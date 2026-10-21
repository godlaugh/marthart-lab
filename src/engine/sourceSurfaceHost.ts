import {sourceSurfaceWorkBudget} from './sourceSurfaceWork';
import {SourceSurfaceGpuPoints} from './sourceSurfaceGpuPoints';
import {sourceSurfaceGpuFunction} from './sourceSurfaceGpuFunction';
import type {OrdinaryCameraParticleFrame,OrdinaryCameraTargetRequest,OrdinarySourceCameraParticles} from './ordinarySourceCameraTimeline';
import {parseSourceSurfaceMeshConfiguration,type SourceSurfaceMeshConfiguration} from './sourceSurfaceMeshConfig';
import {prepareSourceSurfaceFunction,type SourceSurfaceFunction} from './sourceSurfaceFunction';
import {createSourceSurfacePointRuntime,type SourceSurfaceParticles} from './sourceSurfaceParticles';
import {createSourceSurfaceMeshRuntime,type SourceSurfaceMeshRuntime} from './sourceSurfaceMeshRuntime';
import type {SourceSurfacePalette} from './sourceSurfaceColor';
import type {SourceGradientAction} from './sourceGradientRuntime';
import type {SourceSurfaceParameterAction,SourceSurfaceParameterConfiguration} from './sourceSurfaceParameterRuntime';
import type {SourceSurfaceMode} from './sourceSurfaceTransition';

