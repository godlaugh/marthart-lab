import {validSourceImplicitOutput} from './sourceImplicitResponse';
import {usesSourceImplicitCpuMesh} from './sourceImplicitPresentation';
import {SourceRootsRecordingLease} from './sourceRootsRecordingLease';
import {validRootsLiveOutput} from './rootsLive';
import {usesRootsNativePresentation} from './rootsPresentationAuthoring';
import {rootsFormulaViewport} from './rootsFormulaPresentation';
import type {SourceCameraViewport} from './sourceCamera';
import {validSourcePerlinLiveOutput} from './sourcePerlinResponse';
import {SourceGeometryRecordingLease} from './sourceGeometryRecordingLease';
import {validSourceSurfaceOutput} from './sourceSurfaceResponse';
import {sourceGeometryCapturePlan,type SourceGeometryPausedCaptureResult} from './sourceGeometryCapture';
import type {GeometryPausedCaptureOperation} from './generationProtocol';
import {sameSourceRecordingValue} from './sourceRecordingValue';
import {implicitCameraFrame} from './sourceImplicitResponse';
import {validateSourceDomainFrameRate} from './sourceDomainClockInput';
import type {SourceDomainNavigationEvent} from './sourceDomainLiveSession';
import type {FractalFreshRecordingPlan} from './sourceFractalRecording';
import {assertFractalRecordingFrame} from './sourceFractalRecording';
import {validSourceQueueRecordingClock,type SourceQueueRecordingClock,type SourceRecordingClock} from './sourceRecordingClock';
import {sourceRecordingSize} from './sourceRecordingSize';
import {prepareSourcePausedCaptureSize} from './sourcePausedCaptureSize';
import {MAX_RASTER_PIXELS} from './rasterDimensions';
import {sourceProfileForFormula} from './fractalSourcePrecision';
import {snapshotGenerationInput} from './generationInput';
import type {SourceViewportNavigationEvent} from './sourceViewportNavigation';
import type {PerlinFreshRecordingPlan} from './sourcePerlinRecording';
import type { SceneDocument, SceneOutput, GenerationInput, GenerationStatus } from "../types";
import type { StableSearchOptions, StableSearchProgress, StableSearchResult } from './stableSearch';
import type { GenerationRequest, GenerationResponse, RootsPausedCaptureResult, RootsPausedCaptureSize, PerlinPausedCaptureResult, PerlinPausedCaptureSize, PausedCaptureOperation, PausedCaptureResult, PausedCaptureSize, SourceRecordingOptions, SourceRecordingHandle, SourceRecordingStart, SourceRecordingStop, SourceRecordingRaster } from './generationProtocol';
import {pausedCaptureContracts,isPausedCaptureOperation,SourceRecordingOperationError,isSourceRecordingOperation,FractalLiveGenerationError} from './generationProtocol';
import type { ComplexExploreOptions, ComplexExploreProgress, ComplexExploreResult } from './complexExplore';
import type {SpirographRecordingPlan} from './spirographFramePlan';
import type {RootsFreshRecordingPlan} from './rootsRecording';
import {validateFrameFormulas} from './formulaConfig';
import {usesSourceFractal} from './sourceFractalDocument';
import {usesSourceSurfaceGeometry} from './sourceSurfaceIdentity';
import {usesSourceImplicitPresentation} from './sourceImplicitPresentation';
type FormulaOutputContract =
 |{kind:'optional'}
 |{kind:'raster'}
 |{kind:'source-raster';layout:'source-surface-centered-v1';viewport:SourceCameraViewport}
 |{kind:'source-geometry';layout:'source-surface-centered-v1'|undefined};
function generationFormulaContract(scene:SceneDocument,context:GenerationInput):FormulaOutputContract {
 if(usesRootsNativePresentation(scene)&&scene.formulas?.layout==='source-surface-centered-v1')return{kind:'source-raster',layout:scene.formulas.layout,viewport:rootsFormulaViewport(context.rootsViewport??{logicalWidth:context.width,logicalHeight:context.height,referenceLogicalHeight:context.height,target:'primary'})};
 if(usesSourceSurfaceGeometry(scene)||usesSourceImplicitPresentation(scene))return{kind:'source-geometry',layout:scene.formulas?.layout};
 return{kind:usesSourceFractal(scene)?'raster':'optional'};
}
function validOutputFormulas(output:SceneOutput,contract:FormulaOutputContract):boolean {
 try{
  if(!output||(contract.kind==='raster'||contract.kind==='source-raster')&&output.type!=='raster'||contract.kind==='source-geometry'&&output.type!=='geometry')return false;
  if(output.formulaPresentation===undefined)return contract.kind==='optional';
  output.formulaPresentation=validateFrameFormulas(output.formulaPresentation,contract.kind==='source-raster'?contract.viewport:output.sourceCameraFrame?.viewport);
  return contract.kind!=='source-geometry'&&contract.kind!=='source-raster'||output.formulaPresentation.layout===contract.layout;
 }catch{return false;}
}
type RasterRecordingResponse=
 |(Omit<Extract<GenerationResponse,{operation:'source-recording-begin'}>,'result'>&{result:Omit<SourceRecordingStart,'handle'>})
 |(Omit<Extract<GenerationResponse,{operation:'source-recording-frame'}>,'output'>&{output:SourceRecordingRaster})
 |(Omit<Extract<GenerationResponse,{operation:'source-recording-finish'}>,'result'>&{result:SourceRecordingStop&{preview:SourceRecordingRaster}});
/** Wire recording now permits geometry; existing pixel consumers must narrow
 * before validating their family-specific metadata or granting a capability. */
function rasterRecordingResponse(value:GenerationResponse):value is RasterRecordingResponse {
 if('error' in value)return false;
 return value.operation==='source-recording-begin'?value.result?.warmup?.type==='raster':value.operation==='source-recording-frame'?value.output?.type==='raster':value.operation==='source-recording-finish'&&value.result?.preview?.type==='raster';
}
function recordingRaster(value:unknown,family:string):value is SourceRecordingRaster {
  const v=value as SourceRecordingRaster|undefined;return !!v&&v.type==='raster'&&Number.isSafeInteger(v.width)&&v.width>0&&Number.isSafeInteger(v.height)&&v.height>0&&v.pixels instanceof Uint8ClampedArray&&v.pixels.byteLength===v.width*v.height*4&&(family==='roots'?!!v.rootsLive&&!!v.rootsPresentation:family==='domain'?!!v.domainLive&&!!v.domainRender:family==='fractal'?!!v.fractalLive&&!!v.fractalRender:family==='perlin'?!!v.sourcePerlinFrame:family==='map'?!!v.mapLive:family==='symmetry'&&!!v.symmetryLive);
}
/** Runtime frame can change on a playback acknowledgement before any new image
 * is displayed. Keep it separate from the caller's completed-image capability. */
