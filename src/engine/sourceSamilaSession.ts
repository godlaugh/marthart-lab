import {SourceSceneHostClock,validateSourceSceneClockRequest,type SourceSceneClockRequest} from './sourceSceneHostClock';
import type {GenerateContext,Palette,SceneDocument,SceneOutput} from '../types';
import {SOURCE_SAMILA_APPEARANCE_FIELDS} from './sourceSamilaFields';
import {sourceSamilaSceneIdentity,sourceSamilaApplyIdentity,SOURCE_SAMILA_HOT_SETTINGS as HOT_SETTINGS} from './sourceSamilaIdentity';
import {prepareIteratedFrame,type IteratedFrameJob} from '../scenes/iteratedDensity';
import {IteratedDensityGpu,iteratedGpuBytes,type IteratedGpuOptions,type IteratedGpuFacts} from './iteratedDensityGpu';
import {GenerationCleanupState} from './generationCleanup';
import {SourceSamilaRandomSource,prepareSourceSamilaLiveBatch,usesSourceSamilaSampling,validateSourceSamilaSampling} from './sourceSamilaSampling';
import {SOURCE_SAMILA_PRESENTATION_MODEL,usesSourceSamilaPresentation,validateSourceSamilaPresentation,sourceSamilaDisplayTransform} from './sourceSamilaPresentation';
import {prepareSourceSamilaSplat,validateSourceSamilaSplat,sourceSamilaFloat,sourceSamilaPointDiameter,sourceSamilaTrailDecay} from './sourceSamilaSplat';
import {SourceSamilaTimelineSession,usesSourceSamilaTimeline,type SourceSamilaFrame} from './sourceSamilaReplay';
import {prepareSamilaView,parseSamilaCamera,SAMILA_CAMERA_MODEL,type PreparedSamilaView} from './samilaCamera';
import {readSamilaViewport} from './samilaViewport';
import {samilaNdcSamplingRotation} from './samilaProjection';
import {samilaParametersChanged,SAMILA_HISTORY_CEILING} from './samilaHistory';
import {prepareDensityTone,type DensityToneJob} from './density';
import {prepareSourcePausedCaptureSize} from './sourcePausedCaptureSize';
import {exactRasterDimensions} from './rasterDimensions';
import {sourceSamilaPaletteRuntimeScene} from './sourceSamilaPaletteEditing';

export interface SourceSamilaLiveContext {sessionId:string;pixelDensity:number;dirtyRevision?:number;runtimeRevision?:number;parameterRevisions?:Readonly<Record<string,number>>;clock?:SourceSceneClockRequest;}
export interface SourceSamilaRuntimeFacts {sceneTime:number;rawDt:number;activeDt:number;queueIndex:number;queueComplete:boolean;parameterWriteRevision:number;phi:number;theta:number;gamma:number;paused:boolean;updates:number;clockSource:'worker-wall-clock'|'page-wall-clock'|'injected';}
export type SourceSamilaHotAction=
 | {kind:'parameter';name:string;value:number}
 | {kind:'rotation';value:number}
 | {kind:'transform';scaleX:number;scaleY:number;offsetX:number;offsetY:number}
 | {kind:'batchSize';value:number}
 | {kind:'palette';value:Palette};
export type SourceSamilaLiveOutput=Extract<SceneOutput,{type:'raster'}>;
export interface SourceSamilaDisplayBudget {job:IteratedFrameJob;width:number;height:number;additionalBytes:number;stateBytes:number;}
export interface SourceSamilaSessionOptions {
 samilaSeedProvider?:()=>number;
 hostClock?:{now:()=>number;source:'page-wall-clock'|'worker-wall-clock'};
 /** An external backend owns its own admission limit. Omission selects the
  * existing WebGL working-set budget; it is not a native-backend guarantee. */
 admitDisplay?:(budget:SourceSamilaDisplayBudget)=>void;
}
export interface SourceSamilaOperation {readonly kind:'primary'|'capture';readonly resetRequired:boolean;}
/** The reference itself is a one-use transaction token. Backends consume the
 * prepared producer inputs and must not mutate them or resubmit a failed draw. */
