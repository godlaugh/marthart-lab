import {describe,it,expect} from 'vitest';
import type {AnimationTrack,SceneDocument} from '../src/types';
import {sceneAtTime,clipDuration,createAnimationTrack,validateTimelineExtensions,resolveTimeline} from '../src/engine/timeline';
import {scenePlaybackTime} from '../src/engine/scenePlayback';
import {parseScene,persistentScene} from '../src/engine/document';
import {createDefaultSpirographLayer} from '../src/scenes/spirograph';

function rotate(start:number,duration:number,speed:number,easing='linear'):AnimationTrack {
  return{id:crypto.randomUUID(),type:'animate',target:'camera.actions',from:0,to:0,start,duration,easing,pingPong:false,enabled:true,actions:[{id:crypto.randomUUID(),method:'spirographRotate',args:{speed}}]};
}
function scene(tracks:AnimationTrack[]=[]):SceneDocument {
  const layer={...createDefaultSpirographLayer(),statorRadius:3,rotors:[{radius:1,mode:'inside' as const}],penDistance:1,speed:1,showGuides:false};
  return{version:1,id:'spirograph-source-timeline',name:'Source Spirograph',kind:'spirograph',equations:{},parameters:{},settings:{spirographVersion:'mathart-1.7.8-v1',rotation:30,rotationSpeed:0,animate:true,layers:JSON.stringify([layer]),fadeOutStatorsOnFinish:false,startEaseEnabled:false,endEaseEnabled:false},palette:{name:'test',stops:['#000000','#ffffff'],offset:0,cycles:1,mode:'linear'},camera:{position:[0,0,10],target:[0,0,0],orthographic:true,zoom:1},timeline:{duration:20,fps:30,loop:false,tracks},favorite:false};
}
const angle=(document:SceneDocument,time:number)=>sceneAtTime(document,time).evaluatedSpirographRotationRadians!;
const wait=(start:number,duration:number):AnimationTrack=>({id:'wait',type:'spirograph_finish_wait',spirographWait:'visual-or-deadline-v1',target:'timeline.wait',from:0,to:0,start,duration,easing:'linear',pingPong:false,enabled:true});

