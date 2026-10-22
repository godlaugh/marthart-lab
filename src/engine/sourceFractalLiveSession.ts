import {SourceFractalDisplay,sourceFractalDisplayInput} from './sourceFractalDisplay';
import type {FormulaPresentation,GenerateContext,GenerationInput,SceneDocument,SceneOutput} from '../types';
import {formulaPresentation} from './formulas';
import type {PausedCaptureResult} from './generationProtocol';
import {snapshotGenerationInput} from './generationInput';
import {generateFractal,prepareFractalRender} from '../scenes/complex';
import {SourceFractalHostSession,type SourceFractalHostSnapshot} from './sourceFractalHostSession';
import type {SourceFractalHostRecordingHandle} from './sourceFractalHostSession';
import type {SourceQueueRecordingClock} from './sourceRecordingClock';
import {sourceRecordingSize} from './sourceRecordingSize';
import {planFractalRecordingClock,fractalRecordingFrameFacts,assertFractalRecordingFrame} from './sourceFractalRecording';
import {bindSourceFractalFrame,prepareSourceFractalScene} from './sourceFractalTimeline';
import {supportsSourceFractalLive} from './sourceFractalDocument';
import {validateSourceSceneClockRequest,type SourceSceneClockRequest} from './sourceSceneHostClock';
import {MAX_RASTER_PIXELS,validateRasterRequest} from './rasterDimensions';
import {prepareSourcePausedCaptureSize} from './sourcePausedCaptureSize';

export interface SourceFractalLiveContext {
 sessionId:string;revision:number;intent:'hot'|'apply';clock:SourceSceneClockRequest;
 /** Measured local draw rate (or an explicitly chosen initial rate), not JVM evidence. */
 actualFrameRate:number;
 /** Exact whole-document snapshot captured when this revision was requested. */
 configuration?:SceneDocument;
 /** Local fixed reconstruction on a fresh incarnation, never native seeking. */
 startAt?:number;
}
export type SourceFractalLivePresentation=Pick<SceneDocument,'settings'|'palette'|'camera'|'sourceCamera'|'timeline'|'formulas'|'projectResolution'|'fractalSource'|'fractalSourceColor'|'evaluatedFractalScene'|'evaluatedFractalGradient'>;
export interface SourceFractalLiveFacts {
 sessionId:string;revision:number;clock:'realtime-source-queue'|'fixed-source-queue';clockSource:'worker-wall-clock'|'injected'|'fixed-step';
 target:'primary'|'offscreen';renderKind:'update'|'snapshot';
 sceneTime:number;rawDt:number;activeDt:number;queueIndex:number;queueComplete:boolean;paused:boolean;
 updateOrdinal:number;objectUpdates:number;actualFrameRate:number;presentation:SourceFractalLivePresentation;
}
type Raster=Extract<SceneOutput,{type:'raster'}>;
const copy=<T>(value:T):T=>structuredClone(value);
const LOCAL_COLOR_FIELDS=['coloring','colorDensity','gradientOffset','transfer','repeatGradient','solidColor','metric','binaryAxis','smoothSource','smoothPower','smoothReal','smoothImag','smoothBailout','distancePower','directScale','directGamma','directSaturation','directMix','trapMerge','trapThreshold','trapShape','trapRadius','trapReal','trapImag','trapRotation','trapAspect'] as const;
/** Explicit Mobject settings; every unlisted setting belongs to the retained
 * scene shell. Backend/profile choices are local policy, applied with the same
 * captured event, and do not claim an original inspector callback. */
