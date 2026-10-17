import {describe,it,expect} from 'vitest';
import {parseSpirographClock,prepareSpirographReplay,SPIROGRAPH_REPLAY_MAX_FRAMES} from '../src/engine/spirographReplay';
import type {SpirographReplayInput,SpirographReplayClip} from '../src/engine/spirographReplay';
import type {SpirographSourceMotionLayer} from '../src/engine/spirographModel';
const F=Math.fround;
const layer=(more:Partial<SpirographSourceMotionLayer>={}):SpirographSourceMotionLayer=>({visible:true,enabled:true,showGuides:false,autoStopOnClosure:false,speed:1,closureDegrees:360,...more});
const rotate=(id:string,duration:number,targetRate?:number,easing='linear'):SpirographReplayClip=>({id,kind:'rotate',duration,targetRate,easing});
const plan=(extra:Partial<SpirographReplayInput>={})=>prepareSpirographReplay({layers:[layer()],settings:{},clips:[rotate('ramp',1,1)],clock:{kind:'offline-fixed',fps:2},...extra});

describe('source frame queue and staged rotation',()=>{
 it('keeps omission distinct and rejects implicit clock migration',()=>{expect(parseSpirographClock(undefined)).toBeUndefined();expect(parseSpirographClock('source-frame-v1')).toBe('source-frame-v1');for(const raw of [null,'',false,'local-v1'])expect(()=>parseSpirographClock(raw)).toThrow();});
 it('updates rate before angle and holds rate after the last clip',()=>{
  const p=plan();expect(p.sample(0).rotationRadians).toBe(0);
  expect(p.sample(1)).toMatchObject({sceneTime:.5,rotationRate:.5,rotationRadians:.25,phases:[30],queueFinished:false});
  expect(p.sample(2)).toMatchObject({sceneTime:1,rotationRate:1,rotationRadians:.75,queueFinished:true,queueCompleteFrame:2});
  expect(p.sample(3)).toMatchObject({sceneTime:1.5,rotationRate:1,rotationRadians:1.25,phases:[90]});
  expect(p.sample(2).rotationRadians).not.toBe(.5);
 });
 it('does not carry a short nonfinal clip remainder into the next animation',()=>{
  const p=plan({clips:[rotate('a',.3,1),rotate('b',.3,3)]});
  expect(p.sample(1)).toMatchObject({rotationRate:1,rotationRadians:.5,sceneTime:.5,queueIndex:1});
  const last=p.sample(2);expect(last.rotationRadians).toBe(F(.5+F(3*F(.3))));expect(last.sceneTime).toBe(F(.5+F(.3)));expect(last.activeDt).toBe(F(.3));
  expect(last.clips.map(c=>[c.startFrame,c.endFrame])).toEqual([[1,1],[2,2]]);expect(last.queueCompleteFrame).toBe(2);
 });
 it('preserves nullable rate and does not force a nonmonotone endpoint',()=>{
  expect(plan({initialRate:2,clips:[rotate('nullable',1)]}).sample(2).rotationRadians).toBe(2);
  const p=plan({clips:[rotate('back',1,2,'there-and-back')]});expect(p.sample(1).rotationRate).toBe(2);expect(p.sample(2).rotationRate).toBe(0);expect(p.sample(3).rotationRate).toBe(0);
 });
 it('matches independent float accumulation at 24/30/60/120 fps',()=>{
  for(const fps of [24,30,60,120]){
   let runtime=0,time=0,angle=0,rate=0,finished=false;
   const dt=F(1/F(fps)),duration=F(.7),target=F(.123456789),p=plan({clock:{kind:'offline-fixed',fps},clips:[rotate('r',duration,target)]});
   for(let frame=1;frame<=fps;frame++){
    const active=finished?dt:Math.min(dt,Math.max(0,F(duration-runtime)));time=F(time+active);
    if(!finished){runtime=F(runtime+active);const q=Math.max(0,Math.min(1,F(runtime/duration)));rate=F(F(target)*q);finished=runtime>=duration;}
    angle=F(angle+F(rate*active));const actual=p.sample(frame);expect(actual.rotationRadians).toBe(angle);expect(actual.sceneTime).toBe(time);expect(actual.rotationRate).toBe(rate);
   }
  }
 });
 it('diagnoses actual zero-duration NaN without inventing an instant endpoint',()=>{
  expect(()=>plan({clips:[rotate('zero',0,1)]}).sample(1)).toThrow('零时长');
  expect(plan({clips:[rotate('zero',0,1),{id:'wait',kind:'wait',duration:1}]}).sample(1).rotationRate).toBe(1);
  expect(plan({initialRate:2,clips:[rotate('nullzero',0)]}).sample(1)).toMatchObject({rotationRate:2,rotationRadians:0,queueFinished:true});
  expect(plan({clips:[{id:'waitzero',kind:'wait',duration:0}]}).sample(1).queueFinished).toBe(true);
 });
});

