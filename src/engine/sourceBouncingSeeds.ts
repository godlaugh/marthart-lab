import {JavaSourceRandom48} from './javaSourceRandom';
import {parseSourceBouncingConfiguration,type SourceBouncingConfiguration,type SourceBouncingResult,type SourceBouncingError} from './sourceBouncingConfig';
import {createSourceBouncingSampler} from './sourceBouncingSamplers';
import type {SourceBouncingBoundary,SourceBouncingUpdate} from './sourceBouncingGpu';

const F=Math.fround;
export const SOURCE_BOUNCING_SEED_LIMITS=Object.freeze({bytes:128*1024*1024,work:64_000_000});
export interface SourceBouncingSeedOptions {
 readonly isCancelled?:()=>boolean;
 /** Optional smaller execution budget, never a change to source attempt limits. */
 readonly workLimit?:number;
}
export interface SourceBouncingSeed {
 readonly index:number;readonly position:readonly[number,number];readonly velocity:readonly[number,number];
}
export interface SourceBouncingSeedDiagnostics {
 readonly count:number;readonly generated:number;readonly outerAttempts:number;readonly centerFallbacks:number;
 readonly work:number;readonly workLimit:number;readonly randomState48:string;
}
export interface SourceBouncingSeedStream {
 readonly count:number;
 /** Source world boundary, translated once by its owner. Reusable by the GPU
  * uploader; the historical circleCenter fields do not select this center. */
 readonly update:SourceBouncingUpdate;
 next():SourceBouncingResult<SourceBouncingSeed|null>;
 diagnostics():SourceBouncingSeedDiagnostics;
}
class SeedFailure extends Error {constructor(readonly detail:SourceBouncingError){super(detail.reason);}}

/** Snapshot from BouncingParticlesMobject construction, before rendering.
 * Polygon vertices are translated in Float32; initialization does not inset
 * polygon edges by particleRadius. The GPU shader owns its separate collision
 * projection, so neither consumer borrows the local exact billiards solver. */
function boundarySnapshot(c:SourceBouncingConfiguration):SourceBouncingBoundary{
 const center=Object.freeze([c.boundaryCenterX,c.boundaryCenterY] as const);
 if(c.containerShape==='CIRCLE')return Object.freeze({kind:'circle',center,radius:c.circleRadius});
 if(c.containerShape==='ELLIPSE')return Object.freeze({kind:'ellipse',center,a:c.ellipseSemiMajorAxis,b:c.ellipseSemiMinorAxis});
 const vertices:Array<readonly[number,number]>=[];
 for(let i=0;i<c.polygonVertices.length;i+=2)vertices.push(Object.freeze([F(c.polygonVertices[i]+center[0]),F(c.polygonVertices[i+1]+center[1])] as const));
 return Object.freeze({kind:'polygon',vertices:Object.freeze(vertices)});
}
function contains(boundary:SourceBouncingBoundary,radius:number,x:number,y:number):boolean{
 if(boundary.kind==='circle'){
  const dx=F(x-boundary.center[0]),dy=F(y-boundary.center[1]),r=Math.max(0,F(boundary.radius-radius));
  return F(F(dx*dx)+F(dy*dy))<=F(r*r);
 }
 if(boundary.kind==='ellipse'){
  const dx=F(x-boundary.center[0]),dy=F(y-boundary.center[1]),a=Math.max(F(.001),F(boundary.a-radius)),b=Math.max(F(.001),F(boundary.b-radius));
  return F(F(F(dx*dx)/F(a*a))+F(F(dy*dy)/F(b*b)))<=1;
 }
 let inside=false;const vertices=boundary.vertices;
 for(let i=0,j=vertices.length-1;i<vertices.length;j=i++){
  const [xi,yi]=vertices[i],[xj,yj]=vertices[j];
  if((yi>y)!==(yj>y)){
   const dy=F(yj-yi),cross=F(F(F(F(xj-xi)*F(y-yi))/(dy===0?F(1e-6):dy))+xi);
   if(x<cross)inside=!inside;
  }
 }
 return inside;
}
function fallbackCenter(boundary:SourceBouncingBoundary):readonly[number,number]{
 if(boundary.kind!=='polygon')return boundary.center;
 let x=0,y=0;for(const point of boundary.vertices){x=F(x+point[0]);y=F(y+point[1]);}
 return Object.freeze([F(x/F(boundary.vertices.length)),F(y/F(boundary.vertices.length))] as const);
}
function velocity(c:SourceBouncingConfiguration,rng:JavaSourceRandom48,x:number,y:number):[number,number]{
 let vx:number,vy:number;
 const mode=c.initialVelocityMode;
 if(mode==='RADIAL_OUT'||mode==='RADIAL_IN'){
  vx=F(x-c.velocityCenterX);vy=F(y-c.velocityCenterY);
  if(mode==='RADIAL_IN'){vx=-vx;vy=-vy;}
 }else if(mode==='TANGENTIAL_CW'||mode==='TANGENTIAL_CCW'){
  const dx=F(x-c.velocityCenterX),dy=F(y-c.velocityCenterY);
  [vx,vy]=mode==='TANGENTIAL_CW'?[dy,-dx]:[-dy,dx];
 }else{
  const angle=mode==='RANDOM'?F(rng.nextFloat()*F(2*Math.PI)):c.initialAngle;
  vx=F(Math.cos(angle));vy=F(Math.sin(angle));
 }
 let length=F(Math.sqrt(F(F(vx*vx)+F(vy*vy))));
 if(length<F(1e-6)){vx=F(Math.cos(c.initialAngle));vy=F(Math.sin(c.initialAngle));length=1;}
 vx=F(vx/length);vy=F(vy/length);
 const jitter=F(c.initialAngleSpread+F(c.velocityNoise*F(2*Math.PI)));
 if(jitter>0){const angle=F(F(Math.atan2(vy,vx))+F(F(rng.nextFloat()-.5)*jitter));vx=F(Math.cos(angle));vy=F(Math.sin(angle));}
 return[F(vx*c.initialSpeed),F(vy*c.initialSpeed)];
}
/** Exact source order: one shared Java Random; accepted/fallback position then
 * velocity for every slot. Every rejected sampler call retains its random
 * consumption. No particle compaction, extra jitter draws or CPU normalization
 * of nonfinite source results. Rendering scale/offset do not belong here. */
