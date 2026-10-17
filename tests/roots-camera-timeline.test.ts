import {afterEach,describe,expect,it,vi} from 'vitest';
import type {AnimationAction,AnimationTrack,SceneDocument} from '../src/types';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import {withRootsPresentation} from '../src/engine/rootsPresentationAuthoring';
import {createAnimationTrack,resolveTimeline,sceneAtTime,timelineWarnings,validateTimelineCapacity} from '../src/engine/timeline';
import {validateTimelineCapacity as sharedCapacity} from '../src/engine/timelineCapacity';
import {RootsSceneClock} from '../src/engine/rootsSceneClock';
import {
 prepareRootsCameraTimeline,resolveRootsCameraTimeline,rootsCameraAtTime,rootsCameraTargetFrame,
 usesRootsCameraTimeline,withRootsCameraTimeline,createRootsCameraWorkBudget,ROOTS_CAMERA_FRAME_LIMIT,ROOTS_CAMERA_WORK_LIMIT,
} from '../src/engine/rootsCameraTimeline';

const F=Math.fround;
function clip(id:string,duration:number,actions?:AnimationAction[]):AnimationTrack {
 return{id,type:actions?'animate':'wait',target:actions?'camera.actions':'timeline.wait',from:0,to:0,start:0,duration,easing:'linear',enabled:true,pingPong:false,...(actions?{actions}: {})};
}
const ambient=(phiSpeed:number,thetaSpeed=0,gammaSpeed=0):AnimationAction=>({id:'ambient',method:'ambient',args:{phiSpeed,thetaSpeed,gammaSpeed}});
const zoom=(value:number):AnimationAction=>({id:'zoom',method:'zoom',args:{value}});
function scene(tracks:AnimationTrack[]=[],fps=4):SceneDocument {
 const presentation=defaultRootsPresentationConfiguration();Object.assign(presentation.camera,{phi:0,theta:0,gamma:0,zoom:1});
 const s=withRootsCameraTimeline(withRootsPresentation(createScene(definition('roots')),presentation),true);
 s.timeline={...s.timeline,duration:2,fps,tracks};return s;
}
afterEach(()=>vi.restoreAllMocks());

