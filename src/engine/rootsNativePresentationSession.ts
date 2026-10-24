import {RootsControlOwner,rootsControlRepresentationBytes,type PreparedRootsControls} from './rootsControl';
import {prepareRootsComputationPlan} from './rootsComputation';
import {RootsPendingQueue,prepareRootsPendingPlan} from './rootsPending';
import {snapshotGenerationInput} from './generationInput';
import {sourceRecordingSize} from './sourceRecordingSize';
import type {SourceRecordingOptions} from './generationProtocol';
import {RootsConcurrentStream} from './rootsConcurrentStream';
import {validateRootsLiveContext,type RootsLiveContext,type RootsLiveFacts} from './rootsLive';
import {SourceSceneHostClock} from './sourceSceneHostClock';
import {isRootsAutoRecordingComplete} from './rootsRecording';
import {formulaPresentation} from './formulas';
import {rootsFormulaViewport} from './rootsFormulaPresentation';
import type {GenerateContext,RootsProgress,SceneDocument,SceneOutput} from '../types';
import {GenerationCleanupState,withGenerationCleanup} from './generationCleanup';
import {RootsMathSession,type RootsMathJob} from './rootsMathJob';
import {usesRootsNativeMath} from './rootsMathConfig';
import {usesRootsNativePresentation} from './rootsPresentationAuthoring';
import {createRootsNativeProgress,RootsNativePointReader} from './rootsNativePointReader';
import {prepareRootsDensityColor,rootsDensityScale,type RootsMetricColorPlan} from './rootsDensityColor';
import {prepareRootsProjection,type PreparedRootsProjection} from './rootsProjection';
import {RootsNativeDensityDisplay} from './rootsNativeDisplay';
import {rootsNativeDensityGpuBytes,rootsNativeToneGpuBytes} from './rootsNativeDensityGpu';
import {rootsNativeInkViewBytes} from './rootsNativeInk';
import {RootsNativePointCloudGpu,rootsNativePointCloudGpuBytes} from './rootsNativePointCloudGpu';
import {RootsPointCloudRing,ROOTS_POINT_CLOUD_APPEND_LIMIT,ROOTS_POINT_CLOUD_DEFAULT_BYTES} from './rootsPointCloudRing';
import {RootsGpuError,rootsGpuCancel,rootsGpuInput} from './rootsGpuFailure';
import type {RootsPresentationConfiguration} from './rootsPresentationConfig';
import {validateRasterRequest} from './rasterDimensions';
import {sceneAtTime} from './timeline';
import {rootsSchedule,rootsSampleProgressAt} from '../scenes/rootsDensity';
import {prepareRootsOrdinalCompletion,rootsPendingCompletion} from './rootsRecording';
import {RootsPendingStream} from './rootsPendingStream';
import type {RootsPresentationFacts} from './rootsPresentationFacts';
import {rootsPresentationRequestIdentity} from './rootsPresentationRequest';
import {createRootsCameraClock,createRootsCameraWorkBudget,prepareRootsCameraTimeline,rootsCameraTargetFrame,usesRootsCameraTimeline,ROOTS_CAMERA_FRAME_LIMIT} from './rootsCameraTimeline';
import type {RootsSceneClock,RootsSceneFrame} from './rootsSceneClock';

const MAX_BYTES=768*1024*1024,CHUNK=ROOTS_POINT_CLOUD_APPEND_LIMIT;
// Each sequential display can touch the whole framebuffer; cloud drawing also
// visits its retained points. This is a local per-request work admission policy,
// not a source-format/time limit. Incremental playback resets this work budget.
const MAX_DISPLAY_WORK=1_000_000_000;
// Deterministic representation accounting before a descriptor copy: UTF-16
// strings, scalar/slot/header allowances and typed buffers. This is not a heap
// measurement or a driver/VRAM bound; no separate metadata capacity is imposed.
function descriptorRepresentationBytes(value:unknown):number {
 if(value===undefined||value===null)return 8;
 if(typeof value==='string')return 16+value.length*2;
 if(typeof value==='number'||typeof value==='boolean')return 8;
 if(ArrayBuffer.isView(value))return 64+value.byteLength;
 if(value instanceof ArrayBuffer)return 64+value.byteLength;
 if(Array.isArray(value)){let bytes=32+value.length*8;for(const item of value)bytes+=descriptorRepresentationBytes(item);return bytes;}
 if(typeof value==='object'){let bytes=64;for(const key in value)if(Object.hasOwn(value,key))bytes+=16+key.length*2+descriptorRepresentationBytes((value as Record<string,unknown>)[key]);return bytes;}
 throw new RootsGpuError('暂停截图完成帧包含不可保留的描述数据','input');
}
const COLD_EXPORT_WARNING='冷导出从当前文档重新回放，不是原版同实例暂停截图；未保留热编辑墨迹历史。';
const OPAQUE_FRAME_WARNING='输出保留目标帧的 RGBA；预览和导出按完整帧 RGB 不透明显示，不声明与原版 PNG 透明度等价。';
const CAPTURE_ALPHA_WARNING='暂停截图保留目标帧的 RGBA，不通过不透明预览载体；未证明与原版 PNG 透明度逐像素等价。';
const PAUSED_CAPTURE_WARNING='同实例暂停截图只重绘已完成帧；不推进相机、渐变或求根。当前本地到达流没有待提交队列，不模拟原版并发排空；截图后重绘主预览，尺寸变化可能清除密度墨迹。';
const PENDING_CAPTURE_WARNING='暂停截图不推进时钟或求根，但会绘制已有积压点；截图后继续重绘主预览。尺寸变化会清除密度墨迹，未绘制的原始点仍保留。';
interface Identity {document:string;math:string;mode:'density'|'point-cloud';timeline:string;clock:string;camera:string;gradient:string;pending:string;}
const numericIdentity=(value:unknown)=>JSON.stringify(value,(_key,item:unknown)=>typeof item==='number'&&Object.is(item,-0)?{negativeZero:true}:item);
export type RootsRasterOutput=Extract<SceneOutput,{type:'raster'}>;
type DisplayFacts=Pick<RootsPresentationFacts,'density'|'pointCloud'>;
interface CloudTarget {owner:RootsNativePointCloudGpu;width:number;height:number;}
interface CompletedFrame {
 requestKey:string;time:number;plan:PreparedRootsProjection;color:RootsMetricColorPlan;
 configuration:RootsPresentationConfiguration;metadata:Omit<RootsRasterOutput,'pixels'|'warnings'>;baseWarnings:readonly string[];
 mathBytes:number;descriptorBytes:number;
}
interface LiveRecording {
 handle:object;author:SceneDocument;primary:GenerateContext;target:GenerateContext;simulationFps:number;next:number;complete:boolean;finished:boolean;descriptorBytes:number;
}
/** One worker-owned native presentation instance. Explicit live requests own
 * concurrent producers; saved replay retains the existing ordinal math job.
 * Display edits consume zero historical points. Explicit backseek reconstructs
 * a new local instance, rather than pretending to rewind original native ink. */
