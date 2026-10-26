import type {SourceAttractorConfiguration} from './sourceAttractorConfig';
import type {SourceAttractorVisualConfiguration} from './sourceAttractorVisualConfig';
import type {SourceAttractorGpuFunction} from './sourceAttractorGpuFunction';
import {sourceAttractorGpuPrograms} from './sourceAttractorGpuShaders';
import {SourceAttractorGpuError,SOURCE_ATTRACTOR_GPU_LIMITS,sourceAttractorGpuLayout,sourceAttractorGpuDisplayLayout,prepareSourceAttractorGpuOptions,prepareSourceAttractorGpuInitialData,prepareSourceAttractorGpuDisplay,sourceAttractorGpuWarmupPasses,sourceAttractorGpuNormalPass,sourceAttractorGpuPassUniforms,type SourceAttractorGpuOptions,type SourceAttractorGpuDisplay,type SourceAttractorGpuPrepared,type SourceAttractorGpuPass} from './sourceAttractorGpuPrepared';
export {SourceAttractorGpuError,SOURCE_ATTRACTOR_GPU_LIMITS,sourceAttractorGpuLayout,sourceAttractorGpuDisplayLayout,prepareSourceAttractorGpuWork,type SourceAttractorGpuOptions,type SourceAttractorGpuDisplay} from './sourceAttractorGpuPrepared';

/** WebGL owns full upload/readback arrays as well as device targets. Native
 * uses the same layout facts but admits its distinct representations separately. */
export function admitSourceAttractorWebGlDisplay(layout:ReturnType<typeof sourceAttractorGpuLayout>,display:ReturnType<typeof sourceAttractorGpuDisplayLayout>,trackingBytes=0){
 if(!Number.isSafeInteger(trackingBytes)||trackingBytes<0||layout.bytes+display.bytes+trackingBytes>SOURCE_ATTRACTOR_GPU_LIMITS.bytes)throw new SourceAttractorGpuError('capacity','源 GPU 吸引子跟踪、附件与上传表示合计超过本地 256 MiB 预算');
}

type Program={program:WebGLProgram;locations:Map<string,WebGLUniformLocation|null>};
type Target={texture:WebGLTexture;framebuffer:WebGLFramebuffer;width:number;height:number};

/** One native-style object lifetime. Raw XYZW state remains on this context;
 * only render() publishes pixels. readState() is an explicit diagnostic.
 * Failures are terminal until disposal, with no CPU/half-float fallback. */
