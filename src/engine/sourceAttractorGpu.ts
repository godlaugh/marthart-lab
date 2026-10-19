import {parseSourceAttractorConfiguration,type SourceAttractorConfiguration} from './sourceAttractorConfig';
import {parseSourceAttractorVisualConfiguration,prepareSourceAttractorInitialColors,type SourceAttractorVisualConfiguration} from './sourceAttractorVisualConfig';
import {createSourceAttractorSeedStream} from './sourceAttractorSeeds';
import type {SourceAttractorGpuFunction} from './sourceAttractorGpuFunction';
import type {SourceCameraPlan} from './sourceCamera';
import {sourceAttractorQuad,sourceAttractorUpdate,sourceAttractorAccumulateVertex,sourceAttractorAccumulateFragment,sourceAttractorPresent} from './sourceAttractorGpuShaders';
import {MAX_RASTER_PIXELS} from './rasterDimensions';

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
 readonly shader:SourceAttractorGpuFunction;readonly isCancelled?:()=>boolean;
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
type Program={program:WebGLProgram;locations:Map<string,WebGLUniformLocation|null>};
type Target={texture:WebGLTexture;framebuffer:WebGLFramebuffer;width:number;height:number};

/** One native-style object lifetime. Raw XYZW state remains on this context;
 * only render() publishes pixels. readState() is an explicit diagnostic.
 * Failures are terminal until disposal, with no CPU/half-float fallback. */
