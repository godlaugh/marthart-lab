import {parseSourcePerlinParameterAction,SourcePerlinParameterFailure,SOURCE_PERLIN_PARAMETER_NAMES,SOURCE_PERLIN_PARAMETER_DEFAULTS,type SourcePerlinParameterAction,type SourcePerlinParameterConfiguration,type SourcePerlinParameterName} from './sourcePerlinParameterConfig';

export type SourcePerlinParameterValues=Readonly<Record<SourcePerlinParameterName,number>>;
export type SourcePerlinBackend='cpu'|'gpu';
export type SourcePerlinFieldEffect='rebuild-angle'|'dirty'|'rebuild-curves-if-needed';
export interface SourcePerlinParameterOptions {
 readonly initial:SourcePerlinParameterValues;
 readonly backend:SourcePerlinBackend;
 readonly style:'particles'|'field-curves';
 readonly fieldDimensions?:readonly [number,number];
 readonly isCancelled?:()=>boolean;
 /** Geometry remains owned by the field consumer. Events occur after the
  * scalar write, and stop requests can rebuild before the next frame update. */
 readonly onFieldEffect?:(effect:SourcePerlinFieldEffect,values:SourcePerlinParameterValues)=>void;
}
export class SourcePerlinParameterRuntimeError extends Error {
 constructor(readonly code:'input'|'capacity'|'cancelled'|'failed',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourcePerlinParameterRuntimeError';}
}
interface Config extends SourcePerlinParameterConfiguration {phase:number;}
interface Child {kind:'start'|'stop';parameters:Config[];finished:boolean;}
interface Drift extends Config {running:boolean;}
const F=Math.fround,TAU=2*Math.PI,EPS=F(1e-6),NAMES=SOURCE_PERLIN_PARAMETER_NAMES;
const floors:Readonly<Record<SourcePerlinParameterName,number>>={noise_offset:-1,noise_scale:F(.0001),curve_noise_scale:F(.01),curve_angle_scale:F(.1)};
const finite=(value:number)=>{if(!Number.isFinite(value))throw new SourcePerlinParameterRuntimeError('input','Perlin 参数运算产生非有限数值');return value;};
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));

/** Specialized Perlin parameter lifecycle, not SurfaceParameterAnimator.
 * Queue owns begin/interpolate; Mobject owns update after gradients advance.
 * No noise, particle positions or framebuffer parity is implied by this owner. */
