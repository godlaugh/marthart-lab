import {describe,it,expect} from 'vitest';
import {validSourceObservedRecordingClock,validSourceQueueRecordingClock} from '../src/engine/sourceRecordingClock';
const observed={simulationFps:30,warmupUpdates:1,completionReason:'observed-roots-display'};
const planned={simulationFps:30,warmupUpdates:1,updates:3,encodedFrames:2,firstEncodedUpdate:2,lastDisplayFrame:2,completionReason:'animation-queue'};
describe('recording completion contracts',()=>{
 it('keeps unknown asynchronous completion separate from known queue ordinals',()=>{
  expect(validSourceObservedRecordingClock(observed,30)).toBe(true);expect(validSourceQueueRecordingClock(observed,30)).toBe(false);
  expect(validSourceQueueRecordingClock(planned,30)).toBe(true);expect(validSourceObservedRecordingClock(planned,30)).toBe(false);
  for(const key of ['updates','encodedFrames','firstEncodedUpdate','lastDisplayFrame'])for(const value of [undefined,null,0,3])expect(validSourceObservedRecordingClock({...observed,[key]:value},30)).toBe(false);
 });
 it('rejects mismatched rate, invented ordinals and unsupported rate domains',()=>{
  for(const rate of [0,-1,NaN,Infinity,121]){
   expect(validSourceQueueRecordingClock({...planned,simulationFps:rate},rate)).toBe(false);
   expect(validSourceObservedRecordingClock({...observed,simulationFps:rate},rate)).toBe(false);
  }
  expect(validSourceObservedRecordingClock(observed,60)).toBe(false);
  expect(validSourceObservedRecordingClock({...observed,simulationFps:29.97},29.97)).toBe(false);
  for(const patch of [{updates:2},{encodedFrames:3},{lastDisplayFrame:3},{firstEncodedUpdate:null},{warmupUpdates:0}])expect(validSourceQueueRecordingClock({...planned,...patch},30)).toBe(false);
  expect(validSourceQueueRecordingClock({...planned,updates:1,encodedFrames:0,lastDisplayFrame:0,firstEncodedUpdate:null},30)).toBe(true);
 });
});
