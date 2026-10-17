import type {FractalConfig} from '../scenes/complex';
import type {GpuOrbitBatch} from './fractalGpu';
import type {FractalColors} from './fractalColor';
import {stepTolerance} from './fractalConvergence';
import {usesFractalTrap} from './fractalColor';
import {fractalTrapGLSL,uploadFractalTrace} from './fractalColorGpu';
import {complexPixel,type FractalViewport} from './complexViewport';
import {FRACTAL_DISTANCE_GLSL,FRACTAL_DISTANCE_GPU_STRIDE} from './fractalDistance';

/** Independent two-float rational orbit. This is neither native DS parity nor
 * arbitrary precision. Branches carry a forward-error estimate and driver checks; these are
 * numerical guards, not interval proofs. Uncertain results use CPU repair. */
function vertex(distance:boolean):string{return `#version 300 es
#pragma STDGL invariant(all)
precision highp float;precision highp int;
layout(location=0)in vec4 point;
uniform vec4 start,julia,quad,constantTerm,initialCoefficient;
uniform vec2 tolerance,bailout,relaxation,denomOffset,singularSentinel;
uniform int formula,juliaMode,iterations,power;
uniform uint roundBarrier;
uniform vec4 legacyTrap;uniform vec3 legacyTrapShape;uniform float traceFeature;
out vec4 orbitA;out vec4 orbitB;out vec4 residualA;out vec4 residualB;out vec4 trapA;out vec4 trapB;
${fractalTrapGLSL}
const float ROUND=2e-14;
bool unsafe=false;
bool bad(float a){return (floatBitsToUint(a)&0x7f800000u)==0x7f800000u;}
bool bad4(vec4 a){return bad(a.x)||bad(a.y)||bad(a.z)||bad(a.w);}
// The zero-valued runtime integer barrier makes each binary32 operation
// observable before the next one. Without it, Metal fast math may reassociate
// the error-free transforms into plain float arithmetic, even with invariant.
float rounded(float x){return uintBitsToFloat(floatBitsToUint(x)^roundBarrier);}
float addF(float a,float b){return rounded(a+b);}float subF(float a,float b){return rounded(a-b);}float mulF(float a,float b){return rounded(a*b);}
vec2 renorm(float a,float b){float s=addF(a,b);return vec2(s,subF(b,subF(s,a)));}
vec2 addD(vec2 a,vec2 b){float s=addF(a.x,b.x),v=subF(s,a.x),e=addF(addF(subF(a.x,subF(s,v)),subF(b.x,v)),addF(a.y,b.y));return renorm(s,e);}
vec2 subD(vec2 a,vec2 b){return addD(a,-b);}
vec2 mulD(vec2 a,vec2 b){
 float p=mulF(a.x,b.x),ac=mulF(4097.,a.x),bc=mulF(4097.,b.x),ah=subF(ac,subF(ac,a.x)),bh=subF(bc,subF(bc,b.x)),al=subF(a.x,ah),bl=subF(b.x,bh);
 float e=addF(addF(addF(subF(mulF(ah,bh),p),mulF(ah,bl)),mulF(al,bh)),mulF(al,bl));e=addF(e,addF(mulF(a.x,b.y),mulF(a.y,b.x)));e=addF(e,mulF(a.y,b.y));
 return renorm(p,e);
}
vec2 divD(vec2 a,vec2 b){float q=rounded(a.x/b.x);vec2 r=subD(a,mulD(b,vec2(q,0.)));return addD(vec2(q,0.),vec2(rounded(addF(r.x,r.y)/b.x),0.));}
vec2 sqrtD(vec2 a){if(a.x<=0.)return vec2(0.);float q=sqrt(a.x);return mulD(vec2(.5,0.),addD(vec2(q,0.),divD(a,vec2(q,0.))));}
vec2 normD(vec4 z){float scale=max(abs(z.x),abs(z.z));if(scale==0.)return vec2(0.);vec2 x=divD(z.xy,vec2(scale,0.)),y=divD(z.zw,vec2(scale,0.));return mulD(vec2(scale,0.),sqrtD(addD(mulD(x,x),mulD(y,y))));}
float norm(vec4 z){vec2 n=normD(z);return n.x+n.y;}
float l1(vec4 z){return abs(z.x)+abs(z.y)+abs(z.z)+abs(z.w);}
float trapValue(vec4 z){vec2 q=vec2(z.x+z.y,z.z+z.w)-legacyTrap.xy;float co=legacyTrapShape.x,si=legacyTrapShape.y;q=vec2((q.x*co-q.y*si)/legacyTrap.w,q.x*si+q.y*co);return legacyTrapShape.z>1.5?min(abs(q.x),abs(q.y)):legacyTrapShape.z>.5?abs(length(q)-legacyTrap.z):length(q);}
struct C{vec4 v;float e;};
C value(vec4 v){return C(v,ROUND*l1(v));}
C scalar(float x){return C(vec4(x,0.,0.,0.),0.);}
C checked(vec4 v,float e){if(bad4(v)||bad(e)||max(abs(v.x),abs(v.z))>1e30)unsafe=true;return C(v,e*1.000001+1e-30);}
C addC(C a,C b){return checked(vec4(addD(a.v.xy,b.v.xy),addD(a.v.zw,b.v.zw)),a.e+b.e+ROUND*(l1(a.v)+l1(b.v)));}
C subC(C a,C b){return addC(a,C(-b.v,b.e));}
C mulC(C a,C b){return checked(vec4(subD(mulD(a.v.xy,b.v.xy),mulD(a.v.zw,b.v.zw)),addD(mulD(a.v.xy,b.v.zw),mulD(a.v.zw,b.v.xy))),a.e*l1(b.v)+b.e*l1(a.v)+2.*a.e*b.e+ROUND*l1(a.v)*l1(b.v));}
C scaleC(C a,float b){return mulC(a,scalar(b));}
C powC(C z,int p){C a=scalar(1.),b=z;for(int i=0;i<6;i++){if((p&1)==1)a=mulC(a,b);p=p>>1;if(p==0)break;b=mulC(b,b);}return a;}
C divideC(C a,C b){
 float radius=norm(b.v),bound=1.5*b.e;
 if(radius<=bound){unsafe=true;return scalar(0.);}
 vec2 re,im;
 if(abs(b.v.x)>=abs(b.v.z)){vec2 r=divD(b.v.zw,b.v.xy),d=addD(b.v.xy,mulD(b.v.zw,r));re=divD(addD(a.v.xy,mulD(a.v.zw,r)),d);im=divD(subD(a.v.zw,mulD(a.v.xy,r)),d);}
 else{vec2 r=divD(b.v.xy,b.v.zw),d=addD(b.v.zw,mulD(b.v.xy,r));re=divD(addD(mulD(a.v.xy,r),a.v.zw),d);im=divD(subD(mulD(a.v.zw,r),a.v.xy),d);}
 vec4 q=vec4(re,im);float error=(1.5*a.e+norm(q)*bound)/(radius-bound)+ROUND*l1(q);return checked(q,error);
}
// Returns the same singular branch as CPU. Near the strict boundary, the CPU
// owner decides; zero/finite sentinels are not a substitute for invalid math.
bool singular(C denominator){float radius=norm(denominator.v),bound=1.5*denominator.e+ROUND*radius;if(abs(radius-1e-12)<=bound)unsafe=true;return radius<1e-12;}
bool below(vec2 distance,vec2 limit,float error){vec2 difference=subD(distance,limit);if(abs(difference.x+difference.y)<=error+ROUND*abs(limit.x))unsafe=true;return difference.x<0.||(difference.x==0.&&difference.y<0.);}
C iterate(C z,C constant,out C slope){
 C numerator,denominator,nd,dd;
 if(formula==0){numerator=addC(mulC(z,z),subC(constant,scalar(1.)));denominator=addC(scaleC(z,2.),subC(constant,scalar(2.)));nd=scaleC(z,2.);dd=scalar(2.);}
 else if(formula==1){C a=subC(constant,scalar(1.)),b=subC(constant,scalar(2.)),ab=mulC(a,b);numerator=addC(addC(powC(z,3),scaleC(mulC(a,z),3.)),ab);denominator=addC(addC(scaleC(mulC(z,z),3.),scaleC(mulC(b,z),3.)),addC(ab,scalar(1.)));nd=addC(scaleC(mulC(z,z),3.),scaleC(a,3.));dd=addC(scaleC(z,6.),scaleC(b,3.));}
 else{numerator=addC(addC(powC(z,power),mulC(value(quad),mulC(z,z))),value(constantTerm));denominator=addC(addC(scaleC(powC(z,power-1),2.),mulC(value(initialCoefficient),constant)),value(vec4(denomOffset,0.,0.)));nd=addC(scaleC(powC(z,power-1),float(power)),scaleC(mulC(value(quad),z),2.));dd=scaleC(powC(z,power-2),float(2*(power-1)));}
 if(singular(denominator)){slope=scalar(0.);if(formula==2)return value(vec4(singularSentinel,0.,0.));return scalar(0.);}
 C ratio=divideC(numerator,denominator),derivative=divideC(subC(nd,mulC(ratio,dd)),denominator);
 if(formula==2){C r=value(vec4(relaxation,0.,0.));slope=addC(scalar(1.),mulC(r,subC(derivative,scalar(1.))));return addC(z,mulC(r,subC(ratio,z)));}
 slope=scaleC(mulC(ratio,derivative),2.);return mulC(ratio,ratio);
}
${distance?`${FRACTAL_DISTANCE_GLSL}
uniform int sourceDistanceCapable,sourceDistancePower;
out vec4 sourceDistanceA;out vec4 sourceDistanceB;out vec4 sourceDistanceC;
void main(){`:`void main(){`}
 bool isJulia=juliaMode==1;C pixel=value(point),constant=pixel,z=value(start);if(isJulia)constant=value(julia);if(formula==2||isJulia)z=pixel;
 ${distance?`vec2 sourceD=isJulia?vec2(1.,0.):vec2(0.);
 int count=iterations,status=1,metric=0,ci=iterations-1;`:`int count=iterations,status=1,metric=0,ci=iterations-1;`}vec2 distance=vec2(0.),colorResidual=vec2(0.);float repair=0.,nearest=3.402823466e38;
 // A driver that reassociates error-free transforms cannot run this kernel.
 // The uploaded point is not involved in the capability guard's exact oracle.
 vec2 guard=subD(addD(vec2(1.,0.),vec2(0.00000001,0.)),vec2(1.,0.)),productGuard=mulD(vec2(1.0000001192092896,0.),vec2(1.0000001192092896,0.));
 if(abs(guard.x-0.00000001)>1e-15||productGuard.y<1.4e-14||productGuard.y>1.5e-14){orbitA=vec4(0.);orbitB=vec4(0.,0.,0.,2.);residualA=vec4(0.);residualB=vec4(0.);${distance?`trapA=vec4(0.);trapB=vec4(0.);sourceDistanceA=vec4(0.);sourceDistanceB=vec4(0.);sourceDistanceC=vec4(0.);gl_Position=vec4(0.);return;`:`trapA=vec4(0.);trapB=vec4(0.);gl_Position=vec4(0.);return;`}}
 for(int n=0;n<4096;n++){
  ${distance?`if(n>=iterations)break;C old=z;
  if(sourceDistanceCapable==1)sourceD=sourceDistanceStep(sourceD,vec2(old.v.x,old.v.z),sourceDistancePower,isJulia);`:`if(n>=iterations)break;C old=z;`}
  if(traceEnabled!=0){vec2 approximate=vec2(z.v.x+z.v.y,z.v.z+z.v.w);float loss=max(abs(z.v.y-(approximate.x-z.v.x)),abs(z.v.w-(approximate.y-z.v.z)));if(loss+z.e>traceFeature){repair=1.;count=n+1;ci=-1;break;}traceStep(approximate);}
  // Propagate a sensitivity/error estimate through the rational derivative.
  // Re-evaluate with zero input uncertainty to estimate local roundoff instead
  // of treating correlated N/D terms as independent noise. This is a guard,
  // not an interval certificate or a universal guarantee against chaos.
  C slope,localSlope;iterate(old,constant,slope);C local=iterate(C(old.v,0.),constant,localSlope);
  z=checked(local.v,1.5*local.e+(norm(slope.v)+1.5*slope.e)*old.e);
  if(unsafe||bad4(z.v)){z=old;count=n+1;ci=-1;repair=1.;break;}
  nearest=min(nearest,trapValue(z.v));
  vec2 magnitude=normD(z.v);float magnitudeError=1.5*z.e+ROUND*abs(magnitude.x);C target=scalar(1.);if(formula==2||(formula==1&&isJulia))target=old;C delta=subC(z,target);vec2 measured=normD(delta.v);float measuredError=1.5*delta.e+ROUND*abs(measured.x);
  bool canConverge=formula==2||((tolerance.x>0.||tolerance.y>0.)&&below(magnitude,bailout,magnitudeError));
  vec2 threshold=tolerance;
  bool converged=canConverge&&below(measured,threshold,measuredError);
  if(unsafe){count=n+1;ci=-1;repair=1.;break;}
  if(converged){count=n+1;ci=n;status=4;metric=(formula==2||(formula==1&&isJulia))?1:2;distance=measured;colorResidual=formula==0?vec2(0.):measured;
   if(formula!=0&&measured.x<=32.*measuredError)repair=1.;break;}
  bool escaped=formula==2?!below(magnitude,vec2(1e6,0.),magnitudeError):!below(magnitude,bailout,magnitudeError);
  // Binocular escapes strictly above 1e6; equality is repaired, not guessed.
  if(unsafe){count=n+1;ci=-1;repair=1.;break;}
  if(escaped){count=n+1;ci=n;status=0;break;}
  if(z.e>1e-8*max(1.,norm(z.v))){repair=1.;count=n+1;ci=-1;break;}
 }
 ${distance?`int sourceExit=(status&1)!=0?0:((status&4)!=0?2:1);
 vec2 high=vec2(z.v.x,z.v.z),sourceEstimate=sourceDistanceEstimate(high,sourceD,sourceDistancePower,sourceDistanceCapable==1,sourceExit!=0);
 sourceDistanceA=vec4(sourceD,sourceEstimate);sourceDistanceB=vec4(high,float(ci<0?count-1:ci),float(sourceExit));sourceDistanceC=vec4(colorResidual.x*colorResidual.x,0.,0.,0.);
 orbitA=vec4(z.v.x,z.v.z,float(count),float(status));`:`orbitA=vec4(z.v.x,z.v.z,float(count),float(status));`}orbitB=vec4(isJulia?1.:0.,0.,nearest,repair);
 residualA=vec4(z.v.y,z.v.w,distance);residualB=vec4(colorResidual,float(metric),float(ci));trapA=traceInside;trapB=traceOutside;gl_Position=vec4(0.);
}`;}
const fragment='#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(0.);}';
const split=(n:number):[number,number]=>{const hi=Math.fround(n),lo=Math.fround(n-hi);if(!Number.isFinite(hi)||!Number.isFinite(lo)||Math.abs(n)>1e30||n!==0&&Math.abs(n)<1e-30)throw new Error('残差 GPU 参数或坐标超出双 float 表示范围');return[hi,lo];};
export function residualGpuCapability(c:FractalConfig):string|undefined{
 if(c.convergenceMode!=='residual'||!['magnet1','magnet2','binocular'].includes(c.formula))return '残差 GPU 只接受 Magnet/Binocular residual 配置。';
 if(c.formula==='binocular'&&!Number.isInteger(Math.max(2,c.power[0])))return 'Binocular 非整数指数仍使用 CPU 复幂；残差 GPU 当前只验证整数有理函数。';
 return;
}
export class FractalResidualGpu {
 private gl?:WebGL2RenderingContext;private program?:WebGLProgram;private programs=new Map<boolean,WebGLProgram>();private uniforms=new Map<string,WebGLUniformLocation|null>();
 private context(distance:boolean){
  if(this.gl?.isContextLost()){this.gl=undefined;this.program=undefined;this.programs.clear();this.uniforms.clear();}
  if(!this.gl){if(typeof OffscreenCanvas==='undefined')throw new Error('OffscreenCanvas 不可用');this.gl=new OffscreenCanvas(1,1).getContext('webgl2',{antialias:false,depth:false,alpha:false})??undefined;if(!this.gl)throw new Error('WebGL2 不可用');}
  const cached=this.programs.get(distance);if(this.program!==cached){this.program=cached;this.uniforms.clear();}
  if(!this.program){const gl=this.gl,p=gl.createProgram();if(!p)throw new Error('残差 GPU program 分配失败');const shaders:WebGLShader[]=[];try{for(const[type,source]of[[gl.VERTEX_SHADER,vertex(distance)],[gl.FRAGMENT_SHADER,fragment]] as const){const shader=gl.createShader(type);if(!shader)throw new Error('残差 GPU shader 分配失败');shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)??'残差 GPU 编译失败');gl.attachShader(p,shader);}gl.transformFeedbackVaryings(p,['orbitA','orbitB','residualA','residualB','trapA','trapB',...(distance?['sourceDistanceA','sourceDistanceB','sourceDistanceC']:[])],gl.INTERLEAVED_ATTRIBS);gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p)??'残差 GPU 链接失败');this.program=p;this.programs.set(distance,p);}catch(e){gl.deleteProgram(p);throw e;}finally{shaders.forEach(s=>gl.deleteShader(s));}}
  return this.gl;
 }
 sample(points:Float32Array,width:number,height:number,view:FractalViewport,c:FractalConfig,colors?:FractalColors):GpuOrbitBatch{
  let gl:WebGL2RenderingContext|undefined,input:WebGLBuffer|null=null,output:WebGLBuffer|null=null,vao:WebGLVertexArrayObject|null=null,feedback:WebGLTransformFeedback|null=null,traceTexture:WebGLTexture|null=null,active=false;
  try{
   const reason=residualGpuCapability(c);if(reason)return{warning:reason};
   if(points.length%2||points.length>131072||!points.every(Number.isFinite)||![width,height].every(v=>Number.isInteger(v)&&v>0))throw new Error('残差 GPU 单批最多 65536 个有限像素，画布尺寸必须为正整数');
   if(points.length===0)return{values:new Float32Array(),residual:new Float32Array()};
   const coordinates=new Float32Array(points.length*2);for(let i=0;i<points.length/2;i++){const z=complexPixel(points[i*2],points[i*2+1],width,height,view);coordinates.set([...split(z[0]),...split(z[1])],i*4);}
   const distanceEnabled=!!c.distance?.requested,stride=24+(distanceEnabled?FRACTAL_DISTANCE_GPU_STRIDE:0);
   gl=this.context(distanceEnabled);const g=gl;g.useProgram(this.program!);const loc=(name:string)=>{if(!this.uniforms.has(name))this.uniforms.set(name,g.getUniformLocation(this.program!,name));return this.uniforms.get(name)!;};
   const real=(name:string,n:number)=>g.uniform2f(loc(name),...split(n)),complex=(name:string,z:readonly[number,number])=>g.uniform4f(loc(name),...split(z[0]),...split(z[1]));
   for(const key of['start','julia','quad','constantTerm','initialCoefficient'] as const)complex(key,c[key]);for(const key of['bailout','relaxation','denomOffset'] as const)real(key,c[key]);real('tolerance',c.formula==='binocular'?stepTolerance(c.tolerance):c.tolerance);real('singularSentinel',1e30);
   g.uniform1i(loc('formula'),['magnet1','magnet2','binocular'].indexOf(c.formula));g.uniform1i(loc('juliaMode'),c.variant==='julia'?1:0);g.uniform1i(loc('iterations'),c.iterations);g.uniform1i(loc('power'),Math.max(2,c.power[0]));g.uniform1ui(loc('roundBarrier'),0);
   if(distanceEnabled){g.uniform1i(loc('sourceDistanceCapable'),c.distance!.capability.supported?1:0);g.uniform1i(loc('sourceDistancePower'),c.distance!.capability.power);}
   const legacy=[...c.trapCenter,c.trapRadius,c.trapAspect];if(!legacy.every(v=>Number.isFinite(Math.fround(v))))throw new Error('Trap parameters exceed float32');g.uniform4fv(loc('legacyTrap'),legacy);g.uniform3f(loc('legacyTrapShape'),Math.cos(c.trapRotation),Math.sin(c.trapRotation),['point','ring','cross'].indexOf(c.trapShape));
   traceTexture=uploadFractalTrace(g,this.program!,colors);const features=colors?[colors.inside,colors.outside].filter(usesFractalTrap).map(s=>s.threshold):[],feature=features.length?Math.min(...features):1;g.uniform1f(loc('traceFeature'),feature/(Math.max(1,c.iterations)*2048));
   input=g.createBuffer();output=g.createBuffer();vao=g.createVertexArray();feedback=g.createTransformFeedback();if(!input||!output||!vao||!feedback)throw new Error('残差 GPU 缓冲分配失败');g.bindVertexArray(vao);g.bindBuffer(g.ARRAY_BUFFER,input);g.bufferData(g.ARRAY_BUFFER,coordinates,g.STATIC_DRAW);g.enableVertexAttribArray(0);g.vertexAttribPointer(0,4,g.FLOAT,false,0,0);g.bindTransformFeedback(g.TRANSFORM_FEEDBACK,feedback);g.bindBuffer(g.TRANSFORM_FEEDBACK_BUFFER,output);g.bufferData(g.TRANSFORM_FEEDBACK_BUFFER,points.length/2*stride*4,g.STREAM_READ);g.bindBufferBase(g.TRANSFORM_FEEDBACK_BUFFER,0,output);g.enable(g.RASTERIZER_DISCARD);g.beginTransformFeedback(g.POINTS);active=true;g.drawArrays(g.POINTS,0,points.length/2);g.endTransformFeedback();active=false;
   const packed=new Float32Array(points.length/2*stride);g.getBufferSubData(g.TRANSFORM_FEEDBACK_BUFFER,0,packed);const values=new Float32Array(points.length*4),residual=new Float32Array(points.length*4),traps=colors?new Float32Array(points.length*4):undefined,distance=distanceEnabled?new Float32Array(points.length/2*FRACTAL_DISTANCE_GPU_STRIDE):undefined;for(let i=0;i<points.length/2;i++){const k=i*stride;if(packed[k+7]===2)throw new Error('驱动未保留双 float 运算低位');if(!Number.isInteger(packed[k+2])||packed[k+2]<1||packed[k+2]>c.iterations||![0,1,4].includes(packed[k+3])||![0,1].includes(packed[k+7])||!packed.subarray(k,k+24).every(Number.isFinite)||![0,1,2].includes(packed[k+14])||!Number.isInteger(packed[k+15])||packed[k+15]<-1||packed[k+15]>=c.iterations)throw new Error('残差 GPU 返回无效轨道记录');values.set(packed.subarray(k,k+8),i*8);residual.set(packed.subarray(k+8,k+16),i*8);traps?.set(packed.subarray(k+16,k+24),i*8);distance?.set(packed.subarray(k+24,k+stride),i*FRACTAL_DISTANCE_GPU_STRIDE);}const error=g.getError();if(error!==g.NO_ERROR||g.isContextLost())throw new Error(`残差 GPU 执行失败 (${error})`);return{values,residual,traps,distance};
  }catch(error){return{warning:`GPU 分形回退 CPU：${error instanceof Error?error.message:String(error)}`};}
  finally{if(gl){if(active)gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindVertexArray(null);gl.deleteBuffer(input);gl.deleteBuffer(output);gl.deleteVertexArray(vao);gl.deleteTransformFeedback(feedback);gl.deleteTexture(traceTexture);gl.activeTexture(gl.TEXTURE0);}}
 }
 dispose(){if(this.gl){for(const program of this.programs.values())this.gl.deleteProgram(program);this.gl.getExtension('WEBGL_lose_context')?.loseContext();}this.gl=undefined;this.program=undefined;this.programs.clear();this.uniforms.clear();}
}
