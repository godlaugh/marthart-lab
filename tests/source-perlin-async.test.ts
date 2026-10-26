import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {GenerateContext,SceneDocument,SceneOutput} from '../src/types';
import type {SourcePerlinGpuChannel,SourcePerlinGpuFrame} from '../src/engine/sourcePerlinGpu';
import type {SourceNativePixels} from '../src/engine/sourceNativeClient';

type NativeRender=(frame:SourcePerlinGpuFrame,channel:SourcePerlinGpuChannel,options:{retainedBytes:number})=>Promise<SourceNativePixels>;
type Event={kind:'cpu'|'submit'|'ack'|'read'|'dispose'|'reserve'|'release';target:number;bytes?:number};
const graphics=vi.hoisted(()=>({targets:[] as object[],events:[] as Event[]}));
vi.mock('../src/engine/sourcePerlinCpuTarget',()=>{
 class Target {
  readonly width:number;readonly height:number;readonly density:number;readonly samples:number;
  readonly physicalWidth:number;readonly physicalHeight:number;readonly id:number;
  draws=0;disposed=false;workingBytes=0;private pixels:Uint8ClampedArray;
  constructor(o:{width:number;height:number;density:number;samples?:number}){
   this.width=o.width;this.height=o.height;this.density=o.density;this.samples=o.samples??0;this.physicalWidth=o.width*o.density;this.physicalHeight=o.height*o.density;
   this.pixels=new Uint8ClampedArray(this.physicalWidth*this.physicalHeight*4);this.id=graphics.targets.length;graphics.targets.push(this);
  }
  static createSmoothed(o:{width:number;height:number;density:number},samples:number){return new Target({...o,samples});}
  createSibling(o:{width:number;height:number;density:number;samples?:number}){return new Target(o);}
  draw(){graphics.events.push({kind:'cpu',target:this.id});this.draws++;}
  drawGpu(){this.draw();}
  async drawGpuAsync(frame:SourcePerlinGpuFrame,channel:SourcePerlinGpuChannel,render:NativeRender,cancelled?:()=>boolean,retainedSourceBytes=0){
   if(cancelled?.())throw new DOMException('cancelled','AbortError');graphics.events.push({kind:'submit',target:this.id});
   const result=await render(frame,channel,{retainedBytes:retainedSourceBytes+this.workingBytes});
   if(cancelled?.())throw new DOMException('cancelled','AbortError');
   this.pixels=result.pixels.slice();this.draws++;graphics.events.push({kind:'ack',target:this.id});
  }
  readPixels(cancelled?:()=>boolean){if(cancelled?.())throw new DOMException('cancelled','AbortError');graphics.events.push({kind:'read',target:this.id});return this.pixels.slice();}
  withWorkingBytes<T>(_bytes:number,fn:()=>T){return fn();}
  async withWorkingBytesAsync<T>(bytes:number,fn:()=>Promise<T>){this.workingBytes+=bytes;graphics.events.push({kind:'reserve',target:this.id,bytes});try{return await fn();}finally{this.workingBytes-=bytes;graphics.events.push({kind:'release',target:this.id,bytes});}}
  releaseSceneGpuBindings(){}
  diagnostics(){return{width:this.width,height:this.height,density:this.density,samples:this.samples,initialized:this.draws>0,draws:this.draws};}
  dispose(){this.disposed=true;graphics.events.push({kind:'dispose',target:this.id});}
 }
 return{SourcePerlinCpuTarget:Target};
});
import {SourcePerlinSession} from '../src/scenes/sourcePerlin';
import {parseProjectFile} from '../src/engine/legacyImport';

