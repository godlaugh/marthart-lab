/** Parsed, finite inputs shared with the CPU Perlin texture renderer. Grid rows
 * and palette entries are in the producer's order; render returns top-down RGBA. */
export interface PerlinTextureJob {
 width:number;height:number;style:'filament'|'water';steps:number;step:number;time:number;
 brightness:number;vignette:number;fiber:number;
 transform:{sx:number;sy:number;co:number;si:number;ox:number;oy:number};
 values:Float32Array;flowX:Float32Array;flowY:Float32Array;palette:Float32Array;
 background:[number,number,number];transparent:boolean;
}
export interface PerlinGpuResult {pixels?:Uint8ClampedArray;warning?:string;}
const GRID=128,PALETTE=1024,MAX_PIXELS=16_777_216,TILE_EDGE=512;
const FLOAT_EPSILON=2**-23;
const vertex=`#version 300 es
precision highp float;
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}`;
const fragment=`#version 300 es
precision highp float;precision highp int;precision highp sampler2D;
uniform sampler2D scalarGrid,flowXGrid,flowYGrid,paletteGrid;
uniform vec2 size,scale,rotation,offset,tileOrigin,tileSize;
uniform float stepSize,timeValue,brightness,vignette,fiber;
uniform int steps,water,transparentBackground;
uniform vec3 backgroundColor;
layout(location=0) out vec4 color;
layout(location=1) out vec4 precisionStatus;
float sampleGrid(sampler2D data,vec2 point){
 vec2 q=fract(point)*128.;ivec2 raw=ivec2(floor(q));vec2 f=q-vec2(raw);
 // fract of a negative value close to zero can round to 1 in float32.
 ivec2 a=raw%128;
 ivec2 b=(a+ivec2(1))%128;
 // Explicit interpolation avoids float-texture filtering extension differences.
 float lower=texelFetch(data,a,0).r*(1.-f.x)+texelFetch(data,ivec2(b.x,a.y),0).r*f.x;
 float upper=texelFetch(data,ivec2(a.x,b.y),0).r*(1.-f.x)+texelFetch(data,b,0).r*f.x;
 return lower*(1.-f.y)+upper*f.y;
}
float flowCornerMagnitude(sampler2D data,vec2 point){
 ivec2 a=ivec2(floor(fract(point)*128.))%128,b=(a+ivec2(1))%128;
 return max(max(abs(texelFetch(data,a,0).r),abs(texelFetch(data,ivec2(b.x,a.y),0).r)),max(abs(texelFetch(data,ivec2(a.x,b.y),0).r),abs(texelFetch(data,b,0).r)));
}
float magnitude(vec2 v){float m=max(abs(v.x),abs(v.y));return m==0.?0.:m*sqrt(dot(v/m,v/m));}
void main(){
 vec2 pixel=tileOrigin+vec2(gl_FragCoord.x,tileSize.y-gl_FragCoord.y);
 vec2 world=vec2((2.*pixel.x-size.x)/size.y,(size.y-2.*pixel.y)/size.y)-offset;
 vec2 p=vec2(world.x*rotation.x+world.y*rotation.y,-world.x*rotation.y+world.y*rotation.x)/scale;
 float total=0.,weights=0.;bool unsafeFlow=false;
 for(int j=0;j<128;j++){
  if(j>=steps)break;
  vec2 q=p/8.+.5,velocity=vec2(sampleGrid(flowXGrid,q),sampleGrid(flowYGrid,q));
  float norm=magnitude(velocity);
  float corner=max(flowCornerMagnitude(flowXGrid,q),flowCornerMagnitude(flowYGrid,q));
  // Near cancellation amplifies interpolation error in the normalized direction.
  // 64 float32 epsilons bounds the local arithmetic margin; constant zero fields
  // remain exact and tiny, same-direction fields keep their full step length.
  if(corner>0. && norm<=corner*0.00000762939453125)unsafeFlow=true;
  if(norm==0.)norm=1.;p+=stepSize*velocity/norm;
  vec2 uv=vec2(p.x*.5+.5+timeValue*(water==1?.025:.008),p.y*.5+.5);
  float weight=water==1?1.:sin(3.141592653589793*(float(j)+.5)/float(steps));
  total+=sampleGrid(scalarGrid,uv)*weight;weights+=weight;
 }
 float tone=clamp(total/weights,0.,1.);
 float coordinate=clamp((1.-fiber)*(.5+.25*sin(p.x))+fiber*tone,0.,1.);
 int index=min(1023,int(floor(coordinate*1024.)));
 vec2 uv=pixel/size;
 float edge=max(0.,16.*uv.x*(1.-uv.x)*uv.y*(1.-uv.y));
 float light=brightness*pow(edge,vignette)*(.35+.65*tone),alpha=clamp(light,0.,1.);
 vec3 paletteColor=texelFetch(paletteGrid,ivec2(index,0),0).rgb;
 float fraction=coordinate==1.?1.:fract(coordinate*1024.);
 int neighbor=clamp(index+(fraction<.5?-1:1),0,1023);
 vec3 difference=abs(paletteColor-texelFetch(paletteGrid,ivec2(neighbor,0),0).rgb);
 // Eight float32 epsilons per accumulated step, expressed in LUT cells.
 // A discontinuous color jump near that boundary needs the CPU path.
 bool unsafePalette=min(fraction,1.-fraction)<=float(steps)/1024. && max(difference.r,max(difference.g,difference.b))>2./255.;
 vec3 rgb=clamp(paletteColor*min(light,1.),0.,1.);
 color=vec4(transparentBackground==1?rgb:rgb*alpha+backgroundColor*(1.-alpha),transparentBackground==1?alpha:1.);
 // Match the CPU's positive Math.round byte conversion, not driver tie rules.
 color=floor(clamp(color,0.,1.)*255.+.5)/255.;
 precisionStatus=vec4(unsafeFlow?1.:0.,unsafePalette?1.:0.,0.,1.);
}`;
function finiteFloat(value:number,label:string){if(typeof value!=='number'||!Number.isFinite(value)||!Number.isFinite(Math.fround(value)))throw new Error(`${label} 超出有限 float32 范围`);}
function range(value:number,label:string,min:number,max:number){finiteFloat(value,label);if(value<min||value>max)throw new Error(`${label} 必须在 ${min}–${max}`);}
function array(value:Float32Array,length:number,label:string,min:number,max:number){
 if(!(value instanceof Float32Array)||value.length!==length)throw new Error(`${label} 必须是 ${length} 个 Float32 数值`);
 for(let i=0;i<value.length;i++){const v=value[i];if(!Number.isFinite(v)||v<min||v>max)throw new Error(`${label}[${i}] 超出 ${min}–${max}`);if(v!==0&&Math.abs(v)<1e-30)throw new Error(`${label}[${i}] 过小，GPU 可能冲刷次正规数`);}
}
/** Validate representation expansion and float resolution before any GL allocation. */
export function validatePerlinTextureJob(job:PerlinTextureJob):void {
 if(!job||typeof job!=='object')throw new Error('缺少 Perlin 纹理输入');
 if(!Number.isSafeInteger(job.width)||!Number.isSafeInteger(job.height)||job.width<1||job.height<1||job.width>MAX_PIXELS||job.height>MAX_PIXELS||job.width*job.height>MAX_PIXELS)throw new Error('纹理图像必须为正整数且不超过 16777216 像素');
 if(!Number.isInteger(job.steps)||job.steps<1||job.steps>128)throw new Error('纹理沿场采样步数须为 1–128 的整数');
 if(!['filament','water'].includes(job.style)||typeof job.transparent!=='boolean')throw new Error('纹理模式或透明背景格式无效');
 range(job.step,'步长',.0001,.5);range(job.brightness,'亮度',0,10);range(job.vignette,'暗角',0,5);range(job.fiber,'细节混合',0,1);finiteFloat(job.time,'时间');
 if(!job.transform||typeof job.transform!=='object')throw new Error('缺少纹理空间变换');
 for(const key of ['sx','sy','co','si','ox','oy'] as const)finiteFloat(job.transform[key],key);
 const {sx,sy,co,si,ox,oy}=job.transform;if(Math.abs(sx)<1e-12||Math.abs(sy)<1e-12)throw new Error('纹理空间缩放不能为零');
 if(Math.abs(co*co+si*si-1)>1e-6)throw new Error('纹理旋转必须为单位旋转');
 const wx=job.width/job.height+Math.abs(ox),wy=1+Math.abs(oy);
 const maximum=Math.max((wx*Math.abs(co)+wy*Math.abs(si))/Math.abs(sx),(wx*Math.abs(si)+wy*Math.abs(co))/Math.abs(sy))+job.steps*job.step;
 if(!Number.isFinite(maximum)||maximum*FLOAT_EPSILON>job.step/16)throw new Error('float32 坐标分辨率不足以保持沿场步长');
 const phase=maximum*.5+.5+Math.abs(job.time)*(job.style==='water'?.025:.008);
 if(phase*FLOAT_EPSILON*GRID>1/32)throw new Error('float32 分辨率不足以保持 128 格纹理相位');
 array(job.values,GRID*GRID,'标量网格',0,1);array(job.flowX,GRID*GRID,'流场 X',-1,1);array(job.flowY,GRID*GRID,'流场 Y',-1,1);array(job.palette,PALETTE*3,'色板',0,1);
 if(!Array.isArray(job.background)||job.background.length!==3)throw new Error('背景需要三个 RGB 数值');job.background.forEach(v=>range(v,'背景',0,1));
}

