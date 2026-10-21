import {sourceAttractorWorkBudget} from './sourceAttractorWork';
import {SourceParticleTrailHistory,SOURCE_PARTICLE_TRAIL_MAX_RECORDS,type SourceParticleTrails} from './sourceParticleTrails';
import {parseSourceAttractorVisualConfiguration,type SourceAttractorVisualConfiguration} from './sourceAttractorVisualConfig';
import {SourceAttractorColorRuntime} from './sourceAttractorColorRuntime';
import type {SourceGradientAction} from './sourceGradientRuntime';
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
 /** Explicit opt-in to source display state; numerical-only callers retain their cost. */
 readonly visualConfiguration?:SourceAttractorVisualConfiguration;
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
 readonly visualConfiguration?:SourceAttractorVisualConfiguration;
 readonly colors?:Float32Array;readonly pointAlphas?:Float32Array;readonly packedColors?:Uint32Array;
 readonly particleIds?:Uint32Array;readonly trails?:SourceParticleTrails;readonly diagnostics?:string[];
}
const F=Math.fround;
/** Motion owner for source CPU particles: displayed geometry and bound camera
 * targets read the same state. Optional source display owns live colors and
 * every substep trail; public document integration remains separate work. */
export class SourceAttractorCpuParticles implements OrdinarySourceCameraParticles {
 readonly configuration:SourceAttractorConfiguration;
 readonly visualConfiguration?:SourceAttractorVisualConfiguration;
 private readonly color?:SourceAttractorColorRuntime;private readonly history?:SourceParticleTrailHistory;
 private readonly raw:Float32Array;private readonly positions:Float32Array;private readonly dt:Float32Array;private readonly steps:Float64Array;
 private readonly count:number;private readonly field;private readonly scratch=new Float32Array(3);
 private readonly operations:number;private readonly options:SourceAttractorCpuOptions;
 private readonly scales:number[];private readonly offsets:number[];
 private operationBudget=sourceAttractorWorkBudget();private operationDepth=0;
 private frameIndex=-1;private used=0;private failed=false;private failure:unknown;
 constructor(options:SourceAttractorCpuOptions){
  this.options={...options};
  if(options.visualConfiguration!==undefined){
   const visual=parseSourceAttractorVisualConfiguration(options.visualConfiguration);
   if(!visual.ok)throw new SourceAttractorCpuError(visual.error.kind==='capacity'?'capacity':'input',visual.error.reason);
   this.visualConfiguration=visual.value;
   if(visual.value.palette.kind==='colors')Object.freeze(visual.value.palette.colors);
   Object.freeze(visual.value.palette);Object.freeze(visual.value.points);Object.freeze(visual.value.trails);Object.freeze(visual.value);
  }
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
  if(this.visualConfiguration){
   const v=this.visualConfiguration;
   this.color=new SourceAttractorColorRuntime({count:this.count,nativeBackend:'cpu',showTrails:v.trails.show,palette:v.palette,reserve:n=>this.reserve(n),isCancelled:this.options.isCancelled});
   // No warmup records. Native Dot3D capacity is fixed at construction even
   // when recording is disabled; pooled storage stays lazy until first add.
   this.history=new SourceParticleTrailHistory(this.count,F(v.trails.lifetime),v.trails.fade,this.color.packed,()=>this.check(),()=>{throw new SourceAttractorCpuError('capacity','原版吸引子拖尾超过本地 32 MiB 记录池预算');},SOURCE_PARTICLE_TRAIL_MAX_RECORDS);
  }
 }
 private check(){if(this.failed)throw this.failure;if(this.options.isCancelled?.())throw new SourceAttractorCpuError('cancelled','原版吸引子回放已取消');}
 private reserve(n:number){this.check();this.operationBudget(n);this.options.reserve?.(n);this.used+=n;}
 private guarded<T>(run:()=>T):T{if(this.operationDepth++===0)this.operationBudget=sourceAttractorWorkBudget();try{this.check();return run();}catch(error){this.failed=true;this.failure=error;throw error;}finally{this.operationDepth--;}}
 private integrate(index:number){sourceAttractorEulerStep(this.field,this.raw,index*3,this.dt[index],this.scratch);this.steps[index]++;}
 private transform(index:number){for(let axis=0;axis<3;axis++){const at=index*3+axis;this.positions[at]=F(F(this.raw[at]*this.scales[axis])+this.offsets[axis]);}}
 diagnostics(){return{frameIndex:this.frameIndex,workUnits:this.used,retainedBytes:this.raw.byteLength+this.positions.byteLength+this.dt.byteLength+this.steps.byteLength+this.scratch.byteLength+(this.color?.retainedBytes??0)+(this.history?.retainedBytes??0)};}
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
 beginGradientActions(actions:readonly SourceGradientAction[]):void{this.guarded(()=>{
  if(!this.color){if(Array.isArray(actions)&&actions.length===0)return;throw new SourceAttractorCpuError('input','原版吸引子渐变需要视觉配置');}this.color.beginGradientActions(actions);
 });}
 interpolateGradientActions(eased:number,finished:boolean):void{this.guarded(()=>{
  this.color?.interpolateGradientActions(eased,finished);
 });}
 update(frame:OrdinaryCameraParticleFrame):void{this.guarded(()=>{
  if(!Number.isSafeInteger(frame.frameIndex)||frame.frameIndex!==this.frameIndex+1||!Number.isFinite(F(frame.time))||frame.time<0||!Number.isFinite(F(frame.deltaTime))||frame.deltaTime<0)throw new SourceAttractorCpuError('input','原版吸引子帧顺序或时刻无效');
  const substeps=this.configuration.stepsPerFrame,time=F(frame.time);
  this.color?.update(F(frame.deltaTime));
  this.reserve(Math.max(0,substeps)*this.count*(this.operations+12+(this.visualConfiguration?.trails.show?8:0)));
  // StrangeAttractor.update ignores elapsed dt for integration, even dt=0.
  // The Scene clock decides whether this active-frame callback occurs at all.
  // An empty source array has no motion to advance. Avoid an uncharged outer
  // loop when a preserved int32 substep count is large and count is zero.
  if(this.count>0)for(let step=0;step<substeps;step++)for(let i=0;i<this.count;i++){if((i&255)===0)this.check();this.integrate(i);this.transform(i);
   if(this.history&&this.visualConfiguration!.trails.show){const at=i*3;this.history.add(i,this.positions[at],this.positions[at+1],this.positions[at+2],time);}
  }
  if(this.history){this.reserve(this.count);for(let i=0;i<this.count;i++){if((i&255)===0)this.check();this.history.expire(i,time);}}
  this.frameIndex=frame.frameIndex;
 });}
 snapshot():SourceAttractorCpuSnapshot{return this.guarded(()=>{
  this.reserve(this.count*9);
  if(this.color)this.reserve(this.count*8+(this.history?.recordCount??0)*12);
  const visual=this.color?{visualConfiguration:this.visualConfiguration!,colors:this.color.colors.slice(),pointAlphas:this.color.alphas.slice(),packedColors:this.color.packed.slice(),particleIds:Uint32Array.from({length:this.count},(_,i)=>i),trails:this.history!.snapshot(),diagnostics:[...this.color.diagnostics]}:{};
  return{...visual,model:'attractor-cpu-motion-1.7.8',frameIndex:this.frameIndex,rawPositions:this.raw.slice(),positions:this.positions.slice(),timeSteps:this.dt.slice(),integrationSteps:this.steps.slice(),workUnits:this.used};
 });}
}
