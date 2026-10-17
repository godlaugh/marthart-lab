import type {RootsMetricColorPlan} from './rootsDensityColor';
import {rootsDensityScale,validateRootsMetricColorPlan} from './rootsDensityColor';
import {RootsGpuError,rootsGpuCall,rootsGpuCleanup,rootsGpuFinally,rootsGpuInput,rootsGpuCancel as cancel,rootsGpuRequire as require} from './rootsGpuFailure';

const TILE=512,REDUCE=4,HEADER='#version 300 es\nprecision highp float;precision highp int;precision highp usampler2D;\n';
const VERTEX=HEADER+'void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}';
const FRAGMENT=HEADER+`
uniform sampler2D ink,paletteTex;uniform ivec2 origin,imageSize;
uniform float paletteOffset,brightness,contrast,gamma,dynamicRange,saturation,scale;uniform vec3 backgroundRgb;
layout(location=0)out vec4 pixel;layout(location=1)out uvec4 facts;
bool finiteFloat(float x){return !isnan(x)&&!isinf(x);}
float smoothLimit(float x,float k){x=2.0*x-1.0;float a=pow(abs(x),1.0/max(k,0.01));return sign(x)*pow(a/(a+1.0),max(k,0.01))*0.5+0.5;}
void main(){ivec2 p=origin+ivec2(gl_FragCoord.xy);vec4 accum=texelFetch(ink,ivec2(p.x,imageSize.y-1-p.y),0);
 bool valid=all(not(isnan(accum)))&&all(not(isinf(accum)))&&accum.r>=0.&&accum.g>=0.&&accum.g<=accum.r&&accum.b==0.&&accum.a==0.;
 float count=max(accum.r,0.);facts=uvec4(count>0.?1u:0u,floatBitsToUint(count),valid?0u:1u,0u);
 if(!valid||count<=1.0e-12){pixel=vec4(backgroundRgb,1.);return;}
 float avgT=accum.g/count;vec3 avgRgb=texture(paletteTex,vec2(fract(avgT+paletteOffset),0.5)).rgb;
 float density=count/max(scale,1.0e-8);float v=density==0.0?-20.0:(log(density)-log(1.0))/(log(1000.0)-log(1.0));
 float value=smoothLimit(contrast*v+brightness,dynamicRange);float densityBrightness=clamp(value,0.0,1.0);
 vec3 rgb=mix(backgroundRgb,avgRgb,densityBrightness);rgb=pow(clamp(rgb,0.0,1.0),vec3(1.0/max(gamma,0.001)));
 float luma=dot(rgb,vec3(0.299,0.587,0.114));rgb=mix(vec3(luma),rgb,saturation);
 facts.w=all(not(isnan(rgb)))&&all(not(isinf(rgb)))?0u:1u;pixel=vec4(rgb,1.);
}`;
const REDUCTION=HEADER+`
uniform usampler2D values;uniform ivec2 size;layout(location=0)out uvec4 facts;
void main(){ivec2 start=ivec2(gl_FragCoord.xy)*4;uvec4 sum=uvec4(0);for(int y=0;y<4;y++)for(int x=0;x<4;x++){ivec2 p=start+ivec2(x,y);if(all(lessThan(p,size))){uvec4 v=texelFetch(values,p,0);sum.x+=v.x;sum.y=max(sum.y,v.y);sum.z|=v.z;sum.w|=v.w;}}facts=sum;}`;

/** GPU attachments + prepared/cached/GPU LUT copies + CPU statistics. Whole output and
 * optional same-ink full readback are accounted by the accumulator owner. */
export function rootsMetricToneGpuBytes():number{return TILE*TILE*20+Math.ceil(TILE/REDUCE)**2*32+3072+16;}
interface Program {handle:WebGLProgram;locations:Map<string,WebGLUniformLocation|null>;}
export interface RootsMetricGpuToneResult {pixels:Uint8ClampedArray;occupiedPixels:number;maxCount:number;needsCpu:boolean;}
/** Exclusive serial borrower of the roots accumulator context. No borrowed
 * ink deletion or context loss, and no ambient GL state restoration promise. */