export interface SourceSurfaceHostOptions {
 configuration:SourceSurfaceMeshConfiguration;
 equations:Readonly<Record<string,string>>;parameters:Readonly<Record<string,number>>;
 palette?:SourceSurfacePalette;frameRate:number;coverage:'all'|'tracked';isCancelled?:()=>boolean;
 /** Parent operation budget; omission bounds the entire fixed replay. */
 reserve?:(units:number)=>void;
}
export class SourceSurfaceHostError extends Error {
 constructor(readonly code:'input'|'unsupported'|'capacity'|'cancelled',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourceSurfaceHostError';}
}
type Surface={mode:'points';runtime:SourceSurfaceParticles|SourceSurfaceGpuPoints;function:SourceSurfaceFunction}|{mode:'mesh';runtime:SourceSurfaceMeshRuntime;function:SourceSurfaceFunction};
function fail(code:SourceSurfaceHostError['code'],message:string):never{throw new SourceSurfaceHostError(code,message);}

/** GenericSurfaceScene owns two distinct references: setupTimeline's initial
 * object and the current main object in the update/render list. Switching only
 * replaces the latter. Camera snapshots and overlay arithmetic belong to the
 * animation/scene clock; this owner never changes a bound target or camera.
 * Retained MathArt 1.7.8 GenericSurfaceScene.switchSurfaceMode PC31–113.
 */
export class SourceSurfaceHost implements OrdinarySourceCameraParticles {
 private readonly configuration:SourceSurfaceMeshConfiguration;
 private readonly initial:Surface;
 private current:Surface;
 private readonly prepared:ReturnType<typeof prepareSourceSurfaceFunction>;
 private readonly gpuFunction?:ReturnType<typeof sourceSurfaceGpuFunction>;
 private readonly palette?:SourceSurfacePalette;
 private readonly options:Pick<SourceSurfaceHostOptions,'frameRate'|'coverage'|'isCancelled'>;
 private readonly reserveBudget:(units:number)=>void;
 private used=0;private failed=false;private failure:unknown;
 private lastDisplay=-1;private lastUpdate=-1;private createdAt=0;private replacements=0;
 constructor(options:SourceSurfaceHostOptions){
  this.reserveBudget=options.reserve??sourceSurfaceWorkBudget();
  this.options={frameRate:options.frameRate,coverage:options.coverage,isCancelled:options.isCancelled};
  const parsed=parseSourceSurfaceMeshConfiguration(options.configuration);
  if(!parsed.ok)fail('input',`原版曲面宿主配置无效：${parsed.error.path.join('.')} ${parsed.error.reason}`);
  this.configuration=parsed.value;
  if(!Number.isFinite(options.frameRate)||options.frameRate<1||options.frameRate>120)fail('input','曲面宿主帧率必须在 1–120');
  if(options.coverage!=='all'&&options.coverage!=='tracked')fail('input','曲面宿主查询范围无效');
  const t=this.configuration.transform;
  this.prepared=prepareSourceSurfaceFunction({equations:options.equations,parameters:options.parameters,scales:[t.scaleX,t.scaleY,t.scaleZ],offsets:[t.offsetX,t.offsetY,t.offsetZ]});
  if(this.configuration.nativeBackend==='gpu')this.gpuFunction=sourceSurfaceGpuFunction(options.equations,options.parameters,this.configuration);
  this.palette=options.palette?{colors:[...options.palette.colors]}:undefined;
  this.initial=this.current=this.construct(this.configuration.mode,this.prepared.create());
 }
 private check(){if(this.failed)throw this.failure;if(this.options.isCancelled?.())fail('cancelled','曲面宿主回放已取消');}
 private guarded<T>(run:()=>T):T{try{this.check();return run();}catch(error){this.failed=true;this.failure=error;throw error;}}
 private reserve=(units:number)=>{this.check();this.used+=units;this.reserveBudget(units);};
 private construct(mode:SourceSurfaceMode,surfaceFunction:SourceSurfaceFunction):Surface {
  const common={configuration:this.configuration,surfaceFunction,operationsPerPosition:this.prepared.operations,frameRate:this.options.frameRate,palette:this.palette,coverage:this.options.coverage,gpuFunction:this.gpuFunction,isCancelled:this.options.isCancelled,reserve:this.reserve};
  if(this.gpuFunction&&mode==='points')return{mode:'points',runtime:new SourceSurfaceGpuPoints(common,this.gpuFunction),function:surfaceFunction};
  return mode==='mesh'?{mode,runtime:createSourceSurfaceMeshRuntime(common),function:surfaceFunction}:{mode,runtime:createSourceSurfacePointRuntime(common),function:surfaceFunction};
 }
 get mode():SourceSurfaceMode{return this.current.mode;}
 get generation():number{return this.replacements;}
 get workUnits():number{return this.used;}
 bind(request:OrdinaryCameraTargetRequest){return this.guarded(()=>{if(this.lastUpdate>=0||this.lastDisplay>=0||this.replacements)fail('input','曲面跟踪必须在宿主首次运行前绑定');return this.initial.runtime.bind(request);});}
 /** Called by the transition before this frame's main-object update. Construct
  * first; a local capacity/cancellation failure cannot publish a partial switch. */
 switchMode(mode:SourceSurfaceMode):void{this.guarded(()=>{
  if(mode!=='points'&&mode!=='mesh')fail('input','未知曲面模式');
  if(this.gpuFunction)fail('unsupported','原版 GPU 曲面不执行模式切换；导入应保留为等待');
  if(mode===this.current.mode)return;
  if(this.lastUpdate>this.lastDisplay)fail('input','曲面切换必须先于当前帧的对象更新');
  const replacement=this.construct(mode,this.current.function.recreate());
  this.current.runtime.retire();this.current=replacement;this.createdAt=this.lastDisplay+1;this.replacements++;
 });}
 /** MathArt.updateParameter targets the current function, while queue actions
  * remain bound to the initial object. Does not update particles or animators. */
 updateParameter(name:string,value:number):void{this.guarded(()=>{this.current.function.write(name,value);});}
 setRecordingTrails(enabled:boolean){this.guarded(()=>this.initial.runtime.setRecordingTrails(enabled));}
 beginGradientActions(actions:readonly SourceGradientAction[]){this.guarded(()=>this.initial.runtime.beginGradientActions(actions));}
 interpolateGradientActions(eased:number,finished:boolean){this.guarded(()=>this.initial.runtime.interpolateGradientActions(eased,finished));}
 beginParameterActions(actions:readonly SourceSurfaceParameterAction[]){this.guarded(()=>this.initial.runtime.beginParameterActions(actions));}
 interpolateParameterActions(eased:number,finished:boolean){this.guarded(()=>this.initial.runtime.interpolateParameterActions(eased,finished));}
 beginParameterClip(parameters:readonly ({name:string}&SourceSurfaceParameterConfiguration)[]){this.guarded(()=>this.initial.runtime.beginParameterClip(parameters));}
 finishParameterClip(){this.guarded(()=>this.initial.runtime.finishParameterClip());}
 update(frame:OrdinaryCameraParticleFrame){this.guarded(()=>{
  if(!Number.isInteger(frame.frameIndex)||frame.frameIndex!==this.lastDisplay+1||frame.frameIndex<=this.lastUpdate)fail('input','曲面宿主帧更新顺序无效');
  this.current.runtime.update({...frame,frameIndex:frame.frameIndex-this.createdAt});this.lastUpdate=frame.frameIndex;
 });}
 displayFrame(frameIndex:number,final:boolean){this.guarded(()=>{
  if(!Number.isInteger(frameIndex)||frameIndex<0||frameIndex<this.lastUpdate||frameIndex!==this.lastDisplay&&frameIndex!==this.lastDisplay+1||typeof final!=='boolean')fail('input','曲面宿主显示帧顺序无效');
  if(this.current.mode==='mesh')this.current.runtime.display(frameIndex-this.createdAt,1,final);
  this.lastDisplay=frameIndex;
 });}
 snapshot(){return this.guarded(()=>{
  if(this.lastDisplay<0||this.lastUpdate>this.lastDisplay)fail('input','曲面宿主需要完成显示帧后才能交付');
  if(this.options.coverage!=='all')fail('input','相机查询不能交付完整曲面画面');
  const facts={generation:this.replacements,frameIndex:this.lastDisplay,workUnits:this.used};
  if(this.current.runtime instanceof SourceSurfaceGpuPoints)return{...facts,mode:'points' as const,gpuPoints:this.current.runtime.snapshot()};
  return this.current.mode==='mesh'?{...facts,mode:'mesh' as const,mesh:this.current.runtime.snapshot()}:{...facts,mode:'points' as const,points:this.current.runtime.snapshot()};
 });}
}
