import {describe,it,expect} from 'vitest';
import type {SceneDocument,AnimationTrack} from '../src/types';
import {usesSpirographFrameClock,spirographSimulationFps,sourceFrameIndex,sourceFrameAtOrAfter,parseSpirographFrameEvents,spirographFrameClips} from '../src/engine/spirographFrameConfig';

function scene(tracks:AnimationTrack[]=[]):SceneDocument {
  return{version:1,id:'frame-config',name:'frame',kind:'spirograph',equations:{},parameters:{},settings:{spirographVersion:'mathart-1.7.8-v1',spirographClock:'source-frame-v1'},palette:{name:'plain',stops:['#000000','#ffffff'],mode:'linear',offset:0,cycles:1},camera:{position:[0,0,10],target:[0,0,0],orthographic:true,zoom:1},timeline:{duration:10,fps:30,loop:false,schedule:'spirograph-sequence-v1',tracks},favorite:false};
}
function track(type:AnimationTrack['type']='wait'):AnimationTrack{return{id:'a',type,target:'timeline.wait',start:0,duration:1,from:0,to:0,easing:'linear',pingPong:false,enabled:true};}
describe('explicit source frame authoring boundary',()=>{
  it('never migrates an omitted clock and rejects an inapplicable explicit clock',()=>{
    const doc=scene();delete doc.settings.spirographClock;expect(usesSpirographFrameClock(doc)).toBe(false);
    doc.settings.spirographClock='source-frame-v1';expect(usesSpirographFrameClock(doc)).toBe(true);
    expect(()=>usesSpirographFrameClock({...doc,kind:'domain'})).toThrow();
    delete doc.settings.spirographVersion;expect(()=>usesSpirographFrameClock(doc)).toThrow();
  });
  it('captures simulation FPS separately from encoding/presentation FPS',()=>{
    const doc=scene();expect(spirographSimulationFps(doc)).toBe(60);
    doc.settings.spirographSimulationFps=24;doc.timeline.fps=120;expect(spirographSimulationFps(doc)).toBe(24);
    for(const value of [0,121,NaN,Infinity,29.97]){doc.settings.spirographSimulationFps=value;expect(()=>spirographSimulationFps(doc)).toThrow();}
  });
  it('recognizes exact ticks without synthesizing fractional simulation steps',()=>{
    for(const fps of [24,30,60,120]){
      expect(sourceFrameIndex(7/fps,fps)).toBe(7);
      expect(sourceFrameIndex((7-.001)/fps,fps)).toBe(6);
      expect(sourceFrameIndex((7+.001)/fps,fps)).toBe(7);
      expect(sourceFrameAtOrAfter((7+.001)/fps,fps)).toBe(8);
      expect(sourceFrameAtOrAfter(7/fps,fps)).toBe(7);
    }
  });
  it('retains input event order, including same-frame commands, without aliasing',()=>{
    const input=[{beforeFrame:5,type:'finish'},{beforeFrame:3,type:'clear'},{beforeFrame:5,type:'restart'}];
    const events=parseSpirographFrameEvents(input);expect(events).toEqual(input);
    input[0].beforeFrame=99;expect(events[0].beforeFrame).toBe(5);
    for(const value of [[{beforeFrame:0,type:'clear'}],[{beforeFrame:1.2,type:'finish'}],[{beforeFrame:1,type:'other'}],[{beforeFrame:1,type:'clear',implicit:true}],Array(4097).fill({beforeFrame:1,type:'clear'})])expect(()=>parseSpirographFrameEvents(value)).toThrow();
  });
  it('adapts source clips once, preserving authored deadlines and the last enabled setter',()=>{
    const rotate={...track('animate'),start:.3,actions:[{id:'one',method:'spirographRotate',args:{speed:1}},{id:'two',method:'spirographRotate',args:{speed:2.0000001}},{id:'off',method:'spirographRotate',args:{speed:9},enabled:false}]};
    const wait={...track('spirograph_finish_wait'),id:'w',duration:20,spirographWait:'visual-or-deadline-v1' as const};
    const disabled={...track('numeric'),enabled:false,start:999,duration:999};
    const doc=scene([rotate,disabled,wait]),before=JSON.stringify(doc),adapted=spirographFrameClips(doc);
    expect(adapted.clips.map(c=>[c.kind,c.duration,c.targetRate])).toEqual([['wait',.3,undefined],['rotate',1,Math.fround(2.0000001)],['finish-wait',20,undefined]]);
    expect(adapted.bindings).toEqual([{trackIndex:0,clipIndex:1,delayIndex:0},{trackIndex:2,clipIndex:2}]);
    expect(JSON.stringify(doc)).toBe(before);
  });
  it('keeps a targetless rotation distinct from setting zero and rejects unsupported extensions',()=>{
    const rotate={...track('animate'),actions:[]};
    expect(spirographFrameClips(scene([rotate])).clips[0].targetRate).toBeUndefined();
    rotate.actions=[];
    for(const invalid of [{...track('numeric')},{...track(),repeat:2},{...track(),pingPong:true},{...track('animate'),actions:[{id:'camera',method:'rotateTheta',args:{angle:1}}]}])expect(()=>spirographFrameClips(scene([invalid]))).toThrow();
    const absolute=scene();delete absolute.timeline.schedule;expect(()=>spirographFrameClips(absolute)).toThrow('顺序队列');
  });
});
