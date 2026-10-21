import {describe,it,expect} from 'vitest';
import {SourceDomainSceneRuntime,type SourceDomainSceneClip} from '../src/engine/sourceDomainSceneRuntime';
import fixture from './fixtures/source-domain-clock/numerical.json';

const bits=(value:number)=>{const view=new DataView(new ArrayBuffer(4));view.setFloat32(0,value);return view.getUint32(0).toString(16).padStart(8,'0');};
describe('original Domain Scene numerical traces',()=>{
 for(const c of fixture.cases)it(`matches original JVM case ${c.id}: ${c.driver}`,()=>{
  const clips:SourceDomainSceneClip[]=c.input.timeline.map(raw=>{
   const clip=raw as {type:string;duration:number;easing?:string;actions?:{method:string;args:number[]}[]};
   return clip.type==='wait'?{kind:'wait',duration:clip.duration}:{kind:'animate',duration:clip.duration,easing:'linear',rotationRate:clip.actions?.slice().reverse().find(a=>a.method==='domainRotate')?.args[0]};
  });
  let work=0;const runtime=new SourceDomainSceneRuntime({initial:{settings:{scale:2.5},parameters:{},rotation:c.initialRotation.value,rotationRate:c.initialRate.value,paletteOffset:0},clips,parameterFps:c.pAppletFrameRate},{reserve:n=>{work+=n;}});
  expect(bits(runtime.snapshot().rotation)).toBe(c.initial.rotation.bits);
  for(const row of c.frames){
   const out=runtime.step(row.inputStep.value,row.paused),expected=row.state;
   expect(bits(out.rotation),`frame ${row.index} rotation`).toBe(expected.rotation.bits);
   expect(bits(out.rotationRate),`frame ${row.index} rate`).toBe(expected.rotationRate.bits);
   expect(bits(out.clock.sceneTime),`frame ${row.index} time`).toBe(expected.sceneTime.bits);
   expect(bits(out.clock.rawDt),`frame ${row.index} dt`).toBe(expected.rawDt.bits);
   expect(out.clock.queueIndex).toBe(expected.queueIndex);
   expect(out.clock.queueComplete).toBe(expected.complete);
   expect(out.phases.map(p=>p.kind)).toEqual(row.paused?[]:expected.finishedAtFrameStart?['raw']:['active','raw']);
  }
  expect(work).toBeGreaterThan(0);
 });
 it('invalidates all child state after cancellation and never offers a partial snapshot',()=>{
  const runtime=new SourceDomainSceneRuntime({initial:{settings:{},parameters:{},rotation:0,rotationRate:1,paletteOffset:0},clips:[],parameterFps:60},{reserve:()=>{}});
  expect(()=>runtime.step(.25,false,()=>true)).toThrow('取消');
  expect(()=>runtime.snapshot()).toThrow('重建完整实例');
 });
 it('copies caller-owned configuration and keeps dedicated output fields single-owned',()=>{
  const initial={settings:{rotation:99,paletteOffset:99,scale:2.5},parameters:{a:1},rotation:0,rotationRate:1,paletteOffset:.25};
  const runtime=new SourceDomainSceneRuntime({initial,clips:[],parameterFps:60},{reserve:()=>{}});
  initial.parameters.a=5;initial.settings.scale=9;
  const out=runtime.step(.25);expect(out.rotation).toBe(.25);expect(out.paletteOffset).toBe(.25);
  expect(out.parameters.a).toBe(1);expect(out.settings.scale).toBe(2.5);
  expect(out.settings.rotation).toBeUndefined();expect(out.settings.paletteOffset).toBeUndefined();
  out.parameters.a=8;out.settings.scale=8;expect(runtime.snapshot().parameters.a).toBe(1);expect(runtime.snapshot().settings.scale).toBe(2.5);
 });
 it('bounds repeated gradient child work and invalidates the whole scene on exhaustion',()=>{
  let used=0;const gradients=Array.from({length:64},()=>({kind:'start' as const,config:{mode:'hue_rotate' as const,speed:90,interpolation:'linear' as const}}));
  const runtime=new SourceDomainSceneRuntime({initial:{settings:{},parameters:{},rotation:0,rotationRate:0,paletteOffset:0},clips:[{kind:'animate',duration:100,easing:'linear',gradients}],parameterFps:60},{reserve:n=>{used+=n;if(used>150)throw Error('shared work exhausted');}});
  runtime.step(1/60);
  expect(()=>runtime.step(1/60)).toThrow('shared work exhausted');expect(()=>runtime.snapshot()).toThrow('重建完整实例');
 });

});
