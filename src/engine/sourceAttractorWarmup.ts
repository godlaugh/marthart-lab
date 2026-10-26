import {parseSourceAttractorConfiguration,type SourceAttractorConfiguration} from './sourceAttractorConfig';
import {createSourceAttractorSeedStream} from './sourceAttractorSeeds';
import {prepareSourceAttractorEquation,sourceAttractorEulerStep,type PreparedSourceAttractorEquation,type SourceAttractorEquationSource} from './sourceAttractorEquation';
import {SOURCE_ATTRACTOR_WORK_LIMIT,SourceAttractorWorkError} from './sourceAttractorWork';

/** Local bounded scheduling policy, not a limit claimed for MathArt. A task is
 * admitted in full before workers start; concurrency never discounts its cost. */
export const SOURCE_ATTRACTOR_WARMUP_LIMITS=Object.freeze({maximumSlices:16,maximumWorkers:4,sliceWork:SOURCE_ATTRACTOR_WORK_LIMIT,maximumWork:16*SOURCE_ATTRACTOR_WORK_LIMIT,maximumBytes:256*1024*1024,timeoutMs:60_000});
export class SourceAttractorWarmupError extends Error {
 constructor(readonly code:'input'|'capacity'|'cancelled'|'worker'|'protocol',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourceAttractorWarmupError';}
}
export interface SourceAttractorWarmupSlice {readonly offset:number;readonly count:number;readonly work:number;}
export interface SourceAttractorWarmupPlan {
 readonly configuration:SourceAttractorConfiguration;readonly equation:PreparedSourceAttractorEquation;
 readonly raw:Float32Array;readonly dt:Float32Array;readonly steps:Int32Array;
 readonly work:number;readonly reservedBytes:number;readonly workers:number;readonly slices:readonly SourceAttractorWarmupSlice[];
}
export interface SourceAttractorWarmupMotion {readonly raw:Float32Array;readonly dt:Float32Array;readonly steps:Float64Array;readonly work:number;readonly execution:'serial'|'workers';readonly workers:number;readonly slices:number;readonly reservedBytes:number;}
const ownedPlans=new WeakSet<object>();
export function assertSourceAttractorWarmupPlan(plan:SourceAttractorWarmupPlan):void {if(!ownedPlans.has(plan))throw new SourceAttractorWarmupError('input','预热必须使用拥有者已准入的完整计划');}
function check(cancelled?:()=>boolean){if(cancelled?.())throw new SourceAttractorWarmupError('cancelled','原版吸引子预热已取消');}
export function prepareSourceAttractorWarmup(configuration:SourceAttractorConfiguration,equation:PreparedSourceAttractorEquation,options:{parallel?:boolean;maximumWorkers?:number;isCancelled?:()=>boolean}={}):SourceAttractorWarmupPlan {
 check(options.isCancelled);
 const parsed=parseSourceAttractorConfiguration(configuration);if(!parsed.ok)throw new SourceAttractorWarmupError(parsed.error.kind==='capacity'?'capacity':'input',parsed.error.reason);
 if(parsed.value.nativeBackend!=='cpu')throw new SourceAttractorWarmupError('input','CPU 预热不能代替原版 GPU 积分');
 if(!equation||!Number.isSafeInteger(equation.operations)||equation.operations<1)throw new SourceAttractorWarmupError('input','原版吸引子导数工作量无效');
 const workers=options.maximumWorkers??Math.min(4,Math.max(1,typeof navigator==='undefined'?4:navigator.hardwareConcurrency||1));
 if(!Number.isSafeInteger(workers)||workers<1||workers>SOURCE_ATTRACTOR_WARMUP_LIMITS.maximumWorkers)throw new SourceAttractorWarmupError('capacity','预热最多使用 4 个 worker');
 if(options.parallel&&!equation.source)throw new SourceAttractorWarmupError('input','并行预热需要公式生产者的可序列化输入');
 const stream=createSourceAttractorSeedStream(parsed.value);if(!stream.ok)throw new SourceAttractorWarmupError(stream.error.kind==='capacity'?'capacity':'input',stream.error.reason);
 const count=stream.value.count;
 if(!Number.isSafeInteger(count)||count<0||count>10000)throw new SourceAttractorWarmupError('capacity','原版 CPU 粒子最多 10000 个');
 // Canonical seed storage + result/transfer copies + final motion/display
 // arrays, plus independently compiled lane inputs and expression workspace.
 const sourceBytes=equation.source?new TextEncoder().encode(JSON.stringify(equation.source)).byteLength:0;
 const reservedBytes=count*128+(workers+1)*(sourceBytes*8+equation.operations*64+65536);
 if(!Number.isSafeInteger(reservedBytes)||reservedBytes>SOURCE_ATTRACTOR_WARMUP_LIMITS.maximumBytes)throw new SourceAttractorWarmupError('capacity','预热峰值超过本地 256 MiB 预算');
 const raw=new Float32Array(count*3),dt=new Float32Array(count),steps=new Int32Array(count);
 let work=count*9;const maximum=options.parallel?SOURCE_ATTRACTOR_WARMUP_LIMITS.maximumWork:SOURCE_ATTRACTOR_WORK_LIMIT;
 for(let i=0;i<count;i++){
  check(options.isCancelled);const next=stream.value.next();if(!next.ok||!next.value||next.value.index!==i)throw new SourceAttractorWarmupError('input','原版吸引子种子槽位不连续');
  const seed=next.value,n=Math.max(0,seed.warmupSteps),cost=n*(equation.operations+6);
  if(!Number.isSafeInteger(cost)||cost>SOURCE_ATTRACTOR_WARMUP_LIMITS.sliceWork||work+cost>maximum){if(!options.parallel)throw new SourceAttractorWorkError();throw new SourceAttractorWarmupError('capacity','原版吸引子预热超过本地完整任务或单槽工作预算');}
  raw.set(seed.raw,i*3);dt[i]=seed.dt;steps[i]=n;work+=cost;
 }
 const slices:SourceAttractorWarmupSlice[]=[];
 // Stable contiguous slots, no per-lane RNG. At most sixteen 20M slices;
 // smaller tasks still spread their independent particles across real lanes.
 const target=Math.min(SOURCE_ATTRACTOR_WARMUP_LIMITS.sliceWork,Math.max(1,Math.ceil(work/workers)));
 let offset=0,sliceWork=0;
 for(let i=0;i<count;i++){
  const cost=9+steps[i]*(equation.operations+6);
  if(i>offset&&sliceWork+cost>target){slices.push(Object.freeze({offset,count:i-offset,work:sliceWork}));offset=i;sliceWork=0;}
  sliceWork+=cost;
  if(sliceWork>SOURCE_ATTRACTOR_WARMUP_LIMITS.sliceWork)throw new SourceAttractorWarmupError('capacity','预热单槽超过本地 slice 工作预算');
 }
 if(count)slices.push(Object.freeze({offset,count:count-offset,work:sliceWork}));
 if(slices.length>SOURCE_ATTRACTOR_WARMUP_LIMITS.maximumSlices)throw new SourceAttractorWarmupError('capacity','预热需要超过本地 16 个工作分片');
 for(const value of Object.values(parsed.value))if(value&&typeof value==='object')Object.freeze(value);Object.freeze(parsed.value);
 const plan=Object.freeze({configuration:parsed.value,equation,raw,dt,steps,work,reservedBytes,workers:Math.min(workers,slices.length),slices:Object.freeze(slices)});ownedPlans.add(plan);return plan;
}
export function runSourceAttractorWarmupSerial(plan:SourceAttractorWarmupPlan,isCancelled?:()=>boolean):SourceAttractorWarmupMotion {
 assertSourceAttractorWarmupPlan(plan);const raw=plan.raw.slice(),steps=new Float64Array(plan.dt.length),field=plan.equation.create(),scratch=new Float32Array(3);
 for(let i=0;i<steps.length;i++)for(let step=0;step<plan.steps[i];step++){if((step&255)===0)check(isCancelled);sourceAttractorEulerStep(field,raw,i*3,plan.dt[i],scratch);steps[i]++;}
 check(isCancelled);return{raw,dt:plan.dt.slice(),steps,work:plan.work,execution:'serial',workers:0,slices:plan.slices.length,reservedBytes:plan.reservedBytes};
}
export interface SourceAttractorWarmupRequest {readonly kind:'warmup';readonly job:number;readonly slice:number;readonly offset:number;readonly source:SourceAttractorEquationSource;readonly operations:number;readonly raw:Float32Array;readonly dt:Float32Array;readonly steps:Int32Array;}
export interface SourceAttractorWarmupResponse {readonly kind:'complete';readonly job:number;readonly slice:number;readonly offset:number;readonly raw:Float32Array;readonly steps:Int32Array;readonly work:number;}
/** The same Euler kernel as serial/update; one invocation owns its compiled
 * equation variables and scratch. NaN/Inf bits are numeric output, not errors. */
export function executeSourceAttractorWarmup(request:SourceAttractorWarmupRequest):SourceAttractorWarmupResponse {
 if(!request||request.kind!=='warmup'||![request.job,request.slice,request.offset].every(n=>Number.isSafeInteger(n)&&n>=0)||request.job<1)throw new SourceAttractorWarmupError('protocol','预热请求身份无效');
 const {raw,dt,steps}=request,count=dt?.length;
 for(const array of [raw,dt,steps])if(!ArrayBuffer.isView(array)||!(array.buffer instanceof ArrayBuffer)||array.byteOffset!==0||array.byteLength!==array.buffer.byteLength)throw new SourceAttractorWarmupError('protocol','预热需要完整独占数组');
 if(!(raw instanceof Float32Array)||!(dt instanceof Float32Array)||!(steps instanceof Int32Array)||count<1||count>10000||raw.length!==count*3||steps.length!==count)throw new SourceAttractorWarmupError('protocol','预热数组尺寸无效');
 const prepared=prepareSourceAttractorEquation(request.source);if(!prepared.ok)throw new SourceAttractorWarmupError(prepared.error.kind,prepared.error.reason);
 if(prepared.value.operations!==request.operations)throw new SourceAttractorWarmupError('protocol','预热公式工作量不匹配');
 let work=count*9;for(let i=0;i<count;i++){if(steps[i]<0)throw new SourceAttractorWarmupError('protocol','预热步数无效');work+=steps[i]*(request.operations+6);}
 if(!Number.isSafeInteger(work)||work>SOURCE_ATTRACTOR_WARMUP_LIMITS.sliceWork)throw new SourceAttractorWarmupError('capacity','预热分片超过本地工作预算');
 const field=prepared.value.create(),scratch=new Float32Array(3),actual=new Int32Array(count);
 for(let i=0;i<count;i++)for(let n=0;n<steps[i];n++){sourceAttractorEulerStep(field,raw,i*3,dt[i],scratch);actual[i]++;}
 return{kind:'complete',job:request.job,slice:request.slice,offset:request.offset,raw,steps:actual,work};
}
