import type {IteratedField} from '../scenes/iteratedDensity';
import {prepareSourceSamilaGpuMath} from './iteratedGpuSamila';
import {sourceSamilaMathGlsl} from './sourceSamilaMath';
import {SOURCE_SAMILA_PCG_GLSL} from './sourceSamilaSampling';
import {SOURCE_SAMILA_NOISE_GLSL,SOURCE_SAMILA_NOISE_UNIFORMS} from './sourceSamilaSplat';

const HEADER='#version 300 es\nprecision highp float;precision highp int;precision highp sampler2D;\n';
/** One actual draw's borrowed TF observations. Values contain every vertex's
 * post-rotation world XY, including all six quad corners. Consume synchronously;
 * the next chunk may overwrite values. No seed draw or second evaluation occurs. */
export interface SourceSamilaDrawChunk {firstSampleId:number;sampleCount:number;totalSampleCount:number;path:'points'|'quad';verticesPerSample:1|6;vertexStride:2;values:Float32Array;}
export type SourceSamilaDrawObserver=(chunk:SourceSamilaDrawChunk)=>void;
export const SOURCE_SAMILA_DIRECT_VERTICES=65532; // divisible by six: a chunk never splits a sample

/** The common source AST/math owners supply formulas and uniforms. This owner
 * preserves the source vertex→fragment stages; only output channel order is
 * adapted from native (mass,rgbMass) to the local (rgbMass,mass) ink ABI. */