export class SourceAttractorGpu {
 readonly configuration:SourceAttractorConfiguration;readonly visualConfiguration:SourceAttractorVisualConfiguration;
 readonly layout:ReturnType<typeof sourceAttractorGpuLayout>;
 private readonly shader:SourceAttractorGpuFunction;private readonly isCancelled?:()=>boolean;
 private gl?:WebGL2RenderingContext;private initialized=false;private disposed=false;private failure:unknown;private failed=false;
 private readonly releases=new Map<object,()=>void>();
 private updateProgram?:Program;private accumulateProgram?:Program;private presentProgram?:Program;
 private state:Target[]=[];private current=0;private emptyVao?:WebGLVertexArrayObject;private pointVao?:WebGLVertexArrayObject;
 private accumulation?:Target;private output?:Target;
 private work=0;private updatePasses=0;private warmupPasses=0;private rendered=0;private readbackBytes=0;
 constructor(options:SourceAttractorGpuOptions){
  const c=parseSourceAttractorConfiguration(options.configuration),v=parseSourceAttractorVisualConfiguration(options.visualConfiguration);
  if(!c.ok||!v.ok)throw new SourceAttractorGpuError('input','源 GPU 吸引子配置未通过解析');
  if(c.value.nativeBackend!=='gpu')throw new SourceAttractorGpuError('input','源 GPU 吸引子不能接受 CPU 后端');
  if(!options.shader||typeof options.shader.code!=='string'||!Number.isSafeInteger(options.shader.operations)||options.shader.operations<1)throw new SourceAttractorGpuError('input','缺少已准备的源 GPU 导数函数');
  this.configuration=c.value;this.visualConfiguration=v.value;this.shader={...options.shader};this.isCancelled=options.isCancelled;
  this.layout=sourceAttractorGpuLayout(c.value.particleCountGPU);
  prepareSourceAttractorGpuWork(this.configuration,this.shader.operations,0);
 }
 diagnostics(){return{contextOwned:!!this.gl,handles:this.releases.size,initialized:this.initialized,disposed:this.disposed,failed:this.failed,
  texSize:this.layout.size,particleCount:this.layout.count,updatePasses:this.updatePasses,warmupPasses:this.warmupPasses,rendered:this.rendered,nodeWork:this.work,readbackBytes:this.readbackBytes,
  estimatedBytes:this.layout.bytes+(this.output?sourceAttractorGpuDisplayLayout(this.output.width,this.output.height).bytes:0)};}
 private check(){if(this.disposed)throw new SourceAttractorGpuError('disposed','源 GPU 吸引子对象已释放');if(this.failed)throw this.failure;if(this.isCancelled?.())throw new SourceAttractorGpuError('cancelled','源 GPU 吸引子已取消');if(this.gl?.isContextLost())throw new SourceAttractorGpuError('context','源 GPU 吸引子上下文丢失');}
 private guarded<T>(run:()=>T):T{try{this.check();return run();}catch(error){this.failed=true;this.failure=error;throw error;}}
 private checkGl(){this.check();const error=this.gl!.getError();if(error!==this.gl!.NO_ERROR)throw new SourceAttractorGpuError('render',`源 GPU 吸引子执行失败 (${error})`);}
 private own<T extends object>(handle:T|null,release:(handle:T)=>void):T{if(!handle)throw new SourceAttractorGpuError('capacity','源 GPU 吸引子设备资源分配失败');this.releases.set(handle,()=>release(handle));return handle;}
 private release(handle:object){const cleanup=this.releases.get(handle);if(cleanup){cleanup();this.releases.delete(handle);}}
 private program(vertex:string,fragment:string):Program{
  const gl=this.gl!,p=this.own(gl.createProgram(),x=>gl.deleteProgram(x));
  for(const [type,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]] as const){
   const s=this.own(gl.createShader(type),x=>gl.deleteShader(x));gl.shaderSource(s,source);gl.compileShader(s);
   if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new SourceAttractorGpuError('shader','源 GPU 吸引子着色器编译失败：'+gl.getShaderInfoLog(s));gl.attachShader(p,s);
   // Attached shaders remain alive until linking/program deletion, even after delete.
   this.release(s);
  }
  gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new SourceAttractorGpuError('shader','源 GPU 吸引子程序链接失败：'+gl.getProgramInfoLog(p));
  return{program:p,locations:new Map()};
 }
 private location(p:Program,name:string){if(!p.locations.has(name))p.locations.set(name,this.gl!.getUniformLocation(p.program,name));return p.locations.get(name)!;}
 private target(width:number,height:number,floating:boolean,linear=false,data:Float32Array|null=null):Target{
  const gl=this.gl!,texture=this.own(gl.createTexture(),x=>gl.deleteTexture(x));gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,linear?gl.LINEAR:gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,linear?gl.LINEAR:gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,floating?gl.RGBA32F:gl.RGBA8,width,height,0,gl.RGBA,floating?gl.FLOAT:gl.UNSIGNED_BYTE,data);
  const framebuffer=this.own(gl.createFramebuffer(),x=>gl.deleteFramebuffer(x));gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new SourceAttractorGpuError('capability','源 GPU 吸引子 framebuffer 不完整；不降级精度');this.checkGl();return{texture,framebuffer,width,height};
 }
 private retire(target:Target|undefined){if(target){this.release(target.framebuffer);this.release(target.texture);}}
 private admitWork(steps:number){
  const work=this.layout.texels*Math.max(0,steps)*(this.shader.operations*4+40);
  if(!Number.isSafeInteger(work)||work>SOURCE_ATTRACTOR_GPU_LIMITS.drawNodeWork||this.work+work>SOURCE_ATTRACTOR_GPU_LIMITS.replayNodeWork||this.updatePasses+this.warmupPasses>=SOURCE_ATTRACTOR_GPU_LIMITS.passes)throw new SourceAttractorGpuError('capacity','源 GPU 吸引子 RK4 工作量超过本地单次绘制或回放预算；不减少粒子和步数');
  this.work+=work;
 }
 initialize():void{this.guarded(()=>{
  if(this.initialized)return;
  if(typeof OffscreenCanvas==='undefined')throw new SourceAttractorGpuError('context','OffscreenCanvas 不可用');
  const gl=new OffscreenCanvas(1,1).getContext('webgl2',{alpha:true,antialias:false,depth:false,premultipliedAlpha:false,preserveDrawingBuffer:false});
  if(!gl)throw new SourceAttractorGpuError('context','WebGL2 不可用');this.gl=gl;
  for(const extension of ['EXT_color_buffer_float','EXT_float_blend','OES_texture_float_linear'])if(!gl.getExtension(extension))throw new SourceAttractorGpuError('capability',`源 GPU 吸引子需要 ${extension}`);
  const maxTexture=gl.getParameter(gl.MAX_TEXTURE_SIZE),maxViewport=gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  if(this.layout.size>maxTexture||this.layout.size>Math.min(...maxViewport))throw new SourceAttractorGpuError('capability','源 GPU 吸引子状态纹理超过设备容量');
  gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);gl.disable(gl.DITHER);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.CULL_FACE);gl.colorMask(true,true,true,true);gl.pixelStorei(gl.PACK_ALIGNMENT,1);gl.activeTexture(gl.TEXTURE0);
  this.emptyVao=this.own(gl.createVertexArray(),x=>gl.deleteVertexArray(x));gl.bindVertexArray(this.emptyVao);
  this.updateProgram=this.program(sourceAttractorQuad,sourceAttractorUpdate.replace('// %ATTRACTOR_FUNCTION_BODY%',this.shader.code));
  this.accumulateProgram=this.program(sourceAttractorAccumulateVertex,sourceAttractorAccumulateFragment);this.presentProgram=this.program(sourceAttractorQuad,sourceAttractorPresent);
  const stream=createSourceAttractorSeedStream(this.configuration);if(!stream.ok)throw new SourceAttractorGpuError('input',stream.error.reason);
  const colors=prepareSourceAttractorInitialColors(this.visualConfiguration.palette,this.layout.count);if(!colors.ok)throw new SourceAttractorGpuError('input',colors.error.reason);
  const data=new Float32Array(this.layout.texels*4),uv=new Float32Array(this.layout.count*2),rgba=new Float32Array(this.layout.count*4),inv=F(1/this.layout.size),half=F(inv*F(.5));
  for(let i=0;i<this.layout.count;i++){
   if((i&255)===0)this.check();const next=stream.value.next();if(!next.ok||!next.value)throw new SourceAttractorGpuError('input',next.ok?'源粒子初始化提前结束':next.error.reason);
   data.set(next.value.raw,i*4);data[i*4+3]=next.value.dt;uv[i*2]=F(F((i%this.layout.size)*inv)+half);uv[i*2+1]=F(F(Math.floor(i/this.layout.size)*inv)+half);
   const c=colors.value.colorAt(i);if(!c.ok)throw new SourceAttractorGpuError('input',c.error.reason);const packed=c.value;
   rgba[i*4]=F((packed>>>16&255)/255);rgba[i*4+1]=F((packed>>>8&255)/255);rgba[i*4+2]=F((packed&255)/255);rgba[i*4+3]=F((packed>>>24)/255);
  }
  this.state=[this.target(this.layout.size,this.layout.size,true,false,data),this.target(this.layout.size,this.layout.size,true)];
  const warmup=this.configuration.warmup,max=Math.max(0,warmup.staggerMax),min=Math.min(max,Math.max(0,warmup.staggerMin)),total=(warmup.steps+max)|0;
  for(let base=0;base<total;){const steps=Math.min(100,total-base);this.pass(steps,true,base,min,max-min);base+=steps;}
  this.pointVao=this.own(gl.createVertexArray(),x=>gl.deleteVertexArray(x));gl.bindVertexArray(this.pointVao);
  for(const [name,values,size] of [['texIndex',uv,2],['color',rgba,4]] as const){const b=this.own(gl.createBuffer(),x=>gl.deleteBuffer(x));gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,values,gl.STATIC_DRAW);const location=gl.getAttribLocation(this.accumulateProgram.program,name);if(location<0)throw new SourceAttractorGpuError('shader','源 GPU 粒子属性缺失：'+name);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,0,0);}
  gl.bindBuffer(gl.ARRAY_BUFFER,null);gl.bindVertexArray(null);this.checkGl();this.initialized=true;
 });}
 private pass(steps:number,warmup:boolean,base=0,min=0,range=0){
  this.check();this.admitWork(steps);const gl=this.gl!,p=this.updateProgram!,next=1-this.current;
  gl.disable(gl.BLEND);gl.useProgram(p.program);gl.bindVertexArray(this.emptyVao!);gl.bindFramebuffer(gl.FRAMEBUFFER,this.state[next].framebuffer);gl.viewport(0,0,this.layout.size,this.layout.size);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.state[this.current].texture);
  for(const [name,value] of [['posTex',0],['steps',steps],['isWarmup',warmup?1:0],['warmupBase',this.configuration.warmup.steps],['staggerMin',min],['staggerRange',range],['currentStepBase',base]] as const)gl.uniform1i(this.location(p,name),value);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);this.checkGl();this.current=next;if(warmup)this.warmupPasses++;else this.updatePasses++;
 }
 advance():void{this.guarded(()=>{this.initialize();this.pass(this.configuration.stepsPerFrame,false);});}
 readState():Float32Array{return this.guarded(()=>{this.initialize();const gl=this.gl!,result=new Float32Array(this.layout.texels*4);gl.bindFramebuffer(gl.FRAMEBUFFER,this.state[this.current].framebuffer);gl.readPixels(0,0,this.layout.size,this.layout.size,gl.RGBA,gl.FLOAT,result);this.checkGl();this.readbackBytes+=result.byteLength;return result;});}
 render(options:SourceAttractorGpuDisplay):{width:number;height:number;pixels:Uint8ClampedArray}{return this.guarded(()=>{
  const d=sourceAttractorGpuDisplayLayout(options.width,options.height);
  if(this.layout.bytes+d.bytes>SOURCE_ATTRACTOR_GPU_LIMITS.bytes)throw new SourceAttractorGpuError('capacity','源 GPU 吸引子附件与上传表示合计超过本地 256 MiB 预算');
  if(!Number.isInteger(options.backgroundColor)||options.backgroundColor<0||options.backgroundColor>0xffffffff)throw new SourceAttractorGpuError('input','源 GPU 背景需要 uint32 ARGB');
  this.initialize();const gl=this.gl!,limit=gl.getParameter(gl.MAX_TEXTURE_SIZE),viewport=gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  if(Math.max(d.accumWidth,d.accumHeight)>limit||d.accumWidth>viewport[0]||d.accumHeight>viewport[1])throw new SourceAttractorGpuError('capability','源 GPU 密度附件超过设备容量');
  const radius=F(Math.max(1,F(F(this.visualConfiguration.points.dotRadius)*Math.max(F(options.cameraPlan.displayScale),0)))*d.scale),range=gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array;
  if(!Number.isFinite(radius)||radius>range[1])throw new SourceAttractorGpuError('capability','源 GPU 点直径超过设备容量；不静默截断');
  if(!this.output||this.output.width!==d.width||this.output.height!==d.height){
   this.retire(this.accumulation);this.retire(this.output);this.accumulation=undefined;this.output=undefined;
   this.accumulation=this.target(d.accumWidth,d.accumHeight,true,true);this.output=this.target(d.width,d.height,false);
  }
  const p=this.accumulateProgram!,c=this.configuration.transform;gl.bindFramebuffer(gl.FRAMEBUFFER,this.accumulation!.framebuffer);gl.viewport(0,0,d.accumWidth,d.accumHeight);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.ONE,gl.ONE);gl.useProgram(p.program);gl.bindVertexArray(this.pointVao!);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.state[this.current].texture);
  gl.uniform1i(this.location(p,'posTex'),0);gl.uniform1f(this.location(p,'radius'),radius);gl.uniform3f(this.location(p,'scale'),F(c.scaleX),F(c.scaleY),F(c.scaleZ));gl.uniform3f(this.location(p,'offset'),F(c.offsetX),F(c.offsetY),F(c.offsetZ));gl.uniformMatrix4fv(this.location(p,'projection'),false,options.cameraPlan.projection.columnMajor);gl.uniformMatrix4fv(this.location(p,'modelview'),false,options.cameraPlan.modelView.columnMajor);
  gl.drawArrays(gl.POINTS,0,this.layout.count);this.checkGl();
  const tone=this.visualConfiguration.gpuTone,q=this.presentProgram!,background=options.backgroundColor;
  gl.disable(gl.BLEND);gl.bindFramebuffer(gl.FRAMEBUFFER,this.output!.framebuffer);gl.viewport(0,0,d.width,d.height);gl.useProgram(q.program);gl.bindVertexArray(this.emptyVao!);gl.bindTexture(gl.TEXTURE_2D,this.accumulation!.texture);gl.uniform1i(this.location(q,'accumTex'),0);gl.uniform3f(this.location(q,'backgroundRgb'),F((background>>>16&255)/255),F((background>>>8&255)/255),F((background&255)/255));
  for(const name of ['exposure','contrast','gamma','saturation'] as const)gl.uniform1f(this.location(q,name),tone[name]);
  gl.uniform1f(this.location(q,'densityScale'),F(Math.max(F(.08),F(F(F(this.layout.count)/Math.max(1,F(F(d.accumWidth)*F(d.accumHeight))))*F(.45)))*F(tone.densityScale)));
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);this.checkGl();const pixels=new Uint8ClampedArray(d.width*d.height*4);gl.readPixels(0,0,d.width,d.height,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(pixels.buffer));this.checkGl();
  const stride=d.width*4,row=new Uint8ClampedArray(stride);for(let y=0;y<Math.floor(d.height/2);y++){const top=y*stride,bottom=(d.height-1-y)*stride;row.set(pixels.subarray(top,top+stride));pixels.copyWithin(top,bottom,bottom+stride);pixels.set(row,bottom);}
  this.rendered++;this.readbackBytes+=pixels.byteLength;return{width:d.width,height:d.height,pixels};
 });}
 dispose():void{
  // Failed deletion remains owned and retriable. Do not erase the context or
  // release list until all deletions and context retirement actually succeed.
  const gl=this.gl;if(gl){gl.bindVertexArray(null);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindTexture(gl.TEXTURE_2D,null);gl.bindBuffer(gl.ARRAY_BUFFER,null);gl.useProgram(null);}
  for(const handle of this.releases.keys())this.release(handle);
  if(gl&&!gl.isContextLost()){const retirement=gl.getExtension('WEBGL_lose_context');if(!retirement)throw new SourceAttractorGpuError('context','源 GPU 上下文无法显式释放；保留所有权等待重试');retirement.loseContext();}
  this.gl=undefined;this.state=[];this.accumulation=undefined;this.output=undefined;this.disposed=true;
 }
}
