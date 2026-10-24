import {presentRootsNativeMetricInk,prepareRootsInkView} from '../src/engine/rootsNativeInk';
import type {RootsMetricColorPlan} from '../src/engine/rootsDensityColor';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import type {GenerateContext} from '../src/types';
const observation=vi.hoisted(()=>({palettes:[] as number[][],points:[] as number[][],readbacks:0,clears:0,disposeFailures:0,cloudDraws:0,cloudClear:0,cloudFade:0,cloudReadbacks:0}));
// Real math/stream/projection/color/session; only the device accumulation is a
// deterministic test double. Actual shader/worker verification is separate.
vi.mock('../src/engine/rootsNativeDensityGpu',async importOriginal=>{
 const original=await importOriginal<typeof import('../src/engine/rootsNativeDensityGpu')>();
 class Gpu {
  width=0;height=0;count=0;ink=new Float32Array();
  initialize(w:number,h:number){this.width=w;this.height=h;if(!this.ink.length)this.ink=new Float32Array(w*h*4);}
  add(p:readonly number[],metric:number){observation.points.push([...p,metric]);this.count++;this.ink[0]++;this.ink[1]+=metric;}
  flush(){}clear(){observation.clears++;this.count=0;this.ink.fill(0);}
  presentPixels(color:RootsMetricColorPlan,rotation:number){observation.palettes.push(Array.from(color.lut.slice(0,4)));return presentRootsNativeMetricInk(this.ink,prepareRootsInkView(this.width,this.height,rotation),color,this.count).pixels;}
  readback(){observation.readbacks++;return this.ink.slice();}
  diagnostics(){return{width:this.width,height:this.height,submittedPoints:this.count,retainedBytes:this.ink.byteLength,lastKernel:'points' as const,probe:{selected:'points' as const},handles:this.ink.length?1:0};}
  reset(){if(observation.disposeFailures-->0)throw new Error('controlled cleanup');this.ink=new Float32Array();this.count=0;}
  dispose(){this.reset();}
 }
 return{...original,RootsNativeDensityGpu:Gpu};
});
vi.mock('../src/engine/rootsNativePointCloudGpu',async importOriginal=>{
 const original=await importOriginal<typeof import('../src/engine/rootsNativePointCloudGpu')>();
 class Gpu {w=0;h=0;initialize(w:number,h:number){this.w=w;this.h=h;}clear(){observation.cloudClear++;}fade(){observation.cloudFade++;}draw(){observation.cloudDraws++;}readback(){observation.cloudReadbacks++;return new Uint8ClampedArray(this.w*this.h*4);}diagnostics(){return{retainedBytes:0};}dispose(){}}
 return{...original,RootsNativePointCloudGpu:Gpu};
});
import {RootsNativePresentationSession} from '../src/engine/rootsNativePresentationSession';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {withRootsPresentation} from '../src/engine/rootsPresentationAuthoring';
import {defaultRootsPresentationConfiguration,defaultRootsPendingConfiguration} from '../src/engine/rootsPresentationConfig';
import {withRootsSceneTimeline} from '../src/engine/rootsCameraTimeline';
import {validRootsLiveOutput} from '../src/engine/rootsLive';
import type {RootsControlCommand} from '../src/engine/rootsControl';
class IdleWorker {static instances:IdleWorker[]=[];onmessage=null;onerror=null;onmessageerror=null;terminated=false;constructor(){IdleWorker.instances.push(this);}postMessage(){}terminate(){this.terminated=true;}}
function scene(){const s=withRootsSceneTimeline(withRootsPresentation(createScene(definition('roots')),{...defaultRootsPresentationConfiguration(),pending:defaultRootsPendingConfiguration(),previewMode:'live-worker-arrival-v1'}),true);s.rootsMath!.sampling.workerCount=1;s.rootsMath!.sampling.sampleCount=4;s.rootsMath!.sampling.batchSize=2;s.timeline.tracks=[];s.rootsSourcePalette={colors:['#ff0000']};return s;}
function context(acknowledgedRevision:number,commands:RootsControlCommand[]=[]):GenerateContext{return{time:0,width:17,height:13,quality:'preview',rootsPixelDensity:1,rootsLive:{sessionId:'controlled',maximumWorkers:1,clock:{paused:true,timestampMs:100},controls:{acknowledgedRevision,commands}}};}
beforeEach(()=>{IdleWorker.instances=[];vi.stubGlobal('Worker',IdleWorker);observation.disposeFailures=0;observation.clears=0;observation.palettes=[];});
describe('Roots controlled live presentation lifecycle (idle worker / GPU test doubles)',()=>{
 it('isolates staged author fields, applies narrow hot commands, and records cold without changing author',()=>{
  const s=scene(),session=new RootsNativePresentationSession(),first=context(0,[{kind:'apply',revision:1,scene:s}]);
  const a=session.generate(s,first),instance=a.rootsPresentation!.instance;
  s.rootsPresentation!.mode='point-cloud';s.rootsPresentation!.camera.zoom=5;s.timeline.tracks=[{id:'staged',target:'camera.rotationX',keyframes:[]} as never];s.rootsSourcePalette={colors:['#00ff00']};
  const hot=context(1,[{kind:'palette',revision:2,palette:s.rootsSourcePalette}]),b=session.generate(s,hot);
  expect(b.rootsPresentation!.instance).toBe(instance);expect(b.rootsLive!.presentation!.mode).toBe('density');expect(b.rootsLive!.presentation!.camera.zoom).toBe(a.rootsLive!.presentation!.camera.zoom);expect(b.rootsLive!.autoRecording.hasAnimations).toBe(false);expect(IdleWorker.instances).toHaveLength(1);expect(observation.palettes.at(-1)).toEqual([0,255,0,255]);
  const captured=session.capturePaused(s,{...hot,rootsViewport:{logicalWidth:17,logicalHeight:13,referenceLogicalHeight:13,target:'offscreen'}});expect(captured.capture.rootsLive!.controls).toEqual({revision:2,applyRevision:1,resetRevision:1});expect(captured.preview.rootsLive!.presentation!.mode).toBe('density');
  const record=session.beginRecording(s,hot,{simulationFps:30,width:17,height:13});
  expect(record.scene).toEqual(s);expect(record.context.rootsLive!.controls).toEqual({acknowledgedRevision:2,commands:[]});expect(record.warmup.rootsLive!.controls).toEqual({revision:2,applyRevision:1,resetRevision:2});expect(record.warmup.rootsLive!.presentation!.mode).toBe('density');
  expect(observation.palettes.at(-1)).toEqual([255,0,0,255]);expect(IdleWorker.instances).toHaveLength(2);expect(IdleWorker.instances[0].terminated).toBe(true);
  const stop=session.finishRecording(record.handle,1000);expect(observation.palettes.at(-1)).toEqual([255,0,0,255]);expect(stop.scene).toEqual(s);expect(stop.preview.rootsLive!.controls).toEqual(record.warmup.rootsLive!.controls);expect(stop.preview.rootsPresentation!.instance).toBe(record.warmup.rootsPresentation!.instance);
  const after=session.generate(s,{...stop.context,rootsLive:{...stop.context.rootsLive!,controls:{acknowledgedRevision:2,commands:[{kind:'palette',revision:3,palette:s.rootsSourcePalette}]}}});expect(observation.palettes.at(-1)).toEqual([0,255,0,255]);expect(after.rootsLive!.controls).toEqual({revision:3,applyRevision:1,resetRevision:2});session.reset();
 });
 it('retains side effects for transform A→B→A, runtime camera does not restart, and equal Apply does',()=>{
  const s=scene(),session=new RootsNativePresentationSession();const first=session.generate(s,context(0,[{kind:'apply',revision:1,scene:s}])),initial=structuredClone(s.rootsPresentation!.transform);
  session.generate(s,context(1,[{kind:'transform',revision:2,transform:{...initial,offset:[1,0,0]}},{kind:'transform',revision:3,transform:initial}]));expect(observation.clears).toBe(2);expect(IdleWorker.instances).toHaveLength(1);
  const camera=session.generate(s,context(3,[{kind:'camera',revision:4,camera:{phi:.5,theta:.6,gamma:.7,zoom:2}}]));expect(camera.rootsPresentation!.instance).toBe(first.rootsPresentation!.instance);expect(camera.rootsLive!.presentation!.camera.zoom).toBe(2);
  const applied=session.generate(s,context(4,[{kind:'apply',revision:5,scene:s}]));expect(applied.rootsPresentation!.instance).toBe(first.rootsPresentation!.instance+1);expect(applied.rootsLive!.controls).toEqual({revision:5,applyRevision:5,resetRevision:2});session.reset();
 });
 it('invalid math, cancellation and worker-budget rejection precede mutation and preserve completed primary',()=>{
  const s=scene(),session=new RootsNativePresentationSession(),first=context(0,[{kind:'apply',revision:1,scene:s}]);session.generate(s,first);const instance=session.diagnostics().instance;
  const invalid=structuredClone(s);invalid.rootsMath!.polynomial.coefficients[0].expression='???';
  expect(()=>session.generate(s,context(1,[{kind:'apply',revision:2,scene:invalid}]))).toThrow();
  expect(()=>session.generate(s,{...context(1,[{kind:'restart',revision:2}]),isCancelled:()=>true})).toThrow();
  const tooMany=structuredClone(s);tooMany.rootsMath!.sampling.workerCount=4;expect(()=>session.generate(s,context(1,[{kind:'apply',revision:2,scene:tooMany}]))).toThrow();
  expect(session.matchesCompletedPrimary(s,first)).toBe(true);expect(session.diagnostics().instance).toBe(instance);expect(IdleWorker.instances).toHaveLength(1);expect(IdleWorker.instances[0].terminated).toBe(false);session.reset();
 });
 it('rejects reduced worker budget without resetting an existing larger pool',()=>{
  const s=scene();s.rootsMath!.sampling.workerCount=2;const session=new RootsNativePresentationSession(),c=context(0,[{kind:'apply',revision:1,scene:s}]);c.rootsLive!.maximumWorkers=2;session.generate(s,c);
  expect(()=>session.generate(s,context(1))).toThrow('预算');expect(session.matchesCompletedPrimary(s,c)).toBe(true);expect(IdleWorker.instances).toHaveLength(2);expect(IdleWorker.instances.every(w=>!w.terminated)).toBe(true);session.reset();
 });

 it('retires failed full cleanup before considering subsequent control authority',()=>{
  const s=scene(),session=new RootsNativePresentationSession();session.generate(s,context(0,[{kind:'apply',revision:1,scene:s}]));observation.disposeFailures=1;expect(()=>session.reset()).toThrow('cleanup');
  expect(()=>session.generate(s,context(1))).toThrow('Apply');expect(IdleWorker.instances.every(w=>w.terminated)).toBe(true);const fresh=session.generate(s,context(0,[{kind:'apply',revision:1,scene:s}]));expect(fresh.rootsLive!.controls!.revision).toBe(1);session.reset();
 });
 it('does not validate a fresh session against the retired session receipt',()=>{
  const s=scene(),session=new RootsNativePresentationSession();session.generate(s,context(0,[{kind:'apply',revision:1,scene:s}]));const old=session.generate(s,context(1,[{kind:'restart',revision:2}]));const fresh=context(0,[{kind:'apply',revision:1,scene:s}]);fresh.rootsLive!.sessionId='new-session';const output=session.generate(s,fresh);expect(validRootsLiveOutput(output,fresh,old.rootsLive)).toBe(true);session.reset();
 });

});
