import type {GpuOrbitBatch} from './fractalGpu';
import type {FractalSourceAsyncSampler,FractalSourceSampleRequest,FractalSourceSampleAdmission} from './fractalSourceSampling';
import type {FractalSourceDiagnostics,FractalSourceExecutionIdentity} from './fractalSourceFrame';
import {FractalSourceReferenceCache,validateFractalSourcePlan,type FractalReferenceBuildOptions,type FractalSourcePlan,type FractalSourceReferenceResult,type FractalSourceReferenceReady} from './fractalSourcePrecision';
import {validatePreparedFractalSourceColor} from './fractalSourceColor';
import {validateSourceFractalDisplayFacts} from './sourceFractalDisplay';
import {createFractalSourceRasterBindings} from './fractalSourceRasterBindings';
import {FRACTAL_SOURCE_NATIVE_SHADERS} from './fractalSourceNativeProgram';
import {scatterFractalSourceRasterSample,type FractalSourceRasterOutput} from './fractalSourceRasterSample';
import {SOURCE_FRAME_BUDGET} from './sourceDrawingFrame';
import {SOURCE_FRACTAL_NATIVE_MAX_SAMPLES,sourceFractalNativeProgramBytes,type SourceFractalNativeOperation} from './sourceFractalNativeProtocol';
import {ensureSourceNativeLease} from './sourceNativeLease';
import {exchangeSourceFractalNative,SourceNativeError,type SourceNativeFractalResponse} from './sourceNativeClient';
import type {SourceDrawingUniform} from './sourceDrawingSnapshot';

type Identity={rendererIdentity:string;contextSerial:number;sessionSerial:number;generation:number;sequence:number};
type State={resource:string;index:number;width:number;height:number;referenceBytes:number;paletteBytes:number;pendingTarget:number;pendingTextures:number;failed:boolean;identity?:Identity};
const programBytes=sourceFractalNativeProgramBytes(FRACTAL_SOURCE_NATIVE_SHADERS),owners=new Set<FractalSourceNativeSampler>();
let generation=0;
const nativeBytes=(s:State)=>programBytes+96+s.width*s.height*52+s.referenceBytes+s.paletteBytes+s.pendingTarget+s.pendingTextures;
const demand=(ok:unknown,message:string)=>{if(!ok)throw new SourceNativeError('input',message);};
const capacity=(bytes:number)=>{if(!Number.isSafeInteger(bytes)||bytes<0||bytes>SOURCE_FRAME_BUDGET)throw new SourceNativeError('capacity','分形原生会话、传输、采样输出及调用方图像超过 256 MiB 预算');};
const uniformBytes=(uniforms:readonly SourceDrawingUniform[])=>4+uniforms.reduce((bytes,u)=>bytes+4+u.name.length+4+(u.kind==='sampler2d'?4:8+u.values.byteLength),0);

/** One source-fragment owner, retaining uncertain tokens until release ACK.
 * Cancellation is observed only between acknowledged transactions: cancelling
 * an export never aborts the transport shared with another live owner. Browser
 * accounting covers this module's two owners; native admission additionally
 * enforces the authoritative shared budget across all renderer families. */
