import type {IteratedFrameJob,IteratedField} from '../scenes/iteratedDensity';
import {IteratedDensityGpu,type IteratedGpuOptions,type IteratedGpuFacts} from './iteratedDensityGpu';
import {prepareSourceIterationFramePlan,prepareSourceIterationReplayFrame,type SourceIterationFramePlan} from './sourceIterationFramePlan';
import {sourceDensitySplatPixelTests} from './sourceDensitySplat';
import {GenerationCleanupState} from './generationCleanup';
import {executeSourceIteratedReplay,executeSourceIteratedReplayAsync,type SourceIteratedReplayBackend,type SourceIteratedReplayAsyncBackend,type SourceIteratedReplayBackendOptions,type SourceIteratedReplayOperation,type SourceIteratedPresentArguments,type SourceIteratedPresented} from './sourceIteratedReplayBackend';
export interface SourceIteratedDisplayEvent {updates:readonly IteratedField[];paused:boolean;parameterChanged:boolean;cameraChanged:boolean;}
export interface SourceIteratedDisplayFacts {
 displayIndex:number;replayed:boolean;resized:boolean;cleared:boolean;passes:number;accumulationPasses:number;
 warmupApplied:boolean;replayActive:boolean;remainingBurnInSteps:number;remainingReplaySteps:number;
 phases:readonly {kind:'update'|'display'|'replay';warmupSteps:number;iterationSteps:number;draw:boolean;resetParticles:boolean}[];
 gpu:IteratedGpuFacts;
}
/** Native helpers, restricted to the supported finite configuration domain.
 * No Java int-overflow behavior is used to bypass a local work bound. */
export function sourceIteratedReplayBudget(remaining:number,framesLeft:number,index:number):number {
 if(!Number.isSafeInteger(remaining)||remaining<0||remaining>256||!Number.isSafeInteger(framesLeft)||!Number.isSafeInteger(index)||index<0)throw Error('迭代场景 重播预算无效');
 return remaining===0?0:index===0?(remaining>=16?2:1):Math.max(1,Math.ceil(remaining/Math.max(1,framesLeft)));
}
export function sourceIteratedRenderFps(value:unknown):number {if(typeof value!=='number'||!Number.isInteger(value)||value< -2147483648||value>2147483647)throw Error('迭代场景 宿主 renderFps 必须为 Java int');return value;}
function checkCancelled(isCancelled?:()=>boolean){if(isCancelled?.())throw new DOMException('迭代场景显示已取消','AbortError');}
/** GPU lifetime of one native mobject. Edits explicitly request replay; document
 * differences do not invent events. A full reset is a new incarnation. Camera
 * capture and parameter acknowledgement belong to the calling display owner;
 * it must skip them when willReplayDisplay(targetWidth,targetHeight) is true. */
