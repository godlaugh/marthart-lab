import {sourcePerlinGpuVertex,sourcePerlinGpuFragment} from './sourcePerlinGpuShader';

export interface SourcePerlinGpuUniforms {
 readonly time:number;readonly noiseFrequency:number;readonly warpAmplitude:number;readonly warpFrequency:number;
 readonly directionOffset:number;readonly timeSpeed:number;readonly marchSteps:number;readonly stepSize:number;
 readonly brightness:number;readonly vignettePower:number;readonly fiberStrength:number;readonly renderStyle:number;
}
export interface SourcePerlinGpuFrame extends SourcePerlinGpuUniforms {
 readonly width:number;readonly height:number;
 /** Packed ARGB from SourcePerlinColorRuntime.paletteTexture(). Alpha remains
  * in the texture; the source fragment samples RGB and writes opaque output. */
 readonly palette:Uint32Array;
}
export interface SourcePerlinGpuChannel {readonly size:512|1024|2048;readonly pixels:Uint32Array;}
export class SourcePerlinGpuError extends Error {
 constructor(readonly code:'input'|'capacity'|'capability'|'shader'|'render'|'cancelled'|'failed'|'disposed',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourcePerlinGpuError';}
}
export const SOURCE_PERLIN_GPU_LIMITS=Object.freeze({pixels:16_777_216,bytes:256*1024*1024,marchIterations:1_073_741_824});
const F=Math.fround;
const scalar=(v:unknown)=>{if(typeof v!=='number'||!Number.isFinite(v)||!Number.isFinite(F(v)))throw new SourcePerlinGpuError('input','Perlin GPU uniform 需要有限 float');return F(v);};
const integer=(v:unknown)=>{if(typeof v!=='number'||!Number.isInteger(v)||v< -2147483648||v>2147483647)throw new SourcePerlinGpuError('input','Perlin GPU 整数 uniform 需要 Java int');return v;};
export function sourcePerlinFlowTextureSize(width:number,height:number):512|1024|2048 {
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1)throw new SourcePerlinGpuError('input','Perlin 物理画布尺寸必须为正整数');
 const edge=Math.max(width,height);return edge>=2160?2048:edge>=1080?1024:512;
}
/** drawGpuNoise owns these clamps. Shader also clamps marchSteps to128 and
 * selects water only for renderStyle==1. Other positive styles are filament. */
export function prepareSourcePerlinGpuUniforms(raw:SourcePerlinGpuUniforms):SourcePerlinGpuUniforms {
 return Object.freeze({time:scalar(raw.time),noiseFrequency:Math.max(F(.01),scalar(raw.noiseFrequency)),warpAmplitude:Math.max(0,scalar(raw.warpAmplitude)),warpFrequency:Math.max(0,scalar(raw.warpFrequency)),directionOffset:scalar(raw.directionOffset),timeSpeed:scalar(raw.timeSpeed),marchSteps:Math.max(1,integer(raw.marchSteps)),stepSize:Math.max(F(.0001),scalar(raw.stepSize)),brightness:Math.max(0,scalar(raw.brightness)),vignettePower:Math.max(F(.001),scalar(raw.vignettePower)),fiberStrength:Math.max(0,Math.min(1,scalar(raw.fiberStrength))),renderStyle:Math.max(0,integer(raw.renderStyle))});
}
export function sourcePerlinGpuLayout(width:number,height:number,marchSteps:number){
 const size=sourcePerlinFlowTextureSize(width,height),pixels=width*height;
 if(pixels>SOURCE_PERLIN_GPU_LIMITS.pixels||width>16384||height>16384)throw new SourcePerlinGpuError('capacity','Perlin 画布超过本地 16777216 像素预算');
 const work=pixels*Math.max(1,Math.min(128,integer(marchSteps)));
 if(work>SOURCE_PERLIN_GPU_LIMITS.marchIterations)throw new SourcePerlinGpuError('capacity','Perlin 沿场迭代超过本地单帧预算');
 // Caller channel + owned upload + RGBA8 mip chain; output attachment/readback.
 // Counts typed representations, not driver bookkeeping or process RSS.
 const bytes=Math.ceil(size*size*(8+16/3))+pixels*8+width*4+4096;
 if(bytes>SOURCE_PERLIN_GPU_LIMITS.bytes)throw new SourcePerlinGpuError('capacity','Perlin 图像与纹理超过本地 256 MiB 表示预算');
 return Object.freeze({size,pixels,work,bytes});
}
function packedRgba(input:Uint32Array){
 const out=new Uint8Array(input.length*4);
 for(let i=0;i<input.length;i++){const c=input[i],p=i*4;out[p]=c>>>16;out[p+1]=c>>>8;out[p+2]=c;out[p+3]=c>>>24;}
 return out;
}
type Target={texture:WebGLTexture;framebuffer:WebGLFramebuffer;width:number;height:number};
/** One owned source channel bucket, reused across animation frames. Resolution
 * bucket changes require a new producer/channel. Never substitutes local noise
 * or CPU pixels after a GPU failure. */
