import type {OscillationEdgeEasing} from '../types';
import {sourceEase} from './sourceEasing';
import {sourceOscillationEdgeScale} from './sourceOscillationEdge';
import {prepareRootsSourceMemberOrder} from './rootsSourceOrder';
import {isJavaBlank} from './sourceJavaText';

export interface SourceFractalParameterDefinition {readonly kind:'float'|'integer'|'complex'|'other';}
export interface SourceFractalParameterConfiguration {
 readonly min:number;readonly max:number;readonly step:number;readonly edgeEasing?:OscillationEdgeEasing;
}
export type SourceFractalParameterScope={readonly kind:'all'}|{readonly kind:'named';readonly name:string};
export type SourceFractalParameterAction=
 |{readonly kind:'start';readonly scope:SourceFractalParameterScope;readonly configuration?:SourceFractalParameterConfiguration}
 |{readonly kind:'stop';readonly scope:SourceFractalParameterScope};
export interface SourceFractalParameterRuntimeOptions {
 /** Exact active source formula metadata, not arbitrary local setting names. */
 readonly definition:(baseName:string)=>SourceFractalParameterDefinition|undefined;
 readonly readScalar:(baseName:string)=>number|undefined;
 readonly readComplex:(baseName:string)=>readonly[number,number]|undefined;
 /** Mobject owns FLOAT/INTEGER narrowing and its formula-runtime remapping. */
 readonly writeScalar:(baseName:string,value:number)=>void;
 readonly writeComplex:(baseName:string,real:number,imaginary:number)=>void;
 readonly reserve:(units:number)=>void;
}
interface Configuration {readonly min:number;readonly max:number;readonly step:number;readonly middle:number;readonly half:number;readonly span:number;readonly edge:Readonly<OscillationEdgeEasing>;}
interface Entry {readonly name:string;readonly configuration:Configuration;scale:number;scalarPhase?:number;complexPhase?:number;fixedImaginary?:number;}
interface Child {readonly action:SourceFractalParameterAction;finished:boolean;readonly captured?:ReadonlyMap<string,number>;}
interface Binding {readonly name:string;readonly kind:SourceFractalParameterDefinition['kind'];readonly mode:'scalar'|'complex-full'|'complex-real'|'complex-imaginary';}
const F=Math.fround,TAU=6.283185307179586;
const finite=(n:number,label:string)=>{if(typeof n!=='number'||!Number.isFinite(n))throw Error(`原版分形参数${label}必须有限`);return n;};
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
function configuration(input:SourceFractalParameterConfiguration):Configuration {
 const lo=finite(input.min,'下界'),hi=finite(input.max,'上界'),step=finite(input.step,'步进'),min=Math.min(lo,hi),max=Math.max(lo,hi),span=finite(max-min,'范围'),middle=finite((min+max)*.5,'中值');
 const raw=input.edgeEasing??{window:.4,floor:.5,easing:'sine-out'},edge=Object.freeze({window:Math.max(1e-6,finite(raw.window,'端点窗口')),floor:clamp(finite(raw.floor,'端点速度下限'),0,1),easing:raw.easing});
 sourceEase(edge.easing,0);return Object.freeze({min,max,step,span,middle,half:span*.5,edge});
}

/** FractalParameterAnimator's registry and Start/Stop callbacks. Its generic
 * Animation child clock remains with the scene queue. This is not Surface's
 * scalar-only oscillator: metadata, component aliases and captured imaginary
 * coordinates remain distinct. Original finite numerical fixtures are retained
 * in tests/fixtures/source-fractal-parameter; GUI/GPU scheduling is not modeled. */
