import {runGenerationEffects,runGenerationEffectsAsync} from '../engine/generationEffects';
import {SourceAttractorWarmupPool,type SourceAttractorWarmupWorkerFactory} from '../engine/sourceAttractorWarmupPool';
import type {OrdinarySourceCameraFrame} from '../engine/ordinarySourceCameraTimeline';
import {GenerationCleanupState,withGenerationCleanup} from '../engine/generationCleanup';
import type {FormulaContent,GenerateContext,SceneDocument,SceneOutput} from '../types';
import {prepareSourceAttractorScene} from '../engine/sourceAttractorDocument';
import {composeSourceAttractorCpu,validateSourceAttractorCpuDisplay} from '../engine/sourceAttractorScene';
import {SourceAttractorCpuParticles} from '../engine/sourceAttractorCpuParticles';
import {OrdinarySourceCameraTimelineSession} from '../engine/ordinarySourceCameraTimeline';
import {sourceAttractorWorkBudget} from '../engine/sourceAttractorWork';
import {SourceAttractorGpuReplaySession,type SourceAttractorGpuDisplayRequest} from '../engine/sourceAttractorGpuReplay';
import type {SourceAttractorGpuAsyncFactory} from '../engine/sourceAttractorGpuPrepared';
import {ordinarySourceCameraFrame} from '../engine/ordinarySourceCamera';
import {defaultFormulas,presentFormulas,resolveFormulaContent,validateFormulas} from '../engine/formulas';
import {sourceAttractorVariableNames} from '../engine/sourceAttractorEquation';
import {sourceAttractorPixelDensity} from '../engine/sourceAttractorImageTarget';

const identityNumber=(_key:string,value:unknown)=>typeof value==='number'?{number:Object.is(value,-0)?'-0':String(value)}:value;

/** One Worker/export lifetime owns both CPU motion and camera. Inputs are
 * validated on every request; only immutable prepared facts enter the replay.
 * Viewport/quality changes consume the same motion, backwards seeks rebuild. */
type AttractorEffect={kind:'timeline';time:number}|{kind:'gpu';request:SourceAttractorGpuDisplayRequest}|{kind:'clear';failures:readonly unknown[]};
export class SourceAttractorSession {
 private key='';
 private gpu?:SourceAttractorGpuReplaySession;
 private readonly cleanup=new GenerationCleanupState();
 private timeline?:OrdinarySourceCameraTimelineSession;
 private particles?:SourceAttractorCpuParticles;
 private formulas?:{key:string;content:FormulaContent};
 private cancelled?:()=>boolean;
 private reserve?:(units:number)=>void;
 private constructions=0;private busy=false;private revoked=false;private active?:Promise<SceneOutput>;private resetting?:Promise<void>;private cleanupFailure?:unknown;
 private readonly warmupPool:SourceAttractorWarmupPool;
 constructor(private readonly options:{warmupWorkerFactory?:SourceAttractorWarmupWorkerFactory;maximumWarmupWorkers?:number;asyncBackend?:SourceAttractorGpuAsyncFactory}={}){this.warmupPool=new SourceAttractorWarmupPool(options.warmupWorkerFactory);}

