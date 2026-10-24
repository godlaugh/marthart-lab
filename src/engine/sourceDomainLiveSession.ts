import {domainPaletteRuntimeScene} from './domainPaletteEditing';
import {validateSourceDomainFrameRate} from './sourceDomainClockInput';
import type {PausedCaptureResult,SourceRecordingOptions} from './generationProtocol';
import type {FormulaPresentation,GenerateContext,GenerationInput,SceneDocument,SceneOutput} from '../types';
import {SourceDomainHostSession,type SourceDomainHostRecordingHandle,type SourceDomainHostSnapshot} from './sourceDomainHostSession';
import {bindSourceDomainFrame,prepareSourceDomainScene,usesSourceDomain} from './sourceDomainTimeline';
import {validateSourceSceneClockRequest,type SourceSceneClockRequest} from './sourceSceneHostClock';
import {DomainRenderSession} from './domainRenderSession';
import {generateDomain} from './domain';
import {parseDomainCpuChainModel,parseDomainModel} from './domainModel';
import {parseDomainRenderPolicy} from './domainRenderPolicy';
import {formulaPresentation} from './formulas';
import {MAX_RASTER_PIXELS,validateRasterRequest} from './rasterDimensions';
import {prepareSourcePausedCaptureSize} from './sourcePausedCaptureSize';
import {snapshotGenerationInput} from './generationInput';
import {sourceRecordingSize} from './sourceRecordingSize';
import {planDomainRecordingClock} from './sourceDomainRecording';
import type {SourceQueueRecordingClock} from './sourceRecordingClock';

export interface SourceDomainLiveContext {
 sessionId:string;revision:number;clock:SourceSceneClockRequest;
 /** Observed local draw FPS, or an explicitly chosen initial rate; not JVM timing. */
 actualFrameRate:number;
 /** Logical primary canvas and its density, independent of downsampled pixels. */
 viewport?:{logicalWidth:number;logicalHeight:number;pixelDensity:number};
 /** Whole document captured when this Apply revision was requested. */
 configuration?:SceneDocument;
 /** Explicit local fixed reconstruction, only when creating a session. */
 startAt?:number;
}
/** Browser logical deltas only. The completed primary owns pan dimensions. */
export type SourceDomainNavigationEvent={kind:'pan';dx:number;dy:number}|{kind:'wheel';count:number};
export type SourceDomainLivePresentation=Pick<SceneDocument,
 'equations'|'parameters'|'settings'|'palette'|'camera'|'sourceCamera'|'timeline'|'formulas'|'projectResolution'|'domainSourcePalette'|'evaluatedDomainScene'|'evaluatedDomainGradient'>;
export interface SourceDomainLiveFacts {
 sessionId:string;revision:number;target:'primary'|'offscreen';renderKind:'update'|'snapshot';
 clockSource:'worker-wall-clock'|'injected'|'fixed-step';sceneTime:number;rawDt:number;activeDt:number;
 queueIndex:number;queueComplete:boolean;paused:boolean;updateOrdinal:number;
 actualFrameRate:number;presentation:SourceDomainLivePresentation;
 recording?:SourceDomainHostSnapshot['recording'];
 /** Owned primary logical geometry, independent of adaptive preview sampling. */
 viewport?:SourceDomainLiveContext['viewport'];
}
type Raster=Extract<SceneOutput,{type:'raster'}>;
type LiveRaster=Raster&{domainLive:SourceDomainLiveFacts;formulaPresentation:FormulaPresentation};
type Render=(scene:SceneDocument,context:GenerateContext,session:DomainRenderSession)=>SceneOutput;
const copy=<T>(value:T):T=>structuredClone(value);

