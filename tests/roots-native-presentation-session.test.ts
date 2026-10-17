import {beforeEach,describe,it,expect,vi} from 'vitest';
import type {SceneOutput} from '../src/types';
const observation=vi.hoisted(()=>({points:[] as number[][],readbacks:0,clears:0,disposeFailures:0,cloudDraws:0,cloudClear:0,cloudFade:0,cloudReadbacks:0}));
// Real math/stream/projection/color/session; only the device accumulation is a
// deterministic test double. Actual shader/worker verification is separate.
vi.mock('../src/engine/rootsNativeDensityGpu',async importOriginal=>{
 const original=await importOriginal<typeof import('../src/engine/rootsNativeDensityGpu')>();
 class Gpu {
  width=0;height=0;count=0;ink=new Float32Array();
  initialize(w:number,h:number){this.width=w;this.height=h;if(!this.ink.length)this.ink=new Float32Array(w*h*4);}
  add(p:readonly number[],metric:number){observation.points.push([...p,metric]);this.count++;this.ink[0]++;this.ink[1]+=metric;}
  flush(){}clear(){observation.clears++;this.count=0;this.ink.fill(0);}
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
import {RootsNativeDensityDisplay} from '../src/engine/rootsNativeDisplay';
import {prepareRootsNativeArrival} from '../src/engine/rootsSampling';
import {createScene,parseScene} from '../src/engine/document';
import {definitions} from '../src/scenes/complex';
import {createRootsNativeMath} from '../src/engine/rootsMathConfig';
import {defaultRootsPresentationConfiguration,defaultRootsPendingConfiguration} from '../src/engine/rootsPresentationConfig';
import {withRootsSceneTimeline} from '../src/engine/rootsCameraTimeline';
import {prepareRootsProjection} from '../src/engine/rootsProjection';
import {prepareRootsDensityColor} from '../src/engine/rootsDensityColor';
import {generateScene,TemporalGenerationSession} from '../src/engine/temporal';
const ctx={time:0,width:17,height:13,quality:'export' as const};
function scene(){
 const s=createScene(definitions.find(d=>d.kind==='roots')!);s.rootsMath=createRootsNativeMath();
 s.rootsMath.polynomial={variable:'x',coefficients:[{exponent:'1',expression:'1'},{exponent:'0',expression:'-t2'}]};
 s.rootsMath.parameters=[{name:'t2',domain:'FIXED',minRe:0,maxRe:1,minIm:0,maxIm:1,value:[.25,.5]}];
 s.rootsMath.sampling={sampleCount:9,batchSize:2,workerCount:2,seed:'0',filter:''};
 s.rootsPresentation=defaultRootsPresentationConfiguration();s.rootsPresentation.camera.phi=0;
 Object.assign(s.settings,{rootsMode:'progressive',rootDensityColorVersion:'mathart-1.7.8-metric-v1',rootSamplesPerFrame:3,rootSamplingFps:10,rootStartTime:0,rootColor:'t2_real'});
 return s;
}
function raster(output:SceneOutput){if(output.type!=='raster')throw Error('Expected raster');return output;}
beforeEach(()=>{observation.points=[];observation.readbacks=observation.clears=observation.cloudDraws=observation.cloudClear=observation.cloudFade=observation.cloudReadbacks=0;observation.disposeFailures=0;});
describe('native Roots stream and presentation ownership',()=>{
 it('produces raw source float XYZ/metric without legacy geometry or float-overflow filtering',()=>{
  const arrival=prepareRootsNativeArrival('t2_imag');
  expect(arrival([1,2],{t2:[.2,.3]})).toEqual({kind:'point',values:[1,2,Math.fround(.3),Math.fround(.3)]});
  expect(arrival([1e300,2],{t2:[0,1e300]})).toEqual({kind:'point',values:[Infinity,2,Infinity,Infinity]});
  expect(arrival([Infinity,2],{})).toEqual({kind:'invalid',reason:'nonfinite-root'});
 });
 it('uses the shared native solver/RNG and ignores all dormant legacy projection controls',()=>{
  const s=scene();Object.assign(s.settings,{rootRender:'wrong',filter:'wrong',rootScale:'bad',rotation:'bad',depthScale:'bad'});
  const owner=new RootsNativePresentationSession(),o=raster(owner.generate(s,ctx));
  expect(observation.points).toEqual(Array(3).fill([60,120,0,.25]));
  expect(o.rootsPresentation).toMatchObject({instance:1,restartReason:'initial',newSamples:3,newRawPoints:3,totalRawPoints:3,density:{submittedFinitePointCount:3}});
  expect(o.roots).toMatchObject({attemptedSamples:3,rootPoints:3,math:{logicalWorkers:2}});owner.reset();
 });
 it('retains sampler and ink for repeat/tone/dot/angle edits without new arrivals',()=>{
  const s=scene(),owner=new RootsNativePresentationSession();owner.generate(s,ctx);const jobs=owner.diagnostics().math.preparedJobs;
  s.settings.rootSourceBrightness=.7;s.rootsPresentation!.dotSize=.05;s.rootsPresentation!.camera.theta=.31;
  const o=raster(owner.generate(s,ctx));expect(observation.points).toHaveLength(3);expect(observation.clears).toBe(0);
  expect(owner.diagnostics().math.preparedJobs).toBe(jobs);expect(o.rootsPresentation).toMatchObject({instance:1,restartReason:null,newSamples:0,newRawPoints:0,density:{submittedFinitePointCount:3,capture:false,clearInk:false,displayRotation:Math.fround(.31)}});owner.reset();
 });
 it('clears changed transform without replay and accumulates only subsequent arrivals',()=>{
  const s=scene(),owner=new RootsNativePresentationSession();owner.generate(s,ctx);s.rootsPresentation!.transform.offset=[2,0,0];
  const cleared=raster(owner.generate(s,ctx));expect(cleared.rootsPresentation?.density).toMatchObject({submittedFinitePointCount:0,clearInk:true,capture:false});expect(observation.points).toHaveLength(3);
  const next=raster(owner.generate(s,{...ctx,time:.1}));expect(next.rootsPresentation).toMatchObject({instance:1,newSamples:3,totalRawPoints:6,density:{submittedFinitePointCount:3}});expect(observation.points.slice(3)).toEqual(Array(3).fill([62,120,0,.25]));owner.reset();
 });
 it('keeps the captured matrix on resize while clearing ink/N and not resetting sample ordinal',()=>{
  const s=scene(),owner=new RootsNativePresentationSession();owner.generate(s,ctx);
  const o=raster(owner.generate(s,{...ctx,width:19,height:11,rootsViewport:{logicalWidth:19,logicalHeight:11,referenceLogicalHeight:13,target:'offscreen'}}));
  expect(o.rootsPresentation).toMatchObject({newSamples:0,physicalSize:[19,11],density:{capture:false,clearInk:true,submittedFinitePointCount:0,matrixReferenceViewport:{physicalWidth:17,physicalHeight:13}}});expect(observation.points).toHaveLength(3);owner.reset();
 });
 it('captures a changed camera center without replay; metric edits affect only future arrivals',()=>{
  const s=scene(),owner=new RootsNativePresentationSession();owner.generate(s,ctx);s.settings.rootColor='t2_imag';
  expect(raster(owner.generate(s,ctx)).rootsPresentation?.newRawPoints).toBe(0);
  owner.generate(s,{...ctx,time:.1});expect(observation.points.map(p=>p[3])).toEqual([.25,.25,.25,.5,.5,.5]);
  s.rootsPresentation!.camera.center=[1,0,0];const out=raster(owner.generate(s,{...ctx,time:.1}));
  expect(out.rootsPresentation?.density).toMatchObject({capture:true,clearInk:true,submittedFinitePointCount:0});expect(out.rootsPresentation?.newSamples).toBe(0);owner.reset();
 });
 it.each(['math','mode','timeline','document','backward-seek'] as const)('makes %s an explicit new instance',reason=>{
  const s=scene(),owner=new RootsNativePresentationSession();owner.generate(s,{...ctx,time:.1});let time=.1;
  if(reason==='math')s.rootsMath!.sampling.seed='1';else if(reason==='mode')s.rootsPresentation!.mode='point-cloud';else if(reason==='timeline')s.timeline.duration+=1;else if(reason==='document')s.id+='new';else time=0;
  const o=raster(owner.generate(s,{...ctx,time}));expect(o.rootsPresentation).toMatchObject({instance:2,restartReason:reason,newSamples:time===0?3:6});owner.reset();
 });
 it('uses raw Z and preserves point ring across transform/size/tone edits without resampling',()=>{
  const s=scene();s.rootsPresentation!.mode='point-cloud';const owner=new RootsNativePresentationSession();const first=raster(owner.generate(s,ctx));
  expect(first.rootsPresentation?.pointCloud).toMatchObject({retainedPoints:3,totalWrites:'3'});
  s.rootsPresentation!.transform.offset=[2,3,4];s.rootsPresentation!.accumulation.enabled=true;
  const next=raster(owner.generate(s,{...ctx,width:19,height:11}));expect(next.rootsPresentation).toMatchObject({instance:1,newSamples:0,pointCloud:{retainedPoints:3,totalWrites:'3',accumulationEnabled:true}});
  expect(observation.cloudDraws).toBe(2);expect(observation.cloudFade).toBe(1);owner.reset();expect(owner.diagnostics().ring).toBeUndefined();
 });
 it('replays saved/cold and backward requests explicitly while outputs remain transfer-safe',()=>{
  const s=scene(),owner=new RootsNativePresentationSession();const warm=raster(owner.generate(s,{...ctx,time:.2}));const saved=parseScene(JSON.stringify(s));
  const coldOwner=new RootsNativePresentationSession(),cold=raster(coldOwner.generate(saved,{...ctx,time:.2}));expect(warm.pixels).toEqual(cold.pixels);expect(warm.roots).toEqual(cold.roots);
  structuredClone(warm,{transfer:[warm.pixels.buffer]});expect(raster(owner.generate(s,{...ctx,time:.2})).pixels).toEqual(cold.pixels);owner.reset();coldOwner.reset();
 });
 it('retains runtime ownership across save IDs but distinguishes load and omission',()=>{
  const s=scene(),owner=new RootsNativePresentationSession();owner.generate(s,{...ctx,rootsSessionId:'opened-instance'});
  s.id='saved-id';expect(raster(owner.generate(s,{...ctx,rootsSessionId:'opened-instance'})).rootsPresentation).toMatchObject({instance:1,newSamples:0});
  expect(raster(owner.generate(s,{...ctx,rootsSessionId:s.id})).rootsPresentation).toMatchObject({instance:2,restartReason:'document',newSamples:3});
  expect(raster(owner.generate(s,ctx)).rootsPresentation).toMatchObject({instance:3,restartReason:'document',newSamples:3});
  owner.reset();
 });
 it('routes the public temporal producer and releases native state on leaving the profile',()=>{
  const s=scene(),session=new TemporalGenerationSession();expect(raster(generateScene(s,ctx,session)).rootsPresentation?.instance).toBe(1);
  s.rootsPresentation!.camera.theta=.2;expect(raster(generateScene(s,ctx,session)).rootsPresentation?.newSamples).toBe(0);
  const legacy=structuredClone(s);delete legacy.rootsPresentation;legacy.settings.rootDensityBackend='cpu';generateScene(legacy,ctx,session);
  expect(session.diagnostics().rootsNative.retainedBytes).toBe(0);session.reset();
 });
 it('propagates callback/cancel/capacity errors and releases partial state before retry',()=>{
  const s=scene(),owner=new RootsNativePresentationSession(),failure=new Error('caller callback');
  expect(()=>owner.generate(s,{...ctx,onStatus:()=>{throw failure;}})).toThrow(failure);expect(owner.diagnostics().retainedBytes).toBe(0);
  let checks=0;expect(()=>owner.generate(s,{...ctx,isCancelled:()=>++checks>10})).toThrow();expect(owner.diagnostics().retainedBytes).toBe(0);
  expect(()=>owner.generate(s,{...ctx,width:16384,height:2048})).toThrow(/768 MiB/);expect(owner.diagnostics().retainedBytes).toBe(0);
  expect(raster(owner.generate(s,ctx)).rootsPresentation?.newSamples).toBe(3);owner.reset();
 });
 it('requires explicit matching source math and color without silently falling back',()=>{
  const s=scene(),owner=new RootsNativePresentationSession();delete s.rootsMath;
  expect(()=>owner.generate(s,ctx)).toThrow(/源数学/);s.rootsMath=createRootsNativeMath();delete s.settings.rootDensityColorVersion;
  expect(()=>owner.generate(s,ctx)).toThrow(/平均度量/);expect(owner.diagnostics().retainedBytes).toBe(0);
 });
});
describe('source Roots camera sequence through the public presentation producer',()=>{
 function animated(){
  const s=scene();s.timeline.schedule='roots-camera-sequence-v1';s.timeline.fps=4;s.timeline.duration=3;
  s.timeline.tracks=[{id:'camera',label:'camera',target:'timeline.animate',type:'animate',enabled:true,start:0,duration:1,from:0,to:0,easing:'linear',pingPong:false,actions:[{id:'ambient',method:'ambient',args:{phiSpeed:1,thetaSpeed:0,gammaSpeed:0}}]}];
  return s;
 }
 it('uses the independent four-FPS ambient hand vector and preserves authored camera',()=>{
  const s=animated(),owner=new RootsNativePresentationSession(),baseline=structuredClone(s);
  const expected=[.0625,.1875,.375,.625,.875];
  for(let frame=0;frame<expected.length;frame++){
   const o=raster(owner.generate(s,{...ctx,time:frame/4}));
   expect(o.rootsPresentation?.cameraTimeline).toMatchObject({frame,completedFrames:frame+1,framesAdvanced:1,readbacks:1,displayFrames:frame+1,camera:{phi:expected[frame]}});
  }
  expect(s).toEqual(baseline);owner.reset();
 });
 it('cold-seeks through intermediate zoom clears with one final readback, matching incremental arrival history',()=>{
  const s=animated();s.timeline.tracks[0].duration=.5;s.timeline.tracks[0].actions=[{id:'zoom',method:'zoom',args:{value:2}}];
  const coldOwner=new RootsNativePresentationSession(),cold=raster(coldOwner.generate(s,{...ctx,time:.5}));
  expect(observation.readbacks).toBe(1);
  expect(cold.rootsPresentation).toMatchObject({newSamples:9,density:{submittedFinitePointCount:6},cameraTimeline:{frame:2,completedFrames:3,framesAdvanced:3,displayFrames:3,inkClears:1,camera:{zoom:2}}});
  const warmOwner=new RootsNativePresentationSession();for(const time of [0,.25])warmOwner.generate(s,{...ctx,time});
  const warm=raster(warmOwner.generate(s,{...ctx,time:.5}));expect(warm.pixels).toEqual(cold.pixels);expect(warm.roots).toEqual(cold.roots);
  expect(warm.rootsPresentation?.density).toEqual(cold.rootsPresentation?.density);
  coldOwner.reset();warmOwner.reset();
 });
 it('quantizes math to display time, so fractional requests do not add invisible samples',()=>{
  const s=animated(),owner=new RootsNativePresentationSession();const a=raster(owner.generate(s,{...ctx,time:.1}));
  expect(a.rootsPresentation).toMatchObject({newSamples:3,cameraTimeline:{frame:0,sampleTime:0,framesAdvanced:1}});
  const b=raster(owner.generate(s,{...ctx,time:.24}));expect(b.rootsPresentation).toMatchObject({newSamples:0,cameraTimeline:{frame:0,framesAdvanced:0}});
  expect(b.pixels).toEqual(a.pixels);owner.reset();
 });
 it('advances cloud history for every camera frame and does not fade a repeated paused frame',()=>{
  const s=animated();s.rootsPresentation!.mode='point-cloud';s.rootsPresentation!.accumulation.enabled=true;
  const owner=new RootsNativePresentationSession();const first=raster(owner.generate(s,{...ctx,time:1}));
  expect(observation.cloudDraws).toBe(5);expect(observation.cloudFade).toBe(5);expect(observation.cloudReadbacks).toBe(1);
  expect(first.rootsPresentation?.cameraTimeline).toMatchObject({frame:4,framesAdvanced:5,displayFrames:5});
  const repeat=raster(owner.generate(s,{...ctx,time:1}));
  expect(observation.cloudDraws).toBe(5);expect(observation.cloudFade).toBe(5);expect(observation.cloudReadbacks).toBe(2);
  expect(repeat.rootsPresentation?.cameraTimeline).toMatchObject({framesAdvanced:0,displayFrames:5});
  s.settings.rootSourceBrightness=.7;owner.generate(s,{...ctx,time:1});expect(observation.cloudDraws).toBe(6);owner.reset();
 });
 it('rebuilds initial angle edits and backward seeks, including after transferable outputs',()=>{
  const s=animated(),owner=new RootsNativePresentationSession();let o=raster(owner.generate(s,{...ctx,time:.75}));
  structuredClone(o,{transfer:[o.pixels.buffer]});s.rootsPresentation!.camera.phi=1;
  o=raster(owner.generate(s,{...ctx,time:.75}));expect(o.rootsPresentation).toMatchObject({restartReason:'camera',instance:2,cameraTimeline:{framesAdvanced:4,camera:{phi:1.625}}});
  o=raster(owner.generate(s,ctx));expect(o.rootsPresentation).toMatchObject({restartReason:'backward-seek',instance:3,cameraTimeline:{framesAdvanced:1,camera:{phi:1.0625}}});owner.reset();
 });
 it.each([24,30,60,120])('replays %i FPS warm/cold source clock through the temporal entry once per display frame',fps=>{
  const s=animated();s.timeline.fps=fps;const warm=new TemporalGenerationSession(),cold=new TemporalGenerationSession();
  for(let frame=0;frame<5;frame++)generateScene(s,{...ctx,time:frame/fps},warm);
  const a=raster(generateScene(s,{...ctx,time:5/fps},warm)),b=raster(generateScene(s,{...ctx,time:5/fps},cold));
  expect(a.pixels).toEqual(b.pixels);expect(a.roots).toEqual(b.roots);
  expect(a.rootsPresentation?.cameraTimeline?.camera).toEqual(b.rootsPresentation?.cameraTimeline?.camera);
  expect(b.rootsPresentation?.cameraTimeline).toMatchObject({framesAdvanced:6,completedFrames:6,displayFrames:6});warm.reset();cold.reset();
 });
 it('cancels sequential replay, revokes partial owners and starts the next request from frame zero',()=>{
  const s=animated(),owner=new RootsNativePresentationSession();let calls=0;
  expect(()=>owner.generate(s,{...ctx,time:2,isCancelled:()=>++calls>50})).toThrow();expect(owner.diagnostics().retainedBytes).toBe(0);
  const out=raster(owner.generate(s,ctx));expect(out.rootsPresentation?.cameraTimeline).toMatchObject({frame:0,framesAdvanced:1,displayFrames:1});owner.reset();
 });
 it('rejects excessive framebuffer replay before drawing and recovers on a bounded request',()=>{
  const s=animated();s.timeline.fps=120;const owner=new RootsNativePresentationSession();
  expect(()=>owner.generate(s,{...ctx,time:20,width:1024,height:512})).toThrow(/10 亿/);
  expect(owner.diagnostics()).toMatchObject({retainedBytes:0,displayFrames:0});expect(observation.readbacks).toBe(0);
  expect(raster(owner.generate(s,ctx)).rootsPresentation?.cameraTimeline?.framesAdvanced).toBe(1);owner.reset();
 });
});
describe('batched density display',()=>{
 it('consumes a reused borrowed batch immediately and presents once',()=>{
  const s=scene(),plan=prepareRootsProjection(s.rootsPresentation!,{width:17,height:13,viewport:{logicalWidth:17,logicalHeight:13,referenceLogicalHeight:13,target:'primary'}}),color=prepareRootsDensityColor(s);
  if(color.kind!=='metric-sum')throw Error('metric');const owner=new RootsNativeDensityDisplay(),buffer=new Float32Array([1,2,0,.25]);
  function* batches(){yield buffer;buffer.set([3,4,0,.75]);yield buffer;}
  const o=owner.renderBatches(plan,batches(),color);expect(observation.points).toEqual([[240,480,0,.25],[720,960,0,.75]]);expect(observation.readbacks).toBe(1);expect(o.facts).toMatchObject({newInputPoints:2,submittedFinitePointCount:2});owner.dispose();
 });
 it('preserves iterator failure and cleanup ownership, then recovers without old-ticket interference',()=>{
  const s=scene(),plan=prepareRootsProjection(s.rootsPresentation!,{width:17,height:13,viewport:{logicalWidth:17,logicalHeight:13,referenceLogicalHeight:13,target:'primary'}}),color=prepareRootsDensityColor(s);if(color.kind!=='metric-sum')throw Error('metric');
  const owner=new RootsNativeDensityDisplay(),failure=new Error('arrival producer');
  function* bad(){yield new Float32Array([1,2,0,.5]);throw failure;}
  observation.disposeFailures=1;let caught:unknown;try{owner.renderBatches(plan,bad(),color);}catch(e){caught=e;}
  expect(caught).toMatchObject({name:'GenerationCleanupError',errors:expect.arrayContaining([failure])});expect(owner.diagnostics().gpu).toBeDefined();
  owner.render(plan,new Float32Array([1,2,0,.5]),color);
  (caught as {retryCleanup():void}).retryCleanup();expect(owner.diagnostics().gpu).toBeDefined();owner.dispose();
 });
});

describe('source pending stream through actual presentation owner',()=>{
 function queued(){
  const s=scene();s.rootsMath!.sampling.workerCount=1;s.settings.rootSamplesPerFrame=9;
  s.rootsPresentation!.pending={...defaultRootsPendingConfiguration(),maxSplatPointsPerFrame:1};
  return s;
 }
 it('retains complete source batches and publication backpressure across displays',()=>{
  const s=queued(),owner=new RootsNativePresentationSession();
  const first=raster(owner.generate(s,ctx));
  expect(first.rootsPresentation?.pending).toMatchObject({attemptedSamples:6,producedPoints:6,publishedPoints:4,consumedPoints:1,pendingPoints:3,blockedPoints:2,finishedWorkers:0,drainCalls:2,pumpCalls:1});
  expect(first.rootsPresentation?.density?.submittedFinitePointCount).toBe(1);
  const second=raster(owner.generate(s,{...ctx,time:.1}));
  expect(second.rootsPresentation?.pending).toMatchObject({attemptedSamples:9,producedPoints:9,publishedPoints:8,consumedPoints:2,pendingPoints:6,blockedPoints:1,finishWaitingWorkers:1,finishedWorkers:0});
  const third=raster(owner.generate(s,{...ctx,time:.2}));
  expect(third.rootsPresentation?.pending).toMatchObject({attemptedSamples:9,producedPoints:9,publishedPoints:9,consumedPoints:3,pendingPoints:6,blockedPoints:0,finishWaitingWorkers:0,finishedWorkers:1});
  expect(observation.points).toHaveLength(3);owner.reset();expect(owner.diagnostics().retainedBytes).toBe(0);
 });
 it('keeps a sub-threshold builder private until a complete batch is published',()=>{
  const s=queued();s.rootsMath!.sampling.batchSize=3;s.rootsMath!.sampling.sampleCount=5;s.settings.rootSamplesPerFrame=1;
  const owner=new RootsNativePresentationSession();
  for(const time of [0,.1]){const o=raster(owner.generate(s,{...ctx,time}));expect(o.rootsPresentation?.density?.submittedFinitePointCount).toBe(0);}
  expect(raster(owner.generate(s,{...ctx,time:.2})).rootsPresentation?.pending).toMatchObject({builderPoints:0,publishedPoints:3,pendingPoints:2,consumedPoints:1});
  owner.reset();
 });
 it('transforms remaining raw pending points with a hot transform after clearing old ink',()=>{
  const s=queued(),owner=new RootsNativePresentationSession();owner.generate(s,ctx);
  s.rootsPresentation!.transform.offset=[2,0,0];
  const edited=raster(owner.generate(s,ctx));
  expect(edited.rootsPresentation).toMatchObject({instance:1,newSamples:0,density:{clearInk:true,submittedFinitePointCount:1},pending:{attemptedSamples:6,pendingPoints:2,consumedPoints:2,pumpCalls:1}});
  expect(observation.points).toEqual([[60,120,0,.25],[62,120,0,.25]]);owner.reset();
 });
 it('consumes nonfinite transformed raw entries without counting them as finite submissions',()=>{
  const s=queued();s.rootsMath!.parameters[0].value=[4,0];s.rootsPresentation!.transform.scale=[1e38,1,1];
  const owner=new RootsNativePresentationSession(),o=raster(owner.generate(s,ctx));
  expect(o.rootsPresentation?.pending).toMatchObject({producedPoints:6,consumedPoints:1,pendingPoints:3});
  expect(o.rootsPresentation?.density?.submittedFinitePointCount).toBe(0);expect(o.stats.invalid).toBe(1);
  const pair=owner.capturePaused(s,{...ctx,rootsViewport:{logicalWidth:ctx.width,logicalHeight:ctx.height,referenceLogicalHeight:ctx.height,target:'offscreen'}});
  expect(pair.capture.stats.invalid).toBe(2);expect(pair.preview.stats.invalid).toBe(3);
  expect(pair.capture.warnings).toContain('0 个根非有限；2 个点未通过密度显示的 float32 世界坐标检查。');
  expect(pair.preview.warnings).toContain('0 个根非有限；3 个点未通过密度显示的 float32 世界坐标检查。');
  expect(pair.preview.warnings?.filter(w=>w.includes('个根非有限'))).toHaveLength(1);owner.reset();
 });
 it('paused PNG consumes capture and primary budgets without another sample or clock step',()=>{
  const s=queued(),owner=new RootsNativePresentationSession(),first=raster(owner.generate(s,ctx));
  const pair=owner.capturePaused(s,{...ctx,rootsViewport:{logicalWidth:ctx.width,logicalHeight:ctx.height,referenceLogicalHeight:ctx.height,target:'offscreen'}});
  expect(pair.capture.rootsPresentation).toMatchObject({instance:first.rootsPresentation!.instance,newSamples:0,pending:{attemptedSamples:6,consumedPoints:2,pendingPoints:2,drainCalls:3,pumpCalls:1},pausedCapture:{arrivals:'retained-local-pending'}});
  expect(pair.preview.rootsPresentation).toMatchObject({newSamples:0,pending:{attemptedSamples:6,consumedPoints:3,pendingPoints:1,drainCalls:5,pumpCalls:1}});
  expect(pair.capture.rootsPresentation?.density?.submittedFinitePointCount).toBe(2);expect(pair.preview.rootsPresentation?.density?.submittedFinitePointCount).toBe(3);owner.reset();
 });
 it('replays every pending display for cold/warm/backward seeks with identical final ink',()=>{
  const s=queued(),warm=new RootsNativePresentationSession(),cold=new RootsNativePresentationSession();let output:ReturnType<typeof raster>|undefined;
  for(let frame=0;frame<9;frame++)output=raster(warm.generate(s,{...ctx,time:frame/10}));
  const c=raster(cold.generate(s,{...ctx,time:.8}));expect(c.pixels).toEqual(output!.pixels);
  expect(c.rootsPresentation?.pending).toEqual(output!.rootsPresentation?.pending);expect(c.rootsPresentation?.pending).toMatchObject({attemptedSamples:9,pendingPoints:0,consumedPoints:9,pumpCalls:9});
  const back=raster(warm.generate(s,ctx));expect(back.rootsPresentation).toMatchObject({restartReason:'backward-seek',instance:2,pending:{consumedPoints:1,pendingPoints:3}});warm.reset();cold.reset();
 });
 it('changes pending policy by rebuilding explicitly without recompiling mathematical inputs',()=>{
  const s=queued(),owner=new RootsNativePresentationSession();owner.generate(s,ctx);const jobs=owner.diagnostics().math.preparedJobs;
  s.rootsPresentation!.pending!.maxSplatPointsPerFrame=2;
  const o=raster(owner.generate(s,ctx));expect(o.rootsPresentation).toMatchObject({restartReason:'pending-policy',instance:2,pending:{consumedPoints:2,pendingPoints:2}});expect(owner.diagnostics().math.preparedJobs).toBe(jobs);owner.reset();
 });
 it('keeps cloud batch delivery independent of the density splat budget',()=>{
  const s=queued();s.rootsPresentation!.mode='point-cloud';const owner=new RootsNativePresentationSession();
  const o=raster(owner.generate(s,ctx));expect(o.rootsPresentation).toMatchObject({pointCloud:{retainedPoints:4,drawnPoints:4},pending:{pendingPoints:0,drainedPoints:4,consumedPoints:0,blockedPoints:2}});owner.reset();
 });
 it('does not finish an empty recording manager until a blocked terminal is actually drained',()=>{
  let s=queued();s.rootsMath!.sampling.sampleCount=1;s.rootsMath!.polynomial={variable:'x',coefficients:[{exponent:'7',expression:'1'},{exponent:'0',expression:'-1'}]};s.rootsPresentation!.pending!.referenceHeapBytes=0;
  s=withRootsSceneTimeline(s,true);s.timeline.fps=10;s.timeline.tracks=[];
  const owner=new RootsNativePresentationSession();
  const warmup=raster(owner.generate(s,ctx));expect(warmup.rootsPresentation).toMatchObject({autoRecording:{complete:false,finishedWorkers:0,queueSize:1,pendingPoints:0},pending:{maximumPendingPoints:4,consumedPoints:7,drainCalls:2}});
  const encoded=raster(owner.generate(s,{...ctx,time:.1}));expect(encoded.rootsPresentation?.autoRecording).toMatchObject({complete:true,finishedWorkers:1,queueSize:0,pendingPoints:0});owner.reset();
 });
 it('rejects oversized batch allocation before retaining partial state and recovers',()=>{
  const s=queued();s.rootsMath!.sampling.batchSize=2147483647;const owner=new RootsNativePresentationSession();
  expect(()=>owner.generate(s,ctx)).toThrow(expect.objectContaining({kind:'capacity'}));expect(owner.diagnostics().retainedBytes).toBe(0);
  s.rootsMath!.sampling.batchSize=2;
  expect(raster(owner.generate(s,ctx)).rootsPresentation?.pending).toMatchObject({consumedPoints:1,pendingPoints:3});owner.reset();
 });
 it('retains the whole pending generation when GPU cleanup fails and retries cleanup before rebuilding',()=>{
  const s=queued(),owner=new RootsNativePresentationSession();let status=0;observation.disposeFailures=1;
  expect(()=>owner.generate(s,{...ctx,onStatus:()=>{if(++status===2)throw new Error('status failure');}})).toThrow();
  expect(owner.diagnostics().pending).toBeDefined();expect(owner.diagnostics().retainedBytes).toBeGreaterThan(0);
  const recovered=raster(owner.generate(s,ctx));expect(recovered.rootsPresentation?.pending).toMatchObject({consumedPoints:1,pendingPoints:3,pumpCalls:1});owner.reset();expect(owner.diagnostics().retainedBytes).toBe(0);
 });
});
