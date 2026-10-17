import type {DensityBounds,DensityProjection,GenerateContext,RootsMathConfiguration,RootsProgress,SceneDocument,SceneOutput,Settings} from '../types';
import {numberSetting} from '../engine/expression';
import {uniform} from '../engine/iteratedSeed';
import {validatePalette} from '../engine/palette';
import {prepareRootGeneration} from '../engine/rootsSampling';
import {RootsMathSession} from '../engine/rootsMathJob';
import {parseRootsMath,usesRootsNativeMath,rootMathControlVisible} from '../engine/rootsMathConfig';
import type {Complex} from '../engine/complexMath';
import {parseDensityViewport,parseDensityViewportGeometry,prepareDensityTone,toneDensityRgbaPrepared} from '../engine/density';
import {prepareRootsSplat,projectRootPoints,projectRootsMetricPoints,depositRootPoint,depositRootMetric,rootsMetricPositionIsFinite,type RootsInk,type RootsInkFacts} from '../engine/rootsInk';
import {RootsDensityGpu,RootsGpuError,rootsGpuBytes} from '../engine/rootsDensityGpu';
import {prepareRootsDensityColor,parseRootsMetricKind,parseRootsDensityColorVersion,rootsDensityScale,toneRootsMetricRgbaPrepared,ROOTS_SOURCE_TONE_FIELDS} from '../engine/rootsDensityColor';
import {rasterDimensions} from '../engine/rasterDimensions';
import {sceneAtTime} from '../engine/timeline';
import {GenerationCleanupState,withGenerationCleanup} from '../engine/generationCleanup';
export {rootsControls,rootsDefaults,visibleRootsControls,rootsControlSettings} from '../engine/rootsControls';
const MAX_BYTES=768*1024*1024,AXES:Record<DensityProjection,[number,number]>={xy:[0,1],xz:[0,2],yz:[1,2]};
const int=(s:Settings,k:string,d:number,min:number,max:number)=>{const n=numberSetting(s,k,d,min,max);if(!Number.isInteger(n))throw new Error(`${k} 必须为整数`);return n;};
const check=(c:GenerateContext)=>{if(c.isCancelled?.())throw new DOMException('渐进复根已取消','AbortError');};
/** Sampling addresses depend on the global polynomial ordinal, never chunk size. */
export function rootsUniform(seed:number,sample:number,channel:number):number {
 if(!Number.isInteger(seed)||seed<0||seed>0xffffffff||!Number.isInteger(sample)||sample<0||sample>2147483647||!Number.isInteger(channel)||channel<0||channel>512)throw new Error('复根随机地址无效');
 return uniform(seed,0,sample,channel);
}
function rootsClock(s:Settings){return{perFrame:int(s,'rootSamplesPerFrame',128,1,100000),fps:int(s,'rootSamplingFps',30,1,120),start:numberSetting(s,'rootStartTime',0,0,86400)};}
export function rootsSchedule(s:Settings,math?:RootsMathConfiguration){const native=math?.model==='mathart-1.7.8-v1'?parseRootsMath(math).sampling:undefined;return{total:native?.sampleCount??int(s,'rootTotalSamples',15000,1,2147483647),...rootsClock(s),batch:native?.batchSize??int(s,'rootBatchSize',256,1,1000000),seed:native?.seed??int(s,'seed',42,0,0xffffffff)};}
/** Prepared ordinal schedule lookup. Keep negative pre-start frames and the
 * existing epsilon/floor/clamp order; display and recording use these same facts. */
