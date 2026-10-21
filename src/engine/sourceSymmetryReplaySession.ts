import type {IteratedFrameJob,IteratedField} from '../scenes/iteratedDensity';
import {IteratedDensityGpu,type IteratedGpuOptions,type IteratedGpuFacts} from './iteratedDensityGpu';
import {prepareSourceSymmetryFramePlan,prepareSourceSymmetryReplayFrame,type SourceSymmetryFramePlan} from './sourceSymmetryFramePlan';
import {sourceSymmetrySplatPixelTests} from './sourceSymmetrySplat';
import {GenerationCleanupState} from './generationCleanup';
export interface SourceSymmetryDisplayEvent {updates:readonly IteratedField[];paused:boolean;parameterChanged:boolean;cameraChanged:boolean;}
export interface SourceSymmetryDisplayFacts {
 displayIndex:number;replayed:boolean;resized:boolean;cleared:boolean;passes:number;accumulationPasses:number;
 warmupApplied:boolean;replayActive:boolean;remainingBurnInSteps:number;remainingReplaySteps:number;
 phases:readonly {kind:'update'|'display'|'replay';warmupSteps:number;iterationSteps:number;draw:boolean;resetParticles:boolean}[];
 gpu:IteratedGpuFacts;
}
/** Native helpers, restricted to the supported finite configuration domain.
 * No Java int-overflow behavior is used to bypass a local work bound. */
export function sourceSymmetryReplayBudget(remaining:number,framesLeft:number,index:number):number {
 if(!Number.isSafeInteger(remaining)||remaining<0||remaining>256||!Number.isSafeInteger(framesLeft)||!Number.isSafeInteger(index)||index<0)throw Error('Symmetry 重播预算无效');
 return remaining===0?0:index===0?(remaining>=16?2:1):Math.max(1,Math.ceil(remaining/Math.max(1,framesLeft)));
}
/** GPU lifetime of one native mobject. Edits explicitly request replay; document
 * differences do not invent events. A full reset is a new incarnation. Camera
 * capture and parameter acknowledgement belong to the calling display owner;
 * it must skip them when willReplayDisplay(targetWidth,targetHeight) is true. */