function context(c:GenerateContext):SourceDomainLiveContext {
 const v=c.domainLive;
 if(!v||typeof v!=='object'||Array.isArray(v)||typeof v.sessionId!=='string'||!v.sessionId.trim()||v.sessionId.length>256||!Number.isSafeInteger(v.revision)||v.revision<0)throw Error('域着色实时会话上下文无效');
 validateSourceSceneClockRequest(v.clock);
 validateSourceDomainFrameRate(v.actualFrameRate);
 if(v.startAt!==undefined&&(!Number.isFinite(v.startAt)||v.startAt<0||v.startAt>86400))throw Error('域着色本地重建起点必须在 0–86400 秒');
 if(v.viewport!==undefined){
  const p=v.viewport;
  if(!p||typeof p!=='object'||Array.isArray(p)||![p.logicalWidth,p.logicalHeight,p.pixelDensity].every(n=>Number.isSafeInteger(n)&&n>0))throw Error('域着色主视口需要正整数逻辑尺寸与密度');
  prepareSourcePausedCaptureSize({width:p.logicalWidth*p.pixelDensity,height:p.logicalHeight*p.pixelDensity},p.pixelDensity,MAX_RASTER_PIXELS);
 }
 if(c.fractalLive!==undefined||c.fractalRecording!==undefined||c.mapLive!==undefined||c.symmetryLive!==undefined||c.samilaLive!==undefined||c.fractalViewport!==undefined||c.sourceBouncingFrame!==undefined||c.spirographFrame!==undefined||c.sourceViewport!==undefined||c.rootsViewport!==undefined)throw Error('域着色实时主预览不能混用其它场景或离屏时钟');
 if(c.quality!=='preview'&&c.quality!=='export')throw Error('域着色实时渲染质量无效');
 validateRasterRequest(c);return v;
}
function clean(scene:SceneDocument):SceneDocument {
 const result=copy(domainPaletteRuntimeScene(scene));delete result.evaluatedDomainScene;delete result.evaluatedDomainGradient;return result;
}
function display(scene:SceneDocument,snapshot:SourceDomainHostSnapshot):SceneDocument {
 const result=clean(scene);
 bindSourceDomainFrame(result,{...snapshot.state,displayFrame:snapshot.updateOrdinal,simulationFps:snapshot.recording?.simulationFps??scene.timeline.fps});
 return result;
}
function presentation(scene:SceneDocument):SourceDomainLivePresentation {
 // Include optional omissions: a staged author's value must never fill them.
 return copy({equations:scene.equations,parameters:scene.parameters,settings:scene.settings,palette:scene.palette,camera:scene.camera,sourceCamera:scene.sourceCamera,timeline:scene.timeline,formulas:scene.formulas,projectResolution:scene.projectResolution,domainSourcePalette:scene.domainSourcePalette,evaluatedDomainScene:scene.evaluatedDomainScene,evaluatedDomainGradient:scene.evaluatedDomainGradient});
}

/** One numerical host and captured full-Apply render document. The bounded
 * renderer binds the whole current state on each draw. GPU failure identity is
 * owned here, independently of fixed/offscreen render sessions. This owner has
 * no accumulated image history or original PGraphics/GL target lifecycle. */
