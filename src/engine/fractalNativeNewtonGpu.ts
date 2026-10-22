import type {SourceFractalDisplayFacts} from './sourceFractalDisplay';
import type {FractalConfig} from '../scenes/complex';
import type {GpuOrbitBatch} from './fractalGpu';
import type {FractalColors} from './fractalColor';
import {uploadFractalTrace} from './fractalColorGpu';
import {FractalSourceReferenceCache,validateFractalSourcePlan,type FractalSourcePlan,type FractalSourceReferenceReady,type FractalViewport} from './fractalPrecision';
import {FractalSourceGpuError,fractalSourceRequire as require,fractalSourceDevice as device,fractalSourceCancel as cancel} from './fractalSourceGpuFailure';
import {FRACTAL_SOURCE_RASTER_VERTEX,FRACTAL_SOURCE_NEWTON_VERTEX,FRACTAL_SOURCE_TF_FRAGMENT,FRACTAL_SOURCE_TF_VARYINGS,FRACTAL_SOURCE_TF_STRIDE as STRIDE} from './fractalNativeNewtonKernel';
import {FRACTAL_SOURCE_RASTER_FRAGMENT,FRACTAL_SOURCE_COLOR_RASTER_FRAGMENT,decodeFractalSourceTerminal} from './fractalNativeNewtonRaster';

import {validatePreparedFractalSourceColor,type PreparedFractalSourceColor} from './fractalSourceColor';

const SOURCE_COLOR_LUT_BYTES=1024*3*4;
const FALLBACK_TEXTURE_BYTES=12;
const MAX_SAMPLES=65536,MAX_BYTES=768*1024*1024,MAX_DRAW_WORK=2_000_000;
/** Representation preflight, including the rarely needed second readback that
 * distinguishes legitimate NaN payloads from an incomplete GL read.
 * Includes two old 2048-entry CPU arrays and its still-owned GPU texture while replacing a shorter
 * reference/cache copy, plus the new cache, copy and GPU texture. Driver
 * Native color additionally charges old/new LUT representations, returned RGBA
 * bytes and a mixed 52-byte/pixel MRT target. Driver internal storage and the
 * caller's final assembled image/color arrays are not included. Raster requests
 * also charge the uint32 permutation; in-place heap sorting uses constant scratch. Row readbacks
 * never exceed count, including holes coalesced between requested pixels. */
export function fractalSourceGpuBytes(width:number,height:number,count:number,referenceLength:number,direct=false,sourceColor=false):number {
 require([width,height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=16384),'Source fractal dimensions exceed the image capacity','capacity');
 require(Number.isSafeInteger(count)&&count>=0&&count<=MAX_SAMPLES,'Source fractal batch exceeds 65536 samples','capacity');
 require(Number.isSafeInteger(referenceLength)&&referenceLength>=0&&referenceLength<=2048,'Source reference exceeds 2048 entries','capacity');
 return (direct?0:width*height*(sourceColor?52:64)+count*4)+(sourceColor?5*SOURCE_COLOR_LUT_BYTES+FALLBACK_TEXTURE_BYTES+count*4:0)+count*(16+16+STRIDE*4*4)+referenceLength*16*3+2048*16*3+1025*2*4*4*2+6*4*4;
}
function bytes(length:number):Uint8Array {try{return new Uint8Array(length);}catch(cause){throw new FractalSourceGpuError('Source fractal byte buffer allocation failed','capacity',{cause});}}
function floats(length:number):Float32Array {try{return new Float32Array(length);}catch(cause){throw new FractalSourceGpuError('Source fractal typed buffer allocation failed','capacity',{cause});}}
type Kind='texture'|'buffer'|'program'|'shader'|'vao'|'feedback'|'framebuffer';
type Handle=WebGLTexture|WebGLBuffer|WebGLProgram|WebGLShader|WebGLVertexArrayObject|WebGLTransformFeedback|WebGLFramebuffer;
interface Owned {kind:Kind;handle:Handle;}

/** One owned context, four-attachment raster target and reference/cache. Whole-request
 * failures release resources or retain failed cleanup for dispose retry. */