export class SourceAttractorGpu {
 readonly configuration:SourceAttractorConfiguration;readonly visualConfiguration:SourceAttractorVisualConfiguration;
 readonly layout:ReturnType<typeof sourceAttractorGpuLayout>;
 private readonly prepared:SourceAttractorGpuPrepared;private readonly shader:SourceAttractorGpuFunction;private readonly isCancelled?:()=>boolean;
 private gl?:WebGL2RenderingContext;private initialized=false;private disposed=false;private failure:unknown;private failed=false;
 private readonly releases=new Map<object,()=>void>();
 private updateProgram?:Program;private accumulateProgram?:Program;private presentProgram?:Program;
 private state:Target[]=[];private current=0;private emptyVao?:WebGLVertexArrayObject;private pointVao?:WebGLVertexArrayObject;
 private accumulation?:Target;private output?:Target;
 private work=0;private updatePasses=0;private warmupPasses=0;private rendered=0;private readbackBytes=0;
 constructor(options:SourceAttractorGpuOptions){
  this.prepared=prepareSourceAttractorGpuOptions(options);this.configuration=this.prepared.configuration;this.visualConfiguration=this.prepared.visualConfiguration;this.shader=this.prepared.shader;this.layout=this.prepared.layout;this.isCancelled=options.isCancelled;
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
  const programs=sourceAttractorGpuPrograms(this.shader,'webgl2');
  this.updateProgram=this.program(programs.update.vertex,programs.update.fragment);
  this.accumulateProgram=this.program(programs.accumulate.vertex,programs.accumulate.fragment);this.presentProgram=this.program(programs.present.vertex,programs.present.fragment);
  const {data,uv,rgba}=prepareSourceAttractorGpuInitialData(this.prepared,()=>this.check());
  this.state=[this.target(this.layout.size,this.layout.size,true,false,data),this.target(this.layout.size,this.layout.size,true)];
  for(const pass of sourceAttractorGpuWarmupPasses(this.configuration))this.pass(pass);
  this.pointVao=this.own(gl.createVertexArray(),x=>gl.deleteVertexArray(x));gl.bindVertexArray(this.pointVao);
  for(const [name,values,size] of [['texIndex',uv,2],['color',rgba,4]] as const){const b=this.own(gl.createBuffer(),x=>gl.deleteBuffer(x));gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,values,gl.STATIC_DRAW);const location=gl.getAttribLocation(this.accumulateProgram.program,name);if(location<0)throw new SourceAttractorGpuError('shader','源 GPU 粒子属性缺失：'+name);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,0,0);}
  gl.bindBuffer(gl.ARRAY_BUFFER,null);gl.bindVertexArray(null);this.checkGl();this.initialized=true;
 });}
 private pass(pass:SourceAttractorGpuPass){
  const {steps,warmup}=pass;
  this.check();this.admitWork(steps);const gl=this.gl!,p=this.updateProgram!,next=1-this.current;
  gl.disable(gl.BLEND);gl.useProgram(p.program);gl.bindVertexArray(this.emptyVao!);gl.bindFramebuffer(gl.FRAMEBUFFER,this.state[next].framebuffer);gl.viewport(0,0,this.layout.size,this.layout.size);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.state[this.current].texture);
  for(const [name,value] of sourceAttractorGpuPassUniforms(pass))gl.uniform1i(this.location(p,name),value);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);this.checkGl();this.current=next;if(warmup)this.warmupPasses++;else this.updatePasses++;
 }
 advance():void{this.guarded(()=>{this.initialize();this.pass(sourceAttractorGpuNormalPass(this.configuration));});}
 readState():Float32Array{return this.guarded(()=>{this.initialize();const gl=this.gl!,result=new Float32Array(this.layout.texels*4);gl.bindFramebuffer(gl.FRAMEBUFFER,this.state[this.current].framebuffer);gl.readPixels(0,0,this.layout.size,this.layout.size,gl.RGBA,gl.FLOAT,result);this.checkGl();this.readbackBytes+=result.byteLength;return result;});}
 render(options:SourceAttractorGpuDisplay):{width:number;height:number;pixels:Uint8ClampedArray}{return this.guarded(()=>{
  const plan=prepareSourceAttractorGpuDisplay(this.prepared,options),d=plan.layout;admitSourceAttractorWebGlDisplay(this.layout,d);
  this.initialize();const gl=this.gl!,limit=gl.getParameter(gl.MAX_TEXTURE_SIZE),viewport=gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  if(Math.max(d.accumWidth,d.accumHeight)>limit||d.accumWidth>viewport[0]||d.accumHeight>viewport[1])throw new SourceAttractorGpuError('capability','源 GPU 密度附件超过设备容量');
  const radius=plan.radius,range=gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array;
  if(!Number.isFinite(radius)||radius>range[1])throw new SourceAttractorGpuError('capability','源 GPU 点直径超过设备容量；不静默截断');
  if(!this.output||this.output.width!==d.width||this.output.height!==d.height){
   this.retire(this.accumulation);this.retire(this.output);this.accumulation=undefined;this.output=undefined;
   this.accumulation=this.target(d.accumWidth,d.accumHeight,true,true);this.output=this.target(d.width,d.height,false);
  }
  const p=this.accumulateProgram!;gl.bindFramebuffer(gl.FRAMEBUFFER,this.accumulation!.framebuffer);gl.viewport(0,0,d.accumWidth,d.accumHeight);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.ONE,gl.ONE);gl.useProgram(p.program);gl.bindVertexArray(this.pointVao!);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.state[this.current].texture);
  gl.uniform1i(this.location(p,'posTex'),0);gl.uniform1f(this.location(p,'radius'),radius);gl.uniform3f(this.location(p,'scale'),...plan.scale);gl.uniform3f(this.location(p,'offset'),...plan.offset);gl.uniformMatrix4fv(this.location(p,'projection'),false,plan.projection);gl.uniformMatrix4fv(this.location(p,'modelview'),false,plan.modelview);
  gl.drawArrays(gl.POINTS,0,this.layout.count);this.checkGl();
  const q=this.presentProgram!;
  gl.disable(gl.BLEND);gl.bindFramebuffer(gl.FRAMEBUFFER,this.output!.framebuffer);gl.viewport(0,0,d.width,d.height);gl.useProgram(q.program);gl.bindVertexArray(this.emptyVao!);gl.bindTexture(gl.TEXTURE_2D,this.accumulation!.texture);gl.uniform1i(this.location(q,'accumTex'),0);gl.uniform3f(this.location(q,'backgroundRgb'),...plan.backgroundRgb);
  for(const name of ['exposure','contrast','gamma','saturation'] as const)gl.uniform1f(this.location(q,name),plan[name]);
  gl.uniform1f(this.location(q,'densityScale'),plan.densityScale);
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
