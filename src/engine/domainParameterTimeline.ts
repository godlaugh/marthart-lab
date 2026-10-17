import type {AnimationAction,DomainParameterAction,SceneDocument} from '../types';
import {DEFAULT_EDGE_EASING,edgeSpeedScale,parseOscillationEdge,prepareParameterOscillation,type PreparedParameterOscillation} from './oscillation';
import {applyDomainParameterBinding,domainParameterBinding,normalizedDomainParameterValue,readDomainParameterBinding,type DomainParameterBinding} from './domainParameterBinding';
export {readDomainParameterScalar} from './domainParameterBinding';

type Curve=(t:number)=>number;
export type DomainParameterCurveResolver=(name:string)=>Curve;
export function validateDomainParameterActions(raw:unknown,method:string,sceneKind?:SceneDocument['kind'],resolve?:DomainParameterCurveResolver):DomainParameterAction[] {
 if(sceneKind!==undefined&&sceneKind!=='domain')throw new Error('原产物 Domain 参数注册表仅适用于域着色');
 if(method!=='paramStart'&&method!=='paramStop')throw new Error('域参数注册表只能用于开始或停止参数动作');
 if(!Array.isArray(raw)||raw.length>128)throw new Error('单动作域参数操作数量必须为0至128');
 return raw.map(value=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('域参数操作必须为对象');
  const p=value as DomainParameterAction;
  if(p.model!=='domain-registry-1.7.8'||!p.scope||typeof p.scope!=='object'||Array.isArray(p.scope)||!['all','named'].includes(p.scope.kind))throw new Error('域参数操作模型或作用域无效');
  if(p.scope.kind==='named'&&typeof p.scope.name!=='string')throw new Error('域参数名称必须为字符串');
  const needsConfig=method==='paramStart'&&p.scope.kind==='named';
  if(needsConfig!==(p.configuration!==undefined))throw new Error('仅具名开始域参数动作需要范围配置');
  if(p.configuration!==undefined){
   if(!p.configuration||typeof p.configuration!=='object'||Array.isArray(p.configuration))throw new Error('域参数范围配置无效');
   prepareParameterOscillation({...p.configuration,model:'domain-1.7.8'},0);
   if(p.configuration.edgeEasing!==undefined){const edge=parseOscillationEdge(p.configuration.edgeEasing);resolve?.(edge.easing);}
  }
  return p;
 });
}

interface Configuration {range:PreparedParameterOscillation;step:number;edge:ReturnType<typeof parseOscillationEdge>;curve:Curve;}
interface Entry {name:string;binding:DomainParameterBinding;configuration:Configuration;phase:number;gain:number;value:number|undefined;written:boolean;}
interface Operation {method:'paramStart'|'paramStop';spec:DomainParameterAction;configuration?:Configuration;}
interface Group {start:number;duration:number;curve:Curve;operations:Operation[];readings:ReadonlyMap<string,number|undefined>;}
interface Active {group:number;operation:Operation;captured?:ReadonlyMap<string,number>;}
interface State {time:number;group:number;running:boolean;work:number;entries:Map<string,Entry>;active:Active[];}
export interface DomainParameterFrame {
 readonly time:number;readonly running:boolean;
 readonly entries:readonly {readonly name:string;readonly phase:number;readonly gain:number;readonly value:number|undefined;readonly written:boolean;readonly minimum:number;readonly maximum:number;readonly step:number}[];
}
const frames=new WeakMap<SceneDocument,DomainParameterFrame>();
export function domainParameterFrame(scene:SceneDocument):DomainParameterFrame|undefined{return frames.get(scene);}
const FPS=60,TAU=2*Math.PI,MAX_WORK=20_000_000,MAX_CACHE_BYTES=4*1024*1024,MAX_READINGS_BYTES=8*1024*1024;
function wrap(value:number,work:{value:number}):number {
 if(!Number.isFinite(value))throw new Error('域参数相位产生非有限值');
 if(value>TAU&&value-TAU===value||value<0&&value+TAU===value)throw new Error('域参数相位约简无法推进');
 const reductions=value>TAU?Math.max(0,Math.ceil(value/TAU)-1):value<0?Math.ceil(-value/TAU):0;
 if(reductions>MAX_WORK-work.value)throw new Error('域参数回放超过2000万次更新，请缩短时间或减少注册参数');
 // Source wrap leaves exact 2π intact and repeatedly subtracts/adds. Count this
 // real work rather than silently replacing an unbounded input with modulo.
 while(value>TAU){if(++work.value>MAX_WORK)throw new Error('域参数回放超过2000万次更新，请缩短时间或减少注册参数');value-=TAU;}
 while(value<0){if(++work.value>MAX_WORK)throw new Error('域参数回放超过2000万次更新，请缩短时间或减少注册参数');value+=TAU;}
 return value;
}
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
function clone(state:State):State{return{...state,entries:new Map([...state.entries].map(([name,e])=>[name,{...e}])),active:[...state.active]};}
function estimate(state:State):number{return 128+state.entries.size*192+state.active.reduce((n,a)=>n+64+(a.captured?.size??0)*32,0);}

