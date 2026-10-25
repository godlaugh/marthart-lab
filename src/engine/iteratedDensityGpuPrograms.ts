import {DENSITY_FULLSCREEN_VERTEX_GLSL,SAMILA_HISTORY_COPY_GLSL} from './densityGpuShaders';
import {SOURCE_SAMILA_NOISE_GLSL} from './sourceSamilaSplat';
import {SAMILA_NDC_POSITION_GLSL} from './samilaProjection';
import {compileGlslExpression,glslRealPrelude} from './gpuSampler';
import {iteratedNoiseGlsl} from './iteratedGpuNoise';
import {compileSamilaGpuField} from './iteratedGpuSamila';
import {symmetryCustomFragmentSource} from './symmetryCustomShader';
import {sourceMapGpuField} from './sourceMapMath';
import {sourceSymmetryGpuField} from './sourceSymmetryMath';
import {gpuShaderHeader,type GpuShaderProfile} from './gpuShaderProfile';
import type {IteratedField} from '../scenes/iteratedDensity';

const finite32=(v:number)=>Number.isFinite(v)&&Number.isFinite(Math.fround(v));
const checked=(v:boolean,message:string)=>{if(!v)throw new Error(message);};
/** Built-in fields are header-free. Authored custom fragments carry the profile
 * that assembled their header, so cross-profile assembly fails explicitly. */
export type IteratedGpuFieldSource={source:string;uniforms:Readonly<Record<string,number>>;key:string}&(
 | {stage?:undefined;sourceCalculateNext?:true}
 | {stage:'fragment';profile:GpuShaderProfile;sourceCalculateNext?:never}
);
export interface IteratedGpuProgramSource {vertex:string;fragment:string;varyings?:string[];}
export interface SourceIteratedGpuProgramSource {vertex:string;fragment:string;diagnosticVertex:string;diagnosticFragment:string;}
/** Coordinates and explicit sequential aliases use the existing safe AST emitter.
 * Parameter values remain uniforms and never enter a shader-cache key. */
export function iteratedGpuFieldSource(field:IteratedField,profile:GpuShaderProfile='webgl2'):IteratedGpuFieldSource {
 if(field.kind==='symmetry-custom'){if(field.plan.dialect!=='webgl2-glsl-es-300-budgeted-v1')throw Error('原生自定义 Symmetry 程序不能交给 WebGL 计算路径');return{source:symmetryCustomFragmentSource(field.plan,profile),uniforms:field.uniforms,key:field.plan.programKey,stage:'fragment',profile};}
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
 if(field.mathModel)return sourceMapGpuField(field);
 const names=Object.keys(field.parameters).sort(),reserved=new Set(['x','y','z','t','time','nx','ny','nz','x_next','y_next','z_next','constructor','prototype','__proto__']);
 checked(!names.some(n=>reserved.has(n)),'GPU 映射参数覆盖保留变量');
 const base=[...names,'t','time'],values=[...names.map(n=>field.parameters[n]),field.time,field.time];checked(values.every(finite32),'映射参数超出 GPU float32');
 const nx=compileGlslExpression(field.equations.x,['x','y','z'],base),ny=compileGlslExpression(field.equations.y,['x','y','z'],[...base,'nx','x_next']),nz=field.dimension===3?compileGlslExpression(field.equations.z?.trim()||'z',['x','y','z'],[...base,'nx','x_next','ny','y_next']):'0.0';
 const source=`${values.map((_,i)=>`uniform float parameter${i};`).join('\n')}
vec3 nextPoint(vec3 samplePosition){float nextX=${nx};float parameter${base.length}=nextX,parameter${base.length+1}=nextX;float nextY=${ny};float parameter${base.length+2}=nextY,parameter${base.length+3}=nextY;return vec3(nextX,nextY,${nz});}`;
 return{source,uniforms:Object.fromEntries(values.map((v,i)=>['parameter'+i,v])),key:source};
}

/** The source owner runs each positive prefix from a frozen input. Keep this
 * mathematical program independent from classification: observing finiteness
 * inside its loop changes native compiler lowering and the source trajectory.
 * Zero-step behavior belongs to the retained owner, never this clamped loop. */