export class RootsDensityToneGpu {
 private programs:Program[]=[];private shaders=new Set<WebGLShader>();private textures:WebGLTexture[]=[];private framebuffer?:WebGLFramebuffer;private uploadedLut?:Uint8Array;
 constructor(private readonly gl:WebGL2RenderingContext){}
 diagnostics(){return{retainedBytes:this.textures.length?rootsMetricToneGpuBytes()-16:0,handles:this.programs.length+this.shaders.size+this.textures.length+Number(!!this.framebuffer)};}
 private program(fragment:string){const gl=this.gl,p=gl.createProgram();require(p,'GPU root tone program allocation failed');const owned:Program={handle:p,locations:new Map()};this.programs.push(owned);
  for(const [type,source]of[[gl.VERTEX_SHADER,VERTEX],[gl.FRAGMENT_SHADER,fragment]]as const){const s=gl.createShader(type);require(s,'GPU root tone shader allocation failed');this.shaders.add(s);gl.shaderSource(s,source);gl.compileShader(s);require(gl.getShaderParameter(s,gl.COMPILE_STATUS),'GPU root tone compile failed: '+gl.getShaderInfoLog(s));gl.attachShader(p,s);}
  gl.linkProgram(p);require(gl.getProgramParameter(p,gl.LINK_STATUS),'GPU root tone link failed: '+gl.getProgramInfoLog(p));for(const s of this.shaders){rootsGpuCleanup(()=>{gl.deleteShader(s);this.shaders.delete(s);});}return owned;
 }
 private texture(width:number,height:number,format:number,layout:number,type:number,filter:number){const gl=this.gl,t=gl.createTexture();require(t,'GPU root tone texture allocation failed');this.textures.push(t);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,format,width,height,0,layout,type,null);return t;}
 private ensure(){if(this.framebuffer)return;rootsGpuCall(()=>{const gl=this.gl;require(!gl.isContextLost(),'GPU root tone context lost');require(gl.getParameter(gl.MAX_DRAW_BUFFERS)>=2&&gl.getParameter(gl.MAX_TEXTURE_SIZE)>=TILE,'GPU root tone capability unavailable');this.program(FRAGMENT);this.program(REDUCTION);this.texture(TILE,TILE,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,gl.NEAREST);this.texture(TILE,TILE,gl.RGBA32UI,gl.RGBA_INTEGER,gl.UNSIGNED_INT,gl.NEAREST);for(let i=0;i<2;i++)this.texture(TILE/REDUCE,TILE/REDUCE,gl.RGBA32UI,gl.RGBA_INTEGER,gl.UNSIGNED_INT,gl.NEAREST);this.texture(256,1,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,gl.LINEAR);this.framebuffer=gl.createFramebuffer()??undefined;require(this.framebuffer,'GPU root tone framebuffer allocation failed');require(gl.getError()===gl.NO_ERROR,'GPU root tone allocation failed');});}
 private location(p:Program,name:string){if(!p.locations.has(name))p.locations.set(name,this.gl.getUniformLocation(p.handle,name));return p.locations.get(name)!;}
 private bind(t:WebGLTexture,unit:number){this.gl.activeTexture(this.gl.TEXTURE0+unit);this.gl.bindTexture(this.gl.TEXTURE_2D,t);}
 private target(t:WebGLTexture,w:number,h:number,second?:WebGLTexture){const gl=this.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer!);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT1,gl.TEXTURE_2D,second??null,0);gl.drawBuffers(second?[gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]:[gl.COLOR_ATTACHMENT0]);require(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'GPU root tone framebuffer incomplete');gl.viewport(0,0,w,h);}
 render(ink:WebGLTexture,width:number,height:number,plan:RootsMetricColorPlan,exposure:{submittedFinitePointCount:number},isCancelled?:()=>boolean,destination?:Uint8ClampedArray):RootsMetricGpuToneResult{
  cancel(isCancelled);require([width,height].every(v=>Number.isInteger(v)&&v>0&&v<=16384)&&width*height<=33554432,'GPU root tone dimensions exceed capacity','capacity');require(!destination||destination instanceof Uint8ClampedArray&&destination.length===width*height*4,'GPU root tone destination is invalid','input');const scale=rootsGpuInput(()=>{validateRootsMetricColorPlan(plan);return rootsDensityScale({...exposure,width,height});});this.ensure();
  const gl=this.gl,[output,stats,reduceA,reduceB,lut]=this.textures,[tone,reduction]=this.programs,pixels=destination??new Uint8ClampedArray(width*height*4),facts=new Uint32Array(4);let occupiedPixels=0,maxBits=0,needsCpu=false;pixels.fill(0);
  rootsGpuCall(()=>{gl.bindVertexArray(null);gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.DITHER);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.pixelStorei(gl.PACK_ALIGNMENT,1);this.bind(lut,1);if(!this.uploadedLut||!this.uploadedLut.every((v,i)=>v===plan.lut[i])){gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,256,1,gl.RGBA,gl.UNSIGNED_BYTE,plan.lut);this.uploadedLut=new Uint8Array(plan.lut);}gl.useProgram(tone.handle);gl.uniform1i(this.location(tone,'ink'),0);gl.uniform1i(this.location(tone,'paletteTex'),1);gl.uniform2i(this.location(tone,'imageSize'),width,height);for(const name of ['paletteOffset','brightness','contrast','gamma','dynamicRange','saturation']as const)gl.uniform1f(this.location(tone,name),plan[name]);gl.uniform1f(this.location(tone,'scale'),scale);gl.uniform3f(this.location(tone,'backgroundRgb'),plan.backgroundRGB[0],plan.backgroundRGB[1],plan.backgroundRGB[2]);});
  return rootsGpuFinally(()=>{for(let y=0;y<height;y+=TILE)for(let x=0;x<width;x+=TILE){cancel(isCancelled);const w=Math.min(TILE,width-x),h=Math.min(TILE,height-y);
    rootsGpuCall(()=>{gl.useProgram(tone.handle);this.bind(ink,0);this.bind(lut,1);gl.uniform2i(this.location(tone,'origin'),x,y);this.target(output,w,h,stats);gl.drawArrays(gl.TRIANGLES,0,3);gl.useProgram(reduction.handle);gl.uniform1i(this.location(reduction,'values'),0);let rw=w,rh=h,source=stats,side=0;do{this.bind(source,0);gl.uniform2i(this.location(reduction,'size'),rw,rh);rw=Math.ceil(rw/4);rh=Math.ceil(rh/4);source=side++%2?reduceB:reduceA;this.target(source,rw,rh);gl.drawArrays(gl.TRIANGLES,0,3);}while(rw>1||rh>1);facts.fill(0xffffffff);gl.pixelStorei(gl.PACK_ROW_LENGTH,0);gl.pixelStorei(gl.PACK_SKIP_PIXELS,0);gl.pixelStorei(gl.PACK_SKIP_ROWS,0);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.readPixels(0,0,1,1,gl.RGBA_INTEGER,gl.UNSIGNED_INT,facts);require(gl.getError()===gl.NO_ERROR&&!gl.isContextLost(),'GPU root tone statistics readback failed');});
    require(facts.every(value=>value!==0xffffffff),'GPU root statistics readback is incomplete','device');require(facts[2]===0,'GPU root metric ink is invalid','input');occupiedPixels+=facts[0];maxBits=Math.max(maxBits,facts[1]);needsCpu||=facts[3]!==0;
    rootsGpuCall(()=>{this.target(output,w,h);gl.pixelStorei(gl.PACK_ROW_LENGTH,width);gl.pixelStorei(gl.PACK_SKIP_PIXELS,x);gl.pixelStorei(gl.PACK_SKIP_ROWS,y);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);require(gl.getError()===gl.NO_ERROR&&!gl.isContextLost(),'GPU root tone pixel readback failed');});
    for(let row=0;row<h;row++){cancel(isCancelled);for(let column=0;column<w;column++)require(pixels[((y+row)*width+x+column)*4+3]===255,'GPU root tone readback is incomplete','device');}
   }cancel(isCancelled);return{pixels,occupiedPixels,maxCount:new Float32Array(new Uint32Array([maxBits]).buffer)[0],needsCpu};
  },()=>{gl.pixelStorei(gl.PACK_ROW_LENGTH,0);gl.pixelStorei(gl.PACK_SKIP_PIXELS,0);gl.pixelStorei(gl.PACK_SKIP_ROWS,0);gl.bindFramebuffer(gl.FRAMEBUFFER,null);});
 }
 dispose(){const gl=this.gl;let failure:unknown;const attempt=(f:()=>void)=>{try{f();}catch(e){failure??=e;}};
  for(const t of [...this.textures])attempt(()=>{gl.deleteTexture(t);this.textures.splice(this.textures.indexOf(t),1);});
  for(const p of [...this.programs])attempt(()=>{if(gl.getParameter(gl.CURRENT_PROGRAM)===p.handle)gl.useProgram(null);gl.deleteProgram(p.handle);this.programs.splice(this.programs.indexOf(p),1);});
  for(const s of [...this.shaders])attempt(()=>{gl.deleteShader(s);this.shaders.delete(s);});
  if(this.framebuffer)attempt(()=>{gl.deleteFramebuffer(this.framebuffer!);this.framebuffer=undefined;});
  if(failure)throw new RootsGpuError('GPU root tone cleanup failed','cleanup',{cause:failure});this.uploadedLut=undefined;
 }
}