export class SourcePerlinParameterRuntime {
 private readonly values:Record<SourcePerlinParameterName,number>;
 private readonly drifts:Record<SourcePerlinParameterName,Drift>;
 private children:Child[]=[];
 private active=false;
 private failed=false;
 private work=0;
 constructor(private readonly options:SourcePerlinParameterOptions){
  if(!['cpu','gpu'].includes(options.backend)||!['particles','field-curves'].includes(options.style))throw new SourcePerlinParameterRuntimeError('input','Perlin 参数后端或样式无效');
  const dimensions=options.fieldDimensions;
  if(dimensions!==undefined&&(!Array.isArray(dimensions)||dimensions.length!==2||dimensions.some(v=>typeof v!=='number'||!Number.isFinite(F(v)))))throw new SourcePerlinParameterRuntimeError('input','Perlin 场尺寸需要两个有限源 float');
  this.options=Object.freeze({...options,...(dimensions?{fieldDimensions:Object.freeze([F(dimensions[0]),F(dimensions[1])] as const)}:{})});
  this.values={} as Record<SourcePerlinParameterName,number>;this.drifts={} as Record<SourcePerlinParameterName,Drift>;
  for(const name of NAMES){
   const value=finite(F(options.initial?.[name]));
   const [step,min,max]=SOURCE_PERLIN_PARAMETER_DEFAULTS[name];
   this.values[name]=value;this.drifts[name]={name,step,min,max,phase:0,running:false};
  }
 }
 private spend(){
  if(this.options.isCancelled?.())throw new SourcePerlinParameterRuntimeError('cancelled','Perlin 参数更新已取消');
  // Local work bound, mainly for native repeated phase subtraction. Modulo
  // would change rounding; reject oversized work instead of approximating it.
  if(++this.work>100_000)throw new SourcePerlinParameterRuntimeError('capacity','Perlin 参数单次更新超过本地 100000 步预算');
 }
 private run(f:()=>void){
  if(this.failed)throw new SourcePerlinParameterRuntimeError('failed','Perlin 参数状态先前失败，需要重建');
  this.work=0;try{this.spend();f();}catch(e){this.failed=true;throw e;}
 }
 snapshot(){return Object.freeze({values:Object.freeze({...this.values}),active:this.active,drifts:Object.freeze(NAMES.map(n=>Object.freeze({...this.drifts[n]}))),children:Object.freeze(this.children.map(c=>Object.freeze({...c,parameters:Object.freeze(c.parameters.map(p=>Object.freeze({...p})))})))});}
 /** PerlinNoiseField.isFieldCurveAnimating excludes ordinary noise_scale and
  * all color-gradient state. Consumers must not reinterpret drift snapshots. */
 get fieldCurvesAnimating():boolean{
  if(this.failed)throw new SourcePerlinParameterRuntimeError('failed','Perlin 参数状态先前失败，需要重建');
  return this.active||this.drifts.noise_offset.running||this.drifts.curve_noise_scale.running||this.drifts.curve_angle_scale.running;
 }
 private effect(effect:SourcePerlinFieldEffect){this.spend();this.options.onFieldEffect?.(effect,Object.freeze({...this.values}));}
 private write(name:SourcePerlinParameterName,input:number){
  this.spend();const value=finite(F(name==='noise_offset'?clamp(F(input),-1,1):Math.max(floors[name],F(input))));
  if(Math.abs(F(value-this.values[name]))<EPS)return;
  this.values[name]=value;
  if(this.options.style!=='field-curves'||name==='noise_scale')return;
  if(name!=='noise_offset'&&this.options.fieldDimensions?.every(v=>v>0))this.effect('rebuild-angle');
  this.effect('dirty');
 }
 private phaseFor(c:SourcePerlinParameterConfiguration){
  const half=(c.max-c.min)*.5;if(half<=1e-6)return 0;
  const mid=(c.min+c.max)*.5,q=clamp((clamp(this.values[c.name],c.min,c.max)-mid)/half,-1,1),phase=Math.asin(q);
  return c.step<0?Math.PI-phase:phase;
 }
 private wrap(value:number){
  value=finite(value);
  while(value>TAU){this.spend();const next=value-TAU;if(next===value)throw new SourcePerlinParameterRuntimeError('capacity','Perlin 相位无法逐步约简');value=next;}
  while(value<0){this.spend();const next=value+TAU;if(next===value)throw new SourcePerlinParameterRuntimeError('capacity','Perlin 相位无法逐步约简');value=next;}
  return value;
 }
 private stop(parameters:readonly Config[]){
  this.active=false;
  for(const name of parameters.length?parameters.map(p=>p.name):NAMES){
   this.spend();this.drifts[name].running=false;
   if(name!=='noise_scale')this.effect('rebuild-curves-if-needed');
  }
 }
 begin(actions:readonly SourcePerlinParameterAction[]):void {this.run(()=>{
  if(!Array.isArray(actions)||actions.length>64)throw new SourcePerlinParameterRuntimeError('capacity','Perlin 参数动作超过本地 64 项预算');
  const prepared=actions.map(a=>{this.spend();const p=parseSourcePerlinParameterAction(a);if(!p.ok)throw new SourcePerlinParameterFailure(p.error);return p.value;});
  this.children=prepared.map(a=>{
   const parameters=a.parameters.map(p=>({...p,phase:0}));
   if(a.kind==='stop')this.stop(parameters);
   else if(parameters.length){this.active=parameters.some(p=>p.name!=='noise_scale');for(const c of parameters)c.phase=this.phaseFor(c);}
   return{kind:a.kind,parameters,finished:false};
  });
 });}
 /** eased is the child easing, not necessarily the generic group's easing:
  * Perlin's duration<=0 branch uses ease(1), avoiding generic zero/zero. */
 interpolate(eased:number,finished:boolean,dt:number):void {this.run(()=>{
  eased=finite(F(eased));dt=Math.max(0,finite(F(dt)));
  for(const child of this.children){
   this.spend();if(child.finished)continue;
   if(child.kind==='start')for(const c of child.parameters){
    this.spend();const half=(c.max-c.min)*.5;
    if(half<=1e-6)this.write(c.name,c.min);
    else{c.phase=this.wrap(c.phase+((Math.abs(c.step)*eased)/half)*(dt*60));this.write(c.name,(c.min+c.max)*.5+half*Math.sin(c.phase));}
   }
   if(finished){
    if(child.kind==='stop')this.stop(child.parameters);
    else if(child.parameters.length){this.active=false;for(const c of child.parameters){this.spend();this.drifts[c.name]={...c,running:true};}}
    child.finished=true;
   }
  }
 });}
 update(dt:number):void {this.run(()=>{
  dt=Math.max(0,finite(F(dt)));if(this.options.backend==='gpu')return;
  const names:readonly SourcePerlinParameterName[]=this.options.style==='field-curves'?['noise_scale','noise_offset','curve_noise_scale','curve_angle_scale']:['noise_scale'];
  for(const name of names){
   this.spend();const c=this.drifts[name];if(!c.running)continue;
   const half=(c.max-c.min)*.5;
   if(half<=(name==='noise_offset'?1e-6:1e-9))this.write(name,c.min);
   else{c.phase=this.wrap(c.phase+((Math.abs(c.step)/half)*dt)*60);this.write(name,(c.min+c.max)*.5+half*Math.sin(c.phase));}
  }
  if(this.options.style==='field-curves')this.effect('rebuild-curves-if-needed');
 });}
}