// Only graphics execution is replaced. Real timeline, noise, CPU object model,
// palette, camera and retained session run; no native/WebGL parity is claimed.
type Raster=Extract<SceneOutput,{type:'raster'}>;
type Target={id:number;width:number;height:number;draws:number;disposed:boolean;workingBytes:number};
type Draw={frame:SourcePerlinGpuFrame;channel:SourcePerlinGpuChannel;options:{retainedBytes:number};result:SourceNativePixels};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const owners:SourcePerlinSession[]=[],acknowledgements:ReturnType<typeof deferred<void>>[]=[];
function controlledRenderer(){
 const calls:Draw[]=[],gates:{entered:ReturnType<typeof deferred<Draw>>;ack:ReturnType<typeof deferred<void>>}[]=[];
 const render=vi.fn(async(frame:SourcePerlinGpuFrame,channel:SourcePerlinGpuChannel,options:{retainedBytes:number}):Promise<SourceNativePixels>=>{
  const result={width:frame.width,height:frame.height,pixels:new Uint8ClampedArray(frame.width*frame.height*4),generation:1,sequence:calls.length+1,rendererIdentity:'c'.repeat(64),requestBytes:128},draw={frame,channel,options,result};calls.push(draw);
  const gate=gates.shift();if(gate){gate.entered.resolve(draw);await gate.ack.promise;}return result;
 });
 return{render,calls,hold(){const gate={entered:deferred<Draw>(),ack:deferred<void>()};gates.push(gate);acknowledgements.push(gate.ack);return gate;}};
}
function scene(backend:'cpu'|'gpu'='gpu'):SceneDocument{
 const value=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'PERLIN',name:'Async owner',settings:{render_mode:'CPU',seed:123,particle_count:3,cpu_render_style:'PARTICLES'},timeline:[{type:'wait',duration:.5}]})).scene;
 value.timeline.fps=4;value.perlinSource!.backend=backend;return value;
}
function context(timestampMs=1000,paused=true):GenerateContext{return{time:0,width:8,height:6,quality:'preview',sourcePerlinViewport:{width:8,height:6,pixelDensity:1},sourceViewport:{logicalWidth:8,logicalHeight:6,referenceLogicalHeight:6,target:'primary',projectionPass:'perspective'},perlinLive:{sessionId:'perlin-async',clock:{paused,timestampMs}}};}
function owner(options:ConstructorParameters<typeof SourcePerlinSession>[0]={}){const value=new SourcePerlinSession(options);owners.push(value);return value;}
function raster(value:SceneOutput):Raster{if(value.type!=='raster')throw Error('expected Perlin raster');return value;}
function numerical(value:SourcePerlinSession){const state=value.diagnosticSnapshot()!,model=value.diagnostics().model!;return{time:model.time,updates:model.updates,cpuUpdates:model.cpuUpdates,motion:state.motion,trails:state.trails,parameters:state.parameters,gradient:state.colors.gradient};}
function withoutTiming(value:SceneOutput){const {elapsedMs:_,...stats}=value.stats;return{...value,stats};}
const targets=()=>graphics.targets as Target[];
const submissions=()=>graphics.events.filter(event=>event.kind==='submit');
beforeEach(()=>{graphics.targets.length=0;graphics.events.length=0;vi.stubGlobal('OffscreenCanvas',class{constructor(){throw Error('unexpected real GPU canvas');}});});
afterEach(async()=>{for(const ack of acknowledgements.splice(0))ack.resolve();for(const value of owners.splice(0))await value.resetAsync();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('Perlin asynchronous retained session with CPU graphics stand-ins',()=>{
 it('shares synchronous CPU state and pixels across running, pause, capture and resumed updates',async()=>{
  const s=scene('cpu'),sync=owner(),async=owner(),c=context(1000,false);
  for(const ms of [1000,1250]){
   const input={...c,perlinLive:{...c.perlinLive!,clock:{paused:false,timestampMs:ms}}};
   expect(withoutTiming(await async.generateAsync(s,input))).toEqual(withoutTiming(sync.generate(s,input)));expect(numerical(async)).toEqual(numerical(sync));
  }
  sync.setPaused(true,1500);async.setPaused(true,1500);const paused=context(9000),capture={...paused,width:4,height:4,sourceViewport:{...paused.sourceViewport!,target:'offscreen' as const}};
  expect(withoutTiming(await async.generateAsync(s,paused))).toEqual(withoutTiming(sync.generate(s,paused)));
  const result=await async.capturePausedAsync(s,capture),expected=sync.capturePaused(s,capture);
  expect(withoutTiming(result.capture)).toEqual(withoutTiming(expected.capture));expect(withoutTiming(result.preview)).toEqual(withoutTiming(expected.preview));expect(numerical(async)).toEqual(numerical(sync));
  sync.setPaused(false,10000);async.setPaused(false,10000);
  expect(withoutTiming(await async.generateAsync(s,context(10250,false)))).toEqual(withoutTiming(sync.generate(s,context(10250,false))));
 });

 it('blocks competing operations and grants the completed primary only after native ACK',async()=>{
  const renderer=controlledRenderer(),gate=renderer.hold(),value=owner({gpuRender:renderer.render}),s=scene(),c=context(),pending=value.generateAsync(s,c);
  let published=false;void pending.then(()=>{published=true;},()=>{});const draw=await gate.entered.promise;
  expect(draw.frame).toMatchObject({width:8,height:6,time:0});expect(draw.channel.size).toBe(512);expect(targets()[0].draws).toBe(0);expect(value.matchesCompletedPrimary(s,c)).toBe(false);expect(published).toBe(false);
  expect(()=>value.setPaused(false,1500)).toThrow();expect(()=>value.applyConfiguration(s)).toThrow();expect(()=>value.generate(s,c)).toThrow();expect(()=>value.reset()).toThrow();
  await expect(value.generateAsync(s,c)).rejects.toThrow();await expect(value.capturePausedAsync(s,{...c,sourceViewport:{...c.sourceViewport!,target:'offscreen'}})).rejects.toThrow();
  expect(renderer.calls).toHaveLength(1);gate.ack.resolve();const output=raster(await pending);
  expect(output.perlinLive).toMatchObject({sessionId:'perlin-async',paused:true,sceneTime:0,constructions:1});expect(targets()[0].draws).toBe(1);expect(value.matchesCompletedPrimary(s,c)).toBe(true);
 });

 it('waits for native ACK during soft reset and suppresses the cancelled publication before releasing targets',async()=>{
  const renderer=controlledRenderer(),gate=renderer.hold(),value=owner({gpuRender:renderer.render}),s=scene(),c=context(),pending=value.generateAsync(s,c),rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});
  await gate.entered.promise;let reset=false,settled=false;const resetting=value.resetAsync().then(()=>{reset=true;}),settling=value.settle().then(()=>{settled=true;});
  await Promise.resolve();expect(reset).toBe(false);expect(settled).toBe(false);expect(targets()[0].disposed).toBe(false);
  gate.ack.resolve();await rejected;await Promise.all([resetting,settling]);expect(targets()[0].disposed).toBe(true);expect(value.matchesCompletedPrimary(s,c)).toBe(false);expect(value.diagnostics().target).toBeUndefined();
  expect(raster(await value.generateAsync(s,c)).perlinLive).toMatchObject({constructions:1,sceneTime:0});
 });

 it('awaits the offscreen capture before redrawing the same primary without a numerical update',async()=>{
  const renderer=controlledRenderer(),value=owner({gpuRender:renderer.render}),s=scene(),c=context();await value.generateAsync(s,c);
  const before=numerical(value),primary=targets()[0],first=renderer.hold(),second=renderer.hold(),pending=value.capturePausedAsync(s,{...c,width:4,height:4,sourceViewport:{...c.sourceViewport!,target:'offscreen'}},{additionalBytes:17});
  await first.entered.promise;expect(submissions().map(event=>event.target)).toEqual([primary.id,1]);expect(primary.draws).toBe(1);expect(primary.workingBytes).toBe(17);expect(value.matchesCompletedPrimary(s,c)).toBe(false);
  first.ack.resolve();await second.entered.promise;expect(submissions().map(event=>event.target)).toEqual([primary.id,1,primary.id]);expect(targets()[1].draws).toBe(1);expect(primary.draws).toBe(1);expect(numerical(value)).toEqual(before);
  second.ack.resolve();const result=await pending;
  expect(result.capture).toMatchObject({width:4,height:4,sourcePerlinFrame:{samples:0},perlinLive:{renderKind:'snapshot',sceneTime:0}});
  expect(result.preview).toMatchObject({width:8,height:6,perlinLive:{renderKind:'snapshot',sceneTime:0}});expect(result.capture.perlinLive!.frame).toEqual(result.preview.perlinLive!.frame);
  expect(numerical(value)).toEqual(before);expect(primary.draws).toBe(2);expect(primary.workingBytes).toBe(0);expect(primary.disposed).toBe(false);expect(targets()).toHaveLength(2);expect(value.matchesCompletedPrimary(s,c)).toBe(true);
 });

 it('hot switches CPU and native GPU on the same numerical model and both retained targets',async()=>{
  const renderer=controlledRenderer(),value=owner({gpuRender:renderer.render}),s=scene('cpu'),c=context();await value.generateAsync(s,c);
  await value.capturePausedAsync(s,{...c,width:4,height:4,sourceViewport:{...c.sourceViewport!,target:'offscreen'}});const originalTargets=[...targets()],before=numerical(value),constructions=value.diagnostics().constructions;
  s.perlinSource!.backend='gpu';const gate=renderer.hold(),pending=value.generateAsync(s,c);await gate.entered.promise;expect(targets()).toEqual(originalTargets);gate.ack.resolve();await pending;
  s.perlinSource!.backend='cpu';await value.generateAsync(s,c);
  expect(numerical(value)).toEqual(before);expect(value.diagnostics().constructions).toBe(constructions);expect(targets()).toEqual(originalTargets);expect(targets().every(target=>!target.disposed)).toBe(true);expect(renderer.calls).toHaveLength(1);
 });

 it('keeps runtime recording cancellation separate from cloneable begin and stop inputs',async()=>{
  let cancelled=false;const value=owner(),s=scene('cpu'),c={...context(),isCancelled:()=>cancelled,onProgress:()=>{},onStatus:()=>{}};
  await value.generateAsync(s,c);const start=await value.beginRecordingAsync(s,c,{width:4,height:4,simulationFps:4});
  expect(()=>structuredClone(start)).not.toThrow();for(const name of ['isCancelled','onProgress','onStatus'])expect(start.context).not.toHaveProperty(name);
  cancelled=true;await expect(value.nextRecordingFrameAsync(start.handle,1)).rejects.toMatchObject({name:'AbortError'});expect(value.ownsRecording(start.handle)).toBe(true);
  cancelled=false;await value.nextRecordingFrameAsync(start.handle,1);const stop=await value.finishRecordingAsync(start.handle);
  expect(()=>structuredClone(stop)).not.toThrow();for(const name of ['isCancelled','onProgress','onStatus'])expect(stop.context).not.toHaveProperty(name);
 });

 it('awaits recording warmup and stop while retaining both targets and publishes retries without another display',async()=>{
  let now=1000;const renderer=controlledRenderer(),value=owner({gpuRender:renderer.render,now:()=>now}),s=scene(),c=context();await value.generateAsync(s,c);
  const primary=targets()[0],warmupGate=renderer.hold(),starting=value.beginRecordingAsync(s,c,{width:4,height:4,simulationFps:4});let started=false;void starting.then(()=>{started=true;},()=>{});
  await warmupGate.entered.promise;expect(started).toBe(false);expect(primary.disposed).toBe(false);expect(primary.draws).toBe(1);warmupGate.ack.resolve();const start=await starting;
  expect(()=>structuredClone(start)).not.toThrow();expect(start.context).not.toHaveProperty('isCancelled');
  expect(start.warmup.perlinLive).toMatchObject({clockSource:'fixed-step',frame:{frameIndex:0,sceneTime:.25}});expect(value.ownsRecording(start.handle)).toBe(true);expect(targets()).toHaveLength(2);
  const frame=await value.nextRecordingFrameAsync(start.handle,1),before=numerical(value),constructions=value.diagnostics().constructions,originalTargets=[...targets()];
  expect(frame.perlinLive).toMatchObject({clockSource:'fixed-step',frame:{frameIndex:1,sceneTime:.5,queueComplete:true}});
  now=5000;const stopGate=renderer.hold(),stopping=value.finishRecordingAsync(start.handle);await stopGate.entered.promise;expect(numerical(value)).toEqual(before);expect(targets()).toEqual(originalTargets);stopGate.ack.resolve();const stop=await stopping;
  if(!('preview' in stop)||!stop.preview)throw Error('live recording stop must restore preview');
  expect(()=>structuredClone(stop)).not.toThrow();expect(stop.context).not.toHaveProperty('isCancelled');
  expect(stop.preview.perlinLive).toMatchObject({renderKind:'snapshot',sceneTime:.5,frame:{frameIndex:1}});expect(value.matchesCompletedPrimary(stop.scene,stop.context)).toBe(true);expect(value.diagnostics().constructions).toBe(constructions);expect(numerical(value)).toEqual(before);
  const count=renderer.calls.length,draws=primary.draws;structuredClone(stop.preview.pixels,{transfer:[stop.preview.pixels.buffer]});now=9000;const retry=await value.finishRecordingAsync(start.handle);
  if(!('preview' in retry)||!retry.preview)throw Error('live recording retry must restore preview');
  expect(retry.preview.pixels.byteLength).toBe(8*6*4);expect(retry.preview.perlinLive).toEqual(stop.preview.perlinLive);expect(renderer.calls).toHaveLength(count);expect(primary.draws).toBe(draws);expect(numerical(value)).toEqual(before);expect(value.diagnostics().live?.lastTime).toBe(5);
 });
});
