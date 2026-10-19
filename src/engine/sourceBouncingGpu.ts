import {sourceBouncingQuad,sourceBouncingUpdateFragment,sourceBouncingRenderVertex,sourceBouncingRenderFragment} from './sourceBouncingGpuShader';

import {prepareSourceBouncingDisplay,type SourceBouncingVisualConfiguration} from './sourceBouncingVisualConfig';
import type {SourceCameraPlan} from './sourceCamera';
import {MAX_RASTER_PIXELS} from './rasterDimensions';
import {writeSourcePackedColor} from './sourceProcessingGeometry';
import {prepareSourceBouncingBoundary,SOURCE_BOUNCING_BOUNDARY_LIMITS} from './sourceBouncingBoundary';
import {sourceProcessingClosedStrokeBuffers,sourceProcessingLineDisplay,sourceProcessingLineVertex,sourceProcessingLineFragment,SOURCE_PROCESSING_CLOSED_STROKE_LIMITS} from './sourceProcessingStroke';

export interface SourceBouncingGpuDisplay {
 readonly width:number;readonly height:number;readonly cameraPlan:SourceCameraPlan;
 readonly visualConfiguration:SourceBouncingVisualConfiguration;readonly initialSpeed:number;
 /** Already translated world boundary from the seed/update owner. Omission
  * retains the explicit particle-only diagnostic path. */
 readonly boundary?:SourceBouncingBoundary;
}
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
export const SOURCE_BOUNCING_GPU_LIMITS=Object.freeze({bytes:256*1024*1024,passes:10000,collisionEdgeWork:1_000_000_000,pointFragments:1_000_000_000});
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
export function sourceBouncingGpuDisplayLayout(width:number,height:number){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>16384||height>16384||width*height>MAX_RASTER_PIXELS)throw new SourceBouncingGpuError('capacity','源弹跳画布超出本地图像容量');
 // RGBA8 attachment + readback; one flip row and small uniform upload arrays.
 return Object.freeze({width,height,bytes:width*height*8+width*4+1024});
}
function matrix(values:ArrayLike<number>|undefined):Float32Array{
 if(!values||values.length!==16)throw new SourceBouncingGpuError('input','源弹跳矩阵需要16个有限Float32值');
 const result=new Float32Array(16);for(let i=0;i<16;i++)result[i]=scalar(values[i]);return result;
}
type Program={program:WebGLProgram;locations:Map<string,WebGLUniformLocation|null>};
type Target={texture:WebGLTexture;framebuffer:WebGLFramebuffer};
type DisplayTarget=Target&{width:number;height:number};
type BoundaryResources={program:Program;vao:WebGLVertexArrayObject;vertices:WebGLBuffer;indices:WebGLBuffer;color:number};
// Bounded source path (at most 200 points), CPU expanded buffers plus retained
// GPU buffers. Driver allocations remain outside the representation budget.
const BOUNDARY_BYTES=SOURCE_PROCESSING_CLOSED_STROKE_LIMITS.maxBufferBytes*2+SOURCE_BOUNCING_BOUNDARY_LIMITS.pathBytes;
/** Owned motion and particle-drawing layer for the native Bouncing pipeline. Each advance is one
 * actual Mobject.update, independent of its ignored time/dt arguments. This
 * object intentionally does not select a timeline, seed generator or full-scene composition
 * policy, and is not a substitute for the still-separate public local model. */
