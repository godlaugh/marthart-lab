import {GenerationCleanupState,withGenerationCleanup} from '../engine/generationCleanup';
import type {GenerateContext,SceneDocument,SceneOutput} from '../types';
import {prepareSourceAttractorScene} from '../engine/sourceAttractorDocument';
import {composeSourceAttractorCpu,validateSourceAttractorCpuDisplay} from '../engine/sourceAttractorScene';
import {SourceAttractorCpuParticles} from '../engine/sourceAttractorCpuParticles';
import {OrdinarySourceCameraTimelineSession} from '../engine/ordinarySourceCameraTimeline';
import {sourceAttractorWorkBudget} from '../engine/sourceAttractorWork';
import {SourceAttractorGpuReplaySession} from '../engine/sourceAttractorGpuReplay';
import {ordinarySourceCameraFrame} from '../engine/ordinarySourceCamera';

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
 private constructions=0;
 reset(failures:readonly unknown[]=[]):void{this.cleanup.reset(()=>{this.gpu?.reset();this.gpu=undefined;this.timeline?.reset();this.timeline=undefined;this.particles=undefined;this.key='';this.cancelled=undefined;this.reserve=undefined;this.constructions=0;},failures);}
 diagnostics(){return{constructions:this.constructions,retainedBytes:(this.particles?.diagnostics().retainedBytes??0)+(this.gpu?.diagnostics().retainedBytes??0),workUnits:this.particles?.diagnostics().workUnits??0,gpu:this.gpu?.diagnostics()};}
 generate(scene:SceneDocument,context:GenerateContext):SceneOutput {
  this.cleanup.prepare();const started=performance.now();
  try{
   const prepared=prepareSourceAttractorScene(scene);
   const initial=ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:{time:0,frameIndex:0,camera:prepared.camera}},context);
   // Include all simulation inputs, not compiled function identity. Preserve
   // -0, which JSON's default numeric encoding would conflate with +0.
   const key=JSON.stringify([scene.id,prepared.configuration,prepared.visualConfiguration,prepared.camera,prepared.backgroundColor,
    scene.equations,scene.parameters,scene.timeline.tracks,scene.timeline.fps],(_key,value)=>typeof value==='number'?{number:Object.is(value,-0)?'-0':String(value)}:value);
   if(prepared.backend==='gpu'){
    if(key!==this.key){this.reset();this.key=key;this.gpu=new SourceAttractorGpuReplaySession({...prepared,tracks:scene.timeline.tracks,fps:scene.timeline.fps,time:context.time});}
    return this.gpu!.generate({time:context.time,viewport:initial.viewport,width:context.width,height:context.height,backgroundColor:prepared.backgroundColor,isCancelled:context.isCancelled});
   }
   const options={...prepared,tracks:scene.timeline.tracks,fps:scene.timeline.fps,time:context.time,
    viewport:initial.viewport,referencePixelDensity:context.sourcePointPixelDensity};
   validateSourceAttractorCpuDisplay(options);
   if(key!==this.key){
    this.reset();this.key=key;
    this.timeline=new OrdinarySourceCameraTimelineSession(prepared.camera,scene.timeline.tracks,scene.timeline.fps,{
     particleActions:'attractor',isCancelled:()=>this.cancelled?.()??false,
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
   this.cancelled=context.isCancelled;this.reserve=sourceAttractorWorkBudget();
   const frame=this.timeline!.evaluate(context.time);
   return composeSourceAttractorCpu(options,{frame,particles:this.particles!},started);
  }catch(error){this.reset([error]);throw error;}
  finally{this.cancelled=undefined;this.reserve=undefined;}
 }
}

/** Public direct queries remain independent; Worker/export callers supply an owner. */
export function generateSourceAttractor(scene:SceneDocument,context:GenerateContext,session?:SourceAttractorSession):SceneOutput {
 if(session)return session.generate(scene,context);
 const owner=new SourceAttractorSession();return withGenerationCleanup(()=>owner.generate(scene,context),owner);
}
