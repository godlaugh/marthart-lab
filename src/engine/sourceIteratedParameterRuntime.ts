import type {OscillationEdgeEasing} from '../types';
import {sourceEase} from './sourceEasing';
import {sourceOscillationEdgeScale,wrapSourceOscillationPhase} from './sourceOscillationEdge';
import {prepareRootsSourceMemberOrder} from './rootsSourceOrder';
export interface SourceIteratedParameterConfiguration {readonly min:number;readonly max:number;readonly step:number;readonly edgeEasing?:OscillationEdgeEasing;}
export type SourceIteratedParameterAction={readonly kind:'start'|'stop';readonly scope:{readonly kind:'all'}|{readonly kind:'named';readonly name:string};readonly configuration?:SourceIteratedParameterConfiguration;readonly duration:number;readonly easing:string;};
export interface SourceIteratedParameterRuntimeOptions {
 readonly read:(name:string)=>number|undefined;
 readonly write:(name:string,value:number)=>void;
 /** Shared replay work/cancellation owner; includes repeated phase reduction. */
 readonly reserve:(units:number)=>void;
}
interface Configuration {readonly min:number;readonly max:number;readonly step:number;readonly span:number;readonly middle:number;readonly half:number;readonly edge:Readonly<OscillationEdgeEasing>;}
interface Entry {readonly name:string;readonly configuration:Configuration;phase?:number;scale:number;}
interface Child {readonly action:SourceIteratedParameterAction;runtime:number;finished:boolean;readonly captured?:ReadonlyMap<string,number>;}
const F=Math.fround;
const finite=(n:number,label:string)=>{if(typeof n!=='number'||!Number.isFinite(n))throw Error(`源迭代参数${label}必须有限`);return n;};
const clamp=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));
function configuration(input:SourceIteratedParameterConfiguration):Configuration {
 const lo=finite(input.min,'下界'),hi=finite(input.max,'上界'),step=finite(input.step,'步进'),min=Math.min(lo,hi),max=Math.max(lo,hi),span=finite(max-min,'范围'),middle=finite((min+max)*.5,'中值');
 const raw=input.edgeEasing??{window:.4,floor:.5,easing:'sine-out'},edge=Object.freeze({window:Math.max(1e-6,finite(raw.window,'端点窗口')),floor:clamp(finite(raw.floor,'端点速度'),0,1),easing:raw.easing});sourceEase(edge.easing,0);
 return Object.freeze({min,max,step,span,middle,half:span*.5,edge});
}
/** Original Map and Symmetry registry and child clocks. Their corresponding
 * animator and Start/Stop methods have identical normalized bytecode. Surface differs in range
 * normalization, missing/out-of-range initial values, disabled entries, phase
 * wrapping and Start's clock. Target scalar writes and Scene scheduling remain
 * separate owners; this class does not render or request a replay. */
