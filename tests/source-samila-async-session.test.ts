import {describe,expect,it,vi} from 'vitest';
import {SourceSamilaAsyncSession,type SourceSamilaAsyncBackend} from '../src/engine/sourceSamilaAsyncSession';
import {SourceSamilaSession,type SourceSamilaPreparedDisplay,type SourceSamilaDisplayResult} from '../src/engine/sourceSamilaSession';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {initializeSamilaCamera} from '../src/engine/samilaCamera';
import type {GenerateContext} from '../src/types';
function scene(){const s=createScene(definition('samila'));s.settings=initializeSamilaCamera({...s.settings,samilaMathModel:'mathart-1.7.8',samilaProjectionModel:'source-ndc-v1',samilaSplatModel:'samila-splat-1.7.8',samilaSamplingModel:'samila-pcg-1.7.8',samilaPresentationModel:'samila-present-1.7.8',densityToneModel:'samila-normalized-v2',iteratedBackend:'gpu',batchSize:13,samilaSpotSize:.04,normalizedGamma:1,normalizedDynamicRange:1});s.palette={name:'white',mode:'linear',stops:['#ffffff','#ffffff'],cycles:1,offset:0};s.equations={f1:'.1+a',f2:'.2'};s.parameters={a:0};s.timeline={...s.timeline,schedule:'samila-scene-sequence-v1',tracks:[]};return s;}
const c:GenerateContext={width:17,height:13,time:0,quality:'preview',samilaPrimaryPixelHeight:1080,samilaLive:{sessionId:'live',pixelDensity:1}};
function result(display:SourceSamilaPreparedDisplay):SourceSamilaDisplayResult {const samples=display.job.history!.samples;return{facts:{bounds:{minX:-1,maxX:1,minY:-1,maxY:1},steps:samples,accepted:samples,invalid:0,sampleInvalid:0,clipped:0},shown:{pixels:new Uint8ClampedArray(display.options.width*display.options.height*4),occupiedPixels:1,maxCount:1,toneBackend:'native',warnings:[]},sourcePixelRenderer:{backend:'native',identity:'test-backend',generation:1,sequence:1,samples:0}};}
function backend(){return{admitDisplay:vi.fn<SourceSamilaAsyncBackend['admitDisplay']>(()=>{}),draw:vi.fn<SourceSamilaAsyncBackend['draw']>(async display=>result(display)),reset:vi.fn<SourceSamilaAsyncBackend['reset']>(async()=>{}),cancel:vi.fn(),diagnostics:()=>({owner:'test-backend'})};}
function deferred<T>() {let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}