const MOBJECT_SETTINGS=[
 'centerX','centerY','centerXLow','centerYLow','zoom','rotation','iterations','renderMethod','perturbationPrecision',
 'fractalBackend','fractalColorProfile','fractalNumericProfile','fractalColorVersion','fractalDistanceVersion',
 'insidePalette','outsidePalette',...LOCAL_COLOR_FIELDS,...(['inside','outside'] as const).flatMap(side=>LOCAL_COLOR_FIELDS.map(field=>side+field[0].toUpperCase()+field.slice(1))),
];
function context(c:GenerateContext):SourceFractalLiveContext {
 const v=c.fractalLive;
 if(!v||typeof v!=='object'||Array.isArray(v)||typeof v.sessionId!=='string'||!v.sessionId.trim()||v.sessionId.length>256||!Number.isSafeInteger(v.revision)||v.revision<0||!['hot','apply'].includes(v.intent))throw Error('分形实时会话上下文无效');
 validateSourceSceneClockRequest(v.clock);
 if(typeof v.actualFrameRate!=='number'||!Number.isFinite(v.actualFrameRate)||!Number.isFinite(Math.fround(v.actualFrameRate)))throw Error('分形实时帧率需要明确的有限 Float32');
 if(v.startAt!==undefined&&(!Number.isFinite(v.startAt)||v.startAt<0||v.startAt>86400))throw Error('分形本地重建起点必须在 0–86400 秒');
 if(c.fractalViewport?.target!=='primary')throw Error('分形实时实例只接受主画布；离屏导出使用独立路径');
 if(c.fractalRecording!==undefined||c.mapLive!==undefined||c.symmetryLive!==undefined||c.samilaLive!==undefined)throw Error('一次生成只能拥有一个分形实时或录制时钟');
 validateRasterRequest(c);return v;
}
function clean(scene:SceneDocument):SceneDocument {
 const result=copy(scene);delete result.evaluatedFractalScene;delete result.evaluatedFractalGradient;return result;
}
function hotScene(retained:SceneDocument,configuration:SceneDocument):SceneDocument {
 const result=clean(retained);
 for(const key of MOBJECT_SETTINGS){if(configuration.settings[key]===undefined)delete result.settings[key];else result.settings[key]=configuration.settings[key];}
 result.fractalSource=copy(configuration.fractalSource);result.fractalSourceColor=copy(configuration.fractalSourceColor);result.palette=copy(configuration.palette);
 return result;
}
function display(scene:SceneDocument,snapshot:SourceFractalHostSnapshot):SceneDocument {
 const result=clean(scene);bindSourceFractalFrame(result,{...snapshot.state,displayFrame:snapshot.updateOrdinal,simulationFps:snapshot.recording?.simulationFps??scene.timeline.fps});return result;
}
function presentation(scene:SceneDocument):SourceFractalLivePresentation {
 // Include absent optional fields explicitly so a staged author value cannot
 // fill an omission when the viewport merges this shell into the document.
 return copy({settings:scene.settings,palette:scene.palette,camera:scene.camera,sourceCamera:scene.sourceCamera,timeline:scene.timeline,formulas:scene.formulas,projectResolution:scene.projectResolution,fractalSource:scene.fractalSource,fractalSourceColor:scene.fractalSourceColor,evaluatedFractalScene:scene.evaluatedFractalScene,evaluatedFractalGradient:scene.evaluatedFractalGradient});
}

/** One worker-owned numerical host and captured render configuration. The
 * existing bounded GPU renderer is shared; every draw binds the entire native
 * state. A separate display owner retains passIndex and the delayed gradient uniform;
 * GL objects remain local and no rendered image is cached. */
