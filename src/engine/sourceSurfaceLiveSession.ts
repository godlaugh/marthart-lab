import {resolveFormulaContent} from './formulas';
import type {FormulaContent} from '../types';
import {planSourceSurfaceRecording,assertSourceSurfaceRecordingFrame,type SourceSurfaceRecordingFrame} from './sourceSurfaceRecording';
import type {SourceRecordingOptions} from './generationProtocol';
import type {SourceQueueRecordingClock} from './sourceRecordingClock';
import {sourceRecordingSize} from './sourceRecordingSize';
import {navigateSourceViewportCamera,type SourceViewportNavigationEvent} from './sourceViewportNavigation';
import {sourceGeometryCapturePlan,type SourceGeometryCapturePreparation} from './sourceGeometryCapture';
import type {GenerateContext,GenerationInput,SceneDocument,SceneOutput} from '../types';
import {ordinarySourceCameraInitial} from './ordinarySourceCamera';
import {OrdinarySourceCameraTimelineSession,type OrdinarySourceCameraFrame} from './ordinarySourceCameraTimeline';
import {SourceSceneHostClock,validateSourceSceneClockRequest,type SourceSceneClockRequest} from './sourceSceneHostClock';
import {usesSourceSurfaceGeometry,usesSourceSurfaceHost} from './sourceSurfaceIdentity';
import {prepareSourceSurfaceScene} from './sourceSurfaceScene';
import {SourceSurfaceHost} from './sourceSurfaceHost';
import {prepareSourceSurfaceParticles,SourceSurfaceParticles} from './sourceSurfaceParticles';
import {sourceSurfaceWorkBudget} from './sourceSurfaceWork';
import {sourceSurfaceParameterFrameRate} from './sourceSurfaceFrame';
import {snapshotGenerationInput} from './generationInput';
import {presentSourceSurfaceFrame,validateSourceSurfacePresentation,type SourceSurfaceDisplayState} from '../scenes/sourceSurface';

export interface SourceSurfaceLiveContext {
 sessionId:string;revision:number;clock:SourceSceneClockRequest;
 /** Independent local draw observation, not the simulation FPS or JVM clock. */
 actualFrameRate:number;
 /** Captured full configuration for a new local Apply revision. */
 configuration?:SceneDocument;
 /** Explicit local fixed reconstruction on creation; not a native seek API. */
 startAt?:number;
}
export interface SourceSurfaceLiveFacts {
 sessionId:string;revision:number;paused:boolean;renderKind:'update'|'snapshot';
 clockSource:'worker-wall-clock'|'injected'|'fixed-step';recording?:SourceSurfaceRecordingFrame;frame:OrdinarySourceCameraFrame;
 /** Counts actual producer construction, including local revision replacement. */
 constructions:number;
}
type Owned={scene:SceneDocument;formulas:FormulaContent;sessionId:string;revision:number;startAt?:number;clock:SourceSceneHostClock;queue:OrdinarySourceCameraTimelineSession;producer:SourceSurfaceHost|SourceSurfaceParticles};
type Recording={handle:object;clock:SourceQueueRecordingClock;author:SceneDocument;primary:GenerationInput;target:GenerationInput;next:number;actualFrameRate:number;cancel?:()=>boolean;pending?:{frame:OrdinarySourceCameraFrame;actualFrameRate:number};finished?:OrdinarySourceCameraFrame};
function observedRate(value:number|undefined):number{return sourceSurfaceParameterFrameRate({frameIndex:0,time:0,deltaTime:0,actualFrameRate:value},NaN);}
function context(c:GenerateContext):SourceSurfaceLiveContext {
 const v=c.surfaceLive;
 if(!v||typeof v!=='object'||Array.isArray(v)||typeof v.sessionId!=='string'||!v.sessionId.trim()||v.sessionId.length>256||!Number.isSafeInteger(v.revision)||v.revision<0)throw Error('曲面实时会话上下文无效');
 validateSourceSceneClockRequest(v.clock);
 sourceSurfaceParameterFrameRate({frameIndex:0,time:0,deltaTime:0,actualFrameRate:v.actualFrameRate},NaN);
 if(v.startAt!==undefined&&(typeof v.startAt!=='number'||!Number.isFinite(v.startAt)||v.startAt<0||v.startAt>86400))throw Error('曲面本地重建起点必须在 0–86400 秒');
 if(c.domainLive!==undefined||c.fractalLive!==undefined||c.mapLive!==undefined||c.symmetryLive!==undefined||c.samilaLive!==undefined||c.fractalRecording!==undefined||c.sourceBouncingFrame!==undefined||c.spirographFrame!==undefined)throw Error('曲面实时主预览不能混用其它场景时钟');
 if(c.sourceViewport?.target!=='primary')throw Error('曲面实时会话只接受主视口，离屏回放使用独立实例');
 if(c.quality!=='preview'&&c.quality!=='export')throw Error('曲面实时质量无效');
 return v;
}
/** Retains the exact numerical producer, bound targets and queue across worker
 * requests. Recording replaces the producer from its applied anchor, then owns
 * contiguous updates through stop. Geometry display owns no GL or encoder. */