export function createSourceBouncingSeedStream(input:unknown,options:SourceBouncingSeedOptions={}):SourceBouncingResult<SourceBouncingSeedStream>{
 const parsed=parseSourceBouncingConfiguration(input);if(!parsed.ok)return parsed;
 const c=parsed.value,count=c.particleCount,workLimit=options.workLimit??SOURCE_BOUNCING_SEED_LIMITS.work;
 if(!Number.isSafeInteger(workLimit)||workLimit<0||workLimit>SOURCE_BOUNCING_SEED_LIMITS.work)return{ok:false,error:{kind:'input',path:['workLimit'],reason:'初始化工作预算必须是允许范围内的非负整数'}};
 if(count<1)return{ok:false,error:{kind:'input',path:['particleCount'],reason:'源初始化需要正整数粒子数'}};
 const boundary=Object.freeze(boundarySnapshot(c)),boundaryWork=boundary.kind==='polygon'?boundary.vertices.length:1;
 // Reserve the minimum complete workload before starting, then charge actual
 // nested sampler/predicate and outer boundary work before each operation.
 // Pathological rejection stops with a capacity result, never partial success.
 if(count*(boundaryWork+2)>workLimit)return{ok:false,error:{kind:'capacity',path:['particleCount'],reason:'完整初始化的最少采样工作量超过预算；不减少粒子数量'}};
 const sampler=createSourceBouncingSampler(c);if(!sampler.ok)return sampler;
 const rng=new JavaSourceRandom48(BigInt(c.seed)),center=fallbackCenter(boundary);
 let index=0,outerAttempts=0,centerFallbacks=0,work=0,failure:SourceBouncingError|undefined;
 const consume=(amount:number)=>{
  if(options.isCancelled?.())throw new SeedFailure({kind:'cancelled',path:['particles',String(index)],reason:'源弹跳初始化已取消'});
  if(work+amount>workLimit)throw new SeedFailure({kind:'capacity',path:['particles',String(index)],reason:'源弹跳采样工作量超过预算；保留512次尝试规则，不返回不完整粒子数组'});
  work+=amount;
 };
 const diagnostics=():SourceBouncingSeedDiagnostics=>({count,generated:index,outerAttempts,centerFallbacks,work,workLimit,randomState48:rng.state48.toString()});
 const update=Object.freeze({subSteps:c.subSteps,timeStep:c.timeStep,particleRadius:c.particleRadius,boundary});
 return{ok:true,value:{count,update,diagnostics,next(){
  if(failure)return{ok:false,error:failure};
  try{
   consume(0);if(index===count)return{ok:true,value:null};
   let position:readonly[number,number]|undefined;
   for(let attempt=0;attempt<512;attempt++){
    const candidate=sampler.value.sample(rng,{consume});outerAttempts++;
    consume(boundaryWork);if(contains(boundary,c.particleRadius,candidate[0],candidate[1])){position=candidate;break;}
   }
   if(!position){position=center;centerFallbacks++;}
   consume(1);const v=velocity(c,rng,position[0],position[1]);
   return{ok:true,value:{index:index++,position:[position[0],position[1]],velocity:v}};
  }catch(error){if(error instanceof SeedFailure){failure=error.detail;return{ok:false,error:failure};}throw error;}
 }}};
}
export interface SourceBouncingGeneratedSeeds {
 readonly state:Float32Array;readonly update:SourceBouncingUpdate;readonly diagnostics:SourceBouncingSeedDiagnostics;
}
export interface SourceBouncingPreparedSeeds {
 readonly count:number;readonly update:SourceBouncingUpdate;
 /** Exactly one attempt, including failure/cancellation. No packed-state cache. */
 generate():SourceBouncingResult<SourceBouncingGeneratedSeeds>;
}
/** Prepare one detached configuration, sampler, RNG and translated boundary.
 * No particles are sampled and no packed state array is allocated here. The
 * session can admit its complete collision workload using count/update before
 * invoking generate. The same stream owns all later random/work consumption. */
