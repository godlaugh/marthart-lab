import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {AnimationTrack,SceneOutput} from '../src/types';

// Peer boundary tests: real stream/math, camera clock, projection, display,
// cleanup, and temporal routing. The device only counts submissions and gives
// a valid tiny ink buffer; these tests do not establish shader/pixel fidelity.
const device=vi.hoisted(()=>({flushes:0,readbacks:0,clears:0,points:0,live:0,disposals:0,
 readFailure:undefined as Error|undefined,disposeFailures:0}));
vi.mock('../src/engine/rootsNativeDensityGpu',async load=>{
 const original=await load<typeof import('../src/engine/rootsNativeDensityGpu')>();
 class CountedDevice {
  width=0;height=0;count=0;ink=new Float32Array();owned=false;
  initialize(width:number,height:number){this.width=width;this.height=height;this.ink=new Float32Array(width*height*4);this.owned=true;device.live++;}
  add(_point:readonly number[],metric:number){device.points++;this.count++;this.ink[0]++;this.ink[1]+=metric;}
  flush(){device.flushes++;}
  clear(){device.clears++;this.count=0;this.ink.fill(0);}
  readback(){device.readbacks++;if(device.readFailure){const error=device.readFailure;device.readFailure=undefined;throw error;}return this.ink.slice();}
  diagnostics(){return{width:this.width,height:this.height,submittedPoints:this.count,retainedBytes:this.ink.byteLength,lastKernel:'points' as const,probe:{selected:'points' as const},handles:this.owned?1:0};}
  dispose(){device.disposals++;if(device.disposeFailures>0){device.disposeFailures--;throw new Error('peer controlled disposal failure');}if(this.owned){this.owned=false;device.live--;}this.ink=new Float32Array();this.count=0;}
 }
 return {...original,RootsNativeDensityGpu:CountedDevice};
});
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {createRootsNativeMath} from '../src/engine/rootsMathConfig';
import {defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import {RootsNativePresentationSession} from '../src/engine/rootsNativePresentationSession';
import {generateScene,TemporalGenerationSession} from '../src/engine/temporal';
import {GenerationCleanupError} from '../src/engine/generationCleanup';

const request={time:0,width:3,height:3,quality:'export' as const};
function track(id:string,duration:number,actions:NonNullable<AnimationTrack['actions']>=[]):AnimationTrack {
 return{id,label:id,target:'timeline.animate',type:actions.length?'animate':'wait',enabled:true,start:0,duration,from:0,to:0,easing:'linear',pingPong:false,actions};
}
function fixture(){
 const scene=createScene(definition('roots'));
 scene.rootsMath=createRootsNativeMath();
 scene.rootsMath.polynomial={variable:'x',coefficients:[{exponent:'1',expression:'1'},{exponent:'0',expression:'-t2'}]};
 scene.rootsMath.parameters=[{name:'t2',domain:'FIXED',minRe:0,maxRe:1,minIm:0,maxIm:1,value:[.25,.5]}];
 scene.rootsMath.sampling={sampleCount:100,batchSize:2,workerCount:2,seed:'0',filter:''};
 scene.rootsPresentation=defaultRootsPresentationConfiguration();scene.rootsPresentation.camera.phi=0;
 Object.assign(scene.settings,{rootsMode:'progressive',rootDensityColorVersion:'mathart-1.7.8-metric-v1',rootSamplesPerFrame:2,rootSamplingFps:7,rootStartTime:0,rootColor:'t2_real'});
 scene.timeline={...scene.timeline,schedule:'roots-camera-sequence-v1',fps:4,duration:3,tracks:[track('ramp',1,[{id:'rate',method:'ambient',args:{phiSpeed:1,thetaSpeed:0,gammaSpeed:0}}])]};
 return scene;
}
function raster(output:SceneOutput){if(output.type!=='raster')throw new Error('Expected raster');return output;}
function containsError(error:unknown,wanted:unknown):boolean {
 return error===wanted||error instanceof AggregateError&&Array.from(error.errors).some(item=>containsError(item,wanted));
}
beforeEach(()=>{Object.assign(device,{flushes:0,readbacks:0,clears:0,points:0,live:0,disposals:0,readFailure:undefined,disposeFailures:0});});

describe('Roots camera session independent producer boundaries',()=>{
 it('keeps source no-carry and raw-dt integration through a cold multi-frame display request',()=>{
  const scene=fixture();scene.timeline.tracks=[track('short-ramp',.1,[{id:'rate',method:'ambient',args:{phiSpeed:1}}]),track('short-wait',.1)];
  const owner=new TemporalGenerationSession();
  // Source: first remaining fold F(.1 + .1), but angle integrates raw .25;
  // the second clip starts next frame, then the completed queue keeps rate 1.
  const expected=[{phi:.25,index:1,dt:Math.fround(.2),samples:2},{phi:.5,index:2,dt:Math.fround(.1),samples:4},{phi:.75,index:2,dt:.25,samples:8}];
  for(const [frame,value] of expected.entries()){
   const out=raster(generateScene(scene,{...request,time:frame/4},owner));
   expect(out.rootsPresentation?.cameraTimeline).toMatchObject({frame,rawDt:.25,activeDt:value.dt,queueIndex:value.index,camera:{phi:value.phi}});
   expect(out.roots?.attemptedSamples).toBe(value.samples);
  }
  const coldOwner=new TemporalGenerationSession(),before=device.readbacks;
  const cold=raster(generateScene(scene,{...request,time:.5},coldOwner));
  expect(device.readbacks-before).toBe(1);
  expect(cold.rootsPresentation?.cameraTimeline).toMatchObject({completedFrames:3,framesAdvanced:3,displayFrames:3,camera:{phi:.75}});
  expect(cold.roots?.attemptedSamples).toBe(8);expect(cold.rootsPresentation?.newRawPoints).toBe(8);
  owner.reset();coldOwner.reset();expect(device.live).toBe(0);
 });

 it('keeps omitted-profile request-time sampling distinct from explicit camera display-frame sampling',()=>{
  const scene=fixture(),legacy=structuredClone(scene);delete legacy.timeline.schedule;
  const oldOwner=new TemporalGenerationSession(),newOwner=new TemporalGenerationSession();
  const old=raster(generateScene(legacy,{...request,time:.24},oldOwner));
  const source=raster(generateScene(scene,{...request,time:.24},newOwner));
  expect(old.roots?.attemptedSamples).toBe(4);expect(old.rootsPresentation?.cameraTimeline).toBeUndefined();
  expect(source.roots?.attemptedSamples).toBe(2);expect(source.rootsPresentation?.cameraTimeline).toMatchObject({frame:0,sampleTime:0,camera:{phi:.0625}});
  expect(legacy.rootsPresentation?.camera.phi).toBe(0);expect(scene.rootsPresentation?.camera.phi).toBe(0);
  oldOwner.reset();newOwner.reset();expect(device.live).toBe(0);
 });

 it('retains the 2767 omitted-profile identity treatment of signed zero in dormant timeline fields',()=>{
  const scene=fixture();delete scene.timeline.schedule;
  const owner=new TemporalGenerationSession();generateScene(scene,request,owner);
  scene.timeline.tracks[0].start=-0;
  const next=raster(generateScene(scene,request,owner));
  expect(next.rootsPresentation).toMatchObject({instance:1,restartReason:null,newSamples:0});
  expect(device.points).toBe(2);owner.reset();expect(device.live).toBe(0);
 });

 it('retains sampler and camera frame for hot projection edits, but rebuilds an authored zoom baseline',()=>{
  const scene=fixture(),owner=new TemporalGenerationSession();
  const first=raster(generateScene(scene,{...request,time:.5,rootsSessionId:'opened'},owner));
  const jobs=owner.diagnostics().rootsNative.math.preparedJobs;
  scene.rootsPresentation!.camera.center=[1,0,0];scene.rootsPresentation!.camera.focalDistance=21;scene.id='saved-id';
  const edited=raster(generateScene(scene,{...request,time:.5,width:5,rootsSessionId:'opened'},owner));
  expect(edited.rootsPresentation).toMatchObject({instance:1,restartReason:null,newSamples:0,density:{capture:true,clearInk:true,submittedFinitePointCount:0},cameraTimeline:{framesAdvanced:0,completedFrames:3,camera:{phi:.375}}});
  expect(owner.diagnostics().rootsNative.math.preparedJobs).toBe(jobs);
  expect(first.rootsPresentation?.cameraTimeline?.camera).toEqual({phi:.375,theta:0,gamma:0,zoom:1});
  scene.rootsPresentation!.camera.zoom=2;
  const baseline=raster(generateScene(scene,{...request,time:.5,width:5,rootsSessionId:'opened'},owner));
  expect(baseline.rootsPresentation).toMatchObject({instance:2,restartReason:'camera',newSamples:8,cameraTimeline:{framesAdvanced:3,camera:{phi:.375,zoom:2}}});
  owner.reset();expect(device.live).toBe(0);
 });

 it('saves the author baseline and cold-replays the same clock without persisting delivered frame facts',()=>{
  const scene=fixture(),owner=new TemporalGenerationSession();
  const displayed=raster(generateScene(scene,{...request,time:.75},owner));
  const saved=persistentScene(scene),parsed=parseScene(JSON.stringify(saved));
  expect(saved.rootsPresentation?.camera.phi).toBe(0);expect(saved).not.toHaveProperty('evaluatedRootsCamera');
  const coldOwner=new TemporalGenerationSession(),cold=raster(generateScene(parsed,{...request,time:.75},coldOwner));
  expect(cold.rootsPresentation?.cameraTimeline).toMatchObject({camera:{phi:.625},completedFrames:4});
  expect(cold.pixels).toEqual(displayed.pixels);expect(cold.roots).toEqual(displayed.roots);
  owner.reset();coldOwner.reset();expect(device.live).toBe(0);
 });

 it('counts remaining-queue work across the entire small-frame request and recovers after capacity failure',()=>{
  const scene=fixture();scene.timeline.fps=120;scene.timeline.duration=86400;
  scene.timeline.tracks=Array.from({length:1000},(_,i)=>track(String(i),86400));
  const owner=new RootsNativePresentationSession();
  // Tiny image cannot exercise the pixel budget. All 1000 clips remain, so
  // each frame costs 1001 units and only floor(2,000,000 / 1001) fit.
  expect(()=>owner.generate(scene,{...request,width:1,height:1,time:20})).toThrow(/队列折叠工作预算/);
  expect(device.flushes).toBe(1998);expect(device.readbacks).toBe(0);
  expect(device.live).toBe(0);expect(owner.diagnostics().retainedBytes).toBe(0);
  const recovery=raster(owner.generate(fixture(),request));
  expect(recovery.rootsPresentation?.cameraTimeline).toMatchObject({frame:0,framesAdvanced:1,displayFrames:1,camera:{phi:.0625}});
  owner.reset();expect(device.live).toBe(0);
 });

 it('revokes the completed camera frame when the final status callback fails after readback',()=>{
  const scene=fixture(),owner=new TemporalGenerationSession(),failure=new Error('caller rejected final status');
  expect(()=>generateScene(scene,{...request,time:.5,onStatus:()=>{if(device.readbacks)throw failure;}},owner)).toThrow(failure);
  expect(device.flushes).toBe(3);expect(device.readbacks).toBe(1);expect(device.live).toBe(0);
  expect(owner.diagnostics().rootsNative).toMatchObject({retainedBytes:0,cameraFrame:-1,displayFrames:0});
  const recovered=raster(generateScene(scene,request,owner));
  expect(recovered.rootsPresentation?.cameraTimeline).toMatchObject({frame:0,framesAdvanced:1,displayFrames:1,camera:{phi:.0625}});
  owner.reset();expect(device.live).toBe(0);
 });

 it('retains nested cleanup ownership after final-readback failure and retires the old retry ticket',()=>{
  const scene=fixture(),owner=new RootsNativePresentationSession(),failure=new Error('peer final readback');
  device.readFailure=failure;device.disposeFailures=2;
  let caught:unknown;try{owner.generate(scene,{...request,time:.5});}catch(error){caught=error;}
  expect(caught).toBeInstanceOf(GenerationCleanupError);expect(containsError(caught,failure)).toBe(true);
  expect(device.flushes).toBe(3);expect(device.readbacks).toBe(1);expect(device.live).toBe(1);
  expect(owner.diagnostics().density?.frameReady).toBe(false);
  const recovered=raster(owner.generate(scene,request));
  expect(recovered.rootsPresentation?.cameraTimeline).toMatchObject({frame:0,framesAdvanced:1,displayFrames:1});
  expect(device.live).toBe(1);(caught as GenerationCleanupError).retryCleanup();
  expect(device.live).toBe(1);expect(owner.diagnostics().density?.frameReady).toBe(true);
  owner.reset();expect(device.live).toBe(0);
 });
});

describe('Roots mixed scene queue reaches the actual display boundary',()=>{
 const start={id:'start',method:'gradientStart',gradient:{model:'offsets' as const,mode:'hue_rotate' as const,interpolation:'linear' as const,speed:360,affectInside:true,affectOutside:true}};
 function mixed(){
  const scene=fixture();scene.timeline.schedule='roots-scene-sequence-v1';
  scene.timeline.tracks=[track('mixed',1,[{id:'rate',method:'ambient',args:{phiSpeed:1}},start]),track('stop',.5,[{id:'stop',method:'gradientStop'}])];return scene;
 }
 it('uses two ordered phases, recolors retained ink and freezes the last offset after stop',()=>{
  const scene=mixed(),before=structuredClone(scene),owner=new TemporalGenerationSession();
  for(const [frame,offset] of [.125,.375,.75,.25,.5,.5,.5].entries()){
   const out=raster(generateScene(scene,{...request,time:frame/4},owner)),facts=out.rootsPresentation!.cameraTimeline!;
   expect(facts.model).toBe('roots-scene-sequence-v1');expect(facts.gradient?.offset).toBe(offset);expect(out.rootsColor?.paletteOffset).toBe(offset);
   expect(facts.gradient?.phases.map(phase=>phase.kind)).toEqual(frame<6?['active','raw']:['raw']);
   expect(facts.gradient?.running).toBe(frame<5);expect(facts.inkClears).toBe(0);
  }
  expect(scene).toEqual(before);expect(device.points).toBe(22);
  const paused=raster(generateScene(scene,{...request,time:1.5},owner));
  expect(paused.rootsPresentation).toMatchObject({newSamples:0,cameraTimeline:{framesAdvanced:0,gradient:{offset:.5,running:false}}});expect(paused.rootsColor?.paletteOffset).toBe(.5);
  owner.reset();expect(device.live).toBe(0);
 });
 it('cold seek, backward replay and saved document produce the same final target and sample count',()=>{
  const scene=mixed(),warm=new TemporalGenerationSession(),cold=new TemporalGenerationSession();
  generateScene(scene,request,warm);generateScene(scene,{...request,time:.75},warm);
  const expected=raster(generateScene(scene,{...request,time:1.25},warm));
  const parsed=parseScene(JSON.stringify(persistentScene(scene))),fresh=raster(generateScene(parsed,{...request,time:1.25},cold));
  expect(fresh.rootsPresentation?.cameraTimeline?.gradient).toEqual(expected.rootsPresentation?.cameraTimeline?.gradient);expect(fresh.pixels).toEqual(expected.pixels);expect(fresh.roots).toEqual(expected.roots);
  const backwards=raster(generateScene(scene,{...request,time:.25},warm));
  expect(backwards.rootsPresentation).toMatchObject({restartReason:'backward-seek',cameraTimeline:{gradient:{offset:.375},framesAdvanced:2}});
  warm.reset();cold.reset();expect(device.live).toBe(0);
 });
 it('keeps ordered start/stop actions instead of last-write collapsing their runtime state',()=>{
  for(const [actions,running,offset] of [[[{id:'stop',method:'gradientStop'},start],true,.5],[[start,{id:'stop',method:'gradientStop'}],false,0]] as const){
   const scene=mixed();scene.timeline.tracks=[track('ordered',.25,[...actions])];
   const owner=new TemporalGenerationSession(),out=raster(generateScene(scene,request,owner));
   expect(out.rootsPresentation?.cameraTimeline?.gradient).toMatchObject({running,offset});expect(out.rootsColor?.paletteOffset).toBe(offset);owner.reset();
  }
  expect(device.live).toBe(0);
 });
 it('rebuilds an edited full-scene offset baseline while preserving the camera-only hot-edit contract',()=>{
  for(const full of [false,true]){
   const scene=mixed();if(!full)scene.timeline.schedule='roots-camera-sequence-v1';
   const owner=new TemporalGenerationSession();generateScene(scene,request,owner);scene.settings.rootSourcePaletteOffset=.25;
   const out=raster(generateScene(scene,request,owner));
   expect(out.rootsPresentation).toMatchObject({instance:full?2:1,restartReason:full?'gradient':null,newSamples:full?2:0});expect(out.rootsColor?.paletteOffset).toBe(full?.375:.25);
   if(!full)expect(out.rootsPresentation?.cameraTimeline?.gradient).toBeUndefined();owner.reset();
  }
  expect(device.live).toBe(0);
 });
});

describe('Roots source completion after real producer submission',()=>{
 it('finishes authored queues even while the gradient and sampling remain active',()=>{
  const scene=fixture();scene.timeline.schedule='roots-scene-sequence-v1';
  scene.timeline.tracks=[track('short',.25,[{id:'gradient',method:'gradientStart',gradient:{mode:'hue_rotate',interpolation:'linear',speed:360}}])];
  const owner=new TemporalGenerationSession(),out=raster(generateScene(scene,request,owner));
  expect(device.readbacks).toBe(1);expect(out.rootsPresentation?.cameraTimeline?.gradient?.running).toBe(true);expect(out.roots?.complete).toBe(false);
  expect(out.rootsPresentation?.autoRecording).toMatchObject({policy:'local-synchronous-ordinal',complete:true,hasAnimations:true,queueComplete:true,attemptedSamples:2,sampleCount:100,finishedWorkers:0,queueSize:0,pendingPoints:0});
  owner.reset();expect(device.live).toBe(0);
 });
 it('empty queues wait for all logical partitions and submitted points, including worker clamping',()=>{
  const scene=fixture();scene.timeline.schedule='roots-scene-sequence-v1';scene.timeline.tracks=[];
  scene.rootsMath!.sampling.sampleCount=3;scene.rootsMath!.sampling.workerCount=10;
  const owner=new TemporalGenerationSession(),first=raster(generateScene(scene,request,owner));
  expect(first.rootsPresentation?.autoRecording).toMatchObject({complete:false,hasAnimations:false,queueComplete:true,configuredWorkerCount:10,workerCount:3,finishedWorkers:2,attemptedSamples:2});
  const last=raster(generateScene(scene,{...request,time:.25},owner));
  expect(last.rootsPresentation?.autoRecording).toMatchObject({complete:true,workerCount:3,finishedWorkers:3,attemptedSamples:3,queueSize:0,pendingPoints:0});
  expect(device.points).toBe(3);expect(device.readbacks).toBe(2);owner.reset();expect(device.live).toBe(0);
 });
});
