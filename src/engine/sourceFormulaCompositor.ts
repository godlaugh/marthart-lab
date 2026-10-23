import type {FormulaPresentation} from '../types';
import {sourceFormulaQuad} from './formulas';
import {sourceFormulaGlyph,type SourceFormulaGlyph} from './sourceFormulaGlyphClient';
import {MAX_RASTER_PIXELS} from './rasterDimensions';
import {validateFormulaPresentation} from './formulaConfig';
import {sourceTextureAnisotropy,type SourceTextureAnisotropy} from './sourceProcessingTextureSampling';
const QUAD_ORDER=[0,1,2,0,2,3],QUAD_UV=[0,0,0,1,1,1,1,0];
export type SourceFormulaPresentation=Extract<FormulaPresentation,{layout:'source-surface-centered-v1'}>;
export interface PreparedSourceFormula {presentation:SourceFormulaPresentation;glyphs:readonly SourceFormulaGlyph[];}
/** One immutable presentation owns its glyph snapshot. A recording may retain
 * this snapshot across frames; a new preparation validates the backend anew. */
export async function prepareSourceFormulas(presentation:SourceFormulaPresentation,signal?:AbortSignal):Promise<PreparedSourceFormula>{
 const validated=validateFormulaPresentation(presentation);if(validated.layout!=='source-surface-centered-v1')throw new Error('源公式需要源布局');presentation=validated;
 const glyphs:SourceFormulaGlyph[]=[];let bytes=0;
 // The next response is individually bounded at 64 MB. Sequential admission
 // keeps retained frame glyphs <=64 MiB and transient preparation <=128 MiB;
 // no failed preparation leaves background subscribers running.
 for(const label of presentation.labels){
  const glyph=await sourceFormulaGlyph(label.latex,label.color,signal);bytes+=glyph.pixels.byteLength;
  if(bytes>64*1024**2)throw new Error('源公式超过 64 MiB 帧字形预算');
  if(glyphs.length&&glyph.rendererIdentity!==glyphs[0].rendererIdentity)throw new Error('同一帧的公式来自不同字形后端');
  glyphs.push(glyph);
 }
 return{presentation,glyphs};
}
/** Source Texture.set uploads straight RGBA and generates mipmaps. Its BLEND
 * uses SRC_ALPHA/ONE_MINUS_SRC_ALPHA for RGB and ONE/ONE for alpha. Every
 * consumer includes the base framebuffer; a transparent DOM-only layer cannot
 * reproduce this equation for translucent backgrounds. */
