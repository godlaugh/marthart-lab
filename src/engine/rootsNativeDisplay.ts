import {GenerationCleanupState} from './generationCleanup';
import {RootsNativeDensityGpu,ROOTS_NATIVE_DENSITY_CHUNK,rootsNativeDensityGpuBytes,type RootsNativeDensityKernel} from './rootsNativeDensityGpu';
import {RootsGpuError,rootsGpuCancel,rootsGpuInput} from './rootsGpuFailure';
import {validatePreparedRootsProjection,updateRootsProjectionState,transformRootsPoint,type PreparedRootsProjection,type RootsProjectionState,type RootsProjectionUpdate} from './rootsProjection';
import {prepareRootsMetricValue,validateRootsMetricColorPlan,type RootsMetricColorPlan} from './rootsDensityColor';
import {prepareRootsInkView,presentRootsNativeMetricInk,rootsNativeInkViewBytes} from './rootsNativeInk';

export interface RootsNativeDensityAdvanceOptions {kernel?:RootsNativeDensityKernel;isCancelled?:()=>boolean;}
export interface RootsNativeDensityPresentOptions {isCancelled?:()=>boolean;}
/** Committed advance facts contain no claim that readback or tone has run. */
export interface RootsNativeDensityFrameFacts {
 readonly model:'mathart-1.7.8-v1';readonly mode:'density';
 readonly kernelPolicy:RootsNativeDensityKernel;readonly actualKernel:'points'|'quad'|undefined;
 readonly submittedFinitePointCount:number;readonly newInputPoints:number;readonly newInvalidPoints:number;readonly consumedInputPoints:number;
 readonly capture:boolean;readonly captureReason:RootsProjectionUpdate['captureReason'];
 readonly clearInk:boolean;readonly clearReasons:RootsProjectionUpdate['reasons'];readonly displayRotation:number;
 readonly projectionKind:PreparedRootsProjection['optics']['projectionKind'];
 readonly physicalSize:readonly[number,number];readonly logicalSize:readonly[number,number];
 readonly referenceLogicalHeight:number;readonly displayScale:number;readonly densityDiameter:number;
 readonly matrixReferenceViewport:PreparedRootsProjection['matrixReferenceViewport'];
 readonly accumulationPrecision:'float32';readonly streamPolicy:'caller-supplied-arrival-order';
}

/** Display-stage owner for the source density stream. Its caller owns sample
 * generation and arrival order. A render consumes only the supplied new raw
 * XYZ/metric points; camera/transform/size changes never ask for prior points.
 * Application clock, point-cloud history and source export are separate work. */
export class RootsNativeDensityDisplay {
 private cleanup=new GenerationCleanupState();
 private gpu?:RootsNativeDensityGpu;
 private projection?:RootsProjectionState;
 private invalidPoints=0;
 private consumedPoints=0;
 private renders=0;
 private clears=0;
 private frame?:RootsNativeDensityFrameFacts;

 diagnostics(){return{renders:this.renders,clears:this.clears,consumedPoints:this.consumedPoints,invalidPoints:this.invalidPoints,frameReady:!!this.frame,gpu:this.gpu?.diagnostics(),anchor:this.projection?.anchor,current:this.projection?.current};}
 reset(failures:readonly unknown[]=[]):void {
  // Revoke presentation even when disposal fails and the resource owner must
  // remain alive for a retry. Failed/partial work can never expose old facts.
  this.frame=undefined;
  this.cleanup.reset(()=>{
   this.gpu?.dispose();this.gpu=undefined;this.projection=undefined;
   this.invalidPoints=this.consumedPoints=this.renders=this.clears=0;
  },failures);
 }
 dispose():void{this.reset();}