describe('source Spirograph target-rate ownership',()=>{
  it('integrates a rate transition and preserves authored degrees independently',()=>{
    const document=scene([rotate(0,2,2)]),saved=JSON.stringify(document);
    for(const [time,expected] of [[0,0],[1,.5],[2,2],[4,6]]){
      expect(angle(document,time)).toBeCloseTo(expected,7);
      expect(sceneAtTime(document,time).settings.rotation).toBe(30);
    }
    expect(JSON.stringify(document)).toBe(saved);
  });
  it('decelerates from the previous rate, crosses zero and retains the final rate',()=>{
    const document=scene([rotate(0,2,2),rotate(4,2,-2)]);
    for(const [time,expected] of [[4,6],[5,7],[6,6],[7,4]])expect(angle(document,time)).toBeCloseTo(expected,7);
  });
  it('takes over an overlapping transition from its actual current rate',()=>{
    const document=scene([rotate(0,2,2),rotate(1,2,3)]);
    for(const [time,expected] of [[1,.5],[2,2],[3,4.5],[4,7.5]])expect(angle(document,time)).toBeCloseTo(expected,7);
  });
  it('uses the final enabled setter in a source group without applying intermediate targets',()=>{
    const clip=rotate(0,0,100,'not-quite-there');
    clip.actions!.push({id:'second',method:'spirographRotate',args:{speed:2}},{id:'disabled',method:'spirographRotate',args:{speed:1000},enabled:false});
    expect(angle(scene([clip]),1)).toBe(Math.fround(2*Math.fround(.7)));
  });
  it('retains the eased endpoint instead of forcing a target after onFinish',()=>{
    const document=scene([rotate(0,0,1),rotate(1,2,3,'there-and-back')]);
    expect(angle(document,3)).toBeCloseTo(5,6);
    expect(angle(document,7)-angle(document,3)).toBeCloseTo(4,8);
  });
  it('preserves easing overshoot in the angular velocity',()=>{
    const document=scene([rotate(0,1,1,'back-out')]);
    const integral=1-2.70158/4+1.70158/3;
    expect(angle(document,1)).toBeCloseTo(integral,6);
    expect((angle(document,.81)-angle(document,.8))/.01).toBeGreaterThan(1);
    expect(angle(document,2)-angle(document,1)).toBeCloseTo(1,7);
  });
  it('keeps a caller-selected initial rate and uses radians per second, without degree conversion',()=>{
    const document=scene([rotate(2,2,1.5)]);document.settings.rotationSpeed=.5;
    expect(angle(document,1)).toBe(.5);expect(angle(document,2)).toBe(1);
    expect(angle(document,3)).toBeCloseTo(1.75,7);expect(angle(document,4)).toBeCloseTo(3,7);
    expect(angle(document,5)).toBeCloseTo(4.5,7);
  });
  it('defines finite instant transitions and does not reset them with a generic camera stop',()=>{
    const stop=rotate(3,1,0);stop.actions=[{id:'stop',method:'stopAmbient',args:{}}];
    const document=scene([rotate(1,0,2),stop]);
    expect(angle(document,0)).toBe(0);expect(angle(document,2)).toBe(2);expect(angle(document,5)).toBe(8);
  });
  it('converts targets to source floats without changing the authored value',()=>{
    const speed=1.00000006,document=scene([rotate(0,0,speed)]);
    expect(angle(document,1)).toBe(Math.fround(speed));expect(document.timeline.tracks[0].actions![0].args!.speed).toBe(speed);
    expect(()=>angle(scene([rotate(0,1,1e100)]),1)).toThrow('角速度');
  });
  it('reconstructs cold and backwards seeks and strips runtime rotations at persistence boundaries',()=>{
    const document=scene([rotate(0,2,2,'quad-in'),rotate(3,2,-1,'sine-in-out')]);
    const times=[7,.3,4,0,2,7],expected=times.map(t=>angle(document,t));
    expect(times.map(t=>angle(parseScene(JSON.stringify(document)),t))).toEqual(expected);
    const evaluated=sceneAtTime(document,7);
    expect(persistentScene(evaluated).evaluatedSpirographRotationRadians).toBeUndefined();
    expect(parseScene(JSON.stringify({...document,evaluatedSpirographRotationRadians:999})).evaluatedSpirographRotationRadians).toBeUndefined();
    expect(angle(evaluated,.3)).toBe(expected[1]);
  });
  it('preserves legacy radians and the old from-zero rotation policy when the source version is omitted',()=>{
    const document=scene([rotate(0,2,2),rotate(4,2,0)]);delete document.settings.spirographVersion;document.settings.rotation=0;
    expect(sceneAtTime(document,5).settings.rotation).toBeCloseTo(6,10);
    expect(sceneAtTime(document,5).evaluatedSpirographRotationRadians).toBeUndefined();
  });
  it('integrates a numeric rate extension through the same owner as source actions',()=>{
    const numeric:AnimationTrack={...rotate(0,2,0),type:'numeric',target:'settings.rotationSpeed',from:0,to:2,actions:undefined};
    const document=scene([numeric,rotate(3,2,0)]);
    for(const [time,expected] of [[1,.5],[2,2],[3,4],[4,5.5],[5,6],[7,6]])expect(angle(document,time)).toBeCloseTo(expected,6);
    expect(sceneAtTime(document,1).settings.rotationSpeed).toBe(1);
  });
  it('starts a numeric current-rate transition from an interrupted source action',()=>{
    const numeric:AnimationTrack={...rotate(1,2,0),type:'numeric',target:'settings.rotationSpeed',from:100,to:3,fromCurrent:true,actions:undefined};
    const document=scene([rotate(0,2,2),numeric]);
    expect(angle(document,1)).toBeCloseTo(.5,7);expect(angle(document,3)).toBeCloseTo(4.5,6);
    expect(angle(document,4)).toBeCloseTo(7.5,6);
  });
  it('rejects continuous interpolation of drawing event timestamps',()=>{
    for(const key of ['traceStartTime','traceClearTime','traceFinishTime']){
      const numeric:AnimationTrack={...rotate(0,2,0),type:'numeric',target:`settings.${key}`,from:0,to:2,actions:undefined};
      const document=scene([numeric]);document.settings[key]=0;
      expect(()=>angle(document,1)).toThrow('绘制事件');
    }
  });
  it('does not advertise a local ease duration as an effective source animation',()=>{
    const numeric:AnimationTrack={...rotate(0,2,0),type:'numeric',target:'settings.easeDuration',from:.6,to:2,actions:undefined};
    const document=scene([numeric]);document.settings.easeDuration=.6;
    expect(()=>angle(document,1)).toThrow('自适应缓动');
    delete document.settings.spirographVersion;expect(sceneAtTime(document,1).settings.easeDuration).toBe(1.3);
  });
  it('rejects ineffective source Z animation while retaining the authored values',()=>{
    for(const key of ['scaleZ','offsetZ']){
      const numeric:AnimationTrack={...rotate(0,2,0),type:'numeric',target:`settings.${key}`,from:1,to:3,actions:undefined};
      const document=scene([numeric]);document.settings[key]=1;
      expect(()=>angle(document,1)).toThrow('二维旋轮');
      expect(parseScene(JSON.stringify(document)).settings[key]).toBe(1);
      delete document.settings.spirographVersion;
      expect(sceneAtTime(document,1).settings[key]).toBe(2);
    }
  });
});

