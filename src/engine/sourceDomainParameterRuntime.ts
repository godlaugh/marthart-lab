import type {DomainParameterAction,OscillationEdgeEasing} from '../types';
import {DEFAULT_EDGE_EASING,parseOscillationEdge,prepareParameterOscillation} from './oscillation';
import {prepareRootsSourceMemberOrder} from './rootsSourceOrder';
import {sourceEase} from './sourceEasing';
import {sourceOscillationEdgeScale,wrapSourceOscillationPhase} from './sourceOscillationEdge';

export interface SourceDomainParameterRuntimeOptions {
 readonly readScalar:(name:string)=>number|undefined;
 /** The mobject binding owns narrowing, clamping and unknown-name behavior. */
 readonly writeScalar:(name:string,value:number)=>void;
 readonly reserve:(units:number)=>void;
}
export interface SourceDomainParameterRuntimeAction {
 readonly method:'paramStart'|'paramStop';
 readonly spec:DomainParameterAction;
}
interface Configuration {
 readonly min:number;readonly max:number;readonly step:number;
 readonly edgeEasing:Readonly<OscillationEdgeEasing>;
}
interface Entry {
 readonly name:string;readonly configuration:Configuration;
 readonly minimum:number;readonly middle:number;readonly half:number;
 phase?:number;scale:number;
}
interface Child {
 readonly method:SourceDomainParameterRuntimeAction['method'];
 readonly scope:DomainParameterAction['scope'];
 readonly captured?:ReadonlyMap<string,number>;
 finished:boolean;
}
const F=Math.fround;
function finite(value:number,label:string):number {
 if(typeof value!=='number'||!Number.isFinite(value))throw Error(`原版域参数${label}必须有限`);
 return value;
}
function configuration(value:NonNullable<DomainParameterAction['configuration']>):Configuration {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('原版域参数范围配置无效');
 // JsonDomainColoringConfig constructs Start children from getJsonFloat values.
 // The shared range owner also preserves Domain's sign-dependent initial end.
 prepareParameterOscillation({...value,model:'domain-1.7.8'},0);
 const edge=parseOscillationEdge(value.edgeEasing??DEFAULT_EDGE_EASING);
 sourceEase(edge.easing,0);
 return Object.freeze({min:F(value.min),max:F(value.max),step:F(value.step),edgeEasing:Object.freeze(edge)});
}

/** Original DomainParameterAnimator and its Start/Stop callbacks. The scene
 * owns the child clocks and calls this animator in each positive mobject phase.
 * This owner uses the supplied PApplet.frameRate, not the legacy 60 Hz timeline.
 * Java Math transcendental results may differ from JS by final double bits. */
