import {sourceSurfaceParameterFrameRate} from './sourceSurfaceFrame';
import {SourceParticleTrailHistory,type SourceParticleTrails} from './sourceParticleTrails';
import {SourceSurfaceParameterRuntime,type SourceSurfaceParameterAction,type SourceSurfaceParameterConfiguration} from './sourceSurfaceParameterRuntime';
import {SourceGradientRuntime,type SourceGradientAction} from './sourceGradientRuntime';
import {INITIAL_SOURCE_SURFACE_PALETTE_STATE,sourceSurfacePaletteTarget,smoothSourceSurfacePalette,type SourceSurfacePaletteState} from './sourceSurfaceGradient';
import {createSourceSurfaceTrailGradient} from './sourceSurfaceTrailGradient';
import {parseSourceSurfacePalette,prepareSourceSurfaceColors,refreshSourceSurfaceColors,type SourceSurfacePalette,type PreparedSourceSurfaceColors} from './sourceSurfaceColor';
import type {SceneDocument} from '../types';
import {parseSourceSurfaceMeshConfiguration,type SourceSurfaceMeshConfiguration} from './sourceSurfaceMeshConfig';
import {parseDomainSourceFloat} from './domainSourceScalar';
import {prepareSourceSurfaceFunction,type SourceSurfaceFunction} from './sourceSurfaceFunction';
import type {OrdinaryCameraParticleFrame,OrdinarySourceCameraParticles,OrdinaryCameraTargetRequest,OrdinaryCameraTargetBinding} from './ordinarySourceCameraTimeline';
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
 return{count,operationsPerPosition:operations,create:(coverage,isCancelled)=>new SourceSurfaceParticles({u,v,count,surfaceFunction:surfaceFunction.create(),frameRate:F(scene.timeline.fps),operations,trails,palette,fadePoints},coverage,isCancelled)};
}
interface Configuration {gpu?:boolean;reserve?:(units:number)=>void;surfaceFunction:SourceSurfaceFunction;frameRate:number;palette?:SourceSurfacePalette;fadePoints:boolean;u:Axis;v:Axis;count:number;operations:number;trails:{show:boolean;record:boolean;fade:boolean;lifetime:number};}
export interface SourceSurfacePointRuntimeOptions {
 configuration:SourceSurfaceMeshConfiguration;surfaceFunction:SourceSurfaceFunction;
 operationsPerPosition:number;frameRate:number;palette?:SourceSurfacePalette;
 coverage:'all'|'tracked';isCancelled?:()=>boolean;reserve?:(units:number)=>void;
}
/** Construct one ParametricSurface from the canonical full surface settings.
 * A mode host supplies the function instance so fresh objects copy the current
 * shared constants while prebuilt actions retain the initial function slots. */
