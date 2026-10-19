import {parseSourceAttractorConfiguration,type SourceAttractorConfiguration} from './sourceAttractorConfig';
import {createSourceAttractorSeedStream} from './sourceAttractorSeeds';
import {sourceAttractorEulerStep,type PreparedSourceAttractorEquation} from './sourceAttractorEquation';
import {attractorParticleId} from './particleCamera';
import type {OrdinaryCameraParticleFrame,OrdinaryCameraTargetBinding,OrdinaryCameraTargetRequest,OrdinarySourceCameraParticles} from './ordinarySourceCameraTimeline';

export class SourceAttractorCpuError extends Error {
 constructor(readonly code:'input'|'capacity'|'cancelled',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourceAttractorCpuError';}
}
export interface SourceAttractorCpuOptions {
 readonly configuration:SourceAttractorConfiguration;
 readonly equation:PreparedSourceAttractorEquation;
 readonly isCancelled?:()=>boolean;
 /** Shared request owner may charge additional consumers to the same budget. */
 readonly reserve?:(units:number)=>void;
}
export interface SourceAttractorCpuSnapshot {
 readonly model:'attractor-cpu-motion-1.7.8';
 readonly frameIndex:number;
 readonly rawPositions:Float32Array;
 readonly positions:Float32Array;
 readonly timeSteps:Float32Array;
 /** Counts remain per slot; nonfinite slots are never removed or reseeded. */
 readonly integrationSteps:Float64Array;
 readonly workUnits:number;
}
const F=Math.fround,MAX_WORK=20_000_000;
/** Motion owner for source CPU particles: displayed geometry and bound camera
 * targets must read this same state. Rendering/color/trails and public document
 * integration are separate work; this is not a complete Mobject renderer. */
export class SourceAttractorCpuParticles implements OrdinarySourceCameraParticles {
 readonly configuration:SourceAttractorConfiguration;
 private readonly raw:Float32Array;private readonly positions:Float32Array;private readonly dt:Float32Array;private readonly steps:Float64Array;
 private readonly count:number;private readonly field;private readonly scratch=new Float32Array(3);
 private readonly operations:number;private readonly options:SourceAttractorCpuOptions;
 private readonly scales:number[];private readonly offsets:number[];
 private frameIndex=-1;private used=0;private failed=false;private failure:unknown;
 constructor(options:SourceAttractorCpuOptions){
  this.options={...options};
  const parsed=parseSourceAttractorConfiguration(options.configuration);
  if(!parsed.ok)throw new SourceAttractorCpuError(parsed.error.kind==='capacity'?'capacity':'input',parsed.error.reason);
  this.configuration=parsed.value;
  for(const value of Object.values(this.configuration))if(value&&typeof value==='object')Object.freeze(value);
  Object.freeze(this.configuration);
  if(this.configuration.nativeBackend!=='cpu')throw new SourceAttractorCpuError('input','CPU 粒子生产者不能代替原版 GPU 积分');
  if(!options.equation||!Number.isSafeInteger(options.equation.operations)||options.equation.operations<1)throw new SourceAttractorCpuError('input','原版吸引子导数工作量无效');
  this.operations=options.equation.operations;this.field=options.equation.create();
  const stream=createSourceAttractorSeedStream(this.configuration);
  if(!stream.ok)throw new SourceAttractorCpuError(stream.error.kind==='capacity'?'capacity':'input',stream.error.reason);
  this.count=stream.value.count;
  // Source clamps CPU count at its configuration boundary; the owner still
  // admits only a bounded allocation before creating any particle buffer.
  if(!Number.isInteger(this.count)||this.count<0||this.count>10000)throw new SourceAttractorCpuError('capacity','原版 CPU 粒子最多 10000 个');
  this.reserve(this.count*9);this.raw=new Float32Array(this.count*3);this.positions=new Float32Array(this.count*3);this.dt=new Float32Array(this.count);this.steps=new Float64Array(this.count);
  const t=this.configuration.transform;this.scales=[t.scaleX,t.scaleY,t.scaleZ].map(F);this.offsets=[t.offsetX,t.offsetY,t.offsetZ].map(F);
  for(let i=0;i<this.count;i++){
   this.check();const next=stream.value.next();
   if(!next.ok)throw new SourceAttractorCpuError(next.error.kind==='capacity'?'capacity':'input',next.error.reason);
   const seed=next.value;if(!seed||seed.index!==i)throw new SourceAttractorCpuError('input','原版吸引子种子槽位不连续');
   this.raw.set(seed.raw,i*3);this.dt[i]=seed.dt;
   this.reserve(Math.max(0,seed.warmupSteps)*(this.operations+6));
   for(let step=0;step<seed.warmupSteps;step++){if((step&255)===0)this.check();this.integrate(i);}
   this.transform(i);
  }
 }
 private check(){if(this.failed)throw this.failure;if(this.options.isCancelled?.())throw new SourceAttractorCpuError('cancelled','原版吸引子回放已取消');}
 private reserve(n:number){this.check();if(!Number.isSafeInteger(n)||n<0||this.used+n>MAX_WORK)throw new SourceAttractorCpuError('capacity','原版吸引子超过本地 2000 万工作单位预算');this.used+=n;this.options.reserve?.(n);}
 private guarded<T>(run:()=>T):T{try{this.check();return run();}catch(error){this.failed=true;this.failure=error;throw error;}}
 private integrate(index:number){sourceAttractorEulerStep(this.field,this.raw,index*3,this.dt[index],this.scratch);this.steps[index]++;}
 private transform(index:number){for(let axis=0;axis<3;axis++){const at=index*3+axis;this.positions[at]=F(F(this.raw[at]*this.scales[axis])+this.offsets[axis]);}}
 bind(request:OrdinaryCameraTargetRequest):OrdinaryCameraTargetBinding{return this.guarded(()=>{
  if(this.frameIndex!==-1)throw new SourceAttractorCpuError('input','原版吸引子跟踪必须在播放前绑定');
  const index=request.action.args?.index;
  if(typeof index!=='number'||!Number.isFinite(index))throw new SourceAttractorCpuError('input','原版吸引子跟踪索引需要有限数值');
  const id=this.count===0?undefined:attractorParticleId(index,this.count);
  if(id===undefined)return{kind:'ignored',reason:'原版吸引子跟踪索引超出槽位范围；保留此前有效目标'};
  // Capturing the array and offset models PVector identity without allocating
  // per-particle JS objects. Snapshot copies cannot replace this storage.
  const positions=this.positions,at=id*3;
  return{kind:'bound',readPosition:()=>this.guarded(()=>[positions[at],positions[at+1],positions[at+2]] as [number,number,number])};
 });}
 update(frame:OrdinaryCameraParticleFrame):void{this.guarded(()=>{
  if(!Number.isSafeInteger(frame.frameIndex)||frame.frameIndex!==this.frameIndex+1||!Number.isFinite(F(frame.time))||frame.time<0||!Number.isFinite(F(frame.deltaTime))||frame.deltaTime<0)throw new SourceAttractorCpuError('input','原版吸引子帧顺序或时刻无效');
  const substeps=this.configuration.stepsPerFrame;
  this.reserve(Math.max(0,substeps)*this.count*(this.operations+12));
  // StrangeAttractor.update ignores elapsed dt for integration, even dt=0.
  // The Scene clock decides whether this active-frame callback occurs at all.
  // An empty source array has no motion to advance. Avoid an uncharged outer
  // loop when a preserved int32 substep count is large and count is zero.
  if(this.count>0)for(let step=0;step<substeps;step++)for(let i=0;i<this.count;i++){if((i&255)===0)this.check();this.integrate(i);this.transform(i);}
  this.frameIndex=frame.frameIndex;
 });}
 snapshot():SourceAttractorCpuSnapshot{return this.guarded(()=>{
  this.reserve(this.count*9);
  return{model:'attractor-cpu-motion-1.7.8',frameIndex:this.frameIndex,rawPositions:this.raw.slice(),positions:this.positions.slice(),timeSteps:this.dt.slice(),integrationSteps:this.steps.slice(),workUnits:this.used};
 });}
}
