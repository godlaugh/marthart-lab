import {describe,it,expect,vi} from 'vitest';
import {createScene,parseScene} from '../src/engine/document';
import {definitions} from '../src/scenes/complex';
import {compilePolynomial,polynomialRelativeResidual,solvePolynomial} from '../src/engine/polynomial';
import {prepareRootGeneration} from '../src/engine/rootsSampling';
import {RootsDensitySession,generateRootsDensity,rootsSchedule,rootsCompletionTime,rootsUniform,visibleRootsControls,rootsControlSettings} from '../src/scenes/rootsDensity';
import {generateScene,TemporalGenerationSession} from '../src/engine/temporal';
import {parseLegacyScene} from '../src/engine/legacyImport';
import type {SceneDocument,SceneOutput,Settings} from '../src/types';
const def=definitions.find(x=>x.kind==='roots')!,context={time:0,quality:'export' as const,width:48,height:32};
function scene(patch:Settings={}):SceneDocument{const s=createScene(def);s.equations.polynomial='z-t1';Object.assign(s.settings,{rootsMode:'progressive',rootTotalSamples:100,rootSamplesPerFrame:10,rootSamplingFps:10,rootBatchSize:13,paletteMode:'source'},patch);return s;}
function raster(o:SceneOutput){if(o.type!=='raster')throw new Error('raster');return o;}
const at=(s:SceneDocument,time:number,owner?:RootsDensitySession)=>raster(generateRootsDensity(s,{...context,time},owner));

