import type {SourceDomainModel} from './domainModel';
import type {DomainGpuColorPreparation,DomainColorUniform} from './domainGpuColor';

/** Executes prepared source-color facts. Palette parsing, adaptive subdivision,
 * packed-byte interpolation and normalization stay with domainSourceColor. */
export function prepareDomainSourceGpuColor(model:SourceDomainModel):DomainGpuColorPreparation {
 const f=model.sourceColor.facts,p=f.palette;
 if(p.sampling==='cpu-n-cycle')return{reason:'原产物 CPU 动态色板逐次整数插值使用 CPU 着色合同'};
 const entries=p.entries,count=entries.length;
 if(count>4096)return{reason:'原产物完整色板超出本机 GPU 色板纹理容量'};
 if(!Number.isFinite(Math.fround(f.paletteOffset))||Math.abs(f.paletteOffset)*2**-23>1/8192)return{reason:'域着色色板相位或分段斜率需要 CPU 双精度'};
 const width=Math.max(1,Math.min(count,1024)),height=Math.max(1,Math.ceil(count/width)),data=new Float32Array(width*height*4);
 entries.forEach((c,i)=>data.set(c,i*4));
 const uniforms:DomainColorUniform[]=[
  {name:'dsCount',type:'1i',value:count},{name:'dsCpu',type:'1i',value:f.version==='mathart-1.7.8-cpu'?1:0},
  {name:'dsCurveMode',type:'1i',value:['PHASE','MODULUS','PHASE_MODULUS','NONE'].indexOf(f.curveMode)},
  {name:'dsContour',type:'4f',value:[f.phaseDensity,f.modDensity,f.phaseSharpness,f.modSharpness]},
  {name:'dsBiasMix',type:'2f',value:[f.bias,f.mix]},{name:'dsOffset',type:'1f',value:f.paletteOffset},
 ];
 return{plan:{key:'domain-source-color-1.7.8',source:DOMAIN_SOURCE_GPU_COLOR_SOURCE,uniforms,textures:[{name:'dsColors',width,height,data}],textureBytes:data.byteLength,precisionPolicy:'Explicit source color contract with shared parsed palette facts. Numerical sensitivity requests complete CPU re-evaluation using the same selected source color version; no native-driver pixel equivalence claim.'}};
}

/** Independent implementation of the source stripe/product/additive-bias
 * contract. This is not the shipped shader or a replacement complex evaluator.
 * Final source CPU byte truncation is distinct from source GPU float RGB. */
export const DOMAIN_SOURCE_GPU_COLOR_SOURCE=`
uniform highp sampler2D dsColors;
uniform int dsCount,dsCpu,dsCurveMode;
uniform vec4 dsContour;uniform vec2 dsBiasMix;uniform float dsOffset;
const float DS_TAU=6.28318530717958647692,DS_EPS=1.1920928955078125e-7;
bool dsFinite(float x){return (floatBitsToUint(x)&0x7f800000u)!=0x7f800000u;}
vec3 dsColor(int i){int w=textureSize(dsColors,0).x;return texelFetch(dsColors,ivec2(i%w,i/w),0).rgb;}
vec3 dsPalette(float coordinate,inout bool repair){
 if(dsCount==0)return vec3(0.);if(dsCount==1)return dsColor(0);
 float t=fract(coordinate),phaseError=16.*DS_EPS*(1.+abs(coordinate));
 if(min(t,1.-t)<phaseError)repair=true;
 float p=t*float(dsCount-1),fraction=fract(p);int index=min(dsCount-1,int(floor(p)));
 if(phaseError*float(dsCount-1)>1./2048.)repair=true;
 return mix(dsColor(index),dsColor(min(index+1,dsCount-1)),fraction);
}
float dsStripe(float v,float density,float sharpness,out vec2 range){
 float argument=v*max(.0001,density),power=max(.0001,sharpness);
 float base=clamp(.5+.5*cos(argument),0.,1.),error=16.*DS_EPS*(1.+abs(argument));
 range=pow(clamp(vec2(base-error,base+error),0.,1.),vec2(power));
 return pow(base,power);
}
vec3 domainShade(vec2 value,vec2 pixel,out bool valid,out bool repair){
 valid=true;repair=false;
 bool finiteValue=dsFinite(value.x)&&dsFinite(value.y);float magnitude;
 if(dsCpu==0){
  float squared=dot(value,value);
  if(!finiteValue||!(squared<=1.e24))value=vec2(1.e6,0.);
  else if(abs(squared-1.e24)<=1.e24*32.*DS_EPS)repair=true;
  magnitude=min(length(value),1.e6);
 }else{
  if(!finiteValue){repair=true;return vec3(0.);}
  float scale=max(abs(value.x),abs(value.y));magnitude=scale>1.e6?1.e6:scale==0.?0.:min(scale*length(value/scale),1.e6);
 }
 // GLSL atan(0,0) is unspecified. The independent version chooses phase zero;
 // negative-axis and zero risks are evaluated by its same-version CPU owner.
 float phase=value.x==0.&&value.y==0.?0.:atan(value.y,value.x);
 if((value.x==0.&&value.y==0.)||(value.x<0.&&abs(value.y)<32.*DS_EPS*abs(value.x)))repair=true;
 float modulus=log(magnitude+1.e-12);vec2 phaseRange,modRange;
 float a=dsStripe(phase,dsContour.x,dsContour.z,phaseRange),b=dsStripe(modulus,dsContour.y,dsContour.w,modRange);
 float curve=dsCurveMode==0?a:dsCurveMode==1?b:dsCurveMode==2?a*b:1.;
 vec2 curveRange=dsCurveMode==0?phaseRange:dsCurveMode==1?modRange:dsCurveMode==2?phaseRange*modRange:vec2(1.);
 float brightness=mix(1.,curve,dsBiasMix.y);vec2 brightnessRange=mix(vec2(1.),curveRange,dsBiasMix.y);
 if(max(abs(brightnessRange.x-brightness),abs(brightnessRange.y-brightness))>1./2048.)repair=true;
 vec3 base=dsPalette(phase/DS_TAU+dsOffset,repair),color=clamp(base*brightness+dsBiasMix.x,0.,1.);
 if(!dsFinite(color.x)||!dsFinite(color.y)||!dsFinite(color.z)){repair=true;return vec3(0.);}
 if(dsCpu==1){
  vec3 scaled=color*255.,boundary=min(fract(scaled),1.-fract(scaled));
  if(min(min(boundary.x,boundary.y),boundary.z)<512.*DS_EPS*255.)repair=true;
  color=floor(scaled)/255.;
 }
 return color;
}
`;
