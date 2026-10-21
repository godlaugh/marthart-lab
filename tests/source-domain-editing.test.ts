import {describe,it,expect} from 'vitest';
import {SourceDomainSceneRuntime,type SourceDomainSceneConfiguration} from '../src/engine/sourceDomainSceneRuntime';
import {SourceDomainHostSession} from '../src/engine/sourceDomainHostSession';
const config=():SourceDomainSceneConfiguration=>({
 initial:{settings:{centerX:.125,centerY:-.25,scale:2.5,phaseDensity:7,formula:'z+a',domainShaderModel:'mathart-1.7.8'},parameters:{a:.2,b:.3},rotation:.5,rotationRate:.25,paletteOffset:.1},parameterFps:24,
 clips:[{kind:'animate',duration:1,easing:'linear',rotationRate:1,
  parameters:[{method:'paramStart',spec:{model:'domain-registry-1.7.8',scope:{kind:'named',name:'a'},configuration:{min:-1,max:1,step:.02}}},{method:'paramStart',spec:{model:'domain-registry-1.7.8',scope:{kind:'named',name:'scale'},configuration:{min:1,max:3,step:.03}}},{method:'paramStart',spec:{model:'domain-registry-1.7.8',scope:{kind:'named',name:'phaseDensity'},configuration:{min:2,max:10,step:.2}}}],
  gradients:[{kind:'start',config:{mode:'hue_rotate',speed:60,interpolation:'linear',affectInside:true,affectOutside:true}}]},
 {kind:'animate',duration:.5,easing:'linear',parameters:[{method:'paramStart',spec:{model:'domain-registry-1.7.8',scope:{kind:'named',name:'b'},configuration:{min:-1,max:1,step:.04}}}]}],
});
const runtime=()=>new SourceDomainSceneRuntime(config(),{reserve:()=>{}});

