import {describe,it,expect} from 'vitest';
import {readyPlaybackStep} from '../src/engine/previewPlayback';
import {normalizeTimelineTime} from '../src/engine/timeline';
describe('preview work backpressure',()=>{
  it('advances one fixed sample step after slow work, with no wall-clock catch-up',()=>{
    let clock=0,last=1;
    for(let frame=1;frame<=20;frame++){
      const now=frame*500+1;
      expect(readyPlaybackStep(clock,last,now,30,30,true)).toEqual({clock,lastStepMs:last,advanced:false});
      const step=readyPlaybackStep(clock,last,now,30,30,false);expect(step.clock-clock).toBeCloseTo(1/30,14);clock=step.clock;last=step.lastStepMs;
    }
    expect(clock).toBeCloseTo(20/30,14);expect(last).toBe(10001);
  });
  it('honors preview frame limits while retaining exact high-frequency sample steps',()=>{
    expect(readyPlaybackStep(0,1,20,120,30,false).advanced).toBe(false);
    const step=readyPlaybackStep(0,1,35,120,30,false);expect(step.clock).toBe(1/120);
    expect(readyPlaybackStep(step.clock,step.lastStepMs,40,120,30,false).advanced).toBe(false);
    expect(readyPlaybackStep(0,1,1000,1,120,false).advanced).toBe(false);
    expect(readyPlaybackStep(0,1,1001,1,120,false).clock).toBe(1);
  });
  it('keeps existing once, loop and ping-pong semantics at a timeline boundary',()=>{
    const clock=readyPlaybackStep(.95,1,500,10,30,false).clock;
    for(const[mode,expected]of [['once',1],['loop',.05],['ping-pong',.95]]as const)expect(normalizeTimelineTime(clock,{duration:1,fps:30,loop:false,tracks:[],playbackMode:mode})).toBeCloseTo(expected,14);
  });
  it('rejects nonfinite or invalid time inputs instead of poisoning the playback clock',()=>{
    for(const values of [[0,0,NaN,30,30],[0,10,9,30,30],[0,0,10,0,30],[0,0,10,30,121],[0,0,10,30,1.5]])expect(()=>readyPlaybackStep(...values as[number,number,number,number,number],false)).toThrow();
  });
});
