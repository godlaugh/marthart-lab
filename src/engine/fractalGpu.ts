import type {PreparedFractalSourceColor} from './fractalSourceColor';
import {FractalSourceNewtonGpu} from './fractalNativeNewtonGpu';
import {FractalSourceGpuError} from './fractalSourceGpuFailure';
import type {FractalSourcePlan} from './fractalSourcePrecision';
import {fractalViewportRules} from './complexViewport';
import {fractalTrapGLSL,uploadFractalTrace} from './fractalColorGpu';
import type {FractalColors} from './fractalColor';
import type { FractalConfig, FractalOrbit } from '../scenes/complex';
import {usesStepConvergence,usesResidualConvergence,CONVERGENCE_CPU_NOTICE} from './fractalConvergence';
import {FractalResidualGpu} from './fractalResidualGpu';
import type { FractalViewport, ReferenceOrbit } from './fractalPrecision';
import {FRACTAL_DISTANCE_GLSL,FRACTAL_DISTANCE_GPU_STRIDE,type FractalDistanceFacts} from './fractalDistance';
/** distance uses FRACTAL_DISTANCE_GPU_STRIDE floats per pixel:
 * derivative.xy, estimate, valid, highZ.xy, zero-based iteration, exitKind,
 * residualSquared, path (0 ordinary / 1 perturbation), two reserved zeros.
 * Derivative nonfinites are meaningful: only the GPU estimate owns validity. */
