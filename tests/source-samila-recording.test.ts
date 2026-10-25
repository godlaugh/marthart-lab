import {describe,expect,it,vi} from 'vitest';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {SourceSamilaAsyncSession,type SourceSamilaAsyncBackend} from '../src/engine/sourceSamilaAsyncSession';
import type {SourceSamilaPreparedDisplay,SourceSamilaDisplayResult} from '../src/engine/sourceSamilaSession';
import {ensureSourceSamilaPaletteSession,writeSourceSamilaParameter,sourceSamilaOwnerScene} from '../src/engine/sourceSamilaPaletteEditing';
import {assertSourceSamilaRecordingFrame} from '../src/engine/sourceSamilaRecording';
import {SourceRecordingOperationError} from '../src/engine/generationProtocol';
import type {GenerateContext} from '../src/types';

const handle={sessionId:1,recordingId:1},options={width:5,height:3,simulationFps:10};
const context:GenerateContext={time:0,width:17,height:13,quality:'preview',samilaPrimaryPixelHeight:1080,samilaLive:{sessionId:'owner',pixelDensity:2,clock:{paused:true}}};
function scene(durations=[.15]){const s=parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'SAMILA',name:'Recording owner',palette:['#ffffff','#ffffff'],parameters:{a:0},equations:{f1:'.1+a',f2:'.2'},settings:{batch_size:13},timeline:durations.map(duration=>({type:'wait',duration}))})).scene;s.settings.iteratedBackend='gpu';return ensureSourceSamilaPaletteSession(s);}
function result(display:SourceSamilaPreparedDisplay):SourceSamilaDisplayResult {const n=display.job.history!.samples,pixels=new Uint8ClampedArray(display.options.width*display.options.height*4);pixels.set([37,41,53,67]);return{facts:{bounds:{minX:-1,maxX:1,minY:-1,maxY:1},steps:n,accepted:n,invalid:0,sampleInvalid:0,clipped:0},shown:{pixels,occupiedPixels:1,maxCount:1,toneBackend:'native',warnings:[]}};}
function fixture(){const backend={admitDisplay:vi.fn<SourceSamilaAsyncBackend['admitDisplay']>(()=>{}),draw:vi.fn<SourceSamilaAsyncBackend['draw']>(async p=>result(p)),reset:vi.fn(async()=>{}),cancel:vi.fn()},now=vi.fn(()=>1000),seeds=vi.fn(()=>7);return{backend,now,seeds,owner:new SourceSamilaAsyncSession(backend,{samilaSeedProvider:seeds,hostClock:{now,source:'page-wall-clock'}})};}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return{promise,resolve};}