export class SourceFormulaCompositor {
 readonly canvas:HTMLCanvasElement;
 private gl:WebGL2RenderingContext;
 private program:WebGLProgram;
 private buffer:WebGLBuffer;
 private texture:WebGLTexture;
 private textures=new Map<SourceFormulaGlyph,WebGLTexture>();
 private projection:WebGLUniformLocation;
 private vertices=new Float32Array(24);
 private disposed=false;
 private anisotropy?:SourceTextureAnisotropy;
 constructor(canvas=document.createElement('canvas')){
  this.canvas=canvas;
  const gl=canvas.getContext('webgl2',{alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:true,depth:false,stencil:false});
  if(!gl)throw new Error('源公式需要 WebGL 2');this.gl=gl;
  const shaders:WebGLShader[]=[];let program:WebGLProgram|null=null,buffer:WebGLBuffer|null=null,texture:WebGLTexture|null=null;
  try{
   this.anisotropy=sourceTextureAnisotropy(gl);
   const shader=(type:number,source:string)=>{const s=gl.createShader(type);if(!s)throw new Error('无法创建公式着色器');shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error('公式着色器编译失败');return s;};
   program=gl.createProgram();if(!program)throw new Error('无法创建公式绘图程序');
   gl.attachShader(program,shader(gl.VERTEX_SHADER,`#version 300 es
in vec2 position;in vec2 texCoord;out vec2 uv;uniform vec2 projection;void main(){uv=texCoord;gl_Position=vec4(position*projection,0.,1.);}`));
   gl.attachShader(program,shader(gl.FRAGMENT_SHADER,`#version 300 es
precision highp float;in vec2 uv;uniform sampler2D tex;out vec4 color;void main(){color=texture(tex,uv);}`));
   gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('公式绘图程序链接失败');gl.useProgram(program);
   buffer=gl.createBuffer();texture=gl.createTexture();if(!buffer||!texture)throw new Error('无法创建公式图形资源');
   gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,this.vertices.byteLength,gl.DYNAMIC_DRAW);
   for(const [name,offset] of [['position',0],['texCoord',8]] as const){const a=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,16,offset);}
   const projection=gl.getUniformLocation(program,'projection');if(!projection)throw new Error('公式着色器缺少布局参数');
   this.program=program;this.buffer=buffer;this.texture=texture;this.projection=projection;
   gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
  }catch(error){if(texture)gl.deleteTexture(texture);if(buffer)gl.deleteBuffer(buffer);if(program)gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();throw error;}
  finally{for(const s of shaders)gl.deleteShader(s);}
 }
 private quad(corners:readonly number[]|Float32Array){
  for(let i=0;i<QUAD_ORDER.length;i++){const corner=QUAD_ORDER[i]*2,at=i*4;this.vertices[at]=corners[corner];this.vertices[at+1]=corners[corner+1];this.vertices[at+2]=QUAD_UV[corner];this.vertices[at+3]=QUAD_UV[corner+1];}
  const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,this.vertices);gl.drawArrays(gl.TRIANGLES,0,6);
 }
 private check(){if(this.disposed||this.gl.isContextLost())throw new Error('源公式图形上下文已释放或丢失');}
 private upload(texture:WebGLTexture,width:number,height:number,pixels:Uint8Array|Uint8ClampedArray,mipmap:boolean){
  const gl=this.gl;gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,mipmap?gl.LINEAR:gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,mipmap?gl.LINEAR_MIPMAP_LINEAR:gl.NEAREST);if(mipmap){gl.generateMipmap(gl.TEXTURE_2D);if(this.anisotropy)gl.texParameterf(gl.TEXTURE_2D,this.anisotropy.parameter,this.anisotropy.maximum);}
 }
 draw(prepared:PreparedSourceFormula,width:number,height:number,base:Uint8ClampedArray){
  this.check();const gl=this.gl;
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>MAX_RASTER_PIXELS||width>gl.getParameter(gl.MAX_TEXTURE_SIZE)||height>gl.getParameter(gl.MAX_TEXTURE_SIZE))throw new Error('源公式合成画布超出图像预算');
  if(!(base.buffer instanceof ArrayBuffer)||base.length!==width*height*4)throw new Error('源公式需要完整未共享的基础 RGBA 图像');
  if(prepared.glyphs.length!==prepared.presentation.labels.length)throw new Error('源公式字形与标注不对应');
  if(this.canvas.width!==width)this.canvas.width=width;if(this.canvas.height!==height)this.canvas.height=height;
  gl.viewport(0,0,width,height);gl.useProgram(this.program);gl.uniform2f(this.projection,Math.fround(2/width),Math.fround(-2/height));gl.disable(gl.BLEND);gl.disable(gl.DITHER);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
  this.upload(this.texture,width,height,base,false);this.quad([-width/2,-height/2,-width/2,height/2,width/2,height/2,width/2,-height/2]);
  const keep=new Set(prepared.glyphs);for(const [glyph,texture]of this.textures)if(!keep.has(glyph)){gl.deleteTexture(texture);this.textures.delete(glyph);}
  gl.enable(gl.BLEND);gl.blendEquationSeparate(gl.FUNC_ADD,gl.FUNC_ADD);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE);
  prepared.glyphs.forEach((glyph,index)=>{
   let texture=this.textures.get(glyph);if(!texture){texture=gl.createTexture()??undefined;if(!texture)throw new Error('无法创建公式纹理');this.textures.set(glyph,texture);this.upload(texture,glyph.width,glyph.height,glyph.pixels,true);}else gl.bindTexture(gl.TEXTURE_2D,texture);
   this.quad(sourceFormulaQuad(prepared.presentation,prepared.presentation.labels[index],width,height,glyph));
  });
  const overlay=prepared.presentation.finalBlackOverlayAlpha??0;
  if(overlay){
   // The source's final black rectangle uses the same straight-RGB/additive-
   // alpha blend as glyphs. Reuse the owned base texture after its copy pass.
   this.upload(this.texture,1,1,new Uint8Array([0,0,0,overlay]),false);
   this.quad([-width/2,-height/2,-width/2,height/2,width/2,height/2,width/2,-height/2]);
  }
  this.check();if(gl.getError()!==gl.NO_ERROR)throw new Error('源公式 GPU 合成失败');
 }
 readPixels(){
  this.check();const {width,height}=this.canvas,gl=this.gl,pixels=new Uint8ClampedArray(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);this.check();if(gl.getError()!==gl.NO_ERROR)throw new Error('源公式像素回读失败');flipRows(pixels,width,height);return pixels;
 }
 dispose(){if(this.disposed)return;this.disposed=true;const gl=this.gl;for(const t of this.textures.values())gl.deleteTexture(t);this.textures.clear();gl.deleteTexture(this.texture);gl.deleteBuffer(this.buffer);gl.deleteProgram(this.program);gl.getExtension('WEBGL_lose_context')?.loseContext();this.canvas.width=this.canvas.height=0;}
}
function flipRows(pixels:Uint8ClampedArray,width:number,height:number){const stride=width*4,row=new Uint8ClampedArray(stride);for(let y=0;y<Math.floor(height/2);y++){const a=y*stride,b=(height-y-1)*stride;row.set(pixels.subarray(a,a+stride));pixels.copyWithin(a,b,b+stride);pixels.set(row,b);}}
/** Read the source framebuffer without Canvas2D's alpha conversion. Reading
 * changes no WebGL bindings. Other canvas types use their ordinary 2D copy. */
export function formulaBasePixels(canvas:HTMLCanvasElement):Uint8ClampedArray<ArrayBuffer>{
 const {width,height}=canvas;if(width<1||height<1||!Number.isSafeInteger(width*height)||width*height>MAX_RASTER_PIXELS)throw new Error('源公式基础图像超出预算');
 const gl=canvas.getContext('webgl2');if(gl){const pixels=new Uint8ClampedArray(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);if(gl.isContextLost()||gl.getError()!==gl.NO_ERROR)throw new Error('无法读取源公式基础帧');flipRows(pixels,width,height);return pixels;}
 const owned=document.createElement('canvas');owned.width=width;owned.height=height;try{const ctx=owned.getContext('2d');if(!ctx)throw new Error('无法读取公式基础图像');ctx.drawImage(canvas,0,0);return ctx.getImageData(0,0,width,height).data;}finally{owned.width=owned.height=0;}
}
export async function compositeSourceFormulaPixels(base:Uint8ClampedArray,width:number,height:number,presentation:SourceFormulaPresentation,signal?:AbortSignal){
 const prepared=await prepareSourceFormulas(presentation,signal);if(signal?.aborted)throw new DOMException('公式合成已取消','AbortError');
 const compositor=new SourceFormulaCompositor();try{compositor.draw(prepared,width,height,base);return compositor.readPixels();}finally{compositor.dispose();}
}
