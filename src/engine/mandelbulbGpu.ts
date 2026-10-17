import {BULB_PALETTE_SIZE,validateBulbJob,type BulbJob} from './mandelbulb';
const vertex=`#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}`;
// Independently implemented latitude-power DE. Numerical policy and parsed
// uniforms are owned by mandelbulb.ts; no native shader source is embedded.
const fragment=`#version 300 es
precision highp float;precision highp int;precision highp sampler2D;
uniform vec2 size,tile;uniform sampler2D palette;
uniform mat3 rotation;uniform vec3 camera,forward,right,up,background;
uniform float power,bailout,phase,rayScale,epsilon,shadowStrength,ambient,diffuseStrength,specular,shininess,fog,exposure;
uniform int iterations,steps,shadowSteps,transparentBackground;
out vec4 color;
float magnitude(vec3 v){float m=max(abs(v.x),max(abs(v.y),abs(v.z)));return m==0.?0.:m*length(v/m);}
vec2 estimate(vec3 world){
 vec3 q=rotation*world,c=q.xzy,z=c;float ld=0.,r=0.,trap=1e30;
 for(int n=0;n<128;n++){
  if(n>=iterations)break;r=magnitude(z);trap=min(trap,r);if(r>bailout)break;
  float safe=max(r,1e-6),lr=log(safe),lp=lr*power;
  if(lp>32.&&lp>log(bailout)*1.01)break;
  float a=(power-1.)*lr+log(power)+ld;ld=max(a,0.)+log(1.+exp(-abs(a)));
  float azimuth=(z.x==0.&&z.y==0.?0.:atan(z.y,z.x))*power;
  float latitude=asin(clamp(z.z/safe,-1.,1.))*power+phase,rp=exp(lp);
  z=rp*vec3(cos(azimuth)*cos(latitude),sin(azimuth)*cos(latitude),sin(latitude))+c;
 }
 return vec2(abs(.5*log(max(r,1e-6))*r*exp(-ld)),clamp(trap/bailout,0.,1.));
}
vec3 normalAt(vec3 p){vec3 d=vec3(epsilon,0.,0.);vec3 n=vec3(estimate(p+d.xyy).x-estimate(p-d.xyy).x,estimate(p+d.yxy).x-estimate(p-d.yxy).x,estimate(p+d.yyx).x-estimate(p-d.yyx).x);float r=length(n);return r>1e-20?n/r:vec3(0.,1.,0.);}
float shadowAt(vec3 p,vec3 normal,vec3 sun){if(shadowSteps==0||shadowStrength==0.)return 1.;vec3 origin=p+normal*epsilon*3.;float t=.02,result=1.;for(int i=0;i<96;i++){if(i>=shadowSteps||t>=12.)break;float d=estimate(origin+sun*t).x;if(d<epsilon*.8)return .04;result=min(result,shadowStrength*d/t);t+=clamp(d,.01,.5);}return clamp(result,.04,1.);}
void main(){
 vec2 pixel=vec2(gl_FragCoord.x,tile.x+tile.y-gl_FragCoord.y);
 vec2 uv=vec2(2.*pixel.x-size.x,size.y-2.*pixel.y)/size.y;
 vec3 ray=normalize(forward*rayScale+right*uv.x+up*uv.y);
 float b=dot(camera,ray),d=b*b-dot(camera,camera)+4.;bool hit=false;float t=0.,trap=0.;vec3 point=vec3(0.);
 if(d>=0.){float root=sqrt(d),end=-b+root+.01;t=max(0.,-b-root-.01);for(int i=0;i<256;i++){if(i>=steps||t>end)break;point=camera+ray*t;vec2 value=estimate(point);if(value.x<max(epsilon,.5/size.x)){hit=true;trap=value.y;break;}t+=clamp(value.x*.85,.0005,.75);}}
 if(!hit){color=vec4(background,transparentBackground==1?0.:1.);return;}
 vec3 n=normalAt(point),sun=normalize(vec3(.2,.75,.55));float occlusion=shadowAt(point,n,sun),diffuse=max(dot(n,sun),0.),sky=.45+.55*max(n.y,0.),back=max(dot(n,normalize(vec3(-sun.x,-.35,-sun.z))),0.),highlight=pow(max(dot(reflect(ray,n),sun),0.),shininess);
 float index=trap*1023.,f=fract(index);int lo=int(floor(index)),hi=min(lo+1,1023);vec3 base=mix(texelFetch(palette,ivec2(lo,0),0).rgb,texelFetch(palette,ivec2(hi,0),0).rgb,f);
 vec3 light=vec3(1.45,1.18,.92)*(diffuse*occlusion*diffuseStrength+back*.32)+vec3(.58,.82,1.)*sky*ambient;
 float haze=1.-exp(-fog*t*t);vec3 rgb=pow(clamp(mix(base*light+highlight*occlusion*specular,background,haze)*exposure,0.,1.),vec3(1./2.2));
 color=floor(vec4(rgb,1.)*255.+.5)/255.;
}`;
export interface BulbGpuResult {pixels?:Uint8ClampedArray;warning?:string;samples?:number;cancelled?:boolean;}
/** One context per worker; only program is retained. Targets/readbacks are
 * strips <=64 rows, so 4K does not imply a full-size GPU framebuffer. */
