import {FRACTAL_NATIVE_NEWTON_GLSL} from './fractalNativeNewtonGlsl';
import {fractalTrapGLSL} from './fractalColorGpu';

/** Retained Processing QUADS: TL TR BR / BR BL TL. Coordinates are generated
 * by actual full-frame interpolation, not divided pixel indices on the CPU. */
export const FRACTAL_SOURCE_RASTER_VERTEX=`#version 300 es
precision highp float;
layout(location=0)in vec2 position;
layout(location=1)in vec2 texCoord;
out vec2 vUv;
void main(){vUv=texCoord;gl_Position=vec4(position,0.,1.);}`;
/** Main-loop specialization for only source Newton/Nova. Formula and DS helper
 * bodies are retained verbatim. The TF protocol and local shared color/trap
 * transport are adapters, not native color or arbitrary-precision claims. */
export const FRACTAL_SOURCE_NEWTON_VERTEX=`#version 300 es
precision highp float;precision highp int;
layout(location=0)in vec4 inputPoint;
uniform highp sampler2D referenceTexture;
uniform vec4 centerDS,sourceSeed;
uniform vec2 shaderPower,sourceZoom,sourceResolution;
uniform float relaxation,sourceBailout,perturbThreshold,perturbAbsFactor,perturbRelLimit;
uniform int formulaNova,isJulia,iterations,perturb,referenceLength,integerPower;
uniform vec4 legacyTrap;uniform vec3 legacyTrapShape;
out vec4 orbitA,orbitB,residualA,residualB,trapA,trapB,distanceA,distanceB,distanceC,sourceFacts;
${FRACTAL_NATIVE_NEWTON_GLSL}
${fractalTrapGLSL}
float localTrap(vec2 z){vec2 q=z-legacyTrap.xy;float co=legacyTrapShape.x,si=legacyTrapShape.y;q=vec2((q.x*co-q.y*si)/legacyTrap.w,q.x*si+q.y*co);return legacyTrapShape.z>1.5?min(abs(q.x),abs(q.y)):legacyTrapShape.z>.5?abs(length(q)-legacyTrap.z):length(q);}
void observe(vec2 zr,vec2 zi,inout float nearest){vec2 z=vec2(zr.x,zi.x);traceStep(z);float v=localTrap(z);if(!isnan(v)&&!isinf(v))nearest=min(nearest,v);}
void main(){
 vec4 offset=inputPoint;
 vec2 ox=offset.xy,oy=offset.zw;
 vec2 zr=ds_add(centerDS.xy,ox),zi=ds_add(centerDS.zw,oy),cr=sourceSeed.xy,ci=sourceSeed.zw;
 if(formulaNova==1&&isJulia==0){cr=zr;ci=zi;zr=sourceSeed.xy;zi=sourceSeed.zw;}
 vec2 pr=ds_set(shaderPower.x),pi=ds_set(shaderPower.y);
 float toleranceSquared=sourceBailout*sourceBailout;
 if(formulaNova==1){
  float zoomVal=max(sourceZoom.x+sourceZoom.y,1.0e-12);
  float minRes=max(min(sourceResolution.x,sourceResolution.y),1.0);
  float pixelSpan=2.0/(zoomVal*minRes);
  float userConv=sqrt(max(toleranceSquared,1.0e-30));
  float autoConv=max(pixelSpan*64.0,1.0e-16);
  float minConv=max(userConv*1.0e-3,1.0e-12);
  float conv=max(min(userConv,autoConv),minConv);toleranceSquared=conv*conv;
 }
 int iter=0,exitKind=0,maxIter=iterations,ordinarySteps=0,perturbSteps=0,glitches=0;
 vec2 delta_r=ds_set(0.),delta_i=ds_set(0.),delta_c_r=ds_set(0.),delta_c_i=ds_set(0.);
 bool perturbActive=perturb==1&&referenceLength>0;
 bool startedPerturb=perturbActive;
 if(perturbActive){maxIter=min(iterations,referenceLength);if(formulaNova==0||isJulia==1){delta_r=ox;delta_i=oy;}else{delta_c_r=ox;delta_c_i=oy;}}
 float initialDelta2=ox.x*ox.x+oy.x*oy.x;
 float adaptivePerturbThreshold=max(perturbThreshold,initialDelta2*64.);
 float finalResidual=0.,nearest=3.402823466e38;
 for(int i=0;i<2048;i++){
  if(i>=maxIter)break;
  if(perturbActive){
   perturbSteps++;
   vec4 ref=texelFetch(referenceTexture,ivec2(i,0),0);
   vec2 zref_r=ref.rg,zref_i=ref.ba;
   zr=ds_add(zref_r,delta_r);zi=ds_add(zref_i,delta_i);observe(zr,zi,nearest);
   vec2 new_delta_r,new_delta_i;
   ds_deltaNewton(zref_r,zref_i,delta_r,delta_i,integerPower,relaxation,new_delta_r,new_delta_i);
   if(formulaNova==1&&isJulia==0){new_delta_r=ds_add(new_delta_r,delta_c_r);new_delta_i=ds_add(new_delta_i,delta_c_i);}
   delta_r=new_delta_r;delta_i=new_delta_i;
   int nextIdx=i+1;
   if(nextIdx<maxIter){
    vec4 refNext=texelFetch(referenceTexture,ivec2(nextIdx,0),0);
    vec2 zNextR=ds_add(refNext.rg,delta_r),zNextI=ds_add(refNext.ba,delta_i);
    vec2 dzr=ds_sub(zNextR,zr),dzi=ds_sub(zNextI,zi);
    float dx=dzr.x,dy=dzi.x,step2=dx*dx+dy*dy;
    if(step2<toleranceSquared){finalResidual=step2;iter=i;exitKind=2;break;}
   }
   float dm=delta_r.x*delta_r.x+delta_i.x*delta_i.x;
   float zrefm=zref_r.x*zref_r.x+zref_i.x*zref_i.x;
   float relDelta=dm/max(zrefm,1.e-30);
   float adaptiveAbsLimit=adaptivePerturbThreshold*max(perturbAbsFactor,1.);
   float adaptiveRelLimit=max(perturbRelLimit,1.e-12);
   bool deltaInvalid=isnan(dm)||isinf(dm)||isnan(relDelta)||isinf(relDelta);
   if(deltaInvalid||dm>adaptiveAbsLimit||relDelta>adaptiveRelLimit){perturbActive=false;glitches++;}
  }else{
   ordinarySteps++;
   vec2 oldR=zr,oldI=zi;observe(oldR,oldI,nearest);
   vec2 nr,ni;
   if(formulaNova==1)iterateNova(zr,zi,cr,ci,pr,pi,relaxation,nr,ni);
   else iterateNewton(zr,zi,pr,pi,relaxation,nr,ni);
   zr=nr;zi=ni;
   vec2 dzr=ds_sub(zr,oldR),dzi=ds_sub(zi,oldI);
   float dx=dzr.x,dy=dzi.x;
   if((dx*dx+dy*dy)<toleranceSquared){finalResidual=dx*dx+dy*dy;iter=i;exitKind=2;break;}
  }
  iter=i;
 }
 // Source Newton/Nova has no nonfinite/escape branch: a nonfinite terminal
 // remains an iteration-limit interior result. Never substitute a CPU orbit.
 int status=exitKind==2?4:1;
 float measured=exitKind==2?sqrt(finalResidual):0.;
 vec2 derivative=isJulia==1?vec2(1.,0.):vec2(0.);
 orbitA=vec4(zr.x,zi.x,float(iter+1),float(status));
 orbitB=vec4(derivative,nearest,0.);
 residualA=vec4(zr.y,zi.y,measured,0.);
 residualB=vec4(measured,0.,exitKind==2?1.:0.,float(iter));
 trapA=traceInside;trapB=traceOutside;
 // Newton/Nova explicitly has no source DE capability, including when DE is
 // requested. Carry actual terminal/step facts for the shared packed fallback.
 distanceA=vec4(derivative,0.,0.);distanceB=vec4(zr.x,zi.x,float(iter),float(exitKind));
 distanceC=vec4(finalResidual,startedPerturb?1.:0.,0.,0.);
 sourceFacts=vec4(startedPerturb?1.:0.,float(glitches),float(ordinarySteps),float(perturbSteps));
 gl_Position=vec4(0.);
}`;
export const FRACTAL_SOURCE_TF_FRAGMENT='#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(0.);}';
export const FRACTAL_SOURCE_TF_VARYINGS=['orbitA','orbitB','residualA','residualB','trapA','trapB','distanceA','distanceB','distanceC','sourceFacts'] as const;
export const FRACTAL_SOURCE_TF_STRIDE=40;
