import {afterEach,describe,it,expect,vi} from 'vitest';
import {createScene} from '../src/engine/document';
import {definitions} from '../src/scenes/complex';
import {generateScene,TemporalGenerationSession} from '../src/engine/temporal';
import {RootsDensitySession,generateRootsDensity} from '../src/scenes/rootsDensity';
import {ROOTS_DENSITY_COLOR_VERSION,prepareRootsDensityColor,toneRootsMetricRgbaPrepared} from '../src/engine/rootsDensityColor';
import {projectRootsMetricPoints,depositRootMetric,type RootsInk} from '../src/engine/rootsInk';
import {RootsDensityGpu,RootsGpuError} from '../src/engine/rootsDensityGpu';
import {defaultRootParameter,withRootParameters} from '../src/engine/rootParameters';
import {prepareRootGeneration} from '../src/engine/rootsSampling';
import {GenerationCleanupError} from '../src/engine/generationCleanup';
import {createAnimationTrack,sceneAtTime} from '../src/engine/timeline';
import type {SceneDocument,SceneOutput,Settings} from '../src/types';
const context={time:0,quality:'export' as const,width:8,height:8};
const pixel={kind:'pixel' as const,diameter:3},bounds={minX:-1,maxX:1,minY:-1,maxY:1};
function scene(settings:Settings={}):SceneDocument{
 const s=createScene(definitions.find(d=>d.kind==='roots')!);s.equations.polynomial='z';
 Object.assign(s.settings,{rootsMode:'progressive',rootDensityColorVersion:ROOTS_DENSITY_COLOR_VERSION,rootColor:'t2_real',rootTotalSamples:10,rootSamplesPerFrame:1,rootSamplingFps:10,rootBatchSize:1,domain2:'FIXED',fixed2Real:.5,fixed2Imag:.25,densityView:'manual',densityCenterX:0,densityCenterY:0,densitySpan:2,rootSourceGamma:1,rootSourceBrightness:1,background:'#000000'},settings);
 s.rootsSourcePalette={colors:['#ff0000','#00ff00','#ff0000']};return s;
}
function raster(output:SceneOutput){if(output.type!=='raster')throw new Error('expected raster');return output;}
function render(s:SceneDocument,time=0,owner?:RootsDensitySession){return raster(generateRootsDensity(s,{...context,time},owner));}
function center(output:ReturnType<typeof raster>){const at=(4*8+4)*4;return Array.from(output.pixels.slice(at,at+4));}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('source Roots admission before either backend',()=>{
 it('counts finite submitted XYZ before clipping, excludes hidden axes and F32 overflow, and clamps metric infinities',()=>{
  const points=new Float64Array([0,0,0,.5, 3,0,0,.25, 0,0,Infinity,NaN, 0,0,1e100,NaN, 0,0,0,Infinity, 0,0,0,-Infinity]);
  const visits:number[][]=[];
  expect(projectRootsMetricPoints(points,6,8,8,bounds,'xy',pixel,(...p)=>visits.push(p))).toEqual({accepted:3,clipped:1,invalid:2,submittedFinitePointCount:4});
  expect(visits).toEqual([[4.5,4.5,.5],[4.5,4.5,1],[4.5,4.5,0]]);
  expect(()=>projectRootsMetricPoints(new Float64Array([0,0,0,NaN]),1,8,8,bounds,'xy',pixel,()=>{})).toThrow('NaN');
  // Offscreen valid points are still submitted and cannot hide a poisoned metric.
  expect(()=>projectRootsMetricPoints(new Float64Array([3,0,0,NaN]),1,8,8,bounds,'xy',pixel,()=>{})).toThrow('NaN');
 });
 it('deposits mass and weighted scalar sums before a nonlinear palette lookup',()=>{
  const ink:Extract<RootsInk,{kind:'metric-sum'}>={kind:'metric-sum',values:new Float64Array(4)};
  depositRootMetric(ink,1,1,.5,.5,0,pixel);depositRootMetric(ink,1,1,.5,.5,1,pixel);
  expect(Array.from(ink.values)).toEqual([2,1,0,0]);
  const plan=prepareRootsDensityColor(scene());if(plan.kind!=='metric-sum')throw new Error('metric plan');
  const output=toneRootsMetricRgbaPrepared(1,1,ink.values,plan,{submittedFinitePointCount:2});
  expect(output[1]).toBeGreaterThan(180);expect(output[0]).toBeLessThan(2);expect(output[2]).toBe(0);expect(output[3]).toBe(255);
 });
 it('uses raw radius and fixed t2 regardless of the local display selector, including absent t2',()=>{
  const s=scene({rootDisplayParameter:'missing'}),source=prepareRootGeneration(s,{kind:'metric-sum',metric:'t2_real'});
  expect(source.metric([0,0],{t2:[.5,.25],missing:[1,1]})).toBe(.5);expect(source.metric([0,0],{})).toBe(0);
  expect(prepareRootGeneration(s,{kind:'metric-sum',metric:'radius'}).metric([1,0],{})).toBe(1);
  expect(()=>prepareRootGeneration(s)).toThrow('采样参数不存在');
  const p=defaultRootParameter('q','FIXED');p.value=[.75,.75];s.settings=withRootParameters(s.settings,[p]);
  expect(center(render(s))).toEqual([191,1,0,255]);
 });
});