export class SourceFractalParameterRuntime {
 private readonly entries=new Map<string,Entry>();
 private order:readonly string[]=[];
 // HashMap.clear retains its allocated table. Replaying insertion since the
 // latest clear must start at that capacity, not at the latest grown capacity.
 private orderInitialCapacity=0;
 private orderCapacity=0;
 private children:Child[]=[];
 private active=false;
 private failed=false;
 private readonly options:SourceFractalParameterRuntimeOptions;
 constructor(options:SourceFractalParameterRuntimeOptions){
  if(!options||['definition','readScalar','readComplex','writeScalar','writeComplex','reserve'].some(k=>typeof options[k as keyof SourceFractalParameterRuntimeOptions]!=='function'))throw Error('原版分形参数回调无效');
  this.options=Object.freeze({...options});
 }
 get running(){this.ensure();return this.active;}
 private ensure(){if(this.failed)throw Error('原版分形参数状态已失败，需要重建');}
 private run(action:()=>void){this.ensure();try{action();}catch(error){this.failed=true;throw error;}}
 private spend(units=1){this.options.reserve(units);}
 snapshot(){this.ensure();return Object.freeze({running:this.active,entries:Object.freeze(this.order.map(name=>Object.freeze({...this.entries.get(name)!}))),children:Object.freeze(this.children.map(c=>Object.freeze({finished:c.finished})))});}
 private binding(raw:string):Binding|undefined {
  this.spend();if(isJavaBlank(raw))return;
  let name=raw,mode:Binding['mode']='scalar';
  if(raw.endsWith('_re')){name=raw.slice(0,-3);mode='complex-real';}
  else if(raw.endsWith('_im')){name=raw.slice(0,-3);mode='complex-imaginary';}
  const definition=this.options.definition(name);if(!definition)return;
  if(!['float','integer','complex','other'].includes(definition.kind))throw Error('原版分形参数元数据类型无效');
  if(definition.kind!=='complex')mode='scalar';else if(mode==='scalar')mode='complex-full';
  return{name,kind:definition.kind,mode};
 }
 private complex(name:string):readonly[number,number]|undefined {
  const value=this.options.readComplex(name);if(value===undefined)return;
  if(!Array.isArray(value)||value.length!==2)throw Error('原版分形复数参数需要两个分量');
  return[finite(value[0],'实部'),finite(value[1],'虚部')];
 }
 private sync(entry:Entry):void {
  this.spend();const binding=this.binding(entry.name);if(!binding)return;const c=entry.configuration;
  if(c.span<=1e-6){
   entry.scalarPhase=0;
   if(binding.mode==='complex-full'){entry.fixedImaginary=this.complex(binding.name)?.[1]??c.min;entry.complexPhase=0;}
   return;
  }
  let value:number;
  if(binding.mode==='complex-full'){
   const current=this.complex(binding.name);entry.fixedImaginary=current?.[1]??c.min;value=current?.[0]??c.min;
  }else if(binding.mode==='complex-real'||binding.mode==='complex-imaginary')value=this.complex(binding.name)?.[binding.mode==='complex-real'?0:1]??c.min;
  else value=binding.kind==='other'?c.min:this.options.readScalar(binding.name)??c.min;
  const phase=Math.asin(clamp((finite(value,'起始值')-c.middle)/c.half,-1,1)),signed=c.step<0?Math.PI-phase:phase;
  if(binding.mode==='complex-full')entry.complexPhase=signed;else entry.scalarPhase=signed;
 }
 private add(name:string,c:Configuration):void {
  this.spend(8+name.length);const old=this.entries.get(name),entry:Entry={name,configuration:c,scale:1,scalarPhase:old?.scalarPhase,complexPhase:old?.complexPhase,fixedImaginary:old?.fixedImaginary};
  this.entries.set(name,entry);
  if(!old){this.spend(this.entries.size*4);const order=prepareRootsSourceMemberOrder([...this.entries.keys()],{initialCapacity:this.orderInitialCapacity});if(!order.ok)throw Error('原版分形参数注册表超过本地容量');this.order=order.value.keys;this.orderCapacity=order.value.capacity;}
  if(this.active)this.sync(entry);
 }
 private start(){
  if(this.active)return;
  for(const entry of this.entries.values()){entry.scalarPhase=undefined;entry.complexPhase=undefined;entry.fixedImaginary=undefined;}
  for(const name of this.order)this.sync(this.entries.get(name)!);
  this.active=true;
 }
 private scale(scope:SourceFractalParameterScope,value:number){
  for(const name of scope.kind==='all'?this.order:[scope.name]){this.spend();const entry=this.entries.get(name);if(entry)entry.scale=Math.max(0,value);}
 }
 /** All group children start before any child updates, including replacements. */
 begin(actions:readonly SourceFractalParameterAction[]):void {this.run(()=>{
  if(!Array.isArray(actions))throw Error('原版分形参数动作需要数组');
  const prepared=actions.map(action=>{
   this.spend();if(!action||!['start','stop'].includes(action.kind)||!action.scope||!['all','named'].includes(action.scope.kind)||action.scope.kind==='named'&&typeof action.scope.name!=='string')throw Error('原版分形参数动作无效');
   const input='configuration' in action?action.configuration:undefined,needsConfig=action.kind==='start'&&action.scope.kind==='named';
   if(needsConfig!==Boolean(input))throw Error('仅具名开始分形参数动作需要配置');
   const config=input?configuration(input):undefined,copy=Object.freeze({...action,scope:Object.freeze({...action.scope}),...(input?{configuration:Object.freeze({...input,...(input.edgeEasing?{edgeEasing:Object.freeze({...input.edgeEasing})}:{})})}:{})});
   return{action:copy,configuration:config};
  });
  this.children=prepared.map(({action,configuration:c})=>{
   if(action.kind==='start'){if(action.scope.kind==='named')this.add(action.scope.name,c!);this.start();this.scale(action.scope,0);return{action,finished:false};}
   if(!this.active)return{action,finished:true};
   const captured=new Map<string,number>();for(const name of action.scope.kind==='all'?this.order:[action.scope.name]){this.spend();captured.set(name,this.entries.get(name)?.scale??1);}
   return{action,finished:false,captured};
  });
 });}
 interpolate(eased:number,finished:boolean):void {this.run(()=>{
  // Generic Animation can transiently produce NaN for a zero-duration child;
  // its same-call onFinish restores scales before the mobject update.
  eased=F(eased);
  for(const child of this.children){
   this.spend();if(child.finished)continue;
   if(child.action.kind==='start'){this.scale(child.action.scope,eased);if(finished)this.scale(child.action.scope,1);}
   else{for(const [name,value]of child.captured!)this.scale({kind:'named',name},value*(1-eased));if(finished){this.scale(child.action.scope,0);if(child.action.scope.kind==='all')this.active=false;}}
   if(finished)child.finished=true;
  }
 });}
 /** Mobject.applyConfig clears registry state, not the already-started queue
  * children. Their later scale callbacks must not re-register these entries. */
 clear():void {this.run(()=>{this.spend();this.entries.clear();this.order=[];this.orderInitialCapacity=this.orderCapacity;});}
 stop():void {this.run(()=>{this.spend();this.active=false;});}
 private write(entry:Entry,binding:Binding,value:number):void {
  value=finite(value,'写入值');
  if(binding.mode==='complex-full')this.options.writeComplex(binding.name,value,entry.fixedImaginary??0);
  else if(binding.mode==='complex-real'||binding.mode==='complex-imaginary'){
   const current=this.complex(binding.name)??[0,0];this.options.writeComplex(binding.name,binding.mode==='complex-real'?value:current[0],binding.mode==='complex-imaginary'?value:current[1]);
  }else if(binding.kind!=='other')this.options.writeScalar(binding.name,value);
 }
 update(dt:number,frameRate:number):void {this.run(()=>{
  if(!this.active)return;
  dt=finite(F(dt),'帧间隔');frameRate=finite(F(frameRate),'帧率');const rate=frameRate>1?frameRate:60;
  for(const name of this.order){
   this.spend();const entry=this.entries.get(name)!,binding=this.binding(name);if(!binding)continue;const c=entry.configuration;
   if(c.span<=1e-6){this.write(entry,binding,c.min);continue;}
   let phase=(binding.mode==='complex-full'?entry.complexPhase:entry.scalarPhase)??0;
   const edge=sourceOscillationEdgeScale(phase,c.edge,n=>this.spend(n)),delta=(((Math.abs(c.step)*entry.scale)*edge)/c.half)*(dt*rate);
   phase=finite(phase+delta,'相位');
   // Fractal wrapPhase only subtracts positive overflow. Negative phase is
   // retained; the edge-easing owner normalizes its own input separately.
   while(phase>TAU){this.spend();const next=phase-TAU;if(next===phase)throw Error('原版分形参数相位约简无法推进');phase=next;}
   if(binding.mode==='complex-full')entry.complexPhase=phase;else entry.scalarPhase=phase;
   this.write(entry,binding,c.middle+c.half*Math.sin(phase));
  }
 });}
}