describe('shared Roots camera queue authoring and persistence',()=>{
 it('requires both the source presentation profile and explicit queue marker without upgrading omission',()=>{
  const s=scene([clip('wait',1)]),local=withRootsCameraTimeline(s,false),before=structuredClone(local);
  expect(usesRootsCameraTimeline(local)).toBe(false);expect(resolveTimeline(local)).toBe(local.timeline);
  expect(parseScene(JSON.stringify(persistentScene(local))).timeline.schedule).toBeUndefined();expect(local).toEqual(before);
  const dormant=structuredClone(s);dormant.rootsPresentation!.model='local-v1';expect(usesRootsCameraTimeline(dormant)).toBe(false);
  expect(resolveTimeline(dormant).schedule).toBeUndefined();expect(dormant.timeline.schedule).toBe('roots-camera-sequence-v1');
  expect(()=>withRootsCameraTimeline(dormant,true)).toThrow(/空间显示/);
 });

 it('compiles shared tracks, preserves authored baseline and serializes only authored camera data',()=>{
  const s=scene([clip('rise',1,[ambient(1)])]),before=structuredClone(s);
  const evaluated=sceneAtTime(s,.75);
  expect(evaluated.evaluatedRootsCamera?.camera.phi).toBe(.625);
  expect(evaluated.rootsPresentation!.camera).toEqual(before.rootsPresentation!.camera);
  expect(s).toEqual(before);
  const saved=persistentScene(evaluated);expect(saved).not.toHaveProperty('evaluatedRootsCamera');
  const loaded=parseScene(JSON.stringify(saved));expect(loaded.timeline).toEqual(s.timeline);expect(loaded.rootsPresentation).toEqual(s.rootsPresentation);
  expect(rootsCameraAtTime(loaded,.75).camera.phi).toBe(.625);
  const injected={...s,evaluatedRootsCamera:{camera:{phi:999}}};expect(parseScene(JSON.stringify(injected))).not.toHaveProperty('evaluatedRootsCamera');
 });

 it('uses last builder target writes and preserves action-level false as a source warning',()=>{
  const s=scene([clip('mixed',1,[ambient(1,2,3),{id:'stop',method:'stopAmbient'},
   {id:'last',method:'ambient',enabled:false,args:{phiSpeed:4,thetaSpeed:5}},zoom(2),zoom(0)])]);
  const before=structuredClone(s),p=prepareRootsCameraTimeline(s);
  expect(p.clips).toEqual([{duration:1,easing:'linear',zoom:0,rates:[4,5,0]}]);
  expect(p.warnings.join('\n')).toContain('动作级启用开关');
  expect(rootsCameraAtTime(s,0).camera).toEqual({phi:.25,theta:.3125,gamma:0,zoom:.75});expect(s).toEqual(before);
 });

 it('retains unsupported authored content visibly while only supported enabled clips enter the queue',()=>{
  const disabled=clip('disabled',100,[zoom(NaN)]);disabled.enabled=false;
  const unsupported={...clip('plane',20),type:'numeric' as const,target:'settings.rootScale',from:1,to:5};
  const mixed=clip('camera',.5,[{id:'gradient',method:'gradientStart',args:{}},ambient(1)]);mixed.start=9;mixed.repeat=3;mixed.pingPong=true;
  const s=scene([disabled,unsupported,mixed]),before=structuredClone(s),p=prepareRootsCameraTimeline(s);
  expect(p.trackIds).toEqual(['camera']);expect(p.trackIndices).toEqual([2]);expect(p.clips).toHaveLength(1);
  const warnings=timelineWarnings(s).join('\n');
  for(const text of ['numeric','gradientStart','绝对起点','重复次数','本地固定帧率'])expect(warnings).toContain(text);
  expect(s).toEqual(before);expect(rootsCameraAtTime(s,0).camera.phi).toBe(.125);
 });

 it('shares the existing total action-capacity owner and counts disabled actions on enabled clips',()=>{
  expect(validateTimelineCapacity).toBe(sharedCapacity);
  const actions=Array.from({length:64},(_,i)=>({id:String(i),method:'stopAmbient',enabled:false}));
  const s=scene(Array.from({length:64},(_,i)=>clip(String(i),.001,actions)));
  expect(()=>prepareRootsCameraTimeline(s)).toThrow(/4096/);
  s.timeline.tracks[0].enabled=false;expect(prepareRootsCameraTimeline(s).clips).toHaveLength(63);
  expect(()=>parseScene(JSON.stringify(scene(Array.from({length:64},(_,i)=>clip(String(i),.001,actions)))))).toThrow(/4096/);
 });

 it('creates only editable queue clips and leaves their initial camera untouched',()=>{
  const s=scene(),before=structuredClone(s);
  expect(createAnimationTrack(s,'animate',7)).toMatchObject({type:'animate',start:0,target:'camera.actions',actions:[{method:'ambient',args:{phiSpeed:0,thetaSpeed:.2,gammaSpeed:0}}]});
  expect(createAnimationTrack(s,'wait',7)).toMatchObject({type:'wait',start:0});
  expect(()=>createAnimationTrack(s,'numeric')).toThrow(/仅支持/);expect(s).toEqual(before);
 });
});

