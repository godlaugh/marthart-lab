import type {GenerateContext,GenerationInput,SceneDocument,SceneOutput} from '../types';
import type {PausedCaptureResult} from './generationProtocol';
import {snapshotGenerationInput} from './generationInput';
import {generateFractal,prepareFractalRender} from '../scenes/complex';
import {SourceFractalHostSession,type SourceFractalHostSnapshot} from './sourceFractalHostSession';
import {bindSourceFractalFrame,prepareSourceFractalScene} from './sourceFractalTimeline';
import {supportsSourceFractalLive} from './sourceFractalDocument';
import {validateSourceSceneClockRequest,type SourceSceneClockRequest} from './sourceSceneHostClock';
import {validateRasterRequest} from './rasterDimensions';

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
 sessionId:string;revision:number;clock:'realtime-source-queue';clockSource:'worker-wall-clock'|'injected';
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
 if(c.quality!=='preview'||c.fractalViewport?.target!=='primary')throw Error('分形实时实例只接受主预览；导出使用独立固定路径');
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
 const result=clean(scene);bindSourceFractalFrame(result,{...snapshot.state,displayFrame:snapshot.updateOrdinal,simulationFps:scene.timeline.fps});return result;
}
function presentation(scene:SceneDocument):SourceFractalLivePresentation {
 // Include absent optional fields explicitly so a staged author value cannot
 // fill an omission when the viewport merges this shell into the document.
 return copy({settings:scene.settings,palette:scene.palette,camera:scene.camera,sourceCamera:scene.sourceCamera,timeline:scene.timeline,formulas:scene.formulas,projectResolution:scene.projectResolution,fractalSource:scene.fractalSource,fractalSourceColor:scene.fractalSourceColor,evaluatedFractalScene:scene.evaluatedFractalScene,evaluatedFractalGradient:scene.evaluatedFractalGradient});
}

/** One worker-owned numerical host and captured render configuration. The
 * existing bounded GPU renderer is shared; every draw binds the entire native
 * state. This does not retain original GL targets, passIndex or accumulated ink. */
