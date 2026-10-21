import {afterEach,describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {clearSourceSymmetryTimelineCache,replaySourceSymmetryTimeline,SourceSymmetryTimelineSession} from '../src/engine/sourceSymmetryTimeline';
import {prepareSourceSymmetryFramePlan,type SourceSymmetryUpdateEvent} from '../src/engine/sourceSymmetryFramePlan';
import native from './fixtures/symmetry/scene-dispatch.json';
const scene=(timeline:unknown[])=>parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:'Object cadence',settings:{batch_size:8,burn_in_steps:7},timeline})).scene;
const plan=(event:SourceSymmetryUpdateEvent,warm:boolean)=>prepareSourceSymmetryFramePlan({frameIndex:event.frameIndex,updateCount:event.calls.length},warm,7,2);
afterEach(clearSourceSymmetryTimelineCache);
describe('source Symmetry complete scene dispatch',()=>{
 for(const row of native.rows)it(`matches native ${row.queue}, pending=${row.pending}, replay=${row.replayActive}`,()=>{
  const s=scene(row.queue==='empty'?[]:[{type:'wait',duration:row.queue==='zero'?0:.15}]);s.timeline.fps=10;
  const owner=new SourceSymmetryTimelineSession(s);let warm=false;
  for(const expected of row.frames){
   const actual=owner.step(Math.fround(.1),{paused:expected.paused,acknowledgeParameters:!row.pending&&!row.replayActive});
   expect(actual.update.calls.map(call=>({time:call.time,dt:call.deltaTime}))).toEqual(expected.calls);
   expect(actual.frame.sceneTime).toBe(expected.sceneTime);expect(actual.frame.rawDt).toBe(expected.frameDeltaTime);
   const p=plan(actual.update,warm);expect(p.objectUpdates).toBe(expected.count);expect(p.iterationSteps).toBe(expected.count*2);expect(p.warmupSteps).toBe(expected.count&&!warm?7:0);warm=p.warmupApplied;
  }
 });
 it('keeps two parameter snapshots distinct and retains them after later frames',()=>{
  const s=scene([{type:'animate',duration:0,actions:[{method:'paramStart',args:{parameters:{gain:{min:0,max:100,step:.1,edgeEasing:{floor:1}}}}}]},{type:'wait',duration:1}]);
  const owner=new SourceSymmetryTimelineSession(s),first=owner.step(Math.fround(1/30));
  expect(first.update.calls).toHaveLength(2);expect(first.update.calls[0].parameters!.gain).not.toBe(first.update.calls[1].parameters!.gain);
  const saved=structuredClone(first.update);owner.step(.1);expect(first.update).toEqual(saved);
 });
 it('keeps fixed cold/warm/backward trajectories identical including post-completion updates',()=>{
  const s=scene([{type:'wait',duration:.1}]),frames=Array.from({length:9},(_,i)=>replaySourceSymmetryTimeline(s,i/s.timeline.fps));
  const final=frames.findIndex(f=>f.frame.queueComplete);expect(frames[final].update.calls).toHaveLength(2);expect(frames[final+1].update.calls).toHaveLength(1);
  let warm=false,total=0;for(const f of frames){const p=plan(f.update,warm);warm=p.warmupApplied;total+=p.warmupSteps+p.iterationSteps;}
  expect(total).toBe(7+2*(frames.length+final+1));
  for(const i of [7,0,2,8,1]){clearSourceSymmetryTimelineCache();expect(replaySourceSymmetryTimeline(s,i/s.timeline.fps)).toEqual(frames[i]);}
 });
 it('rejects invalid counts and capacity before GPU dispatch',()=>{
  for(const updateCount of [-1,3,.5,NaN])expect(()=>prepareSourceSymmetryFramePlan({frameIndex:0,updateCount},false,0,1)).toThrow();
  expect(()=>prepareSourceSymmetryFramePlan({frameIndex:-1,updateCount:1},false,0,1)).toThrow();
  for(const burn of [-1,.5,100001,NaN])expect(()=>prepareSourceSymmetryFramePlan({frameIndex:0,updateCount:1},false,burn,1)).toThrow();
  for(const n of [0,.5,17,NaN])expect(()=>prepareSourceSymmetryFramePlan({frameIndex:0,updateCount:1},false,0,n)).toThrow();
 });
});