describe('source Domain navigation and same-object parameter edits',()=>{
 it('direct mobject setters preserve double increments and every queue/animation owner',()=>{
  const owner=runtime();owner.step(.25);const before=owner.snapshot();
  owner.addViewportCenterDelta(2**-30,-(2**-29));owner.setViewportScale(-8);
  const after=owner.snapshot();expect(after.settings.centerX).toBe(.125+2**-30);expect(after.settings.centerX).not.toBe(Math.fround(after.settings.centerX as number));expect(after.settings.centerY).toBe(-.25-2**-29);expect(after.settings.scale).toBe(1e-9);
  expect({...after,settings:before.settings}).toEqual(before);
 });
 it('paused source gestures use unrotated original logical-coordinate arithmetic without a scene update',()=>{
  const host=new SourceDomainHostSession(config(),{paused:true}),before=host.snapshot();
  const pan=host.navigatePaused({kind:'pan',dx:17,dy:-9,width:801,height:603});
  // Independent binary64 values derived from the documented original PCs;
  // these are not labeled original JVM outputs or GPU pixel observations.
  expect(pan.state.settings.centerX).toBe(.10244610342342458);
  expect(pan.state.settings.centerY).toBe(-.2380597014925373);
  const wheel=host.navigatePaused({kind:'wheel',count:2});expect(wheel.state.settings.scale).toBe(2.2675739021000716);
  expect(wheel.updateOrdinal).toBe(before.updateOrdinal);expect(wheel.state.clock).toEqual(before.state.clock);expect(wheel.hostClock).toEqual(before.hostClock);expect(wheel.state.rotation).toBe(.5);expect(wheel.state.parameterState).toEqual(before.state.parameterState);expect(host.recordingApplied()).toEqual(config());
  host.setPaused(false,1000);expect(host.snapshot().state.settings).toEqual(wheel.state.settings);
 });
 it('rejects malformed/running/recording gestures before changing an admitted host',()=>{
  const host=new SourceDomainHostSession(config());expect(()=>host.navigatePaused({kind:'wheel',count:1})).toThrow('暂停');host.setPaused(true,1000);const before=host.snapshot();
  for(const value of [NaN,Infinity])expect(()=>host.navigatePaused({kind:'pan',dx:value,dy:0,width:800,height:600})).toThrow();
  expect(()=>host.navigatePaused({kind:'pan',dx:1,dy:1,width:0,height:600})).toThrow();expect(()=>host.navigatePaused({kind:'wheel',count:.5})).toThrow();expect(()=>host.navigatePaused({kind:'wheel',count:-2147483648})).toThrow('有限');expect(host.snapshot()).toEqual(before);
  expect(host.navigatePaused({kind:'wheel',count:2147483647}).state.settings.scale).toBe(1e-9);
  const {handle}=host.beginRecording(4,24);expect(()=>host.navigatePaused({kind:'wheel',count:1})).toThrow('录制');host.finishRecording(handle,2000);
 });
 it('parameter hot edit reapplies retained geometry but preserves mutated config parameters and queue children',()=>{
  const owner=runtime();owner.step(.25);owner.addViewportCenterDelta(3,4);owner.setViewportScale(99);const before=owner.snapshot();expect(before.parameters.a).not.toBe(.2);expect(before.parameterState.running).toBe(true);expect(before.settings.phaseDensity).not.toBe(7);
  owner.updateParameter('b',.75);const after=owner.snapshot();
  expect(after.settings).toEqual({...config().initial.settings,constantReal:Math.fround(before.parameters.a),constantImag:Math.fround(.75)});expect(after.parameters).toEqual({...before.parameters,b:.75});expect(after.clock).toEqual(before.clock);expect(after.rotation).toBe(before.rotation);expect(after.rotationRate).toBe(before.rotationRate);expect(after.gradient).toEqual(before.gradient);expect(after.paletteOffset).toBe(before.paletteOffset);expect(after.parameterState.running).toBe(false);expect(after.parameterState.entries).toEqual([]);expect(after.parameterState.children).toEqual(before.parameterState.children);
  const continued=owner.step(.25);expect(continued.parameters).toEqual(after.parameters);expect(continued.parameterState.running).toBe(false);expect(continued.rotation).not.toBe(after.rotation);expect(continued.paletteOffset).not.toBe(after.paletteOffset);
  owner.step(.5);expect(owner.snapshot().parameterState.running).toBe(false);const restarted=owner.step(.25);expect(restarted.parameterState.running).toBe(true);expect(restarted.parameterState.entries.map(e=>e.name)).toEqual(['b']);expect(restarted.parameters.b).not.toBe(.75);
 });
 it('an explicit same-value commit still reapplies config and clears active animation',()=>{
  const owner=runtime();owner.step(.25);const before=owner.snapshot();owner.updateParameter('a',before.parameters.a);const after=owner.snapshot();
  expect(after.parameters).toEqual(before.parameters);expect(after.parameterState.running).toBe(false);expect(after.parameterState.entries).toEqual([]);expect(after.clock).toEqual(before.clock);expect(after.settings.scale).toBe(2.5);
 });
 it('hot generic names bypass animation bindings, preserve raw double and safely admit map keys',()=>{
  const owner=runtime();owner.updateParameter('scale',7);owner.updateParameter('phaseDensity',12);owner.updateParameter('',.6);owner.updateParameter('__proto__',.12345678901234567);const state=owner.snapshot();
  expect(state.settings.scale).toBe(2.5);expect(state.settings.phaseDensity).toBe(7);expect(state.parameters.scale).toBe(7);expect(state.parameters.phaseDensity).toBe(12);expect(state.parameters['']).toBe(.6);expect(Object.hasOwn(state.parameters,'__proto__')).toBe(true);expect(state.parameters.__proto__).toBe(.12345678901234567);expect(Object.getPrototypeOf(state.parameters)).toBe(Object.prototype);
 });
 it.each([false,true])('host parameter hot commit preserves paused=%s and full recording anchor',paused=>{
  const host=new SourceDomainHostSession(config());host.update({paused:false,timestampMs:1000},24);host.update({paused:false,timestampMs:1250},24);host.setPaused(paused,2000);const before=host.snapshot();
  const edited=host.updateParameter('new-name',.3333333333333333);expect(edited.paused).toBe(paused);expect(edited.updateOrdinal).toBe(before.updateOrdinal);expect(edited.hostClock).toEqual(before.hostClock);expect(edited.state.clock).toEqual(before.state.clock);expect(host.recordingApplied()).toEqual(config());
  const {handle,warmup}=host.beginRecording(4,24);expect(warmup.state.parameters['new-name']).toBeUndefined();expect(warmup.state.parameterState.running).toBe(true);expect(()=>host.updateParameter('a',1)).toThrow('录制');host.finishRecording(handle,4000);
 });
 it('invalid hot data leaves host usable; partial budget failure invalidates until explicit full load',()=>{
  let fail=false;const host=new SourceDomainHostSession(config(),{reserve:()=>{if(fail)throw Error('test budget');}}),before=host.snapshot();
  expect(()=>host.updateParameter('a',NaN)).toThrow();expect(host.snapshot()).toEqual(before);fail=true;expect(()=>host.updateParameter('a',.5)).toThrow('budget');expect(()=>host.snapshot()).toThrow('fullLoad');fail=false;host.fullLoad(config());expect(host.snapshot().state.parameters.a).toBe(.2);
 });
});
