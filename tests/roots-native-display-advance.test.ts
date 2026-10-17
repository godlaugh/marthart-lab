import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {PreparedRootsProjection} from '../src/engine/rootsProjection';

const observed=vi.hoisted(()=>({
 readbacks:0,initializations:0,clears:0,disposals:0,disposeFailures:0,
 flushFailure:undefined as Error|undefined,readbackFailure:undefined as Error|undefined,invalidInk:false,
 flushes:[] as {count:number;plan:PreparedRootsProjection}[],points:[] as number[][],
}));
// Exercise the real display/projection/tone/cleanup owners. This bounded device
// double exposes submissions and readbacks; it is not a WebGL correctness test.
vi.mock('../src/engine/rootsNativeDensityGpu',async importOriginal=>{
 const original=await importOriginal<typeof import('../src/engine/rootsNativeDensityGpu')>();
 class Device {
  width=0;height=0;count=0;pending:number[]=[];ink=new Float32Array();
  initialize(width:number,height:number){this.width=width;this.height=height;this.ink=new Float32Array(width*height*4);observed.initializations++;}
  add(world:readonly number[],metric:number){observed.points.push([...world,metric]);this.pending.push(metric);}
  flush(plan:PreparedRootsProjection){
   if(observed.flushFailure)throw observed.flushFailure;
   observed.flushes.push({count:this.pending.length,plan});
   for(const metric of this.pending){this.ink[0]++;this.ink[1]+=metric;this.count++;}
   this.pending=[];
  }
  clear(){this.pending=[];this.count=0;this.ink.fill(0);observed.clears++;}
  readback(){observed.readbacks++;if(observed.readbackFailure)throw observed.readbackFailure;const ink=this.ink.slice();if(observed.invalidInk)ink[0]=NaN;return ink;}
  diagnostics(){return{submittedPoints:this.count,lastKernel:'points' as const,handles:this.ink.length?1:0};}
  dispose(){observed.disposals++;if(observed.disposeFailures-->0)throw new Error('controlled disposal');this.ink=new Float32Array();this.pending=[];this.count=0;}
 }
 return{...original,RootsNativeDensityGpu:Device};
});
import {RootsNativeDensityDisplay} from '../src/engine/rootsNativeDisplay';
import {prepareRootsProjection} from '../src/engine/rootsProjection';
import {defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import {prepareRootsDensityColor} from '../src/engine/rootsDensityColor';
import {GenerationCleanupError} from '../src/engine/generationCleanup';
import {ROOTS_NATIVE_DENSITY_CHUNK} from '../src/engine/rootsNativeDensityGpu';

function config(){const c=defaultRootsPresentationConfiguration();c.camera.phi=0;c.transform.scale=[1,1,1];return c;}
function plan(c=config(),width=7,height=5){return prepareRootsProjection(c,{width,height,viewport:{logicalWidth:width,logicalHeight:height,referenceLogicalHeight:5,target:'primary'}});}
function color(brightness=1){
 const c=prepareRootsDensityColor({settings:{rootDensityColorVersion:'mathart-1.7.8-metric-v1',rootSourceBrightness:brightness,rootSourceGamma:1,background:'#000000'},rootsSourcePalette:{colors:['#FFFFFF']}});
 if(c.kind!=='metric-sum')throw Error('Expected source metric color');return c;
}
const one=()=>new Float32Array([1,2,0,.5]);
beforeEach(()=>{Object.assign(observed,{readbacks:0,initializations:0,clears:0,disposals:0,disposeFailures:0,flushFailure:undefined,readbackFailure:undefined,invalidInk:false,flushes:[],points:[]});});

describe('native density advance and presentation ownership',()=>{
 it('preserves every intermediate clear and anchor observation while reading only the final frame',()=>{
  const deferred=new RootsNativeDensityDisplay(),immediate=new RootsNativeDensityDisplay(),c=config();
  const frames=[{plan:plan(c),points:one()}];
  c.camera.theta=.3;frames.push({plan:plan(c),points:new Float32Array()});
  c.transform.offset=[9,0,0];frames.push({plan:plan(c),points:new Float32Array()});
  frames.push({plan:plan(c),points:one()});
  frames.push({plan:plan(c,9,7),points:new Float32Array()});
  frames.push({plan:plan(c,9,7),points:one()});
  const facts=frames.map(f=>deferred.advanceBatches(f.plan,[f.points],color()));
  expect(observed.readbacks).toBe(0);expect(deferred.diagnostics().renders).toBe(6);
  expect(facts.map(f=>f.submittedFinitePointCount)).toEqual([1,1,0,1,0,1]);
  expect(facts.map(f=>f.capture)).toEqual([true,false,false,false,false,false]);
  expect(facts[2].clearReasons).toEqual(['transform']);expect(facts[4].clearReasons).toEqual(['physical-size']);
  expect(facts[5]).toMatchObject({newInputPoints:1,consumedInputPoints:3,physicalSize:[9,7],matrixReferenceViewport:{physicalWidth:7,physicalHeight:5},displayRotation:Math.fround(.3)});
  expect(facts[5]).not.toHaveProperty('toneBackend');
  const result=deferred.present(color());expect(observed.readbacks).toBe(1);
  let expected:ReturnType<RootsNativeDensityDisplay['render']>|undefined;
  for(const frame of frames)expected=immediate.render(frame.plan,frame.points,color());
  expect(result).toEqual(expected);expect(deferred.diagnostics().renders).toBe(6);
  deferred.dispose();immediate.dispose();
 });

 it('commits camera capture on an unpresented frame and never reads to advance',()=>{
  const owner=new RootsNativeDensityDisplay(),c=config();owner.advanceBatches(plan(c),[one()],color());
  c.camera.zoom=1.2;const captured=owner.advanceBatches(plan(c),[],color());
  expect(captured).toMatchObject({capture:true,clearInk:true,submittedFinitePointCount:0});
  c.camera.theta=.4;const current=owner.advanceBatches(plan(c),[one()],color());
  expect(current).toMatchObject({capture:false,clearInk:false,submittedFinitePointCount:1,displayRotation:Math.fround(.4)});
  expect(observed.readbacks).toBe(0);expect(owner.present(color()).facts).toMatchObject(current);owner.dispose();
 });

 it('allows repeated presentation and new tone without changing the committed frame or borrowing output pixels',()=>{
  const owner=new RootsNativeDensityDisplay(),p=plan(),facts=owner.advanceBatches(p,[one()],color());
  const first=owner.present(color()),second=owner.present(color(.1));
  expect(first.pixels).not.toEqual(second.pixels);expect(first.facts).toEqual(second.facts);
  first.pixels.fill(0);first.facts.submittedFinitePointCount=500;
  expect(Reflect.set(facts.physicalSize,'0',999)).toBe(false);
  expect(Reflect.set(facts.matrixReferenceViewport,'physicalWidth',999)).toBe(false);
  const again=owner.present(color(.1));expect(again.pixels).toEqual(second.pixels);expect(again.facts.submittedFinitePointCount).toBe(1);
  expect(observed.points).toHaveLength(1);expect(observed.flushes).toHaveLength(1);expect(observed.readbacks).toBe(3);expect(owner.diagnostics().renders).toBe(1);owner.dispose();
 });

 it('requires a successful advance before presentation, including after reset',()=>{
  const owner=new RootsNativeDensityDisplay();
  expect(()=>owner.present(color())).toThrow(expect.objectContaining({failureKind:'input'}));
  owner.advanceBatches(plan(),[one()],color());owner.reset();
  expect(owner.diagnostics().frameReady).toBe(false);expect(()=>owner.present(color())).toThrow(expect.objectContaining({failureKind:'input'}));expect(observed.readbacks).toBe(0);
 });

 it('consumes reused input immediately, flushes the bounded chunk, and retains no borrowed tuple',()=>{
  const owner=new RootsNativeDensityDisplay(),p=plan(),large=new Float32Array(ROOTS_NATIVE_DENSITY_CHUNK*4);
  for(let i=0;i<large.length;i+=4)large.set([1,2,0,.25],i);
  const tail=one();function* arrivals(){yield large;yield tail;tail.set([3,4,0,.75]);yield tail;}
  const facts=owner.advanceBatches(p,arrivals(),color());large.fill(NaN);tail.fill(NaN);
  expect(observed.flushes.map(f=>f.count)).toEqual([ROOTS_NATIVE_DENSITY_CHUNK,2]);
  expect(observed.points.slice(-2)).toEqual([[1,2,0,.5],[3,4,0,.75]]);
  expect(facts).toMatchObject({newInputPoints:ROOTS_NATIVE_DENSITY_CHUNK+2,submittedFinitePointCount:ROOTS_NATIVE_DENSITY_CHUNK+2});
  expect(observed.readbacks).toBe(0);expect(owner.present(color()).accumulated.totalMass).toBe(ROOTS_NATIVE_DENSITY_CHUNK+2);owner.dispose();
 });

 it.each(['iterator','cancel','input','device','capacity'] as const)('revokes old success after an advance %s failure and recovers with a fresh frame',kind=>{
  const owner=new RootsNativeDensityDisplay(),p=plan();owner.render(p,one(),color());
  const original=new Error('controlled '+kind);
  const fail=()=>{
   if(kind==='iterator'){function* bad(){yield one();throw original;}owner.advanceBatches(p,bad(),color());}
   if(kind==='cancel')owner.advanceBatches(p,[one()],color(),{isCancelled:()=>true});
   if(kind==='input')owner.advanceBatches(p,[new Float32Array(3)],color());
   if(kind==='device'){observed.flushFailure=original;owner.advanceBatches(p,[one()],color());}
   if(kind==='capacity')owner.advanceBatches(plan(config(),16384,2048),[],color());
  };
  if(kind==='iterator'||kind==='device')expect(fail).toThrow(original);else expect(fail).toThrow();
  expect(owner.diagnostics()).toMatchObject({frameReady:false,renders:0,gpu:undefined});
  expect(()=>owner.present(color())).toThrow(expect.objectContaining({failureKind:'input'}));
  observed.flushFailure=undefined;expect(owner.render(p,one(),color()).facts.submittedFinitePointCount).toBe(1);owner.dispose();
 });

 it.each(['readback','tone','cancel','input'] as const)('revokes old success after presentation %s failure',kind=>{
  const owner=new RootsNativeDensityDisplay();owner.advanceBatches(plan(),[one()],color());
  if(kind==='readback')observed.readbackFailure=new Error('controlled readback');
  if(kind==='tone')observed.invalidInk=true;
  const c=kind==='input'?{...color(),gamma:NaN}:color();
  expect(()=>owner.present(c,{isCancelled:kind==='cancel'?()=>true:undefined})).toThrow();
  expect(owner.diagnostics()).toMatchObject({frameReady:false,gpu:undefined});
  expect(()=>owner.present(color())).toThrow(expect.objectContaining({failureKind:'input'}));
 });

 it('retains cleanup ownership and both failures, but never retains a presentable frame',()=>{
  const owner=new RootsNativeDensityDisplay(),p=plan();owner.advanceBatches(p,[one()],color());
  const failure=new Error('readback failed');observed.readbackFailure=failure;observed.disposeFailures=1;
  let caught:unknown;try{owner.present(color());}catch(error){caught=error;}
  expect(caught).toBeInstanceOf(GenerationCleanupError);expect(caught).toMatchObject({cleanupPending:true,errors:expect.arrayContaining([failure])});
  expect(owner.diagnostics().frameReady).toBe(false);expect(owner.diagnostics().gpu?.handles).toBe(1);
  observed.readbackFailure=undefined;owner.advanceBatches(p,[one()],color());
  (caught as GenerationCleanupError).retryCleanup();expect(owner.present(color()).facts.submittedFinitePointCount).toBe(1);owner.dispose();
 });
});