describe('source object ordering and event lifecycle',()=>{
 it('moves only one layer per frame and does not commit elapsed on closure',()=>{
  const p=plan({layers:[layer({autoStopOnClosure:true,speed:1000}),layer({autoStopOnClosure:true,speed:1000})],clips:[]});
  expect(p.sample(1)).toMatchObject({phases:[360,0],elapsedMotionSeconds:[0,0],closed:[true,false],geometryFinished:false});
  expect(p.sample(2)).toMatchObject({phases:[360,360],geometryFinished:true,geometrySeconds:1});
 });
 it('finish-wait sees natural completion on the following frame',()=>{
  const p=plan({layers:[layer({autoStopOnClosure:true,speed:1000})],clips:[{id:'wait',kind:'finish-wait',duration:10}]});
  expect(p.sample(1)).toMatchObject({geometryFinished:true,visualFinished:true,queueFinished:false});
  expect(p.sample(2)).toMatchObject({queueFinished:true,queueCompleteFrame:2});
 });
 it('uses global fade and may reach a deadline before visual completion',()=>{
  const p=plan({layers:[layer({autoStopOnClosure:true,speed:1000}),layer({enabled:false,showGuides:true})],settings:{fadeOutStatorsOnFinish:true},clips:[{id:'wait',kind:'finish-wait',duration:10}]});
  expect(p.sample(1).visualFinished).toBe(false);expect(p.sample(2)).toMatchObject({visualFinished:true,queueFinished:false});expect(p.sample(3).queueFinished).toBe(true);
  const short=plan({layers:[layer({autoStopOnClosure:true,speed:1000,showGuides:true})],settings:{fadeOutStatorsOnFinish:true},clips:[{id:'deadline',kind:'finish-wait',duration:.1}],recording:true});
  expect(short.sample(4)).toMatchObject({frame:1,queueFinished:true,visualFinished:false,encodedFrames:0,recordingFinished:true});
 });
 it('applies only the last pending command before an update',()=>{
  const layers=[layer({autoStopOnClosure:true,speed:1})],clips=[{id:'wait',kind:'finish-wait' as const,duration:10}];
  expect(plan({layers,clips,events:[{beforeFrame:1,type:'restart'},{beforeFrame:1,type:'finish'}]}).sample(1)).toMatchObject({phases:[360],queueFinished:true,queueCompleteFrame:1});
  expect(plan({layers,clips,events:[{beforeFrame:1,type:'finish'},{beforeFrame:1,type:'restart'}]}).sample(1)).toMatchObject({phases:[30],queueFinished:false});
 });
 it('clear preserves state; restart resets motion/fades but not angle/queue',()=>{
  const p=plan({initialRate:1,clips:[],settings:{fadeInStatorsOnStart:true},events:[{beforeFrame:2,type:'clear'},{beforeFrame:3,type:'restart'}]});
  expect(p.sample(2)).toMatchObject({phases:[60],clearedPhases:[30],rotationRadians:1});
  const restart=p.sample(3);expect(restart).toMatchObject({phases:[30],clearedPhases:[0],rotationRadians:1.5,sceneTime:1.5});expect(restart.guideOpacity).toBeLessThan(1);
 });
 it('finish parks an infinite layer without falsely completing geometry',()=>{
  const p=plan({layers:[layer(),layer({autoStopOnClosure:true})],clips:[],events:[{beforeFrame:2,type:'finish'}]});
  expect(p.sample(3)).toMatchObject({phases:[30,360],geometryFinished:false,visualFinished:false,activeLayer:2});
 });
});

