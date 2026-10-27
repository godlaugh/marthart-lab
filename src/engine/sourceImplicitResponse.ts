import {validateSourceImplicitLiveContext} from './sourceImplicitLive';
import type {GenerationInput,SceneOutput} from '../types';
import {prepareOrdinarySourceFrame,type OrdinarySourceCameraFrame} from './ordinarySourceCamera';
import type {OrdinarySourceCameraFrame as NumericalFrame} from './ordinarySourceCameraTimeline';
import {validateFrameFormulas} from './formulaConfig';
import {SOURCE_IMPLICIT_PRESENTATION,sourceImplicitMeshRoute} from './sourceImplicitIdentity';
import {SOURCE_IMPLICIT_GPU_PRESENTATION} from './sourceImplicitGpuPresentation';
import type {SceneDocument} from '../types';
import type {SourceQueueRecordingClock} from './sourceRecordingClock';
import {implicitPaletteControlReceiptMatches} from './implicitPaletteControl';
import {validateSourceImplicitDisplay} from './sourceImplicitDisplay';
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
  if(output?.type!=='geometry')return false;
  const facts=output.sourceImplicitPresentation,count=output.positions.length/3;
  if(!facts||!Number.isSafeInteger(count)||facts.referencePixelDensity!==input.sourcePointPixelDensity||!Number.isFinite(facts.referencePixelDensity)||facts.referencePixelDensity<=0||typeof facts.fill!=='boolean'||!Number.isFinite(facts.lineWeight)||facts.lineWeight<=0||!(facts.fillColors instanceof Float32Array)||facts.fillColors.length!==count*4)return false;
  if(facts.model===SOURCE_IMPLICIT_GPU_PRESENTATION){
   const display=validateSourceImplicitDisplay(output.sourceImplicitDisplay,input);
   const formula=output.formulaPresentation;
   if(formula?.layout==='source-surface-centered-v1'&&(!formula.drawingViewport||display.viewport.some((v,i)=>v!==formula.drawingViewport![i])))return false;
   const scalar=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&Object.is(v,Math.fround(v));
   const packed=(v:unknown)=>typeof v==='number'&&Number.isInteger(v)&&v>=0&&v<=0xffffffff;
   const vector=(v:unknown)=>Array.isArray(v)&&v.length===3&&v.every(scalar);
   const m=facts.material;
   if(!['GPU','AUTO'].includes(facts.meshMode)||facts.meshComputation!=='source-cpu-fallback'||!(facts.palette instanceof Uint32Array)||facts.palette.length>65536||!vector(facts.boundsMin)||!vector(facts.boundsMax)||!scalar(facts.fillOpacity)||facts.fillOpacity<0||facts.fillOpacity>1||!m||!scalar(m.shininess)||m.shininess<0||m.shininess>100||!packed(m.ambient)||!packed(m.specular)||!Number.isInteger(m.proceduralTextureType)||m.proceduralTextureType<0||m.proceduralTextureType>4)return false;
   new Uint8Array(facts.palette.buffer,0,0); // Empty is valid; a detached transfer is not.
  }else if(facts.model!==SOURCE_IMPLICIT_PRESENTATION||output.sourceImplicitDisplay!==undefined)return false;
  const wire=facts.wire;
  if(wire&&(!(wire.positions instanceof Float32Array)||wire.positions.length%6!==0||!(wire.colors instanceof Float32Array)||wire.colors.length!==wire.positions.length||!(wire.alphas instanceof Float32Array)||wire.alphas.length!==wire.positions.length/3||!Array.isArray(wire.axes)||wire.axes.length!==2||new Set(wire.axes).size!==2||wire.axes.some(v=>!Number.isInteger(v)||v<0||v>2)||!Number.isSafeInteger(wire.samples)||wire.samples<0))return false;
  const display=facts.display;if(!display||[display.transparentBackground,display.showGrid,display.showAxes].some(value=>typeof value!=='boolean'))return false;
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

/** Fixed replay binds its requested presentation route. Controlled/continued
 * frames instead own their applied configuration, which may differ from the
 * staged document; their exact receipt and numerical owner remain authority. */
export function validSourceImplicitGenerationOutput(output:SceneOutput,input:GenerationInput,scene:SceneDocument,previous?:SceneOutput):boolean {
 if(input.implicitControls)return validImplicitControlOutput(output,input,previous);
 if(!validSourceImplicitOutput(output,input))return false;
 if(input.implicitLive)return true;
 if(output.formulaPresentation?.layout!==scene.formulas?.layout)return false;
 try{
  const route=sourceImplicitMeshRoute(scene),facts=output.sourceImplicitPresentation!;
  return route?.presentation==='cpu-slices'?facts.model===SOURCE_IMPLICIT_PRESENTATION:route?.presentation==='gpu-material'&&facts.model===SOURCE_IMPLICIT_GPU_PRESENTATION&&facts.meshMode===route.requestedMeshMode;
 }catch{return false;}
}
