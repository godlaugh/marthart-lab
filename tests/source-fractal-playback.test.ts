import {describe,expect,it} from 'vitest';
import fixture from './fixtures/source-fractal-clock/source.json';
import {SourceFractalSceneClock,type SourceFractalObjectState,type SourceFractalSceneClip} from '../src/engine/sourceFractalSceneClock';
import {SourceFractalPlaybackSession} from '../src/engine/sourceFractalPlayback';
const initial=():SourceFractalObjectState=>({centerX:0,centerY:0,centerXLow:0,centerYLow:0,zoom:1,rotation:0,rotationRate:.25,iterations:127,bailout:4,juliaReal:-.7,juliaImag:.27015,ambientAngles:[0,0,0],ambientRates:[0,.5,0],currentTime:0});
function clips(id=4):SourceFractalSceneClip[]{return fixture.cases[id].input.timeline.map(c=>c.type==='fractal_zoom'?{kind:'target',duration:c.duration,easing:'linear',target:{model:'mathart-1.7.8-target',zoom:Number('zoom' in c?c.zoom:1),centerX:Number('center' in c?c.center![0]:0),centerY:Number('center' in c?c.center![1]:0),centerXLow:0,centerYLow:0,maxZoom:1e300}}:{kind:'wait',duration:c.duration});}
function create(fps=24,queue=clips(),isCancelled?:()=>boolean){let creations=0;return{session:new SourceFractalPlaybackSession({fps,isCancelled,createScene:()=>{creations++;return new SourceFractalSceneClock(initial(),queue);}}),creations:()=>creations};}
const near=(a:number,b:number)=>expect(Math.abs(a-b)).toBeLessThanOrEqual(Math.max(Number.MIN_VALUE,Math.abs(b)*Number.EPSILON*8));
function compare(frame:ReturnType<SourceFractalPlaybackSession['evaluate']>,row:typeof fixture.cases[number]['frames'][number]){
 expect(frame.sceneTime).toBe(row.state.sceneTime.value);expect(frame.queueIndex).toBe(row.state.managerIndex);expect(frame.queueComplete).toBe(row.state.managerFinished);expect(frame.object.rotation).toBe(row.state.fractalRotation.value);expect(frame.cameraAngles[1]).toBe(row.state.cameraTheta.value);
 (['zoom','centerX','centerXLow','centerY','centerYLow'] as const).forEach((key,i)=>near(frame.object[key],Number(row.state.viewport[i].value)));
}
describe('Fractal host frame selection and recording ordinals',()=>{
 it('renders actual original fixed 24 FPS updates, retaining one state and rebuilding backwards',()=>{
  const {session,creations}=create(),sample=fixture.cases[4];
  sample.frames.forEach(row=>{const frame=session.evaluateFrame(row.index);expect(frame.displayFrame).toBe(row.index);compare(frame,row);});
  expect(creations()).toBe(1);compare(session.evaluate(0),sample.frames[0]);expect(creations()).toBe(2);
  compare(session.evaluate(.5/24),sample.frames[0]);expect(creations()).toBe(2);
 });
 it('matches original fresh realtime zero update then fixed 60 FPS steps without substituting sampled seconds',()=>{
  const {session}=create(60,clips(5)),sample=fixture.cases[5];expect(session.snapshot().displayFrame).toBe(-1);
  sample.frames.forEach(row=>compare(session.step(row.index===0?0:Math.fround(1/60)),row));
  expect(()=>session.evaluate(0)).toThrow('实时');
 });
 it('plans the original completion update including one discarded warmup, and no hold frame',()=>{
  const {session}=create(),originalEnd=fixture.cases[4].frames.find(row=>row.state.managerFinished)!.index;
  expect(session.planRecording()).toEqual({simulationFps:24,warmupUpdates:1,updates:originalEnd+1,encodedFrames:originalEnd,firstEncodedUpdate:2,lastDisplayFrame:originalEnd,completionReason:'animation-queue'});
  expect(create(60,[]).session.planRecording()).toMatchObject({updates:1,encodedFrames:0,firstEncodedUpdate:null,lastDisplayFrame:0});
  expect(create(60,[{kind:'wait',duration:0}]).session.planRecording()).toMatchObject({updates:1,encodedFrames:0});
 });
 it('requires explicit reconstruction between clock modes and recovers cancellation only after reset',()=>{
  let cancelled=false;const {session}=create(24,clips(),()=>cancelled);
  session.evaluate(0);expect(()=>session.step(.1)).toThrow('明确重建');const reconstructed=session.reconstruct(0);expect(session.step(0,true).object).toEqual(reconstructed.object);
  cancelled=true;expect(()=>session.step(.1)).toThrow('取消');cancelled=false;expect(()=>session.snapshot()).toThrow('需要重置');session.reset();expect(session.snapshot().displayFrame).toBe(-1);
 });
 it('preserves AbortError when cancellation arrives during a child update',()=>{
  let cancelled=false,interrupt=true;
  const session=new SourceFractalPlaybackSession({fps:60,isCancelled:()=>cancelled,createScene:()=>new SourceFractalSceneClock(initial(),[{kind:'wait',duration:1}],{update(){if(interrupt)cancelled=true;}})});
  expect(()=>session.step(.1)).toThrow(expect.objectContaining({name:'AbortError'}));
  cancelled=false;interrupt=false;expect(()=>session.snapshot()).toThrow('需要重置');session.reset();expect(()=>session.step(.1)).not.toThrow();
 });
 it('rejects non-ordinal and out-of-domain frame requests before creating or poisoning state',()=>{
  const {session,creations}=create();
  for(const frame of [-1,.5,NaN,Infinity,Number.MAX_SAFE_INTEGER])expect(()=>session.evaluateFrame(frame)).toThrow('显示帧');
  expect(creations()).toBe(0);compare(session.evaluateFrame(0),fixture.cases[4].frames[0]);expect(creations()).toBe(1);
  const live=create().session;live.step(0);expect(()=>live.evaluateFrame(0)).toThrow('实时');
 });
});