export class SourcePerlinGpu {
 private gl?:WebGL2RenderingContext;
 private program?:WebGLProgram;
 private vao?:WebGLVertexArrayObject;
 private channel?:WebGLTexture;
 private palette?:WebGLTexture;
 private target?:Target;
 private upload?:Uint8Array;
 private readonly size:512|1024|2048;
 private readonly uniforms=new Map<string,WebGLUniformLocation|null>();
 private paletteBytes?:Uint8Array;
 private failed=false;
 private disposed=false;
 constructor(channel:SourcePerlinGpuChannel){
  if(!channel||![512,1024,2048].includes(channel.size)||!(channel.pixels instanceof Uint32Array)||channel.pixels.length!==channel.size*channel.size)throw new SourcePerlinGpuError('input','Perlin 通道必须为完整源尺寸 ARGB 纹理');
  this.size=channel.size;this.upload=packedRgba(channel.pixels);
 }
 private check(cancelled?:()=>boolean){
  if(this.disposed)throw new SourcePerlinGpuError('disposed','Perlin GPU 已释放');
  if(this.failed)throw new SourcePerlinGpuError('failed','Perlin GPU 先前失败，需要重建');
  if(cancelled?.())throw new SourcePerlinGpuError('cancelled','Perlin GPU 绘制已取消');
 }
 private texture(data:Uint8Array|null,width:number,height:number,mip:boolean){
  const g=this.gl!,t=g.createTexture();if(!t)throw new SourcePerlinGpuError('render','Perlin GPU 纹理分配失败');
  try{
   g.bindTexture(g.TEXTURE_2D,t);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,mip?g.LINEAR_MIPMAP_LINEAR:g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,mip?g.LINEAR:g.NEAREST);
   g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);
   g.texImage2D(g.TEXTURE_2D,0,g.RGBA8,width,height,0,g.RGBA,g.UNSIGNED_BYTE,data);if(mip)g.generateMipmap(g.TEXTURE_2D);return t;
  }catch(e){g.deleteTexture(t);throw e;}
 }
 private context(){
  if(this.gl?.isContextLost())throw new SourcePerlinGpuError('render','Perlin WebGL2 上下文丢失');
  if(this.gl)return this.gl;
  if(typeof OffscreenCanvas==='undefined')throw new SourcePerlinGpuError('capability','Perlin 需要 OffscreenCanvas WebGL2');
  const g=new OffscreenCanvas(1,1).getContext('webgl2',{alpha:true,antialias:false,depth:false,stencil:false,premultipliedAlpha:false});
  if(!g)throw new SourcePerlinGpuError('capability','Perlin WebGL2 不可用');this.gl=g;
  const precision=g.getShaderPrecisionFormat(g.FRAGMENT_SHADER,g.HIGH_FLOAT);if(!precision||precision.precision<23)throw new SourcePerlinGpuError('capability','Perlin 片元需要高精度 float');
  if(this.size>g.getParameter(g.MAX_TEXTURE_SIZE))throw new SourcePerlinGpuError('capacity','Perlin 通道超过 GPU 纹理尺寸');
  const p=g.createProgram();if(!p)throw new SourcePerlinGpuError('render','Perlin GPU 程序分配失败');this.program=p;
  const shaders:WebGLShader[]=[];
  try{
   for(const [kind,source] of [[g.VERTEX_SHADER,sourcePerlinGpuVertex],[g.FRAGMENT_SHADER,sourcePerlinGpuFragment]] as const){
    const s=g.createShader(kind);if(!s)throw new SourcePerlinGpuError('render','Perlin shader 分配失败');shaders.push(s);g.shaderSource(s,source);g.compileShader(s);
    if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw new SourcePerlinGpuError('shader',g.getShaderInfoLog(s)??'Perlin shader 编译失败');g.attachShader(p,s);
   }
   g.linkProgram(p);if(!g.getProgramParameter(p,g.LINK_STATUS))throw new SourcePerlinGpuError('shader',g.getProgramInfoLog(p)??'Perlin 程序链接失败');
  }finally{for(const s of shaders)g.deleteShader(s);}
  this.vao=g.createVertexArray()??undefined;if(!this.vao)throw new SourcePerlinGpuError('render','Perlin VAO 分配失败');
  g.pixelStorei(g.UNPACK_ALIGNMENT,1);g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL,false);g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
  this.channel=this.texture(this.upload!,this.size,this.size,true);this.upload=undefined;
  this.palette=this.texture(new Uint8Array(1024),256,1,true);
  return g;
 }
 private output(width:number,height:number){
  const g=this.gl!;if(this.target?.width===width&&this.target.height===height)return this.target;
  if(this.target){g.deleteFramebuffer(this.target.framebuffer);g.deleteTexture(this.target.texture);this.target=undefined;}
  const texture=this.texture(null,width,height,false),framebuffer=g.createFramebuffer();
  if(!framebuffer){g.deleteTexture(texture);throw new SourcePerlinGpuError('render','Perlin framebuffer 分配失败');}
  this.target={texture,framebuffer,width,height};g.bindFramebuffer(g.FRAMEBUFFER,framebuffer);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,texture,0);
  if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw new SourcePerlinGpuError('render','Perlin framebuffer 不完整');return this.target;
 }
 render(frame:SourcePerlinGpuFrame,cancelled?:()=>boolean):Uint8ClampedArray {
  try{
   this.check(cancelled);const u=prepareSourcePerlinGpuUniforms(frame),layout=sourcePerlinGpuLayout(frame.width,frame.height,u.marchSteps);
   if(layout.size!==this.size)throw new SourcePerlinGpuError('input','Perlin 分辨率档位改变，需要重建源通道');
   if(!(frame.palette instanceof Uint32Array)||frame.palette.length!==256)throw new SourcePerlinGpuError('input','Perlin 色板需要 256 项 ARGB');
   const g=this.context(),max=g.getParameter(g.MAX_TEXTURE_SIZE),viewport=g.getParameter(g.MAX_VIEWPORT_DIMS) as Int32Array;
   if(frame.width>Math.min(max,viewport[0])||frame.height>Math.min(max,viewport[1]))throw new SourcePerlinGpuError('capacity','Perlin 完整画布超过 GPU 容量；导数采样不能静默拆成小块');
   const out=this.output(frame.width,frame.height);g.useProgram(this.program!);g.bindVertexArray(this.vao!);
   const location=(name:string)=>{if(!this.uniforms.has(name))this.uniforms.set(name,g.getUniformLocation(this.program!,name));return this.uniforms.get(name)!;};
   g.uniform2f(location('u_resolution'),frame.width,frame.height);
   for(const key of ['time','noiseFrequency','warpAmplitude','warpFrequency','directionOffset','timeSpeed','stepSize','brightness','vignettePower','fiberStrength'] as const)g.uniform1f(location('u_'+key),u[key]);
   g.uniform1i(location('u_marchSteps'),u.marchSteps);g.uniform1i(location('u_renderStyle'),u.renderStyle);g.uniform1f(location('u_paletteSize'),256);g.uniform1i(location('u_useChannel0'),1);
   g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,this.channel!);g.uniform1i(location('u_channel0'),0);
   g.activeTexture(g.TEXTURE1);g.bindTexture(g.TEXTURE_2D,this.palette!);g.uniform1i(location('u_palette'),1);
   const bytes=packedRgba(frame.palette);
   if(!this.paletteBytes||bytes.some((v,i)=>v!==this.paletteBytes![i])){g.texSubImage2D(g.TEXTURE_2D,0,0,0,256,1,g.RGBA,g.UNSIGNED_BYTE,bytes);g.generateMipmap(g.TEXTURE_2D);this.paletteBytes=bytes;}
   g.bindFramebuffer(g.FRAMEBUFFER,out.framebuffer);g.viewport(0,0,frame.width,frame.height);g.disable(g.BLEND);g.disable(g.DEPTH_TEST);g.disable(g.SCISSOR_TEST);g.enable(g.DITHER);
   this.check(cancelled);g.drawArrays(g.TRIANGLES,0,3);
   const pixels=new Uint8ClampedArray(layout.pixels*4);g.readPixels(0,0,frame.width,frame.height,g.RGBA,g.UNSIGNED_BYTE,pixels);
   const error=g.getError();if(error!==g.NO_ERROR||g.isContextLost())throw new SourcePerlinGpuError('render',`Perlin GPU 绘制失败 (${error})`);
   const rowBytes=frame.width*4,row=new Uint8ClampedArray(rowBytes);
   for(let y=0;y<Math.floor(frame.height/2);y++){const a=y*rowBytes,b=(frame.height-1-y)*rowBytes;row.set(pixels.subarray(a,a+rowBytes));pixels.copyWithin(a,b,b+rowBytes);pixels.set(row,b);}
   this.check(cancelled);return pixels;
  }catch(e){this.failed=true;this.release();throw e;}
 }
 private release(){
  const g=this.gl;if(g){if(this.target){g.deleteFramebuffer(this.target.framebuffer);g.deleteTexture(this.target.texture);}g.deleteTexture(this.channel??null);g.deleteTexture(this.palette??null);g.deleteVertexArray(this.vao??null);g.deleteProgram(this.program??null);g.getExtension('WEBGL_lose_context')?.loseContext();}
  this.gl=undefined;this.target=undefined;this.channel=undefined;this.palette=undefined;this.vao=undefined;this.program=undefined;this.upload=undefined;this.paletteBytes=undefined;this.uniforms.clear();
 }
 dispose(){if(!this.disposed){this.release();this.disposed=true;}}
}