type Completed={id:number;scene:SceneDocument;context:GenerationInput;output:SceneOutput;surfaceFrame?:import('./ordinarySourceCameraTimeline').OrdinarySourceCameraFrame};
const surfaceFrame=(source:Completed)=>source.surfaceFrame??(source.output.type==='geometry'?source.output.surfaceLive?.frame:undefined);
type LiveRasterRequest={sessionId:string;revision:number;paused:boolean;actualFrameRate:number};
function validFractalOutput(output:SceneOutput,request:LiveRasterRequest,target:'primary'|'offscreen'='primary',renderKind:'update'|'snapshot'='update',clock:'realtime-source-queue'|'fixed-source-queue'='realtime-source-queue'):boolean {
  if(!output||output.type!=='raster'||!Number.isSafeInteger(output.width)||output.width<1||!Number.isSafeInteger(output.height)||output.height<1||!(output.pixels instanceof Uint8ClampedArray)||output.pixels.byteLength!==output.width*output.height*4||!output.fractalRender||!validOutputFormulas(output,{kind:'raster'}))return false;
  const live=output.fractalLive,frame=live?.presentation?.evaluatedFractalScene?.scene;
  return !!live&&live.sessionId===request.sessionId&&live.revision===request.revision&&live.target===target&&live.renderKind===renderKind&&live.paused===request.paused&&live.actualFrameRate===Math.fround(request.actualFrameRate)&&live.clock===clock&&(clock==='fixed-source-queue'?live.clockSource==='fixed-step':['worker-wall-clock','injected'].includes(live.clockSource))&&Number.isSafeInteger(live.updateOrdinal)&&live.updateOrdinal>=0&&Number.isSafeInteger(live.objectUpdates)&&live.objectUpdates>=0&&[live.sceneTime,live.rawDt,live.activeDt].every(Number.isFinite)&&Number.isSafeInteger(live.queueIndex)&&live.queueIndex>=0&&typeof live.queueComplete==='boolean'&&!!frame&&frame.sceneTime===live.sceneTime&&frame.queueIndex===live.queueIndex&&frame.queueComplete===live.queueComplete;
}
function validDomainOutput(output:SceneOutput,request:LiveRasterRequest,input:GenerationInput,target:'primary'|'offscreen'='primary',recording=false):boolean {
 if(!output||output.type!=='raster'||!Number.isSafeInteger(output.width)||output.width<1||!Number.isSafeInteger(output.height)||output.height<1||!(output.pixels instanceof Uint8ClampedArray)||output.pixels.byteLength!==output.width*output.height*4||!output.domainRender||!validOutputFormulas(output,{kind:'raster'}))return false;
 const live=output.domainLive,frame=live?.presentation?.evaluatedDomainScene,clock=frame?.clock,render=output.domainRender.sourceClock;
 if(!live||!clock||!render||target==='primary'&&JSON.stringify(live.viewport)!==JSON.stringify(input.domainLive?.viewport)||output.width>input.width||output.height>input.height||output.width*output.height>MAX_RASTER_PIXELS||input.quality==='export'&&(output.width!==input.width||output.height!==input.height))return false;
 // Paused repaint reports the last consumed parameter FPS, not an observation
 // which never reached the numerical owner. Fixed reconstruction is likewise a snapshot.
 return live.sessionId===request.sessionId&&live.revision===request.revision&&live.paused===request.paused&&Number.isFinite(live.actualFrameRate)&&Math.fround(live.actualFrameRate)===live.actualFrameRate&&live.actualFrameRate===frame.parameterFps&&(live.renderKind==='update'?live.actualFrameRate===Math.fround(request.actualFrameRate):live.renderKind==='snapshot'&&live.rawDt===0&&live.activeDt===0)&&live.target===target&&(recording?live.clockSource==='fixed-step':live.recording===undefined&&['worker-wall-clock','injected'].includes(live.clockSource))&&Number.isSafeInteger(live.updateOrdinal)&&live.updateOrdinal>=0&&[live.sceneTime,live.rawDt,live.activeDt].every(Number.isFinite)&&Number.isSafeInteger(live.queueIndex)&&live.queueIndex>=0&&typeof live.queueComplete==='boolean'&&clock.sceneTime===live.sceneTime&&clock.queueIndex===live.queueIndex&&clock.queueComplete===live.queueComplete&&frame.displayFrame===live.updateOrdinal&&render.displayFrame===live.updateOrdinal&&render.parameterFps===live.actualFrameRate&&render.sceneTime===live.sceneTime&&render.queueIndex===live.queueIndex&&render.queueComplete===live.queueComplete;
}
interface RetainedRecordingLease {
 options:SourceRecordingOptions;size:{width:number;height:number};primary:GenerationInput;
 clock?:SourceQueueRecordingClock;nextDisplayFrame:number;
}
interface DomainRecordingLease extends RetainedRecordingLease {
 sceneId:string;size:ReturnType<typeof sourceRecordingSize>;
 last?:NonNullable<SourceRecordingRaster['domainLive']>;
 /** An owner-confirmed failed request may have consumed this update. Only
  * the same observation can be retried; stop may report either side of it. */
 attempt?:{displayFrame:number;actualFrameRate:number};
 formulas:SourceRecordingRaster['formulaPresentation'];
}
function validDomainRecordingContext(input:GenerationInput,lease:DomainRecordingLease):boolean {
 const live=input?.domainLive,old=lease.primary.domainLive;
 return !!live&&!!old&&live.sessionId===old.sessionId&&live.revision===old.revision&&live.startAt===old.startAt&&live.clock?.paused===false&&live.configuration===undefined&&input.width===lease.primary.width&&input.height===lease.primary.height&&input.quality===lease.primary.quality&&JSON.stringify(input.domainTarget)===JSON.stringify(lease.primary.domainTarget)&&JSON.stringify(live.viewport)===JSON.stringify(old.viewport);
}
function validDomainRecordingOutput(output:SceneOutput,lease:DomainRecordingLease,clock:SourceRecordingClock,ordinal:number,actualFrameRate:number):boolean {
 const live=lease.primary.domainLive,size=lease.size;
 if(!live||!validSourceQueueRecordingClock(clock,lease.options.simulationFps)||!validDomainOutput(output,{...live,paused:false,actualFrameRate},{...lease.primary,quality:'export',width:size.width,height:size.height},'offscreen',true)||output.type!=='raster')return false;
 const facts=output.domainLive!,position=facts.recording,frame=facts.presentation.evaluatedDomainScene!,render=output.domainRender!,target=render.target;
 return Object.is(facts.actualFrameRate,Math.fround(actualFrameRate))&&facts.renderKind==='update'&&facts.updateOrdinal===ordinal&&facts.queueComplete===(ordinal===clock.lastDisplayFrame)&&position?.ordinal===ordinal&&position.simulationFps===clock.simulationFps&&position.warmup===(ordinal===0)&&position.complete===facts.queueComplete&&frame.simulationFps===clock.simulationFps&&render.sourceClock?.simulationFps===clock.simulationFps&&facts.rawDt===Math.fround(1/Math.fround(clock.simulationFps))&&facts.rawDt===frame.clock.rawDt&&facts.activeDt===frame.clock.activeDt&&render.sourceClock.rawDt===frame.clock.rawDt&&render.sourceClock.activeDt===frame.clock.activeDt&&!!target&&target.width===size.width&&target.height===size.height&&target.logicalWidth===size.logicalWidth&&target.logicalHeight===size.logicalHeight&&target.density===size.density&&JSON.stringify(output.formulaPresentation)===JSON.stringify(lease.formulas);
}
function validDomainRecordingStop(stop:SourceRecordingStop,lease:DomainRecordingLease):boolean {
 if(stop?.preview?.type!=='raster'||stop?.scene?.id!==lease.sceneId||!validDomainRecordingContext(stop.context,lease)||!validDomainOutput(stop.preview,{...stop.context.domainLive!,paused:false},stop.context))return false;
 const out=stop.preview,live=out.domainLive!,last=lease.last,ordinal=live.updateOrdinal;
 const expectedTarget=lease.primary.domainTarget,target=out.domainRender?.target;
 if(expectedTarget&&(!target||target.logicalWidth!==expectedTarget.logicalWidth||target.logicalHeight!==expectedTarget.logicalHeight||target.density!==expectedTarget.pixelDensity||target.width!==lease.primary.width||target.height!==lease.primary.height))return false;
 if(live.renderKind!=='snapshot'||live.sceneTime!==stop.context.time||JSON.stringify(out.formulaPresentation)!==JSON.stringify(lease.formulas))return false;
 // A lost warmup grants only stop, whose numerical ordinal must still be zero.
 const confirmed=last?.updateOrdinal??0,possible=lease.attempt?.displayFrame??confirmed;
 if(ordinal!==confirmed&&ordinal!==possible)return false;
 const fps=ordinal===confirmed?(last?.actualFrameRate??lease.options.actualFrameRate!):lease.attempt!.actualFrameRate;
 if(!Object.is(live.actualFrameRate,Math.fround(fps))||!Object.is(Math.fround(stop.context.domainLive!.actualFrameRate),live.actualFrameRate))return false;
 if(last&&ordinal===confirmed){
  const {simulationFps:_,...before}=last.presentation.evaluatedDomainScene!;
  const {simulationFps:__,...after}=live.presentation.evaluatedDomainScene!;
  if(JSON.stringify(before)!==JSON.stringify(after))return false;
 }
 return true;
}
function validFractalRecordingOutput(output:SceneOutput,lease:RetainedRecordingLease,clock:SourceRecordingClock,displayFrame:number):boolean {
 try{
  if(!validSourceQueueRecordingClock(clock,lease.options.simulationFps))return false;
  assertFractalRecordingFrame(output,clock,displayFrame);
  const live=lease.primary.fractalLive;
  if(!live||clock.simulationFps!==lease.options.simulationFps||!validFractalOutput(output,{sessionId:live.sessionId,revision:live.revision,paused:false,actualFrameRate:clock.simulationFps},'offscreen','update','fixed-source-queue')||output.type!=='raster')return false;
  const facts=output.fractalRecording!,actual=output.fractalLive!;
  return output.width===lease.size.width&&output.height===lease.size.height&&facts.sceneTime===actual.sceneTime&&facts.queueIndex===actual.queueIndex&&facts.complete===actual.queueComplete&&actual.updateOrdinal===displayFrame;
 }catch{return false;}
}
function validFractalRecordingStop(stop:SourceRecordingStop,lease:RetainedRecordingLease):boolean {
 const live=stop?.context?.fractalLive,old=lease.primary.fractalLive,output=stop?.preview;
 if(!live||!old||!output||output.type!=='raster'||live.sessionId!==old.sessionId||live.revision!==old.revision||live.clock?.paused!==false||stop.context.quality!==lease.primary.quality||stop.context.fractalViewport?.target!=='primary'||stop.context.fractalViewport.logicalWidth!==lease.primary.fractalViewport?.logicalWidth||stop.context.fractalViewport.logicalHeight!==lease.primary.fractalViewport?.logicalHeight||stop.context.width!==lease.primary.width||stop.context.height!==lease.primary.height||!validFractalOutput(output,{...live,paused:false},'primary','snapshot'))return false;
 const render=output.fractalRender;
 // Preview sampling may shrink this raster, including when the recording
 // anchor has a different iteration budget from the previous live document.
 // The renderer owns that decision and reports requested and actual sizes.
 return render!==undefined&&render.profile===sourceProfileForFormula(render.formula)&&render.execution?.backend==='webgl2'&&render.requestedSize?.[0]===lease.primary.width&&render.requestedSize?.[1]===lease.primary.height&&render.rasterSize?.[0]===output.width&&render.rasterSize?.[1]===output.height&&(lease.primary.quality!=='export'||output.width===lease.primary.width&&output.height===lease.primary.height)&&output.fractalRecording===undefined&&output.fractalLive!.sceneTime===stop.context.time&&output.fractalLive!.rawDt===0&&output.fractalLive!.activeDt===0&&output.fractalLive!.objectUpdates===0;
}
type SourceCaptureSize=ReturnType<typeof prepareSourcePausedCaptureSize>;
function validCurrentImage(capture:PausedCaptureResult['capture'],size:PausedCaptureSize,scale:1|3|5,base:SourceCaptureSize):boolean {
 const f=capture.sourceCurrentImage,match=(v:unknown,w:number,h:number)=>Array.isArray(v)&&v.length===2&&v[0]===w&&v[1]===h;
 return capture.width===base.width&&capture.height===base.height&&f?.model==='local-current-numerical-snapshot'&&f.stage==='base-before-formulas'&&match(f.requestedSize,size.width,size.height)&&match(f.logicalSize,base.logicalWidth,base.logicalHeight)&&f.pixelDensity===base.density&&match(f.baseSize,base.width,base.height)&&f.scale===scale&&!('resampling' in f);
}
function validDomainCapture(result:PausedCaptureResult,source:Completed,size:PausedCaptureSize,scale:1|3|5,base:SourceCaptureSize):boolean {
 const original=source.output;if(original.type!=='raster'||!original.domainLive||!result?.capture||!result.preview)return false;
 const before=original.domainLive;
 for(const [output,target,input] of [[result.capture,'offscreen',{...source.context,quality:'export',width:base.width,height:base.height}],[result.preview,'primary',source.context]] as const){
  if(!validDomainOutput(output,{...before,paused:true},input,target))return false;
  const live=output.domainLive!;
  if(live.renderKind!=='snapshot'||live.updateOrdinal!==before.updateOrdinal||live.sceneTime!==before.sceneTime||live.queueIndex!==before.queueIndex||live.queueComplete!==before.queueComplete||live.actualFrameRate!==before.actualFrameRate||JSON.stringify(output.formulaPresentation)!==JSON.stringify(original.formulaPresentation))return false;
 }
 // A successful explicit hot edit can change current numerical settings without
 // drawing. Compare both new renders to each other, not the previous image.
 const capture=result.capture,preview=result.preview,t=capture.domainRender?.target;
 return JSON.stringify(capture.domainLive!.presentation)===JSON.stringify(preview.domainLive!.presentation)&&!!t&&t.width===base.width&&t.height===base.height&&t.logicalWidth===base.logicalWidth&&t.logicalHeight===base.logicalHeight&&t.density===base.density&&validCurrentImage(capture,size,scale,base);
}
function validFractalCapture(result:PausedCaptureResult,source:SceneOutput,size:PausedCaptureSize,scale:1|3|5,base:SourceCaptureSize):boolean {
 if(source.type!=='raster'||!source.fractalLive||!result?.capture||!result.preview)return false;
 const before=source.fractalLive,expected={...before,paused:true};
 for(const [output,target] of [[result.capture,'offscreen'],[result.preview,'primary']] as const){
  if(!validFractalOutput(output,expected,target,'snapshot'))return false;
  const live=output.fractalLive!;
  if(live.updateOrdinal!==before.updateOrdinal||live.sceneTime!==before.sceneTime||live.queueIndex!==before.queueIndex||live.queueComplete!==before.queueComplete||live.rawDt!==0||live.activeDt!==0||live.objectUpdates!==0||JSON.stringify(live.presentation.evaluatedFractalScene)!==JSON.stringify(before.presentation.evaluatedFractalScene)||JSON.stringify(live.presentation.evaluatedFractalGradient)!==JSON.stringify(before.presentation.evaluatedFractalGradient))return false;
 }
 const {capture,preview}=result;
 const matchesSize=(value:unknown,width:number,height:number)=>Array.isArray(value)&&value.length===2&&value[0]===width&&value[1]===height;
 return preview.width===source.width&&preview.height===source.height&&validCurrentImage(capture,size,scale,base)&&matchesSize(capture.fractalRender?.logicalSize,base.logicalWidth,base.logicalHeight)&&matchesSize(capture.fractalRender?.requestedSize,base.width,base.height)&&matchesSize(capture.fractalRender?.rasterSize,base.width,base.height);
}
function validGeometryCapture(result:import('./sourceGeometryCapture').SourceGeometryCapturePreparation,source:Completed,target:GenerationInput,operation:GeometryPausedCaptureOperation):boolean {
 if(!result?.scene||result.scene.id!==source.scene.id)return false;
 if(operation==='implicit-paused-capture'){
  if(!sameSourceRecordingValue(result.scene,source.scene))return false;
  const {viewport:beforeViewport,...before}=implicitCameraFrame(source.output);void beforeViewport;
  for(const [output,input] of [[result.capture,target],[result.preview,source.context]] as const){
   if(!validSourceImplicitOutput(output,input)||output.implicitLive?.renderKind!=='snapshot'||!output.implicitLive.paused)return false;
   const {viewport,...frame}=implicitCameraFrame(output);void viewport;
   if(!sameSourceRecordingValue(frame,before))return false;
  }
 }else{
  const frame=surfaceFrame(source);
  if(result.scene.kind!=='surface'||!validSourceSurfaceOutput(result.capture,target)||!validSourceSurfaceOutput(result.preview,source.context)||result.capture.surfaceLive?.renderKind!=='snapshot'||result.preview.surfaceLive?.renderKind!=='snapshot'||!sameSourceRecordingValue(result.capture.surfaceLive.frame,frame)||!sameSourceRecordingValue(result.preview.surfaceLive.frame,frame))return false;
 }
 return sameSourceRecordingValue(result.capture.formulaPresentation,source.output.formulaPresentation)&&sameSourceRecordingValue(result.preview.formulaPresentation,source.output.formulaPresentation);
}
type Pending =
  | {[O in GeometryPausedCaptureOperation]:{operation:O;source:Completed;size:PausedCaptureSize;scale:1|3|5;controller:AbortController;rendering?:boolean;resolve:(result:SourceGeometryPausedCaptureResult)=>void;reject:(error:Error)=>void}}[GeometryPausedCaptureOperation]
  | {operation:'surface-parameter';source:Completed;resolve:()=>void;reject:(error:Error)=>void}
  | {operation:'surface-current';source:Completed;resolve:(output:SceneOutput)=>void;reject:(error:Error)=>void}
  | {operation:'domain-navigation';source:Completed;resolve:(output:SceneOutput)=>void;reject:(error:Error)=>void}
  | {operation:'domain-parameters';source:Completed;scene:SceneDocument;resolve:()=>void;reject:(error:Error)=>void}
  | {operation:'surface-navigation';source:Completed;resolve:(output:SceneOutput)=>void;reject:(error:Error)=>void}
  | {operation:'iterated-navigation';source:Completed;resolve:(output:SceneOutput)=>void;reject:(error:Error)=>void}
  | {operation:'iterated-parameters';source:Completed;scene:SceneDocument;resolve:()=>void;reject:(error:Error)=>void}
  | {operation:'samila-playback'|'symmetry-playback'|'map-playback'|'fractal-playback'|'domain-playback'|'implicit-playback'|'surface-playback'|'perlin-playback'|'roots-playback';source:Completed;paused:boolean;resolve:()=>void;reject:(error:Error)=>void}
  | {operation:'source-recording-begin';source:Completed;handle:SourceRecordingHandle;resolve:(value:SourceRecordingStart)=>void;reject:(error:Error)=>void}
  | {operation:'source-recording-frame';handle:SourceRecordingHandle;family:string;displayFrame:number;actualFrameRate?:number;resolve:(value:SourceRecordingRaster)=>void;reject:(error:Error)=>void}
  | {operation:'source-recording-finish';handle:SourceRecordingHandle;family:string;resolve:(value:SourceRecordingStop)=>void;reject:(error:Error)=>void}
  | { operation: 'generate'; scene:SceneDocument; context:GenerationInput; fractal?:LiveRasterRequest;domain?:LiveRasterRequest; source?:Completed; resolve: (output: SceneOutput) => void; reject: (error: Error) => void; onProgress?: (output: SceneOutput) => void; onStatus?: (status: GenerationStatus) => void }
  | { operation:PausedCaptureOperation; source:Completed; size:PausedCaptureSize;scale:1|3|5;captureSize?:SourceCaptureSize; resolve:(output:PausedCaptureResult)=>void; reject:(error:Error)=>void }
  | { operation:'fractal-recording-plan'; resolve:(output:FractalFreshRecordingPlan)=>void; reject:(error:Error)=>void }
  | { operation:'perlin-recording-plan'; resolve:(output:PerlinFreshRecordingPlan)=>void; reject:(error:Error)=>void }
  | { operation:'roots-recording-plan'; resolve:(output:RootsFreshRecordingPlan)=>void; reject:(error:Error)=>void }
  | { operation:'spirograph-recording-plan'; resolve:(output:SpirographRecordingPlan)=>void; reject:(error:Error)=>void }
  | { operation: 'search-stable'; resolve: (output: StableSearchResult) => void; reject: (error: Error) => void; onProgress?: (progress: StableSearchProgress) => void }
  | { operation: 'explore-complex'; resolve: (output: ComplexExploreResult) => void; reject: (error: Error) => void; onProgress?: (progress: ComplexExploreProgress) => void };