export class SourceIteratedReplaySession {
 private readonly gpu?:SourceIteratedReplayBackend;
 private readonly asyncBackend?:SourceIteratedReplayAsyncBackend;
 private readonly cleanup=new GenerationCleanupState();
 private inFlight?:Promise<unknown>;private resetting?:Promise<void>;private asyncRevision=0;
 private initialized=false;private failed=false;private busy=false;
 private gpuFrame=0;private displayIndex=0;private passes=0;
 private warmup=false;private pending=false;private active=false;
 private remainingBurn=0;private remainingReplay=0;private replayIndex=0;private targetFrames=30;private burnBudget=8;
 private width=0;private height=0;
 /** Native MathArt.config.renderFps, independent of fixed timeline sampling. */
 constructor(private readonly family:'map'|'symmetry',private renderFps:number,backend:SourceIteratedReplayBackendOptions={}){
  if(family!=='map'&&family!=='symmetry')throw Error('未知迭代场景');this.renderFps=sourceIteratedRenderFps(renderFps);
  if(backend.backend&&backend.asyncBackend)throw Error('迭代场景不能同时拥有两个执行后端');
  this.asyncBackend=backend.asyncBackend;this.gpu=this.asyncBackend?undefined:backend.backend??new IteratedDensityGpu();
 }
 /** Work admission delegates to the backend that owns its execution model. */
 estimateWork(job:IteratedFrameJob,resetParticles:boolean):number {
  const plan=job.iterationFrame;
  const work=this.asyncBackend?.estimateWork?.(job,resetParticles)??job.config.count*((plan?.warmupSteps??(resetParticles?job.config.burn:0))+(plan?.iterationSteps??job.config.iterations));
  if(!Number.isSafeInteger(work)||work<0)throw Error('迭代场景 后端工作预算无效');return work;
 }
 private get executing(){return this.busy||!!this.inFlight||!!this.resetting;}
 private syncBackend(){if(!this.gpu)throw Error('异步迭代场景必须使用 Async 操作');return this.gpu;}
 setRenderFps(value:number){if(this.failed||this.executing)throw Error('迭代场景 帧率更新需要可用且空闲的会话');this.renderFps=sourceIteratedRenderFps(value);}
 get usesReplayDisplay(){return this.initialized&&(this.pending||this.active);}
 /** ensureAccumulationBuffers runs before the native replay branch and
  * cancels replay on a target resize. Callers use this for acknowledgment. */
 willReplayDisplay(width:number,height:number){
  if(![width,height].every(value=>Number.isInteger(value)&&value>0&&value<=16384))throw Error('迭代场景 显示尺寸无效');
  return this.usesReplayDisplay&&width===this.width&&height===this.height;
 }
 requestReplay(){if(this.failed||this.executing)throw Error('迭代场景 重播事件需要可用且空闲的会话');this.pending=true;this.active=false;}
 diagnostics(){return{renderFps:this.renderFps,initialized:this.initialized,failed:this.failed,displayIndex:this.displayIndex,acknowledgedPhases:this.gpuFrame,inFlight:!!this.inFlight,resetting:!!this.resetting,accumulationPasses:this.passes,warmupApplied:this.warmup,replayPending:this.pending,replayActive:this.active,remainingBurnInSteps:this.remainingBurn,remainingReplaySteps:this.remainingReplay,replayFrameIndex:this.replayIndex,targetRevealFrames:this.targetFrames,burnInBudgetPerFrame:this.burnBudget,gpu:(this.asyncBackend??this.syncBackend()).diagnostics()};}
 private clear(){this.initialized=false;this.gpuFrame=0;this.displayIndex=0;this.passes=0;this.warmup=false;this.pending=false;this.active=false;this.remainingBurn=0;this.remainingReplay=0;this.replayIndex=0;this.targetFrames=30;this.burnBudget=8;this.width=0;this.height=0;this.failed=false;}
 reset(failures:readonly unknown[]=[]){const gpu=this.syncBackend();if(this.executing)throw Error('迭代场景 显示尚未结束');this.failed=true;this.cleanup.reset(()=>{gpu.dispose();this.clear();},failures);}
 /** Revoke now, wait for the submitted effect, then release this exact owner.
  * Never abort a shared native context. Failed disposal preserves all metadata
  * and backend ownership for a later explicit resetAsync retry. */
 resetAsync(failures:readonly unknown[]=[]):Promise<void>{
  if(!this.asyncBackend){try{this.reset(failures);return Promise.resolve();}catch(error){return Promise.reject(error);}}
  if(this.resetting)return this.resetting;
  this.asyncRevision++;this.failed=true;const pending=this.inFlight;
  const cleanup=(async()=>{await pending?.catch(()=>{});try{await this.asyncBackend!.dispose();}catch(error){throw new AggregateError([...failures,error],'迭代场景异步清理失败；保留所有权以便重试');}this.clear();})();
  this.resetting=cleanup;void cleanup.then(()=>{if(this.resetting===cleanup)this.resetting=undefined;},()=>{if(this.resetting===cleanup)this.resetting=undefined;});return cleanup;
 }
 validateCapture(width:number,height:number,additionalBytes:number){if(this.failed||this.executing||!this.initialized)throw Error('迭代场景 截图需要空闲的已初始化会话');(this.asyncBackend??this.syncBackend()).validateAccumulationCapture(width,height,additionalBytes);}
 private read<T>(operation:(gpu:SourceIteratedReplayBackend)=>T):T {
  const gpu=this.syncBackend();if(this.failed||this.executing||!this.initialized)throw Error('迭代场景 读取需要空闲的已初始化会话');this.busy=true;
  try{return operation(gpu);}catch(error){this.failed=true;throw error;}finally{this.busy=false;}
 }
 readParticles(){return this.read(gpu=>gpu.readParticles());}
 readback(){return this.read(gpu=>gpu.readback());}
 present(...args:SourceIteratedPresentArguments){return this.read(gpu=>gpu.present(...args));}
 private runAsync<T>(operation:(isCancelled:()=>boolean)=>Promise<T>,isCancelled?:()=>boolean):Promise<T>{
  if(!this.asyncBackend)return Promise.reject(Error('异步迭代场景缺少执行后端'));
  if(this.failed||this.executing)return Promise.reject(Error('异步迭代场景正在执行或需要显式重置'));
  const revision=this.asyncRevision,cancelled=()=>revision!==this.asyncRevision||Boolean(isCancelled?.());
  // Install inFlight before invoking an injected backend, including a backend
  // that synchronously calls back into its owner before returning a Promise.
  const pending=Promise.resolve().then(()=>{checkCancelled(cancelled);return operation(cancelled);});this.inFlight=pending;
  void pending.then(()=>{if(this.inFlight===pending)this.inFlight=undefined;},()=>{if(this.inFlight===pending)this.inFlight=undefined;});return pending;
 }
 presentAsync(tone:SourceIteratedPresentArguments[0],isCancelled?:()=>boolean,view?:SourceIteratedPresentArguments[2]):Promise<SourceIteratedPresented>{
  if(!this.initialized)return Promise.reject(Error('迭代场景 累积状态不可呈现'));
  let snapshot:{tone:typeof tone;view:typeof view};try{snapshot=structuredClone({tone,view});}catch(error){return Promise.reject(error);}
  return this.runAsync(async cancelled=>{try{const result=await this.asyncBackend!.present(snapshot.tone,snapshot.view);checkCancelled(cancelled);return result;}catch(error){this.failed=true;throw error;}},isCancelled);
 }
 display(job:IteratedFrameJob,options:Omit<IteratedGpuOptions,'resetParticles'|'clearInk'>,event:SourceIteratedDisplayEvent):SourceIteratedDisplayFacts {
  const gpu=this.syncBackend();return executeSourceIteratedReplay(this.displayOperation(job,options,event),gpu);
 }
 displayAsync(job:IteratedFrameJob,options:Omit<IteratedGpuOptions,'resetParticles'|'clearInk'>,event:SourceIteratedDisplayEvent):Promise<SourceIteratedDisplayFacts>{
  let snapshot:{job:IteratedFrameJob;event:SourceIteratedDisplayEvent};
  try{
   // parseParticleTransform owns a frozen scalar record and a pure point
   // closure over those same scalars. Retain this prepared owner, while all
   // mutable frame/parameter data is detached before the first async boundary.
   const {transform,...data}=job;
   if(!Object.isFrozen(transform)||typeof transform.point!=='function'||!['sx','sy','sz','ox','oy','oz','co','si'].every(key=>Object.prototype.hasOwnProperty.call(transform,key)&&typeof transform[key as keyof typeof transform]==='number'))throw Error('异步迭代场景需要不可变的已准备粒子变换');
   const copy=structuredClone({data,event});
   snapshot={job:{...copy.data,transform},event:copy.event};
  }catch(error){return Promise.reject(error);}
  const prepared={...options,...(options.bounds?{bounds:{...options.bounds}}:{})};
  return this.runAsync(cancelled=>executeSourceIteratedReplayAsync(this.displayOperation(snapshot.job,{...prepared,isCancelled:cancelled},snapshot.event),this.asyncBackend!),options.isCancelled);
 }
 private *displayOperation(job:IteratedFrameJob,options:Omit<IteratedGpuOptions,'resetParticles'|'clearInk'>,event:SourceIteratedDisplayEvent):SourceIteratedReplayOperation<SourceIteratedDisplayFacts> {
  this.cleanup.prepare();if(this.failed||this.busy)throw Error('迭代场景 显示需要重置失败会话');
  const cfg=job.config;
  if(job.kind!==this.family||(this.family==='symmetry'?(!job.densitySplat||!job.symmetryPalette):job.field.kind!=='map'||job.field.mathModel!=='mathart-1.7.8-gpu-v1')||!cfg.sourceInitialSeed||!cfg.record)throw Error('迭代场景 重播需要完整源 GPU 配置与粒子绘制');
  if(!event||['paused','parameterChanged','cameraChanged'].some(key=>typeof event[key as keyof SourceIteratedDisplayEvent]!=='boolean'))throw Error('迭代场景 显示事件无效');
  if(!Array.isArray(event.updates)||event.updates.length>2)throw Error('迭代场景 有序更新事件无效');
  const resized=this.initialized&&(options.width!==this.width||options.height!==this.height);
  // Validate steps with the ordinary producer before any GPU mutation.
  const ordinary=prepareSourceIterationFramePlan(this.family,{frameIndex:this.displayIndex,updateCount:event.updates.length},this.warmup,cfg.burn,cfg.iterations);
  const replay=this.willReplayDisplay(options.width,options.height),starting=replay&&this.pending;
  const remaining=starting?Math.max(64,Math.min(256,cfg.burn)):this.remainingReplay;
  const frames=starting?Math.max(1,Math.floor(Math.fround(Math.fround(.5)*Math.fround(Math.max(1,this.renderFps)))+.5)):this.targetFrames;
  const burnBudget=starting?Math.min(12,Math.max(8,Math.min(64,cfg.burn))):this.burnBudget;
  const burn=replay?Math.min(starting?cfg.burn:this.remainingBurn,burnBudget):0;
  const draws=replay?Math.min(remaining,sourceIteratedReplayBudget(remaining,frames-(starting?0:this.replayIndex),starting?0:this.replayIndex),8):1;
  const phaseJob=(plan:SourceIterationFramePlan,kind:'update'|'display'|'replay',frame=this.gpuFrame):IteratedFrameJob=>({...job,frame,iterationUpdates:kind==='replay'?undefined:event.updates,iterationFrame:{...plan,frameIndex:frame}});
  const replayPlans=replay?Array.from({length:Math.max(1,draws)},(_,i)=>prepareSourceIterationReplayFrame(this.family,this.displayIndex,i===0?burn:0,i<draws?cfg.iterations:0)):[];
  let work=!replay||event.updates.length?this.estimateWork(phaseJob(ordinary,replay?'update':'display'),!replay&&!this.initialized):0;
  for(let i=0;i<replayPlans.length;i++)work+=this.estimateWork(phaseJob(replayPlans[i],'replay'),starting&&i===0);
  const pixelWork=(job.densitySplat?sourceDensitySplatPixelTests(job.densitySplat,cfg.count):cfg.count*(Math.ceil(cfg.pointSize)+2)**2)*draws;
  if(!Number.isSafeInteger(work)||work>2_000_000_000||!Number.isSafeInteger(pixelWork)||pixelWork>2_000_000_000)throw Error('迭代场景 单次显示超过 20 亿工作预算');
  const retainedPasses=resized||starting||!this.initialized||!replay&&(event.cameraChanged||event.parameterChanged&&!event.paused)?0:this.passes;
  if(retainedPasses+draws>0x7fffffff||!Number.isSafeInteger(this.displayIndex+1)||!Number.isSafeInteger(this.gpuFrame+10))throw Error('迭代场景 显示计数超出容量');
  const phases:SourceIteratedDisplayFacts['phases'][number][]=[],total:IteratedGpuFacts={bounds:{minX:-1,maxX:1,minY:-1,maxY:1},steps:0,invalid:0,accepted:0,clipped:0,sampleInvalid:0};
  const execute=function*(this:SourceIteratedReplaySession,kind:'update'|'display'|'replay',plan:SourceIterationFramePlan,draw:boolean,resetParticles:boolean,clearInk:boolean,decay:number):SourceIteratedReplayOperation<void>{
   checkCancelled(options.isCancelled);
   const frame=this.gpuFrame,phase={...phaseJob(plan,kind,frame),config:{...cfg,record:draw,decay}};
   const result=(yield{kind:'step',job:phase,options:{...options,resetParticles,clearInk}}) as IteratedGpuFacts;
   this.gpuFrame++;total.bounds=result.bounds;total.steps+=result.steps;total.invalid+=result.invalid;
   if(draw){total.accepted+=result.accepted;total.clipped+=result.clipped;total.sampleInvalid+=result.sampleInvalid;}
   phases.push({kind,warmupSteps:plan.warmupSteps,iterationSteps:plan.iterationSteps,draw,resetParticles});
   checkCancelled(options.isCancelled);
  }.bind(this);
  this.busy=true;
  try{
   // Native resize clears ink/count and cancels pending/active replay, but
   // leaves particle state, warmup and replay progress counters untouched.
   if(resized){checkCancelled(options.isCancelled);yield{kind:'resize',width:options.width,height:options.height,isCancelled:options.isCancelled};this.pending=false;this.active=false;this.passes=0;checkCancelled(options.isCancelled);}
   let clear=!this.initialized||resized;
   if(!replay){
    clear||=event.cameraChanged||event.parameterChanged&&!event.paused;
    yield* execute('display',ordinary,true,!this.initialized,clear,clear&&this.family==='symmetry'?1:cfg.decay);
    this.warmup=ordinary.warmupApplied;this.pending=false;if(clear)this.passes=0;this.passes++;
   }else{
    // update precedes display even when display will discard the old trajectory.
    if(event.updates.length){yield* execute('update',ordinary,false,false,false,1);this.warmup=ordinary.warmupApplied;}
    if(starting){this.remainingBurn=cfg.burn;this.remainingReplay=remaining;this.replayIndex=0;this.targetFrames=frames;this.burnBudget=burnBudget;this.warmup=false;this.passes=0;this.pending=false;this.active=true;clear=true;}
    for(let i=0;i<replayPlans.length;i++)yield* execute('replay',replayPlans[i],i<draws,starting&&i===0,clear&&i===0,1);
    this.remainingBurn-=burn;this.remainingReplay-=draws;if(draws>0)this.replayIndex++;this.passes+=draws;
    this.active=this.remainingBurn>0||this.remainingReplay>0;this.warmup=!this.active;
   }
   this.initialized=true;this.width=options.width;this.height=options.height;
   return{displayIndex:this.displayIndex++,replayed:replay,resized,cleared:clear,passes:draws,accumulationPasses:this.passes,warmupApplied:this.warmup,replayActive:this.active,remainingBurnInSteps:this.remainingBurn,remainingReplaySteps:this.remainingReplay,phases,gpu:total};
  }catch(error){this.failed=true;throw error;}finally{this.busy=false;}
 }
}