describe('fresh and current recording share one owned replay',()=>{
 it('advances a warmup frame and stops after the queue-completing frame',()=>{
  const p=plan({recording:true});expect(p.sample(1)).toMatchObject({encodedFrameIndex:null,encodedFrames:0,recordingFinished:false});
  expect(p.sample(2)).toMatchObject({encodedFrameIndex:0,encodedFrames:1,recordingFinished:true,rotationRadians:.75});expect(p.sample(100)).toEqual(p.sample(2));
 });
 it('forks runtime/start-rate, motion, events and angle without resetting preview',()=>{
  const p=plan({clips:[rotate('ramp',2,2)],events:[{beforeFrame:3,type:'clear'}]});const before=p.sample(1),recording=p.forkRecording(1,4);
  expect(recording.sample(0)).toMatchObject({frame:0,absoluteFrame:1,rotationRadians:.25,rotationRate:.5,clipRuntime:.5,phases:[30]});
  expect(recording.sample(1)).toMatchObject({absoluteFrame:2,sceneTime:.75,rotationRate:.75,rotationRadians:.4375,encodedFrames:0});
  expect(recording.sample(2)).toMatchObject({absoluteFrame:3,sceneTime:1,rotationRate:1,rotationRadians:.6875,phases:[60],clearedPhases:[45],encodedFrameIndex:0});
  expect(p.sample(1)).toEqual(before);expect(p.sample(2).rotationRadians).toBe(.75);
  p.dispose();expect(recording.sample(3).rotationRadians).toBe(1);
 });
 it('does not advance schedule beyond completion or poison later preview',()=>{
  const p=plan(),schedule=p.schedule(10000);expect(schedule).toMatchObject({frame:2,queueCompleteFrame:2,finished:true});expect(p.diagnostics().advancedFrames).toBe(2);
  expect(p.sample(4).rotationRadians).toBe(1.75);expect(p.schedule(10000).frame).toBe(2);
 });
 it('plans zero encoded frames only after the warmup of an already finished queue',()=>{
  const empty=plan({clips:[],recording:true});expect(empty.schedule(100)).toMatchObject({frame:1,recordingFinished:true,encodedFrames:0});
  const done=plan().forkRecording(4,2);expect(done.schedule(100)).toMatchObject({frame:1,absoluteFrame:5,recordingFinished:true,encodedFrames:0});
  expect(done.sample(0)).toMatchObject({frame:0,recordingFinished:false,rotationRadians:1.75});expect(done.schedule(100).frame).toBe(1);
 });
});

describe('retained clocks and resource ownership',()=>{
 it('uses float millis, first-frame zero dt and supplied live history',()=>{
  const p=plan({clock:{kind:'retained-millis',frames:[1000,1250,1500,2000].map(millis=>({millis}))}});
  expect(p.sample(1)).toMatchObject({rawDt:0,sceneTime:0,rotationRadians:0});expect(p.sample(4)).toMatchObject({sceneTime:1,rotationRadians:.6875});expect(()=>p.sample(5)).toThrow('millis 证据');
 });
 it('pause skips update and explicit resume excludes the pause gap',()=>{
  const p=plan({initialRate:2,clips:[],clock:{kind:'retained-millis',frames:[{millis:1000},{millis:1250},{millis:5000,paused:true},{millis:6000,resume:true},{millis:6250}]}});
  expect(p.sample(2).rotationRadians).toBe(.5);expect(p.sample(3)).toMatchObject({paused:true,rawDt:0,rotationRadians:.5});expect(p.sample(4)).toMatchObject({paused:false,rawDt:0,rotationRadians:.5});expect(p.sample(5).rotationRadians).toBe(1);
 });
 it('cancels transactionally, bounds checkpoints and releases them',()=>{
  const p=plan({clips:[]}),before=p.sample(3);let checks=0;expect(()=>p.sample(1000,()=>++checks===3)).toThrow('取消');expect(p.sample(3)).toEqual(before);
  const clean=plan({clips:[]});expect(p.sample(600)).toEqual(clean.sample(600));for(const frame of [20,60,15,80,21,599,3])p.sample(frame);
  expect(p.diagnostics().retainedCheckpoints).toBeLessThanOrEqual(6);p.dispose();expect(p.diagnostics()).toMatchObject({retainedCheckpoints:0,estimatedRetainedBytes:0,disposed:true});expect(()=>p.sample(0)).toThrow('释放');
 });
 it('bounds inputs and propagates overflow as a diagnostic',()=>{
  expect(()=>plan({clock:{kind:'offline-fixed',fps:121}})).toThrow('帧率');expect(()=>plan({clips:[rotate('long',86401,1)]})).toThrow('86400');expect(()=>plan().sample(SPIROGRAPH_REPLAY_MAX_FRAMES+1)).toThrow('容量');expect(()=>plan({initialRate:3e38,clips:[],clock:{kind:'offline-fixed',fps:1}}).sample(2)).toThrow('非有限');
 });
});
