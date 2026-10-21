import {sourceSymmetryPaletteLut} from './sourceSymmetryPalette';
import {sourceSymmetryPointDiameter,sourceSymmetrySplatPixelTests} from './sourceSymmetrySplat';
import {compileSourceSamilaDirect,type SourceSamilaDrawObserver} from './sourceSamilaGpuDirect';
import {SourceSamilaGpuResources,sourceSamilaDirectGpuPlan} from './sourceSamilaGpuResources';
import {validateSourceSamilaSamplingBatch} from './sourceSamilaSampling';
import {sourceSamilaNoiseLut,sourceSamilaPaletteLut,sourceSamilaPointDiameter} from './sourceSamilaSplat';
import {SAMILA_NDC_POSITION_GLSL} from './samilaProjection';
import {isCapturedDensityView,type PreparedDensityView} from './densityPresentation';
import type {DensityBounds,DensityProjection} from '../types';
import type {IteratedFrameJob,IteratedField} from '../scenes/iteratedDensity';
import {compileGlslExpression,glslRealPrelude} from './gpuSampler';
import {paletteBaseColor} from './palette';
import {toneDensityRgbaPrepared,type DensityToneJob} from './density';
import {DensityGpuTone,prepareDensityGpuTone,densityGpuToneBytes,sourceDensityPresentationBytes} from './densityGpuTone';
import {iteratedInitialChunk,iteratedSamilaSeedChunk} from './iteratedSeed';
import {createNoisePermutation} from '../scenes/noise';
import {iteratedNoiseGlsl} from './iteratedGpuNoise';
import {compileSamilaGpuField} from './iteratedGpuSamila';
import {symmetryCustomFragmentSource} from './symmetryCustomShader';
import {SAMILA_HISTORY_CEILING} from './samilaHistory';
import {sourceSymmetryGpuField} from './sourceSymmetryMath';

export interface IteratedGpuOptions {resetParticles:boolean;clearInk:boolean;width:number;height:number;projection:DensityProjection;padding:number;bounds?:DensityBounds;isCancelled?:()=>boolean;}
export interface IteratedGpuFacts {bounds:DensityBounds;steps:number;invalid:number;accepted:number;clipped:number;sampleInvalid:number;}
interface Program {value:WebGLProgram;locations:Map<string,WebGLUniformLocation|null>;customBindingsChecked?:boolean;}
interface Resources {drawPaletteKey?:string;paletteFormat:'local-rgba4097'|'source-rgb1024';sourceNoise?:WebGLTexture;sourcePalette?:WebGLTexture;splatPath?:'points'|'quad';paletteKey?:string;count:number;capacity:number;tw:number;th:number;width:number;height:number;positions:WebGLBuffer[];counters:WebGLBuffer[];stateTextures:WebGLTexture[];counterTextures:WebGLTexture[];storage:'buffer'|'texture';ink:WebGLTexture;inkScratch?:WebGLTexture;palette:WebGLTexture;noise:WebGLTexture;floatReduce:WebGLTexture[];uintReduce:WebGLTexture[];framebuffer:WebGLFramebuffer;feedback:WebGLTransformFeedback;vao:WebGLVertexArrayObject;drawVao:WebGLVertexArrayObject;side:number;bytes:number;}
const HEADER='#version 300 es\nprecision highp float;precision highp int;precision highp sampler2D;precision highp usampler2D;\n';
// Bit classification also survives fast-math shader compilation. ANGLE Metal's
// program-cache path can lose its isnan/isinf compile flag; use one explicit
// representation for all contexts instead of relying on that hidden flag.
const FLOAT_CLASSIFY=`bool finiteFloat(float v){return (floatBitsToUint(v)&0x7f800000u)!=0x7f800000u;}
bool finiteVector(vec3 v){return finiteFloat(v.x)&&finiteFloat(v.y)&&finiteFloat(v.z);}`;
const QUAD=HEADER+`void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;
const EMPTY=HEADER+'out vec4 color;void main(){color=vec4(0.);}';
const HISTORY_COPY=HEADER+`uniform sampler2D previousInk;uniform float decay,densityCeiling;out vec4 result;void main(){result=texelFetch(previousInk,ivec2(gl_FragCoord.xy),0)*decay;if(result.a>densityCeiling){result.rgb*=densityCeiling/result.a;result.a=densityCeiling;}}`;
const MAX_BYTES=768*1024*1024,CHUNK=65536,SEED_STAGING_BYTES=CHUNK*24,PALETTE_INTERVALS=4096;
const finite32=(v:number)=>Number.isFinite(v)&&Number.isFinite(Math.fround(v));
const checked=(v:boolean,message:string)=>{if(!v)throw new Error(message);};
function checkBounds(b:DensityBounds){checked([b.minX,b.maxX,b.minY,b.maxY].every(finite32)&&Math.fround(b.maxX)>Math.fround(b.minX)&&Math.fround(b.maxY)>Math.fround(b.minY)&&finite32(Math.fround(b.maxX)-Math.fround(b.minX))&&finite32(Math.fround(b.maxY)-Math.fround(b.minY)),'GPU 视口在 float32 中退化');}
const checkCancelled=(f?:()=>boolean)=>{if(f?.())throw new DOMException('GPU 持续密度已取消','AbortError');};
/** Structural estimate includes every resident buffer/texture, two reduction
 * formats and a final image readback. It excludes driver/program overhead. */
export function iteratedGpuBytes(count:number,width:number,height:number,textureWidth=2048,boundedHistory=false,customStorage=false,sourceSplat=false,sourcePresentation=false,sourceSampling=false):number {
 if(sourceSampling)return sourceSamilaDirectGpuPlan(count,width,height,{textureLimit:textureWidth,sourcePresentation}).estimatedBytes;
 checked(typeof sourcePresentation==='boolean'&&typeof sourceSplat==='boolean'&&typeof boundedHistory==='boolean'&&typeof customStorage==='boolean','GPU 历史模型容量标记无效');
 checked(Number.isInteger(count)&&count>0&&count<=8_000_000,'GPU 粒子数须为 1–8000000');
 checked([width,height,textureWidth].every(n=>Number.isInteger(n)&&n>0&&n<=16384),'GPU 密度尺寸无效');
 const tw=Math.min(textureWidth,count),th=Math.ceil(count/tw),capacity=tw*th,reduce=Math.ceil(tw/2)*Math.ceil(th/2);
 return (sourcePresentation?sourceDensityPresentationBytes(width,height):0)+(sourceSplat?256*256*4*2+1024*3*4*2:0)+capacity*(customStorage?48:72)+reduce*64+width*height*(boundedHistory?48:32)+width*16+(PALETTE_INTERVALS+1)*32+SEED_STAGING_BYTES+512+densityGpuToneBytes();
}
export interface IteratedGpuFieldSource {source:string;uniforms:Readonly<Record<string,number>>;key:string;stage?:'fragment';sourceSymmetry?:true;}
/** Coordinates and explicit sequential aliases use the existing safe AST emitter.
 * Parameter values remain uniforms and never enter a shader-cache key. */
export function iteratedGpuFieldSource(field:IteratedField):IteratedGpuFieldSource {
 if(field.kind==='symmetry-custom')return{source:symmetryCustomFragmentSource(field.plan),uniforms:field.uniforms,key:field.plan.programKey,stage:'fragment'};
 if(field.kind==='samila')return compileSamilaGpuField(field);
 if(field.kind==='symmetry'){
  if(field.mathModel)return sourceSymmetryGpuField(field.parameters);
  const q=field.parameters,values=[q.lambda,q.alpha,q.beta,q.gamma,q.omega,q.n,q.template==='modified'?(q.delta??0):0,q.deltaPower??1];
  checked(values.every(finite32),'对称参数超出 GPU float32');
  const uniforms=Object.fromEntries(values.map((v,i)=>['q'+i,v]));
  const source=`${values.map((_,i)=>`uniform float q${i};`).join('\n')}
vec3 nextPoint(vec3 p){float r=length(p.xy),theta=r==0.?0.:atan(p.y,p.x),rn=pow(r,q5),rp=pow(r,q5-1.);float gain=q0+q1*r*r+q2*rn*cos(q5*theta)+q6*r*cos(q5*q7*theta);return vec3(gain*p.x+q3*rp*cos((q5-1.)*theta)-q4*p.y,gain*p.y-q3*rp*sin((q5-1.)*theta)+q4*p.x,0.);}`;
  return{source,uniforms,key:'symmetry'};
 }
 const names=Object.keys(field.parameters).sort(),reserved=new Set(['x','y','z','t','time','nx','ny','nz','x_next','y_next','z_next','constructor','prototype','__proto__']);
 checked(!names.some(n=>reserved.has(n)),'GPU 映射参数覆盖保留变量');
 const base=[...names,'t','time'],values=[...names.map(n=>field.parameters[n]),field.time,field.time];checked(values.every(finite32),'映射参数超出 GPU float32');
 const nx=compileGlslExpression(field.equations.x,['x','y','z'],base),ny=compileGlslExpression(field.equations.y,['x','y','z'],[...base,'nx','x_next']),nz=field.dimension===3?compileGlslExpression(field.equations.z?.trim()||'z',['x','y','z'],[...base,'nx','x_next','ny','y_next']):'0.0';
 const source=`${values.map((_,i)=>`uniform float parameter${i};`).join('\n')}
