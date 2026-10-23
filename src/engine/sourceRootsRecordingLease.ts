import {prepareRootsCameraTimeline} from './rootsCameraTimeline';
import type {GenerationInput,SceneDocument,SceneOutput} from '../types';
import type {SourceRecordingOptions,SourceRecordingWireStart,SourceRecordingStop} from './generationProtocol';
import {validSourceObservedRecordingClock,type SourceRecordingClock,type SourceObservedRecordingClock} from './sourceRecordingClock';
import {snapshotGenerationInput} from './generationInput';
import {sourceRecordingSize} from './sourceRecordingSize';
import {isRootsAutoRecordingComplete} from './rootsRecording';
import {validRootsLiveOutput} from './rootsLive';
import {resolveFormulaContent,presentFormulas} from './formulas';
import {rootsFormulaViewport} from './rootsFormulaPresentation';
import {validateFrameFormulas} from './formulaConfig';
import type {RootsLiveFacts} from './rootsLive';
type Raster=Extract<SceneOutput,{type:'raster'}>;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** Validate frame facts shared by the lease and downstream recording consumer.
 * A recording response is never valid as an ordinary live preview. */
export function assertRootsLiveRecordingFrame(output:SceneOutput,clock:SourceRecordingClock,index:number):asserts output is Raster {
 if(!validSourceObservedRecordingClock(clock,clock?.simulationFps)||output?.type!=='raster'||!output.rootsLive||!output.rootsPresentation||!output.roots)throw Error('复根录制响应缺少实际显示事实');
 const f=output.rootsLive,r=f.recording,p=f.autoRecording;
 if(typeof p.complete!=='boolean'||typeof p.hasAnimations!=='boolean'||typeof p.queueComplete!=='boolean'||!Number.isSafeInteger(index)||index<0||!r||r.displayFrame!==index||r.simulationFps!==clock.simulationFps||r.warmup!==(index===0)||r.complete!==p.complete||p.complete!==isRootsAutoRecordingComplete(p)||f.frame.frame!==index+1||f.frame.rawDt!==Math.fround(1/Math.fround(clock.simulationFps))||f.clockSource!=='render-fixed-step'||f.renderKind!=='update'||f.paused||f.frame.paused||f.frame.sceneTime!==f.sceneTime||![f.sceneTime,f.frame.rawDt,f.frame.activeDt].every(Number.isFinite)||output.rootsPresentation.target!=='offscreen')throw Error('复根录制显示帧或完成判定无效');
 const stream=f.stream;
 if(![p.finishedWorkers,p.workerCount,p.queueSize,p.pendingPoints,output.roots.attemptedSamples,output.roots.rootPoints,f.frame.queueIndex].every(n=>Number.isSafeInteger(n)&&n>=0)||p.workerCount<1||p.finishedWorkers>p.workerCount||![f.frame.camera.phi,f.frame.camera.theta,f.frame.camera.gamma,f.frame.camera.zoom].every(Number.isFinite))throw Error('复根录制计数或相机值无效');
 if(stream?.policy!=='roots-worker-arrival-v1'||stream.failed||stream.disposed||stream.pool.consumedSamples!==output.roots.attemptedSamples||stream.pending.producedPoints!==output.roots.rootPoints||p.policy!=='roots-worker-arrival-v1'||p.mode!==output.rootsPresentation.mode||p.queueComplete!==f.frame.queueComplete||p.finishedWorkers!==stream.pending.finishedWorkers||p.workerCount!==stream.pending.workerCount||p.queueSize!==stream.pool.queuedBatches+stream.pool.waitingBatches+stream.pending.queuedBatches||p.pendingPoints!==stream.pending.pendingPoints)throw Error('复根录制完成事实与实际队列不一致');
 if(!Number.isSafeInteger(output.width)||!Number.isSafeInteger(output.height)||output.width<1||output.height<1||!(output.pixels instanceof Uint8ClampedArray)||output.pixels.byteLength!==output.width*output.height*4)throw Error('复根录制像素无效');
}
/** Client-owned identity and sequencing; no replanning the asynchronous solver. */
export class SourceRootsRecordingLease {
 private readonly primary:GenerationInput;private readonly size:ReturnType<typeof sourceRecordingSize>;private readonly scene:SceneDocument;private readonly options:SourceRecordingOptions;
 private readonly hasAnimations:boolean;private readonly priorInstance:number;private instance?:number;private next=1;private attempt?:number;private last?:RootsLiveFacts;
 private clock?:SourceObservedRecordingClock;
 private readonly recordingFormulas:ReturnType<typeof presentFormulas>;private readonly primaryFormulas:ReturnType<typeof presentFormulas>;
 constructor(scene:SceneDocument,input:GenerationInput,output:Raster,options:SourceRecordingOptions){
  // A playback acknowledgement updates the current control state without
  // repainting the completed-image capability. Validate that image against
  // its observed pause state, while retaining the acknowledged input below.
  const displayed=input.rootsLive&&output.rootsLive?{...input,rootsLive:{...input.rootsLive,clock:{...input.rootsLive.clock,paused:output.rootsLive.paused}}}:input;
  if(!validRootsLiveOutput(output,displayed)||output.rootsPresentation?.target!=='primary')throw Error('复根录制需要实时主预览');
  if(!Number.isSafeInteger(options.simulationFps)||options.simulationFps<1||options.simulationFps>120)throw Error('复根录制帧率必须为 1–120 的整数');
  this.primary={...snapshotGenerationInput(input),rootsViewport:{logicalWidth:output.rootsPresentation.logicalSize[0],logicalHeight:output.rootsPresentation.logicalSize[1],referenceLogicalHeight:output.rootsPresentation.referenceLogicalHeight,target:'primary'}};this.scene=structuredClone(scene);this.options={...options};this.hasAnimations=prepareRootsCameraTimeline(scene).clips.length>0;this.priorInstance=output.rootsPresentation.instance;
  this.size=sourceRecordingSize(options,input.rootsPixelDensity??NaN);
  const content=resolveFormulaContent(this.scene),viewport=this.primary.rootsViewport!;
  this.primaryFormulas=presentFormulas(content,rootsFormulaViewport(viewport));
  this.recordingFormulas=presentFormulas(content,rootsFormulaViewport({...viewport,logicalWidth:this.size.logicalWidth,logicalHeight:this.size.logicalHeight,target:'offscreen'}));
 }
 private context(input:GenerationInput):boolean {
  const a=input?.rootsLive,b=this.primary.rootsLive;
  return !!a&&!!b&&a.sessionId===b.sessionId&&a.maximumWorkers===b.maximumWorkers&&a.clock?.paused===false&&input.width===this.primary.width&&input.height===this.primary.height&&input.quality===this.primary.quality&&input.rootsPixelDensity===this.primary.rootsPixelDensity&&same(input.rootsViewport,this.primary.rootsViewport);
 }
 private frame(output:SceneOutput,index:number,clock:SourceRecordingClock):asserts output is Raster {
  assertRootsLiveRecordingFrame(output,clock,index);
  const f=output.rootsLive!,p=output.rootsPresentation!,s=this.size;
  const viewport={logicalWidth:s.logicalWidth,logicalHeight:s.logicalHeight,referenceLogicalHeight:this.primary.rootsViewport?.referenceLogicalHeight??this.primary.height,target:'offscreen' as const};
  const formulaViewport=rootsFormulaViewport(viewport),expected=this.recordingFormulas;
  validateFrameFormulas(output.formulaPresentation,formulaViewport);
  if(f.autoRecording.hasAnimations!==this.hasAnimations||p.mode!==this.scene.rootsPresentation!.mode||clock.simulationFps!==this.options.simulationFps||f.sessionId!==this.primary.rootsLive!.sessionId||p.instance!==(this.instance??this.priorInstance+1)||output.width!==s.width||output.height!==s.height||!same(p.logicalSize,[s.logicalWidth,s.logicalHeight])||p.referenceLogicalHeight!==viewport.referenceLogicalHeight||!same(output.formulaPresentation,expected))throw Error('复根录制身份、尺寸或公式不匹配');
 }
 acceptStart(start:SourceRecordingWireStart):void {
  if(!same(start?.scene,this.scene)||!this.context(start.context)||start.context.time!==0||!validSourceObservedRecordingClock(start.clock,this.options.simulationFps))throw Error('复根录制起始配置或完成策略无效');
  this.frame(start.warmup,0,start.clock);this.clock=structuredClone(start.clock);this.instance=start.warmup.rootsPresentation!.instance;this.last=structuredClone(start.warmup.rootsLive!);
 }
 requestFrame(index:number):void {
  if(!this.clock||this.last?.recording?.complete||index!==this.next||!Number.isSafeInteger(index))throw Error('复根录制需要下一连续显示帧，已完成或未交付预热的会话只能停止');
  this.attempt=index;
 }
 acceptFrame(output:SceneOutput,index:number):void {
  if(!this.clock||index!==this.attempt||index!==this.next)throw Error('复根录制交付序号无效');
  this.frame(output,index,this.clock);this.last=structuredClone(output.rootsLive!);this.attempt=undefined;this.next++;
 }
 acceptStop(stop:SourceRecordingStop):void {
  const output=stop?.preview;
  if(!same(stop?.scene,this.scene)||!this.context(stop.context)||!validRootsLiveOutput(output,stop.context)||output.type!=='raster'||output.rootsPresentation?.target!=='primary'||output.rootsPresentation.instance!==(this.instance??this.priorInstance+1)||output.rootsLive?.renderKind!=='snapshot'||output.rootsLive.sceneTime!==stop.context.time)throw Error('复根录制停止响应无效');
  // A failed publication may have consumed one attempted frame. Stopping may
  // return that frame, but never advance another numerical update itself.
  const viewport=this.primary.rootsViewport!,p=output.rootsPresentation;
  validateFrameFormulas(output.formulaPresentation,rootsFormulaViewport(viewport));
  if(!same(output.formulaPresentation,this.primaryFormulas)||!same(p.logicalSize,[viewport.logicalWidth,viewport.logicalHeight])||p.referenceLogicalHeight!==viewport.referenceLogicalHeight||p.mode!==this.scene.rootsPresentation!.mode)throw Error('复根停止主预览显示事实无效');
  const frame=output.rootsLive.frame;
  if(!this.last&&frame.frame!==1)throw Error('未交付预热帧的复根停止响应额外推进了场景');
  if(this.last&&frame.frame!==this.last.frame.frame&&frame.frame!==(this.attempt===undefined?undefined:this.attempt+1))throw Error('复根停止时额外推进了场景');
  if(this.last&&frame.frame===this.last.frame.frame&&!same(frame,this.last.frame))throw Error('复根停止改变了最后成功帧');
 }
}