describe('finite progressive polynomial ensemble',()=>{
 it('uses fresh deterministic coefficient samples each fixed step and stops at the exact finite total',()=>{
  const s=scene({rootTotalSamples:23}),owner=new RootsDensitySession();const a=at(s,0,owner),b=at(s,.1,owner),c=at(s,.2,owner),d=at(s,300,owner);
  expect(a.roots).toMatchObject({totalSamples:23,attemptedSamples:10,acceptedPolynomials:10,rootPoints:10,complete:false});expect(b.roots?.rootPoints).toBe(20);expect(b.pixels).not.toEqual(a.pixels);expect(c.roots).toMatchObject({attemptedSamples:23,rootPoints:23,complete:true});expect(c.density?.accepted).toBe(23);expect(d.pixels).toEqual(c.pixels);expect(d.roots).toEqual(c.roots);expect(d.temporal?.frames).toBe(3);
 });
 it('production route preserves cold/warm/backseek, priority over generic density windows and transfer ownership',()=>{
  const s=scene({densityAccumulation:'window',densityLifetime:4}),owner=new TemporalGenerationSession(),render=(time:number,session?:TemporalGenerationSession)=>raster(generateScene(s,{...context,time},session));
  render(0,owner);render(.1,owner);const warm=render(.4,owner),repeat=render(.4,owner),cold=render(.4),back=render(.1,owner);
  expect(warm.pixels).toEqual(cold.pixels);expect(warm.roots).toEqual(cold.roots);expect(warm.roots?.attemptedSamples).toBe(50);expect(repeat.pixels).toEqual(warm.pixels);expect(repeat.temporal?.cacheHits).toBe(1);expect(back.pixels).toEqual(render(.1).pixels);
  structuredClone(warm,{transfer:[warm.pixels.buffer]});expect(render(.4,owner).pixels).toEqual(cold.pixels);
  const tone={...s,settings:{...s.settings,exposure:2}};expect(raster(generateScene(tone,{...context,time:.4},owner)).temporal?.cacheHits).toBe(1);
  const single={...s,settings:{...s.settings,rootsMode:'single',densityAccumulation:'frame',sampleCount:10}};generateScene(single,context,owner);expect(owner.diagnostics().roots.retainedBytes).toBe(0);render(.2,owner);const domain=createScene(definitions.find(d=>d.kind==='domain')!);generateScene(domain,context,owner);expect(owner.diagnostics().roots.retainedBytes).toBe(0);
  render(.2,owner);expect(()=>generateScene(s,{...context,time:.3,isCancelled:()=>true},owner)).toThrow();expect(owner.diagnostics().roots.retainedBytes).toBe(0);
 });
 it('root-point chunk threshold never changes polynomial samples, accepted roots, fit or output',()=>{
  const s=scene({rootTotalSamples:63,rootSamplesPerFrame:21});s.equations.polynomial='z^8+t1*z^3+t2';
  const a=at(s,.2);for(const rootBatchSize of [1,7,256,32256]){const b=at({...s,settings:{...s.settings,rootBatchSize}},.2);expect(b.pixels).toEqual(a.pixels);expect(b.roots).toEqual(a.roots);expect(b.density?.bounds).toEqual(a.density?.bounds);}
 });
 it('tone changes reuse ink; scene edits and dimensions invalidate the owned state',()=>{
  const s=scene(),owner=new RootsDensitySession();const a=at(s,.2,owner),changed={...s,settings:{...s.settings,exposure:3}},b=at(changed,.2,owner);
  expect(b.temporal?.cacheHits).toBe(1);expect(b.roots).toEqual(a.roots);expect(b.pixels).not.toEqual(a.pixels);expect(b.pixels).toEqual(at(changed,.2).pixels);
  const edited={...s,equations:{...s.equations,polynomial:'z-2*t1'}};expect(at(edited,.2,owner).temporal?.cacheHits).toBe(0);const resized=raster(owner.generate(edited,{...context,time:.2,width:64}));expect(resized.temporal?.cacheHits).toBe(0);expect(resized.width).toBe(64);
 });
 it('filters sampled parameter imaginary part before solving, separately from a root upper-half filter',()=>{
  const s=scene({rootSampleFilter:'parameter-imag-nonnegative',rootFilterParameter:'t1',rootTotalSamples:100,rootSamplesPerFrame:100});s.equations.polynomial='z+i';const o=at(s,0);
  let accepted=0;for(let i=0;i<100;i++)if(Math.sin(rootsUniform(42,i,0)*2*Math.PI)>=0)accepted++;
  expect(o.roots).toMatchObject({attemptedSamples:100,acceptedPolynomials:accepted,filteredSamples:100-accepted,rootPoints:accepted,solverWork:accepted*2,complete:true});expect(o.density!.bounds.maxY).toBeLessThan(0);
 });
 it('waits for first nonempty accepted frame before fitting and preserves null residual until accepted roots exist',()=>{
  const s=scene();s.equations.polynomial='time*(z-100)';const owner=new RootsDensitySession(),empty=at(s,0,owner);expect(empty.roots).toMatchObject({invalidSamples:10,rootPoints:0,maxResidual:null});const next=at(s,.1,owner);expect(next.density!.bounds.minX).toBeGreaterThan(99);expect(next.density!.accepted).toBe(10);expect(next.pixels).toEqual(at(s,.1).pixels);
 });
 it('counts nonconvergence and invalid coefficients without plotting their approximate roots',()=>{
  const s=scene({rootIterations:1,rootSamplesPerFrame:4});s.equations.polynomial='z^12+z-1';const no=at(s,0);expect(no.roots).toMatchObject({attemptedSamples:4,nonconvergentSamples:4,rootPoints:0,maxResidual:null,solverIterations:4});expect(no.density!.occupiedPixels).toBe(0);
  s.equations.polynomial='z+1/0';expect(at(s,0).roots).toMatchObject({invalidSamples:4,nonconvergentSamples:0,rootPoints:0});
  s.equations.polynomial='7';expect(at(s,0).roots).toMatchObject({acceptedPolynomials:4,rootPoints:0,maxResidual:null});
 });
 it('handles Replay before its start, cancellation, cleanup, retained bytes and resource limits',()=>{
  const s=scene({rootStartTime:1}),owner=new RootsDensitySession();expect(at(s,0,owner).roots?.attemptedSamples).toBe(0);expect(at(s,1,owner).roots?.attemptedSamples).toBe(10);let checks=0;expect(()=>owner.generate(s,{...context,time:1.2,isCancelled:()=>++checks>3})).toThrow();expect(owner.diagnostics().retainedBytes).toBe(0);expect(at(s,1.2,owner).pixels).toEqual(at(s,1.2).pixels);expect(owner.diagnostics().retainedBytes).toBeLessThan(context.width*context.height*32+10000);owner.reset();expect(owner.diagnostics().attemptedSamples).toBe(0);
  expect(()=>generateRootsDensity(scene(),{...context,width:16384,height:1536})).toThrow('768');
  expect(()=>generateRootsDensity(scene({rootTotalSamples:47550000,rootSamplesPerFrame:100000}),{...context,quality:'preview',time:3})).toThrow('200 万');
 });
 it('reports lightweight completed sample facts against the requested time, not the whole ensemble',()=>{
  const s=scene({rootTotalSamples:100}),statuses:unknown[]=[];let clock=0;const spy=vi.spyOn(performance,'now').mockImplementation(()=>clock+=300);
  try{const o=raster(generateRootsDensity(s,{...context,time:.3,onStatus:status=>statuses.push(status)}));expect(statuses[0]).toEqual({kind:'roots',attemptedSamples:0,targetSamples:40,totalSamples:100});expect(statuses.at(-1)).toEqual({kind:'roots',attemptedSamples:40,targetSamples:40,totalSamples:100});expect(statuses.length).toBeGreaterThan(2);for(const status of statuses)expect(Object.keys(status as object).sort()).toEqual(['attemptedSamples','kind','targetSamples','totalSamples']);expect(o.roots?.complete).toBe(false);}finally{spy.mockRestore();}
 });
 it('preserves the full source-scale total without allocating or pretending to complete it',()=>{
  const s=scene({rootTotalSamples:47550000,rootSamplesPerFrame:16}),o=at(s,0);expect(o.roots).toMatchObject({totalSamples:47550000,attemptedSamples:16,complete:false});expect(parseScene(JSON.stringify(s)).settings.rootTotalSamples).toBe(47550000);
 });
 it('retains transformed 3D source coordinates before explicit xz projection',()=>{
  const s=scene({domain1:'FIXED',fixed1Real:2,fixed1Imag:0,domain2:'FIXED',fixed2Imag:3,rootRender:'DEPTH',depthScale:4,rootScale:2,rootScaleY:3,rootOffsetX:5,rootOffsetY:7,rootOffsetZ:9,rotation:Math.PI/2,densityProjection:'xz'}),o=at(s,0);
  expect(o.density!.bounds.minX+o.density!.bounds.maxX).toBeCloseTo(10);expect(o.density!.bounds.minY+o.density!.bounds.maxY).toBeCloseTo(42);expect(o.density!.projection).toBe('xz');
 });
});

