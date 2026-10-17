import {DomainGpuError,domainGpuOperation as gpuCall} from './domainGpuFailure';
import type {DomainModel} from './domainModel';
import {domainExpressions} from './domainExpressions';
import {renderDomainRaster,prepareDomainRaster,domainNativeWork,type DomainRasterFacts,type DomainRepairPixel} from './domainGpuRaster';
export const MAX_DOMAIN_GPU_BATCH=8192;
interface Program {program:WebGLProgram;locations:Map<string,WebGLUniformLocation|null>;}
export interface DomainGpuBatch {values:Float32Array;repair:Uint8Array;}
/** Compatibility API; the shared structure owner retains ASTs and GLSL. */
export function domainGpuSource(model:DomainModel){return domainExpressions.get(model).gpuSource();}
/** One worker-local GL owner: legacy transform-feedback sampling remains a
 * numerical oracle; tiled raster passes consume the same parsed orbit facts. */
export class DomainGpu {
 private lastRaster?:DomainRasterFacts;private gl?:WebGL2RenderingContext;private programs=new Map<string,Program>();
 // A failed release retains its closure and every not-yet-released handle.
 // Pending work blocks context reuse and is retried by dispose().
 private pendingCleanup=new Set<()=>void>();
 private ownCleanup=(cleanup:()=>void)=>()=>{try{cleanup();this.pendingCleanup.delete(cleanup);}catch(error){this.pendingCleanup.add(cleanup);throw error;}};
 private finishPendingCleanup(){for(const cleanup of this.pendingCleanup){cleanup();this.pendingCleanup.delete(cleanup);}}
 diagnostics(){return{programs:this.programs.size,pendingCleanup:this.pendingCleanup.size,context:!!this.gl,lastRaster:this.lastRaster};}
 private context(){
  this.finishPendingCleanup();
  if(this.gl&&gpuCall('context','域着色 GPU 上下文检查失败',()=>this.gl!.isContextLost())){this.dispose();throw new DomainGpuError('context','域着色 GPU 上下文已丢失');}
  if(!this.gl){if(typeof OffscreenCanvas==='undefined')throw new DomainGpuError('context','OffscreenCanvas 不可用');const gl=gpuCall('context','域着色 GPU 上下文创建失败',()=>new OffscreenCanvas(1,1).getContext('webgl2',{antialias:false}));if(!gl)throw new DomainGpuError('context','WebGL2 不可用');this.gl=gl;}
  return this.gl;
 }
 private program(source:string,fragment?:string):Program{
  const key=fragment===undefined?source:source+'\0'+fragment;
  const gl=this.context(),cached=this.programs.get(key);if(cached){this.programs.delete(key);this.programs.set(key,cached);return cached;}
  const program=gpuCall('allocation','域着色 GPU program 分配失败',()=>gl.createProgram());if(!program)throw new DomainGpuError('allocation','域着色 GPU program 分配失败');const shaders:WebGLShader[]=[],attached=new Set<WebGLShader>();let committed=false;
  const releaseShaders=()=>{while(shaders.length){const shader=shaders[0];if(attached.has(shader)){gl.detachShader(program,shader);attached.delete(shader);}gl.deleteShader(shader);shaders.shift();}};
  const release=this.ownCleanup(()=>{releaseShaders();if(!committed){if(gl.getParameter(gl.CURRENT_PROGRAM)===program)gl.useProgram(null);gl.deleteProgram(program);}});
  try{
   for(const[type,code]of [[gl.VERTEX_SHADER,source],[gl.FRAGMENT_SHADER,fragment??'#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(0.);}']] as const){const shader=gpuCall('allocation','域着色 GPU shader 分配失败',()=>gl.createShader(type));if(!shader)throw new DomainGpuError('allocation','域着色 GPU shader 分配失败');shaders.push(shader);gpuCall('compile','域着色 GPU 编译失败',()=>{gl.shaderSource(shader,code);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new DomainGpuError('compile','域着色 GPU 编译失败：'+gl.getShaderInfoLog(shader));});gpuCall('link','域着色 GPU shader 绑定失败',()=>gl.attachShader(program,shader));attached.add(shader);}
   gpuCall('link','域着色 GPU 链接失败',()=>{if(fragment===undefined)gl.transformFeedbackVaryings(program,['result'],gl.SEPARATE_ATTRIBS);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new DomainGpuError('link','域着色 GPU 链接失败：'+gl.getProgramInfoLog(program));});
   // Publish only after temporary shaders and any evicted program were released.
   // A failed build/release remains pending and can never become a cache hit.
   releaseShaders();
   if(this.programs.size>=8){const oldest=this.programs.keys().next().value!;const evicted=this.programs.get(oldest)!.program;const retire=this.ownCleanup(()=>{if(gl.getParameter(gl.CURRENT_PROGRAM)===evicted)gl.useProgram(null);gl.deleteProgram(evicted);});this.programs.delete(oldest);retire();}
   const value={program,locations:new Map<string,WebGLUniformLocation|null>()};this.programs.set(key,value);committed=true;return value;
  }finally{release();}
 }
 sample(model:DomainModel,points:Float32Array,isCancelled?:()=>boolean):DomainGpuBatch{
  if(isCancelled?.())throw new DOMException('域着色计算已取消','AbortError');
  const nativeExecution=model.execution.arithmetic==='native-gpu';
  if(!(points instanceof Float32Array)||points.length%2||points.length>MAX_DOMAIN_GPU_BATCH*2||!nativeExecution&&points.some(v=>!Number.isFinite(v)))throw new Error('域着色 GPU 批次坐标无效或超出预算');
  const count=points.length/2,drawLimit=nativeExecution?domainNativeWork(model).itemsPerDraw:MAX_DOMAIN_GPU_BATCH;if(count===0)return{values:new Float32Array(),repair:new Uint8Array()};
  const compiled=domainGpuSource(model);if(!nativeExecution&&[...Object.values(model.parameters),...model.constant,model.bailout].some(v=>!Number.isFinite(Math.fround(v))))throw new Error('域着色参数超出 GPU float32 范围');
  let gl:WebGL2RenderingContext|undefined,input:WebGLBuffer|null=null,output:WebGLBuffer|null=null,vao:WebGLVertexArrayObject|null=null,feedback:WebGLTransformFeedback|null=null,active=false;
  const release=this.ownCleanup(()=>{if(gl){if(active){gl.endTransformFeedback();active=false;}gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindVertexArray(null);if(input){gl.deleteBuffer(input);input=null;}if(output){gl.deleteBuffer(output);output=null;}if(vao){gl.deleteVertexArray(vao);vao=null;}if(feedback){gl.deleteTransformFeedback(feedback);feedback=null;}}});
  try{
   gl=this.context();if(compiled.parameters.length+8>gpuCall('capability','域着色 GPU uniform 容量查询失败',()=>gl!.getParameter(gl!.MAX_VERTEX_UNIFORM_VECTORS)))throw new DomainGpuError('capability','域着色参数超过 GPU uniform 容量');
   const p=this.program(compiled.source);gpuCall('render','域着色 GPU 程序绑定失败',()=>gl!.useProgram(p.program));
   const location=(name:string)=>{if(!p.locations.has(name))p.locations.set(name,gpuCall('render','域着色 GPU uniform 查询失败',()=>gl!.getUniformLocation(p.program,name)));return p.locations.get(name)!;};
   gpuCall('render','域着色 GPU uniform 上传失败',()=>{compiled.parameters.forEach((name,i)=>gl!.uniform1f(location('parameter'+i),model.parameters[name]));gl!.uniform2f(location('constantValue'),...model.constant);gl!.uniform1i(location('iterate'),model.iteration?1:0);gl!.uniform1i(location('iterationSteps'),model.steps);gl!.uniform1i(location('seedMode'),model.seed==='PIXEL_Z'?0:model.seed==='ZERO'?1:2);gl!.uniform1f(location('bailout'),model.bailout);});
   gpuCall('allocation','域着色 GPU 缓冲分配失败',()=>{input=gl!.createBuffer();output=gl!.createBuffer();vao=gl!.createVertexArray();feedback=gl!.createTransformFeedback();});if(!input||!output||!vao||!feedback)throw new DomainGpuError('allocation','域着色 GPU 缓冲分配失败');
   gpuCall('allocation','域着色 GPU 缓冲准备失败',()=>{gl!.bindVertexArray(vao);gl!.bindBuffer(gl!.ARRAY_BUFFER,input);gl!.bufferData(gl!.ARRAY_BUFFER,points,gl!.STREAM_DRAW);gl!.enableVertexAttribArray(0);gl!.vertexAttribPointer(0,2,gl!.FLOAT,false,0,0);
   gl!.bindTransformFeedback(gl!.TRANSFORM_FEEDBACK,feedback);gl!.bindBuffer(gl!.TRANSFORM_FEEDBACK_BUFFER,output);gl!.bufferData(gl!.TRANSFORM_FEEDBACK_BUFFER,count*16,gl!.STREAM_READ);gl!.bindBufferBase(gl!.TRANSFORM_FEEDBACK_BUFFER,0,output);gl!.enable(gl!.RASTERIZER_DISCARD);});
   if(nativeExecution){for(let start=0;start<count;start+=drawLimit){if(isCancelled?.())throw new DOMException('域着色计算已取消','AbortError');const n=Math.min(drawLimit,count-start);gpuCall('render','域着色 GPU 执行失败',()=>{gl!.bindBufferRange(gl!.TRANSFORM_FEEDBACK_BUFFER,0,output,start*16,n*16);gl!.beginTransformFeedback(gl!.POINTS);active=true;gl!.drawArrays(gl!.POINTS,start,n);gl!.endTransformFeedback();active=false;});}}
   else{gpuCall('render','域着色 GPU 执行失败',()=>{gl!.beginTransformFeedback(gl!.POINTS);active=true;gl!.drawArrays(gl!.POINTS,0,count);gl!.endTransformFeedback();active=false;});}
   if(isCancelled?.())throw new DOMException('域着色计算已取消','AbortError');
   const packed=new Float32Array(count*4);gpuCall('readback','域着色 GPU 读回失败',()=>{gl!.getBufferSubData(gl!.TRANSFORM_FEEDBACK_BUFFER,0,packed);if(gl!.isContextLost())throw new DomainGpuError('context','域着色 GPU 上下文已丢失');const error=gl!.getError();if(error!==gl!.NO_ERROR)throw new DomainGpuError('readback','域着色 GPU 执行失败 ('+error+')');});
   const values=new Float32Array(count*2),repair=new Uint8Array(count);for(let i=0;i<count;i++){values[i*2]=packed[i*4];values[i*2+1]=packed[i*4+1];repair[i]=!nativeExecution&&(packed[i*4+2]!==0||!Number.isFinite(values[i*2])||!Number.isFinite(values[i*2+1]))?1:0;}return{values,repair};
  }finally{release();}
 }
 render(model:DomainModel,width:number,height:number,pixels:Uint8ClampedArray,repairPixel:DomainRepairPixel,isCancelled?:()=>boolean){
  this.lastRaster=undefined;
  if(isCancelled?.())throw new DOMException('域着色计算已取消','AbortError');
  const prepared=prepareDomainRaster(model,width,height);if(pixels.length!==width*height*4)throw new Error('域着色 GPU 输出缓冲尺寸无效');const orbit=domainGpuSource(model);const result=renderDomainRaster(this.context(),this.ownCleanup,fragment=>this.program(prepared.vertexSource,fragment),orbit,model,width,height,pixels,repairPixel,isCancelled,prepared);this.lastRaster=result;return result;
 }
 dispose(){
  this.finishPendingCleanup();const gl=this.gl;this.lastRaster=undefined;if(!gl)return;
  const programs=[...this.programs.values()];this.programs.clear();
  this.ownCleanup(()=>{gl.useProgram(null);while(programs.length){gl.deleteProgram(programs[0].program);programs.shift();}gl.getExtension('WEBGL_lose_context')?.loseContext();this.gl=undefined;})();
 }
}
export const domainGpu=new DomainGpu();
