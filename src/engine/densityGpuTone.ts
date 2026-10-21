import {SOURCE_SYMMETRY_PRESENT_GLSL,sourceIteratedBrightnessUniform} from './sourceSymmetryPresentation';
import {isCapturedDensityView,validateDensityView,type PreparedDensityView} from './densityPresentation';
import {SOURCE_SAMILA_PRESENT_GLSL,sourceSamilaDisplayTransform} from './sourceSamilaPresentation';
import {densityAcceptsSignedMass} from './density';
import type {DensityToneJob} from './density';
import {DEFAULT_COSINE,hexRGB,paletteColor,palettePositions,rgbHSV} from './palette';
import {samilaSourceIndex} from './samilaCamera';

export const DENSITY_TONE_TILE=512;
const REDUCE=4,HEADER='#version 300 es\nprecision highp float;precision highp int;precision highp sampler2D;precision highp usampler2D;\n';
const QUAD=HEADER+'void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}';
const finite=(v:number)=>Number.isFinite(v)&&Number.isFinite(Math.fround(v));
const require=(condition:boolean,message:string)=>{if(!condition)throw new Error(message);};
const cancel=(fn?:()=>boolean)=>{if(fn?.())throw new DOMException('GPU 密度调色已取消','AbortError');};
export interface DensityGpuTonePlan {job:DensityToneJob;stops:Float32Array;mode:number;hsvStops:boolean;endpoint:[number,number,number];constant:[number,number,number];cosine:typeof DEFAULT_COSINE;}
export type DensityGpuToneAdmission={plan:DensityGpuTonePlan;reason?:never}|{plan?:never;reason:string};
/** Only capability/precision applicability is decided here. Settings and palette
 * validity belong to prepareDensityTone; no raw scene data enters this adapter. */
export function prepareDensityGpuTone(job:DensityToneJob):DensityGpuToneAdmission {
 const {tone,palette:p}=job;
 if(![job.gain,job.inverseGamma,job.logWhite,tone.dynamicRange,tone.contrast,tone.brightness,tone.saturation,...job.background].every(finite))return{reason:'调色参数超出 GPU float32 范围'};
 if(job.model!=='white-point-v1'&&(!finite(job.normalization.scale)||Math.fround(job.normalization.scale)<=0))return{reason:'归一密度尺度需要 CPU 双精度调色'};
 if(!job.sourcePresentation&&!job.sourceSymmetryPresentation&&tone.contrast!==0&&Math.abs(tone.contrast)<1e-20)return{reason:'极小对比度需要 CPU 双精度调色'};
 // Source colors have already been sampled and accumulated, so every palette
 // representation remains eligible when only the RGB/mass average is needed.
 if(tone.paletteMode==='source')return{plan:{job,stops:new Float32Array([0,0,0,0,0,0,0,1]),mode:0,hsvStops:false,endpoint:[0,0,0],constant:[0,0,0],cosine:DEFAULT_COSINE}};
 if(p.mode==='curve')return{reason:'曲线色板保留共享 CPU 分段三次插值调色'};
 if(!finite(p.cycles)||!finite(p.offset)||Math.abs(p.cycles)>64||Math.abs(p.offset)>64)return{reason:'大色板周期或偏移需要 CPU 双精度相位'};
 const locations=palettePositions(p),hsvStops=p.interpolation==='hsv',stops=new Float32Array(p.stops.length*4);
 for(let i=0;i<p.stops.length;i++){stops.set(hsvStops?rgbHSV(hexRGB(p.stops[i])):hexRGB(p.stops[i]),i*4);stops[i*4+3]=locations[i];if(i&&stops[i*4+3]<=stops[(i-1)*4+3])return{reason:'相邻色标位置在 GPU float32 中重合'};}
 const cosine=p.cosine??DEFAULT_COSINE;
 if(p.mode==='cosine'&&Object.values(cosine).flat().some(v=>!finite(v)||Math.abs(v)>64))return{reason:'大余弦色板参数需要 CPU 双精度相位'};
 return{plan:{job,stops,mode:p.cycles===0?4:{linear:0,sine:1,hsv:2,cosine:3}[p.mode as 'linear'|'sine'|'hsv'|'cosine'],hsvStops,endpoint:paletteColor(p,1-Number.EPSILON),constant:paletteColor(p,0),cosine}};
}
/** Two MRT targets, two reductions, and a bounded integer view-index tile.
 * Includes CPU upload scratch as well as owned GPU presentation storage. */
