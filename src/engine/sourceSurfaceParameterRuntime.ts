import type {OscillationEdgeEasing} from '../types';
import {sourceEase} from './sourceEasing';

export interface SourceSurfaceParameterConfiguration {
 readonly min:number;readonly max:number;readonly step:number;
 readonly enabled?:boolean;readonly edgeEasing?:OscillationEdgeEasing;
}
export type SourceSurfaceParameterScope={readonly kind:'all'}|{readonly kind:'named';readonly name:string};
export type SourceSurfaceParameterAction=
 |{readonly kind:'start';readonly scope:SourceSurfaceParameterScope;readonly configuration?:SourceSurfaceParameterConfiguration}
 |{readonly kind:'stop';readonly scope:SourceSurfaceParameterScope};
export interface SourceSurfaceParameterRuntimeOptions {
 readonly read:(name:string)=>number;
 readonly write:(name:string,value:number)=>void;
 /** Shared replay work/cancellation owner. Every loop iteration is charged. */
 readonly reserve:(units:number)=>void;
}
interface Configuration {readonly min:number;readonly max:number;readonly step:number;readonly enabled:boolean;readonly edge:Readonly<OscillationEdgeEasing>;readonly span:number;readonly middle:number;readonly half:number;}
interface Entry {name:string;configuration:Configuration;phase?:number;scale:number;}
interface Child {action:SourceSurfaceParameterAction;finished:boolean;captured?:ReadonlyMap<string,number>;}
const TAU=6.283185307179586,F=Math.fround;
const finite=(value:number,label:string)=>{if(!Number.isFinite(value))throw new Error(`原版曲面参数${label}必须有限`);return value;};
const clamp=(value:number)=>value<0?0:value>1?1:value;
const DEFAULT_EDGE=Object.freeze({window:.4,floor:.5,easing:'sine-out'});
function configuration(input:SourceSurfaceParameterConfiguration,enabled:boolean,edge=input.edgeEasing):Configuration {
 const min=finite(input.min,'下界'),max=finite(input.max,'上界'),step=finite(input.step,'步进');
 const span=finite(max-min,'范围'),middle=finite((min+max)/2,'中值'),half=span/2;
 const e=edge??DEFAULT_EDGE;
 const prepared=Object.freeze({window:Math.max(1e-6,finite(e.window,'端点窗口')),floor:clamp(finite(e.floor,'端点速度下限')),easing:e.easing});
 sourceEase(prepared.easing,0); // Admit the exact source curve before mutating registry state.
 return Object.freeze({min,max,step,enabled,edge:prepared,span,middle,half});
}

/** SurfaceParameterAnimator owns one registry. The scene owns scheduling and
 * known variable slots; unknown-name getters return0 and setters do nothing.
 * This runtime never substitutes the Domain/local oscillator or a 60Hz clock. */
