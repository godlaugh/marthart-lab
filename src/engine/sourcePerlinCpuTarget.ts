import {sourceProcessingLineVertex,sourceProcessingLineFragment} from './sourceProcessingStroke';
import {sourceProcessingPointVertex,sourceProcessingPointFragment} from './sourceProcessingPoints';
export interface SourcePerlinCpuCache{readonly vertexOffset:number;readonly indexOffset:number;readonly vertexCount:number;readonly indexCount:number;}
export interface SourcePerlinCpuBuffers{
 readonly positions:Float32Array;readonly colors:Float32Array;readonly indices:Uint16Array;
 readonly caches:readonly SourcePerlinCpuCache[];
}
export type SourcePerlinCpuPrimitive=
 {readonly kind:'lines';readonly buffers:SourcePerlinCpuBuffers&{readonly directions:Float32Array}}|
 {readonly kind:'points';readonly buffers:SourcePerlinCpuBuffers&{readonly offsets:Float32Array}};
export interface SourcePerlinCpuFrame{
 readonly projection:Float32Array;
 /** Already interpreted RGB255 fill/background color, not raw packed input. */
 readonly background:readonly[number,number,number,number];
 readonly accumulation:boolean;readonly primitives:readonly SourcePerlinCpuPrimitive[];
 /** Synchronously emit bounded primitives after the retained list. Buffers
  * may be reused after consume returns; the target never retains their views. */
 readonly streamPrimitives?:(consume:(primitive:SourcePerlinCpuPrimitive)=>void)=>void;
 /** Caller-owned source/snapshot arrays live throughout streaming. Count them
  * with each chunk and the shared device before admitting any GL allocation. */
 readonly streamRetainedBytes?:number;
 /** Completed sibling targets, composited in order after primitives. */
 readonly images?:readonly SourcePerlinCpuTarget[];
}
export interface SourcePerlinCpuTargetOptions{
 readonly width:number;readonly height:number;readonly density:number;
 /** Actual chosen sample count. Unsupported counts fail rather than silently change. */
 readonly samples:0|2|4|8;
 /** Target creation contents are explicit; source Scene.render does not own them. */
 readonly initialColor:readonly[number,number,number,number];
}
export class SourcePerlinCpuTargetError extends Error{
 constructor(readonly code:'input'|'capacity'|'capability'|'shader'|'render'|'cancelled'|'failed'|'disposed',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourcePerlinCpuTargetError';}
}
const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const backgroundVertex=`#version 300 es
precision highp float;
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0,1);}`;
const backgroundFragment=`#version 300 es
precision mediump float;
uniform vec4 background;out vec4 fragmentColor;void main(){fragmentColor=background;}`;
// The source texture is already a GL framebuffer: v=0 is its bottom row.
// Processing's image texture inversion cancels its top-left image coordinates.
// No unpremultiply: source BLEND applies SRC_ALPHA again at this image pass.
const imageVertex=`#version 300 es
precision highp float;
out vec2 imageUV;
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));imageUV=p;gl_Position=vec4(p*2.0-1.0,0,1);}`;
const imageFragment=`#version 300 es
precision mediump float;
uniform sampler2D imageTexture;in vec2 imageUV;out vec4 fragmentColor;
void main(){fragmentColor=texture(imageTexture,imageUV);}`;
const colorValid=(color:unknown):color is readonly[number,number,number,number]=>Array.isArray(color)&&color.length===4&&[0,1,2,3].every(i=>typeof color[i]==='number'&&Number.isFinite(color[i])&&color[i]>=0&&color[i]<=1);
const MAX_BYTES=256*1024*1024;
type Program={program:WebGLProgram;uniforms:Map<string,WebGLUniformLocation|null>};
type ProgramKind='lines'|'points'|'background'|'image';
interface PrimitiveInputs{readonly buffers:ReadonlySet<ArrayBufferLike>;readonly bytes:number;}

/** One context owner. Targets own only attachments; losing this device invalidates
 * all of them. The map also reserves not-yet-allocated targets and their readbacks. */
class SourcePerlinCpuDevice{
 gl?:WebGL2RenderingContext;
 vao?:WebGLVertexArrayObject;
 readonly buffers:WebGLBuffer[]=[];
 readonly programs:Partial<Record<ProgramKind,Program>>={};
 private readonly targets=new Map<object,{bytes:number;release:()=>void}>();
 private readonly uploadSizes=[0,0,0,0];
 private reservedBytes=0;
 failed=false;
 get bytes(){return this.reservedBytes+this.uploadSizes.reduce((a,b)=>a+b,0);}
 get targetCount(){return this.targets.size;}
 add(owner:object,bytes:number,release:()=>void){
  this.check();this.budget(bytes);this.targets.set(owner,{bytes,release});this.reservedBytes+=bytes;
 }
 resize(owner:object,bytes:number){
  const target=this.targets.get(owner);if(!target)throw new SourcePerlinCpuTargetError('failed','Missing Perlin target resource owner.');
  if(bytes>target.bytes)this.budget(bytes-target.bytes);
  this.reservedBytes+=bytes-target.bytes;target.bytes=bytes;
 }
 remove(owner:object){
  const target=this.targets.get(owner);if(!target)return;
  this.targets.delete(owner);this.reservedBytes-=target.bytes;
  if(!this.targets.size)this.release();
 }
 budget(extra:number){if(!Number.isSafeInteger(extra)||extra<0||this.bytes+extra>MAX_BYTES)throw new SourcePerlinCpuTargetError('capacity','Perlin CPU shared device representations exceed 256 MiB.');}
 uploaded(index:number,bytes:number){this.uploadSizes[index]=bytes;}
 check(){
  if(this.failed)throw new SourcePerlinCpuTargetError('failed','Perlin CPU shared device failed; rebuild before use.');
  if(this.gl?.isContextLost()){this.fail();throw new SourcePerlinCpuTargetError('render','Perlin CPU WebGL context lost.');}
 }
 fail(){
  this.failed=true;
  for(const target of this.targets.values())target.release();
  this.targets.clear();this.reservedBytes=0;this.release();
 }
 context(){
  this.check();if(this.gl)return this.gl;
  try{
   if(typeof OffscreenCanvas==='undefined')throw new SourcePerlinCpuTargetError('capability','Perlin CPU drawing needs OffscreenCanvas WebGL2.');
   const g=new OffscreenCanvas(1,1).getContext('webgl2',{alpha:true,antialias:false,depth:false,stencil:false,premultipliedAlpha:false});
   if(!g)throw new SourcePerlinCpuTargetError('capability','Perlin CPU WebGL2 unavailable.');this.gl=g;
   this.programs.lines=this.compile(sourceProcessingLineVertex,sourceProcessingLineFragment);
   this.programs.points=this.compile(sourceProcessingPointVertex,sourceProcessingPointFragment);
   this.programs.background=this.compile(backgroundVertex,backgroundFragment);
   this.programs.image=this.compile(imageVertex,imageFragment);
   this.vao=g.createVertexArray()??undefined;if(!this.vao)throw new SourcePerlinCpuTargetError('render','Cannot allocate Perlin VAO.');
   for(let i=0;i<4;i++){const b=g.createBuffer();if(!b)throw new SourcePerlinCpuTargetError('render','Cannot allocate Perlin geometry buffer.');this.buffers.push(b);}
   return g;
  }catch(error){this.fail();throw error;}
 }
 private compile(vertex:string,fragment:string):Program{
  const g=this.gl!,program=g.createProgram();if(!program)throw new SourcePerlinCpuTargetError('render','Cannot allocate Perlin program.');
  const shaders:WebGLShader[]=[];
  try{
   for(const [kind,text] of [[g.VERTEX_SHADER,vertex],[g.FRAGMENT_SHADER,fragment]] as const){
    const shader=g.createShader(kind);if(!shader)throw new SourcePerlinCpuTargetError('render','Cannot allocate Perlin shader.');
    shaders.push(shader);g.shaderSource(shader,text.startsWith('#version')?text:'#version 300 es\n'+text);g.compileShader(shader);
    if(!g.getShaderParameter(shader,g.COMPILE_STATUS))throw new SourcePerlinCpuTargetError('shader',g.getShaderInfoLog(shader)??'Perlin shader compilation failed.');g.attachShader(program,shader);
   }
   g.bindAttribLocation(program,0,'position');g.bindAttribLocation(program,1,'color');g.bindAttribLocation(program,2,vertex===sourceProcessingLineVertex?'direction':'offset');g.linkProgram(program);
   if(!g.getProgramParameter(program,g.LINK_STATUS))throw new SourcePerlinCpuTargetError('shader',g.getProgramInfoLog(program)??'Perlin program link failed.');
   return{program,uniforms:new Map()};
  }catch(error){g.deleteProgram(program);throw error;}finally{for(const shader of shaders)g.deleteShader(shader);}
 }
 uniform(p:Program,name:string){if(!p.uniforms.has(name))p.uniforms.set(name,this.gl!.getUniformLocation(p.program,name));return p.uniforms.get(name)!;}
 private release(){
  const g=this.gl;if(!g)return;
  for(const key of Object.keys(this.programs) as ProgramKind[]){g.deleteProgram(this.programs[key]!.program);delete this.programs[key];}
  for(const b of this.buffers)g.deleteBuffer(b);this.buffers.length=0;this.uploadSizes.fill(0);
  g.deleteVertexArray(this.vao??null);this.vao=undefined;g.getExtension('WEBGL_lose_context')?.loseContext();this.gl=undefined;
 }
}

/** Owns one render target and its display history. draw() ALWAYS applies the
 * Scene clear/fade, even when the producer has not updated. readPixels() is an
 * observation only. Siblings share GPU resources but retain independent history.
 * Primitive assembly, curve-cache invalidation and frame scheduling are callers. */
export class SourcePerlinCpuTarget{
 readonly width:number;readonly height:number;readonly physicalWidth:number;readonly physicalHeight:number;
 private options:SourcePerlinCpuTargetOptions;private targetBytes:number;
 private device:SourcePerlinCpuDevice;private failed=false;private disposed=false;
 private framebuffer?:WebGLFramebuffer;private texture?:WebGLTexture;
 private multisample?:WebGLFramebuffer;private renderbuffer?:WebGLRenderbuffer;
 private drawCount=0;
 constructor(options:SourcePerlinCpuTargetOptions){
  if(!options||!Number.isSafeInteger(options.width)||!Number.isSafeInteger(options.height)||options.width<1||options.height<1||!Number.isSafeInteger(options.density)||options.density<1||![0,2,4,8].includes(options.samples)||!colorValid(options.initialColor))throw new SourcePerlinCpuTargetError('input','Invalid Perlin CPU target dimensions, samples or initial color.');
  this.width=options.width;this.height=options.height;this.physicalWidth=options.width*options.density;this.physicalHeight=options.height*options.density;
  if(this.physicalWidth>16384||this.physicalHeight>16384||this.physicalWidth*this.physicalHeight>16777216)throw new SourcePerlinCpuTargetError('capacity','Perlin CPU target exceeds the physical pixel budget.');
  // Texture + optional MSAA storage + one top-down readback and its swap row.
  // A readback is reserved for each live target, including its row swap scratch.
  this.targetBytes=this.physicalWidth*this.physicalHeight*4*(2+options.samples)+this.physicalWidth*4;
  if(this.targetBytes>MAX_BYTES)throw new SourcePerlinCpuTargetError('capacity','Perlin CPU attachments/readback exceed 256 MiB.');
  this.options=Object.freeze({...options,initialColor:Object.freeze([...options.initialColor]) as readonly[number,number,number,number]});
  this.device=new SourcePerlinCpuDevice();this.device.add(this,this.targetBytes,()=>this.releaseAttachments());
 }
 /** Primary PGL FBO smooth request on the returned target device.
  * PGL.createFBOLayer PC81–126 chooses min(request,maxSamples), and only
  * counts >1 allocate MSAA. No alternative RGBA8 count is silently substituted. */
 static createSmoothed(options:Omit<SourcePerlinCpuTargetOptions,'samples'>,requested=4):SourcePerlinCpuTarget{
  const target=new SourcePerlinCpuTarget({...options,samples:0});
  try{
   const samples=target.selectedSamples(requested),bytes=target.physicalWidth*target.physicalHeight*4*(2+samples)+target.physicalWidth*4;
   target.device.resize(target,bytes);target.targetBytes=bytes;target.options=Object.freeze({...target.options,samples});return target;
  }catch(error){target.dispose();throw error;}
 }
 /** Query the primary PGL FBO sample policy on this existing device.
  * Offscreen caches use their explicit smooth request, not this clamp policy.
  * Returned counts describe this browser/device, not native JOGL capabilities. */
 selectedSamples(requested=4):0|2|4|8{
  try{
   this.check();if(!Number.isSafeInteger(requested)||requested<0)throw new SourcePerlinCpuTargetError('input','Perlin smooth request requires a nonnegative integer.');
   if(requested<=1)return 0;
   const g=this.device.context(),maximum=g.getParameter(g.MAX_SAMPLES) as number;
   if(!Number.isSafeInteger(maximum)||maximum<0)throw new SourcePerlinCpuTargetError('capability','Perlin maximum sample capability is unavailable.');
   const selected=Math.min(requested,maximum);if(selected<=1)return 0;
   const supported=g.getInternalformatParameter(g.RENDERBUFFER,g.RGBA8,g.SAMPLES) as Int32Array;
   if(![2,4,8].includes(selected)||![...supported].includes(selected))throw new SourcePerlinCpuTargetError('capability','Source-selected Perlin MSAA count is unavailable for RGBA8.');
   return selected as 2|4|8;
  }catch(error){this.poison();throw error;}
 }
 createSibling(options:SourcePerlinCpuTargetOptions):SourcePerlinCpuTarget{
  this.check();const sibling=new SourcePerlinCpuTarget(options);
  try{
   this.device.add(sibling,sibling.targetBytes,()=>sibling.releaseAttachments());
   sibling.device.remove(sibling);sibling.device=this.device;return sibling;
  }catch(error){sibling.dispose();throw error;}
 }
 private check(cancelled?:()=>boolean){
  if(this.disposed)throw new SourcePerlinCpuTargetError('disposed','Perlin CPU target is disposed.');
  if(this.failed)throw new SourcePerlinCpuTargetError('failed','Perlin CPU target failed; rebuild before use.');
  if(cancelled!==undefined&&typeof cancelled!=='function')throw new SourcePerlinCpuTargetError('input','Perlin CPU cancellation must be a function.');
  if(cancelled?.())throw new SourcePerlinCpuTargetError('cancelled','Perlin CPU drawing cancelled.');
  this.device.check();
 }
 private context(){
  const g=this.device.context();if(this.framebuffer)return g;
  const max=g.getParameter(g.MAX_TEXTURE_SIZE),viewport=g.getParameter(g.MAX_VIEWPORT_DIMS) as Int32Array;
  if(this.physicalWidth>Math.min(max,viewport[0])||this.physicalHeight>Math.min(max,viewport[1]))throw new SourcePerlinCpuTargetError('capacity','Perlin CPU target exceeds GPU dimensions.');
  if(this.options.samples){
   const supported=g.getInternalformatParameter(g.RENDERBUFFER,g.RGBA8,g.SAMPLES) as Int32Array;
   if(![...supported].includes(this.options.samples))throw new SourcePerlinCpuTargetError('capability','Requested Perlin CPU MSAA count unavailable.');
  }
  this.texture=g.createTexture()??undefined;this.framebuffer=g.createFramebuffer()??undefined;
  if(!this.texture||!this.framebuffer)throw new SourcePerlinCpuTargetError('render','Cannot allocate Perlin color target.');
  g.bindTexture(g.TEXTURE_2D,this.texture);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);
  g.texImage2D(g.TEXTURE_2D,0,g.RGBA8,this.physicalWidth,this.physicalHeight,0,g.RGBA,g.UNSIGNED_BYTE,null);
  g.bindFramebuffer(g.FRAMEBUFFER,this.framebuffer);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,this.texture,0);this.complete(g);
  if(this.options.samples){
   this.multisample=g.createFramebuffer()??undefined;this.renderbuffer=g.createRenderbuffer()??undefined;
   if(!this.multisample||!this.renderbuffer)throw new SourcePerlinCpuTargetError('render','Cannot allocate Perlin multisample target.');
   g.bindRenderbuffer(g.RENDERBUFFER,this.renderbuffer);g.renderbufferStorageMultisample(g.RENDERBUFFER,this.options.samples,g.RGBA8,this.physicalWidth,this.physicalHeight);
   g.bindFramebuffer(g.FRAMEBUFFER,this.multisample);g.framebufferRenderbuffer(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.RENDERBUFFER,this.renderbuffer);this.complete(g);
  }
  g.disable(g.SCISSOR_TEST);g.colorMask(true,true,true,true);g.clearColor(...this.options.initialColor);g.clear(g.COLOR_BUFFER_BIT);this.resolve(g);return g;
 }
 private complete(g:WebGL2RenderingContext){if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw new SourcePerlinCpuTargetError('render','Perlin CPU framebuffer incomplete.');}
 private resolve(g:WebGL2RenderingContext){if(!this.multisample)return;g.bindFramebuffer(g.READ_FRAMEBUFFER,this.multisample);g.bindFramebuffer(g.DRAW_FRAMEBUFFER,this.framebuffer!);g.blitFramebuffer(0,0,this.physicalWidth,this.physicalHeight,0,0,this.physicalWidth,this.physicalHeight,g.COLOR_BUFFER_BIT,g.NEAREST);}
 private verify(frame:SourcePerlinCpuFrame,cancelled?:()=>boolean){
  if(!(frame?.projection instanceof Float32Array)||frame.projection.length!==16||!frame.projection.every(Number.isFinite)||!colorValid(frame.background)||typeof frame.accumulation!=='boolean'||!Array.isArray(frame.primitives)||(frame.streamPrimitives!==undefined&&typeof frame.streamPrimitives!=='function')||(frame.images!==undefined&&!Array.isArray(frame.images)))throw new SourcePerlinCpuTargetError('input','Invalid Perlin CPU draw frame.');
  const retained=frame.streamRetainedBytes??0;
  if(!Number.isSafeInteger(retained)||retained<0)throw new SourcePerlinCpuTargetError('input','Invalid Perlin streaming source byte count.');
  this.device.budget(retained);
  for(const image of frame.images??[]){
   if(!(image instanceof SourcePerlinCpuTarget)||image===this||image.device!==this.device||image.disposed||image.failed||image.drawCount===0||!image.texture||!image.framebuffer)throw new SourcePerlinCpuTargetError('input','Perlin CPU image must be a completed, live sibling target.');
   image.check();
  }
  return this.verifyPrimitives(frame.primitives,retained,cancelled);
 }
 /** Original frame inputs remain alive throughout streaming. Only the current
  * chunk is added to that reservation; prior chunks may reuse their storage.
  * Existing GPU uploads are independently counted by the shared device. */
 private verifyPrimitives(primitives:readonly SourcePerlinCpuPrimitive[],retained:number,cancelled?:()=>boolean,held?:PrimitiveInputs):PrimitiveInputs{
  let inputBytes=held?.bytes??0,uploadBytes=0;const inputBuffers=new Set(held?.buffers);
  this.device.budget(inputBytes+retained);
  for(const p of primitives){
   this.check(cancelled);if(!p||!['lines','points'].includes(p.kind)||!p.buffers)throw new SourcePerlinCpuTargetError('input','Unknown Perlin CPU primitive or missing buffers.');const b=p.buffers,d=p.kind==='lines'?p.buffers.directions:p.buffers.offsets,size=p.kind==='lines'?4:2;
   if(!(b.positions instanceof Float32Array)||b.positions.length%4||!(b.colors instanceof Float32Array)||b.colors.length!==b.positions.length||!(d instanceof Float32Array)||d.length!==b.positions.length/4*size||!(b.indices instanceof Uint16Array)||!Array.isArray(b.caches))throw new SourcePerlinCpuTargetError('input','Invalid Perlin CPU primitive buffers.');
   // Count source arrays, complete GPU uploads and existing device uploads before
   // any new allocation. The shared map includes every sibling's attachments.
   for(const array of [b.positions,b.colors,d,b.indices])if(!inputBuffers.has(array.buffer)){inputBuffers.add(array.buffer);inputBytes+=array.buffer.byteLength;}
   inputBytes+=b.caches.length*32;
   uploadBytes+=b.positions.byteLength+b.colors.byteLength+d.byteLength+b.indices.byteLength;
   this.device.budget(inputBytes+uploadBytes+retained);
   let previousIndex=0,previousVertex=0;
   for(const cache of b.caches){
    this.check(cancelled);
    if(!cache||cache.vertexCount===0||cache.indexCount===0)throw new SourcePerlinCpuTargetError('input','Empty or missing Perlin CPU index cache; empty geometry requires no caches.');
    for(const n of [cache.vertexOffset,cache.indexOffset,cache.vertexCount,cache.indexCount])if(typeof n!=='number'||!Number.isSafeInteger(n)||n<0)throw new SourcePerlinCpuTargetError('input','Invalid Perlin CPU index cache.');
    if(cache.vertexOffset!==previousVertex||cache.indexOffset!==previousIndex||cache.vertexCount>32768||cache.vertexOffset+cache.vertexCount>b.positions.length/4||cache.indexOffset+cache.indexCount>b.indices.length||cache.indexCount%3)throw new SourcePerlinCpuTargetError('input','Noncontiguous or out-of-range Perlin CPU index cache.');
    for(let i=cache.indexOffset;i<cache.indexOffset+cache.indexCount;i++){if((i&4095)===0)this.check(cancelled);if(b.indices[i]>=cache.vertexCount)throw new SourcePerlinCpuTargetError('input','Perlin CPU index exceeds its cache.');}
    previousIndex+=cache.indexCount;previousVertex+=cache.vertexCount;
   }
   if(previousIndex!==b.indices.length||previousVertex!==b.positions.length/4)throw new SourcePerlinCpuTargetError('input','Perlin CPU cache coverage is incomplete.');
  }
  return{buffers:inputBuffers,bytes:inputBytes};
 }
 draw(frame:SourcePerlinCpuFrame,cancelled?:()=>boolean):void{
  try{
   this.check(cancelled);const inputs=this.verify(frame,cancelled),g=this.context(),device=this.device;
   g.bindFramebuffer(g.FRAMEBUFFER,this.multisample??this.framebuffer!);g.bindVertexArray(device.vao!);g.viewport(0,0,this.physicalWidth,this.physicalHeight);
   g.disable(g.DEPTH_TEST);g.disable(g.SCISSOR_TEST);g.disable(g.CULL_FACE);g.enable(g.DITHER);g.enable(g.BLEND);g.blendEquationSeparate(g.FUNC_ADD,g.FUNC_ADD);g.blendFuncSeparate(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA,g.ONE,g.ONE);
   if(frame.accumulation){const p=device.programs.background!;g.useProgram(p.program);g.uniform4fv(device.uniform(p,'background'),frame.background);for(let i=0;i<3;i++)g.disableVertexAttribArray(i);g.drawArrays(g.TRIANGLES,0,3);}
   else{g.clearColor(...frame.background);g.clear(g.COLOR_BUFFER_BIT);}
   const drawPrimitive=(primitive:SourcePerlinCpuPrimitive)=>{
    this.check(cancelled);const p=device.programs[primitive.kind]!,b=primitive.buffers,d=primitive.kind==='lines'?primitive.buffers.directions:primitive.buffers.offsets,size=primitive.kind==='lines'?4:2;
    g.useProgram(p.program);g.uniform4f(device.uniform(p,'viewport'),0,0,this.width,this.height);g.uniform1i(device.uniform(p,'perspective'),0);
    g.uniformMatrix4fv(device.uniform(p,primitive.kind==='lines'?'lineModelview':'pointModelview'),false,identity);g.uniformMatrix4fv(device.uniform(p,'projection'),false,frame.projection);
    if(primitive.kind==='lines')g.uniform3f(device.uniform(p,'scale'),1,1,Math.fround(.999));
    const data=[b.positions,b.colors,d];for(let i=0;i<3;i++){g.bindBuffer(g.ARRAY_BUFFER,device.buffers[i]);g.bufferData(g.ARRAY_BUFFER,data[i],g.DYNAMIC_DRAW);device.uploaded(i,data[i].byteLength);g.enableVertexAttribArray(i);}
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER,device.buffers[3]);g.bufferData(g.ELEMENT_ARRAY_BUFFER,b.indices,g.DYNAMIC_DRAW);device.uploaded(3,b.indices.byteLength);
    for(const cache of b.caches){
     this.check(cancelled);for(let i=0;i<3;i++){g.bindBuffer(g.ARRAY_BUFFER,device.buffers[i]);const components=i===2?size:4;g.vertexAttribPointer(i,components,g.FLOAT,false,0,cache.vertexOffset*components*4);}
     g.drawElements(g.TRIANGLES,cache.indexCount,g.UNSIGNED_SHORT,cache.indexOffset*2);
    }
   };
   for(const primitive of frame.primitives)drawPrimitive(primitive);
   if(frame.streamPrimitives){
    let consuming=true,failure:{error:unknown}|undefined;
    const reject=(error:unknown):never=>{
     failure??={error};this.poison();throw failure.error;
    };
    try{
     const completion:unknown=frame.streamPrimitives(primitive=>{
      if(failure)throw failure.error;
      try{
       if(!consuming)throw new SourcePerlinCpuTargetError('input','Perlin primitive stream must be synchronous.');
       this.check(cancelled);
       this.verifyPrimitives([primitive],frame.streamRetainedBytes??0,cancelled,inputs);
       drawPrimitive(primitive);
      }catch(error){reject(error);}
     });
     if(completion!==null&&(typeof completion==='object'||typeof completion==='function')&&typeof (completion as PromiseLike<unknown>).then==='function'){
      // A producer that returns a Promise cannot publish this synchronous draw.
      // Observe its rejection, including a later rejected consume invocation.
      void Promise.resolve(completion).catch(()=>{});
      reject(new SourcePerlinCpuTargetError('input','Perlin primitive stream must complete synchronously.'));
     }
     if(failure)throw failure.error;
    }catch(error){reject(error);}finally{consuming=false;}
   }
   if(frame.images?.length){
    const p=device.programs.image!;g.useProgram(p.program);g.activeTexture(g.TEXTURE0);g.uniform1i(device.uniform(p,'imageTexture'),0);
    for(let i=0;i<3;i++)g.disableVertexAttribArray(i);
    for(const image of frame.images){this.check(cancelled);g.bindTexture(g.TEXTURE_2D,image.texture!);g.drawArrays(g.TRIANGLES,0,3);}
    g.bindTexture(g.TEXTURE_2D,null);
   }
   this.resolve(g);this.check(cancelled);if(g.getError()!==g.NO_ERROR)throw new SourcePerlinCpuTargetError('render','Perlin CPU GL draw failed.');this.drawCount++;
  }catch(error){this.poison();throw error;}
 }
 readPixels(cancelled?:()=>boolean):Uint8ClampedArray{
  try{
   this.check(cancelled);this.device.budget(0);const g=this.context(),pixels=new Uint8ClampedArray(this.physicalWidth*this.physicalHeight*4);g.bindFramebuffer(g.FRAMEBUFFER,this.framebuffer!);g.readPixels(0,0,this.physicalWidth,this.physicalHeight,g.RGBA,g.UNSIGNED_BYTE,pixels);
   if(g.getError()!==g.NO_ERROR)throw new SourcePerlinCpuTargetError('render','Perlin CPU readback failed.');const rowBytes=this.physicalWidth*4,row=new Uint8ClampedArray(rowBytes);
   for(let y=0;y<Math.floor(this.physicalHeight/2);y++){this.check(cancelled);const a=y*rowBytes,b=(this.physicalHeight-y-1)*rowBytes;row.set(pixels.subarray(a,a+rowBytes));pixels.copyWithin(a,b,b+rowBytes);pixels.set(row,b);}
   this.check(cancelled);return pixels;
  }catch(error){this.poison();throw error;}
 }
 diagnostics(){this.check();return{draws:this.drawCount,width:this.width,height:this.height,physicalWidth:this.physicalWidth,physicalHeight:this.physicalHeight,samples:this.options.samples,targetRepresentationBytes:this.targetBytes,deviceRepresentationBytes:this.device.bytes,deviceTargets:this.device.targetCount,initialized:!!this.framebuffer};}
 private releaseAttachments(){
  const g=this.device.gl;if(!g)return;
  g.deleteFramebuffer(this.multisample??null);g.deleteRenderbuffer(this.renderbuffer??null);g.deleteFramebuffer(this.framebuffer??null);g.deleteTexture(this.texture??null);
  this.multisample=undefined;this.renderbuffer=undefined;this.framebuffer=undefined;this.texture=undefined;
 }
 private poison(){this.failed=true;this.releaseAttachments();this.device.remove(this);}
 dispose(){if(this.disposed)return;this.releaseAttachments();this.device.remove(this);this.disposed=true;}
}
