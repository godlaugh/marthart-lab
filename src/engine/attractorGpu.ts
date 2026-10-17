import type {AttractorFrameJob} from '../scenes/geometry';
import {AttractorSeedStream,ATTRACTOR_SEED_CHUNK,MAX_ATTRACTOR_GPU_PARTICLES,type AttractorInitialConfig} from './attractorSeeds';
import {compileGlslExpression,glslRealPrelude} from './gpuSampler';
import {existingParameterNameError} from './expression';

const CHUNK=ATTRACTOR_SEED_CHUNK,MAX_BYTES=512*1024*1024,MAX_PROGRAMS=8;
const check=(condition:boolean,message:string)=>{if(!condition)throw new Error(message);};
const finite32=(v:number)=>Number.isFinite(v)&&Number.isFinite(Math.fround(v))&&(v===0||Math.abs(v)>=1.1754943508222875e-38);
const cancel=(f?:()=>boolean)=>{if(f?.())throw new DOMException('Attractor GPU calculation cancelled','AbortError');};
/** Three vec4 states, three uvec2 counters and one static vec2 seed per particle.
 * Peak adds readback, caller output, and one bounded seed-upload chunk; excludes
 * browser/driver allocations and is not a whole-process RAM/VRAM claim. */
export function attractorGpuBytes(count:number):{retainedBytes:number;estimatedPeakBytes:number}{
 check(Number.isInteger(count)&&count>=1&&count<=MAX_ATTRACTOR_GPU_PARTICLES,'Attractor GPU particle count must be 1–2000000');
 return{retainedBytes:count*80,estimatedPeakBytes:count*160+Math.min(CHUNK,count)*32};
}
export interface AttractorGpuFieldSource {source:string;key:string;parameters:readonly string[];uniforms:Record<string,number>;}
/** Safe arithmetic only. Explicit parameters precede constants such as e;
 * physical time is supplied separately for every Euler/RK4 stage. */
export function attractorGpuFieldSource(field:AttractorFrameJob['field']):AttractorGpuFieldSource{
 const parameters=Object.keys(field.parameters).sort();
 check(parameters.every(name=>!existingParameterNameError(name,'attractor')),'Attractor GPU parameter name is reserved or invalid');
 check(Object.values(field.parameters).every(finite32),'Attractor GPU parameters exceed float32 range');
 check(field.equations.length===3&&field.equations.every(v=>typeof v==='string'),'Attractor GPU needs three derivative equations');
 const names=[...parameters,'t','time'],expressions=field.equations.map(source=>compileGlslExpression(source,['x','y','z'],names));
 const source=`${parameters.map((_,i)=>`uniform float parameter${i};`).join('\n')}
vec3 derivative(vec3 samplePosition,float physicalTime){float parameter${parameters.length}=physicalTime,parameter${parameters.length+1}=physicalTime;return vec3(${expressions.join(',')});}`;
 return{source,key:source,parameters:Object.freeze(parameters),uniforms:Object.fromEntries(parameters.map((name,i)=>['parameter'+i,field.parameters[name]]))};
}
const HEADER='#version 300 es\nprecision highp float;precision highp int;\n';
const PREFIX=HEADER+`
layout(location=0)in vec4 oldState;layout(location=1)in uvec2 oldSteps;layout(location=2)in vec2 initial;
out vec4 newState;flat out uvec2 newSteps;
uniform float dt,dtMin,dtMax,fraction,limit;uniform int method,variableStep,batchSteps,warming,warmOffset;
${glslRealPrelude}
bool finiteFloat(float x){return (floatBitsToUint(x)&0x7f800000u)!=0x7f800000u;}
bool finiteVector(vec3 x){return finiteFloat(x.x)&&finiteFloat(x.y)&&finiteFloat(x.z);}
float norm3(vec3 p){float m=max(max(abs(p.x),abs(p.y)),abs(p.z));return m==0.?0.:m*sqrt(dot(p/m,p/m));}
`;
const MAIN=`
vec3 integrate(vec3 p,float time,float h){
 vec3 k1=derivative(p,time);if(method==0)return p+h*k1;
 vec3 k2=derivative(p+h*k1/2.,time+h/2.);
 vec3 k3=derivative(p+h*k2/2.,time+h/2.);
 vec3 k4=derivative(p+h*k3,time+h);
 return p+h*(k1+2.*k2+2.*k3+k4)/6.;
}
void main(){vec4 state=oldState;uvec2 count=oldSteps;float h=(variableStep==1?dtMin+initial.x*(dtMax-dtMin):dt)*fraction;
 for(int j=0;j<256;j++){
  if(j>=batchSteps||state.w<0.||(warming==1&&warmOffset+j>=int(initial.y)))break;
  vec3 next=integrate(state.xyz,state.w,h);float time=state.w+h;
  count.x+=1u;if(count.x==0u)count.y+=1u;
  bool alive=finiteVector(next)&&finiteFloat(time)&&norm3(next)<=limit;
  state=vec4(next,alive?time:-1.);
 }
 newState=state;newSteps=count;gl_Position=vec4(0.);
}`;
const FRAGMENT=HEADER+'out vec4 color;void main(){color=vec4(0.);}';
interface Program{value:WebGLProgram;locations:Map<string,WebGLUniformLocation|null>;}
interface Resources{count:number;positions:WebGLBuffer[];counters:WebGLBuffer[];seed:WebGLBuffer;vao:WebGLVertexArrayObject;feedback:WebGLTransformFeedback;committed:number;selected:number;warmSteps:number;warmed:boolean;}

