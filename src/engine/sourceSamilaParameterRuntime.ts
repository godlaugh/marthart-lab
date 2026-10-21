import {isJavaBlank} from './sourceJavaText';
import {normalizeSourceSamilaParameterAction,type SourceSamilaParameterAction,type SourceSamilaParameterConfiguration} from './sourceSamilaParameter';
import {sourceEase} from './sourceEasing';
interface Entry extends SourceSamilaParameterConfiguration {middle:number;amplitude:number;phase:number;}
interface Child {kind:'start'|'stop';entries:Entry[];runtime:number;duration:number;easing:string;finished:boolean;}
const F=Math.fround,TAU=2*Math.PI;
/** SamilaParamAnimation is a clip-local phase owner, not SurfaceParameterAnimator.
 * Every child's constructor captures the same initial scene parameter map. */
export class SourceSamilaParameterRuntime {
 private readonly initial:Readonly<Record<string,number>>;
 private readonly values:Record<string,number>;
 private children:Child[]=[];
 private drift:Entry[]=[];
 private writes=0;
 constructor(initial:Readonly<Record<string,number>>,private readonly reserve:(units:number)=>void){
  if(Object.values(initial).some(v=>!Number.isFinite(v)))throw Error('源 Samila 初始参数必须有限');
  this.initial={...initial};this.values={...initial};
 }
 get writeRevision(){return this.writes;}
 snapshot(){return{parameters:{...this.values},writeRevision:this.writes};}
 private entry(p:SourceSamilaParameterConfiguration):Entry {
  const middle=(p.min+p.max)*.5,amplitude=(p.max-p.min)*.5,value=Math.min(p.max,Math.max(p.min,Object.hasOwn(this.initial,p.name)?this.initial[p.name]:p.min));
  let phase=amplitude<=1e-6?0:Math.asin(Math.max(-1,Math.min(1,(value-middle)/amplitude)));
  if(amplitude>1e-6&&p.step<0)phase=Math.PI-phase;
  return{...p,middle,amplitude,phase};
 }
 begin(actions:readonly SourceSamilaParameterAction[],duration:number,easing:string):void {
  const narrowed=F(duration);if(!Number.isFinite(narrowed))throw Error('源 Samila 参数片段时长必须为有限 Float32');sourceEase(easing,0);
  this.children=actions.map(action=>{const parsed=normalizeSourceSamilaParameterAction(action);if(!parsed.ok)throw Error(parsed.error.reason);this.reserve(1+parsed.value.parameters.length);return{kind:parsed.value.kind,entries:parsed.value.parameters.map(p=>this.entry(p)),runtime:0,duration:narrowed,easing,finished:false};});
 }
 write(name:string,value:number):void {
  // Mobject.updateParameter ignores null/blank names, but permits new names.
  if(isJavaBlank(name))return;if(!Number.isFinite(value))throw Error('源 Samila 参数动画产生非有限数值');
  Object.defineProperty(this.values,name,{value,writable:true,enumerable:true,configurable:true});this.writes++;if(!Number.isSafeInteger(this.writes))throw Error('源 Samila 参数写入计数超出容量');
 }
 private advance(entry:Entry,dt:number,gain:number):void {
  this.reserve(1);
  if(entry.amplitude<=1e-6){this.write(entry.name,entry.min);return;}
  let phase=entry.phase+((Math.abs(entry.step)*gain)/entry.amplitude)*(dt*60);
  if(!Number.isFinite(phase))throw Error('源 Samila 参数相位溢出');
  while(phase>TAU){this.reserve(1);const next=phase-TAU;if(next===phase)throw Error('源 Samila 参数相位约简无法推进');phase=next;}
  while(phase<0){this.reserve(1);const next=phase+TAU;if(next===phase)throw Error('源 Samila 参数相位约简无法推进');phase=next;}
  entry.phase=phase;this.write(entry.name,entry.middle+entry.amplitude*Math.sin(phase));
 }
 /** AnimationGroup passes raw clipped dt to each child, not group easing. */
 advanceChildren(dt:number):void {
  dt=F(dt);if(!Number.isFinite(dt))throw Error('源 Samila 参数帧间隔无效');
  for(const child of this.children){this.reserve(1);if(child.finished)continue;child.runtime=F(child.runtime+dt);
   if(!Number.isFinite(child.runtime))throw Error('源 Samila 参数时间溢出');
   const progress=child.duration<=0?1:Math.min(F(child.runtime/child.duration),1),eased=sourceEase(child.easing,progress);
   if(child.kind==='start')for(const entry of child.entries)this.advance(entry,Math.max(dt,0),eased);
   if(child.runtime>=child.duration){child.finished=true;if(child.kind==='stop')this.drift=[];else if(child.entries.length)this.drift=child.entries.map(entry=>({...entry}));}
  }
 }
 /** Scene calls Mobject after child finish: start's completion frame drifts
  * once more, while stop's completion frame has already cleared all drift. */
 update(dt:number):void {dt=F(dt);if(!Number.isFinite(dt))throw Error('源 Samila 漂移帧间隔无效');if(dt>0)for(const entry of this.drift)this.advance(entry,dt,1);}
}
