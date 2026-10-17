import {domainPixelSpan} from './domainViewport';
import type {DomainModel} from './domainModel';
import type {DomainPaletteFacts} from './domainGradient';
import type {RGB} from '../types';
import {prepareDomainSourceGpuColor} from './domainSourceGpuColor';

export type DomainColorUniform = {name:string;type:'1f'|'1i'|'2f'|'3f'|'4f';value:number|readonly number[]};
export interface DomainColorTexture {name:string;width:number;height:number;data:Float32Array}
export interface DomainGpuColorPlan {
 key:string;source:string;uniforms:readonly DomainColorUniform[];textures:readonly DomainColorTexture[];
 /** Payload bytes only. The caller budgets CPU payload + GL storage separately. */
 textureBytes:number;precisionPolicy:string;
}
export type DomainGpuColorPreparation={plan:DomainGpuColorPlan}|{reason:string};
/** Native-float orbit values remain on GPU even when the selected color recipe
 * requires CPU. This pass only requests capture; its placeholder RGB is never
 * presented because every pixel is completed by the color owner callback. */
export const DOMAIN_CPU_COLOR_CAPTURE_PLAN:DomainGpuColorPlan=Object.freeze({
 key:'domain-cpu-color-from-native-result-v1',
 source:'vec3 domainShade(vec2 value,vec2 pixel,out bool valid,out bool repair){valid=false;repair=true;return vec3(0.);}',
 uniforms:Object.freeze([]),textures:Object.freeze([]),textureBytes:0,
 precisionPolicy:'Capture actual native GPU orbit output; shade it with the selected CPU color owner without reevaluating the orbit.',
});
/** 1024 cyclic segments, four RGBA32F texels each. Curves use at most765
 * segments. This is exact piecewise data, not a sampled palette LUT. */
export const MAX_DOMAIN_COLOR_TEXELS=4096;
export const MAX_DOMAIN_COLOR_TEXTURE_BYTES=MAX_DOMAIN_COLOR_TEXELS*16;
const EPS=2**-23;
const POLICY='Float32 domain color with segment/phase/quantization conditioning guards; risky output pixels require the existing Float64 color owner. Guards are numerical estimates, not interval proofs or cross-device error guarantees.';

function packPalette(facts:DomainPaletteFacts):{data:Float32Array;kind:number;warp:number;count:number;channels:RGB;cosine:number[][];slope:number;reason?:string}{
 const values:number[]=[],shape=facts.shape;let kind=0,warp=0,count=0,channels:RGB=[0,0,0],cosine:number[][]=[[0,0,0],[0,0,0],[0,0,0],[0,0,0]],slope=1;
 const add=(meta:readonly number[],left:readonly number[],right:readonly number[],last:readonly number[]=[0,0,0,0])=>{values.push(...meta,...left,0,...right,0,...last);count++;};
 if(shape.kind==='stops'){
  warp=shape.warp==='sine'?1:0;count=0;
  for(let i=0;i<shape.colors.length-1;i++){
   const x0=shape.positions[i],x1=shape.positions[i+1],width=x1-x0;
   if(!(Math.fround(x1)>Math.fround(x0)))return{data:new Float32Array(),kind,warp,count,channels,cosine,slope,reason:'色标间距不足以用 GPU float32 区分'};
   if(shape.interpolation==='hsv'){const h=shape.hsv![i];add([x0,x1,4,h.hueDelta],h.left,h.right);slope=Math.max(slope,8/width);}
   else{const a=shape.colors[i],b=shape.colors[i+1];add([x0,x1,0,0],a,b);slope=Math.max(slope,...a.map((v,k)=>Math.abs(b[k]-v)/width));}
  }
 }else if(shape.kind==='cyclic'){
  kind=1;const n=shape.segments.length;
  for(let i=0;i<n;i++){const p=shape.segments[i],space=['rgb','linear','oklab','oklch'].indexOf(p.space);add([i/n,(i+1)/n,space,p.space==='oklch'?p.hueDelta:0],p.left,p.right);slope=Math.max(slope,n*(space===0?1:16));}
 }else if(shape.kind==='hsv-wheel'){kind=2;slope=6;}
 else if(shape.kind==='cosine'){kind=3;const c=shape.cosine;cosine=[c.a,c.b,c.c,c.d];slope=Math.max(1,...c.b.map((b,i)=>Math.abs(b*c.c[i])*Math.PI*2));}
 else{
  kind=4;channels=shape.channels.map(c=>c.length) as RGB;
  for(const channel of shape.channels)for(const p of channel){
   if(!(Math.fround(p.x1)>Math.fround(p.x0)))return{data:new Float32Array(),kind,warp,count,channels,cosine,slope,reason:'曲线节点间距不足以用 GPU float32 区分'};
   add([p.x0,p.x1,0,0],[p.y0,p.y1,p.m0],[p.m1,0,0]);
   slope=Math.max(slope,Math.abs(p.m0),Math.abs(p.m1),3*Math.abs(p.y1-p.y0)/(p.x1-p.x0));
  }
 }
 if(!values.length)values.push(...Array(16).fill(0));
 if(values.length>MAX_DOMAIN_COLOR_TEXELS*4)throw new Error('域着色色板事实超过纹理容量');
 if(values.some(v=>!Number.isFinite(v)||!Number.isFinite(Math.fround(v))))return{data:new Float32Array(),kind,warp,count,channels,cosine,slope,reason:'色板分段参数超出 GPU float32 范围'};
 return{data:Float32Array.from(values),kind,warp,count,channels,cosine,slope};
}

