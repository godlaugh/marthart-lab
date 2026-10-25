import type {SourceIteratedReplayBackend,SourceIteratedReplayAsyncBackend,SourceIteratedPresented} from './sourceIteratedReplayBackend';
import {symmetryPaletteColdAnchor,assertSymmetryPaletteRetention} from './sourceSymmetryPaletteEditing';
import {sourcePaletteRuntimeScene} from './sourcePaletteRuntimeScene';
import {sourceRecordingSize} from './sourceRecordingSize';
import {sourceIteratedParameterChanges} from './sourceIteratedParameterEdit';
import {navigateSourceViewportCamera,type SourceViewportNavigationEvent} from './sourceViewportNavigation';
import type {SourceQueueRecordingClock} from './sourceRecordingClock';
import {snapshotGenerationInput} from './generationInput';
import {planSourceIteratedRecording,assertSourceIteratedRecordingFrame} from './sourceIteratedRecording';
import {deriveSourceIteratedNormalization} from './sourceIteratedPresentation';
import type {GenerateContext,SceneDocument,SceneOutput} from '../types';
import {prepareIteratedFrame,prepareIteratedField} from '../scenes/iteratedDensity';
import {SourceIteratedTimelineSession,bindSourceIterationFrame,type SourceIteratedTimelineResult} from './sourceIteratedTimeline';
import {SourceIteratedReplaySession,sourceIteratedRenderFps,type SourceIteratedDisplayFacts} from './sourceIteratedReplaySession';
import {prepareSourceIterationFramePlan} from './sourceIterationFramePlan';
import {resetSourceSymmetryPointSize} from './sourceSymmetryConfig';
import {SourceSceneHostClock,validateSourceSceneClockRequest,type SourceSceneClockRequest} from './sourceSceneHostClock';
import {sourceIteratedLiveKind} from './sourceLivePreview';
import {prepareSourceMapTone} from './sourceMapPresentation';
import {sourceMapRuntimeColors} from './sourceMapRuntimeColors';
import {prepareSourceSymmetryTone} from './sourceSymmetryPresentation';
import {ordinarySourceCameraInitial,ordinarySourceCameraFrame,prepareOrdinarySourceFrame} from './ordinarySourceCamera';
import {prepareCapturedDensityCamera,prepareCapturedDensityView,type CapturedDensityAnchor} from './sourceDensityCamera';
import {prepareSourceDensitySplat,sourceDensitySplatPixelTests} from './sourceDensitySplat';
import {prepareSourcePausedCaptureSize} from './sourcePausedCaptureSize';
import type {PausedCaptureResult} from './generationProtocol';
import {exactRasterDimensions} from './rasterDimensions';
import {GenerationCleanupState} from './generationCleanup';
import {SOURCE_MAP_RUNTIME_SETTINGS,sourceIteratedApplyIdentity,sourceIteratedReplayIdentity,sourceIteratedSceneIdentity} from './sourceIteratedLiveIdentity';
import {hasSymmetryCustom} from './symmetryCustom';
import type {SourceProcessingHost} from './sourceProcessingHost';
import {beginSourceSymmetryProcessingFrame,beginSourceSymmetryProcessingRender,endSourceSymmetryProcessingFrame,endSourceSymmetryProcessingRender} from './sourceSymmetryProcessing';

export interface SourceIteratedLiveContext {
 sessionId:string;renderFps:number;clock:SourceSceneClockRequest;
 /** Explicit palette/transform edit sequence; equal-value edits still count. */
 replayRevision:number;
 /** Local fixed reconstruction on a new incarnation, not native seeking. */
 startAt?:number;
 /** Map native hot calls; equal-value calls remain observable events. */
 mapEdits?:{runtimeRevision:number;dotSizeRevision:number};
}
export interface SourceIteratedLiveFacts {
 sessionId:string;clock:'realtime-source-queue'|'fixed-source-queue';clockSource:'worker-wall-clock'|'page-wall-clock'|'injected'|'fixed-step';
 sceneTime:number;rawDt:number;activeDt:number;queueIndex:number;queueComplete:boolean;paused:boolean;
 objectUpdates:number;replayRevision:number;display:SourceIteratedDisplayFacts;
}
type Raster=Extract<SceneOutput,{type:'raster'}>;
export type SourceIteratedSessionOptions=(
 | {backend?:()=>SourceIteratedReplayBackend;asyncBackend?:never}
 | {backend?:never;asyncBackend:()=>SourceIteratedReplayAsyncBackend})&{symmetryDialect?:'native-gl41';hostClock?:{now:()=>number;source:'worker-wall-clock'|'page-wall-clock'}};
type DisplayResult={scene:SceneDocument;job:ReturnType<typeof prepareIteratedFrame>;sourceFrame:ReturnType<typeof ordinarySourceCameraFrame>;display:SourceIteratedDisplayFacts};
type RecordingStart={handle:object;scene:SceneDocument;context:ReturnType<typeof snapshotGenerationInput>;clock:SourceQueueRecordingClock;warmup:Raster};
type Effect=
 | {kind:'display';args:Parameters<SourceIteratedReplaySession['display']>}
 | {kind:'present';args:Parameters<SourceIteratedReplaySession['present']>}
 | {kind:'reset';failures?:readonly unknown[];keepProcessing?:boolean};
