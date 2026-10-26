import {parseSourceAttractorConfiguration,type SourceAttractorConfiguration} from './sourceAttractorConfig';
import {parseSourceAttractorVisualConfiguration,prepareSourceAttractorInitialColors,type SourceAttractorVisualConfiguration} from './sourceAttractorVisualConfig';
import {createSourceAttractorSeedStream} from './sourceAttractorSeeds';
import type {SourceAttractorGpuFunction} from './sourceAttractorGpuFunction';
import type {SourceCameraPlan} from './sourceCamera';
import {MAX_RASTER_PIXELS} from './rasterDimensions';
import type {RasterOutput} from '../types';

const F=Math.fround;
/** Local admission limits, never source clamps or quality reductions. The byte
 * bound includes uploads, attachments, debug state readback and final pixels;
 * it excludes driver/context overhead. Node work is a proxy, not GPU time. */
export const SOURCE_ATTRACTOR_GPU_LIMITS={bytes:256*1024*1024,drawNodeWork:1_000_000_000,replayNodeWork:64_000_000_000,passes:10000} as const;
export class SourceAttractorGpuError extends Error {
 constructor(readonly code:'input'|'capacity'|'capability'|'context'|'shader'|'render'|'cancelled'|'disposed',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourceAttractorGpuError';}
}
export interface SourceAttractorGpuOptions {
 readonly configuration:SourceAttractorConfiguration;readonly visualConfiguration:SourceAttractorVisualConfiguration;
 readonly shader:SourceAttractorGpuFunction;readonly isCancelled?:()=>boolean;readonly retainedBytes?:()=>number;
}
export interface SourceAttractorGpuDisplay {
 readonly width:number;readonly height:number;readonly cameraPlan:SourceCameraPlan;readonly backgroundColor:number;
}
export function sourceAttractorGpuLayout(count:number){
 if(!Number.isInteger(count)||count<1||count>2147483647)throw new SourceAttractorGpuError('input','源 GPU 吸引子需要正整数粒子数；不替换为 CPU');
 const size=Math.ceil(Math.sqrt(count)),texels=size*size;
 // State attachments (32), initialization upload (16), optional diagnostic
 // readback (16) per texel; UV/color CPU uploads and GPU VBOs (48) per particle.
 const bytes=texels*64+count*48;
 if(bytes>SOURCE_ATTRACTOR_GPU_LIMITS.bytes)throw new SourceAttractorGpuError('capacity','源 GPU 吸引子粒子表示超过本地 256 MiB 预算');
 return{count,size,texels,bytes};
}
export function sourceAttractorGpuDisplayLayout(width:number,height:number){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>16384||height>16384||width*height>MAX_RASTER_PIXELS)throw new SourceAttractorGpuError('capacity','源 GPU 吸引子画布超出本地图像容量');
 const scale=F(Math.max(1,Math.min(F(1.5),F(F(4096)/F(Math.max(width,height)))))),accumWidth=Math.ceil(F(F(width)*scale)),accumHeight=Math.ceil(F(F(height)*scale));
 return{width,height,scale,accumWidth,accumHeight,bytes:accumWidth*accumHeight*16+width*height*8+width*4};
}
/** Bound both arithmetic and driver submissions before context allocation.
 * A tiny particle count with int-max warmup must not execute millions of
 * otherwise cheap passes before eventually exhausting the arithmetic budget. */
export function prepareSourceAttractorGpuWork(configuration:SourceAttractorConfiguration,operations:number,updates:number){
 const {texels}=sourceAttractorGpuLayout(configuration.particleCountGPU),maximum=Math.max(0,configuration.warmup.staggerMax);
 const warmup=Math.max(0,(configuration.warmup.steps+maximum)|0),warmupPasses=Math.ceil(warmup/100),normal=Math.max(0,configuration.stepsPerFrame),perStep=texels*(operations*4+40);
 const work=perStep*(warmup+normal*updates),passes=warmupPasses+updates;
 if(!Number.isSafeInteger(updates)||updates<0||!Number.isSafeInteger(work)||passes>SOURCE_ATTRACTOR_GPU_LIMITS.passes||work>SOURCE_ATTRACTOR_GPU_LIMITS.replayNodeWork||perStep*Math.min(100,warmup)>SOURCE_ATTRACTOR_GPU_LIMITS.drawNodeWork||updates>0&&perStep*normal>SOURCE_ATTRACTOR_GPU_LIMITS.drawNodeWork)throw new SourceAttractorGpuError('capacity','源 GPU 吸引子预热或回放超过本地工作量与绘制次数预算；不减少作者配置');
 return{work,passes,warmup,warmupPasses};
}