export class SourceSurfaceParameterRuntime {
 private readonly entries=new Map<string,Entry>();
 private children:Child[]=[];
 private active=false;
 constructor(private readonly options:SourceSurfaceParameterRuntimeOptions){}
 get running(){return this.active;}
 snapshot(){return Object.freeze({running:this.active,entries:Object.freeze([...this.entries.values()].map(entry=>Object.freeze({...entry}))) });}
 private spend(units=1){this.options.reserve(units);}
 private sync(entry:Entry):void {
  this.spend();const current=finite(this.options.read(entry.name),'起始值'),c=entry.configuration;
  if(c.span<=1e-6){entry.phase=0;return;}
  const normalized=Math.max(-1,Math.min(1,(current-c.middle)/c.half));
  const phase=Math.asin(normalized);entry.phase=c.step<0?Math.PI-phase:phase;
 }
 private add(name:string,c:Configuration):void {
  this.spend(8+name.length);const old=this.entries.get(name),entry={name,configuration:c,phase:old?.phase,scale:1};
  this.entries.set(name,entry);if(this.active&&c.enabled)this.sync(entry);
 }
 private start():void {
  if(this.active)return;
  for(const entry of this.entries.values()){
   this.spend();entry.phase=undefined;
   // Native start reads every entry, even disabled ordinary-range entries.
   // Narrow/reversed entries still receive phase0 independently of enable.
   if(entry.configuration.enabled||entry.configuration.span<=1e-6)this.sync(entry);
   else finite(this.options.read(entry.name),'起始值');
  }
  this.active=true;
 }
 private setScale(name:string,scale:number):void {
  this.spend();const entry=this.entries.get(name);if(entry)entry.scale=Math.max(0,scale);
 }
 private setAll(scale:number):void {for(const name of this.entries.keys())this.setScale(name,scale);}
 private scopedScale(scope:SourceSurfaceParameterScope,scale:number):void {if(scope.kind==='all')this.setAll(scale);else this.setScale(scope.name,scale);}
 /** All child starts precede all child updates, including overwritten names. */
 begin(actions:readonly SourceSurfaceParameterAction[]):void {
  const prepared=actions.map(action=>{
   this.spend();
   if(!action.scope||!['all','named'].includes(action.scope.kind)||action.scope.kind==='named'&&typeof action.scope.name!=='string')throw new Error('原版曲面参数作用域无效');
   if(action.kind==='start'){
    if(action.scope.kind==='named'&&!action.configuration||action.scope.kind==='all'&&action.configuration!==undefined)throw new Error('仅具名开始曲面参数动作需要范围配置');
    return{action:{...action,scope:Object.freeze({...action.scope})},configuration:action.configuration?configuration(action.configuration,true):undefined};
   }
   if(action.kind!=='stop')throw new Error('原版曲面参数动作无效');
   return{action:{...action,scope:Object.freeze({...action.scope})},configuration:undefined};
  });
  this.children=prepared.map(({action,configuration:c})=>{
   this.spend();
   if(action.kind==='start'){
    if(action.scope.kind==='named')this.add(action.scope.name,c!);
    this.start();this.scopedScale(action.scope,0);return{action,finished:false};
   }
   if(!this.active)return{action,finished:true};
   const captured=new Map<string,number>();
   if(action.scope.kind==='named')captured.set(action.scope.name,this.entries.get(action.scope.name)?.scale??1);
   else for(const entry of this.entries.values()){this.spend(4+entry.name.length);captured.set(entry.name,entry.scale);}
   return{action,finished:false,captured};
  });
 }
 interpolate(eased:number,finished:boolean):void {
  eased=F(eased); // onFinish restores transient 0/0 before parameter updates.
  for(const child of this.children){
   this.spend();if(child.finished)continue;
   if(child.action.kind==='start'){
    this.scopedScale(child.action.scope,eased);
    if(finished)this.scopedScale(child.action.scope,1);
   }else{
    for(const [name,scale]of child.captured!)this.setScale(name,scale*(1-eased));
    if(finished){this.scopedScale(child.action.scope,0);if(child.action.scope.kind==='all')this.stop();}
   }
   if(finished)child.finished=true;
  }
 }
 /** AnimateSurfaceParam: clear maps without changing running, add with gain1
  * and null edge, then start. Its onUpdate does nothing; caller stops onFinish. */
 replace(configs:readonly (SourceSurfaceParameterConfiguration&{readonly name:string})[]):void {
  const prepared=configs.map(input=>{
   this.spend();if(typeof input.name!=='string'||input.enabled!==undefined&&typeof input.enabled!=='boolean')throw new Error('原版曲面参数替换配置无效');
   return{name:input.name,configuration:configuration({...input,edgeEasing:undefined},input.enabled!==false)};
  });
  this.entries.clear();this.children=[];
  for(const entry of prepared)this.add(entry.name,entry.configuration);
  this.start();
 }
 stop():void {this.spend();this.active=false;}
 private edgeScale(phase:number,edge:Readonly<OscillationEdgeEasing>):number {
  phase=finite(phase,'相位');
  // Native local lookup normalizes by repeated subtraction, unlike the stored
  // phase's single subtraction below. Charge every reduction and reject a
  // subtraction that cannot advance at binary64 precision.
  while(phase>TAU){this.spend();const next=phase-TAU;if(next===phase)throw new Error('原版曲面参数相位约简无法推进');phase=next;}
  while(phase<0){this.spend();const next=phase+TAU;if(next===phase)throw new Error('原版曲面参数相位约简无法推进');phase=next;}
  const distance=(to:number)=>{const d=Math.abs(phase-to)%TAU;return d>Math.PI?TAU-d:d;};
  const q=clamp(Math.min(distance(Math.PI/2),distance(3*Math.PI/2))/edge.window);
  return finite(edge.floor+(1-edge.floor)*sourceEase(edge.easing,F(q)),'端点速度');
 }
 update(dt:number,frameRate:number):void {
  if(!this.active)return;
  dt=finite(F(dt),'帧间隔');frameRate=finite(F(frameRate),'帧率');const rate=frameRate>1?frameRate:60;
  for(const entry of this.entries.values()){
   this.spend();const c=entry.configuration;if(!c.enabled)continue;
   if(c.span<=1e-6){this.options.write(entry.name,c.min);continue;}
   let phase=entry.phase??0;
   const delta=(((Math.abs(c.step)*entry.scale)*this.edgeScale(phase,c.edge))/c.half)*(dt*rate);
   phase=finite(phase+delta,'相位');if(phase>TAU)phase-=TAU;entry.phase=phase;
   this.options.write(entry.name,finite(c.middle+c.half*Math.sin(phase),'数值'));
  }
 }
}