export class SourceBouncingGpu {
 readonly layout:ReturnType<typeof sourceBouncingGpuLayout>;
 private initial?:Float32Array;private gl?:WebGL2RenderingContext;private updateProgram?:Program;private renderProgram?:Program;private vao?:WebGLVertexArrayObject;private pointVao?:WebGLVertexArrayObject;private output?:DisplayTarget;
 private targets:Target[]=[];private current=0;private initialized=false;private disposed=false;private failed=false;private failure:unknown;
 private boundaryResources?:BoundaryResources;private boundaryDraws=0;
 private passes=0;private rendered=0;private readbackBytes=0;private work=0;private readonly cleanup=new Map<object,()=>void>();
 constructor(initial:Float32Array,private readonly isCancelled?:()=>boolean){
  if(!(initial instanceof Float32Array)||initial.length%4)throw new SourceBouncingGpuError('input','源弹跳状态需要 RGBA Float32Array');
  this.layout=sourceBouncingGpuLayout(initial.length/4);this.initial=initial.slice();
 }
 diagnostics(){return{...this.layout,contextOwned:!!this.gl,handles:this.cleanup.size,initialized:this.initialized,disposed:this.disposed,failed:this.failed,passes:this.passes,collisionEdgeWork:this.work,readbackBytes:this.readbackBytes,rendered:this.rendered,boundaryDraws:this.boundaryDraws,estimatedBytes:this.layout.bytes+(this.output?sourceBouncingGpuDisplayLayout(this.output.width,this.output.height).bytes:0)+(this.boundaryResources?BOUNDARY_BYTES:0)};}
 private check(){if(this.disposed)throw new SourceBouncingGpuError('disposed','源弹跳 GPU 对象已释放');if(this.failed)throw this.failure;if(this.isCancelled?.())throw new SourceBouncingGpuError('cancelled','源弹跳 GPU 已取消');if(this.gl?.isContextLost())throw new SourceBouncingGpuError('context','源弹跳 GPU 上下文丢失');}
 private guarded<T>(run:()=>T):T{try{this.check();return run();}catch(error){this.failed=true;this.failure=error;throw error;}}
 private own<T extends object>(handle:T|null,release:(value:T)=>void):T{if(!handle)throw new SourceBouncingGpuError('capacity','源弹跳 GPU 资源分配失败');this.cleanup.set(handle,()=>release(handle));return handle;}
 private release(handle:object){const cleanup=this.cleanup.get(handle);if(cleanup){cleanup();this.cleanup.delete(handle);}}
 private checkGl(){this.check();const error=this.gl!.getError();if(error!==this.gl!.NO_ERROR)throw new SourceBouncingGpuError('render',`源弹跳 GPU 执行失败 (${error})`);}
 private location(p:Program,name:string){if(!p.locations.has(name))p.locations.set(name,this.gl!.getUniformLocation(p.program,name));return p.locations.get(name)!;}
 private compile(vertex:string,fragment:string):Program{
  const gl=this.gl!,program=this.own(gl.createProgram(),p=>gl.deleteProgram(p));
  for(const [kind,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]] as const){
   const shader=this.own(gl.createShader(kind),s=>gl.deleteShader(s));gl.shaderSource(shader,source);gl.compileShader(shader);
   if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new SourceBouncingGpuError('shader','源弹跳着色器编译失败：'+gl.getShaderInfoLog(shader));gl.attachShader(program,shader);this.release(shader);
  }
  gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new SourceBouncingGpuError('shader','源弹跳程序链接失败：'+gl.getProgramInfoLog(program));return{program,locations:new Map()};
 }
 initialize():void{this.guarded(()=>{
  if(this.initialized)return;if(typeof OffscreenCanvas==='undefined')throw new SourceBouncingGpuError('context','OffscreenCanvas 不可用');
  const gl=new OffscreenCanvas(1,1).getContext('webgl2',{antialias:false,depth:false,alpha:true,premultipliedAlpha:false});if(!gl)throw new SourceBouncingGpuError('context','WebGL2 不可用');this.gl=gl;
  if(!gl.getExtension('EXT_color_buffer_float'))throw new SourceBouncingGpuError('capability','源弹跳需要 RGBA32F 浮点附件');
  const viewport=gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  if(this.layout.size>gl.getParameter(gl.MAX_TEXTURE_SIZE)||this.layout.size>Math.min(...viewport))throw new SourceBouncingGpuError('capability','源弹跳状态纹理超过设备容量');
  this.updateProgram=this.compile(sourceBouncingQuad,sourceBouncingUpdateFragment);
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
  const position=gl.getAttribLocation(this.updateProgram.program,'quadPosition');if(position<0)throw new SourceBouncingGpuError('shader','源弹跳四边形顶点属性缺失');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ARRAY_BUFFER,null);
  gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.DITHER);gl.colorMask(true,true,true,true);
  this.checkGl();this.initial=undefined;this.initialized=true;
 });}
 advance(input:SourceBouncingUpdate):void{this.guarded(()=>{
  const u=prepareSourceBouncingUpdate(input),boundary=u.boundary;
  // Polygon: one initial area scan, up to four collision scans, then at most
  // one inside test plus area/nearest-edge recovery scans before returning.
  // Circle/ellipse have four bounded collision iterations and no edge scans.
  const units=this.layout.texels*Math.max(1,Math.min(16,u.subSteps))*(boundary.kind==='polygon'?8*Math.max(1,boundary.vertices.length):4);
  if(this.passes>=SOURCE_BOUNCING_GPU_LIMITS.passes||units>SOURCE_BOUNCING_GPU_LIMITS.collisionEdgeWork)throw new SourceBouncingGpuError('capacity','源弹跳更新超过本地碰撞边工作量或绘制次数预算；不减少子步或粒子');
  this.initialize();const gl=this.gl!,p=this.updateProgram!;gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.useProgram(p.program);gl.bindVertexArray(this.vao!);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.targets[this.current].texture);gl.bindFramebuffer(gl.FRAMEBUFFER,this.targets[1-this.current].framebuffer);gl.viewport(0,0,this.layout.size,this.layout.size);
  gl.uniform1i(this.location(p,'stateTex'),0);gl.uniform1i(this.location(p,'subSteps'),u.subSteps);gl.uniform1f(this.location(p,'timeStep'),u.timeStep);gl.uniform1f(this.location(p,'particleRadius'),u.particleRadius);
  gl.uniform1i(this.location(p,'containerShape'),boundary.kind==='circle'?1:boundary.kind==='ellipse'?2:0);
  if(boundary.kind==='circle'){gl.uniform2fv(this.location(p,'circleCenter'),boundary.center);gl.uniform1f(this.location(p,'circleRadius'),boundary.radius);}
  else if(boundary.kind==='ellipse'){gl.uniform2fv(this.location(p,'ellipseCenter'),boundary.center);gl.uniform1f(this.location(p,'ellipseA'),boundary.a);gl.uniform1f(this.location(p,'ellipseB'),boundary.b);}
  else{gl.uniform1i(this.location(p,'polygonVertexCount'),boundary.vertices.length);const vertices=new Float32Array(128);boundary.vertices.forEach((point,i)=>vertices.set(point,i*2));gl.uniform2fv(this.location(p,'polygonVertices[0]'),vertices);}
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);this.checkGl();this.current=1-this.current;this.passes++;this.work+=units;
 });}
 /** Explicit diagnostic copy. Production presentation must consume the owned
  * texture directly instead of reading every particle through this method. */
 readState():Float32Array{return this.guarded(()=>{this.initialize();const gl=this.gl!,out=new Float32Array(this.layout.texels*4);gl.bindFramebuffer(gl.FRAMEBUFFER,this.targets[this.current].framebuffer);gl.readPixels(0,0,this.layout.size,this.layout.size,gl.RGBA,gl.FLOAT,out);this.checkGl();this.readbackBytes+=out.byteLength;return out;});}
 /** Draw the current state texture, then the optional source closed boundary
  * into the same attachment. Each frame clears; scene accumulation and replay
  * are separate policies. No particle readback occurs here. */
 render(options:SourceBouncingGpuDisplay):{width:number;height:number;pixels:Uint8ClampedArray}{return this.guarded(()=>{
  const d=sourceBouncingGpuDisplayLayout(options.width,options.height);
  if(this.layout.bytes+d.bytes+(options.boundary||this.boundaryResources?BOUNDARY_BYTES:0)>SOURCE_BOUNCING_GPU_LIMITS.bytes)throw new SourceBouncingGpuError('capacity','源弹跳状态与绘制表示合计超过256 MiB预算');
  const prepared=prepareSourceBouncingDisplay(options.visualConfiguration,{initialSpeed:options.initialSpeed},options.cameraPlan?.displayScale);
  if(!prepared.ok)throw new SourceBouncingGpuError(prepared.error.kind==='capacity'?'capacity':'input',prepared.error.reason);
  const u=prepared.value,projection=matrix(options.cameraPlan?.projection?.columnMajor),modelview=matrix(options.cameraPlan?.modelView?.columnMajor);
  let boundary:{buffers:ReturnType<typeof sourceProcessingClosedStrokeBuffers>;color:number;display:ReturnType<typeof sourceProcessingLineDisplay>}|undefined;
  if(options.boundary){
   const path=prepareSourceBouncingBoundary(options.boundary,u,options.cameraPlan);
   if(!path.ok)throw new SourceBouncingGpuError(path.error.kind==='capacity'?'capacity':'input',path.error.reason);
   if(path.value.positions.length)boundary={buffers:sourceProcessingClosedStrokeBuffers(path.value.positions,path.value.lineWidth,options.cameraPlan),color:path.value.packedColor,display:sourceProcessingLineDisplay(options.cameraPlan)};
  }
  const pointSize=Math.max(1,u.radius),fragments=this.layout.count*Math.ceil(pointSize)**2;
  if(!Number.isFinite(pointSize)||!Number.isSafeInteger(fragments)||fragments>SOURCE_BOUNCING_GPU_LIMITS.pointFragments||this.rendered>=SOURCE_BOUNCING_GPU_LIMITS.passes)throw new SourceBouncingGpuError('capacity','源弹跳点片元或绘制次数超出预算；不减少粒子或点大小');
  this.initialize();const gl=this.gl!,viewport=gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array,range=gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array;
  if(Math.max(d.width,d.height)>gl.getParameter(gl.MAX_TEXTURE_SIZE)||d.width>viewport[0]||d.height>viewport[1]||pointSize>range[1])throw new SourceBouncingGpuError('capability','源弹跳绘制尺寸或点直径超过设备容量');
  if(!this.renderProgram){this.renderProgram=this.compile(sourceBouncingRenderVertex,sourceBouncingRenderFragment);this.pointVao=this.own(gl.createVertexArray(),v=>gl.deleteVertexArray(v));}
  if(!this.output||this.output.width!==d.width||this.output.height!==d.height){
   if(this.output){this.release(this.output.framebuffer);this.release(this.output.texture);this.output=undefined;}
   const texture=this.own(gl.createTexture(),t=>gl.deleteTexture(t));gl.bindTexture(gl.TEXTURE_2D,texture);
   for(const key of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,key,gl.NEAREST);
   for(const key of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,key,gl.CLAMP_TO_EDGE);
   gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,d.width,d.height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
   const framebuffer=this.own(gl.createFramebuffer(),f=>gl.deleteFramebuffer(f));gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new SourceBouncingGpuError('capability','源弹跳RGBA8绘制附件不完整');this.output={texture,framebuffer,width:d.width,height:d.height};
  }
  const p=this.renderProgram,c=u.transform,background=u.backgroundColor;
  gl.bindFramebuffer(gl.FRAMEBUFFER,this.output.framebuffer);gl.viewport(0,0,d.width,d.height);gl.disable(gl.DEPTH_TEST);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.DITHER);gl.colorMask(true,true,true,true);
  // PGraphicsOpenGL keeps ARGB format, but colorCalc(int) still treats
  // alpha-zero integers <=255 as opaque grayscale. Reuse that color owner.
  const clear=new Float32Array(4);writeSourcePackedColor(background,clear,0);
  gl.clearColor(clear[0],clear[1],clear[2],clear[3]);gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(p.program);gl.bindVertexArray(this.pointVao!);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.targets[this.current].texture);
  gl.uniform1i(this.location(p,'stateTex'),0);gl.uniform1i(this.location(p,'texSize'),this.layout.size);gl.uniform1i(this.location(p,'particleCount'),this.layout.count);
  gl.uniform3f(this.location(p,'scale'),c.scaleX,c.scaleY,c.scaleZ);gl.uniform3f(this.location(p,'offset'),c.offsetX,c.offsetY,c.offsetZ);
  gl.uniform1f(this.location(p,'radius'),u.radius);gl.uniform1f(this.location(p,'speedScale'),u.speedScale);
  gl.uniform1i(this.location(p,'paletteCount'),u.paletteCount);gl.uniform3fv(this.location(p,'palette[0]'),u.paletteRgb);
  gl.uniformMatrix4fv(this.location(p,'projection'),false,projection);gl.uniformMatrix4fv(this.location(p,'modelview'),false,modelview);
  gl.drawArrays(gl.POINTS,0,this.layout.count);gl.disable(gl.BLEND);this.checkGl();
  if(boundary){this.drawBoundary(boundary,projection);this.checkGl();this.boundaryDraws++;}
  const pixels=new Uint8ClampedArray(d.width*d.height*4);gl.readPixels(0,0,d.width,d.height,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(pixels.buffer));this.checkGl();
  const stride=d.width*4,row=new Uint8ClampedArray(stride);for(let y=0;y<Math.floor(d.height/2);y++){const top=y*stride,bottom=(d.height-1-y)*stride;row.set(pixels.subarray(top,top+stride));pixels.copyWithin(top,bottom,bottom+stride);pixels.set(row,bottom);}
  this.rendered++;this.readbackBytes+=pixels.byteLength;return{width:d.width,height:d.height,pixels};
 });}
 private drawBoundary(boundary:{buffers:ReturnType<typeof sourceProcessingClosedStrokeBuffers>;color:number;display:ReturnType<typeof sourceProcessingLineDisplay>},projection:Float32Array){
  const gl=this.gl!,limit=SOURCE_PROCESSING_CLOSED_STROKE_LIMITS,offset=limit.maxVertices*16;
  if(!this.boundaryResources){
   const program=this.compile('#version 300 es\n'+sourceProcessingLineVertex,'#version 300 es\n'+sourceProcessingLineFragment),vao=this.own(gl.createVertexArray(),v=>gl.deleteVertexArray(v));gl.bindVertexArray(vao);
   const vertices=this.own(gl.createBuffer(),b=>gl.deleteBuffer(b));gl.bindBuffer(gl.ARRAY_BUFFER,vertices);gl.bufferData(gl.ARRAY_BUFFER,offset*2,gl.DYNAMIC_DRAW);
   for(const [name,position] of [['position',0],['direction',offset]] as const){const attribute=gl.getAttribLocation(program.program,name);if(attribute<0)throw new SourceBouncingGpuError('shader','源边界顶点属性缺失：'+name);gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,4,gl.FLOAT,false,0,position);}
   const color=gl.getAttribLocation(program.program,'color');if(color<0)throw new SourceBouncingGpuError('shader','源边界颜色属性缺失');gl.disableVertexAttribArray(color);
   const indices=this.own(gl.createBuffer(),b=>gl.deleteBuffer(b));gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indices);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,limit.maxIndices*4,gl.DYNAMIC_DRAW);
   this.boundaryResources={program,vao,vertices,indices,color};
  }
  const resources=this.boundaryResources,p=resources.program,b=boundary.buffers;
  gl.useProgram(p.program);gl.bindVertexArray(resources.vao);gl.bindBuffer(gl.ARRAY_BUFFER,resources.vertices);gl.bufferSubData(gl.ARRAY_BUFFER,0,b.positions);gl.bufferSubData(gl.ARRAY_BUFFER,offset,b.directions);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,resources.indices);gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER,0,b.indices);
  const rgba=new Float32Array(4);writeSourcePackedColor(boundary.color,rgba,0);gl.vertexAttrib4fv(resources.color,rgba);
  gl.uniformMatrix4fv(this.location(p,'lineModelview'),false,new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]));gl.uniformMatrix4fv(this.location(p,'projection'),false,projection);
  gl.uniform4fv(this.location(p,'viewport'),boundary.display.viewport);gl.uniform1i(this.location(p,'perspective'),boundary.display.perspective);gl.uniform3fv(this.location(p,'scale'),boundary.display.scale);
  // endPGL restores Processing BLEND before the boundary flush: RGB uses
  // normal source alpha, alpha uses ONE+ONE. Depth is explicitly disabled by
  // BouncingBoundaryMobject; this differs from the preceding particle pass.
  gl.disable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendEquationSeparate(gl.FUNC_ADD,gl.FUNC_ADD);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE);
  gl.drawElements(gl.TRIANGLES,b.indices.length,gl.UNSIGNED_INT,0);gl.disable(gl.BLEND);
 }
 dispose():void{
  const gl=this.gl;if(gl){gl.bindVertexArray(null);gl.bindBuffer(gl.ARRAY_BUFFER,null);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindTexture(gl.TEXTURE_2D,null);gl.useProgram(null);}
  for(const handle of this.cleanup.keys())this.release(handle);
  if(gl&&!gl.isContextLost()){const retire=gl.getExtension('WEBGL_lose_context');if(!retire)throw new SourceBouncingGpuError('context','源弹跳上下文释放能力缺失；保留所有权等待重试');retire.loseContext();}
  this.gl=undefined;this.initial=undefined;this.targets=[];this.updateProgram=undefined;this.renderProgram=undefined;this.vao=undefined;this.pointVao=undefined;this.output=undefined;this.boundaryResources=undefined;this.disposed=true;
 }
}
