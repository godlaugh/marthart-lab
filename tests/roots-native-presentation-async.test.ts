import {afterEach,describe,expect,it,vi} from 'vitest';
import {RootsNativePresentationSession} from '../src/engine/rootsNativePresentationSession';
import type {RootsPointCloudAsyncBackend,RootsPointCloudAsyncDisplay,RootsPointCloudAsyncReceipt,RootsPointCloudTarget} from '../src/engine/rootsPointCloudAsync';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {createRootsNativeMath} from '../src/engine/rootsMathConfig';
import {defaultRootsPendingConfiguration,defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import type {GenerateContext} from '../src/types';

const primary:GenerateContext={time:0,width:17,height:13,quality:'preview',rootsSessionId:'test',rootsPixelDensity:1,rootsViewport:{logicalWidth:17,logicalHeight:13,referenceLogicalHeight:13,target:'primary'}};
const capture=(width=19,height=11):GenerateContext=>({...primary,quality:'export',width,height,rootsViewport:{logicalWidth:width,logicalHeight:height,referenceLogicalHeight:13,target:'offscreen'}});
function scene(){
 const s=createScene(definition('roots'));s.rootsMath=createRootsNativeMath();
 s.rootsMath.polynomial={variable:'x',coefficients:[{exponent:'1',expression:'1'},{exponent:'0',expression:'-t2'}]};
 s.rootsMath.parameters=[{name:'t2',domain:'FIXED',minRe:0,maxRe:1,minIm:0,maxIm:1,value:[.25,.5]}];
 s.rootsMath.sampling={sampleCount:9,batchSize:2,workerCount:1,seed:'0',filter:''};
 s.rootsPresentation={...defaultRootsPresentationConfiguration(),mode:'point-cloud'};
 Object.assign(s.settings,{rootsMode:'progressive',rootDensityColorVersion:'mathart-1.7.8-metric-v1',rootSamplesPerFrame:3,rootSamplingFps:4,rootStartTime:0,rootColor:'t2_real'});
 s.timeline={...s.timeline,schedule:'roots-scene-sequence-v1',fps:4,duration:2,tracks:[]};return s;
}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};}
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
class Backend implements RootsPointCloudAsyncBackend {
 events:string[]=[];inputs:RootsPointCloudAsyncDisplay[]=[];receipts:RootsPointCloudAsyncReceipt[]=[];
 owned=new Map<RootsPointCloudTarget,{width:number;height:number;index:number}>();
 initializeGate?:ReturnType<typeof deferred>;displayGate?:ReturnType<typeof deferred>;releaseGate?:ReturnType<typeof deferred>;
 failure?:Error;releaseFailures=0;malformed=false;sequence=0;
 async initialize(target:RootsPointCloudTarget,size:{width:number;height:number},programs:Parameters<RootsPointCloudAsyncBackend['initialize']>[2]){
  this.events.push(`initialize:${target}`);expect(programs.point.vertex.startsWith('#version 410 core\n')).toBe(true);
  this.owned.set(target,{...size,index:0});await this.initializeGate?.promise;return{pointSizeRange:[1,64] as const};
 }
 async display(target:RootsPointCloudTarget,input:RootsPointCloudAsyncDisplay){
  this.events.push(`display:${target}`);this.inputs.push(input);await this.displayGate?.promise;
  if(this.failure)throw this.failure;
  let count=0;for(const chunk of input.chunks){expect(chunk.points.byteLength).toBe(chunk.points.buffer.byteLength);expect(chunk.points.byteOffset).toBe(0);expect(chunk.points.byteLength).toBeLessThanOrEqual(65_536*16);count+=chunk.pointCount;input.chunks.assertCurrent();}
  expect(count).toBe(input.chunks.pointCount);
  const state=this.owned.get(target)!;state.index++;
  const pixels=new Uint8ClampedArray(state.width*state.height*4);pixels[0]=state.index;pixels[3]=81;
  const receipt={...state,pixels,displayIndex:state.index,width:state.width,height:state.height,rendererIdentity:'a'.repeat(64),generation:1,sequence:++this.sequence,requestBytes:200};
  if(this.malformed)receipt.width++;
  this.receipts.push(receipt);this.events.push(`ack:${target}`);return receipt;
 }
 async release(target?:RootsPointCloudTarget){this.events.push(`release:${target??'all'}`);await this.releaseGate?.promise;if(this.releaseFailures-->0)throw Error('release unavailable');if(target)this.owned.delete(target);else this.owned.clear();}
 async settle(){}
}
class IdleWorker {static instances:IdleWorker[]=[];onmessage=null;onerror=null;onmessageerror=null;terminated=false;constructor(){IdleWorker.instances.push(this);}postMessage(){}terminate(){this.terminated=true;}}
afterEach(()=>vi.unstubAllGlobals());