/** One registry and animation lifecycle. Starts do not write scalar values.
 * Deterministic replay uses a 60 Hz grid plus explicit event boundaries, with
 * source float dt/easing boundaries. This is not the application's live clock.
 * Fractional request samples never become future simulation state. */
export class DomainParameterTimeline {
 private readonly groups:Group[]=[];
 private readonly names=new Set<string>();
 private readingsBytes=0;
 private cache:State[]=[];
 constructor(private readonly resolve:DomainParameterCurveResolver){}
 appendGroup(start:number,duration:number,easing:string,actions:readonly AnimationAction[],baseline:SceneDocument):number {
  const operations:Operation[]=[];
  for(const action of actions){
   if(action.enabled===false||!action.domainParameters)continue;
   for(const spec of validateDomainParameterActions(action.domainParameters,action.method,baseline.kind,this.resolve)){
    const operation:Operation={method:action.method as Operation['method'],spec:structuredClone(spec)};
    if(spec.scope.kind==='named')this.names.add(spec.scope.name);
    if(spec.configuration){
     const c=spec.configuration,edge=parseOscillationEdge(c.edgeEasing??DEFAULT_EDGE_EASING);
     operation.configuration={range:prepareParameterOscillation({...c,model:'domain-1.7.8'},0),step:Math.fround(c.step),edge,curve:this.resolve(edge.easing)};
    }
    operations.push(operation);
   }
  }
  if(!operations.length)return -1;
  if(!Number.isFinite(start)||start<0||!Number.isFinite(duration)||duration<0||start<(this.groups.at(-1)?.start??0))throw new Error('域参数动作时间无效');
  let readingBytes=0;for(const name of this.names)readingBytes+=32+name.length*2;
  if(this.readingsBytes+readingBytes>MAX_READINGS_BYTES)throw new Error('域参数启动快照超过8 MiB容量');
  const readings=new Map<string,number|undefined>();
  for(const name of this.names)readings.set(name,readDomainParameterBinding(baseline,domainParameterBinding(name)));
  this.readingsBytes+=readingBytes;
  this.groups.push({start,duration,curve:this.resolve(easing),operations,readings});
  // A new event can change state exactly at its start, never an earlier state.
  this.cache=this.cache.filter(state=>state.time<start);
  return this.groups.length-1;
 }
 latestGroup(time:number):number {let index=this.groups.length-1;while(index>=0&&this.groups[index].start>time)index--;return index;}
 private sync(entry:Entry,readings:ReadonlyMap<string,number|undefined>):void {
  const {minimum,maximum}=entry.configuration.range,initial=readings.get(entry.name)??minimum;
  const range=prepareParameterOscillation({model:'domain-1.7.8',min:minimum,max:maximum,step:entry.configuration.step},initial);
  entry.phase=range.phase;
 }
 private setGain(state:State,name:string,value:number):void {const entry=state.entries.get(name);if(entry)entry.gain=Math.max(0,value);}
 private startGroup(state:State,index:number):void {
  const group=this.groups[index];
  // All starts see this pre-update snapshot, including two starts for one name.
  for(const [name,entry]of state.entries)entry.value=group.readings.get(name);
  for(const operation of group.operations){
   const {scope}=operation.spec;
   if(operation.method==='paramStart'){
    if(scope.kind==='named'){
     const entry:Entry={name:scope.name,binding:domainParameterBinding(scope.name),configuration:operation.configuration!,phase:0,gain:1,value:group.readings.get(scope.name),written:state.entries.get(scope.name)?.written??false};
     state.entries.set(scope.name,entry);if(state.running)this.sync(entry,group.readings);
    }
    if(!state.running){for(const entry of state.entries.values())this.sync(entry,group.readings);state.running=true;}
    if(scope.kind==='all')for(const entry of state.entries.values())entry.gain=0;else this.setGain(state,scope.name,0);
    state.active.push({group:index,operation});
   }else if(state.running){
    const names=scope.kind==='all'?[...state.entries.keys()]:[scope.name];
    const captured=new Map(names.map(name=>[name,state.entries.get(name)?.gain??1]));
    state.active.push({group:index,operation,captured});
   }
  }
  state.group=index;
 }
 private updateEffects(state:State,time:number,work:{value:number}):void {
  const keep:Active[]=[];
  for(const active of state.active){
   this.spend(work);
   const group=this.groups[active.group],{operation}=active,scope=operation.spec.scope;
   const finished=time>=group.start+group.duration;
   const eased=Math.fround(group.curve(Math.fround(group.duration===0?1:clamp((time-group.start)/group.duration))));
   if(!Number.isFinite(eased))throw new Error('域参数动作缓动产生非有限值');
   if(operation.method==='paramStart'){
    const gain=finished?1:Math.max(0,eased);
    if(scope.kind==='all')for(const entry of state.entries.values()){this.spend(work);entry.gain=gain;}else this.setGain(state,scope.name,gain);
   }else{
    for(const [name,gain]of active.captured!){this.spend(work);this.setGain(state,name,finished?0:gain*Math.max(0,1-eased));}
    if(finished&&scope.kind==='all'){for(const entry of state.entries.values()){this.spend(work);entry.gain=0;}state.running=false;}
   }
   if(!finished)keep.push(active);
  }
  state.active=keep;
 }
 private advance(state:State,time:number,work:{value:number}):void {
  const dt=Math.fround(time-state.time);this.updateEffects(state,time,work);
  if(dt>0&&state.running)for(const entry of state.entries.values()){
   this.spend(work);
   const {range,step,edge,curve}=entry.configuration;
   let value=range.minimum;
   if(range.half){
    const delta=Math.abs(step)*entry.gain*edgeSpeedScale(entry.phase,edge,curve,true)/range.half*(dt*FPS);
    entry.phase=wrap(entry.phase+delta,work);value=range.middle+range.half*Math.sin(entry.phase);
   }
   const normalized=normalizedDomainParameterValue(entry.binding,value,entry.value);
   if(normalized!==undefined){entry.value=normalized;entry.written=true;}
  }
  state.time=time;
 }
 private spend(work:{value:number}):void {if(++work.value>MAX_WORK)throw new Error('域参数回放超过2000万次更新，请缩短时间或减少注册参数');}
 private replay(time:number):State {
  if(!Number.isFinite(time)||time<0||time>86400)throw new Error('域参数回放时间必须在0至86400秒内');
  let state:State={time:0,group:-1,running:false,work:0,entries:new Map(),active:[]};
  for(const candidate of this.cache)if(candidate.time<=time&&candidate.time>=state.time)state=clone(candidate);
  // Capacity is tied to the deterministic replay, not cache warmth. Repeated
  // short seeks cannot bypass a resource rejection of the equivalent cold seek.
  const work={value:state.work};
  const starts=()=>{let changed=false;while(state.group+1<this.groups.length&&this.groups[state.group+1].start<=state.time){this.startGroup(state,state.group+1);changed=true;}if(changed)this.updateEffects(state,state.time,work);state.work=work.value;};
  starts();
  while(state.time<time){
   const event=this.groups[state.group+1]?.start??Infinity;
   let finish=Infinity;for(const a of state.active)finish=Math.min(finish,this.groups[a.group].start+this.groups[a.group].duration);
   let tickIndex=Math.floor(state.time*FPS)+1,tick=tickIndex/FPS;
   if(tick<=state.time)tick=++tickIndex/FPS;
   let moving=false;if(state.running)for(const e of state.entries.values())if(e.gain!==0&&e.configuration.step!==0&&e.configuration.range.half!==0){moving=true;break;}
   const boundary=Math.min(event,finish,moving||state.active.length?tick:Infinity);
   const next=Math.min(time,boundary);
   if(next<boundary)this.remember(state);
   this.advance(state,next,work);starts();
   // The target may be fractional: only intrinsic grid/event boundaries cache.
   if(next===boundary&&next===time)this.remember(state);
  }
  return state;
 }
 private remember(state:State):void {
  // At most eight snapshots / 4 MiB of estimated numerical state; configurations
  // and names are shared immutable facts and separately bounded at compilation.
  if(estimate(state)>MAX_CACHE_BYTES)return;
  const previous=this.cache.findIndex(s=>s.time===state.time);if(previous>=0)this.cache.splice(previous,1);
  this.cache.push(clone(state));while(this.cache.length>8||this.cache.reduce((n,s)=>n+estimate(s),0)>MAX_CACHE_BYTES)this.cache.shift();
 }
 sample(time:number):DomainParameterFrame {
  const state=this.replay(time);
  return Object.freeze({time,running:state.running,entries:Object.freeze([...state.entries.values()].map(e=>Object.freeze({name:e.name,phase:e.phase,gain:e.gain,value:e.value,written:e.written,minimum:e.configuration.range.minimum,maximum:e.configuration.range.maximum,step:e.configuration.step})))});
 }
 apply(scene:SceneDocument,time:number,onSettingWrite:(key:string)=>void):void {
  const state=this.replay(time),entries:DomainParameterFrame['entries'][number][]=[];
  for(const entry of state.entries.values()){
   entries.push(Object.freeze({name:entry.name,phase:entry.phase,gain:entry.gain,value:entry.value,written:entry.written,minimum:entry.configuration.range.minimum,maximum:entry.configuration.range.maximum,step:entry.configuration.step}));
   if(entry.written&&entry.value!==undefined){applyDomainParameterBinding(scene,entry.binding,entry.value);if(entry.binding.kind==='scale')onSettingWrite('scale');else if(entry.binding.kind==='curve')onSettingWrite(entry.binding.key);}
  }
  frames.set(scene,Object.freeze({time,running:state.running,entries:Object.freeze(entries)}));
 }
 diagnostics(){return{groups:this.groups.length,registeredNames:this.names.size,readingsBytes:this.readingsBytes,checkpoints:this.cache.length,estimatedCacheBytes:this.cache.reduce((n,s)=>n+estimate(s),0)};}
}
