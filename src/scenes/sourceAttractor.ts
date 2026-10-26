import {runGenerationEffects,runGenerationEffectsAsync} from '../engine/generationEffects';
import {SourceAttractorWarmupPool,type SourceAttractorWarmupWorkerFactory} from '../engine/sourceAttractorWarmupPool';
import type {OrdinarySourceCameraFrame} from '../engine/ordinarySourceCameraTimeline';
import {GenerationCleanupState,withGenerationCleanup} from '../engine/generationCleanup';
import type {GenerateContext,SceneDocument,SceneOutput} from '../types';
import {prepareSourceAttractorScene} from '../engine/sourceAttractorDocument';
import {composeSourceAttractorCpu,validateSourceAttractorCpuDisplay} from '../engine/sourceAttractorScene';
import {SourceAttractorCpuParticles} from '../engine/sourceAttractorCpuParticles';
import {OrdinarySourceCameraTimelineSession} from '../engine/ordinarySourceCameraTimeline';
import {sourceAttractorWorkBudget} from '../engine/sourceAttractorWork';
import {SourceAttractorGpuReplaySession} from '../engine/sourceAttractorGpuReplay';
import {ordinarySourceCameraFrame} from '../engine/ordinarySourceCamera';
import {formulaPresentation} from '../engine/formulas';

/** One Worker/export lifetime owns both CPU motion and camera. Inputs are
 * validated on every request; only immutable prepared facts enter the replay.
 * Viewport/quality changes consume the same motion, backwards seeks rebuild. */
export class SourceAttractorSession {
 private key='';
 private gpu?:SourceAttractorGpuReplaySession;
 private readonly cleanup=new GenerationCleanupState();
 private timeline?:OrdinarySourceCameraTimelineSession;
 private particles?:SourceAttractorCpuParticles;
 private cancelled?:()=>boolean;
 private reserve?:(units:number)=>void;
 private constructions=0;private busy=false;private revoked=false;private active?:Promise<SceneOutput>;private resetting?:Promise<void>;
 private readonly warmupPool:SourceAttractorWarmupPool;
 constructor(private readonly options:{warmupWorkerFactory?:SourceAttractorWarmupWorkerFactory;maximumWarmupWorkers?:number}={}){this.warmupPool=new SourceAttractorWarmupPool(options.warmupWorkerFactory);}

 reset(failures:readonly unknown[]=[]):void{if(this.busy||this.resetting)throw Error('源吸引子预热尚未结束；需要 resetAsync');this.clear(failures);}
 private clear(failures:readonly unknown[]=[]):void{this.cleanup.reset(()=>{this.warmupPool.reset();this.gpu?.reset();this.gpu=undefined;this.timeline?.reset();this.timeline=undefined;this.particles=undefined;this.key='';this.cancelled=undefined;this.reserve=undefined;this.constructions=0;},failures);}
 diagnostics(){return{warmup:this.warmupPool.diagnostics(),motionWarmup:this.particles?.diagnostics().warmup,constructions:this.constructions,retainedBytes:(this.particles?.diagnostics().retainedBytes??0)+(this.gpu?.diagnostics().retainedBytes??0),workUnits:this.particles?.diagnostics().workUnits??0,gpu:this.gpu?.diagnostics()};}
 generate(scene:SceneDocument,context:GenerateContext):SceneOutput {
  this.enter();try{return runGenerationEffects(this.generateOperation(scene,context),time=>this.timeline!.evaluate(time));}finally{this.busy=false;}
 }
 generateAsync(scene:SceneDocument,context:GenerateContext):Promise<SceneOutput> {
  this.enter();const operation=runGenerationEffectsAsync(this.generateOperation(scene,context),time=>this.timeline!.evaluateAsync(time));
  const settled=operation.finally(()=>{this.busy=false;if(this.active===settled)this.active=undefined;});this.active=settled;return settled;
 }
 private enter(){if(this.busy||this.resetting)throw Error('源吸引子请求正在进行');if(this.warmupPool.diagnostics().ownedWorkers)throw Error('源吸引子预热清理未完成；需要 reset');this.cleanup.prepare();this.busy=true;this.revoked=false;}
 async settle():Promise<void>{await this.active?.then(()=>undefined,()=>undefined);}
 resetAsync():Promise<void>{
  if(this.resetting)return this.resetting;this.revoked=true;
  const operation=(async()=>{if(this.active){this.warmupPool.reset();await this.settle();}this.clear();})();
  const settled=operation.finally(()=>{if(this.resetting===settled)this.resetting=undefined;});this.resetting=settled;return settled;
 }
 private *generateOperation(scene:SceneDocument,context:GenerateContext):Generator<number,SceneOutput,OrdinarySourceCameraFrame> {
  this.cleanup.prepare();const started=performance.now();
  try{
   const prepared=prepareSourceAttractorScene(scene);
   const initial=ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:{time:0,frameIndex:0,camera:prepared.camera}},context);
   // Include all simulation inputs, not compiled function identity. Preserve
   // -0, which JSON's default numeric encoding would conflate with +0.
   const key=JSON.stringify([scene.id,prepared.configuration,prepared.visualConfiguration,prepared.camera,prepared.backgroundColor,
    scene.equations,scene.parameters,scene.timeline.tracks,scene.timeline.fps],(_key,value)=>typeof value==='number'?{number:Object.is(value,-0)?'-0':String(value)}:value);
   if(prepared.backend==='gpu'){
    if(key!==this.key){this.clear();this.key=key;this.gpu=new SourceAttractorGpuReplaySession({...prepared,tracks:scene.timeline.tracks,fps:scene.timeline.fps,time:context.time});}
    return this.gpu!.generate({time:context.time,viewport:initial.viewport,width:context.width,height:context.height,backgroundColor:prepared.backgroundColor,isCancelled:()=>this.revoked||!!context.isCancelled?.()});
   }
   // Capture and validate presentation before asynchronous warmup. Labels are
   // not motion identity; their edits must not reseed particles or replace the
   // camera subsequently paired with that same replay's tracked particle.
   const formulas=structuredClone(formulaPresentation(scene,initial.viewport));
   const options={...prepared,tracks:scene.timeline.tracks,fps:scene.timeline.fps,time:context.time,
    viewport:initial.viewport,referencePixelDensity:context.sourcePointPixelDensity};
   validateSourceAttractorCpuDisplay(options);
   if(key!==this.key){
    this.clear();this.key=key;
    this.timeline=new OrdinarySourceCameraTimelineSession(prepared.camera,scene.timeline.tracks,scene.timeline.fps,{
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
   // This request owns construction (if any), every skipped frame and the
   // final snapshot. Reuse never divides a large seek into unbounded requests.
   this.cancelled=()=>this.revoked||!!context.isCancelled?.();this.reserve=sourceAttractorWorkBudget();
   const frame=yield context.time;
   if(this.cancelled())throw Object.assign(Error('原版吸引子回放已取消'),{name:'AbortError'});
   const output=composeSourceAttractorCpu(options,{frame,particles:this.particles!},started);
   output.formulaPresentation=formulas;
   return output;
  }catch(error){if(!this.warmupPool.diagnostics().ownedWorkers)this.clear([error]);throw error;}
  finally{this.cancelled=undefined;this.reserve=undefined;}
 }
}

/** Public direct queries remain independent; Worker/export callers supply an owner. */
export function generateSourceAttractor(scene:SceneDocument,context:GenerateContext,session?:SourceAttractorSession):SceneOutput {
 if(session)return session.generate(scene,context);
 const owner=new SourceAttractorSession();return withGenerationCleanup(()=>owner.generate(scene,context),owner);
}