describe('Samila retained recording owner (CPU backend boundary, no GPU parity claim)',()=>{
 it('resets last Apply, makes exactly one scale-3 warmup, and keeps author metadata',async()=>{
  const f=fixture(),s=writeSourceSamilaParameter(scene(),'a',2);await f.owner.generate(s,context);const start=await f.owner.beginRecording(s,context,options,handle);
  expect(start.clock).toMatchObject({updates:2,encodedFrames:1,warmupUpdates:1});expect(start.context.samilaLive).toMatchObject({sessionId:'owner',dirtyRevision:0,runtimeRevision:0,parameterRevisions:{},clock:{paused:false}});
  expect(start.scene.parameters.a).toBe(2);expect(start.scene.samilaPaletteSession!.effective.parameters.a).toBe(0);expect(start.scene.samilaPaletteSession!.applied.parameters.a).toBe(0);
  expect([start.warmup.width,start.warmup.height]).toEqual([16,10]);expect(start.warmup.samilaLive).toMatchObject({target:'offscreen',displayIndex:0,runtime:{updates:1,sceneTime:Math.fround(.1),rawDt:Math.fround(.1),paused:false,clockSource:'fixed-step'}});
  expect(f.backend.draw).toHaveBeenCalledTimes(2);expect(f.backend.reset).toHaveBeenCalledTimes(2);expect(f.owner.diagnostics().parameters.a).toBe(0);expect(f.now).not.toHaveBeenCalled();
  expect([...start.warmup.pixels.slice(0,4)]).toEqual([37,41,53,67]);assertSourceSamilaRecordingFrame(start.warmup,start.clock as never,0);
  for(const patch of [{clockSource:'page-wall-clock' as const},{rawDt:0},{paused:true},{updates:2}])expect(()=>assertSourceSamilaRecordingFrame({...start.warmup,samilaLive:{...start.warmup.samilaLive!,runtime:{...start.warmup.samilaLive!.runtime!,...patch}}},start.clock as never,0)).toThrow('实际队列');
  await f.owner.finishRecording(handle,5000);await f.owner.release();
 });
 it('encodes the actual completing update, rejects skipped/duplicate/terminal requests, then hands off the first normal update and display',async()=>{
  const f=fixture(),s=scene();await f.owner.generate(s,context);const start=await f.owner.beginRecording(s,context,options,handle);await expect(f.owner.nextRecordingFrame(handle,2)).rejects.toThrow('连续');
  const frame=await f.owner.nextRecordingFrame(handle,1);assertSourceSamilaRecordingFrame(frame,start.clock as never,1);expect(frame.samilaRecording).toMatchObject({complete:true,warmup:false,sceneTime:Math.fround(.15)});
  await expect(f.owner.nextRecordingFrame(handle,1)).rejects.toThrow('连续');await expect(f.owner.nextRecordingFrame(handle,2)).rejects.toThrow('连续');
  const before=f.owner.diagnostics().runtime!,stop=await f.owner.finishRecording(handle,5000);expect(stop.preview.type).toBe('raster');expect(stop.preview).toMatchObject({width:17,height:13,samilaLive:{target:'primary',recordingHandoff:'first-post-stop-primary-frame',runtime:{updates:before.updates+1,sceneTime:before.sceneTime,rawDt:0,paused:false}}});
  expect(f.owner.diagnostics().hostClock?.lastTime).toBe(5);expect(f.owner.hasRecording(handle)).toBe(false);expect(f.backend.reset).toHaveBeenCalledTimes(2);expect(f.backend.draw).toHaveBeenCalledTimes(4);expect(f.owner.matchesCompletedPrimary(stop.scene,stop.context)).toBe(true);
  await f.owner.generate(stop.scene,{...stop.context,samilaLive:{...stop.context.samilaLive!,clock:{paused:false,timestampMs:5100}}});expect(f.owner.diagnostics().runtime?.rawDt).toBe(Math.fround(Math.fround(5.1)-5));await f.owner.release();
 });
 it('an empty queue completes its warmup and exposes zero encodable frames',async()=>{
  const f=fixture(),s=scene([]);await f.owner.generate(s,context);const start=await f.owner.beginRecording(s,context,options,handle);expect(start.clock).toMatchObject({updates:1,encodedFrames:0,firstEncodedUpdate:null});expect(start.warmup.samilaRecording).toMatchObject({warmup:true,complete:true});await expect(f.owner.nextRecordingFrame(handle,1)).rejects.toThrow('连续');await f.owner.finishRecording(handle);await f.owner.release();
 });
 it('manual stop keeps the unfinished queue, uses a real dt-zero host update, and rejects a copied capability',async()=>{
  const f=fixture(),s=scene([1]);await f.owner.generate(s,context);const start=await f.owner.beginRecording(s,context,options,handle);expect(start.handle).toBe(handle);expect(f.owner.hasRecording({...handle})).toBe(false);await expect(f.owner.nextRecordingFrame({...handle},1)).rejects.toMatchObject({recordingRetained:false});
  const stop=await f.owner.finishRecording(handle,7000);expect(stop.preview).toMatchObject({samilaLive:{recordingHandoff:'first-post-stop-primary-frame',runtime:{updates:2,sceneTime:Math.fround(.1),rawDt:0,queueComplete:false,paused:false}}});
  const next=await f.owner.generate(stop.scene,{...stop.context,samilaLive:{...stop.context.samilaLive!,clock:{paused:false,timestampMs:7100}}});expect(next.samilaLive?.runtime).toMatchObject({updates:3,queueComplete:false});expect(next.samilaLive!.runtime!.sceneTime).toBeGreaterThan(Math.fround(.1));await f.owner.release();
 });
 it('rejects capacity before reset, seed or primary ownership mutation',async()=>{
  const f=fixture(),s=scene();await f.owner.generate(s,context);f.backend.admitDisplay.mockImplementation(b=>{if(b.width===16)throw Error('capacity');});await expect(f.owner.beginRecording(s,context,options,handle)).rejects.toMatchObject({previewRetained:true,recordingRetained:false});expect(f.owner.matchesCompletedPrimary(s,context)).toBe(true);expect(f.seeds).toHaveBeenCalledOnce();expect(f.backend.draw).toHaveBeenCalledOnce();expect(f.owner.hasRecording(handle)).toBe(false);await f.owner.release();
 });
 it('keeps the first full-load anchor for a compatible document without palette persistence',async()=>{
  const f=fixture(),initial=scene();delete initial.samilaSourcePalette;delete initial.samilaPaletteSession;await f.owner.generate(initial,context);const hot={...initial,parameters:{a:3}};await f.owner.generate(hot,context);const start=await f.owner.beginRecording(hot,context,options,handle);expect(start.scene.parameters.a).toBe(0);expect(f.owner.diagnostics().parameters.a).toBe(0);await f.owner.finishRecording(handle);await f.owner.release();
 });
 it('retains unknown warmup failure solely for exact release and retries failed cleanup without another draw',async()=>{
  const f=fixture(),s=scene();await f.owner.generate(s,context);f.backend.draw.mockRejectedValueOnce(Error('unknown commit'));await expect(f.owner.beginRecording(s,context,options,handle)).rejects.toMatchObject({previewRetained:false,recordingRetained:true,handle});expect(f.owner.hasRecording(handle)).toBe(true);
  f.backend.reset.mockRejectedValueOnce(Error('release pending'));await expect(f.owner.finishRecording(handle)).rejects.toMatchObject({previewRetained:false,recordingRetained:true});expect(f.owner.hasRecording(handle)).toBe(true);await expect(f.owner.finishRecording(handle)).rejects.toMatchObject({previewRetained:false,recordingRetained:false});expect(f.owner.hasRecording(handle)).toBe(false);expect(f.backend.draw).toHaveBeenCalledTimes(2);expect(f.backend.cancel).not.toHaveBeenCalled();await f.owner.release();
 });
 it('a failed primary handoff can only release, never repeat its update, random word or display',async()=>{
  const f=fixture(),s=scene([1]);await f.owner.generate(s,context);await f.owner.beginRecording(s,context,options,handle);f.backend.draw.mockRejectedValueOnce(Error('restore unknown'));await expect(f.owner.finishRecording(handle,7000)).rejects.toMatchObject({previewRetained:false,recordingRetained:true});expect(f.owner.diagnostics().runtime?.updates).toBe(2);const draws=f.backend.draw.mock.calls.length,seeds=f.seeds.mock.calls.length;await expect(f.owner.finishRecording(handle,7100)).rejects.toMatchObject({previewRetained:false,recordingRetained:false});expect(f.backend.draw).toHaveBeenCalledTimes(draws);expect(f.seeds).toHaveBeenCalledTimes(seeds);expect(f.owner.hasRecording(handle)).toBe(false);await f.owner.release();
 });
 it('waits for the in-flight recording draw before stop and never aborts on ordinary finish',async()=>{
  const f=fixture(),s=scene();await f.owner.generate(s,context);await f.owner.beginRecording(s,context,options,handle);const pending=deferred<SourceSamilaDisplayResult>();f.backend.draw.mockImplementationOnce(()=>pending.promise);const draw=f.owner.nextRecordingFrame(handle,1);await vi.waitFor(()=>expect(f.backend.draw).toHaveBeenCalledTimes(3));await expect(f.owner.finishRecording(handle)).rejects.toBeInstanceOf(SourceRecordingOperationError);expect(f.backend.cancel).not.toHaveBeenCalled();pending.resolve(result(f.backend.draw.mock.calls[2][0]));await draw;await f.owner.finishRecording(handle);expect(f.backend.cancel).not.toHaveBeenCalled();await f.owner.release();
 });
 it('removes only editor UI before copying the full author and applied owner',()=>{const s=scene();s.samilaPaletteEditor={callback:()=>{}} as never;const owned=sourceSamilaOwnerScene(s);expect(()=>structuredClone(owned)).not.toThrow();expect(owned.samilaPaletteSession).toBe(s.samilaPaletteSession);expect(owned.samilaPaletteEditor).toBeUndefined();});
});