export class RootsNativePresentationSession {
 private cleanup=new GenerationCleanupState();
 private controlOwner?:RootsControlOwner;
 private controlTemporaryBytes=0;
 private controlResetPending=false;
 private controlledOffset?:number;
 private math=new RootsMathSession();
 private density?:RootsNativeDensityDisplay;
 private clouds:Partial<Record<'primary'|'offscreen',CloudTarget>>={};
 private completed?:CompletedFrame;
 private pending?:RootsPendingStream;
 private concurrent?:RootsConcurrentStream;
 private liveContext?:RootsLiveContext;
 private hostClock?:SourceSceneHostClock;
 private liveHasAnimations=false;
 private recording?:LiveRecording;
 private recordingHandoff?:LiveRecording;
 private recordingDescriptorBytes=0;
 private pendingFrame=-1;
 private pendingAdmission?:(bytes:number)=>void;
 private ring?:RootsPointCloudRing;
 private identity?:Identity;
 private state?:RootsProgress;
 private instance=0;
 private lastTime=-1;
 private rawInvalid=0;
 private displayInvalid=0;
 private cameraClock?:RootsSceneClock;
 private cameraFrame=-1;
 private displayFrames=0;
 private displayKey?:string;
 private resetDisplay(){
  // Never drop an owner before its cleanup succeeds. A failed cleanup ticket
  // remains attached to this generation and is retired before future work.
  this.completed=undefined;this.recording=undefined;this.recordingHandoff=undefined;this.recordingDescriptorBytes=0;
  this.density?.dispose();this.density=undefined;
  for(const target of ['primary','offscreen'] as const){this.clouds[target]?.owner.dispose();delete this.clouds[target];}
  this.ring?.dispose();this.ring=undefined;
  this.concurrent?.dispose();this.concurrent=undefined;this.liveContext=undefined;this.hostClock=undefined;this.liveHasAnimations=false;
  this.pending?.dispose();this.pending=undefined;this.pendingFrame=-1;this.pendingAdmission=undefined;
  this.cameraClock=undefined;this.cameraFrame=-1;this.displayFrames=0;this.displayKey=undefined;
 }
 private releaseRuntime(){
  this.resetDisplay();this.math.dispose();this.identity=undefined;this.state=undefined;
  this.lastTime=-1;this.rawInvalid=this.displayInvalid=0;
 }
 private resetRuntime(failures:readonly unknown[]=[]){this.cleanup.reset(()=>this.releaseRuntime(),failures);}
 reset(failures:readonly unknown[]=[]){this.controlResetPending=true;this.cleanup.reset(()=>{this.releaseRuntime();this.controlOwner=undefined;this.controlledOffset=undefined;this.controlResetPending=false;},failures);}
 completedHasFormulas():boolean{if(!this.completed)throw new RootsGpuError("复根缺少已完成显示帧","input");return !!this.completed.metadata.formulaPresentation?.labels.length;}
 diagnostics(){const math=this.math.diagnostics(),density=this.density?.diagnostics(),primary=this.clouds.primary?.owner.diagnostics(),offscreen=this.clouds.offscreen?.owner.diagnostics(),cloud=primary??offscreen,ring=this.ring?.facts;return{
  instance:this.instance,attemptedSamples:this.state?.attemptedSamples??0,rawPoints:this.state?.rootPoints??0,math,density,cloud,cloudTargets:{primary,offscreen},ring,displayFrames:this.displayFrames,cameraFrame:this.cameraFrame,completedPrimary:!!this.completed&&this.completed.plan.target==='primary',
  pending:this.pending?.facts,concurrent:this.concurrent?.facts,
  retainedBytes:(this.controlOwner?.retainedBytes??0)+math.workspaceBytes+math.keyBytes+(density?.gpu?.retainedBytes??0)+(primary?.retainedBytes??0)+(offscreen?.retainedBytes??0)+(ring?.allocatedBytes??0)+(this.completed?.descriptorBytes??0)+this.recordingDescriptorBytes+(this.concurrent?.facts.reservedBytes??this.pending?.retainedBytes??0),
 };}
 generate(scene:SceneDocument,c:GenerateContext):RootsRasterOutput {
  if(this.recording)throw Error('复根录制进行中，请先停止录制');
  this.cleanup.prepare();if(this.controlResetPending){this.controlOwner=undefined;this.controlledOffset=undefined;this.controlResetPending=false;}
  // Admission is outside the mutation/cleanup catch: rejected commands retain
  // the prior completed preview and its owner.
  const live=c.rootsLive===undefined?undefined:validateRootsLiveContext(c.rootsLive);
  if(this.controlOwner&&live?.sessionId===this.controlOwner.sessionId&&!live.controls)throw new RootsGpuError('复根受控会话不能省略 controls','input');
  const owner=live?.controls?(this.controlOwner?.sessionId===live.sessionId?this.controlOwner:new RootsControlOwner(live.sessionId)):undefined;
  const transaction=owner&&owner.prepare(live!.controls!,c.isCancelled);
  if(transaction)this.preflightControls(transaction,c,scene);
  this.recordingHandoff=undefined;this.recordingDescriptorBytes=0;
  try{if(transaction){this.controlTemporaryBytes=transaction.peakBytes;this.applyControls(owner!,transaction,c);}
   if(c.rootsLive!==undefined)return this.runLive(scene,c);if(this.liveContext)this.reset();return this.run(scene,c);
  }catch(error){this.reset([error]);throw error;}finally{this.controlTemporaryBytes=0;}
 }
 /** Identity observation for transport recovery after a rejected capture. This
  * does not admit a new size or authorize a mutation. Unknown input is false. */
 matchesCompletedPrimary(scene:SceneDocument,c:GenerateContext):boolean {
  try{const last=this.completed;return !!last&&last.plan.target==='primary'&&Object.is(c.time,last.time)&&this.requestKey(scene,c)===last.requestKey;}
  catch{return false;}
 }
 /** Render the completed live frame into its reusable base-size offscreen target,
  * then refresh primary, in the source paused-PNG order. No clock advance or
  * synchronous sampling; an explicitly live producer continues independently.
  * Stale/input/capacity/pre-cancel rejection precedes mutation and preserves the
  * preview. Once rendering starts, failure revokes the frame and cleans the same
  * owners; a changed density target may already have irreversibly cleared ink. */
 capturePaused(scene:SceneDocument,c:GenerateContext,options:{additionalBytes?:number}={}):{capture:RootsRasterOutput;preview:RootsRasterOutput} {
  if(this.recording)throw Error('复根录制进行中，不能暂停截图');
  const last=this.completed,additionalBytes=options.additionalBytes??0;
  if(!Number.isSafeInteger(additionalBytes)||additionalBytes<0)throw new RootsGpuError('暂停截图的后处理容量预留无效','input');
  rootsGpuInput(()=>validateRasterRequest(c));rootsGpuCancel(c.isCancelled);
  if(!last||last.plan.target!=='primary')throw new RootsGpuError('暂停截图需要同实例最后成功的主预览帧','input');
  if(!this.matchesCompletedPrimary(scene,c))throw new RootsGpuError('暂停截图请求与最后成功预览不一致；请等待当前预览完成','input');
  if(c.rootsViewport?.target!=='offscreen'||c.rootsViewport.referenceLogicalHeight!==last.plan.referenceLogicalHeight)throw new RootsGpuError('暂停截图需要基准 1× 离屏尺寸及最后预览的参考高度','input');
  // The caller supplies the base 1x target. Menu 3x/5x belongs to the later
  // image enhancement/resizing owner, never this geometry/render operation.
  const capturePlan=rootsGpuInput(()=>prepareRootsProjection(last.configuration,{width:c.width,height:c.height,viewport:c.rootsViewport!}));
  const heldCaptureBytes=c.width*c.height*4;
  // The retained metadata is already known. Actual changed metadata is measured
  // again before each copy, alongside both targets and any held output buffer.
  const descriptorReserve=last.descriptorBytes+3*descriptorRepresentationBytes(last.metadata);
  this.admitMemory(capturePlan,last.mathBytes,descriptorReserve+additionalBytes);
  this.admitMemory(last.plan,last.mathBytes,descriptorReserve+heldCaptureBytes+additionalBytes,capturePlan);
  this.cleanup.prepare();this.completed=undefined;
  const started=performance.now();
  try{
   if(this.concurrent)this.pendingAdmission=bytes=>this.admitMemory(capturePlan,0,descriptorReserve+additionalBytes,undefined,bytes);
   const captureFacts=this.advanceDisplay(capturePlan,[],last.color,c.isCancelled);
   const capture=this.captureOutput(last,capturePlan,last.color,this.readDisplay(capturePlan,last.color,c.isCancelled),captureFacts,'capture',started,additionalBytes);
   const {pixels:ignoredCapture,...captureMetadata}=capture;
   const captureMetadataBytes=descriptorRepresentationBytes(captureMetadata);
   rootsGpuCancel(c.isCancelled);
   // The ordinary paused update after savePausedFrameInternal drains once;
   // the primary display below supplies the second drain and one more splat.
   if(this.concurrent)this.pendingAdmission=bytes=>this.admitMemory(last.plan,0,descriptorReserve+heldCaptureBytes+additionalBytes,capturePlan,bytes);
   this.drainPending(last.plan,c.isCancelled);
   const previewFacts=this.advanceDisplay(last.plan,[],last.color,c.isCancelled);
   const preview=this.captureOutput(last,last.plan,last.color,this.readDisplay(last.plan,last.color,c.isCancelled),previewFacts,'preview-refresh',started,additionalBytes+heldCaptureBytes+captureMetadataBytes);
   rootsGpuCancel(c.isCancelled);
   const {pixels:_,warnings:ignoredPreviewWarnings,...metadata}=preview;
   const metadataBytes=descriptorRepresentationBytes(metadata);
   const descriptorBytes=last.requestKey.length*2+descriptorRepresentationBytes({plan:last.plan,color:last.color,configuration:last.configuration,metadata,baseWarnings:last.baseWarnings});
   this.admitMemory(last.plan,last.mathBytes,last.descriptorBytes+captureMetadataBytes+2*metadataBytes+heldCaptureBytes+additionalBytes);
   this.completed={...last,metadata:structuredClone(metadata),descriptorBytes};
   this.recordingHandoff=undefined;this.recordingDescriptorBytes=0;
   return{capture,preview};
  }catch(error){this.reset([error]);throw error;}
 }
 private requestKey(scene:SceneDocument,c:GenerateContext):string {
  if(c.rootsLive?.controls){if(!this.controlOwner||this.controlOwner.sessionId!==c.rootsLive.sessionId)throw new RootsGpuError('复根控制 owner 缺失','input');const p=this.controlOwner.prepare(c.rootsLive.controls);if(p.steps.length)throw new RootsGpuError('复根控制命令尚未显示','input');}
  return rootsGpuInput(()=>numericIdentity(c.rootsLive?[rootsPresentationRequestIdentity(scene,c.rootsLive.sessionId),scene,c.rootsLive.maximumWorkers,c.rootsPixelDensity,c.rootsLive.controls?this.controlOwner!.receipt:undefined]:[rootsPresentationRequestIdentity(scene,c.rootsSessionId),scene]));
 }
 private displayPeak(plan:PreparedRootsProjection):number {
  return plan.mode==='density'
   ?rootsNativeDensityGpuBytes(plan.physicalWidth,plan.physicalHeight)+rootsNativeInkViewBytes(plan.physicalWidth,plan.physicalHeight,4)-plan.physicalWidth*plan.physicalHeight*16+rootsNativeToneGpuBytes(plan.physicalWidth,plan.physicalHeight)
   :rootsNativePointCloudGpuBytes(plan.physicalWidth,plan.physicalHeight);
 }
 private admitMemory(plan:PreparedRootsProjection,mathBytes:number,extraBytes=0,additionalTarget?:PreparedRootsProjection,pendingBytes=this.concurrent?.facts.reservedBytes??this.pending?.retainedBytes??0){
  let peak=this.displayPeak(plan);
  if(plan.mode==='point-cloud'){
   peak+=ROOTS_POINT_CLOUD_DEFAULT_BYTES;
   const other=plan.target==='primary'?'offscreen':'primary',retained=this.clouds[other];
   if(additionalTarget?.target===other)peak+=this.displayPeak(additionalTarget);
   else if(retained)peak+=rootsNativePointCloudGpuBytes(retained.width,retained.height);
  }
  if(peak+mathBytes+CHUNK*16+pendingBytes+extraBytes+this.recordingDescriptorBytes+(this.controlOwner?.retainedBytes??0)+this.controlTemporaryBytes>MAX_BYTES)throw new RootsGpuError('源复根工作区、显示与点缓冲超过 768 MiB','capacity');
 }
 private drainPending(plan:PreparedRootsProjection,isCancelled?:()=>boolean){
  if(!this.pending&&!this.concurrent)return;
  if(plan.mode==='point-cloud')this.ring??=new RootsPointCloudRing();
  (this.concurrent??this.pending)!.drain(plan.mode,plan.mode==='point-cloud'?slice=>this.ring!.append(slice.points!):undefined,{isCancelled});
  if(this.concurrent){this.state=this.concurrent.progress;this.rawInvalid=this.concurrent.facts.invalidRoots;}
 }
 /** Sole display operation for generated and render-only frames. Raw arrivals
  * are consumed before the next borrowed chunk; target histories own no solver. */
 private advanceDisplay(plan:PreparedRootsProjection,batches:Iterable<Float32Array>,color:RootsMetricColorPlan,isCancelled?:()=>boolean,admit:(cost:number)=>void=()=>{}):DisplayFacts {
  rootsGpuCancel(isCancelled);let result:DisplayFacts;
  this.drainPending(plan,isCancelled);
  if(plan.mode==='density'){
   this.density??=new RootsNativeDensityDisplay();
   let facts:ReturnType<RootsNativeDensityDisplay['advanceBatches']>;
   if(this.concurrent||this.pending)(this.concurrent??this.pending)!.consumeDensity(slices=>{
    function* points(){for(const slice of slices)yield slice.points!;}
    facts=this.density!.advanceBatches(plan,points(),color,{isCancelled});
   },{isCancelled});
   else facts=this.density.advanceBatches(plan,batches,color,{isCancelled});
   this.displayInvalid+=facts!.newInvalidPoints;
   result={density:{submittedFinitePointCount:facts!.submittedFinitePointCount,kernel:facts!.actualKernel,capture:facts!.capture,clearInk:facts!.clearInk,clearReasons:facts!.clearReasons,displayRotation:facts!.displayRotation,matrixReferenceViewport:facts!.matrixReferenceViewport}};
  }else{
   this.ring??=new RootsPointCloudRing();
   for(const batch of batches){rootsGpuCancel(isCancelled);this.ring.append(batch);}
   admit(Math.min(this.ring.facts.retainedPointCount,this.ring.facts.recentWindowPoints));
   let target=this.clouds[plan.target];
   if(target&&(target.width!==plan.physicalWidth||target.height!==plan.physicalHeight)){
    target.owner.dispose();delete this.clouds[plan.target];target=undefined;
   }
   const fresh=!target;
   if(!target){target={owner:new RootsNativePointCloudGpu(),width:plan.physicalWidth,height:plan.physicalHeight};this.clouds[plan.target]=target;}
   target.owner.initialize(plan.physicalWidth,plan.physicalHeight);
   if(fresh||!plan.accumulation.enabled)target.owner.clear(color.backgroundPacked);
   if(plan.accumulation.enabled)target.owner.fade(color.backgroundPacked,plan.accumulation.fadeAlpha);
   target.owner.draw(plan,color,this.ring,{isCancelled});
   result={pointCloud:this.cloudFacts(plan)};
  }
  this.displayFrames++;return result;
 }
 private cloudFacts(plan:PreparedRootsProjection):NonNullable<RootsPresentationFacts['pointCloud']> {
  const ring=this.ring!.facts;
  return{retainedPoints:ring.retainedPointCount,drawnPoints:Math.min(ring.retainedPointCount,ring.recentWindowPoints),totalWrites:ring.totalWrites.toString(),accumulationEnabled:plan.accumulation.enabled,fadeAlpha:plan.accumulation.fadeAlpha};
 }
 private readDisplay(plan:PreparedRootsProjection,color:RootsMetricColorPlan,isCancelled?:()=>boolean):Uint8ClampedArray {
  return plan.mode==='density'?this.density!.present(color,{isCancelled}).pixels:this.clouds[plan.target]!.owner.readback(isCancelled);
 }
 private captureOutput(last:CompletedFrame,plan:PreparedRootsProjection,color:RootsMetricColorPlan,pixels:Uint8ClampedArray,display:DisplayFacts,role:'capture'|'preview-refresh',started:number,extraBytes:number):RootsRasterOutput {
  const metadata=last.metadata,facts=metadata.rootsPresentation!;
  const live=this.concurrent?this.liveFacts('snapshot',plan.mode):undefined;
  const pending=this.pending?.facts;
  const autoRecording=pending&&facts.autoRecording?rootsPendingCompletion(pending,{...facts.autoRecording,mode:plan.mode}):facts.autoRecording;
  const cameraTimeline=facts.cameraTimeline?{...facts.cameraTimeline,framesAdvanced:0,readbacks:1,displayFrames:this.displayFrames,inkClears:this.density?.diagnostics().clears??0}:undefined;
  const output:RootsRasterOutput={...metadata,...(live?{rootsLive:live,roots:{...metadata.roots!,...this.state!,math:{...metadata.roots!.math!,iterationLimitSamples:this.state!.nonconvergentSamples}}}:{}),width:plan.physicalWidth,height:plan.physicalHeight,pixels,
   rootsPresentation:{...facts,...(live?{attemptedSamples:this.state!.attemptedSamples,totalRawPoints:this.state!.rootPoints}:{}),presentationAlpha:role==='capture'?'preserved-framebuffer-rgba':'opaque-framebuffer-rgb',newSamples:live?this.state!.attemptedSamples-facts.attemptedSamples:0,newRawPoints:live?this.state!.rootPoints-facts.totalRawPoints:0,restartReason:null,physicalSize:[plan.physicalWidth,plan.physicalHeight],logicalSize:[plan.logicalWidth,plan.logicalHeight],referenceLogicalHeight:plan.referenceLogicalHeight,target:plan.target,...display,...(pending?{pending}:{}),...(autoRecording?{autoRecording}:{}),...(cameraTimeline?{cameraTimeline}:{}),pausedCapture:{policy:'same-instance-render-only-v1',role,baseScale:1,clockAdvanced:false,samplesGenerated:live?null:0,arrivals:live?'concurrent-pending':pending?'retained-local-pending':'local-no-pending',primarySize:[last.plan.physicalWidth,last.plan.physicalHeight]}},
   ...(display.density?{rootsColor:{...metadata.rootsColor!,submittedFinitePointCount:display.density.submittedFinitePointCount,exposureScale:rootsDensityScale({submittedFinitePointCount:display.density.submittedFinitePointCount,width:plan.physicalWidth,height:plan.physicalHeight}),paletteOffset:color.paletteOffset}}:{}),
   temporal:metadata.temporal?{...metadata.temporal,cacheHits:1}:undefined,stats:{...metadata.stats,...(live?{samples:this.state!.attemptedSamples,generated:this.state!.rootPoints}:{}),invalid:this.state!.invalidSamples+this.rawInvalid+this.displayInvalid,elapsedMs:performance.now()-started},
   warnings:[...last.baseWarnings.filter(w=>w!==COLD_EXPORT_WARNING&&(role!=='capture'||w!==OPAQUE_FRAME_WARNING)),live?'同实例截图不推进场景时钟；后台求根继续，截图与主预览分别消费可用积压点。':pending?PENDING_CAPTURE_WARNING:PAUSED_CAPTURE_WARNING,...(role==='capture'?[CAPTURE_ALPHA_WARNING]:[]),...this.counterWarnings()],
  };
  const {pixels:_,...outputMetadata}=output;
  this.admitMemory(plan,last.mathBytes,last.descriptorBytes+descriptorRepresentationBytes(outputMetadata)+extraBytes);
  return{...structuredClone(outputMetadata),pixels};
 }
 /** Toolbar recording reconstructs the last applied document, including its
  * computation workers. Completion is observed after each real display; no
  * predicted sample/frame count can stand in for asynchronous arrivals. */
 beginRecording(scene:SceneDocument,c:GenerateContext,options:SourceRecordingOptions){
  if(this.recording)throw Error('复根录制已经开始');
  if(!c.rootsLive||!this.matchesCompletedPrimary(scene,c))throw Error('复根录制需要最后成功的实时主预览');
  rootsGpuCancel(c.isCancelled);
  if(!options||!Number.isSafeInteger(options.simulationFps)||options.simulationFps<1||options.simulationFps>120)throw Error('复根录制帧率必须为 1–120 的整数');
  const last=this.completed!,size=sourceRecordingSize(options,c.rootsPixelDensity??NaN);
  if(c.width!==last.plan.physicalWidth||c.height!==last.plan.physicalHeight||c.rootsViewport?.target==='offscreen')throw Error('复根录制主视口与最后成功预览不一致');
  const input=snapshotGenerationInput(c);
  const descriptorBytes=2*descriptorRepresentationBytes(scene)+4*descriptorRepresentationBytes(input);
  this.admitMemory(last.plan,0,last.descriptorBytes+descriptorBytes);
  const author=structuredClone(scene),live={...validateRootsLiveContext(c.rootsLive),clock:{paused:false}};
  const controlReset=live.controls?this.controlOwner!.prepareRecordingReset():undefined;
  if(controlReset)live.controls={acknowledgedRevision:controlReset.receipt.revision,commands:[]};
  const primary:GenerateContext={...input,time:0,rootsLive:live,rootsViewport:{logicalWidth:last.plan.logicalWidth,logicalHeight:last.plan.logicalHeight,referenceLogicalHeight:last.plan.referenceLogicalHeight,target:'primary'}};
  const target:GenerateContext={...primary,isCancelled:c.isCancelled,quality:'export',width:size.width,height:size.height,rootsViewport:{logicalWidth:size.logicalWidth,logicalHeight:size.logicalHeight,referenceLogicalHeight:last.plan.referenceLogicalHeight,target:'offscreen'}};
  const plan=prepareRootsProjection((controlReset?.current??author).rootsPresentation!,{width:target.width,height:target.height,viewport:target.rootsViewport!});
  // Admit the new target against the existing identical computation budget
  // before destroying the completed preview. Rebuilding starts no worker here.
  this.admitMemory(plan,0,last.descriptorBytes+descriptorBytes);
  const record:LiveRecording={handle:{},author,primary,target,simulationFps:options.simulationFps,next:0,complete:false,finished:false,descriptorBytes};
  if(controlReset)this.preflightControls(controlReset,target,author);
  if(!controlReset)this.reset();
  try{
   if(controlReset){this.controlTemporaryBytes=controlReset.peakBytes;this.applyControls(this.controlOwner!,controlReset,target);}
   const warmup=this.runLive(author,target,{kind:'recording',simulationFps:record.simulationFps,displayFrame:0,descriptorBytes});
   record.next=1;record.complete=warmup.rootsLive!.autoRecording.complete;this.recording=record;
   return{handle:record.handle,scene:structuredClone(author),context:snapshotGenerationInput(primary),clock:{simulationFps:record.simulationFps,warmupUpdates:1 as const,completionReason:'observed-roots-display' as const},warmup};
  }catch(error){this.reset([error]);throw error;}finally{this.controlTemporaryBytes=0;}
 }
 ownsRecording(handle:object):boolean{return this.recording?.handle===handle;}
 nextRecordingFrame(handle:object,displayFrame:number):RootsRasterOutput {
  const record=this.recording;
  if(!record||record.handle!==handle||record.finished||record.complete)throw Error('复根录制已完成或身份已失效');
  if(!Number.isSafeInteger(displayFrame)||displayFrame!==record.next)throw Error('复根录制必须连续请求下一显示帧');
  // Cancellation before a draw preserves the last delivered state for finish.
  rootsGpuCancel(record.target.isCancelled);
  try{
   const output=this.runLive(record.author,record.target,{kind:'recording',simulationFps:record.simulationFps,displayFrame,descriptorBytes:record.descriptorBytes});
   record.next++;record.complete=output.rootsLive!.autoRecording.complete;return output;
  }catch(error){this.reset([error]);throw error;}
 }
 finishRecording(handle:object,timestampMs?:number){
  const record=this.recording??this.recordingHandoff;
  if(!record||record.handle!==handle)throw Error('复根录制身份已失效');
  // disableRenderMode resets only lastTime. It never resets scene time,
  // restores pause angles, reconstructs workers or repeats the final update.
  if(!record.finished){this.hostClock!.resetTime(timestampMs);record.finished=true;}
  const primary={...record.primary,time:this.cameraClock!.snapshot().sceneTime,isCancelled:undefined};
  try{
   const preview=this.runLive(record.author,primary,{kind:'snapshot'});
   this.recording=undefined;this.recordingHandoff=record;
   return{scene:structuredClone(record.author),context:snapshotGenerationInput(primary),preview};
  }catch(error){this.reset([error]);throw error;}
 }
 setPaused(paused:boolean,timestampMs?:number):void {
  if(this.recording)throw Error('复根录制进行中，不能切换播放状态');
  if(!this.liveContext||!this.hostClock||!this.cameraClock)throw Error('复根播放控制需要实时实例');
  const restore=this.hostClock.setPaused(paused,this.cameraClock.snapshot().camera,timestampMs);
  if(restore)this.cameraClock.writeAngles(restore);
  this.liveContext={...this.liveContext,clock:{...this.liveContext.clock,paused}};
  this.recordingHandoff=undefined;this.recordingDescriptorBytes=0;
 }
 private liveFacts(renderKind:'update'|'snapshot',mode:'density'|'point-cloud'):RootsLiveFacts {
  const stream=this.concurrent!.facts,frame=this.cameraClock!.snapshot(),host=this.hostClock!.diagnostics();
  const inputs={queueComplete:frame.queueComplete,hasAnimations:this.liveHasAnimations,mode,finishedWorkers:stream.pending.finishedWorkers,workerCount:stream.pending.workerCount,queueSize:stream.pool.queuedBatches+stream.pool.waitingBatches+stream.pending.queuedBatches,pendingPoints:stream.pending.pendingPoints};
  return{...(this.controlOwner&&this.liveContext!.controls?{controls:this.controlOwner.receipt,presentation:structuredClone({...this.controlOwner.currentScene.rootsPresentation!,camera:{...this.controlOwner.currentScene.rootsPresentation!.camera,...frame.camera}})}:{}),sessionId:this.liveContext!.sessionId,paused:host.paused,clockSource:host.clockSource,renderKind,sceneTime:frame.sceneTime,frame,stream,autoRecording:{...inputs,policy:'roots-worker-arrival-v1',complete:isRootsAutoRecordingComplete(inputs)}};
 }
 private controlProjection(scene:SceneDocument,c:GenerateContext,camera?:RootsSceneFrame['camera']){
  return prepareRootsProjection({...scene.rootsPresentation!,...(camera?{camera:{...scene.rootsPresentation!.camera,...camera}}:{})},{width:c.width,height:c.height,viewport:c.rootsViewport??{logicalWidth:c.width,logicalHeight:c.height,referenceLogicalHeight:c.height,target:'primary'}});
 }
 private preflightControls(transaction:PreparedRootsControls,c:GenerateContext,author?:SceneDocument){
  validateRasterRequest(c);rootsGpuCancel(c.isCancelled);const live=validateRootsLiveContext(c.rootsLive);
  if(!Number.isFinite(c.time))throw new RootsGpuError('复根预览请求时间无效','input');
  if(!transaction.steps.some(s=>s.reset)&&this.concurrent&&live.maximumWorkers<this.concurrent.facts.pool.workerCount)throw new RootsGpuError('现有复根线程超过调用方新预算，请重新 Apply','capacity');
  if(c.rootsPixelDensity!==undefined&&(!Number.isSafeInteger(c.rootsPixelDensity)||c.rootsPixelDensity<1))throw new RootsGpuError('复根显示像素密度无效','input');
  const authorBytes=author===undefined?0:rootsControlRepresentationBytes(author)*3;
  if(!transaction.steps.some(s=>s.reset))this.hostClock?.assertPaused(live.clock.paused);
  for(const step of transaction.steps.length?transaction.steps:[{scene:transaction.current,reset:false}]){
   const scene=step.scene,plan=this.controlProjection(scene,c),color=prepareRootsDensityColor(scene);if(color.kind!=='metric-sum')throw new RootsGpuError('复根配色无效','input');
   const reserve=transaction.peakBytes+transaction.retainedBytes+(this.completed?.descriptorBytes??0)+authorBytes;
   const maximumBytes=MAX_BYTES-this.displayPeak(plan)-CHUNK*16-reserve-(plan.mode==='point-cloud'?ROOTS_POINT_CLOUD_DEFAULT_BYTES:0);
   const prepared=prepareRootsComputationPlan(scene.rootsMath,color.metric,{maximumWorkers:live.maximumWorkers,maximumBytes});if(!prepared.ok)throw prepared.error;
   const p=prepared.value;prepareRootsPendingPlan({...scene.rootsPresentation!.pending!,batchSize:p.configuration.sampling.batchSize,workerCount:p.partitions.workerCount,maxPointsPerSample:p.maxPointsPerSample});
   if(p.reservedBytes+RootsPendingQueue.minimumBytes>maximumBytes)throw new RootsGpuError('复根控制与运行缓冲超过 768 MiB','capacity');
   this.admitMemory(plan,0,reserve);
  }
  rootsGpuCancel(c.isCancelled);
 }
 private initializeControlled(scene:SceneDocument,c:GenerateContext){
  const live=validateRootsLiveContext(c.rootsLive),plan=this.controlProjection(scene,c),color=prepareRootsDensityColor(scene);if(color.kind!=='metric-sum')throw new RootsGpuError('复根配色无效','input');
  this.resetRuntime();this.controlledOffset=undefined;this.instance++;this.liveContext=live;
  const timeline=prepareRootsCameraTimeline(scene);this.cameraClock=createRootsCameraClock(scene,timeline);this.hostClock=new SourceSceneHostClock(live.clock.paused,this.cameraClock.snapshot().camera);this.liveHasAnimations=timeline.clips.length>0;
  this.pendingAdmission=bytes=>this.admitMemory(plan,0,0,undefined,bytes);
  const maximumBytes=MAX_BYTES-this.displayPeak(plan)-CHUNK*16-(plan.mode==='point-cloud'?ROOTS_POINT_CLOUD_DEFAULT_BYTES:0)-(this.controlOwner?.retainedBytes??0)-this.controlTemporaryBytes;
  this.concurrent=new RootsConcurrentStream(scene.rootsMath,color.metric,scene.rootsPresentation!.pending!,{maximumWorkers:live.maximumWorkers,maximumBytes},undefined,bytes=>this.pendingAdmission!(bytes));this.state=this.concurrent.progress;this.concurrent.start();
 }
 private applyControls(owner:RootsControlOwner,transaction:PreparedRootsControls,c:GenerateContext){
  for(const step of transaction.steps){
   if(step.reset)this.initializeControlled(step.scene,c);
   else if(step.kind==='camera'){const camera=step.scene.rootsPresentation!.camera;this.cameraClock!.writeAngles(camera);this.cameraClock!.writeZoom(camera.zoom);}
   else if(step.kind==='offset')this.controlledOffset=Number(step.scene.settings.rootSourcePaletteOffset);
   // Preserve ordered transform effects even if subsequent commands restore
   // the original value. This touches no pending batches or clock.
   if((step.kind==='transform'||step.kind==='camera')&&this.density){const color=prepareRootsDensityColor(step.scene);if(color.kind!=='metric-sum')throw new RootsGpuError('复根配色无效','input');this.density.advanceBatches(this.controlProjection(step.scene,c,this.cameraClock!.snapshot().camera),[],color,{isCancelled:c.isCancelled});}
  }
  owner.commit(transaction);this.controlOwner=owner;
 }
 private runLive(scene:SceneDocument,c:GenerateContext,operation?:{kind:'recording';simulationFps:number;displayFrame:number;descriptorBytes:number}|{kind:'snapshot'}):RootsRasterOutput {
  const started=performance.now();validateRasterRequest(c);rootsGpuCancel(c.isCancelled);
  const author=scene,live=validateRootsLiveContext(c.rootsLive);
  const controlled=live.controls!==undefined;
  if(controlled){if(!this.controlOwner||this.controlOwner.sessionId!==live.sessionId)throw new RootsGpuError("复根控制状态缺失，请重新 Apply","input");scene=this.controlOwner.currentScene;}
  if(c.rootsPixelDensity!==undefined&&(!Number.isSafeInteger(c.rootsPixelDensity)||c.rootsPixelDensity<1))throw Error('复根显示像素密度必须为正整数');
  if(!usesRootsNativePresentation(scene)||!usesRootsNativeMath(scene)||scene.settings.rootsMode!=='progressive'||!usesRootsCameraTimeline(scene))throw Error('复根实时预览需要完整源数学、显示和相机队列');
  if(!Number.isFinite(c.time))throw Error('复根预览请求时间无效');
  const timeline=prepareRootsCameraTimeline(scene),pending=scene.rootsPresentation!.pending;
  if(!pending)throw Error('复根实时预览需要显式待绘制预算');
  let color=prepareRootsDensityColor(scene);
  if(color.kind!=='metric-sum')throw Error('复根实时预览需要源平均度量配色');
  const projection=(camera?:RootsSceneFrame['camera'])=>prepareRootsProjection(camera?{...scene.rootsPresentation!,camera:{...scene.rootsPresentation!.camera,...camera}}:scene.rootsPresentation!,{width:c.width,height:c.height,viewport:c.rootsViewport??{logicalWidth:c.width,logicalHeight:c.height,referenceLogicalHeight:c.height,target:'primary'}});
  let plan=projection();const camera=scene.rootsPresentation!.camera;
  const identity:Identity={document:rootsPresentationRequestIdentity(scene,live.sessionId),math:numericIdentity([scene.rootsMath,color.metric,live.maximumWorkers]),mode:plan.mode,timeline:numericIdentity(scene.timeline),clock:'source-live-clock-v1',camera:numericIdentity([camera.phi,camera.theta,camera.gamma,camera.zoom]),gradient:numericIdentity(color.paletteOffset),pending:numericIdentity(pending)};
  const prior=this.identity;
  const restartReason:RootsPresentationFacts['restartReason']=controlled?null:!prior?'initial':prior.document!==identity.document?'document':prior.mode!==identity.mode?'mode':prior.math!==identity.math||prior.clock!==identity.clock?'math':prior.timeline!==identity.timeline?'timeline':prior.camera!==identity.camera?'camera':prior.gradient!==identity.gradient?'gradient':prior.pending!==identity.pending?'pending-policy':null;
  const requestKey=this.requestKey(author,c);this.completed=undefined;
  if(restartReason){
   this.reset();this.identity=identity;this.instance++;this.liveContext=live;
   this.cameraClock=createRootsCameraClock(scene,timeline);this.hostClock=new SourceSceneHostClock(live.clock.paused,this.cameraClock.snapshot().camera);this.liveHasAnimations=timeline.clips.length>0;
   this.pendingAdmission=bytes=>this.admitMemory(plan,0,requestKey.length*2,undefined,bytes);
   const maximumBytes=MAX_BYTES-this.displayPeak(plan)-CHUNK*16-requestKey.length*2-(plan.mode==='point-cloud'?ROOTS_POINT_CLOUD_DEFAULT_BYTES:0);
   this.concurrent=new RootsConcurrentStream(scene.rootsMath,color.metric,pending,{maximumWorkers:live.maximumWorkers,maximumBytes},undefined,bytes=>this.pendingAdmission!(bytes));
   this.state=this.concurrent.progress;this.concurrent.start();
  }
  if(operation?.kind==='recording')this.recordingDescriptorBytes=operation.descriptorBytes;
  this.hostClock!.assertPaused(live.clock.paused);
  const before=this.state!,previous=this.cameraClock!.snapshot();
  const dt=operation?.kind==='recording'?Math.fround(1/Math.fround(operation.simulationFps)):operation?.kind==='snapshot'?0:this.hostClock!.update(live.clock);
  const frame=operation?.kind==='snapshot'?previous:this.cameraClock!.step(dt,{paused:live.clock.paused,allowSignedDt:true,isCancelled:c.isCancelled});
  plan=projection(frame.camera);if(controlled&&frame.gradient?.phases.some(p=>p.applied))this.controlledOffset=undefined;
  if(controlled&&this.controlledOffset!==undefined)color={...color,paletteOffset:this.controlledOffset};else if(frame.gradient)color={...color,paletteOffset:frame.gradient.offset};
  this.admitMemory(plan,0,requestKey.length*2);
  this.pendingAdmission=bytes=>this.admitMemory(plan,0,requestKey.length*2,undefined,bytes);
  if(operation?.kind!=='snapshot')for(let i=0;i<(previous.queueComplete||live.clock.paused?1:2);i++)this.drainPending(plan,c.isCancelled);
  const display=this.advanceDisplay(plan,[],color,c.isCancelled),pixels=this.readDisplay(plan,color,c.isCancelled);
  rootsGpuCancel(c.isCancelled);this.lastTime=c.time;this.liveContext=live;
  const state=this.state!,liveFacts=this.liveFacts(operation?.kind==='snapshot'?'snapshot':'update',plan.mode),density=display.density;
  if(operation?.kind==='recording'){liveFacts.clockSource='render-fixed-step';liveFacts.recording={displayFrame:operation.displayFrame,simulationFps:operation.simulationFps,warmup:operation.displayFrame===0,complete:liveFacts.autoRecording.complete};}
  const facts:RootsPresentationFacts={model:'mathart-1.7.8-v1',mode:plan.mode,clockPolicy:'source-live-clock-v1',streamPolicy:'worker-arrival',presentationAlpha:'opaque-framebuffer-rgb',instance:this.instance,restartReason,attemptedSamples:state.attemptedSamples,newSamples:state.attemptedSamples-before.attemptedSamples,newRawPoints:state.rootPoints-before.rootPoints,totalRawPoints:state.rootPoints,physicalSize:[c.width,c.height],logicalSize:[plan.logicalWidth,plan.logicalHeight],referenceLogicalHeight:plan.referenceLogicalHeight,target:plan.target,...display};
  const warnings=[...color.diagnostics,...timeline.warnings,'后台求根按实际线程批次到达；暂停只停止场景时钟，绘制继续消费积压点。未声明与原版墙钟或逐帧到达顺序一致。',OPAQUE_FRAME_WARNING];
  const output:RootsRasterOutput={type:'raster',dimension:2,cameraResolved:true,backend:'webgl2',width:c.width,height:c.height,pixels,formulaPresentation:formulaPresentation(scene,rootsFormulaViewport(plan)),rootsPresentation:facts,rootsLive:liveFacts,
   roots:{...state,math:{model:'mathart-1.7.8-v1',solver:'aberth-ehrlich-power-substitution',sampling:'java-random48-partitioned',logicalWorkers:liveFacts.stream.pool.workerCount,replayOrder:'worker-arrival',residualMeasured:false,iterationLimitSamples:state.nonconvergentSamples}},
   ...(density?{rootsColor:{version:color.version,inkKind:color.kind,metric:color.metric,submittedFinitePointCount:density.submittedFinitePointCount,exposureScale:rootsDensityScale({submittedFinitePointCount:density.submittedFinitePointCount,width:c.width,height:c.height}),accumulationPrecision:'float32' as const,toneBackend:'webgl2' as const,paletteOffset:color.paletteOffset}}:{}),
   stats:{samples:state.attemptedSamples,generated:state.rootPoints,invalid:state.invalidSamples+this.rawInvalid+this.displayInvalid,elapsedMs:performance.now()-started},warnings:[...warnings,...this.counterWarnings()]};
  const {pixels:_,warnings:ignored,...metadata}=output;
  const configuration:RootsPresentationConfiguration={...scene.rootsPresentation!,camera:{...scene.rootsPresentation!.camera,...plan.camera,center:[...plan.camera.center]}};
  const descriptorBytes=requestKey.length*2+descriptorRepresentationBytes({plan,color,configuration,metadata,baseWarnings:warnings});
  this.admitMemory(plan,0,descriptorBytes+descriptorRepresentationBytes(metadata));
  this.completed={requestKey,time:c.time,plan,color:structuredClone(color),configuration:structuredClone(configuration),metadata:structuredClone(metadata),baseWarnings:warnings,mathBytes:0,descriptorBytes};
  return output;
 }
 private run(scene:SceneDocument,c:GenerateContext):RootsRasterOutput {
  const started=performance.now();validateRasterRequest(c);rootsGpuCancel(c.isCancelled);
  const requestKey=this.requestKey(scene,c);this.completed=undefined;
  if(!usesRootsNativePresentation(scene)||!usesRootsNativeMath(scene)||scene.settings.rootsMode!=='progressive')throw new Error('源复根显示要求源数学和渐进模式');
  if(!Number.isFinite(c.time)||c.time<0||c.time>86400)throw new Error('源复根显示时间须为 0–86400 秒');
  const cameraTimeline=usesRootsCameraTimeline(scene)?prepareRootsCameraTimeline(scene):undefined;
  // The sequential owner advances the source camera once per display frame.
  // Calling sceneAtTime here would replay a second, discarded cold camera.
  const current=cameraTimeline?scene:sceneAtTime(scene,c.time);
  const preparedColor=prepareRootsDensityColor(current);
  if(preparedColor.kind!=='metric-sum')throw new Error('源复根显示要求源平均度量配色');
  let color:RootsMetricColorPlan=preparedColor;
  const projection=(camera?:RootsSceneFrame['camera'])=>prepareRootsProjection(camera?{...current.rootsPresentation!,camera:{...current.rootsPresentation!.camera,...camera}}:current.rootsPresentation!,{width:c.width,height:c.height,viewport:c.rootsViewport??{logicalWidth:c.width,logicalHeight:c.height,referenceLogicalHeight:c.height,target:'primary'}});
  let plan=projection();
  const schedule=rootsSchedule(scene.settings,scene.rootsMath);
  const clock=JSON.stringify({perFrame:schedule.perFrame,fps:schedule.fps,start:schedule.start});
  const activeClock=rootsSchedule(current.settings,current.rootsMath);
  if(activeClock.perFrame!==schedule.perFrame||activeClock.fps!==schedule.fps||activeClock.start!==schedule.start)throw new Error('源复根本地采样时钟不能在运行中动画改变');
  const initialCamera=scene.rootsPresentation!.camera;
  const pendingConfiguration=current.rootsPresentation!.pending;
  const identity:Identity={document:rootsPresentationRequestIdentity(scene,c.rootsSessionId),math:JSON.stringify(scene.rootsMath),mode:plan.mode,timeline:cameraTimeline?numericIdentity(scene.timeline):JSON.stringify(scene.timeline),clock,camera:cameraTimeline?numericIdentity([initialCamera.phi,initialCamera.theta,initialCamera.gamma,initialCamera.zoom]):'',gradient:cameraTimeline?.model==='roots-scene-sequence-v1'?numericIdentity(color.paletteOffset):'',pending:numericIdentity(pendingConfiguration??null)};
  const prior=this.identity;
  const restartReason:RootsPresentationFacts['restartReason']=!prior?'initial':prior.document!==identity.document?'document':prior.mode!==identity.mode?'mode':prior.math!==identity.math||prior.clock!==clock?'math':prior.timeline!==identity.timeline?'timeline':prior.camera!==identity.camera?'camera':prior.gradient!==identity.gradient?'gradient':prior.pending!==identity.pending?'pending-policy':c.time<this.lastTime?'backward-seek':null;
  if(restartReason){
   this.resetDisplay();
   if(!prior||prior.document!==identity.document)this.math.dispose();else this.math.reset();
   this.state=createRootsNativeProgress(schedule.total);this.rawInvalid=this.displayInvalid=0;this.instance++;this.identity=identity;
   if(cameraTimeline)this.cameraClock=createRootsCameraClock(scene,cameraTimeline);
  }
  const math=this.math.get(scene,{isCancelled:c.isCancelled}),state=this.state!;
  const displayFps=cameraTimeline?.fps??schedule.fps;
  const displayTarget=cameraTimeline?rootsCameraTargetFrame(c.time,cameraTimeline.fps):pendingConfiguration?Math.floor(c.time*displayFps+1e-9):0;
  const sampleTime=cameraTimeline||pendingConfiguration?displayTarget/displayFps:c.time;
  const samplesAt=(time:number)=>rootsSampleProgressAt(schedule,time).attemptedSamples;
  const {frame:targetFrame,attemptedSamples:targetSamples}=rootsSampleProgressAt(schedule,sampleTime);
  const completion=cameraTimeline&&!pendingConfiguration?prepareRootsOrdinalCompletion(math.ensemble!.sampleCount,math.ensemble!.configuredWorkers,math.ensemble!.seed):undefined;
  const newSamples=targetSamples-state.attemptedSamples;
  if(newSamples<0)throw new Error('源复根采样序号不能在现有实例内倒退');
  if(newSamples>2_000_000)throw new RootsGpuError('源复根单次请求超过 200 万个参数样本；请分段播放或缩短跳转','capacity');
  if((cameraTimeline||pendingConfiguration)&&Math.max(0,displayTarget-(cameraTimeline?this.cameraFrame:this.pendingFrame))*c.width*c.height>MAX_DISPLAY_WORK)throw new RootsGpuError('源复根单次逐帧显示超过 10 亿像素与点访问预算；请分段播放或缩短跳转','capacity');
  if(pendingConfiguration&&!cameraTimeline&&displayTarget-this.pendingFrame>ROOTS_CAMERA_FRAME_LIMIT)throw new RootsGpuError('源复根单次逐帧显示超过共享帧预算；请分段播放或缩短跳转','capacity');
  const mathBytes=math.workspaceCapacityBytes+this.math.diagnostics().keyBytes;
  this.admitMemory(plan,mathBytes,requestKey.length*2);
  this.pendingAdmission=bytes=>this.admitMemory(plan,mathBytes,requestKey.length*2,undefined,bytes);
  if(pendingConfiguration&&!this.pending)this.pending=new RootsPendingStream(math,state,schedule,pendingConfiguration,{storage:'points',onBytes:bytes=>this.pendingAdmission!(bytes)});
  const beforeRaw=state.rootPoints,beforeSamples=state.attemptedSamples;
  let work=0,lastStatus=0;
  const onWork=(n:number)=>{work+=n;if(work>(c.quality==='export'?300_000_000:100_000_000))throw new RootsGpuError('源复根本次请求超过求解工作预算；请分段播放或减少样本','capacity');};
  const status=()=>{rootsGpuCancel(c.isCancelled);c.onStatus?.({kind:'roots',attemptedSamples:state.attemptedSamples,targetSamples,totalSamples:schedule.total});lastStatus=performance.now();};
  status();
  let pixels:Uint8ClampedArray,densityFacts:RootsPresentationFacts['density'],pointCloudFacts:RootsPresentationFacts['pointCloud'];
  let displayWork=0,framesAdvanced=0;
  const advance=(framePlan:PreparedRootsProjection,sampleTarget:number,updateDrains=1,pump=true)=>{
   rootsGpuCancel(c.isCancelled);
   const admit=(cost:number)=>{displayWork+=cost;if(displayWork>MAX_DISPLAY_WORK)throw new RootsGpuError('源复根单次逐帧显示超过 10 亿像素与点访问预算；请分段播放或缩短跳转','capacity');};
   admit(c.width*c.height);
   const poll=()=>{if(performance.now()-lastStatus>=500)status();};
   if(this.pending){
    if(pump)this.pending.pump(sampleTarget,color.metric,{isCancelled:c.isCancelled,onWork,poll});
    this.rawInvalid=this.pending.invalidRoots;
    for(let i=0;i<updateDrains;i++)this.drainPending(framePlan,c.isCancelled);
   }
   const batches=this.pending?[]:this.arrivals(math,state,sampleTarget,color,c,schedule,onWork,poll,bytes=>this.admitMemory(framePlan,mathBytes,requestKey.length*2+bytes));
   const facts=this.advanceDisplay(framePlan,batches,color,c.isCancelled,admit);
   densityFacts=facts.density;pointCloudFacts=facts.pointCloud;
  };
  if(cameraTimeline){
   const cameraBudget=createRootsCameraWorkBudget(cameraTimeline);let previousCamera=this.cameraClock!.snapshot();
   for(let frame=this.cameraFrame+1;frame<=displayTarget;frame++){
    cameraBudget.reserveFrame(previousCamera.queueIndex);
    const camera=this.cameraClock!.step(cameraTimeline.dt,{isCancelled:c.isCancelled});
    plan=projection(camera.camera);
    if(camera.gradient)color={...color,paletteOffset:camera.gradient.offset};
    advance(plan,samplesAt(frame/cameraTimeline.fps),previousCamera.queueComplete||previousCamera.paused?1:2);
    this.cameraFrame=frame;framesAdvanced++;previousCamera=camera;
   }
   if(framesAdvanced===0){
    const retained=this.cameraClock!.snapshot();
    plan=projection(retained.camera);
    if(retained.gradient)color={...color,paletteOffset:retained.gradient.offset};
    // Paused/repeated cloud requests only read the existing framebuffer. A hot
    // presentation edit keeps the established local redraw policy explicitly.
    if(plan.mode==='density'||this.displayKey!==numericIdentity([plan,color]))advance(plan,targetSamples,1,false);
   }
  }else if(this.pending){
   for(let frame=this.pendingFrame+1;frame<=displayTarget;frame++){
    advance(plan,samplesAt(frame/displayFps));this.pendingFrame=frame;framesAdvanced++;
   }
   if(framesAdvanced===0&&(plan.mode==='density'||this.displayKey!==numericIdentity([plan,color])))advance(plan,targetSamples,1,false);
  }else advance(plan,targetSamples);
  this.displayKey=numericIdentity([plan,color]);
  pixels=this.readDisplay(plan,color,c.isCancelled);
  if(plan.mode==='point-cloud')pointCloudFacts=this.cloudFacts(plan);
  rootsGpuCancel(c.isCancelled);status();state.complete=state.attemptedSamples===schedule.total;this.lastTime=c.time;
  const camera=this.cameraClock?.snapshot();
  const pending=this.pending?.facts;
  const autoRecording=cameraTimeline&&camera?(pending?rootsPendingCompletion(pending,{mode:plan.mode,queueComplete:camera.queueComplete,hasAnimations:cameraTimeline.clips.length>0,configuredWorkerCount:math.ensemble!.configuredWorkers,sampleCount:math.ensemble!.sampleCount}):completion!.at(state.attemptedSamples,plan.mode,camera.queueComplete,cameraTimeline.clips.length>0)):undefined;
  const facts:RootsPresentationFacts={model:'mathart-1.7.8-v1',mode:plan.mode,clockPolicy:'local-fixed-sample-clock-v1',streamPolicy:'global-ordinal',presentationAlpha:'opaque-framebuffer-rgb',instance:this.instance,restartReason,attemptedSamples:state.attemptedSamples,newSamples:state.attemptedSamples-beforeSamples,newRawPoints:state.rootPoints-beforeRaw,totalRawPoints:state.rootPoints,physicalSize:[c.width,c.height],logicalSize:[plan.logicalWidth,plan.logicalHeight],referenceLogicalHeight:plan.referenceLogicalHeight,target:plan.target,...(pending?{pending}:{}),...(autoRecording?{autoRecording}:{}),...(densityFacts?{density:densityFacts}:{}),...(pointCloudFacts?{pointCloud:pointCloudFacts}:{}),...(cameraTimeline&&camera?{cameraTimeline:{model:cameraTimeline.model,replay:'offline-fixed-dt-from-zero' as const,fps:cameraTimeline.fps,frame:displayTarget,completedFrames:camera.frame,sampleTime,framesAdvanced,readbacks:1,rawDt:camera.rawDt,activeDt:camera.activeDt,sceneTime:camera.sceneTime,queueIndex:camera.queueIndex,queueComplete:camera.queueComplete,camera:camera.camera,rates:camera.rates,...(camera.gradient?{gradient:camera.gradient,managerFinishedAtFrameStart:camera.managerFinishedAtFrameStart}:{}),displayFrames:this.displayFrames,inkClears:this.density?.diagnostics().clears??0}}:{})};
  const warnings=[...color.diagnostics,'源复根显示复用 Java 随机数和求根；到达顺序采用样本序号，本地固定采样时钟不代表原版并发到达或实时进度。',cameraTimeline?'源相机队列从第零帧按固定 dt 重放；初始角度与缩放编辑重建实例，其他显示编辑保留本地热更新规则。':'显示尺寸、相机、变换和调色编辑不重放历史点；向后跳转、数学或模式及时间线编辑会建立新的本地回放实例。',COLD_EXPORT_WARNING];
  if(cameraTimeline)warnings.push(...cameraTimeline.warnings,'相机和显示逐帧推进，参数样本按本地采样时钟分配到显示帧；未复现原版实时首帧与并发点到达。'
   ,...(cameraTimeline.model==='roots-scene-sequence-v1'?[pending?'渐变按动作顺序及 active/raw 两次更新执行；点批次只在每帧更新前产生，更新和显示分别排空队列，不模拟原版并发线程时序。初始颜色偏移编辑会重建回放。':'渐变按动作顺序及 active/raw 两次更新执行；到达点仍按本地采样时钟一次提交，没有模拟原版两次并发队列排空。初始颜色偏移编辑会重建回放。']:['仅相机队列保留旧行为；保存的渐变动作尚未启用。']));
  if(pending)warnings.push('批次队列保留未绘制的原始点，密度每次显示按基础预算及积压比例消费；求根完成不代表画面绘制完成。参考堆容量来自显式配置，不是原 JVM 实测值。');
  warnings.push(OPAQUE_FRAME_WARNING);
  const output:RootsRasterOutput={formulaPresentation:formulaPresentation(scene,rootsFormulaViewport(plan)),type:'raster',dimension:2,cameraResolved:true,backend:'webgl2',width:c.width,height:c.height,pixels,rootsPresentation:facts,
   roots:{...state,math:{model:'mathart-1.7.8-v1',solver:'aberth-ehrlich-power-substitution',sampling:'java-random48-partitioned',logicalWorkers:math.ensemble!.workers,replayOrder:'global-ordinal',residualMeasured:false,iterationLimitSamples:state.nonconvergentSamples}},
   ...(densityFacts?{rootsColor:{version:color.version,inkKind:color.kind,metric:color.metric,submittedFinitePointCount:densityFacts.submittedFinitePointCount,exposureScale:rootsDensityScale({submittedFinitePointCount:densityFacts.submittedFinitePointCount,width:c.width,height:c.height}),accumulationPrecision:'float32' as const,toneBackend:'webgl2' as const,paletteOffset:color.paletteOffset}}:{}),
   temporal:{time:c.time,windowStart:schedule.start,frames:Math.max(0,targetFrame+1),samplingFps:schedule.fps,recordedPoints:state.rootPoints,cacheHits:state.attemptedSamples===beforeSamples?1:0},stats:{samples:state.attemptedSamples,generated:state.rootPoints,invalid:state.invalidSamples+this.rawInvalid+this.displayInvalid,elapsedMs:performance.now()-started},warnings:[...warnings,...this.counterWarnings()]};
  const {pixels:_,warnings:ignoredOutputWarnings,...metadata}=output;
  const configuration:RootsPresentationConfiguration={...current.rootsPresentation!,camera:{...current.rootsPresentation!.camera,...plan.camera,center:[...plan.camera.center]}};
  const descriptorBytes=requestKey.length*2+descriptorRepresentationBytes({plan,color,configuration,metadata,baseWarnings:warnings});
  this.admitMemory(plan,mathBytes,descriptorBytes+descriptorRepresentationBytes(metadata));
  this.completed={requestKey,time:c.time,plan,color:structuredClone(color),configuration:structuredClone(configuration),metadata:structuredClone(metadata),baseWarnings:structuredClone(warnings),mathBytes,descriptorBytes};
  return output;
 }
 private counterWarnings():string[]{
  const state=this.state!,warnings:string[]=[];
  if(state.nonconvergentSamples)warnings.push(`${state.nonconvergentSamples} 个源多项式达到迭代上限，有限近似根仍参与绘图。`);
  if(state.invalidSamples)warnings.push(`${state.invalidSamples} 个参数样本的源多项式无效。`);
  if(this.rawInvalid||this.displayInvalid)warnings.push(`${this.rawInvalid} 个根非有限；${this.displayInvalid} 个点未通过密度显示的 float32 世界坐标检查。`);
  return warnings;
 }
 private *arrivals(math:RootsMathJob,state:RootsProgress,target:number,color:RootsMetricColorPlan,c:GenerateContext,schedule:ReturnType<typeof rootsSchedule>,onWork:(n:number)=>void,poll:()=>void,admit:(bytes:number)=>void):Generator<Float32Array>{
  if(target<=state.attemptedSamples)return;
  const capacity=Math.min(CHUNK,Math.max(1,(target-state.attemptedSamples)*math.maxRootCount));
  const reader=new RootsNativePointReader(math,state,'points',admit);
  try{
   const buffer=new Float32Array(capacity*4);let used=0;
   while(state.attemptedSamples<target){
    rootsGpuCancel(c.isCancelled);poll();const ordinal=state.attemptedSamples;
    const sampled=reader.read(schedule.start+Math.floor(ordinal/schedule.perFrame)/schedule.fps,color.metric,{isCancelled:c.isCancelled,onWork});this.rawInvalid+=sampled.invalidRoots;
    let offset=0;
    while(offset<sampled.pointCount){
     const count=Math.min(capacity-used,sampled.pointCount-offset);
     buffer.set(sampled.points!.subarray(offset*4,(offset+count)*4),used*4);used+=count;offset+=count;
     if(used===capacity){yield buffer;used=0;}
    }
   }
   if(used)yield buffer.subarray(0,used*4);
  }finally{reader.dispose();}
 }
}
export function generateRootsNativePresentation(scene:SceneDocument,c:GenerateContext,session?:RootsNativePresentationSession):SceneOutput{
 if(session)return session.generate(scene,c);
 const owner=new RootsNativePresentationSession();return withGenerationCleanup(()=>owner.generate(scene,c),owner);
}