export class MandelbulbGpu {
 private gl?:WebGL2RenderingContext;private program?:WebGLProgram;private uniforms=new Map<string,WebGLUniformLocation|null>();
 private context(){
  if(this.gl?.isContextLost()){this.gl=undefined;this.program=undefined;this.uniforms.clear();throw new Error('WebGL2 上下文丢失；下次请求重新创建');}
  if(!this.gl){if(typeof OffscreenCanvas==='undefined')throw new Error('OffscreenCanvas 不可用');this.gl=new OffscreenCanvas(1,1).getContext('webgl2',{alpha:true,antialias:false,depth:false,stencil:false,premultipliedAlpha:false,preserveDrawingBuffer:false})??undefined;if(!this.gl)throw new Error('WebGL2 不可用');}
  if(!this.program){const gl=this.gl,program=gl.createProgram();if(!program)throw new Error('GPU program 分配失败');const shaders:WebGLShader[]=[];try{for(const [type,source]of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]] as const){const shader=gl.createShader(type);if(!shader)throw new Error('GPU shader 分配失败');shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error('GPU shader 编译失败：'+gl.getShaderInfoLog(shader));gl.attachShader(program,shader);}gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('GPU program 链接失败：'+gl.getProgramInfoLog(program));this.program=program;}catch(error){gl.deleteProgram(program);throw error;}finally{shaders.forEach(s=>gl.deleteShader(s));}}
  return this.gl;
 }
 render(job:BulbJob,cancel?:()=>boolean):BulbGpuResult{
  let gl:WebGL2RenderingContext|undefined,framebuffer:WebGLFramebuffer|null=null,vao:WebGLVertexArrayObject|null=null;const textures:WebGLTexture[]=[];
  try{
   validateBulbJob(job);const c=job.config;
   // Far cameras suffer catastrophic cancellation in ray/sphere intersection.
   if(Math.hypot(...c.camera)>128)throw new Error('远距离相机超出 float32 射线精度，使用 CPU 双精度');
   gl=this.context();const g=gl,max=g.getParameter(g.MAX_TEXTURE_SIZE),viewport=g.getParameter(g.MAX_VIEWPORT_DIMS) as Int32Array,rows=Math.min(64,job.height);
   if(job.width>max||job.width>viewport[0]||rows>viewport[1]||max<BULB_PALETTE_SIZE)throw new Error('超过当前 GPU 纹理/视口容量');
   if((g.getShaderPrecisionFormat(g.FRAGMENT_SHADER,g.HIGH_FLOAT)?.precision??0)<23)throw new Error('GPU 不支持所需 float32 精度');
   g.useProgram(this.program!);const loc=(name:string)=>{if(!this.uniforms.has(name))this.uniforms.set(name,g.getUniformLocation(this.program!,name));return this.uniforms.get(name)!;};
   for(const name of ['power','bailout','phase','rayScale','epsilon','shadowStrength','ambient','specular','shininess','fog','exposure'] as const)g.uniform1f(loc(name),c[name]);g.uniform1f(loc('diffuseStrength'),c.diffuse);
   for(const name of ['iterations','steps','shadowSteps'] as const)g.uniform1i(loc(name),c[name]);g.uniform1i(loc('transparentBackground'),c.transparent?1:0);
   for(const name of ['camera','forward','right','up','background'] as const)g.uniform3fv(loc(name),c[name]);g.uniformMatrix3fv(loc('rotation'),false,c.rotation);g.uniform2f(loc('size'),job.width,job.height);
   const texture=(unit:number,w:number,h:number,internal:number,format:number,type:number,data:Float32Array|null)=>{const t=g.createTexture();if(!t)throw new Error('GPU texture 分配失败');textures.push(t);g.activeTexture(g.TEXTURE0+unit);g.bindTexture(g.TEXTURE_2D,t);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);g.texImage2D(g.TEXTURE_2D,0,internal,w,h,0,format,type,data);return t;};
   g.pixelStorei(g.PACK_ALIGNMENT,1);g.pixelStorei(g.UNPACK_ALIGNMENT,1);texture(0,1024,1,g.RGB32F,g.RGB,g.FLOAT,job.palette);g.uniform1i(loc('palette'),0);const target=texture(1,job.width,rows,g.RGBA8,g.RGBA,g.UNSIGNED_BYTE,null);
   framebuffer=g.createFramebuffer();vao=g.createVertexArray();if(!framebuffer||!vao)throw new Error('GPU framebuffer/VAO 分配失败');g.bindFramebuffer(g.FRAMEBUFFER,framebuffer);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,target,0);if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw new Error('GPU framebuffer 不完整');
   g.bindVertexArray(vao);g.disable(g.BLEND);g.disable(g.DEPTH_TEST);g.disable(g.SCISSOR_TEST);g.disable(g.DITHER);
   const pixels=new Uint8ClampedArray(job.width*job.height*4),strip=new Uint8Array(job.width*rows*4);let samples=0;
   for(let start=0;start<job.height;start+=rows){if(cancel?.())return{pixels,samples,cancelled:true};const count=Math.min(rows,job.height-start);g.uniform2f(loc('tile'),start,count);g.viewport(0,0,job.width,count);g.drawArrays(g.TRIANGLES,0,3);g.readPixels(0,0,job.width,count,g.RGBA,g.UNSIGNED_BYTE,strip);const error=g.getError();if(error!==g.NO_ERROR||g.isContextLost())throw new Error(`GPU 光线步进失败 (${error})`);for(let y=0;y<count;y++)pixels.set(strip.subarray((count-1-y)*job.width*4,(count-y)*job.width*4),(start+y)*job.width*4);samples+=job.width*count;}
   return{pixels,samples,cancelled:false};
  }catch(error){return{warning:'Mandelbulb GPU 回退 CPU：'+(error instanceof Error?error.message:String(error))};}
  finally{if(gl){gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);for(let unit=0;unit<2;unit++){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,null);}textures.forEach(t=>gl!.deleteTexture(t));gl.deleteFramebuffer(framebuffer);gl.deleteVertexArray(vao);}}
 }
 dispose(){if(this.gl){this.gl.deleteProgram(this.program??null);this.gl.getExtension('WEBGL_lose_context')?.loseContext();}this.gl=undefined;this.program=undefined;this.uniforms.clear();}
}
export const mandelbulbGpu=new MandelbulbGpu();
