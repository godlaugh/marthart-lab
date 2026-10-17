import {describe,it,expect} from 'vitest';
import type {SceneDocument,AnimationTrack} from '../src/types';
import {generateScene,TemporalGenerationSession} from '../src/engine/temporal';
import {createDefaultSpirographLayer} from '../src/scenes/spirograph';
import {sceneAtTime,resolveTimeline} from '../src/engine/timeline';
import {scenePlaybackTime} from '../src/engine/scenePlayback';
import {persistentScene,parseScene} from '../src/engine/document';
import {SpirographFrameSession} from '../src/engine/spirographFramePlan';

function rotate(id:string,duration:number,speed?:number):AnimationTrack {return{id,type:'animate',target:'camera.actions',start:0,duration,from:0,to:0,easing:'linear',pingPong:false,enabled:true,actions:speed===undefined?[]:[{id:id+'-action',method:'spirographRotate',args:{speed}}]};}
function scene(tracks:AnimationTrack[]=[rotate('a',.3,1),rotate('b',.3,3)]):SceneDocument {
  const layer={...createDefaultSpirographLayer(),statorRadius:30,rotors:[{radius:10,mode:'inside' as const}],penDistance:12,speed:1,showGuides:false};
  return{version:1,id:'frame-integration',name:'source frames',kind:'spirograph',equations:{},parameters:{},settings:{spirographVersion:'mathart-1.7.8-v1',spirographClock:'source-frame-v1',spirographSimulationFps:2,animate:true,spiroView:'native',layers:JSON.stringify([layer]),startEaseEnabled:false,endEaseEnabled:false,fadeInStatorsOnStart:false,fadeOutStatorsOnFinish:false,count:500},palette:{name:'plain',stops:['#000000','#ffffff'],mode:'linear',offset:0,cycles:1},camera:{position:[0,0,10],target:[0,0,0],orthographic:true,zoom:1},timeline:{duration:.1,fps:30,loop:false,schedule:'spirograph-sequence-v1',tracks},favorite:false};
}
const context={time:0,width:64,height:48,quality:'export' as const};
describe('source frame public generation integration',()=>{
  it('uses source whole-queue dt clipping and one clip per frame through public APIs',()=>{
    const doc=scene(),at=sceneAtTime(doc,1),frame=at.evaluatedSpirographFrame!;
    // Independently calculated source witness: .5*1 + F(.3)*3, not integral.
    expect(frame.rotationRadians).toBe(1.4000000953674316);
    expect(frame.sceneTime).toBe(Math.fround(.8));
    expect(frame.queueCompleteFrame).toBe(2);
    expect(frame.clips.map(c=>[c.startFrame,c.endFrame])).toEqual([[1,1],[2,2]]);
    expect(resolveTimeline(doc).tracks.map(t=>[t.start,t.duration])).toEqual([[0,.5],[.5,.5]]);
    expect(resolveTimeline(doc).duration).toBe(1);
    expect(scenePlaybackTime(doc,2)).toEqual({time:2,finished:false});
    expect(sceneAtTime(doc,1.5).evaluatedSpirographFrame!.rotationRadians).toBe(Math.fround(2.9));
  });
  it('binds delivered pixels to the requested update independently of display seconds',()=>{
    const doc=scene(),owner=new TemporalGenerationSession();
    const a=generateScene(doc,{...context,time:0,spirographFrame:{frame:2}},owner);
    const b=generateScene(doc,{...context,time:1},owner);
    expect(a.spirographFrame).toEqual(b.spirographFrame);
    expect(a.type).toBe('raster');expect(b.type).toBe('raster');
    if(a.type==='raster'&&b.type==='raster')expect(a.pixels).toEqual(b.pixels);
    expect(a.spirographFrame!.phases[0]).toBeCloseTo(48.00000071525574,10);
    owner.reset();
  });
  it('reconstructs backward/cold queries without retaining runtime state in saved documents',()=>{
    const doc=scene(),owner=new TemporalGenerationSession();
    for(const frame of [3,1,0,2,3]){
      const warm=generateScene(doc,{...context,spirographFrame:{frame}},owner);
      const cold=generateScene(parseScene(JSON.stringify(doc)),{...context,spirographFrame:{frame}});
      expect(warm.spirographFrame).toEqual(cold.spirographFrame);
      if(warm.type==='raster'&&cold.type==='raster')expect(warm.pixels).toEqual(cold.pixels);
    }
    const evaluated=sceneAtTime(doc,1);
    expect(persistentScene(evaluated).evaluatedSpirographFrame).toBeUndefined();
    expect(parseScene(JSON.stringify(evaluated)).evaluatedSpirographFrame).toBeUndefined();
    owner.reset();
  });
  it('uses previous-frame completion for waits and same-frame explicit Finish input',()=>{
    const wait:AnimationTrack={...rotate('wait',20),type:'spirograph_finish_wait',spirographWait:'visual-or-deadline-v1',actions:undefined};
    const doc=scene([wait]);const layers=JSON.parse(String(doc.settings.layers));layers[0].speed=120;doc.settings.layers=JSON.stringify(layers);
    const frame1=sceneAtTime(doc,.5).evaluatedSpirographFrame!;
    expect(frame1.visualFinished).toBe(true);expect(frame1.queueFinished).toBe(false);
    expect(sceneAtTime(doc,1).evaluatedSpirographFrame!.queueCompleteFrame).toBe(2);
    doc.spirographFrameEvents=[{beforeFrame:1,type:'finish'}];
    expect(sceneAtTime(doc,.5).evaluatedSpirographFrame!.queueCompleteFrame).toBe(1);
  });
  it('owns same-frame event coalescing, clear history and an explicit recording fork',()=>{
    const doc=scene([rotate('rotate',3,2)]);doc.spirographFrameEvents=[{beforeFrame:2,type:'finish'},{beforeFrame:2,type:'clear'}];
    const frame=sceneAtTime(doc,1).evaluatedSpirographFrame!;
    expect(frame.closed[0]).toBe(false);expect(frame.clearedPhases[0]).toBe(30);
    const recording=generateScene(doc,{...context,spirographFrame:{frame:1,recording:{startFrame:2,fps:4}}}).spirographFrame!;
    expect(recording.absoluteFrame).toBe(3);expect(recording.frame).toBe(1);expect(recording.encodedFrames).toBe(0);
    expect(recording.rotationRadians).toBeGreaterThan(frame.rotationRadians);
  });
  it('cancels replay, recovers cold, and rejects requests outside their clock contract',()=>{
    const doc=scene(),owner=new TemporalGenerationSession();
    expect(()=>generateScene(doc,{...context,spirographFrame:{frame:5},isCancelled:()=>true},owner)).toThrow('取消');
    expect(generateScene(doc,{...context,spirographFrame:{frame:2}},owner).spirographFrame!.frame).toBe(2);
    const old=structuredClone(doc);delete old.settings.spirographClock;
    expect(()=>generateScene(old,{...context,spirographFrame:{frame:2}},owner)).toThrow('不适用');
    expect(()=>generateScene(doc,{...context,spirographFrame:{frame:-1}},owner)).toThrow();
    owner.reset();
  });
  it('plans fresh and current-state recording with a separate recording clock and one warmup draw',()=>{
    const doc=scene([rotate('record',3,2)]),owner=new SpirographFrameSession();
    const preview=owner.sample(doc,0,{frame:2});
    expect(preview.sceneTime).toBe(1);
    // Three seconds at 4 fps give 12 updates. A current-state fork starts after
    // two preview updates at 2 fps, leaving eight. Each skips its first draw.
    expect(owner.recordingPlan(doc,0,4)).toEqual({startFrame:0,fps:4,encodedFrames:11,updates:12,firstEncodedUpdate:2,finished:true});
    const current=owner.recordingPlan(doc,2,4);
    expect(current).toEqual({startFrame:2,fps:4,encodedFrames:7,updates:8,firstEncodedUpdate:2,finished:true});
    const terminal=owner.sample(doc,0,{frame:current.updates,recording:{startFrame:2,fps:4}});
    expect(terminal.absoluteFrame).toBe(10);
    expect(terminal.recordingFinished).toBe(true);
    expect(terminal.encodedFrameIndex).toBe(6);
    expect(owner.sample(doc,0,{frame:2})).toEqual(preview);
    owner.reset();
  });
  it('returns a completed zero-output recording plan for empty or already finished queues',()=>{
    const owner=new SpirographFrameSession();
    for(const [doc,startFrame] of [[scene([]),0],[scene([rotate('done',3,2)]),6]] as const){
      expect(owner.recordingPlan(doc,startFrame,4)).toEqual({startFrame,fps:4,encodedFrames:0,updates:1,firstEncodedUpdate:null,finished:true});
    }
    owner.reset();
  });
});
