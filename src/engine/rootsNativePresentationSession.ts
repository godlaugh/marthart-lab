import type {GenerateContext,RootsProgress,SceneDocument,SceneOutput} from '../types';
import {GenerationCleanupState,withGenerationCleanup} from './generationCleanup';
import {RootsMathSession,type RootsMathJob} from './rootsMathJob';
import {usesRootsNativeMath} from './rootsMathConfig';
import {usesRootsNativePresentation} from './rootsPresentationAuthoring';
import {createRootsNativeProgress,RootsNativePointReader} from './rootsNativePointReader';
import {prepareRootsDensityColor,rootsDensityScale,type RootsMetricColorPlan} from './rootsDensityColor';
import {prepareRootsProjection,type PreparedRootsProjection} from './rootsProjection';
import {RootsNativeDensityDisplay} from './rootsNativeDisplay';
import {rootsNativeDensityGpuBytes} from './rootsNativeDensityGpu';
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
/** One worker-owned native presentation instance. Sampling uses the existing
 * mathematical job and its Java streams; only scheduling/arrival order is local.
 * Display edits consume zero historical points. Explicit backseek reconstructs
 * a new local instance, rather than pretending to rewind original native ink. */
export class RootsNativePresentationSession {
 private cleanup=new GenerationCleanupState();
 private math=new RootsMathSession();
 private density?:RootsNativeDensityDisplay;
 private clouds:Partial<Record<'primary'|'offscreen',CloudTarget>>={};
 private completed?:CompletedFrame;
 private pending?:RootsPendingStream;
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
  this.completed=undefined;
  this.density?.dispose();this.density=undefined;
  for(const target of ['primary','offscreen'] as const){this.clouds[target]?.owner.dispose();delete this.clouds[target];}
  this.ring?.dispose();this.ring=undefined;
  this.pending?.dispose();this.pending=undefined;this.pendingFrame=-1;this.pendingAdmission=undefined;
  this.cameraClock=undefined;this.cameraFrame=-1;this.displayFrames=0;this.displayKey=undefined;
 }
 reset(failures:readonly unknown[]=[]){this.cleanup.reset(()=>{
  this.resetDisplay();this.math.dispose();this.identity=undefined;this.state=undefined;
  this.lastTime=-1;this.rawInvalid=this.displayInvalid=0;
 },failures);}
 diagnostics(){const math=this.math.diagnostics(),density=this.density?.diagnostics(),primary=this.clouds.primary?.owner.diagnostics(),offscreen=this.clouds.offscreen?.owner.diagnostics(),cloud=primary??offscreen,ring=this.ring?.facts;return{
  instance:this.instance,attemptedSamples:this.state?.attemptedSamples??0,rawPoints:this.state?.rootPoints??0,math,density,cloud,cloudTargets:{primary,offscreen},ring,displayFrames:this.displayFrames,cameraFrame:this.cameraFrame,completedPrimary:!!this.completed&&this.completed.plan.target==='primary',
  pending:this.pending?.facts,
  retainedBytes:math.workspaceBytes+math.keyBytes+(density?.gpu?.retainedBytes??0)+(primary?.retainedBytes??0)+(offscreen?.retainedBytes??0)+(ring?.allocatedBytes??0)+(this.completed?.descriptorBytes??0)+(this.pending?.retainedBytes??0),
 };}
 generate(scene:SceneDocument,c:GenerateContext):RootsRasterOutput {
  this.cleanup.prepare();
  try{return this.run(scene,c);}catch(error){this.reset([error]);throw error;}
 }
 /** Identity observation for transport recovery after a rejected capture. This
  * does not admit a new size or authorize a mutation. Unknown input is false. */
 matchesCompletedPrimary(scene:SceneDocument,c:GenerateContext):boolean {
  try{const last=this.completed;return !!last&&last.plan.target==='primary'&&Object.is(c.time,last.time)&&this.requestKey(scene,c)===last.requestKey;}
  catch{return false;}
 }
 /** Render the completed live frame into its reusable base-size offscreen target,
  * then refresh primary, in the source paused-PNG order. No clock/sample advance.
  * Stale/input/capacity/pre-cancel rejection precedes mutation and preserves the
  * preview. Once rendering starts, failure revokes the frame and cleans the same
  * owners; a changed density target may already have irreversibly cleared ink. */
 capturePaused(scene:SceneDocument,c:GenerateContext,options:{additionalBytes?:number}={}):{capture:RootsRasterOutput;preview:RootsRasterOutput} {
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
   const captureFacts=this.advanceDisplay(capturePlan,[],last.color,c.isCancelled);
   const capture=this.captureOutput(last,capturePlan,last.color,this.readDisplay(capturePlan,last.color,c.isCancelled),captureFacts,'capture',started,additionalBytes);
   const {pixels:ignoredCapture,...captureMetadata}=capture;
   const captureMetadataBytes=descriptorRepresentationBytes(captureMetadata);
   rootsGpuCancel(c.isCancelled);
   // The ordinary paused update after savePausedFrameInternal drains once;
   // the primary display below supplies the second drain and one more splat.
   this.drainPending(last.plan,c.isCancelled);
   const previewFacts=this.advanceDisplay(last.plan,[],last.color,c.isCancelled);
   const preview=this.captureOutput(last,last.plan,last.color,this.readDisplay(last.plan,last.color,c.isCancelled),previewFacts,'preview-refresh',started,additionalBytes+heldCaptureBytes+captureMetadataBytes);
   rootsGpuCancel(c.isCancelled);
   const {pixels:_,warnings:ignoredPreviewWarnings,...metadata}=preview;
   const metadataBytes=descriptorRepresentationBytes(metadata);
   const descriptorBytes=last.requestKey.length*2+descriptorRepresentationBytes({plan:last.plan,color:last.color,configuration:last.configuration,metadata,baseWarnings:last.baseWarnings});
   this.admitMemory(last.plan,last.mathBytes,last.descriptorBytes+captureMetadataBytes+2*metadataBytes+heldCaptureBytes+additionalBytes);
   this.completed={...last,metadata:structuredClone(metadata),descriptorBytes};
   return{capture,preview};
  }catch(error){this.reset([error]);throw error;}
 }
 private requestKey(scene:SceneDocument,c:GenerateContext):string {
  return rootsGpuInput(()=>numericIdentity([rootsPresentationRequestIdentity(scene,c.rootsSessionId),scene]));
 }
 private displayPeak(plan:PreparedRootsProjection):number {
  return plan.mode==='density'
   ?rootsNativeDensityGpuBytes(plan.physicalWidth,plan.physicalHeight)+rootsNativeInkViewBytes(plan.physicalWidth,plan.physicalHeight,4)-plan.physicalWidth*plan.physicalHeight*16
   :rootsNativePointCloudGpuBytes(plan.physicalWidth,plan.physicalHeight);
 }
 private admitMemory(plan:PreparedRootsProjection,mathBytes:number,extraBytes=0,additionalTarget?:PreparedRootsProjection,pendingBytes=this.pending?.retainedBytes??0){
  let peak=this.displayPeak(plan);
  if(plan.mode==='point-cloud'){
   peak+=ROOTS_POINT_CLOUD_DEFAULT_BYTES;
   const other=plan.target==='primary'?'offscreen':'primary',retained=this.clouds[other];
   if(additionalTarget?.target===other)peak+=this.displayPeak(additionalTarget);
   else if(retained)peak+=rootsNativePointCloudGpuBytes(retained.width,retained.height);
  }
  if(peak+mathBytes+CHUNK*16+pendingBytes+extraBytes>MAX_BYTES)throw new RootsGpuError('源复根工作区、显示与点缓冲超过 768 MiB','capacity');
 }
 private drainPending(plan:PreparedRootsProjection,isCancelled?:()=>boolean){
  if(!this.pending)return;
  if(plan.mode==='point-cloud')this.ring??=new RootsPointCloudRing();
  this.pending.drain(plan.mode,plan.mode==='point-cloud'?slice=>this.ring!.append(slice.points!):undefined,{isCancelled});
 }
 /** Sole display operation for generated and render-only frames. Raw arrivals
  * are consumed before the next borrowed chunk; target histories own no solver. */
 private advanceDisplay(plan:PreparedRootsProjection,batches:Iterable<Float32Array>,color:RootsMetricColorPlan,isCancelled?:()=>boolean,admit:(cost:number)=>void=()=>{}):DisplayFacts {
  rootsGpuCancel(isCancelled);let result:DisplayFacts;
  this.drainPending(plan,isCancelled);
  if(plan.mode==='density'){
   this.density??=new RootsNativeDensityDisplay();
   let facts:ReturnType<RootsNativeDensityDisplay['advanceBatches']>;
   if(this.pending)this.pending.consumeDensity(slices=>{
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
  const pending=this.pending?.facts;
  const autoRecording=pending&&facts.autoRecording?rootsPendingCompletion(pending,{...facts.autoRecording,mode:plan.mode}):facts.autoRecording;
  const cameraTimeline=facts.cameraTimeline?{...facts.cameraTimeline,framesAdvanced:0,readbacks:1,displayFrames:this.displayFrames,inkClears:this.density?.diagnostics().clears??0}:undefined;
  const output:RootsRasterOutput={...metadata,width:plan.physicalWidth,height:plan.physicalHeight,pixels,
   rootsPresentation:{...facts,presentationAlpha:role==='capture'?'preserved-framebuffer-rgba':'opaque-framebuffer-rgb',newSamples:0,newRawPoints:0,restartReason:null,physicalSize:[plan.physicalWidth,plan.physicalHeight],logicalSize:[plan.logicalWidth,plan.logicalHeight],referenceLogicalHeight:plan.referenceLogicalHeight,target:plan.target,...display,...(pending?{pending}:{}),...(autoRecording?{autoRecording}:{}),...(cameraTimeline?{cameraTimeline}:{}),pausedCapture:{policy:'same-instance-render-only-v1',role,baseScale:1,clockAdvanced:false,samplesGenerated:0,arrivals:pending?'retained-local-pending':'local-no-pending',primarySize:[last.plan.physicalWidth,last.plan.physicalHeight]}},
   ...(display.density?{rootsColor:{...metadata.rootsColor!,submittedFinitePointCount:display.density.submittedFinitePointCount,exposureScale:rootsDensityScale({submittedFinitePointCount:display.density.submittedFinitePointCount,width:plan.physicalWidth,height:plan.physicalHeight}),paletteOffset:color.paletteOffset}}:{}),
   temporal:metadata.temporal?{...metadata.temporal,cacheHits:1}:undefined,stats:{...metadata.stats,invalid:this.state!.invalidSamples+this.rawInvalid+this.displayInvalid,elapsedMs:performance.now()-started},
   warnings:[...last.baseWarnings.filter(w=>w!==COLD_EXPORT_WARNING&&(role!=='capture'||w!==OPAQUE_FRAME_WARNING)),pending?PENDING_CAPTURE_WARNING:PAUSED_CAPTURE_WARNING,...(role==='capture'?[CAPTURE_ALPHA_WARNING]:[]),...this.counterWarnings()],
  };
  const {pixels:_,...outputMetadata}=output;
  this.admitMemory(plan,last.mathBytes,last.descriptorBytes+descriptorRepresentationBytes(outputMetadata)+extraBytes);
  return{...structuredClone(outputMetadata),pixels};
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
  const output:RootsRasterOutput={type:'raster',dimension:2,cameraResolved:true,backend:'webgl2',width:c.width,height:c.height,pixels,rootsPresentation:facts,
   roots:{...state,math:{model:'mathart-1.7.8-v1',solver:'aberth-ehrlich-power-substitution',sampling:'java-random48-partitioned',logicalWorkers:math.ensemble!.workers,replayOrder:'global-ordinal',residualMeasured:false,iterationLimitSamples:state.nonconvergentSamples}},
   ...(densityFacts?{rootsColor:{version:color.version,inkKind:color.kind,metric:color.metric,submittedFinitePointCount:densityFacts.submittedFinitePointCount,exposureScale:rootsDensityScale({submittedFinitePointCount:densityFacts.submittedFinitePointCount,width:c.width,height:c.height}),accumulationPrecision:'float32' as const,toneBackend:'cpu' as const,paletteOffset:color.paletteOffset}}:{}),
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
