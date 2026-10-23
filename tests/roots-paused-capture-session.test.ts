import {presentRootsNativeMetricInk,prepareRootsInkView} from '../src/engine/rootsNativeInk';
import type {RootsMetricColorPlan} from '../src/engine/rootsDensityColor';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {GenerateContext} from '../src/types';
// These are ownership/ordering tests with real math, clock, projection and tone.
// Device doubles give distinct target histories, not native shader goldens.
const seen=vi.hoisted(()=>({ids:0,live:new Set<number>(),points:0,reads:0,draws:[] as {id:number;target:string}[],readFailure:undefined as Error|undefined,failDeleteId:0,deleteFailures:0}));
vi.mock('../src/engine/rootsNativeDensityGpu',async load=>{
 const real=await load<typeof import('../src/engine/rootsNativeDensityGpu')>();
 class Device {
  id=++seen.ids;width=0;height=0;count=0;ink=new Float32Array();
  initialize(w:number,h:number){this.width=w;this.height=h;this.ink=new Float32Array(w*h*4);seen.live.add(this.id);}
  add(_p:readonly number[],m:number){seen.points++;this.count++;this.ink[0]++;this.ink[1]+=m;}
  clear(){this.count=0;this.ink.fill(0);}flush(){}
  presentPixels(color:RootsMetricColorPlan,rotation:number){return presentRootsNativeMetricInk(this.ink,prepareRootsInkView(this.width,this.height,rotation),color,this.count).pixels;}
  readback(){seen.reads++;if(seen.readFailure){const e=seen.readFailure;seen.readFailure=undefined;throw e;}return this.ink.slice();}
  diagnostics(){return{width:this.width,height:this.height,submittedPoints:this.count,retainedBytes:this.ink.byteLength,lastKernel:'points' as const,handles:1};}
  dispose(){if(this.id===seen.failDeleteId&&seen.deleteFailures-->0)throw Error('capture disposal failed');seen.live.delete(this.id);this.ink=new Float32Array();this.count=0;}
 }
 return{...real,RootsNativeDensityGpu:Device};
});
vi.mock('../src/engine/rootsNativePointCloudGpu',async load=>{
 const real=await load<typeof import('../src/engine/rootsNativePointCloudGpu')>();
 class Device {
  id=++seen.ids;width=0;height=0;history=0;
  initialize(w:number,h:number){this.width=w;this.height=h;seen.live.add(this.id);}
  clear(){this.history=0;}fade(){}
  draw(plan:{target:string}){this.history++;seen.draws.push({id:this.id,target:plan.target});}
  readback(){seen.reads++;if(seen.readFailure){const e=seen.readFailure;seen.readFailure=undefined;throw e;}const out=new Uint8ClampedArray(this.width*this.height*4);out[0]=this.history;out[3]=80+this.history;return out;}
  diagnostics(){return{retainedBytes:this.width*this.height*4};}
  dispose(){if(this.id===seen.failDeleteId&&seen.deleteFailures-->0)throw Error('capture disposal failed');seen.live.delete(this.id);}
 }
 return{...real,RootsNativePointCloudGpu:Device};
});
import {RootsNativePresentationSession} from '../src/engine/rootsNativePresentationSession';
import {RootsMathSession} from '../src/engine/rootsMathJob';
import {RootsSceneClock} from '../src/engine/rootsSceneClock';
import {GenerationCleanupError} from '../src/engine/generationCleanup';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {createRootsNativeMath} from '../src/engine/rootsMathConfig';
import {defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
const primary:GenerateContext={time:0,width:17,height:13,quality:'preview',rootsSessionId:'live',rootsViewport:{logicalWidth:17,logicalHeight:13,referenceLogicalHeight:13,target:'primary'}};
const capture=(width=17,height=13):GenerateContext=>({...primary,quality:'export',width,height,rootsViewport:{logicalWidth:width,logicalHeight:height,referenceLogicalHeight:13,target:'offscreen'}});
function scene(mode:'density'|'point-cloud'='density'){
 const s=createScene(definition('roots'));s.rootsMath=createRootsNativeMath();
 s.rootsMath.polynomial={variable:'x',coefficients:[{exponent:'1',expression:'1'},{exponent:'0',expression:'-t2'}]};
 s.rootsMath.parameters=[{name:'t2',domain:'FIXED',minRe:0,maxRe:1,minIm:0,maxIm:1,value:[.25,.5]}];
 s.rootsMath.sampling={sampleCount:100,batchSize:2,workerCount:2,seed:'0',filter:''};
 s.rootsPresentation=defaultRootsPresentationConfiguration();s.rootsPresentation.mode=mode;s.rootsPresentation.camera.phi=0;s.rootsPresentation.accumulation.enabled=mode==='point-cloud';
 Object.assign(s.settings,{rootsMode:'progressive',rootDensityColorVersion:'mathart-1.7.8-metric-v1',rootSamplesPerFrame:3,rootSamplingFps:4,rootStartTime:0,rootColor:'t2_real'});
 s.timeline={...s.timeline,schedule:'roots-scene-sequence-v1',fps:4,duration:2,tracks:[{id:'g',label:'g',type:'animate',target:'timeline.animate',enabled:true,start:0,duration:1,from:0,to:0,pingPong:false,easing:'linear',actions:[{id:'rotate',method:'ambient',args:{phiSpeed:1}},{id:'gradient',method:'gradientStart',gradient:{mode:'hue_rotate',interpolation:'linear',speed:360}}]}]};
 return s;
}
beforeEach(()=>{vi.restoreAllMocks();seen.ids=seen.points=seen.reads=seen.failDeleteId=seen.deleteFailures=0;seen.live.clear();seen.draws=[];seen.readFailure=undefined;});
describe('same-instance paused capture',()=>{
 it('retains the primary formula frame through offscreen capture and rejects stale annotation edits',()=>{
  const s=scene();s.formulas={layout:'source-surface-centered-v1',main:{visible:true,x:0,y:150,scale:.25,color:'#ffffff',anchor:'center',latex:'x^2'},additional:[]};
  const owner=new RootsNativePresentationSession(),before=owner.generate(s,primary),expected=structuredClone(before.formulaPresentation);
  before.formulaPresentation!.labels[0].latex='consumer mutation';const result=owner.capturePaused(s,capture(19,15));
  expect(result.capture.formulaPresentation).toEqual(expected);expect(result.preview.formulaPresentation).toEqual(expected);expect(result.capture.formulaPresentation).toMatchObject({primaryLogicalHeight:13});
  s.formulas.main.latex='changed';expect(()=>owner.capturePaused(s,capture())).toThrow(/预览/);owner.reset();
 });
 it('observes retained completed identity without mutation and treats malformed queries as unknown',()=>{
  const owner=new RootsNativePresentationSession(),s=scene();
  expect(owner.matchesCompletedPrimary(s,primary)).toBe(false);owner.generate(s,primary);const before=owner.diagnostics();
  expect(owner.matchesCompletedPrimary(s,primary)).toBe(true);
  expect(owner.matchesCompletedPrimary(s,{...primary,time:-0})).toBe(false);
  expect(owner.matchesCompletedPrimary(s,{...primary,rootsSessionId:''})).toBe(false);
  expect(owner.matchesCompletedPrimary(s,undefined as unknown as GenerateContext)).toBe(false);
  const cycle=structuredClone(s);(cycle as unknown as Record<string,unknown>).loop=cycle;
  expect(owner.matchesCompletedPrimary(cycle,primary)).toBe(false);expect(owner.diagnostics()).toEqual(before);
  owner.reset();expect(owner.matchesCompletedPrimary(s,primary)).toBe(false);
 });
 it('requires a successful primary request without constructing a renderer',()=>{
  const owner=new RootsNativePresentationSession();expect(()=>owner.capturePaused(scene(),capture())).toThrow(/最后成功/);expect(seen.ids).toBe(0);owner.reset();
 });
 it('reuses exact evaluated color/camera and current ink without math or clock calls',()=>{
  const owner=new RootsNativePresentationSession(),s=scene(),request={...primary,time:.25};
  const first=owner.generate(s,request),jobs=owner.diagnostics().math.preparedJobs;
  const get=vi.spyOn(RootsMathSession.prototype,'get'),step=vi.spyOn(RootsSceneClock.prototype,'step'),points=seen.points;
  // Delivered buffers and metadata belong to caller; changing/transferring
  // them must not mutate the saved successful request's private facts.
  first.rootsPresentation!.cameraTimeline!.camera={...first.rootsPresentation!.cameraTimeline!.camera,phi:123};
  first.roots!.attemptedSamples=999;
  structuredClone(first,{transfer:[first.pixels.buffer]});
  const pair=owner.capturePaused(s,{...capture(),time:.25});
  expect(get).not.toHaveBeenCalled();expect(step).not.toHaveBeenCalled();expect(seen.points).toBe(points);expect(owner.diagnostics().math.preparedJobs).toBe(jobs);
  for(const output of [pair.capture,pair.preview]){
   expect(output.roots).toMatchObject({attemptedSamples:6,rootPoints:6});
   expect(output.rootsPresentation).toMatchObject({instance:1,newSamples:0,newRawPoints:0,cameraTimeline:{completedFrames:2,framesAdvanced:0,camera:{phi:.1875},gradient:{offset:.375}},density:{submittedFinitePointCount:6}});
   expect(output.rootsColor?.paletteOffset).toBe(.375);
  }
  expect(pair.capture.pixels).toEqual(pair.preview.pixels);expect(pair.capture.rootsPresentation?.pausedCapture?.role).toBe('capture');expect(pair.preview.rootsPresentation?.pausedCapture?.role).toBe('preview-refresh');
  expect(pair.capture.rootsPresentation?.cameraTimeline?.displayFrames).toBe(3);expect(pair.preview.rootsPresentation?.cameraTimeline?.displayFrames).toBe(4);
  expect(pair.capture.rootsPresentation?.presentationAlpha).toBe('preserved-framebuffer-rgba');expect(pair.preview.rootsPresentation?.presentationAlpha).toBe('opaque-framebuffer-rgb');
  expect(pair.capture.warnings?.some(w=>w.includes('预览和导出按完整帧 RGB 不透明'))).toBe(false);expect(pair.preview.warnings?.some(w=>w.includes('预览和导出按完整帧 RGB 不透明'))).toBe(true);
  expect(pair.capture.pixels.buffer).not.toBe(pair.preview.pixels.buffer);owner.reset();expect(seen.live.size).toBe(0);
 });
 it('clears shared density on offscreen/primary size transitions while retaining the original matrix anchor',()=>{
  const s=scene(),owner=new RootsNativePresentationSession();owner.generate(s,primary);const points=seen.points;
  const pair=owner.capturePaused(s,capture(19,11));
  expect(pair.capture).toMatchObject({width:19,height:11});expect(pair.preview).toMatchObject({width:17,height:13});
  for(const out of [pair.capture,pair.preview])expect(out.rootsPresentation?.density).toMatchObject({capture:false,clearInk:true,clearReasons:['physical-size'],submittedFinitePointCount:0,matrixReferenceViewport:{physicalWidth:17,physicalHeight:13,target:'primary'}});
  expect(owner.diagnostics().density?.clears).toBe(2);expect(seen.points).toBe(points);expect(owner.diagnostics().instance).toBe(1);
  const resumed=owner.generate(s,{...primary,time:.25});expect(resumed.rootsPresentation).toMatchObject({instance:1,newSamples:3,density:{submittedFinitePointCount:3}});expect(resumed.rootsPresentation?.pausedCapture).toBeUndefined();owner.reset();
 });
 it('owns separate cloud target histories and reuses each on repeated captures',()=>{
  const s=scene('point-cloud'),owner=new RootsNativePresentationSession();owner.generate(s,primary);owner.generate(s,{...primary,time:.25});
  const first=owner.capturePaused(s,{...capture(),time:.25});
  expect(first.capture.pixels[0]).toBe(1);expect(first.preview.pixels[0]).toBe(3);expect(first.capture.pixels[3]).toBe(81);
  const second=owner.capturePaused(s,{...capture(),time:.25});
  expect(second.capture.pixels[0]).toBe(2);expect(second.preview.pixels[0]).toBe(4);
  expect(seen.draws.map(d=>d.target)).toEqual(['primary','primary','offscreen','primary','offscreen','primary']);
  expect(new Set(seen.draws.filter(d=>d.target==='primary').map(d=>d.id)).size).toBe(1);expect(seen.live.size).toBe(2);
  expect(second.capture.rootsPresentation?.pointCloud).toMatchObject({retainedPoints:6,totalWrites:'6'});
  const before=seen.draws.length;owner.generate(s,{...primary,time:.25});expect(seen.draws.length).toBe(before);owner.reset();expect(seen.live.size).toBe(0);
 });
 it('recreates only resized cloud offscreen history and keeps the same ring and primary target',()=>{
  const s=scene('point-cloud'),owner=new RootsNativePresentationSession();owner.generate(s,primary);owner.capturePaused(s,capture());
  const pair=owner.capturePaused(s,capture(19,11));
  expect(pair.capture.pixels[0]).toBe(1);expect(pair.preview.pixels[0]).toBe(3);expect(seen.ids).toBe(3);expect(seen.live.size).toBe(2);
  expect(pair.capture.rootsPresentation?.pointCloud?.totalWrites).toBe('3');owner.reset();
 });
 it('rejects stale scene/time/instance/reference and invalid sizes before changing preview',()=>{
  const s=scene(),owner=new RootsNativePresentationSession();owner.generate(s,primary);const before=owner.diagnostics();
  const changed=structuredClone(s);changed.settings.rootSourceBrightness=.7;
  const requests:[typeof s,GenerateContext][]=[[changed,capture()],[s,{...capture(),time:.1}],[s,{...capture(),time:-0}],[s,{...capture(),rootsSessionId:'other'}],[s,{...capture(),rootsViewport:{...capture().rootsViewport!,target:'primary'}}],[s,{...capture(),rootsViewport:{...capture().rootsViewport!,referenceLogicalHeight:14}}],[s,capture(0,13)]];
  for(const [document,request]of requests)expect(()=>owner.capturePaused(document,request)).toThrow();
  expect(owner.diagnostics()).toEqual(before);expect(seen.reads).toBe(1);expect(owner.capturePaused(s,capture()).preview.rootsPresentation?.instance).toBe(1);owner.reset();
 });
 it('pre-cancel and invalid or over-capacity enhancer reservations preserve the completed frame',()=>{
  const s=scene(),owner=new RootsNativePresentationSession();owner.generate(s,primary);const before=owner.diagnostics();
  expect(()=>owner.capturePaused(s,{...capture(),isCancelled:()=>true})).toThrow();
  for(const additionalBytes of [-1,NaN,Infinity,.5])expect(()=>owner.capturePaused(s,capture(),{additionalBytes})).toThrow(/容量预留/);
  expect(()=>owner.capturePaused(s,capture(),{additionalBytes:768*1024*1024})).toThrow(/768 MiB/);
  expect(owner.diagnostics()).toEqual(before);expect(owner.matchesCompletedPrimary(s,primary)).toBe(true);owner.capturePaused(s,capture());owner.reset();
 });
 it('preflights two cloud targets and the held capture output before any large allocation',()=>{
  const s=scene('point-cloud'),owner=new RootsNativePresentationSession();owner.generate(s,primary);const before=owner.diagnostics(),ids=seen.ids;
  expect(()=>owner.capturePaused(s,capture(16384,2048),{additionalBytes:220*1024*1024})).toThrow(/768 MiB/);
  expect(seen.ids).toBe(ids);expect(owner.diagnostics()).toEqual(before);owner.reset();
 });
 it('mid-operation cancellation revokes the completed frame and releases changed targets',()=>{
  const s=scene(),owner=new RootsNativePresentationSession();owner.generate(s,primary);const reads=seen.reads;
  expect(()=>owner.capturePaused(s,{...capture(19,11),isCancelled:()=>seen.reads>reads})).toThrow();
  expect(owner.matchesCompletedPrimary(s,primary)).toBe(false);expect(owner.diagnostics()).toMatchObject({completedPrimary:false,retainedBytes:0});expect(seen.live.size).toBe(0);
  expect(()=>owner.capturePaused(s,capture())).toThrow(/最后成功/);expect(owner.generate(s,primary).rootsPresentation?.restartReason).toBe('initial');owner.reset();
 });
 it('keeps failed cleanup owners and old retry tickets cannot dispose a recovered generation',()=>{
  const s=scene('point-cloud'),owner=new RootsNativePresentationSession();owner.generate(s,primary);
  seen.readFailure=new Error('offscreen readback failed');seen.failDeleteId=2;seen.deleteFailures=1;
  let caught:unknown;try{owner.capturePaused(s,capture());}catch(error){caught=error;}
  expect(caught).toBeInstanceOf(GenerationCleanupError);expect(owner.matchesCompletedPrimary(s,primary)).toBe(false);expect(owner.diagnostics().completedPrimary).toBe(false);expect(seen.live.has(2)).toBe(true);
  const recovered=owner.generate(s,primary);expect(recovered.rootsPresentation?.instance).toBe(2);expect(seen.live.size).toBe(1);
  (caught as GenerationCleanupError).retryCleanup();expect(seen.live.size).toBe(1);owner.reset();expect(seen.live.size).toBe(0);
 });
 it('does not retain transferable output pixels across captures and clears eligibility on reset',()=>{
  const s=scene(),owner=new RootsNativePresentationSession();owner.generate(s,primary);const pair=owner.capturePaused(s,capture());
  const expected=pair.preview.pixels.slice();structuredClone(pair,{transfer:[pair.capture.pixels.buffer,pair.preview.pixels.buffer]});
  expect(owner.capturePaused(s,capture()).preview.pixels).toEqual(expected);owner.reset();expect(()=>owner.capturePaused(s,capture())).toThrow(/最后成功/);
 });
 it('does not reinterpret a standalone offscreen generation as a primary preview instance',()=>{
  const s=scene('point-cloud'),owner=new RootsNativePresentationSession();owner.generate(s,capture());const before=owner.diagnostics();
  expect(()=>owner.capturePaused(s,capture())).toThrow(/主预览/);expect(owner.diagnostics()).toEqual(before);owner.reset();
 });
});