describe('explicit bounded Spirograph completion waits',()=>{
  it('keeps a short maximum wait instead of replacing it with a full closure estimate',()=>{
    const document=scene();expect(clipDuration(wait(0,.25),document)).toBe(.25);
    document.settings.traceStartTime=10;expect(clipDuration(wait(0,.25),document)).toBe(.25);
  });
  it('allows a deadline for paused and continuously drawing layers',()=>{
    for(const patch of [{speed:0},{autoStopOnClosure:false}]){
      const document=scene(),layers=JSON.parse(String(document.settings.layers));Object.assign(layers[0],patch);document.settings.layers=JSON.stringify(layers);
      expect(clipDuration(wait(0,.25),document)).toBe(.25);
      const created=createAnimationTrack(document,'spirograph_finish_wait',0);
      expect(created.spirographWait).toBe('visual-or-deadline-v1');expect(created.duration).toBeGreaterThan(0);
    }
  });
  it('ends immediately for an already finished drawing and preserves the authored deadline',()=>{
    const document=scene(),track=wait(15,2);expect(clipDuration(track,document)).toBe(0);expect(track.duration).toBe(2);
    document.timeline.tracks=[track];expect(()=>sceneAtTime(document,16)).not.toThrow();
    expect(clipDuration(wait(86399,1200),document)).toBe(0);
  });
  it('rejects malformed wait contracts and deadlines rather than converting them to completion',()=>{
    const document=scene();
    for(const duration of [-1,NaN,Infinity,86401])expect(()=>clipDuration(wait(0,duration),document)).toThrow();
    expect(()=>validateTimelineExtensions({...wait(0,1),spirographWait:'unknown' as never},'spirograph')).toThrow('规则');
    expect(()=>validateTimelineExtensions(wait(0,1),'domain')).toThrow('规则');
    expect(()=>validateTimelineExtensions({...wait(0,1),type:'wait'},'spirograph')).toThrow('规则');
  });
});

describe('source drawing-dependent sequential schedule',()=>{
  function queued(tracks:AnimationTrack[]){const document=scene(tracks);document.timeline.schedule='spirograph-sequence-v1';document.timeline.duration=.1;return document;}
  it('owns effective starts without freezing a finish predicate at import time',()=>{
    const document=queued([wait(0,20),rotate(0,1,2)]),before=JSON.stringify(document);
    const first=resolveTimeline(document);expect(first.tracks[1].start).toBe(6);expect(first.duration).toBe(7);expect(first.schedule).toBeUndefined();
    expect(JSON.stringify(document)).toBe(before);expect(angle(document,5)).toBe(0);expect(angle(document,6.5)).toBeCloseTo(.25,6);
    const layers=JSON.parse(String(document.settings.layers));layers[0].speed=.5;document.settings.layers=JSON.stringify(layers);
    const slower=resolveTimeline(document);expect(slower.tracks[1].start).toBe(12);expect(slower.duration).toBe(13);
    expect(angle(document,6.5)).toBe(0);expect(angle(document,12.5)).toBeCloseTo(.25,6);
    expect(resolveTimeline(parseScene(JSON.stringify(document)))).toEqual(slower);
  });
  it('keeps deadlines, caller delays and minimum playback span separate',()=>{
    const disabled=wait(70,70);disabled.enabled=false;
    const document=queued([wait(0,.25),disabled,rotate(.5,1,2)]);document.timeline.duration=4;
    const resolved=resolveTimeline(document);
    expect(resolved.tracks.map(track=>track.start)).toEqual([0,.25,.75]);expect(resolved.duration).toBe(4);
    expect(angle(document,.5)).toBe(0);expect(angle(document,1.25)).toBeCloseTo(.25,6);
    resolved.tracks[0].start=99;expect(resolveTimeline(document).tracks[0].start).toBe(0);
  });
  it('uses the same resolved span for playback and cold timeline evaluation',()=>{
    const document=queued([wait(0,.25),rotate(0,1,2)]);
    expect(scenePlaybackTime(document,1)).toEqual({time:1,finished:false});
    expect(scenePlaybackTime(document,2)).toEqual({time:1.25,finished:true});
    expect(angle(document,2)).toBeCloseTo(1,6);
    document.timeline.playbackMode='loop';expect(scenePlaybackTime(document,1.5)).toEqual({time:.25,finished:false});
    document.timeline.playbackMode='ping-pong';expect(scenePlaybackTime(document,1.5)).toEqual({time:1,finished:false});
  });
  it('resolves an explicit Finish event without inventing completion for infinite layers',()=>{
    const document=queued([wait(0,3),rotate(0,1,2)]);document.settings.traceFinishTime=.201;
    expect(resolveTimeline(document).tracks[1].start).toBe(.201);
    expect(angle(document,.701)).toBeCloseTo(.25,6);
    const layers=JSON.parse(String(document.settings.layers));layers[0].autoStopOnClosure=false;document.settings.layers=JSON.stringify(layers);
    expect(resolveTimeline(document).tracks[1].start).toBe(3);expect(angle(document,.701)).toBe(0);
  });
  it('fails closed on malformed applicability, delays and queue capacity',()=>{
    const document=queued([rotate(0,1,2)]);
    expect(()=>resolveTimeline({...document,kind:'domain'})).toThrow('顺序规则');
    expect(()=>resolveTimeline({...document,timeline:{...document.timeline,schedule:'unknown' as never}})).toThrow('顺序规则');
    for(const start of [NaN,-1,Infinity,86401]){document.timeline.tracks[0].start=start;expect(()=>resolveTimeline(document)).toThrow();}
    document.timeline.tracks[0].start=86400;expect(()=>resolveTimeline(document)).toThrow('24 小时');
  });
});