export type SourceAttractorGpuRaster={width:number;height:number;pixels:Uint8ClampedArray;sourcePixelRenderer?:RasterOutput['sourcePixelRenderer']};
export interface SourceAttractorGpuDiagnostics {
 contextOwned:boolean;handles:number;initialized:boolean;disposed:boolean;failed:boolean;
 texSize:number;particleCount:number;updatePasses:number;warmupPasses:number;rendered:number;nodeWork:number;readbackBytes:number;estimatedBytes:number;
 cleanupPending?:boolean;
}
export interface SourceAttractorGpuAsyncBackend {
 readonly layout:ReturnType<typeof sourceAttractorGpuLayout>;
 initialize():Promise<void>;advance():Promise<void>;render(options:SourceAttractorGpuDisplay):Promise<SourceAttractorGpuRaster>;
 dispose():Promise<void>;diagnostics():SourceAttractorGpuDiagnostics;
}
export type SourceAttractorGpuAsyncFactory=(options:SourceAttractorGpuOptions)=>SourceAttractorGpuAsyncBackend;

/** Normalize configuration once, before any allocation. Both engines consume
 * the same parsed facts, with no backend-specific source reinterpretation. */
export function prepareSourceAttractorGpuOptions(options:SourceAttractorGpuOptions){
 const c=parseSourceAttractorConfiguration(options.configuration),v=parseSourceAttractorVisualConfiguration(options.visualConfiguration);
 if(!c.ok||!v.ok)throw new SourceAttractorGpuError('input','源 GPU 吸引子配置未通过解析');
 if(c.value.nativeBackend!=='gpu')throw new SourceAttractorGpuError('input','源 GPU 吸引子不能接受 CPU 后端');
 if(!options.shader||typeof options.shader.code!=='string'||!Number.isSafeInteger(options.shader.operations)||options.shader.operations<1)throw new SourceAttractorGpuError('input','缺少已准备的源 GPU 导数函数');
 const layout=sourceAttractorGpuLayout(c.value.particleCountGPU);prepareSourceAttractorGpuWork(c.value,options.shader.operations,0);
 return{configuration:c.value,visualConfiguration:v.value,shader:{...options.shader,parameterNames:[...options.shader.parameterNames]},layout};
}
export type SourceAttractorGpuPrepared=ReturnType<typeof prepareSourceAttractorGpuOptions>;

/** The complete canonical stream including square-texture zero padding. This
 * is shared upload data, never a native-side reimplementation of the RNG. */