export class SourceFractalLiveSession {
 private host?:SourceFractalHostSession;
 private displayOwner=new SourceFractalDisplay();
 private retained?:SceneDocument;
 /** Complete last full-load JSON/render anchor; hot edits never replace it. */
 private applied?:SceneDocument;
 /** TexMobjects belong to the full-loaded Scene, not the hot Mobject config. */
 private retainedFormulas?:FormulaPresentation;
 private appliedFormulas?:FormulaPresentation;
 private recording?:{handle:SourceFractalHostRecordingHandle;clock:SourceQueueRecordingClock;author:SceneDocument;primary:GenerationInput;target:GenerationInput;next:number;cancel?:()=>boolean;finished?:SourceFractalHostSnapshot};
 private handoff?:NonNullable<SourceFractalLiveSession['recording']>;
 private sessionId='';private revision=0;private startAt?:number;private failed=false;private busy=false;
 private cancel?:()=>boolean;
 private completed?:{sceneId:string;sessionId:string;revision:number;width:number;height:number;context:GenerationInput};
 constructor(private readonly render:(scene:SceneDocument,context:GenerateContext,prepared?:ReturnType<typeof prepareFractalRender>)=>SceneOutput=generateFractal){}
 reset():void {if(this.recording)throw Error('请先结束分形录制再释放实例');this.host=undefined;this.displayOwner=new SourceFractalDisplay();this.retained=undefined;this.applied=undefined;this.retainedFormulas=undefined;this.appliedFormulas=undefined;this.handoff=undefined;this.sessionId='';this.revision=0;this.startAt=undefined;this.failed=false;this.completed=undefined;this.cancel=undefined;}
 diagnostics(){return{sessionId:this.sessionId,revision:this.revision,failed:this.failed,host:this.host&&!this.failed?this.host.snapshot():undefined,retainedBytes:this.retained?JSON.stringify(this.retained).length*2:0};}
 matchesCompletedPrimary(scene:SceneDocument,c:GenerateContext):boolean {
  const value=this.completed,v=c.fractalLive;return !this.recording&&!this.failed&&!this.busy&&!!value&&!!v&&scene.id===value.sceneId&&v.sessionId===value.sessionId&&v.revision===value.revision&&c.width===value.width&&c.height===value.height&&c.fractalViewport?.target==='primary';
 }
 setPaused(paused:boolean,timestampMs?:number):void {
  if(this.recording||this.busy||this.failed||!this.host||!this.completed)throw Error('分形播放控制需要已完成且可用的实时主预览');
  validateSourceSceneClockRequest({paused,timestampMs});
  try{this.host.setPaused(paused,timestampMs);this.handoff=undefined;}catch(error){this.failed=true;this.completed=undefined;throw error;}
 }
 private draw(scene:SceneDocument,c:GenerateContext):SceneOutput {
  const prepared=prepareFractalRender(scene,c);
  // Saved source-arithmetic documents may deliberately use local coloring.
  // Their existing local scheduling does not claim native display semantics.
  if(!prepared.colorPlan)return this.render(scene,c,prepared);
  return this.displayOwner.display(sourceFractalDisplayInput(prepared,scene),facts=>this.render(scene,{...c,fractalDisplay:facts},prepared));
 }
 private admit(scene:SceneDocument,c:GenerateContext){
  if(!supportsSourceFractalLive(scene))throw Error('分形实时预览需要完整受支持分形源配置与源队列');
  const configuration=prepareSourceFractalScene(scene),candidate=new SourceFractalHostSession(configuration,{paused:c.fractalLive!.clock.paused,isCancelled:()=>this.cancel?.()??false});
  prepareFractalRender(display(scene,candidate.snapshot()),c);return{configuration,candidate,formulas:formulaPresentation(scene)};
 }
 private facts(snapshot:SourceFractalHostSnapshot,scene:SceneDocument,actualFrameRate:number,target:'primary'|'offscreen',updated:boolean):SourceFractalLiveFacts {
  const s=snapshot.state.scene;
  return{sessionId:this.sessionId,revision:this.revision,clock:snapshot.recording?'fixed-source-queue':'realtime-source-queue',clockSource:snapshot.recording?'fixed-step':snapshot.hostClock.clockSource,target,renderKind:updated?'update':'snapshot',sceneTime:s.sceneTime,rawDt:updated?s.rawDt:0,activeDt:updated?s.activeDt:0,queueIndex:s.queueIndex,queueComplete:s.queueComplete,paused:snapshot.paused,updateOrdinal:snapshot.updateOrdinal,objectUpdates:updated?s.objectUpdates.length:0,actualFrameRate:Math.fround(actualFrameRate),presentation:presentation(scene)};
 }
 private bind(output:SceneOutput,facts:SourceFractalLiveFacts):Raster {
  if(output.type!=='raster'||!output.fractalRender||!this.retainedFormulas)throw Error('分形实时预览未返回源栅格事实');output.fractalLive=copy(facts);output.formulaPresentation=copy(this.retainedFormulas);return output;
 }
 /** Two complete renders bind the same numerical snapshot, never an update
  * or authored-document replay. The owned parent density determines logical
  * shader dimensions and rounded physical pixels; preview sampling does not.
  * Both displays share the original pass/uniform owner; logical target changes
  * reset its pass index without advancing the numerical clock. */
 capturePaused(scene:SceneDocument,c:GenerateContext,options:{additionalBytes?:number}={}):PausedCaptureResult {
  if(this.recording||!this.completed||!this.host||!this.retained||this.failed||this.busy||scene.id!==this.completed.sceneId||c.fractalLive?.sessionId!==this.sessionId||c.fractalLive.revision!==this.revision)throw Error('分形当前帧截图需要已完成的实时主预览');
  const snapshot=this.host.snapshot();if(!snapshot.paused)throw Error('请先暂停分形再保存当前帧');
  const retained=this.completed,renderScene=display(this.retained,snapshot),primary:GenerateContext={...retained.context,isCancelled:c.isCancelled,onProgress:undefined};
  const size=prepareSourcePausedCaptureSize(c,primary.fractalPixelDensity??NaN,MAX_RASTER_PIXELS);
  const capture:GenerateContext={...primary,time:snapshot.state.scene.sceneTime,quality:'export',width:size.width,height:size.height,fractalViewport:{logicalWidth:size.logicalWidth,logicalHeight:size.logicalHeight,target:'offscreen'},fractalLive:undefined};
  validateRasterRequest(capture);const extra=options.additionalBytes??0;
  if(!Number.isSafeInteger(extra)||extra<0||extra+capture.width*capture.height*8+primary.width*primary.height*4>768*1024*1024)throw Error('分形当前帧截图超过 768 MiB 工作预算');
  prepareFractalRender(renderScene,capture);prepareFractalRender(renderScene,primary);
  if(c.isCancelled?.())throw new DOMException('分形当前帧截图已取消','AbortError');
  this.busy=true;this.completed=undefined;this.handoff=undefined;
  try{
   const actualFrameRate=retained.context.fractalLive!.actualFrameRate;
   const captured=this.bind(this.draw(renderScene,capture),this.facts(snapshot,renderScene,actualFrameRate,'offscreen',false));
   if(c.isCancelled?.())throw new DOMException('分形当前帧截图已取消','AbortError');
   const preview=this.bind(this.draw(display(this.retained,snapshot),primary),this.facts(snapshot,renderScene,actualFrameRate,'primary',false));
   if(c.isCancelled?.())throw new DOMException('分形当前帧截图已取消','AbortError');
   this.completed=retained;return{capture:captured,preview};
  }catch(error){this.failed=true;throw error;}finally{this.busy=false;}
 }
 /** Toolbar recording rebuilds the numerical host from the last full load.
  * Keep the author draft and the full render anchor distinct. Size uses the
  * explicit parent density, never a low-quality preview's raster ratio. */
 beginRecording(scene:SceneDocument,c:GenerateContext,options:{width:number;height:number;simulationFps:number}){
  if(this.recording||!this.matchesCompletedPrimary(scene,c)||!this.applied||!this.host)throw Error('分形录制需要已完成且匹配的主预览');
  this.cancel=c.isCancelled;
  try{
   const source=this.completed!,primary=snapshotGenerationInput(source.context),live=primary.fractalLive!;
   primary.fractalLive={...live,clock:{paused:false}};delete primary.fractalLive.configuration;primary.time=0;
   const size=sourceRecordingSize(options,primary.fractalPixelDensity??NaN);
   const target:GenerationInput={...primary,quality:'export',width:size.width,height:size.height,fractalViewport:{logicalWidth:size.logicalWidth,logicalHeight:size.logicalHeight,target:'offscreen'}};
   validateRasterRequest(target);
   const clock=planFractalRecordingClock(this.applied,options.simulationFps,this.cancel),anchor=clean(this.applied),author=clean(scene);
   // Pure renderer admission precedes the same host's irreversible reset.
   const candidate=new SourceFractalHostSession({...prepareSourceFractalScene(anchor),fps:options.simulationFps});
   prepareFractalRender(display(anchor,candidate.snapshot()),target);prepareFractalRender(display(anchor,candidate.snapshot()),primary);
   if(this.cancel?.())throw new DOMException('分形录制开始已取消','AbortError');
   this.busy=true;
   try{
    const started=this.host.beginRecording(options.simulationFps);
    this.displayOwner=new SourceFractalDisplay();
    this.retained=anchor;this.retainedFormulas=copy(this.appliedFormulas!);this.completed=undefined;this.handoff=undefined;
    this.recording={handle:started.handle,clock,author,primary,target,next:0,cancel:c.isCancelled};
    const warmup=this.renderRecording(started.warmup);
    return{handle:started.handle,scene:clean(anchor),context:snapshotGenerationInput(primary),clock:{...clock},warmup};
   }catch(error){this.failed=true;this.completed=undefined;this.recording=undefined;throw error;}finally{this.busy=false;}
  }finally{this.cancel=undefined;}
 }
 private renderRecording(snapshot:SourceFractalHostSnapshot):Raster {
  const record=this.recording!,position=snapshot.recording!;
  if(this.cancel?.())throw new DOMException('分形录制更新已取消','AbortError');
  const scene=display(this.retained!,snapshot),c:GenerateContext={...record.target,time:snapshot.state.scene.sceneTime,isCancelled:this.cancel};
  const output=this.bind(this.draw(scene,c),this.facts(snapshot,scene,record.clock.simulationFps,'offscreen',true));
  output.fractalRecording=fractalRecordingFrameFacts(scene.evaluatedFractalScene!,{displayFrame:position.ordinal,simulationFps:record.clock.simulationFps});
  assertFractalRecordingFrame(output,record.clock,position.ordinal);
  if(this.cancel?.())throw new DOMException('分形录制更新已取消','AbortError');
  record.next=position.ordinal+1;return output;
 }
 ownsRecording(handle:object):boolean{return !this.failed&&this.recording?.handle===handle;}
 nextRecordingFrame(handle:object,displayFrame:number):Raster {
  const record=this.recording;
  if(this.failed||this.busy||!record||!this.ownsRecording(handle)||record.finished||displayFrame!==record.next||displayFrame>record.clock.lastDisplayFrame)throw Error('分形录制身份或连续帧序号无效');
  this.busy=true;this.cancel=record.cancel;
  try{return this.renderRecording(this.host!.nextRecordingFrame(record.handle,displayFrame));}
  catch(error){this.failed=true;this.recording=undefined;this.completed=undefined;throw error;}finally{this.busy=false;this.cancel=undefined;}
 }
 /** disableRenderMode resets wall time exactly once. The returned local
  * primary snapshot adds no numerical update; the next live draw resumes.
  * A failed redraw retains this finish lease for an explicit retry. */
 finishRecording(handle:object,timestampMs?:number):{scene:SceneDocument;context:GenerationInput;preview:Raster} {
  const record=this.recording??this.handoff;
  if(this.failed||this.busy||!record||record.handle!==handle||(!this.recording&&!this.completed))throw Error('分形录制身份无效');
  this.busy=true;
  try{
   record.finished??=this.host!.finishRecording(record.handle,timestampMs);
   const snapshot=record.finished,scene=display(this.retained!,snapshot),context={...snapshotGenerationInput(record.primary),time:snapshot.state.scene.sceneTime};
   const preview=this.bind(this.draw(scene,context),this.facts(snapshot,scene,context.fractalLive!.actualFrameRate,'primary',false));
   this.completed={sceneId:record.author.id,sessionId:this.sessionId,revision:this.revision,width:context.width,height:context.height,context:snapshotGenerationInput(context)};
   this.recording=undefined;this.handoff=record;return{scene:clean(record.author),context,preview};
  }finally{this.busy=false;}
 }
 generate(scene:SceneDocument,c:GenerateContext):Raster {
  const live=context(c);if(scene.kind!=='fractal')throw Error('分形实时上下文只能用于分形场景');if(this.recording||this.busy)throw Error('分形实时会话正在生成或录制');
  const replace=!this.host||live.sessionId!==this.sessionId;
  if(!replace&&(this.failed||live.revision<this.revision||live.startAt!==this.startAt))throw Error('分形实时实例已失效或版本倒退，需要新的 sessionId');
  this.cancel=c.isCancelled;
  let mutated=false;this.busy=true;
  try{
   if(this.cancel?.())throw new DOMException('分形实时预览已取消','AbortError');
   if(replace){
    const initial=live.configuration??scene;
    if(initial.id!==scene.id||initial.kind!==scene.kind)throw Error('分形配置快照与当前文档身份不匹配');
    const admitted=this.admit(initial,c),retained=clean(initial);
    if(live.startAt!==undefined)admitted.candidate.reconstruct(live.startAt);
    this.host=admitted.candidate;this.displayOwner=new SourceFractalDisplay();this.retained=retained;this.applied=retained;this.retainedFormulas=admitted.formulas;this.appliedFormulas=copy(admitted.formulas);this.sessionId=live.sessionId;this.revision=live.revision;this.startAt=live.startAt;this.failed=false;mutated=true;
   }else if(live.revision>this.revision){
    if(!live.configuration||live.configuration.kind!=='fractal'||live.configuration.id!==scene.id)throw Error('分形配置版本需要对应文档事件的完整配置快照');
    const configuration=live.configuration,admitted=this.admit(configuration,c),hot=live.intent==='hot'||this.host!.snapshot().paused;
    const retained=hot?hotScene(this.retained!,configuration):clean(configuration);
    prepareFractalRender(display(retained,admitted.candidate.snapshot()),c);
    mutated=true;if(live.intent==='hot')this.host!.hotApply(admitted.configuration);else this.host!.applyConfiguration(admitted.configuration);
    if(hot)this.displayOwner.applyConfiguration();else this.displayOwner=new SourceFractalDisplay();
    this.retained=retained;if(!hot){this.applied=retained;this.retainedFormulas=admitted.formulas;this.appliedFormulas=copy(admitted.formulas);}this.revision=live.revision;
   }
   // Same-revision author edits are staged, even if render-affecting. Only the
   // captured revision event above may replace live render configuration.
   this.completed=undefined;this.handoff=undefined;mutated=true;const snapshot=this.host!.update(live.clock,live.actualFrameRate),renderScene=display(this.retained!,snapshot),s=snapshot.state.scene;
   const facts=this.facts(snapshot,renderScene,live.actualFrameRate,'primary',true);
   const bind=(output:SceneOutput):Raster=>this.bind(output,facts);
   const output=bind(this.draw(renderScene,{...c,time:s.sceneTime,onProgress:c.onProgress?value=>c.onProgress!(bind(value)):undefined}));
   if(this.cancel?.())throw new DOMException('分形实时预览已取消','AbortError');
   const saved=snapshotGenerationInput(c);delete saved.fractalLive!.configuration;
   this.completed={sceneId:scene.id,sessionId:this.sessionId,revision:this.revision,width:c.width,height:c.height,context:saved};return output;
  }catch(error){if(mutated){this.failed=true;this.completed=undefined;}throw error;}
  finally{this.busy=false;this.cancel=undefined;}
 }
}
