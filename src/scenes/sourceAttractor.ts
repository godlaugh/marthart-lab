import type {GenerateContext,SceneDocument,SceneOutput} from '../types';
import {prepareSourceAttractorScene} from '../engine/sourceAttractorDocument';
import {composeSourceAttractorCpu,validateSourceAttractorCpuDisplay} from '../engine/sourceAttractorScene';
import {SourceAttractorCpuParticles} from '../engine/sourceAttractorCpuParticles';
import {OrdinarySourceCameraTimelineSession} from '../engine/ordinarySourceCameraTimeline';
import {sourceAttractorWorkBudget} from '../engine/sourceAttractorWork';
import {generateSourceAttractorGpu} from '../engine/sourceAttractorGpuReplay';
import {ordinarySourceCameraFrame} from '../engine/ordinarySourceCamera';

/** One Worker/export lifetime owns both CPU motion and camera. Inputs are
 * validated on every request; only immutable prepared facts enter the replay.
 * Viewport/quality changes consume the same motion, backwards seeks rebuild. */
export class SourceAttractorSession {
 private key='';
 private timeline?:OrdinarySourceCameraTimelineSession;
 private particles?:SourceAttractorCpuParticles;
 private cancelled?:()=>boolean;
 private reserve?:(units:number)=>void;
 private constructions=0;
 reset():void{this.timeline?.reset();this.timeline=undefined;this.particles=undefined;this.key='';this.cancelled=undefined;this.reserve=undefined;this.constructions=0;}
 diagnostics(){return{constructions:this.constructions,retainedBytes:this.particles?.diagnostics().retainedBytes??0,workUnits:this.particles?.diagnostics().workUnits??0};}
 generate(scene:SceneDocument,context:GenerateContext):SceneOutput {
  const started=performance.now();
  try{
   const prepared=prepareSourceAttractorScene(scene);
   const initial=ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:{time:0,frameIndex:0,camera:prepared.camera}},context);
   if(prepared.backend==='gpu'){
    this.reset();
    return generateSourceAttractorGpu({...prepared,tracks:scene.timeline.tracks,fps:scene.timeline.fps,time:context.time,
     viewport:initial.viewport,width:context.width,height:context.height,isCancelled:context.isCancelled});
   }
   const options={...prepared,tracks:scene.timeline.tracks,fps:scene.timeline.fps,time:context.time,
    viewport:initial.viewport,referencePixelDensity:context.sourcePointPixelDensity};
   validateSourceAttractorCpuDisplay(options);
   // Include all simulation inputs, not compiled function identity. Preserve
   // -0, which JSON's default numeric encoding would conflate with +0.
   const key=JSON.stringify([scene.id,prepared.configuration,prepared.visualConfiguration,prepared.camera,prepared.backgroundColor,
    scene.equations,scene.parameters,scene.timeline.tracks,scene.timeline.fps],(_key,value)=>typeof value==='number'?{number:Object.is(value,-0)?'-0':String(value)}:value);
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
  }catch(error){this.reset();throw error;}
  finally{this.cancelled=undefined;this.reserve=undefined;}
 }
}

/** Public direct queries remain independent; Worker/export callers supply an owner. */
export function generateSourceAttractor(scene:SceneDocument,context:GenerateContext,session=new SourceAttractorSession()):SceneOutput {
 return session.generate(scene,context);
}