describe('root boundary parsing, sampling and controls',()=>{
 it('validates addressed randomness and schedule without clamping caller values',()=>{
  expect(rootsCompletionTime({rootTotalSamples:23,rootSamplesPerFrame:10,rootSamplingFps:10,rootStartTime:1})).toBe(1.2);expect(rootsCompletionTime({rootTotalSamples:47550000})).toBeCloseTo(12382.8);
  expect(rootsUniform(0,0,0)).toBe(rootsUniform(0,0,0));expect(new Set(Array.from({length:1000},(_,i)=>rootsUniform(9,i,0))).size).toBe(1000);expect(rootsUniform(9,2,1)).not.toBe(rootsUniform(9,2,2));
  for(const a of [[-1,0,0],[0,-1,0],[0,0,513],[Infinity,0,0],[0,1.5,0]])expect(()=>rootsUniform(...a as [number,number,number])).toThrow();
  for(const p of [{rootTotalSamples:0},{rootTotalSamples:2147483648},{rootSamplesPerFrame:1.5},{rootSamplingFps:0},{rootStartTime:NaN},{rootBatchSize:0}] as Settings[])expect(()=>rootsSchedule(p)).toThrow();
 });
 it('uses the shared parsed model for arbitrary independent names and rejects unknown filters/parameters',()=>{
  const s=scene({rootSampleFilter:'parameter-imag-nonnegative',rootFilterParameter:'missing'});expect(()=>prepareRootGeneration(s)).toThrow('不存在');s.settings.rootSampleFilter='nonsense';expect(()=>prepareRootGeneration(s)).toThrow('不支持');
  expect(rootsControlSettings({rootScale:3}).rootScaleY).toBe(3);expect(rootsControlSettings({rootScale:3,rootScaleY:2}).rootScaleY).toBe(2);expect(rootsControlSettings({}).rootOffsetX).toBe(0);
  for(const key of ['sampleCount','densitySampleRate','densityDecay','densityLifetime'])expect(visibleRootsControls(def.controls,scene().settings).map(c=>c.key)).not.toContain(key);expect(visibleRootsControls(def.controls,{rootsMode:'single'}).map(c=>c.key)).not.toContain('rootTotalSamples');expect(visibleRootsControls(def.controls,{rootSampleFilter:'all'}).map(c=>c.key)).not.toContain('rootFilterParameter');
 });
 it('imports the full source schedule and canonical spatial transform without silent total clipping',()=>{
  const raw={config_version:'1.0.0',type:'COMPLEX_ROOTS',name:'finite',polynomial:{variable:'z',coefficients:{1:'1',0:'-t2'}},root_parameters:{t2:{domain:'UNIT_CIRCLE'}},sampling:{sample_count:47550000,batch_size:32256,filter:'im(t2) >= 0',seed:0},settings:{render_mode:'GPU_DENSITY',rotation:90,scale_x:2,scale_y:3,offset_x:5}};
  const imported=parseLegacyScene(JSON.stringify(raw));expect(imported.scene.settings.rootsMode).toBe('progressive');
  expect(imported.scene.rootsPresentation).toMatchObject({model:'mathart-1.7.8-v1',mode:'density',transform:{scale:[2,3,35],offset:[5,0,0],rotationDegrees:90}});
  const dormant=createScene(def).settings;for(const key of ['rootScale','rootScaleY','rootOffsetX','rotation'])expect(imported.scene.settings[key]).toEqual(dormant[key]);
  expect(imported.scene.rootsMath?.sampling).toMatchObject({sampleCount:47550000,batchSize:32256,filter:'im(t2) >= 0',seed:'0'});expect(imported.warnings.join()).not.toContain('转换为 100000');expect(imported.source).toEqual(raw);
  // Parsing the complete native schedule proves the requested total survives;
  // a single GPU frame would not demonstrate completion of 47,550,000 samples.
  expect(rootsSchedule(imported.scene.settings,imported.scene.rootsMath)).toMatchObject({total:47550000,batch:32256,seed:'0'});
  const reloaded=parseScene(JSON.stringify(imported.scene));expect(rootsSchedule(reloaded.settings,reloaded.rootsMath).total).toBe(47550000);expect(reloaded.rootsPresentation).toEqual(imported.scene.rootsPresentation);
 });
});

