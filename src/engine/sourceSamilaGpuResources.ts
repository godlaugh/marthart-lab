import {SOURCE_SAMILA_DIRECT_VERTICES} from './sourceSamilaGpuDirect';
import {densityGpuToneBytes,sourceDensityPresentationBytes} from './densityGpuTone';
export function sourceSamilaDirectGpuPlan(count:number,width:number,height:number,options:{observe?:boolean;textureLimit?:number;sourcePresentation?:boolean}={}){
 if(!Number.isInteger(count)||count<1||count>8_000_000||![width,height].every(n=>Number.isInteger(n)&&n>0&&n<=16384))throw Error('源 Samila direct 容量无效');
 const limit=options.textureLimit??2048;if(!Number.isInteger(limit)||limit<1)throw Error('源 Samila direct 纹理容量无效');
 const maxVertices=Math.min(SOURCE_SAMILA_DIRECT_VERTICES,count*36),tw=Math.min(256,limit,maxVertices),th=Math.ceil(maxVertices/tw),capacity=tw*th,rw=Math.ceil(tw/2),rh=Math.ceil(th/2);
 if(th>limit)throw Error('源 Samila 统计纹理超过设备容量');
 // At most six compensation batches and six vertices per quad sample.
 const maxChunks=Math.ceil(count*36/maxVertices),summaryWidth=Math.min(256,limit,maxChunks),summaryHeight=Math.ceil(maxChunks/summaryWidth),summaryBytes=summaryWidth*summaryHeight*16;
 if(summaryHeight>limit||Math.ceil(summaryWidth/2)>rw||Math.ceil(summaryHeight/2)>rh)throw Error('源 Samila 汇总超出共享归约纹理容量');
 const statisticsBytes=capacity*32+rw*rh*32+summaryBytes,observationBytes=options.observe?capacity*16:0;
 const residentBytes=width*height*32+statisticsBytes+observationBytes;
 const peakBytes=residentBytes+width*height*16+width*16+16+densityGpuToneBytes();
 return{model:'source-samila-direct' as const,count,width,height,tw,th,capacity,maxVertices,rw,rh,maxChunks,summaryWidth,summaryHeight,summaryBytes,statisticsBytes,observationBytes,residentBytes,peakBytes,estimatedBytes:peakBytes+256*256*4*2+1024*3*4*2+(options.sourcePresentation?sourceDensityPresentationBytes(width,height):0)};
}
/** Sole owner of direct-draw targets and bounded TF/reduction storage. It owns
 * no persistent particle positions; changing plan always releases the old owner. */
