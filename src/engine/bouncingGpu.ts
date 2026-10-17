import {insetBouncingBoundary,insideBoundary,bouncingPolygonFacts,type Boundary} from '../scenes/bouncing';
export interface BouncingGpuJob {initial:Float64Array|Float32Array;boundary:Boundary;time:number;}
export interface BouncingGpuResult {states?:Float32Array;unsafe?:Uint32Array;warning?:string;}
interface PreparedJob {input:Float32Array;scale:number;kind:number;axes:[number,number];planes:Float32Array;planeCount:number;}
const MAX_PARTICLES=1_000_000;
export const bouncingCollisionVertex=`#version 300 es
precision highp float;precision highp int;
layout(location=0) in vec4 initialState;
uniform int kind,planeCount;uniform vec2 axes;uniform vec3 planes[64];uniform float elapsed;
out vec4 nextState;out float status;
void main(){
 vec2 p=initialState.xy,v=initialState.zw;float remaining=elapsed;status=0.;
 if(kind<2){float start=dot(p/axes,p/axes);if(start>1.-0.000002)status=1.;}
 else {for(int i=0;i<64;i++){if(i>=planeCount)break;if(dot(planes[i].xy,p)>planes[i].z-0.000002)status=1.;}}
 for(int bounce=0;bounce<64;bounce++){
  if(remaining<=0.||dot(v,v)==0.){remaining=0.;break;}
  float hit=1.e30;vec2 normal=vec2(0.);
  if(kind<2){
   vec2 q=p/axes,w=v/axes;float a=dot(w,w),b=dot(q,w),c=dot(q,q)-1.,disc=b*b-a*c;
   if(disc<=0.00000001*a){status=1.;break;}
   float root=sqrt(disc);hit=b>=0.?-c/(b+root):(-b+root)/a;
   if(hit<0.){status=1.;break;}normal=normalize((p+v*hit)/(axes*axes));
  }else{
   for(int i=0;i<64;i++){
    if(i>=planeCount)break;float toward=dot(planes[i].xy,v);if(toward<=0.)continue;
    float t=(planes[i].z-dot(planes[i].xy,p))/toward;
    if(t<-.000002){status=1.;break;}t=max(0.,t);
    if(abs(t-hit)<.000002){status=1.;}
    if(t<hit){hit=t;normal=planes[i].xy;}
   }
  }
  if(hit>remaining){p+=v*remaining;remaining=0.;break;}
  p+=v*hit;remaining-=hit;v-=2.*dot(v,normal)*normal;
 }
 if(remaining>0.)status=1.;
 if(kind<2){if(dot(p/axes,p/axes)>1.00002)status=1.;}
 else{for(int i=0;i<64;i++){if(i>=planeCount)break;if(dot(planes[i].xy,p)>planes[i].z+.00002)status=1.;}}
 if(any(isnan(p))||any(isinf(p))||any(isnan(v))||any(isinf(v)))status=1.;
 if(abs(length(v)-length(initialState.zw))>max(1.e-12,length(initialState.zw)*.00002))status=1.;
 nextState=vec4(p,v);gl_Position=vec4(0.,0.,0.,1.);gl_PointSize=1.;
}`;
const fragment=`#version 300 es
precision highp float;out vec4 color;void main(){color=vec4(0.);}`;
export function prepareBouncingGpuBoundary(source:Boundary){
 const boundary=insetBouncingBoundary(source,0),scale=boundary.kind==='circle'?boundary.radius:boundary.kind==='ellipse'?Math.max(boundary.a,boundary.b):Math.max(...boundary.vertices.map(p=>Math.hypot(...p)));
 if(!Number.isFinite(scale)||scale<=0)throw new Error('GPU 边界尺度无效');
 const axes:[number,number]=boundary.kind==='circle'?[1,1]:boundary.kind==='ellipse'?[boundary.a/scale,boundary.b/scale]:[1,1];
 if(Math.min(...axes)<.001)throw new Error('椭圆轴比超出 GPU float32 精度预算');
 const planes=new Float32Array(64*3);let planeCount=0;
 if(boundary.kind==='polygon'){
  const {vertices,orientation,convex}=bouncingPolygonFacts(boundary.vertices);planeCount=vertices.length;
  if(!convex)throw new Error('GPU 碰撞仅支持凸多边形；凹多边形使用 CPU 精确路径');
  for(let i=0;i<vertices.length;i++){
   const a=vertices[i],b=vertices[(i+1)%vertices.length],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
   if(length/scale<1e-5)throw new Error('多边形边长超出 GPU float32 分辨率');
   const nx=orientation*dy/length,ny=-orientation*dx/length;planes.set([nx,ny,(nx*a[0]+ny*a[1])/scale],i*3);
  }
 }
 return{boundary,scale,kind:boundary.kind==='circle'?0:boundary.kind==='ellipse'?1:2,axes,planes,planeCount};
}
/** Normalize physical units once before float32 upload; reject unsupported precision/capacity before allocation. */
function prepare(job:BouncingGpuJob):PreparedJob {
 if(!job||!(job.initial instanceof Float32Array||job.initial instanceof Float64Array)||job.initial.length%4||job.initial.length<4||job.initial.length/4>MAX_PARTICLES)throw new Error('GPU 弹跳需要 1 至 1000000 个 xy/vxy 状态');
 if(!Number.isFinite(job.time)||job.time<0||!Number.isFinite(Math.fround(job.time)))throw new Error('GPU 弹跳时间必须为非负 float32');
 const {boundary,scale,kind,axes,planes,planeCount}=prepareBouncingGpuBoundary(job.boundary);
 // Known typed allocations total at most 124 MB at the one-million limit, including caller input,
 // both GPU buffers and readback. Driver overhead is unmeasured. No particle state is retained.
 for(let i=0;i<job.initial.length;i+=4){
  const x=job.initial[i],y=job.initial[i+1],vx=job.initial[i+2],vy=job.initial[i+3];
  if(![x,y,vx,vy].every(v=>Number.isFinite(v)&&Math.abs(v)<1e12)||!insideBoundary([x,y],boundary))throw new Error(`GPU 初始粒子 ${i/4} 不在有限边界内`);
  const travel=Math.hypot(vx,vy)/scale*job.time;if(!Number.isFinite(travel)||travel>128)throw new Error('单帧弹道距离超出 GPU 64 次碰撞预算，使用 CPU 路径');
  for(const v of [x,y,vx,vy]){const n=v/scale;if(!Number.isFinite(Math.fround(n))||(n!==0&&Math.abs(n)<1e-30))throw new Error('归一化粒子状态超出 GPU float32 精度');}
 }
 const input=new Float32Array(job.initial.length);for(let i=0;i<input.length;i++)input[i]=job.initial[i]/scale;
 return{input,scale,kind,axes,planes,planeCount};
}
export function validateBouncingGpuJob(job:BouncingGpuJob):void {prepare(job);}
/** Worker-local transform-feedback kernel. Every call starts at the supplied initial state, so cold/warm,
 * arbitrary seeks and exports use identical identities. It never retains transferred output arrays. */