type Reply=SourceIteratedDisplayFacts|SourceIteratedPresented|void;
type Operation<T>=Generator<Effect,T,Reply>;
const identity=(value:unknown)=>JSON.stringify(value);
const cancel=(c:GenerateContext)=>{if(c.isCancelled?.())throw new DOMException('迭代场景 实时生成已取消','AbortError');};
function context(c:GenerateContext,family:'map'|'symmetry'):SourceIteratedLiveContext {
 const v=family==='map'?c.mapLive:c.symmetryLive;
 if(!v||typeof v.sessionId!=='string'||!v.sessionId.length||!Number.isSafeInteger(v.replayRevision)||v.replayRevision<0)throw Error('迭代场景 实时会话上下文无效');
 sourceIteratedRenderFps(v.renderFps);validateSourceSceneClockRequest(v.clock);
 if(v.startAt!==undefined&&(!Number.isFinite(v.startAt)||v.startAt<0||v.startAt>86400))throw Error('迭代场景 本地重建起点须为 0–86400 秒');
 if([c.samilaLive,c.symmetryLive,c.mapLive].filter(v=>v!==undefined).length!==1)throw Error('一次生成不能同时拥有两个实时场景');
 if(v.mapEdits!==undefined&&(!v.mapEdits||typeof v.mapEdits!=='object'||family!=='map'||![v.mapEdits.runtimeRevision,v.mapEdits.dotSizeRevision].every(n=>Number.isSafeInteger(n)&&n>=0)))throw Error('Map 热编辑事件序号无效');
 return v;
}
/** One actual display lifetime: queue, host clock, mathematical particles,
 * accumulation and captured camera stay together until explicit replacement. */