export function createSourceSurfacePointRuntime(options:SourceSurfacePointRuntimeOptions):SourceSurfaceParticles {
 const parsed=parseSourceSurfaceMeshConfiguration(options.configuration);
 if(!parsed.ok)fail('input',`原版点配置无效：${parsed.error.path.join('.')} ${parsed.error.reason}`);
 const c=parsed.value,p=c.points,d=c.domain;
 if(c.nativeBackend==='gpu'&&options.coverage!=='tracked')fail('unsupported','GPU 位置由着色器产生，CPU 运行时只提供跟踪事实');
 if(!Number.isFinite(options.frameRate)||options.frameRate<1||options.frameRate>120)fail('input','原版点帧率必须在 1–120');
 if(!Number.isInteger(options.operationsPerPosition)||options.operationsPerPosition<0)fail('input','原版点公式工作量无效');
 if(![p.uSegments,p.vSegments].every(n=>Number.isInteger(n)&&n>=1&&n<=512))fail('capacity','原版点每轴采样数必须在 1–512');
 const axis=(name:'U'|'V'):Axis=>({min:scalar(d[name==='U'?'uMin':'vMin'],name+'Min'),max:scalar(d[name==='U'?'uMax':'vMax'],name+'Max'),count:p[name==='U'?'uSegments':'vSegments'],speed:scalar(c.tracking[`speed${name}`],'speed'+name),periodic:d[`periodic${name}`],flowing:d[`flowing${name}`]});
 return new SourceSurfaceParticles({gpu:c.nativeBackend==='gpu',u:axis('U'),v:axis('V'),count:p.uSegments*p.vSegments,surfaceFunction:options.surfaceFunction,frameRate:F(options.frameRate),operations:options.operationsPerPosition,palette:options.palette,fadePoints:p.fadePoints,trails:{show:c.nativeBackend==='cpu'&&p.showTrails,record:true,fade:p.fadeTrails,lifetime:scalar(p.trailLifetime,'trailLifetime')},reserve:options.reserve},options.coverage,options.isCancelled);
}
/** initDots uses count, not count-1; shared by GPU seeds and CPU targets. */
export function sourceSurfaceParticleStart(min:number,max:number,index:number,count:number):number {return F(min+F(F(index)*F(F(max-min)/F(count))));}
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
 private color?:PreparedSourceSurfaceColors;
 private pointAlphas?:Float32Array;
 private state:Float32Array;
 private positions:Float32Array;
 private readonly ids:number[]=[];
 private readonly slots=new Map<number,number>();
 private readonly surfaceFunction:SourceSurfaceFunction;
 private history?:SourceParticleTrailHistory;
 private readonly boundaryPoint=new Float32Array(3);
 private recording:boolean;
 private used=0;
 private failure:unknown;
 private failed=false;
 private lastFrame=-1;
 private retired=false;
 private readonly targets=new Map<number,Float32Array>();
 private trackedSlot=0;
 constructor(private readonly config:Configuration,private readonly coverage:'all'|'tracked',private readonly isCancelled?:()=>boolean){
  const capacity=coverage==='all'?config.count:Math.min(config.count,4096);
  this.state=new Float32Array(capacity*4);this.positions=new Float32Array(capacity*3);this.surfaceFunction=config.surfaceFunction;
  this.recording=config.trails.record;
  // Camera-only queries never allocate full-grid color buffers.
  if(coverage==='all'){this.color=prepareSourceSurfaceColors(config.palette,config.u.count,config.v.count,config.u.periodic);this.pointAlphas=new Float32Array(capacity);}
  if(coverage==='all'&&config.trails.show&&config.trails.record)this.history=new SourceParticleTrailHistory(config.count,config.trails.lifetime,config.trails.fade,this.color!.packed,()=>this.check(),()=>fail('capacity','原版曲面拖尾超过本地 100 万记录预算（含断点）'));
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
  if(config.gpu)this.trackedSlot=this.ensure(Math.floor(config.count/2));
 }
 private check(){if(this.failed)throw this.failure;if(this.isCancelled?.())fail('cancelled','原版曲面粒子回放已取消');}
 private guarded<T>(operation:()=>T):T {
  try{this.check();return operation();}catch(error){this.failed=true;this.failure=error;throw error;}
 }
 private reserve(count=1){this.reserveWork(count*(this.config.operations+24));}
 private reserveWork(units:number){this.check();this.used+=units;if(this.used>MAX_WORK)fail('capacity','原版曲面粒子回放超过本地 2000 万工作单位预算');this.config.reserve?.(units);}
 /** Shared expression/transform owner for heads and seam endpoints. Boundary
  * nonfinite results become source break records; CPU invalid heads reject.
  * GPU retains native nonfinite tracking facts; the camera validates only
  * when it actually consumes a target. The shader owns visible GPU vertices. */
 private position(u:number,v:number,out:Float32Array,offset:number):boolean {
  return this.surfaceFunction.position(u,v,out,offset);
 }
 private calculate(slot:number){
  if(!this.position(this.state[slot*4],this.state[slot*4+1],this.positions,slot*3)&&!this.config.gpu)fail('arithmetic',`原版曲面粒子 ${this.ids[slot]} 产生非有限坐标；没有替换成邻点或原点`);
  this.targets.get(slot)?.set(this.positions.subarray(slot*3,slot*3+3));
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
  this.state[at]=sourceSurfaceParticleStart(u.min,u.max,i,u.count);
  this.state[at+1]=sourceSurfaceParticleStart(v.min,v.max,j,v.count);
  this.state[at+2]=u.speed;this.state[at+3]=v.speed;this.calculate(slot);if(this.pointAlphas)this.pointAlphas[slot]=(this.color!.packed[id]>>>24)/255;return slot;
 }
 bind(request:OrdinaryCameraTargetRequest):OrdinaryCameraTargetBinding {return this.guarded(()=>{
  if(this.retired||this.lastFrame>=0)fail('input','原版曲面目标必须在第一帧前绑定');
  const raw=request.action.args?.index;
  if(typeof raw!=='number'||!Number.isFinite(raw))fail('input','原版曲面跟踪索引必须有限');
  // JVM f2i then setTrackedDot clamp, not local row-major or survivor index.
  const id=Math.max(0,Math.min(this.config.count-1,Math.trunc(F(raw)))),slot=this.ensure(id);
  this.trackedSlot=slot;
  let target=this.targets.get(slot);if(!target){target=this.positions.slice(slot*3,slot*3+3);this.targets.set(slot,target);}
  const captured=target;return{kind:'bound',readPosition:()=>this.guarded(()=>[captured[0],captured[1],captured[2]])};
 });}
 /** resetToEmpty removes particles and history, but old actions and captured
  * target vectors remain valid. Retained targets no longer pin full buffers. */
 retire():void {this.guarded(()=>{this.retired=true;this.state=new Float32Array();this.positions=new Float32Array();this.ids.length=0;this.slots.clear();this.targets.clear();this.color=undefined;this.pointAlphas=undefined;this.history=undefined;});}
 setRecordingTrails(enabled:boolean):void {this.guarded(()=>{
  if(typeof enabled!=='boolean')fail('input','原版拖尾录制开关必须是布尔值');
  if(!this.retired&&enabled&&!this.history&&this.coverage==='all'&&this.config.trails.show)this.history=new SourceParticleTrailHistory(this.config.count,this.config.trails.lifetime,this.config.trails.fade,this.color!.packed,()=>this.check(),()=>fail('capacity','原版曲面拖尾超过本地 100 万记录预算（含断点）'));
  this.recording=enabled;
 });}
 beginGradientActions(actions:readonly SourceGradientAction[]):void {this.guarded(()=>this.gradient.begin(actions));}
 interpolateGradientActions(eased:number,finished:boolean):void {this.guarded(()=>this.gradient.interpolate(eased,finished));}
 beginParameterActions(actions:readonly SourceSurfaceParameterAction[]):void {this.guarded(()=>this.parameters.begin(actions));}
 interpolateParameterActions(eased:number,finished:boolean):void {this.guarded(()=>this.parameters.interpolate(eased,finished));}
 beginParameterClip(parameters:readonly ({name:string}&SourceSurfaceParameterConfiguration)[]):void {this.guarded(()=>this.parameters.replace(parameters));}
 finishParameterClip():void {this.guarded(()=>this.parameters.stop());}
 update(frame:OrdinaryCameraParticleFrame):void {this.guarded(()=>{
  this.check();if(this.retired)fail('input','已移出的曲面不再执行粒子更新');if(!Number.isInteger(frame.frameIndex)||frame.frameIndex<0||frame.frameIndex<=this.lastFrame||typeof frame.time!=='number'||!Number.isFinite(F(frame.time))||typeof frame.deltaTime!=='number'||!Number.isFinite(F(frame.deltaTime)))fail('input','原版曲面粒子帧顺序或时间无效');
  // Scene display indices can skip paused updates. Signed dt is retained by
  // the scene; the original object returns before consuming dt <= 0.
  this.lastFrame=frame.frameIndex;const dt=F(frame.deltaTime);if(dt<=0)return;
  this.animationTime=F(frame.time);this.parameters.update(dt,sourceSurfaceParameterFrameRate(frame,this.config.frameRate));this.gradient.update(dt);
  this.reserve(this.config.gpu?1:this.ids.length);
  const u=this.config.u,v=this.config.v,time=F(frame.time);
  for(let slot=0;slot<this.ids.length;slot++){
   if(this.config.gpu&&slot!==this.trackedSlot)continue;
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
 get currentAnimationTime():number{return this.animationTime;}
 get parameterDiagnostics():string[]{return this.ignoredParameterNames.size?[`原版曲面忽略 ${this.ignoredParameterNames.size} 个未声明参数的写入；参数名已保留在时间线。`]:[];}
 snapshot():{positions:Float32Array;particleIds:Uint32Array;colors:Float32Array;pointAlphas:Float32Array;diagnostics:string[];workUnits:number;trails?:SourceParticleTrails} {return this.guarded(()=>{
  if(this.retired)fail('input','已移出的曲面没有可交付画面');
  if(this.coverage!=='all')fail('input','稀疏相机查询不能伪装成完整曲面输出');
  const dynamic=this.history&&this.gradient.running?createSourceSurfaceTrailGradient({palette:this.color!.palette,runtime:this.gradient,time:this.animationTime,numU:this.config.u.count,numV:this.config.v.count,reserve:units=>this.reserveWork(units)}):undefined;
  const trails=this.history?.snapshot(dynamic);
  return{positions:this.positions.slice(),colors:this.color!.colors.slice(),pointAlphas:this.pointAlphas!.slice(),diagnostics:[...this.color!.diagnostics,...this.parameterDiagnostics],particleIds:Uint32Array.from(this.ids),workUnits:this.used,...(trails?{trails}: {})};
 });}
}