export class BouncingGpu {
 private gl?:WebGL2RenderingContext;private program?:WebGLProgram;
 private context(){
  if(this.gl?.isContextLost()){this.gl=undefined;this.program=undefined;throw new Error('WebGL2 上下文丢失，本次 CPU；下一请求重新创建');}
  if(!this.gl){if(typeof OffscreenCanvas==='undefined')throw new Error('OffscreenCanvas 不可用');this.gl=new OffscreenCanvas(1,1).getContext('webgl2',{antialias:false,depth:false,stencil:false})??undefined;if(!this.gl)throw new Error('WebGL2 不可用');}
  if(!this.program){const gl=this.gl,program=gl.createProgram(),shaders:WebGLShader[]=[];if(!program)throw new Error('GPU program 分配失败');
   try{for(const [type,source]of [[gl.VERTEX_SHADER,bouncingCollisionVertex],[gl.FRAGMENT_SHADER,fragment]] as const){const shader=gl.createShader(type);if(!shader)throw new Error('GPU shader 分配失败');shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(`GPU shader 编译失败：${gl.getShaderInfoLog(shader)?.slice(0,300)}`);gl.attachShader(program,shader);}gl.transformFeedbackVaryings(program,['nextState','status'],gl.INTERLEAVED_ATTRIBS);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(`GPU program 链接失败：${gl.getProgramInfoLog(program)?.slice(0,300)}`);this.program=program;}
   catch(error){gl.deleteProgram(program);throw error;}finally{for(const shader of shaders)gl.deleteShader(shader);}
  }return this.gl;
 }
 advance(job:BouncingGpuJob):BouncingGpuResult {
  let gl:WebGL2RenderingContext|undefined,vao:WebGLVertexArrayObject|null=null,feedback:WebGLTransformFeedback|null=null,active=false;const buffers:WebGLBuffer[]=[];
  try{
   const prepared=prepare(job);gl=this.context();const g=gl;if(g.getParameter(g.MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS)<5)throw new Error('GPU transform feedback 容量不足');
   g.useProgram(this.program!);const loc=(name:string)=>g.getUniformLocation(this.program!,name);
   g.uniform1i(loc('kind'),prepared.kind);g.uniform1i(loc('planeCount'),prepared.planeCount);g.uniform2f(loc('axes'),...prepared.axes);g.uniform3fv(loc('planes[0]'),prepared.planes);g.uniform1f(loc('elapsed'),job.time);
   vao=g.createVertexArray();feedback=g.createTransformFeedback();if(!vao||!feedback)throw new Error('GPU VAO/反馈对象分配失败');g.bindVertexArray(vao);
   const input=g.createBuffer(),output=g.createBuffer();if(input)buffers.push(input);if(output)buffers.push(output);if(!input||!output)throw new Error('GPU 状态缓冲分配失败');
   const count=prepared.input.length/4;g.bindBuffer(g.ARRAY_BUFFER,input);g.bufferData(g.ARRAY_BUFFER,prepared.input,g.STATIC_DRAW);g.enableVertexAttribArray(0);g.vertexAttribPointer(0,4,g.FLOAT,false,0,0);
   g.bindBuffer(g.TRANSFORM_FEEDBACK_BUFFER,output);g.bufferData(g.TRANSFORM_FEEDBACK_BUFFER,count*5*4,g.STREAM_READ);g.bindTransformFeedback(g.TRANSFORM_FEEDBACK,feedback);g.bindBufferBase(g.TRANSFORM_FEEDBACK_BUFFER,0,output);
   g.enable(g.RASTERIZER_DISCARD);g.beginTransformFeedback(g.POINTS);active=true;g.drawArrays(g.POINTS,0,count);g.endTransformFeedback();active=false;g.disable(g.RASTERIZER_DISCARD);
   const interleaved=new Float32Array(count*5);g.getBufferSubData(g.TRANSFORM_FEEDBACK_BUFFER,0,interleaved);const error=g.getError();if(error!==g.NO_ERROR||g.isContextLost())throw new Error(`GPU 弹跳计算/读回失败 (${error})`);
   const states=new Float32Array(count*4),unsafe=new Uint32Array(count);let unsafeCount=0;
   for(let i=0;i<count;i++){
    let bad=interleaved[i*5+4]!==0;for(let j=0;j<4;j++){const value=interleaved[i*5+j]*prepared.scale;states[i*4+j]=value;if(!Number.isFinite(states[i*4+j]))bad=true;}
    const before=Math.hypot(job.initial[i*4+2],job.initial[i*4+3]),after=Math.hypot(states[i*4+2],states[i*4+3]);if(Math.abs(before-after)>Math.max(1e-12,before*2e-5))bad=true;
    if(bad)unsafe[unsafeCount++]=i;
   }
   return{states,unsafe:unsafe.subarray(0,unsafeCount)};
  }catch(error){return{warning:`GPU 弹跳回退 CPU：${error instanceof Error?error.message:String(error)}`};}
  finally{if(gl){if(active)gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindBuffer(gl.ARRAY_BUFFER,null);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,null);gl.bindVertexArray(null);buffers.forEach(b=>gl!.deleteBuffer(b));gl.deleteTransformFeedback(feedback);gl.deleteVertexArray(vao);}}
 }
 dispose(){if(this.gl){this.gl.deleteProgram(this.program??null);this.gl.getExtension('WEBGL_lose_context')?.loseContext();}this.gl=undefined;this.program=undefined;}
}
