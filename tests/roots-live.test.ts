import {describe,expect,it} from 'vitest';
import {validateRootsLiveContext} from '../src/engine/rootsLive';
import {snapshotGenerationInput} from '../src/engine/generationInput';
import {RootsSceneClock} from '../src/engine/rootsSceneClock';
import {SourceSceneHostClock} from '../src/engine/sourceSceneHostClock';
import {generateScene} from '../src/engine/temporal';
import {createScene} from '../src/engine/document';
import {definitions} from '../src/scenes/complex';
import {createRootsNativeMath} from '../src/engine/rootsMathConfig';
import {defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
const live={sessionId:'source-roots',maximumWorkers:4,clock:{paused:true,timestampMs:1000}};
describe('explicit live roots boundary',()=>{
 it('rejects invalid authority, capacity and clock inputs before starting workers',()=>{
  for(const value of [null,{}, {...live,sessionId:' '},{...live,maximumWorkers:0},{...live,maximumWorkers:Infinity},{...live,clock:{paused:1}},{...live,clock:{paused:true,timestampMs:NaN}}])expect(()=>validateRootsLiveContext(value)).toThrow();
  const copy=snapshotGenerationInput({time:0,width:10,height:10,quality:'preview',rootsPixelDensity:2,rootsLive:structuredClone(live)});
  expect(copy.rootsPixelDensity).toBe(2);expect(copy.rootsLive).toEqual(live);expect(copy.rootsLive?.clock).not.toBe(live.clock);
 });
 it('rejects conflicting scene clocks before worker or GPU ownership',()=>{
  const scene=createScene(definitions.find(d=>d.kind==='roots')!);scene.rootsMath=createRootsNativeMath();scene.rootsPresentation=defaultRootsPresentationConfiguration();
  expect(()=>generateScene(scene,{time:0,width:10,height:10,quality:'preview',rootsLive:live,perlinLive:{} as never})).toThrow('一个实时或录制时钟');
 });
 it('restores saved F32 angles without rewinding queue or gradient state',()=>{
  const camera={phi:.1,theta:.2,gamma:.3,zoom:1},clock=new RootsSceneClock(camera,[{duration:1,easing:'linear',rates:[1,2,3]}]),host=new SourceSceneHostClock(false,camera);
  clock.step(.2);host.setPaused(true,clock.snapshot().camera);const saved=clock.snapshot();clock.writeAngles({phi:9,theta:8,gamma:7});
  const restore=host.setPaused(false,clock.snapshot().camera,9000)!;clock.writeAngles(restore);
  expect(clock.snapshot()).toEqual(saved);expect(host.update({paused:false,timestampMs:9033})).toBeCloseTo(.033,5);
  expect(()=>clock.writeAngles({phi:1,theta:NaN,gamma:3})).toThrow();expect(clock.snapshot()).toEqual(saved);
 });
});
