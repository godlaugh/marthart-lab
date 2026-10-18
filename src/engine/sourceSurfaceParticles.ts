import type {SceneDocument} from '../types';
import {prepareSourceRealExpression,parseDomainSourceFloat,type SourceRealExpression} from './domainSourceScalar';
import type {OrdinarySourceCameraParticles,OrdinaryCameraTargetRequest,OrdinaryCameraParticleFrame,OrdinaryCameraTargetBinding} from './ordinarySourceCameraTimeline';
import {evaluateOrdinarySourceCameraTimeline} from './ordinarySourceCameraTimeline';
import {ordinarySourceCameraInitial} from './ordinarySourceCamera';

/** Explicit version: existing local and ordinary-camera documents retain their
 * previous surface sampler until they opt into the source particle geometry. */
export const SOURCE_SURFACE_CLIP_TYPES:readonly string[]=['wait','animate','align'];
export const SOURCE_SURFACE_CAMERA_METHODS:readonly string[]=['rotatePhi','rotateTheta','rotateGamma','rotateTo','zoom','focal','ambient','stopAmbient','track','stopTracking'];
export const SOURCE_SURFACE_PARTICLES='mathart-1.7.8-points-v1';
export const usesSourceSurfaceParticles=(scene:Pick<SceneDocument,'kind'|'settings'>)=>scene.kind==='surface'&&scene.settings.surfaceGeometryVersion===SOURCE_SURFACE_PARTICLES;
export function replaySourceSurface(scene:SceneDocument,time:number,coverage:'all'|'tracked',isCancelled?:()=>boolean){
 const initial=ordinarySourceCameraInitial(scene);if(!initial)throw new Error('原版曲面粒子需要对应的原版相机');
 const prepared=prepareSourceSurfaceParticles(scene);let particles:SourceSurfaceParticles|undefined;
 const frame=evaluateOrdinarySourceCameraTimeline(initial,scene.timeline.tracks,scene.timeline.fps,time,{isCancelled,createParticles:()=>particles=prepared.create(coverage,isCancelled)});
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
 const s=scene.settings;
 if(s.renderMode!=='points'||s.computeBackend!=='cpu')fail('unsupported','原版曲面粒子当前只接入 CPU 点模式；GPU 与网格仍待接入');
 if(s.showTrails===true)fail('unsupported','原版曲面拖尾的边界分段尚未接入此粒子路径');
 if(s.scale!==1||['rotateX','rotateY','rotateZ'].some(key=>Number(s[key]??0)!==0))fail('unsupported','原版曲面粒子使用分轴 scale 与 offset，不执行本地整体缩放或物体旋转');
 for(const track of scene.timeline.tracks){
  if(!track.enabled)continue;
  if(!SOURCE_SURFACE_CLIP_TYPES.includes(track.type??'')||track.actions?.some(a=>!SOURCE_SURFACE_CAMERA_METHODS.includes(a.method)))fail('unsupported','原版曲面粒子的参数/渐变或模式动画尚未接入，不能按本地时钟替代');
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
 const keys=Object.keys(scene.parameters).sort();
 if(keys.length>8192)fail('capacity','原版曲面参数超过 8192 项本地容量');
 const names=['u','v',...keys],variables=new Float64Array(names.length);
 keys.forEach((key,i)=>{const value=scene.parameters[key];if(!Number.isFinite(value))fail('input',`原版曲面参数 ${key} 必须有限`);variables[i+2]=value;});
 const expressions=['x','y','z'].map(key=>{const parsed=prepareSourceRealExpression(scene.equations[key],names);if(!parsed.ok)fail(parsed.error.kind,`原版曲面公式 ${key}：${JSON.stringify(parsed.error)}`);return parsed.value;});
 const operations=expressions.reduce((sum,e)=>sum+e.operations,0);
 return{count,operationsPerPosition:operations,create:(coverage,isCancelled)=>new SourceSurfaceParticles({u,v,count,scales,offsets,variables,expressions,operations},coverage,isCancelled)};
}
interface Configuration {u:Axis;v:Axis;count:number;scales:number[];offsets:number[];variables:Float64Array;expressions:SourceRealExpression[];operations:number;}
function wrap(value:number,axis:Axis):number {
 const range=F(axis.max-axis.min);if(range<=0)return axis.min;
 let rest=F(F(value-axis.min)%range);if(rest<0)rest=F(rest+range);return F(axis.min+rest);
}
/** CPU ParametricSurface state. The same position buffer feeds geometry and
 * bound tracking targets. Sparse coverage is for UI camera queries only; it
 * executes the identical particle recurrence, never a second analytic sampler.
 * All buffers are owned by this replay and snapshots are copied before transfer. */
export class SourceSurfaceParticles implements OrdinarySourceCameraParticles {
 private readonly state:Float32Array;
 private readonly positions:Float32Array;
 private readonly ids:number[]=[];
 private readonly slots=new Map<number,number>();
 private readonly variables:Float64Array;
 private used=0;
 private failure:unknown;
 private failed=false;
 private lastFrame=-1;
 constructor(private readonly config:Configuration,private readonly coverage:'all'|'tracked',private readonly isCancelled?:()=>boolean){
  const capacity=coverage==='all'?config.count:Math.min(config.count,4096);
  this.state=new Float32Array(capacity*4);this.positions=new Float32Array(capacity*3);this.variables=config.variables.slice();
  if(coverage==='all')for(let id=0;id<config.count;id++)this.ensure(id);
 }
 private check(){if(this.failed)throw this.failure;if(this.isCancelled?.())fail('cancelled','原版曲面粒子回放已取消');}
 private guarded<T>(operation:()=>T):T {
  try{this.check();return operation();}catch(error){this.failed=true;this.failure=error;throw error;}
 }
 private reserve(count=1){this.check();this.used+=count*(this.config.operations+24);if(this.used>MAX_WORK)fail('capacity','原版曲面粒子回放超过本地 2000 万工作单位预算');}
 private calculate(slot:number){
  const at=slot*4,to=slot*3,c=this.config;this.variables[0]=this.state[at];this.variables[1]=this.state[at+1];
  for(let k=0;k<3;k++){
   const value=F(F(F(c.expressions[k].evaluate(this.variables))*c.scales[k])+c.offsets[k]);
   if(!Number.isFinite(value))fail('arithmetic',`原版曲面粒子 ${this.ids[slot]} 产生非有限坐标；没有替换成邻点或原点`);
   this.positions[to+k]=value;
  }
 }
 private ensure(id:number):number {
  const existing=this.slots.get(id);if(existing!==undefined)return existing;
  const slot=this.ids.length;if((slot+1)*4>this.state.length)fail('capacity','原版曲面跟踪超过独立目标容量');
  this.reserve();const {u,v}=this.config,at=slot*4,i=Math.floor(id/v.count),j=id%v.count;
  this.ids.push(id);this.slots.set(id,slot);
  this.state[at]=F(u.min+F(F(i)*F(F(u.max-u.min)/F(u.count))));
  this.state[at+1]=F(v.min+F(F(j)*F(F(v.max-v.min)/F(v.count))));
  this.state[at+2]=u.speed;this.state[at+3]=v.speed;this.calculate(slot);return slot;
 }
 bind(request:OrdinaryCameraTargetRequest):OrdinaryCameraTargetBinding {return this.guarded(()=>{
  if(this.lastFrame>=0)fail('input','原版曲面目标必须在第一帧前绑定');
  const raw=request.action.args?.index;
  if(typeof raw!=='number'||!Number.isFinite(raw))fail('input','原版曲面跟踪索引必须有限');
  // JVM f2i then setTrackedDot clamp, not local row-major or survivor index.
  const id=Math.max(0,Math.min(this.config.count-1,Math.trunc(F(raw)))),slot=this.ensure(id),positions=this.positions;
  return{kind:'bound',readPosition:()=>this.guarded(()=>[positions[slot*3],positions[slot*3+1],positions[slot*3+2]])};
 });}
 update(frame:OrdinaryCameraParticleFrame):void {this.guarded(()=>{
  this.check();if(!Number.isInteger(frame.frameIndex)||frame.frameIndex!==this.lastFrame+1||!Number.isFinite(frame.time)||frame.time<0||!Number.isFinite(frame.deltaTime)||frame.deltaTime<0)fail('input','原版曲面粒子帧顺序或时间无效');
  this.lastFrame=frame.frameIndex;const dt=F(frame.deltaTime);if(dt<=0)return;
  this.reserve(this.ids.length);
  for(let slot=0;slot<this.ids.length;slot++){
   if((slot&255)===0)this.check();const at=slot*4;
   for(let k=0;k<2;k++){
    const axis=k===0?this.config.u:this.config.v;
    let value=this.state[at+k];if(axis.periodic&&axis.flowing)value=wrap(value,axis);
    value=F(value+F(dt*this.state[at+k+2]));
    if(axis.periodic){
     if(axis.flowing)value=wrap(value,axis);
     else if(value<axis.min||value>axis.max){this.state[at+k+2]=-this.state[at+k+2];value=value<axis.min?axis.min:value>axis.max?axis.max:value;}
    }
    this.state[at+k]=value;
   }
   this.calculate(slot);
  }
 });}
 snapshot():{positions:Float32Array;particleIds:Uint32Array;workUnits:number} {return this.guarded(()=>{
  if(this.coverage!=='all')fail('input','稀疏相机查询不能伪装成完整曲面输出');
  return{positions:this.positions.slice(),particleIds:Uint32Array.from(this.ids),workUnits:this.used};
 });}
}