export function sourceIteratedGpuPrograms(source:IteratedGpuFieldSource,profile:GpuShaderProfile='native-gl41'):Readonly<SourceIteratedGpuProgramSource> {
 checked(source.sourceCalculateNext===true&&source.stage===undefined,'源迭代程序需要显式 calculate_next 数学模型');
 const header=gpuShaderHeader(profile,'precision highp float;precision highp int;\n');
 const fragment=header+'out vec4 color;void main(){color=vec4(0.);}\n';
 const vertex=header+'layout(location=0)in vec4 oldState;out vec4 newState;uniform int steps,dimension;\n'+source.source+`
void main() {
  vec4 current = oldState;
  vec3 pos = current.xyz;
  float stepMetric = current.w;

  int stepCount = clamp(steps, 1, 16);
  for (int i = 0; i < 16; i++) {
    if (i >= stepCount) break;
    vec3 nextPos = pos;
    float metric = stepMetric;
    calculate_next(pos, nextPos, metric);
    if (dimension == 2) {
      nextPos.z = 0.0;
    }
    pos = nextPos;
    stepMetric = metric;
  }

  newState = vec4(pos, stepMetric);
  gl_Position=vec4(0.);
}
`;
 const diagnosticVertex=header+`layout(location=0)in vec4 oldState;layout(location=1)in uvec2 oldMetadata;
flat out uvec2 newMetadata;uniform int resetCounter,observe;
bool finiteFloat(float v){return (floatBitsToUint(v)&0x7f800000u)!=0x7f800000u;}
void main(){uint count=resetCounter==1?0u:oldMetadata.r;
if(observe==0){newMetadata=uvec2(count,oldMetadata.g);}
else{bool valid=finiteFloat(oldState.x)&&finiteFloat(oldState.y)&&finiteFloat(oldState.z)&&finiteFloat(oldState.w);newMetadata=uvec2(count+uint(!valid),valid?1u:0u);}
gl_Position=vec4(0.);}
`;
 return Object.freeze({vertex,fragment,diagnosticVertex,diagnosticFragment:fragment});
}