export function createSourceAttractorGpuInitialSource(prepared:SourceAttractorGpuPrepared,check:()=>void=()=>{}){
 const {configuration,visualConfiguration,layout}=prepared;
 const stream=createSourceAttractorSeedStream(configuration);if(!stream.ok)throw new SourceAttractorGpuError('input',stream.error.reason);
 const colors=prepareSourceAttractorInitialColors(visualConfiguration.palette,layout.count);if(!colors.ok)throw new SourceAttractorGpuError('input',colors.error.reason);
 const inv=F(1/layout.size),half=F(inv*F(.5));let cursor=0;
 const fill=(texels:number,data:Float32Array,uv:Float32Array,rgba:Float32Array)=>{
  if(!Number.isSafeInteger(texels)||texels<1||cursor+texels>layout.texels)throw new SourceAttractorGpuError('input','源 GPU 初始化分块超出方形状态');
  const real=Math.min(texels,Math.max(0,layout.count-cursor));
  if(data.length!==texels*4||uv.length!==real*2||rgba.length!==real*4)throw new SourceAttractorGpuError('input','源 GPU 初始化分块表示不匹配');
  const offset=cursor;
  for(let local=0;local<real;local++){
   const i=offset+local;if((i&255)===0)check();const next=stream.value.next();if(!next.ok||!next.value)throw new SourceAttractorGpuError('input',next.ok?'源粒子初始化提前结束':next.error.reason);
   data.set(next.value.raw,local*4);data[local*4+3]=next.value.dt;uv[local*2]=F(F((i%layout.size)*inv)+half);uv[local*2+1]=F(F(Math.floor(i/layout.size)*inv)+half);
   const c=colors.value.colorAt(i);if(!c.ok)throw new SourceAttractorGpuError('input',c.error.reason);const packed=c.value;
   rgba[local*4]=F((packed>>>16&255)/255);rgba[local*4+1]=F((packed>>>8&255)/255);rgba[local*4+2]=F((packed&255)/255);rgba[local*4+3]=F((packed>>>24)/255);
  }
  data.fill(0,real*4);cursor+=texels;return{offset,positions:data,texIndex:uv,colors:rgba};
 };
 return{get cursor(){return cursor;},fill,next(texels:number){
  if(!Number.isSafeInteger(texels)||texels<1||cursor+texels>layout.texels)throw new SourceAttractorGpuError('input','源 GPU 初始化分块超出方形状态');
  const real=Math.min(texels,Math.max(0,layout.count-cursor));return fill(texels,new Float32Array(texels*4),new Float32Array(real*2),new Float32Array(real*4));
 }};
}
export function prepareSourceAttractorGpuInitialData(prepared:SourceAttractorGpuPrepared,check:()=>void=()=>{}){
 const {layout}=prepared,data=new Float32Array(layout.texels*4),uv=new Float32Array(layout.count*2),rgba=new Float32Array(layout.count*4);
 createSourceAttractorGpuInitialSource(prepared,check).fill(layout.texels,data,uv,rgba);return{data,uv,rgba};
}
export interface SourceAttractorGpuPass {readonly steps:number;readonly warmup:boolean;readonly warmupBase:number;readonly currentStepBase:number;readonly staggerMin:number;readonly staggerRange:number;}
export function* sourceAttractorGpuWarmupPasses(configuration:SourceAttractorConfiguration):Generator<SourceAttractorGpuPass>{
 const w=configuration.warmup,max=Math.max(0,w.staggerMax),min=Math.min(max,Math.max(0,w.staggerMin)),total=(w.steps+max)|0;
 for(let base=0;base<total;){const steps=Math.min(100,total-base);yield{steps,warmup:true,warmupBase:w.steps,currentStepBase:base,staggerMin:min,staggerRange:max-min};base+=steps;}
}
export function sourceAttractorGpuNormalPass(configuration:SourceAttractorConfiguration):SourceAttractorGpuPass{return{steps:configuration.stepsPerFrame,warmup:false,warmupBase:configuration.warmup.steps,currentStepBase:0,staggerMin:0,staggerRange:0};}
export function sourceAttractorGpuPassUniforms(pass:SourceAttractorGpuPass){return[['posTex',0],['steps',pass.steps],['isWarmup',pass.warmup?1:0],['warmupBase',pass.warmupBase],['staggerMin',pass.staggerMin],['staggerRange',pass.staggerRange],['currentStepBase',pass.currentStepBase]] as const;}
export function prepareSourceAttractorGpuDisplay(prepared:SourceAttractorGpuPrepared,options:SourceAttractorGpuDisplay){
 const {layout,configuration,visualConfiguration}=prepared,d=sourceAttractorGpuDisplayLayout(options.width,options.height);
 if(!Number.isInteger(options.backgroundColor)||options.backgroundColor<0||options.backgroundColor>0xffffffff)throw new SourceAttractorGpuError('input','源 GPU 背景需要 uint32 ARGB');
 const radius=F(Math.max(1,F(F(visualConfiguration.points.dotRadius)*Math.max(F(options.cameraPlan.displayScale),0)))*d.scale),c=configuration.transform,tone=visualConfiguration.gpuTone,background=options.backgroundColor;
 return{layout:d,radius,scale:[F(c.scaleX),F(c.scaleY),F(c.scaleZ)] as const,offset:[F(c.offsetX),F(c.offsetY),F(c.offsetZ)] as const,
  projection:options.cameraPlan.projection.columnMajor,modelview:options.cameraPlan.modelView.columnMajor,
  backgroundRgb:[F((background>>>16&255)/255),F((background>>>8&255)/255),F((background&255)/255)] as const,
  exposure:tone.exposure,contrast:tone.contrast,gamma:tone.gamma,saturation:tone.saturation,
  densityScale:F(Math.max(F(.08),F(F(F(layout.count)/Math.max(1,F(F(d.accumWidth)*F(d.accumHeight))))*F(.45)))*F(tone.densityScale))};
}
