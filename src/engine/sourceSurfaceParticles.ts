import {SourceSurfaceParameterRuntime,type SourceSurfaceParameterAction,type SourceSurfaceParameterConfiguration} from './sourceSurfaceParameterRuntime';
import {SourceGradientRuntime,type SourceGradientAction} from './sourceGradientRuntime';
import {INITIAL_SOURCE_SURFACE_PALETTE_STATE,sourceSurfacePaletteTarget,smoothSourceSurfacePalette,type SourceSurfacePaletteState} from './sourceSurfaceGradient';
import {createSourceSurfaceTrailGradient} from './sourceSurfaceTrailGradient';
import {parseSourceSurfacePalette,prepareSourceSurfaceColors,refreshSourceSurfaceColors,type SourceSurfacePalette,type PreparedSourceSurfaceColors} from './sourceSurfaceColor';
import type {SceneDocument} from '../types';
import {parseDomainSourceFloat} from './domainSourceScalar';
import {prepareSourceSurfaceFunction,type PreparedSourceSurfaceFunction,type SourceSurfaceFunction} from './sourceSurfaceFunction';
import type {OrdinarySourceCameraParticles,OrdinaryCameraTargetRequest,OrdinaryCameraParticleFrame,OrdinaryCameraTargetBinding} from './ordinarySourceCameraTimeline';
import {evaluateOrdinarySourceCameraTimeline} from './ordinarySourceCameraTimeline';
import {ordinarySourceCameraInitial} from './ordinarySourceCamera';
import {usesSourceSurfaceParticles,SOURCE_SURFACE_CLIP_TYPES,SOURCE_SURFACE_ACTION_METHODS} from './sourceSurfaceIdentity';

/** Explicit version: existing local and ordinary-camera documents retain their
 * previous surface sampler until they opt into the source particle geometry. */
