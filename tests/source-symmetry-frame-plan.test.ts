import {afterEach,describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {sceneAtTime} from '../src/engine/timeline';
import {clearSourceSymmetryTimelineCache,replaySourceSymmetryTimeline,sourceSymmetryUpdateEvent} from '../src/engine/sourceSymmetryTimeline';
import {prepareSourceSymmetryFramePlan} from '../src/engine/sourceSymmetryFramePlan';
const scene=(timeline:unknown[])=>parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:'Object cadence',settings:{batch_size:8,burn_in_steps:7},timeline})).scene;
afterEach(clearSourceSymmetryTimelineCache);
describe('source Symmetry object update and display cadence',()=>{
 it('displays an empty queue without warming or advancing particles',()=>{
  const s=scene([]);
  for(const t of [0,1,2,.5]){const snapshot=sceneAtTime(s,t),event=sourceSymmetryUpdateEvent(snapshot)!;
   expect(event).toEqual({frameIndex:Math.floor(t*s.timeline.fps),updated:false});
   expect(prepareSourceSymmetryFramePlan(event,false,7,2)).toMatchObject({objectUpdated:false,warmupSteps:0,iterationSteps:0,warmupApplied:false});
  }
 });
 it('updates on the zero-duration completion frame, then displays frozen particles',()=>{
  const s=scene([{type:'wait',duration:0}]),first=replaySourceSymmetryTimeline(s,0);
  expect(first.frame.queueComplete).toBe(true);expect(first.update.updated).toBe(true);
  const plan=prepareSourceSymmetryFramePlan(first.update,false,7,2);
  expect(plan).toMatchObject({warmupSteps:7,iterationSteps:2,warmupApplied:true});
  expect(prepareSourceSymmetryFramePlan(replaySourceSymmetryTimeline(s,1).update,plan.warmupApplied,7,2)).toMatchObject({objectUpdated:false,warmupSteps:0,iterationSteps:0,warmupApplied:true});
 });
 it('keeps the final active update and cold/warm/backward queue evaluation consistent',()=>{
  const s=scene([{type:'wait',duration:.1}]);
  const frames=Array.from({length:9},(_,i)=>replaySourceSymmetryTimeline(s,i/s.timeline.fps));
  const final=frames.findIndex(f=>f.frame.queueComplete);
  expect(final).toBeGreaterThan(0);expect(frames[final].update.updated).toBe(true);expect(frames[final+1].update.updated).toBe(false);
  let warm=false,total=0;
  for(const f of frames){const plan=prepareSourceSymmetryFramePlan(f.update,warm,7,2);warm=plan.warmupApplied;total+=plan.warmupSteps+plan.iterationSteps;}
  expect(total).toBe(7+(final+1)*2);
  for(const i of [7,0,2,8,1]){clearSourceSymmetryTimelineCache();expect(replaySourceSymmetryTimeline(s,i/s.timeline.fps)).toEqual(frames[i]);}
 });
 it('rejects unknown events and invalid source work counts',()=>{
  expect(()=>prepareSourceSymmetryFramePlan({frameIndex:-1,updated:true},false,0,1)).toThrow();
  for(const burn of [-1,.5,100001,NaN])expect(()=>prepareSourceSymmetryFramePlan({frameIndex:0,updated:true},false,burn,1)).toThrow();
  for(const n of [0,.5,17,NaN])expect(()=>prepareSourceSymmetryFramePlan({frameIndex:0,updated:true},false,0,n)).toThrow();
 });
});
