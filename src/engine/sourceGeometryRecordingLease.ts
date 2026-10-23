import {sameSourceRecordingValue as same} from './sourceRecordingValue';
import {validateSourceImplicitLiveContext} from './sourceImplicitLive';
import {usesSourceImplicitCpuMesh} from './sourceImplicitPresentation';
import {validSourceImplicitOutput,implicitCameraFrame,assertSourceImplicitRecordingFrame,type ImplicitCameraFrame} from './sourceImplicitResponse';
import type {GenerationInput,SceneDocument,SceneOutput,FormulaPresentation} from '../types';
import type {SourceRecordingOptions,SourceRecordingWireStart,SourceRecordingStop} from './generationProtocol';
import {validSourceQueueRecordingClock,type SourceQueueRecordingClock} from './sourceRecordingClock';
import {sourceRecordingSize} from './sourceRecordingSize';
import {sourceSurfaceParameterFrameRate} from './sourceSurfaceFrame';
import {validSourceSurfaceOutput,validSourceSurfacePresentation} from './sourceSurfaceResponse';
import {assertSourceSurfaceRecordingFrame} from './sourceSurfaceRecording';
import {snapshotGenerationInput} from './generationInput';
import {usesSourceSurfaceGeometry} from './sourceSurfaceIdentity';
import type {GeometryRecordingRenderer} from './renderGeometryRecording';
import type {SourceDrawingRequest} from './sourceDrawingPixels';
import type {SourceSurfaceLiveFacts} from './sourceSurfaceLiveSession';
type Geometry=Extract<SceneOutput,{type:'geometry'}>;
/** Labels/layout stay fixed during this recording; the final transition is a
 * delivered frame fact validated against the numerical producer separately. */
function annotations(value:FormulaPresentation|undefined):FormulaPresentation|undefined {
 if(value?.layout!=='source-surface-centered-v1')return value;
 const {finalBlackOverlayAlpha:_,...stable}=value;return stable;
}
const rate=(value:number|undefined)=>sourceSurfaceParameterFrameRate({frameIndex:0,time:0,deltaTime:0,actualFrameRate:value},NaN);
/** Numerical facts belong to the Worker. This client lease validates transport,
 * retains an unpainted geometry frame, and owns one main-thread GL renderer. */
