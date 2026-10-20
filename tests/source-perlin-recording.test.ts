import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {ordinarySourceCameraInitial} from '../src/engine/ordinarySourceCamera';
import {OrdinarySourceCameraTimelineSession,resolveOrdinarySourceCameraTimeline,clearOrdinarySourceCameraTimelineCache} from '../src/engine/ordinarySourceCameraTimeline';
import {planPerlinFreshRecording,withPerlinFreshRecording,assertPerlinRecordingFrame} from '../src/engine/sourcePerlinRecording';
import type {SceneOutput} from '../src/types';
import golden from './fixtures/source-perlin/recording-clock.json';
const scene=(durations:number[])=>{
 const s=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'PERLIN',name:'Recording',settings:{render_mode:'CPU',particle_count:3,seed:123},timeline:[]})).scene;
 s.timeline.tracks=durations.map((duration,index)=>({id:`clip-${index}`,type:'wait',target:'camera.actions',duration,start:0,from:0,to:0,enabled:true,pingPong:false,easing:'linear'}));
 return s;
};
describe('Perlin source-queue recording clock (independent bytecode transcript)',()=>{
 it.each(golden.cases)('$name',row=>{
  const s=scene(row.durations),before=structuredClone(s),plan=planPerlinFreshRecording(s,{simulationFps:row.fps,encoderFps:7});
  expect(plan).toEqual({policy:'fresh-local-source-queue-replay',simulationFps:row.fps,encoderFps:7,warmupUpdates:1,
   updates:row.stopOrdinal,encodedFrames:row.encodedFrames,firstEncodedUpdate:row.encodedFrames?2:null,lastDisplayFrame:row.stopOrdinal-1,completionReason:'animation-queue'});
  const updated:{time:number;deltaTime:number}[]=[],displayed:number[]=[];
  const session=new OrdinarySourceCameraTimelineSession(ordinarySourceCameraInitial(s)!,s.timeline.tracks,row.fps,{particleActions:'perlin',
   createParticles:()=>({bind:()=>{throw Error('No binding in wait fixture');},update:frame=>updated.push(frame),displayFrame:index=>displayed.push(index)}),
  });
  let updateCount=0;
  for(const expected of row.frames){
   const frame=session.evaluate((expected.ordinal-1)/row.fps);
   expect(frame).toMatchObject({frameIndex:expected.ordinal-1,queueIndex:expected.queueIndex,queueComplete:expected.queueComplete,sceneTime:expected.sceneTime});
   if(expected.mobjectUpdated){updateCount++;expect(updated.at(-1)).toMatchObject({time:expected.sceneTime,deltaTime:expected.activeDt});}
   expect(updated).toHaveLength(updateCount);
   expect(expected.encoded).toBe(expected.ordinal>1);
  }
  expect(displayed).toEqual(row.frames.map(f=>f.ordinal-1));
  expect(s).toEqual(before);session.reset();
 });
 it('retains exact integer completion count in cached layout without allowing caller mutation',()=>{
  clearOrdinarySourceCameraTimelineCache();const s=scene([1]),initial=ordinarySourceCameraInitial(s)!;
  const a=resolveOrdinarySourceCameraTimeline(initial,s.timeline.tracks,60,{particleActions:'perlin'});
  expect(a.updates).toBe(61);a.updates=500;a.clips[0].duration=999;
  const b=resolveOrdinarySourceCameraTimeline(initial,s.timeline.tracks,60,{particleActions:'perlin'});expect(b.updates).toBe(61);expect(b.clips[0].duration).toBe(61/60);
 });
 it('separates encoder fps from simulation and preserves authored document',()=>{
  const s=scene([1]),before=structuredClone(s),a=planPerlinFreshRecording(s,{simulationFps:60,encoderFps:24}),b=planPerlinFreshRecording(s,{simulationFps:60,encoderFps:120});
  expect({...a,encoderFps:120}).toEqual(b);expect(s).toEqual(before);
  const fresh=withPerlinFreshRecording(s,24);expect(fresh.timeline.fps).toBe(24);expect(s).toEqual(before);
 });
 it('rejects invalid configuration, rates, unsupported clips, and cancellation before cached work',()=>{
  const s=scene([1]);
  for(const rate of [NaN,Infinity,0,121,1.5]){
   expect(()=>planPerlinFreshRecording(s,{simulationFps:rate,encoderFps:24})).toThrow('模拟帧率');
   expect(()=>planPerlinFreshRecording(s,{simulationFps:24,encoderFps:rate})).toThrow('编码帧率');
  }
  expect(()=>withPerlinFreshRecording({...s,perlinSource:undefined},24)).toThrow('完整配置');
  expect(()=>withPerlinFreshRecording({...s,perlinSource:{...s.perlinSource!,seed:'invalid'}},24)).toThrow();
  const bad=structuredClone(s);bad.timeline.tracks[0].type='param';expect(()=>planPerlinFreshRecording(bad,{simulationFps:24,encoderFps:24})).toThrow('不支持');
  planPerlinFreshRecording(s,{simulationFps:24,encoderFps:24});
  expect(()=>planPerlinFreshRecording(s,{simulationFps:24,encoderFps:24,isCancelled:()=>true})).toThrow(expect.objectContaining({name:'AbortError'}));
  let calls=0;expect(()=>planPerlinFreshRecording(scene([100]),{simulationFps:24,encoderFps:24,isCancelled:()=>++calls>12})).toThrow(expect.objectContaining({name:'AbortError'}));
 });
 it('rejects observed early/late completion and wrong frame identity, including warmup',()=>{
  const plan=planPerlinFreshRecording(scene([.001,.001,.001]),{simulationFps:24,encoderFps:24});
  const output:SceneOutput={type:'raster',width:1,height:1,pixels:new Uint8ClampedArray(4),stats:{generated:1,samples:1,invalid:0,elapsedMs:0},
   sourcePerlinFrame:{frameIndex:0,updates:1,queueComplete:false,queueIndex:1,sceneTime:.003,samples:0,sourceViewport:{width:1,height:1,pixelDensity:1}}};
  expect(()=>assertPerlinRecordingFrame(output,plan,0)).not.toThrow();
  expect(()=>assertPerlinRecordingFrame(output,plan,1)).toThrow('完成状态');
  output.sourcePerlinFrame!.queueComplete=true;expect(()=>assertPerlinRecordingFrame(output,plan,0)).toThrow();
  output.sourcePerlinFrame!.frameIndex=2;expect(()=>assertPerlinRecordingFrame(output,plan,2)).not.toThrow();
  output.sourcePerlinFrame!.queueComplete=false;expect(()=>assertPerlinRecordingFrame(output,plan,2)).toThrow();
  expect(()=>assertPerlinRecordingFrame({...output,sourcePerlinFrame:undefined},plan,0)).toThrow();
 });
});