describe('Roots session async point-cloud effects (CPU backend receipts, no GL)',()=>{
 it('snapshots input before awaiting, commits only after ACK, and reads cached pixels without an extra display',async()=>{
  const backend=new Backend(),owner=new RootsNativePresentationSession({pointCloudBackend:backend}),s=scene();backend.initializeGate=deferred();
  const original=structuredClone(s),pending=owner.generateAsync(s,primary);s.rootsPresentation!.camera.zoom=9;await flush();
  expect(owner.diagnostics()).toMatchObject({displayFrames:0,completedPrimary:false,inFlight:true});expect(backend.events).toEqual(['initialize:primary']);
  expect(()=>owner.generate(s,primary)).toThrow('active');await expect(owner.generateAsync(s,primary)).rejects.toThrow('active');
  backend.initializeGate.resolve();const out=await pending;
  expect(out).toMatchObject({backend:'native',sourcePixelRenderer:{backend:'native',identity:'a'.repeat(64),generation:1,samples:0}});
  expect(out.pixels.buffer).not.toBe(backend.receipts[0].pixels.buffer);expect(out.rootsPresentation?.pointCloud?.totalWrites).toBe('3');
  expect(owner.matchesCompletedPrimary(original,primary)).toBe(true);
  structuredClone(out,{transfer:[out.pixels.buffer]});const before=backend.events.length,repeated=await owner.generateAsync(original,primary);
  expect(backend.events).toHaveLength(before);expect(repeated.pixels[3]).toBe(81);expect(owner.diagnostics().displayFrames).toBe(1);
  await owner.resetAsync();expect(backend.owned.size).toBe(0);expect(owner.diagnostics().retainedBytes).toBe(0);
 });
 it('does not expose a completed capability while display ACK is pending',async()=>{
  const b=new Backend(),o=new RootsNativePresentationSession({pointCloudBackend:b}),s=scene();await o.generateAsync(s,primary);b.displayGate=deferred();
  const pending=o.generateAsync(s,{...primary,time:.25});await flush();expect(o.matchesCompletedPrimary(s,primary)).toBe(false);expect(o.diagnostics().displayFrames).toBe(1);
  b.displayGate.resolve();const out=await pending;expect(out.rootsPresentation?.cameraTimeline?.framesAdvanced).toBe(1);expect(o.diagnostics().displayFrames).toBe(2);await o.resetAsync();
 });
 it('waits the submitted ACK before cancellation cleanup and never publishes cancelled pixels',async()=>{
  const b=new Backend(),o=new RootsNativePresentationSession({pointCloudBackend:b});b.displayGate=deferred();let cancelled=false;
  const pending=o.generateAsync(scene(),{...primary,isCancelled:()=>cancelled});const outcome=pending.catch(e=>e);await flush();cancelled=true;
  expect(b.events).toEqual(['initialize:primary','display:primary']);expect(b.owned.size).toBe(1);
  b.displayGate.resolve();expect(await outcome).toMatchObject({name:'AbortError'});expect(b.events.at(-1)).toBe('release:primary');expect(b.owned.size).toBe(0);expect(o.diagnostics().completedPrimary).toBe(false);
 });
 it('external reset cancels an outstanding operation, waits its ACK, and releases its exact target',async()=>{
  const b=new Backend(),o=new RootsNativePresentationSession({pointCloudBackend:b});b.initializeGate=deferred();
  const pending=o.generateAsync(scene(),primary),outcome=pending.catch(e=>e);await flush();const reset=o.resetAsync();await flush();expect(b.events).toEqual(['initialize:primary']);
  b.initializeGate.resolve();expect(await outcome).toMatchObject({name:'AbortError'});await reset;expect(b.events).toEqual(['initialize:primary','release:primary']);expect(o.diagnostics().retainedBytes).toBe(0);
 });
 it('keeps failed release custody, preserves both errors and retries before reconstructing',async()=>{
  const b=new Backend(),o=new RootsNativePresentationSession({pointCloudBackend:b});b.failure=Error('display failed');b.releaseFailures=1;
  const failure=await o.generateAsync(scene(),primary).catch(e=>e);
  expect(failure).toMatchObject({failureKind:'cleanup'});expect(failure.cause.errors.map((e:Error)=>e.message)).toEqual(['display failed','release unavailable']);
  expect(o.diagnostics()).toMatchObject({cleanupPending:true,completedPrimary:false});expect(b.owned.size).toBe(1);
  b.failure=undefined;const out=await o.generateAsync(scene(),primary);expect(out.backend).toBe('native');
  expect(b.events.slice(0,5)).toEqual(['initialize:primary','display:primary','release:primary','release:primary','initialize:primary']);await o.resetAsync();
 });
 it('rejects stale/capacity capture before mutation, owns two target histories and preserves alpha/transfer safety',async()=>{
  const b=new Backend(),o=new RootsNativePresentationSession({pointCloudBackend:b}),s=scene();await o.generateAsync(s,primary);const events=b.events.length;
  await expect(o.capturePausedAsync(s,capture(),{additionalBytes:768*1024*1024})).rejects.toThrow('768 MiB');
  await expect(o.capturePausedAsync(s,{...capture(),time:.5})).rejects.toThrow('预览');expect(b.events).toHaveLength(events);expect(o.matchesCompletedPrimary(s,primary)).toBe(true);
  const pair=await o.capturePausedAsync(s,capture());expect(b.events.filter(e=>e.startsWith('display'))).toEqual(['display:primary','display:offscreen','display:primary']);
  expect(pair.capture).toMatchObject({width:19,height:11,backend:'native',sourcePixelRenderer:{sequence:2}});expect(pair.preview.sourcePixelRenderer).toMatchObject({backend:'native',sequence:3});
  expect(pair.capture.pixels[3]).toBe(81);expect(pair.preview.pixels[3]).toBe(81);expect(pair.capture.pixels.buffer).not.toBe(pair.preview.pixels.buffer);
  expect(pair.capture.rootsPresentation?.pointCloud?.totalWrites).toBe('3');expect(b.owned.size).toBe(2);
  structuredClone(pair.capture,{transfer:[pair.capture.pixels.buffer]});structuredClone(pair.preview,{transfer:[pair.preview.pixels.buffer]});
  const repeat=await o.generateAsync(s,primary);expect(repeat.pixels[0]).toBe(2);expect(b.events.filter(e=>e.startsWith('display'))).toHaveLength(3);
  const resized=await o.capturePausedAsync(s,capture(21,9));expect(resized.capture.pixels[0]).toBe(1);expect(resized.preview.pixels[0]).toBe(3);
  expect(b.events.filter(e=>e.startsWith('release'))).toEqual(['release:offscreen']);await o.resetAsync();expect(b.owned.size).toBe(0);
 });
 it('revokes malformed ACK pixels and releases the owned target',async()=>{
  const b=new Backend(),o=new RootsNativePresentationSession({pointCloudBackend:b});b.malformed=true;
  await expect(o.generateAsync(scene(),primary)).rejects.toThrow('receipt');expect(b.owned.size).toBe(0);expect(o.diagnostics().completedPrimary).toBe(false);
 });
 it('refuses synchronous entry before mutation when async resources are configured',()=>{
  const b=new Backend(),o=new RootsNativePresentationSession({pointCloudBackend:b});expect(()=>o.generate(scene(),primary)).toThrow('async');expect(b.events).toEqual([]);expect(o.diagnostics().retainedBytes).toBe(0);
 });
 it('records warmup/continuous frames after ACK and finishes with a primary snapshot of the same live state',async()=>{
  IdleWorker.instances=[];vi.stubGlobal('Worker',IdleWorker);
  const b=new Backend(),o=new RootsNativePresentationSession({pointCloudBackend:b}),s=scene();s.rootsPresentation!.pending=defaultRootsPendingConfiguration();
  s.timeline.tracks=[{id:'wait',label:'wait',type:'animate',target:'timeline.animate',enabled:true,start:0,duration:1,from:0,to:0,pingPong:false,easing:'linear',actions:[]}];
  const c:GenerateContext={...primary,rootsLive:{sessionId:'live',maximumWorkers:1,clock:{paused:true,timestampMs:1000}}};
  await o.generateAsync(s,c);const record=await o.beginRecordingAsync(s,c,{width:17,height:13,simulationFps:4});
  expect(record.warmup.rootsLive).toMatchObject({paused:false,recording:{displayFrame:0,warmup:true,simulationFps:4}});expect(IdleWorker.instances).toHaveLength(2);expect(IdleWorker.instances[0].terminated).toBe(true);
  b.displayGate=deferred();const pending=o.nextRecordingFrameAsync(record.handle,1);await flush();await expect(o.nextRecordingFrameAsync(record.handle,2)).rejects.toThrow('active');b.displayGate.resolve();const frame=await pending;
  expect(frame.rootsLive?.recording?.displayFrame).toBe(1);const sceneTime=frame.rootsLive!.sceneTime,instance=frame.rootsPresentation!.instance;
  const stop=await o.finishRecordingAsync(record.handle,2000);expect(stop.preview.rootsLive).toMatchObject({renderKind:'snapshot',sceneTime,paused:false});expect(stop.preview.rootsPresentation?.instance).toBe(instance);expect(IdleWorker.instances).toHaveLength(2);
  expect(b.events.filter(e=>e.startsWith('display'))).toEqual(['display:primary','display:offscreen','display:offscreen','display:primary']);
  const resumed=await o.generateAsync(s,{...stop.context,rootsLive:{...stop.context.rootsLive!,clock:{paused:false,timestampMs:2250}}});expect(resumed.rootsLive!.sceneTime).toBeGreaterThan(sceneTime);await o.resetAsync();expect(IdleWorker.instances.every(w=>w.terminated)).toBe(true);
 });
});