export class Generator {
  private worker: Worker | null = null;
  private counter = 0;
  private sessionId = 0;
  private pending = new Map<number, Pending>();
  private currentInputId=0;
  private completed?:Completed;
  private recording?:{handle:SourceRecordingHandle;family:string;usable:boolean;roots?:SourceRootsRecordingLease;fractal?:RetainedRecordingLease;domain?:DomainRecordingLease;geometry?:SourceGeometryRecordingLease;perlin?:{sceneId:string;primary:GenerationInput;size:SourceCaptureSize}};
  private playbackPending(){return [...this.pending.values()].some(p=>p.operation==='surface-navigation'||(p.operation==='surface-paused-capture'||p.operation==='implicit-paused-capture')||p.operation==='surface-parameter'||p.operation==='surface-current'||p.operation==='implicit-playback'||p.operation==='surface-playback'||p.operation==='domain-navigation'||p.operation==='domain-parameters'||p.operation==='iterated-navigation'||p.operation==='iterated-parameters'||p.operation==='samila-playback'||p.operation==='symmetry-playback'||p.operation==='map-playback'||p.operation==='fractal-playback'||p.operation==='roots-playback'||p.operation==='perlin-playback'||p.operation==='domain-playback');}
  private recordingError(message:string){const retained=!!this.recording?.usable;return new SourceRecordingOperationError(message,false,retained,retained?this.recording!.handle:undefined);}
  private invalidate(error:Error){
    try{this.recording?.geometry?.releaseRenderer();}catch(cleanup){error=new AggregateError([error,cleanup],'曲面录制已失效，绘图清理仍待重试');}
    this.worker?.terminate();this.worker=null;this.recording=undefined;this.completed=undefined;this.currentInputId=0;
    for(const p of this.pending.values()){if(p.operation==='surface-paused-capture'||p.operation==='implicit-paused-capture')p.controller.abort();p.reject(error);}this.pending.clear();
  }
  hasSourceRecording(handle:SourceRecordingHandle):boolean{return !!this.worker&&this.recording?.handle===handle&&this.recording.usable;}

  private renderGeometryFrame(id:number,p:Extract<Pending,{operation:'source-recording-begin'|'source-recording-frame'}>,lease:SourceGeometryRecordingLease,worker:Worker,start?:import('./generationProtocol').SourceRecordingWireStart){
    const cancelled=()=>this.worker!==worker||this.pending.get(id)!==p||this.recording?.geometry!==lease;
    void import('./renderGeometryRecording').then(({GeometryRecordingRenderer})=>{if(cancelled())return;return lease.render(GeometryRecordingRenderer,cancelled,{generation:this.sessionId,sequence:id});}).then(output=>{
      if(!output||cancelled())return;this.pending.delete(id);
      if(p.operation==='source-recording-begin'&&start)p.resolve({...start,warmup:output,handle:p.handle});
      else if(p.operation==='source-recording-frame')p.resolve(output);
    }).catch(error=>{if(cancelled())return;this.pending.delete(id);p.reject(new SourceRecordingOperationError(error instanceof Error?error.message:String(error),false,true,p.handle));});
  }