export class SourceDomainParameterRuntime {
 private readonly entries=new Map<string,Entry>();
 private order:readonly string[]=[];
 private orderInitialCapacity=0;
 private orderCapacity=0;
 private children:Child[]=[];
 private active=false;
 private failed=false;
 private readonly options:SourceDomainParameterRuntimeOptions;
 constructor(options:SourceDomainParameterRuntimeOptions){
  if(!options||['readScalar','writeScalar','reserve'].some(k=>typeof options[k as keyof SourceDomainParameterRuntimeOptions]!=='function'))throw Error('原版域参数回调无效');
  this.options=Object.freeze({...options});
 }
 private ensure(){if(this.failed)throw Error('原版域参数状态已失败，需要重建');}
 private run(action:()=>void){this.ensure();try{action();}catch(error){this.failed=true;throw error;}}
 private spend(units=1){this.options.reserve(units);}
 get running(){this.ensure();return this.active;}
 snapshot(){
  this.ensure();
  return Object.freeze({running:this.active,
   entries:Object.freeze(this.order.map(name=>{const e=this.entries.get(name)!;return Object.freeze({name:e.name,configuration:e.configuration,phase:e.phase,scale:e.scale});})),
   children:Object.freeze(this.children.map(c=>Object.freeze({finished:c.finished}))),
  });
 }
 private sync(entry:Entry):void {
  this.spend();
  if(entry.half===0){entry.phase=0;return;}
  const initial=this.options.readScalar(entry.name)??entry.minimum;
  entry.phase=prepareParameterOscillation({...entry.configuration,model:'domain-1.7.8'},finite(initial,'起始值')).phase;
 }
 private add(name:string,c:Configuration):void {
  this.spend(8+name.length);
  const range=prepareParameterOscillation({...c,model:'domain-1.7.8'},0),old=this.entries.get(name);
  const entry:Entry={name,configuration:c,minimum:range.minimum,middle:range.middle,half:range.half,phase:old?.phase,scale:1};
  this.entries.set(name,entry);
  if(!old){
   this.spend(this.entries.size*4);
   const order=prepareRootsSourceMemberOrder([...this.entries.keys()],{initialCapacity:this.orderInitialCapacity});
   if(!order.ok)throw Error('原版域参数注册表超过本地容量');
   this.order=order.value.keys;this.orderCapacity=order.value.capacity;
  }
  if(this.active)this.sync(entry);
 }
 private start():void {
  if(this.active)return;
  for(const entry of this.entries.values()){this.spend();entry.phase=undefined;}
  for(const name of this.order)this.sync(this.entries.get(name)!);
  this.active=true;
 }
 private scale(scope:DomainParameterAction['scope'],value:number):void {
  for(const name of scope.kind==='all'?this.order:[scope.name]){
   this.spend();const entry=this.entries.get(name);if(entry)entry.scale=Math.max(0,value);
  }
 }
 /** Every group child starts before any child's interpolation. A Stop begun
  * while inactive remains finished even if a later sibling starts the animator. */
 begin(actions:readonly SourceDomainParameterRuntimeAction[]):void {this.run(()=>{
  if(!Array.isArray(actions))throw Error('原版域参数动作需要数组');
  const prepared=actions.map(action=>{
   this.spend();
   if(!action||typeof action!=='object'||Array.isArray(action)||!['paramStart','paramStop'].includes(action.method))throw Error('原版域参数动作无效');
   const spec=action.spec;
   if(!spec||typeof spec!=='object'||Array.isArray(spec)||spec.model!=='domain-registry-1.7.8'||!spec.scope||typeof spec.scope!=='object'||Array.isArray(spec.scope)||!['all','named'].includes(spec.scope.kind)||spec.scope.kind==='named'&&typeof spec.scope.name!=='string')throw Error('原版域参数模型或作用域无效');
   const needsConfig=action.method==='paramStart'&&spec.scope.kind==='named';
   if(needsConfig!==(spec.configuration!==undefined))throw Error('仅具名开始域参数动作需要配置');
   return{method:action.method,scope:Object.freeze({...spec.scope}),configuration:spec.configuration===undefined?undefined:configuration(spec.configuration)};
  });
  this.children=prepared.map(action=>{
   if(action.method==='paramStart'){
    if(action.scope.kind==='named')this.add(action.scope.name,action.configuration!);
    this.start();this.scale(action.scope,0);
    return{method:action.method,scope:action.scope,finished:false};
   }
   if(!this.active)return{method:action.method,scope:action.scope,finished:true};
   const captured=new Map<string,number>();
   for(const name of action.scope.kind==='all'?this.order:[action.scope.name]){this.spend();captured.set(name,this.entries.get(name)?.scale??1);}
   return{method:action.method,scope:action.scope,captured,finished:false};
  });
 });}
 interpolate(eased:number,finished:boolean):void {this.run(()=>{
  if(typeof eased!=='number'||typeof finished!=='boolean'||!finished&&!Number.isFinite(F(eased)))throw Error('原版域参数动画进度无效');
  // A zero-duration source child can have NaN progress; its same-call finish
  // restores the scale before the mobject runs, so preserve that ordering.
  eased=F(eased);
  for(const child of this.children){
   this.spend();if(child.finished)continue;
   if(child.method==='paramStart'){this.scale(child.scope,eased);if(finished)this.scale(child.scope,1);}
   else{
    for(const [name,value]of child.captured!)this.scale({kind:'named',name},value*(1-eased));
    if(finished){this.scale(child.scope,0);if(child.scope.kind==='all')this.active=false;}
   }
   if(finished)child.finished=true;
  }
 });}
 /** applyConfig clears all maps, retains allocated HashMap capacity and does
  * not replace the queue's already-started children. */
 clear():void {this.run(()=>{this.spend();this.entries.clear();this.order=[];this.orderInitialCapacity=this.orderCapacity;});}
 stop():void {this.run(()=>{this.spend();this.active=false;});}
 update(dt:number,actualPAppletFrameRate:number):void {this.run(()=>{
  if(!this.active)return;
  dt=finite(F(finite(dt,'帧间隔')),'帧间隔');
  const fps=finite(F(finite(actualPAppletFrameRate,'宿主帧率')),'宿主帧率'),rate=fps>1?fps:60;
  for(const name of this.order){
   this.spend();const entry=this.entries.get(name)!,c=entry.configuration;
   if(entry.half===0){this.options.writeScalar(name,entry.minimum);continue;}
   const phase=entry.phase??0,edge=sourceOscillationEdgeScale(phase,c.edgeEasing,n=>this.spend(n));
   const delta=(((Math.abs(c.step)*entry.scale)*edge)/entry.half)*(dt*rate);
   entry.phase=wrapSourceOscillationPhase(phase+delta,n=>this.spend(n));
   this.options.writeScalar(name,finite(entry.middle+entry.half*Math.sin(entry.phase),'写入值'));
  }
 });}
}