export function replaySourceSurface(scene:SceneDocument,time:number,coverage:'all'|'tracked',isCancelled?:()=>boolean){
 const initial=ordinarySourceCameraInitial(scene);if(!initial)throw new Error('原版曲面粒子需要对应的原版相机');
 const prepared=prepareSourceSurfaceParticles(scene);let particles:SourceSurfaceParticles|undefined;
 const frame=evaluateOrdinarySourceCameraTimeline(initial,scene.timeline.tracks,scene.timeline.fps,time,{isCancelled,particleActions:'surface',createParticles:()=>particles=prepared.create(coverage,isCancelled)});
 return{frame,particles:particles!};
}
const F=Math.fround,MAX_PARTICLES=512*512,MAX_WORK=20_000_000;
export class SourceSurfaceParticleError extends Error {
 constructor(readonly code:'input'|'unsupported'|'capacity'|'arithmetic'|'cancelled',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourceSurfaceParticleError';}
}
interface Axis {min:number;max:number;count:number;speed:number;periodic:boolean;flowing:boolean;}
export interface PreparedSourceSurfaceParticles {
 readonly count:number;readonly operationsPerPosition:number;
 create(coverage:'all'|'tracked',isCancelled?:()=>boolean):SourceSurfaceParticles;
}
function fail(code:SourceSurfaceParticleError['code'],message:string):never{throw new SourceSurfaceParticleError(code,message);}
function scalar(raw:unknown,label:string):number {
 if(typeof raw==='string'){const parsed=parseDomainSourceFloat(raw);if(parsed.ok)raw=parsed.value;}
 return typeof raw==='number'&&Number.isFinite(F(raw))?F(raw):fail('input',`原版曲面 ${label} 需要有限 Float32 数值`);
}
/** Canonical authored scalars are produced once at import/edit. No reparsing of
 * original JSON or sampling through the unrelated local mathjs geometry path. */
export function prepareSourceSurfaceParticles(scene:SceneDocument):PreparedSourceSurfaceParticles {
 if(!usesSourceSurfaceParticles(scene))fail('input','缺少原版曲面粒子版本');
 if(!Number.isFinite(scene.timeline.fps)||scene.timeline.fps<1||scene.timeline.fps>120)fail('input','原版曲面帧率必须在 1–120');
 const s=scene.settings;
 if(s.renderMode!=='points'||s.computeBackend!=='cpu')fail('unsupported','原版曲面粒子当前只接入 CPU 点模式；GPU 与网格仍待接入');
 for(const key of ['showTrails','recordTrails','fadeTrails'])if(typeof s[key]!=='boolean')fail('input',`原版曲面 ${key} 缺少布尔值`);
 if(scalar(s.trailWidth,'trailWidth')<0)fail('input','原版曲面拖尾线宽的本地呈现要求非负值');
 if(s.fadePoints!==undefined&&typeof s.fadePoints!=='boolean')fail('input','原版曲面 fadePoints 需要布尔值');
 const palette=scene.surfaceSourcePalette===undefined?undefined:parseSourceSurfacePalette(scene.surfaceSourcePalette);
 const fadePoints=s.fadePoints!==false;
 const trails={show:s.showTrails===true,record:s.recordTrails!==false,fade:s.fadeTrails===true,lifetime:scalar(s.trailLifetime,'trailLifetime')};
 if(s.scale!==1||['rotateX','rotateY','rotateZ'].some(key=>Number(s[key]??0)!==0))fail('unsupported','原版曲面粒子使用分轴 scale 与 offset，不执行本地整体缩放或物体旋转');
 for(const track of scene.timeline.tracks){
  if(!track.enabled)continue;
  if(!SOURCE_SURFACE_CLIP_TYPES.includes(track.type??'')||track.actions?.some(a=>!SOURCE_SURFACE_ACTION_METHODS.includes(a.method)))fail('unsupported','原版曲面粒子的模式动画尚未接入，不能按本地时钟替代');
 }
 const axis=(name:'U'|'V'):Axis=>{
  const prefix=name.toLowerCase(),count=s[prefix+'Segments'];
  if(typeof count!=='number'||!Number.isInteger(count)||count<1||count>512)fail('capacity','原版曲面每轴粒子数须为 1–512；不会截断请求网格');
  for(const key of ['periodic'+name,'flowing'+name])if(typeof s[key]!=='boolean')fail('input',`原版曲面 ${key} 缺少布尔值`);
  return{min:scalar(s[prefix+'Min'],prefix+'Min'),max:scalar(s[prefix+'Max'],prefix+'Max'),count:count as number,speed:scalar(s['speed'+name],'speed'+name),periodic:s['periodic'+name] as boolean,flowing:s['flowing'+name] as boolean};
 };
 const u=axis('U'),v=axis('V'),count=u.count*v.count;
 if(count>MAX_PARTICLES)fail('capacity','原版曲面粒子超过本地网格容量');
 const scales=['X','Y','Z'].map(a=>scalar(s['scale'+a],'scale'+a)),offsets=['X','Y','Z'].map(a=>scalar(s['offset'+a],'offset'+a));
 const surfaceFunction=prepareSourceSurfaceFunction({equations:scene.equations,parameters:scene.parameters,scales,offsets});
 const operations=surfaceFunction.operations;
 return{count,operationsPerPosition:operations,create:(coverage,isCancelled)=>new SourceSurfaceParticles({u,v,count,surfaceFunction,frameRate:F(scene.timeline.fps),operations,trails,palette,fadePoints},coverage,isCancelled)};
}
interface Configuration {surfaceFunction:PreparedSourceSurfaceFunction;frameRate:number;palette?:SourceSurfacePalette;fadePoints:boolean;u:Axis;v:Axis;count:number;operations:number;trails:{show:boolean;record:boolean;fade:boolean;lifetime:number};}
function wrap(value:number,axis:Axis):number {
 const range=F(axis.max-axis.min);if(range<=0)return axis.min;
 let rest=F(F(value-axis.min)%range);if(rest<0)rest=F(rest+range);return F(axis.min+rest);
}
function edgeFade(factor:number,axis:Axis,value:number):number {
 if(!axis.flowing||!axis.periodic)return factor;
 const width=F(F(axis.max-axis.min)*F(.1)),lower=F(value-axis.min),upper=F(axis.max-value);
 if(lower<width)return F(factor*F(lower/width));
 if(upper<width)return F(factor*F(upper/width));
 return factor;
}
/** CPU ParametricSurface state. The same position buffer feeds geometry and
 * bound tracking targets. Sparse coverage is for UI camera queries only; it
 * executes the identical particle recurrence, never a second analytic sampler.
 * All buffers are owned by this replay and snapshots are copied before transfer. */
export class SourceSurfaceParticles implements OrdinarySourceCameraParticles {
 private readonly gradient:SourceGradientRuntime;
 private readonly parameters:SourceSurfaceParameterRuntime;
 private readonly ignoredParameterNames=new Set<string>();
 private paletteState:SourceSurfacePaletteState=INITIAL_SOURCE_SURFACE_PALETTE_STATE;
 private animationTime=0;
 private readonly color?:PreparedSourceSurfaceColors;
 private readonly pointAlphas?:Float32Array;
 private readonly state:Float32Array;
 private readonly positions:Float32Array;
 private readonly ids:number[]=[];
 private readonly slots=new Map<number,number>();
 private readonly surfaceFunction:SourceSurfaceFunction;
 private history?:SurfaceTrailHistory;
 private readonly boundaryPoint=new Float32Array(3);
 private recording:boolean;
 private used=0;
 private failure:unknown;
 private failed=false;
 private lastFrame=-1;
 constructor(private readonly config:Configuration,private readonly coverage:'all'|'tracked',private readonly isCancelled?:()=>boolean){
  const capacity=coverage==='all'?config.count:Math.min(config.count,4096);
  this.state=new Float32Array(capacity*4);this.positions=new Float32Array(capacity*3);this.surfaceFunction=config.surfaceFunction.create();
  this.recording=config.trails.record;
  // Camera-only queries never allocate full-grid color buffers.
  if(coverage==='all'){this.color=prepareSourceSurfaceColors(config.palette,config.u.count,config.v.count,config.u.periodic);this.pointAlphas=new Float32Array(capacity);}
  if(coverage==='all'&&config.trails.show&&config.trails.record)this.history=new SurfaceTrailHistory(config.count,config.trails.lifetime,config.trails.fade,this.color!.packed,()=>this.check());
  this.gradient=new SourceGradientRuntime(()=>this.paletteState.primary,(frame,gradient)=>{
   this.reserveWork(64);const next=smoothSourceSurfacePalette(this.paletteState,sourceSurfacePaletteTarget(frame,gradient.mode));
   if(!next.changed)return;
   this.paletteState=next.state;
   if(this.color){
    this.reserveWork(config.count*4+config.u.count*128);
    refreshSourceSurfaceColors(this.color,config.u.count,config.v.count,this.paletteState,gradient.mode,gradient.interpolation,true,()=>this.check());
    // Native refresh replaces baseCol AND col. The later particle update
    // reapplies boundary fade; zero-dt animation callbacks still reset alpha.
    for(let id=0;id<config.count;id++){if((id&1023)===0)this.check();this.pointAlphas![id]=(this.color.packed[id]>>>24)/255;}
   }
  });
  this.parameters=new SourceSurfaceParameterRuntime({
   read:name=>this.surfaceFunction.read(name),
   write:(name,value)=>{if(!this.surfaceFunction.write(name,value))this.ignoredParameterNames.add(name);},
   reserve:units=>this.reserveWork(units),
  });
  if(coverage==='all')for(let id=0;id<config.count;id++)this.ensure(id);
 }
 private check(){if(this.failed)throw this.failure;if(this.isCancelled?.())fail('cancelled','原版曲面粒子回放已取消');}
 private guarded<T>(operation:()=>T):T {
  try{this.check();return operation();}catch(error){this.failed=true;this.failure=error;throw error;}
 }
 private reserve(count=1){this.reserveWork(count*(this.config.operations+24));}
 private reserveWork(units:number){this.check();this.used+=units;if(this.used>MAX_WORK)fail('capacity','原版曲面粒子回放超过本地 2000 万工作单位预算');}
 /** Shared expression/transform owner for heads and seam endpoints. Boundary
  * nonfinite results become source break records; invalid heads still reject. */
 private position(u:number,v:number,out:Float32Array,offset:number):boolean {
  return this.surfaceFunction.position(u,v,out,offset);
 }
 private calculate(slot:number){
  if(!this.position(this.state[slot*4],this.state[slot*4+1],this.positions,slot*3))fail('arithmetic',`原版曲面粒子 ${this.ids[slot]} 产生非有限坐标；没有替换成邻点或原点`);
 }
 private boundary(slot:number,u:number,v:number,time:number,invalidBreak:boolean){
  this.reserve();const p=this.boundaryPoint;
  if(this.position(u,v,p,0))this.history!.add(slot,p[0],p[1],p[2],time);
  else if(invalidBreak)this.history!.add(slot,NaN,NaN,NaN,time);
 }
 private ensure(id:number):number {
  const existing=this.slots.get(id);if(existing!==undefined)return existing;
  const slot=this.ids.length;if((slot+1)*4>this.state.length)fail('capacity','原版曲面跟踪超过独立目标容量');
  this.reserve();const {u,v}=this.config,at=slot*4,i=Math.floor(id/v.count),j=id%v.count;
  this.ids.push(id);this.slots.set(id,slot);
  this.state[at]=F(u.min+F(F(i)*F(F(u.max-u.min)/F(u.count))));
  this.state[at+1]=F(v.min+F(F(j)*F(F(v.max-v.min)/F(v.count))));
  this.state[at+2]=u.speed;this.state[at+3]=v.speed;this.calculate(slot);if(this.pointAlphas)this.pointAlphas[slot]=(this.color!.packed[id]>>>24)/255;return slot;
 }
 bind(request:OrdinaryCameraTargetRequest):OrdinaryCameraTargetBinding {return this.guarded(()=>{
  if(this.lastFrame>=0)fail('input','原版曲面目标必须在第一帧前绑定');
  const raw=request.action.args?.index;
  if(typeof raw!=='number'||!Number.isFinite(raw))fail('input','原版曲面跟踪索引必须有限');
  // JVM f2i then setTrackedDot clamp, not local row-major or survivor index.
  const id=Math.max(0,Math.min(this.config.count-1,Math.trunc(F(raw)))),slot=this.ensure(id),positions=this.positions;
  return{kind:'bound',readPosition:()=>this.guarded(()=>[positions[slot*3],positions[slot*3+1],positions[slot*3+2]])};
 });}
 setRecordingTrails(enabled:boolean):void {this.guarded(()=>{
  if(typeof enabled!=='boolean')fail('input','原版拖尾录制开关必须是布尔值');
  if(enabled&&!this.history&&this.coverage==='all'&&this.config.trails.show)this.history=new SurfaceTrailHistory(this.config.count,this.config.trails.lifetime,this.config.trails.fade,this.color!.packed,()=>this.check());
  this.recording=enabled;
 });}
 beginGradientActions(actions:readonly SourceGradientAction[]):void {this.guarded(()=>this.gradient.begin(actions));}
 interpolateGradientActions(eased:number,finished:boolean):void {this.guarded(()=>this.gradient.interpolate(eased,finished));}
 beginParameterActions(actions:readonly SourceSurfaceParameterAction[]):void {this.guarded(()=>this.parameters.begin(actions));}
 interpolateParameterActions(eased:number,finished:boolean):void {this.guarded(()=>this.parameters.interpolate(eased,finished));}
 beginParameterClip(parameters:readonly ({name:string}&SourceSurfaceParameterConfiguration)[]):void {this.guarded(()=>this.parameters.replace(parameters));}
 finishParameterClip():void {this.guarded(()=>this.parameters.stop());}
 update(frame:OrdinaryCameraParticleFrame):void {this.guarded(()=>{
  this.check();if(!Number.isInteger(frame.frameIndex)||frame.frameIndex!==this.lastFrame+1||!Number.isFinite(frame.time)||frame.time<0||!Number.isFinite(frame.deltaTime)||frame.deltaTime<0)fail('input','原版曲面粒子帧顺序或时间无效');
  this.lastFrame=frame.frameIndex;const dt=F(frame.deltaTime);if(dt<=0)return;
  this.animationTime=F(frame.time);this.parameters.update(dt,this.config.frameRate);this.gradient.update(dt);
  this.reserve(this.ids.length);
  const u=this.config.u,v=this.config.v,time=F(frame.time);
  for(let slot=0;slot<this.ids.length;slot++){
   if((slot&255)===0)this.check();const at=slot*4;
   const oldU=u.periodic&&u.flowing?wrap(this.state[at],u):this.state[at],oldV=v.periodic&&v.flowing?wrap(this.state[at+1],v):this.state[at+1];
   let nextU=F(oldU+F(dt*this.state[at+2])),nextV=F(oldV+F(dt*this.state[at+3]));
   // Source detects STRICT crossings before the final wrap. Landing exactly
   // on max wraps to min without creating seam records; do not repair this.
   const crossU=u.periodic&&u.flowing?(nextU>u.max?1:nextU<u.min?-1:0):0,crossV=v.periodic&&v.flowing?(nextV>v.max?1:nextV<v.min?-1:0):0;
   if(u.periodic&&!u.flowing&&(nextU<u.min||nextU>u.max)){this.state[at+2]=-this.state[at+2];nextU=nextU<u.min?u.min:u.max;}
   if(v.periodic&&!v.flowing&&(nextV<v.min||nextV>v.max)){this.state[at+3]=-this.state[at+3];nextV=nextV<v.min?v.min:v.max;}
   if(this.history&&this.recording&&(crossU||crossV)){
    const fraction=(old:number,next:number,axis:Axis,direction:number)=>Math.max(0,Math.min(1,F(F((direction>0?axis.max:axis.min)-old)/F(next-old))));
    const crossing=Math.min(crossU?fraction(oldU,nextU,u,crossU):1,crossV?fraction(oldV,nextV,v,crossV):1);
    const edgeU=F(oldU+F(F(nextU-oldU)*crossing)),edgeV=F(oldV+F(F(nextV-oldV)*crossing));
    this.boundary(slot,edgeU,edgeV,time,true);
    this.history.add(slot,NaN,NaN,NaN,time);
    // Both crossing axes reset, even if their first crossings had different
    // fractions. One boundary pair per frame also preserves multi-wrap behavior.
    this.boundary(slot,crossU?(crossU>0?u.min:u.max):edgeU,crossV?(crossV>0?v.min:v.max):edgeV,time,false);
   }
   this.state[at]=u.periodic&&u.flowing?wrap(nextU,u):nextU;this.state[at+1]=v.periodic&&v.flowing?wrap(nextV,v):nextV;
   this.calculate(slot);
   if(this.pointAlphas){
    // updateCPUDots PCs623–791/1168–1255: multiply U then V edge fades,
    // truncate the packed alpha once. Initial/dt=0 state keeps base alpha.
    let factor=1;
    if(this.config.fadePoints){factor=edgeFade(factor,u,this.state[at]);factor=edgeFade(factor,v,this.state[at+1]);}
    this.pointAlphas[slot]=(Math.trunc(F((this.color!.packed[this.ids[slot]]>>>24)*factor))&255)/255;
   }
   if(this.history){const to=slot*3;if(this.recording)this.history.add(slot,this.positions[to],this.positions[to+1],this.positions[to+2],time);this.history.expire(slot,time);}
  }
 });}
 snapshot():{positions:Float32Array;particleIds:Uint32Array;colors:Float32Array;pointAlphas:Float32Array;diagnostics:string[];workUnits:number;trails?:SourceSurfaceTrails} {return this.guarded(()=>{
  if(this.coverage!=='all')fail('input','稀疏相机查询不能伪装成完整曲面输出');
  const dynamic=this.history&&this.gradient.running?createSourceSurfaceTrailGradient({palette:this.color!.palette,runtime:this.gradient,time:this.animationTime,numU:this.config.u.count,numV:this.config.v.count,reserve:units=>this.reserveWork(units)}):undefined;
  const trails=this.history?.snapshot(dynamic);
  return{positions:this.positions.slice(),colors:this.color!.colors.slice(),pointAlphas:this.pointAlphas!.slice(),diagnostics:[...this.color!.diagnostics,...(this.ignoredParameterNames.size?[`原版曲面忽略 ${this.ignoredParameterNames.size} 个未声明参数的写入；参数名已保留在时间线。`]:[])],particleIds:Uint32Array.from(this.ids),workUnits:this.used,...(trails?{trails}: {})};
 });}
}


export interface SourceSurfaceTrails {
 readonly positions:Float32Array;readonly colors:Float32Array;readonly alphas:Float32Array;readonly indices:Uint32Array;
 readonly particleIds:Uint32Array;readonly records:number;readonly oldestTime:number;
}
const TRAIL_RECORDS=1_000_000,TRAIL_BLOCK=4096;
/** Source Dot3D FIFO semantics with pooled typed storage. Native per-dot
 * retention is preserved; lazy blocks replace thousands of mostly empty arrays.
 * The 1M aggregate record bound includes NaN separators and precedes allocation.
 * Known storage: <=20MB pool + 12 bytes/particle metadata, <=40MB snapshot;
 * renderer instance buffers have their own owner budgets. Colors are now
 * produced here; scene consumers must not reconstruct them from current heads. */
class SurfaceTrailHistory {
 private readonly heads:Uint32Array;private readonly tails:Uint32Array;private readonly counts:Uint32Array;
 private readonly blocks:{values:Float32Array;next:Uint32Array}[]=[];
 private readonly maximum:number;
 private free=0;private fresh=1;private total=0;
 constructor(particles:number,private readonly lifetime:number,private readonly fade:boolean,private readonly packed:Uint32Array,private readonly check:()=>void){
  this.heads=new Uint32Array(particles);this.tails=new Uint32Array(particles);this.counts=new Uint32Array(particles);
  const product=F(lifetime*60),integer=Math.max(-2147483648,Math.min(2147483647,Math.trunc(product)));
  this.maximum=Math.max(0,(integer+120)|0); // JVM f2i then signed iadd.
 }
 private block(id:number){return this.blocks[Math.floor((id-1)/TRAIL_BLOCK)];}
 private index(id:number){return(id-1)%TRAIL_BLOCK;}
 private next(id:number){return this.block(id).next[this.index(id)];}
 private link(id:number,next:number){this.block(id).next[this.index(id)]=next;}
 private remove(slot:number){
  const id=this.heads[slot];this.heads[slot]=this.next(id);if(--this.counts[slot]===0)this.tails[slot]=0;
  this.link(id,this.free);this.free=id;this.total--;
 }
 add(slot:number,x:number,y:number,z:number,time:number){
  if(!this.maximum)return;
  if(this.counts[slot]===this.maximum)this.remove(slot);
  let id=this.free;
  if(id)this.free=this.next(id);
  else{
   if(this.fresh>TRAIL_RECORDS)fail('capacity','原版曲面拖尾超过本地 100 万记录预算（含断点）');
   id=this.fresh++;
   if(this.index(id)===0){this.check();const size=Math.min(TRAIL_BLOCK,TRAIL_RECORDS-id+1);this.blocks.push({values:new Float32Array(size*4),next:new Uint32Array(size)});}
  }
  const block=this.block(id),i=this.index(id),at=i*4;block.values[at]=x;block.values[at+1]=y;block.values[at+2]=z;block.values[at+3]=time;block.next[i]=0;
  if(this.tails[slot])this.link(this.tails[slot],id);else this.heads[slot]=id;
  this.tails[slot]=id;this.counts[slot]++;this.total++;
 }
 expire(slot:number,time:number){
  while(this.heads[slot]){const id=this.heads[slot];if(!(F(time-this.block(id).values[this.index(id)*4+3])>this.lifetime))break;this.remove(slot);}
 }
 snapshot(dynamicColor?:(particleId:number,recordTime:number,baseColor:number)=>number):SourceSurfaceTrails {
  let vertices=0,segments=0,oldestTime=Infinity;
  const finite=(data:Float32Array,i:number)=>Number.isFinite(data[i])&&Number.isFinite(data[i+1])&&Number.isFinite(data[i+2]);
  for(let slot=0;slot<this.heads.length;slot++){
   if((slot&255)===0)this.check();let previous=false,visited=0;
   for(let id=this.heads[slot];id;id=this.next(id)){
    if((visited++&1023)===0)this.check();
    const data=this.block(id).values,i=this.index(id)*4,valid=finite(data,i);oldestTime=Math.min(oldestTime,data[i+3]);
    if(valid){vertices++;if(previous)segments++;}previous=valid;
   }
  }
  // Both counts are bounded by retained records. Finite points are compacted
  // only after edge identity and original ordinal fade are known.
  const positions=new Float32Array(vertices*3),colors=new Float32Array(vertices*3),alphas=new Float32Array(vertices),particleIds=new Uint32Array(vertices),indices=new Uint32Array(segments*2);
  const writeColor=(vertex:number,color:number)=>{colors[vertex*3]=((color>>>16)&255)/255;colors[vertex*3+1]=((color>>>8)&255)/255;colors[vertex*3+2]=(color&255)/255;};
  let vertex=0,edge=0;
  for(let slot=0;slot<this.heads.length;slot++){
   if((slot&255)===0)this.check();let previous=-1,ordinal=0,previousTime=0,previousColor=0,hasPreviousColor=false;const denominator=Math.max(1,this.counts[slot]-1);
   for(let id=this.heads[slot];id;id=this.next(id),ordinal++){
    if((ordinal&1023)===0)this.check();
    const data=this.block(id).values,i=this.index(id)*4;if(!finite(data,i)){previous=-1;hasPreviousColor=false;continue;}
    positions[vertex*3]=data[i];positions[vertex*3+1]=data[i+1];positions[vertex*3+2]=data[i+2];particleIds[vertex]=slot;
    // PGraphics RGB/255: source stroke(alpha) normalizes and packs to an 8-bit
    // channel before its GL vertex consumer. Separators count in the denominator.
    const baseAlpha=dynamicColor?255:(this.packed[slot]>>>24)||255; // Native trail fallback for zero alpha.
    const stroke=this.fade?F(baseAlpha*F(ordinal/denominator)):baseAlpha;
    alphas[vertex]=F(Math.trunc(F(255*F(stroke/255)))/255);
    writeColor(vertex,this.packed[slot]);
    if(previous>=0){
     if(dynamicColor){
      // Only drawn segment endpoints enter native age/color caches. A
      // contiguous segment reuses the preceding endpoint's sampled color.
      if(!hasPreviousColor)previousColor=dynamicColor(slot,previousTime,this.packed[slot]);
      writeColor(previous,previousColor);previousColor=dynamicColor(slot,data[i+3],this.packed[slot]);
      writeColor(vertex,previousColor);hasPreviousColor=true;
     }
     indices[edge++]=previous;indices[edge++]=vertex;
    }
    previous=vertex++;previousTime=data[i+3];
   }
  }
  return{positions,colors,alphas,indices,particleIds,records:this.total,oldestTime:Number.isFinite(oldestTime)?oldestTime:0};
 }
}
