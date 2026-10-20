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
const colorValid=(color:readonly number[])=>color?.length===4&&color.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1);
const MAX_BYTES=256*1024*1024;
type Program={program:WebGLProgram;uniforms:Map<string,WebGLUniformLocation|null>};
/** Owns one render target and its display history. draw() ALWAYS applies the
 * Scene clear/fade, even when the producer has not updated. readPixels() is an
 * observation only. A resize creates a new owner with explicit initial state.
 * Primitive assembly, curve-cache composition and frame scheduling are callers. */
export class SourcePerlinCpuTarget{
 readonly width:number;readonly height:number;readonly physicalWidth:number;readonly physicalHeight:number;
 private readonly options:SourcePerlinCpuTargetOptions;private readonly targetBytes:number;
 private gl?:WebGL2RenderingContext;private failed=false;private disposed=false;
 private vao?:WebGLVertexArrayObject;private buffers:WebGLBuffer[]=[];
 private programs:Partial<Record<'lines'|'points'|'background',Program>>={};
 private framebuffer?:WebGLFramebuffer;private texture?:WebGLTexture;
 private multisample?:WebGLFramebuffer;private renderbuffer?:WebGLRenderbuffer;
 private drawCount=0;
 constructor(options:SourcePerlinCpuTargetOptions){
  if(!options||!Number.isSafeInteger(options.width)||!Number.isSafeInteger(options.height)||options.width<1||options.height<1||!Number.isSafeInteger(options.density)||options.density<1||![0,2,4,8].includes(options.samples)||!colorValid(options.initialColor))throw new SourcePerlinCpuTargetError('input','Invalid Perlin CPU target dimensions, samples or initial color.');
  this.width=options.width;this.height=options.height;this.physicalWidth=options.width*options.density;this.physicalHeight=options.height*options.density;
  if(this.physicalWidth>16384||this.physicalHeight>16384||this.physicalWidth*this.physicalHeight>16777216)throw new SourcePerlinCpuTargetError('capacity','Perlin CPU target exceeds the physical pixel budget.');
  this.targetBytes=this.physicalWidth*this.physicalHeight*4*(2+options.samples)+this.physicalWidth*4;
  if(this.targetBytes>MAX_BYTES)throw new SourcePerlinCpuTargetError('capacity','Perlin CPU attachments/readback exceed 256 MiB.');
  this.options=Object.freeze({...options,initialColor:Object.freeze([...options.initialColor]) as readonly[number,number,number,number]});
 }
 private check(cancelled?:()=>boolean){
  if(this.disposed)throw new SourcePerlinCpuTargetError('disposed','Perlin CPU target is disposed.');
  if(this.failed)throw new SourcePerlinCpuTargetError('failed','Perlin CPU target failed; rebuild before use.');
  if(cancelled?.())throw new SourcePerlinCpuTargetError('cancelled','Perlin CPU drawing cancelled.');
  if(this.gl?.isContextLost())throw new SourcePerlinCpuTargetError('render','Perlin CPU WebGL context lost.');
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
 private context(){
  if(this.gl)return this.gl;
  if(typeof OffscreenCanvas==='undefined')throw new SourcePerlinCpuTargetError('capability','Perlin CPU drawing needs OffscreenCanvas WebGL2.');
  const g=new OffscreenCanvas(1,1).getContext('webgl2',{alpha:true,antialias:false,depth:false,stencil:false,premultipliedAlpha:false});
  if(!g)throw new SourcePerlinCpuTargetError('capability','Perlin CPU WebGL2 unavailable.');this.gl=g;
  const max=g.getParameter(g.MAX_TEXTURE_SIZE),viewport=g.getParameter(g.MAX_VIEWPORT_DIMS) as Int32Array;
  if(this.physicalWidth>Math.min(max,viewport[0])||this.physicalHeight>Math.min(max,viewport[1]))throw new SourcePerlinCpuTargetError('capacity','Perlin CPU target exceeds GPU dimensions.');
  if(this.options.samples){
   const supported=g.getInternalformatParameter(g.RENDERBUFFER,g.RGBA8,g.SAMPLES) as Int32Array;
   if(![...supported].includes(this.options.samples))throw new SourcePerlinCpuTargetError('capability','Requested Perlin CPU MSAA count unavailable.');
  }
  this.programs.lines=this.compile(sourceProcessingLineVertex,sourceProcessingLineFragment);
  this.programs.points=this.compile(sourceProcessingPointVertex,sourceProcessingPointFragment);
  this.programs.background=this.compile(backgroundVertex,backgroundFragment);
  this.vao=g.createVertexArray()??undefined;if(!this.vao)throw new SourcePerlinCpuTargetError('render','Cannot allocate Perlin VAO.');
  for(let i=0;i<4;i++){const b=g.createBuffer();if(!b)throw new SourcePerlinCpuTargetError('render','Cannot allocate Perlin geometry buffer.');this.buffers.push(b);}
  this.texture=g.createTexture()??undefined;this.framebuffer=g.createFramebuffer()??undefined;
  if(!this.texture||!this.framebuffer)throw new SourcePerlinCpuTargetError('render','Cannot allocate Perlin color target.');
  g.bindTexture(g.TEXTURE_2D,this.texture);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);
  g.texImage2D(g.TEXTURE_2D,0,g.RGBA8,this.physicalWidth,this.physicalHeight,0,g.RGBA,g.UNSIGNED_BYTE,null);
  g.bindFramebuffer(g.FRAMEBUFFER,this.framebuffer);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,this.texture,0);this.complete();
  if(this.options.samples){
   this.multisample=g.createFramebuffer()??undefined;this.renderbuffer=g.createRenderbuffer()??undefined;
   if(!this.multisample||!this.renderbuffer)throw new SourcePerlinCpuTargetError('render','Cannot allocate Perlin multisample target.');
   g.bindRenderbuffer(g.RENDERBUFFER,this.renderbuffer);g.renderbufferStorageMultisample(g.RENDERBUFFER,this.options.samples,g.RGBA8,this.physicalWidth,this.physicalHeight);
   g.bindFramebuffer(g.FRAMEBUFFER,this.multisample);g.framebufferRenderbuffer(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.RENDERBUFFER,this.renderbuffer);this.complete();
  }
  g.clearColor(...this.options.initialColor);g.clear(g.COLOR_BUFFER_BIT);this.resolve();return g;
 }
 private complete(){const g=this.gl!;if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw new SourcePerlinCpuTargetError('render','Perlin CPU framebuffer incomplete.');}
 private resolve(){const g=this.gl!;if(!this.multisample)return;g.bindFramebuffer(g.READ_FRAMEBUFFER,this.multisample);g.bindFramebuffer(g.DRAW_FRAMEBUFFER,this.framebuffer!);g.blitFramebuffer(0,0,this.physicalWidth,this.physicalHeight,0,0,this.physicalWidth,this.physicalHeight,g.COLOR_BUFFER_BIT,g.NEAREST);}
 private uniform(p:Program,name:string){if(!p.uniforms.has(name))p.uniforms.set(name,this.gl!.getUniformLocation(p.program,name));return p.uniforms.get(name)!;}
 private verify(frame:SourcePerlinCpuFrame,cancelled?:()=>boolean){
  if(!(frame?.projection instanceof Float32Array)||frame.projection.length!==16||!frame.projection.every(Number.isFinite)||!colorValid(frame.background)||typeof frame.accumulation!=='boolean'||!Array.isArray(frame.primitives))throw new SourcePerlinCpuTargetError('input','Invalid Perlin CPU draw frame.');
  let bytes=this.targetBytes;
  for(const p of frame.primitives){
   this.check(cancelled);if(!p||!['lines','points'].includes(p.kind)||!p.buffers)throw new SourcePerlinCpuTargetError('input','Unknown Perlin CPU primitive or missing buffers.');const b=p.buffers,d=p.kind==='lines'?p.buffers.directions:p.buffers.offsets,size=p.kind==='lines'?4:2;
   if(!b||!(b.positions instanceof Float32Array)||b.positions.length%4||!(b.colors instanceof Float32Array)||b.colors.length!==b.positions.length||!(d instanceof Float32Array)||d.length!==b.positions.length/4*size||!(b.indices instanceof Uint16Array)||!Array.isArray(b.caches))throw new SourcePerlinCpuTargetError('input','Invalid Perlin CPU primitive buffers.');
   // Input arrays plus their complete GPU uploads; count representation growth
   // before GPU allocation. Driver bookkeeping is outside this explicit budget.
   bytes+=2*(b.positions.byteLength+b.colors.byteLength+d.byteLength+b.indices.byteLength)+b.caches.length*32;
   if(bytes>MAX_BYTES)throw new SourcePerlinCpuTargetError('capacity','Perlin CPU draw representations exceed 256 MiB.');
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
 }
 draw(frame:SourcePerlinCpuFrame,cancelled?:()=>boolean):void{
  try{
   this.check(cancelled);this.verify(frame,cancelled);const g=this.context();
   g.bindFramebuffer(g.FRAMEBUFFER,this.multisample??this.framebuffer!);g.bindVertexArray(this.vao!);g.viewport(0,0,this.physicalWidth,this.physicalHeight);
   g.disable(g.DEPTH_TEST);g.disable(g.SCISSOR_TEST);g.disable(g.CULL_FACE);g.enable(g.DITHER);g.enable(g.BLEND);g.blendEquationSeparate(g.FUNC_ADD,g.FUNC_ADD);g.blendFuncSeparate(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA,g.ONE,g.ONE);
   if(frame.accumulation){const p=this.programs.background!;g.useProgram(p.program);g.uniform4fv(this.uniform(p,'background'),frame.background);for(let i=0;i<3;i++)g.disableVertexAttribArray(i);g.drawArrays(g.TRIANGLES,0,3);}
   else{g.clearColor(...frame.background);g.clear(g.COLOR_BUFFER_BIT);}
   for(const primitive of frame.primitives){
    this.check(cancelled);const p=this.programs[primitive.kind]!,b=primitive.buffers,d=primitive.kind==='lines'?primitive.buffers.directions:primitive.buffers.offsets,size=primitive.kind==='lines'?4:2;
    g.useProgram(p.program);g.uniform4f(this.uniform(p,'viewport'),0,0,this.width,this.height);g.uniform1i(this.uniform(p,'perspective'),0);
    g.uniformMatrix4fv(this.uniform(p,primitive.kind==='lines'?'lineModelview':'pointModelview'),false,identity);g.uniformMatrix4fv(this.uniform(p,'projection'),false,frame.projection);
    if(primitive.kind==='lines')g.uniform3f(this.uniform(p,'scale'),1,1,Math.fround(.999));
    const data=[b.positions,b.colors,d];for(let i=0;i<3;i++){g.bindBuffer(g.ARRAY_BUFFER,this.buffers[i]);g.bufferData(g.ARRAY_BUFFER,data[i],g.DYNAMIC_DRAW);g.enableVertexAttribArray(i);}
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER,this.buffers[3]);g.bufferData(g.ELEMENT_ARRAY_BUFFER,b.indices,g.DYNAMIC_DRAW);
    for(const cache of b.caches){
     this.check(cancelled);for(let i=0;i<3;i++){g.bindBuffer(g.ARRAY_BUFFER,this.buffers[i]);const components=i===2?size:4;g.vertexAttribPointer(i,components,g.FLOAT,false,0,cache.vertexOffset*components*4);}
     g.drawElements(g.TRIANGLES,cache.indexCount,g.UNSIGNED_SHORT,cache.indexOffset*2);
    }
   }
   this.resolve();this.check(cancelled);if(g.getError()!==g.NO_ERROR)throw new SourcePerlinCpuTargetError('render','Perlin CPU GL draw failed.');this.drawCount++;
  }catch(error){this.failed=true;this.release();throw error;}
 }
 readPixels(cancelled?:()=>boolean):Uint8ClampedArray{
  try{
   this.check(cancelled);const g=this.context(),pixels=new Uint8ClampedArray(this.physicalWidth*this.physicalHeight*4);g.bindFramebuffer(g.FRAMEBUFFER,this.framebuffer!);g.readPixels(0,0,this.physicalWidth,this.physicalHeight,g.RGBA,g.UNSIGNED_BYTE,pixels);
   if(g.getError()!==g.NO_ERROR)throw new SourcePerlinCpuTargetError('render','Perlin CPU readback failed.');const rowBytes=this.physicalWidth*4,row=new Uint8ClampedArray(rowBytes);
   for(let y=0;y<Math.floor(this.physicalHeight/2);y++){this.check(cancelled);const a=y*rowBytes,b=(this.physicalHeight-y-1)*rowBytes;row.set(pixels.subarray(a,a+rowBytes));pixels.copyWithin(a,b,b+rowBytes);pixels.set(row,b);}
   this.check(cancelled);return pixels;
  }catch(error){this.failed=true;this.release();throw error;}
 }
 diagnostics(){this.check();return{draws:this.drawCount,width:this.width,height:this.height,physicalWidth:this.physicalWidth,physicalHeight:this.physicalHeight,samples:this.options.samples,targetRepresentationBytes:this.targetBytes,initialized:!!this.gl};}
 private release(){const g=this.gl;if(!g)return;for(const p of Object.values(this.programs))if(p)g.deleteProgram(p.program);for(const b of this.buffers)g.deleteBuffer(b);g.deleteVertexArray(this.vao??null);g.deleteFramebuffer(this.multisample??null);g.deleteRenderbuffer(this.renderbuffer??null);g.deleteFramebuffer(this.framebuffer??null);g.deleteTexture(this.texture??null);g.getExtension('WEBGL_lose_context')?.loseContext();this.gl=undefined;this.programs={};this.buffers=[];this.vao=undefined;this.multisample=undefined;this.renderbuffer=undefined;this.framebuffer=undefined;this.texture=undefined;}
 dispose(){if(this.disposed)return;this.release();this.disposed=true;}
}
