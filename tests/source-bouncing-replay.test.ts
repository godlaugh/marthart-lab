import {describe,it,expect} from 'vitest';
import {parseSourceBouncingCheckpoint,sourceBouncingSeedCheckpoint,stepSourceBouncingRealtime,resetSourceBouncingRenderClock,planSourceBouncingFixedReplay,planSourceBouncingRecording,SOURCE_BOUNCING_REPLAY_LIMITS,type SourceBouncingCheckpoint} from '../src/engine/sourceBouncingReplay';
import type {SourceBouncingResult} from '../src/engine/sourceBouncingConfig';
const F=Math.fround;
function value<T>(result:SourceBouncingResult<T>):T{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;}
const seed=sourceBouncingSeedCheckpoint();
const fixed=(updates:number,fps=60)=>value(planSourceBouncingFixedReplay({updates,fps})).checkpoint;
const kind=(result:SourceBouncingResult<unknown>)=>result.ok?'unexpected success':result.error.kind;
describe('native Bouncing explicit frame and recording clock',()=>{
 it('distinguishes seed, first realtime dt0, first fixed frame, and paused display',()=>{
  expect(seed).toMatchObject({simulationUpdates:0,sceneTime:0});expect(Object.isFrozen(seed)).toBe(true);
  const realtime=value(stepSourceBouncingRealtime(seed,{deltaTime:0,paused:false}));
  expect(realtime).toMatchObject({simulationUpdates:1,sceneTime:0});
  expect(fixed(1)).toMatchObject({simulationUpdates:1,sceneTime:F(1/60)});
  expect(value(stepSourceBouncingRealtime(seed,{deltaTime:NaN,paused:true}))).toEqual(seed);
  expect(value(stepSourceBouncingRealtime(realtime,{deltaTime:1,paused:true}))).toEqual(realtime);
 });
 it('narrowly accumulates raw realtime dt and advances once independently of elapsed seconds',()=>{
  let state=seed;
  for(const deltaTime of [.1,.2,0,100])state=value(stepSourceBouncingRealtime(state,{deltaTime,paused:false}));
  expect(state).toMatchObject({simulationUpdates:4,sceneTime:F(F(F(.1)+F(.2))+100)});
  expect(value(stepSourceBouncingRealtime(state,{deltaTime:0,paused:false})).simulationUpdates).toBe(5);
 });
 it('replays an absolute update target deterministically from seed or a matching earlier checkpoint',()=>{
  const direct=value(planSourceBouncingFixedReplay({updates:100,fps:60}));
  const resumed=value(planSourceBouncingFixedReplay({from:fixed(37),updates:100,fps:60}));
  expect(resumed.checkpoint).toEqual(direct.checkpoint);expect(resumed.advancedUpdates).toBe(63);
  expect(value(planSourceBouncingFixedReplay({from:direct.checkpoint,updates:100,fps:60})).advancedUpdates).toBe(0);
  expect(kind(planSourceBouncingFixedReplay({from:direct.checkpoint,updates:99,fps:60}))).toBe('input');
  expect(fixed(0)).toEqual(seed);
 });
 it('setRenderMode resets only time and recording preserves the starting physical index',()=>{
  const from=fixed(17),reset=value(resetSourceBouncingRenderClock(from));
  expect(reset).toMatchObject({simulationUpdates:17,sceneTime:0});expect(from.sceneTime).not.toBe(0);
  const plan=value(planSourceBouncingRecording({from,fps:30,recordDuration:1}));
  expect(plan.start).toEqual(reset);expect(plan.warmup).toMatchObject({simulationUpdates:18,sceneTime:F(1/30)});
  expect(plan.frames[0]).toMatchObject({simulationUpdates:19,sceneTime:F(F(1/30)+F(1/30))});
  expect(plan.end).toMatchObject({simulationUpdates:47,sceneTime:1.0000003576278687});
  expect(plan.frames).toHaveLength(29);expect(Object.isFrozen(plan.frames)).toBe(true);
  const resumed=value(stepSourceBouncingRealtime(plan.end,{deltaTime:0,paused:false}));
  expect(resumed).toMatchObject({simulationUpdates:48,sceneTime:plan.end.sceneTime});
 });
 // Expected values independently evaluated with Python struct binary32 operations,
 // applying the retained Scene float division/addition and post-record comparison.
 it.each([
  [60,1,60,61,1.0166664123535156],
  [30,1,29,30,1.0000003576278687],
  [24,10,239,240,10.00000286102295],
  [60,F(.1),5,6,0.10000000149011612],
  [1,F(.1),1,2,2],
  [29.97,1,29,30,1.0010008811950684],
 ])('matches source F32 stopping at fps=%s duration=%s',(fps,recordDuration,encoded,updates,time)=>{
  const plan=value(planSourceBouncingRecording({from:seed,fps,recordDuration}));
  expect(plan.frames).toHaveLength(encoded);expect(plan.end.simulationUpdates).toBe(updates);expect(plan.end.sceneTime).toBe(time);
  expect(plan.frames.at(-1)).toEqual(plan.end);
 });
 it('revalidates transport facts without deriving physical updates from their time',()=>{
  const realtime=value(stepSourceBouncingRealtime(seed,{deltaTime:0,paused:false}));
  expect(value(parseSourceBouncingCheckpoint(JSON.parse(JSON.stringify(realtime))))).toEqual(realtime);
  const reset=value(resetSourceBouncingRenderClock(fixed(500)));
  expect(value(parseSourceBouncingCheckpoint(JSON.parse(JSON.stringify(reset))))).toEqual(reset);
  for(const raw of [null,[],{}, {...seed,extra:1},{...seed,model:'local'},{...seed,simulationUpdates:-1},{...seed,simulationUpdates:1.5},{...seed,sceneTime:1},{...realtime,sceneTime:.1},{...realtime,sceneTime:-1}])expect(kind(parseSourceBouncingCheckpoint(raw))).toBe('input');
  for(const sceneTime of [Infinity,NaN])expect(kind(parseSourceBouncingCheckpoint({...realtime,sceneTime}))).toBe('nonfinite');
 });
 it('rejects excessive complete work rather than returning truncated recording or replay plans',()=>{
  expect(fixed(10000).simulationUpdates).toBe(SOURCE_BOUNCING_REPLAY_LIMITS.maxUpdates);
  expect(kind(planSourceBouncingFixedReplay({updates:10001,fps:60}))).toBe('capacity');
  expect(kind(stepSourceBouncingRealtime(fixed(10000),{deltaTime:0,paused:false}))).toBe('capacity');
  expect(value(stepSourceBouncingRealtime(fixed(10000),{deltaTime:0,paused:true})).simulationUpdates).toBe(10000);
  expect(kind(planSourceBouncingRecording({from:fixed(9999),fps:1,recordDuration:F(.1)}))).toBe('capacity');
  expect(value(planSourceBouncingRecording({from:fixed(9998),fps:1,recordDuration:F(.1)})).end.simulationUpdates).toBe(10000);
  expect(kind(planSourceBouncingRecording({from:seed,fps:60,recordDuration:1000}))).toBe('capacity');
 });
 it('reports cancellation before planning and within fixed/recording loops',()=>{
  const options={isCancelled:()=>true};
  expect(kind(stepSourceBouncingRealtime(seed,{deltaTime:0,paused:true},options))).toBe('cancelled');
  expect(kind(resetSourceBouncingRenderClock(seed,options))).toBe('cancelled');
  for(const mode of ['fixed','record'] as const){let checks=0;const during={isCancelled:()=>++checks===8};
   const result=mode==='fixed'?planSourceBouncingFixedReplay({updates:100,fps:60},during):planSourceBouncingRecording({from:seed,fps:60,recordDuration:1},during);
   expect(kind(result)).toBe('cancelled');expect(checks).toBe(8);
  }
 });
 it('rejects unusable scheduling numbers and Float32 overflow explicitly',()=>{
  for(const fps of [0,-1,NaN,Infinity])expect(kind(planSourceBouncingFixedReplay({updates:1,fps}))).toBe('input');
  for(const fps of [1e-300,1e300])expect(kind(planSourceBouncingFixedReplay({updates:1,fps}))).toBe('nonfinite');
  for(const deltaTime of [-1,NaN,Infinity])expect(kind(stepSourceBouncingRealtime(seed,{deltaTime,paused:false}))).toBe('input');
  expect(kind(stepSourceBouncingRealtime(seed,{deltaTime:1e300,paused:false}))).toBe('nonfinite');
  for(const recordDuration of [0,.1,-1])expect(kind(planSourceBouncingRecording({from:seed,fps:60,recordDuration}))).toBe('input');
  expect(kind(planSourceBouncingRecording({from:seed,fps:60,recordDuration:Infinity}))).toBe('nonfinite');
  const huge=value(parseSourceBouncingCheckpoint({...seed,simulationUpdates:1,sceneTime:F(3e38)}));
  expect(kind(stepSourceBouncingRealtime(huge,{deltaTime:3e38,paused:false}))).toBe('nonfinite');
  expect(kind(stepSourceBouncingRealtime({} as SourceBouncingCheckpoint,{deltaTime:0,paused:false}))).toBe('input');
 });
});
