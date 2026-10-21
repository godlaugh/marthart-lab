import type {FormulaPresentation,GenerateContext,GenerationInput,SceneDocument,SceneOutput} from '../types';
import {SourceDomainHostSession,type SourceDomainHostSnapshot} from './sourceDomainHostSession';
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
 sessionId:string;revision:number;target:'primary';renderKind:'update'|'snapshot';
 clockSource:'worker-wall-clock'|'injected';sceneTime:number;rawDt:number;activeDt:number;
 queueIndex:number;queueComplete:boolean;paused:boolean;updateOrdinal:number;
 actualFrameRate:number;presentation:SourceDomainLivePresentation;
}
type Raster=Extract<SceneOutput,{type:'raster'}>;
type LiveRaster=Raster&{domainLive:SourceDomainLiveFacts;formulaPresentation:FormulaPresentation};
type Render=(scene:SceneDocument,context:GenerateContext,session:DomainRenderSession)=>SceneOutput;
const copy=<T>(value:T):T=>structuredClone(value);

function context(c:GenerateContext):SourceDomainLiveContext {
 const v=c.domainLive;
 if(!v||typeof v!=='object'||Array.isArray(v)||typeof v.sessionId!=='string'||!v.sessionId.trim()||v.sessionId.length>256||!Number.isSafeInteger(v.revision)||v.revision<0)throw Error('域着色实时会话上下文无效');
 validateSourceSceneClockRequest(v.clock);
 if(typeof v.actualFrameRate!=='number'||!Number.isFinite(v.actualFrameRate)||!Number.isFinite(Math.fround(v.actualFrameRate)))throw Error('域着色实时帧率需要明确的有限 Float32');
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
 const result=copy(scene);delete result.evaluatedDomainScene;delete result.evaluatedDomainGradient;return result;
}
function display(scene:SceneDocument,snapshot:SourceDomainHostSnapshot):SceneDocument {
 const result=clean(scene);
 bindSourceDomainFrame(result,{...snapshot.state,displayFrame:snapshot.updateOrdinal,simulationFps:scene.timeline.fps});
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
 constructor(private readonly render:Render=generateDomain){}
 reset():void {
  if(this.busy)throw Error('域着色实时生成期间不能释放实例');
  this.renderer?.reset();this.host=undefined;this.renderer=undefined;this.retained=undefined;this.formulas=undefined;
  this.completed=undefined;this.cancel=undefined;this.sessionId='';this.revision=0;this.startAt=undefined;this.failed=false;
 }
 diagnostics(){return{sessionId:this.sessionId,revision:this.revision,failed:this.failed,host:this.host&&!this.failed?this.host.snapshot():undefined,renderFailure:this.renderer?.failure(),retainedBytes:this.retained?JSON.stringify(this.retained).length*2:0};}
 matchesCompletedPrimary(scene:SceneDocument,c:GenerateContext):boolean {
  const done=this.completed,v=c.domainLive,p=v?.viewport,saved=done?.context.domainLive?.viewport,a=c.domainTarget,b=done?.context.domainTarget;
  return !this.busy&&!this.failed&&!!done&&!!v&&scene.kind==='domain'&&scene.id===done.sceneId&&v.sessionId===done.sessionId&&v.revision===done.revision&&v.startAt===this.startAt&&c.width===done.width&&c.height===done.height&&p?.logicalWidth===saved?.logicalWidth&&p?.logicalHeight===saved?.logicalHeight&&p?.pixelDensity===saved?.pixelDensity&&(a===b||!!a&&!!b&&a.logicalWidth===b.logicalWidth&&a.logicalHeight===b.logicalHeight&&a.pixelDensity===b.pixelDensity);
 }
 setPaused(paused:boolean,timestampMs?:number):void {
  if(this.busy||this.failed||!this.host||!this.completed)throw Error('域着色播放控制需要已完成且可用的实时主预览');
  validateSourceSceneClockRequest({paused,timestampMs});
  try{this.host.setPaused(paused,timestampMs);this.completed.context.domainLive!.clock={...this.completed.context.domainLive!.clock,paused};}catch(error){this.failed=true;this.completed=undefined;throw error;}
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
  try{this.host!.updateParameters(writes);changed=true;if(this.cancel?.())throw new DOMException('域着色实时编辑已取消','AbortError');}
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
   const snapshot=this.host!.navigatePaused(gesture);changed=true;this.completed=undefined;
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
 private facts(snapshot:SourceDomainHostSnapshot,scene:SceneDocument,kind:SourceDomainLiveFacts['renderKind']):SourceDomainLiveFacts {
  const s=snapshot.state;
  return{sessionId:this.sessionId,revision:this.revision,target:'primary',renderKind:kind,clockSource:snapshot.hostClock.clockSource,
   sceneTime:s.clock.sceneTime,rawDt:kind==='update'?s.clock.rawDt:0,activeDt:kind==='update'?s.clock.activeDt:0,
   queueIndex:s.clock.queueIndex,queueComplete:s.clock.queueComplete,paused:snapshot.paused,updateOrdinal:snapshot.updateOrdinal,
   actualFrameRate:s.parameterFps,presentation:presentation(scene)};
 }
 private bind(output:SceneOutput,facts:SourceDomainLiveFacts,c:GenerateContext):LiveRaster {
  if(output.type!=='raster'||!output.domainRender||!this.formulas||!Number.isInteger(output.width)||!Number.isInteger(output.height)||output.width<1||output.height<1||output.width>c.width||output.height>c.height||c.quality==='export'&&(output.width!==c.width||output.height!==c.height)||output.width*output.height>MAX_RASTER_PIXELS||!(output.pixels instanceof Uint8ClampedArray)||output.pixels.length!==output.width*output.height*4)throw Error('域着色实时预览未返回有效源栅格事实');
  return Object.assign(output,{domainLive:copy(facts),formulaPresentation:copy(this.formulas)});
 }
 private renderSnapshot(snapshot:SourceDomainHostSnapshot,c:GenerateContext,kind:SourceDomainLiveFacts['renderKind']):LiveRaster {
  const renderScene=display(this.retained!,snapshot),facts=this.facts(snapshot,renderScene,kind),bind=(output:SceneOutput)=>this.bind(output,facts,c);
  return bind(this.render(renderScene,{...c,time:snapshot.state.clock.sceneTime,onProgress:c.onProgress?value=>c.onProgress!(bind(value)):undefined},this.renderer!));
 }
 generate(scene:SceneDocument,c:GenerateContext):LiveRaster {
  const live=context(c);
  if(scene.kind!=='domain')throw Error('域着色实时上下文只能用于域着色场景');
  if(this.busy)throw Error('域着色实时会话正在生成');
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
    this.sessionId=live.sessionId;this.revision=live.revision;this.startAt=live.startAt;this.failed=false;this.completed=undefined;mutated=true;
   }
   // Same-revision author edits are staged. Paused redraws bind a snapshot;
   // they must not accumulate extra numerical host ordinals on resize/repaint.
   const snapshotOnly=reconstructed||live.clock.paused&&this.completed!==undefined;
   this.completed=undefined;mutated=true;
   const snapshot=snapshotOnly?this.host!.snapshot():this.host!.update(live.clock,live.actualFrameRate);
   const result=this.renderSnapshot(snapshot,c,snapshotOnly?'snapshot':'update');
   if(this.cancel?.())throw new DOMException('域着色实时预览已取消','AbortError');
   const saved=snapshotGenerationInput({...c,domainLive:{...live,configuration:undefined}});
   this.completed={sceneId:scene.id,sessionId:this.sessionId,revision:this.revision,width:c.width,height:c.height,context:saved};return result;
  }catch(error){if(mutated)this.invalidate();throw error;}
  finally{this.busy=false;this.cancel=undefined;}
 }
}