describe('source Roots public generation and retained ink',()=>{
 it('keeps the raw fixed metric through the solver and produces the nonlinear middle color',()=>{
  const s=scene(),out=render(s);
  // Center LUT is [1,254,0]; mass=1 yields smoothLimit(1,1)=.75.
  // The reference rounds 254*.75=190.5 upward to 191.
  expect(center(out)).toEqual([1,191,0,255]);
  expect(out.rootsColor).toMatchObject({version:ROOTS_DENSITY_COLOR_VERSION,inkKind:'metric-sum',metric:'t2_real',submittedFinitePointCount:1,exposureScale:1,accumulationPrecision:'float64',toneBackend:'cpu'});
  const radius=scene({rootColor:'radius'});radius.equations.polynomial='z-0.5';
  expect(render(radius).pixels).toContain(191);
  const legacy={...s,settings:{...s.settings,rootDensityColorVersion:'local-rgb-v1'}};
  expect(render(legacy).rootsColor).toBeUndefined();expect(render(legacy).pixels).not.toEqual(out.pixels);
 });
 it('uses all submitted points for exposure even when every root is outside the viewport',()=>{
  const s=scene({rootTotalSamples:512,rootSamplesPerFrame:512});s.equations.polynomial='z-3';const out=render(s);
  expect(out.rootsColor).toMatchObject({submittedFinitePointCount:512,exposureScale:2});
  expect(out.density).toMatchObject({inputPoints:512,examined:512,accepted:0,clipped:512,invalid:0,occupiedPixels:0});
  expect(Array.from(out.pixels).every((v,i)=>v===(i%4===3?255:0))).toBe(true);
 });
 it('excludes hidden depth overflow from N while preserving the complete attempted sample facts',()=>{
  const s=scene({rootRender:'DEPTH',fixed2Imag:1e40});const out=render(s);
  expect(out.rootsColor?.submittedFinitePointCount).toBe(0);expect(out.density).toMatchObject({inputPoints:1,accepted:0,invalid:1});expect(out.roots?.attemptedSamples).toBe(1);
 });
 it('warms without duplicate counts, deterministically replays backseek, and leaves transferred output independent',()=>{
  const s=scene(),owner=new RootsDensitySession();render(s,0,owner);const warm=render(s,.4,owner),repeat=render(s,.4,owner);
  expect(warm.rootsColor?.submittedFinitePointCount).toBe(5);expect(repeat.rootsColor).toEqual(warm.rootsColor);expect(repeat.temporal?.cacheHits).toBe(1);
  expect(warm.pixels).toEqual(render(s,.4).pixels);expect(render(s,.1,owner).pixels).toEqual(render(s,.1).pixels);
  structuredClone(warm,{transfer:[warm.pixels.buffer]});expect(render(s,.4,owner).pixels).toEqual(repeat.pixels);
  owner.reset();expect(owner.diagnostics().retainedBytes).toBe(0);expect(owner.diagnostics().submittedFinitePointCount).toBe(0);
 });
 it('recolors retained ink for palette/tone/offset/background edits while geometry, metric and dimensions replay',()=>{
  const s=scene(),owner=new RootsDensitySession(),original=render(s,.4,owner);
  const changes:SceneDocument[]=[{...s,rootsSourcePalette:{colors:['#ffffff']}},{...s,settings:{...s.settings,rootSourceBrightness:.5}},{...s,settings:{...s.settings,rootSourcePaletteOffset:.3}},{...s,settings:{...s.settings,background:'#123456'}}];
  for(const changed of changes){const out=render(changed,.4,owner);expect(out.temporal?.cacheHits).toBe(1);expect(out.roots).toEqual(original.roots);expect(out.rootsColor?.submittedFinitePointCount).toBe(5);expect(out.pixels).toEqual(render(changed,.4).pixels);expect(out.pixels).not.toEqual(original.pixels);}
  for(const changed of [{...s,equations:{polynomial:'z-.2'}},{...s,settings:{...s.settings,rootColor:'t2_imag'}},{...s,settings:{...s.settings,rootSplat:'soft-disc'}}])expect(render(changed,.4,owner).temporal?.cacheHits).toBe(0);
  expect(raster(owner.generate(s,{...context,width:16,time:.4})).rootsColor?.submittedFinitePointCount).toBe(5);
  expect(owner.diagnostics().cacheHits).toBe(0);
 });
 it('does not validate or consume inactive generic tone and rich palette controls in source mode',()=>{
  const s=scene(),before=render(s),changed={...s,settings:{...s.settings,gamma:0,brightness:1e300,toneMap:'not-a-mode'},palette:{...s.palette,stops:[]}};
  expect(render(changed).pixels).toEqual(before.pixels);
  expect(()=>render({...changed,settings:{...changed.settings,rootDensityColorVersion:'local-rgb-v1'}})).toThrow();
 });
 it('replays edits to presentation-only timeline clips because they participate in scheduling',()=>{
  const s=scene(),owner=new RootsDensitySession();render(s,.4,owner);
  const edited=structuredClone(s);edited.timeline.tracks.push({id:'wait',type:'wait',target:'timeline.wait',from:0,to:0,easing:'linear',pingPong:false,start:0,duration:1,enabled:true});
  const out=render(edited,.4,owner);expect(out.temporal?.cacheHits).toBe(0);expect(out.pixels).toEqual(render(edited,.4).pixels);expect(out.warnings?.join()).toContain('时间线');
 });
 it('retains inactive local gradient timing without evaluating its palette and owns copied source colors',()=>{
  const s=scene(),track=createAnimationTrack(s,'animate');expect(track.actions?.[0].method).toBe('paramStart');
  track.actions=[{id:'old-gradient',method:'gradientStart',enabled:true,gradient:{mode:'palette_morph',speed:.1,interpolation:'rgb',fromStops:[],toStops:[]}}];
  s.timeline.tracks=[track];s.palette.stops=[];const before=render(s,.4);expect(before.rootsColor?.submittedFinitePointCount).toBe(5);
  const copied=sceneAtTime(s,.4);copied.rootsSourcePalette!.colors[0]='#ffffff';expect(s.rootsSourcePalette!.colors[0]).toBe('#ff0000');
  const edited={...s,rootsSourcePalette:{colors:['#ffffff']}};expect(render(edited,.4).pixels).not.toEqual(before.pixels);
 });
 it('keeps source tag dormant for single geometry and clears a persistent progressive owner when switching modes',()=>{
  const s=scene(),owner=new TemporalGenerationSession();const out=raster(generateScene(s,context,owner));expect(out.rootsColor).toBeDefined();
  const single={...s,settings:{...s.settings,rootsMode:'single',sampleCount:4}};
  const a=generateScene(single,context,owner),b=generateScene({...single,settings:{...single.settings,rootDensityColorVersion:'local-rgb-v1'}},context);
  expect(a.type).toBe('geometry');if(a.type!=='geometry'||b.type!=='geometry')throw new Error('geometry');expect(a.positions).toEqual(b.positions);expect(a.colors).toEqual(b.colors);expect(owner.diagnostics().roots.retainedBytes).toBe(0);
 });
 it('clears partial sampling after cancellation and recovers to a cold reference',()=>{
  const s=scene(),owner=new RootsDensitySession();render(s,0,owner);let checks=0;
  expect(()=>owner.generate(s,{...context,time:.4,isCancelled:()=>++checks>5})).toThrow();expect(owner.diagnostics().retainedBytes).toBe(0);
  expect(render(s,.4,owner).pixels).toEqual(render(s,.4).pixels);
 });
});