export class SourceGeometryRecordingLease {
 readonly size:ReturnType<typeof sourceRecordingSize>;readonly options:SourceRecordingOptions;
 readonly primary:GenerationInput;readonly sceneId:string;readonly constructions:number;
 clock?:SourceQueueRecordingClock;scene?:SceneDocument;
 private readonly implicit:boolean;private readonly anchor?:SceneDocument;private lastImplicit?:ImplicitCameraFrame;private implicitSessionId?:string;
 private formulas?:FormulaPresentation;private pending?:Geometry;private last?:SourceSurfaceLiveFacts;
 private attempt?:{index:number;rate:number};private next=1;private warmupDelivered=false;
 private renderer?:GeometryRecordingRenderer;private stopping=false;private drawing=false;
 constructor(scene:SceneDocument,input:GenerationInput,output:Geometry,options:SourceRecordingOptions,private readonly signal?:AbortSignal){
  this.implicit=usesSourceImplicitCpuMesh(scene);this.anchor=this.implicit?structuredClone(scene):undefined;
  if((this.implicit?!validSourceImplicitOutput(output,input,true):!validSourceSurfacePresentation(output,input)||!usesSourceSurfaceGeometry(scene))||output.sourceCameraFrame?.viewport.target!=='primary')throw Error('几何录制需要已完成的源主预览');
  const actualFrameRate=rate(options.actualFrameRate);
  if(!Number.isSafeInteger(options.simulationFps)||options.simulationFps<1||options.simulationFps>120)throw Error('曲面录制模拟帧率必须为 1–120 的整数');
  this.options={...options,actualFrameRate};this.size=sourceRecordingSize(options,input.sourcePointPixelDensity??1);
  this.primary=snapshotGenerationInput(input);this.sceneId=scene.id;this.constructions=this.implicit?0:output.surfaceLive!.constructions+1;
 }
 private context(input:GenerationInput):boolean {
  if(this.implicit){if(!input)return false;const {time:_,implicitLive:__,...a}=input,{time:___,implicitLive:____,...b}=this.primary;return same(a,b);}
  const a=input?.surfaceLive,b=this.primary.surfaceLive;
  return !!a&&!!b&&a.sessionId===b.sessionId&&a.revision===b.revision&&a.clock?.paused===false&&a.startAt===undefined&&a.configuration===undefined&&input.width===this.primary.width&&input.height===this.primary.height&&input.quality===this.primary.quality&&input.sourcePointPixelDensity===this.primary.sourcePointPixelDensity&&same(input.sourceViewport,this.primary.sourceViewport);
 }
 private frame(output:SceneOutput,index:number,actualFrameRate:number,clock=this.clock):asserts output is Geometry {
  if(this.implicit){
   const size=this.size,input:GenerationInput={...this.primary,width:size.width,height:size.height,quality:'export',sourceViewport:{...this.primary.sourceViewport!,logicalWidth:size.width,logicalHeight:size.height,referenceLogicalHeight:this.primary.sourceViewport!.logicalHeight,target:'offscreen'}};
   if(!clock||!validSourceQueueRecordingClock(clock,this.options.simulationFps)||!validSourceImplicitOutput(output,input))throw Error('隐式录制响应身份或尺寸无效');
   assertSourceImplicitRecordingFrame(output,clock,index);
   if(!Object.is(output.implicitRecording!.actualFrameRate,actualFrameRate))throw Error('隐式录制实际帧率不匹配');
   if(this.formulas&&!same(output.formulaPresentation,this.formulas))throw Error('隐式录制公式改变了已确认的标注');
   return;
  }
  const size=this.size,input:GenerationInput={...this.primary,width:size.width,height:size.height,quality:'export',surfaceLive:{...this.primary.surfaceLive!,clock:{paused:false}},sourceViewport:{...this.primary.sourceViewport!,logicalWidth:size.logicalWidth,logicalHeight:size.logicalHeight,referenceLogicalHeight:this.primary.sourceViewport!.logicalHeight,target:'offscreen'}};
  if(!clock||!validSourceQueueRecordingClock(clock,this.options.simulationFps)||!validSourceSurfaceOutput(output,input,true))throw Error('曲面录制响应身份或尺寸无效');
  assertSourceSurfaceRecordingFrame(output,clock,index);
  if(this.formulas&&!same(annotations(output.formulaPresentation),this.formulas))throw Error('曲面录制公式改变了已确认的场景标注');
  const live=output.surfaceLive!;
  if(live.constructions!==this.constructions||!Object.is(live.recording!.actualFrameRate,actualFrameRate)||live.frame.rawDt!==Math.fround(1/Math.fround(clock.simulationFps)))throw Error('曲面录制响应时钟或对象身份无效');
 }
 acceptStart(start:SourceRecordingWireStart):void {
  if(this.drawing||this.clock)throw Error('曲面录制重复起始响应');
  if(start?.scene?.formulas?.layout==='source-surface-centered-v1'&&start.warmup?.formulaPresentation?.layout!=='source-surface-centered-v1')throw Error('曲面录制公式布局无效');
  if(this.implicit){if(!same(start?.scene,this.anchor)||!this.context(start.context)||start.context.time!==this.primary.time)throw Error('隐式录制起始配置或主预览身份无效');validateSourceImplicitLiveContext(start.context.implicitLive!);if(start.context.implicitLive!.clock.paused||!Object.is(start.context.implicitLive!.actualFrameRate,this.options.actualFrameRate))throw Error('隐式录制继续播放状态无效');this.implicitSessionId=start.context.implicitLive!.sessionId;}
  else if(!start?.scene||start.scene.id!==this.sceneId||!usesSourceSurfaceGeometry(start.scene)||!this.context(start.context)||start.context.time!==0||!Object.is(rate(start.context.surfaceLive!.actualFrameRate),this.options.actualFrameRate))throw Error('曲面录制起始配置或主预览身份无效');
  if(!validSourceQueueRecordingClock(start.clock,this.options.simulationFps))throw Error('曲面录制完成规划无效');
  this.frame(start.warmup,0,this.options.actualFrameRate!,start.clock);
  this.clock=structuredClone(start.clock);this.scene=structuredClone(start.scene);this.pending=start.warmup;this.formulas=structuredClone(annotations(start.warmup.formulaPresentation));if(this.implicit)this.lastImplicit=structuredClone(implicitCameraFrame(start.warmup));else this.last=structuredClone(start.warmup.surfaceLive!);
 }
 requestFrame(index:number,actualFrameRate:number|undefined):{cached:boolean;actualFrameRate:number} {
  if(this.stopping||!this.warmupDelivered||!this.clock||index!==this.next||index>this.clock.lastDisplayFrame)throw Error('曲面录制必须连续请求，未交付 warmup 的会话只能停止');
  const observed=rate(actualFrameRate);
  if(this.attempt&&!Object.is(this.attempt.rate,observed))throw Error('曲面录制重试不能改变未确认帧的实际帧率');
  this.attempt={index,rate:observed};return{cached:!!this.pending,actualFrameRate:observed};
 }
 acceptFrame(output:SceneOutput,index:number):void {
  if(this.drawing||this.pending)throw Error('曲面录制重复帧响应');
  if(!this.attempt||this.attempt.index!==index)throw Error('曲面录制返回了未请求的帧');
  this.frame(output,index,this.attempt.rate);this.pending=output;if(this.implicit)this.lastImplicit=structuredClone(implicitCameraFrame(output));else this.last=structuredClone(output.surfaceLive!);
 }
 async render(Renderer:typeof GeometryRecordingRenderer,isCancelled:()=>boolean,identity:Pick<SourceDrawingRequest,'generation'|'sequence'>){
  if(!this.pending||!this.scene||this.stopping||this.drawing)throw Error('曲面录制没有待绘制帧或前一帧尚未完成');
  const check=()=>{if(isCancelled()||this.stopping||this.signal?.aborted)throw new DOMException('曲面录制绘图已取消','AbortError');};check();
  const pending=this.pending;this.drawing=true;
  try{
   this.renderer??=new Renderer(this.scene,this.size);
   const output=await this.renderer.render(pending,isCancelled,{...identity,signal:this.signal??new AbortController().signal});check();
   if(this.pending!==pending)throw Error('曲面录制待交付帧已改变');
   const index=this.implicit?pending.implicitRecording!.displayFrame:pending.surfaceLive!.frame.frameIndex;
   this.pending=undefined;this.attempt=undefined;if(index===0)this.warmupDelivered=true;else this.next=index+1;
   return output;
  }finally{this.drawing=false;}
 }
 prepareStop():void {this.stopping=true;this.releaseRenderer();}
 releaseRenderer():void {this.renderer?.dispose();this.renderer=undefined;}
 acceptStop(stop:SourceRecordingStop):void {
  const output=stop?.preview;
  if(this.implicit){
   if(!same(stop?.scene,this.anchor)||!this.context(stop.context)||!validSourceImplicitOutput(output,stop.context)||output.implicitRecording!==undefined)throw Error('隐式录制停止响应身份无效');
   validateSourceImplicitLiveContext(stop.context.implicitLive!);
   if(stop.context.implicitLive!.clock.paused||this.implicitSessionId&&stop.context.implicitLive!.sessionId!==this.implicitSessionId)throw Error('隐式录制停止继续播放身份无效');
   const frame=implicitCameraFrame(output),confirmed=this.lastImplicit?.frameIndex??0,possible=this.attempt?.index??confirmed;
   if(stop.context.time!==frame.sceneTime||(frame.frameIndex!==confirmed&&frame.frameIndex!==possible)||frame.rawDt!==Math.fround(1/Math.fround(this.options.simulationFps)))throw Error('隐式录制停止响应增加了未知更新');
   if(this.lastImplicit&&frame.frameIndex===confirmed){const {viewport:_,...a}=frame,{viewport:__,...b}=this.lastImplicit;if(!same(a,b))throw Error('隐式录制停止改变了已确认数值帧');}
   if(this.lastImplicit&&frame.frameIndex!==confirmed&&(frame.activeDt<0||frame.activeDt>frame.rawDt||frame.sceneTime!==Math.fround(this.lastImplicit.sceneTime+frame.activeDt)))throw Error('隐式录制停止未确认帧的时钟不匹配');
   if(this.clock&&frame.queueComplete!==(frame.frameIndex===this.clock.lastDisplayFrame))throw Error('隐式录制停止完成状态不匹配');
   if(this.formulas&&!same(output.formulaPresentation,this.formulas))throw Error('隐式录制停止改变了场景标注');
   this.pending=undefined;return;
  }
  if(stop?.scene?.id!==this.sceneId||stop.scene.kind!=='surface'||!this.context(stop.context)||!validSourceSurfaceOutput(output,stop.context)||output.surfaceLive!.renderKind!=='snapshot'||output.surfaceLive!.recording!==undefined||output.surfaceLive!.constructions!==this.constructions||stop.context.time!==output.surfaceLive!.frame.sceneTime)throw Error('曲面录制停止响应身份无效');
  if(this.formulas&&!same(annotations(output.formulaPresentation),this.formulas))throw Error('曲面录制停止改变了场景标注');
  const frame=output.surfaceLive!.frame,confirmed=this.last?.frame.frameIndex??0,possible=this.attempt?.index??confirmed;
  if(frame.frameIndex!==confirmed&&frame.frameIndex!==possible)throw Error('曲面录制停止响应增加了未知更新');
  if(this.last&&frame.frameIndex===confirmed&&!same(frame,this.last.frame))throw Error('曲面录制停止改变了已确认的数值状态');
  if(this.last&&frame.frameIndex!==confirmed){
   const dt=Math.fround(1/Math.fround(this.options.simulationFps));
   if(frame.sceneTime!==Math.fround(this.last.frame.sceneTime+dt)||frame.rawDt!==dt||this.clock&&frame.queueComplete!==(frame.frameIndex===this.clock.lastDisplayFrame))throw Error('曲面录制停止未确认帧的时钟不匹配');
  }
  const expectedRate=frame.frameIndex===confirmed?(this.last?.recording?.actualFrameRate??this.options.actualFrameRate):this.attempt!.rate;
  if(!Object.is(rate(stop.context.surfaceLive!.actualFrameRate),expectedRate))throw Error('曲面录制停止实际帧率不匹配');
  this.pending=undefined;
 }
}