describe('source-derived cold camera and discrete layout',()=>{
 // Hand-derived binary fractions from retained Scene/Animation/CameraController
 // op order in .cache/roots-spatial-timeline-next.json, not production-generated.
 it('matches the independent 4-FPS ramp/stop witness including time zero as the first displayed update',()=>{
  const s=scene([clip('rise',1,[ambient(1)]),clip('stop',.5,[{id:'stop',method:'stopAmbient'}])]);
  const expected=[.0625,.1875,.375,.625,.75,.75,.75];
  for(const [index,phi] of expected.entries()){
   const value=rootsCameraAtTime(s,index/4);expect(value.camera.phi).toBe(phi);expect(value.frame).toBe(index+1);expect(value.rawDt).toBe(.25);
  }
  expect(rootsCameraAtTime(s,.25)).toEqual(rootsCameraAtTime(parseScene(JSON.stringify(s)),.25));
  expect(rootsCameraAtTime(s,1.5).queueComplete).toBe(true);
 });

 it.each([
  [24,0.0416666679084301,0.0017361112404614687],
  [30,0.03333333507180214,0.0011111112544313073],
  [60,0.01666666753590107,0.00027777781360782683],
  [120,0.008333333767950535,0.00006944445340195671],
 ])('uses the independent first LINEAR frame at %i FPS', (fps,dt,phi)=>{
  const s=scene([clip('rate',1,[ambient(1)])],fps),p=prepareRootsCameraTimeline(s),value=rootsCameraAtTime(s,0);
  expect(p.dt).toBe(dt);expect(value.rawDt).toBe(dt);expect(value.rates[0]).toBe(dt);expect(value.camera.phi).toBe(phi);
 });

 it('retains raw-dt integration and no carry across short clips instead of nominal-duration layout',()=>{
  const s=scene([clip('rise',.1,[ambient(1)]),clip('wait',.1)]);
  const first=rootsCameraAtTime(s,0),second=rootsCameraAtTime(s,.25),layout=resolveRootsCameraTimeline(s);
  expect(first).toMatchObject({activeDt:F(.2),rawDt:.25,camera:{phi:.25},finishedClip:0});
  expect(second).toMatchObject({activeDt:F(.1),rawDt:.25,camera:{phi:.5},sceneTime:F(F(.2)+F(.1)),finishedClip:1,queueComplete:true});
  expect(layout.tracks.map(t=>[t.start,t.duration])).toEqual([[0,.25],[.25,.25]]);
  expect(layout.duration).toBe(2);expect(layout.schedule).toBeUndefined();
 });

 it('preserves zero and negative zoom targets and nullable camera waits',()=>{
  const s=scene([clip('zero',.5,[zoom(0)]),clip('negative',.5,[zoom(-2)]),clip('noop',.5,[])],2);
  expect(rootsCameraAtTime(s,0).camera.zoom).toBe(0);expect(rootsCameraAtTime(s,.5).camera.zoom).toBe(-2);expect(rootsCameraAtTime(s,1).camera.zoom).toBe(-2);
  expect(parseScene(JSON.stringify(s)).timeline.tracks).toEqual(s.timeline.tracks);
 });

 it('keeps source ambient finish snapping distinct from non-target Zoom easing endpoints',()=>{
  const c=clip('return',.5,[zoom(5),ambient(2)]);c.easing='there-and-back';const s=scene([c],2),value=rootsCameraAtTime(s,0);
  expect(value.camera.zoom).toBe(1);expect(value.rates).toEqual([2,0,0]);expect(value.camera.phi).toBe(1);
 });

 it('lays out by authored array position even when IDs repeat or unsupported tracks are interleaved',()=>{
  const first=clip('same',.5),skipped={...clip('same',10),enabled:false},last=clip('same',1);
  const s=scene([first,skipped,last]),saved=parseScene(JSON.stringify(s)),layout=resolveRootsCameraTimeline(saved);
  expect(layout.tracks.map(t=>[t.start,t.duration])).toEqual([[0,.5],[0,10],[.5,1]]);
  const renamed=structuredClone(s);renamed.timeline.tracks.forEach((t,i)=>t.id='different-'+i);
  expect(resolveRootsCameraTimeline(renamed).tracks.map(t=>[t.start,t.duration])).toEqual(layout.tracks.map(t=>[t.start,t.duration]));
  expect(s.timeline.tracks.map(t=>t.start)).toEqual([0,0,0]);
 });

 it('uses exact source layout on cold and cached calls without leaking returned edits',()=>{
  const s=scene([clip('first',.017),clip('second',.023),clip('third',.041)],30),before=structuredClone(s);
  const clock=new RootsSceneClock({phi:0,theta:0,gamma:0,zoom:1},prepareRootsCameraTimeline(s).clips);
  const transitions=[];for(let index=0;index<5;index++){const f=clock.step(F(1/30));if(f.startedClip!==null)transitions.push(index/30);if(f.queueComplete)break;}
  // The source short clips occupy one, one and two display updates respectively.
  expect(transitions).toEqual([0,1/30,2/30]);
  const cold=resolveRootsCameraTimeline(s),expected=structuredClone(cold);
  expect(cold.tracks.map(t=>t.start)).toEqual([0,1/30,2/30]);expect(cold.tracks[2].duration).toBe(2/30);
  cold.tracks[0].start=999;expect(resolveRootsCameraTimeline(s)).toEqual(expected);expect(s).toEqual(before);
 });
});

