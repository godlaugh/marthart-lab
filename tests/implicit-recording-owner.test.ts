import {afterEach,describe,expect,it,vi} from 'vitest';
import {SourceImplicitRecordingSession} from '../src/engine/sourceImplicitRecording';
import {generateScene} from '../src/engine/temporal';
import {parseProjectFile} from '../src/engine/legacyImport';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import * as geometry from '../src/scenes/geometry';
import native from './fixtures/source-implicit-presentation/recording-clock.json';
import type {GenerateContext} from '../src/types';
function setup(){
 const raw=structuredClone(native.cases[0].input.project);raw.settings.x_segments=raw.settings.y_segments=raw.settings.z_segments=4;
 const scene=parseProjectFile(JSON.stringify(raw)).scene;let cancelled=false;
 const context:GenerateContext={time:0,width:810,height:972,quality:'preview',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,405,486,'primary',486),isCancelled:()=>cancelled};
 const output=generateScene(scene,context);if(output.type!=='geometry')throw Error('geometry');const owner=new SourceImplicitRecordingSession();owner.admitPrimary(scene,context,output);
 const options={width:128,height:96,simulationFps:4,actualFrameRate:37};
 return{owner,scene,context,options,cancel:()=>{cancelled=true;}};
}
afterEach(()=>vi.restoreAllMocks());
describe('Implicit numerical recording ownership',()=>{
 it('retains primary on cancelled admission and can stop after subsequent cancellation without advancing',()=>{
  const before=setup();before.cancel();expect(()=>before.owner.beginRecording(before.scene,before.context,before.options)).toThrowError(expect.objectContaining({name:'AbortError'}));expect(before.owner.matchesCompletedPrimary(before.scene,before.context)).toBe(true);before.owner.reset();
  const f=setup(),start=f.owner.beginRecording(f.scene,f.context,f.options);f.cancel();expect(()=>f.owner.nextRecordingFrame(start.handle,1,12)).toThrowError(expect.objectContaining({name:'AbortError'}));expect(f.owner.ownsRecording(start.handle)).toBe(true);
  const stop=f.owner.finishRecording(start.handle);expect(stop.preview.sourceCameraFrame?.camera).toEqual(start.warmup.sourceCameraFrame?.camera);expect(stop.preview.sourceCameraFrame?.frameIndex).toBe(0);expect(f.owner.matchesCompletedPrimary(stop.scene,stop.context)).toBe(true);f.owner.reset();
 });
 it('retries failed geometry from the consumed numeric frame and stops failed attempts without an extra update',()=>{
  const f=setup(),start=f.owner.beginRecording(f.scene,f.context,f.options);const generate=vi.spyOn(geometry,'generateImplicit');generate.mockImplementationOnce(()=>{throw Error('geometry failure');});
  expect(()=>f.owner.nextRecordingFrame(start.handle,1,12)).toThrow('geometry failure');expect(f.owner.ownsRecording(start.handle)).toBe(true);expect(()=>f.owner.nextRecordingFrame(start.handle,1,24)).toThrow('实际帧率');
  const frame=f.owner.nextRecordingFrame(start.handle,1,12);expect(frame.sourceCameraFrame?.frameIndex).toBe(1);
  generate.mockImplementationOnce(()=>{throw Error('second geometry failure');});expect(()=>f.owner.nextRecordingFrame(start.handle,2,1)).toThrow('second geometry failure');
  const stop=f.owner.finishRecording(start.handle);expect(stop.preview.sourceCameraFrame?.frameIndex).toBe(2);expect(stop.preview.sourceCameraFrame).toMatchObject({sceneTime:.75});f.owner.reset();
 });
 it('retries failed stop materialization at the same frame and keeps the original authored FPS',()=>{
  const f=setup(),start=f.owner.beginRecording(f.scene,f.context,f.options);const original=structuredClone(f.scene);
  vi.spyOn(geometry,'generateImplicit').mockImplementationOnce(()=>{throw Error('stop geometry failure');});expect(()=>f.owner.finishRecording(start.handle)).toThrow('stop geometry failure');expect(f.owner.ownsRecording(start.handle)).toBe(true);expect(()=>f.owner.nextRecordingFrame(start.handle,1,12)).toThrow('连续帧');
  const stop=f.owner.finishRecording(start.handle);expect(stop.preview.sourceCameraFrame?.frameIndex).toBe(0);expect(stop.scene).toEqual(original);expect(stop.scene.timeline.fps).toBe(30);
  const replay=f.owner.finishRecording(start.handle);expect(replay.preview.positions).toEqual(stop.preview.positions);expect(replay.preview.sourceCameraFrame).toEqual(stop.preview.sourceCameraFrame);f.owner.reset();expect(()=>f.owner.finishRecording(start.handle)).toThrow('身份');
 });
});