export class SourceDomainLiveSession {
 private host?:SourceDomainHostSession;
 private retained?:SceneDocument;
 private formulas?:FormulaPresentation;
 private renderer?:DomainRenderSession;
 private sessionId='';private revision=0;private startAt?:number;
 private busy=false;private failed=false;private cancel?:()=>boolean;
 private completed?:{sceneId:string;sessionId:string;revision:number;width:number;height:number;context:GenerationInput};
 private recording?:{handle:SourceDomainHostRecordingHandle;clock:SourceQueueRecordingClock;author:SceneDocument;primary:GenerationInput;target:GenerationInput;next:number;cancel?:()=>boolean;pending?:SourceDomainHostSnapshot;finished?:SourceDomainHostSnapshot};
 private handoff?:NonNullable<SourceDomainLiveSession['recording']>;
 constructor(private readonly render:Render=generateDomain){}
 reset():void {
  if(this.busy||this.recording&&!this.failed)throw Error('请先结束域着色生成或录制再释放实例');
  this.recording=undefined;this.handoff=undefined;
  this.renderer?.reset();this.host=undefined;this.renderer=undefined;this.retained=undefined;this.formulas=undefined;
  this.completed=undefined;this.cancel=undefined;this.sessionId='';this.revision=0;this.startAt=undefined;this.failed=false;
 }
 diagnostics(){return{sessionId:this.sessionId,revision:this.revision,failed:this.failed,host:this.host&&!this.failed?this.host.snapshot():undefined,renderFailure:this.renderer?.failure(),retainedBytes:this.retained?JSON.stringify(this.retained).length*2:0};}
 matchesCompletedPrimary(scene:SceneDocument,c:GenerateContext):boolean {
  const done=this.completed,v=c.domainLive,p=v?.viewport,saved=done?.context.domainLive?.viewport,a=c.domainTarget,b=done?.context.domainTarget;
  return !this.busy&&!this.failed&&!this.recording&&!!done&&!!v&&scene.kind==='domain'&&scene.id===done.sceneId&&v.sessionId===done.sessionId&&v.revision===done.revision&&v.startAt===this.startAt&&c.width===done.width&&c.height===done.height&&p?.logicalWidth===saved?.logicalWidth&&p?.logicalHeight===saved?.logicalHeight&&p?.pixelDensity===saved?.pixelDensity&&(a===b||!!a&&!!b&&a.logicalWidth===b.logicalWidth&&a.logicalHeight===b.logicalHeight&&a.pixelDensity===b.pixelDensity);
 }
 setPaused(paused:boolean,timestampMs?:number):void {
  if(this.busy||this.failed||!this.host||!this.completed)throw Error('域着色播放控制需要已完成且可用的实时主预览');
  validateSourceSceneClockRequest({paused,timestampMs});
  try{this.host.setPaused(paused,timestampMs);this.handoff=undefined;this.completed.context.domainLive!.clock={...this.completed.context.domainLive!.clock,paused};}catch(error){this.failed=true;this.completed=undefined;throw error;}
 }
 private requireCompleted(scene:SceneDocument,c:GenerateContext):void {
  const live=context(c);
  if(!this.matchesCompletedPrimary(scene,c)||!this.host)throw Error('域着色编辑需要匹配的已完成实时主预览');
  if(this.host.snapshot().paused!==live.clock.paused)throw Error('域着色暂停状态必须通过独立 setPaused 操作修改');
  if(c.isCancelled?.())throw new DOMException('域着色实时编辑已取消','AbortError');
 }
 private invalidate():void {this.failed=true;this.completed=undefined;}
 /** Host preflight rejection leaves its numerical capability intact. A host
  * partial failure poisons its own snapshot API; preserve that failure here. */
 private checkFailedHost():void {try{this.host!.snapshot();}catch{this.invalidate();}}
 /** Same-object hot batch; one budget/failure transaction, deliberately no
  * render or numerical host update. Each ordered write still reapplies config. */
 updateParameters(scene:SceneDocument,c:GenerateContext,writes:readonly (readonly [string,number])[]):void {
  this.requireCompleted(scene,c);this.busy=true;this.cancel=c.isCancelled;let changed=false;
  try{this.host!.updateParameters(writes);changed=true;this.handoff=undefined;if(this.cancel?.())throw new DOMException('域着色实时编辑已取消','AbortError');}
  catch(error){if(changed)this.invalidate();else this.checkFailedHost();throw error;}
  finally{this.busy=false;this.cancel=undefined;}
 }
 /** A paused gesture redraws the current state at the completed primary's
  * raster profile. Neither the authored document nor full-load anchor changes. */
 navigatePaused(scene:SceneDocument,c:GenerateContext,event:SourceDomainNavigationEvent):LiveRaster {
  this.requireCompleted(scene,c);
  const completed=this.completed!,viewport=completed.context.domainLive!.viewport;
  if(!viewport)throw Error('域着色导航需要已完成主预览的逻辑视口');
  if(!event||typeof event!=='object'||Array.isArray(event))throw Error('域着色视口手势无效');
  const gesture=event.kind==='pan'?{kind:'pan' as const,dx:event.dx,dy:event.dy,width:viewport.logicalWidth,height:viewport.logicalHeight}:event.kind==='wheel'?{kind:'wheel' as const,count:event.count}:undefined;
  if(!gesture)throw Error('域着色不支持此视口手势');
  this.busy=true;this.cancel=c.isCancelled;let changed=false;
  try{
   const snapshot=this.host!.navigatePaused(gesture);changed=true;this.handoff=undefined;this.completed=undefined;
   const renderContext={...completed.context,isCancelled:c.isCancelled,onProgress:c.onProgress,onStatus:c.onStatus};
   const result=this.renderSnapshot(snapshot,renderContext,'snapshot');
   if(this.cancel?.())throw new DOMException('域着色实时导航已取消','AbortError');
   this.completed=completed;return result;
  }catch(error){if(changed)this.invalidate();else this.checkFailedHost();throw error;}
  finally{this.busy=false;this.cancel=undefined;}
 }
 private admit(scene:SceneDocument,live:SourceDomainLiveContext){
  if(!usesSourceDomain(scene))throw Error('域着色实时预览需要显式源队列');
  const retained=clean(scene),configuration=prepareSourceDomainScene(retained);
  const host=new SourceDomainHostSession(configuration,{paused:live.clock.paused,isCancelled:()=>this.cancel?.()??false});
  const initial=display(retained,host.snapshot()),policy=parseDomainRenderPolicy(initial.settings.domainRenderPolicy);
  // Validate the selected numerical/rendering configuration before replacing a
  // valid host. GPU readiness remains the actual renderer's responsibility.
  if(policy==='source-cpu-always-v1')parseDomainCpuChainModel(initial,0);else parseDomainModel(initial,0);
  const formulas=formulaPresentation(retained);
  return{retained,host,formulas,renderer:new DomainRenderSession()};
 }
 private facts(snapshot:SourceDomainHostSnapshot,scene:SceneDocument,kind:SourceDomainLiveFacts['renderKind'],target:SourceDomainLiveFacts['target']='primary'):SourceDomainLiveFacts {
  const s=snapshot.state;
  return{sessionId:this.sessionId,revision:this.revision,target,renderKind:kind,clockSource:snapshot.recording?'fixed-step':snapshot.hostClock.clockSource,
   sceneTime:s.clock.sceneTime,rawDt:kind==='update'?s.clock.rawDt:0,activeDt:kind==='update'?s.clock.activeDt:0,
   queueIndex:s.clock.queueIndex,queueComplete:s.clock.queueComplete,paused:snapshot.paused,updateOrdinal:snapshot.updateOrdinal,
   actualFrameRate:s.parameterFps,presentation:presentation(scene),...(snapshot.recording?{recording:{...snapshot.recording}}:{})};
 }
 private bind(output:SceneOutput,facts:SourceDomainLiveFacts,c:GenerateContext):LiveRaster {
  if(output.type!=='raster'||!output.domainRender||!this.formulas||!Number.isInteger(output.width)||!Number.isInteger(output.height)||output.width<1||output.height<1||output.width>c.width||output.height>c.height||c.quality==='export'&&(output.width!==c.width||output.height!==c.height)||output.width*output.height>MAX_RASTER_PIXELS||!(output.pixels instanceof Uint8ClampedArray)||output.pixels.length!==output.width*output.height*4)throw Error('域着色实时预览未返回有效源栅格事实');
  return Object.assign(output,{domainLive:copy(facts),formulaPresentation:copy(this.formulas)});
 }
 private renderSnapshot(snapshot:SourceDomainHostSnapshot,c:GenerateContext,kind:SourceDomainLiveFacts['renderKind'],target:SourceDomainLiveFacts['target']='primary'):LiveRaster {
  const renderScene=display(this.retained!,snapshot),facts=this.facts(snapshot,renderScene,kind,target),bind=(output:SceneOutput)=>this.bind(output,facts,c);
  if(target==='primary'&&c.domainLive?.viewport)facts.viewport=copy(c.domainLive.viewport);
  return bind(this.render(renderScene,{...c,time:snapshot.state.clock.sceneTime,onProgress:c.onProgress?value=>c.onProgress!(bind(value)):undefined},this.renderer!));
 }
 /** Capture and primary redraw share the current numerical snapshot and
  * renderer failure owner. Neither operation advances or reconstructs time. */
 capturePaused(scene:SceneDocument,c:GenerateContext,options:{additionalBytes?:number}={}):PausedCaptureResult {
  const retained=this.completed;
  if(!retained)throw Error('域着色当前帧截图需要已完成主预览');
  this.requireCompleted(scene,{...c,width:retained.width,height:retained.height,domainTarget:retained.context.domainTarget});
  const snapshot=this.host!.snapshot();if(!snapshot.paused)throw Error('请先暂停域着色再保存当前帧');
  const primary:GenerateContext={...retained.context,isCancelled:c.isCancelled,onProgress:undefined};
  const size=prepareSourcePausedCaptureSize(c,primary.domainLive!.viewport?.pixelDensity??NaN,MAX_RASTER_PIXELS);
  const capture:GenerateContext={...primary,time:snapshot.state.clock.sceneTime,quality:'export',width:size.width,height:size.height,domainLive:undefined,domainTarget:{logicalWidth:size.logicalWidth,logicalHeight:size.logicalHeight,pixelDensity:size.density}};
  const extra=options.additionalBytes??0;
  // Include retained preview + capture and bounded image/attachment expansion;
  // each renderer separately admits its actual CPU/GPU scratch representation.
  if(!Number.isSafeInteger(extra)||extra<0||extra+capture.width*capture.height*16+primary.width*primary.height*16>768*1024*1024)throw Error('域着色当前帧截图超过 768 MiB 工作预算');
  if(c.isCancelled?.())throw new DOMException('域着色当前帧截图已取消','AbortError');
  this.busy=true;this.cancel=c.isCancelled;this.completed=undefined;this.handoff=undefined;
  try{
   const captured=this.renderSnapshot(snapshot,capture,'snapshot','offscreen');
   if(this.cancel?.())throw new DOMException('域着色当前帧截图已取消','AbortError');
   const preview=this.renderSnapshot(snapshot,primary,'snapshot');
   if(this.cancel?.())throw new DOMException('域着色当前帧截图已取消','AbortError');
   this.completed=retained;return{capture:captured,preview};
  }catch(error){this.invalidate();throw error;}finally{this.busy=false;this.cancel=undefined;}
 }
 /** Toolbar recording reloads the full Apply anchor. Stage the fresh numerical
  * host/renderer until the warmup succeeds, preserving the completed primary
  * if local admission, cancellation or that first render fails. */
 beginRecording(scene:SceneDocument,c:GenerateContext,options:SourceRecordingOptions){
  this.requireCompleted(scene,c);
  validateSourceDomainFrameRate(options.actualFrameRate);
  const primary=snapshotGenerationInput(this.completed!.context),live=primary.domainLive!;
  primary.domainLive={...live,clock:{paused:false},actualFrameRate:options.actualFrameRate,configuration:undefined};primary.time=0;
  const size=sourceRecordingSize(options,live.viewport?.pixelDensity??NaN);
  const target:GenerationInput={...primary,quality:'export',width:size.width,height:size.height,domainLive:undefined,domainTarget:{logicalWidth:size.logicalWidth,logicalHeight:size.logicalHeight,pixelDensity:size.density}};
  validateRasterRequest(target);
  if(target.width*target.height*16+primary.width*primary.height*16>768*1024*1024)throw Error('域着色录制目标超过 768 MiB 工作预算');
  const clock=planDomainRecordingClock(this.retained!,options.simulationFps,c.isCancelled),author=clean(scene);
  this.busy=true;this.cancel=c.isCancelled;
  const renderer=new DomainRenderSession();let committed=false;
  try{
   const host=new SourceDomainHostSession(prepareSourceDomainScene(this.retained!),{isCancelled:()=>this.cancel?.()??false});
   const started=host.beginRecording(options.simulationFps,options.actualFrameRate),snapshot=started.warmup;
   const renderScene=display(this.retained!,snapshot),renderContext={...target,time:snapshot.state.clock.sceneTime,isCancelled:this.cancel};
   const warmup=this.bind(this.render(renderScene,renderContext,renderer),this.facts(snapshot,renderScene,'update','offscreen'),renderContext);
   this.assertRecording(snapshot,clock,0);
   if(this.cancel?.())throw new DOMException('域着色录制开始已取消','AbortError');
   this.renderer?.reset();this.renderer=renderer;this.host=host;this.completed=undefined;this.handoff=undefined;
   this.recording={handle:started.handle,clock,author,primary,target,next:1,cancel:c.isCancelled};committed=true;
   return{handle:started.handle,scene:clean(this.retained!),context:snapshotGenerationInput(primary),clock:{...clock},warmup};
  }finally{if(!committed)renderer.reset();this.busy=false;this.cancel=undefined;}
 }
 private assertRecording(snapshot:SourceDomainHostSnapshot,clock:SourceQueueRecordingClock,ordinal:number):void {
  const position=snapshot.recording;
  if(!position||position.ordinal!==ordinal||snapshot.updateOrdinal!==ordinal||position.simulationFps!==clock.simulationFps||position.warmup!==(ordinal===0)||position.complete!==(ordinal===clock.lastDisplayFrame)||snapshot.paused)throw Error('域着色录制实际队列与规划帧不一致');
 }
 ownsRecording(handle:object):boolean{return !this.failed&&this.recording?.handle===handle;}
 /** FPS belongs to this update, independently of simulation FPS. A failed
  * raster retry reuses the pending numerical snapshot and requires the same
  * observation; it never advances the host twice or replaces that observation. */
 nextRecordingFrame(handle:object,displayFrame:number,actualFrameRate?:number):LiveRaster {
  const record=this.recording;
  if(this.busy||!record||!this.ownsRecording(handle)||record.finished||displayFrame!==record.next||displayFrame>record.clock.lastDisplayFrame)throw Error('域着色录制身份或连续帧序号无效');
  validateSourceDomainFrameRate(actualFrameRate);
  if(record.pending&&!Object.is(record.pending.state.parameterFps,Math.fround(actualFrameRate)))throw Error('域着色录制重试不能改变已消费的实际帧率');
  this.busy=true;this.cancel=record.cancel;
  try{
   if(this.cancel?.())throw new DOMException('域着色录制更新已取消','AbortError');
   if(!record.pending){
    try{record.pending=this.host!.nextRecordingFrame(record.handle,displayFrame,actualFrameRate);}
    catch(error){this.checkFailedHost();throw error;}
   }
   this.assertRecording(record.pending,record.clock,displayFrame);
   const output=this.renderSnapshot(record.pending,{...record.target,isCancelled:this.cancel},'update','offscreen');
   if(this.cancel?.())throw new DOMException('域着色录制更新已取消','AbortError');
   record.next++;record.pending=undefined;return output;
  }finally{this.busy=false;this.cancel=undefined;}
 }
 /** Finish resets wall time once and redraws the retained final state. Keep
  * the snapshot across failed redraw/publication so a retry cannot update it.
  * Cleanup deliberately does not inherit the recording cancellation callback. */
 finishRecording(handle:object,timestampMs?:number):{scene:SceneDocument;context:GenerationInput;preview:LiveRaster} {
  const record=this.recording??this.handoff;
  if(this.failed||this.busy||!record||record.handle!==handle||(!this.recording&&!this.completed))throw Error('域着色录制身份无效');
  this.busy=true;
  try{
   record.finished??=this.host!.finishRecording(record.handle,timestampMs);
   const snapshot=record.finished,context=snapshotGenerationInput(record.primary);
   context.time=snapshot.state.clock.sceneTime;context.domainLive!.actualFrameRate=snapshot.state.parameterFps;
   const preview=this.renderSnapshot(snapshot,context,'snapshot');
   this.completed={sceneId:record.author.id,sessionId:this.sessionId,revision:this.revision,width:context.width,height:context.height,context:snapshotGenerationInput(context)};
   this.recording=undefined;this.handoff=record;
   return{scene:clean(record.author),context,preview};
  }finally{this.busy=false;}
 }
 generate(scene:SceneDocument,c:GenerateContext):LiveRaster {
  const live=context(c);
  if(scene.kind!=='domain')throw Error('域着色实时上下文只能用于域着色场景');
  if(this.busy||this.recording)throw Error('域着色实时会话正在生成或录制');
  const replace=!this.host||live.sessionId!==this.sessionId;
  if(!replace&&(this.failed||live.revision<this.revision||live.startAt!==this.startAt||scene.id!==this.retained!.id))throw Error('域着色实时实例已失效或请求身份改变，需要新的 sessionId');
  if(!replace&&this.host!.snapshot().paused!==live.clock.paused)throw Error('域着色暂停状态必须通过独立 setPaused 操作修改');
  this.busy=true;this.cancel=c.isCancelled;let mutated=false;
  try{
   if(this.cancel?.())throw new DOMException('域着色实时预览已取消','AbortError');
   let reconstructed=false;
   if(replace||live.revision>this.revision){
    const initial=live.configuration??(replace?scene:undefined);
    if(!initial||initial.kind!=='domain'||initial.id!==scene.id)throw Error('域着色配置版本需要对应文档事件的完整配置快照');
    const candidate=this.admit(initial,live);
    if(replace&&live.startAt!==undefined){
     candidate.host.reconstruct(Math.floor(live.startAt*candidate.retained.timeline.fps+1e-9),candidate.retained.timeline.fps,live.actualFrameRate);reconstructed=true;
    }
    if(this.cancel?.())throw new DOMException('域着色实时预览已取消','AbortError');
    this.renderer?.reset();this.host=candidate.host;this.retained=candidate.retained;this.formulas=candidate.formulas;this.renderer=candidate.renderer;
    this.sessionId=live.sessionId;this.revision=live.revision;this.startAt=live.startAt;this.failed=false;this.completed=undefined;this.handoff=undefined;mutated=true;
   }
   // Same-revision author edits are staged. Paused redraws bind a snapshot;
   // they must not accumulate extra numerical host ordinals on resize/repaint.
   const snapshotOnly=reconstructed||live.clock.paused&&this.completed!==undefined;
   this.completed=undefined;this.handoff=undefined;mutated=true;
   const snapshot=snapshotOnly?this.host!.snapshot():this.host!.update(live.clock,live.actualFrameRate);
   const result=this.renderSnapshot(snapshot,c,snapshotOnly?'snapshot':'update');
   if(this.cancel?.())throw new DOMException('域着色实时预览已取消','AbortError');
   const saved=snapshotGenerationInput({...c,domainLive:{...live,configuration:undefined}});
   this.completed={sceneId:scene.id,sessionId:this.sessionId,revision:this.revision,width:c.width,height:c.height,context:saved};return result;
  }catch(error){if(mutated)this.invalidate();throw error;}
  finally{this.busy=false;this.cancel=undefined;}
 }
}