describe('source Roots GPU failure boundaries in the public session',()=>{
 it('replays device failures once per document/backend/version and scopes retries to a different document',()=>{
  const initialize=vi.spyOn(RootsDensityGpu.prototype,'initialize').mockImplementation(()=>{throw new RootsGpuError('unavailable test device','device');});
  const s=scene({rootDensityBackend:'webgl2'}),owner=new RootsDensitySession(),out=render(s,.4,owner);
  expect(out.backend).toBe('cpu');expect(out.rootsColor).toMatchObject({submittedFinitePointCount:5,accumulationPrecision:'float64',toneBackend:'cpu'});
  expect(out.pixels).toEqual(render({...s,settings:{...s.settings,rootDensityBackend:'cpu'}},.4).pixels);
  render(s,.4,owner);expect(initialize).toHaveBeenCalledTimes(1);render({...s,id:'new-document'},.4,owner);expect(initialize).toHaveBeenCalledTimes(2);
 });
 it.each(['input','capacity','cleanup'] as const)('does not turn %s failure into CPU success',kind=>{
  const error=new RootsGpuError('failed '+kind,kind);vi.spyOn(RootsDensityGpu.prototype,'initialize').mockImplementation(()=>{throw error;});
  const owner=new RootsDensitySession();expect(()=>render(scene({rootDensityBackend:'webgl2'}),0,owner)).toThrow(error);expect(owner.diagnostics().retainedBytes).toBe(0);
 });
 it.each(['roots','temporal'] as const)('retains failed cleanup ownership and prevents an old %s error clearing recovered work',route=>{
  const operation=new RootsGpuError('controlled device failure','device'),cleanup=new Error('controlled cleanup failure');let failing=true;
  vi.spyOn(RootsDensityGpu.prototype,'initialize').mockImplementation(()=>{throw operation;});
  vi.spyOn(RootsDensityGpu.prototype,'reset').mockImplementation(()=>{if(failing)throw cleanup;});
  const owner=route==='roots'?new RootsDensitySession():new TemporalGenerationSession();
  const run=(s:SceneDocument)=>route==='roots'?render(s,.4,owner as RootsDensitySession):raster(generateScene(s,{...context,time:.4},owner as TemporalGenerationSession));
  let failure:unknown;try{run(scene({rootDensityBackend:'webgl2'}));}catch(e){failure=e;}
  expect(failure).toBeInstanceOf(GenerationCleanupError);const retained=failure as GenerationCleanupError;
  const causes=(e:unknown):unknown[]=>e instanceof AggregateError?[e,...e.errors.flatMap(causes)]:[e];
  expect(causes(retained)).toContain(operation);expect(causes(retained)).toContain(cleanup);expect(retained.cleanupPending).toBe(true);
  failing=false;const s=scene(),recovered=run(s),before=owner.diagnostics();expect(retained.cleanupPending).toBe(false);
  retained.retryCleanup();expect(owner.diagnostics()).toEqual(before);expect(run(s).pixels).toEqual(recovered.pixels);owner.reset();
 });
 it.each(['roots','temporal'] as const)('exposes a retryable cleanup ticket after a one-shot %s failure',route=>{
  let failing=true;vi.spyOn(RootsDensityGpu.prototype,'initialize').mockImplementation(()=>{throw new RootsGpuError('controlled device failure');});
  vi.spyOn(RootsDensityGpu.prototype,'reset').mockImplementation(()=>{if(failing)throw new Error('controlled cleanup failure');});
  let failure:unknown;try{const s=scene({rootDensityBackend:'webgl2'});if(route==='roots')render(s);else generateScene(s,context);}catch(e){failure=e;}
  expect(failure).toBeInstanceOf(GenerationCleanupError);const retained=failure as GenerationCleanupError;expect(retained.cleanupPending).toBe(true);
  failing=false;retained.retryCleanup();expect(retained.cleanupPending).toBe(false);expect(()=>retained.retryCleanup()).not.toThrow();
 });
});
