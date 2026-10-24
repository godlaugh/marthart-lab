import {sourcePaletteRuntimeScene} from '../src/engine/sourcePaletteRuntimeScene';
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
  const stop=f.owner.finishRecording(start.handle);expect(stop.preview.sourceCameraFrame?.frameIndex).toBe(0);expect(stop.scene).toEqual(sourcePaletteRuntimeScene(original));expect(stop.scene.timeline.fps).toBe(30);
  const replay=f.owner.finishRecording(start.handle);expect(replay.preview.positions).toEqual(stop.preview.positions);expect(replay.preview.sourceCameraFrame).toEqual(stop.preview.sourceCameraFrame);f.owner.reset();expect(()=>f.owner.finishRecording(start.handle)).toThrow('身份');
 });
});


describe('Implicit continuation failure ownership',()=>{
 it('does not reset the stop baseline when re-materializing after a failed stop',()=>{
  const f=setup(),start=f.owner.beginRecording(f.scene,f.context,f.options);
  vi.spyOn(geometry,'generateImplicit').mockImplementationOnce(()=>{throw Error('stop readback');});
  expect(()=>f.owner.finishRecording(start.handle,1000)).toThrow('stop readback');
  const stop=f.owner.finishRecording(start.handle,2000);
  const output=f.owner.generateContinuation(stop.scene,{...stop.context,implicitLive:{...stop.context.implicitLive!,clock:{paused:false,timestampMs:1125}}});
  expect(output.sourceCameraFrame).toMatchObject({frameIndex:1,rawDt:.125,sceneTime:.375});
  expect(()=>f.owner.finishRecording(start.handle)).toThrow('身份');f.owner.reset();
 });
 it('rejects a second clock before consuming a live update',()=>{
  const f=setup(),start=f.owner.beginRecording(f.scene,f.context,f.options),stop=f.owner.finishRecording(start.handle,1000);
  const context={...stop.context,implicitLive:{...stop.context.implicitLive!,clock:{paused:false,timestampMs:1125}}};
  expect(()=>f.owner.generateContinuation(stop.scene,{...context,fractalRecording:{} as NonNullable<GenerateContext['fractalRecording']>})).toThrow('自身主视口');
  expect(f.owner.generateContinuation(stop.scene,context).sourceCameraFrame).toMatchObject({frameIndex:1,sceneTime:.375});f.owner.reset();
 });
 it('invalidates continuation after an update whose geometry could not be delivered',()=>{
  const f=setup(),start=f.owner.beginRecording(f.scene,f.context,f.options),stop=f.owner.finishRecording(start.handle,1000);
  const context={...stop.context,implicitLive:{...stop.context.implicitLive!,clock:{paused:false,timestampMs:1125}}};
  vi.spyOn(geometry,'generateImplicit').mockImplementationOnce(()=>{throw Error('live geometry');});
  expect(()=>f.owner.generateContinuation(stop.scene,context)).toThrow('live geometry');
  expect(f.owner.matchesCompletedPrimary(stop.scene,stop.context)).toBe(false);
  expect(()=>f.owner.generateContinuation(stop.scene,context)).toThrow('原录制');f.owner.reset();
 });
});

describe('Implicit paused geometry materialization',()=>{
 it('retains numerical ownership after failed rematerialization and rejects copied capabilities',()=>{
  const f=setup(),start=f.owner.beginRecording(f.scene,f.context,f.options),stop=f.owner.finishRecording(start.handle,1000);
  const context=f.owner.setPaused(stop.scene,stop.context,true,2000);
  expect(()=>f.owner.capturePaused(stop.scene,{...context},{width:65,height:49},1)).toThrow('已完成');
  vi.spyOn(geometry,'generateImplicit').mockImplementationOnce(()=>{throw Error('capture allocation');});
  expect(()=>f.owner.capturePaused(stop.scene,context,{width:65,height:49},1)).toThrow('capture allocation');
  expect(f.owner.matchesCompletedPrimary(stop.scene,context)).toBe(true);
  const capture=f.owner.capturePaused(stop.scene,context,{width:65,height:49},1);
  expect(capture.preview.sourceCameraFrame).toEqual(stop.preview.sourceCameraFrame);
  const resumed=f.owner.setPaused(stop.scene,context,false,3000);
  expect(f.owner.generateContinuation(stop.scene,{...resumed,implicitLive:{...resumed.implicitLive!,clock:{paused:false,timestampMs:3125}}}).sourceCameraFrame).toMatchObject({sceneTime:.375,rawDt:.125,frameIndex:1});f.owner.reset();
 });
});
