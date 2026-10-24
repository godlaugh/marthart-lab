import {validateSourceImplicitLiveContext} from './sourceImplicitLive';
import type {GenerationInput,SceneOutput} from '../types';
import {prepareOrdinarySourceFrame,type OrdinarySourceCameraFrame} from './ordinarySourceCamera';
import type {OrdinarySourceCameraFrame as NumericalFrame} from './ordinarySourceCameraTimeline';
import {validateFrameFormulas} from './formulaConfig';
import {SOURCE_IMPLICIT_PRESENTATION} from './sourceImplicitPresentation';
import type {SourceQueueRecordingClock} from './sourceRecordingClock';
import {implicitPaletteControlReceiptMatches} from './implicitPaletteControl';
export type ImplicitCameraFrame=OrdinarySourceCameraFrame&NumericalFrame;
type Geometry=Extract<SceneOutput,{type:'geometry'}>&{sourceCameraFrame:ImplicitCameraFrame};
/** Validate the actual owner's receipt; staged author values never select the
 * applied configuration or reset count. Recording checks its own reset step. */
export function validImplicitControlOutput(output:SceneOutput,input:GenerationInput,previous?:SceneOutput):boolean {
 const request=input.implicitControls,receipt=output.implicitControls;
 if(!request)return receipt===undefined;
 if(!receipt||receipt.sessionId!==request.sessionId||!validSourceImplicitOutput(output,input))return false;
 const {sessionId:_,...facts}=receipt,{sessionId:__,...controls}=request;
 const prior=previous?.implicitControls?.sessionId===request.sessionId?previous.implicitControls:undefined;
 const priorFacts=prior?{revision:prior.revision,applyRevision:prior.applyRevision,resetRevision:prior.resetRevision}:undefined;
 return implicitPaletteControlReceiptMatches(facts,controls,priorFacts);
}
/** Validate delivered numerical camera facts without replaying the queue. */
export function implicitCameraFrame(output:SceneOutput):ImplicitCameraFrame {
 const f=output.sourceCameraFrame as ImplicitCameraFrame|undefined;
 if(!f||![f.sceneTime,f.time,f.rawDt,f.activeDt].every(Number.isFinite)||!Number.isSafeInteger(f.queueIndex)||f.queueIndex<0||typeof f.queueComplete!=='boolean'||!Array.isArray(f.rates)||f.rates.length!==3||!f.rates.every(Number.isFinite))throw Error('隐式录制数值帧无效');
 prepareOrdinarySourceFrame(f);return f;
}
export function validSourceImplicitOutput(output:SceneOutput,input:GenerationInput,presentationOnly=false):output is Geometry {
 try{
  if(output?.type!=='geometry'||output.sourceImplicitPresentation?.model!==SOURCE_IMPLICIT_PRESENTATION||output.sourceImplicitPresentation.referencePixelDensity!==input.sourcePointPixelDensity)return false;
  const display=output.sourceImplicitPresentation.display;if(!display||[display.transparentBackground,display.showGrid,display.showAxes].some(value=>typeof value!=='boolean'))return false;
  const parameters=output.sourceImplicitParameters;if(!parameters||parameters.model!=='implicit-registry-1.7.8'||!parameters.values||typeof parameters.values!=='object'||Array.isArray(parameters.values)||Object.values(parameters.values).some(value=>typeof value!=='number'||!Number.isFinite(value)))return false;
  const frame=implicitCameraFrame(output),v=frame.viewport,w=input.sourceViewport;
  if(!w||v.logicalWidth!==w.logicalWidth||v.logicalHeight!==w.logicalHeight||v.referenceLogicalHeight!==w.referenceLogicalHeight||v.target!==w.target||v.projectionPass!==w.projectionPass)return false;
  if(input.implicitLive&&output.implicitRecording===undefined){
   validateSourceImplicitLiveContext(input.implicitLive);const live=output.implicitLive;
   if(!live||live.sessionId!==input.implicitLive.sessionId||typeof live.paused!=='boolean'||!presentationOnly&&live.paused!==input.implicitLive.clock.paused||!['update','snapshot'].includes(live.renderKind)||!['worker-wall-clock','injected'].includes(live.clockSource)||!Object.is(live.actualFrameRate,Math.fround(input.implicitLive.actualFrameRate))||frame.time!==frame.sceneTime)return false;
  }else if(output.implicitLive!==undefined)return false;
  validateFrameFormulas(output.formulaPresentation,w);return true;
 }catch{return false;}
}
export function assertSourceImplicitRecordingFrame(output:SceneOutput,clock:SourceQueueRecordingClock,index:number):void {
 const f=implicitCameraFrame(output),r=output.implicitRecording;
 if(!Number.isSafeInteger(index)||index<0||index>clock.lastDisplayFrame||!r||r.displayFrame!==index||r.simulationFps!==clock.simulationFps||!Number.isFinite(r.actualFrameRate)||r.actualFrameRate!==Math.fround(r.actualFrameRate)||r.warmup!==(index===0)||r.complete!==(index===clock.lastDisplayFrame)||f.frameIndex!==index||f.queueComplete!==r.complete||f.rawDt!==Math.fround(1/Math.fround(clock.simulationFps))||f.time!==f.sceneTime||f.viewport.target!=='offscreen')throw Error('隐式录制帧与实际队列完成状态不一致');
}
