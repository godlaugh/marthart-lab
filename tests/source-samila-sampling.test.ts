import {describe,it,expect,vi} from 'vitest';
import {SourceSamilaSamplingSession,SOURCE_SAMILA_SEED_TAPE_BYTES,SOURCE_SAMILA_SAMPLING_MODEL,prepareSourceSamilaSamplingBatch,sourceSamilaPcgHash,sourceSamilaSample} from '../src/engine/sourceSamilaSampling';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {initializeSamilaCamera} from '../src/engine/samilaCamera';
import {IteratedDensitySession,visibleIteratedControls} from '../src/scenes/iteratedDensity';
import {identity,inputScene} from '../src/engine/iteratedIdentity';
function scene(){const s=createScene(definition('samila'));s.settings=initializeSamilaCamera({...s.settings,samilaSamplingModel:SOURCE_SAMILA_SAMPLING_MODEL,samilaMathModel:'mathart-1.7.8',samilaProjectionModel:'source-ndc-v1',samilaSplatModel:'samila-splat-1.7.8',densityToneModel:'samila-normalized-v2',iteratedBackend:'cpu',batchSize:3,iteratedFps:10,samilaSpotSize:.04,normalizedGamma:1,normalizedDynamicRange:1,recordTrails:false});s.palette={name:'white',mode:'linear',stops:['#ffffff','#ffffff'],cycles:1,offset:0};s.equations={f1:'x+a',f2:'y'};s.parameters={a:0};s.timeline.tracks=[{id:'param',type:'numeric',target:'parameters.a',start:0,duration:1,from:0,to:1,easing:'linear',enabled:true,pingPong:false}];return s;}
const context={width:17,height:13,time:0,quality:'export' as const,samilaPrimaryPixelHeight:1080};
describe('source Samila runtime sampling',()=>{
 it('preserves independent original-shader PCG uint observations',()=>{
  // Fixed JAR a6e1da3a…; original GLSL TF oracle, shader 29eaf827…,
  // seed=0, IDs 0/1. Expected uint words do not come from this implementation.
  expect([sourceSamilaPcgHash(0),sourceSamilaPcgHash(1)]).toEqual([129708002,2831084092]);
  expect(sourceSamilaPcgHash(129708002)).toBe(817759070);expect(sourceSamilaPcgHash(2831084092)).toBe(3911864714);
  expect(sourceSamilaSample(0,0,-1,1)).toEqual([-.9395999908447266,-.6192013025283813]);
  expect(sourceSamilaSample(-1,65536,2,2)).toEqual([2,2]);expect(sourceSamilaSample(-1,65536,-1,1)).toEqual(sourceSamilaSample(0xffffffff,65536,-1,1));
 });
 it('takes one seed per replay frame including sixfold batches, reuses zero seeds, bounds sparse pages and resets ownership',()=>{
  const provider=vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(-1).mockReturnValue(123),owner=new SourceSamilaSamplingSession({nextSeed:provider});
  expect(prepareSourceSamilaSamplingBatch(owner,0,65537,6)).toMatchObject({frameSeed:0,sampleCount:393222,baseBatchSize:65537,replayFrame:0});expect(owner.seed(0)).toBe(0);expect(provider).toHaveBeenCalledTimes(1);
  expect(owner.seed(4096)).toBe(0xffffffff);expect(owner.retainedBytes).toBe(2*4096*5);expect(owner.projectedBytes(4097)).toBe(owner.retainedBytes);
  expect(()=>owner.seed(SOURCE_SAMILA_SEED_TAPE_BYTES/5)).toThrow('10 MiB');expect(provider).toHaveBeenCalledTimes(2);owner.reset();expect(owner.retainedBytes).toBe(0);expect(owner.seed(0)).toBe(123);
  for(const value of [NaN,Infinity,.5,-2147483649,4294967296]){const next=vi.fn(()=>value),bad=new SourceSamilaSamplingSession({nextSeed:next});expect(()=>bad.seed(0)).toThrow('32 位');expect(next).toHaveBeenCalledOnce();expect(bad.retainedBytes).toBe(0);}
 });
 it('replays actual CPU frames with one entropy draw, continuous compensation counts, and dormant config seeds/record toggle',()=>{
  const s=scene(),provider=vi.fn(()=>42),owner=new IteratedDensitySession({samilaSeedProvider:provider});
  try{const zero=owner.generate(s,context);expect(zero.type==='raster'&&zero.samilaSampling).toMatchObject({frameSeed:42,replayFrame:0,sampleCount:3,seedSource:'injected'});
   owner.generate(s,{...context,time:.1});expect(provider).toHaveBeenCalledTimes(2);expect(owner.diagnostics()).toMatchObject({lastFramePasses:6,lastFrameSamples:18});const ink=owner.snapshotInk();
   owner.generate(s,context);owner.generate(s,{...context,time:.1});expect(provider).toHaveBeenCalledTimes(2);expect(owner.snapshotInk()).toEqual(ink);
   const dormant={...s,settings:{...s.settings,seed:999,funcSeed:888,recordTrails:true}};expect(identity(inputScene(dormant),17,13)).toBe(identity(inputScene(s),17,13));owner.generate(dormant,{...context,time:.1});expect(provider).toHaveBeenCalledTimes(2);expect(owner.snapshotInk()).toEqual(ink);
   const controls=visibleIteratedControls('samila',s.settings,definition('samila').controls).map(x=>x.key);expect(controls).not.toContain('seed');expect(controls).not.toContain('funcSeed');expect(controls).not.toContain('recordTrails');
  }finally{owner.reset();}expect(owner.diagnostics().samilaSampling.retainedBytes).toBe(0);
 });
 it('retains the consumed seed on a soft cancellation and distinguishes explicit disposal and resize epochs',()=>{
  const s=scene();let calls=0;const owner=new IteratedDensitySession({samilaSeedProvider:()=>++calls});
  try{owner.generate(s,context);expect(()=>owner.generate(s,{...context,time:.2,isCancelled:()=>calls>=2})).toThrow('取消');expect(calls).toBe(2);owner.generate(s,{...context,time:.2});expect(calls).toBe(3);
   owner.generate(s,{...context,time:.2});expect(calls).toBe(3);owner.generate(s,{...context,time:0,width:19});expect(calls).toBe(4);owner.reset();owner.generate(s,context);expect(calls).toBe(5);
  }finally{owner.reset();}
 });
 it('lets formulas decide validity for overflowing spans with finite source-PCG endpoints',()=>{
  const s=scene();s.settings.start=-3e38;s.settings.stop=3e38;s.equations={f1:'0',f2:'0'};s.timeline.tracks=[];
  const owner=new IteratedDensitySession({samilaSeedProvider:()=>0});try{const constant=owner.generate(s,context);expect(constant.density).toMatchObject({accepted:3,invalid:0});expect(owner.snapshotInk().some(x=>x>0)).toBe(true);
   const propagated=owner.generate({...s,equations:{f1:'x',f2:'y'}},context);expect(propagated.density).toMatchObject({accepted:0,invalid:3});expect(propagated.warnings?.some(x=>x.includes('已跳过'))).toBe(true);
   const old={...s,settings:{...s.settings}};delete old.settings.samilaSamplingModel;expect(()=>owner.generate(old,context)).toThrow('Float32');expect(()=>owner.generate({...s,settings:{...s.settings,stop:1e39}},context)).toThrow('Float32');
  }finally{owner.reset();}
 });
 it('keeps unmarked saved documents deterministic without consuming runtime entropy',()=>{
  const s=scene();delete s.settings.samilaSamplingModel;s.settings.recordTrails=true;const provider=vi.fn(()=>{throw Error('unexpected entropy');}),owner=new IteratedDensitySession({samilaSeedProvider:provider});try{owner.generate(s,context);const first=owner.snapshotInk();owner.reset();owner.generate(s,context);expect(owner.snapshotInk()).toEqual(first);expect(provider).not.toHaveBeenCalled();}finally{owner.reset();}
 });
});