/** Input is the sole parsed DomainModel, including the sampler owner's facts.
 * This adapter owns no context, settings parser, time state or palette LUT. */
export function prepareDomainGpuColor(model:DomainModel,height:number):DomainGpuColorPreparation {
 if(!Number.isInteger(height)||height<1)throw new Error('域着色图像高度无效');
 if(model.colorVersion!=='local-v1')return prepareDomainSourceGpuColor(model);
 const facts=model.paletteFacts,packed=packPalette(facts);if(packed.reason)return{reason:packed.reason};
 const maxCoordinate=(.5+Math.abs(model.paletteOffset))*Math.abs(facts.cycles)+Math.abs(facts.offset);
 const scalars=[facts.cycles,facts.offset,model.paletteOffset,model.phaseDensity,model.modDensity,model.phaseSharpness,model.modSharpness,model.bias,model.mix,...packed.cosine.flat()];
 if(scalars.some(v=>!Number.isFinite(v)||!Number.isFinite(Math.fround(v))||(v!==0&&Math.abs(v)<2**-126)))return{reason:'域着色颜色参数超出 GPU float32 正规范围'};
 // No normalization modulo here: reducing an authored huge offset first would
 // change double addition semantics. Keep the CPU owner for ill-conditioned data.
 if(!Number.isFinite(maxCoordinate)||!Number.isFinite(packed.slope)||8*EPS*(1+maxCoordinate)*packed.slope*(packed.warp?Math.PI:1)>1/1024)return{reason:'域着色色板相位或分段斜率需要 CPU 双精度'};
 if(packed.kind===3&&Math.max(...packed.cosine[0].map(Math.abs),...packed.cosine[1].map(Math.abs),...packed.cosine[3].map(Math.abs))*EPS>1/8192)return{reason:'余弦色板振幅或相位需要 CPU 双精度'};
 const gridScale=domainPixelSpan(model.view,height,model.gridSpacing);
 if(model.grid&&(!Number.isFinite(gridScale)||gridScale<2**-126||!Number.isFinite(Math.fround(model.gridSpacing))))return{reason:'域着色网格线宽需要 CPU 双精度'};
 const texels=packed.data.length/4,width=Math.min(1024,texels),textureHeight=Math.ceil(texels/width),data=new Float32Array(width*textureHeight*4);data.set(packed.data);
 const uniforms:DomainColorUniform[]=[
  {name:'dcKind',type:'1i',value:packed.kind},{name:'dcWarp',type:'1i',value:packed.warp},{name:'dcCount',type:'1i',value:packed.count},
  {name:'dcChannels',type:'3f',value:packed.channels},{name:'dcMap',type:'3f',value:[facts.cycles,facts.offset,model.paletteOffset]},
  {name:'dcSlope',type:'1f',value:packed.slope},{name:'dcCurveMode',type:'1i',value:['NONE','PHASE','MODULUS','PHASE_MODULUS'].indexOf(model.curveMode)},
  {name:'dcContour',type:'4f',value:[model.phaseDensity,model.modDensity,model.phaseSharpness,model.modSharpness]},
  {name:'dcBrightness',type:'2f',value:[model.mix,model.bias]},
  {name:'dcGrid',type:'1i',value:model.grid?1:0},{name:'dcGridInfo',type:'2f',value:[model.gridSpacing,model.grid?gridScale:1]},
  ...packed.cosine.map((value,i)=>({name:'dcCosine'+i,type:'3f' as const,value})),
 ];
 return{plan:{key:'domain-color-v1-piecewise',source:DOMAIN_GPU_COLOR_SOURCE,uniforms,textures:[{name:'dcData',width,height:textureHeight,data}],textureBytes:data.byteLength,precisionPolicy:POLICY}};
}

/** Shader returns unrounded color (SS averaging belongs to the renderer). The
 * running cyclic sampler's internal 8-bit quantization is intentionally earlier. */