export function rootsSampleProgressAt(schedule:Pick<ReturnType<typeof rootsSchedule>,'total'|'perFrame'|'fps'|'start'>,time:number):{frame:number;attemptedSamples:number}{
 const frame=Math.min(Math.floor((time-schedule.start)*schedule.fps+1e-9),Math.ceil(schedule.total/schedule.perFrame)-1);
 return{frame,attemptedSamples:Math.min(schedule.total,Math.max(0,(frame+1)*schedule.perFrame))};
}
/** Time at which the last coefficient sample is due; this is independent of CPU wall time. */
export function rootsCompletionTime(settings:Settings,math?:RootsMathConfiguration):number{const s=rootsSchedule(settings,math);return s.start+(Math.ceil(s.total/s.perFrame)-1)/s.fps;}
const omitted=new Set(['rootsMode','sampleCount','rootBatchSize','presentation','exposure','gamma','contrast','brightness','saturation','dynamicRange','paletteMode','toneMap','transparentBackground','background','densityAccumulation','densityLifetime','densitySamplingFps','densitySampleRate','densityDecay']);
const sourcePresentationKeys=new Set<string>(ROOTS_SOURCE_TONE_FIELDS.map(f=>f.key));
function inputScene(scene:SceneDocument,source:boolean):SceneDocument{return{...scene,settings:Object.fromEntries(Object.entries(scene.settings).filter(([k])=>!omitted.has(k)&&rootMathControlVisible(scene,k)&&!(source&&sourcePresentationKeys.has(k))))}};
interface State {frame:number;fitted:boolean;ink:RootsInk;bounds:DensityBounds;progress:RootsProgress;accepted:number;clipped:number;invalidPoints:number;inputPoints:number;submittedFinitePointCount:number;}
function progress(total:number):RootsProgress{return{totalSamples:total,attemptedSamples:0,acceptedPolynomials:0,filteredSamples:0,invalidSamples:0,nonconvergentSamples:0,rootPoints:0,solverIterations:0,solverWork:0,maxResidual:null,complete:false};}
class WorkLimitError extends Error {}
/** Owns a finite ensemble, not a particle orbit. CPU or GPU ink persists; every
 * output is newly allocated and transfer-safe. Failed/cancelled requests clear
 * partially updated state. Seeking backwards deterministically replays. */