export function compileSourceSamilaDirect(field:Extract<IteratedField,{kind:'samila'}>){
 const {selection,expressions,uniforms:mathUniforms}=prepareSourceSamilaGpuMath(field),uniforms:Record<string,number>={...mathUniforms,...SOURCE_SAMILA_NOISE_UNIFORMS};
 const vertex=HEADER+Object.keys(mathUniforms).map(n=>`uniform float ${n};`).join('\n')+sourceSamilaMathGlsl+SOURCE_SAMILA_PCG_GLSL+SOURCE_SAMILA_NOISE_GLSL+`
uniform float u_rangeStart,u_rangeStop;uniform int u_frameSeed,u_particleCount;
uniform vec2 scale,offset,u_viewportSize;uniform float u_aspectRatio,radius;uniform bool u_quadSplat;
out vec2 vTexCoord,vNdcCoord,vQuadLocal;out float vValidFlag,vLocalRadius,vPointDiameter,vPaletteU;
flat out uvec4 sourceStats;
const vec2 QUAD_CORNERS[6]=vec2[6](vec2(-1.,-1.),vec2(1.,-1.),vec2(-1.,1.),vec2(-1.,1.),vec2(1.,-1.),vec2(1.,1.));
float samila_f1(float x,float y){vec3 samplePosition=vec3(x,y,0.);return ${expressions.glsl[0]};}
float samila_f2(float x,float y){vec3 samplePosition=vec3(x,y,0.);return ${expressions.glsl[1]};}
void main(){
 int sampleVertexId=u_quadSplat?(gl_VertexID/6):gl_VertexID;
 int cornerId=gl_VertexID-sampleVertexId*6;
 bool countSample=!u_quadSplat||cornerId==0;sourceStats=uvec4(0u);
 uint id=uint(sampleVertexId)^uint(u_frameSeed);uint hashX=sourceSamilaPcgHash(id);
 float posX=u_rangeStart+float(hashX)/float(0xFFFFFFFFu)*(u_rangeStop-u_rangeStart);
 float posY=u_rangeStart+sourceSamilaRandFloat(hashX)*(u_rangeStop-u_rangeStart);
 float v1=samila_f1(posX,posY);float v2=samila_f2(posX,posY);
 if(isnan(v1)||isnan(v2)||isinf(v1)||isinf(v2)){
  gl_Position=vec4(0.,0.,-2.,1.);gl_PointSize=0.;vTexCoord=vec2(0.);vNdcCoord=vec2(0.);vValidFlag=-1.;vLocalRadius=0.;vQuadLocal=vec2(0.);vPointDiameter=0.;vPaletteU=0.;if(countSample)sourceStats.x=1u;return;
 }
 float normIdx=float(sampleVertexId)/max(float(u_particleCount),1.);
 float plotX,plotY;sourceSamilaApplyGenerateMode(v1,v2,posX,posY,normIdx,plotX,plotY);
 float finalX,finalY;sourceSamilaApplyProjection(plotX,plotY,finalX,finalY);
 float transformX=finalX,transformY=finalY;
 if(abs(sourceSamilaRotation)>1e-9){float cosR=cos(sourceSamilaRotation),sinR=sin(sourceSamilaRotation);transformX=finalX*cosR-finalY*sinR;transformY=finalX*sinR+finalY*cosR;}
 vec2 ndc=vec2(transformX,transformY)*scale;ndc.y*=u_aspectRatio;ndc+=offset;
 if(u_quadSplat){vec2 local=QUAD_CORNERS[cornerId];float pointDiameter=max(radius*.6,.8);vec2 pixelToNdc=vec2(2./max(u_viewportSize.x,1.),2./max(u_viewportSize.y,1.));gl_Position=vec4(ndc+local*pointDiameter*.5*pixelToNdc,0.,1.);gl_PointSize=1.;vLocalRadius=1.;vQuadLocal=local;vPointDiameter=pointDiameter;}
 else{gl_Position=vec4(ndc,0.,1.);gl_PointSize=max(radius,1.);vLocalRadius=min(radius,1.);vQuadLocal=vec2(0.);vPointDiameter=max(radius,1.);}
 vTexCoord=vec2(transformX,transformY);vNdcCoord=ndc;
 vPaletteU=sourceSamilaNoisePaletteCoordinate(ndc);vValidFlag=1.;
 // Local diagnostics observe the same computed point without altering the
 // source's clipping/fragment validity path. Counts describe candidate coverage.
 if(countSample){if(any(isnan(ndc))||any(isinf(ndc)))sourceStats.x=1u;
 else if(!u_quadSplat&&any(greaterThan(abs(ndc),vec2(1.))))sourceStats.w=1u;
 else{vec2 pixel=(ndc+1.)*.5*u_viewportSize-.5;float extent=vPointDiameter*.5;
 vec2 lo=max(vec2(0.),ceil(pixel-extent)),hi=min(u_viewportSize-1.,floor(pixel+extent));if(any(greaterThan(lo,hi)))sourceStats.w=1u;else sourceStats.z=1u;}}
}`;
 const fragment=HEADER+`
uniform float colorPhase,alpha;uniform sampler2D paletteLUT;uniform bool useLUT,u_quadSplat;
in vec2 vTexCoord,vNdcCoord,vQuadLocal;in float vValidFlag,vLocalRadius,vPointDiameter,vPaletteU;out vec4 result;
const float PI=3.14159265358979323846;
vec3 colorscale(float t){return .5+.5*vec3(cos((2.*PI)*t-colorPhase),cos((2.*PI)*(t-1./3.)-colorPhase),cos((2.*PI)*(t-2./3.)-colorPhase));}
void main(){if(vValidFlag<0.)discard;vec2 p=u_quadSplat?vQuadLocal:(gl_PointCoord*2.-1.);float dist=length(p),r=u_quadSplat?1.:max(vLocalRadius,.01);if(dist>(u_quadSplat?1.35:r))discard;
float paletteU=vPaletteU;vec3 rgb;if(useLUT)rgb=texture(paletteLUT,vec2(paletteU,.5)).rgb;else rgb=colorscale(paletteU);
float edgeAlpha;if(u_quadSplat){float halfPointSize=max(vPointDiameter*.5,.4);float distanceToEdgePx=(dist-1.)*halfPointSize;float coverageAlpha=1.-smoothstep(-.75,.75,distanceToEdgePx);float coreAlpha=exp(-.45*dot(p,p));edgeAlpha=coverageAlpha*coreAlpha*alpha;}else edgeAlpha=(1.-smoothstep(r*.75,r,dist))*alpha;
result=vec4(rgb*edgeAlpha,edgeAlpha);}`;
 return{vertex,fragment,uniforms,selection,key:vertex+'\n'+fragment};
}