export interface GpuOrbitBatch { values?:Float32Array; traps?:Float32Array; residual?:Float32Array; distance?:Float32Array; /** Four native execution facts per sample: started perturbation, glitch count, ordinary steps, perturbation steps. */ source?:Float32Array; /** Final same-fragment native color, RGBA8 in requested sample order; never CPU-shaded. */ sourceRGBA?:Uint8Array; warning?:string; }
const formulas=['mandelbrot','julia','newton','nova','phoenix','magnet1','magnet2','lambda','c_sin','spiral_septagon','binocular'];
// One template owns both variants. Omission emits the original GLSL byte for byte.
function vertex(distance:boolean):string{return `#version 300 es
precision highp float;precision highp int;
layout(location=0)in vec2 pixel;
uniform vec2 size,center,start,julia,power,feedback,quad,constantTerm,initialCoefficient,trapCenter;
uniform float zoom,rotation,bailout,tolerance,relaxation,denomOffset,singularityGuard,trapRadius,trapRotation,trapAspect,glitchThreshold;
uniform int formula,juliaMode,iterations,historyPower,trapShape,perturb,referenceLength;
uniform sampler2D referenceTexture;
out vec4 orbitA;out vec4 orbitB;out vec4 trapA;out vec4 trapB;
${fractalTrapGLSL}
float magnitude(vec2 z){float m=max(abs(z.x),abs(z.y));return m==0.?0.:m*sqrt(dot(z/m,z/m));}
vec2 mulc(vec2 a,vec2 b){return vec2(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);}
vec2 divc(vec2 a,vec2 b){if(b.x==0.&&b.y==0.)return vec2(uintBitsToFloat(0x7fc00000u));if(abs(b.x)>=abs(b.y)){float r=b.y/b.x,d=b.x+b.y*r;return vec2((a.x+a.y*r)/d,(a.y-a.x*r)/d);}float r=b.x/b.y,d=b.y+b.x*r;return vec2((a.x*r+a.y)/d,(a.y*r-a.x)/d);}
vec2 ipow(vec2 z,int p){vec2 a=vec2(1.,0.),b=z;for(int i=0;i<6;i++){if((p&1)==1)a=mulc(a,b);p=p>>1;if(p==0)break;b=mulc(b,b);}return a;}
vec2 cpow(vec2 z,vec2 p){if(p.y==0.&&p.x==floor(p.x)&&abs(p.x)<=32.){vec2 v=ipow(z,int(abs(p.x)));return p.x<0.?divc(vec2(1.,0.),v):v;}float r=length(z);if(r==0.)return p.y==0.&&p.x>0.?vec2(0.):vec2(uintBitsToFloat(0x7fc00000u));vec2 l=mulc(p,vec2(log(r),atan(z.y,z.x)));return exp(l.x)*vec2(cos(l.y),sin(l.y));}
vec2 csin(vec2 z){return vec2(sin(z.x)*cosh(z.y),cos(z.x)*sinh(z.y));}
float trap(vec2 z){vec2 q=z-trapCenter;float co=cos(trapRotation),si=sin(trapRotation);q=vec2((q.x*co-q.y*si)/trapAspect,q.x*si+q.y*co);return trapShape==1?abs(length(q)-trapRadius):trapShape==2?min(abs(q.x),abs(q.y)):length(q);}
bool bad(vec2 z){return any(isnan(z))||any(isinf(z));}
${distance?`${FRACTAL_DISTANCE_GLSL}
uniform int sourceDistanceCapable,sourceDistancePower;
out vec4 sourceDistanceA;out vec4 sourceDistanceB;out vec4 sourceDistanceC;
void main(){`:`void main(){`}
 vec2 uv=vec2(((pixel.x+.5)/size.x-.5)*4.*size.x/size.y,(.5-(pixel.y+.5)/size.y)*4.)/zoom;
 float co=cos(rotation),si=sin(rotation);vec2 deltaPoint=vec2(uv.x*co-uv.y*si,uv.x*si+uv.y*co),point=center+deltaPoint;
 bool isJulia=formula==1||juliaMode==1;
 vec2 constant=isJulia?julia:point,z=(formula==2||formula==10||isJulia)?point:start,previous=vec2(0.),derivative=isJulia?vec2(1.,0.):vec2(0.);
 vec2 delta=isJulia?deltaPoint:vec2(0.),dc=isJulia?vec2(0.):deltaPoint;
 ${distance?`vec2 sourceD=isJulia?vec2(1.,0.):vec2(0.);int sourceIteration=iterations-1;
 float nearest=3.402823466e38;`:`float nearest=3.402823466e38;`}int count=iterations,status=1;float repair=0.,errorEstimate=0.;
 for(int n=0;n<4096;n++){
  ${distance?`if(n>=iterations)break;sourceIteration=n;vec2 old=z;if(perturb==0)traceStep(z);
  if(perturb==0&&sourceDistanceCapable==1)sourceD=sourceDistanceStep(sourceD,z,sourceDistancePower,isJulia);`:`if(n>=iterations)break;vec2 old=z;traceStep(z);`}
  if(perturb==1){
   ${distance?`if(n>=referenceLength){repair=1.;break;}
   vec4 packed=texelFetch(referenceTexture,ivec2(n,0),0);vec2 ref=packed.xy+packed.zw;
   z=ref+delta;old=z;traceStep(z);nearest=min(nearest,trap(z));
   if(sourceDistanceCapable==1)sourceD=sourceDistanceStep(sourceD,z,sourceDistancePower,isJulia);
   if(length(z)>bailout){count=n+1;status=0;break;}
   // Source perturbation examines current z after updating D, never a future z.
   if(n+1>=iterations){count=n+1;break;}
   // A locally bounded reference can end before this pixel does. Its absence
   // is not evidence of an interior point; retain the explicit DD repair path.
   if(n+1>=referenceLength){repair=1.;break;}`:`if(n+1>=referenceLength){repair=1.;break;}
   vec4 packed=texelFetch(referenceTexture,ivec2(n,0),0);vec2 ref=packed.xy+packed.zw;`}
   vec2 correction=vec2(0.);int p=int(power.x);
   if(p==2)correction=mulc(delta,2.*ref+delta);
   else {float binomial=1.;vec2 dk=vec2(1.,0.);for(int k=1;k<=32;k++){if(k>p)break;binomial*=float(p-k+1)/float(k);dk=mulc(dk,delta);correction+=binomial*mulc(ipow(ref,p-k),dk);}}
   ${distance?``:`derivative=mulc(power.x*ipow(ref+delta,p-1),derivative)+(isJulia?vec2(0.):vec2(1.,0.));`}
   errorEstimate=power.x*pow(max(length(ref+delta),1e-30),power.x-1.)*errorEstimate+3e-7*(magnitude(correction)+magnitude(dc));
   delta=correction+dc;vec4 next=texelFetch(referenceTexture,ivec2(n+1,0),0);vec2 nextRef=next.xy+next.zw;z=nextRef+delta;
   if(bad(delta)||length(z)<1e-5*length(nextRef)||errorEstimate>glitchThreshold*max(magnitude(delta),1e-37)){repair=1.;break;}
  }else if(formula==0||formula==1||formula==4){
   ${distance?``:`derivative=mulc(mulc(power,cpow(z,power-vec2(1.,0.))),derivative)+(isJulia?vec2(0.):vec2(1.,0.));`}
   z=cpow(z,power)+constant;if(formula==4)z+=mulc(ipow(previous,historyPower),feedback);
  }else if(formula==2||formula==3){
   vec2 residual=cpow(z,power)-vec2(1.,0.);
   if(formula==2&&length(residual)<tolerance){nearest=min(nearest,trap(z));count=n;status=5;break;}
   z-=relaxation*divc(residual,mulc(power,cpow(z,power-vec2(1.,0.))));if(formula==3)z+=constant;
  }else if(formula==5){vec2 q=divc(mulc(z,z)+constant-vec2(1.,0.),2.*z+constant-vec2(2.,0.));z=mulc(q,q);}
  else if(formula==6){vec2 a=constant-vec2(1.,0.),b=constant-vec2(2.,0.),ab=mulc(a,b);vec2 q=divc(ipow(z,3)+3.*mulc(a,z)+ab,3.*mulc(z,z)+3.*mulc(b,z)+ab+vec2(1.,0.));z=mulc(q,q);}
  else if(formula==7)z=mulc(constant,mulc(z,vec2(1.,0.)-z));
  else if(formula==8)z=mulc(csin(z),constant);
  else if(formula==9)z=dot(z,z)<singularityGuard?vec2(0.):divc(cpow(z,vec2(power.x,0.))+constant,z);
  else if(formula==10){float m=max(2.,power.x);vec2 numerator=cpow(z,vec2(m,0.))+mulc(quad,mulc(z,z))+constantTerm,denominator=2.*cpow(z,vec2(m-1.,0.))+mulc(initialCoefficient,constant)+vec2(denomOffset,0.);z=dot(denominator,denominator)<1e-24?vec2(1e30,0.):z+relaxation*(divc(numerator,denominator)-z);}
  if(bad(z)){z=old;count=n+1;status=2;break;}
  nearest=min(nearest,trap(z));previous=old;
  bool converged=((formula==2||formula==3||formula==10)&&length(z-old)<tolerance)||((formula==5||formula==6)&&length(formula==6&&isJulia?z-old:z-vec2(1.,0.))<tolerance);
  if(converged){count=n+1;status=5;break;}
  float escapeLimit=formula==10?1e6:(formula==2||formula==3)?1e12:bailout;
  ${distance?`if(perturb==0&&length(z)>escapeLimit){count=n+1;status=0;break;}`:`if(length(z)>escapeLimit){count=n+1;status=0;break;}`}
 }
 // Magnet II may round into a false converged state in float32. Verify all
 // non-escaping candidates on CPU, including unclassified iteration-limit points.
 if((formula==6&&(status&1)==1)||status==2)repair=1.;
 ${distance?`int sourceExit=(status&1)!=0?0:((status&4)!=0?2:1);
 vec2 sourceEstimate=sourceDistanceEstimate(z,sourceD,sourceDistancePower,sourceDistanceCapable==1,sourceExit!=0);
 sourceDistanceA=vec4(sourceD,sourceEstimate);sourceDistanceB=vec4(z,float(sourceIteration),float(sourceExit));sourceDistanceC=vec4(0.,float(perturb),0.,0.);
 derivative=sourceD;
 orbitA=vec4(z,float(count),float(status));`:`orbitA=vec4(z,float(count),float(status));`}orbitB=vec4(derivative,nearest,repair);trapA=traceInside;trapB=traceOutside;gl_Position=vec4(0.);
}`;}
const fragment='#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(0.);}';
/** Worker-owned bounded WebGL2 transform feedback. The math is computed on the
 * GPU; coloring remains shared with CPU so every palette mode has one owner. */
export class FractalGpu {
 private residual?:FractalResidualGpu;
 private source?:FractalSourceNewtonGpu;
 prepareSourceReference(plan:FractalSourcePlan,options:{isCancelled?:()=>boolean;onBytes?:(bytes:number)=>void}={}){return(this.source??=new FractalSourceNewtonGpu()).prepareReference(plan,options);}
 sourceDiagnostics(){return this.source?.diagnostics();}
 private gl?:WebGL2RenderingContext;private program?:WebGLProgram;private programs=new Map<boolean,WebGLProgram>();private uniforms=new Map<string,WebGLUniformLocation|null>();
 private context(distance:boolean){
  if(this.gl?.isContextLost()){this.gl=undefined;this.program=undefined;this.programs.clear();this.uniforms.clear();}
  if(!this.gl){if(typeof OffscreenCanvas==='undefined')throw new Error('OffscreenCanvas 不可用');this.gl=new OffscreenCanvas(1,1).getContext('webgl2',{antialias:false,depth:false,alpha:false})??undefined;if(!this.gl)throw new Error('WebGL2 不可用');}
  const cached=this.programs.get(distance);if(this.program!==cached){this.program=cached;this.uniforms.clear();}
  if(!this.program){const gl=this.gl,p=gl.createProgram();if(!p)throw new Error('GPU program 分配失败');const shaders:WebGLShader[]=[];
   try{for(const [type,source]of [[gl.VERTEX_SHADER,vertex(distance)],[gl.FRAGMENT_SHADER,fragment]] as const){const shader=gl.createShader(type);if(!shader)throw new Error('GPU shader 分配失败');shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)??'GPU 编译失败');gl.attachShader(p,shader);}gl.transformFeedbackVaryings(p,['orbitA','orbitB','trapA','trapB',...(distance?['sourceDistanceA','sourceDistanceB','sourceDistanceC']:[])],gl.INTERLEAVED_ATTRIBS);gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p)??'GPU 链接失败');this.program=p;this.programs.set(distance,p);}
   catch(e){gl.deleteProgram(p);throw e;}finally{shaders.forEach(s=>gl.deleteShader(s));}
  }return this.gl;
 }
 sample(points:Float32Array,width:number,height:number,view:FractalViewport,c:FractalConfig,reference?:ReferenceOrbit,threshold=1e-4,traceColors?:FractalColors,source?:{plan:FractalSourcePlan;colorPlan?:PreparedFractalSourceColor;isCancelled?:()=>boolean}):GpuOrbitBatch {
  if(fractalViewportRules(c.numericProfile??'local-v1',c.formula).sourceArithmetic){
   if(!source)throw new FractalSourceGpuError('Explicit source arithmetic requires a prepared source plan','input');
   return(this.source??=new FractalSourceNewtonGpu()).sample(points,width,height,view,c,source.plan,traceColors,source.isCancelled,source.colorPlan);
  }
  if(source)throw new FractalSourceGpuError('A source plan cannot be applied to independent arithmetic','input');
  let gl:WebGL2RenderingContext|undefined;let input:WebGLBuffer|null=null,output:WebGLBuffer|null=null,vao:WebGLVertexArrayObject|null=null,feedback:WebGLTransformFeedback|null=null,texture:WebGLTexture|null=null,traceTexture:WebGLTexture|null=null,active=false;
  try{
   if(usesStepConvergence(c))return {warning:CONVERGENCE_CPU_NOTICE};
   if(usesResidualConvergence(c))return (this.residual??=new FractalResidualGpu()).sample(points,width,height,view,c,traceColors);
   if(points.length===0)return {values:new Float32Array(0)};
   if(points.length%2||points.length>131072||!points.every(Number.isFinite))throw new Error('GPU 单批最多 65536 个有限像素');
   if(!formulas.includes(c.formula))throw new Error('不支持此公式');
   const distanceEnabled=!!c.distance?.requested,stride=16+(distanceEnabled?FRACTAL_DISTANCE_GPU_STRIDE:0);
   gl=this.context(distanceEnabled);const g=gl;g.useProgram(this.program!);
   const loc=(name:string)=>{if(!this.uniforms.has(name))this.uniforms.set(name,g.getUniformLocation(this.program!,name));return this.uniforms.get(name)!;};
   const one=(name:string,value:number)=>{if(!Number.isFinite(Math.fround(value)))throw new Error(`${name} 超出 float32`);g.uniform1f(loc(name),value);};
   const two=(name:string,a:number,b:number)=>{if(![a,b].every(v=>Number.isFinite(Math.fround(v))))throw new Error(`${name} 超出 float32`);g.uniform2f(loc(name),a,b);};
   const int=(name:string,value:number)=>g.uniform1i(loc(name),value);
   two('size',width,height);two('center',view.centerX+view.centerXLow,view.centerY+view.centerYLow);two('start',...c.start);two('julia',...c.julia);two('power',...c.power);two('feedback',c.feedback,c.feedbackImag);two('quad',...c.quad);two('constantTerm',...c.constantTerm);two('initialCoefficient',...c.initialCoefficient);two('trapCenter',...c.trapCenter);
   for(const name of ['bailout','tolerance','relaxation','denomOffset','singularityGuard','trapRadius','trapRotation','trapAspect'] as const)one(name,c[name]);one('zoom',view.zoom);one('rotation',view.rotation);one('glitchThreshold',threshold);
   int('formula',formulas.indexOf(c.formula));int('juliaMode',c.variant==='julia'?1:0);int('iterations',c.iterations);int('historyPower',c.phoenixPower2);int('trapShape',['point','ring','cross'].indexOf(c.trapShape));int('perturb',reference?1:0);int('referenceLength',reference?.length??0);
   if(distanceEnabled){int('sourceDistanceCapable',c.distance!.capability.supported?1:0);int('sourceDistancePower',c.distance!.capability.power);}
   texture=g.createTexture();if(!texture)throw new Error('GPU texture 分配失败');g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,texture);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);
   const length=reference?.length??1;if(length>g.getParameter(g.MAX_TEXTURE_SIZE))throw new Error('参考轨道超出 GPU 纹理长度');g.texImage2D(g.TEXTURE_2D,0,g.RGBA32F,length,1,0,g.RGBA,g.FLOAT,reference?.values??new Float32Array(4));int('referenceTexture',0);
   traceTexture=uploadFractalTrace(g,this.program!,traceColors);
   input=g.createBuffer();output=g.createBuffer();vao=g.createVertexArray();feedback=g.createTransformFeedback();if(!input||!output||!vao||!feedback)throw new Error('GPU 缓冲分配失败');
   g.bindVertexArray(vao);g.bindBuffer(g.ARRAY_BUFFER,input);g.bufferData(g.ARRAY_BUFFER,points,g.STATIC_DRAW);g.enableVertexAttribArray(0);g.vertexAttribPointer(0,2,g.FLOAT,false,0,0);
   g.bindTransformFeedback(g.TRANSFORM_FEEDBACK,feedback);g.bindBuffer(g.TRANSFORM_FEEDBACK_BUFFER,output);g.bufferData(g.TRANSFORM_FEEDBACK_BUFFER,points.length/2*stride*4,g.STREAM_READ);g.bindBufferBase(g.TRANSFORM_FEEDBACK_BUFFER,0,output);g.enable(g.RASTERIZER_DISCARD);
   g.beginTransformFeedback(g.POINTS);active=true;g.drawArrays(g.POINTS,0,points.length/2);g.endTransformFeedback();active=false;
   const packed=new Float32Array(points.length/2*stride);g.getBufferSubData(g.TRANSFORM_FEEDBACK_BUFFER,0,packed);const values=new Float32Array(points.length*4),traps=traceColors?new Float32Array(points.length*4):undefined,distance=distanceEnabled?new Float32Array(points.length/2*FRACTAL_DISTANCE_GPU_STRIDE):undefined;for(let i=0;i<points.length/2;i++){const k=i*stride;values.set(packed.subarray(k,k+8),i*8);traps?.set(packed.subarray(k+8,k+16),i*8);distance?.set(packed.subarray(k+16,k+stride),i*FRACTAL_DISTANCE_GPU_STRIDE);}const error=g.getError();if(error!==g.NO_ERROR||g.isContextLost())throw new Error(`GPU 执行失败 (${error})`);return {values,traps,distance};
  }catch(error){return {warning:`GPU 分形回退 CPU：${error instanceof Error?error.message:String(error)}`};}
  finally{if(gl){if(active)gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindVertexArray(null);gl.bindTexture(gl.TEXTURE_2D,null);gl.deleteBuffer(input);gl.deleteBuffer(output);gl.deleteVertexArray(vao);gl.deleteTransformFeedback(feedback);gl.deleteTexture(texture);gl.deleteTexture(traceTexture);gl.activeTexture(gl.TEXTURE0);}}
 }
 dispose(){this.source?.dispose();this.source=undefined;this.residual?.dispose();this.residual=undefined;if(this.gl){for(const program of this.programs.values())this.gl.deleteProgram(program);this.gl.getExtension('WEBGL_lose_context')?.loseContext();}this.gl=undefined;this.program=undefined;this.programs.clear();this.uniforms.clear();}
}
export function unpackGpuOrbit(values:Float32Array,i:number,residual?:Float32Array,config?:Pick<FractalConfig,'distance'>,distance?:Float32Array):FractalOrbit {
 const offset=i*8,status=Math.round(values[offset+3]),orbit:FractalOrbit={z:[values[offset],values[offset+1]],count:Math.round(values[offset+2]),inside:(status&1)!==0,invalid:(status&2)!==0,converged:(status&4)!==0,derivative:[values[offset+4],values[offset+5]],trap:values[offset+6]};
 if(residual){orbit.z=[orbit.z[0]+residual[offset],orbit.z[1]+residual[offset+1]];const iteration=residual[offset+7],metric=residual[offset+6];if(iteration>=0)orbit.colorIteration=iteration;if(metric)orbit.convergence={iteration,metric:metric===1?'step':'fixed-point',distance:residual[offset+2]+residual[offset+3],colorResidual:residual[offset+4]+residual[offset+5]};}
 if(config?.distance?.requested){
  const k=i*FRACTAL_DISTANCE_GPU_STRIDE;if(!distance||k+FRACTAL_DISTANCE_GPU_STRIDE>distance.length)throw new Error('GPU source distance facts are missing');
  const valid=distance[k+3],exitKind=distance[k+7],iteration=distance[k+6],path=distance[k+9];
  if(![0,1].includes(valid)||![0,1,2].includes(exitKind)||![0,1].includes(path)||!Number.isInteger(iteration)||iteration<0||valid===1&&(!Number.isFinite(distance[k+2])||distance[k+2]<0))throw new Error('GPU source distance facts are invalid');
  const facts:FractalDistanceFacts={version:config.distance.version,path:path===1?'perturbation':'ordinary',derivative:[distance[k],distance[k+1]],finalZHigh:[distance[k+4],distance[k+5]],iteration,exitKind:exitKind as 0|1|2,residualSquared:distance[k+8],estimate:valid===1?{valid:true,value:distance[k+2]}:{valid:false,value:0,reason:!config.distance.capability.supported?'capability-disabled':exitKind===0?'not-escaped':'invalid-distance'}};orbit.distance=facts;orbit.derivative=facts.derivative;
 }
 return orbit;
}
export const fractalGpu=new FractalGpu();