export class FractalSourceNewtonGpu {
 private gl?:WebGL2RenderingContext;
 private owned:Owned[]=[];
 private cleanupPending=false;
 private orbitProgram?:WebGLProgram;private rasterProgram?:WebGLProgram;private colorProgram?:WebGLProgram;
 private rasterTextures:WebGLTexture[]=[];private rasterFbo?:WebGLFramebuffer;private rasterSize?:string;
 private referenceTexture?:WebGLTexture;private referenceKey?:string;private referenceCopy?:Float32Array;
 private input?:WebGLBuffer;private output?:WebGLBuffer;private vao?:WebGLVertexArrayObject;private feedback?:WebGLTransformFeedback;
 private quadVertices?:WebGLBuffer;private quadVao?:WebGLVertexArrayObject;
 private traceTexture?:WebGLTexture|null;private traceColors?:FractalColors;private traceProgram?:WebGLProgram;
 private fallbackTexture?:WebGLTexture;private colorTexture?:WebGLTexture;private colorLutKey?:string;private colorLutCopy?:Float32Array;private colorPlanKey?:string;
 private colorUploads=0;private colorHits=0;private colorSamples=0;
 private activeFeedback=false;
 private readonly references=new FractalSourceReferenceCache();
 private referenceUploads=0;private referenceHits=0;private rasterDraws=0;private rasterAllocations=0;private draws=0;private samples=0;private glitches=0;private perturbSamples=0;private ordinarySteps=0;private perturbSteps=0;
 private rasterBytes=0;private bufferBytes=0;private peakBytes=0;
 diagnostics(){return{contextOwned:!!this.gl,ownedHandles:this.owned.length,cleanupPending:this.cleanupPending,reference:this.references.diagnostics(),referenceUploads:this.referenceUploads,referenceHits:this.referenceHits,rasterDraws:this.rasterDraws,rasterAllocations:this.rasterAllocations,draws:this.draws,samples:this.samples,glitches:this.glitches,perturbSamples:this.perturbSamples,ordinarySteps:this.ordinarySteps,perturbSteps:this.perturbSteps,colorPlanKey:this.colorPlanKey,colorLutKey:this.colorLutKey,colorUploads:this.colorUploads,colorHits:this.colorHits,colorSamples:this.colorSamples,retainedCpuBytes:(this.references.diagnostics().retainedBytes)+(this.referenceCopy?.byteLength??0)+(this.colorLutCopy?.byteLength??0),retainedGpuBytes:this.rasterBytes+this.bufferBytes+(this.quadVertices?6*4*4:0)+(this.referenceCopy?.byteLength??0)+(this.traceTexture?1025*2*16:0)+(this.colorTexture?SOURCE_COLOR_LUT_BYTES:0)+(this.fallbackTexture?FALLBACK_TEXTURE_BYTES:0),estimatedPeakBytes:this.peakBytes};}
 prepareReference(plan:FractalSourcePlan,options:{isCancelled?:()=>boolean;onBytes?:(bytes:number)=>void}={}){return this.references.prepare(plan,options);}
 private own<T extends Handle>(kind:Kind,handle:T|null):T {require(handle,'Source fractal '+kind+' allocation failed','device');this.owned.push({kind,handle});return handle;}
 private release(handle:Handle){const index=this.owned.findIndex(v=>v.handle===handle);if(index<0)return;const gl=this.gl!,v=this.owned[index];
  try{switch(v.kind){case'texture':gl.deleteTexture(v.handle);break;case'buffer':gl.deleteBuffer(v.handle);break;case'program':gl.deleteProgram(v.handle);break;case'shader':gl.deleteShader(v.handle);break;case'vao':gl.deleteVertexArray(v.handle);break;case'feedback':gl.deleteTransformFeedback(v.handle);break;case'framebuffer':gl.deleteFramebuffer(v.handle);break;}const code=gl.getError();if(code!==gl.NO_ERROR)throw new Error('GL resource deletion failed ('+code+')');}
  catch(cause){this.cleanupPending=true;throw new FractalSourceGpuError('Source fractal resource cleanup failed','cleanup',{cause});}
  this.owned.splice(index,1);
 }
 private checkDevice(stage:string){const gl=this.gl!,error=device(()=>gl.getError());require(error===gl.NO_ERROR&&!device(()=>gl.isContextLost()),'Source fractal '+stage+' failed ('+error+')','device');}
 private program(vertex:string,fragment:string,feedback=false):WebGLProgram {
  const gl=this.gl!,program=this.own('program',device(()=>gl.createProgram()));
  const shaders:WebGLShader[]=[];
  for(const[type,source]of[[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]] as const){const shader=this.own('shader',device(()=>gl.createShader(type)));shaders.push(shader);device(()=>{gl.shaderSource(shader,source);gl.compileShader(shader);});require(device(()=>gl.getShaderParameter(shader,gl.COMPILE_STATUS)),device(()=>gl.getShaderInfoLog(shader))??'Source fractal shader compilation failed','device');device(()=>gl.attachShader(program,shader));}
  if(feedback)device(()=>gl.transformFeedbackVaryings(program,[...FRACTAL_SOURCE_TF_VARYINGS],gl.INTERLEAVED_ATTRIBS));
  device(()=>gl.linkProgram(program));require(device(()=>gl.getProgramParameter(program,gl.LINK_STATUS)),device(()=>gl.getProgramInfoLog(program))??'Source fractal program link failed','device');
  for(const shader of shaders)this.release(shader);return program;
 }
 private context(){
  require(!this.cleanupPending,'Source fractal cleanup must finish before reuse','cleanup');
  if(this.gl&&device(()=>this.gl!.isContextLost())){this.clearLostContext();throw new FractalSourceGpuError('Source fractal context was lost','device');}
  if(!this.gl){require(typeof OffscreenCanvas!=='undefined','Source fractal requires OffscreenCanvas WebGL2','device');const gl=device(()=>new OffscreenCanvas(1,1).getContext('webgl2',{alpha:false,antialias:false,depth:false,preserveDrawingBuffer:false}));require(gl,'Source fractal WebGL2 is unavailable','device');this.gl=gl;
   require(device(()=>gl.getParameter(gl.MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS))>=STRIDE,'Source fractal transform-feedback capacity is insufficient','device');
   require(device(()=>gl.getExtension('EXT_color_buffer_float')),'Source fractal float attachment is unavailable','device');
   require(device(()=>gl.getParameter(gl.MAX_DRAW_BUFFERS))>=4&&device(()=>gl.getParameter(gl.MAX_COLOR_ATTACHMENTS))>=4,'Source fractal needs four float attachments','device');
   this.orbitProgram=this.program(FRACTAL_SOURCE_NEWTON_VERTEX,FRACTAL_SOURCE_TF_FRAGMENT,true);
   this.rasterProgram=this.program(FRACTAL_SOURCE_RASTER_VERTEX,FRACTAL_SOURCE_RASTER_FRAGMENT);
   this.input=this.own('buffer',device(()=>gl.createBuffer()));this.output=this.own('buffer',device(()=>gl.createBuffer()));this.vao=this.own('vao',device(()=>gl.createVertexArray()));this.feedback=this.own('feedback',device(()=>gl.createTransformFeedback()));
   this.quadVertices=this.own('buffer',device(()=>gl.createBuffer()));this.quadVao=this.own('vao',device(()=>gl.createVertexArray()));
   device(()=>{gl.bindVertexArray(this.quadVao!);gl.bindBuffer(gl.ARRAY_BUFFER,this.quadVertices!);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,1,0,0, 1,1,1,0, 1,-1,1,1, 1,-1,1,1, -1,-1,0,1, -1,1,0,0]),gl.STATIC_DRAW);for(let i=0;i<2;i++){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,2,gl.FLOAT,false,16,i*8);}gl.bindVertexArray(null);});
  }return this.gl;
 }
 private texture(){const gl=this.gl!,t=this.own('texture',device(()=>gl.createTexture()));device(()=>{gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);});return t;}
 private ensureRaster(width:number,height:number,sourceColor=false){
  const size=width+':'+height+':'+sourceColor;if(this.rasterSize===size)return;
  const gl=this.gl!,max=device(()=>gl.getParameter(gl.MAX_TEXTURE_SIZE)),viewport=device(()=>gl.getParameter(gl.MAX_VIEWPORT_DIMS));
  require(width<=max&&height<=max&&width<=viewport[0]&&height<=viewport[1],'Source raster target exceeds GPU dimensions','device');
  for(const t of this.rasterTextures)this.release(t);if(this.rasterFbo)this.release(this.rasterFbo);this.rasterTextures=[];this.rasterFbo=undefined;this.rasterSize=undefined;
  this.rasterFbo=this.own('framebuffer',device(()=>gl.createFramebuffer()));device(()=>{gl.bindFramebuffer(gl.FRAMEBUFFER,this.rasterFbo!);gl.activeTexture(gl.TEXTURE0);});
  for(let attachment=0;attachment<4;attachment++){
   const texture=this.texture();this.rasterTextures.push(texture);
   device(()=>{gl.texImage2D(gl.TEXTURE_2D,0,sourceColor&&attachment===2?gl.RGBA8:gl.RGBA32F,width,height,0,gl.RGBA,sourceColor&&attachment===2?gl.UNSIGNED_BYTE:gl.FLOAT,null);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+attachment,gl.TEXTURE_2D,texture,0);});
  }
  device(()=>gl.drawBuffers([0,1,2,3].map(n=>gl.COLOR_ATTACHMENT0+n)));
  require(device(()=>gl.checkFramebufferStatus(gl.FRAMEBUFFER))===gl.FRAMEBUFFER_COMPLETE,'Source raster framebuffer is incomplete','device');this.checkDevice('raster allocation');
  this.rasterSize=size;this.rasterBytes=width*height*(sourceColor?52:64);this.rasterAllocations++;
 }
 private ensureReference(reference:FractalSourceReferenceReady|undefined){
  const gl=this.gl!,values=reference?.values??new Float32Array(4),key=reference?.key??'ordinary-no-reference';
  const same=key===this.referenceKey&&this.referenceCopy?.length===values.length&&values.every((x,i)=>Object.is(x,this.referenceCopy![i]));
  if(same){this.referenceHits++;return;}
  require((reference?.length??1)<=device(()=>gl.getParameter(gl.MAX_TEXTURE_SIZE)),'Source reference exceeds the GPU texture capacity','device');
  if(this.referenceTexture)this.release(this.referenceTexture);this.referenceTexture=undefined;this.referenceKey=undefined;
  device(()=>gl.activeTexture(gl.TEXTURE2));this.referenceTexture=this.texture();device(()=>gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,reference?.length??1,1,0,gl.RGBA,gl.FLOAT,values));this.checkDevice('reference upload');this.referenceCopy=floats(values.length);this.referenceCopy.set(values);this.referenceKey=key;this.referenceUploads++;
 }
 private trace(colors:FractalColors|undefined,program:WebGLProgram){
  if(this.traceTexture!==undefined&&colors===this.traceColors&&program===this.traceProgram){if(this.traceTexture)device(()=>{this.gl!.activeTexture(this.gl!.TEXTURE1);this.gl!.bindTexture(this.gl!.TEXTURE_2D,this.traceTexture!);});return;}
  if(this.traceTexture)this.release(this.traceTexture);this.traceTexture=undefined;
  // Shared parsed color facts and upload; the allocation hook gives this owner
  // custody before any upload can fail.
  this.traceTexture=uploadFractalTrace(this.gl!,program,colors,t=>{this.own('texture',t);},device);this.traceColors=colors;this.traceProgram=program;
 }
 /** The parsed owner supplies the full LUT. A private copy makes cache reuse
  * depend on its actual bytes as well as its canonical key. */
 private sourceColor(plan:PreparedFractalSourceColor,program:WebGLProgram,display?:SourceFractalDisplayFacts){
  const gl=this.gl!,same=this.colorTexture&&this.colorLutKey===plan.lutKey&&this.colorLutCopy?.length===plan.lut.length&&plan.lut.every((x,i)=>Object.is(x,this.colorLutCopy![i]));
  if((!display||display.useGradientTexture)&&!same){
   require(plan.lutSize<=device(()=>gl.getParameter(gl.MAX_TEXTURE_SIZE)),'Source color LUT exceeds GPU texture capacity','device');
   if(this.colorTexture)this.release(this.colorTexture);this.colorTexture=undefined;this.colorLutKey=undefined;this.colorLutCopy=undefined;
   device(()=>gl.activeTexture(gl.TEXTURE1));this.colorTexture=this.texture();
   device(()=>gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB32F,plan.lutSize,1,0,gl.RGB,gl.FLOAT,plan.lut));this.checkDevice('color LUT upload');
   this.colorLutCopy=floats(plan.lut.length);this.colorLutCopy.set(plan.lut);this.colorLutKey=plan.lutKey;this.colorUploads++;
  }else if(!display||display.useGradientTexture)this.colorHits++;
  const loc=(n:string)=>device(()=>gl.getUniformLocation(program,n));
  if(display&&!display.useGradientTexture&&!this.fallbackTexture){
   device(()=>gl.activeTexture(gl.TEXTURE1));this.fallbackTexture=this.texture();device(()=>gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB32F,1,1,0,gl.RGB,gl.FLOAT,new Float32Array(3)));this.checkDevice('fallback palette upload');
  }
  device(()=>{
   gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,display&&!display.useGradientTexture?this.fallbackTexture!:this.colorTexture!);gl.uniform1i(loc('u_gradientTex'),1);gl.uniform1i(loc('u_gradientSize'),display?.gradientSize??plan.lutSize);
   const p=plan.fallback;gl.uniform1i(loc('u_paletteSize'),p.size);if(p.size)gl.uniform3fv(loc('u_palette[0]'),p.colors);
   gl.uniform1f(loc('u_paletteOffset'),p.offset);gl.uniform1f(loc('u_paletteGamma'),p.gamma);gl.uniform1i(loc('u_paletteSpace'),p.space);gl.uniform1i(loc('u_useCosinePalette'),p.useCosine?1:0);
   for(const k of ['a','b','c','d'] as const)gl.uniform3fv(loc('u_cos'+k.toUpperCase()),p.cosine[k]);
   for(const side of ['inside','outside'] as const){const p=plan[side],prefix='u_'+side;
    gl.uniform1i(loc(prefix+'ColoringAlgorithm'),p.algorithmId);gl.uniform4fv(loc(prefix+'ColoringParams0'),p.p0);gl.uniform4fv(loc(prefix+'ColoringParams1'),p.p1);gl.uniform4fv(loc(prefix+'ColoringParams2'),p.p2);
    gl.uniform4f(loc(prefix+'SolidColor'),...p.solid,1);gl.uniform1i(loc(prefix+'TransferFunction'),p.transferId);gl.uniform1f(loc(prefix+'ColorDensity'),p.density);gl.uniform1f(loc(prefix+'GradientOffset'),p.offset);gl.uniform1i(loc(prefix+'RepeatGradient'),p.repeat?1:0);
   }
  });
 }
 sample(points:Float32Array,width:number,height:number,_view:FractalViewport,c:FractalConfig,plan:FractalSourcePlan,colors?:FractalColors,isCancelled?:()=>boolean,colorPlan?:PreparedFractalSourceColor,display?:SourceFractalDisplayFacts):GpuOrbitBatch {
  return this.sampleInternal(points,width,height,c,plan,colors,isCancelled,false,undefined,colorPlan,display);
 }
 /** Independent orbit-level test bridge: supplied DS offsets do not assert
  * native fragment interpolation. Production always calls sample(). */
 sampleOffsets(offsets:Float32Array,c:FractalConfig,plan:FractalSourcePlan,reference:FractalSourceReferenceReady|undefined,colors?:FractalColors,isCancelled?:()=>boolean):GpuOrbitBatch {
  return this.sampleInternal(offsets,1,1,c,plan,colors,isCancelled,true,reference);
 }
 private sampleInternal(points:Float32Array,width:number,height:number,c:FractalConfig,plan:FractalSourcePlan,colors:FractalColors|undefined,isCancelled:(()=>boolean)|undefined,direct:boolean,override?:FractalSourceReferenceReady,colorPlan?:PreparedFractalSourceColor,display?:SourceFractalDisplayFacts):GpuOrbitBatch {
  validateFractalSourcePlan(plan);require(!direct||plan.formula==='newton'||plan.formula==='nova','The direct-offset diagnostic supports Newton/Nova only');if(colorPlan)validatePreparedFractalSourceColor(colorPlan);cancel(isCancelled);require(points instanceof Float32Array&&points.length%(direct?4:2)===0&&(direct||points.every(Number.isFinite)),'Source GPU expects pixel/DS-offset records');
  require(plan.formula===c.formula&&['newton','nova','mandelbrot','julia'].includes(plan.formula),'Source GPU requires a matching source formula plan');
  // New CPU outputs exist before a differently sized old target is released.
  // The explicit TF bridge may also retain its previous buffer allocation.
  // Charge those actual held representations, even for a smaller next request.
  const count=points.length/(direct?4:2),newRasterBytes=direct?0:width*height*(colorPlan?52:64);
  const taskBytes=fractalSourceGpuBytes(width,height,count,plan.reference.length,direct,!!colorPlan)+Math.max(0,this.rasterBytes-newRasterBytes)+this.bufferBytes+(colorPlan?0:(this.colorLutCopy?.byteLength??0)+(this.colorTexture?SOURCE_COLOR_LUT_BYTES:0)+(this.fallbackTexture?FALLBACK_TEXTURE_BYTES:0));
  require(taskBytes<=MAX_BYTES,'Source fractal GPU representations exceed 768 MiB','capacity');this.peakBytes=Math.max(this.peakBytes,taskBytes);
  if(!direct)for(let i=0;i<points.length;i+=2)require(Number.isInteger(points[i])&&Number.isInteger(points[i+1])&&points[i]>=0&&points[i]<width&&points[i+1]>=0&&points[i+1]<height,'Source GPU needs actual integer pixels inside this raster');
  if(!count)return{values:new Float32Array(),residual:new Float32Array(),source:new Float32Array(),...(colorPlan?{sourceRGBA:new Uint8Array()}: {})};
  const prepared=direct?override:this.prepareReference(plan,{isCancelled}).reference;
  const reference=prepared?.kind==='ready'?prepared:undefined;
  if(reference)require(reference.layout==='real-hi-low-imag-hi-low'&&reference.length>0&&reference.length<=2048&&reference.values instanceof Float32Array&&reference.values.length===reference.length*4&&reference.key===plan.key,'Malformed/mismatched source reference');
  const maxIter=Math.min(plan.iterations,reference?.length??2048,2048);
  const workPerPixel=maxIter*(reference?Math.max(1,plan.shaderIntegerPower):16);
  require(Number.isSafeInteger(workPerPixel)&&workPerPixel>0&&workPerPixel<=MAX_DRAW_WORK,'One source orbit exceeds the bounded GPU draw work','capacity');
  const drawCount=Math.max(1,Math.min(count,Math.floor(MAX_DRAW_WORK/workPerPixel)));
  const values=floats(count*8),residual=floats(count*8),traps=colors&&!colorPlan?floats(count*8):undefined,distance=c.distance?.requested?floats(count*12):undefined,source=floats(count*4),sourceRGBA=colorPlan?bytes(count*4):undefined;
  try{
   const gl=this.context();this.ensureReference(reference);
   if(!direct){this.renderRaster(points,width,height,c,plan,reference,colors,isCancelled,drawCount,maxIter,{values,residual,traps,distance,source,sourceRGBA},colorPlan,display);cancel(isCancelled);return{values,residual,traps,distance,source,...(sourceRGBA?{sourceRGBA}:{})};}
   device(()=>gl.useProgram(this.orbitProgram!));this.trace(colors,this.orbitProgram!);
   const loc=(n:string)=>device(()=>gl.getUniformLocation(this.orbitProgram!,n));
   device(()=>{
    gl.uniform4fv(loc('centerDS'),plan.shaderCenter);gl.uniform4fv(loc('sourceSeed'),plan.shaderJuliaConstant);gl.uniform2fv(loc('shaderPower'),plan.shaderPower);
    gl.uniform1f(loc('relaxation'),plan.shaderRelaxation);gl.uniform1f(loc('sourceBailout'),plan.bailout);gl.uniform2fv(loc('sourceZoom'),plan.zoom);gl.uniform2fv(loc('sourceResolution'),plan.logicalSize);gl.uniform1f(loc('perturbThreshold'),plan.perturbation.threshold);gl.uniform1f(loc('perturbAbsFactor'),plan.perturbation.absFactor);gl.uniform1f(loc('perturbRelLimit'),plan.perturbation.relLimit);
    gl.uniform1i(loc('formulaNova'),plan.formula==='nova'?1:0);gl.uniform1i(loc('isJulia'),plan.isJulia?1:0);gl.uniform1i(loc('iterations'),plan.iterations);gl.uniform1i(loc('perturb'),reference?1:0);gl.uniform1i(loc('referenceLength'),reference?.length??0);gl.uniform1i(loc('integerPower'),plan.shaderIntegerPower);
    gl.uniform4f(loc('legacyTrap'),...c.trapCenter,c.trapRadius,c.trapAspect);gl.uniform3f(loc('legacyTrapShape'),Math.cos(c.trapRotation),Math.sin(c.trapRotation),['point','ring','cross'].indexOf(c.trapShape));
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.referenceTexture!);gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.referenceTexture!);gl.uniform1i(loc('referenceTexture'),2);
   });
   for(let base=0;base<count;base+=drawCount){
    cancel(isCancelled);const n=Math.min(drawCount,count-base),components=direct?4:2,chunk=points.subarray(base*components,(base+n)*components),packed=floats(n*STRIDE),bits=new Uint32Array(packed.buffer);bits.fill(0x7fc0f00d);
    device(()=>{gl.bindVertexArray(this.vao!);gl.bindBuffer(gl.ARRAY_BUFFER,this.input!);gl.bufferData(gl.ARRAY_BUFFER,chunk,gl.STREAM_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,components,gl.FLOAT,false,0,0);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,this.feedback!);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,this.output!);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,packed.byteLength,gl.STREAM_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,this.output!);gl.enable(gl.RASTERIZER_DISCARD);gl.beginTransformFeedback(gl.POINTS);});this.activeFeedback=true;
    device(()=>gl.drawArrays(gl.POINTS,0,n));device(()=>gl.endTransformFeedback());this.activeFeedback=false;
    device(()=>gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,packed));this.checkDevice('orbit readback');
    if(bits.some(x=>x===0x7fc0f00d)){
     // A real source NaN may share the sentinel payload: a differently filled
     // second read proves full writes without banning legitimate nonfinites.
     const again=new Uint32Array(packed.length);again.fill(0xffc0e00e);device(()=>gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,again));this.checkDevice('readback confirmation');require(bits.every((x,i)=>x===again[i]),'Source fractal returned an incomplete orbit record','device');
    }
    for(let i=0;i<n;i++){const k=i*STRIDE,o=base+i,steps=packed[k+2],status=packed[k+3],metric=packed[k+14],iteration=packed[k+15];
     require(Number.isInteger(steps)&&steps>=1&&steps<=maxIter&&[1,4].includes(status)&&packed[k+7]===0&&Number.isInteger(iteration)&&iteration===steps-1&&metric===(status===4?1:0),'Source fractal returned invalid terminal metadata','device');
     const numeric=packed.subarray(k+36,k+40);require([0,1].includes(numeric[0])&&[0,1].includes(numeric[1])&&numeric.slice(2).every(v=>Number.isInteger(v)&&v>=0)&&numeric[2]+numeric[3]===steps,'Source fractal returned invalid execution facts','device');
     require(packed[k+27]===0&&packed[k+30]===iteration&&packed[k+31]===(status===4?2:0)&&packed[k+33]===numeric[0],'Source fractal returned inconsistent DE facts','device');
     values.set(packed.subarray(k,k+8),o*8);residual.set(packed.subarray(k+8,k+16),o*8);traps?.set(packed.subarray(k+16,k+24),o*8);distance?.set(packed.subarray(k+24,k+36),o*12);source.set(numeric,o*4);this.glitches+=numeric[1];this.perturbSamples+=numeric[0];this.ordinarySteps+=numeric[2];this.perturbSteps+=numeric[3];
    }
    this.bufferBytes=chunk.byteLength+packed.byteLength;this.draws++;this.samples+=n;
   }
   device(()=>{gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindVertexArray(null);gl.activeTexture(gl.TEXTURE0);});cancel(isCancelled);
   return{values,residual,traps,distance,source};
  }catch(error){
   try{this.reset();}catch(cleanup){throw new FractalSourceGpuError('Source fractal operation and cleanup failed','cleanup',{cause:new AggregateError([error,cleanup])});}
   throw error;
  }
 }
 private renderRaster(points:Float32Array,width:number,height:number,c:FractalConfig,plan:FractalSourcePlan,reference:FractalSourceReferenceReady|undefined,colors:FractalColors|undefined,isCancelled:(()=>boolean)|undefined,drawCount:number,maxIter:number,out:{values:Float32Array;residual:Float32Array;traps?:Float32Array;distance?:Float32Array;source:Float32Array;sourceRGBA?:Uint8Array},colorPlan?:PreparedFractalSourceColor,display?:SourceFractalDisplayFacts){
  const gl=this.gl!,program=colorPlan?(this.colorProgram??=this.program(FRACTAL_SOURCE_RASTER_VERTEX,FRACTAL_SOURCE_COLOR_RASTER_FRAGMENT)):this.rasterProgram!,loc=(n:string)=>device(()=>gl.getUniformLocation(program,n));this.ensureRaster(width,height,!!colorPlan);
  device(()=>gl.useProgram(program));if(colorPlan)this.sourceColor(colorPlan,program,display);else this.trace(colors,program);
  device(()=>{
   gl.uniform2fv(loc('u_resolution'),plan.logicalSize);gl.uniform2fv(loc('u_centerHigh'),[plan.shaderCenter[0],plan.shaderCenter[2]]);gl.uniform2fv(loc('u_centerLow'),[plan.shaderCenter[1],plan.shaderCenter[3]]);gl.uniform2fv(loc('u_zoomDS'),plan.zoom);
   gl.uniform2fv(loc('u_juliaConstantHigh'),[plan.shaderJuliaConstant[0],plan.shaderJuliaConstant[2]]);gl.uniform2fv(loc('u_juliaConstantLow'),[plan.shaderJuliaConstant[1],plan.shaderJuliaConstant[3]]);
   gl.uniform1f(loc('u_rotation'),plan.rotation);gl.uniform1f(loc('u_previewScale'),display?.previewScale??1);gl.uniform1f(loc('u_bailout'),plan.bailout);gl.uniform1f(loc('u_perturbationThreshold'),plan.perturbation.threshold);gl.uniform1f(loc('u_perturbationAbsFactor'),plan.perturbation.absFactor);gl.uniform1f(loc('u_perturbationRelLimit'),plan.perturbation.relLimit);
   gl.uniform1i(loc('u_formulaId'),plan.formula==='newton'?2:plan.formula==='nova'?3:plan.formula==='julia'?1:0);gl.uniform1i(loc('u_type'),plan.isJulia?1:0);gl.uniform1i(loc('u_formulaType'),0);gl.uniform1i(loc('u_power'),plan.uniformPower);gl.uniform1i(loc('u_formulaSupportsPerturbation'),1);gl.uniform1i(loc('u_iterations'),plan.iterations);gl.uniform1i(loc('u_usePerturbation'),reference?1:0);gl.uniform1i(loc('u_refOrbitLen'),reference?.length??0);gl.uniform1i(loc('u_refOrbitTex'),2);if(!colorPlan){gl.uniform1i(loc('u_insideColoringAlgorithm'),1);gl.uniform1i(loc('u_outsideColoringAlgorithm'),1);}
   gl.uniform4fv(loc('u_formulaParams'),plan.formulaParams);gl.uniform1fv(loc('u_dynamicParams[0]'),plan.dynamicParams);
   gl.uniform4f(loc('legacyTrap'),...c.trapCenter,c.trapRadius,c.trapAspect);gl.uniform3f(loc('legacyTrapShape'),Math.cos(c.trapRotation),Math.sin(c.trapRotation),['point','ring','cross'].indexOf(c.trapShape));
   gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.referenceTexture!);gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.referenceTexture!);
   gl.bindVertexArray(this.quadVao!);gl.bindFramebuffer(gl.FRAMEBUFFER,this.rasterFbo!);gl.viewport(0,0,width,height);gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.disable(gl.DITHER);gl.disable(gl.RASTERIZER_DISCARD);gl.enable(gl.SCISSOR_TEST);
  });
  // The sampler owns request order. Guessing supplies block corners/centers,
  // with holes and duplicate pixels; submitting each in caller order forces a
  // GPU synchronization per point. Sort indices, read bounded row spans, then
  // scatter requested records back without changing fragment interpolation.
  let order:Uint32Array;
  try{order=new Uint32Array(points.length/2);}
  catch(cause){throw new FractalSourceGpuError('Source fractal raster permutation allocation failed','capacity',{cause});}
  const later=(a:number,b:number)=>points[a*2+1]>points[b*2+1]||(points[a*2+1]===points[b*2+1]&&points[a*2]>points[b*2]);
  let sorted=true;
  for(let i=0;i<order.length;i++){order[i]=i;if(i&&later(i-1,i))sorted=false;}
  // Avoid runtime-dependent comparator-sort copies at the capacity boundary.
  // Already ordered One Pass batches keep the linear path.
  if(!sorted){
   const sift=(root:number,end:number)=>{for(let child=root*2+1;child<end;child=root*2+1){
    if(child+1<end&&later(order[child+1],order[child]))child++;
    if(!later(order[child],order[root]))break;
    const value=order[root];order[root]=order[child];order[child]=value;root=child;
   }};
   for(let root=Math.floor(order.length/2)-1;root>=0;root--)sift(root,order.length);
   for(let end=order.length-1;end>0;end--){const value=order[0];order[0]=order[end];order[end]=value;sift(0,end);}
  }
  for(let first=0;first<order.length;){
   cancel(isCancelled);const x=points[order[first]*2],y=points[order[first]*2+1];let end=first+1;
   while(end<order.length&&points[order[end]*2+1]===y&&points[order[end]*2]-x<drawCount)end++;
   const n=points[order[end-1]*2]-x+1;
   let nativeRgba:Uint8Array|undefined;
   device(()=>{gl.scissor(x,height-1-y,n,1);gl.drawArrays(gl.TRIANGLES,0,6);});this.checkDevice('raster draw');this.draws++;this.rasterDraws++;
   const attachments:Float32Array[]=[];
   for(let attachment=0;attachment<4;attachment++){
    if(colorPlan&&attachment===2){
     const rgba=bytes(n*4);rgba.fill(0xa5);device(()=>{gl.readBuffer(gl.COLOR_ATTACHMENT0+attachment);gl.readPixels(x,height-1-y,n,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);});this.checkDevice('native color readback');
     if(rgba.some(v=>v===0xa5)){const again=bytes(rgba.length);again.fill(0x5a);device(()=>gl.readPixels(x,height-1-y,n,1,gl.RGBA,gl.UNSIGNED_BYTE,again));this.checkDevice('native color readback confirmation');require(rgba.every((v,i)=>v===again[i]),'Source fractal returned incomplete native color bytes','device');}
     nativeRgba=rgba;attachments.push(new Float32Array());continue;
    }
    const data=floats(n*4),bits=new Uint32Array(data.buffer);bits.fill(0x7fc0f00d);
    device(()=>{gl.readBuffer(gl.COLOR_ATTACHMENT0+attachment);gl.readPixels(x,height-1-y,n,1,gl.RGBA,gl.FLOAT,data);});this.checkDevice('raster readback');
    if(bits.some(v=>v===0x7fc0f00d)){
     const again=floats(data.length),againBits=new Uint32Array(again.buffer);againBits.fill(0xffc0e00e);
     device(()=>gl.readPixels(x,height-1-y,n,1,gl.RGBA,gl.FLOAT,again));this.checkDevice('raster readback confirmation');require(bits.every((v,i)=>v===againBits[i]),'Source fractal returned an incomplete raster record','device');
    }
    attachments.push(data);
   }
   for(let j=first;j<end;j++){
    const o=order[j],k=(points[o*2]-x)*4,z=attachments[0],t=attachments[1];
    if(nativeRgba)out.sourceRGBA!.set(nativeRgba.subarray(k,k+4),o*4);const facts=decodeFractalSourceTerminal(t[k],t[k+1],maxIter);
    const derivative=plan.isJulia?1:0,measured=facts.converged?Math.fround(Math.sqrt(t[k+2])):0;
    out.values.set([z[k],z[k+2],facts.steps,facts.converged?4:facts.escaped?2:1,derivative,0,t[k+3],0],o*8);
    out.residual.set([z[k+1],z[k+3],measured,0,measured,0,facts.converged?1:0,facts.iteration],o*8);
    if(out.traps){out.traps.set(attachments[2].subarray(k,k+4),o*8);out.traps.set(attachments[3].subarray(k,k+4),o*8+4);}
    out.distance?.set([derivative,0,0,0,z[k],z[k+2],facts.iteration,facts.converged?2:facts.escaped?1:0,t[k+2],facts.startedPerturb?1:0,0,0],o*12);
    out.source.set([facts.startedPerturb?1:0,facts.glitches,facts.ordinarySteps,facts.perturbSteps],o*4);
    this.samples++;if(colorPlan){this.colorSamples++;this.colorPlanKey=colorPlan.key;}else this.colorPlanKey=undefined;this.glitches+=facts.glitches;this.perturbSamples+=facts.startedPerturb?1:0;this.ordinarySteps+=facts.ordinarySteps;this.perturbSteps+=facts.perturbSteps;
   }
   first=end;
  }
  device(()=>{gl.disable(gl.SCISSOR_TEST);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.activeTexture(gl.TEXTURE0);});
 }
 private clearLostContext(){this.owned=[];this.clearHandles();this.gl=undefined;this.cleanupPending=false;}
 private clearHandles(){this.orbitProgram=undefined;this.rasterProgram=undefined;this.colorProgram=undefined;this.colorTexture=undefined;this.fallbackTexture=undefined;this.colorLutKey=undefined;this.colorLutCopy=undefined;this.colorPlanKey=undefined;this.rasterTextures=[];this.rasterFbo=undefined;this.rasterSize=undefined;this.referenceTexture=undefined;this.referenceKey=undefined;this.referenceCopy=undefined;this.input=undefined;this.output=undefined;this.vao=undefined;this.feedback=undefined;this.quadVertices=undefined;this.quadVao=undefined;this.traceTexture=undefined;this.traceColors=undefined;this.traceProgram=undefined;this.activeFeedback=false;this.rasterBytes=0;this.bufferBytes=0;}
 reset(){
  if(!this.gl){this.references.dispose();return;}
  if(device(()=>this.gl!.isContextLost())){this.clearLostContext();this.references.dispose();return;}
  const failures:unknown[]=[];
  // The operation already owns its error. Consume its GL error flag before
  // checking individual deletions, so cleanup errors retain the right handle.
  try{this.gl.getError();}catch(error){failures.push(error);}
  if(this.activeFeedback)try{this.gl.endTransformFeedback();this.activeFeedback=false;}catch(error){failures.push(error);}
  // A deleted current program remains live (including its attached shaders)
  // until it is no longer current. Detach bindings before retiring any handle;
  // an unwind failure retains every owned object for an explicit retry.
  const gl=this.gl;
  const unwind=[()=>gl.disable(gl.RASTERIZER_DISCARD),()=>gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null),()=>gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null),()=>gl.bindVertexArray(null),()=>gl.bindBuffer(gl.ARRAY_BUFFER,null),()=>gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,null),()=>gl.bindFramebuffer(gl.FRAMEBUFFER,null),()=>gl.useProgram(null)];
  for(const unit of [gl.TEXTURE0,gl.TEXTURE1,gl.TEXTURE2])unwind.push(()=>{gl.activeTexture(unit);gl.bindTexture(gl.TEXTURE_2D,null);});
  for(const operation of unwind)try{operation();}catch(error){failures.push(error);}
  try{const code=gl.getError();if(code!==gl.NO_ERROR)failures.push(new Error('GL cleanup unbind failed ('+code+')'));}catch(error){failures.push(error);}
  if(failures.length){this.cleanupPending=true;throw new FractalSourceGpuError('Source fractal cleanup unbind is incomplete','cleanup',{cause:new AggregateError(failures)});}
  for(const item of [...this.owned].reverse())try{this.release(item.handle);}catch(error){failures.push(error);}
  if(failures.length){this.cleanupPending=true;throw new FractalSourceGpuError('Source fractal cleanup is incomplete','cleanup',{cause:new AggregateError(failures)});}
  try{this.gl.getExtension('WEBGL_lose_context')?.loseContext();}catch(cause){this.cleanupPending=true;throw new FractalSourceGpuError('Source fractal context cleanup failed','cleanup',{cause});}
  this.clearHandles();this.gl=undefined;this.cleanupPending=false;this.references.dispose();
 }
 dispose(){this.reset();}
}