export const DOMAIN_GPU_COLOR_SOURCE=`
uniform highp sampler2D dcData;
uniform int dcKind,dcWarp,dcCount,dcCurveMode,dcGrid;
uniform vec3 dcChannels,dcMap,dcCosine0,dcCosine1,dcCosine2,dcCosine3;
uniform vec4 dcContour;
uniform vec2 dcBrightness,dcGridInfo;
uniform float dcSlope;
const float DC_PI=3.14159265358979323846,DC_TAU=6.28318530717958647692,DC_EPS=1.1920928955078125e-7;
bool dcFinite(float v){return (floatBitsToUint(v)&0x7f800000u)!=0x7f800000u;}
bool dcFinite3(vec3 v){return dcFinite(v.x)&&dcFinite(v.y)&&dcFinite(v.z);}
vec4 dcGet(int segment,int field){int at=segment*4+field,w=textureSize(dcData,0).x;return texelFetch(dcData,ivec2(at%w,at/w),0);}
float dcWrap(float v){return mod(mod(v,1.)+1.,1.);}
float dcRemainder(float v){return v-trunc(v);}
vec3 dcHsv(vec3 hsv){float h=dcWrap(hsv.x);vec3 k=mod(vec3(5.,3.,1.)+h*6.,6.);return hsv.z-hsv.z*hsv.y*max(vec3(0.),min(min(k,4.-k),vec3(1.)));}
float dcSrgb(float v){return v<=.0031308?12.92*v:1.055*pow(v,1./2.4)-.055;}
vec3 dcSrgb3(vec3 v){return vec3(dcSrgb(v.x),dcSrgb(v.y),dcSrgb(v.z));}
vec3 dcFromLab(vec3 lab){
 float l=lab.x+.3963377774*lab.y+.2158037573*lab.z;
 float m=lab.x-.1055613458*lab.y-.0638541728*lab.z;
 float s=lab.x-.0894841775*lab.y-1.291485548*lab.z;
 l=l*l*l;m=m*m*m;s=s*s*s;
 return dcSrgb3(vec3(4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s));
}
int dcFind(float t,int start,int count){
 int lo=0,hi=count;
 // At most1024segments, binary search includes the closing endpoint.
 for(int j=0;j<11;j++){if(hi-lo<=1)break;int mid=(lo+hi)/2;if(dcGet(start+mid,0).x<=t)lo=mid;else hi=mid;}
 return start+min(lo,count-1);
}
vec3 dcSegment(int index,float t,inout bool repair,float te){
 vec4 meta=dcGet(index,0);vec3 a=dcGet(index,1).xyz,b=dcGet(index,2).xyz;
 float width=meta.y-meta.x,f=dcKind==1?t*float(dcCount)-float(index):clamp((t-meta.x)/width,0.,1.);int space=int(meta.z);
 if(te/width>1./2048.)repair=true;
 vec3 color;
 if(space==0)color=dcKind==1?a*(1.-f)+b*f:a+(b-a)*f;
 else if(space==1)color=dcSrgb3(a*(1.-f)+b*f);
 else if(space==2)color=dcFromLab(a*(1.-f)+b*f);
 else if(space==3){float h=a.z+meta.w*f,c=a.y*(1.-f)+b.y*f;color=dcFromLab(vec3(a.x*(1.-f)+b.x*f,c*cos(h),c*sin(h)));}
 else color=dcHsv(vec3(a.x+meta.w*f,a.y+(b.y-a.y)*f,a.z+(b.z-a.z)*f));
 return color;
}
float dcCurve(float t,int start,int count){
 int index=dcFind(t,start,count);vec4 meta=dcGet(index,0),a=dcGet(index,1),b=dcGet(index,2);
 if(t<=dcGet(start,0).x)return dcGet(start,1).x;
 if(t>=dcGet(start+count-1,0).y)return dcGet(start+count-1,1).y;
 float width=meta.y-meta.x,u=(t-meta.x)/width,u2=u*u,u3=u2*u;
 return clamp((2.*u3-3.*u2+1.)*a.x+(u3-2.*u2+u)*width*a.z+(-2.*u3+3.*u2)*a.y+(u3-u2)*width*b.x,0.,1.);
}
vec3 domainPalette(float coordinate,out bool repair){
 repair=false;float scaled=coordinate*dcMap.x+dcMap.y,t=dcWrap(scaled);
 float te=8.*DC_EPS*(1.+abs(coordinate*dcMap.x)+abs(dcMap.y));
 if(!dcFinite(scaled)||min(t,1.-t)<te)repair=true;
 if(dcWarp==1){t=.5-.5*cos(t*DC_TAU);te=DC_PI*te+8.*DC_EPS;}
 if(te*dcSlope>1./1024.)repair=true;
 vec3 color;
 if(dcKind==2)color=dcHsv(vec3(t,.72,1.));
 else if(dcKind==3){
  vec3 ct=dcCosine2*t,dt=dcCosine3;
  vec3 a=vec3(dcRemainder(ct.x)+dcRemainder(dt.x),dcRemainder(ct.y)+dcRemainder(dt.y),dcRemainder(ct.z)+dcRemainder(dt.z));
  if(max(max(abs(ct.x),abs(ct.y)),abs(ct.z))*DC_EPS>1./8192.)repair=true;
  color=clamp(dcCosine0+dcCosine1*cos(DC_TAU*a),0.,1.);
 }else if(dcKind==4){int r=int(dcChannels.x),g=int(dcChannels.y),b=int(dcChannels.z);color=vec3(dcCurve(t,0,r),dcCurve(t,r,g),dcCurve(t,r+g,b));}
 else{
  int index=dcKind==1?min(dcCount-1,int(floor(t*float(dcCount)))):dcFind(t,0,dcCount);
  color=dcSegment(index,t,repair,te);
  if(dcKind==1){
   color=clamp(color,0.,1.);vec3 scaledColor=color*255.,distance=abs(fract(scaledColor)-.5);
   float error=(te*dcSlope+32.*DC_EPS)*255.;
   if(min(min(distance.x,distance.y),distance.z)<error)repair=true;
   color=floor(scaledColor+.5)/255.;
  }
 }
 if(!dcFinite3(color))repair=true;
 return color;
}
vec3 domainShade(vec2 value,vec2 pixel,out bool valid,out bool repair){
 repair=false;valid=dcFinite(value.x)&&dcFinite(value.y);
 if(!valid)return vec3(0.);
 float scale=max(abs(value.x),abs(value.y));
 float magnitude=scale==0.?0.:scale*length(value/scale);
 if(!dcFinite(magnitude)){valid=false;return vec3(0.);}
 if(abs(magnitude-1.e12)<=1.e12*16.*DC_EPS)repair=true;
 if(magnitude>1.e12){valid=false;return vec3(0.);}
 // atan's negative-real-axis branch (including signed zero) can select
 // different palette phases when cycles is nonintegral. Do not guess a side.
 if(value.x<0.&&abs(value.y)<=16.*DC_EPS*abs(value.x))repair=true;
 float angle=magnitude==0.?0.:atan(value.y,value.x),phase=angle/DC_TAU;
 float pa=angle*dcContour.x,ma=log(max(magnitude,1.e-15))*dcContour.y;
 float pb=clamp(.5+.5*cos(pa),0.,1.),mb=clamp(.5+.5*cos(ma),0.,1.);
 float pe=8.*DC_EPS*(1.+abs(pa)),me=8.*DC_EPS*(1.+abs(ma));
 float pw=pow(pb,dcContour.z),mw=pow(mb,dcContour.w);
 // Propagate a base-value sensitivity bracket through pow itself. The
 // derivative sharpness*base^(sharpness-1) is singular at a dark valley
 // when sharpness<1; multiplying by sharpness alone is not sufficient.
 vec2 pr=pow(clamp(vec2(pb-pe,pb+pe),0.,1.),vec2(dcContour.z));
 vec2 mr=pow(clamp(vec2(mb-me,mb+me),0.,1.),vec2(dcContour.w));
 float level=dcCurveMode==1?pw:dcCurveMode==2?mw:dcCurveMode==3?sqrt(pw*mw):1.;
 vec2 lr=dcCurveMode==1?pr:dcCurveMode==2?mr:dcCurveMode==3?sqrt(pr*mr):vec2(1.);
 float magnitudeFactor=min(1.,sqrt(magnitude));
 float brightness=clamp((1.-dcBrightness.x)+dcBrightness.x*(.25+.75*level)+dcBrightness.y,0.,1.)*magnitudeFactor;
 vec2 br=clamp((1.-dcBrightness.x)+dcBrightness.x*(.25+.75*lr)+dcBrightness.y,0.,1.)*magnitudeFactor;
 if(max(abs(br.x-brightness),abs(br.y-brightness))>1./1024.)repair=true;
 if(dcGrid==1){vec2 g=pixel/dcGridInfo.x;vec2 nearest=floor(g+.5);float distance=min(abs(g.x-nearest.x),abs(g.y-nearest.y));brightness*=.35+.65*clamp(distance/dcGridInfo.y,0.,1.);float ge=8.*DC_EPS*(1.+max(abs(g.x),abs(g.y)));if(distance<=dcGridInfo.y+ge&&ge/dcGridInfo.y>1./1024.)repair=true;}
 bool paletteRepair;vec3 color=domainPalette(phase+dcMap.z,paletteRepair);repair=repair||paletteRepair;
 color*=brightness;if(!dcFinite3(color)){repair=true;return vec3(0.);}return color;
}
`;