export interface SourceSamilaPreparedDisplay {readonly job:IteratedFrameJob;readonly options:IteratedGpuOptions;readonly tone:DensityToneJob;readonly view:PreparedSamilaView;}
export interface SourceSamilaDisplayResult {
 facts:IteratedGpuFacts;
 shown:{pixels:Uint8ClampedArray;occupiedPixels:number;maxCount:number;toneBackend:'cpu'|'webgl2'|'native';warnings:string[]};
 sourcePixelRenderer?:SourceSamilaLiveOutput['sourcePixelRenderer'];
}
interface DisplayStage {context:GenerateContext;target:'primary'|'offscreen';additionalBytes:number;}
interface PendingDisplay {prepared:SourceSamilaPreparedDisplay;context:GenerateContext;target:'primary'|'offscreen';clear:boolean;changed:boolean;anchor:number;completedPasses:number;parameters:Record<string,number>;}
interface ActiveOperation {token:SourceSamilaOperation;stages:DisplayStage[];outputs:SourceSamilaLiveOutput[];completed:Completed;pending?:PendingDisplay;}

const LIMIT=768*1024*1024,F=Math.fround;
const RUNTIME_LIMITS:Record<string,readonly[number,number]>={normalizedBrightness:[0,1],normalizedContrast:[.1,2],normalizedGamma:[.1,10],normalizedDynamicRange:[.1,1],normalizedSaturation:[0,1],colorSpeed:[.1,2],colorPhase:[0,360]};
function appliedRuntimeSettings(scene:SceneDocument):void {
 for(const [source,field]of Object.entries(SOURCE_SAMILA_APPEARANCE_FIELDS)){
  if(source==='trail_lifetime')continue;const value=sourceSamilaFloat(scene.settings,field.key,field.base),limit=RUNTIME_LIMITS[field.key];
  scene.settings[field.key]=limit?F(Math.max(F(limit[0]),Math.min(F(limit[1]),value))):value;
 }
}
const cancel=(c:GenerateContext)=>{if(c.isCancelled?.())throw new DOMException('Samila 热显示已取消','AbortError');};
const copy=<T>(value:T):T=>structuredClone(value);
function context(c:GenerateContext):SourceSamilaLiveContext {
 const value=c.samilaLive;
 if(!value||typeof value.sessionId!=='string'||!value.sessionId.length||!Number.isSafeInteger(value.pixelDensity)||value.pixelDensity<1||value.dirtyRevision!==undefined&&(!Number.isSafeInteger(value.dirtyRevision)||value.dirtyRevision<0))throw Error('Samila 热会话上下文无效');
 if(value.runtimeRevision!==undefined&&(!Number.isSafeInteger(value.runtimeRevision)||value.runtimeRevision<0))throw Error('Samila 运行设置版本无效');
 if(value.parameterRevisions!==undefined&&(!value.parameterRevisions||typeof value.parameterRevisions!=='object'||Array.isArray(value.parameterRevisions)||Object.values(value.parameterRevisions).some(v=>!Number.isSafeInteger(v)||v<1)))throw Error('Samila 参数写入版本无效');
 if(value.clock!==undefined)validateSourceSceneClockRequest(value.clock);
 if(!Number.isFinite(c.time)||!value.clock&&(c.time<0||c.time>86400))throw Error('Samila 热会话时间无效');return value;
}
function validate(scene:SceneDocument,c:GenerateContext):void {
 context(c);if(!usesSourceSamilaSampling(scene)||!usesSourceSamilaPresentation(scene)||!usesSourceSamilaTimeline(scene))throw Error('Samila 热显示需要完整源采样、呈现和源队列配置');
 if(Object.keys(context(c).parameterRevisions??{}).some(name=>!Object.hasOwn(scene.parameters,name)))throw Error('Samila 参数写入版本只能引用既有参数');
 validateSourceSamilaSampling(scene);validateSourceSamilaPresentation(scene);validateSourceSamilaSplat(scene);
 if(scene.settings.iteratedBackend==='cpu')throw Error('Samila 热显示需要 WebGL2；不能用冷 CPU 重放替换现有墨迹');
 prepareIteratedFrame(scene,c.time,0);exactRasterDimensions(c);cancel(c);
}
interface Completed {context:GenerateContext;identity:string;width:number;height:number;}
/** One hot mobject owner. Explicit host timing advances the owned source queue;
 * omitted timing retains fixed replay compatibility. Every display mutates ink. */
