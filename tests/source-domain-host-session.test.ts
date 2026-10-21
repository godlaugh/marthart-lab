import {describe,it,expect} from 'vitest';
import {SourceDomainHostSession} from '../src/engine/sourceDomainHostSession';
import type {SourceDomainSceneConfiguration} from '../src/engine/sourceDomainSceneRuntime';
const F=Math.fround;
const config=():SourceDomainSceneConfiguration=>({initial:{settings:{scale:2.5},parameters:{a:0},rotation:0,rotationRate:0,paletteOffset:0},clips:[{kind:'animate',duration:1,easing:'linear',rotationRate:1}],parameterFps:30});
const at=(host:SourceDomainHostSession,timestampMs:number,frameRate=30)=>host.update({paused:false,timestampMs},frameRate);

describe('Domain numerical host lifecycle',()=>{
 it('uses zero elapsed time for the first wall-clock update and separates pause from object updates',()=>{
  const host=new SourceDomainHostSession(config());expect(host.snapshot().updateOrdinal).toBe(-1);
  expect(at(host,1000).state.rotation).toBe(0);expect(at(host,1250).state.rotation).toBe(.125);
  const before=host.snapshot();host.setPaused(true,9999);const paused=host.update({paused:true,timestampMs:20000},12);
  expect(paused.state.rotation).toBe(before.state.rotation);expect(paused.state.phases).toEqual([]);expect(paused.hostClock.lastTime).toBe(before.hostClock.lastTime);
  host.setPaused(false,30000);expect(host.snapshot().updateOrdinal).toBe(paused.updateOrdinal);expect(at(host,30250).state.rotation).toBe(.375);
 });
 it.each([false,true])('full Apply replaces the queue and object while preserving paused=%s',paused=>{
  const host=new SourceDomainHostSession(config());at(host,1000);at(host,1500);host.setPaused(paused,2000);
  const next=config();next.initial.settings.scale=8;next.initial.parameters.a=.5;
  const applied=host.applyConfiguration(next);expect(applied.paused).toBe(paused);expect(applied.state.rotation).toBe(0);expect(applied.state.rotationRate).toBe(0);expect(applied.state.clock.queueIndex).toBe(0);expect(applied.hostClock.lastTime).toBe(0);expect(applied.updateOrdinal).toBe(-1);
  next.initial.parameters.a=99;expect(host.recordingApplied().initial.parameters.a).toBe(.5);expect(host.snapshot().state.settings.scale).toBe(8);
 });
 it('keeps an admitted host after malformed replacement, and rejects undeclared pause transitions',()=>{
  const host=new SourceDomainHostSession(config());at(host,1000);at(host,1250);const before=host.snapshot();
  expect(()=>host.applyConfiguration({...config(),parameterFps:Infinity})).toThrow();expect(host.snapshot()).toEqual(before);
  expect(()=>host.update({paused:true,timestampMs:2000},30)).toThrow('独立');expect(host.snapshot()).toEqual(before);
 });
 it('rebuilds the full-load anchor for recording, discards no numeric update, and stops at the terminal frame',()=>{
  const host=new SourceDomainHostSession(config());at(host,1000);at(host,1500);host.setPaused(true);
  const {handle,warmup}=host.beginRecording(4,23);expect(warmup.paused).toBe(false);expect(warmup.state.rotation).toBe(.125);expect(warmup.state.parameterFps).toBe(23);expect(warmup.recording).toMatchObject({ordinal:0,warmup:true,complete:false});
  const expected=[.375,.75,1.25];for(let i=1;i<=3;i++){const frame=host.nextRecordingFrame(handle,i,17+i);expect(frame.state.rotation).toBe(expected[i-1]);expect(frame.state.parameterFps).toBe(17+i);}
  expect(host.snapshot().recording?.complete).toBe(true);expect(()=>host.nextRecordingFrame(handle,4,20)).toThrow('终帧');
  const before=host.snapshot(),finished=host.finishRecording(handle,40000);expect(finished.recording).toBeUndefined();expect(finished.paused).toBe(false);expect(finished.updateOrdinal).toBe(before.updateOrdinal);expect(finished.state).toEqual(before.state);
  expect(at(host,40250,12).state.rotation).toBe(1.5);
 });
 it('keeps simulation dt and actual parameter FPS independent during recording',()=>{
  const base:SourceDomainSceneConfiguration={...config(),clips:[{kind:'animate',duration:1,easing:'linear',parameters:[{method:'paramStart',spec:{model:'domain-registry-1.7.8',scope:{kind:'named',name:'a'},configuration:{min:-1,max:1,step:.1}}}]}]};
  const slow=new SourceDomainHostSession(base).beginRecording(30,12).warmup,fast=new SourceDomainHostSession(base).beginRecording(30,60).warmup;
  expect(slow.state.clock.rawDt).toBe(fast.state.clock.rawDt);expect(slow.state.parameters.a).not.toBe(fast.state.parameters.a);
 });
 it('rejects forged and stale recording capabilities and out-of-order updates without mutation',()=>{
  const host=new SourceDomainHostSession(config()),{handle}=host.beginRecording(4,30),before=host.snapshot();
  expect(()=>host.nextRecordingFrame({...handle},1,30)).toThrow('不属于');expect(()=>host.nextRecordingFrame(handle,2,30)).toThrow('连续');expect(()=>at(host,1000)).toThrow('录制期间');expect(host.snapshot()).toEqual(before);
  host.finishRecording(handle,1000);const second=host.beginRecording(4,30);expect(()=>host.finishRecording(handle,2000)).toThrow('不属于');expect(second.handle.recordingId).not.toBe(handle.recordingId);
 });
 it('reconstructs a local fixed display ordinal with one budget and a fresh wall clock',()=>{
  const host=new SourceDomainHostSession(config(),{paused:true});const frame=host.reconstruct(3,4,19);expect(frame.state.rotation).toBe(1.25);expect(frame.state.parameterFps).toBe(19);expect(frame.paused).toBe(true);expect(frame.hostClock.lastTime).toBe(0);expect(()=>host.reconstruct(0,4,30)).toThrow('新的宿主');
  host.setPaused(false,1000);expect(at(host,1250).state.rotation).toBe(1.5);
 });
 it('invalidates partially advanced state on cancellation and allows explicit reload recovery',()=>{
  let spending=0,cancel=false;const host=new SourceDomainHostSession(config(),{isCancelled:()=>cancel,reserve:()=>{if(++spending===2)cancel=true;}});
  expect(()=>host.reconstruct(10,4,30)).toThrow('取消');expect(()=>host.snapshot()).toThrow('fullLoad');cancel=false;host.fullLoad(config());expect(at(host,1000).state.rotation).toBe(0);
 });
 it('rejects a rebuild whose whole operation exceeds the work budget',()=>{
  const host=new SourceDomainHostSession({...config(),clips:[]});expect(()=>host.reconstruct(2_000_000,30,30)).toThrow('200万');expect(()=>host.snapshot()).toThrow('fullLoad');
 });
 it('preserves fractional host FPS before fixed-step division',()=>{
  const host=new SourceDomainHostSession(config());const result=host.beginRecording(29.97,59.94).warmup;expect(result.state.clock.rawDt).toBe(F(1/F(29.97)));expect(result.state.parameterFps).toBe(F(59.94));
 });
});