export class SourceIteratedSession {
 constructor(readonly family:'map'|'symmetry',private readonly backend:SourceIteratedSessionOptions={}){
  if(family!=='map'&&family!=='symmetry')throw Error('未知实时迭代场景');
  if(backend.backend&&backend.asyncBackend)throw Error('迭代场景不能同时拥有两个执行后端');
  if(backend.symmetryDialect&&!backend.asyncBackend)throw Error('原生自定义 Symmetry 需要异步执行后端');
 }
 private inFlight?:Promise<unknown>;private resetting?:Promise<void>;private asyncRevision=0;
 private get executing(){return this.busy||!!this.inFlight||!!this.resetting;}
 /** Only effects differ. Clock, capture ordering, applied construction and all
  * recording transitions are owned by the same operation in both drivers. */
 private run<T>(operation:Operation<T>):T {
  if(this.backend.asyncBackend)throw Error('异步迭代场景必须使用 Async 操作');
  let next=operation.next();
  while(!next.done){let reply:Reply=undefined;
   try{const effect=next.value;if(effect.kind==='reset')this.resetSync(effect.failures,effect.keepProcessing);else if(effect.kind==='display')reply=this.replay!.display(...effect.args);else reply=this.replay!.present(...effect.args);}
   catch(error){next=operation.throw(error);continue;}next=operation.next(reply);
  }return next.value;
 }
 private runAsync<T>(operation:(cancelled:()=>boolean)=>Operation<T>,isCancelled?:()=>boolean):Promise<T>{
  if(!this.backend.asyncBackend)return Promise.reject(Error('异步迭代场景缺少执行后端'));
  if(this.executing||this.failed)return Promise.reject(Error('异步迭代场景正在执行或需要显式重置'));
  const revision=this.asyncRevision,cancelled=()=>revision!==this.asyncRevision||Boolean(isCancelled?.());
  const pending=Promise.resolve().then(async()=>{
   const iterator=operation(cancelled);let next=iterator.next();
   while(!next.done){let reply:Reply=undefined;
    try{const effect=next.value;if(effect.kind==='reset')await this.releaseAsync(effect.failures,effect.keepProcessing);else if(effect.kind==='display')reply=await this.replay!.displayAsync(...effect.args);else reply=await this.replay!.presentAsync(...effect.args);}
    catch(error){next=iterator.throw(error);continue;}next=iterator.next(reply);
   }return next.value;
  });
  this.inFlight=pending;void pending.then(()=>{if(this.inFlight===pending)this.inFlight=undefined;},()=>{if(this.inFlight===pending)this.inFlight=undefined;});return pending;
 }
 private snapshot(scene:SceneDocument,c:GenerateContext){return{scene:structuredClone(scene),context:snapshotGenerationInput(c),isCancelled:c.isCancelled};}
 private *resetOperation(failures:readonly unknown[]=[],keepProcessing=false):Operation<void>{
  // A failed release is already a cleanup attempt. Preserve its owner and
  // error; only an explicit resetAsync may retry it.
  if(failures.length&&this.backend.asyncBackend&&this.failed)throw failures[0];
  yield{kind:'reset',failures,keepProcessing};
 }
 private async releaseAsync(failures:readonly unknown[]=[],keepProcessing=false):Promise<void>{
  this.failed=true;await this.replay?.resetAsync(failures);this.clear(keepProcessing);
 }
 /** Revoke pending output, wait for its ACK/cleanup, then release exactly this
  * owner. No transport abort: other native families may share its context. */
 resetAsync(failures:readonly unknown[]=[]):Promise<void>{
  if(!this.backend.asyncBackend){try{this.reset(failures);return Promise.resolve();}catch(error){return Promise.reject(error);}}
  if(this.resetting)return this.resetting;
  this.asyncRevision++;this.failed=true;const pending=this.inFlight;
  const cleanup=(async()=>{await pending?.catch(()=>{});await this.releaseAsync(failures);})();this.resetting=cleanup;
  void cleanup.then(()=>{if(this.resetting===cleanup)this.resetting=undefined;},()=>{if(this.resetting===cleanup)this.resetting=undefined;});return cleanup;
 }
 private live(c:GenerateContext){return this.family==='map'?c.mapLive:c.symmetryLive;}
 private tone(scene:SceneDocument,c:GenerateContext){return this.family==='map'?prepareSourceMapTone(scene,c):prepareSourceSymmetryTone(scene,c);}
 private runtimeRevision=0;private dotSizeRevision=0;private runtimePointSize?:number;
 private readonly cleanup=new GenerationCleanupState();
 private processing?:SourceProcessingHost;
 private timeline?:SourceIteratedTimelineSession;private replay?:SourceIteratedReplaySession;private clock?:SourceSceneHostClock<'worker-wall-clock'|'page-wall-clock'>;
 private applied?:SceneDocument;
 private particleConstruction?:Pick<SceneDocument,'mapSource'|'symmetrySource'>;
 private recording?:{handle:object;clock:SourceQueueRecordingClock;primary:GenerateContext;target:GenerateContext;next:number};
 private authored?:SceneDocument;private frame?:SourceIteratedTimelineResult;private anchor?:CapturedDensityAnchor;
 private sessionId='';private shape='';private startAt?:number;private revision=0;private busy=false;private failed=false;
 private invalidUnit?:'iteration'|'completed-pass';
 private steps=0;private accepted=0;private invalid=0;private clipped=0;private sampleInvalid=0;private deposited=0;private displays=0;
 private completed?:{context:GenerateContext;identity:string};private lastUpdatePaused=false;
 private requestSteps=0;private requestPixels=0;
 private clear(keepProcessing=false){if(!keepProcessing){this.processing?.dispose();this.processing=undefined;}this.replay=undefined;this.timeline?.reset();this.timeline=undefined;this.clock=undefined;this.authored=undefined;this.applied=undefined;this.particleConstruction=undefined;this.recording=undefined;this.completed=undefined;this.lastUpdatePaused=false;this.frame=undefined;this.anchor=undefined;this.sessionId='';this.shape='';this.startAt=undefined;this.revision=0;this.runtimeRevision=0;this.dotSizeRevision=0;this.runtimePointSize=undefined;this.invalidUnit=undefined;this.steps=0;this.accepted=0;this.invalid=0;this.clipped=0;this.sampleInvalid=0;this.deposited=0;this.displays=0;this.failed=false;}
 private resetSync(failures:readonly unknown[]=[],keepProcessing=false){if(this.backend.asyncBackend)throw Error('异步迭代场景必须使用 resetAsync');this.failed=true;this.cleanup.reset(()=>{this.replay?.reset();this.clear(keepProcessing);},failures);}
 reset(failures:readonly unknown[]=[]){this.resetSync(failures);}
 diagnostics(){return{...(this.processing?{processing:this.processing.diagnostics()}:{}),family:this.family,inFlight:!!this.inFlight,resetting:!!this.resetting,recording:this.recording?{next:this.recording.next,clock:{...this.recording.clock}}:undefined,runtimeRevision:this.runtimeRevision,dotSizeRevision:this.dotSizeRevision,runtimePointSize:this.runtimePointSize,failed:this.failed,sessionId:this.sessionId,displays:this.displays,steps:this.steps,clock:this.clock?.diagnostics(),replay:this.replay?.diagnostics(),frame:this.frame?structuredClone(this.frame):undefined,anchor:this.anchor?structuredClone(this.anchor):undefined,retainedBytes:(this.replay?.diagnostics().gpu.retainedBytes??0)+(this.authored?identity(this.authored).length*2:0)+(this.applied?identity(this.applied).length*2:0)+(this.particleConstruction?identity(this.particleConstruction).length*2:0)+this.shape.length*2+(this.completed?this.completed.identity.length*2:0)};}
 snapshotInk(){if(this.failed||!this.replay)throw Error('迭代场景 实时累积不可读');return this.replay.readback();}
 readParticles(){if(this.failed||!this.replay)throw Error('迭代场景 实时粒子不可读');return this.replay.readParticles();}
 setPaused(paused:boolean,timestampMs?:number){
  if(this.recording||this.executing||this.failed||!this.clock||!this.timeline)throw Error('迭代场景 播放控制需要已初始化且空闲的会话');
  this.cleanup.prepare();const restore=this.clock.setPaused(paused,this.timeline.snapshot().frame.camera,timestampMs);
  if(restore)this.timeline.writeAngles(restore);this.frame=this.timeline.snapshot();
  if(this.completed){this.live(this.completed.context)!.clock={...this.live(this.completed.context)!.clock,paused};this.completed.identity=this.captureIdentity(this.authored!,this.completed.context);}
 }
 /** A parameter control writes runtime uniforms, without update/display/reseed.
  * Applied recording config and constructor seed stay owned by initialization. */
 updateParameters(before:SceneDocument,next:SceneDocument,c:GenerateContext,writes?:readonly (readonly [string,number])[]){
  before=sourcePaletteRuntimeScene(before);next=sourcePaletteRuntimeScene(next);
  if(!this.matchesCompletedPrimary(before,c)||!this.authored||!this.timeline)throw Error('迭代参数更新需要匹配的已完成主预览');
  const changes=sourceIteratedParameterChanges(before,next,writes);if(!changes)throw Error('该编辑不是已有迭代参数热更新');
  this.timeline.writeParameters(changes);this.authored=structuredClone(next);this.shape=sourceIteratedApplyIdentity(next);this.frame=this.timeline.snapshot();
  this.completed!.identity=this.captureIdentity(next,c);
 }
 /** Native input changes the live camera, then redraws the paused scene.
  * It never applies the author document or reconstructs the particle owner. */
 navigatePaused(scene:SceneDocument,c:GenerateContext,event:SourceViewportNavigationEvent):Raster {return this.run(this.navigatePausedOperation(scene,c,event));}
 navigatePausedAsync(scene:SceneDocument,c:GenerateContext,event:SourceViewportNavigationEvent):Promise<Raster>{
  const input=this.snapshot(scene,c),navigation=structuredClone(event);return this.runAsync(cancelled=>this.navigatePausedOperation(input.scene,{...input.context,isCancelled:cancelled},navigation),input.isCancelled);
 }
 private *navigatePausedOperation(scene:SceneDocument,c:GenerateContext,event:SourceViewportNavigationEvent):Operation<Raster> {
  if(!this.matchesPrimary(scene,c)||!this.timeline||!this.clock||!this.particleConstruction)throw Error('迭代视口交互需要匹配的已完成主预览');
  this.clock.assertPaused(true);cancel(c);
  const viewport=this.completed!.context.sourceViewport!;
  const mode=this.family==='map'&&this.particleConstruction.mapSource!.construction.dimension<3?'map-2d':'rotate';
  const next=navigateSourceViewportCamera(this.timeline.snapshot().frame.camera,mode,event,viewport.logicalWidth,viewport.logicalHeight);
  if(!next.ok)throw next.error;
  this.cleanup.prepare();this.busy=true;
  try{this.timeline.writeViewport(next.value);return yield* this.present(c,yield* this.advance(c,0,true));}
  catch(error){yield* this.resetOperation([error]);throw error;}finally{this.busy=false;}
 }
 private *advance(c:GenerateContext,dt:number,paused:boolean,reconstructing=false,host:{withinFrame?:boolean;previewCopy?:boolean}={}):Operation<DisplayResult>{
  cancel(c);const replaying=this.replay!.willReplayDisplay(c.width,c.height);
  if(this.processing&&!host.withinFrame)this.processing=beginSourceSymmetryProcessingFrame(this.processing,c);
  const frame=this.timeline!.step(dt,{paused,acknowledgeParameters:!replaying});this.lastUpdatePaused=paused;
  const result=yield* this.display(c,frame,paused,reconstructing);
  if(this.processing&&!host.withinFrame)endSourceSymmetryProcessingFrame(this.processing,host.previewCopy);
  return result;
 }
 private *display(c:GenerateContext,frame:SourceIteratedTimelineResult,paused:boolean,reconstructing=false):Operation<DisplayResult>{
  cancel(c);const replaying=this.replay!.willReplayDisplay(c.width,c.height);this.frame=frame;
  const scene={...this.authored!,settings:{...this.authored!.settings,...frame.mapColors,...(this.runtimePointSize!==undefined?{pointSize:this.runtimePointSize}:{})},parameters:{...frame.parameters!.values},evaluatedSourceCamera:frame.frame};
  bindSourceIterationFrame(scene,frame.palette,frame.update,frame.parameters);
  const anchor={...this.authored!,...this.particleConstruction};
  if(anchor.mapSource&&this.authored!.mapSource)anchor.mapSource={...anchor.mapSource,construction:{...anchor.mapSource.construction,iterations:this.authored!.mapSource.construction.iterations}};
  const sourceFrame=ordinarySourceCameraFrame(scene,c),plan=prepareOrdinarySourceFrame(sourceFrame),job=prepareIteratedFrame(scene,frame.frame.sceneTime,this.displays,anchor,{symmetryDialect:this.backend.symmetryDialect});
  // During replay native display skips camera capture and parameter snapshot.
  let cameraChanged=false;
  if(!replaying){const captured=prepareCapturedDensityCamera(this.family,plan,this.anchor);this.anchor=captured.anchor;cameraChanged=captured.clearInk;}
  job.sourceCamera={anchor:this.anchor!,clearInk:cameraChanged};
  job.densitySplat=prepareSourceDensitySplat(this.family,job.config.pointSize,plan.displayScale);
  const updates=frame.update.calls.map(call=>prepareIteratedField({...scene,parameters:{...call.parameters!}},job.config,call.time,anchor,{symmetryDialect:this.backend.symmetryDialect}));
  if(reconstructing){
   const planned=prepareSourceIterationFramePlan(this.family,{frameIndex:this.displays,updateCount:updates.length},this.replay!.diagnostics().warmupApplied,job.config.burn,job.config.iterations);
   this.requestSteps+=this.replay!.estimateWork({...job,iterationFrame:planned,iterationUpdates:updates},!this.replay!.diagnostics().initialized);
   this.requestPixels+=sourceDensitySplatPixelTests(job.densitySplat,job.config.count);
   if(this.requestSteps>2_000_000_000||this.requestPixels>2_000_000_000)throw Error('迭代场景 本地重建超过 20 亿工作预算');
  }
  const processing=this.processing?beginSourceSymmetryProcessingRender(this.processing,plan,updates.length>0):undefined;
  const display=(yield{kind:'display',args:[job,{width:c.width,height:c.height,projection:'xy',padding:0,bounds:{minX:-1,maxX:1,minY:-1,maxY:1},isCancelled:c.isCancelled},{updates,paused,parameterChanged:frame.parameters!.changed,cameraChanged,...(processing?{processing}:{})}]}) as SourceIteratedDisplayFacts;
  if(this.processing)endSourceSymmetryProcessingRender(this.processing);
  if(this.displays&&(this.invalidUnit??'iteration')!==(display.gpu.invalidUnit??'iteration'))throw Error('迭代场景的无效计数单位发生变化');
  this.invalidUnit=display.gpu.invalidUnit;
  this.steps+=display.gpu.steps;this.accepted+=display.gpu.accepted;this.invalid+=display.gpu.invalid;this.clipped+=display.gpu.clipped;this.sampleInvalid+=display.gpu.sampleInvalid;this.deposited+=display.passes*job.config.count;this.displays++;
  if(![this.steps,this.accepted,this.invalid,this.clipped,this.sampleInvalid,this.deposited,this.displays].every(Number.isSafeInteger))throw Error('迭代场景 累计计数超过安全整数');
  return{scene,job,sourceFrame,display};
 }
 generate(scene:SceneDocument,c:GenerateContext):Raster {return this.run(this.generateOperation(scene,c));}
 generateAsync(scene:SceneDocument,c:GenerateContext):Promise<Raster>{
  const input=this.snapshot(scene,c);return this.runAsync(cancelled=>this.generateOperation(input.scene,{...input.context,isCancelled:cancelled}),input.isCancelled);
 }
 private *generateOperation(scene:SceneDocument,c:GenerateContext):Operation<Raster> {
  scene=sourcePaletteRuntimeScene(scene);
  if(this.recording||this.busy||this.failed)throw Error('迭代场景 实时会话需要可用且空闲的所有者');this.cleanup.prepare();const live=context(c,this.family);exactRasterDimensions(c);cancel(c);
  if(sourceIteratedLiveKind(scene)!==this.family)throw Error('迭代场景 实时生成需要完整源模型、零起点和开启绘制；本地延迟累积或停止记录使用固定回放');
  this.tone(scene,c);const shape=sourceIteratedApplyIdentity(scene),replace=!this.authored||this.sessionId!==live.sessionId||this.shape!==shape||this.startAt!==live.startAt;
  if(!replace){this.clock!.assertPaused(live.clock.paused);if(live.replayRevision<this.revision)throw Error('迭代场景 编辑事件序号已过期');if(sourceIteratedReplayIdentity(scene)!==sourceIteratedReplayIdentity(this.authored!)&&live.replayRevision===this.revision)throw Error('迭代场景 调色板/变换编辑缺少显式重播事件');}
  const edits=live.mapEdits??{runtimeRevision:0,dotSizeRevision:0};
  if(!replace&&this.family==='map'){
   if(edits.runtimeRevision<this.runtimeRevision||edits.dotSizeRevision<this.dotSizeRevision)throw Error('Map 热编辑事件序号已过期');
   if(SOURCE_MAP_RUNTIME_SETTINGS.some(key=>!Object.is(this.authored!.settings[key],scene.settings[key]))&&edits.runtimeRevision===this.runtimeRevision)throw Error('Map 运行设置修改缺少显式运行设置事件');
   if(!Object.is(scene.settings.pointSize,this.authored!.settings.pointSize)&&edits.dotSizeRevision===this.dotSizeRevision)throw Error('Map 点尺寸修改缺少显式热更新事件');
  }
  this.busy=true;this.requestSteps=0;this.requestPixels=0;
  try{
   if(replace)yield* this.initialize(scene,live,c);
   else{
    const before=ordinarySourceCameraInitial(this.authored!)!,after=ordinarySourceCameraInitial(scene)!;
    if(['phi','theta','gamma'].some(key=>before[key as 'phi']!==after[key as 'phi']))this.timeline!.writeAngles({phi:after.phi,theta:after.theta,gamma:after.gamma});
    if(this.family==='map'){
     if(edits.runtimeRevision!==this.runtimeRevision){
      if(this.timeline!.writeMapColors(sourceMapRuntimeColors(scene.settings)))this.replay!.requestReplay();
     }
     if(edits.dotSizeRevision!==this.dotSizeRevision)this.runtimePointSize=Math.max(1,Math.fround(Number(scene.settings.pointSize??1)));
     this.runtimeRevision=edits.runtimeRevision;this.dotSizeRevision=edits.dotSizeRevision;
    }
    if(live.replayRevision!==this.revision)this.replay!.requestReplay();this.revision=live.replayRevision;this.authored=structuredClone(scene);this.replay!.setRenderFps(live.renderFps);
   }
   let result:DisplayResult;
   if(replace&&live.startAt!==undefined){
    const frames=Math.floor(live.startAt*scene.timeline.fps+1e-9)+1;
    for(let i=0;i<frames;i++)result=yield* this.advance(c,Math.fround(1/scene.timeline.fps),false,true);
    this.clock=new SourceSceneHostClock(live.clock.paused,this.frame!.frame.camera,this.backend.hostClock?.now,this.backend.hostClock?.source??'worker-wall-clock');
   }else result=yield* this.advance(c,this.clock!.update(live.clock),live.clock.paused);
   const output=yield* this.present(c,result!);
   this.completed=c.sourceViewport?.target==='primary'?{context:{...c,[this.family==='map'?'mapLive':'symmetryLive']:structuredClone(live),sourceViewport:{...c.sourceViewport},...(c.sourceMapToneReference?{sourceMapToneReference:{...c.sourceMapToneReference}}:{}),...(c.sourceSymmetryToneReference?{sourceSymmetryToneReference:{...c.sourceSymmetryToneReference}}:{})},identity:this.captureIdentity(scene,c)}:undefined;
   return output;
  }catch(error){yield* this.resetOperation([error]);throw error;}finally{this.busy=false;}
 }
 private *initialize(scene:SceneDocument,live:SourceIteratedLiveContext,c:GenerateContext):Operation<void>{
  const applied=scene.symmetrySourcePalette?symmetryPaletteColdAnchor(scene):resetSourceSymmetryPointSize(scene);
  if(scene.symmetrySourcePalette)assertSymmetryPaletteRetention({input:scene,authored:scene,applied,construction:scene.symmetrySource});
  yield* this.resetOperation([],true);
  if(this.backend.symmetryDialect&&hasSymmetryCustom(scene)){this.processing=beginSourceSymmetryProcessingFrame(this.processing,c,true);endSourceSymmetryProcessingFrame(this.processing);}
  else{this.processing?.dispose();this.processing=undefined;}
  this.particleConstruction=structuredClone({mapSource:scene.mapSource,symmetrySource:scene.symmetrySourcePalette?applied.symmetrySource:scene.symmetrySource});this.applied=structuredClone(applied);this.authored=structuredClone(scene);this.shape=sourceIteratedApplyIdentity(scene);
  this.sessionId=live.sessionId;this.startAt=live.startAt;this.revision=live.replayRevision;
  this.timeline=new SourceIteratedTimelineSession(scene);this.frame=this.timeline.snapshot();
  this.clock=new SourceSceneHostClock(live.clock.paused,this.frame.frame.camera,this.backend.hostClock?.now,this.backend.hostClock?.source??'worker-wall-clock');this.replay=new SourceIteratedReplaySession(this.family,live.renderFps,this.backend.asyncBackend?{asyncBackend:this.backend.asyncBackend()}:{backend:this.backend.backend?.()});
  this.runtimeRevision=live.mapEdits?.runtimeRevision??0;this.dotSizeRevision=live.mapEdits?.dotSizeRevision??0;
 }
 /** Public toolbar resets from the last applied JSON before enabling recording.
  * It does not promote intervening hot edits to constructor inputs. Native
  * video uses the fixed MathArtConfig exportScaleFactor=3, not PNG enhancement. */
 beginRecording(scene:SceneDocument,c:GenerateContext,options:{width:number;height:number;simulationFps:number}):RecordingStart{return this.run(this.beginRecordingOperation(scene,c,options));}
 beginRecordingAsync(scene:SceneDocument,c:GenerateContext,options:{width:number;height:number;simulationFps:number}):Promise<RecordingStart>{
  const input=this.snapshot(scene,c),recording={...options};return this.runAsync(cancelled=>this.beginRecordingOperation(input.scene,{...input.context,isCancelled:cancelled},recording),input.isCancelled);
 }
 private *beginRecordingOperation(scene:SceneDocument,c:GenerateContext,options:{width:number;height:number;simulationFps:number}):Operation<RecordingStart>{
  scene=sourcePaletteRuntimeScene(scene);
  if(this.recording||!this.matchesPrimary(scene,c)||!this.applied||c.sourceViewport?.target!=='primary')throw Error('迭代场景录制需要已完成且匹配的主预览');
  this.cleanup.prepare();cancel(c);
  const clock=planSourceIteratedRecording(this.applied,options.simulationFps,c.isCancelled);
  const size=sourceRecordingSize(options,c.sourcePointPixelDensity??NaN);
  this.replay!.validateCapture(size.width,size.height,0);
  if(scene.symmetrySourcePalette)assertSymmetryPaletteRetention({input:scene,applied:this.applied,detached:this.applied});
  const applied=structuredClone(this.applied),effective=scene.symmetrySourcePalette
   ?{...applied,id:scene.id,name:scene.name,description:scene.description,favorite:scene.favorite,symmetryPaletteSession:{cold:applied},timeline:{...applied.timeline,fps:options.simulationFps}}
   :{...resetSourceSymmetryPointSize(structuredClone(scene)),equations:applied.equations,parameters:applied.parameters,settings:applied.settings,sourceCamera:applied.sourceCamera,mapSource:applied.mapSource,symmetrySource:applied.symmetrySource,palette:applied.palette,projectResolution:applied.projectResolution,timeline:{...applied.timeline,fps:options.simulationFps}};
  const live:SourceIteratedLiveContext={sessionId:crypto.randomUUID(),renderFps:options.simulationFps,replayRevision:0,mapEdits:this.family==='map'?{runtimeRevision:0,dotSizeRevision:0}:undefined,clock:{paused:false}};
  const key=this.family==='map'?'mapLive':'symmetryLive',toneKey=this.family==='map'?'sourceMapToneReference':'sourceSymmetryToneReference';
  const primary:GenerateContext={...snapshotGenerationInput(c),time:0,[key]:live,isCancelled:c.isCancelled};
  const target:GenerateContext={...primary,width:size.width,height:size.height,quality:'export',sourceViewport:{...primary.sourceViewport!,logicalWidth:size.logicalWidth,logicalHeight:size.logicalHeight,target:'offscreen'},[toneKey]:{width:c.width,height:c.height}};
  this.tone(effective,target);this.busy=true;
  try{
   yield* this.initialize(effective,live,primary);this.recording={handle:Object.freeze({}),clock,primary,target,next:0};
   const warmup=yield* this.advanceRecording(0);
   return{handle:this.recording.handle,scene:structuredClone(effective),context:snapshotGenerationInput(primary),clock:{...clock},warmup};
  }catch(error){yield* this.resetOperation([error]);throw error;}finally{this.busy=false;}
 }
 private *advanceRecording(displayFrame:number):Operation<Raster>{
  const record=this.recording!,c=record.target;cancel(c);
  const output=yield* this.present(c,yield* this.advance(c,Math.fround(1/record.clock.simulationFps),false,false,{previewCopy:true}));
  output.iteratedRecording={displayFrame,warmup:displayFrame===0,complete:this.frame!.frame.queueComplete,simulationFps:record.clock.simulationFps};
  assertSourceIteratedRecordingFrame(output,record.clock,displayFrame);record.next=displayFrame+1;return output;
 }
 ownsRecording(handle:object){return this.recording?.handle===handle;}
 nextRecordingFrame(handle:object,displayFrame:number):Raster{return this.run(this.nextRecordingFrameOperation(handle,displayFrame));}
 nextRecordingFrameAsync(handle:object,displayFrame:number):Promise<Raster>{
  return this.runAsync(cancelled=>this.nextRecordingFrameOperation(handle,displayFrame,cancelled),this.recording?.target.isCancelled);
 }
 private *nextRecordingFrameOperation(handle:object,displayFrame:number,isCancelled?:()=>boolean):Operation<Raster>{
  const record=this.recording;
  if(this.failed||this.busy||!this.ownsRecording(handle)||!record||displayFrame!==record.next||displayFrame>record.clock.lastDisplayFrame)throw Error('迭代场景录制身份或连续帧序号无效');
  this.busy=true;const previous=record.target.isCancelled;if(isCancelled)record.target.isCancelled=isCancelled;try{return yield* this.advanceRecording(displayFrame);}catch(error){yield* this.resetOperation([error]);throw error;}finally{record.target.isCancelled=previous;this.busy=false;}
 }
 /** Stop changes only host clock mode. It does not pause, display, update,
  * clear particles/ink or restore initial camera angles. */
 finishRecording(handle:object,timestampMs?:number):{scene:SceneDocument;context:GenerateContext}{
  const record=this.recording;
  if(this.failed||this.executing||!this.ownsRecording(handle)||!record)throw Error('迭代场景录制身份无效');
  this.clock!.resetTime(timestampMs);
  const context={...snapshotGenerationInput(record.primary),time:this.frame!.frame.sceneTime,isCancelled:record.primary.isCancelled};
  this.recording=undefined;return{scene:structuredClone(this.authored!),context};
 }
 private *present(c:GenerateContext,result:DisplayResult):Operation<Raster> {
   const {scene:current,job,sourceFrame,display}=result;
   const prepared=this.tone(current,c);if(prepared.model!=='normalized-v2')throw Error('迭代场景 实时呈现需要源归一模型');
   const normalization=deriveSourceIteratedNormalization({kind:this.family,width:c.width,height:c.height,recordedPasses:display.accumulationPasses,batchSize:job.config.count},(prepared.sourceMapPresentation??prepared.sourceSymmetryPresentation)!.reference);
   const tone={...prepared,normalization},shown=(yield{kind:'present',args:[tone,c.isCancelled,prepareCapturedDensityView(this.anchor!,sourceFrame.camera,c.width,c.height)]}) as SourceIteratedPresented;
   // The parent resumes in a later microtask than the backend ACK. Recheck its
   // generation before publishing pixels or recording a completed preview.
   cancel(c);const frame=this.frame!.frame;
   const facts:SourceIteratedLiveFacts={sessionId:this.sessionId,clock:this.recording?'fixed-source-queue':'realtime-source-queue',clockSource:this.recording?'fixed-step':this.clock!.diagnostics().clockSource,sceneTime:frame.sceneTime,rawDt:frame.rawDt,activeDt:frame.activeDt,queueIndex:frame.queueIndex,queueComplete:frame.queueComplete,paused:this.clock!.diagnostics().paused,objectUpdates:this.frame!.update.calls.length,replayRevision:this.revision,display};
   return{type:'raster',dimension:2,cameraResolved:true,backend:shown.toneBackend==='native'?'native':'webgl2',...(shown.sourcePixelRenderer?{sourcePixelRenderer:shown.sourcePixelRenderer}:{}),width:c.width,height:c.height,pixels:shown.pixels,sourceCameraFrame:sourceFrame,...(this.family==='map'?{mapLive:facts,mapSplat:job.densitySplat,sourceMapPresentation:{...prepared.sourceMapPresentation!,scale:normalization.scale}}:{symmetryLive:facts,symmetrySplat:job.densitySplat,symmetryPalette:job.symmetryPalette,sourceSymmetryPresentation:{...prepared.sourceSymmetryPresentation!,scale:normalization.scale}}),density:{projection:'xy',bounds:display.gpu.bounds,inputPoints:this.deposited,examined:this.deposited,accepted:this.accepted,clipped:this.clipped,invalid:this.sampleInvalid,occupiedPixels:shown.occupiedPixels,maxCount:shown.maxCount,toneBackend:shown.toneBackend,cancelled:false},temporal:{time:frame.sceneTime,windowStart:0,frames:this.displays,samplingFps:context(c,this.family).renderFps,recordedPoints:this.deposited,cacheHits:0},stats:{samples:this.steps,generated:this.accepted,invalid:this.invalid,...(this.invalidUnit?{invalidUnit:this.invalidUnit}:{})},warnings:[`迭代场景 实时会话按源调度更新和重播；本地 ${shown.toneBackend==='native'?'原生':'WebGL'} 验证不等于原版整窗口像素对照。`,...shown.warnings]};
 }
 private captureIdentity(scene:SceneDocument,c:GenerateContext){return identity([sourceIteratedSceneIdentity(scene),c.time,c.width,c.height,c.quality,this.live(c),c.sourceViewport,c.sourcePointPixelDensity,c.sourceMapToneReference,c.sourceSymmetryToneReference]);}
 matchesCompletedPrimary(scene:SceneDocument,c:GenerateContext){return !this.executing&&this.matchesPrimary(scene,c);}
 private matchesPrimary(scene:SceneDocument,c:GenerateContext){return !this.recording&&!this.busy&&!this.failed&&!!this.completed&&this.completed.identity===this.captureIdentity(scene,c);}
 capturePaused(scene:SceneDocument,c:GenerateContext,options:{additionalBytes?:number}={}):PausedCaptureResult {return this.run(this.capturePausedOperation(scene,c,options));}
 capturePausedAsync(scene:SceneDocument,c:GenerateContext,options:{additionalBytes?:number}={}):Promise<PausedCaptureResult>{
  const input=this.snapshot(scene,c),capture={...options};return this.runAsync(cancelled=>this.capturePausedOperation(input.scene,{...input.context,isCancelled:cancelled},capture),input.isCancelled);
 }
 private *capturePausedOperation(scene:SceneDocument,c:GenerateContext,options:{additionalBytes?:number}):Operation<PausedCaptureResult> {
  // width/height/quality describe this export request. Every primary fact
  // comes from the completed owner, whose physical size is identity-bound.
  const source=this.completed;
  if(!source||!this.matchesPrimary(scene,{...c,width:source.context.width,height:source.context.height,quality:source.context.quality}))throw Error('迭代场景 暂停截图需要完全匹配的已完成主预览');
  this.clock!.assertPaused(true);this.cleanup.prepare();cancel(c);
  const primary=this.completed!,density=primary.context.sourcePointPixelDensity??NaN;
  const size=prepareSourcePausedCaptureSize(c,density),additionalBytes=options.additionalBytes??0;
  this.replay!.validateCapture(size.width,size.height,additionalBytes);
  const captureContext:GenerateContext={...c,width:size.width,height:size.height,sourceViewport:{...primary.context.sourceViewport!,logicalWidth:size.logicalWidth,logicalHeight:size.logicalHeight,target:'offscreen'},[this.family==='map'?'sourceMapToneReference':'sourceSymmetryToneReference']:{width:primary.context.width,height:primary.context.height}};
  this.tone(scene,captureContext);this.busy=true;
  try{
   // Native export render precedes Scene.update(true). Keep the last mobject
   // paused flag for that first display; controls alone do not update it.
   if(this.processing)this.processing=beginSourceSymmetryProcessingFrame(this.processing,primary.context);
   const frame=this.timeline!.display(!this.replay!.willReplayDisplay(size.width,size.height));
   const capture=yield* this.present(captureContext,yield* this.display(captureContext,frame,this.lastUpdatePaused));
   const restored={...primary.context,isCancelled:c.isCancelled};
   const preview=yield* this.present(restored,yield* this.advance(restored,0,true,false,{withinFrame:true}));
   if(this.processing)endSourceSymmetryProcessingFrame(this.processing);
   this.completed=primary;return{capture,preview};
  }catch(error){yield* this.resetOperation([error]);throw error;}finally{this.busy=false;}
 }

}
