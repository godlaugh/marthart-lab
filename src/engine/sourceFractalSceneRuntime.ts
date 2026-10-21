import {SOURCE_FRACTAL_RETAINED_LIMITS} from './sourceFractalLimits';
import {SourceFractalSceneClock,type SourceFractalObjectState,type SourceFractalSceneClip} from './sourceFractalSceneClock';
import {SourceFractalParameterRuntime,type SourceFractalParameterAction} from './sourceFractalParameterRuntime';
import {SourceGradientRuntime,type SourceGradientAction,type SourceGradientFrame} from './sourceGradientRuntime';
import {createSourceFractalFormulaFromConfig,type SourceFractalFormulaConfiguration} from './sourceFractalFormulaRuntime';
import {sourceEase} from './sourceEasing';

export type SourceFractalRuntimeClip=
 |Exclude<SourceFractalSceneClip,{kind:'animate'}>
 |(Omit<Extract<SourceFractalSceneClip,{kind:'animate'}>,'grouped'>&{parameters?:readonly SourceFractalParameterAction[];gradient?:SourceGradientAction});
export interface SourceFractalSceneRuntimeConfiguration {
 readonly initial:SourceFractalObjectState;
 readonly formula:SourceFractalFormulaConfiguration;
 readonly gradient:SourceGradientFrame;
 readonly clips:readonly SourceFractalRuntimeClip[];
 readonly fps:number;
 readonly cameraAngles?:readonly [number,number,number];
}
export interface SourceFractalSceneRuntimeOptions {
 /** Shared request budget, including formula/phase iteration. */
 readonly reserve:(units:number)=>void;
}
const F=Math.fround;
/** Owns the three original mobject producers under the verified scene clock.
 * Formula ParamSet remains distinct from ordinary-animation native fields.
 * A registry write can remap unrelated native fields in the same update. */
export class SourceFractalSceneRuntime {
 readonly clock:SourceFractalSceneClock;
 private readonly formula;
 private readonly parameters:SourceFractalParameterRuntime;
 private readonly gradient:SourceGradientRuntime;
 private offsets:SourceGradientFrame;
 private current:SourceFractalObjectState;
 private readonly clips:readonly SourceFractalRuntimeClip[];
 constructor(configuration:SourceFractalSceneRuntimeConfiguration,options:SourceFractalSceneRuntimeOptions){
  if(!Number.isFinite(configuration.fps)||configuration.fps<1||configuration.fps>120||typeof options.reserve!=='function')throw Error('分形场景需要有效帧率与工作预算');
  if(!Array.isArray(configuration.clips)||configuration.clips.length>2000)throw Error('分形场景队列超过容量');
  let actions=0,nameCharacters=0;for(const clip of configuration.clips)if(clip.kind==='animate'){if(clip.parameters!==undefined&&!Array.isArray(clip.parameters))throw Error('分形参数动作需要数组');actions+=(clip.parameters?.length??0)+(clip.gradient?1:0);if(actions>SOURCE_FRACTAL_RETAINED_LIMITS.actions)throw Error('分形场景参数与渐变动作超过容量');for(const action of clip.parameters??[]){if(action.scope?.kind==='named')nameCharacters+=action.scope.name.length;if(nameCharacters>SOURCE_FRACTAL_RETAINED_LIMITS.nameCharacters)throw Error('分形参数名称超过字符预算');}}
  const fps=configuration.fps;this.clips=structuredClone(configuration.clips);
  this.formula=createSourceFractalFormulaFromConfig(configuration.formula);
  const native=this.formula.nativeState();
  this.current={...structuredClone(configuration.initial),bailout:native.bailout,juliaReal:native.julia[0],juliaImag:native.julia[1]};
  const offsets=configuration.gradient;
  if(!offsets||[offsets.palette,offsets.inside,offsets.outside].some(v=>!Number.isFinite(v)||!Number.isFinite(F(v))))throw Error('分形渐变初值需要有限 Float32');
  this.offsets={palette:F(offsets.palette),inside:F(offsets.inside),outside:F(offsets.outside)};
  this.parameters=new SourceFractalParameterRuntime({
   definition:name=>this.formula.definition(name),readScalar:name=>this.formula.readScalar(name),readComplex:name=>this.formula.readComplex(name),
   writeScalar:(name,value)=>{this.formula.writeScalar(name,value);this.copyNativeToObject();},
   writeComplex:(name,re,im)=>{this.formula.writeComplex(name,re,im);this.copyNativeToObject();},reserve:options.reserve,
  });
  this.gradient=new SourceGradientRuntime(()=>this.offsets,frame=>{
   // ComplexFractalMobject retains a component when double or F32 is nonfinite.
   const next={...this.offsets};for(const key of ['palette','inside','outside'] as const){const value=F(frame[key]);if(Number.isFinite(frame[key])&&Number.isFinite(value)&&value!==next[key])next[key]=value;}this.offsets=next;
  });
  this.clock=new SourceFractalSceneClock(this.current,this.clips.map(clip=>clip.kind==='animate'?{kind:clip.kind,duration:clip.duration,easing:clip.easing,targets:clip.targets,grouped:!!(clip.parameters?.length||clip.gradient)}:clip),{
   // Reset must recreate all owned registries through the runtime constructor.
   reset(){throw Error('请重建完整分形场景，不可只重置队列');},
   begin:(index,state)=>{
    this.acceptOrdinaryState(state);const clip=this.clips[index];if(clip.kind!=='animate')throw Error('分形动作片段身份错误');
    this.parameters.begin(clip.parameters??[]);this.gradient.begin(clip.gradient?[clip.gradient]:[]);
   },
   interpolate:(_index,runtime,duration,easing,finished,state)=>{
    this.acceptOrdinaryState(state);const eased=sourceEase(easing,Math.max(0,Math.min(1,F(runtime/duration))));
    this.parameters.interpolate(eased,finished);this.gradient.interpolate(eased,finished);
   },
   update:(phase,state)=>{
    this.acceptOrdinaryState(state);if(phase.dt>0){this.parameters.update(phase.dt,fps);this.gradient.update(phase.dt);}
   },
  },configuration.cameraAngles);
 }
 private acceptOrdinaryState(state:SourceFractalObjectState):void {
  this.current=state;const native=this.formula.nativeState();
  // Ordinary setters and registry mapping have different floors. Only copy an
  // actual ordinary write; reapplying a setter would corrupt mapped tiny bailout.
  if(!Object.is(native.bailout,state.bailout))this.formula.setBailout(state.bailout);
  if(!Object.is(native.julia[0],state.juliaReal)||!Object.is(native.julia[1],state.juliaImag))this.formula.setJuliaConstant(state.juliaReal,state.juliaImag);
 }
 private copyNativeToObject():void {
  const native=this.formula.nativeState();this.current.bailout=native.bailout;this.current.juliaReal=native.julia[0];this.current.juliaImag=native.julia[1];
 }
 snapshot(){
  const scene=this.clock.snapshot(); // Rejects any failed callback/partial frame.
  return{scene,formula:this.formula.snapshot(),parameters:this.parameters.snapshot(),gradient:this.gradient.snapshot(),offsets:{...this.offsets}};
 }
}