export function densityGpuToneBytes(tile=DENSITY_TONE_TILE):number {
 if(!Number.isInteger(tile)||tile<1||tile>DENSITY_TONE_TILE)throw new Error('GPU 调色分块尺寸无效');
 return tile*tile*28+Math.ceil(tile/REDUCE)**2*32+1024*32;
}
/** Additional full-frame RGBA8 + RGBA32UI targets; fixed tile scratch stays
 * in densityGpuToneBytes. No output or retained ink is counted twice here. */
export function sourceDensityPresentationBytes(width:number,height:number):number {
 require([width,height].every(n=>Number.isInteger(n)&&n>0&&n<=16384)&&width*height<=33554432,'源密度呈现尺寸超出 128 MiB 输出限制');return width*height*20;
}
const FRAGMENT=HEADER+`
uniform sampler2D ink,stops;uniform usampler2D viewIndices;uniform int hasView;
uniform ivec2 origin,imageSize;uniform int sourceSamilaSplat,stopCount,sourceColor,toneMode,transparent,mode,hsvStops,normalized,mapProfile,samilaPalette;
uniform float whitePoint,logWhite,gain,inverseGamma,contrast,brightness,saturation,cycles,phase,normalizationScale;
uniform vec3 background,endpoint,constantColor,cosA,cosB,cosC,cosD;
layout(location=0)out vec4 pixel;layout(location=1)out uvec4 facts;
bool finiteFloat(float x){return(floatBitsToUint(x)&0x7f800000u)!=0x7f800000u;}
bool finite3(vec3 x){return finiteFloat(x.x)&&finiteFloat(x.y)&&finiteFloat(x.z);}
float maximum(vec3 x){return max(x.x,max(x.y,x.z));}
float log1pStable(float x){if(x<.01)return x*(1.+x*(-.5+x*(.333333333333+x*(-.25+x*.2))));float y=1.+x;return log(y)*(x/(y-1.));}
float normalizedValue(float logDensity){float q=2.*(contrast*logDensity/log(1000.)+brightness)-1.;if(q==0.)return .5;float x=-log(abs(q))/whitePoint;float limited=exp(-whitePoint*(max(x,0.)+log1pStable(exp(-abs(x)))));return normalized==2?.5+.5*sign(q)*limited:.5-.5*sign(q)*limited;}
vec3 hsv(vec3 v){vec3 k=mod(vec3(5.,3.,1.)+v.x*6.,6.);return v.z-v.z*v.y*clamp(min(k,4.-k),0.,1.);}
vec3 palette(float base,inout uint repair){
 if(mode==4)return constantColor;
 if(base>=1.)return endpoint;
 float coordinate=clamp(base,0.,1.)*cycles+phase,uncertainty=8e-7*(abs(coordinate)+abs(cycles)*abs(base)+1.);
 float nearInteger=abs(coordinate-round(coordinate));
 // A wrapped discontinuity cannot be silently smoothed by float32 rounding.
 // The default single cycle is continuous at the clamped half-open endpoint.
 if(nearInteger<=uncertainty&&!(phase==0.&&cycles==1.)&&!(phase==0.&&cycles>0.&&coordinate<uncertainty))repair=1u;
 float t=fract(coordinate);if(mode==2)return hsv(vec3(t,.72,1.));
 if(mode==3){if(maximum(abs(cosB*cosC))*6.28318530718*uncertainty>.0015)repair=1u;return clamp(cosA+cosB*cos(6.28318530718*(mod(cosC*t,1.)+mod(cosD,1.))),0.,1.);}
 if(mode==1){t=.5-.5*cos(6.28318530718*t);uncertainty*=3.14159265359;}
 int lo=0,hi=stopCount-1;for(int j=0;j<10;j++){if(hi-lo<=1)break;int m=(lo+hi)/2;if(texelFetch(stops,ivec2(m,0),0).a<=t)lo=m;else hi=m;}
 vec4 a=texelFetch(stops,ivec2(lo,0),0),b=texelFetch(stops,ivec2(hi,0),0);float width=b.a-a.a,u=clamp((t-a.a)/width,0.,1.);
 if(hsvStops!=0){if(a.y<1e-12)a.x=b.x;if(b.y<1e-12)b.x=a.x;float dh=b.x-a.x;if(dh>.5)dh-=1.;if(dh<-.5)dh+=1.;if((6.*abs(dh)+abs(b.y-a.y)+abs(b.z-a.z))*uncertainty/width>.0015)repair=1u;return hsv(vec3(a.x+dh*u,mix(a.y,b.y,u),mix(a.z,b.z,u)));}
 if(maximum(abs(b.rgb-a.rgb))*uncertainty/width>.0015)repair=1u;
 return mix(a.rgb,b.rgb,u);
}
void main(){
 ivec2 local=ivec2(gl_FragCoord.xy),p=origin+local,at=ivec2(p.x,imageSize.y-1-p.y);vec4 v=texelFetch(ink,at,0);float count=v.a;
 uint bad=(!finiteFloat(count)||(count<0.&&sourceSamilaSplat==0)||!finite3(v.rgb))?1u:0u,repair=0u;
 facts=uvec4(count>0.?1u:0u,bad==0u&&count>0.?floatBitsToUint(count):0u,bad,0u);
 if(bad!=0u){pixel=transparent!=0?vec4(0.):vec4(background,1.);return;}
 // Statistics and malformed-source checks above visit every original texel.
 // Only presentation uses the exact shared CPU owner's integer index tile.
 if(hasView!=0){uint index=texelFetch(viewIndices,local,0).r;if(index==0u){pixel=transparent!=0?vec4(0.):vec4(background,1.);return;}index-=1u;at=ivec2(int(index%uint(imageSize.x)),imageSize.y-1-int(index/uint(imageSize.x)));v=texelFetch(ink,at,0);count=v.a;}
 if(count==0.){pixel=transparent!=0?vec4(0.):vec4(background,1.);return;}
 if(normalized!=0){
  if(count<=1e-12){pixel=transparent!=0?vec4(0.):vec4(background,1.);return;}
  float value=normalizedValue(log(count)-log(normalizationScale));
  vec3 average=mapProfile!=0&&count<=1e-6?vec3(0.):v.rgb/count;
  if(!finite3(average)||maximum(abs(average))>1e5)repair=1u;
  vec3 color;float alpha=clamp(1./(1.+.02*normalizationScale/count),0.,1.);
  if(normalized==2&&samilaPalette!=0){
   vec3 raw=mix(background,average,value);float e=2e-5*(1.+maximum(abs(average)));
   if(any(lessThan(raw,vec3(0.)))||maximum(pow(max(raw+e,vec3(0.)),vec3(inverseGamma))-pow(max(raw-e,vec3(0.)),vec3(inverseGamma)))*255.>.75)repair=1u;
   color=pow(max(raw,vec3(0.)),vec3(inverseGamma));float y=dot(color,vec3(.299,.587,.114));color=mix(vec3(y),color,saturation);alpha=1.-value*(1.-alpha);
  }else{
   float y=dot(average,vec3(.299,.587,.114)),chroma=saturation*value*(1.-value)*4.;
   float u=.493*(average.b-y)*chroma,w=.877*(average.r-y)*chroma;
   vec3 raw=vec3(value+w/.877,value-.39393*u-.58081*w,value+u/.493);
   float e=2e-5*(1.+maximum(abs(average)));
   if(maximum(pow(clamp(raw+e,0.,1.),vec3(inverseGamma))-pow(clamp(raw-e,0.,1.),vec3(inverseGamma)))*255.>.75)repair=1u;
   color=pow(clamp(raw,0.,1.),vec3(inverseGamma));
  }
  if(!finite3(color))repair=1u;
  vec3 rgb=transparent!=0?color:color*alpha+background*(1.-alpha);
  pixel=floor(clamp(vec4(rgb,transparent!=0?alpha:1.),0.,1.)*255.+.5)/255.;facts.w=repair;return;
 }
 float base=toneMode==1?log1pStable(count)/logWhite:count/whitePoint;
 if(!finiteFloat(base))base=1e30;
 bool simpleLevel=contrast==1.&&brightness==0.;float raw=simpleLevel?base*gain:contrast==0.?.5+brightness:(base*gain-.5)*contrast+.5+brightness;
 float level=pow(clamp(raw,0.,1.),inverseGamma);
 // Flag amplification near a clamp/power boundary for the exact shared CPU
 // renderer. No pixels are invented when the numerical condition is sensitive.
 float e=8e-7*(abs(base*gain*contrast)+abs(.5*contrast)+.5+abs(brightness));
 if((pow(clamp(raw+e,0.,1.),inverseGamma)-pow(clamp(raw-e,0.,1.),inverseGamma))*255.>.75||(raw>0.&&raw<1e-12)||(transparent!=0&&!simpleLevel&&raw-e<=0.&&raw+e>0.))repair=1u;
 vec3 color=sourceColor!=0?v.rgb/count:palette(base,repair);
 if(!finite3(color)||maximum(abs(color))>1e5)repair=1u;
 float luminance=dot(color,vec3(.2126,.7152,.0722));vec3 channel=clamp(luminance+(color-luminance)*saturation,0.,1.);
 vec3 rgb=transparent!=0?(raw>0.?channel:vec3(0.)):channel*level+background*(1.-level);float alpha=transparent!=0?level:1.;
 pixel=floor(clamp(vec4(rgb,alpha),0.,1.)*255.+.5)/255.;facts.w=repair;
}`;
const REDUCTION=HEADER+`
uniform usampler2D values;uniform ivec2 size,reductionOrigin;out uvec4 total;
void main(){ivec2 base=ivec2(gl_FragCoord.xy)*4;uvec4 r=uvec4(0);for(int y=0;y<4;y++)for(int x=0;x<4;x++){ivec2 p=base+ivec2(x,y);if(p.x<size.x&&p.y<size.y){uvec4 v=texelFetch(values,p+reductionOrigin,0);r.x+=v.x;r.y=max(r.y,v.y);r.z|=v.z;r.w|=v.w;}}total=r;}`;
interface Program{program:WebGLProgram;locations:Map<string,WebGLUniformLocation|null>;}
export interface DensityGpuToneResult{pixels:Uint8ClampedArray;occupiedPixels:number;maxCount:number;needsCpu:boolean;}
/** Borrows a session's GL context and ink. Owns only presentation handles;
 * disposal never deletes the borrowed ink or loses its context. */
