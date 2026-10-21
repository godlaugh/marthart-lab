import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {SourceSymmetryTimelineSession} from '../src/engine/sourceSymmetryTimeline';
const F=Math.fround;
function scene(step=8e-10){
 const result=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:'Owned timeline',parameters:{lambda:.25,alpha:2,beta:.2,gamma:.1,omega:0,symmetry_degree:5},settings:{batch_size:8,burn_in_steps:0},timeline:[{type:'animate',duration:0,easing:'LINEAR',actions:[{method:'paramStart',args:{parameters:{lambda:{step,min:-1,max:1,edgeEasing:{floor:1}}}}},{method:'gradientStart',args:{speed:1}}]},{type:'wait',duration:1}]})).scene;
 result.timeline.fps=60;return result;
}
describe('owned Symmetry queue and display acknowledgement',()=>{
 it('uses the same producer for fixed frames and explicit live steps',()=>{
  const input=scene(),fixed=new SourceSymmetryTimelineSession(input),live=new SourceSymmetryTimelineSession(input);
  const initial=live.snapshot();expect(initial.frame.frameIndex).toBe(-1);expect(initial.update.calls).toEqual([]);expect(initial.parameters).toEqual({values:input.parameters,changed:false});
  for(let i=0;i<70;i++){
   const a=fixed.evaluate(i/60),b=live.step(F(1/60));
   expect({...b.frame,time:a.frame.time}).toEqual(a.frame);expect(b.parameters).toEqual(a.parameters);expect(b.palette).toEqual(a.palette);expect(b.update).toEqual(a.update);
  }
 });
 it('keeps the last ordinary display snapshot while replay skips acknowledgement',()=>{
  const owner=new SourceSymmetryTimelineSession(scene());
  const first=owner.step(F(1/60));expect(first.parameters!.changed).toBe(true);
  for(let i=0;i<4;i++){const replay=owner.step(F(1/60),{acknowledgeParameters:false});expect(replay.parameters!.changed).toBe(false);expect(replay.parameters!.values.lambda).not.toBe(first.parameters!.values.lambda);}
  const paused=owner.step(100,{paused:true});expect(paused.update.calls).toEqual([]);expect(paused.parameters!.changed).toBe(true);
  const again=owner.step(100,{paused:true});expect(again.parameters!.changed).toBe(false);expect(again.parameters!.values).toEqual(paused.parameters!.values);expect(again.palette).toEqual(paused.palette);expect(again.frame.sceneTime).toBe(paused.frame.sceneTime);
  expect(first.parameters!.values.lambda).not.toBe(paused.parameters!.values.lambda);
 });
 it('captures a display without ticking the queue or replaying the last update calls',()=>{
  const owner=new SourceSymmetryTimelineSession(scene(.001));
  const previous=owner.step(F(1/60),{acknowledgeParameters:false});
  expect(previous.update.calls.length).toBeGreaterThan(0);expect(previous.parameters!.changed).toBe(false);
  const capture=owner.display();expect(capture.frame).toEqual(previous.frame);expect(capture.update.calls).toEqual([]);
  expect(capture.parameters!.values).toEqual(previous.parameters!.values);expect(capture.parameters!.changed).toBe(true);expect(capture.palette).toEqual(previous.palette);
  expect(owner.display().parameters!.changed).toBe(false);
  const resumed=owner.step(F(1/60));expect(resumed.frame.frameIndex).toBe(previous.frame.frameIndex+1);expect(resumed.parameters!.values.lambda).toBeGreaterThan(capture.parameters!.values.lambda);
 });
 it('leaves tiny unacknowledged writes to accumulate across repeated pauses',()=>{
  const owner=new SourceSymmetryTimelineSession(scene(4e-10));owner.step(F(1/60));
  const tiny=owner.step(F(1/60));expect(tiny.parameters!.changed).toBe(false);
  for(let i=0;i<3;i++){const paused=owner.step(1,{paused:true});expect(paused.parameters!.changed).toBe(false);expect(paused.parameters!.values).toEqual(tiny.parameters!.values);}
  expect(owner.step(F(1/60)).parameters!.changed).toBe(true);
 });
 it('owns construction inputs and reconstructs a local seek before live continuation',()=>{
  const input=scene(),baseline=structuredClone(input),owner=new SourceSymmetryTimelineSession(input),fresh=new SourceSymmetryTimelineSession(baseline);
  input.parameters.lambda=99;input.palette.offset=.7;input.timeline.tracks.length=0;
  const reconstructed=owner.reconstruct(.1),fixed=fresh.evaluate(.1);
  expect({...reconstructed,frame:{...reconstructed.frame,time:fixed.frame.time}}).toEqual(fixed);
  expect(owner.step(F(1/60)).parameters).toEqual(fresh.evaluate(7/60).parameters);
  owner.reset();expect(owner.snapshot().parameters!.values).toEqual(baseline.parameters);
 });
 it('rejects mode mixing and invalid live input without leaking skipped acknowledgement',()=>{
  const owner=new SourceSymmetryTimelineSession(scene());owner.step(0);
  expect(()=>owner.evaluate(0)).toThrow('实时队列');
  const first=owner.step(0);expect(first.parameters!.changed).toBe(true);
  expect(()=>owner.step(NaN,{acknowledgeParameters:false})).toThrow();expect(owner.frameIndex).toBe(-1);
  expect(owner.step(0).parameters!.changed).toBe(true);
  expect(()=>owner.step(0,{acknowledgeParameters:0 as unknown as boolean})).toThrow('确认标记');
 });
});