export class SourceSamilaSession {
 private gpu?:IteratedDensityGpu;
 private readonly random:SourceSamilaRandomSource;
 private readonly cleanup=new GenerationCleanupState();
 private hostClock?:SourceSceneHostClock<'worker-wall-clock'|'page-wall-clock'>;private runtimeFrame?:SourceSamilaFrame;
 private authored?:SceneDocument;private current?:SceneDocument;private timeline?:SourceSamilaTimelineSession;
 private sessionId='';private structure='';private acknowledged:Record<string,number>={};
 private dirty=true;private dirtyRevision=0;private runtimeRevision=0;private parameterRevisions:Readonly<Record<string,number>>={};private writeRevision=0;private anchor?:number;
 private width=0;private height=0;private count=0;private displayIndex=0;private passes=0;private time=0;private theta=0;
 private trailDecay=1;private runtimeSettingsApplied=false;
 private steps=0;private accepted=0;private clipped=0;private invalid=0;private clears=0;
 private completed?:Completed;private busy=false;private failed=false;private active?:ActiveOperation;
 constructor(private readonly options:SourceSamilaSessionOptions={}){this.random=new SourceSamilaRandomSource({nextSeed:options.samilaSeedProvider});}
 /** Revoke pending tokens immediately, before asynchronous resource cleanup.
  * It deliberately retains semantic/resource ownership until reset succeeds. */
 invalidate():void {this.active=undefined;this.busy=false;this.completed=undefined;this.failed=true;}
 reset(failures:readonly unknown[]=[]):void {
  this.invalidate();
  this.cleanup.reset(()=>{this.disposeGpu();this.clearState();this.failed=false;},failures);
 }
 private disposeGpu():void {this.gpu?.dispose();this.gpu=undefined;}
 private clearState():void {
  this.timeline?.reset();this.timeline=undefined;this.hostClock=undefined;this.runtimeFrame=undefined;this.authored=undefined;this.current=undefined;this.sessionId='';this.structure='';this.acknowledged={};this.dirty=true;this.dirtyRevision=0;this.runtimeRevision=0;this.parameterRevisions={};this.writeRevision=0;this.anchor=undefined;this.trailDecay=1;this.runtimeSettingsApplied=false;this.width=0;this.height=0;this.count=0;this.displayIndex=0;this.passes=0;this.time=0;this.theta=0;this.steps=0;this.accepted=0;this.clipped=0;this.invalid=0;this.clears=0;this.completed=undefined;
 }
 diagnostics(){return{runtime:this.runtimeFacts(),hostClock:this.hostClock?.diagnostics(),sessionId:this.sessionId,displayIndex:this.displayIndex,accumulationPasses:this.passes,anchorTheta:this.anchor,dirty:this.dirty,parameterSnapshot:{...this.acknowledged},parameters:{...this.current?.parameters},width:this.width,height:this.height,clears:this.clears,failed:this.failed,random:this.random.diagnostics(),gpu:this.gpu?.diagnostics(),retainedBytes:(this.gpu?.diagnostics().retainedBytes??0)+this.stateBytes()};}
 private stateBytes():number{if(!this.current&&!this.authored)return 0;return (this.authored?JSON.stringify(this.authored).length*2:0)+(this.current?JSON.stringify(this.current).length*2:0)+this.structure.length*2+JSON.stringify(this.acknowledged).length*2+JSON.stringify(this.parameterRevisions).length*2+(this.completed?.identity.length??0)*2;}
 snapshotInk():Float32Array {if(this.failed||!this.gpu)throw Error('Samila 热墨迹不可读取');if(this.diagnostics().retainedBytes+this.width*this.height*16>LIMIT)throw Error('Samila 热墨迹复制超过 768 MiB');return this.gpu.readback();}
 private replace(scene:SceneDocument,c:GenerateContext):void {
  if(context(c).clock&&(c.time<0||c.time>86400))throw Error('Samila 本地重建起点需要 0–86400 秒');
  this.clearState();this.authored=copy(scene);this.current=copy(scene);this.sessionId=context(c).sessionId;this.structure=sourceSamilaApplyIdentity(scene);this.acknowledged={...scene.parameters};this.trailDecay=sourceSamilaTrailDecay(scene.settings);this.theta=F(parseSamilaCamera(scene).theta);this.timeline=new SourceSamilaTimelineSession(copy(scene),Boolean(context(c).clock));if(context(c).clock){this.runtimeFrame=c.time>0?this.timeline.reconstruct(c.time):this.timeline.snapshot();this.hostClock=new SourceSceneHostClock(context(c).clock!.paused,this.runtimeFrame.camera,this.options.hostClock?.now,this.options.hostClock?.source);this.current.parameters={...this.runtimeFrame.parameters};this.theta=F(this.runtimeFrame.camera.theta);this.time=this.runtimeFrame.sceneTime;}this.dirtyRevision=context(c).dirtyRevision??0;this.runtimeRevision=context(c).runtimeRevision??0;this.parameterRevisions=copy(context(c).parameterRevisions??{});
  // A history checkpoint may reconstruct effective hot settings, distinct from
  // explicit source Reset/Apply which starts a new context at revision zero.
  if(this.runtimeRevision){appliedRuntimeSettings(this.current);this.runtimeSettingsApplied=true;}
 }
 applyHot(action:SourceSamilaHotAction):void {
  if(this.busy||this.failed||!this.current)throw Error('Samila 热操作需要已初始化且空闲的会话');
  this.applyAction(action);this.completed=undefined;
 }
 private applyAction(action:SourceSamilaHotAction):void {
  const scene=this.current!;
  if(action.kind==='parameter'){
   if(!Object.hasOwn(scene.parameters,action.name)||!Number.isFinite(action.value))throw Error('Samila 热参数需要既有名称与有限值；新增参数需要完整应用');
   this.timeline!.writeParameter(action.name,action.value);scene.parameters={...scene.parameters,[action.name]:action.value};this.dirty=true;
  }else if(action.kind==='palette'){
   const next={...scene,palette:copy(action.value)};validateSourceSamilaSplat(next);scene.palette=next.palette;this.dirty=true;
  }else if(action.kind==='transform'){
   const settings={...scene.settings};for(const key of ['scaleX','scaleY','offsetX','offsetY'] as const)settings[key]=sourceSamilaFloat({[key]:action[key]},key,0);
   scene.settings=settings;this.dirty=true;
  }else if(action.kind==='rotation'){scene.settings.rotation=sourceSamilaFloat({rotation:action.value},'rotation',0);this.dirty=true;
  }else if(action.kind==='batchSize'){
   if(!Number.isSafeInteger(action.value)||action.value<1||action.value>8_000_000)throw Error('Samila 热批次必须为 1–8000000');
   if(scene.settings.batchSize!==action.value){scene.settings.batchSize=action.value;this.dirty=true;}
  }else throw Error('未知 Samila 热操作');
 }
 private needsReplacement(scene:SceneDocument,c:GenerateContext):boolean {
  const live=context(c);return !this.current||this.sessionId!==live.sessionId||this.structure!==sourceSamilaApplyIdentity(scene)||Boolean(live.clock)!==Boolean(this.hostClock)||!live.clock&&c.time<this.time;
 }
 private sync(scene:SceneDocument,c:GenerateContext):void {
  const live=context(c);
  if(this.needsReplacement(scene,c))this.replace(scene,c);
  else{
   const before=this.authored!,next=this.current!,oldColorSpeed=sourceSamilaFloat(next.settings,'colorSpeed',.22),oldColorPhase=sourceSamilaFloat(next.settings,'colorPhase',180),runtimeRevision=live.runtimeRevision??0;if(runtimeRevision<this.runtimeRevision)throw Error('Samila 运行设置版本倒退；需要新的会话');let runtimeSettingsChanged=runtimeRevision!==this.runtimeRevision;
   const parameterRevisions=live.parameterRevisions??{};
   for(const [name,revision]of Object.entries(this.parameterRevisions))if((parameterRevisions[name]??0)<revision)throw Error('Samila 参数写入版本倒退；需要新的会话');
   for(const [name,value]of Object.entries(scene.parameters))if(!Object.is(before.parameters[name],value)||(parameterRevisions[name]??0)>(this.parameterRevisions[name]??0))this.applyAction({kind:'parameter',name,value});
   this.parameterRevisions=copy(parameterRevisions);
   for(const key of HOT_SETTINGS){const value=scene.settings[key];if(Object.is(before.settings[key],value))continue;
    if(key==='rotation')this.applyAction({kind:'rotation',value:sourceSamilaFloat(scene.settings,key,0)});
    else if(key==='batchSize')this.applyAction({kind:'batchSize',value:Number(value??4096)});
    else if(['scaleX','scaleY','offsetX','offsetY'].includes(key)){next.settings[key]=sourceSamilaFloat(scene.settings,key,key.startsWith('scale')?.33:0);this.dirty=true;}
    else if(key==='samilaCameraTheta'){this.theta=sourceSamilaFloat(scene.settings,key,0);this.timeline!.writeTheta(this.theta);next.settings[key]=this.theta;}
    else{
     if(key==='samilaUsePaletteLut')this.dirty=true;else runtimeSettingsChanged=true;
     if(value===undefined)delete next.settings[key];else next.settings[key]=value;
    }
   }
   if(runtimeSettingsChanged){
    // One native setter receives the entire group: editing background can also
    // clamp a previously imported out-of-range phase/gamma. Constructor values
    // remain literal until this explicit local hot-authoring operation.
    appliedRuntimeSettings(next);
    this.runtimeSettingsApplied=true;
    if(Math.abs(F(Number(next.settings.colorSpeed)-oldColorSpeed))>F(1e-6)||Math.abs(F(Number(next.settings.colorPhase)-oldColorPhase))>F(1e-6))this.dirty=true;
   }
   this.runtimeRevision=runtimeRevision;
   if(JSON.stringify(before.palette)!==JSON.stringify(scene.palette)){
    if(JSON.stringify({...before.palette,offset:0})===JSON.stringify({...scene.palette,offset:0}))next.palette={...next.palette,offset:scene.palette.offset};
    else this.applyAction({kind:'palette',value:scene.palette});
   }
   this.authored=copy(scene);
  }
  const revision=live.dirtyRevision??0;if(revision<this.dirtyRevision)throw Error('Samila 热操作版本倒退；需要新的会话');if(revision!==this.dirtyRevision){this.dirty=true;this.dirtyRevision=revision;}
  const frame=this.runtimeFrame=this.hostClock?this.timeline!.step(this.hostClock.update(live.clock!),live.clock!.paused):this.timeline!.evaluate(c.time);if(Object.keys(frame.parameters).some(name=>!Object.hasOwn(this.authored!.parameters,name)))throw Error('Samila 热时间线新增 uniform 尚不支持；请完整应用参数配置');this.current!.parameters={...frame.parameters};if(frame.parameterWriteRevision!==this.writeRevision){this.dirty=true;this.writeRevision=frame.parameterWriteRevision;}
  this.theta=F(frame.camera.theta);
  this.time=this.hostClock?frame.sceneTime:c.time;
  const viewport=readSamilaViewport(scene);
  if(viewport){const values={scaleX:viewport.scaleX,scaleY:viewport.scaleY,offsetX:viewport.offsetX,offsetY:viewport.offsetY};if(Object.entries(values).some(([key,value])=>this.current!.settings[key]!==value)){this.applyAction({kind:'transform',...values});}}
 }
 private preflight(scene:SceneDocument,c:GenerateContext,additionalBytes=0):{job:IteratedFrameJob;width:number;height:number} {
  const [width,height]=exactRasterDimensions(c),job=prepareIteratedFrame(scene,c.time,this.displayIndex);
  if(this.runtimeSettingsApplied)job.config.decay=Math.max(0,Math.min(1,F(this.trailDecay*sourceSamilaFloat(scene.settings,'accumulationDecay',1))));
  job.samilaSplat=prepareSourceSamilaSplat(scene,{width,height,primaryPixelHeight:c.samilaPrimaryPixelHeight,path:'points'});
  if(!Number.isSafeInteger(additionalBytes)||additionalBytes<0)throw Error('Samila 热显示附加内存必须为非负安全整数');
  if(this.options.admitDisplay)this.options.admitDisplay({job,width,height,additionalBytes,stateBytes:this.stateBytes()});
  else if(iteratedGpuBytes(job.config.count,width,height,2048,true,false,true,true,true)+width*height*4+this.stateBytes()+additionalBytes>LIMIT)throw Error('Samila 热显示超过 768 MiB 工作预算');
  const radius=Math.max(sourceSamilaPointDiameter(job.samilaSplat!),F(job.samilaSplat!.radius*F(.6)),F(.8));
  if(job.config.count*6*6>2_000_000_000||job.config.count*6*(Math.ceil(radius)+2)**2>2_000_000_000)throw Error('Samila 热显示超过 20 亿次工作预算');
  return{job,width,height};
 }
 private operation(token:SourceSamilaOperation):ActiveOperation {
  if(this.failed||!this.busy||!this.active||this.active.token!==token)throw Error('Samila 显示事务已失效');return this.active;
 }
 /** Preparation owns clock/dirty/queue changes, but does not consume a seed or
  * acknowledge an output. Validation failure before sync preserves completion. */
 begin(scene:SceneDocument,c:GenerateContext):SourceSamilaOperation {
  scene=sourceSamilaPaletteRuntimeScene(scene);
  if(this.busy)throw Error('Samila 热会话正在执行');this.cleanup.prepare();if(this.failed)throw Error('Samila 热会话失败，需要显式重置');
  validate(scene,c);if(this.hostClock&&context(c).clock&&this.sessionId===context(c).sessionId&&this.structure===sourceSamilaApplyIdentity(scene))this.hostClock.assertPaused(context(c).clock!.paused);this.preflight(scene,c);
  c={...c,samilaLive:copy(context(c))};
  const token:SourceSamilaOperation=Object.freeze({kind:'primary',resetRequired:this.needsReplacement(scene,c)});
  this.active={token,stages:[{context:c,target:'primary',additionalBytes:0}],outputs:[],completed:{context:c,identity:this.identity(scene,c),width:c.width,height:c.height}};this.busy=true;this.completed=undefined;
  try{this.sync(scene,c);return token;}catch(error){this.abort(token);throw error;}
 }
 beginCapture(scene:SceneDocument,c:GenerateContext,options:{additionalBytes?:number}={}):SourceSamilaOperation {
  scene=sourceSamilaPaletteRuntimeScene(scene);
  if(this.busy||this.failed||!this.completed||this.completed.identity!==this.identity(scene,c))throw Error('Samila 暂停截图需要相同已完成主画布');
  const additionalBytes=options.additionalBytes??0;if(!Number.isSafeInteger(additionalBytes)||additionalBytes<0)throw Error('Samila 暂停截图附加内存必须为非负安全整数');
  if(this.hostClock&&!this.hostClock.diagnostics().paused)throw Error('Samila 实时截图需要已暂停的会话');
  this.cleanup.prepare();const primary=this.completed,size=prepareSourcePausedCaptureSize(c,context(c).pixelDensity),exportContext={...c,samilaLive:copy(context(c)),width:size.width,height:size.height};
  this.preflight(this.current!,exportContext,additionalBytes+primary.width*primary.height*4);this.preflight(this.current!,primary.context,additionalBytes+size.width*size.height*4);cancel(c);
  const token:SourceSamilaOperation=Object.freeze({kind:'capture',resetRequired:false});
  this.active={token,stages:[{context:exportContext,target:'offscreen',additionalBytes:additionalBytes+primary.width*primary.height*4},{context:{...primary.context,isCancelled:c.isCancelled},target:'primary',additionalBytes:additionalBytes+size.width*size.height*4}],outputs:[],completed:primary};this.busy=true;this.completed=undefined;return token;
 }
 prepareDisplay(token:SourceSamilaOperation):SourceSamilaPreparedDisplay {
  const active=this.operation(token);if(active.pending)throw Error('Samila 显示事务已有未确认绘制');
  const stage=active.stages[active.outputs.length];if(!stage)throw Error('Samila 显示事务已完成全部绘制');
  let c=stage.context;const {target,additionalBytes}=stage;
  if(this.hostClock)c={...c,time:this.time};
  cancel(c);const scene=this.current!,{job,width,height}=this.preflight(scene,c,additionalBytes),resized=width!==this.width||height!==this.height;
  // Resize precedes comparison and clears only the dirty bit, not the anchor or
  // acknowledged map. A later significant parameter change can still reanchor.
  const dirty=resized?false:this.dirty;const changed=samilaParametersChanged(scene.parameters,this.acknowledged),clear=resized||changed||dirty;
  const anchor=this.anchor===undefined||changed||dirty?this.theta:this.anchor,passes=changed?6:1,completedPasses=(clear?0:this.passes)+passes;
  if(!Number.isSafeInteger(completedPasses)||completedPasses>0x7fffffff||!Number.isSafeInteger(this.displayIndex+1))throw Error('Samila 热显示计数超过整数容量');
  if(job.field.kind!=='samila'||!job.samilaProjection||!job.samilaSplat)throw Error('Samila 热显示缺少已解析字段');
  job.field={...job.field,rotation:samilaNdcSamplingRotation(job.field.rotation,anchor)};
  job.history={model:'bounded-v2',clear,passes,samples:job.config.count*passes,randomFrames:[],densityCeiling:SAMILA_HISTORY_CEILING,next:{parameters:changed?{...scene.parameters}:this.acknowledged,fieldKey:job.fieldKey}};
  const tone=prepareDensityTone(scene.palette,scene.settings,{kind:'samila',historyModel:'bounded-v2',width,height,completedPasses,baseBatchSize:job.config.count,alpha:job.config.alpha,combinedDecay:job.config.decay,splat:{model:job.samilaSplat.model,nominalRadius:job.samilaSplat.nominalRadius}});
  const view=prepareSamilaView({model:SAMILA_CAMERA_MODEL,time:c.time,theta:this.theta},anchor,width,height,c.time),{delta}=sourceSamilaDisplayTransform(view,width,height);view.delta=delta;view.cos=Math.cos(delta);view.sin=Math.sin(delta);
  cancel(c);job.samilaSampling=prepareSourceSamilaLiveBatch(this.random,this.displayIndex,job.config.count,passes);
  const options:IteratedGpuOptions={resetParticles:resized||this.count!==job.config.count,clearInk:clear,width,height,projection:'xy',padding:0,bounds:{minX:-1,maxX:1,minY:-1,maxY:1},isCancelled:c.isCancelled};
  const prepared:SourceSamilaPreparedDisplay=Object.freeze({job,options,tone,view});
  active.pending={prepared,context:c,target,clear,changed,anchor,completedPasses,parameters:{...scene.parameters}};return prepared;
 }
 /** The only point that acknowledges drawn ink. A late/duplicate token cannot
  * change counters, completed identity, or a replacement session. */
 commitDisplay(prepared:SourceSamilaPreparedDisplay,result:SourceSamilaDisplayResult):SourceSamilaLiveOutput {
  const active=this.active,pending=active?.pending;if(this.failed||!this.busy||!active||!pending||pending.prepared!==prepared)throw Error('Samila 显示确认令牌已失效');
  const {context:c,target,clear,changed,anchor,completedPasses}=pending,{job,view}=prepared,{width,height}=prepared.options,{facts,shown}=result,scene=this.current!;
  if(!job.samilaSplat||!job.samilaProjection)throw Error('Samila 显示确认缺少已解析字段');
  if(!(shown.pixels instanceof Uint8ClampedArray)||shown.pixels.byteLength!==width*height*4)throw Error('Samila 显示结果像素尺寸无效');cancel(c);
  if(clear){this.accepted=0;this.clipped=0;this.invalid=0;this.steps=0;this.clears++;}
  this.accepted+=facts.accepted;this.clipped+=facts.clipped;this.invalid+=facts.invalid;this.steps+=facts.steps;
  this.width=width;this.height=height;this.count=job.config.count;this.passes=completedPasses;this.anchor=anchor;this.dirty=false;if(changed)this.acknowledged={...pending.parameters};
  const index=this.displayIndex++;
  const output:SourceSamilaLiveOutput={type:'raster',cameraResolved:true,dimension:2,backend:shown.toneBackend==='native'?'native':'webgl2',width,height,pixels:shown.pixels,...(result.sourcePixelRenderer?{sourcePixelRenderer:result.sourcePixelRenderer}:{}),samilaLive:{sessionId:this.sessionId,target,displayIndex:index,accumulationPasses:this.passes,anchorTheta:anchor,parameterChanged:changed,cleared:clear,clock:this.hostClock?'realtime-source-queue':'fixed-source-queue',...(this.hostClock?{runtime:this.runtimeFacts()!}:{})},samilaSampling:job.samilaSampling,samilaSplat:{...job.samilaSplat},samilaView:view,samilaViewportTransform:{scaleX:job.samilaProjection.scaleX,scaleY:job.samilaProjection.scaleY,offsetX:job.samilaProjection.offsetX,offsetY:job.samilaProjection.offsetY},sourceSamilaPresentation:{model:SOURCE_SAMILA_PRESENTATION_MODEL,stage:'present-target-rgba8',display:'opaque-rgb-copy',backend:shown.toneBackend==='native'?'native':shown.toneBackend==='webgl2'?'webgl2':'cpu-derived'},density:{projection:'xy',bounds:facts.bounds,inputPoints:this.steps,examined:this.steps,accepted:this.accepted,clipped:this.clipped,invalid:this.invalid,occupiedPixels:shown.occupiedPixels,maxCount:shown.maxCount,toneBackend:shown.toneBackend,cancelled:false},temporal:{time:c.time,windowStart:0,frames:this.displayIndex,samplingFps:scene.timeline.fps,recordedPoints:this.steps,cacheHits:0},stats:{samples:facts.steps,generated:facts.accepted,invalid:facts.invalid},warnings:[...shown.warnings,this.hostClock?'Samila 热显示按本地宿主墙钟实际间隔推进源队列；暂停不推进，恢复重置时钟。未捕获原生宿主的事件时序、随机流或跨设备整图。':'Samila 热显示每次绘制使用新的运行时随机字；模拟时钟仍为本地固定源队列，未验证原生 UI 时序、随机流或跨设备整图一致性。']};
  active.outputs.push(output);active.pending=undefined;return output;
 }
 completePrimary(token:SourceSamilaOperation):SourceSamilaLiveOutput {
  const active=this.operation(token);if(token.kind!=='primary'||active.pending||active.outputs.length!==1)throw Error('Samila 主画布事务尚未完成');
  this.completed=active.completed;this.active=undefined;this.busy=false;return active.outputs[0];
 }
 completeCapture(token:SourceSamilaOperation):{capture:SourceSamilaLiveOutput;preview:SourceSamilaLiveOutput} {
  const active=this.operation(token);if(token.kind!=='capture'||active.pending||active.outputs.length!==2)throw Error('Samila 截图事务尚未完成');
  this.completed=active.completed;this.active=undefined;this.busy=false;return{capture:active.outputs[0],preview:active.outputs[1]};
 }
 abort(token:SourceSamilaOperation):void {if(this.active?.token===token)this.invalidate();}
 private drawSync(token:SourceSamilaOperation):void {
  const prepared=this.prepareDisplay(token);this.gpu??=new IteratedDensityGpu();
  const facts=this.gpu.step(prepared.job,prepared.options),shown=this.gpu.present(prepared.tone,prepared.options.isCancelled,prepared.view);this.commitDisplay(prepared,{facts,shown});
 }
 private runtimeFacts():SourceSamilaRuntimeFacts|undefined {
  const frame=this.runtimeFrame,host=this.hostClock?.diagnostics();if(!frame||!host)return;
  return{sceneTime:frame.sceneTime,rawDt:frame.rawDt,activeDt:frame.activeDt,queueIndex:frame.queueIndex,queueComplete:frame.queueComplete,parameterWriteRevision:frame.parameterWriteRevision,phi:frame.camera.phi,theta:frame.camera.theta,gamma:frame.camera.gamma,paused:host.paused,updates:frame.frameIndex+1,clockSource:host.clockSource};
 }
 /** Independent host transition: no simulation, ink, random word or draw. */
 setPaused(paused:boolean,timestampMs?:number):void {
  if(this.busy||this.failed||!this.hostClock||!this.timeline||!this.current)throw Error('Samila 播放操作需要已初始化且空闲的实时会话');
  this.cleanup.prepare();const frame=this.timeline.snapshot(),restore=this.hostClock.setPaused(paused,frame.camera,timestampMs);
  if(restore)this.timeline.writeAngles(restore);this.runtimeFrame=this.timeline.snapshot();this.theta=F(this.runtimeFrame.camera.theta);
  if(this.completed){const c=this.completed.context;c.samilaLive={...c.samilaLive!,clock:{...c.samilaLive!.clock!,paused}};this.completed.identity=this.identity(this.authored!,c);}
 }
 private identity(scene:SceneDocument,c:GenerateContext):string{return JSON.stringify([sourceSamilaSceneIdentity(scene),c.time,c.samilaLive,c.samilaPrimaryPixelHeight]);}
 matchesCompletedPrimary(scene:SceneDocument,c:GenerateContext):boolean {return !this.failed&&!!this.completed&&this.completed.identity===this.identity(scene,c)&&this.completed.width===c.width&&this.completed.height===c.height;}
 generate(scene:SceneDocument,c:GenerateContext):SourceSamilaLiveOutput {
  let token:SourceSamilaOperation|undefined;
  try{token=this.begin(scene,c);if(token.resetRequired)this.disposeGpu();this.drawSync(token);return this.completePrimary(token);}
  catch(error){if(token||this.failed)this.reset([error]);throw error;}
 }
 capturePaused(scene:SceneDocument,c:GenerateContext,options:{additionalBytes?:number}={}):{capture:SourceSamilaLiveOutput;preview:SourceSamilaLiveOutput} {
  const token=this.beginCapture(scene,c,options);
  try{this.drawSync(token);this.drawSync(token);return this.completeCapture(token);}
  catch(error){this.reset([error]);throw error;}
 }
}
