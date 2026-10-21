import {describe,expect,it} from 'vitest';
import native from './fixtures/source-surface-scene/edits-native.json';
import {usesSourceSurfaceGeometry} from '../src/engine/sourceSurfaceIdentity';
import {parseProjectFile} from '../src/engine/legacyImport';
import {ordinarySourceCameraInitial} from '../src/engine/ordinarySourceCamera';
import {OrdinarySourceCameraTimelineSession} from '../src/engine/ordinarySourceCameraTimeline';
import {SourceSurfaceHost} from '../src/engine/sourceSurfaceHost';
import {prepareSourceSurfaceParticles} from '../src/engine/sourceSurfaceParticles';

describe('original MathArt.updateParameter on the retained Surface object',()=>{
 it('records that empty CPU point timelines still import through the local geometry path',()=>{
  const trace=native.actual.cases.find(c=>c.input.name==='hot-edit-empty-points')!;
  expect(usesSourceSurfaceGeometry(parseProjectFile(JSON.stringify(trace.input.project)).scene)).toBe(false);
 });
 for(const trace of native.actual.cases.filter(c=>c.input.name!=='hot-edit-empty-points'))it(trace.input.name,()=>{
  const scene=parseProjectFile(JSON.stringify(trace.input.project)).scene;scene.timeline.fps=10;
  const initial=ordinarySourceCameraInitial(scene)!;
  const producer=scene.surfaceSource?new SourceSurfaceHost({configuration:scene.surfaceSource,equations:scene.equations,parameters:scene.parameters,palette:scene.surfaceSourcePalette,frameRate:10,coverage:'all'}):prepareSourceSurfaceParticles(scene).create('all');
  const queue=new OrdinarySourceCameraTimelineSession(initial,scene.timeline.tracks,10,{particleActions:'surface',surfaceMode:scene.surfaceSource?.mode,createParticles:()=>producer});
  queue.snapshot();
  for(const [index,step]of trace.input.steps.entries()){
   const original=trace.frames[index],before=queue.snapshot(),label=`${trace.input.name} frame ${index}`;
   if('edit' in step&&step.edit)producer.updateParameter(step.edit.name,step.edit.value);
   expect(queue.snapshot(),`${label} direct edit retains queue`).toEqual(before);
   // The observed source method changes function values, not stored CPU dots.
   expect(original.afterEdit.firstPosition,label).toEqual(original.before.firstPosition);
   expect(original.afterEdit.sceneTime,label).toBe(original.before.sceneTime);
   expect(original.afterEdit.queueIndex,label).toBe(original.before.queueIndex);
   const frame=queue.step(step.dt,step),expected=original.updated;
   expect(frame,label).toMatchObject({sceneTime:expected.sceneTime,rawDt:expected.rawDt,queueIndex:expected.queueIndex,queueComplete:expected.queueComplete});
   for(const key of ['phi','theta','gamma','zoom','focalDistance'] as const)expect(frame.camera[key],label).toBe(expected.camera[key]);
   if(producer instanceof SourceSurfaceHost){
    expect(producer.mode,label).toBe(expected.mode.toLowerCase());
    expect(producer.generation===0,label).toBe(expected.initialObjectStillCurrent);
    const snapshot=producer.snapshot();if('gpuPoints' in snapshot)throw Error('CPU fixture');
    if(snapshot.mode==='points')expect(snapshot.points.positions[0],label).toBe(expected.firstPosition![0]);
    else{
     // This is a derived x=a+u,u=0 mesh sample from the observed native
     // function value; no native render or framebuffer was invoked.
     expect(snapshot.mesh.geometry!.positions[0],label).toBe(Math.fround(expected.value.value));
     expect(snapshot.mesh.animationTime,label).toBe(expected.objectTime);
    }
   }else expect(producer.snapshot().positions[0],label).toBe(expected.firstPosition![0]);
  }
 });
});
