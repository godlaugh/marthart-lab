import {sourceBouncingQuad,sourceBouncingUpdateFragment} from './sourceBouncingGpuShader';

export type SourceBouncingBoundary=
 |{readonly kind:'circle';readonly center:readonly[number,number];readonly radius:number}
 |{readonly kind:'ellipse';readonly center:readonly[number,number];readonly a:number;readonly b:number}
 |{readonly kind:'polygon';readonly vertices:readonly (readonly[number,number])[]};
/** These are parsed host uniform values, not native JSON or local billiards
 * settings. Negative radii/time and degenerate polygons stay shader inputs;
 * the source shader owns its clamps and recovery, not the local exact solver. */
export interface SourceBouncingUpdate {
 readonly subSteps:number;readonly timeStep:number;readonly particleRadius:number;readonly boundary:SourceBouncingBoundary;
}
export const SOURCE_BOUNCING_GPU_LIMITS=Object.freeze({bytes:256*1024*1024,passes:10000,collisionEdgeWork:1_000_000_000});
export class SourceBouncingGpuError extends Error {
 constructor(readonly code:'input'|'capacity'|'capability'|'context'|'shader'|'render'|'cancelled'|'disposed',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourceBouncingGpuError';}
}
const F=Math.fround;
function scalar(value:unknown):number{if(typeof value!=='number'||!Number.isFinite(value)||!Number.isFinite(F(value)))throw new SourceBouncingGpuError('input','源弹跳 uniform 需要有限 Float32');return F(value);}
function pair(value:unknown):[number,number]{if(!Array.isArray(value)||value.length!==2)throw new SourceBouncingGpuError('input','源弹跳坐标需要两个数值');return[scalar(value[0]),scalar(value[1])];}
/** Immutable uniform snapshot. It never calls the local inset/convexity/
 * collision owner: native degenerate inputs have different shader behavior. */
export function prepareSourceBouncingUpdate(input:SourceBouncingUpdate):SourceBouncingUpdate{
 if(!input||!Number.isInteger(input.subSteps)||input.subSteps< -2147483648||input.subSteps>2147483647)throw new SourceBouncingGpuError('input','源弹跳 subSteps 需要 Java int32');
 const timeStep=scalar(input.timeStep),particleRadius=scalar(input.particleRadius),b=input.boundary;let boundary:SourceBouncingBoundary;
 if(b?.kind==='circle')boundary={kind:'circle',center:Object.freeze(pair(b.center)),radius:scalar(b.radius)};
 else if(b?.kind==='ellipse')boundary={kind:'ellipse',center:Object.freeze(pair(b.center)),a:scalar(b.a),b:scalar(b.b)};
 else if(b?.kind==='polygon'){
  if(!Array.isArray(b.vertices)||b.vertices.length>64)throw new SourceBouncingGpuError('capacity','源弹跳着色器最多接受 64 个多边形顶点');
  boundary={kind:'polygon',vertices:Object.freeze(b.vertices.map(point=>Object.freeze(pair(point))))};
 }else throw new SourceBouncingGpuError('input','未知源弹跳容器类型');
 return Object.freeze({subSteps:input.subSteps,timeStep,particleRadius,boundary:Object.freeze(boundary)});
}
export function sourceBouncingGpuLayout(count:number){
 if(!Number.isInteger(count)||count<1||count>2147483647)throw new SourceBouncingGpuError('input','源弹跳状态需要正整数粒子数量');
 const size=Math.ceil(Math.sqrt(count)),texels=size*size;
 // Caller input + owned snapshot; padded upload + 2 RGBA32F textures + optional
 // diagnostic readback. Driver/context overhead is outside this byte budget.
 const bytes=count*32+texels*64+64; // Quad CPU upload and GPU buffer.
 if(bytes>SOURCE_BOUNCING_GPU_LIMITS.bytes)throw new SourceBouncingGpuError('capacity','源弹跳 GPU 状态表示超过本地 256 MiB 预算');
 return Object.freeze({count,size,texels,bytes});
}
type Target={texture:WebGLTexture;framebuffer:WebGLFramebuffer};
/** Motion foundation for the native Bouncing pipeline. Each advance is one
 * actual Mobject.update, independent of its ignored time/dt arguments. This
 * object intentionally does not select a timeline, seed generator or display
 * policy, and is not a substitute for the still-separate public local model. */
export class SourceBouncingGpu {
 readonly layout:ReturnType<typeof sourceBouncingGpuLayout>;
 private initial?:Float32Array;private gl?:WebGL2RenderingContext;private program?:WebGLProgram;private vao?:WebGLVertexArrayObject;
 private targets:Target[]=[];private current=0;private initialized=false;private disposed=false;private failed=false;private failure:unknown;
 private passes=0;private readbackBytes=0;private work=0;private readonly cleanup=new Map<object,()=>void>();private readonly locations=new Map<string,WebGLUniformLocation|null>();
 constructor(initial:Float32Array,private readonly isCancelled?:()=>boolean){
  if(!(initial instanceof Float32Array)||initial.length%4)throw new SourceBouncingGpuError('input','源弹跳状态需要 RGBA Float32Array');
  this.layout=sourceBouncingGpuLayout(initial.length/4);this.initial=initial.slice();
 }
 diagnostics(){return{...this.layout,contextOwned:!!this.gl,handles:this.cleanup.size,initialized:this.initialized,disposed:this.disposed,failed:this.failed,passes:this.passes,collisionEdgeWork:this.work,readbackBytes:this.readbackBytes};}
 private check(){if(this.disposed)throw new SourceBouncingGpuError('disposed','源弹跳 GPU 对象已释放');if(this.failed)throw this.failure;if(this.isCancelled?.())throw new SourceBouncingGpuError('cancelled','源弹跳 GPU 已取消');if(this.gl?.isContextLost())throw new SourceBouncingGpuError('context','源弹跳 GPU 上下文丢失');}
 private guarded<T>(run:()=>T):T{try{this.check();return run();}catch(error){this.failed=true;this.failure=error;throw error;}}
 private own<T extends object>(handle:T|null,release:(value:T)=>void):T{if(!handle)throw new SourceBouncingGpuError('capacity','源弹跳 GPU 资源分配失败');this.cleanup.set(handle,()=>release(handle));return handle;}
 private release(handle:object){const cleanup=this.cleanup.get(handle);if(cleanup){cleanup();this.cleanup.delete(handle);}}
 private checkGl(){this.check();const error=this.gl!.getError();if(error!==this.gl!.NO_ERROR)throw new SourceBouncingGpuError('render',`源弹跳 GPU 执行失败 (${error})`);}
 private location(name:string){if(!this.locations.has(name))this.locations.set(name,this.gl!.getUniformLocation(this.program!,name));return this.locations.get(name)!;}
 initialize():void{this.guarded(()=>{
  if(this.initialized)return;if(typeof OffscreenCanvas==='undefined')throw new SourceBouncingGpuError('context','OffscreenCanvas 不可用');
  const gl=new OffscreenCanvas(1,1).getContext('webgl2',{antialias:false,depth:false,alpha:true,premultipliedAlpha:false});if(!gl)throw new SourceBouncingGpuError('context','WebGL2 不可用');this.gl=gl;
  if(!gl.getExtension('EXT_color_buffer_float'))throw new SourceBouncingGpuError('capability','源弹跳需要 RGBA32F 浮点附件');
  const viewport=gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  if(this.layout.size>gl.getParameter(gl.MAX_TEXTURE_SIZE)||this.layout.size>Math.min(...viewport))throw new SourceBouncingGpuError('capability','源弹跳状态纹理超过设备容量');
  this.program=this.own(gl.createProgram(),p=>gl.deleteProgram(p));
  for(const [kind,source] of [[gl.VERTEX_SHADER,sourceBouncingQuad],[gl.FRAGMENT_SHADER,sourceBouncingUpdateFragment]] as const){
   const shader=this.own(gl.createShader(kind),s=>gl.deleteShader(s));gl.shaderSource(shader,source);gl.compileShader(shader);
   if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new SourceBouncingGpuError('shader','源弹跳着色器编译失败：'+gl.getShaderInfoLog(shader));gl.attachShader(this.program,shader);this.release(shader);
  }
  gl.linkProgram(this.program);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new SourceBouncingGpuError('shader','源弹跳程序链接失败：'+gl.getProgramInfoLog(this.program));
  const data=new Float32Array(this.layout.texels*4);data.set(this.initial!);
  gl.activeTexture(gl.TEXTURE0);
  for(let i=0;i<2;i++){
   const texture=this.own(gl.createTexture(),t=>gl.deleteTexture(t));gl.bindTexture(gl.TEXTURE_2D,texture);
   for(const key of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,key,gl.NEAREST);
   for(const key of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,key,gl.CLAMP_TO_EDGE);
   gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,this.layout.size,this.layout.size,0,gl.RGBA,gl.FLOAT,i===0?data:null);
   const framebuffer=this.own(gl.createFramebuffer(),f=>gl.deleteFramebuffer(f));gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new SourceBouncingGpuError('capability','源弹跳 RGBA32F framebuffer 不完整');this.targets.push({texture,framebuffer});
  }
  this.vao=this.own(gl.createVertexArray(),v=>gl.deleteVertexArray(v));gl.bindVertexArray(this.vao);
  const quad=this.own(gl.createBuffer(),b=>gl.deleteBuffer(b));gl.bindBuffer(gl.ARRAY_BUFFER,quad);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const position=gl.getAttribLocation(this.program,'quadPosition');if(position<0)throw new SourceBouncingGpuError('shader','源弹跳四边形顶点属性缺失');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ARRAY_BUFFER,null);
  gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.DITHER);gl.colorMask(true,true,true,true);
  this.checkGl();this.initial=undefined;this.initialized=true;
 });}
 advance(input:SourceBouncingUpdate):void{this.guarded(()=>{
  const u=prepareSourceBouncingUpdate(input),boundary=u.boundary,units=this.layout.texels*Math.max(1,Math.min(16,u.subSteps))*4*(boundary.kind==='polygon'?Math.max(1,boundary.vertices.length):1);
  if(this.passes>=SOURCE_BOUNCING_GPU_LIMITS.passes||units>SOURCE_BOUNCING_GPU_LIMITS.collisionEdgeWork)throw new SourceBouncingGpuError('capacity','源弹跳更新超过本地碰撞边工作量或绘制次数预算；不减少子步或粒子');
  this.initialize();const gl=this.gl!;gl.useProgram(this.program!);gl.bindVertexArray(this.vao!);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.targets[this.current].texture);gl.bindFramebuffer(gl.FRAMEBUFFER,this.targets[1-this.current].framebuffer);gl.viewport(0,0,this.layout.size,this.layout.size);
  gl.uniform1i(this.location('stateTex'),0);gl.uniform1i(this.location('subSteps'),u.subSteps);gl.uniform1f(this.location('timeStep'),u.timeStep);gl.uniform1f(this.location('particleRadius'),u.particleRadius);
  gl.uniform1i(this.location('containerShape'),boundary.kind==='circle'?1:boundary.kind==='ellipse'?2:0);
  if(boundary.kind==='circle'){gl.uniform2fv(this.location('circleCenter'),boundary.center);gl.uniform1f(this.location('circleRadius'),boundary.radius);}
  else if(boundary.kind==='ellipse'){gl.uniform2fv(this.location('ellipseCenter'),boundary.center);gl.uniform1f(this.location('ellipseA'),boundary.a);gl.uniform1f(this.location('ellipseB'),boundary.b);}
  else{gl.uniform1i(this.location('polygonVertexCount'),boundary.vertices.length);const vertices=new Float32Array(128);boundary.vertices.forEach((point,i)=>vertices.set(point,i*2));gl.uniform2fv(this.location('polygonVertices[0]'),vertices);}
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);this.checkGl();this.current=1-this.current;this.passes++;this.work+=units;
 });}
 /** Explicit diagnostic copy. Production presentation must consume the owned
  * texture directly instead of reading every particle through this method. */
 readState():Float32Array{return this.guarded(()=>{this.initialize();const gl=this.gl!,out=new Float32Array(this.layout.texels*4);gl.bindFramebuffer(gl.FRAMEBUFFER,this.targets[this.current].framebuffer);gl.readPixels(0,0,this.layout.size,this.layout.size,gl.RGBA,gl.FLOAT,out);this.checkGl();this.readbackBytes+=out.byteLength;return out;});}
 dispose():void{
  const gl=this.gl;if(gl){gl.bindVertexArray(null);gl.bindBuffer(gl.ARRAY_BUFFER,null);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindTexture(gl.TEXTURE_2D,null);gl.useProgram(null);}
  for(const handle of this.cleanup.keys())this.release(handle);
  if(gl&&!gl.isContextLost()){const retire=gl.getExtension('WEBGL_lose_context');if(!retire)throw new SourceBouncingGpuError('context','源弹跳上下文释放能力缺失；保留所有权等待重试');retire.loseContext();}
  this.gl=undefined;this.initial=undefined;this.targets=[];this.program=undefined;this.vao=undefined;this.locations.clear();this.disposed=true;
 }
}