export class SourceSamilaGpuResources {
 readonly plan:ReturnType<typeof sourceSamilaDirectGpuPlan>;readonly count:number;readonly width:number;readonly height:number;readonly bytes:number;
 ink!:WebGLTexture;inkScratch!:WebGLTexture;framebuffer!:WebGLFramebuffer;feedback!:WebGLTransformFeedback;drawVao!:WebGLVertexArrayObject;
 statsBuffer!:WebGLBuffer;statsTexture!:WebGLTexture;summaryTexture!:WebGLTexture;reductions:WebGLTexture[]=[];observationBuffer?:WebGLBuffer;observationData?:Float32Array;
 sourceNoise?:WebGLTexture;sourcePalette?:WebGLTexture;splatPath?:'points'|'quad';paletteKey?:string;
 // Storage is allocated once. This framebuffer is only configured by target()
 // with COLOR_ATTACHMENT0, attachment1=null and drawBuffers([attachment0]).
 // Content uploads and viewport sizes cannot change its completeness.
 readonly validatedTargets=new Set<WebGLTexture>();
 ownsTarget(texture:WebGLTexture):boolean{return this.textures.includes(texture);}
 private initialized=false;private buffers:WebGLBuffer[]=[];private textures:WebGLTexture[]=[];private framebuffers:WebGLFramebuffer[]=[];private feedbacks:WebGLTransformFeedback[]=[];private vaos:WebGLVertexArrayObject[]=[];
 constructor(private gl:WebGL2RenderingContext,count:number,width:number,height:number,observe:boolean){
  this.plan=sourceSamilaDirectGpuPlan(count,width,height,{observe,textureLimit:gl.getParameter(gl.MAX_TEXTURE_SIZE)});this.count=count;this.width=width;this.height=height;this.bytes=this.plan.peakBytes;
  const viewport=gl.getParameter(gl.MAX_VIEWPORT_DIMS);if(width>gl.getParameter(gl.MAX_TEXTURE_SIZE)||height>gl.getParameter(gl.MAX_TEXTURE_SIZE)||width>viewport[0]||height>viewport[1]||this.plan.estimatedBytes>768*1024*1024)throw Error('源 Samila direct 目标超过设备或 768 MiB 容量');
 }
 initialize(){
  if(this.initialized)throw Error('源 Samila direct 资源已初始化或待清理');this.initialized=true;
  const gl=this.gl,{width,height}=this,observe=this.plan.observationBytes>0;
  const buffer=(bytes:number)=>{const b=gl.createBuffer();if(!b)throw Error('源 Samila TF 分配失败');this.buffers.push(b);gl.bindBuffer(gl.ARRAY_BUFFER,b);try{gl.bufferData(gl.ARRAY_BUFFER,bytes,gl.DYNAMIC_COPY);}finally{gl.bindBuffer(gl.ARRAY_BUFFER,null);}return b;};
  const texture=(w:number,h:number,format:number,layout:number,type:number)=>{const t=gl.createTexture();if(!t)throw Error('源 Samila 纹理分配失败');this.textures.push(t);gl.bindTexture(gl.TEXTURE_2D,t);for(const n of[gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,n,gl.NEAREST);for(const n of[gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,n,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,format,w,h,0,layout,type,null);return t;};
  const p=this.plan;this.ink=texture(width,height,gl.RGBA32F,gl.RGBA,gl.FLOAT);this.inkScratch=texture(width,height,gl.RGBA32F,gl.RGBA,gl.FLOAT);this.statsBuffer=buffer(p.capacity*16);this.statsTexture=texture(p.tw,p.th,gl.RGBA32UI,gl.RGBA_INTEGER,gl.UNSIGNED_INT);this.summaryTexture=texture(p.summaryWidth,p.summaryHeight,gl.RGBA32UI,gl.RGBA_INTEGER,gl.UNSIGNED_INT);this.reductions=[texture(p.rw,p.rh,gl.RGBA32UI,gl.RGBA_INTEGER,gl.UNSIGNED_INT),texture(p.rw,p.rh,gl.RGBA32UI,gl.RGBA_INTEGER,gl.UNSIGNED_INT)];
   if(observe){this.observationBuffer=buffer(p.capacity*8);this.observationData=new Float32Array(p.capacity*2);}
   this.framebuffer=gl.createFramebuffer()!;if(this.framebuffer)this.framebuffers.push(this.framebuffer);this.feedback=gl.createTransformFeedback()!;if(this.feedback)this.feedbacks.push(this.feedback);this.drawVao=gl.createVertexArray()!;if(this.drawVao)this.vaos.push(this.drawVao);
   if(!this.framebuffer||!this.feedback||!this.drawVao||gl.getError()!==gl.NO_ERROR)throw Error('源 Samila direct 资源分配失败');
 }
 dispose(){this.validatedTargets.clear();const gl=this.gl,errors:unknown[]=[];
  const release=<T>(owned:T[],remove:(resource:T)=>void)=>{for(let i=owned.length-1;i>=0;i--){try{remove(owned[i]);owned.splice(i,1);}catch(error){errors.push(error);}}};
  release(this.buffers,b=>gl.deleteBuffer(b));release(this.textures,t=>gl.deleteTexture(t));release(this.framebuffers,f=>gl.deleteFramebuffer(f));release(this.feedbacks,f=>gl.deleteTransformFeedback(f));release(this.vaos,v=>gl.deleteVertexArray(v));
  for(const key of ['sourceNoise','sourcePalette'] as const)if(this[key])try{gl.deleteTexture(this[key]!);this[key]=undefined;}catch(error){errors.push(error);}
  if(errors.length)throw new AggregateError(errors,'源 Samila direct 资源清理未完成；保留所有权待重试');this.observationData=undefined;
 }
}