export class SourceIteratedParameterRuntime {
 private readonly entries=new Map<string,Entry>();
 private order:readonly string[]=[];
 private children:Child[]=[];
 private active=false;
 private failed=false;
 private readonly options:SourceIteratedParameterRuntimeOptions;
 constructor(options:SourceIteratedParameterRuntimeOptions){if(!options||['read','write','reserve'].some(k=>typeof options[k as keyof SourceIteratedParameterRuntimeOptions]!=='function'))throw Error('源迭代参数回调无效');this.options=Object.freeze({...options});}
 private spend(units=1){this.options.reserve(units);}
 private run(f:()=>void){if(this.failed)throw Error('源迭代参数状态已失败，需要重建');try{f();}catch(e){this.failed=true;throw e;}}
 private ensure(){if(this.failed)throw Error('源迭代参数状态已失败，需要重建');}
 snapshot(){this.ensure();return Object.freeze({running:this.active,phases:Object.freeze(Object.fromEntries(this.order.flatMap(name=>{const p=this.entries.get(name)!.phase;return p===undefined?[]:[[name,p]];}))),scales:Object.freeze(Object.fromEntries(this.order.map(name=>[name,this.entries.get(name)!.scale]))),children:Object.freeze(this.children.map(c=>Object.freeze({runtime:c.runtime,finished:c.finished})))});}
 private sync(entry:Entry){
  this.spend();const c=entry.configuration;if(c.span<=1e-6){entry.phase=0;return;}
  const found=this.options.read(entry.name),raw=found===undefined?c.min:finite(found,'起始值');
  const value=raw<c.min||raw>c.max?(c.step<0?c.max:c.min):raw,phase=Math.asin(clamp((value-c.middle)/c.half,-1,1));entry.phase=c.step<0?Math.PI-phase:phase;
 }
 private start(){if(this.active)return;for(const name of this.order){const entry=this.entries.get(name)!;entry.phase=undefined;this.sync(entry);}this.active=true;}
 private add(name:string,c:Configuration){
  this.spend(8+name.length);const previous=this.entries.get(name),entry:Entry={name,configuration:c,phase:previous?.phase,scale:1};
  this.entries.set(name,entry);
  if(!previous){const order=prepareRootsSourceMemberOrder([...this.entries.keys()]);if(!order.ok)throw Error('源迭代参数注册表超过容量');this.order=order.value.keys;}
  if(this.active)this.sync(entry);
 }
 private scale(scope:SourceIteratedParameterAction['scope'],value:number){for(const name of scope.kind==='all'?this.order:[scope.name]){this.spend();const entry=this.entries.get(name);if(entry)entry.scale=Math.max(0,value);}}
 begin(actions:readonly SourceIteratedParameterAction[]):void {this.run(()=>{
  if(!Array.isArray(actions)||actions.length>256)throw Error('源迭代参数子动画超过 256 项本地容量');
  // Validate/detach before mutating the registry; every start precedes updates.
  const prepared=actions.map(input=>{
   this.spend();if(!input||!['start','stop'].includes(input.kind)||!input.scope||!['all','named'].includes(input.scope.kind)||input.scope.kind==='named'&&typeof input.scope.name!=='string')throw Error('源迭代参数动作无效');
   if(input.scope.kind==='named'&&input.scope.name.length>65536)throw Error('源迭代参数名称超过本地容量');
   const duration=finite(F(input.duration),'时长');sourceEase(input.easing,0);
   const needsConfig=input.kind==='start'&&input.scope.kind==='named';if(needsConfig!==Boolean(input.configuration))throw Error('仅具名开始参数动作需要配置');
   const config=input.configuration?configuration(input.configuration):undefined;
   const action=Object.freeze({...input,duration,scope:Object.freeze({...input.scope}),...(input.configuration?{configuration:Object.freeze({...input.configuration,...(input.configuration.edgeEasing?{edgeEasing:Object.freeze({...input.configuration.edgeEasing})}:{})})}:{})});
   return{action,config};
  });
  this.children=prepared.map(({action,config})=>{
   if(action.kind==='start'){if(action.scope.kind==='named')this.add(action.scope.name,config!);this.start();this.scale(action.scope,0);return{action,runtime:0,finished:false};}
   const captured=new Map<string,number>();if(this.active)for(const name of action.scope.kind==='all'?this.order:[action.scope.name]){this.spend();captured.set(name,this.entries.get(name)?.scale??1);}
   return{action,runtime:0,finished:!this.active,captured};
  });
 });}
 /** Advance actual child time, not an eased value inferred from group time.
  * Start clamps negative dt and treats nonpositive duration as progress1;
  * Stop uses Animation's generic Float32 clock, including transient 0/0. */
 advance(dt:number):void {this.run(()=>{
  dt=finite(F(dt),'片段帧间隔');
  for(const child of this.children){
   this.spend();if(child.finished)continue;const a=child.action;
   child.runtime=finite(F(child.runtime+(a.kind==='start'?Math.max(0,dt):dt)),'子动画时间');
   const ratio=a.kind==='start'&&a.duration<=0?1:F(child.runtime/a.duration),progress=clamp(ratio,0,1),eased=sourceEase(a.easing,progress);
   if(a.kind==='start')this.scale(a.scope,eased);
   else for(const [name,value]of child.captured!)this.scale({kind:'named',name},value*(1-eased));
   if(child.runtime>=a.duration){
    this.scale(a.scope,a.kind==='start'?1:0);if(a.kind==='stop'&&a.scope.kind==='all')this.active=false;child.finished=true;
   }
  }
 });}

 update(dt:number,frameRate=60):void {this.run(()=>{
  if(!this.active)return;dt=finite(F(dt),'对象帧间隔');frameRate=finite(F(frameRate),'帧率');const rate=frameRate>1?frameRate:60;
  for(const name of this.order){this.spend();const entry=this.entries.get(name)!,c=entry.configuration;if(c.span<=1e-6){this.options.write(name,c.min);continue;}
   const phase=entry.phase??0,edge=sourceOscillationEdgeScale(phase,c.edge,n=>this.spend(n)),delta=(((Math.abs(c.step)*entry.scale)*edge)/c.half)*(dt*rate);
   entry.phase=wrapSourceOscillationPhase(phase+delta,n=>this.spend(n));this.options.write(name,finite(c.middle+c.half*Math.sin(entry.phase),'写入值'));
  }
 });}
}