export class DensityGpuTone {
 private sourceTarget?:{output:WebGLTexture;statistics:WebGLTexture;width:number;height:number;bytes:number};private sourceToneProgram?:Program;private symmetryToneProgram?:Program;private programs:Program[]=[];private textures:WebGLTexture[]=[];private framebuffer?:WebGLFramebuffer;
 constructor(private readonly gl:WebGL2RenderingContext){}
 diagnostics(){return{retainedBytes:(this.textures.length?densityGpuToneBytes()-1024*16-DENSITY_TONE_TILE**2*4:0)+this.sourceTargetBytes(),programs:this.programs.length};}
 private program(vertex:string,fragment:string):Program{
  const gl=this.gl,p=gl.createProgram();require(Boolean(p),'GPU 调色 program 分配失败');const shaders:WebGLShader[]=[];
  try{for(const[type,code]of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]as const){const s=gl.createShader(type);require(Boolean(s),'GPU 调色 shader 分配失败');shaders.push(s!);gl.shaderSource(s!,code);gl.compileShader(s!);require(gl.getShaderParameter(s!,gl.COMPILE_STATUS),'GPU 调色编译失败：'+gl.getShaderInfoLog(s!));gl.attachShader(p!,s!);}gl.linkProgram(p!);require(gl.getProgramParameter(p!,gl.LINK_STATUS),'GPU 调色链接失败：'+gl.getProgramInfoLog(p!));const out={program:p!,locations:new Map<string,WebGLUniformLocation|null>()};this.programs.push(out);return out;}catch(error){gl.deleteProgram(p);throw error;}finally{shaders.forEach(s=>gl.deleteShader(s));}
 }
 private allocateTexture(w:number,h:number,format:number,layout:number,type:number){const gl=this.gl,t=gl.createTexture();require(Boolean(t),'GPU 调色 texture 分配失败');try{gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,format,w,h,0,layout,type,null);return t!;}catch(error){gl.deleteTexture(t);throw error;}}
 private texture(w:number,h:number,format:number,layout:number,type:number){const t=this.allocateTexture(w,h,format,layout,type);this.textures.push(t);return t;}
 sourceTargetBytes():number{return this.sourceTarget?.bytes??0;}
 releaseSourcePresentation():void {const target=this.sourceTarget;if(!target)return;const gl=this.gl;if(this.framebuffer){gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,null,0);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT1,gl.TEXTURE_2D,null,0);gl.bindFramebuffer(gl.FRAMEBUFFER,null);}gl.deleteTexture(target.output);gl.deleteTexture(target.statistics);this.sourceTarget=undefined;}
 private ensureSourceTarget(width:number,height:number){const gl=this.gl,bytes=sourceDensityPresentationBytes(width,height),viewport=gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array,limit=gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  require(width<=limit&&height<=limit&&width<=viewport[0]&&height<=viewport[1],'源密度呈现超过 GPU 纹理或 viewport 尺寸');
  require(bytes+densityGpuToneBytes()+width*height*4<=768*1024*1024,'源密度呈现超过 768 MiB 工作预算');
  if(this.sourceTarget?.width===width&&this.sourceTarget.height===height)return this.sourceTarget;
  // A resize never keeps both full-size generations resident.
  this.releaseSourcePresentation();let output:WebGLTexture|undefined,statistics:WebGLTexture|undefined;
  try{output=this.allocateTexture(width,height,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE);statistics=this.allocateTexture(width,height,gl.RGBA32UI,gl.RGBA_INTEGER,gl.UNSIGNED_INT);require(gl.getError()===gl.NO_ERROR&&!gl.isContextLost(),'源密度完整呈现目标分配失败');return this.sourceTarget={output,statistics,width,height,bytes};}
  catch(error){if(output)gl.deleteTexture(output);if(statistics)gl.deleteTexture(statistics);throw error;}
 }
 private bind(texture:WebGLTexture,unit:number){this.gl.activeTexture(this.gl.TEXTURE0+unit);this.gl.bindTexture(this.gl.TEXTURE_2D,texture);}
 private location(p:Program,name:string){if(!p.locations.has(name))p.locations.set(name,this.gl.getUniformLocation(p.program,name));return p.locations.get(name)!;}
 private f(p:Program,name:string,n:number){this.gl.uniform1f(this.location(p,name),Math.fround(n));}
 private i(p:Program,name:string,n:number){this.gl.uniform1i(this.location(p,name),n);}
 private xy(p:Program,name:string,x:number,y:number){this.gl.uniform2i(this.location(p,name),x,y);}
 private rgb(p:Program,name:string,values:readonly number[]){this.gl.uniform3f(this.location(p,name),Math.fround(values[0]),Math.fround(values[1]),Math.fround(values[2]));}
 private target(texture:WebGLTexture,width:number,height:number,second?:WebGLTexture){const gl=this.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer!);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT1,gl.TEXTURE_2D,second??null,0);gl.drawBuffers(second?[gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]:[gl.COLOR_ATTACHMENT0]);require(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'GPU 调色 framebuffer 不完整');gl.viewport(0,0,width,height);}
 private ensure(){if(this.framebuffer)return;const gl=this.gl;try{require(gl.getParameter(gl.MAX_DRAW_BUFFERS)>=2,'GPU 调色需要两个颜色输出');require(gl.getParameter(gl.MAX_TEXTURE_SIZE)>=1024,'GPU 调色纹理容量不足');this.program(QUAD,FRAGMENT);this.program(QUAD,REDUCTION);this.texture(512,512,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE);this.texture(512,512,gl.RGBA32UI,gl.RGBA_INTEGER,gl.UNSIGNED_INT);this.texture(128,128,gl.RGBA32UI,gl.RGBA_INTEGER,gl.UNSIGNED_INT);this.texture(128,128,gl.RGBA32UI,gl.RGBA_INTEGER,gl.UNSIGNED_INT);this.texture(1024,1,gl.RGBA32F,gl.RGBA,gl.FLOAT);this.texture(DENSITY_TONE_TILE,DENSITY_TONE_TILE,gl.R32UI,gl.RED_INTEGER,gl.UNSIGNED_INT);const f=gl.createFramebuffer();require(Boolean(f),'GPU 调色 framebuffer 分配失败');this.framebuffer=f!;require(gl.getError()===gl.NO_ERROR,'GPU 调色分配失败');}catch(error){this.dispose();throw error;}}
 render(ink:WebGLTexture,width:number,height:number,plan:DensityGpuTonePlan,isCancelled?:()=>boolean,view?:PreparedDensityView):DensityGpuToneResult{
  cancel(isCancelled);require(Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&width<=16384&&height<=16384&&width*height<=33554432,'GPU 调色输出超出 128 MiB');if(view)validateDensityView(view,width,height);this.ensure();if(plan.job.sourcePresentation||plan.job.sourceSymmetryPresentation)return this.renderSource(ink,width,height,plan,isCancelled,view);this.releaseSourcePresentation();if(view&&isCapturedDensityView(view))throw Error('本地调色不接收源密度相机');const gl=this.gl,[output,statistics,reductionA,reductionB,stops,viewIndices]=this.textures,[tone,reduce]=this.programs;
  const job=plan.job,t=job.tone,p=job.palette,pixels=new Uint8ClampedArray(width*height*4),facts=new Uint32Array(4);let occupiedPixels=0,maxBits=0,needsCpu=false;const indices=view?new Uint32Array(DENSITY_TONE_TILE**2):undefined;
  gl.bindVertexArray(null);gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.DITHER);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.pixelStorei(gl.PACK_ALIGNMENT,1);
  this.bind(stops,1);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,plan.stops.length/4,1,gl.RGBA,gl.FLOAT,plan.stops);gl.useProgram(tone.program);this.i(tone,'ink',0);this.i(tone,'stops',1);this.i(tone,'viewIndices',2);this.i(tone,'hasView',view?1:0);this.bind(viewIndices,2);this.xy(tone,'imageSize',width,height);this.i(tone,'stopCount',plan.stops.length/4);this.i(tone,'sourceColor',t.paletteMode==='source'?1:0);this.i(tone,'toneMode',t.toneMap==='log'?1:0);this.i(tone,'transparent',t.transparentBackground?1:0);this.i(tone,'mode',plan.mode);this.i(tone,'hsvStops',plan.hsvStops?1:0);
  this.i(tone,'normalized',job.model==='normalized-v2'?1:job.model==='samila-normalized-v2'?2:0);this.i(tone,'mapProfile',job.model==='normalized-v2'&&job.normalization.kind==='map'?1:0);this.i(tone,'sourceSamilaSplat',densityAcceptsSignedMass(job)?1:0);this.i(tone,'samilaPalette',job.model==='samila-normalized-v2'&&job.branch==='palette-average'?1:0);
  for(const[name,value]of Object.entries({whitePoint:t.dynamicRange,logWhite:job.logWhite,gain:job.gain,inverseGamma:job.inverseGamma,contrast:t.contrast,brightness:t.brightness,saturation:t.saturation,cycles:t.paletteMode==='source'?0:p.cycles,phase:t.paletteMode==='source'?0:p.offset,normalizationScale:job.model!=='white-point-v1'?job.normalization.scale:1}))this.f(tone,name,value);
  this.rgb(tone,'background',job.background);this.rgb(tone,'endpoint',plan.endpoint);this.rgb(tone,'constantColor',plan.constant);for(const key of ['a','b','c','d']as const)this.rgb(tone,'cos'+key.toUpperCase(),plan.cosine[key]);
  try{for(let y=0;y<height;y+=512)for(let x=0;x<width;x+=512){cancel(isCancelled);const w=Math.min(512,width-x),h=Math.min(512,height-y);
    if(view&&indices){
      // Integer addresses avoid discontinuous float32 nearest-texel choices.
      // The shared owner computes each lookup once; no rotated float image.
      for(let row=0;row<h;row++){cancel(isCancelled);for(let column=0;column<w;column++)indices[row*w+column]=samilaSourceIndex(view,x+column,y+row)+1;}
      this.bind(viewIndices,2);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,w,h,gl.RED_INTEGER,gl.UNSIGNED_INT,indices.subarray(0,w*h));
    }
    gl.useProgram(tone.program);this.bind(ink,0);this.bind(stops,1);this.xy(tone,'origin',x,y);this.target(output,w,h,statistics);gl.drawArrays(gl.TRIANGLES,0,3);
    let rw=w,rh=h,source=statistics,side=0;gl.useProgram(reduce.program);this.i(reduce,'values',0);
    do{this.bind(source,0);this.xy(reduce,'size',rw,rh);this.xy(reduce,'reductionOrigin',0,0);rw=Math.ceil(rw/4);rh=Math.ceil(rh/4);source=side===0?reductionA:reductionB;this.target(source,rw,rh);gl.drawArrays(gl.TRIANGLES,0,3);side=1-side;}while(rw>1||rh>1);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.readPixels(0,0,1,1,gl.RGBA_INTEGER,gl.UNSIGNED_INT,facts);require(facts[2]===0,'GPU 密度累积包含非有限或负权重');occupiedPixels+=facts[0];maxBits=Math.max(maxBits,facts[1]);needsCpu ||= facts[3]!==0;
    this.target(output,w,h);gl.pixelStorei(gl.PACK_ROW_LENGTH,width);gl.pixelStorei(gl.PACK_SKIP_PIXELS,x);gl.pixelStorei(gl.PACK_SKIP_ROWS,y);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);gl.pixelStorei(gl.PACK_ROW_LENGTH,0);gl.pixelStorei(gl.PACK_SKIP_PIXELS,0);gl.pixelStorei(gl.PACK_SKIP_ROWS,0);require(gl.getError()===gl.NO_ERROR&&!gl.isContextLost(),'GPU 密度调色或回读失败');
   }cancel(isCancelled);return{pixels,occupiedPixels,maxCount:new Float32Array(new Uint32Array([maxBits]).buffer)[0],needsCpu};
  }finally{gl.pixelStorei(gl.PACK_ROW_LENGTH,0);gl.pixelStorei(gl.PACK_SKIP_PIXELS,0);gl.pixelStorei(gl.PACK_SKIP_ROWS,0);gl.bindFramebuffer(gl.FRAMEBUFFER,null);}
 }
 private renderSource(ink:WebGLTexture,width:number,height:number,plan:DensityGpuTonePlan,isCancelled?:()=>boolean,view?:PreparedDensityView):DensityGpuToneResult {
  const gl=this.gl,job=plan.job,symmetry=Boolean(job.sourceSymmetryPresentation);if(job.model==='white-point-v1'||(symmetry?job.model!=='normalized-v2':job.model!=='samila-normalized-v2'))throw Error('源密度呈现调色类型无效');
  if(symmetry){require(Boolean(gl.getExtension('OES_texture_float_linear')),'源 Symmetry 呈现需要浮点线性采样');if(view&&(!isCapturedDensityView(view)||view.family!=='symmetry'))throw Error('源 Symmetry 呈现相机类型不匹配');}else if(view&&isCapturedDensityView(view))throw Error('源密度呈现相机类型不匹配');
  const transform=symmetry?{delta:view&&isCapturedDensityView(view)?view.rotation:0,aspect:Math.fround(width/height)}:sourceSamilaDisplayTransform(view&&!isCapturedDensityView(view)?view:undefined,width,height),{output,statistics}=this.ensureSourceTarget(width,height),[,,reductionA,reductionB]=this.textures,reduce=this.programs[1];
  const vertex=HEADER+'out vec2 texCoord;void main(){float x=float((gl_VertexID&1)<<1)-1.;float y=float(gl_VertexID&2)-1.;gl_Position=vec4(x,y,0.,1.);texCoord=vec2((x+1.)*.5,(y+1.)*.5);}';
  const tone=symmetry?(this.symmetryToneProgram??(this.symmetryToneProgram=this.program(vertex,HEADER+SOURCE_SYMMETRY_PRESENT_GLSL))):(this.sourceToneProgram??(this.sourceToneProgram=this.program(vertex,HEADER+SOURCE_SAMILA_PRESENT_GLSL)));
  const pixels=new Uint8ClampedArray(width*height*4),scratch=new Uint8Array(DENSITY_TONE_TILE**2*4),facts=new Uint32Array(4);let occupiedPixels=0,maxBits=0;
  gl.bindVertexArray(null);gl.disable(gl.DEPTH_TEST);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.DITHER);gl.pixelStorei(gl.PACK_ALIGNMENT,1);gl.pixelStorei(gl.PACK_ROW_LENGTH,0);gl.pixelStorei(gl.PACK_SKIP_PIXELS,0);gl.pixelStorei(gl.PACK_SKIP_ROWS,0);
  gl.useProgram(tone.program);this.i(tone,'ink',0);this.i(tone,'usePaletteLUT',job.model==='samila-normalized-v2'&&job.branch==='palette-average'?1:0);this.rgb(tone,'backgroundRgb',job.background);
  for(const[name,value]of Object.entries({displayRotation:transform.delta,viewportAspect:transform.aspect,brightness:symmetry?sourceIteratedBrightnessUniform(job.tone.brightness):job.tone.brightness,contrast:job.tone.contrast,gamma:job.tone.gamma,dynamicRange:job.tone.dynamicRange,saturation:job.tone.saturation,scale:job.normalization.scale}))this.f(tone,name,value);
  this.bind(ink,0);const oldMin=gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER),oldMag=gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER);
  try {
   if(symmetry)for(const name of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,name,gl.LINEAR);
   cancel(isCancelled);gl.useProgram(tone.program);this.bind(ink,0);this.xy(tone,'origin',0,0);this.target(output,width,height,statistics);gl.clearBufferfv(gl.COLOR,0,new Float32Array(symmetry?[...job.background,1]:[0,0,0,0]));gl.clearBufferuiv(gl.COLOR,1,new Uint32Array(4));
   // Preserve the source's complete viewport and four-vertex strip. Offsetting
   // a viewport changes varying rounding at NEAREST boundaries, even when the
   // same shader is used. Only the subsequent integer reduction/readback tiles.
   gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);gl.disable(gl.BLEND);
   for(let y=0;y<height;y+=DENSITY_TONE_TILE)for(let x=0;x<width;x+=DENSITY_TONE_TILE){
   cancel(isCancelled);const w=Math.min(DENSITY_TONE_TILE,width-x),h=Math.min(DENSITY_TONE_TILE,height-y),bottom=height-y-h;
   // Integer MRT facts are not blended. Validate all owned source texels, even
   // those outside the rotated view; undefined source arithmetic is an error.
   let rw=w,rh=h,source=statistics,side=0;gl.useProgram(reduce.program);this.i(reduce,'values',0);
   do{this.bind(source,0);this.xy(reduce,'size',rw,rh);this.xy(reduce,'reductionOrigin',source===statistics?x:0,source===statistics?bottom:0);rw=Math.ceil(rw/4);rh=Math.ceil(rh/4);source=side===0?reductionA:reductionB;this.target(source,rw,rh);gl.drawArrays(gl.TRIANGLES,0,3);side=1-side;}while(rw>1||rh>1);
   gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.readPixels(0,0,1,1,gl.RGBA_INTEGER,gl.UNSIGNED_INT,facts);require(facts[2]===0,'源密度呈现包含非有限源值或 GPU 算术结果；未启用数值修复');occupiedPixels+=facts[0];maxBits=Math.max(maxBits,facts[1]);
   this.target(output,width,height);gl.readPixels(x,bottom,w,h,gl.RGBA,gl.UNSIGNED_BYTE,scratch);for(let row=0;row<h;row++)pixels.set(scratch.subarray(row*w*4,(row+1)*w*4),((y+h-1-row)*width+x)*4);
   require(gl.getError()===gl.NO_ERROR&&!gl.isContextLost(),'源密度 GPU 呈现或回读失败');
  }cancel(isCancelled);return{pixels,occupiedPixels,maxCount:new Float32Array(new Uint32Array([maxBits]).buffer)[0],needsCpu:false};
  }finally{this.bind(ink,0);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,oldMin);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,oldMag);gl.disable(gl.BLEND);gl.pixelStorei(gl.PACK_ROW_LENGTH,0);gl.pixelStorei(gl.PACK_SKIP_PIXELS,0);gl.pixelStorei(gl.PACK_SKIP_ROWS,0);gl.bindFramebuffer(gl.FRAMEBUFFER,null);}
 }
 dispose(){this.releaseSourcePresentation();for(const t of this.textures)this.gl.deleteTexture(t);for(const p of this.programs)this.gl.deleteProgram(p.program);if(this.framebuffer)this.gl.deleteFramebuffer(this.framebuffer);this.textures=[];this.programs=[];this.sourceToneProgram=undefined;this.symmetryToneProgram=undefined;this.framebuffer=undefined;}
}