describe('Samila asynchronous semantic transaction owner (mock backend, no pixel-parity claim)',()=>{
 it('uses one-use tokens and acknowledges completion only after the display is committed',()=>{
  const seeds=vi.fn(()=>3),owner=new SourceSamilaSession({samilaSeedProvider:seeds,admitDisplay:()=>{}}),s=scene();
  const operation=owner.begin(s,c);expect(seeds).not.toHaveBeenCalled();expect(()=>owner.completePrimary(operation)).toThrow('尚未完成');
  const display=owner.prepareDisplay(operation);expect(seeds).toHaveBeenCalledOnce();expect(owner.diagnostics().displayIndex).toBe(0);expect(()=>owner.prepareDisplay(operation)).toThrow('未确认');
  owner.commitDisplay(display,result(display));expect(owner.diagnostics().displayIndex).toBe(1);expect(owner.matchesCompletedPrimary(s,c)).toBe(false);expect(()=>owner.commitDisplay(display,result(display))).toThrow('失效');
  owner.completePrimary(operation);expect(owner.matchesCompletedPrimary(s,c)).toBe(true);
  const oldOperation=owner.begin(s,c),old=owner.prepareDisplay(oldOperation);owner.reset();const nextOperation=owner.begin(s,c);owner.abort(oldOperation);expect(()=>owner.commitDisplay(old,result(old))).toThrow('失效');
  const next=owner.prepareDisplay(nextOperation);owner.commitDisplay(next,result(next));expect(owner.completePrimary(nextOperation).samilaLive?.displayIndex).toBe(0);owner.reset();
 });
 it('revokes an in-flight draw before cleanup and rejects its late result without resubmitting',async()=>{
  const b=backend(),pending=deferred<SourceSamilaDisplayResult>(),seeds=vi.fn(()=>4),owner=new SourceSamilaAsyncSession(b,{samilaSeedProvider:seeds}),s=scene();b.draw.mockImplementationOnce(()=>pending.promise);
  const draw=owner.generate(s,c),failure=expect(draw).rejects.toThrow('失效');await vi.waitFor(()=>expect(b.draw).toHaveBeenCalledOnce());
  expect(owner.diagnostics().displayIndex).toBe(0);expect(owner.matchesCompletedPrimary(s,c)).toBe(false);await expect(owner.generate(s,c)).rejects.toThrow('正在执行');expect(seeds).toHaveBeenCalledOnce();
  const reset=owner.reset();expect(b.cancel).toHaveBeenCalledOnce();expect(b.reset).toHaveBeenCalledOnce();pending.resolve(result(b.draw.mock.calls[0][0]));await failure;await reset;
  expect(b.draw).toHaveBeenCalledOnce();expect(b.reset).toHaveBeenCalledTimes(2);expect(owner.diagnostics()).toMatchObject({displayIndex:0,retainedBytes:0,failed:false});
  expect((await owner.generate(s,c)).samilaLive?.displayIndex).toBe(0);await owner.release();
 });
 it('fails closed on unknown draw success and retains ownership after a failed cleanup retry',async()=>{
  const b=backend(),seeds=vi.fn(()=>5),owner=new SourceSamilaAsyncSession(b,{samilaSeedProvider:seeds}),s=scene();b.draw.mockRejectedValueOnce(Error('transport lost after submit'));
  await expect(owner.generate(s,c)).rejects.toThrow('transport lost');expect(owner.diagnostics()).toMatchObject({displayIndex:0,failed:true,cleanupPending:true,backend:{owner:'test-backend'}});
  await expect(owner.generate(s,c)).rejects.toThrow('显式重置');expect(b.draw).toHaveBeenCalledOnce();expect(seeds).toHaveBeenCalledOnce();expect(b.reset).toHaveBeenCalledOnce();
  b.reset.mockRejectedValueOnce(Error('release uncertain'));await expect(owner.reset()).rejects.toThrow('release uncertain');expect(owner.diagnostics().retainedBytes).toBeGreaterThan(0);await expect(owner.generate(s,c)).rejects.toThrow('显式重置');
  await owner.reset();expect(owner.diagnostics().retainedBytes).toBe(0);expect((await owner.generate(s,c)).samilaLive?.displayIndex).toBe(0);await owner.release();
 });
 it('keeps pause seed-free and captures two ordered displays without another clock update',async()=>{
  const b=backend(),now=vi.fn(()=>1000),seeds=vi.fn(()=>6),owner=new SourceSamilaAsyncSession(b,{samilaSeedProvider:seeds,hostClock:{now,source:'page-wall-clock'}}),s=scene(),live={...c,samilaLive:{...c.samilaLive!,clock:{paused:false}}};
  const first=await owner.generate(s,live);expect(first).toMatchObject({backend:'native',sourceSamilaPresentation:{backend:'native'},sourcePixelRenderer:{backend:'native',identity:'test-backend'}});expect(first.samilaLive?.runtime).toMatchObject({updates:1,clockSource:'page-wall-clock'});
  owner.setPaused(true);expect(now).toHaveBeenCalledOnce();expect(seeds).toHaveBeenCalledOnce();expect(b.draw).toHaveBeenCalledOnce();
  const paused={...live,width:23,height:19,samilaLive:{...live.samilaLive,clock:{paused:true}}},pending=deferred<SourceSamilaDisplayResult>();b.draw.mockImplementationOnce(()=>pending.promise);
  const capture=owner.capturePaused(s,paused);await vi.waitFor(()=>expect(b.draw).toHaveBeenCalledTimes(2));expect(owner.matchesCompletedPrimary(s,{...paused,width:c.width,height:c.height})).toBe(false);expect(seeds).toHaveBeenCalledTimes(2);
  pending.resolve(result(b.draw.mock.calls[1][0]));const shown=await capture;expect(shown.capture.samilaLive).toMatchObject({target:'offscreen',displayIndex:1,runtime:{updates:1}});expect(shown.preview.samilaLive).toMatchObject({target:'primary',displayIndex:2,runtime:{updates:1}});expect([shown.capture.width,shown.capture.height,shown.preview.width,shown.preview.height]).toEqual([23,19,17,13]);expect(b.draw).toHaveBeenCalledTimes(3);expect(seeds).toHaveBeenCalledTimes(3);expect(now).toHaveBeenCalledOnce();await owner.release();
 });
 it('does not authenticate a capture if restoring the primary display fails',async()=>{
  const b=backend(),seeds=vi.fn(()=>7),owner=new SourceSamilaAsyncSession(b,{samilaSeedProvider:seeds}),s=scene();await owner.generate(s,c);b.draw.mockImplementationOnce(async display=>result(display)).mockRejectedValueOnce(Error('primary restoration failed'));
  await expect(owner.capturePaused(s,c)).rejects.toThrow('primary restoration failed');expect(owner.diagnostics()).toMatchObject({displayIndex:2,failed:true});expect(owner.matchesCompletedPrimary(s,c)).toBe(false);expect(seeds).toHaveBeenCalledTimes(3);await expect(owner.capturePaused(s,c)).rejects.toThrow('显式重置');expect(b.draw).toHaveBeenCalledTimes(3);await owner.release();
 });
 it('uses the selected backend admission before any seed and preserves the last completed primary on rejection',async()=>{
  const b=backend(),seeds=vi.fn(()=>8),owner=new SourceSamilaAsyncSession(b,{samilaSeedProvider:seeds}),s=scene();await owner.generate(s,c);b.admitDisplay.mockImplementation(budget=>{if(budget.additionalBytes>=256*1024*1024)throw Error('native 256 MiB limit');});
  await expect(owner.capturePaused(s,c,{additionalBytes:256*1024*1024})).rejects.toThrow('native 256 MiB limit');expect(owner.matchesCompletedPrimary(s,c)).toBe(true);expect(b.draw).toHaveBeenCalledOnce();expect(seeds).toHaveBeenCalledOnce();
  // No allocation occurs at beginCapture. The custom backend owns admission;
  // a WebGL 768 MiB diagnostic must not be substituted for that contract.
  const semantic=new SourceSamilaSession({samilaSeedProvider:()=>1,admitDisplay:()=>{}}),op=semantic.begin(s,c),display=semantic.prepareDisplay(op);semantic.commitDisplay(display,result(display));semantic.completePrimary(op);const capture=semantic.beginCapture(s,c,{additionalBytes:768*1024*1024});semantic.abort(capture);semantic.reset();await owner.release();
 });
 it('retains a failed release for cleanup retry while permanently closing the wrapper to new draws',async()=>{
  const b=backend(),owner=new SourceSamilaAsyncSession(b,{samilaSeedProvider:()=>9});await owner.generate(scene(),c);b.reset.mockRejectedValueOnce(Error('release failed'));await expect(owner.release()).rejects.toThrow('release failed');expect(owner.diagnostics()).toMatchObject({released:true,cleanupPending:true,failed:true});await expect(owner.generate(scene(),c)).rejects.toThrow('已释放');await owner.release();expect(owner.diagnostics()).toMatchObject({retainedBytes:0,cleanupPending:false,released:true});
 });
});