/** Worker-local WebGL2 fragment renderer. No CPU pixels are labelled GPU; every
 * failure returns no pixels so the caller can run its shared CPU implementation. */
export class PerlinGpu {
 private gl?:WebGL2RenderingContext;private program?:WebGLProgram;
 private uniforms=new Map<string,WebGLUniformLocation|null>();
 private context(){
  if(this.gl?.isContextLost()){this.gl=undefined;this.program=undefined;this.uniforms.clear();throw new Error('WebGL2 上下文丢失，本帧回退；下次请求重新创建');}
  if(!this.gl){if(typeof OffscreenCanvas==='undefined')throw new Error('OffscreenCanvas 不可用');this.gl=new OffscreenCanvas(1,1).getContext('webgl2',{alpha:true,antialias:false,depth:false,stencil:false,premultipliedAlpha:false,preserveDrawingBuffer:false})??undefined;if(!this.gl)throw new Error('WebGL2 不可用');}
  if(!this.program){const gl=this.gl,program=gl.createProgram();if(!program)throw new Error('GPU program 分配失败');const shaders:WebGLShader[]=[];
   try{for(const [type,source]of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]] as const){const shader=gl.createShader(type);if(!shader)throw new Error('GPU shader 分配失败');shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(`GPU shader 编译失败：${gl.getShaderInfoLog(shader)?.slice(0,400)}`);gl.attachShader(program,shader);}gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(`GPU program 链接失败：${gl.getProgramInfoLog(program)?.slice(0,400)}`);this.program=program;}
   catch(error){gl.deleteProgram(program);throw error;}finally{for(const shader of shaders)gl.deleteShader(shader);}
  }return this.gl;
 }
 render(job:PerlinTextureJob,isCancelled?:()=>boolean):PerlinGpuResult {
  let gl:WebGL2RenderingContext|undefined,framebuffer:WebGLFramebuffer|null=null,vao:WebGLVertexArrayObject|null=null;const textures:WebGLTexture[]=[];
  try{
   const cancelled=()=>{if(isCancelled?.())throw new DOMException('Perlin 纹理已取消','AbortError');};
   validatePerlinTextureJob(job);cancelled();gl=this.context();const g=gl,max=g.getParameter(g.MAX_TEXTURE_SIZE),viewport=g.getParameter(g.MAX_VIEWPORT_DIMS) as Int32Array;
   const edge=Math.min(TILE_EDGE,max,viewport[0],viewport[1]);
   if(max<PALETTE||!Number.isInteger(edge)||edge<1)throw new Error('查找表超过当前 GPU 纹理/视口容量');
   const precision=g.getShaderPrecisionFormat(g.FRAGMENT_SHADER,g.HIGH_FLOAT);if(!precision||precision.precision<23)throw new Error('GPU 片元着色器不提供所需 float32 精度');
   g.useProgram(this.program!);const loc=(name:string)=>{if(!this.uniforms.has(name))this.uniforms.set(name,g.getUniformLocation(this.program!,name));return this.uniforms.get(name)!;};
   const scalar=(name:string,value:number)=>g.uniform1f(loc(name),value),integer=(name:string,value:number)=>g.uniform1i(loc(name),value);
   g.uniform2f(loc('size'),job.width,job.height);g.uniform2f(loc('scale'),job.transform.sx,job.transform.sy);g.uniform2f(loc('rotation'),job.transform.co,job.transform.si);g.uniform2f(loc('offset'),job.transform.ox,job.transform.oy);g.uniform3f(loc('backgroundColor'),...job.background);
   scalar('stepSize',job.step);scalar('timeValue',job.time);scalar('brightness',job.brightness);scalar('vignette',job.vignette);scalar('fiber',job.fiber);integer('steps',job.steps);integer('water',job.style==='water'?1:0);integer('transparentBackground',job.transparent?1:0);
   g.pixelStorei(g.UNPACK_ALIGNMENT,1);g.pixelStorei(g.PACK_ALIGNMENT,1);
   const texture=(unit:number,width:number,height:number,internal:number,format:number,type:number,data:Float32Array|null)=>{const handle=g.createTexture();if(!handle)throw new Error('GPU texture 分配失败');textures.push(handle);g.activeTexture(g.TEXTURE0+unit);g.bindTexture(g.TEXTURE_2D,handle);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);g.texImage2D(g.TEXTURE_2D,0,internal,width,height,0,format,type,data);return handle;};
   texture(0,GRID,GRID,g.R32F,g.RED,g.FLOAT,job.values);integer('scalarGrid',0);
   texture(1,GRID,GRID,g.R32F,g.RED,g.FLOAT,job.flowX);integer('flowXGrid',1);
   texture(2,GRID,GRID,g.R32F,g.RED,g.FLOAT,job.flowY);integer('flowYGrid',2);
   texture(3,PALETTE,1,g.RGB32F,g.RGB,g.FLOAT,job.palette);integer('paletteGrid',3);
   const tileWidth=Math.min(edge,job.width),tileHeight=Math.min(edge,job.height);
   const target=texture(4,tileWidth,tileHeight,g.RGBA8,g.RGBA,g.UNSIGNED_BYTE,null),risk=texture(5,tileWidth,tileHeight,g.RGBA8,g.RGBA,g.UNSIGNED_BYTE,null);
   framebuffer=g.createFramebuffer();vao=g.createVertexArray();if(!framebuffer||!vao)throw new Error('GPU framebuffer/VAO 分配失败');g.bindFramebuffer(g.FRAMEBUFFER,framebuffer);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,target,0);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT1,g.TEXTURE_2D,risk,0);g.drawBuffers([g.COLOR_ATTACHMENT0,g.COLOR_ATTACHMENT1]);if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw new Error('GPU framebuffer 不完整');
   g.disable(g.BLEND);g.disable(g.DEPTH_TEST);g.disable(g.SCISSOR_TEST);g.disable(g.DITHER);g.bindVertexArray(vao);
   // Only the final RGBA image scales with export dimensions. Targets and
   // readback scratch remain <=512², and each draw contains <=512²×128 steps.
   const pixels=new Uint8ClampedArray(job.width*job.height*4),tile=new Uint8ClampedArray(tileWidth*tileHeight*4);
   for(let top=0;top<job.height;top+=tileHeight)for(let left=0;left<job.width;left+=tileWidth){
    cancelled();const width=Math.min(tileWidth,job.width-left),height=Math.min(tileHeight,job.height-top);
    g.uniform2f(loc('tileOrigin'),left,top);g.uniform2f(loc('tileSize'),width,height);g.viewport(0,0,width,height);g.drawArrays(g.TRIANGLES,0,3);
    g.readBuffer(g.COLOR_ATTACHMENT1);g.readPixels(0,0,width,height,g.RGBA,g.UNSIGNED_BYTE,tile);
    for(let i=0;i<width*height*4;i+=4){if(tile[i])throw new Error('流场插值接近正负抵消，float32 不能可靠保持归一化方向');if(tile[i+1])throw new Error('高反差色板位于 float32 不确定的索引边界');}
    g.readBuffer(g.COLOR_ATTACHMENT0);g.readPixels(0,0,width,height,g.RGBA,g.UNSIGNED_BYTE,tile);
    const error=g.getError();if(error!==g.NO_ERROR||g.isContextLost())throw new Error(`GPU 纹理绘制失败 (${error})`);
    const rowBytes=width*4;for(let row=0;row<height;row++)pixels.set(tile.subarray((height-1-row)*rowBytes,(height-row)*rowBytes),((top+row)*job.width+left)*4);
   }
   cancelled();
   return {pixels};
  }catch(error){if(error instanceof DOMException&&error.name==='AbortError')throw error;return{warning:`GPU Perlin 回退 CPU：${error instanceof Error?error.message:String(error)}`};}
  finally{if(gl){gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);for(let unit=0;unit<6;unit++){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,null);}textures.forEach(t=>gl!.deleteTexture(t));gl.deleteFramebuffer(framebuffer);gl.deleteVertexArray(vao);}}
 }
 dispose(){if(this.gl){this.gl.deleteProgram(this.program??null);this.gl.getExtension('WEBGL_lose_context')?.loseContext();}this.gl=undefined;this.program=undefined;this.uniforms.clear();}
}
export const perlinGpu=new PerlinGpu();
