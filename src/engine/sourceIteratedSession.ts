import {deriveSourceIteratedNormalization} from './sourceIteratedPresentation';
import type {GenerateContext,SceneDocument,SceneOutput} from '../types';
import {prepareIteratedFrame,prepareIteratedField} from '../scenes/iteratedDensity';
import {SourceIteratedTimelineSession,bindSourceIterationFrame,type SourceIteratedTimelineResult} from './sourceIteratedTimeline';
import {SourceIteratedReplaySession,sourceIteratedRenderFps,type SourceIteratedDisplayFacts} from './sourceIteratedReplaySession';
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
 sessionId:string;clock:'realtime-source-queue';clockSource:'worker-wall-clock'|'injected';
 sceneTime:number;rawDt:number;activeDt:number;queueIndex:number;queueComplete:boolean;paused:boolean;
 objectUpdates:number;replayRevision:number;display:SourceIteratedDisplayFacts;
}
type Raster=Extract<SceneOutput,{type:'raster'}>;
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
 constructor(private readonly family:'map'|'symmetry'){if(family!=='map'&&family!=='symmetry')throw Error('未知实时迭代场景');}
 private live(c:GenerateContext){return this.family==='map'?c.mapLive:c.symmetryLive;}
 private tone(scene:SceneDocument,c:GenerateContext){return this.family==='map'?prepareSourceMapTone(scene,c):prepareSourceSymmetryTone(scene,c);}
 private runtimeRevision=0;private dotSizeRevision=0;private runtimePointSize?:number;
 private readonly cleanup=new GenerationCleanupState();
 private timeline?:SourceIteratedTimelineSession;private replay?:SourceIteratedReplaySession;private clock?:SourceSceneHostClock;
 private authored?:SceneDocument;private frame?:SourceIteratedTimelineResult;private anchor?:CapturedDensityAnchor;
 private sessionId='';private shape='';private startAt?:number;private revision=0;private busy=false;private failed=false;
 private steps=0;private accepted=0;private invalid=0;private clipped=0;private sampleInvalid=0;private deposited=0;private displays=0;
 private completed?:{context:GenerateContext;identity:string};private lastUpdatePaused=false;
 private requestSteps=0;private requestPixels=0;
 reset(failures:readonly unknown[]=[]){this.failed=true;this.cleanup.reset(()=>{this.replay?.reset();this.replay=undefined;this.timeline?.reset();this.timeline=undefined;this.clock=undefined;this.authored=undefined;this.completed=undefined;this.lastUpdatePaused=false;this.frame=undefined;this.anchor=undefined;this.sessionId='';this.shape='';this.startAt=undefined;this.revision=0;this.runtimeRevision=0;this.dotSizeRevision=0;this.runtimePointSize=undefined;this.steps=0;this.accepted=0;this.invalid=0;this.clipped=0;this.sampleInvalid=0;this.deposited=0;this.displays=0;this.failed=false;},failures);}
 diagnostics(){return{family:this.family,runtimeRevision:this.runtimeRevision,dotSizeRevision:this.dotSizeRevision,runtimePointSize:this.runtimePointSize,failed:this.failed,sessionId:this.sessionId,displays:this.displays,steps:this.steps,clock:this.clock?.diagnostics(),replay:this.replay?.diagnostics(),frame:this.frame?structuredClone(this.frame):undefined,anchor:this.anchor?structuredClone(this.anchor):undefined,retainedBytes:(this.replay?.diagnostics().gpu.retainedBytes??0)+(this.authored?identity(this.authored).length*2:0)+this.shape.length*2+(this.completed?this.completed.identity.length*2:0)};}
 snapshotInk(){if(this.failed||!this.replay)throw Error('迭代场景 实时累积不可读');return this.replay.readback();}
 readParticles(){if(this.failed||!this.replay)throw Error('迭代场景 实时粒子不可读');return this.replay.readParticles();}
 setPaused(paused:boolean,timestampMs?:number){
  if(this.busy||this.failed||!this.clock||!this.timeline)throw Error('迭代场景 播放控制需要已初始化且空闲的会话');
  this.cleanup.prepare();const restore=this.clock.setPaused(paused,this.timeline.snapshot().frame.camera,timestampMs);
  if(restore)this.timeline.writeAngles(restore);this.frame=this.timeline.snapshot();
  if(this.completed){this.live(this.completed.context)!.clock={...this.live(this.completed.context)!.clock,paused};this.completed.identity=this.captureIdentity(this.authored!,this.completed.context);}
 }
 private advance(c:GenerateContext,dt:number,paused:boolean,reconstructing=false){
  cancel(c);const replaying=this.replay!.willReplayDisplay(c.width,c.height);
  const frame=this.timeline!.step(dt,{paused,acknowledgeParameters:!replaying});this.lastUpdatePaused=paused;
  return this.display(c,frame,paused,reconstructing);
 }
 private display(c:GenerateContext,frame:SourceIteratedTimelineResult,paused:boolean,reconstructing=false){
  cancel(c);const replaying=this.replay!.willReplayDisplay(c.width,c.height);this.frame=frame;
  const scene={...this.authored!,settings:{...this.authored!.settings,...frame.mapColors,...(this.runtimePointSize!==undefined?{pointSize:this.runtimePointSize}:{})},parameters:{...frame.parameters!.values},evaluatedSourceCamera:frame.frame};
  bindSourceIterationFrame(scene,frame.palette,frame.update,frame.parameters);
  const sourceFrame=ordinarySourceCameraFrame(scene,c),plan=prepareOrdinarySourceFrame(sourceFrame),job=prepareIteratedFrame(scene,frame.frame.sceneTime,this.displays,this.authored);
  // During replay native display skips camera capture and parameter snapshot.
  let cameraChanged=false;
  if(!replaying){const captured=prepareCapturedDensityCamera(this.family,plan,this.anchor);this.anchor=captured.anchor;cameraChanged=captured.clearInk;}
  job.sourceCamera={anchor:this.anchor!,clearInk:cameraChanged};
  job.densitySplat=prepareSourceDensitySplat(this.family,job.config.pointSize,plan.displayScale);
  const updates=frame.update.calls.map(call=>prepareIteratedField({...scene,parameters:{...call.parameters!}},job.config,call.time,this.authored!));
  if(reconstructing){
   this.requestSteps+=job.config.count*((!this.replay!.diagnostics().warmupApplied&&updates.length?job.config.burn:0)+updates.length*job.config.iterations);
   this.requestPixels+=sourceDensitySplatPixelTests(job.densitySplat,job.config.count);
   if(this.requestSteps>2_000_000_000||this.requestPixels>2_000_000_000)throw Error('迭代场景 本地重建超过 20 亿工作预算');
  }
  const display=this.replay!.display(job,{width:c.width,height:c.height,projection:'xy',padding:0,bounds:{minX:-1,maxX:1,minY:-1,maxY:1},isCancelled:c.isCancelled},{updates,paused,parameterChanged:frame.parameters!.changed,cameraChanged});
  this.steps+=display.gpu.steps;this.accepted+=display.gpu.accepted;this.invalid+=display.gpu.invalid;this.clipped+=display.gpu.clipped;this.sampleInvalid+=display.gpu.sampleInvalid;this.deposited+=display.passes*job.config.count;this.displays++;
  if(![this.steps,this.accepted,this.invalid,this.clipped,this.sampleInvalid,this.deposited,this.displays].every(Number.isSafeInteger))throw Error('迭代场景 累计计数超过安全整数');
  return{scene,job,sourceFrame,display};
 }
 generate(scene:SceneDocument,c:GenerateContext):Raster {
  if(this.busy||this.failed)throw Error('迭代场景 实时会话需要可用且空闲的所有者');this.cleanup.prepare();const live=context(c,this.family);exactRasterDimensions(c);cancel(c);
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
   if(replace){this.reset();this.authored=structuredClone(scene);this.shape=shape;this.sessionId=live.sessionId;this.startAt=live.startAt;this.revision=live.replayRevision;this.timeline=new SourceIteratedTimelineSession(scene);this.frame=this.timeline.snapshot();this.clock=new SourceSceneHostClock(live.clock.paused,this.frame.frame.camera);this.replay=new SourceIteratedReplaySession(this.family,live.renderFps);this.runtimeRevision=edits.runtimeRevision;this.dotSizeRevision=edits.dotSizeRevision;}
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
   let result:ReturnType<SourceIteratedSession['advance']>;
   if(replace&&live.startAt!==undefined){
    const frames=Math.floor(live.startAt*scene.timeline.fps+1e-9)+1;
    for(let i=0;i<frames;i++)result=this.advance(c,Math.fround(1/scene.timeline.fps),false,true);
    this.clock=new SourceSceneHostClock(live.clock.paused,this.frame!.frame.camera);
   }else result=this.advance(c,this.clock!.update(live.clock),live.clock.paused);
   const output=this.present(c,result!);
   this.completed=c.sourceViewport?.target==='primary'?{context:{...c,[this.family==='map'?'mapLive':'symmetryLive']:structuredClone(live),sourceViewport:{...c.sourceViewport},...(c.sourceMapToneReference?{sourceMapToneReference:{...c.sourceMapToneReference}}:{}),...(c.sourceSymmetryToneReference?{sourceSymmetryToneReference:{...c.sourceSymmetryToneReference}}:{})},identity:this.captureIdentity(scene,c)}:undefined;
   return output;
  }catch(error){this.reset([error]);throw error;}finally{this.busy=false;}
 }
 private present(c:GenerateContext,result:ReturnType<SourceIteratedSession['display']>):Raster {
   const {scene:current,job,sourceFrame,display}=result;
   const prepared=this.tone(current,c);if(prepared.model!=='normalized-v2')throw Error('迭代场景 实时呈现需要源归一模型');
   const normalization=deriveSourceIteratedNormalization({kind:this.family,width:c.width,height:c.height,recordedPasses:display.accumulationPasses,batchSize:job.config.count},(prepared.sourceMapPresentation??prepared.sourceSymmetryPresentation)!.reference);
   const tone={...prepared,normalization},shown=this.replay!.present(tone,c.isCancelled,prepareCapturedDensityView(this.anchor!,sourceFrame.camera,c.width,c.height)),frame=this.frame!.frame;
   const facts:SourceIteratedLiveFacts={sessionId:this.sessionId,clock:'realtime-source-queue',clockSource:this.clock!.diagnostics().clockSource,sceneTime:frame.sceneTime,rawDt:frame.rawDt,activeDt:frame.activeDt,queueIndex:frame.queueIndex,queueComplete:frame.queueComplete,paused:this.clock!.diagnostics().paused,objectUpdates:this.frame!.update.calls.length,replayRevision:this.revision,display};
   return{type:'raster',dimension:2,cameraResolved:true,backend:'webgl2',width:c.width,height:c.height,pixels:shown.pixels,sourceCameraFrame:sourceFrame,...(this.family==='map'?{mapLive:facts,mapSplat:job.densitySplat,sourceMapPresentation:{...prepared.sourceMapPresentation!,scale:normalization.scale}}:{symmetryLive:facts,symmetrySplat:job.densitySplat,symmetryPalette:job.symmetryPalette,sourceSymmetryPresentation:{...prepared.sourceSymmetryPresentation!,scale:normalization.scale}}),density:{projection:'xy',bounds:display.gpu.bounds,inputPoints:this.deposited,examined:this.deposited,accepted:this.accepted,clipped:this.clipped,invalid:this.sampleInvalid,occupiedPixels:shown.occupiedPixels,maxCount:shown.maxCount,toneBackend:shown.toneBackend,cancelled:false},temporal:{time:frame.sceneTime,windowStart:0,frames:this.displays,samplingFps:context(c,this.family).renderFps,recordedPoints:this.deposited,cacheHits:0},stats:{samples:this.steps,generated:this.accepted,invalid:this.invalid},warnings:['迭代场景 实时会话按源调度更新和重播；本地 WebGL 验证不等于原版整窗口像素对照。',...shown.warnings]};
 }
 private captureIdentity(scene:SceneDocument,c:GenerateContext){return identity([sourceIteratedSceneIdentity(scene),c.time,this.live(c),c.sourceViewport,c.sourcePointPixelDensity,c.sourceMapToneReference,c.sourceSymmetryToneReference]);}
 matchesCompletedPrimary(scene:SceneDocument,c:GenerateContext){return !this.busy&&!this.failed&&!!this.completed&&this.completed.identity===this.captureIdentity(scene,c);}
 capturePaused(scene:SceneDocument,c:GenerateContext,options:{additionalBytes?:number}={}):PausedCaptureResult {
  if(!this.matchesCompletedPrimary(scene,c))throw Error('迭代场景 暂停截图需要完全匹配的已完成主预览');
  this.clock!.assertPaused(true);this.cleanup.prepare();cancel(c);
  const primary=this.completed!,density=primary.context.sourcePointPixelDensity??NaN;
  const size=prepareSourcePausedCaptureSize(c,density),additionalBytes=options.additionalBytes??0;
  this.replay!.validateCapture(size.width,size.height,additionalBytes);
  const captureContext:GenerateContext={...c,width:size.width,height:size.height,sourceViewport:{...primary.context.sourceViewport!,logicalWidth:size.logicalWidth,logicalHeight:size.logicalHeight,target:'offscreen'},[this.family==='map'?'sourceMapToneReference':'sourceSymmetryToneReference']:{width:primary.context.width,height:primary.context.height}};
  this.tone(scene,captureContext);this.busy=true;
  try{
   // Native export render precedes Scene.update(true). Keep the last mobject
   // paused flag for that first display; controls alone do not update it.
   const frame=this.timeline!.display(!this.replay!.willReplayDisplay(size.width,size.height));
   const capture=this.present(captureContext,this.display(captureContext,frame,this.lastUpdatePaused));
   const restored={...primary.context,isCancelled:c.isCancelled};
   const preview=this.present(restored,this.advance(restored,0,true));
   this.completed=primary;return{capture,preview};
  }catch(error){this.reset([error]);throw error;}finally{this.busy=false;}
 }

}