describe('independent root acceptance and real solver work',()=>{
 it('does not certify overflow as zero residual and is invariant to coefficient magnitude',()=>{
  expect(polynomialRelativeResidual([[1e308,0],[1e308,0]],[2,0])).toBeCloseTo(1);expect(polynomialRelativeResidual([[1e308,0],[1e308,0]],[-1,0])).toBe(0);
  expect(polynomialRelativeResidual([[1,0],[1,0]],[1e308,0])).toBeCloseTo(1);expect(polynomialRelativeResidual([[1,0],[0,0],[0,0]],[1e308,0])).toBe(1);expect(polynomialRelativeResidual([[0,0]],[0,0])).toBe(Infinity);
  for(const factor of [1e-250,1,1e250])expect(polynomialRelativeResidual([[-factor,0],[0,0],[factor,0]],[1.001,0])).toBeCloseTo(.000999500000249688,12);
 });
 it('reduces exact powers algebraically and validates all lifted roots against the original polynomial',()=>{
  const coefficients=compilePolynomial('z^48-1')({}),r=solvePolynomial(coefficients,1,1e-12);expect(r.converged).toBe(true);expect(r.roots).toHaveLength(48);expect(r.iterations).toBe(0);
  for(let i=0;i<48;i++){const x=Math.cos(i*2*Math.PI/48),y=Math.sin(i*2*Math.PI/48);expect(Math.min(...r.roots.map(z=>Math.hypot(z[0]-x,z[1]-y)))).toBeLessThan(1e-13);}expect(r.residual).toBeLessThan(1e-12);
  expect(solvePolynomial(compilePolynomial('z^3*(z^8-1)')({})).roots).toHaveLength(11);
 });
 it('reports operations actually performed and propagates cancellation/work budget errors',()=>{
  const p=compilePolynomial('z^6+z-1')({}),calls:number[]=[];const r=solvePolynomial(p,1000,1e-10,.123,{onWork:n=>calls.push(n)});expect(r.converged).toBe(true);expect(r.work).toBe(calls.reduce((a,b)=>a+b,0));expect(r.work).toBe(r.iterations*6*19);expect(r.iterations).toBeLessThan(1000);
  expect(()=>solvePolynomial(p,1000,1e-10,.123,{isCancelled:()=>true})).toThrow();const budget=new Error('budget');expect(()=>solvePolynomial(p,1000,1e-10,.123,{onWork:()=>{throw budget}})).toThrow(budget);
 });
});