/** Persistent mathematical state only. The session owns frame/timeline policy
 * and transforms. A failed or cancelled operation destroys this owner's state;
 * callers may replay on CPU but must never consume a partial failed frame. */
export class AttractorGpu {
 private gl?:WebGL2RenderingContext;private resources?:Resources;
 private programs=new Map<string,Program>();private fields=new Map<string,AttractorGpuFieldSource>();private fieldCompiles=0;
 diagnostics(){const r=this.resources;return{...r?attractorGpuBytes(r.count):{retainedBytes:0,estimatedPeakBytes:0},particleCount:r?.count??0,programs:this.programs.size,fieldCompiles:this.fieldCompiles,context:!!this.gl,partial:!!r&&r.selected!==r.committed,warmed:r?.warmed??false};}
 private context(){
  if(this.gl?.isContextLost()){this.reset();throw new Error('Attractor GPU context lost');}
  if(!this.gl){check(typeof OffscreenCanvas!=='undefined','OffscreenCanvas unavailable');const gl=new OffscreenCanvas(1,1).getContext('webgl2',{antialias:false,depth:false,alpha:false});check(!!gl,'WebGL2 unavailable');this.gl=gl!;}
  return this.gl!;
 }
 private guard<T>(operation:()=>T):T{try{return operation();}catch(error){this.reset();throw error;}}
 private assertGL(){check(!!this.gl&&!this.gl.isContextLost()&&this.gl.getError()===this.gl.NO_ERROR,'Attractor GPU execution or allocation failed');}
 initialize(config:AttractorInitialConfig,isCancelled?:()=>boolean):void{this.guard(()=>{
  cancel(isCancelled);const bytes=attractorGpuBytes(config.count);check(bytes.estimatedPeakBytes<=MAX_BYTES,'Attractor GPU known allocations exceed 512 MiB');
  check(Number.isInteger(config.seed)&&config.seed>=0&&config.seed<=0xffffffff&&Number.isInteger(config.burn)&&config.burn>=0&&config.burn<=100000&&Number.isInteger(config.staggerMin)&&Number.isInteger(config.staggerMax)&&config.staggerMin>=0&&config.staggerMax>=config.staggerMin&&config.staggerMax<=100000,'Attractor GPU seed or warmup configuration invalid');
  check([config.spread,...config.initial,...config.min,...config.max].every(finite32)&&config.spread>=0&&config.max.every((v,i)=>v>=config.min[i]),'Attractor GPU initial coordinates invalid or exceed float32');
  check(typeof config.bounds==='boolean'&&typeof config.variableTimeStep==='boolean','Attractor GPU initialization flags invalid');
  this.reset();const gl=this.context();check(gl.getParameter(gl.MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS)>=2&&gl.getParameter(gl.MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS)>=4,'Attractor GPU transform feedback capacity insufficient');
  const buffers:WebGLBuffer[]=[],positions:WebGLBuffer[]=[],counters:WebGLBuffer[]=[];let seed:WebGLBuffer|null=null,vao:WebGLVertexArrayObject|null=null,feedback:WebGLTransformFeedback|null=null;
  const buffer=(size:number)=>{cancel(isCancelled);const b=gl.createBuffer();check(!!b,'Attractor GPU buffer allocation failed');buffers.push(b!);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,size,gl.DYNAMIC_COPY);this.assertGL();return b!;};
  try{
   for(let i=0;i<3;i++){positions.push(buffer(config.count*16));counters.push(buffer(config.count*8));}seed=buffer(config.count*8);vao=gl.createVertexArray();feedback=gl.createTransformFeedback();check(!!vao&&!!feedback,'Attractor GPU state allocation failed');this.assertGL();
   const stream=new AttractorSeedStream(config);let warmSteps=0;
   while(stream.nextIndex<config.count){cancel(isCancelled);const chunk=stream.chunk(Math.min(CHUNK,config.count-stream.nextIndex),isCancelled);for(let i=1;i<chunk.initial.length;i+=2)warmSteps=Math.max(warmSteps,chunk.initial[i]);gl.bindBuffer(gl.ARRAY_BUFFER,positions[0]);gl.bufferSubData(gl.ARRAY_BUFFER,chunk.offset*16,chunk.positions);gl.bindBuffer(gl.ARRAY_BUFFER,seed);gl.bufferSubData(gl.ARRAY_BUFFER,chunk.offset*8,chunk.initial);this.assertGL();}
   gl.bindBuffer(gl.ARRAY_BUFFER,null);cancel(isCancelled);this.resources={count:config.count,positions,counters,seed:seed!,vao:vao!,feedback:feedback!,committed:0,selected:0,warmSteps,warmed:false};
  }catch(error){buffers.forEach(b=>gl.deleteBuffer(b));gl.deleteVertexArray(vao);gl.deleteTransformFeedback(feedback);throw error;}
 });}
 private prepare(job:AttractorFrameJob):AttractorGpuFieldSource{
  check([job.dt,job.dtMin,job.dtMax,job.limit].every(finite32)&&job.dt>0&&job.dtMin>0&&job.dtMax>=job.dtMin&&job.limit>0,'Attractor GPU integration fields invalid or exceed float32');
  check(job.method==='euler'||job.method==='rk4','Attractor GPU integrator unsupported');check(typeof job.variableTimeStep==='boolean','Attractor GPU variable step flag invalid');
  const names=Object.keys(job.field.parameters).sort(),key=JSON.stringify([job.field.equations,names]);check(Object.values(job.field.parameters).every(finite32),'Attractor GPU parameters exceed float32 range');
  let source=this.fields.get(key);if(!source){source=attractorGpuFieldSource(job.field);this.fieldCompiles++;this.fields.set(key,source);if(this.fields.size>MAX_PROGRAMS)this.fields.delete(this.fields.keys().next().value!);}else{this.fields.delete(key);this.fields.set(key,source);}
  return{...source,uniforms:Object.fromEntries(source.parameters.map((name,i)=>['parameter'+i,job.field.parameters[name]]))};
 }
 private program(source:AttractorGpuFieldSource):Program{
  const existing=this.programs.get(source.key);if(existing){this.programs.delete(source.key);this.programs.set(source.key,existing);return existing;}
  const gl=this.context(),p=gl.createProgram();check(!!p,'Attractor GPU program allocation failed');const shaders:WebGLShader[]=[];
  try{for(const[type,text]of [[gl.VERTEX_SHADER,PREFIX+source.source+MAIN],[gl.FRAGMENT_SHADER,FRAGMENT]]as const){const s=gl.createShader(type);check(!!s,'Attractor GPU shader allocation failed');shaders.push(s!);gl.shaderSource(s!,text);gl.compileShader(s!);check(gl.getShaderParameter(s!,gl.COMPILE_STATUS),'Attractor GPU compile failed: '+gl.getShaderInfoLog(s!));gl.attachShader(p!,s!);}gl.transformFeedbackVaryings(p!,['newState','newSteps'],gl.SEPARATE_ATTRIBS);gl.linkProgram(p!);check(gl.getProgramParameter(p!,gl.LINK_STATUS),'Attractor GPU link failed: '+gl.getProgramInfoLog(p!));const result={value:p!,locations:new Map<string,WebGLUniformLocation|null>()};this.programs.set(source.key,result);if(this.programs.size>MAX_PROGRAMS){const oldest=this.programs.keys().next().value!;gl.deleteProgram(this.programs.get(oldest)!.value);this.programs.delete(oldest);}return result;}
  catch(error){gl.deleteProgram(p);throw error;}finally{shaders.forEach(s=>gl.deleteShader(s));}
 }
 private draw(job:AttractorFrameJob,source:AttractorGpuFieldSource,from:number,to:number,steps:number,fraction:number,warming:boolean,offset:number,isCancelled?:()=>boolean){
  const gl=this.context(),r=this.resources!;check(source.parameters.length+12<=gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),'Attractor GPU uniform capacity insufficient');const p=this.program(source);gl.useProgram(p.value);
  const loc=(name:string)=>{if(!p.locations.has(name))p.locations.set(name,gl.getUniformLocation(p.value,name));return p.locations.get(name)!;};
  for(const[name,value]of Object.entries({...source.uniforms,dt:job.dt,dtMin:job.dtMin,dtMax:job.dtMax,fraction,limit:job.limit}))gl.uniform1f(loc(name),Math.fround(value));
  for(const[name,value]of Object.entries({method:job.method==='rk4'?1:0,variableStep:job.variableTimeStep?1:0,batchSteps:steps,warming:warming?1:0,warmOffset:offset}))gl.uniform1i(loc(name),value);
  gl.bindVertexArray(r.vao);gl.bindBuffer(gl.ARRAY_BUFFER,r.positions[from]);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,4,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ARRAY_BUFFER,r.counters[from]);gl.enableVertexAttribArray(1);gl.vertexAttribIPointer(1,2,gl.UNSIGNED_INT,0,0);gl.bindBuffer(gl.ARRAY_BUFFER,r.seed);gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,2,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ARRAY_BUFFER,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,r.feedback);gl.enable(gl.RASTERIZER_DISCARD);
  try{for(let at=0;at<r.count;at+=CHUNK){cancel(isCancelled);const n=Math.min(CHUNK,r.count-at);gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER,0,r.positions[to],at*16,n*16);gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER,1,r.counters[to],at*8,n*8);gl.beginTransformFeedback(gl.POINTS);try{gl.drawArrays(gl.POINTS,at,n);}finally{gl.endTransformFeedback();}this.assertGL();}cancel(isCancelled);}
  finally{gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,1,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindVertexArray(null);}
 }
 warmup(job:AttractorFrameJob,isCancelled?:()=>boolean):void{this.guard(()=>{
  cancel(isCancelled);const r=this.resources;check(!!r,'Attractor GPU is not initialized');if(r!.warmed)return;const source=this.prepare(job);
  for(let offset=0;offset<r!.warmSteps;offset+=256){const next=1-r!.committed;this.draw(job,source,r!.committed,next,Math.min(256,r!.warmSteps-offset),1,true,offset,isCancelled);r!.committed=next;}
  r!.selected=r!.committed;r!.warmed=true;
 });}
 advance(job:AttractorFrameJob,steps:number,fraction:number,commit:boolean,isCancelled?:()=>boolean):void{this.guard(()=>{
  cancel(isCancelled);check(Number.isSafeInteger(steps)&&steps>=0&&Number.isFinite(fraction)&&fraction>=0&&fraction<=1&&typeof commit==='boolean','Attractor GPU advance range invalid');const r=this.resources;check(!!r,'Attractor GPU is not initialized');
  r!.selected=r!.committed;if(steps===0||fraction===0)return;check(finite32(fraction),'Attractor GPU fraction underflows float32');const source=this.prepare(job);check(finite32((job.variableTimeStep?job.dtMin:job.dt)*fraction),'Attractor GPU fractional time step underflows float32');let from=r!.committed;
  for(let offset=0;offset<steps;){const n=Math.min(256,steps-offset),to=commit?1-from:[0,1,2].find(side=>side!==r!.committed&&side!==from)!;this.draw(job,source,from,to,n,fraction,false,0,isCancelled);from=to;offset+=n;}
  r!.selected=from;if(commit)r!.committed=from;
 });}
 snapshot(isCancelled?:()=>boolean):{positionsAndTime:Float32Array;steps:Uint32Array}{return this.guard(()=>{
  cancel(isCancelled);const r=this.resources;check(!!r,'Attractor GPU is not initialized');const gl=this.context(),positionsAndTime=new Float32Array(r!.count*4),steps=new Uint32Array(r!.count*2);
  try{for(let at=0;at<r!.count;at+=CHUNK){cancel(isCancelled);const n=Math.min(CHUNK,r!.count-at);gl.bindBuffer(gl.COPY_READ_BUFFER,r!.positions[r!.selected]);gl.getBufferSubData(gl.COPY_READ_BUFFER,at*16,positionsAndTime,at*4,n*4);gl.bindBuffer(gl.COPY_READ_BUFFER,r!.counters[r!.selected]);gl.getBufferSubData(gl.COPY_READ_BUFFER,at*8,steps,at*2,n*2);this.assertGL();}cancel(isCancelled);return{positionsAndTime,steps};}finally{gl.bindBuffer(gl.COPY_READ_BUFFER,null);}
 });}
 /** Reads only stable requested slots from the selected committed/scratch
  * state; it never advances physics or selects a compacted display neighbor. */
 particleStates(ids:readonly number[],isCancelled?:()=>boolean):Float32Array{return this.guard(()=>{
  cancel(isCancelled);const r=this.resources;check(!!r,'Attractor GPU is not initialized');check(ids.length<=16384&&ids.every(id=>Number.isInteger(id)&&id>=0&&id<r!.count),'Attractor GPU tracking slots invalid');
  const gl=this.context(),out=new Float32Array(ids.length*4);gl.bindBuffer(gl.COPY_READ_BUFFER,r!.positions[r!.selected]);
  try{for(let i=0;i<ids.length;i++){cancel(isCancelled);gl.getBufferSubData(gl.COPY_READ_BUFFER,ids[i]*16,out,i*4,4);}this.assertGL();return out;}finally{gl.bindBuffer(gl.COPY_READ_BUFFER,null);}
 });}
 reset():void{const gl=this.gl,r=this.resources;if(gl){if(r){r.positions.forEach(b=>gl.deleteBuffer(b));r.counters.forEach(b=>gl.deleteBuffer(b));gl.deleteBuffer(r.seed);gl.deleteVertexArray(r.vao);gl.deleteTransformFeedback(r.feedback);}for(const p of this.programs.values())gl.deleteProgram(p.value);gl.getExtension('WEBGL_lose_context')?.loseContext();}this.resources=undefined;this.programs.clear();this.fields.clear();this.fieldCompiles=0;this.gl=undefined;}
 dispose():void{this.reset();}
}