describe('camera replay admission, cancellation and actual work bounds',()=>{
 it('shares deterministic per-request fold accounting with incremental sessions',()=>{
  const p=prepareRootsCameraTimeline(scene([clip('a',1),clip('b',1)])),budget=createRootsCameraWorkBudget(p);
  budget.reserveFrame(0);expect(budget.usedUnits).toBe(3);
  budget.reserveFrame(1);expect(budget.usedUnits).toBe(5);
  budget.reserveFrame(2);expect(budget.usedUnits).toBe(6);
  for(const index of [-1,3,NaN,.5])expect(()=>budget.reserveFrame(index)).toThrow(/位置/);
  expect(budget.usedUnits).toBe(6);expect(createRootsCameraWorkBudget(p).usedUnits).toBe(0);
 });
 it.each([NaN,Infinity,-Infinity,0,-1,121])('rejects invalid FPS %s at the target-frame boundary',fps=>{
  expect(()=>rootsCameraTargetFrame(0,fps)).toThrow(/帧率/);
 });
 it.each([NaN,Infinity,-1,86400.01])('rejects invalid time %s',time=>{expect(()=>rootsCameraTargetFrame(time,60)).toThrow(/时间/);});
 it('keeps the declared 24h/120FPS frame endpoint while refusing excessive synchronous replay before stepping',()=>{
  expect(rootsCameraTargetFrame(86400,120)+1).toBe(ROOTS_CAMERA_FRAME_LIMIT);
  const step=vi.spyOn(RootsSceneClock.prototype,'step');
  expect(()=>rootsCameraAtTime(scene([],120),86400)).toThrow(/工作预算/);expect(step).not.toHaveBeenCalled();
 });
 it('rejects an obviously over-domain long queue before any source frame evaluation',()=>{
  const s=scene(Array.from({length:1000},(_,i)=>clip(String(i),86400)),120),step=vi.spyOn(RootsSceneClock.prototype,'step');
  expect(()=>resolveRootsCameraTimeline(s)).toThrow(/24 小时/);expect(step).not.toHaveBeenCalled();
 });
 it('bounds actual many-clip folding work during lookup, even when target frame count alone is small',()=>{
  const s=scene(Array.from({length:1000},(_,i)=>clip(String(i),1)),120),step=vi.spyOn(RootsSceneClock.prototype,'step');
  expect(()=>rootsCameraAtTime(s,20)).toThrow(/工作预算/);
  expect(step.mock.calls.length).toBeGreaterThan(1000);expect(step.mock.calls.length).toBeLessThan(2401);
  expect(step.mock.calls.length).toBeLessThan(ROOTS_CAMERA_WORK_LIMIT);
 });
 it('cancels cold and cached layout, preserves callback failures, and does not corrupt subsequent results',()=>{
  const s=scene([clip('wait',.73)],30),before=structuredClone(s),failure=new Error('caller cancellation callback');
  let polls=0;expect(()=>resolveRootsCameraTimeline(s,{isCancelled:()=>++polls===4})).toThrow(expect.objectContaining({name:'AbortError'}));
  const expected=resolveRootsCameraTimeline(s);
  expect(()=>resolveRootsCameraTimeline(s,{isCancelled:()=>true})).toThrow(expect.objectContaining({name:'AbortError'}));
  expect(()=>resolveRootsCameraTimeline(s,{isCancelled:()=>{throw failure;}})).toThrow(failure);
  expect(resolveRootsCameraTimeline(s)).toEqual(expected);expect(s).toEqual(before);
 });
 it('cancels cold camera lookup without publishing or retaining partial state',()=>{
  const s=scene([clip('rate',1,[ambient(1)])]),before=structuredClone(s);let polls=0;
  expect(()=>rootsCameraAtTime(s,.75,()=>++polls===5)).toThrow(expect.objectContaining({name:'AbortError'}));
  expect(rootsCameraAtTime(s,.75).camera.phi).toBe(.625);expect(s).toEqual(before);
 });
});

describe('mixed scene action-work admission',()=>{
 it('counts ordered gradient children and two update phases in the shared request budget',()=>{
  const s=scene([clip('mixed',1,[{id:'a',method:'gradientStop'},{id:'b',method:'gradientStop'}])]);s.timeline.schedule='roots-scene-sequence-v1';
  const plan=prepareRootsCameraTimeline(s),budget=createRootsCameraWorkBudget(plan);budget.reserveFrame(0);expect(budget.usedUnits).toBe(10);budget.reserveFrame(1);expect(budget.usedUnits).toBe(13);
 });
 it('keeps duration layout independent of dormant gradient configuration',()=>{
  const s=scene([clip('mixed',.5,[{id:'empty',method:'gradientStart'}])]);s.timeline.schedule='roots-scene-sequence-v1';
  expect(prepareRootsCameraTimeline(s).warnings.join('\n')).toContain('没有配置');expect(rootsCameraAtTime(s,0).gradient).toMatchObject({running:false,offset:0});expect(resolveRootsCameraTimeline(s).tracks[0]).toMatchObject({start:0,duration:.5});
 });
});