vec3 nextPoint(vec3 samplePosition){float nextX=${nx};float parameter${base.length}=nextX,parameter${base.length+1}=nextX;float nextY=${ny};float parameter${base.length+2}=nextY,parameter${base.length+3}=nextY;return vec3(nextX,nextY,${nz});}`;
 return{source,uniforms:Object.fromEntries(values.map((v,i)=>['parameter'+i,v])),key:source};
}
const STEP=HEADER+`
layout(location=0)in vec4 oldState;layout(location=1)in uvec2 oldMetadata;
out vec4 newState;flat out uvec2 newMetadata;
uniform uint seed,serialBase;uniform vec3 lower,upper;uniform int dimension,samila,resetCounter,steps;uniform float escapeRadius;
${glslRealPrelude}
${FLOAT_CLASSIFY}
uint address(uint id,uint serial,uint channel){uint x=seed^((id+1u)*0x9e3779b1u)^(serial*0x85ebca77u)^((channel+1u)*0x27d4eb2du);x=(x^(x>>16))*0x7feb352du;x=(x^(x>>15))*0x846ca68bu;return x^(x>>16);}
vec3 initial(uint id,uint serial){vec3 u=vec3(address(id,serial,0u),address(id,serial,1u),address(id,serial,2u))/4294967296.;vec3 p=lower+(upper-lower)*u;if(dimension==2)p.z=0.;return p;}
float stableLength(vec3 p){float m=max(max(abs(p.x),abs(p.y)),abs(p.z));return m==0.?0.:m*length(p/m);}
bool bad(vec3 p){return !finiteVector(p);}
`;
const STEP_MAIN=`void main(){uint id=uint(gl_VertexID);vec3 p=oldState.xyz;uint invalid=resetCounter==1?0u:oldMetadata.r;float metric=0.;bool valid=true;
for(int j=0;j<256;j++){if(j>=steps)break;vec3 next=nextPoint(p);valid=!bad(next)&&(samila==1||stableLength(next)<=escapeRadius);if(valid){metric=samila==1?0.:stableLength(next-p);p=next;}else{invalid++;p=samila==1?next:initial(id,serialBase+uint(j));}}
newState=vec4(p,metric);newMetadata=uvec2(invalid,valid?1u:0u);gl_Position=vec4(0.);}`;
// Source update preserves even nonfinite state; local diagnostics may hide an
// invalid splat but must never reseed or clamp the mathematical trajectory.
const SOURCE_SYMMETRY_STEP_MAIN=`void main(){vec3 p=oldState.xyz;float metric=oldState.w;uint invalid=resetCounter==1?0u:oldMetadata.r;bool valid=(oldMetadata.g&1u)!=0u;
for(int j=0;j<256;j++){if(j>=steps)break;vec3 next=p;float nextMetric=metric;calculate_next(p,next,nextMetric);next.z=0.;p=next;metric=nextMetric;valid=finiteVector(p)&&finiteFloat(metric);if(!valid)invalid++;}
newState=vec4(p,metric);newMetadata=uvec2(invalid,valid?1u:0u);gl_Position=vec4(0.);}`;
const TRANSFORM=`${FLOAT_CLASSIFY}
uniform vec3 scale,offset;uniform vec2 turn;uniform ivec2 axes;
uniform int samilaNdc;uniform float samilaAspect;uniform vec2 samilaOffset;
${SAMILA_NDC_POSITION_GLSL}
uniform int capturedCamera;uniform mat4 capturedProjection,capturedModelView;
float norm3(vec3 p){float m=max(max(abs(p.x),abs(p.y)),abs(p.z));return m==0.?0.:m*sqrt(dot(p/m,p/m));}
vec3 transformed(vec3 p){return vec3(p.x*scale.x*turn.x-p.y*scale.y*turn.y+offset.x,p.x*scale.x*turn.y+p.y*scale.y*turn.x+offset.y,p.z*scale.z+offset.z);}
// Both statistics and draw use this exact staged projection. Color remains
// a function of the mathematical point, not screen-space coordinates.
bool densityPosition(vec3 point,out vec2 projected){
 if(samilaNdc==1){projected=samilaNdcPosition(point);return finiteFloat(projected.x)&&finiteFloat(projected.y);}
 if(capturedCamera==0){projected=vec2(point[axes.x],point[axes.y]);return true;}
 vec4 eye=capturedModelView*vec4(point,1.);vec4 clip=capturedProjection*eye;
 if(!finiteVector(clip.xyz)||!finiteFloat(clip.w)||clip.w<=0.||clip.z< -clip.w||clip.z>clip.w){projected=vec2(0.);return false;}
 projected=clip.xy/clip.w;return finiteFloat(projected.x)&&finiteFloat(projected.y);
}
bool invalidPosition(vec4 p,vec3 t,uint valid){return (valid&1u)==0u||(samilaNdc==0&&(abs(p.x)>=1e12||abs(p.y)>=1e12))||!finiteVector(t)||(samilaNdc==1&&!finiteVector(vec3(samilaNdcPosition(t),0.)));}
`;
const BOUNDS_FIRST=HEADER+TRANSFORM+`uniform sampler2D states;uniform usampler2D counters;uniform ivec2 sourceSize;uniform int count;out vec4 result;
void main(){ivec2 at=ivec2(gl_FragCoord.xy)*2;vec4 bounds=vec4(3.402823466e38,-3.402823466e38,3.402823466e38,-3.402823466e38);for(int y=0;y<2;y++)for(int x=0;x<2;x++){ivec2 p=at+ivec2(x,y);if(any(greaterThanEqual(p,sourceSize))||p.y*sourceSize.x+p.x>=count)continue;vec4 state=texelFetch(states,p,0);vec3 t=transformed(state.xyz);if(invalidPosition(state,t,texelFetch(counters,p,0).g))continue;bounds.x=min(bounds.x,t[axes.x]);bounds.y=max(bounds.y,t[axes.x]);bounds.z=min(bounds.z,t[axes.y]);bounds.w=max(bounds.w,t[axes.y]);}result=bounds;}`;
const BOUNDS_REDUCE=HEADER+`uniform sampler2D values;uniform ivec2 sourceSize;out vec4 result;void main(){ivec2 at=ivec2(gl_FragCoord.xy)*2;vec4 b=vec4(3.402823466e38,-3.402823466e38,3.402823466e38,-3.402823466e38);for(int y=0;y<2;y++)for(int x=0;x<2;x++){ivec2 p=at+ivec2(x,y);if(any(greaterThanEqual(p,sourceSize)))continue;vec4 v=texelFetch(values,p,0);b=vec4(min(b.x,v.x),max(b.y,v.y),min(b.z,v.z),max(b.w,v.w));}result=b;}`;
const SUM=`uvec4 sum(uvec4 a,uvec4 b){uint lo=a.x+b.x;return uvec4(lo,a.y+b.y+uint(lo<a.x),a.z+b.z,a.w+b.w);}`;
const STATS_FIRST=HEADER+TRANSFORM+SUM+`uniform sampler2D states;uniform usampler2D counters;uniform ivec2 sourceSize,size;uniform int count,recording,sourcePointClip;uniform vec4 bounds;uniform float radius;out uvec4 result;
void main(){ivec2 at=ivec2(gl_FragCoord.xy)*2;uvec4 total=uvec4(0);for(int y=0;y<2;y++)for(int x=0;x<2;x++){ivec2 p=at+ivec2(x,y);if(any(greaterThanEqual(p,sourceSize))||p.y*sourceSize.x+p.x>=count)continue;vec4 state=texelFetch(states,p,0);vec3 t=transformed(state.xyz);uvec2 metadata=texelFetch(counters,p,0).rg;uint invalid=metadata.r,accepted=0u,clipped=0u;if(recording==1&&(metadata.g&1u)!=0u){vec2 projected;if(invalidPosition(state,t,metadata.g))invalid++;else if(!densityPosition(t,projected))clipped++;else if(sourcePointClip!=0&&(any(lessThan(projected,bounds.xz))||any(greaterThan(projected,bounds.yw))))clipped++;else{vec2 pixel=vec2((projected.x-bounds.x)/(bounds.y-bounds.x),(bounds.w-projected.y)/(bounds.w-bounds.z))*vec2(size)-.5;vec2 lo=max(vec2(0),ceil(pixel-radius-.5)),hi=min(vec2(size)-1.,floor(pixel+radius+.5));if(any(greaterThan(lo,hi)))clipped=1u;else accepted=1u;}}total=sum(total,uvec4(invalid,0u,accepted,clipped));}result=total;}`;
const STATS_REDUCE=HEADER+SUM+`uniform usampler2D values;uniform ivec2 sourceSize;out uvec4 result;void main(){ivec2 at=ivec2(gl_FragCoord.xy)*2;uvec4 total=uvec4(0);for(int y=0;y<2;y++)for(int x=0;x<2;x++){ivec2 p=at+ivec2(x,y);if(any(greaterThanEqual(p,sourceSize)))continue;total=sum(total,texelFetch(values,p,0));}result=total;}`;
const CUSTOM_ERRORS_FIRST=HEADER+`uniform usampler2D counters;uniform ivec2 sourceSize;uniform int count;out uvec4 result;void main(){ivec2 at=ivec2(gl_FragCoord.xy)*2;uint flags=0u;for(int y=0;y<2;y++)for(int x=0;x<2;x++){ivec2 p=at+ivec2(x,y);if(any(greaterThanEqual(p,sourceSize))||p.y*sourceSize.x+p.x>=count)continue;flags|=texelFetch(counters,p,0).g&2u;}result=uvec4(flags,0u,0u,0u);}`;
const CUSTOM_ERRORS_REDUCE=HEADER+`uniform usampler2D values;uniform ivec2 sourceSize;out uvec4 result;void main(){ivec2 at=ivec2(gl_FragCoord.xy)*2;uint flags=0u;for(int y=0;y<2;y++)for(int x=0;x<2;x++){ivec2 p=at+ivec2(x,y);if(any(greaterThanEqual(p,sourceSize)))continue;flags|=texelFetch(values,p,0).r;}result=uvec4(flags,0u,0u,0u);}`;
const DRAW_VERTEX=HEADER+TRANSFORM+iteratedNoiseGlsl+`
uniform sampler2D states;uniform usampler2D counters;uniform int stateWidth;uniform ivec2 size;uniform vec4 bounds;uniform float radius,metricMin,metricRange,colorSpeed,colorPhase,paletteCycles,paletteOffset;uniform int metricMode,colorMode,count,particleOffset;
uniform sampler2D palette;uniform bool symmetrySplat,quadSplat,symmetryLut;out vec2 localPoint;flat out float diameter;flat out vec2 center;flat out vec3 tint;
void main(){int id=particleOffset+gl_InstanceID;ivec2 at=ivec2(id%stateWidth,id/stateWidth);vec4 particle=texelFetch(states,at,0);vec3 p=transformed(particle.xyz);vec2 projected;if(invalidPosition(particle,p,texelFetch(counters,at,0).g)||!densityPosition(p,projected)){gl_Position=vec4(2.,2.,0.,1.);center=vec2(-1e30);tint=vec3(0.);return;}
float u=0.;if(colorMode==0){float d=max(0.,particle.w-metricMin);if(symmetrySplat){float normalized=(particle.w-metricMin)/max(metricRange,1.e-6);float positive=max(normalized,0.);u=clamp(metricMode==1?positive/(1.+positive):normalized,0.,1.);}else u=metricMode==1?(d==0.?0.:1./(1.+metricRange/d)):min(1.,d/metricRange);}else if(colorMode==1)u=float(particleOffset+gl_InstanceID)/float(max(1,count-1));else if(colorMode==2)u=norm3(p);else if(colorMode==3)u=(atan(p.y,p.x)+3.141592653589793)/6.283185307179586;else if(colorMode==4)u=p.y;else u=clamp((spatialNoise(p*.1)+1.)/2.,0.,1.);
float coordinate=(u*colorSpeed+colorPhase/360.)*paletteCycles+paletteOffset;float q=fract(coordinate)*4096.;int i=min(4095,int(floor(q)));tint=symmetryLut?texture(palette,vec2(fract(u*max(colorSpeed,.001)),.5)).rgb:(!finiteFloat(coordinate))?vec3(uintBitsToFloat(0x7fc00000u)):mix(texelFetch(palette,ivec2(i,0),0).rgb,texelFetch(palette,ivec2(i+1,0),0).rgb,q-float(i));
center=vec2((projected.x-bounds.x)/(bounds.y-bounds.x),(projected.y-bounds.z)/(bounds.w-bounds.z))*vec2(size);
vec2 corners[6]=vec2[6](vec2(-1.,-1.),vec2(1.,-1.),vec2(-1.,1.),vec2(-1.,1.),vec2(1.,-1.),vec2(1.,1.));diameter=quadSplat?max(radius*.6,.8):max(radius,1.);localPoint=corners[gl_VertexID];gl_PointSize=max(radius,1.);vec2 pixel=center+(symmetrySplat?(quadSplat?localPoint*diameter*.5:vec2(0.)):localPoint*(radius+.5));gl_Position=vec4(pixel/vec2(size)*2.-1.,0.,1.);}`;
// Native density_map_accumulate{,_quad}.frag, adapted to local RGB/mass
// channel order. The old disc kernel remains only for legacy/map rendering.
const DRAW_FRAGMENT=HEADER+`flat in vec2 center;flat in vec3 tint;in vec2 localPoint;flat in float diameter;uniform float radius,alpha;uniform bool symmetrySplat,quadSplat;out vec4 result;void main(){float mass;
if(symmetrySplat){vec2 p=quadSplat?localPoint:gl_PointCoord*2.-1.;float r2=dot(p,p);if(r2>(quadSplat?1.35:1.))discard;
mass=quadSplat?(1.-smoothstep(-.75,.75,(sqrt(r2)-1.)*max(diameter*.5,.4)))*exp(-.45*r2):1.-smoothstep(.75,1.,r2);
}else mass=clamp(radius+.5-length(gl_FragCoord.xy-center),0.,1.)*alpha;result=vec4(tint*mass,mass);}`;

const SOURCE_DRAW_VERTEX=HEADER+TRANSFORM+`
uniform sampler2D states,noiseLUT,palette;uniform usampler2D counters;uniform int stateWidth,particleOffset;uniform ivec2 size;uniform float radius,colorPhase;uniform bool quadSplat,usePaletteLut;
out vec2 localPoint;flat out vec3 tint;flat out float localRadius,diameter;
void main(){int id=particleOffset+gl_InstanceID;ivec2 at=ivec2(id%stateWidth,id/stateWidth);vec4 particle=texelFetch(states,at,0);vec3 p=transformed(particle.xyz);vec2 ndc;
if(invalidPosition(particle,p,texelFetch(counters,at,0).g)||!densityPosition(p,ndc)){gl_Position=vec4(2.,2.,0.,1.);gl_PointSize=1.;localPoint=vec2(0.);localRadius=0.;diameter=1.;tint=vec3(0.);return;}
float n=texture(noiseLUT,ndc*.1+.5).r;n=isnan(n)?0.:n;n*=.5;float u=clamp((n+.5*.85)/(.5*1.7),0.,1.);tint=usePaletteLut?texture(palette,vec2(u,.5)).rgb:.5+.5*cos(6.283185307179586*(vec3(u)-vec3(0.,1./3.,2./3.))-colorPhase);
vec2 corners[6]=vec2[6](vec2(-1.,-1.),vec2(1.,-1.),vec2(-1.,1.),vec2(-1.,1.),vec2(1.,-1.),vec2(1.,1.));
diameter=quadSplat?max(radius*.6,.8):max(radius,1.);localRadius=quadSplat?1.:min(radius,1.);localPoint=quadSplat?corners[gl_VertexID]:vec2(0.);gl_PointSize=max(radius,1.);gl_Position=vec4(ndc+(quadSplat?localPoint*diameter*.5*2./vec2(size):vec2(0.)),0.,1.);}`;
const SOURCE_DRAW_FRAGMENT=HEADER+`
in vec2 localPoint;flat in vec3 tint;flat in float localRadius,diameter;uniform float alpha;uniform bool quadSplat;out vec4 result;
void main(){vec2 p=quadSplat?localPoint:gl_PointCoord*2.-1.;float dist=length(p),r=quadSplat?1.:max(localRadius,.01);if(dist>(quadSplat?1.35:r))discard;
float mass=quadSplat?(1.-smoothstep(-.75,.75,(dist-1.)*max(diameter*.5,.4)))*exp(-.45*dot(p,p))*alpha:(1.-smoothstep(r*.75,r,dist))*alpha;
// Explicit permutation of native (mass,rgbMass) into local (rgbMass,mass).
result=vec4(tint*mass,mass);}`;
const POINT_PROBE_VERTEX=HEADER+`void main(){gl_Position=vec4(0.,0.,0.,1.);gl_PointSize=32.;}`;
const POINT_PROBE_FRAGMENT=HEADER+`out vec4 result;void main(){vec2 p=gl_PointCoord*2.-1.;if(dot(p,p)>1.)discard;result=vec4(1.);}`;

/** One worker session owns all GPU resources. It never samples timeline time or
 * parses Settings. A failed frame destroys partial state. The session may replay
 * built-in fields on CPU; custom GLSL is an explicit error, never a built-in substitute. */
export class IteratedDensityGpu {
 private direct?:SourceSamilaGpuResources;private cleanupPending=false;private pendingAllocation?:()=>void;private pendingAllocationBytes=0;
 private readonly observeSourceDraw?:SourceSamilaDrawObserver;
 constructor(options:{observeSourceDraw?:SourceSamilaDrawObserver}={}){if(options.observeSourceDraw!==undefined&&typeof options.observeSourceDraw!=='function')throw Error('源 Samila 绘制观察接口无效');this.observeSourceDraw=options.observeSourceDraw;}
 private tone?:DensityGpuTone;private gl?:WebGL2RenderingContext;private programs=new Map<string,Program>();private resources?:Resources;private bounds?:DensityBounds;private structuralKey='';private frame=-1;
 diagnostics(){if(this.direct){const r=this.direct;return{cleanupPending:this.cleanupPending,resourceModel:r.plan.model,retainedBytes:r.plan.residentBytes+(r.sourceNoise?256*256*4:0)+(r.sourcePalette?1024*3*4:0)+(this.tone?.diagnostics().retainedBytes??0),estimatedPeakBytes:r.plan.estimatedBytes+(this.tone?.sourceTargetBytes()??0)+(this.tone?.sourceTargetBytes()?r.width*r.height*4:0),frame:this.frame,programs:this.programs.size+(this.tone?.diagnostics().programs??0),particleCount:r.count,statisticsBytes:r.plan.statisticsBytes,observationBytes:r.plan.observationBytes};}const r=this.resources;return{cleanupPending:this.cleanupPending,retainedBytesAccuracy:this.pendingAllocation?'allocation-upper-bound':'known-storage',pendingAllocationBytes:this.pendingAllocationBytes,retainedBytes:r?r.bytes-(r.paletteFormat==='source-rgb1024'?(PALETTE_INTERVALS+1)*16-1024*12:0)+(r.sourceNoise?256*256*4+1024*3*4:0)-r.width*r.height*16-r.width*16-(PALETTE_INTERVALS+1)*16-SEED_STAGING_BYTES-256-densityGpuToneBytes()+(this.tone?.diagnostics().retainedBytes??0)+this.pendingAllocationBytes:this.pendingAllocationBytes,estimatedPeakBytes:r?r.bytes+this.pendingAllocationBytes+(this.tone?.sourceTargetBytes()??0)+(this.tone?.sourceTargetBytes()?r.width*r.height*4:0)+(r.sourceNoise?256*256*4*2+1024*3*4*2:0):0,frame:this.frame,programs:this.programs.size+(this.tone?.diagnostics().programs??0),particleCount:r?.count??0};}
 private context(){
  if(this.gl?.isContextLost()){this.reset();throw new Error('GPU 持续密度上下文已丢失');}
  if(!this.gl){checked(typeof OffscreenCanvas!=='undefined','OffscreenCanvas 不可用');const gl=new OffscreenCanvas(1,1).getContext('webgl2',{antialias:false,depth:false,alpha:false});checked(Boolean(gl),'WebGL2 不可用');this.gl=gl!;checked(Boolean(gl!.getExtension('EXT_color_buffer_float')),'GPU 缺少 EXT_color_buffer_float');checked(Boolean(gl!.getExtension('EXT_float_blend')),'GPU 缺少 EXT_float_blend');}
  return this.gl!;
 }
 private program(key:string,vertex:string,fragment:string,varyings?:string[]):Program {
  const gl=this.context(),existing=this.programs.get(key);if(existing)return existing;
  const p=gl.createProgram();checked(Boolean(p),'GPU program 分配失败');const shaders:WebGLShader[]=[];
  try{for(const [type,source]of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]] as const){const s=gl.createShader(type);checked(Boolean(s),'GPU shader 分配失败');shaders.push(s!);gl.shaderSource(s!,source);gl.compileShader(s!);checked(gl.getShaderParameter(s!,gl.COMPILE_STATUS),`GPU shader 编译失败：${gl.getShaderInfoLog(s!)?.slice(0,500)}`);gl.attachShader(p!,s!);}if(varyings)gl.transformFeedbackVaryings(p!,varyings,gl.SEPARATE_ATTRIBS);gl.linkProgram(p!);checked(gl.getProgramParameter(p!,gl.LINK_STATUS),`GPU 链接失败：${gl.getProgramInfoLog(p!)}`);const result={value:p!,locations:new Map<string,WebGLUniformLocation|null>()};this.programs.set(key,result);if(this.programs.size>14){const oldest=this.programs.keys().next().value!,evicted=this.programs.get(oldest)!.value;if(gl.getParameter(gl.CURRENT_PROGRAM)===evicted)gl.useProgram(null);gl.deleteProgram(evicted);this.programs.delete(oldest);}return result;
  }catch(e){gl.deleteProgram(p);throw e;}finally{shaders.forEach(s=>gl.deleteShader(s));}
 }
 private location(p:Program,name:string){if(!p.locations.has(name))p.locations.set(name,this.gl!.getUniformLocation(p.value,name));return p.locations.get(name)!;}
 private f(p:Program,name:string,v:number){checked(finite32(v),`${name} 超出 GPU float32`);this.gl!.uniform1f(this.location(p,name),Math.fround(v));}
 private i(p:Program,name:string,v:number){this.gl!.uniform1i(this.location(p,name),v);}
 private iv(p:Program,name:string,x:number,y:number){this.gl!.uniform2i(this.location(p,name),x,y);}
 private texture(texture:WebGLTexture,unit:number){const gl=this.gl!;gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);}
 private stateTexture(){const r=this.resources!;return r.stateTextures[r.storage==='texture'?r.side:0];}
 private counterTexture(){const r=this.resources!;return r.counterTextures[r.storage==='texture'?r.side:0];}
 private target(texture:WebGLTexture,w:number,h:number){const gl=this.gl!,r=(this.resources??this.direct)!;gl.bindFramebuffer(gl.FRAMEBUFFER,r.framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT1,gl.TEXTURE_2D,null,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);const direct=this.direct;if(!direct||!direct.ownsTarget(texture)||!direct.validatedTargets.has(texture)){checked(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'GPU framebuffer 不完整');if(direct?.ownsTarget(texture))direct.validatedTargets.add(texture);}gl.viewport(0,0,w,h);}
 private allocate(count:number,width:number,height:number,boundedHistory:boolean,customStorage:boolean){
  const gl=this.context(),limit=Math.min(2048,gl.getParameter(gl.MAX_TEXTURE_SIZE)),bytes=iteratedGpuBytes(count,width,height,limit,boundedHistory,customStorage);checked(bytes<=MAX_BYTES,'GPU 持续密度已知缓冲超过 768 MiB');checked(PALETTE_INTERVALS+1<=gl.getParameter(gl.MAX_TEXTURE_SIZE),'GPU 色板纹理尺寸不足');checked(width<=gl.getParameter(gl.MAX_TEXTURE_SIZE)&&height<=gl.getParameter(gl.MAX_TEXTURE_SIZE),'画布超过 GPU 纹理尺寸');
  const tw=Math.min(count,limit),th=Math.ceil(count/tw);checked(th<=gl.getParameter(gl.MAX_TEXTURE_SIZE),'粒子状态超过 GPU 纹理尺寸');this.releaseResources();
  const buffers:WebGLBuffer[]=[],textures:WebGLTexture[]=[],vaos:WebGLVertexArrayObject[]=[];let framebuffer:WebGLFramebuffer|null=null,feedback:WebGLTransformFeedback|null=null;
  // Install ownership before the first fallible allocation. Cleanup failures
  // retain this closure and its remaining handles for reset() to retry.
  this.pendingAllocationBytes=bytes;const releaseAllocation=()=>{const errors:unknown[]=[];const release=<T>(items:T[],remove:(item:T)=>void)=>{for(let i=items.length-1;i>=0;i--)try{remove(items[i]);items.splice(i,1);}catch(error){errors.push(error);}};
   release(buffers,b=>gl.deleteBuffer(b));release(textures,t=>gl.deleteTexture(t));release(vaos,v=>gl.deleteVertexArray(v));
   if(framebuffer)try{gl.deleteFramebuffer(framebuffer);framebuffer=null;}catch(error){errors.push(error);}if(feedback)try{gl.deleteTransformFeedback(feedback);feedback=null;}catch(error){errors.push(error);}
   if(errors.length)throw new AggregateError(errors,'GPU 未完成分配的资源清理失败；保留所有权待重试');};this.pendingAllocation=releaseAllocation;
  const buffer=(size:number)=>{const b=gl.createBuffer();checked(Boolean(b),'GPU buffer 分配失败');buffers.push(b!);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,size,gl.DYNAMIC_COPY);return b!;};
  const texture=(w:number,h:number,format:number,layout:number,type:number)=>{const t=gl.createTexture();checked(Boolean(t),'GPU texture 分配失败');textures.push(t!);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,format,w,h,0,layout,type,null);return t!;};
  const vao=()=>{const v=gl.createVertexArray();checked(Boolean(v),'GPU VAO 分配失败');vaos.push(v!);return v!;};
  try{const capacity=tw*th,positions=customStorage?[]:[buffer(capacity*16),buffer(capacity*16)],counters=customStorage?[]:[buffer(capacity*8),buffer(capacity*8)],stateTextures=Array.from({length:customStorage?2:1},()=>texture(tw,th,gl.RGBA32F,gl.RGBA,gl.FLOAT)),counterTextures=Array.from({length:customStorage?2:1},()=>texture(tw,th,gl.RG32UI,gl.RG_INTEGER,gl.UNSIGNED_INT)),ink=texture(width,height,gl.RGBA32F,gl.RGBA,gl.FLOAT),inkScratch=boundedHistory?texture(width,height,gl.RGBA32F,gl.RGBA,gl.FLOAT):undefined,palette=texture(PALETTE_INTERVALS+1,1,gl.RGBA32F,gl.RGBA,gl.FLOAT),rw=Math.ceil(tw/2),rh=Math.ceil(th/2),noise=texture(256,1,gl.R8UI,gl.RED_INTEGER,gl.UNSIGNED_BYTE),floatReduce=[texture(rw,rh,gl.RGBA32F,gl.RGBA,gl.FLOAT),texture(rw,rh,gl.RGBA32F,gl.RGBA,gl.FLOAT)],uintReduce=[texture(rw,rh,gl.RGBA32UI,gl.RGBA_INTEGER,gl.UNSIGNED_INT),texture(rw,rh,gl.RGBA32UI,gl.RGBA_INTEGER,gl.UNSIGNED_INT)];framebuffer=gl.createFramebuffer();feedback=gl.createTransformFeedback();checked(Boolean(framebuffer&&feedback),'GPU 状态对象分配失败');const v=vao(),drawVao=vao();checked(gl.getError()===gl.NO_ERROR,'GPU 缓冲分配失败');this.resources={count,capacity,tw,th,width,height,positions,counters,stateTextures,counterTextures,storage:customStorage?'texture':'buffer',ink,inkScratch,palette,noise,floatReduce,uintReduce,framebuffer:framebuffer!,feedback:feedback!,vao:v,drawVao,side:0,bytes,paletteFormat:'local-rgba4097'};this.target(ink,width,height);gl.clearBufferfv(gl.COLOR,0,new Float32Array(4));this.pendingAllocation=undefined;this.pendingAllocationBytes=0;}
  catch(e){this.resources=undefined;try{releaseAllocation();this.pendingAllocation=undefined;this.pendingAllocationBytes=0;}catch(cleanupError){this.cleanupPending=true;throw new AggregateError([e,cleanupError],'GPU 分配失败且清理待重试');}throw e;}
 }
 /** Preflight both capture transitions before changing the retained primary.
  * Includes overlapping old ink/tone, both returned images, and caller-owned
  * enhancement/upscale storage. Driver and compiled-program overhead is unknown. */
 validateAccumulationCapture(width:number,height:number,additionalBytes:number):void {
  const r=this.resources,gl=this.gl;
  checked(Boolean(r&&gl&&!this.direct&&!r.inkScratch&&!this.cleanupPending),'GPU 截图需要可用的单累积目标');
  checked(Number.isSafeInteger(additionalBytes)&&additionalBytes>=0,'GPU 截图额外内存预算无效');
  const state=r!,limit=gl!.getParameter(gl!.MAX_TEXTURE_SIZE) as number;
  checked(width<=limit&&height<=limit,'截图超过 GPU 纹理尺寸');
  const images=(width*height+state.width*state.height)*4;
  for(const [w,h,oldW,oldH] of [[width,height,state.width,state.height],[state.width,state.height,width,height]]){
   const bytes=iteratedGpuBytes(state.count,w,h,state.tw,false,state.storage==='texture',true,true);
   checked(Number.isSafeInteger(bytes+images+additionalBytes)&&bytes+oldW*oldH*36+images+additionalBytes<=MAX_BYTES,'GPU 暂停截图及恢复峰值超过 768 MiB');
  }
 }
 /** Replace only the accumulation attachment. Particle buffers/textures,
  * counters, shader programs and frame sequence keep their existing owner. */
 resizeAccumulation(width:number,height:number,isCancelled?:()=>boolean):boolean {
  if(this.cleanupPending)throw Error('GPU 清理待重试，不能调整累积目标');
  const r=this.resources,gl=this.gl;
  checked(Boolean(r&&gl&&!this.direct&&!r.inkScratch),'GPU 累积调整需要独立粒子状态与单累积目标');
  const state=r!,context=gl!,bytes=iteratedGpuBytes(state.count,width,height,state.tw,false,state.storage==='texture');
  checked(width<=context.getParameter(context.MAX_TEXTURE_SIZE)&&height<=context.getParameter(context.MAX_TEXTURE_SIZE),'画布超过 GPU 纹理尺寸');
  checkCancelled(isCancelled);
  if(state.width===width&&state.height===height)return false;
  // Both old and new attachments coexist until replacement commits. Existing
  // tone targets are released before allocation, but budget their overlap too.
  checked(bytes+state.width*state.height*16+(this.tone?.diagnostics().retainedBytes??0)+(state.sourceNoise?256*256*4+1024*3*4:0)<=MAX_BYTES,'GPU 累积调整峰值超过 768 MiB');
  let texture:WebGLTexture|null=null;
  try{
   this.tone?.dispose();this.tone=undefined;
   this.pendingAllocationBytes=width*height*16;
   this.pendingAllocation=()=>{if(texture){context.deleteTexture(texture);texture=null;}};
   texture=context.createTexture();checked(Boolean(texture),'GPU 累积纹理分配失败');
   this.texture(texture!,0);context.texParameteri(context.TEXTURE_2D,context.TEXTURE_MIN_FILTER,context.NEAREST);context.texParameteri(context.TEXTURE_2D,context.TEXTURE_MAG_FILTER,context.NEAREST);context.texParameteri(context.TEXTURE_2D,context.TEXTURE_WRAP_S,context.CLAMP_TO_EDGE);context.texParameteri(context.TEXTURE_2D,context.TEXTURE_WRAP_T,context.CLAMP_TO_EDGE);
   context.texImage2D(context.TEXTURE_2D,0,context.RGBA32F,width,height,0,context.RGBA,context.FLOAT,null);
   this.target(texture!,width,height);context.disable(context.SCISSOR_TEST);context.colorMask(true,true,true,true);context.clearBufferfv(context.COLOR,0,new Float32Array(4));
   checked(context.getError()===context.NO_ERROR&&!context.isContextLost(),'GPU 累积调整失败');checkCancelled(isCancelled);
   context.deleteTexture(state.ink);state.ink=texture!;texture=null;
   this.pendingAllocation=undefined;this.pendingAllocationBytes=0;
   state.width=width;state.height=height;state.bytes=bytes;state.splatPath=undefined;this.bounds=undefined;
   return true;
  }catch(error){try{this.reset();}catch(cleanupError){throw new AggregateError([error,cleanupError],'GPU 累积调整失败且清理待重试');}throw error;}
 }
 private transform(p:Program,job:IteratedFrameJob,projection:DensityProjection){const gl=this.gl!,t=job.transform;checked([t.sx,t.sy,t.sz,t.ox,t.oy,t.oz,t.co,t.si].every(finite32),'粒子变换超出 GPU float32');gl.uniform3f(this.location(p,'scale'),Math.fround(t.sx),Math.fround(t.sy),Math.fround(t.sz));gl.uniform3f(this.location(p,'offset'),Math.fround(t.ox),Math.fround(t.oy),Math.fround(t.oz));gl.uniform2f(this.location(p,'turn'),Math.fround(t.co),Math.fround(t.si));const a={xy:[0,1],xz:[0,2],yz:[1,2]}[projection];checked(Boolean(a),'GPU 投影无效');this.iv(p,'axes',a[0],a[1]);
  this.i(p,'samilaNdc',job.samilaProjection?1:0);gl.uniform2f(this.location(p,'samilaOffset'),job.samilaProjection?.offsetX??0,job.samilaProjection?.offsetY??0);this.f(p,'samilaAspect',this.resources!.width/this.resources!.height);
  this.i(p,'capturedCamera',job.sourceCamera?1:0);if(job.sourceCamera){const anchor=job.sourceCamera.anchor;for(const [name,matrix]of[['capturedProjection',anchor.projection],['capturedModelView',anchor.modelView]]as const){gl.uniformMatrix4fv(this.location(p,name),false,matrix.columnMajor);}}
 }
 private setBounds(p:Program,b:DensityBounds){checkBounds(b);this.gl!.uniform4f(this.location(p,'bounds'),Math.fround(b.minX),Math.fround(b.maxX),Math.fround(b.minY),Math.fround(b.maxY));}
 private iterate(job:IteratedFrameJob,source:IteratedGpuFieldSource,steps:number,serial:number,resetCounter:boolean,cancel?:()=>boolean){
  if(source.stage==='fragment'){this.iterateCustom(job,source,steps,serial,resetCounter,cancel);return;}
  const gl=this.gl!,r=this.resources!,p=this.program('step:'+source.key,STEP+source.source+(source.sourceSymmetry?SOURCE_SYMMETRY_STEP_MAIN:STEP_MAIN),EMPTY,['newState','newMetadata']);
  checked(Object.keys(source.uniforms).length+16<=gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),'GPU 公式 uniform 容量不足');gl.useProgram(p.value);for(const [name,value]of Object.entries(source.uniforms))this.f(p,name,value);
  const cfg=job.config;gl.uniform1ui(this.location(p,'seed'),cfg.seed);gl.uniform1ui(this.location(p,'serialBase'),serial);gl.uniform3f(this.location(p,'lower'),...cfg.bounds.map(v=>Math.fround(v[0])) as [number,number,number]);gl.uniform3f(this.location(p,'upper'),...cfg.bounds.map(v=>Math.fround(v[1])) as [number,number,number]);this.i(p,'dimension',cfg.dimension);this.i(p,'samila',job.kind==='samila'?1:0);this.i(p,'resetCounter',resetCounter?1:0);this.i(p,'steps',steps);this.f(p,'escapeRadius',cfg.escape);
  const next=1-r.side;gl.bindVertexArray(r.vao);gl.bindBuffer(gl.ARRAY_BUFFER,r.positions[r.side]);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,4,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ARRAY_BUFFER,r.counters[r.side]);gl.enableVertexAttribArray(1);gl.vertexAttribIPointer(1,2,gl.UNSIGNED_INT,0,0);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,r.feedback);gl.enable(gl.RASTERIZER_DISCARD);
  try{for(let offset=0;offset<r.count;offset+=CHUNK){checkCancelled(cancel);const n=Math.min(CHUNK,r.count-offset);gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER,0,r.positions[next],offset*16,n*16);gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER,1,r.counters[next],offset*8,n*8);gl.beginTransformFeedback(gl.POINTS);try{gl.drawArrays(gl.POINTS,offset,n);}finally{gl.endTransformFeedback();}}r.side=next;}
  finally{gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,1,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindVertexArray(null);}
 }
 /** Initial seeds have one owner. Upload bounded rows directly for texture
  * states; no duplicated CPU orbit or whole-capacity staging array is retained. */
 private uploadInitial(values:Float32Array,offset:number){
  const gl=this.gl!,r=this.resources!,count=values.length/4,metadata=new Uint32Array(count*2);
  // Finite seeds are valid before the first object update. Reset error flags at
  // the seed owner, including when a display occurs without any iteration.
  for(let i=0;i<count;i++)metadata[i*2+1]=1;
  if(r.storage==='buffer'){gl.bindBuffer(gl.ARRAY_BUFFER,r.positions[r.side]);gl.bufferSubData(gl.ARRAY_BUFFER,offset*16,values);gl.bindBuffer(gl.ARRAY_BUFFER,r.counters[r.side]);gl.bufferSubData(gl.ARRAY_BUFFER,offset*8,metadata);return;}
  let consumed=0;
  while(consumed<count){const at=offset+consumed,x=at%r.tw,y=Math.floor(at/r.tw),n=Math.min(r.tw-x,count-consumed);
   this.texture(this.stateTexture(),0);gl.texSubImage2D(gl.TEXTURE_2D,0,x,y,n,1,gl.RGBA,gl.FLOAT,values.subarray(consumed*4,(consumed+n)*4));
   this.texture(this.counterTexture(),1);gl.texSubImage2D(gl.TEXTURE_2D,0,x,y,n,1,gl.RG_INTEGER,gl.UNSIGNED_INT,metadata.subarray(consumed*2,(consumed+n)*2));consumed+=n;
  }
 }
 private iterateCustom(job:IteratedFrameJob,source:IteratedGpuFieldSource,steps:number,serial:number,resetCounter:boolean,cancel?:()=>boolean){
  const gl=this.gl!,r=this.resources!,cfg=job.config,p=this.program('custom:'+source.key,QUAD,source.source);
  checked(r.storage==='texture','自定义对称缺少纹理状态');
  if(!p.customBindingsChecked){const active=new Map<string,WebGLActiveInfo>();for(let i=0;i<gl.getProgramParameter(p.value,gl.ACTIVE_UNIFORMS);i++){const info=gl.getActiveUniform(p.value,i);if(info)active.set(info.name,info);}for(const name of Object.keys(source.uniforms)){const location=this.location(p,name),info=active.get(name);checked(location===null||Boolean(info&&info.type===gl.FLOAT&&info.size===1),`自定义对称 uniform ${name} 不是标量 float`);}p.customBindingsChecked=true;}
  gl.useProgram(p.value);for(const [name,value]of Object.entries(source.uniforms))this.f(p,name,value);
  this.texture(this.stateTexture(),0);this.i(p,'rea_states',0);this.texture(this.counterTexture(),1);this.i(p,'rea_metadata',1);this.iv(p,'rea_sourceSize',r.tw,r.th);this.i(p,'rea_count',r.count);this.i(p,'rea_steps',steps);this.i(p,'rea_resetCounter',resetCounter?1:0);this.f(p,'rea_escapeRadius',cfg.escape);
  gl.uniform1ui(this.location(p,'rea_seed'),cfg.seed);gl.uniform1ui(this.location(p,'rea_serialBase'),serial);gl.uniform3f(this.location(p,'rea_lower'),...cfg.bounds.map(v=>Math.fround(v[0])) as [number,number,number]);gl.uniform3f(this.location(p,'rea_upper'),...cfg.bounds.map(v=>Math.fround(v[1])) as [number,number,number]);
  const next=1-r.side;gl.bindFramebuffer(gl.FRAMEBUFFER,r.framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,r.stateTextures[next],0);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT1,gl.TEXTURE_2D,r.counterTextures[next],0);gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);checked(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'自定义对称 framebuffer 不完整');gl.viewport(0,0,r.tw,r.th);gl.bindVertexArray(null);gl.disable(gl.BLEND);gl.enable(gl.SCISSOR_TEST);
  // Scissors retain full-state gl_FragCoord; row chunks only bound submissions.
  // They cannot interrupt a calculate_next call already running on the device.
  try{const rows=Math.max(1,Math.floor(CHUNK/r.tw));for(let y=0;y<r.th;y+=rows){checkCancelled(cancel);gl.scissor(0,y,r.tw,Math.min(rows,r.th-y));gl.drawArrays(gl.TRIANGLES,0,3);}r.side=next;}
  finally{gl.disable(gl.SCISSOR_TEST);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT1,gl.TEXTURE_2D,null,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);}
 }
 private uploadState(){const gl=this.gl!,r=this.resources!;if(r.storage==='texture')return;this.texture(this.stateTexture(),0);gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,r.positions[r.side]);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,r.tw,r.th,gl.RGBA,gl.FLOAT,0);this.texture(this.counterTexture(),1);gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,r.counters[r.side]);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,r.tw,r.th,gl.RG_INTEGER,gl.UNSIGNED_INT,0);gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);}
 private reduce(first:Program,next:Program,integer:boolean,setup:(p:Program)=>void,cancel?:()=>boolean){
  const gl=this.gl!,r=this.resources!,textures=integer?r.uintReduce:r.floatReduce;let w=r.tw,h=r.th,level=0,side=0;
  gl.bindVertexArray(null);gl.disable(gl.BLEND);
  do{checkCancelled(cancel);const p=level===0?first:next;gl.useProgram(p.value);this.iv(p,'sourceSize',w,h);if(level===0){this.texture(this.stateTexture(),0);this.texture(this.counterTexture(),1);this.i(p,'states',0);this.i(p,'counters',1);this.i(p,'count',r.count);setup(p);}else{this.texture(textures[1-side],0);this.i(p,'values',0);}w=Math.ceil(w/2);h=Math.ceil(h/2);this.target(textures[side],w,h);gl.drawArrays(gl.TRIANGLES,0,3);side=1-side;level++;}while(w>1||h>1);
  const result=integer?new Uint32Array(4):new Float32Array(4);gl.readPixels(0,0,1,1,integer?gl.RGBA_INTEGER:gl.RGBA,integer?gl.UNSIGNED_INT:gl.FLOAT,result);return result;
 }
 private autoBounds(job:IteratedFrameJob,options:IteratedGpuOptions):DensityBounds {
  const a=this.reduce(this.program('bounds-first',QUAD,BOUNDS_FIRST),this.program('bounds-reduce',QUAD,BOUNDS_REDUCE),false,p=>this.transform(p,job,options.projection),options.isCancelled),aspect=options.width/options.height;
  if(a[0]>a[1])return{minX:-aspect,maxX:aspect,minY:-1,maxY:1};
  const cx=a[0]/2+a[1]/2,cy=a[2]/2+a[3]/2;let span=Math.max(a[3]-a[2],(a[1]-a[0])/aspect);if(span===0)span=Math.max(1,Math.abs(cx)*1e-6/aspect,Math.abs(cy)*1e-6);span*=1+options.padding*2;return{minX:cx-span*aspect/2,maxX:cx+span*aspect/2,minY:cy-span/2,maxY:cy+span/2};
 }
 step(job:IteratedFrameJob,options:IteratedGpuOptions):IteratedGpuFacts {
  if(this.cleanupPending)this.reset();
  try{return this.run(job,options);}catch(e){this.reset();throw e;}
 }
 /** One texture owner switches storage/filtering atomically between native
  * RGB1024 and local extensions. The existing allocation budget covers the
  * larger 4097 RGBA table and CPU upload; native storage is strictly smaller. */
 private prepareDrawPalette(job:IteratedFrameJob){
  const gl=this.gl!,r=this.resources!,native=job.symmetryPalette?.model==='source-rgb1024',format=native?'source-rgb1024':'local-rgba4097';
  const {name:ignoredName,offset,cycles,...base}=job.palette,key=JSON.stringify([format,native?{...base,offset,cycles}:base,job.symmetryPalette?.model==='source-rgb1024'?job.symmetryPalette.frame:undefined]);this.texture(r.palette,2);
  if(r.drawPaletteKey===key)return;
  if(native){
   checked(Boolean(gl.getExtension('OES_texture_float_linear')),'源 Symmetry 色板需要 OES_texture_float_linear');
   const values=sourceSymmetryPaletteLut(job.palette,job.symmetryPalette?.model==='source-rgb1024'?job.symmetryPalette.frame:undefined);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB32F,1024,1,0,gl.RGB,gl.FLOAT,values);
  }else{
   const colors=new Float32Array((PALETTE_INTERVALS+1)*4);for(let i=0;i<=PALETTE_INTERVALS;i++){colors.set(paletteBaseColor(job.palette,i/PALETTE_INTERVALS),i*4);colors[i*4+3]=1;}
   if(r.paletteFormat!==format)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,PALETTE_INTERVALS+1,1,0,gl.RGBA,gl.FLOAT,colors);
   else gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,PALETTE_INTERVALS+1,1,gl.RGBA,gl.FLOAT,colors);
  }
  for(const name of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,name,native?gl.LINEAR:gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,native?gl.REPEAT:gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  checked(gl.getError()===gl.NO_ERROR,'密度色板上传失败');r.paletteFormat=format;r.drawPaletteKey=key;
 }
 private prepareSourceSplat(job:IteratedFrameJob,cancel?:()=>boolean){
  const gl=this.gl!,r=(this.resources??this.direct)!,facts=job.samilaSplat??job.symmetrySplat;if(!facts)return;if(job.samilaSplat)checked(r.bytes+(this.tone?.sourceTargetBytes()??0)+256*256*4*2+1024*3*4*2<=MAX_BYTES,'源 Samila LUT 超过 768 MiB 工作预算');
  if(!r.splatPath){
   // The source resolves primitive support by drawing sixteen points and reading
   // finite positive mass, not by trusting ALIASED_POINT_SIZE_RANGE.
   let drained=false;for(let i=0;i<16;i++){checkCancelled(cancel);checked(!gl.isContextLost(),'源密度点探针上下文已丢失');if(gl.getError()===gl.NO_ERROR){drained=true;break;}}checked(drained,'源密度点探针无法清除 GL 错误');const p=this.program('source-point-probe',POINT_PROBE_VERTEX,POINT_PROBE_FRAGMENT);this.target(r.ink,r.width,r.height);gl.clearBufferfv(gl.COLOR,0,new Float32Array(4));gl.useProgram(p.value);gl.bindVertexArray(r.drawVao);gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.ONE,gl.ONE);gl.drawArrays(gl.POINTS,0,16);gl.disable(gl.BLEND);
   const tw=Math.min(256,r.width),th=Math.min(256,r.height),data=new Float32Array(tw*th*4);let positive=false;for(let y=0;y<r.height;y+=th)for(let x=0;x<r.width;x+=tw){checkCancelled(cancel);const w=Math.min(tw,r.width-x),h=Math.min(th,r.height-y);gl.readPixels(x,y,w,h,gl.RGBA,gl.FLOAT,data);for(let i=0;i<w*h*4;i+=4)if(Number.isFinite(data[i])&&data[i]>0)positive=true;}const ok=gl.getError()===gl.NO_ERROR&&positive;r.splatPath=ok?'points':'quad';gl.clearBufferfv(gl.COLOR,0,new Float32Array(4));gl.bindVertexArray(null);
  }
  facts.path=r.splatPath;
  if(!job.samilaSplat)return;
  checked(Boolean(gl.getExtension('OES_texture_float_linear')),'源 Samila 需要 OES_texture_float_linear');
  if(!r.sourceNoise){const texture=gl.createTexture();checked(Boolean(texture),'源 Samila noise texture 分配失败');r.sourceNoise=texture!;this.texture(texture!,3);gl.texImage2D(gl.TEXTURE_2D,0,gl.R32F,256,256,0,gl.RED,gl.FLOAT,sourceSamilaNoiseLut());for(const name of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,name,gl.LINEAR);for(const name of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,name,gl.CLAMP_TO_EDGE);}
  const key=JSON.stringify(job.palette);if(r.paletteKey!==key){const values=sourceSamilaPaletteLut(job.palette);if(!r.sourcePalette){r.sourcePalette=gl.createTexture()??undefined;checked(Boolean(r.sourcePalette),'源 Samila palette texture 分配失败');}this.texture(r.sourcePalette!,2);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB32F,1024,1,0,gl.RGB,gl.FLOAT,values);for(const name of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,name,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);r.paletteKey=key;}
  checked(gl.getError()===gl.NO_ERROR,'源 Samila LUT 准备失败');
 }
 /** Integer-only reduction shared by per-draw statistics and the final chunk
  * summary. The first level masks unwritten padding, including previous frames. */
 private reduceDirectStatistics(r:SourceSamilaGpuResources,input:WebGLTexture,width:number,height:number,count:number,cancel?:()=>boolean):void {
  const gl=this.gl!,firstSource=HEADER+SUM+`uniform usampler2D values;uniform ivec2 sourceSize;uniform int count;out uvec4 result;void main(){ivec2 at=ivec2(gl_FragCoord.xy)*2;uvec4 total=uvec4(0);for(int y=0;y<2;y++)for(int x=0;x<2;x++){ivec2 p=at+ivec2(x,y);if(any(greaterThanEqual(p,sourceSize))||p.y*sourceSize.x+p.x>=count)continue;total=sum(total,texelFetch(values,p,0));}result=total;}`;
  let w=width,h=height,side=0,level=0;gl.disable(gl.BLEND);gl.bindVertexArray(null);
  do{checkCancelled(cancel);const p=this.program(level===0?'source-direct-stats-first':'source-direct-stats-next',QUAD,level===0?firstSource:STATS_REDUCE);gl.useProgram(p.value);this.texture(level===0?input:r.reductions[1-side],0);this.i(p,'values',0);this.i(p,'count',count);this.iv(p,'sourceSize',w,h);w=Math.ceil(w/2);h=Math.ceil(h/2);this.target(r.reductions[side],w,h);gl.drawArrays(gl.TRIANGLES,0,3);side=1-side;level++;}while(w>1||h>1);
 }
 private directStatistics(r:SourceSamilaGpuResources,count:number,chunkIndex:number,cancel?:()=>boolean):void {
  const gl=this.gl!;this.texture(r.statsTexture,0);gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,r.statsBuffer);try{gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,r.plan.tw,r.plan.th,gl.RGBA_INTEGER,gl.UNSIGNED_INT,0);}finally{gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);}
  this.reduceDirectStatistics(r,r.statsTexture,r.plan.tw,r.plan.th,count,cancel);
  // Preserve the 1×1 integer result on the GPU. Copy source and destination
  // are distinct RGBA32UI textures; no integer blend or read/write feedback.
  checkCancelled(cancel);this.texture(r.summaryTexture,0);gl.copyTexSubImage2D(gl.TEXTURE_2D,0,chunkIndex%r.plan.summaryWidth,Math.floor(chunkIndex/r.plan.summaryWidth),0,0,1,1);
 }
 private finishDirectStatistics(r:SourceSamilaGpuResources,chunks:number,cancel?:()=>boolean):Uint32Array {
  checkCancelled(cancel);const value=new Uint32Array(4);if(chunks===0)return value;
  if(chunks===1)this.target(r.summaryTexture,r.plan.summaryWidth,r.plan.summaryHeight);
  else this.reduceDirectStatistics(r,r.summaryTexture,r.plan.summaryWidth,r.plan.summaryHeight,chunks,cancel);
  checkCancelled(cancel);this.gl!.readPixels(0,0,1,1,this.gl!.RGBA_INTEGER,this.gl!.UNSIGNED_INT,value);checkCancelled(cancel);return value;
 }
 private runDirect(job:IteratedFrameJob,options:IteratedGpuOptions):IteratedGpuFacts {
  const gl=this.context(),cfg=job.config,batch=job.samilaSampling!,history=job.history!,field=job.field;
  checked(field.kind==='samila'&&!!job.samilaProjection,'源 Samila direct 场类型无效');if(field.kind!=='samila')throw Error('源 Samila direct 场类型无效');
  const source=compileSourceSamilaDirect(field);checked(Object.keys(source.uniforms).length+24<=gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),'源 Samila direct uniform 容量不足');
  const mismatch=!this.direct||this.direct.count!==cfg.count||this.direct.width!==options.width||this.direct.height!==options.height;
  checked(!mismatch||options.resetParticles,'源 Samila direct 尺寸变化需要重置');checked(options.resetParticles||this.structuralKey===job.structuralKey,'源 Samila direct 结构变化需要重置');checked(options.resetParticles||job.frame===this.frame+1,'源 Samila direct 仅允许顺序推进');
  if(mismatch){this.releaseResources();this.direct=new SourceSamilaGpuResources(gl,cfg.count,options.width,options.height,Boolean(this.observeSourceDraw));this.direct.initialize();}
  const r=this.direct!;gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.RASTERIZER_DISCARD);gl.pixelStorei(gl.PACK_ALIGNMENT,1);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
  this.prepareSourceSplat(job,options.isCancelled);
  if(options.clearInk||options.resetParticles){this.target(r.ink,r.width,r.height);gl.clearBufferfv(gl.COLOR,0,new Float32Array(4));}
  const copy=this.program('samila-history-copy',QUAD,HISTORY_COPY);gl.useProgram(copy.value);gl.disable(gl.BLEND);this.texture(r.ink,0);this.i(copy,'previousInk',0);this.f(copy,'decay',cfg.decay);this.f(copy,'densityCeiling',history.densityCeiling);this.target(r.inkScratch,r.width,r.height);gl.drawArrays(gl.TRIANGLES,0,3);[r.ink,r.inkScratch]=[r.inkScratch,r.ink];
  const path=job.samilaSplat!.path,vps=path==='quad'?6:1,totalVertices=batch.sampleCount*vps,observe=this.observeSourceDraw;
  const p=this.program('source-direct:'+Boolean(observe)+source.key,source.vertex,source.fragment,observe?['sourceStats','vTexCoord']:['sourceStats']);
  const chunkCount=Math.ceil(totalVertices/r.plan.maxVertices);checked(chunkCount<=r.plan.maxChunks,'源 Samila 统计汇总块数超过预检容量');let chunks=0;
  for(let first=0;first<totalVertices;first+=r.plan.maxVertices){
   checkCancelled(options.isCancelled);const n=Math.min(r.plan.maxVertices,totalVertices-first);gl.useProgram(p.value);for(const [name,value]of Object.entries(source.uniforms))this.f(p,name,value);
   this.i(p,'sourceSamilaMode',source.selection.modeIndex);this.i(p,'sourceSamilaProjection',source.selection.projectionIndex);this.i(p,'u_frameSeed',batch.frameSeed|0);this.i(p,'u_particleCount',batch.sampleCount);this.f(p,'u_rangeStart',field.lo);this.f(p,'u_rangeStop',field.hi);
   gl.uniform2f(this.location(p,'scale'),job.samilaProjection!.scaleX,job.samilaProjection!.scaleY);gl.uniform2f(this.location(p,'offset'),job.samilaProjection!.offsetX,job.samilaProjection!.offsetY);gl.uniform2f(this.location(p,'u_viewportSize'),r.width,r.height);this.f(p,'u_aspectRatio',r.width/r.height);this.f(p,'radius',job.samilaSplat!.radius);this.i(p,'u_quadSplat',vps===6?1:0);this.f(p,'alpha',cfg.alpha);this.f(p,'colorPhase',cfg.colorPhase);this.i(p,'useLUT',cfg.sourcePaletteLut?1:0);this.texture(r.sourceNoise!,3);this.i(p,'noiseLUT',3);this.texture(r.sourcePalette!,2);this.i(p,'paletteLUT',2);
   this.target(r.ink,r.width,r.height);gl.bindVertexArray(r.drawVao);gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.ONE,gl.ONE);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,r.feedback);gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER,0,r.statsBuffer,0,n*16);if(observe)gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER,1,r.observationBuffer!,0,n*8);
   try{gl.beginTransformFeedback(vps===6?gl.TRIANGLES:gl.POINTS);try{gl.drawArrays(vps===6?gl.TRIANGLES:gl.POINTS,first,n);}finally{gl.endTransformFeedback();}}
   finally{gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,1,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.disable(gl.BLEND);gl.bindVertexArray(null);}
   if(observe){const values=r.observationData!.subarray(0,n*2);gl.bindBuffer(gl.COPY_READ_BUFFER,r.observationBuffer!);try{gl.getBufferSubData(gl.COPY_READ_BUFFER,0,values);}finally{gl.bindBuffer(gl.COPY_READ_BUFFER,null);}const result:unknown=observe({firstSampleId:first/vps,sampleCount:n/vps,totalSampleCount:batch.sampleCount,path,verticesPerSample:vps,vertexStride:2,values});if(result&&typeof(result as {then?:unknown}).then==='function'){void Promise.resolve(result).catch(()=>{});throw Error('源 Samila 绘制观察必须同步消费借用数据');}}
   this.directStatistics(r,n,chunks,options.isCancelled);chunks++;
  }
  const stats=this.finishDirectStatistics(r,chunks,options.isCancelled),invalid=stats[0]+stats[1]*4294967296,accepted=stats[2],clipped=stats[3];
  checked(gl.getError()===gl.NO_ERROR&&!gl.isContextLost(),'源 Samila direct 绘制失败');checkCancelled(options.isCancelled);this.bounds={minX:-1,maxX:1,minY:-1,maxY:1};this.structuralKey=job.structuralKey;this.frame=job.frame;
  return{bounds:{...this.bounds},steps:batch.sampleCount,invalid,accepted,clipped,sampleInvalid:invalid};
 }
 private run(job:IteratedFrameJob,options:IteratedGpuOptions):IteratedGpuFacts {
  checkCancelled(options.isCancelled);const source=job.samilaSampling?undefined:iteratedGpuFieldSource(job.field);const cfg=job.config;checked(['map','symmetry','samila'].includes(job.kind),'GPU 持续密度类型无效');const customStorage=job.field.kind==='symmetry-custom',samila=job.kind==='samila',boundedHistory=samila&&cfg.samilaHistoryModel==='bounded-v2',history=job.history;
  checked(!history||boundedHistory,'GPU 历史规则与模型不匹配');
  const symmetryFrame=job.symmetryFrame,warmup=symmetryFrame?.warmupSteps??(options.resetParticles?cfg.burn:0),iterations=symmetryFrame?.iterationSteps??cfg.iterations;
  if(symmetryFrame)checked(job.kind==='symmetry'&&symmetryFrame.model==='symmetry-frame-1.7.8'&&Number.isSafeInteger(warmup)&&warmup>=0&&warmup<=cfg.burn&&(symmetryFrame.phase==='replay'?symmetryFrame.objectUpdates===0&&(iterations===0||iterations===cfg.iterations):symmetryFrame.phase===undefined&&Number.isInteger(symmetryFrame.objectUpdates)&&symmetryFrame.objectUpdates>=0&&symmetryFrame.objectUpdates<=2&&iterations===symmetryFrame.objectUpdates*cfg.iterations&&(!warmup||symmetryFrame.objectUpdates>0)),'GPU Symmetry 更新计划无效');
  const updateFields=job.symmetryUpdates;
  if(updateFields!==undefined)checked(!!symmetryFrame&&symmetryFrame.phase===undefined&&updateFields.length===symmetryFrame.objectUpdates&&updateFields.every(field=>field.kind===job.field.kind),'GPU Symmetry 有序更新字段无效');
  if(symmetryFrame?.objectUpdates===2)checked(updateFields?.length===2,'GPU Symmetry 两次更新需要各自字段');
  if(job.samilaSampling){checked(samila&&!!job.samilaSplat&&job.field.kind==='samila'&&job.field.mathModel==='mathart-1.7.8'&&!!job.samilaProjection&&!!history,'源 Samila PCG 缺少已解析场/历史事实');validateSourceSamilaSamplingBatch(job.samilaSampling,cfg.count,history!.passes,job.frame);}
  if(boundedHistory)checked(!!history&&history.densityCeiling===SAMILA_HISTORY_CEILING&&[0,1,6].includes(history.passes)&&history.samples===cfg.count*history.passes&&(job.samilaSampling!==undefined||history.randomFrames.length===history.passes&&history.randomFrames.every(f=>Number.isSafeInteger(f)&&f>=0)&&new Set(history.randomFrames).size===history.passes)&&(history.passes>0)===cfg.record,'GPU Samila 缺少有效历史帧事实');
  checked(Number.isSafeInteger(job.frame)&&job.frame>=0&&(samila||cfg.burn+1+job.frame*(symmetryFrame?32:16)+Math.max(iterations,cfg.iterations)<=0xffffffff),'GPU 随机序号超出 32 位');
  checked(cfg.bounds.flat().every(finite32)&&[cfg.decay,cfg.alpha,cfg.escape,cfg.pointSize,cfg.metricMin,cfg.metricMax,cfg.colorSpeed,cfg.colorPhase].every(finite32),'GPU 帧参数超出 float32');
  if(job.symmetrySplat){checked(job.kind==='symmetry','源 Symmetry 散点与场景不匹配');if(cfg.record)sourceSymmetrySplatPixelTests(job.symmetrySplat,cfg.count);}
  if(job.sourceCamera){checked(job.kind!=='samila'&&job.sourceCamera.anchor.family===job.kind,'源密度相机与模型不匹配');for(const matrix of [job.sourceCamera.anchor.projection,job.sourceCamera.anchor.modelView])checked(matrix.columnMajor.length===16&&Array.from(matrix.columnMajor).every(finite32),'源密度投影矩阵无效');}
  if(options.bounds)checkBounds(options.bounds);const t=job.transform;checked([t.sx,t.sy,t.sz,t.ox,t.oy,t.oz,t.co,t.si].every(finite32),'粒子变换超出 GPU float32');checked(['xy','xz','yz'].includes(options.projection)&&Number.isFinite(options.padding)&&options.padding>=0&&options.padding<=1,'GPU 投影或留白无效');
  if(job.samilaSampling)return this.runDirect(job,options);
  if(!source)throw Error('GPU 场未准备');
  if(this.direct)this.releaseResources();
  const gl=this.context();checked(Object.keys(source.uniforms).length+16<=gl.getParameter(source.stage==='fragment'?gl.MAX_FRAGMENT_UNIFORM_VECTORS:gl.MAX_VERTEX_UNIFORM_VECTORS),'GPU 公式 uniform 容量不足');gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.SCISSOR_TEST);gl.pixelStorei(gl.PACK_ALIGNMENT,1);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
  let r=this.resources;const mismatch=!r||r.count!==cfg.count||r.width!==options.width||r.height!==options.height||Boolean(r.inkScratch)!==boundedHistory||(r.storage==='texture')!==customStorage;
  checked(!mismatch||options.resetParticles,'GPU 状态尺寸变化需要 resetParticles');checked(options.resetParticles||this.structuralKey===job.structuralKey,'GPU 状态结构变化需要重置');checked(options.resetParticles||job.frame===this.frame+1,'GPU 状态仅允许顺序推进；seek 必须由会话重放');
  if(mismatch)this.allocate(cfg.count,options.width,options.height,boundedHistory,customStorage);r=this.resources!;
  this.prepareSourceSplat(job,options.isCancelled);
  if(options.clearInk||options.resetParticles){this.target(r.ink,r.width,r.height);gl.clearBufferfv(gl.COLOR,0,new Float32Array(4));}
  if(options.resetParticles&&!samila){
   for(let offset=0;offset<cfg.count;offset+=CHUNK){checkCancelled(options.isCancelled);const initial=iteratedInitialChunk(cfg,offset,Math.min(CHUNK,cfg.count-offset));this.uploadInitial(initial,offset);}

  }
  const updateSources=updateFields?.map(field=>iteratedGpuFieldSource(field));
  if(updateSources)for(const updateSource of updateSources)checked(Object.keys(updateSource.uniforms).length+16<=gl.getParameter(updateSource.stage==='fragment'?gl.MAX_FRAGMENT_UNIFORM_VECTORS:gl.MAX_VERTEX_UNIFORM_VECTORS),'源 Symmetry 更新 uniform 容量不足');
  if(!samila)for(let offset=0;offset<warmup;offset+=256)this.iterate(updateFields?.[0]?{...job,field:updateFields[0]}:job,updateSources?.[0]??source,Math.min(256,warmup-offset),offset+1,offset===0,options.isCancelled);
  if(updateFields)for(let i=0;i<updateFields.length;i++)this.iterate({...job,field:updateFields[i]},updateSources![i],cfg.iterations,cfg.burn+1+job.frame*32+i*cfg.iterations,i===0&&!options.resetParticles&&warmup===0,options.isCancelled);
  // One history copy per fixed frame, before all compensation batches.
  if(boundedHistory){
   checkCancelled(options.isCancelled);const p=this.program('samila-history-copy',QUAD,HISTORY_COPY);gl.useProgram(p.value);gl.disable(gl.BLEND);this.texture(r.ink,0);this.i(p,'previousInk',0);this.f(p,'decay',cfg.decay);this.f(p,'densityCeiling',history!.densityCeiling);this.target(r.inkScratch!,r.width,r.height);gl.drawArrays(gl.TRIANGLES,0,3);[r.ink,r.inkScratch]=[r.inkScratch!,r.ink];
  }else{
  // Decay the destination directly with a constant blend factor; no feedback
  // sampling and no second image texture are needed.
  if(cfg.decay!==1){this.target(r.ink,r.width,r.height);const p=this.program('decay',QUAD,EMPTY);gl.useProgram(p.value);gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendColor(0,0,0,Math.fround(cfg.decay));gl.blendFunc(gl.ZERO,gl.CONSTANT_ALPHA);gl.drawArrays(gl.TRIANGLES,0,3);gl.disable(gl.BLEND);}
  }
  // Reuse the base-batch buffers for distinct random addresses. Never allocate
  // six times the particle state or decay the ink between compensation batches.
  const randomFrames=history?.randomFrames.length?history.randomFrames:[job.frame];
  let invalid=0,accepted=0,clipped=0,sampleInvalid=0;
  for(let pass=0;pass<randomFrames.length;pass++){
   checkCancelled(options.isCancelled);const randomFrame=randomFrames[pass];
  if(samila&&cfg.record){const field=job.field;if(field.kind!=='samila')throw new Error('Samila 帧标签不一致');for(let offset=0;offset<cfg.count;offset+=CHUNK){checkCancelled(options.isCancelled);const seeds=iteratedSamilaSeedChunk({...cfg,seed:cfg.sampleSeed??cfg.seed},randomFrame,field.lo,field.hi,offset,Math.min(CHUNK,cfg.count-offset),field.mathModel!==undefined);gl.bindBuffer(gl.ARRAY_BUFFER,r.positions[r.side]);gl.bufferSubData(gl.ARRAY_BUFFER,offset*16,seeds);}}
  if(updateFields===undefined&&(!samila||cfg.record)&&iterations>0)this.iterate(job,source,iterations,samila?0:cfg.burn+1+job.frame*16,samila||!options.resetParticles&&warmup===0,options.isCancelled);
  if(options.resetParticles||warmup>0||iterations>0&&(!samila||cfg.record))this.uploadState();
  if(customStorage){const errors=this.reduce(this.program('custom-errors-first',QUAD,CUSTOM_ERRORS_FIRST),this.program('custom-errors-reduce',QUAD,CUSTOM_ERRORS_REDUCE),true,()=>{},options.isCancelled);checked(errors[0]===0,'自定义对称公式超过单次调用的循环工作预算');}
  if(job.sourceCamera||job.samilaProjection)this.bounds={minX:-1,maxX:1,minY:-1,maxY:1};else if(options.bounds)this.bounds={...options.bounds};else if(!this.bounds||job.frame===0&&pass===0)this.bounds=samila&&!cfg.record?{minX:-options.width/options.height,maxX:options.width/options.height,minY:-1,maxY:1}:this.autoBounds(job,options);const bounds=this.bounds!;
  const stat=samila&&!cfg.record?new Uint32Array(4):this.reduce(this.program('stats-first',QUAD,STATS_FIRST),this.program('stats-reduce',QUAD,STATS_REDUCE),true,p=>{this.transform(p,job,options.projection);this.setBounds(p,bounds);this.iv(p,'size',r!.width,r!.height);this.f(p,'radius',job.symmetrySplat?sourceSymmetryPointDiameter(job.symmetrySplat)/2-.5:job.samilaSplat?sourceSamilaPointDiameter(job.samilaSplat)/2-.5:cfg.pointSize/2);this.i(p,'recording',cfg.record?1:0);this.i(p,'sourcePointClip',(job.samilaSplat??job.symmetrySplat)?.path==='points'?1:0);},options.isCancelled);

  if(cfg.record){
   const sourceSplat=job.samilaSplat,pointSplat=sourceSplat??job.symmetrySplat,p=sourceSplat?this.program('source-samila-draw',SOURCE_DRAW_VERTEX,SOURCE_DRAW_FRAGMENT):this.program('draw',DRAW_VERTEX,DRAW_FRAGMENT);gl.useProgram(p.value);this.target(r.ink,r.width,r.height);this.transform(p,job,options.projection);this.setBounds(p,bounds);this.iv(p,'size',r.width,r.height);this.i(p,'count',cfg.count);this.f(p,'radius',pointSplat?.radius??cfg.pointSize/2);this.i(p,'symmetrySplat',job.symmetrySplat?1:0);this.i(p,'quadSplat',pointSplat?.path==='quad'?1:0);this.i(p,'usePaletteLut',cfg.sourcePaletteLut?1:0);this.f(p,'alpha',cfg.alpha);this.f(p,'metricMin',cfg.metricMin);this.f(p,'metricRange',cfg.metricMax-cfg.metricMin);this.i(p,'metricMode',cfg.metricMode==='robust'?1:0);this.i(p,'colorMode',['step','index','radius','angle','height','noise'].indexOf(cfg.color));this.f(p,'colorSpeed',cfg.colorSpeed);this.f(p,'colorPhase',cfg.colorPhase);this.f(p,'paletteCycles',job.palette.cycles);this.f(p,'paletteOffset',job.palette.offset);
   if(sourceSplat){this.texture(r.sourcePalette!,2);this.i(p,'palette',2);this.texture(r.sourceNoise!,3);this.i(p,'noiseLUT',3);}else{this.prepareDrawPalette(job);this.i(p,'palette',2);this.i(p,'symmetryLut',job.symmetryPalette?.model==='source-rgb1024'?1:0);this.texture(r.noise,3);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,256,1,gl.RED_INTEGER,gl.UNSIGNED_BYTE,createNoisePermutation(cfg.seed));this.i(p,'noisePermutation',3);}
   gl.bindVertexArray(r.drawVao);this.texture(this.stateTexture(),0);this.i(p,'states',0);this.texture(this.counterTexture(),1);this.i(p,'counters',1);this.i(p,'stateWidth',r.tw);gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.ONE,gl.ONE);
   try{for(let offset=0;offset<cfg.count;offset+=CHUNK){checkCancelled(options.isCancelled);this.i(p,'particleOffset',offset);gl.drawArraysInstanced(pointSplat?.path==='points'?gl.POINTS:gl.TRIANGLES,0,pointSplat?.path==='points'?1:6,Math.min(CHUNK,cfg.count-offset));}}finally{gl.disable(gl.BLEND);gl.bindVertexArray(null);}
  }
   if(!symmetryFrame||symmetryFrame.objectUpdates>0||symmetryFrame.phase==='replay'&&(warmup>0||iterations>0))invalid+=stat[0]+stat[1]*4294967296;accepted+=stat[2];clipped+=stat[3];sampleInvalid+=cfg.record?cfg.count-stat[2]-stat[3]:0;
  }

  checked(gl.getError()===gl.NO_ERROR&&!gl.isContextLost(),'GPU 持续密度执行失败');checkCancelled(options.isCancelled);this.structuralKey=job.structuralKey;this.frame=job.frame;
  return{bounds:{...this.bounds!},steps:history?history.samples:samila&&!cfg.record?0:cfg.count*(iterations+warmup),invalid,accepted,clipped,sampleInvalid};
 }
 /** Tone borrows immutable ink. Unsupported/sensitive presentation uses the same
  * shared CPU tone on float ink; it never restarts or mixes mathematical states. */
 present(job:DensityToneJob,isCancelled?:()=>boolean,view?:PreparedDensityView):{pixels:Uint8ClampedArray;occupiedPixels:number;maxCount:number;toneBackend:'cpu'|'webgl2';warnings:string[]} {
  if(this.cleanupPending)this.reset();
  try{
   checkCancelled(isCancelled);const r=this.resources??this.direct;checked(Boolean(r),'GPU 密度状态为空');const captured=view&&isCapturedDensityView(view)?view:undefined,admission=captured&&!job.sourceSymmetryPresentation?{reason:'源 Map/Sym 相机视图在浮点墨迹上执行共享 CPU 采样与调色'}:prepareDensityGpuTone(job);let reason=admission.reason,destination:Uint8ClampedArray|undefined;
   if(!job.sourcePresentation&&!job.sourceSymmetryPresentation)this.tone?.releaseSourcePresentation();
   const sourceTarget=job.sourcePresentation||job.sourceSymmetryPresentation?sourceDensityPresentationBytes(r!.width,r!.height):0;
   checked(r!.bytes+sourceTarget+r!.width*r!.height*4+(r!.sourceNoise?256*256*4*2+1024*3*4*2:0)<=MAX_BYTES,'GPU 完整呈现目标及输出超过 768 MiB 工作预算');
   if(admission.plan){this.tone??=new DensityGpuTone(this.context());const result=this.tone.render(r!.ink,r!.width,r!.height,admission.plan,isCancelled,view);if(!result.needsCpu)return{...result,toneBackend:'webgl2',warnings:[]};destination=result.pixels;reason='当前像素位于密度取样、色板相位或调色边界的 float32 敏感区';}
   if(job.sourceSymmetryPresentation)throw Error('源 Symmetry GPU 呈现失败：'+reason);
   const rgba=this.readback(),pixels=toneDensityRgbaPrepared(r!.width,r!.height,rgba,job,isCancelled,destination,view);let occupiedPixels=0,maxCount=0;
   for(let i=3;i<rgba.length;i+=4){if((i&65535)===3)checkCancelled(isCancelled);if(rgba[i]>0)occupiedPixels++;maxCount=Math.max(maxCount,rgba[i]);}
   return{pixels,occupiedPixels,maxCount,toneBackend:'cpu',warnings:[`GPU 粒子与累积保留，最终调色回退 CPU：${reason}`]};
  }catch(error){this.reset();throw error;}
 }
 readback():Float32Array {
  if(this.cleanupPending)this.reset();
  try{const gl=this.context(),r=this.resources??this.direct;checked(Boolean(r),'GPU 密度状态为空');this.target(r!.ink,r!.width,r!.height);const raw=new Float32Array(r!.width*r!.height*4);gl.readPixels(0,0,r!.width,r!.height,gl.RGBA,gl.FLOAT,raw);checked(gl.getError()===gl.NO_ERROR&&!gl.isContextLost(),'GPU 密度回读失败');checked(raw.every(Number.isFinite),'GPU 密度累积溢出或包含非有限值');const row=r!.width*4,temporary=new Float32Array(row);for(let y=0;y<Math.floor(r!.height/2);y++){const a=y*row,b=(r!.height-y-1)*row;temporary.set(raw.subarray(a,a+row));raw.copyWithin(a,b,b+row);raw.set(temporary,b);}return raw;}catch(e){this.reset();throw e;}
 }
 /** Explicit diagnostic snapshot, bounded by particle count, never used per frame. */
 readParticles():{positionsAndMetric:Float32Array;invalidCounts:Uint32Array;validity:Uint8Array}{
  if(this.cleanupPending)this.reset();
  if(this.direct)throw Error('源 Samila direct 不保留粒子快照；请使用同次绘制的 observeSourceDraw 有界观察接口');
  try{const gl=this.context(),r=this.resources;checked(Boolean(r),'GPU 粒子状态为空');const state=r!;checked(state.bytes+(this.tone?.sourceTargetBytes()??0)+state.count*21+state.tw*16<=MAX_BYTES,'GPU 粒子诊断回读超过 768 MiB');
   const positionsAndMetric=new Float32Array(state.count*4),invalidCounts=new Uint32Array(state.count),validity=new Uint8Array(state.count),metadata=new Uint32Array(state.tw*4);
   if(state.storage==='buffer'){gl.bindBuffer(gl.COPY_READ_BUFFER,state.positions[state.side]);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,positionsAndMetric);gl.bindBuffer(gl.COPY_READ_BUFFER,null);}else{this.target(this.stateTexture(),state.tw,state.th);for(let y=0;y<state.th;y++){const n=Math.min(state.tw,state.count-y*state.tw);gl.readPixels(0,y,n,1,gl.RGBA,gl.FLOAT,positionsAndMetric.subarray(y*state.tw*4,(y*state.tw+n)*4));}}
   this.target(this.counterTexture(),state.tw,state.th);for(let y=0;y<state.th;y++){const n=Math.min(state.tw,state.count-y*state.tw);gl.readPixels(0,y,n,1,gl.RGBA_INTEGER,gl.UNSIGNED_INT,metadata);for(let x=0;x<n;x++){invalidCounts[y*state.tw+x]=metadata[x*4];validity[y*state.tw+x]=metadata[x*4+1]&1;}}
   checked(gl.getError()===gl.NO_ERROR&&!gl.isContextLost(),'GPU 粒子回读失败');return{positionsAndMetric,invalidCounts,validity};
  }catch(e){this.reset();throw e;}
 }
 private releaseResources(){if(this.pendingAllocation){this.pendingAllocation();this.pendingAllocation=undefined;this.pendingAllocationBytes=0;}this.direct?.dispose();this.direct=undefined;this.tone?.dispose();this.tone=undefined;const gl=this.gl,r=this.resources;if(gl&&r){r.positions.forEach(b=>gl.deleteBuffer(b));r.counters.forEach(b=>gl.deleteBuffer(b));[...r.stateTextures,...r.counterTextures,r.ink,...(r.inkScratch?[r.inkScratch]:[]),r.palette,r.noise,...(r.sourceNoise?[r.sourceNoise]:[]),...(r.sourcePalette?[r.sourcePalette]:[]),...r.floatReduce,...r.uintReduce].forEach(t=>gl.deleteTexture(t));gl.deleteFramebuffer(r.framebuffer);gl.deleteTransformFeedback(r.feedback);gl.deleteVertexArray(r.vao);gl.deleteVertexArray(r.drawVao);}this.resources=undefined;this.bounds=undefined;this.structuralKey='';this.frame=-1;}
 reset(){this.cleanupPending=true;this.releaseResources();const gl=this.gl;if(gl){gl.useProgram(null);for(const p of this.programs.values())gl.deleteProgram(p.value);this.programs.clear();gl.getExtension('WEBGL_lose_context')?.loseContext();}this.gl=undefined;this.cleanupPending=false;}
 dispose(){this.reset();}
}