export class SourceSymmetryReplaySession {
 private readonly gpu=new IteratedDensityGpu();
 private readonly cleanup=new GenerationCleanupState();
 private initialized=false;private failed=false;private busy=false;
 private gpuFrame=0;private displayIndex=0;private passes=0;
 private warmup=false;private pending=false;private active=false;
 private remainingBurn=0;private remainingReplay=0;private replayIndex=0;private targetFrames=30;private burnBudget=8;
 private width=0;private height=0;
 /** Native MathArt.config.renderFps, independent of fixed timeline sampling. */
 constructor(private readonly renderFps:number){if(!Number.isInteger(renderFps)||renderFps< -2147483648||renderFps>2147483647)throw Error('Symmetry 宿主 renderFps 必须为 Java int');}
 get usesReplayDisplay(){return this.initialized&&(this.pending||this.active);}
 /** ensureAccumulationBuffers runs before the native replay branch and
  * cancels replay on a target resize. Callers use this for acknowledgment. */
 willReplayDisplay(width:number,height:number){
  if(![width,height].every(value=>Number.isInteger(value)&&value>0&&value<=16384))throw Error('Symmetry 显示尺寸无效');
  return this.usesReplayDisplay&&width===this.width&&height===this.height;
 }
 requestReplay(){if(this.failed||this.busy)throw Error('Symmetry 重播事件需要可用且空闲的会话');this.pending=true;this.active=false;}
 diagnostics(){return{renderFps:this.renderFps,initialized:this.initialized,failed:this.failed,displayIndex:this.displayIndex,accumulationPasses:this.passes,warmupApplied:this.warmup,replayPending:this.pending,replayActive:this.active,remainingBurnInSteps:this.remainingBurn,remainingReplaySteps:this.remainingReplay,replayFrameIndex:this.replayIndex,targetRevealFrames:this.targetFrames,burnInBudgetPerFrame:this.burnBudget,gpu:this.gpu.diagnostics()};}
 reset(failures:readonly unknown[]=[]){this.failed=true;this.cleanup.reset(()=>{this.gpu.dispose();this.initialized=false;this.gpuFrame=0;this.displayIndex=0;this.passes=0;this.warmup=false;this.pending=false;this.active=false;this.remainingBurn=0;this.remainingReplay=0;this.replayIndex=0;this.targetFrames=30;this.burnBudget=8;this.width=0;this.height=0;this.failed=false;},failures);}
 readParticles(){if(this.failed||!this.initialized)throw Error('Symmetry 粒子状态不可读');return this.gpu.readParticles();}
 readback(){if(this.failed||!this.initialized)throw Error('Symmetry 累积状态不可读');return this.gpu.readback();}
 present(...args:Parameters<IteratedDensityGpu['present']>){if(this.failed||!this.initialized)throw Error('Symmetry 累积状态不可呈现');try{return this.gpu.present(...args);}catch(error){this.failed=true;throw error;}}
 display(job:IteratedFrameJob,options:Omit<IteratedGpuOptions,'resetParticles'|'clearInk'>,event:SourceSymmetryDisplayEvent):SourceSymmetryDisplayFacts {
  this.cleanup.prepare();if(this.failed||this.busy)throw Error('Symmetry 显示需要重置失败会话');
  const cfg=job.config;
  if(job.kind!=='symmetry'||!job.symmetrySplat||!job.symmetryPalette||!cfg.sourceSymmetrySeed||!cfg.record)throw Error('Symmetry 重播需要完整源 GPU 配置与粒子绘制');
  if(!event||['paused','parameterChanged','cameraChanged'].some(key=>typeof event[key as keyof SourceSymmetryDisplayEvent]!=='boolean'))throw Error('Symmetry 显示事件无效');
  if(!Array.isArray(event.updates)||event.updates.length>2)throw Error('Symmetry 有序更新事件无效');
  const resized=this.initialized&&(options.width!==this.width||options.height!==this.height);
  // Validate steps with the ordinary producer before any GPU mutation.
  const ordinary=prepareSourceSymmetryFramePlan({frameIndex:this.displayIndex,updateCount:event.updates.length},this.warmup,cfg.burn,cfg.iterations);
  const replay=this.willReplayDisplay(options.width,options.height),starting=replay&&this.pending;
  const remaining=starting?Math.max(64,Math.min(256,cfg.burn)):this.remainingReplay;
  const frames=starting?Math.max(1,Math.floor(Math.fround(Math.fround(.5)*Math.fround(Math.max(1,this.renderFps)))+.5)):this.targetFrames;
  const burnBudget=starting?Math.min(12,Math.max(8,Math.min(64,cfg.burn))):this.burnBudget;
  const burn=replay?Math.min(starting?cfg.burn:this.remainingBurn,burnBudget):0;
  const draws=replay?Math.min(remaining,sourceSymmetryReplayBudget(remaining,frames-(starting?0:this.replayIndex),starting?0:this.replayIndex),8):1;
  const work=cfg.count*(ordinary.warmupSteps+ordinary.iterationSteps+burn+(replay?draws*cfg.iterations:0));
  const pixelWork=sourceSymmetrySplatPixelTests(job.symmetrySplat,cfg.count)*draws;
  if(!Number.isSafeInteger(work)||work>2_000_000_000||!Number.isSafeInteger(pixelWork)||pixelWork>2_000_000_000)throw Error('Symmetry 单次显示超过 20 亿工作预算');
  const retainedPasses=resized||starting||!this.initialized||!replay&&(event.cameraChanged||event.parameterChanged&&!event.paused)?0:this.passes;
  if(retainedPasses+draws>0x7fffffff||!Number.isSafeInteger(this.displayIndex+1)||!Number.isSafeInteger(this.gpuFrame+10))throw Error('Symmetry 显示计数超出容量');
  const phases:SourceSymmetryDisplayFacts['phases'][number][]=[],total:IteratedGpuFacts={bounds:{minX:-1,maxX:1,minY:-1,maxY:1},steps:0,invalid:0,accepted:0,clipped:0,sampleInvalid:0};
  const execute=(kind:'update'|'display'|'replay',plan:SourceSymmetryFramePlan,draw:boolean,resetParticles:boolean,clearInk:boolean,decay:number)=>{
   const frame=this.gpuFrame++,phase={...job,frame,symmetryUpdates:kind==='replay'?undefined:event.updates,config:{...cfg,record:draw,decay},symmetryFrame:{...plan,frameIndex:frame}};
   const result=this.gpu.step(phase,{...options,resetParticles,clearInk});total.bounds=result.bounds;total.steps+=result.steps;total.invalid+=result.invalid;
   if(draw){total.accepted+=result.accepted;total.clipped+=result.clipped;total.sampleInvalid+=result.sampleInvalid;}
   phases.push({kind,warmupSteps:plan.warmupSteps,iterationSteps:plan.iterationSteps,draw,resetParticles});
  };
  this.busy=true;
  try{
   // Native resize clears ink/count and cancels pending/active replay, but
   // leaves particle state, warmup and replay progress counters untouched.
   if(resized){this.gpu.resizeAccumulation(options.width,options.height,options.isCancelled);this.pending=false;this.active=false;this.passes=0;}
   let clear=!this.initialized||resized;
   if(!replay){
    clear||=event.cameraChanged||event.parameterChanged&&!event.paused;
    execute('display',ordinary,true,!this.initialized,clear,clear?1:cfg.decay);
    this.warmup=ordinary.warmupApplied;this.pending=false;if(clear)this.passes=0;this.passes++;
   }else{
    // update precedes display even when display will discard the old trajectory.
    if(event.updates.length){execute('update',ordinary,false,false,false,1);this.warmup=ordinary.warmupApplied;}
    if(starting){this.remainingBurn=cfg.burn;this.remainingReplay=remaining;this.replayIndex=0;this.targetFrames=frames;this.burnBudget=burnBudget;this.warmup=false;this.passes=0;this.pending=false;this.active=true;clear=true;}
    for(let i=0;i<Math.max(1,draws);i++)execute('replay',prepareSourceSymmetryReplayFrame(this.displayIndex,i===0?burn:0,i<draws?cfg.iterations:0),i<draws,starting&&i===0,clear&&i===0,1);
    this.remainingBurn-=burn;this.remainingReplay-=draws;if(draws>0)this.replayIndex++;this.passes+=draws;
    this.active=this.remainingBurn>0||this.remainingReplay>0;this.warmup=!this.active;
   }
   this.initialized=true;this.width=options.width;this.height=options.height;
   return{displayIndex:this.displayIndex++,replayed:replay,resized,cleared:clear,passes:draws,accumulationPasses:this.passes,warmupApplied:this.warmup,replayActive:this.active,remainingBurnInSteps:this.remainingBurn,remainingReplaySteps:this.remainingReplay,phases,gpu:total};
  }catch(error){this.failed=true;throw error;}finally{this.busy=false;}
 }
}
