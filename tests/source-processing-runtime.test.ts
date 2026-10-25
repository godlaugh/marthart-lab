import {describe,expect,it} from 'vitest';
import fixture from './fixtures/source-processing-context/runtime.json';
import {parseProjectFile} from '../src/engine/legacyImport';
import {prepareSourceCamera,resolveSourceCamera} from '../src/engine/sourceCamera';
import {OrdinarySourceCameraTimelineSession} from '../src/engine/ordinarySourceCameraTimeline';
import {SourceProcessingContext,SourceProcessingShaderContext,type SourceProcessingContextEvent,type SourceProcessingContextSnapshot} from '../src/engine/sourceProcessingContext';
import {sourceProcessingSceneInitializationEvents,sourceProcessingSceneBaseEvents,sourceProcessingSceneWorldEvents,sourceProcessingOverlayEvents} from '../src/engine/sourceProcessingSceneContext';
import {sourceProcessingAutomaticBindings} from '../src/engine/sourceProcessingAutomaticBindings';

const value=<T>(result:{ok:true;value:T}|{ok:false;error:Error}):T=>{if(!result.ok)throw result.error;return result.value;};
const words=(values:readonly number[])=>[...new Uint32Array(new Float32Array(values).buffer)];
function compare(actual:SourceProcessingContextSnapshot,expected:Record<string,number[]>|undefined){
 if(expected)for(const name of ['projection','modelview','transform','normalMatrix'] as const)expect(words(actual[name]),name).toEqual(expected[name]);
}

describe('original runtime Processing context observations',()=>{
 it.each(fixture.cases)('matches actual first-frame, timeline, overlay and scene-switch state: $name',row=>{
  const scene=parseProjectFile(JSON.stringify(row.source)).scene,camera=value(resolveSourceCamera(scene.sourceCamera));
  if(camera.kind!=='known')throw new Error(camera.reason);
  const timeline=new OrdinarySourceCameraTimelineSession(camera.state.value,scene.timeline.tracks,30,{});
  const graphics=value(SourceProcessingContext.create(row.viewport.logicalWidth,row.viewport.logicalHeight));let shader=new SourceProcessingShaderContext();
  const apply=(events:readonly SourceProcessingContextEvent[])=>{for(const event of events)value(graphics.apply(event));};
  apply([{kind:'begin-draw'},...sourceProcessingSceneInitializationEvents(),{kind:'end-draw'}]);
  try{for(const frame of row.frames){
   apply([{kind:'begin-draw'}]);
   if(frame.reinitializeScene){apply(sourceProcessingSceneInitializationEvents());shader.dispose();shader=new SourceProcessingShaderContext();timeline.reset();}
   compare(value(graphics.snapshot()),'before' in frame.contexts?frame.contexts.before:undefined);
   const calculated=timeline.step(frame.rawDt);
   expect(words([calculated.camera.phi,calculated.camera.theta,calculated.camera.gamma,calculated.camera.focalDistance,calculated.camera.zoom])).toEqual(frame.cameraBits);
   for(const pass of frame.passes){
    const {bindings}=value(sourceProcessingAutomaticBindings(pass,value(shader.bind(graphics))));
    for(const binding of bindings)expect(words(binding.values),binding.name).toEqual(pass.find(u=>u.name===binding.name)!.bits);
   }
   const prepared=value(prepareSourceCamera({...scene.sourceCamera,frame:calculated.camera},row.viewport));if(prepared.kind!=='known')throw new Error(prepared.reason);
   apply(sourceProcessingSceneBaseEvents(prepared.plan));
   if(scene.settings.sourceCameraProjection==='scene-fade-orthographic')apply(sourceProcessingOverlayEvents());
   apply(sourceProcessingSceneWorldEvents(prepared.plan));
   for(const observed of frame.world)compare(value(graphics.snapshot()),observed);
   apply([{kind:'pop-matrix'}]);expect(row.watermark).toBe(true);apply(sourceProcessingOverlayEvents());
   compare(value(graphics.snapshot()),'after' in frame.contexts?frame.contexts.after:undefined);apply([{kind:'end-draw'}]);compare(value(graphics.snapshot()),'end' in frame.contexts?frame.contexts.end:undefined);
  }}finally{shader.dispose();graphics.dispose();}
 });
});
