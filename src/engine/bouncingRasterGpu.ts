import {bouncingCollisionVertex,prepareBouncingGpuBoundary} from './bouncingGpu';
import {MAX_RASTER_PIXELS} from './rasterDimensions';
import type {Boundary,Point} from '../scenes/bouncing';
export interface BouncingRasterView {centerX:number;centerY:number;spanX:number;spanY:number;}
export interface BouncingRasterFrame {
 initial:Float64Array;count:number;boundary:Boundary;time:number;weight:number;diameter:number;
 matrix:[number,number,number,number,number,number];view:BouncingRasterView;palette:Float32Array;metric:number;
 repair:(index:number)=>Point;cancel?:()=>void;
}
const CHUNK=65536;
const passthrough=`#version 300 es
precision highp float;out vec4 color;void main(){color=vec4(0.);}`;
const splatVertex=`#version 300 es
precision highp float;precision highp int;
layout(location=0) in vec4 state;layout(location=1) in float indexColor;
uniform vec2 dimensions,viewCenter,viewSpan;uniform vec4 matrix;uniform vec2 translation;
uniform float physicalScale,diameter,weight;uniform int first,total,metric;uniform sampler2D palette;
flat out vec2 center;flat out vec3 rgb;flat out float radius;flat out float colorRisk;
void main(){
 vec2 p=state.xy*physicalScale;vec2 world=vec2(matrix.x*p.x+matrix.y*p.y,matrix.z*p.x+matrix.w*p.y)+translation;
 center=(world-viewCenter)/viewSpan*dimensions+dimensions*.5;radius=diameter*.5;
 float t=metric==0?float(first+gl_InstanceID)/float(max(1,total-1)):metric==1?length((world-viewCenter)/(viewSpan*.5)):metric==2?atan(world.y-viewCenter.y,world.x-viewCenter.x)/6.28318530718+.5:(world.y-viewCenter.y)/viewSpan.y+.5;
 float lookup=clamp(t,0.,1.)*4095.;int colorIndex=metric==0?int(indexColor):int(lookup+.5);rgb=texelFetch(palette,ivec2(colorIndex,0),0).rgb;
 int nearIndex=fract(lookup)<.5?min(4095,colorIndex+1):max(0,colorIndex-1);vec3 nearColor=texelFetch(palette,ivec2(nearIndex,0),0).rgb;
 colorRisk=metric!=0&&abs(fract(lookup)-.5)<.002&&max(max(abs(rgb.r-nearColor.r),abs(rgb.g-nearColor.g)),abs(rgb.b-nearColor.b))>1./64.?1.:0.;
 if(metric==2&&length((world-viewCenter)/viewSpan)<.00001)colorRisk=1.;
 vec2 offsets[6]=vec2[6](vec2(-1.,-1.),vec2(1.,-1.),vec2(-1.,1.),vec2(-1.,1.),vec2(1.,-1.),vec2(1.,1.));
 vec2 pixel=center+offsets[gl_VertexID]*(radius+.5);gl_Position=vec4(pixel/dimensions*2.-1.,0.,1.);
}`;
const splatFragment=`#version 300 es
precision highp float;flat in vec2 center;flat in vec3 rgb;flat in float radius;flat in float colorRisk;uniform float weight;layout(location=0) out vec4 color;layout(location=1) out float contributions;
void main(){float mass=clamp(radius+.5-length(gl_FragCoord.xy-center),0.,1.)*min(1.,4.*radius*radius)*weight;color=vec4(rgb*mass,mass);contributions=mass>0.?max(1.,colorRisk*65537.):0.;}`;
const fullVertex=`#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}`;
const toneFragment=`#version 300 es
precision highp float;uniform sampler2D accumulation;uniform float exposure;uniform vec3 background;uniform bool transparent;out vec4 color;
void main(){vec4 v=texelFetch(accumulation,ivec2(gl_FragCoord.xy),0);float a=1.-exp(-v.a*exposure);vec3 rgb=v.a>0.?clamp(v.rgb/v.a,0.,1.):vec3(0.);color=transparent?vec4(rgb,a):vec4(mix(background,rgb,a),1.);}`;
const riskVertex=`#version 300 es
precision highp float;precision highp int;uniform sampler2D counts;uniform int imageWidth;flat out float risk;
void main(){risk=texelFetch(counts,ivec2(gl_VertexID%imageWidth,gl_VertexID/imageWidth),0).r>65536.?1.:0.;gl_Position=vec4(0.,0.,0.,1.);gl_PointSize=1.;}`;
const riskFragment=`#version 300 es
precision highp float;flat in float risk;out vec4 color;void main(){color=vec4(risk);}`;
/** One owner retains programs only. All per-image and per-batch GL handles are released by end/reset. */
export class BouncingRasterGpu {
 private gl?:WebGL2RenderingContext;private programs:WebGLProgram[]=[];private textures:WebGLTexture[]=[];private buffers:WebGLBuffer[]=[];private fb?:WebGLFramebuffer;private vao?:WebGLVertexArrayObject;private tf?:WebGLTransformFeedback;private width=0;private height=0;private active=false;
 private program(vertex:string,fragment:string,feedback=false){const g=this.gl!,p=g.createProgram();if(!p)throw new Error('GPU program 分配失败');const shaders:WebGLShader[]=[];try{for(const [kind,source]of [[g.VERTEX_SHADER,vertex],[g.FRAGMENT_SHADER,fragment]] as const){const s=g.createShader(kind);if(!s)throw new Error('GPU shader 分配失败');shaders.push(s);g.shaderSource(s,source);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw new Error(String(g.getShaderInfoLog(s)));g.attachShader(p,s);}if(feedback)g.transformFeedbackVaryings(p,['nextState','status'],g.SEPARATE_ATTRIBS);g.linkProgram(p);if(!g.getProgramParameter(p,g.LINK_STATUS))throw new Error(String(g.getProgramInfoLog(p)));return p;}catch(e){g.deleteProgram(p);throw e;}finally{shaders.forEach(s=>g.deleteShader(s));}}
 begin(width:number,height:number){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>MAX_RASTER_PIXELS)throw new Error('GPU 图像超过 128 MiB RGBA 输出预算');
  this.end();if(this.gl?.isContextLost()){this.dispose();throw new Error('WebGL2 上下文丢失；下次重新创建');}
  if(!this.gl){if(typeof OffscreenCanvas==='undefined')throw new Error('OffscreenCanvas 不可用');this.gl=new OffscreenCanvas(1,1).getContext('webgl2',{antialias:false,alpha:true,premultipliedAlpha:false,depth:false,stencil:false})??undefined;if(!this.gl)throw new Error('WebGL2 不可用');}
  const g=this.gl;if(!g.getExtension('EXT_color_buffer_float')||!g.getExtension('EXT_float_blend'))throw new Error('浮点颜色累积/混合扩展不可用');
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||Math.max(width,height)>g.getParameter(g.MAX_TEXTURE_SIZE))throw new Error('GPU 图像尺寸超出纹理容量');
  try{
   if(!this.programs.length){this.programs.push(this.program(bouncingCollisionVertex,passthrough,true));this.programs.push(this.program(splatVertex,splatFragment));this.programs.push(this.program(fullVertex,toneFragment));this.programs.push(this.program(riskVertex,riskFragment));}
   this.width=width;this.height=height;this.fb=g.createFramebuffer()??undefined;this.vao=g.createVertexArray()??undefined;this.tf=g.createTransformFeedback()??undefined;if(!this.fb||!this.vao||!this.tf)throw new Error('GPU 帧对象分配失败');
   for(let i=0;i<3;i++){const b=g.createBuffer();if(!b)throw new Error('GPU 分块状态分配失败');this.buffers.push(b);g.bindBuffer(g.ARRAY_BUFFER,b);g.bufferData(g.ARRAY_BUFFER,CHUNK*(i===0?20:i===2?4:16),g.DYNAMIC_COPY);}
   for(let i=0;i<5;i++){const t=g.createTexture();if(!t)throw new Error('GPU 纹理分配失败');this.textures.push(t);g.bindTexture(g.TEXTURE_2D,t);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);const w=i===2?4096:i===4?1:width,h=i===2||i===4?1:height;g.texImage2D(g.TEXTURE_2D,0,i===1||i===4?g.RGBA8:i===3?g.R32F:g.RGBA32F,w,h,0,i===3?g.RED:g.RGBA,i===1||i===4?g.UNSIGNED_BYTE:g.FLOAT,null);}
   this.target(0);g.clearColor(0,0,0,0);g.clear(g.COLOR_BUFFER_BIT);g.bindVertexArray(this.vao);this.check();
  }catch(e){this.end();throw e;}
 }
 private target(index:number){const g=this.gl!;g.bindFramebuffer(g.FRAMEBUFFER,this.fb!);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,this.textures[index],0);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT1,g.TEXTURE_2D,index===0?this.textures[3]:null,0);g.drawBuffers(index===0?[g.COLOR_ATTACHMENT0,g.COLOR_ATTACHMENT1]:[g.COLOR_ATTACHMENT0]);if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw new Error('GPU 浮点帧缓冲不完整');g.viewport(0,0,this.width,this.height);}
 private check(){const g=this.gl!,error=g.getError();if(error!==g.NO_ERROR||g.isContextLost())throw new Error(`GPU 图像计算/读回失败 (${error})`);}
 frame(job:BouncingRasterFrame):number {
  const g=this.gl;if(!g||!this.fb)throw new Error('GPU 图像尚未开始');const b=prepareBouncingGpuBoundary(job.boundary),n=job.count;if(n<1||n>5_000_000||job.initial.length<n*4)throw new Error('GPU 初始状态数量无效');if(!Number.isFinite(job.time)||job.time<0||!Number.isFinite(Math.fround(job.time)))throw new Error('GPU 时间不可表示');
  for(const value of [...job.matrix,job.view.centerX,job.view.centerY,job.view.spanX,job.view.spanY])if(!Number.isFinite(Math.fround(value)))throw new Error('GPU 视口/变换不能表示为 float32');
  const unit=Math.max(this.width/job.view.spanX,this.height/job.view.spanY);for(let k=0;k<6;k++)if(Math.abs(job.matrix[k]-Math.fround(job.matrix[k]))*(k<4?b.scale:1)*unit>.002)throw new Error('GPU 变换精度不足，需要 CPU');
  const input=new Float32Array(CHUNK*5),flags=new Float32Array(CHUNK),fixed=new Float32Array(4);let repairs=0;
  g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,this.textures[2]);g.texSubImage2D(g.TEXTURE_2D,0,0,0,4096,1,g.RGBA,g.FLOAT,job.palette);
  for(let first=0;first<n;first+=CHUNK){
   job.cancel?.();const count=Math.min(CHUNK,n-first);
   for(let i=0;i<count;i++){const at=(first+i)*4;for(let k=0;k<4;k++){const v=job.initial[at+k]/b.scale;if(!Number.isFinite(Math.fround(v))||(v!==0&&Math.abs(v)<1e-30))throw new Error('归一化粒子超出 GPU 精度');input[i*5+k]=v;}if(Math.hypot(input[i*5+2],input[i*5+3])*job.time>128)throw new Error('弹道距离超出 GPU 碰撞预算');input[i*5+4]=Math.round((first+i)*4095/Math.max(1,n-1));}
   g.bindVertexArray(this.vao!);g.bindBuffer(g.ARRAY_BUFFER,this.buffers[0]);g.bufferSubData(g.ARRAY_BUFFER,0,input.subarray(0,count*5));g.enableVertexAttribArray(0);g.disableVertexAttribArray(1);g.vertexAttribDivisor(0,0);g.vertexAttribPointer(0,4,g.FLOAT,false,20,0);
   const p=this.programs[0],loc=(k:string)=>g.getUniformLocation(p,k);g.useProgram(p);g.uniform1i(loc('kind'),b.kind);g.uniform1i(loc('planeCount'),b.planeCount);g.uniform2f(loc('axes'),...b.axes);g.uniform3fv(loc('planes[0]'),b.planes);g.uniform1f(loc('elapsed'),job.time);
   g.bindTransformFeedback(g.TRANSFORM_FEEDBACK,this.tf!);g.bindBufferBase(g.TRANSFORM_FEEDBACK_BUFFER,0,this.buffers[1]);g.bindBufferBase(g.TRANSFORM_FEEDBACK_BUFFER,1,this.buffers[2]);g.enable(g.RASTERIZER_DISCARD);g.beginTransformFeedback(g.POINTS);this.active=true;g.drawArrays(g.POINTS,0,count);g.endTransformFeedback();this.active=false;g.disable(g.RASTERIZER_DISCARD);g.bindBuffer(g.TRANSFORM_FEEDBACK_BUFFER,this.buffers[2]);g.getBufferSubData(g.TRANSFORM_FEEDBACK_BUFFER,0,flags,0,count);g.bindBufferBase(g.TRANSFORM_FEEDBACK_BUFFER,0,null);g.bindBufferBase(g.TRANSFORM_FEEDBACK_BUFFER,1,null);g.bindTransformFeedback(g.TRANSFORM_FEEDBACK,null);this.check();
   g.bindBuffer(g.ARRAY_BUFFER,this.buffers[1]);
   for(let i=0;i<count;i++)if(flags[i]!==0){const q=job.repair(first+i);fixed.set([q[0]/b.scale,q[1]/b.scale,0,0]);g.bufferSubData(g.ARRAY_BUFFER,i*16,fixed);repairs++;}
   g.vertexAttribPointer(0,4,g.FLOAT,false,0,0);g.vertexAttribDivisor(0,1);g.bindBuffer(g.ARRAY_BUFFER,this.buffers[0]);g.enableVertexAttribArray(1);g.vertexAttribPointer(1,1,g.FLOAT,false,20,16);g.vertexAttribDivisor(1,1);const draw=this.programs[1],dl=(k:string)=>g.getUniformLocation(draw,k);g.useProgram(draw);g.uniform2f(dl('dimensions'),this.width,this.height);g.uniform2f(dl('viewCenter'),job.view.centerX,job.view.centerY);g.uniform2f(dl('viewSpan'),job.view.spanX,job.view.spanY);g.uniform4f(dl('matrix'),...job.matrix.slice(0,4) as [number,number,number,number]);g.uniform2f(dl('translation'),job.matrix[4],job.matrix[5]);g.uniform1f(dl('physicalScale'),b.scale);g.uniform1f(dl('diameter'),job.diameter);g.uniform1f(dl('weight'),job.weight);g.uniform1i(dl('first'),first);g.uniform1i(dl('total'),n);g.uniform1i(dl('metric'),job.metric);g.uniform1i(dl('palette'),0);
   this.target(0);g.enable(g.BLEND);g.blendEquation(g.FUNC_ADD);g.blendFunc(g.ONE,g.ONE);g.drawArraysInstanced(g.TRIANGLES,0,6,count);g.disable(g.BLEND);this.check();
  }
  return repairs;
 }
 finish(exposure:number,background:[number,number,number],transparent:boolean):Uint8ClampedArray {
  const g=this.gl!,p=this.programs[2];this.target(4);g.viewport(0,0,1,1);g.clearColor(0,0,0,0);g.clear(g.COLOR_BUFFER_BIT);g.disableVertexAttribArray(0);g.disableVertexAttribArray(1);g.vertexAttribDivisor(0,0);const risk=this.programs[3];g.useProgram(risk);g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,this.textures[3]);g.uniform1i(g.getUniformLocation(risk,'counts'),0);g.uniform1i(g.getUniformLocation(risk,'imageWidth'),this.width);g.enable(g.BLEND);g.blendEquation(g.MAX);g.blendFunc(g.ONE,g.ONE);g.drawArrays(g.POINTS,0,this.width*this.height);g.disable(g.BLEND);const flag=new Uint8Array(4);g.readPixels(0,0,1,1,g.RGBA,g.UNSIGNED_BYTE,flag);this.check();if(flag[0])throw new Error('单像素贡献超过 65536 次或高反差颜色边界精度不足，需要 CPU 双精度累积');this.target(1);g.useProgram(p);g.disableVertexAttribArray(0);g.disableVertexAttribArray(1);g.vertexAttribDivisor(0,0);g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,this.textures[0]);const loc=(k:string)=>g.getUniformLocation(p,k);g.uniform1i(loc('accumulation'),0);g.uniform1f(loc('exposure'),exposure);g.uniform3f(loc('background'),...background);g.uniform1i(loc('transparent'),Number(transparent));g.drawArrays(g.TRIANGLES,0,3);
  const pixels=new Uint8ClampedArray(this.width*this.height*4);g.readPixels(0,0,this.width,this.height,g.RGBA,g.UNSIGNED_BYTE,pixels);this.check();const stride=this.width*4,row=new Uint8ClampedArray(stride);for(let y=0;y<Math.floor(this.height/2);y++){const a=y*stride,b=(this.height-1-y)*stride;row.set(pixels.subarray(a,a+stride));pixels.copyWithin(a,b,b+stride);pixels.set(row,b);}return pixels;
 }
 end(){const g=this.gl;if(g){if(this.active)g.endTransformFeedback();this.active=false;g.disable(g.RASTERIZER_DISCARD);g.disable(g.BLEND);g.bindTransformFeedback(g.TRANSFORM_FEEDBACK,null);g.bindFramebuffer(g.FRAMEBUFFER,null);g.bindVertexArray(null);for(const b of this.buffers)g.deleteBuffer(b);for(const t of this.textures)g.deleteTexture(t);g.deleteFramebuffer(this.fb??null);g.deleteVertexArray(this.vao??null);g.deleteTransformFeedback(this.tf??null);}this.buffers=[];this.textures=[];this.fb=undefined;this.vao=undefined;this.tf=undefined;}
 dispose(){this.end();if(this.gl){this.programs.forEach(p=>this.gl!.deleteProgram(p));this.gl.getExtension('WEBGL_lose_context')?.loseContext();}this.programs=[];this.gl=undefined;}
}
