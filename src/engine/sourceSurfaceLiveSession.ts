import {navigateSourceViewportCamera,type SourceViewportNavigationEvent} from './sourceViewportNavigation';
import {sourceSurfaceCapturePlan,type SourceSurfaceCapturePreparation} from './sourceSurfaceCapture';
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
 clockSource:'worker-wall-clock'|'injected';frame:OrdinarySourceCameraFrame;
 /** Counts actual producer construction, including local revision replacement. */
 constructions:number;
}
type Owned={scene:SceneDocument;sessionId:string;revision:number;startAt?:number;clock:SourceSceneHostClock;queue:OrdinarySourceCameraTimelineSession;producer:SourceSurfaceHost|SourceSurfaceParticles};
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
 * requests. Fixed/offscreen rendering has a separate owner. No raster target,
 * encoder, full native reload lifecycle or automatic App opt-in lives here. */
export class SourceSurfaceLiveSession {
 private owned?:Owned;
 private completed?:{sceneId:string;context:GenerationInput};
 private cancel?:()=>boolean;
 private budget=sourceSurfaceWorkBudget();
 private failed=false;private busy=false;private constructions=0;
 private check=()=>{if(this.cancel?.())throw new DOMException('曲面实时生成已取消','AbortError');};
 private reserve=(units:number)=>{this.check();this.budget(units);};
 reset():void {if(this.busy)throw Error('曲面生成期间不能释放会话');this.owned=undefined;this.completed=undefined;this.cancel=undefined;this.failed=false;this.constructions=0;}
 diagnostics(){return{failed:this.failed,constructions:this.constructions,sessionId:this.owned?.sessionId,revision:this.owned?.revision,frame:!this.failed?this.owned?.queue.snapshot():undefined};}
 private prepare(scene:SceneDocument,v:SourceSurfaceLiveContext,c:GenerateContext):Owned {
  const applied=structuredClone(v.configuration??scene);
  if(applied.id!==scene.id||!usesSourceSurfaceGeometry(applied)||!usesSourceSurfaceGeometry(scene))throw Error('曲面实时会话需要匹配的源曲面配置');
  delete applied.evaluatedSourceCamera;
  validateSourceSurfacePresentation(applied,c);const initial=ordinarySourceCameraInitial(applied)!;
  let producer:Owned['producer'];
  const configuration=usesSourceSurfaceHost(applied)?prepareSourceSurfaceScene(applied).configuration:undefined;
  const prepared=configuration?undefined:prepareSourceSurfaceParticles(applied);
  const queue=new OrdinarySourceCameraTimelineSession(initial,applied.timeline.tracks,applied.timeline.fps,{
   particleActions:'surface',surfaceMode:configuration?.mode,isCancelled:()=>this.cancel?.()??false,
   createParticles:()=>producer=configuration?new SourceSurfaceHost({configuration,equations:applied.equations,parameters:applied.parameters,palette:applied.surfaceSourcePalette,frameRate:applied.timeline.fps,coverage:'all',reserve:this.reserve,isCancelled:()=>this.cancel?.()??false}):prepared!.create('all',()=>this.cancel?.()??false,this.reserve),
  });
  if(v.startAt===undefined)queue.snapshot();else queue.reconstruct(v.startAt);this.check();
  return{scene:applied,sessionId:v.sessionId,revision:v.revision,startAt:v.startAt,clock:new SourceSceneHostClock(v.clock.paused,initial),queue,producer:producer!};
 }
 matchesCompletedPrimary(scene:SceneDocument,c:GenerateContext):boolean {
  const own=this.owned,done=this.completed,v=c.surfaceLive,a=c.sourceViewport,b=done?.context.sourceViewport;
  return !this.busy&&!this.failed&&!!own&&!!done&&!!v&&scene.id===done.sceneId&&scene.id===own.scene.id&&v.sessionId===own.sessionId&&v.revision===own.revision&&v.startAt===own.startAt&&c.width===done.context.width&&c.height===done.context.height&&c.sourcePointPixelDensity===done.context.sourcePointPixelDensity&&!!a&&!!b&&a.logicalWidth===b.logicalWidth&&a.logicalHeight===b.logicalHeight&&a.referenceLogicalHeight===b.referenceLogicalHeight&&a.target===b.target&&a.projectionPass===b.projectionPass;
 }
 setPaused(paused:boolean,timestampMs?:number):OrdinarySourceCameraFrame {
  if(this.busy||this.failed||!this.owned||!this.completed)throw Error('曲面播放控制需要已完成的实时主预览');
  validateSourceSceneClockRequest({paused,timestampMs});
  const own=this.owned;
  try{const restore=own.clock.setPaused(paused,own.queue.snapshot().camera,timestampMs);if(restore)own.queue.writeAngles(restore);this.completed.context.surfaceLive!.clock={...this.completed.context.surfaceLive!.clock,paused};return own.queue.snapshot();}
  catch(error){this.failed=true;this.completed=undefined;throw error;}
 }
 /** Original MathArt.updateParameter writes the current function only. Staged
  * document configuration and the original action target retain their owners. */
 updateParameter(scene:SceneDocument,c:GenerateContext,name:string,value:number):void {
  if(!this.matchesCompletedPrimary(scene,c))throw Error('曲面参数修改需要匹配的已完成主预览');
  this.owned!.clock.assertPaused(context(c).clock.paused);
  if(typeof name!=='string'||typeof value!=='number'||!Number.isFinite(value))throw Error('曲面参数修改需要字符串名称和有限数值');
  try{this.owned!.producer.updateParameter(name,value);}
  catch(error){this.failed=true;this.completed=undefined;throw error;}
 }
 private display(own:Owned,frame:OrdinarySourceCameraFrame,c:GenerateContext,kind:'update'|'snapshot'):SceneOutput {
  const state:SourceSurfaceDisplayState=own.producer instanceof SourceSurfaceHost?{kind:'host',frame,snapshot:own.producer.snapshot()}:{kind:'points',frame,points:own.producer.snapshot()};
  const output=presentSourceSurfaceFrame(own.scene,c,state);
  if(output.type!=='geometry')throw Error('曲面实时会话要求几何输出');
  output.surfaceLive={sessionId:own.sessionId,revision:own.revision,paused:own.clock.diagnostics().paused,renderKind:kind,clockSource:own.clock.diagnostics().clockSource,frame:structuredClone(frame),constructions:this.constructions};
  return output;
 }
 generate(scene:SceneDocument,c:GenerateContext):SceneOutput {
  if(this.busy)throw Error('曲面实时会话不能并发生成');const v=context(c);
  const previous=this.owned,fresh=!previous||previous.sessionId!==v.sessionId||previous.scene.id!==scene.id||previous.revision!==v.revision||previous.startAt!==v.startAt;
  if(this.failed&&!fresh)throw Error('曲面实时会话更新失败，需要新会话或配置版本');
  if(!fresh)previous.clock.assertPaused(v.clock.paused);
  this.cancel=c.isCancelled;this.budget=sourceSurfaceWorkBudget();
  let own:Owned;
  try{this.check();own=fresh?this.prepare(scene,v,c):previous;validateSourceSurfacePresentation(own.scene,c);}catch(error){this.cancel=undefined;throw error;}
  this.busy=true;this.completed=undefined;
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
 /** Original input mutates the current camera and requests draw, whose paused
  * Scene.update clears raw dt without advancing queue or particle animation. */
 navigatePaused(scene:SceneDocument,c:GenerateContext,event:SourceViewportNavigationEvent):SceneOutput {
  if(!this.matchesCompletedPrimary(scene,c))throw Error('曲面视口交互需要匹配的已完成主预览');
  const own=this.owned!;own.clock.assertPaused(true);
  const next=navigateSourceViewportCamera(own.queue.snapshot().camera,'rotate',event,c.sourceViewport!.logicalWidth,c.sourceViewport!.logicalHeight);
  if(!next.ok)throw next.error;
  if(c.isCancelled?.())throw new DOMException('曲面视口交互已取消','AbortError');
  this.cancel=c.isCancelled;this.budget=sourceSurfaceWorkBudget();this.busy=true;
  try{
   own.queue.writeViewport(next.value);
   const frame=own.queue.step(0,{paused:true,actualFrameRate:c.surfaceLive!.actualFrameRate});
   const output=this.display(own,frame,c,'update');this.check();return output;
  }catch(error){this.failed=true;this.completed=undefined;throw error;}finally{this.busy=false;this.cancel=undefined;}
 }
 /** Native paused capture renders the same scene to an offscreen destination,
  * then primary; neither display calls Scene.update. Preflight is nonmutating. */
 capturePaused(scene:SceneDocument,c:GenerateContext,size:{width:number;height:number},scale:1|3|5):SourceSurfaceCapturePreparation {
  if(!this.matchesCompletedPrimary(scene,c))throw Error('曲面截图需要匹配的已完成主预览');
  const own=this.owned!;own.clock.assertPaused(true);
  const plan=sourceSurfaceCapturePlan(snapshotGenerationInput(c),size,scale);
  validateSourceSurfacePresentation(own.scene,plan.captureContext);
  this.cancel=c.isCancelled;this.budget=sourceSurfaceWorkBudget();this.busy=true;
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