 reset(failures:readonly unknown[]=[]):void{if(this.busy||this.resetting)throw Error('源吸引子预热尚未结束；需要 resetAsync');this.clear(failures);}
 private clearState(){this.gpu=undefined;this.timeline?.reset();this.timeline=undefined;this.particles=undefined;this.formulas=undefined;this.key='';this.cancelled=undefined;this.reserve=undefined;this.constructions=0;}
 private clear(failures:readonly unknown[]=[]):void{this.cleanup.reset(()=>{this.warmupPool.reset();this.gpu?.reset();this.clearState();},failures);}
 private async clearAsync(failures:readonly unknown[]=[]):Promise<void>{
  try{this.warmupPool.reset();await this.gpu?.resetAsync();this.clearState();this.cleanupFailure=undefined;}
  catch(error){this.cleanupFailure=failures.length?new AggregateError([...failures,error],'原生吸引子清理未完成；请重试 resetAsync'):error;throw this.cleanupFailure;}
 }
 private *clearOperation(failures:readonly unknown[]=[]):Generator<AttractorEffect,void,unknown>{if(this.options.asyncBackend)yield{kind:'clear',failures};else this.clear(failures);}
 private perform(effect:AttractorEffect):unknown{switch(effect.kind){case'timeline':return this.timeline!.evaluate(effect.time);case'gpu':return this.gpu!.generate(effect.request);case'clear':return this.clear(effect.failures);}}
 private performAsync(effect:AttractorEffect):unknown|Promise<unknown>{switch(effect.kind){case'timeline':return this.timeline!.evaluateAsync(effect.time);case'gpu':return this.options.asyncBackend?this.gpu!.generateAsync(effect.request):this.gpu!.generate(effect.request);case'clear':return this.clearAsync(effect.failures);}}
 diagnostics(){return{warmup:this.warmupPool.diagnostics(),motionWarmup:this.particles?.diagnostics().warmup,constructions:this.constructions,retainedBytes:(this.particles?.diagnostics().retainedBytes??0)+(this.gpu?.diagnostics().retainedBytes??0),workUnits:this.particles?.diagnostics().workUnits??0,cleanupPending:!!this.cleanupFailure,gpu:this.gpu?.diagnostics()};}
 generate(scene:SceneDocument,context:GenerateContext):SceneOutput {
  if(this.options.asyncBackend)throw Error('源原生吸引子需要 generateAsync');this.enter();try{return runGenerationEffects(this.generateOperation(scene,context),effect=>this.perform(effect));}finally{this.busy=false;}
 }
 generateAsync(scene:SceneDocument,context:GenerateContext):Promise<SceneOutput> {
  this.enter();const operation=runGenerationEffectsAsync(this.generateOperation(scene,context),effect=>this.performAsync(effect));
  const settled=operation.finally(()=>{this.busy=false;if(this.active===settled)this.active=undefined;});this.active=settled;return settled;
 }
 private enter(){if(this.cleanupFailure)throw this.cleanupFailure;if(this.busy||this.resetting)throw Error('源吸引子请求正在进行');if(this.warmupPool.diagnostics().ownedWorkers)throw Error('源吸引子预热清理未完成；需要 reset');this.cleanup.prepare();this.busy=true;this.revoked=false;}
 async settle():Promise<void>{await this.active?.then(()=>undefined,()=>undefined);}
 resetAsync():Promise<void>{
  if(this.resetting)return this.resetting;this.revoked=true;
  const operation=(async()=>{if(this.active){this.warmupPool.reset();await this.settle();if(this.cleanupFailure)throw this.cleanupFailure;}if(this.options.asyncBackend)await this.clearAsync();else this.clear();})();
  const settled=operation.finally(()=>{if(this.resetting===settled)this.resetting=undefined;});this.resetting=settled;return settled;
 }
 private *generateOperation(scene:SceneDocument,context:GenerateContext):Generator<AttractorEffect,SceneOutput,unknown> {
  this.cleanup.prepare();const started=performance.now();
  context={...context,sourceViewport:context.sourceViewport?{...context.sourceViewport}:undefined};
  const tracks=structuredClone(scene.timeline.tracks),fps=scene.timeline.fps;
  try{
   const prepared=prepareSourceAttractorScene(scene);
   const initial=ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:{time:0,frameIndex:0,camera:prepared.camera}},context);
   // Snapshot labels before CPU warmup or GPU allocation; presentation is not
   // motion identity and must not replace the replay's tracked camera.
   const config=validateFormulas(scene.formulas??defaultFormulas());
   const formulaKey=JSON.stringify([scene.name,scene.equations,sourceAttractorVariableNames(scene.parameters),config],identityNumber);
   const formulaState=this.formulas?.key===formulaKey?this.formulas:{key:formulaKey,content:resolveFormulaContent({...scene,formulas:config})};
   const formulas=presentFormulas(formulaState.content,initial.viewport);
   // Include all simulation inputs, not compiled function identity. Preserve
   // -0, which JSON's default numeric encoding would conflate with +0.
   const key=JSON.stringify([scene.id,prepared.configuration,prepared.visualConfiguration,prepared.camera,prepared.backgroundColor,
    scene.equations,scene.parameters,tracks,fps],identityNumber);
   if(prepared.backend==='gpu'){
    const pixelDensity=sourceAttractorPixelDensity(context.sourcePointPixelDensity);
    if(key!==this.key){yield* this.clearOperation();this.key=key;this.gpu=new SourceAttractorGpuReplaySession({...prepared,tracks,fps,time:context.time},{asyncBackend:this.options.asyncBackend});}
    this.formulas=formulaState;
    const output=(yield{kind:'gpu',request:{time:context.time,viewport:initial.viewport,width:context.width,height:context.height,backgroundColor:prepared.backgroundColor,isCancelled:()=>this.revoked||!!context.isCancelled?.()}}) as SceneOutput;
    if(this.revoked||context.isCancelled?.())throw Object.assign(Error('原版吸引子回放已取消'),{name:'AbortError'});
    if(output.type!=='raster')throw Error('源 GPU 吸引子没有生成像素帧');
    if(pixelDensity!==undefined)output.sourceAttractorPixelDensity=pixelDensity;
    output.formulaPresentation=formulas;return output;
   }
   const options={...prepared,tracks,fps,time:context.time,
    viewport:initial.viewport,referencePixelDensity:context.sourcePointPixelDensity};
   validateSourceAttractorCpuDisplay(options);
   if(key!==this.key){
    yield* this.clearOperation();this.key=key;
    this.timeline=new OrdinarySourceCameraTimelineSession(prepared.camera,tracks,fps,{
     particleActions:'attractor',isCancelled:()=>this.cancelled?.()??false,
     createParticlesAsync:async()=>{
      this.particles=undefined;
      const particles=await SourceAttractorCpuParticles.createAsync({...prepared,isCancelled:()=>this.cancelled?.()??false,reserve:units=>{if(!this.reserve)throw new Error('源吸引子请求预算未绑定');this.reserve(units);}},this.warmupPool,this.options.maximumWarmupWorkers);
      this.constructions++;return this.particles=particles;
     },
     createParticles:()=>{
      this.particles=undefined;
      const particles=new SourceAttractorCpuParticles({...prepared,
       isCancelled:()=>this.cancelled?.()??false,reserve:units=>{if(!this.reserve)throw new Error('源吸引子请求预算未绑定');this.reserve(units);}});
      this.constructions++;return this.particles=particles;
     },
    });
   }
   this.formulas=formulaState;
   // This request owns construction (if any), every skipped frame and the
   // final snapshot. Reuse never divides a large seek into unbounded requests.
   this.cancelled=()=>this.revoked||!!context.isCancelled?.();this.reserve=sourceAttractorWorkBudget();
   const frame=(yield{kind:'timeline',time:context.time}) as OrdinarySourceCameraFrame;
   if(this.cancelled())throw Object.assign(Error('原版吸引子回放已取消'),{name:'AbortError'});
   const output=composeSourceAttractorCpu(options,{frame,particles:this.particles!},started);
   output.formulaPresentation=formulas;
   return output;
  }catch(error){if(this.gpu?.diagnostics().cleanupPending)this.cleanupFailure=error;else if(!this.warmupPool.diagnostics().ownedWorkers&&!this.cleanupFailure)yield* this.clearOperation([error]);throw error;}
  finally{this.cancelled=undefined;this.reserve=undefined;}
 }
}

/** Public direct queries remain independent; Worker/export callers supply an owner. */
export function generateSourceAttractor(scene:SceneDocument,context:GenerateContext,session?:SourceAttractorSession):SceneOutput {
 if(session)return session.generate(scene,context);
 const owner=new SourceAttractorSession();return withGenerationCleanup(()=>owner.generate(scene,context),owner);
}