export function prepareSourceBouncingSeeds(input:unknown,options:SourceBouncingSeedOptions={}):SourceBouncingResult<SourceBouncingPreparedSeeds>{
 if(options.isCancelled?.())return{ok:false,error:{kind:'cancelled',path:[],reason:'源弹跳初始化已取消'}};
 const stream=createSourceBouncingSeedStream(input,options);if(!stream.ok)return stream;
 const owner=stream.value;
 if(owner.count*16>SOURCE_BOUNCING_SEED_LIMITS.bytes)return{ok:false,error:{kind:'capacity',path:['particleCount'],reason:'源弹跳初始状态超过128 MiB预算；不减少粒子数量'}};
 let attempted=false;
 return{ok:true,value:Object.freeze({count:owner.count,update:owner.update,generate():SourceBouncingResult<SourceBouncingGeneratedSeeds>{
  if(attempted)return{ok:false,error:{kind:'input',path:['generate'],reason:'源弹跳种子生成计划只能执行一次；请重新准备计划'}};
  attempted=true;
  if(options.isCancelled?.())return{ok:false,error:{kind:'cancelled',path:[],reason:'源弹跳初始化已取消'}};
  // Packed XY/VX/VY includes every requested particle and center fallback.
  // Texture padding belongs to the GPU owner; this array has no padding.
  const state=new Float32Array(owner.count*4);
  for(let i=0;i<owner.count;i++){
   const next=owner.next();if(!next.ok)return next;if(next.value===null)throw new Error('Source Bouncing seed stream ended before its declared count');
   const {position,velocity:v}=next.value;state[i*4]=position[0];state[i*4+1]=position[1];state[i*4+2]=v[0];state[i*4+3]=v[1];
  }
  return{ok:true,value:{state,update:owner.update,diagnostics:owner.diagnostics()}};
 }})};
}
/** Compatibility entry point: the same admission and one-shot generator owner. */
export function generateSourceBouncingSeeds(input:unknown,options:SourceBouncingSeedOptions={}):SourceBouncingResult<SourceBouncingGeneratedSeeds>{
 const prepared=prepareSourceBouncingSeeds(input,options);return prepared.ok?prepared.value.generate():prepared;
}