 /** Raw four-component tuples are borrowed until return. The caller may
  * release them afterwards; no transformed/history array is retained here.
  * Explicit points/quad is a diagnostic forcing policy; application use is auto. */
 render(plan:PreparedRootsProjection,points:Float32Array|Float64Array,color:RootsMetricColorPlan,options:RootsNativeDensityAdvanceOptions={}){
  return this.renderBatches(plan,[points],color,options);
 }
 /** Borrow one bounded arrival batch at a time, consume it before requesting
  * the next, then read/tone once. Iterator/caller failure invalidates partial
  * ink through the same cleanup owner; no solver or history is retained here. */
 renderBatches(plan:PreparedRootsProjection,batches:Iterable<Float32Array|Float64Array>,color:RootsMetricColorPlan,options:RootsNativeDensityAdvanceOptions={}){
  this.advanceBatches(plan,batches,color,options);
  return this.present(color,options);
 }
 /** Advance one complete display frame, including its projection observation,
  * clear and bounded flushes, without reading ink or running CPU tone. Only a
  * successful advance commits facts. Batches are borrowed only during this call. */
 advanceBatches(plan:PreparedRootsProjection,batches:Iterable<Float32Array|Float64Array>,color:RootsMetricColorPlan,options:RootsNativeDensityAdvanceOptions={}):RootsNativeDensityFrameFacts {
  this.frame=undefined;
  return this.operation(()=>this.advance(plan,batches,color,options));
 }
 /** Present the latest committed advance. A different color plan only changes
  * tone; it does not observe a new camera, clear ink or submit points. */
 present(color:RootsMetricColorPlan,options:RootsNativeDensityPresentOptions={}){
  return this.operation(()=>{
   const frame=this.frame,gpu=this.gpu,{isCancelled}=options;
   if(!frame||!gpu)throw new RootsGpuError('Native density presentation requires a successful advance','input');
   rootsGpuInput(()=>validateRootsMetricColorPlan(color));
   rootsGpuCancel(isCancelled);
   const [width,height]=frame.physicalSize;
   const ink=gpu.readback(isCancelled);
   const shown=presentRootsNativeMetricInk(ink,prepareRootsInkView(width,height,frame.displayRotation),color,frame.submittedFinitePointCount,isCancelled);
   return{...shown,width,height,cameraResolved:true as const,backend:'webgl2' as const,facts:{...frame,toneBackend:'cpu' as const}};
  });
 }
 private operation<T>(run:()=>T):T {
  this.cleanup.prepare();
  try{return run();}catch(error){this.reset([error]);throw error;}
 }
 private advance(plan:PreparedRootsProjection,batches:Iterable<Float32Array|Float64Array>,color:RootsMetricColorPlan,options:RootsNativeDensityAdvanceOptions):RootsNativeDensityFrameFacts {
  const {isCancelled}=options,kernel=options.kernel??'auto';
  rootsGpuInput(()=>{validatePreparedRootsProjection(plan);validateRootsMetricColorPlan(color);});
  if(plan.mode!=='density')throw new RootsGpuError('Point-cloud requires its distinct display owner','input');
  if(!batches||typeof batches[Symbol.iterator]!=='function')throw new RootsGpuError('Native density display requires an iterable of raw point batches','input');
  if(!['auto','points','quad'].includes(kernel))throw new RootsGpuError('Native density kernel policy is invalid','input');
  rootsGpuCancel(isCancelled);
  const {physicalWidth:width,physicalHeight:height}=plan;
  // GPU helper already includes one full readback; view helper includes that
  // borrowed readback again. Subtract its one overlap and include caller input.
  const peak=rootsNativeDensityGpuBytes(width,height)+rootsNativeInkViewBytes(width,height,4)-width*height*16;
  if(peak>768*1024*1024)throw new RootsGpuError('Native density display representations exceed 768 MiB','capacity');
  const update=updateRootsProjectionState(this.projection,plan);
  const resized=!!this.projection&&(this.projection.current.physicalWidth!==width||this.projection.current.physicalHeight!==height);
  if(resized){this.gpu?.dispose();this.gpu=undefined;}
  if(!this.gpu){this.gpu=new RootsNativeDensityGpu();this.gpu.initialize(width,height);}
  else if(update.clearInk)this.gpu.clear();
  if(update.clearInk)this.clears++;
  // The projection owner composes captured matrices with current target/point
  // facts once. Consumers never reinterpret an old anchor's viewport.
  const splatPlan=update.splatPlan;
  let pending=0,invalid=0,inputCount=0;
  for(const points of batches){
   rootsGpuCancel(isCancelled);
   if(!(points instanceof Float32Array||points instanceof Float64Array)||points.length%4!==0)throw new RootsGpuError('Native density display requires interleaved raw XYZ/metric tuples','input');
   if(peak+points.byteLength>768*1024*1024)throw new RootsGpuError('Native density display representations exceed 768 MiB','capacity');
   inputCount+=points.length/4;
   if(!Number.isSafeInteger(this.consumedPoints+inputCount))throw new RootsGpuError('Native density consumed point count exceeds safe integer','capacity');
   for(let i=0;i<points.length;i+=4){
   if((i&4095)===0)rootsGpuCancel(isCancelled);
   const point=transformRootsPoint(plan,[points[i],points[i+1],points[i+2]]);
   // Native finite world admission precedes metric clamping/NaN diagnosis.
   if(point.kind==='invalid'){invalid++;continue;}
   const metric=rootsGpuInput(()=>prepareRootsMetricValue(points[i+3])).clamped;
   this.gpu.add(point.world,metric);pending++;
   if(pending===ROOTS_NATIVE_DENSITY_CHUNK){this.gpu.flush(splatPlan,kernel,isCancelled);pending=0;}
   }
  }
  this.gpu.flush(splatPlan,kernel,isCancelled);
  rootsGpuCancel(isCancelled);
  const gpu=this.gpu.diagnostics();
  this.projection=update.state;this.invalidPoints+=invalid;this.consumedPoints+=inputCount;this.renders++;
  this.frame=Object.freeze({model:'mathart-1.7.8-v1',mode:'density',kernelPolicy:kernel,actualKernel:gpu.lastKernel??gpu.probe?.selected,
    submittedFinitePointCount:gpu.submittedPoints,newInputPoints:inputCount,newInvalidPoints:invalid,consumedInputPoints:this.consumedPoints,
    capture:update.capture,captureReason:update.captureReason,clearInk:update.clearInk,clearReasons:Object.freeze([...update.reasons]),displayRotation:update.displayRotation,
    projectionKind:update.state.anchor.optics.projectionKind,physicalSize:Object.freeze([width,height] as const),logicalSize:Object.freeze([plan.logicalWidth,plan.logicalHeight] as const),
    referenceLogicalHeight:plan.referenceLogicalHeight,displayScale:plan.displayScale,densityDiameter:plan.densityDiameter,matrixReferenceViewport:Object.freeze({...splatPlan.matrixReferenceViewport}),
    accumulationPrecision:'float32',streamPolicy:'caller-supplied-arrival-order'});
  return this.frame;
 }
}