export class SourceSurfaceLiveSession {
 private owned?:Owned;
 private recording?:Recording;private handoff?:Recording;
 private completed?:{sceneId:string;context:GenerationInput};
 private cancel?:()=>boolean;
 private budget=sourceSurfaceWorkBudget();
 private failed=false;private busy=false;private constructions=0;
 private check=()=>{if(this.cancel?.())throw new DOMException('曲面实时生成已取消','AbortError');};
 private reserve=(units:number)=>{this.check();this.budget(units);};
 reset():void {if(this.busy||this.recording&&!this.failed)throw Error('请先结束曲面生成或录制再释放会话');this.recording=undefined;this.handoff=undefined;this.owned=undefined;this.completed=undefined;this.cancel=undefined;this.failed=false;this.constructions=0;}
 diagnostics(){return{failed:this.failed,constructions:this.constructions,sessionId:this.owned?.sessionId,revision:this.owned?.revision,frame:!this.failed?this.owned?.queue.snapshot():undefined,recording:this.recording?{next:this.recording.next,pending:!!this.recording.pending,finished:!!this.recording.finished}:undefined};}
 private prepare(scene:SceneDocument,v:SourceSurfaceLiveContext,c:GenerateContext,simulationFps?:number):Owned {
  const applied=structuredClone(v.configuration??scene);
  if(applied.id!==scene.id||!usesSourceSurfaceGeometry(applied)||!usesSourceSurfaceGeometry(scene))throw Error('曲面实时会话需要匹配的源曲面配置');
  delete applied.evaluatedSourceCamera;const fps=simulationFps??applied.timeline.fps;
  validateSourceSurfacePresentation(applied,c);const initial=ordinarySourceCameraInitial(applied)!,formulas=resolveFormulaContent(applied);
  let producer:Owned['producer'];
  const configuration=usesSourceSurfaceHost(applied)?prepareSourceSurfaceScene(applied).configuration:undefined;
  const prepared=configuration?undefined:prepareSourceSurfaceParticles(applied);
  const queue=new OrdinarySourceCameraTimelineSession(initial,applied.timeline.tracks,fps,{
   particleActions:'surface',surfaceMode:configuration?.mode,isCancelled:()=>this.cancel?.()??false,
   createParticles:()=>producer=configuration?new SourceSurfaceHost({configuration,equations:applied.equations,parameters:applied.parameters,palette:applied.surfaceSourcePalette,frameRate:fps,coverage:'all',reserve:this.reserve,isCancelled:()=>this.cancel?.()??false}):prepared!.create('all',()=>this.cancel?.()??false,this.reserve),
  });
  if(v.startAt===undefined)queue.snapshot();else queue.reconstruct(v.startAt);this.check();
  return{scene:applied,formulas,sessionId:v.sessionId,revision:v.revision,startAt:v.startAt,clock:new SourceSceneHostClock(v.clock.paused,initial),queue,producer:producer!};
 }
 matchesCompletedPrimary(scene:SceneDocument,c:GenerateContext):boolean {
  const own=this.owned,done=this.completed,v=c.surfaceLive,a=c.sourceViewport,b=done?.context.sourceViewport;
  return !this.busy&&!this.recording&&!this.failed&&!!own&&!!done&&!!v&&scene.id===done.sceneId&&scene.id===own.scene.id&&v.sessionId===own.sessionId&&v.revision===own.revision&&v.startAt===own.startAt&&c.width===done.context.width&&c.height===done.context.height&&c.sourcePointPixelDensity===done.context.sourcePointPixelDensity&&!!a&&!!b&&a.logicalWidth===b.logicalWidth&&a.logicalHeight===b.logicalHeight&&a.referenceLogicalHeight===b.referenceLogicalHeight&&a.target===b.target&&a.projectionPass===b.projectionPass;
 }
 setPaused(paused:boolean,timestampMs?:number):OrdinarySourceCameraFrame {
  if(this.busy||this.recording||this.failed||!this.owned||!this.completed)throw Error('曲面播放控制需要已完成的实时主预览');
  validateSourceSceneClockRequest({paused,timestampMs});
  const own=this.owned;this.handoff=undefined;
  try{const restore=own.clock.setPaused(paused,own.queue.snapshot().camera,timestampMs);if(restore)own.queue.writeAngles(restore);this.completed.context.surfaceLive!.clock={...this.completed.context.surfaceLive!.clock,paused};return own.queue.snapshot();}
  catch(error){this.failed=true;this.completed=undefined;throw error;}
 }
 /** Original MathArt.updateParameter writes the current function only. Staged
  * document configuration and the original action target retain their owners. */
 updateParameter(scene:SceneDocument,c:GenerateContext,name:string,value:number):void {
  if(!this.matchesCompletedPrimary(scene,c))throw Error('曲面参数修改需要匹配的已完成主预览');
  this.owned!.clock.assertPaused(context(c).clock.paused);
  if(typeof name!=='string'||typeof value!=='number'||!Number.isFinite(value))throw Error('曲面参数修改需要字符串名称和有限数值');
  this.handoff=undefined;
  try{this.owned!.producer.updateParameter(name,value);}
  catch(error){this.failed=true;this.completed=undefined;throw error;}
 }
 private display(own:Owned,frame:OrdinarySourceCameraFrame,c:GenerateContext,kind:'update'|'snapshot',constructions=this.constructions):SceneOutput {
  const state:SourceSurfaceDisplayState=own.producer instanceof SourceSurfaceHost?{kind:'host',frame,snapshot:own.producer.snapshot()}:{kind:'points',frame,points:own.producer.snapshot()};
  const output=presentSourceSurfaceFrame(own.scene,c,state,performance.now(),own.formulas);
  if(output.type!=='geometry')throw Error('曲面实时会话要求几何输出');
  output.surfaceLive={sessionId:own.sessionId,revision:own.revision,paused:own.clock.diagnostics().paused,renderKind:kind,clockSource:own.clock.diagnostics().clockSource,frame:structuredClone(frame),constructions};
  return output;
 }
 generate(scene:SceneDocument,c:GenerateContext):SceneOutput {
  if(this.busy||this.recording)throw Error('曲面实时会话不能并发生成或录制');const v=context(c);
  const previous=this.owned,fresh=!previous||previous.sessionId!==v.sessionId||previous.scene.id!==scene.id||previous.revision!==v.revision||previous.startAt!==v.startAt;
  if(this.failed&&!fresh)throw Error('曲面实时会话更新失败，需要新会话或配置版本');
  if(!fresh)previous.clock.assertPaused(v.clock.paused);
  this.cancel=c.isCancelled;this.budget=sourceSurfaceWorkBudget();
  let own:Owned;
  try{this.check();own=fresh?this.prepare(scene,v,c):previous;validateSourceSurfacePresentation(own.scene,c);}catch(error){this.cancel=undefined;throw error;}
  this.busy=true;this.completed=undefined;this.handoff=undefined;
  try{
   if(fresh){this.owned=own;this.failed=false;this.constructions++;}
   let frame:OrdinarySourceCameraFrame;
   const snapshot=!fresh&&v.clock.paused;
   if(fresh&&v.startAt!==undefined){frame=own.queue.snapshot();if(!v.clock.paused)own.clock.resetTime(v.clock.timestampMs);}
   else if(snapshot)frame=own.queue.display();
   else frame=own.queue.step(own.clock.update(v.clock),{paused:v.clock.paused,actualFrameRate:v.actualFrameRate});
   const output=this.display(own,frame,c,snapshot?'snapshot':'update');this.check();
   this.completed={sceneId:scene.id,context:snapshotGenerationInput({...c,surfaceLive:{...v,configuration:undefined}})};return output;
  }catch(error){this.failed=true;throw error;}finally{this.busy=false;this.cancel=undefined;}
 }
 /** Native toolbar reset uses the full applied anchor. Stage a fresh producer
  * and warmup geometry before retiring the completed live owner. */
 beginRecording(scene:SceneDocument,c:GenerateContext,options:SourceRecordingOptions){
  if(!this.matchesCompletedPrimary(scene,c))throw Error('曲面录制需要匹配的已完成主预览');
  const actualFrameRate=observedRate(options.actualFrameRate),anchor=this.owned!.scene;
  const clock=planSourceSurfaceRecording(anchor,options.simulationFps,c.isCancelled),primary=snapshotGenerationInput(this.completed!.context);
  const live={...primary.surfaceLive!,configuration:undefined,startAt:undefined,clock:{paused:false},actualFrameRate};
  primary.surfaceLive=live;primary.time=0;
  const size=sourceRecordingSize(options,primary.sourcePointPixelDensity??1);
  const target:GenerationInput={...primary,quality:'export',width:size.width,height:size.height,sourcePointPixelDensity:size.density,sourceViewport:{...primary.sourceViewport!,logicalWidth:size.logicalWidth,logicalHeight:size.logicalHeight,target:'offscreen',referenceLogicalHeight:primary.sourceViewport!.logicalHeight}};
  validateSourceSurfacePresentation(anchor,target);
  this.cancel=c.isCancelled;this.budget=sourceSurfaceWorkBudget();this.busy=true;
  try{
   this.check();const candidate=this.prepare(anchor,{...live,configuration:anchor},primary,clock.simulationFps);
   const frame=candidate.queue.step(Math.fround(1/Math.fround(clock.simulationFps)),{paused:false,actualFrameRate});
   const warmup=this.recordingDisplay(candidate,frame,target,clock,0,actualFrameRate,this.constructions+1);this.check();
   const record:Recording={handle:Object.freeze({}),clock,author:structuredClone(scene),primary,target,next:1,actualFrameRate,cancel:c.isCancelled};
   this.owned=candidate;this.constructions++;this.failed=false;this.completed=undefined;this.handoff=undefined;this.recording=record;
   return{handle:record.handle,scene:structuredClone(candidate.scene),context:snapshotGenerationInput(primary),clock:{...clock},warmup};
  }finally{this.busy=false;this.cancel=undefined;}
 }
 private recordingDisplay(own:Owned,frame:OrdinarySourceCameraFrame,target:GenerationInput,clock:SourceQueueRecordingClock,index:number,actualFrameRate:number,constructions=this.constructions){
  const output=this.display(own,frame,target,'update',constructions);if(output.type!=='geometry'||!output.surfaceLive)throw Error('曲面录制缺少几何帧');
  output.surfaceLive.clockSource='fixed-step';output.surfaceLive.recording={displayFrame:index,simulationFps:clock.simulationFps,actualFrameRate,warmup:index===0,complete:frame.queueComplete};
  if(output.temporal)output.temporal.samplingFps=clock.simulationFps;
  assertSourceSurfaceRecordingFrame(output,clock,index);return output;
 }
 ownsRecording(handle:object):boolean{return !this.failed&&this.recording?.handle===handle;}
 nextRecordingFrame(handle:object,displayFrame:number,actualFrameRate?:number){
  const record=this.recording;
  if(this.busy||!record||!this.ownsRecording(handle)||record.finished||displayFrame!==record.next||displayFrame>record.clock.lastDisplayFrame)throw Error('曲面录制身份或连续帧序号无效');
  const rate=observedRate(actualFrameRate);
  if(record.pending&&!Object.is(record.pending.actualFrameRate,rate))throw Error('曲面录制重试不能改变已消费的实际帧率');
  this.cancel=record.cancel;this.budget=sourceSurfaceWorkBudget();this.busy=true;
  try{
   this.check();
   if(!record.pending){
    try{record.pending={frame:this.owned!.queue.step(Math.fround(1/Math.fround(record.clock.simulationFps)),{paused:false,actualFrameRate:rate}),actualFrameRate:rate};}
    catch(error){this.failed=true;throw error;}
   }
   const output=this.recordingDisplay(this.owned!,record.pending.frame,record.target,record.clock,displayFrame,rate);this.check();
   record.actualFrameRate=rate;record.next++;record.pending=undefined;return output;
  }finally{this.busy=false;this.cancel=undefined;}
 }
 /** Stop resets wall time once. Retry retains the same final numerical snapshot
  * and never inherits cancellation from the recording it is cleaning up. */
 finishRecording(handle:object,timestampMs?:number){
  const record=this.recording??this.handoff;
  if(this.failed||this.busy||!record||record.handle!==handle)throw Error('曲面录制结束身份无效');
  this.busy=true;this.budget=sourceSurfaceWorkBudget();
  try{
   if(!record.finished){this.owned!.clock.resetTime(timestampMs);record.finished=this.owned!.queue.snapshot();}
   const primary=snapshotGenerationInput(record.primary);primary.time=record.finished.sceneTime;
   primary.surfaceLive!.actualFrameRate=record.pending?.actualFrameRate??record.actualFrameRate;
   // A prior Worker publication transferred the display buffers. Render the
   // same numerical state again; snapshot alone can expose detached mesh data.
   try{this.owned!.queue.display();}catch(error){this.failed=true;throw error;}
   const preview=this.display(this.owned!,record.finished,primary,'snapshot');if(preview.type!=='geometry')throw Error('曲面录制结束缺少主预览');
   this.completed={sceneId:record.author.id,context:snapshotGenerationInput(primary)};this.recording=undefined;this.handoff=record;
   return{scene:structuredClone(record.author),context:primary,preview};
  }finally{this.busy=false;}
 }
 /** Original input mutates the current camera and requests draw, whose paused
  * Scene.update clears raw dt without advancing queue or particle animation. */
 navigatePaused(scene:SceneDocument,c:GenerateContext,event:SourceViewportNavigationEvent):SceneOutput {
  if(!this.matchesCompletedPrimary(scene,c))throw Error('曲面视口交互需要匹配的已完成主预览');
  const own=this.owned!;own.clock.assertPaused(true);
  const next=navigateSourceViewportCamera(own.queue.snapshot().camera,'rotate',event,c.sourceViewport!.logicalWidth,c.sourceViewport!.logicalHeight);
  if(!next.ok)throw next.error;
  if(c.isCancelled?.())throw new DOMException('曲面视口交互已取消','AbortError');
  this.handoff=undefined;this.cancel=c.isCancelled;this.budget=sourceSurfaceWorkBudget();this.busy=true;
  try{
   own.queue.writeViewport(next.value);
   const frame=own.queue.step(0,{paused:true,actualFrameRate:c.surfaceLive!.actualFrameRate});
   const output=this.display(own,frame,c,'update');this.check();return output;
  }catch(error){this.failed=true;this.completed=undefined;throw error;}finally{this.busy=false;this.cancel=undefined;}
 }
 /** Native paused capture renders the same scene to an offscreen destination,
  * then primary; neither display calls Scene.update. Preflight is nonmutating. */
 capturePaused(scene:SceneDocument,c:GenerateContext,size:{width:number;height:number},scale:1|3|5):SourceGeometryCapturePreparation {
  if(!this.matchesCompletedPrimary(scene,c))throw Error('曲面截图需要匹配的已完成主预览');
  const own=this.owned!;own.clock.assertPaused(true);
  const plan=sourceGeometryCapturePlan(snapshotGenerationInput(c),size,scale);
  validateSourceSurfacePresentation(own.scene,plan.captureContext);
  this.handoff=undefined;this.cancel=c.isCancelled;this.budget=sourceSurfaceWorkBudget();this.busy=true;
  try{
   this.check();const capture=this.display(own,own.queue.display(),plan.captureContext,'snapshot');
   const preview=this.display(own,own.queue.display(),c,'snapshot');this.check();
   if(capture.type!=='geometry'||preview.type!=='geometry')throw Error('曲面截图缺少几何帧');
   return{scene:structuredClone(own.scene),capture,preview};
  }catch(error){this.failed=true;this.completed=undefined;throw error;}finally{this.busy=false;this.cancel=undefined;}
 }
 /** Re-display current owned geometry without Scene.update or clock advancement.
  * Rebuild the published buffers, since a prior worker transfer detached them. */
 current(scene:SceneDocument,c:GenerateContext):SceneOutput {
  const v=context(c);
  if(!this.matchesCompletedPrimary(scene,c))throw Error('曲面当前帧需要匹配的已完成主预览');
  const own=this.owned!;own.clock.assertPaused(v.clock.paused);this.cancel=c.isCancelled;this.budget=sourceSurfaceWorkBudget();this.busy=true;
  try{this.check();const frame=own.queue.display(),output=this.display(own,frame,c,'snapshot');this.check();return output;}
  catch(error){this.failed=true;this.completed=undefined;throw error;}finally{this.busy=false;this.cancel=undefined;}
 }
}