export class SourceFractalLiveSession {
 private host?:SourceFractalHostSession;
 private retained?:SceneDocument;
 private sessionId='';private revision=0;private startAt?:number;private failed=false;private busy=false;
 private cancel?:()=>boolean;
 private completed?:{sceneId:string;sessionId:string;revision:number;width:number;height:number;context:GenerationInput};
 constructor(private readonly render:(scene:SceneDocument,context:GenerateContext)=>SceneOutput=generateFractal){}
 reset():void {this.host=undefined;this.retained=undefined;this.sessionId='';this.revision=0;this.startAt=undefined;this.failed=false;this.completed=undefined;this.cancel=undefined;}
 diagnostics(){return{sessionId:this.sessionId,revision:this.revision,failed:this.failed,host:this.host&&!this.failed?this.host.snapshot():undefined,retainedBytes:this.retained?JSON.stringify(this.retained).length*2:0};}
 matchesCompletedPrimary(scene:SceneDocument,c:GenerateContext):boolean {
  const value=this.completed,v=c.fractalLive;return !this.failed&&!this.busy&&!!value&&!!v&&scene.id===value.sceneId&&v.sessionId===value.sessionId&&v.revision===value.revision&&c.width===value.width&&c.height===value.height&&c.fractalViewport?.target==='primary';
 }
 setPaused(paused:boolean,timestampMs?:number):void {
  if(this.busy||this.failed||!this.host||!this.completed)throw Error('分形播放控制需要已完成且可用的实时主预览');
  validateSourceSceneClockRequest({paused,timestampMs});
  try{this.host.setPaused(paused,timestampMs);}catch(error){this.failed=true;this.completed=undefined;throw error;}
 }
 private admit(scene:SceneDocument,c:GenerateContext){
  if(!supportsSourceFractalLive(scene))throw Error('分形实时预览需要完整 Newton/Nova 源配置与源队列');
  const configuration=prepareSourceFractalScene(scene),candidate=new SourceFractalHostSession(configuration,{paused:c.fractalLive!.clock.paused,isCancelled:()=>this.cancel?.()??false});
  prepareFractalRender(display(scene,candidate.snapshot()),c);return{configuration,candidate};
 }
 private facts(snapshot:SourceFractalHostSnapshot,scene:SceneDocument,actualFrameRate:number,target:'primary'|'offscreen',updated:boolean):SourceFractalLiveFacts {
  const s=snapshot.state.scene;
  return{sessionId:this.sessionId,revision:this.revision,clock:'realtime-source-queue',clockSource:snapshot.hostClock.clockSource,target,renderKind:updated?'update':'snapshot',sceneTime:s.sceneTime,rawDt:updated?s.rawDt:0,activeDt:updated?s.activeDt:0,queueIndex:s.queueIndex,queueComplete:s.queueComplete,paused:snapshot.paused,updateOrdinal:snapshot.updateOrdinal,objectUpdates:updated?s.objectUpdates.length:0,actualFrameRate:Math.fround(actualFrameRate),presentation:presentation(scene)};
 }
 private bind(output:SceneOutput,facts:SourceFractalLiveFacts):Raster {
  if(output.type!=='raster'||!output.fractalRender)throw Error('分形实时预览未返回源栅格事实');output.fractalLive=copy(facts);return output;
 }
 /** Local current-state PNG: two complete renders bind the same numerical
  * snapshot, never an update or authored-document replay. This does not claim
  * original screenshot target/GL or enhancement behavior. */
 capturePaused(scene:SceneDocument,c:GenerateContext,options:{additionalBytes?:number}={}):PausedCaptureResult {
  if(!this.completed||!this.host||!this.retained||this.failed||this.busy||scene.id!==this.completed.sceneId||c.fractalLive?.sessionId!==this.sessionId||c.fractalLive.revision!==this.revision)throw Error('分形当前帧截图需要已完成的实时主预览');
  const snapshot=this.host.snapshot();if(!snapshot.paused)throw Error('请先暂停分形再保存当前帧');
  const retained=this.completed,renderScene=display(this.retained,snapshot),primary:GenerateContext={...retained.context,isCancelled:c.isCancelled,onProgress:undefined};
  const capture:GenerateContext={...primary,time:snapshot.state.scene.sceneTime,quality:'export',width:c.width,height:c.height,fractalViewport:{logicalWidth:c.width,logicalHeight:c.height,target:'offscreen'},fractalLive:undefined};
  validateRasterRequest(capture);const extra=options.additionalBytes??0;
  if(!Number.isSafeInteger(extra)||extra<0||extra+capture.width*capture.height*8+primary.width*primary.height*4>768*1024*1024)throw Error('分形当前帧截图超过 768 MiB 工作预算');
  prepareFractalRender(renderScene,capture);prepareFractalRender(renderScene,primary);
  if(c.isCancelled?.())throw new DOMException('分形当前帧截图已取消','AbortError');
  this.busy=true;this.completed=undefined;
  try{
   const actualFrameRate=retained.context.fractalLive!.actualFrameRate;
   const captured=this.bind(this.render(renderScene,capture),this.facts(snapshot,renderScene,actualFrameRate,'offscreen',false));
   if(c.isCancelled?.())throw new DOMException('分形当前帧截图已取消','AbortError');
   const preview=this.bind(this.render(display(this.retained,snapshot),primary),this.facts(snapshot,renderScene,actualFrameRate,'primary',false));
   if(c.isCancelled?.())throw new DOMException('分形当前帧截图已取消','AbortError');
   this.completed=retained;return{capture:captured,preview};
  }catch(error){this.failed=true;throw error;}finally{this.busy=false;}
 }
 generate(scene:SceneDocument,c:GenerateContext):Raster {
  const live=context(c);if(scene.kind!=='fractal')throw Error('分形实时上下文只能用于分形场景');if(this.busy)throw Error('分形实时会话正在生成');
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
    this.host=admitted.candidate;this.retained=retained;this.sessionId=live.sessionId;this.revision=live.revision;this.startAt=live.startAt;this.failed=false;mutated=true;
   }else if(live.revision>this.revision){
    if(!live.configuration||live.configuration.kind!=='fractal'||live.configuration.id!==scene.id)throw Error('分形配置版本需要对应文档事件的完整配置快照');
    const configuration=live.configuration,admitted=this.admit(configuration,c),hot=live.intent==='hot'||this.host!.snapshot().paused;
    const retained=hot?hotScene(this.retained!,configuration):clean(configuration);
    prepareFractalRender(display(retained,admitted.candidate.snapshot()),c);
    mutated=true;if(live.intent==='hot')this.host!.hotApply(admitted.configuration);else this.host!.applyConfiguration(admitted.configuration);
    this.retained=retained;this.revision=live.revision;
   }
   // Same-revision author edits are staged, even if render-affecting. Only the
   // captured revision event above may replace live render configuration.
   this.completed=undefined;mutated=true;const snapshot=this.host!.update(live.clock,live.actualFrameRate),renderScene=display(this.retained!,snapshot),s=snapshot.state.scene;
   const facts=this.facts(snapshot,renderScene,live.actualFrameRate,'primary',true);
   const bind=(output:SceneOutput):Raster=>this.bind(output,facts);
   const output=bind(this.render(renderScene,{...c,time:s.sceneTime,onProgress:c.onProgress?value=>c.onProgress!(bind(value)):undefined}));
   if(this.cancel?.())throw new DOMException('分形实时预览已取消','AbortError');
   const saved=snapshotGenerationInput(c);delete saved.fractalLive!.configuration;
   this.completed={sceneId:scene.id,sessionId:this.sessionId,revision:this.revision,width:c.width,height:c.height,context:saved};return output;
  }catch(error){if(mutated){this.failed=true;this.completed=undefined;}throw error;}
  finally{this.busy=false;this.cancel=undefined;}
 }
}