  private ensure() {
    if (this.worker) return;
    this.sessionId++;
    this.worker = new Worker(new URL("./generate.worker.ts", import.meta.url), {
      type: "module",
    });
    const worker = this.worker;
    this.worker.onmessage = ({ data }: MessageEvent<GenerationResponse>) => {
      if (data.sessionId !== this.sessionId) return;
      const p = this.pending.get(data.id);
      if (!p) return;
      if(p.operation==='surface-navigation'){
        if(data.operation!=='surface-navigation'||'error' in data||data.sourceId!==p.source.id||data.id!==this.currentInputId){this.invalidate(new Error('error' in data?data.error:'曲面视口响应身份不匹配'));return;}
        const output=data.output,before=p.source.output,previous=surfaceFrame(p.source);
        if(!validSourceSurfaceOutput(output,p.source.context)||output.type!=='geometry'||before.type!=='geometry'||!previous||!output.surfaceLive?.paused||output.surfaceLive.renderKind!=='update'||output.surfaceLive.constructions!==before.surfaceLive?.constructions||JSON.stringify(output.surfaceLive.frame)!==JSON.stringify({...previous,camera:output.surfaceLive.frame.camera,frameIndex:previous.frameIndex+1,rawDt:0,activeDt:0})){this.invalidate(new Error('曲面视口响应状态不匹配'));return;}
        this.pending.delete(data.id);this.completed={...p.source,id:data.id,output,surfaceFrame:output.type==='geometry'?output.surfaceLive?.frame:undefined};p.resolve(output);return;
      }
      if(p.operation==='surface-paused-capture'||p.operation==='implicit-paused-capture'){
        const contract=pausedCaptureContracts[p.operation];
        if(p.rendering){this.invalidate(new Error('曲面截图重复交付准备结果'));return;}
        if(data.operation!==p.operation||data.id!==this.currentInputId){this.invalidate(new Error('曲面截图响应身份不匹配'));return;}
        if('error' in data){
          const retained=data.retainedSourceId===p.source.id;
          if(!retained){this.invalidate(new contract.Error(data.error,false));return;}
          this.pending.delete(data.id);this.completed=p.source;p.reject(new contract.Error(data.error,true));return;
        }
        const result=data.result;
        try{
          const plan=sourceGeometryCapturePlan(p.source.context,p.size,p.scale);
          if(data.sourceId!==p.source.id||!validGeometryCapture(result,p.source,plan.captureContext,p.operation))throw Error('几何截图响应状态不匹配');
        }catch(error){this.invalidate(error instanceof Error?error:new Error(String(error)));return;}
        // Keep the operation pending across module loading and readback. A
        // cancelled transport cannot publish the subsequently encoded image.
        const cancelled=()=>this.pending.get(data.id)!==p||this.worker!==worker;
        p.rendering=true;
        void import('./renderGeometryCapture').then(({renderGeometryCapture})=>renderGeometryCapture(result,p.source.context,p.size,p.scale,cancelled,{signal:p.controller.signal,generation:this.sessionId,sequence:data.id})).then(value=>{
          if(cancelled())return;const plan=sourceGeometryCapturePlan(p.source.context,p.size,p.scale);if(!validCurrentImage(value.capture,p.size,p.scale,plan.base)||!validOutputFormulas(value.capture,{kind:'raster'}))throw Error('曲面截图基础图像或公式无效');this.pending.delete(data.id);this.completed={...p.source,output:value.preview,surfaceFrame:value.preview.surfaceLive?.frame};p.resolve(value);
        }).catch(error=>{if(cancelled())return;this.pending.delete(data.id);this.completed=p.source;p.reject(new contract.Error(error instanceof Error?error.message:String(error),true));});
        return;
      }
      if(p.operation==='surface-parameter'){
        if(data.operation!=='surface-parameter'||'error' in data||data.sourceId!==p.source.id||data.id!==this.currentInputId){this.invalidate(new Error('error' in data?data.error:'曲面参数响应身份不匹配'));return;}
        this.pending.delete(data.id);this.completed=p.source;p.resolve();return;
      }
      if(p.operation==='surface-current'){
        if(data.operation!=='surface-current'||'error' in data||data.sourceId!==p.source.id||data.id!==this.currentInputId){this.invalidate(new Error('error' in data?data.error:'曲面当前帧响应身份不匹配'));return;}
        const output=data.output,before=p.source.output,previous=surfaceFrame(p.source);
        if(!validSourceSurfaceOutput(output,p.source.context)||output.type!=='geometry'||before.type!=='geometry'||output.surfaceLive?.renderKind!=='snapshot'||JSON.stringify(output.surfaceLive.frame)!==JSON.stringify(previous)){this.invalidate(new Error('曲面当前帧响应状态不匹配'));return;}
        this.pending.delete(data.id);this.completed={...p.source,id:data.id,output,surfaceFrame:output.type==='geometry'?output.surfaceLive?.frame:undefined};p.resolve(output);return;
      }
      if(p.operation==='domain-navigation'){
        if(data.operation!=='domain-navigation'||'error' in data||data.sourceId!==p.source.id||data.id!==this.currentInputId){this.invalidate(new Error('error' in data?data.error:'域着色视口响应身份不匹配'));return;}
        const before=p.source.output,output=data.output,live=p.source.context.domainLive;
        if(!live||before.type!=='raster'||!before.domainLive||!validDomainOutput(output,{...live,paused:true},p.source.context)||output.type!=='raster'||output.domainLive!.renderKind!=='snapshot'||output.domainLive!.updateOrdinal!==before.domainLive.updateOrdinal||output.domainLive!.sceneTime!==before.domainLive.sceneTime||output.domainLive!.queueIndex!==before.domainLive.queueIndex||output.domainLive!.queueComplete!==before.domainLive.queueComplete||output.domainLive!.actualFrameRate!==before.domainLive.actualFrameRate||JSON.stringify(output.formulaPresentation)!==JSON.stringify(before.formulaPresentation)){this.invalidate(new Error('域着色视口响应状态不匹配'));return;}
        this.pending.delete(data.id);this.completed={...p.source,id:data.id,output};p.resolve(output);return;
      }
      if(p.operation==='domain-parameters'){
        if(data.operation!=='domain-parameters'||'error' in data||data.sourceId!==p.source.id||data.id!==this.currentInputId){this.invalidate(new Error('error' in data?data.error:'域着色参数响应身份不匹配'));return;}
        this.pending.delete(data.id);this.completed={...p.source,scene:p.scene};p.resolve();return;
      }
      if(p.operation==='iterated-navigation'){
        if(data.operation!=='iterated-navigation'||'error' in data||data.sourceId!==p.source.id||data.id!==this.currentInputId){this.invalidate(new Error('error' in data?data.error:'迭代视口响应身份不匹配'));return;}
        const output=data.output,before=p.source.output,key=p.source.scene.kind==='map'?'mapLive':'symmetryLive';
        if(!recordingRaster(output,p.source.scene.kind)||before.type!=='raster'||!output[key]?.paused||output[key]?.sessionId!==before[key]?.sessionId||output[key]?.sceneTime!==before[key]?.sceneTime||output.sourceCameraFrame?.viewport.target!=='primary'||output.width!==before.width||output.height!==before.height){this.invalidate(new Error('迭代视口响应帧无效'));return;}
        this.pending.delete(data.id);this.completed={...p.source,id:data.id,output};p.resolve(output);return;
      }
      if(p.operation==='iterated-parameters'){
        if(data.operation!=='iterated-parameters'||'error' in data||data.sourceId!==p.source.id||data.id!==this.currentInputId){this.invalidate(new Error('error' in data?data.error:'迭代参数响应身份不匹配'));return;}
        this.pending.delete(data.id);this.completed={...p.source,scene:p.scene};p.resolve();return;
      }
      if(p.operation==='samila-playback' ||p.operation==='symmetry-playback'||p.operation==='map-playback'||p.operation==='fractal-playback'||p.operation==='roots-playback'||p.operation==='perlin-playback'||p.operation==='domain-playback'||p.operation==='implicit-playback'||p.operation==='surface-playback'){
        // A control acknowledgement changes the clock, not the completed image
        // capability. Any uncertain acknowledgement retires this worker so a
        // later draw cannot silently use an unknown paused/running state.
        if((data.operation!=='samila-playback'&&data.operation!=='symmetry-playback'&&data.operation!=='map-playback'&&data.operation!=='fractal-playback'&&data.operation!=='roots-playback'&&data.operation!=='perlin-playback'&&data.operation!=='domain-playback'&&data.operation!=='implicit-playback'&&data.operation!=='surface-playback')||data.operation!==p.operation||'error' in data||data.sourceId!==p.source.id||data.paused!==p.paused||data.id!==this.currentInputId){
          this.invalidate(new Error('error' in data?data.error:'实时场景后台播放响应身份不匹配'));return;
        }
        if(p.operation==='surface-playback'&&data.operation==='surface-playback'){
          const previous=surfaceFrame(p.source),frame=data.frame;
          const angles=frame?.camera&&{phi:frame.camera.phi,theta:frame.camera.theta,gamma:frame.camera.gamma};
          const expected=previous&&{...previous,camera:{...previous.camera,...(!p.paused?angles:{})}};
          if(!angles||!Object.values(angles).every(v=>Number.isFinite(v)&&Math.fround(v)===v)||!expected||JSON.stringify(frame)!==JSON.stringify(expected)){this.invalidate(new Error('曲面播放响应相机状态不匹配'));return;}
          this.completed={...p.source,surfaceFrame:structuredClone(frame),context:{...p.source.context,surfaceLive:{...p.source.context.surfaceLive!,clock:{...p.source.context.surfaceLive!.clock,paused:p.paused}}}};
        }else if(p.operation==='implicit-playback')this.completed={...p.source,context:{...p.source.context,implicitLive:{...p.source.context.implicitLive!,clock:{...p.source.context.implicitLive!.clock,paused:p.paused}}}};
        else if(p.operation==='roots-playback')this.completed={...p.source,context:{...p.source.context,rootsLive:{...p.source.context.rootsLive!,clock:{...p.source.context.rootsLive!.clock,paused:p.paused}}}};
        else if(p.operation==='perlin-playback')this.completed={...p.source,context:{...p.source.context,perlinLive:{...p.source.context.perlinLive!,clock:{...p.source.context.perlinLive!.clock,paused:p.paused}}}};
        else this.completed=p.source;
        this.pending.delete(data.id);p.resolve();return;
      }
      if(isSourceRecordingOperation(p.operation)&&'handle' in p){
        const family=p.operation==='source-recording-begin'?p.source.scene.kind:p.family;
        const fractal=this.recording?.fractal,domain=this.recording?.domain,perlin=this.recording?.perlin;
        const matching=data.operation===p.operation&&('error' in data||('recordingId' in data&&data.recordingId===p.handle.recordingId&&(p.operation!=='source-recording-frame'||('displayFrame' in data&&data.displayFrame===p.displayFrame))));
        if(!matching){this.invalidate(new SourceRecordingOperationError('源场景后台录制响应身份不匹配',false,false));return;}
        if(family==='roots'){
          const lease=this.recording?.roots;
          if(!lease){this.invalidate(new SourceRecordingOperationError('复根录制客户端会话缺失',false,false));return;}
          if('error' in data){
            if(data.retainedRecordingId!==undefined&&data.retainedRecordingId!==p.handle.recordingId){this.invalidate(new SourceRecordingOperationError('复根录制保留身份不匹配',false,false));return;}
            const retained=data.retainedRecordingId===p.handle.recordingId,previewRetained=p.operation==='source-recording-begin'&&data.retainedSourceId===p.source.id&&!retained;
            const error=new SourceRecordingOperationError(data.error,previewRetained,retained,retained?p.handle:undefined);
            if(!retained&&!previewRetained){this.invalidate(error);return;}
            this.pending.delete(data.id);
            if(retained)this.recording!.usable=true;else{this.recording=undefined;this.completed=p.operation==='source-recording-begin'?p.source:undefined;}
            p.reject(error);return;
          }
          try{
            if(p.operation==='source-recording-begin'&&data.operation==='source-recording-begin'){
              lease.acceptStart(data.result);if(data.result.warmup.type!=='raster')throw Error('复根录制需要像素输出');
              this.recording!.usable=true;this.pending.delete(data.id);p.resolve({...data.result,warmup:data.result.warmup,handle:p.handle});return;
            }
            if(p.operation==='source-recording-frame'&&data.operation==='source-recording-frame'){
              lease.acceptFrame(data.output,data.displayFrame);if(data.output.type!=='raster')throw Error('复根录制需要像素输出');
              this.pending.delete(data.id);p.resolve(data.output);return;
            }
            if(p.operation==='source-recording-finish'&&data.operation==='source-recording-finish'){
              lease.acceptStop(data.result);this.pending.delete(data.id);this.recording=undefined;this.currentInputId=data.id;
              this.completed={id:data.id,scene:data.result.scene,context:snapshotGenerationInput(data.result.context),output:data.result.preview};p.resolve(data.result);return;
            }
            throw Error('复根录制响应操作无效');
          }catch(error){this.invalidate(new SourceRecordingOperationError(error instanceof Error?error.message:String(error),false,false));return;}
        }
        if(family==='surface'||family==='implicit'){
          const lease=this.recording?.geometry;
          if(!lease){this.invalidate(new SourceRecordingOperationError('曲面录制客户端会话缺失',false,false));return;}
          if('error' in data){
            if(data.retainedRecordingId!==undefined&&data.retainedRecordingId!==p.handle.recordingId){this.invalidate(new SourceRecordingOperationError('曲面录制保留身份不匹配',false,false));return;}
            const retained=data.retainedRecordingId===p.handle.recordingId,previewRetained=p.operation==='source-recording-begin'&&data.retainedSourceId===p.source.id&&!retained;
            const error=new SourceRecordingOperationError(data.error,previewRetained,retained,retained?p.handle:undefined);
            if(!retained&&!previewRetained){this.invalidate(error);return;}
            this.pending.delete(data.id);
            if(retained)this.recording!.usable=true;else{this.recording=undefined;this.completed=p.operation==='source-recording-begin'?p.source:undefined;}
            p.reject(error);return;
          }
          try{
            if(p.operation==='source-recording-begin'&&data.operation==='source-recording-begin'){
              lease.acceptStart(data.result);this.recording!.usable=true;this.renderGeometryFrame(data.id,p,lease,worker,data.result);return;
            }
            if(p.operation==='source-recording-frame'&&data.operation==='source-recording-frame'){
              lease.acceptFrame(data.output,data.displayFrame);this.renderGeometryFrame(data.id,p,lease,worker);return;
            }
            if(p.operation==='source-recording-finish'&&data.operation==='source-recording-finish'){
              lease.acceptStop(data.result);this.pending.delete(data.id);this.recording=undefined;this.currentInputId=data.id;
              this.completed={id:data.id,scene:data.result.scene,context:snapshotGenerationInput(data.result.context),output:data.result.preview};p.resolve(data.result);return;
            }
            throw Error('曲面录制响应操作无效');
          }catch(error){this.invalidate(new SourceRecordingOperationError(error instanceof Error?error.message:String(error),false,false));return;}
        }
        if(!('error' in data)&&!rasterRecordingResponse(data)){this.invalidate(new SourceRecordingOperationError('当前录制客户端需要像素输出',false,false));return;}
        if(!('error' in data)){
          let valid=false;try{valid=family==='domain'?!!domain&&(data.operation==='source-recording-begin'
            ?data.result?.scene?.kind===family&&data.result.scene.id===domain.sceneId&&validDomainRecordingContext(data.result.context,domain)&&data.result.context.time===0&&Object.is(Math.fround(data.result.context.domainLive!.actualFrameRate),Math.fround(domain.options.actualFrameRate!))&&validDomainRecordingOutput(data.result.warmup,domain,data.result.clock,0,domain.options.actualFrameRate!)
            :data.operation==='source-recording-frame'?!!domain.clock&&p.operation==='source-recording-frame'&&data.displayFrame===domain.nextDisplayFrame&&validDomainRecordingOutput(data.output,domain,domain.clock,data.displayFrame,p.actualFrameRate!)
            :data.operation==='source-recording-finish'&&data.result?.scene?.kind===family&&validDomainRecordingStop(data.result,domain)):
            family==='fractal'?!!fractal&&(data.operation==='source-recording-begin'
            ?data.result?.scene?.kind===family&&data.result.context?.quality===fractal.primary.quality&&data.result.context.fractalViewport?.target==='primary'&&data.result.context.width===fractal.primary.width&&data.result.context.height===fractal.primary.height&&data.result.context.fractalLive?.sessionId===fractal.primary.fractalLive?.sessionId&&data.result.context.fractalLive?.revision===fractal.primary.fractalLive?.revision&&data.result.context.fractalLive?.clock.paused===false&&validSourceQueueRecordingClock(data.result.clock,fractal.options.simulationFps)&&validFractalRecordingOutput(data.result.warmup,fractal,data.result.clock,0)
            :data.operation==='source-recording-frame'?!!fractal.clock&&data.displayFrame===fractal.nextDisplayFrame&&validFractalRecordingOutput(data.output,fractal,fractal.clock,data.displayFrame)
            :data.operation==='source-recording-finish'&&data.result?.scene?.kind===family&&validFractalRecordingStop(data.result,fractal)):
            data.operation==='source-recording-begin'?!!data.result?.scene&&!!data.result.context&&!!data.result.clock&&data.result.scene.kind===family&&recordingRaster(data.result.warmup,family)&&(family==='perlin'?data.result.warmup.sourcePerlinFrame!.frameIndex===0:data.result.warmup.iteratedRecording?.displayFrame===0&&data.result.warmup.iteratedRecording.warmup):
              data.operation==='source-recording-frame'?recordingRaster(data.output,family)&&(family==='perlin'?data.output.sourcePerlinFrame!.frameIndex===data.displayFrame:data.output.iteratedRecording?.displayFrame===data.displayFrame&&!data.output.iteratedRecording.warmup):
              data.operation==='source-recording-finish'&&!!data.result?.scene&&!!data.result.context&&data.result.scene.kind===family&&recordingRaster(data.result.preview,family);
          }catch{/* A malformed response never grants a recording capability. */}
          if(valid&&perlin){
            if(data.operation==='source-recording-begin')valid=data.result.scene.id===perlin.sceneId&&data.result.context.perlinLive?.sessionId===perlin.primary.perlinLive?.sessionId&&validSourcePerlinLiveOutput(data.result.warmup,perlin.primary,{recording:true,paused:false,dimensions:[perlin.size.width,perlin.size.height]});
            else if(data.operation==='source-recording-frame')valid=validSourcePerlinLiveOutput(data.output,perlin.primary,{recording:true,paused:false,dimensions:[perlin.size.width,perlin.size.height]});
            else if(data.operation==='source-recording-finish')valid=data.result.scene.id===perlin.sceneId&&data.result.context.perlinLive?.sessionId===perlin.primary.perlinLive?.sessionId&&data.result.context.perlinLive?.clock.paused===false&&data.result.context.perlinLive?.startAt===undefined&&data.result.context.sourceViewport?.target==='primary'&&validSourcePerlinLiveOutput(data.result.preview,data.result.context)&&data.result.preview.perlinLive?.renderKind==='snapshot'&&data.result.context.time===data.result.preview.perlinLive.sceneTime;
          }
          if(!valid){this.invalidate(new SourceRecordingOperationError('源场景后台录制结果无效',false,false));return;}
        }
        if('error' in data&&data.retainedRecordingId!==undefined&&data.retainedRecordingId!==p.handle.recordingId){this.invalidate(new SourceRecordingOperationError('源场景后台录制保留身份不匹配',false,false));return;}
        this.pending.delete(data.id);
        if('error' in data){
          const retained=data.retainedRecordingId===p.handle.recordingId;
          const previewRetained=p.operation==='source-recording-begin'&&data.retainedSourceId===p.source.id&&!retained;
          if(retained)this.recording={handle:p.handle,family,usable:true,fractal,domain,perlin};else this.recording=undefined;
          this.completed=previewRetained&&p.operation==='source-recording-begin'?p.source:undefined;
          p.reject(new SourceRecordingOperationError(data.error,previewRetained,retained,retained?p.handle:undefined));return;
        }
        if(p.operation==='source-recording-begin'&&data.operation==='source-recording-begin'){
          if(fractal&&data.result.clock.completionReason==='animation-queue'){fractal.clock=structuredClone(data.result.clock);fractal.primary=snapshotGenerationInput(data.result.context);}
          if(domain&&data.result.clock.completionReason==='animation-queue'){domain.clock=structuredClone(data.result.clock);domain.primary=snapshotGenerationInput(data.result.context);domain.last=structuredClone(data.result.warmup.domainLive!);}
          this.recording={handle:p.handle,family,usable:true,fractal,domain,perlin};this.completed=undefined;p.resolve({...data.result,handle:p.handle});return;
        }
        if(p.operation==='source-recording-frame'&&data.operation==='source-recording-frame'){if(fractal)fractal.nextDisplayFrame=data.displayFrame+1;if(domain){domain.nextDisplayFrame=data.displayFrame+1;domain.last=structuredClone(data.output.domainLive!);domain.attempt=undefined;}p.resolve(data.output);return;}
        if(p.operation==='source-recording-finish'&&data.operation==='source-recording-finish'){
          this.recording=undefined;this.currentInputId=data.id;this.completed={id:data.id,scene:data.result.scene,context:snapshotGenerationInput(data.result.context),output:data.result.preview};p.resolve(data.result);return;
        }
        this.invalidate(new SourceRecordingOperationError('源场景后台录制响应无效',false,false));return;
      }
      if (data.operation === 'generate-status') {
        if (p.operation === 'generate') p.onStatus?.(data.status);
        return;
      }
      if (data.operation === 'generate-progress') {
        if(p.operation==='generate'&&!p.fractal&&!validOutputFormulas(data.output,generationFormulaContract(p.scene,p.context))){this.invalidate(new Error('后台进度帧的公式标注无效'));return;}
        if(p.operation==='generate'&&p.context.rootsLive&&!validRootsLiveOutput(data.output,p.context)){this.invalidate(new Error('复根实时进度响应身份或状态不匹配'));return;}
        if(p.operation==='generate'&&p.context.perlinLive&&!validSourcePerlinLiveOutput(data.output,p.context)){this.invalidate(new Error('Perlin 实时进度响应身份或状态不匹配'));return;}
        if(p.operation==='generate'&&p.context.surfaceLive&&!validSourceSurfaceOutput(data.output,p.context)){this.invalidate(new Error('曲面实时进度响应身份或状态不匹配'));return;}
        if(p.operation==='generate'&&p.domain&&!validDomainOutput(data.output,p.domain,p.context)){this.invalidate(new Error('域着色实时进度响应身份或状态不匹配'));return;}
        if(p.operation==='generate'&&p.fractal&&!validFractalOutput(data.output,p.fractal)){this.invalidate(new Error('分形实时进度响应身份或状态不匹配'));return;}
        if (p.operation === 'generate') p.onProgress?.(data.output);
        return;
      }
      if ('progress' in data) {
        if (p.operation === 'search-stable' && data.operation === 'search-stable') p.onProgress?.(data.progress);
        else if (p.operation === 'explore-complex' && data.operation === 'explore-complex') p.onProgress?.(data.progress);
        return;
      }
      this.pending.delete(data.id);
      if ('error' in data) {
        if(isPausedCaptureOperation(p.operation)&&'size' in p){
          const retained=data.operation===p.operation&&'retainedSourceId' in data&&data.retainedSourceId===p.source.id&&data.id===this.currentInputId;
          if(retained)this.completed=p.source;
          p.reject(new pausedCaptureContracts[p.operation].Error(data.error,retained));
        }else if(p.operation==='generate'&&p.fractal){
          const retained=data.operation==='generate'&&data.retainedSourceId!==undefined&&data.retainedSourceId===p.source?.id&&data.id===this.currentInputId;
          if(data.retainedSourceId!==undefined&&!retained){const error=new FractalLiveGenerationError('分形实时预览保留身份不匹配',false);p.reject(error);this.invalidate(error);return;}
          if(retained)this.completed=p.source;
          p.reject(new FractalLiveGenerationError(data.error,retained));
        }else if(p.operation==='generate'&&(p.domain||p.context.implicitLive||p.context.surfaceLive||p.context.perlinLive||p.context.rootsLive)){const error=new Error(data.error);p.reject(error);this.invalidate(error);}else p.reject(new Error(data.error));
      }
      else if (p.operation === 'search-stable' && data.operation === 'search-stable') p.resolve(data.result);
      else if (p.operation === 'generate' && data.operation === 'generate') {
        if(!p.fractal&&!validOutputFormulas(data.output,generationFormulaContract(p.scene,p.context))){const error=new Error('后台帧的公式标注无效');p.reject(error);this.invalidate(error);return;}
        if(p.context.rootsLive&&!validRootsLiveOutput(data.output,p.context)){const error=new Error('复根实时响应身份或状态不匹配');p.reject(error);this.invalidate(error);return;}
        if(p.context.perlinLive&&!validSourcePerlinLiveOutput(data.output,p.context)){const error=new Error('Perlin 实时响应身份或状态不匹配');p.reject(error);this.invalidate(error);return;}
        if(p.context.implicitLive&&!validSourceImplicitOutput(data.output,p.context)){const error=new Error('隐式实时响应身份或状态不匹配');p.reject(error);this.invalidate(error);return;}
        if(p.context.surfaceLive&&!validSourceSurfaceOutput(data.output,p.context)){const error=new Error('曲面实时响应身份或状态不匹配');p.reject(error);this.invalidate(error);return;}
        if(p.domain&&!validDomainOutput(data.output,p.domain,p.context)){const error=new Error('域着色实时响应身份或状态不匹配');p.reject(error);this.invalidate(error);return;}
        if(p.fractal&&!validFractalOutput(data.output,p.fractal)){p.reject(new Error('分形实时响应身份或状态不匹配'));this.invalidate(new Error('分形实时响应身份或状态不匹配'));return;}
        if(data.id===this.currentInputId)this.completed={id:data.id,scene:p.scene,context:p.context,output:data.output};
        p.resolve(data.output);
      }
      else if (isPausedCaptureOperation(p.operation)&&'size' in p&&data.operation===p.operation&&'result' in data) {
        if(p.operation==='perlin-paused-capture'&&p.source.context.perlinLive){
          const {capture,preview}=data.result??{},before=p.source.output,base=p.captureSize;
          const paired=before.type==='raster'&&before.perlinLive&&capture?.type==='raster'&&preview?.type==='raster'&&base&&validSourcePerlinLiveOutput(preview,p.source.context)&&validSourcePerlinLiveOutput(capture,p.source.context,{dimensions:[base.width*p.scale,base.height*p.scale]})&&capture.perlinLive?.renderKind==='snapshot'&&preview.perlinLive?.renderKind==='snapshot'&&JSON.stringify(capture.perlinLive.frame)===JSON.stringify(before.perlinLive.frame)&&JSON.stringify(preview.perlinLive.frame)===JSON.stringify(before.perlinLive.frame)&&capture.perlinLive.constructions===before.perlinLive.constructions&&preview.perlinLive.constructions===before.perlinLive.constructions;
          if(!paired){const error=new pausedCaptureContracts[p.operation].Error('Perlin 当前帧截图响应身份、状态或尺寸不匹配',false);p.reject(error);this.invalidate(error);return;}
        }
        if(p.operation==='domain-paused-capture'&&(!p.captureSize||!validDomainCapture(data.result,p.source,p.size,p.scale,p.captureSize))){const error=new pausedCaptureContracts[p.operation].Error('域着色当前帧截图响应身份、状态或尺寸不匹配',false);p.reject(error);this.invalidate(error);return;}
        if(p.operation==='roots-paused-capture'){
          const before=p.source.output.formulaPresentation,contract=generationFormulaContract(p.source.scene,p.source.context);
          const {capture,preview}=data.result??{};
          if(p.source.context.rootsLive){
            const prior=p.source.output.type==='raster'?p.source.output.rootsLive:undefined;
            const paired=prior&&capture?.type==='raster'&&preview?.type==='raster'&&validRootsLiveOutput(preview,p.source.context)&&validRootsLiveOutput(capture,{...p.source.context,width:capture.width,height:capture.height})&&capture.rootsLive?.renderKind==='snapshot'&&preview.rootsLive?.renderKind==='snapshot'&&JSON.stringify(capture.rootsLive.frame)===JSON.stringify(prior.frame)&&JSON.stringify(preview.rootsLive.frame)===JSON.stringify(prior.frame);
            if(!paired){const error=new pausedCaptureContracts[p.operation].Error('复根实时截图响应身份或时钟不匹配',false);p.reject(error);this.invalidate(error);return;}
          }
          const image=capture?.type==='raster'?capture.sourceCurrentImage:undefined;
          const ordered=!before?.labels.length||capture?.type==='raster'&&capture.width===p.size.width&&capture.height===p.size.height&&image?.model==='local-current-numerical-snapshot'&&image.stage==='base-before-formulas'&&image.scale===p.scale&&image.baseSize?.[0]===capture.width&&image.baseSize?.[1]===capture.height&&!capture.rootsPausedImage;
          if(!ordered||!validOutputFormulas(capture,contract)||!validOutputFormulas(preview,contract)||JSON.stringify(capture.formulaPresentation)!==JSON.stringify(before)||JSON.stringify(preview.formulaPresentation)!==JSON.stringify(before)){
            const error=new pausedCaptureContracts[p.operation].Error('复根截图公式与已完成的预览帧不匹配',false);p.reject(error);this.invalidate(error);return;
          }
        }
        if(p.operation==='fractal-paused-capture'&&(!p.captureSize||!validFractalCapture(data.result,p.source.output,p.size,p.scale,p.captureSize))){const error=new pausedCaptureContracts[p.operation].Error('分形当前帧截图响应身份、状态或尺寸不匹配',false);p.reject(error);this.invalidate(error);return;}
        if(data.id===this.currentInputId)this.completed={...p.source,id:data.id,output:data.result.preview};
        p.resolve(data.result);
      }
      else if (p.operation === 'explore-complex' && data.operation === 'explore-complex') p.resolve(data.result);
      else if (p.operation === 'fractal-recording-plan' && data.operation === 'fractal-recording-plan') p.resolve(data.result);
      else if (p.operation === 'perlin-recording-plan' && data.operation === 'perlin-recording-plan') p.resolve(data.result);
      else if (p.operation === 'roots-recording-plan' && data.operation === 'roots-recording-plan') p.resolve(data.result);
      else if (p.operation === 'spirograph-recording-plan' && data.operation === 'spirograph-recording-plan') p.resolve(data.result);
      else p.reject(new Error('后台任务响应与请求类型不一致'));
    };
    this.worker.onerror = (event) => {
      if (this.worker !== worker) return;
      const message=event.message||'后台计算模块加载失败，请刷新页面后重试';
      this.invalidate(this.recording?new SourceRecordingOperationError(message,false,false):new Error(message));
    };
  }
  generate(
    scene: SceneDocument,
    context: GenerationInput,
    onProgress?: (output: SceneOutput) => void,
    onStatus?: (status: GenerationStatus) => void,
  ): Promise<SceneOutput> {
    if(this.recording)return Promise.reject(this.recordingError('源场景录制期间不能生成其它场景'));
    if(this.playbackPending())return Promise.reject(new Error('实时场景播放状态切换尚未完成'));
    this.ensure();
    const id = ++this.counter;
    const source=this.completed;this.currentInputId=id;this.completed=undefined;
    return new Promise((resolve, reject) => {
      const d=context.domainLive,domain=d?{sessionId:d.sessionId,revision:d.revision,paused:d.clock?.paused,actualFrameRate:d.actualFrameRate}:undefined;
      const v=context.fractalLive,fractal=v?{sessionId:v.sessionId,revision:v.revision,paused:v.clock?.paused,actualFrameRate:v.actualFrameRate}:undefined;
      try { const input=snapshotGenerationInput(context);this.pending.set(id, { operation: 'generate', scene,context:input,fractal,domain,source:fractal?source:undefined, resolve, reject, onProgress, onStatus });
      const request: GenerationRequest = { operation: 'generate', sessionId: this.sessionId, id, scene, ...(onStatus?{wantsStatus:true as const}:{}), context: input };
      this.worker!.postMessage(request); } catch (error) { this.pending.delete(id); reject(error); }
    });
  }
  /** The exact completed preview is the capability. A copied, superseded or
   * partially generated frame cannot select a live worker-owned scene. */
  captureSurfacePaused(output:SceneOutput,size:PausedCaptureSize,scale:1|3|5=1,signal?:AbortSignal):Promise<SourceGeometryPausedCaptureResult>{return this.captureGeometryPaused('surface-paused-capture',output,size,scale,signal);}
  captureImplicitPaused(output:SceneOutput,size:PausedCaptureSize,scale:1|3|5=1,signal?:AbortSignal):Promise<SourceGeometryPausedCaptureResult>{return this.captureGeometryPaused('implicit-paused-capture',output,size,scale,signal);}
  private captureGeometryPaused(operation:GeometryPausedCaptureOperation,output:SceneOutput,size:PausedCaptureSize,scale:1|3|5,signal?:AbortSignal):Promise<SourceGeometryPausedCaptureResult>{
    if(signal?.aborted)return Promise.reject(new DOMException('截图已取消','AbortError'));
    const source=this.completed,contract=pausedCaptureContracts[operation];
    if(this.recording||this.pending.size||!this.worker||!source||source.output!==output||output.type!=='geometry'||!(operation==='implicit-paused-capture'?output.implicitLive:output.surfaceLive))return Promise.reject(new contract.Error('截图需要当前已完成的暂停预览',false));
    try{sourceGeometryCapturePlan(source.context,size,scale);}catch(error){return Promise.reject(new contract.Error(error instanceof Error?error.message:String(error),true));}
    const id=++this.counter;this.currentInputId=id;this.completed=undefined;const copied={...size};
    return new Promise((resolve,reject)=>{
      const controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
      const release=()=>signal?.removeEventListener('abort',cancel);
      this.pending.set(id,{operation,source,size:copied,scale,controller,resolve:value=>{release();resolve(value);},reject:error=>{release();reject(error);}});
      try{this.worker!.postMessage({operation,sessionId:this.sessionId,id,sourceId:source.id,size:copied,scale} satisfies GenerationRequest);}catch(error){this.invalidate(error instanceof Error?error:new Error(String(error)));}
    });
  }
  captureRootsPaused(output:SceneOutput,size:RootsPausedCaptureSize,scale:1|3|5=1):Promise<RootsPausedCaptureResult>{
    return this.capturePaused('roots-paused-capture',output,size,scale);
  }
  capturePerlinPaused(output:SceneOutput,size:PerlinPausedCaptureSize,scale:1|3|5=1):Promise<PerlinPausedCaptureResult>{
    return this.capturePaused('perlin-paused-capture',output,size,scale);
  }
  captureSamilaPaused(output:SceneOutput,size:PausedCaptureSize,scale:1|3|5=1):Promise<PausedCaptureResult>{
    return this.capturePaused('samila-paused-capture',output,size,scale);
  }
  captureMapPaused(output:SceneOutput,size:PausedCaptureSize,scale:1|3|5=1):Promise<PausedCaptureResult>{return this.capturePaused('map-paused-capture',output,size,scale);}
  captureSymmetryPaused(output:SceneOutput,size:PausedCaptureSize,scale:1|3|5=1):Promise<PausedCaptureResult>{return this.capturePaused('symmetry-paused-capture',output,size,scale);}
  captureDomainPaused(output:SceneOutput,size:PausedCaptureSize,scale:1|3|5=1):Promise<PausedCaptureResult>{return this.capturePaused('domain-paused-capture',output,size,scale);}
  captureFractalPaused(output:SceneOutput,size:PausedCaptureSize,scale:1|3|5=1):Promise<PausedCaptureResult>{return this.capturePaused('fractal-paused-capture',output,size,scale);}
  navigateDomainPaused(output:SceneOutput,event:SourceDomainNavigationEvent):Promise<SceneOutput>{
    const source=this.completed;
    if(this.recording||!this.worker||this.pending.size||!source||source.output!==output||source.scene.kind!=='domain'||output.type!=='raster'||output.domainLive?.target!=='primary')return Promise.reject(new Error('域着色视口交互需要当前已完成的主预览'));
    const id=++this.counter;this.currentInputId=id;this.completed=undefined;
    return new Promise((resolve,reject)=>{this.pending.set(id,{operation:'domain-navigation',source,resolve,reject});try{this.worker!.postMessage({operation:'domain-navigation',sessionId:this.sessionId,id,sourceId:source.id,event} satisfies GenerationRequest);}catch(error){this.invalidate(error instanceof Error?error:new Error(String(error)));}});
  }
  updateDomainParameters(output:SceneOutput,scene:SceneDocument,writes:readonly (readonly [string,number])[]):Promise<void>{
    const source=this.completed;
    if(this.recording||!this.worker||this.pending.size||!source||source.output!==output||source.scene.kind!=='domain'||output.type!=='raster'||output.domainLive?.target!=='primary')return Promise.reject(new Error('域着色参数更新需要当前已完成的主预览'));
    const id=++this.counter;this.currentInputId=id;this.completed=undefined;
    return new Promise((resolve,reject)=>{this.pending.set(id,{operation:'domain-parameters',source,scene,resolve,reject});try{this.worker!.postMessage({operation:'domain-parameters',sessionId:this.sessionId,id,sourceId:source.id,scene,writes} satisfies GenerationRequest);}catch(error){this.invalidate(error instanceof Error?error:new Error(String(error)));}});
  }
  navigateSurfacePaused(output:SceneOutput,event:SourceViewportNavigationEvent):Promise<SceneOutput>{
    const source=this.completed;
    if(!source||source.output!==output||source.scene.kind!=='surface'||!source.context.surfaceLive?.clock.paused||this.pending.size||this.recording||!this.worker)return Promise.reject(new Error('曲面视口交互需要已完成且暂停的实时主预览'));
    const id=++this.counter;this.currentInputId=id;this.completed=undefined;
    return new Promise((resolve,reject)=>{this.pending.set(id,{operation:'surface-navigation',source,resolve,reject});try{this.worker!.postMessage({operation:'surface-navigation',sessionId:this.sessionId,id,sourceId:source.id,event} satisfies GenerationRequest);}catch(error){this.invalidate(error instanceof Error?error:new Error(String(error)));}});
  }
  navigateIteratedPaused(output:SceneOutput,event:SourceViewportNavigationEvent):Promise<SceneOutput>{
    const source=this.completed;
    if(this.recording||!this.worker||this.pending.size||!source||source.output!==output||output.type!=='raster'||!['map','symmetry'].includes(source.scene.kind)||output.sourceCameraFrame?.viewport.target!=='primary')return Promise.reject(new Error('迭代视口交互需要当前已完成的主预览'));
    const id=++this.counter;this.currentInputId=id;this.completed=undefined;
    return new Promise((resolve,reject)=>{this.pending.set(id,{operation:'iterated-navigation',source,resolve,reject});try{this.worker!.postMessage({operation:'iterated-navigation',sessionId:this.sessionId,id,sourceId:source.id,event} satisfies GenerationRequest);}catch(error){this.invalidate(error instanceof Error?error:new Error(String(error)));}});
  }
  updateIteratedParameters(output:SceneOutput,scene:SceneDocument,writes:readonly (readonly [string,number])[]):Promise<void>{
    const source=this.completed;
    if(this.recording||!this.worker||this.pending.size||!source||source.output!==output||output.type!=='raster'||!['map','symmetry'].includes(source.scene.kind)||output.sourceCameraFrame?.viewport.target!=='primary')return Promise.reject(new Error('迭代参数更新需要当前已完成的主预览'));
    const id=++this.counter;this.currentInputId=id;this.completed=undefined;
    return new Promise((resolve,reject)=>{this.pending.set(id,{operation:'iterated-parameters',source,scene,resolve,reject});try{this.worker!.postMessage({operation:'iterated-parameters',sessionId:this.sessionId,id,sourceId:source.id,scene,writes} satisfies GenerationRequest);}catch(error){this.invalidate(error instanceof Error?error:new Error(String(error)));}});
  }
  updateSurfaceParameter(output:SceneOutput,name:string,value:number):Promise<void>{
    const source=this.completed;
    if(this.recording||!this.worker||this.pending.size||!source||source.output!==output||source.scene.kind!=='surface'||output.type!=='geometry'||!output.surfaceLive)return Promise.reject(new Error('曲面参数修改需要当前已完成的主预览'));
    if(typeof name!=='string'||typeof value!=='number'||!Number.isFinite(value))return Promise.reject(new Error('曲面参数修改需要字符串名称和有限数值'));
    const id=++this.counter;this.currentInputId=id;this.completed=undefined;
    return new Promise((resolve,reject)=>{this.pending.set(id,{operation:'surface-parameter',source,resolve,reject});try{this.worker!.postMessage({operation:'surface-parameter',sessionId:this.sessionId,id,sourceId:source.id,name,value} satisfies GenerationRequest);}catch(error){this.invalidate(error instanceof Error?error:new Error(String(error)));}});
  }
  currentSurface(output:SceneOutput):Promise<SceneOutput>{
    const source=this.completed;
    if(this.recording||!this.worker||this.pending.size||!source||source.output!==output||source.scene.kind!=='surface'||output.type!=='geometry'||!output.surfaceLive)return Promise.reject(new Error('曲面当前帧需要当前已完成的主预览'));
    const id=++this.counter;this.currentInputId=id;this.completed=undefined;
    return new Promise((resolve,reject)=>{this.pending.set(id,{operation:'surface-current',source,resolve,reject});try{this.worker!.postMessage({operation:'surface-current',sessionId:this.sessionId,id,sourceId:source.id} satisfies GenerationRequest);}catch(error){this.invalidate(error instanceof Error?error:new Error(String(error)));}});
  }
  setImplicitPaused(output:SceneOutput,paused:boolean,timestampMs?:number):Promise<void>{return this.setLivePaused('implicit-playback',output,paused,timestampMs);}
  setSurfacePaused(output:SceneOutput,paused:boolean,timestampMs?:number):Promise<void>{return this.setLivePaused('surface-playback',output,paused,timestampMs);}
  setSamilaPaused(output:SceneOutput,paused:boolean):Promise<void>{return this.setLivePaused('samila-playback',output,paused);}
  setMapPaused(output:SceneOutput,paused:boolean,timestampMs?:number):Promise<void>{return this.setLivePaused('map-playback',output,paused,timestampMs);}
  setSymmetryPaused(output:SceneOutput,paused:boolean,timestampMs?:number):Promise<void>{return this.setLivePaused('symmetry-playback',output,paused,timestampMs);}
  setRootsPaused(output:SceneOutput,paused:boolean,timestampMs?:number):Promise<void>{return this.setLivePaused('roots-playback',output,paused,timestampMs);}
  setPerlinPaused(output:SceneOutput,paused:boolean,timestampMs?:number):Promise<void>{return this.setLivePaused('perlin-playback',output,paused,timestampMs);}
  setDomainPaused(output:SceneOutput,paused:boolean,timestampMs?:number):Promise<void>{return this.setLivePaused('domain-playback',output,paused,timestampMs);}
  setFractalPaused(output:SceneOutput,paused:boolean,timestampMs?:number):Promise<void>{return this.setLivePaused('fractal-playback',output,paused,timestampMs);}
  private setLivePaused(operation:'samila-playback'|'symmetry-playback'|'map-playback'|'fractal-playback'|'domain-playback'|'implicit-playback'|'surface-playback'|'perlin-playback'|'roots-playback',output:SceneOutput,paused:boolean,timestampMs?:number):Promise<void>{
    const source=this.completed;
    const valid=operation==='implicit-playback'?output.type==='geometry'&&source?.scene.kind==='implicit'&&!!source.context.implicitLive&&!!output.implicitLive:operation==='surface-playback'?output.type==='geometry'&&source?.scene.kind==='surface'&&!!output.surfaceLive:output.type==='raster'&&(operation==='roots-playback'?!!source?.context.rootsLive&&!!output.rootsLive&&output.rootsPresentation?.target==='primary':operation==='perlin-playback'?source?.scene.kind==='perlin'&&!!source.context.perlinLive&&!!output.perlinLive&&!!output.sourcePerlinFrame&&source.context.sourceViewport?.target==='primary':operation==='domain-playback'?source?.scene.kind==='domain'&&!!output.domainLive&&!!output.domainRender:operation==='fractal-playback'?source?.scene.kind==='fractal'&&!!output.fractalLive&&!!output.fractalRender:operation==='samila-playback'
      ?source?.scene.kind==='samila'&&output.samilaLive?.target==='primary'&&output.samilaLive.clock==='realtime-source-queue'
      :source?.scene.kind===(operation==='map-playback'?'map':'symmetry')&&output[operation==='map-playback'?'mapLive':'symmetryLive']?.clock==='realtime-source-queue'&&output.sourceCameraFrame?.viewport.target==='primary');
    if(this.recording||!this.worker||this.pending.size||!source||source.output!==output||!valid)
      return Promise.reject(new Error('实时播放控制需要当前已完成的主预览'));
    const id=++this.counter;this.currentInputId=id;this.completed=undefined;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation,source,paused,resolve,reject});
      try{this.worker!.postMessage({operation,sessionId:this.sessionId,id,sourceId:source.id,paused,...(timestampMs!==undefined?{timestampMs}:{})} satisfies GenerationRequest);}
      catch(error){this.invalidate(error instanceof Error?error:new Error(String(error)));}
    });
  }
  private capturePaused(operation:PausedCaptureOperation,output:SceneOutput,size:PausedCaptureSize,scale:1|3|5):Promise<PausedCaptureResult>{
    if(this.recording)return Promise.reject(this.recordingError('源场景录制期间不能截图'));
    const source=this.completed,roots=operation==='roots-paused-capture',contract=pausedCaptureContracts[operation];
    const eligible=output.type==='raster'&&(operation==='domain-paused-capture'?!!output.domainLive&&output.domainLive.target==='primary'&&!!output.domainRender&&source?.scene.kind==='domain':operation==='fractal-paused-capture'?!!output.fractalLive&&output.fractalLive.target==='primary'&&!!output.fractalRender&&source?.scene.kind==='fractal':roots?!!output.rootsPresentation:operation==='symmetry-paused-capture'||operation==='map-paused-capture'?!!output[operation==='map-paused-capture'?'mapLive':'symmetryLive']&&output.sourceCameraFrame?.viewport.target==='primary'&&source?.scene.kind===(operation==='map-paused-capture'?'map':'symmetry'):operation==='samila-paused-capture'?output.samilaLive?.target==='primary'&&source?.scene.kind==='samila':!!output.sourcePerlinFrame&&source?.scene.kind==='perlin'&&!!source.scene.perlinSource);
    if(!this.worker||this.pending.size||!source||source.output!==output||!eligible)
      return Promise.reject(new Error(`当前${contract.label}画面尚未完成或已过期，请等待预览完成后重试`));
    // Resolve density from the completed primary once, before releasing its
    // capability. The response consumes this admitted fact, never caller DPR.
    let captureSize:SourceCaptureSize|undefined;
    if(operation==='fractal-paused-capture'||operation==='domain-paused-capture'||operation==='perlin-paused-capture'&&source.context.perlinLive)try{captureSize=prepareSourcePausedCaptureSize(size,operation==='perlin-paused-capture'?source.context.sourcePerlinViewport?.pixelDensity??NaN:operation==='domain-paused-capture'?source.context.domainLive?.viewport?.pixelDensity??NaN:source.context.fractalPixelDensity??NaN,MAX_RASTER_PIXELS);}
    catch(error){return Promise.reject(new contract.Error(error instanceof Error?error.message:String(error),true));}
    const id=++this.counter;this.currentInputId=id;this.completed=undefined;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation,source,size:{...size},scale,captureSize,resolve,reject});
      const request:GenerationRequest={operation,sessionId:this.sessionId,id,sourceId:source.id,size:{...size},scale};
      try{this.worker!.postMessage(request);}catch(error){
        this.pending.delete(id);
        // Preserve the established Roots synchronous-send contract. Perlin
        // retention requires an explicit acknowledgement from its live owner.
        const retained=roots&&this.currentInputId===id&&this.worker!==null;if(retained)this.completed=source;
        const message=error instanceof Error?error.message:String(error);
        reject(new contract.Error(message,retained));
      }
    });
  }
  beginSourceRecording(output:SceneOutput,options:SourceRecordingOptions,signal?:AbortSignal):Promise<SourceRecordingStart>{
    if(signal?.aborted)return Promise.reject(new DOMException('源场景录制已取消','AbortError'));
    const source=this.completed;
    if(this.recording)return Promise.reject(this.recordingError('源场景录制已开始'));
    const eligible=source&&(source.scene.kind==='surface'||usesSourceImplicitCpuMesh(source.scene)?output.type==='geometry'&&(source.scene.kind==='surface'?!!output.surfaceLive:!!output.sourceImplicitPresentation)&&output.sourceCameraFrame?.viewport.target==='primary':output.type==='raster'&&recordingRaster(output,source.scene.kind)&&(source.scene.kind==='roots'?output.rootsPresentation?.target==='primary'&&!!source.context.rootsLive:source.scene.kind==='domain'?output.domainLive?.target==='primary'&&output.domainLive.clockSource!=='fixed-step':source.scene.kind==='fractal'?output.fractalLive?.target==='primary'&&output.fractalLive.clock==='realtime-source-queue':source.scene.kind==='perlin'?!!source.scene.perlinSource:output.sourceCameraFrame?.viewport.target==='primary'&&(output.mapLive??output.symmetryLive)?.clock==='realtime-source-queue'));
    if(!this.worker||this.pending.size||!source||source.output!==output||!eligible)
      return Promise.reject(new SourceRecordingOperationError('源场景录制需要当前已完成的主预览',false,false));
    let roots:SourceRootsRecordingLease|undefined;
    if(source.scene.kind==='roots')try{
      if(output.type!=='raster')throw Error('复根录制需要像素预览');roots=new SourceRootsRecordingLease(source.scene,source.context,output,options);
    }catch(error){return Promise.reject(new SourceRecordingOperationError(error instanceof Error?error.message:String(error),true,false));}
    let fractal:RetainedRecordingLease|undefined,domain:DomainRecordingLease|undefined,geometry:SourceGeometryRecordingLease|undefined,perlin:{sceneId:string;primary:GenerationInput;size:SourceCaptureSize}|undefined;
    if(source.scene.kind==='perlin'&&source.context.perlinLive)try{perlin={sceneId:source.scene.id,primary:snapshotGenerationInput(source.context),size:prepareSourcePausedCaptureSize(options,source.context.sourcePerlinViewport?.pixelDensity??NaN)};}catch(error){return Promise.reject(new SourceRecordingOperationError(error instanceof Error?error.message:String(error),true,false));}
    if(source.scene.kind==='surface'||usesSourceImplicitCpuMesh(source.scene))try{
      if(output.type!=='geometry')throw Error('曲面录制需要几何预览');geometry=new SourceGeometryRecordingLease(source.scene,source.context,output,options,signal);
    }catch(error){return Promise.reject(new SourceRecordingOperationError(error instanceof Error?error.message:String(error),true,false));}
    if(source.scene.kind==='fractal')try{
      if(!Number.isSafeInteger(options.simulationFps)||options.simulationFps<1||options.simulationFps>120)throw Error('分形录制模拟帧率必须为 1–120 的整数');
      fractal={options:{...options},size:sourceRecordingSize(options,source.context.fractalPixelDensity??NaN),primary:snapshotGenerationInput(source.context),nextDisplayFrame:1};
    }catch(error){return Promise.reject(new SourceRecordingOperationError(error instanceof Error?error.message:String(error),true,false));}
    if(source.scene.kind==='domain')try{
      validateSourceDomainFrameRate(options.actualFrameRate);
      if(!Number.isFinite(options.simulationFps)||options.simulationFps<1||options.simulationFps>120)throw Error('域着色录制模拟帧率必须在 1–120');
      domain={sceneId:source.scene.id,options:{...options},size:sourceRecordingSize(options,source.context.domainLive?.viewport?.pixelDensity??NaN),primary:snapshotGenerationInput(source.context),nextDisplayFrame:1,formulas:structuredClone(output.type==='raster'?output.formulaPresentation:undefined)};
    }catch(error){return Promise.reject(new SourceRecordingOperationError(error instanceof Error?error.message:String(error),true,false));}
    const id=++this.counter,handle=Object.freeze({sessionId:this.sessionId,recordingId:id});
    this.currentInputId=id;this.completed=undefined;this.recording={handle,family:source.scene.kind,usable:false,roots,fractal,domain,geometry,perlin};
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation:'source-recording-begin',source,handle,resolve,reject});
      try{this.worker!.postMessage({operation:'source-recording-begin',sessionId:this.sessionId,id,sourceId:source.id,options:{...options}} satisfies GenerationRequest);}
      catch(error){this.invalidate(new SourceRecordingOperationError(error instanceof Error?error.message:String(error),false,false));}
    });
  }
  nextSourceRecordingFrame(handle:SourceRecordingHandle,displayFrame:number,actualFrameRate?:number):Promise<SourceRecordingRaster>{
    if(!this.hasSourceRecording(handle)||this.pending.size)return Promise.reject(this.recordingError('源场景录制身份无效或前一操作尚未完成'));
    if(!Number.isSafeInteger(displayFrame)||displayFrame<1)return Promise.reject(this.recordingError('源场景录制帧序号无效'));
    try{this.recording!.roots?.requestFrame(displayFrame);}catch(error){return Promise.reject(this.recordingError(error instanceof Error?error.message:String(error)));}
    const fractal=this.recording!.fractal,domain=this.recording!.domain;
    if(fractal&&(!fractal.clock||displayFrame!==fractal.nextDisplayFrame||displayFrame>fractal.clock.lastDisplayFrame))return Promise.reject(this.recordingError('分形录制必须按已确认规划连续请求，未交付 warmup 的会话只能停止'));
    if(domain){
      if(!domain.clock||displayFrame!==domain.nextDisplayFrame||displayFrame>domain.clock.lastDisplayFrame)return Promise.reject(this.recordingError('域着色录制必须按已确认规划连续请求，未交付 warmup 的会话只能停止'));
      try{validateSourceDomainFrameRate(actualFrameRate);}catch(error){return Promise.reject(this.recordingError(error instanceof Error?error.message:String(error)));}
      if(domain.attempt&&!Object.is(domain.attempt.actualFrameRate,actualFrameRate))return Promise.reject(this.recordingError('域着色重试不能改变未确认帧的实际帧率'));
      domain.attempt={displayFrame,actualFrameRate};
    }
    const geometry=this.recording!.geometry;let cached=false;
    if(geometry)try{const admitted=geometry.requestFrame(displayFrame,actualFrameRate);cached=admitted.cached;actualFrameRate=admitted.actualFrameRate;}catch(error){return Promise.reject(this.recordingError(error instanceof Error?error.message:String(error)));}
    const id=++this.counter;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation:'source-recording-frame',handle,family:this.recording!.family,displayFrame,actualFrameRate,resolve,reject});
      if(cached&&geometry){this.renderGeometryFrame(id,this.pending.get(id)! as Extract<Pending,{operation:'source-recording-frame'}>,geometry,this.worker!);return;}
      try{this.worker!.postMessage({operation:'source-recording-frame',sessionId:this.sessionId,id,recordingId:handle.recordingId,displayFrame,actualFrameRate} satisfies GenerationRequest);}
      catch(error){this.invalidate(new SourceRecordingOperationError(error instanceof Error?error.message:String(error),false,false));}
    });
  }
  /** Optional injected stop clock is currently supported only by Implicit.
   * A retry republishes the first stop; it never resets that baseline again. */
  finishSourceRecording(handle:SourceRecordingHandle,timestampMs?:number):Promise<SourceRecordingStop>{
    if(!this.hasSourceRecording(handle)||this.pending.size)return Promise.reject(this.recordingError('源场景录制身份无效或前一操作尚未完成'));
    if(timestampMs!==undefined&&this.recording!.family!=='implicit')return Promise.reject(this.recordingError('注入停止时钟仅支持隐式录制'));
    try{this.recording!.geometry?.prepareStop();}catch(error){return Promise.reject(this.recordingError(error instanceof Error?error.message:String(error)));}
    const id=++this.counter;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation:'source-recording-finish',handle,family:this.recording!.family,resolve,reject});
      try{this.worker!.postMessage({operation:'source-recording-finish',sessionId:this.sessionId,id,recordingId:handle.recordingId,timestampMs} satisfies GenerationRequest);}
      catch(error){this.invalidate(new SourceRecordingOperationError(error instanceof Error?error.message:String(error),false,false));}
    });
  }
  searchStable(scene: SceneDocument, options: StableSearchOptions = {}, onProgress?: (progress: StableSearchProgress) => void): Promise<StableSearchResult> {
    if(this.recording)return Promise.reject(this.recordingError('源场景录制期间不能执行其它后台任务'));
    if(this.playbackPending())return Promise.reject(new Error('实时场景播放状态切换尚未完成'));
    this.ensure();
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { operation: 'search-stable', resolve, reject, onProgress });
      const request: GenerationRequest = { operation: 'search-stable', sessionId: this.sessionId, id, scene, options };
      try { this.worker!.postMessage(request); } catch (error) { this.pending.delete(id); reject(error); }
    });
  }
  planSpirographRecording(scene:SceneDocument,startFrame:number,fps:number):Promise<SpirographRecordingPlan>{
    if(this.recording)return Promise.reject(this.recordingError('源场景录制期间不能执行其它后台任务'));
    if(this.playbackPending())return Promise.reject(new Error('实时场景播放状态切换尚未完成'));
    this.ensure();const id=++this.counter;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation:'spirograph-recording-plan',resolve,reject});
      const request:GenerationRequest={operation:'spirograph-recording-plan',sessionId:this.sessionId,id,scene,startFrame,fps};
      try{this.worker!.postMessage(request);}catch(error){this.pending.delete(id);reject(error);}
    });
  }
  planFractalFreshRecording(scene:SceneDocument,simulationFps:number,encoderFps:number):Promise<FractalFreshRecordingPlan>{
    if(this.recording)return Promise.reject(this.recordingError('源场景录制期间不能执行其它后台任务'));
    if(this.playbackPending())return Promise.reject(new Error('实时场景播放状态切换尚未完成'));
    this.ensure();const id=++this.counter;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation:'fractal-recording-plan',resolve,reject});
      const request:GenerationRequest={operation:'fractal-recording-plan',sessionId:this.sessionId,id,scene,simulationFps,encoderFps};
      try{this.worker!.postMessage(request);}catch(error){this.pending.delete(id);reject(error);}
    });
  }
  planPerlinFreshRecording(scene:SceneDocument,simulationFps:number,encoderFps:number):Promise<PerlinFreshRecordingPlan>{
    if(this.recording)return Promise.reject(this.recordingError('源场景录制期间不能执行其它后台任务'));
    if(this.playbackPending())return Promise.reject(new Error('实时场景播放状态切换尚未完成'));
    this.ensure();const id=++this.counter;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation:'perlin-recording-plan',resolve,reject});
      const request:GenerationRequest={operation:'perlin-recording-plan',sessionId:this.sessionId,id,scene,simulationFps,encoderFps};
      try{this.worker!.postMessage(request);}catch(error){this.pending.delete(id);reject(error);}
    });
  }
  planRootsFreshRecording(scene:SceneDocument,simulationFps:number,encoderFps:number):Promise<RootsFreshRecordingPlan>{
    if(this.recording)return Promise.reject(this.recordingError('源场景录制期间不能执行其它后台任务'));
    if(this.playbackPending())return Promise.reject(new Error('实时场景播放状态切换尚未完成'));
    this.ensure();const id=++this.counter;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{operation:'roots-recording-plan',resolve,reject});
      const request:GenerationRequest={operation:'roots-recording-plan',sessionId:this.sessionId,id,scene,simulationFps,encoderFps};
      try{this.worker!.postMessage(request);}catch(error){this.pending.delete(id);reject(error);}
    });
  }
  exploreComplex(scene: SceneDocument, options: ComplexExploreOptions, onProgress?: (progress: ComplexExploreProgress) => void): Promise<ComplexExploreResult> {
    if(this.recording)return Promise.reject(this.recordingError('源场景录制期间不能执行其它后台任务'));
    if(this.playbackPending())return Promise.reject(new Error('实时场景播放状态切换尚未完成'));
    this.ensure();
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { operation: 'explore-complex', resolve, reject, onProgress });
      const request: GenerationRequest = { operation: 'explore-complex', sessionId: this.sessionId, id, scene, options };
      try { this.worker!.postMessage(request); } catch (error) { this.pending.delete(id); reject(error); }
    });
  }
  cancel() {
    // A recording cancellation is an orderly finish owned by the queue.
    if(this.recording)return;
    this.completed=undefined;this.currentInputId=0;
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()){
      if(p.operation==='surface-paused-capture'||p.operation==='implicit-paused-capture')p.controller.abort();
      p.reject(new DOMException("已取消", "AbortError"));
    }
    this.pending.clear();
  }
  dispose() {
    this.invalidate(this.recording?new SourceRecordingOperationError('源场景录制后台已释放',false,false):new DOMException('已取消','AbortError'));
  }
}