export class FractalSourceNativeSampler implements FractalSourceAsyncSampler {
 readonly maximumSamples=SOURCE_FRACTAL_NATIVE_MAX_SAMPLES;
 private readonly generation=++generation;private sequence=0;
 private readonly references=new FractalSourceReferenceCache();
 private referenceValue?:FractalSourceReferenceResult;
 private state?:State;private active?:Promise<GpuOrbitBatch>;private retiring?:Promise<void>;private closing=false;
 private transientBytes=0;private protocolBytes=0;
 private last?:Identity;
 private counters={referenceUploads:0,referenceHits:0,samples:0,draws:0,rasterDraws:0,rasterAllocations:0,glitches:0,perturbSamples:0,ordinarySteps:0,perturbSteps:0,colorSamples:0,colorUploads:0,colorHits:0};
 private peakBytes=0;
 private static held(){let bytes=0;for(const owner of owners)bytes+=owner.references.diagnostics().retainedBytes+(owner.state?nativeBytes(owner.state):0)+owner.transientBytes+owner.protocolBytes;return bytes;}
 private peak(bytes:number){capacity(bytes);this.peakBytes=Math.max(this.peakBytes,bytes);}
 private next(){if(this.sequence===0xffffffff||this.generation>0xffffffff)throw new SourceNativeError('capacity','分形原生请求身份已耗尽');return{generation:this.generation,sequence:++this.sequence};}
 prepareReference(plan:FractalSourcePlan,options:FractalReferenceBuildOptions & {additionalBytes?:number}={}){
  if(this.active||this.retiring||this.closing)throw new SourceNativeError('capacity','分形采样或清理尚未完成');
  return this.reference(plan,options,options.additionalBytes??0);
 }
 private reference(plan:FractalSourcePlan,options:FractalReferenceBuildOptions,additionalBytes=0){
  demand(Number.isSafeInteger(additionalBytes)&&additionalBytes>=0,'分形调用方保留字节无效');
  owners.add(this);const prior=this.references.diagnostics().retainedBytes;
  this.peak(FractalSourceNativeSampler.held()+additionalBytes);
  const prepared=this.references.prepare(plan,{...options,onBytes:bytes=>{this.peak(FractalSourceNativeSampler.held()-prior+bytes+additionalBytes);options.onBytes?.(bytes);}});this.referenceValue=prepared.reference;return prepared;
 }
 private validate(request:FractalSourceSampleAdmission){
  const {width,height,plan,config,colorPlan,display,additionalBytes,sampleCount}=request;
  validateFractalSourcePlan(plan);validatePreparedFractalSourceColor(colorPlan);if(display)validateSourceFractalDisplayFacts(display);
  demand(plan.formula===config.formula,'分形数值计划与场景公式不一致');
  demand([width,height].every(v=>Number.isSafeInteger(v)&&v>0&&v<=16384)&&width*height<=16_000_000,'分形实际目标尺寸无效');
  demand(Number.isSafeInteger(sampleCount)&&sampleCount>=0&&sampleCount<=this.maximumSamples,'分形批次样本数量无效');
  demand(Number.isSafeInteger(additionalBytes)&&additionalBytes>=0,'分形调用方保留字节无效');
 }
 private budget(request:FractalSourceSampleAdmission,reference?:FractalSourceReferenceReady,referenceBytes=reference?.values.byteLength??16,futureCacheBytes=0){
  this.validate(request);const {width,height,plan,config,colorPlan,display,additionalBytes,sampleCount:count}=request;
  if(!this.state&&[...owners].filter(owner=>owner.state).length>=2)throw new SourceNativeError('capacity','最多保留两个分形原生资源');
  const bindings=createFractalSourceRasterBindings(plan,config,reference,colorPlan,display),paletteBytes=display&&!display.useGradientTexture?12:colorPlan.lut.byteLength;
  const pointBytes=count*8,bindingBytes=bindings.reduce((total,u)=>total+(u.kind==='sampler2d'?0:u.values.byteLength),0),copiedBytes=pointBytes+referenceBytes+paletteBytes+bindingBytes;
  const packetBytes=108+pointBytes+referenceBytes+paletteBytes+uniformBytes(bindings),targetGrowth=this.state?.width===width&&this.state.height===height?0:width*height*52;
  const textureGrowth=(this.state?.referenceBytes===referenceBytes?0:referenceBytes)+(this.state?.paletteBytes===paletteBytes?0:paletteBytes),maxSpan=Math.min(count,Math.floor(2_000_000/plan.iterations));
  const additional=additionalBytes+count*(84+(config.distance?.requested?48:0))+copiedBytes+32;
  const protocolBytes=Math.max(packetBytes*6+count*(52*3+12)+maxSpan*68+256,this.state?0:(96+programBytes/3)*6+192);
  this.peak(FractalSourceNativeSampler.held()+futureCacheBytes+(!this.state?programBytes+96:0)+targetGrowth+textureGrowth+additional+protocolBytes);
  return{bindings,referenceBytes,paletteBytes,targetGrowth,textureGrowth,additional,protocolBytes};
 }
 admit(request:FractalSourceSampleAdmission):void {
  if(this.active||this.retiring||this.closing)throw new SourceNativeError('capacity','分形原生事务或清理尚未完成');
  if(this.state?.failed)throw new SourceNativeError('state-lost','分形原生会话已失效，必须先释放');
  this.validate(request);if(request.isCancelled?.())throw new DOMException('分形采样已取消','AbortError');
  const known=this.referenceValue?.key===request.plan.key?this.referenceValue:undefined,reference=known?.kind==='ready'?known:undefined;
  const futureCacheBytes=!known&&request.plan.perturbation.enabled?request.plan.reference.length*16:0;
  this.budget(request,reference,reference?.values.byteLength??Math.max(16,futureCacheBytes),futureCacheBytes);
 }
 private async exchange(operation:SourceFractalNativeOperation,width=1,height=1){
  const state=this.state,provisional=operation.kind==='create'?programBytes:operation.kind==='sample'?(state?.pendingTarget??0)+(state?.pendingTextures??0):0;
  return exchangeSourceFractalNative({...this.next(),width,height,operation},{retainedBytes:FractalSourceNativeSampler.held()-provisional-this.protocolBytes,...(operation.kind==='sample'&&state?.width?{retainedTarget:{resource:state.resource,width:state.width,height:state.height}}:{})});
 }
 private bind(state:State,response:SourceNativeFractalResponse){
  const previous=state.identity;
  if(previous&&(previous.rendererIdentity!==response.rendererIdentity||previous.contextSerial!==response.contextSerial||previous.sessionSerial!==response.sessionSerial))throw new SourceNativeError('state-lost','分形原生资源的进程或 context 身份已变化');
  const identity={rendererIdentity:response.rendererIdentity,contextSerial:response.contextSerial,sessionSerial:response.sessionSerial,generation:response.generation,sequence:response.sequence};
  state.identity=identity;return identity;
 }
 sample(request:FractalSourceSampleRequest):Promise<GpuOrbitBatch>{
  if(this.active||this.retiring||this.closing)return Promise.reject(new SourceNativeError('capacity','分形原生事务或清理尚未完成'));
  const active=this.perform(request);this.active=active;
  return active.finally(()=>{if(this.active===active)this.active=undefined;this.transientBytes=0;this.protocolBytes=0;});
 }
 private async perform(request:FractalSourceSampleRequest):Promise<GpuOrbitBatch>{
  let submitted=false,boundaryCancelled=false;
  const check=()=>{if(this.closing||request.isCancelled?.()){boundaryCancelled=true;throw new DOMException('分形采样已取消','AbortError');}};
  try{
   check();if(this.state?.failed)throw new SourceNativeError('state-lost','分形原生会话已失效，必须先释放');
   const {points,width,height,plan,config,colorPlan,display,additionalBytes}=request;
   demand(points instanceof Float32Array&&points.buffer instanceof ArrayBuffer&&points.length%2===0&&points.length<=this.maximumSamples*2,'分形需要不超过 65536 个非共享像素坐标');
   this.validate({...request,sampleCount:points.length/2});
   for(let i=0;i<points.length;i+=2)demand(Number.isInteger(points[i])&&points[i]>=0&&points[i]<width&&Number.isInteger(points[i+1])&&points[i+1]>=0&&points[i+1]<height,'分形采样点必须在实际图像内');
   const count=points.length/2,wantsDistance=!!config.distance?.requested;
   if(!count){this.peak(FractalSourceNativeSampler.held()+additionalBytes);return this.allocate(0,wantsDistance);}
   if(!this.state&&[...owners].filter(owner=>owner.state).length>=2)throw new SourceNativeError('capacity','最多保留两个分形原生资源');
   const prepared=this.reference(plan,{isCancelled:()=>this.closing||!!request.isCancelled?.()},additionalBytes).reference,reference=prepared.kind==='ready'?prepared:undefined;
   const {bindings,referenceBytes,paletteBytes,targetGrowth,textureGrowth,additional,protocolBytes}=this.budget({...request,sampleCount:count},reference);
   this.transientBytes=additional;this.protocolBytes=protocolBytes;
   // Every mutable caller/cache upload is snapshotted before the first await.
   const nativePoints=Uint32Array.from(points),nativeReference=reference?new Float32Array(reference.values):new Float32Array(4),palette=paletteBytes===12?new Float32Array(3):new Float32Array(colorPlan.lut);
   const out=this.allocate(count,wantsDistance),maxIterations=Math.min(plan.iterations,reference?.length??2048,2048),isJulia=plan.isJulia;
   check();await ensureSourceNativeLease(new AbortController().signal);check();
   if(!this.state){
    if([...owners].filter(owner=>owner.state).length>=2)throw new SourceNativeError('capacity','最多保留两个分形原生资源');
    const state:State={resource:crypto.randomUUID().replaceAll('-',''),index:0,width:0,height:0,referenceBytes:0,paletteBytes:0,pendingTarget:0,pendingTextures:0,failed:false};this.state=state;owners.add(this);
    submitted=true;const response=await this.exchange({kind:'create',resource:state.resource,shaders:FRACTAL_SOURCE_NATIVE_SHADERS});this.bind(state,response);check();
   }
   const state=this.state;state.pendingTarget=targetGrowth;state.pendingTextures=textureGrowth;
   submitted=true;const response=await this.exchange({kind:'sample',resource:state.resource,expectedIndex:state.index,points:nativePoints,reference:nativeReference,palette,uniforms:bindings},width,height);
   const identity=this.bind(state,response);state.index=response.committedRequests;state.width=width;state.height=height;state.referenceBytes=referenceBytes;state.paletteBytes=paletteBytes;state.pendingTarget=0;state.pendingTextures=0;
   this.counters.samples+=count;this.counters.colorSamples+=count;this.counters.draws+=response.draws;this.counters.rasterDraws+=response.draws;this.counters.rasterAllocations+=response.targetAllocations;this.counters.referenceUploads+=response.referenceUploads;this.counters.colorUploads+=response.paletteUploads;
   const raw=response.records;if(!raw||raw.byteLength!==count*52)throw new SourceNativeError('protocol','分形采样记录缺失');
   const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),scratch=new Float32Array(8),z=scratch.subarray(0,4),terminal=scratch.subarray(4);
   for(let i=0;i<count;i++){
    for(let component=0;component<8;component++)scratch[component]=view.getFloat32(i*52+component*4,true);
    const facts=scatterFractalSourceRasterSample(out,i,isJulia,maxIterations,z,terminal,0,undefined,undefined,raw,i*52+32);
    this.counters.glitches+=facts.glitches;this.counters.perturbSamples+=Number(facts.startedPerturb);this.counters.ordinarySteps+=facts.ordinarySteps;this.counters.perturbSteps+=facts.perturbSteps;
   }
   this.last=identity;check();return out;
  }catch(error){if(submitted&&!boundaryCancelled&&this.state)this.state.failed=true;throw error;}
 }
 private allocate(count:number,distance:boolean):FractalSourceRasterOutput {
  try{return{values:new Float32Array(count*8),residual:new Float32Array(count*8),source:new Float32Array(count*4),sourceRGBA:new Uint8Array(count*4),...(distance?{distance:new Float32Array(count*12)}:{})};}
  catch{throw new SourceNativeError('capacity','分形采样输出分配失败');}
 }
 diagnostics():FractalSourceDiagnostics&{owned:boolean;active:boolean;cleanupPending:boolean;committedRequests:number;resources:number}{
  const reference=this.references.diagnostics(),state=this.state;
  return{...this.counters,reference:{builds:reference.builds,hits:reference.hits},retainedCpuBytes:reference.retainedBytes+(state?programBytes:0),retainedGpuBytes:state?nativeBytes(state)-programBytes:0,estimatedPeakBytes:this.peakBytes,owned:!!state,active:!!this.active,cleanupPending:!!state?.failed||!!this.retiring,committedRequests:state?.index??0,resources:[...owners].filter(owner=>owner.state).length};
 }
 execution():Extract<FractalSourceExecutionIdentity,{backend:'native'}>{const identity=this.last;if(!identity)throw new SourceNativeError('state-lost','分形还没有成功采样身份');return{backend:'native',renderer:{identity:identity.rendererIdentity,contextSerial:identity.contextSerial,sessionSerial:identity.sessionSerial}};}
 pixelRenderer(){const identity=this.last;if(!identity)throw new SourceNativeError('state-lost','分形还没有成功像素身份');return{backend:'native' as const,identity:identity.rendererIdentity,generation:identity.generation,sequence:identity.sequence,samples:0};}
 dispose():Promise<void>{
  if(this.retiring)return this.retiring;this.closing=true;
  this.retiring=(async()=>{
   await this.active?.catch(()=>{});const state=this.state;
   if(state){state.failed=true;const response=await this.exchange({kind:'release',resource:state.resource});if(response.disposition==='owned')throw new SourceNativeError('protocol','分形释放未确认');if(this.state===state)this.state=undefined;}
   this.references.dispose();this.referenceValue=undefined;this.last=undefined;owners.delete(this);
  })().finally(()=>{this.retiring=undefined;this.closing=false;});return this.retiring;
 }
}