function createPrograms(profile:GpuShaderProfile){
const HEADER=gpuShaderHeader(profile,'precision highp float;precision highp int;precision highp sampler2D;precision highp usampler2D;\n');
// Bit classification also survives fast-math shader compilation. ANGLE Metal's
// program-cache path can lose its isnan/isinf compile flag; use one explicit
// representation for all contexts instead of relying on that hidden flag.
const FLOAT_CLASSIFY=`bool finiteFloat(float v){return (floatBitsToUint(v)&0x7f800000u)!=0x7f800000u;}
bool finiteVector(vec3 v){return finiteFloat(v.x)&&finiteFloat(v.y)&&finiteFloat(v.z);}`;
const QUAD=HEADER+DENSITY_FULLSCREEN_VERTEX_GLSL;
const EMPTY=HEADER+'out vec4 color;void main(){color=vec4(0.);}';
const HISTORY_COPY=HEADER+SAMILA_HISTORY_COPY_GLSL;
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
const SOURCE_CALCULATE_NEXT_STEP_MAIN=`void main(){vec3 p=oldState.xyz;float metric=oldState.w;uint invalid=resetCounter==1?0u:oldMetadata.r;bool valid=(oldMetadata.g&1u)!=0u;
for(int j=0;j<256;j++){if(j>=steps)break;vec3 next=p;float nextMetric=metric;calculate_next(p,next,nextMetric);if(dimension==2)next.z=0.;p=next;metric=nextMetric;valid=finiteVector(p)&&finiteFloat(metric);if(!valid)invalid++;}
newState=vec4(p,metric);newMetadata=uvec2(invalid,valid?1u:0u);gl_Position=vec4(0.);}`;
const TRANSFORM=`${FLOAT_CLASSIFY}
uniform vec3 scale,offset;uniform vec2 turn;uniform ivec2 axes;uniform bool densitySplat;
uniform int samilaNdc;uniform float samilaAspect;uniform vec2 samilaOffset;
${SAMILA_NDC_POSITION_GLSL}
uniform int capturedCamera;uniform mat4 capturedProjection,capturedModelView;
float norm3(vec3 p){float m=max(max(abs(p.x),abs(p.y)),abs(p.z));return m==0.?0.:m*sqrt(dot(p/m,p/m));}
vec3 transformed(vec3 p){return vec3(p.x*scale.x*turn.x-p.y*scale.y*turn.y+offset.x,p.x*scale.x*turn.y+p.y*scale.y*turn.x+offset.y,p.z*scale.z+offset.z);}
// Both statistics and draw use this exact staged projection. Color remains
// a function of the mathematical point, not screen-space coordinates. Retain
// homogeneous clip coordinates for source points: dividing and reconstructing
// them through pixel coordinates changes subpixel raster coverage.
bool densityPosition(vec3 point,out vec2 projected,out vec4 clip){
 if(samilaNdc==1){projected=samilaNdcPosition(point);clip=vec4(projected,0.,1.);return finiteFloat(projected.x)&&finiteFloat(projected.y);}
 if(capturedCamera==0){projected=vec2(point[axes.x],point[axes.y]);clip=vec4(projected,0.,1.);return true;}
 vec4 eye=capturedModelView*vec4(point,1.);clip=capturedProjection*eye;
 if(!finiteVector(clip.xyz)||!finiteFloat(clip.w)||clip.w<=0.||clip.z< -clip.w||clip.z>clip.w){projected=vec2(0.);return false;}
 projected=clip.xy/clip.w;return finiteFloat(projected.x)&&finiteFloat(projected.y);
}
// Source Map/Symmetry geometry does not consume the local math-validity bit
// or legacy raw-coordinate sentinel. In particular, an infinite metric can
// still produce a finite CLAMP color. Keep diagnostic counts independent.
bool invalidPosition(vec4 p,vec3 t,uint valid){return (!densitySplat&&((valid&1u)==0u||(samilaNdc==0&&(abs(p.x)>=1e12||abs(p.y)>=1e12))))||!finiteVector(t)||(samilaNdc==1&&!finiteVector(vec3(samilaNdcPosition(t),0.)));}
`;
const BOUNDS_FIRST=HEADER+TRANSFORM+`uniform sampler2D states;uniform usampler2D counters;uniform ivec2 sourceSize;uniform int count;out vec4 result;
void main(){ivec2 at=ivec2(gl_FragCoord.xy)*2;vec4 bounds=vec4(3.402823466e38,-3.402823466e38,3.402823466e38,-3.402823466e38);for(int y=0;y<2;y++)for(int x=0;x<2;x++){ivec2 p=at+ivec2(x,y);if(any(greaterThanEqual(p,sourceSize))||p.y*sourceSize.x+p.x>=count)continue;vec4 state=texelFetch(states,p,0);vec3 t=transformed(state.xyz);if(invalidPosition(state,t,texelFetch(counters,p,0).g))continue;bounds.x=min(bounds.x,t[axes.x]);bounds.y=max(bounds.y,t[axes.x]);bounds.z=min(bounds.z,t[axes.y]);bounds.w=max(bounds.w,t[axes.y]);}result=bounds;}`;
const BOUNDS_REDUCE=HEADER+`uniform sampler2D values;uniform ivec2 sourceSize;out vec4 result;void main(){ivec2 at=ivec2(gl_FragCoord.xy)*2;vec4 b=vec4(3.402823466e38,-3.402823466e38,3.402823466e38,-3.402823466e38);for(int y=0;y<2;y++)for(int x=0;x<2;x++){ivec2 p=at+ivec2(x,y);if(any(greaterThanEqual(p,sourceSize)))continue;vec4 v=texelFetch(values,p,0);b=vec4(min(b.x,v.x),max(b.y,v.y),min(b.z,v.z),max(b.w,v.w));}result=b;}`;
const SUM=`uvec4 sum(uvec4 a,uvec4 b){uint lo=a.x+b.x;return uvec4(lo,a.y+b.y+uint(lo<a.x),a.z+b.z,a.w+b.w);}`;
const STATS_FIRST=HEADER+TRANSFORM+SUM+`uniform sampler2D states;uniform usampler2D counters;uniform ivec2 sourceSize,size;uniform int count,recording,sourcePointClip;uniform vec4 bounds;uniform float radius;out uvec4 result;
void main(){ivec2 at=ivec2(gl_FragCoord.xy)*2;uvec4 total=uvec4(0);for(int y=0;y<2;y++)for(int x=0;x<2;x++){ivec2 p=at+ivec2(x,y);if(any(greaterThanEqual(p,sourceSize))||p.y*sourceSize.x+p.x>=count)continue;vec4 state=texelFetch(states,p,0);vec3 t=transformed(state.xyz);uvec2 metadata=texelFetch(counters,p,0).rg;uint invalid=metadata.r,accepted=0u,clipped=0u;if(recording==1&&(densitySplat||(metadata.g&1u)!=0u)){vec2 projected;vec4 clip;if(invalidPosition(state,t,metadata.g)){if((metadata.g&1u)!=0u)invalid++;}else if(!densityPosition(t,projected,clip))clipped++;else if(sourcePointClip!=0&&(any(lessThan(projected,bounds.xz))||any(greaterThan(projected,bounds.yw))))clipped++;else{vec2 pixel=vec2((projected.x-bounds.x)/(bounds.y-bounds.x),(bounds.w-projected.y)/(bounds.w-bounds.z))*vec2(size)-.5;vec2 lo=max(vec2(0),ceil(pixel-radius-.5)),hi=min(vec2(size)-1.,floor(pixel+radius+.5));if(any(greaterThan(lo,hi)))clipped=1u;else accepted=1u;}}total=sum(total,uvec4(invalid,0u,accepted,clipped));}result=total;}`;
const STATS_REDUCE=HEADER+SUM+`uniform usampler2D values;uniform ivec2 sourceSize;out uvec4 result;void main(){ivec2 at=ivec2(gl_FragCoord.xy)*2;uvec4 total=uvec4(0);for(int y=0;y<2;y++)for(int x=0;x<2;x++){ivec2 p=at+ivec2(x,y);if(any(greaterThanEqual(p,sourceSize)))continue;total=sum(total,texelFetch(values,p,0));}result=total;}`;
const CUSTOM_ERRORS_FIRST=HEADER+`uniform usampler2D counters;uniform ivec2 sourceSize;uniform int count;out uvec4 result;void main(){ivec2 at=ivec2(gl_FragCoord.xy)*2;uint flags=0u;for(int y=0;y<2;y++)for(int x=0;x<2;x++){ivec2 p=at+ivec2(x,y);if(any(greaterThanEqual(p,sourceSize))||p.y*sourceSize.x+p.x>=count)continue;flags|=texelFetch(counters,p,0).g&2u;}result=uvec4(flags,0u,0u,0u);}`;
const CUSTOM_ERRORS_REDUCE=HEADER+`uniform usampler2D values;uniform ivec2 sourceSize;out uvec4 result;void main(){ivec2 at=ivec2(gl_FragCoord.xy)*2;uint flags=0u;for(int y=0;y<2;y++)for(int x=0;x<2;x++){ivec2 p=at+ivec2(x,y);if(any(greaterThanEqual(p,sourceSize)))continue;flags|=texelFetch(values,p,0).r;}result=uvec4(flags,0u,0u,0u);}`;
const DRAW_VERTEX=HEADER+TRANSFORM+iteratedNoiseGlsl+`
uniform sampler2D states;uniform usampler2D counters;uniform int stateWidth;uniform ivec2 size;uniform vec4 bounds;uniform float radius,metricMin,metricRange,colorSpeed,colorPhase,paletteCycles,paletteOffset;uniform int metricMode,colorMode,count,particleOffset;
uniform sampler2D palette;uniform bool mapCosine,quadSplat,symmetryLut;out vec2 localPoint;flat out float diameter;flat out vec2 center;flat out vec3 tint;out float sourceStepMetric;
void main(){int id=particleOffset+gl_InstanceID;ivec2 at=ivec2(id%stateWidth,id/stateWidth);vec4 particle=texelFetch(states,at,0);sourceStepMetric=particle.w;vec3 p=transformed(particle.xyz);vec2 projected;vec4 clip;if(invalidPosition(particle,p,texelFetch(counters,at,0).g)||!densityPosition(p,projected,clip)){gl_Position=vec4(2.,2.,0.,1.);center=vec2(-1e30);tint=vec3(0.);return;}
float u=0.;if(colorMode==0){float d=max(0.,particle.w-metricMin);if(densitySplat){float normalized=(particle.w-metricMin)/max(metricRange,1.e-6);float positive=max(normalized,0.);u=clamp(metricMode==1?positive/(1.+positive):normalized,0.,1.);}else u=metricMode==1?(d==0.?0.:1./(1.+metricRange/d)):min(1.,d/metricRange);}else if(colorMode==1)u=float(particleOffset+gl_InstanceID)/float(max(1,count-1));else if(colorMode==2)u=norm3(p);else if(colorMode==3)u=(atan(p.y,p.x)+3.141592653589793)/6.283185307179586;else if(colorMode==4)u=p.y;else u=clamp((spatialNoise(p*.1)+1.)/2.,0.,1.);
float coordinate=(u*colorSpeed+colorPhase/360.)*paletteCycles+paletteOffset;float q=fract(coordinate)*4096.;int i=min(4095,int(floor(q)));tint=mapCosine?.5+.5*vec3(cos(6.283185307179586*(u*max(colorSpeed,.001))-colorPhase),cos(6.283185307179586*(u*max(colorSpeed,.001)-1./3.)-colorPhase),cos(6.283185307179586*(u*max(colorSpeed,.001)-2./3.)-colorPhase)):symmetryLut?texture(palette,vec2(fract(u*max(colorSpeed,.001)),.5)).rgb:(!finiteFloat(coordinate))?vec3(uintBitsToFloat(0x7fc00000u)):mix(texelFetch(palette,ivec2(i,0),0).rgb,texelFetch(palette,ivec2(i+1,0),0).rgb,q-float(i));
center=vec2((projected.x-bounds.x)/(bounds.y-bounds.x),(projected.y-bounds.z)/(bounds.w-bounds.z))*vec2(size);
vec2 corners[6]=vec2[6](vec2(-1.,-1.),vec2(1.,-1.),vec2(-1.,1.),vec2(-1.,1.),vec2(1.,-1.),vec2(1.,1.));diameter=quadSplat?max(radius*.6,.8):max(radius,1.);localPoint=corners[gl_VertexID];gl_PointSize=max(radius,1.);vec2 pixel=center+(densitySplat?(quadSplat?localPoint*diameter*.5:vec2(0.)):localPoint*(radius+.5));if(capturedCamera==1&&densitySplat&&quadSplat){
// Keep source homogeneous coordinates through clipping/rasterization. A
// divide-by-w, pixel conversion and NDC reconstruction changes subpixel
// coverage and perspective interpolation, even with identical center pixels.
vec2 pixelToNdc=vec2(2./max(float(size.x),1.),2./max(float(size.y),1.));
vec2 clipOffset;if(mapCosine){float halfPointSize=diameter*.5;clipOffset=localPoint*halfPointSize*pixelToNdc*clip.w;}else{clipOffset=localPoint*diameter*.5*pixelToNdc*clip.w;}
gl_Position=clip+vec4(clipOffset,0.,0.);
}else gl_Position=capturedCamera==1&&densitySplat&&!quadSplat?clip:vec4(pixel/vec2(size)*2.-1.,0.,1.);}`;
// Native density_map_accumulate{,_quad}.frag, adapted to local RGB/mass
// channel order. The old disc kernel remains only for legacy rendering.
const DRAW_FRAGMENT=HEADER+`flat in vec2 center;flat in vec3 tint;in vec2 localPoint;flat in float diameter;uniform float radius,alpha;uniform bool densitySplat,quadSplat;out vec4 result;void main(){float mass;
if(densitySplat){vec2 p=quadSplat?localPoint:gl_PointCoord*2.-1.;float r2=dot(p,p);if(r2>(quadSplat?1.35:1.))discard;
mass=quadSplat?(1.-smoothstep(-.75,.75,(sqrt(r2)-1.)*max(diameter*.5,.4)))*exp(-.45*r2):1.-smoothstep(.75,1.,r2);
}else mass=clamp(radius+.5-length(gl_FragCoord.xy-center),0.,1.)*alpha;result=vec4(tint*mass,mass);}`;

// Source density color and coverage have their own fragment program. Keeping
// the legacy color branches in this program changes native floating-point
// lowering: source state/coverage stay exact but accumulated RGB can drift.
// The prepared owner selects this program only for source step/LUT semantics.
const sourceDensityFragment=(quad:boolean,withPalette=true)=>HEADER+`
uniform float colorSpeed,colorPhase,metricMin,metricMax;${withPalette?'uniform sampler2D palette;uniform bool symmetryLut;':''}uniform int metricMode;
in float sourceStepMetric;${quad?'in vec2 localPoint;flat in float diameter;':''}out vec4 result;
float densityMetric(float metric){float span=max(metricMax-metricMin,1.e-6);float normalized=(metric-metricMin)/span;if(metricMode==1){float positive=max(normalized,0.);normalized=positive/(1.+positive);}return clamp(normalized,0.,1.);}
vec3 densityCosine(float t){return .5+.5*vec3(cos(6.283185307179586*t-colorPhase),cos(6.283185307179586*(t-1./3.)-colorPhase),cos(6.283185307179586*(t-2./3.)-colorPhase));}
void main(){vec2 p=${quad?'localPoint':'gl_PointCoord*2.-1.'};float r2=dot(p,p);if(r2>${quad?'1.35':'1.'})discard;
float t=densityMetric(sourceStepMetric)*max(colorSpeed,.001);vec3 rgb;${withPalette?'if(symmetryLut){rgb=texture(palette,vec2(fract(t),.5)).rgb;}else{rgb=densityCosine(t);}':'rgb=densityCosine(t);'}
float mass=${quad?'(1.-smoothstep(-.75,.75,(sqrt(r2)-1.)*max(diameter*.5,.4)))*exp(-.45*r2)':'1.-smoothstep(.75,1.,r2)'};result=vec4(rgb*mass,mass);}`;
const SOURCE_MAP_POINTS_FRAGMENT=sourceDensityFragment(false,false),SOURCE_MAP_QUAD_FRAGMENT=sourceDensityFragment(true,false);
const SOURCE_DENSITY_POINTS_FRAGMENT=sourceDensityFragment(false),SOURCE_DENSITY_QUAD_FRAGMENT=sourceDensityFragment(true);

const SOURCE_DRAW_VERTEX=HEADER+TRANSFORM+SOURCE_SAMILA_NOISE_GLSL+`
uniform sampler2D states,palette;uniform usampler2D counters;uniform int stateWidth,particleOffset;uniform ivec2 size;uniform float radius,colorPhase;uniform bool quadSplat,usePaletteLut;
out vec2 localPoint;flat out vec3 tint;flat out float localRadius,diameter;
void main(){int id=particleOffset+gl_InstanceID;ivec2 at=ivec2(id%stateWidth,id/stateWidth);vec4 particle=texelFetch(states,at,0);vec3 p=transformed(particle.xyz);vec2 ndc;vec4 clip;
if(invalidPosition(particle,p,texelFetch(counters,at,0).g)||!densityPosition(p,ndc,clip)){gl_Position=vec4(2.,2.,0.,1.);gl_PointSize=1.;localPoint=vec2(0.);localRadius=0.;diameter=1.;tint=vec3(0.);return;}
float u=sourceSamilaNoisePaletteCoordinate(ndc);tint=usePaletteLut?texture(palette,vec2(u,.5)).rgb:.5+.5*cos(6.283185307179586*(vec3(u)-vec3(0.,1./3.,2./3.))-colorPhase);
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

const DIRECT_STATS_FIRST=HEADER+SUM+`uniform usampler2D values;uniform ivec2 sourceSize;uniform int count;out uvec4 result;void main(){ivec2 at=ivec2(gl_FragCoord.xy)*2;uvec4 total=uvec4(0);for(int y=0;y<2;y++)for(int x=0;x<2;x++){ivec2 p=at+ivec2(x,y);if(any(greaterThanEqual(p,sourceSize))||p.y*sourceSize.x+p.x>=count)continue;total=sum(total,texelFetch(values,p,0));}result=total;}`;
return Object.freeze({
 QUAD,EMPTY,HISTORY_COPY,STEP,STEP_MAIN,SOURCE_CALCULATE_NEXT_STEP_MAIN,BOUNDS_FIRST,BOUNDS_REDUCE,STATS_FIRST,STATS_REDUCE,CUSTOM_ERRORS_FIRST,CUSTOM_ERRORS_REDUCE,DRAW_VERTEX,DRAW_FRAGMENT,SOURCE_DENSITY_POINTS_FRAGMENT,SOURCE_DENSITY_QUAD_FRAGMENT,SOURCE_MAP_POINTS_FRAGMENT,SOURCE_MAP_QUAD_FRAGMENT,SOURCE_DRAW_VERTEX,SOURCE_DRAW_FRAGMENT,POINT_PROBE_VERTEX,POINT_PROBE_FRAGMENT,DIRECT_STATS_FIRST,
 iteration(source:IteratedGpuFieldSource):IteratedGpuProgramSource {
  if(source.stage==='fragment'){
   if(source.profile!==profile)throw Error('自定义迭代 shader profile 不匹配');
   return{vertex:QUAD,fragment:source.source};
  }
  return{vertex:STEP+source.source+(source.sourceCalculateNext?SOURCE_CALCULATE_NEXT_STEP_MAIN:STEP_MAIN),fragment:EMPTY,varyings:['newState','newMetadata']};
 }
});
}

const programs=new Map<GpuShaderProfile,ReturnType<typeof createPrograms>>();
/** Immutable source tables only: no GL context, resources, scheduling, palette
 * interpretation or compiler cache. Each backend owns its linked programs.
 * Both profiles consume identical bodies and the existing field producers. */
export function iteratedDensityGpuPrograms(profile:GpuShaderProfile){
 const existing=programs.get(profile);if(existing)return existing;
 const result=createPrograms(profile);programs.set(profile,result);return result;
}