export class RootsDensitySession {
 private cleanup=new GenerationCleanupState();
 private math=new RootsMathSession();
 private key='';private state?:State;private hits=0;private gpu?:RootsDensityGpu;private gpuFailure?:{scope:string;message:string};
 private clearInk(){this.key='';this.state=undefined;this.hits=0;this.gpu?.reset();this.gpu=undefined;}
 private clear(){this.math.dispose();this.clearInk();}
 reset(failures:readonly unknown[]=[]){this.cleanup.reset(()=>{this.clear();this.gpuFailure=undefined;},failures);}
 diagnostics(){return{retainedBytes:(this.state?.ink.values.byteLength??0)+this.key.length*2+(this.gpu?.diagnostics().retainedBytes??0)+this.math.diagnostics().workspaceBytes+this.math.diagnostics().keyBytes,math:this.math.diagnostics(),frame:this.state?.frame??null,cacheHits:this.hits,attemptedSamples:this.state?.progress.attemptedSamples??0,rootPoints:this.state?.progress.rootPoints??0,inkKind:this.state?.ink.kind,submittedFinitePointCount:this.state?.submittedFinitePointCount??0,gpu:this.gpu?.diagnostics()};}
 private discard(error:unknown){this.reset([error]);}
 generate(baseScene:SceneDocument,c:GenerateContext):SceneOutput {
  this.cleanup.prepare();
  const scope=JSON.stringify({id:baseScene.id,backend:baseScene.settings.rootDensityBackend,version:baseScene.settings.rootDensityColorVersion});
  if(this.gpuFailure?.scope!==scope)this.gpuFailure=undefined;
  try{return this.run(baseScene,c);}catch(error){
   this.discard(error);
   if(error instanceof RootsGpuError&&error.failureKind==='device'){
    this.gpuFailure={scope,message:error.message};
    try{return this.run(baseScene,c);}catch(replayError){this.discard(replayError);throw replayError;}
   }
   throw error;
  }
 }
 private run(baseScene:SceneDocument,c:GenerateContext):SceneOutput {
  const started=performance.now();if(baseScene.kind!=='roots')throw new Error('渐进复根需要 Complex Roots 场景');
  if(!Number.isFinite(c.time)||c.time<0||c.time>86400)throw new Error('渐进复根时间须为 0–86400 秒');check(c);
  const requested=String(baseScene.settings.rootDensityBackend??'cpu');if(!['cpu','webgl2'].includes(requested))throw new Error('复根密度后端无效');const backend=requested==='webgl2'&&!this.gpuFailure?'webgl2':'cpu';
  const native=usesRootsNativeMath(baseScene),schedule=rootsSchedule(baseScene.settings,baseScene.rootsMath),sampleProgress=rootsSampleProgressAt(schedule,c.time);
  // This older density owner uses -1 as its pre-start cache sentinel; sample
  // ordinals still come from the shared schedule lookup used by native display.
  const targetFrame=Math.max(-1,sampleProgress.frame);
  const warnings:string[]=[],[width,height]=rasterDimensions(c,1,'cpu',warnings),current=sceneAtTime(baseScene,c.time),color=prepareRootsDensityColor(current),source=color.kind==='metric-sum',view=source?parseDensityViewportGeometry(current,width,height):parseDensityViewport(current,width,height),base=inputScene(baseScene,source);
  if(!source)validatePalette(current.palette);
  // Timeline edits conservatively replay: even presentation-only clips can move
  // the start time of later coefficient/geometry actions. Static tone edits do not.
  const key=JSON.stringify({backend,kind:base.kind,id:base.id,inkKind:color.kind,rootsMath:native?base.rootsMath:undefined,equations:native?undefined:base.equations,parameters:native?undefined:base.parameters,settings:base.settings,palette:source?undefined:base.palette,timeline:base.timeline,width,height,projection:view.projection,bounds:view.bounds,padding:view.padding});
  if(key!==this.key){this.clearInk();this.math.reset();this.key=key;}
  const initialMath=this.math.get(baseScene,{isCancelled:c.isCancelled}),maximumRoots=initialMath.maxRootCount;
  const bufferPoints=Math.min(schedule.perFrame*maximumRoots,Math.max(schedule.batch+maximumRoots,!view.bounds?schedule.perFrame*maximumRoots:0));
  if((backend==='webgl2'?rootsGpuBytes(width,height,color.kind):width*height*36+(source?1024:0))+bufferPoints*32+initialMath.workspaceCapacityBytes>MAX_BYTES){if(backend==='webgl2')throw new RootsGpuError('GPU 复根工作缓冲超过 768 MiB','capacity');throw new Error('渐进复根工作缓冲超过 768 MiB；请减少画布或每步样本数');}

  let state=this.state;this.hits=state&&state.frame<=targetFrame?1:0;if(state&&state.frame>targetFrame){state=undefined;this.math.reset();this.gpu?.reset();}
  state??={frame:-1,fitted:!!view.bounds,ink:{kind:color.kind,values:new Float64Array(backend==='cpu'?width*height*4:0)},bounds:view.bounds??{minX:-width/height,maxX:width/height,minY:-1,maxY:1},progress:progress(schedule.total),accepted:0,clipped:0,invalidPoints:0,inputPoints:0,submittedFinitePointCount:0};
  if(state.ink.kind!==color.kind)throw new Error('Root accumulation layout does not match the selected color rules');
  if(backend==='webgl2'){this.gpu??=new RootsDensityGpu();this.gpu.initialize(width,height,color.kind);}
  const s=state,[axisX,axisY]=AXES[view.projection],limit=c.quality==='export'?Number.MAX_SAFE_INTEGER:100_000_000;let requestWork=0,newFrames=0;
  const onWork=(n:number)=>{requestWork+=n;if(requestWork>limit)throw new WorkLimitError(`渐进复根单次请求超过 ${limit.toLocaleString()} 次求解操作；总采样数未缩减，请降低每步样本数或分段播放。`);};
  // Even all-filtered or constant polynomials have finite sampling overhead.
  const remaining=Math.max(0,sampleProgress.attemptedSamples-s.progress.attemptedSamples);
  if(c.quality!=='export'&&remaining>2_000_000)throw new WorkLimitError('渐进复根单次请求超过 200 万个参数样本；总采样目标未缩减，请分段播放或缩短跳转。');
  const targetSamples=sampleProgress.attemptedSamples;let lastStatus=performance.now();
  const status=()=>{check(c);c.onStatus?.({kind:'roots',attemptedSamples:s.progress.attemptedSamples,targetSamples,totalSamples:schedule.total});lastStatus=performance.now();};status();
  for(let frame=s.frame+1;frame<=targetFrame;frame++){
   // Source applicability and animation baselines consume the complete document.
   // The stripped presentation fields belong only to the cache identity.
   check(c);const time=schedule.start+frame/schedule.fps,snapshot=sceneAtTime(source?baseScene:base,time),clock=native?{...schedule,...rootsClock(snapshot.settings)}:rootsSchedule({...snapshot.settings,rootBatchSize:schedule.batch});
   if(clock.total!==schedule.total||clock.perFrame!==schedule.perFrame||clock.fps!==schedule.fps||clock.start!==schedule.start)throw new Error('渐进复根总数和采样时钟不能在运行中动画改变');
   if(parseRootsDensityColorVersion(snapshot.settings.rootDensityColorVersion)!==color.version)throw new Error('Root density color version cannot change within accumulated sampling');
   const frameColor=source?{kind:'metric-sum' as const,metric:parseRootsMetricKind(snapshot.settings.rootColor)}:{kind:'rgb-sum' as const};
   const job=prepareRootGeneration(snapshot,frameColor,this.math.get(snapshot,{isCancelled:c.isCancelled,onWork})),palette=source?undefined:validatePalette(snapshot.palette),splat=prepareRootsSplat(snapshot.settings),count=Math.min(schedule.perFrame,schedule.total-s.progress.attemptedSamples),auto=!s.fitted;
   const capacity=auto?count*job.math.maxRootCount:Math.min(count*job.math.maxRootCount,schedule.batch+job.math.maxRootCount),points=new Float64Array(capacity*4);let used=0;
   const flush=()=>{
    const ink=s.ink;
    let facts:RootsInkFacts;
    if(ink.kind==='metric-sum'){
     const metricFacts=projectRootsMetricPoints(points,used,width,height,s.bounds,view.projection,splat,(x,y,metric)=>{if(backend==='webgl2')this.gpu!.addMetric(x,y,metric,splat,c.isCancelled);else depositRootMetric(ink,width,height,x,y,metric,splat);},c.isCancelled);
     const next=s.submittedFinitePointCount+metricFacts.submittedFinitePointCount;
     if(!Number.isSafeInteger(next))throw new Error('Root submitted point count exceeds the exact integer range');
     s.submittedFinitePointCount=next;facts=metricFacts;
    }else facts=projectRootPoints(points,used,width,height,s.bounds,view.projection,palette!,splat,(x,y,rgb)=>{if(backend==='webgl2')this.gpu!.add(x,y,rgb,splat,c.isCancelled);else depositRootPoint(ink.values,width,height,x,y,rgb,splat);},c.isCancelled);
    if(backend==='webgl2')this.gpu!.flush(splat,c.isCancelled);
    s.accepted+=facts.accepted;s.clipped+=facts.clipped;s.invalidPoints+=facts.invalid;used=0;
   };
   for(let i=0;i<count;i++){
    if((i&31)===0){check(c);if(c.onStatus&&performance.now()-lastStatus>=500)status();}const ordinal=s.progress.attemptedSamples++;let channel=0;
    const legacyUniform=(index:number)=>{if(typeof clock.seed!=='number')throw new Error('Source Roots must use its owned random stream');return rootsUniform(clock.seed,ordinal,index);};
    const result=job.math.sample(ordinal,time,{sample:()=>legacyUniform(channel++),phase:()=>legacyUniform(512)*Math.PI*2},{isCancelled:c.isCancelled,onWork});
    if(result.status==='filtered'){s.progress.filteredSamples++;continue;}
    if(result.status==='invalid'){s.progress.invalidSamples++;continue;}
    if(!Number.isSafeInteger(s.progress.solverWork+result.work))throw new Error('累计求根操作数超过精确整数范围');s.progress.solverWork+=result.work;s.progress.solverIterations+=result.iterations;
    if(result.iterationLimit)s.progress.nonconvergentSamples++;
    if(!result.admitted)continue;
    s.progress.acceptedPolynomials++;
    if(result.rootCount&&result.residual!==null)s.progress.maxResidual=Math.max(s.progress.maxResidual??0,result.residual);
    const root:Complex=[0,0];
    for(let r=0;r<result.rootCount;r++){
     root[0]=result.roots[r*2];root[1]=result.roots[r*2+1];
     const admission=job.project(root,result.parameters);if(admission.kind==='filtered')continue;s.inputPoints++;if(admission.kind==='invalid'){s.invalidPoints++;continue;}const p=admission.point;const metric=job.metric(root,result.parameters);if(!source&&!Number.isFinite(metric)){s.invalidPoints++;continue;}points.set([...p,metric],used++*4);s.progress.rootPoints++;
    }
    if(!auto&&used>=schedule.batch)flush();
   }
   if(auto&&used){
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(let i=0;i<used;i++){const at=i*4;if(source&&!rootsMetricPositionIsFinite(points,at))continue;minX=Math.min(minX,points[at+axisX]);maxX=Math.max(maxX,points[at+axisX]);minY=Math.min(minY,points[at+axisY]);maxY=Math.max(maxY,points[at+axisY]);}
    if(minX!==Infinity){const cx=minX/2+maxX/2,cy=minY/2+maxY/2,aspect=width/height;let span=Math.max(maxY-minY,(maxX-minX)/aspect);if(span===0)span=Math.max(1,Math.abs(cx)*1e-6/aspect,Math.abs(cy)*1e-6);span*=1+2*view.padding;if(!Number.isFinite(span)||span<=0)throw new Error('根坐标范围无法建立有限密度视口');s.bounds={minX:cx-span*aspect/2,maxX:cx+span*aspect/2,minY:cy-span/2,maxY:cy+span/2};s.fitted=true;}
   }
   flush();s.frame=frame;newFrames++;if(c.onStatus&&performance.now()-lastStatus>=500)status();
  }
  check(c);status();s.progress.complete=s.progress.attemptedSamples===schedule.total;
  let pixels:Uint8ClampedArray,occupied=0,maxCount=0,toneBackend:'cpu'|'webgl2'='cpu';
  if(backend==='webgl2'){
   const shown=color.kind==='metric-sum'?this.gpu!.presentMetric(color,{submittedFinitePointCount:s.submittedFinitePointCount},c.isCancelled):this.gpu!.present(prepareDensityTone(current.palette,current.settings),c.isCancelled);
   pixels=shown.pixels;occupied=shown.occupiedPixels;maxCount=shown.maxCount;toneBackend=shown.toneBackend;warnings.push(...shown.warnings);warnings.push('根求解保留 CPU 双精度；GPU 仅作 float32 点密度累积与调色，累积舍入与 CPU 可能不同。');
  }else{
   pixels=color.kind==='metric-sum'?toneRootsMetricRgbaPrepared(width,height,s.ink.values,color,{submittedFinitePointCount:s.submittedFinitePointCount},c.isCancelled):toneDensityRgbaPrepared(width,height,s.ink.values,prepareDensityTone(current.palette,current.settings),c.isCancelled);
   for(let i=source?0:3;i<s.ink.values.length;i+=4){if((i&65535)===(source?0:3))check(c);if(s.ink.values[i])occupied++;maxCount=Math.max(maxCount,s.ink.values[i]);}
   if(requested==='webgl2'&&this.gpuFailure)warnings.push('GPU 复根累积不可用，已从头重放 CPU：'+this.gpuFailure.message);
  }
  if(backend==='webgl2'&&maxCount>=65536)warnings.push(`GPU 单像素最大权重 ${maxCount}；高重叠的 float32 ${source?'度量':'RGB'}累加有可见舍入差异，可选择 CPU 双精度密度复核。`);
  if(prepareRootsSplat(current.settings).kind==='soft-disc')warnings.push(source?'软圆盘使用独立像素直径；原版世界尺寸投影与 DPI 尚未等同。':'软圆盘使用独立像素直径；原版世界尺寸投影、平均度量调色与密度归一化尚未等同。');
  if(color.kind==='metric-sum'){
   warnings.push(...color.diagnostics);
   warnings.push('源复根密度采用数值度量平均和全体有限提交点归一化；投影、点核及 float64/float32 累积不保证原版逐像素一致。');
   if(baseScene.timeline.tracks.length)warnings.push('源复根密度保留本地时间线调度；旧色板动画与通用调色不作用于源颜色，修改时间线会保守重放采样。');
  }
  this.state=s;
  warnings.push(`${native?'源 Aberth–Ehrlich 与幂代换':'CPU 双精度 Durand–Kerner'}；独立 ${schedule.fps} Hz 调度，本次推进 ${newFrames} 步，完成 ${s.progress.attemptedSamples} / ${schedule.total} 个多项式样本。`);
  warnings.push(native?'源 Java 随机数与逻辑工作线程分区；按样本序号稳定重放，未复现原版线程到达顺序。源模式不以残差丢弃整组结果，maxResidual 未测量。':'残差为归一化后向误差，不保证重根或病态多项式的根位置精度；随机序列与原版 Java 工作线程不同。');
  if(s.progress.nonconvergentSamples)warnings.push(`${s.progress.nonconvergentSamples} ${native?'个多项式达到源求根迭代上限，有限近似根仍参与绘图。':'个多项式未通过残差检查，未输出其近似根。'}`);
  if(s.progress.invalidSamples)warnings.push(`${s.progress.invalidSamples} 个参数样本的多项式无效或超出双精度范围。`);
  const inputPoints=source?s.inputPoints:s.progress.rootPoints+s.invalidPoints;
  return{type:'raster',dimension:2,cameraResolved:true,backend,width,height,pixels,roots:{...s.progress,...(native?{math:{model:'mathart-1.7.8-v1' as const,solver:'aberth-ehrlich-power-substitution' as const,sampling:'java-random48-partitioned' as const,logicalWorkers:initialMath.ensemble!.workers,replayOrder:'global-ordinal' as const,residualMeasured:false as const,iterationLimitSamples:s.progress.nonconvergentSamples}}:{})},...(color.kind==='metric-sum'?{rootsColor:{version:color.version,inkKind:color.kind,metric:color.metric,submittedFinitePointCount:s.submittedFinitePointCount,exposureScale:rootsDensityScale({submittedFinitePointCount:s.submittedFinitePointCount,width,height}),accumulationPrecision:backend==='cpu'?'float64' as const:'float32' as const,toneBackend,paletteOffset:color.paletteOffset}}:{}),density:{projection:view.projection,bounds:{...s.bounds},inputPoints,examined:inputPoints,accepted:s.accepted,clipped:s.clipped,invalid:s.invalidPoints,occupiedPixels:occupied,maxCount,toneBackend,cancelled:false},temporal:{time:Math.max(0,Math.min(c.time,schedule.start+Math.max(0,s.frame)/schedule.fps)),windowStart:schedule.start,frames:s.frame+1,samplingFps:schedule.fps,recordedPoints:s.progress.rootPoints,cacheHits:this.hits},stats:{samples:s.progress.attemptedSamples,generated:s.progress.rootPoints,invalid:s.progress.invalidSamples+(native?0:s.progress.nonconvergentSamples)+s.invalidPoints,elapsedMs:performance.now()-started},warnings};
 }
}
export function generateRootsDensity(scene:SceneDocument,context:GenerateContext,session?:RootsDensitySession):SceneOutput{if(session)return session.generate(scene,context);const owner=new RootsDensitySession();return withGenerationCleanup(()=>owner.generate(scene,context),owner);}
