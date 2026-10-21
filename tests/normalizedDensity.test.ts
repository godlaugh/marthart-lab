import {describe,it,expect,vi} from 'vitest';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {createScene,parseScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {prepareDensityTone,toneDensityRgbaPrepared} from '../src/engine/density';
import {densityToneControlSettings,densityToneModel,initializeNormalizedDensity,normalizedDensityValue,prepareDensityNormalization,type DensityNormalizationFacts} from '../src/engine/densityNormalization';
import {prepareDensityGpuTone} from '../src/engine/densityGpuTone';
import {generateScene,TemporalGenerationSession} from '../src/engine/temporal';
import {visibleIteratedControls} from '../src/scenes/iteratedDensity';
import type {Palette,SceneOutput,Settings} from '../src/types';
const palette:Palette={name:'test',mode:'linear',stops:['#ff0000','#0000ff'],cycles:1,offset:0};
const facts:DensityNormalizationFacts={kind:'map',width:100,height:100,recordedPasses:10,batchSize:1000};
function settings(patch:Settings={}){return{...initializeNormalizedDensity('map',{iteratedMode:'continuous'},100,100),...patch};}
function bytes(out:SceneOutput){if(out.type!=='raster')throw Error('raster required');return out.pixels;}
function scene(kind:'map'|'symmetry'='map'){
 const s=createScene(definition(kind));Object.assign(s.settings,{iteratedMode:'continuous',iteratedBackend:'cpu',batchSize:4,burnIn:0,iterationsPerFrame:2,iteratedFps:10,initialRange:0,initialMode:'box',initialXMin:0,initialXMax:0,initialYMin:0,initialYMax:0,densityView:'manual',densitySpan:4,pointSize:1,accumulationDecay:.5});
 if(kind==='map'){s.equations={x:'x',y:'y',z:'z'};s.parameters={};}s.settings=initializeNormalizedDensity(kind,s.settings,11,11);return s;
}
const ctx={time:.2,width:11,height:11,quality:'export' as const};
describe('explicit normalized density boundary',()=>{
 it('initializes only on opt-in and retains both models and the chosen reference on roundtrip',()=>{
  const old:Settings={iteratedMode:'continuous',dynamicRange:32,brightness:-.2,gamma:3,paletteMode:'density'},first=initializeNormalizedDensity('map',old,1280,720);
  expect(old.densityToneModel).toBeUndefined();expect(first).toMatchObject({...old,densityToneModel:'normalized-v2',densityReferenceWidth:1280,densityReferenceHeight:720,normalizedDynamicRange:.2});
  const changed={...first,normalizedBrightness:.9,densityReferenceWidth:333,densityToneModel:'white-point-v1'};
  expect(initializeNormalizedDensity('map',changed,1920,1080)).toMatchObject({normalizedBrightness:.9,densityReferenceWidth:333,densityReferenceHeight:720,dynamicRange:32,gamma:3});
  const s=scene();s.settings=changed;expect(parseScene(JSON.stringify(s)).settings).toEqual(changed);
  expect(()=>initializeNormalizedDensity('samila',old,100,100)).toThrow();expect(()=>initializeNormalizedDensity('map',{},100,100)).toThrow();expect(()=>initializeNormalizedDensity('map',old,1.5,100)).toThrow();
  expect(densityToneModel({})).toBe('white-point-v1');expect(()=>densityToneModel({densityToneModel:'v3'})).toThrow();
 });
 it('keeps omitted and explicit v1 pixels and ignores dormant normalized data',()=>{
  const rgba=new Float32Array([1,0,0,1,0,0,0,0]),v1:Settings={paletteMode:'source',toneMap:'linear',dynamicRange:2,gamma:1,transparentBackground:true};
  const omitted=toneDensityRgbaPrepared(2,1,rgba,prepareDensityTone(palette,v1)),explicit=toneDensityRgbaPrepared(2,1,rgba,prepareDensityTone(palette,{...v1,densityToneModel:'white-point-v1',normalizedGamma:NaN,densityReferenceWidth:0}));
  expect([...omitted]).toEqual([255,0,0,128,0,0,0,0]);expect(explicit).toEqual(omitted);
 });
 it('distinguishes family defaults and uses source-shaped bounds without reading inactive v1 parameters',()=>{
  const map=prepareDensityTone(palette,settings({gamma:NaN,contrast:-1,dynamicRange:32}),facts),sym=prepareDensityTone(palette,{densityToneModel:'normalized-v2',densityReferenceWidth:100,densityReferenceHeight:100},{...facts,kind:'symmetry'});
  expect(map.tone).toMatchObject({brightness:.3,dynamicRange:.2,gamma:2.2,paletteMode:'source'});expect(sym.tone).toMatchObject({brightness:.5,dynamicRange:.5});
  expect(densityToneControlSettings('symmetry',{densityToneModel:'normalized-v2'})).toMatchObject({normalizedBrightness:.5,normalizedDynamicRange:.5});
  for(const patch of [{normalizedBrightness:-.51},{normalizedBrightness:1.51},{normalizedContrast:0},{normalizedGamma:10.1},{normalizedDynamicRange:32},{normalizedSaturation:1.1},{densityReferenceWidth:0},{densityReferenceHeight:1.1},{densityReferenceWidth:NaN}]as Settings[])expect(()=>prepareDensityTone(palette,settings(patch),facts)).toThrow();
  expect(()=>prepareDensityTone(palette,settings())).toThrow('事实');expect(()=>prepareDensityTone(palette,{densityToneModel:'normalized-v2'},facts)).toThrow();
 });
 it('normalizes nominal passes and current batch against an explicit physical reference area',()=>{
  const a=prepareDensityNormalization(settings(),facts),b=prepareDensityNormalization(settings(),{...facts,width:200,height:200});expect(a.scale).toBe(1);expect(b.scale).toBe(1);
  expect(prepareDensityNormalization(settings({densityReferenceWidth:200}),facts).scale).toBe(.5);
  expect(prepareDensityNormalization(settings(),{...facts,recordedPasses:0}).scale).toBe(.1);
  expect(prepareDensityNormalization(settings({densityReferenceWidth:16384,densityReferenceHeight:16384}),{...facts,width:1,height:1,recordedPasses:1,batchSize:1}).scale).toBe(1e-6);
  for(const patch of [{recordedPasses:-1},{recordedPasses:1.5},{batchSize:0},{width:0}])expect(()=>prepareDensityNormalization(settings(),{...facts,...patch})).toThrow();
 });
 it('matches analytic smooth-limit values and straight alpha, then composites an opaque output exactly once',()=>{
  const job=prepareDensityTone(palette,settings({normalizedBrightness:.5,normalizedDynamicRange:1,normalizedGamma:1,normalizedSaturation:0,transparentBackground:true}),facts);
  const ink=new Float64Array([1,0,0,1,10,0,0,10,1000,0,0,1000,0,0,0,0]),out=toneDensityRgbaPrepared(4,1,ink,job);
  expect([...out]).toEqual([128,128,128,250,77,77,77,254,43,43,43,255,0,0,0,0]);
  const opaque=prepareDensityTone(palette,settings({normalizedBrightness:.5,normalizedDynamicRange:1,normalizedGamma:1,normalizedSaturation:0,background:'#000000'}),facts);
  expect([...toneDensityRgbaPrepared(1,1,ink.slice(0,4),opaque)]).toEqual([125,125,125,255]);
  for(const d of [1e-300,1e-6,1,10,1000,1e300])expect(normalizedDensityValue(Math.log(d),2,1.5,.1)).toBeGreaterThanOrEqual(0);
  expect(normalizedDensityValue(0,1,.5,1)).toBe(.5);expect(normalizedDensityValue(Math.log(10),1,.5,1)).toBeCloseTo(.3,14);
 });
 it('uses the source RGB average and map-only tiny-mass guard; empty pixels and failed buffers stay explicit',()=>{
  const patch=settings({normalizedBrightness:.5,normalizedDynamicRange:1,normalizedGamma:1,transparentBackground:true}),tinyFacts={...facts,recordedPasses:1,batchSize:1};
  const ink=new Float64Array([1e-7,0,0,1e-7]),map=prepareDensityTone(palette,patch,tinyFacts),sym=prepareDensityTone(palette,patch,{...tinyFacts,kind:'symmetry'});
  expect(toneDensityRgbaPrepared(1,1,ink,map)).not.toEqual(toneDensityRgbaPrepared(1,1,ink,sym));
  expect(()=>toneDensityRgbaPrepared(1,1,new Float64Array([NaN,0,0,1]),map)).toThrow('非有限');expect(()=>toneDensityRgbaPrepared(1,1,new Float64Array([0,0,0,-1]),map)).toThrow();
  expect(()=>toneDensityRgbaPrepared(1,1,ink,map,()=>true)).toThrow('取消');
  expect(prepareDensityGpuTone(map).plan?.job.model).toBe('normalized-v2');
 });
});
describe('production continuous normalized state',()=>{
 it('rejects invalid active tone before GPU construction or orbit work',()=>{
  const s=scene();Object.assign(s.settings,{iteratedBackend:'gpu',batchSize:5000000,normalizedGamma:0});const canvas=vi.fn(()=>{throw Error('GPU constructed before validation');});vi.stubGlobal('OffscreenCanvas',canvas);const owner=new TemporalGenerationSession();
  try{expect(()=>generateScene(s,ctx,owner)).toThrow(/normalizedGamma/);expect(canvas).not.toHaveBeenCalled();expect(owner.iterated.diagnostics().retainedBytes).toBe(0);}finally{vi.unstubAllGlobals();owner.reset();}
 });
 it('explicit legacy import keeps source tone in dormant v2 fields without guessing a reference or changing valid v1 values',()=>{
  for(const [type,brightness,shape]of [['MAP_ATTRACTOR',.3,.2],['SYMMETRY_CHAOS',.5,.5]]as const){const imported=parseLegacyScene(JSON.stringify({config_version:'1.0.0',type,name:'tone',equations:{x_next:'x',y_next:'y'},settings:{batch_size:2,gamma:3,dynamicRange:.4,invert:true}}),{iteratedMath:'legacy-v1'});
   expect(imported.scene.settings).toMatchObject({gamma:3,dynamicRange:.4,normalizedGamma:3,normalizedDynamicRange:.4,normalizedBrightness:brightness});expect(imported.scene.settings.densityToneModel).toBeUndefined();expect(imported.scene.settings.densityReferenceWidth).toBeUndefined();expect(imported.warnings.join()).toContain('参考画布尺寸未知');expect(imported.warnings.join()).toContain('Invert');
   const omitted=parseLegacyScene(JSON.stringify({config_version:'1.0.0',type,name:'tone',equations:{x_next:'x',y_next:'y'},settings:{batch_size:2}}),{iteratedMath:'legacy-v1'});expect(omitted.scene.settings.normalizedDynamicRange).toBe(shape);
  }
  const imported=parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'MAP_ATTRACTOR',name:'bounds',equations:{x_next:'x',y_next:'y'},settings:{brightness:1.5,gamma:10,dynamic_range:32}}),{iteratedMath:'legacy-v1'});expect(imported.scene.settings).toMatchObject({brightness:1,gamma:8,dynamicRange:32,normalizedBrightness:1.5,normalizedGamma:10,normalizedDynamicRange:1});expect(imported.warnings.join()).toContain('原值保留');
 });
 it('counts recorded passes separately from iterations, decay, clipped and invalid samples',()=>{
  for(const mode of ['finite','invalid','clipped']){const s=scene();if(mode==='invalid')s.equations.x='1/0';if(mode==='clipped')s.settings.offsetX=100;
   const session=new TemporalGenerationSession(),out=generateScene(s,ctx,session),state=session.iterated.diagnostics();expect(state.recordedPasses).toBe(3);expect(state.lastBatchSize).toBe(4);expect(out.stats.samples).toBe(24);expect(out.density?.inputPoints).toBe(12);if(mode==='finite')expect(out.density?.maxCount).toBe(7);else expect(out.stats.generated).toBe(0);session.reset();expect(session.iterated.diagnostics().retainedBytes).toBe(0);
  }
  const s=scene();s.settings.recordTrails=false;const owner=new TemporalGenerationSession();generateScene(s,ctx,owner);expect(owner.iterated.diagnostics().recordedPasses).toBe(0);owner.reset();
 });
 it('reuses the same ink for static tone/model/reference edits, survives output transfer and replays exact cold seeks',()=>{
  for(const kind of ['map','symmetry']as const){const s=scene(kind),owner=new TemporalGenerationSession(),first=generateScene(s,ctx,owner);const old=bytes(first).slice();structuredClone(first,{transfer:[bytes(first).buffer]});
   s.settings.normalizedBrightness=.8;const warm=generateScene(s,ctx,owner);expect(warm.temporal?.cacheHits).toBe(1);expect(owner.iterated.diagnostics().recordedPasses).toBe(3);expect(bytes(warm)).not.toEqual(old);expect(bytes(warm)).toEqual(bytes(generateScene(s,ctx)));
   s.settings.densityReferenceWidth=22;expect(generateScene(s,ctx,owner).temporal?.cacheHits).toBe(1);
   s.settings.densityToneModel='white-point-v1';expect(generateScene(s,ctx,owner).temporal?.cacheHits).toBe(1);
   s.settings.densityToneModel='normalized-v2';const final=generateScene(s,ctx,owner);generateScene(s,{...ctx,time:0},owner);expect(bytes(generateScene(s,ctx,owner))).toEqual(bytes(final));owner.reset();
  }
 });
 it('clears passes with ink and uses last completed batch facts at fractional times',()=>{
  const s=scene();s.settings.iterationsPerFrame=1;s.settings.iteratedFps=4;s.timeline.tracks=[{id:'batch',target:'settings.batchSize',from:2,to:6,start:0,duration:1,easing:'linear',enabled:true,pingPong:false}];const owner=new TemporalGenerationSession(),out=generateScene(s,{...ctx,time:.625},owner);
  expect(owner.iterated.diagnostics()).toMatchObject({recordedPasses:1,lastBatchSize:4,clears:3});expect(out.stats.samples).toBe(9);expect(bytes(out)).toEqual(bytes(generateScene(s,{...ctx,time:.5})));owner.reset();
 });
 it('Replay resets the counter, cancellation releases state and scene departure releases the owner',()=>{
  const s=scene(),owner=new TemporalGenerationSession();generateScene(s,ctx,owner);s.settings.iteratedStartTime=.2;generateScene(s,ctx,owner);expect(owner.iterated.diagnostics().recordedPasses).toBe(1);
  expect(()=>generateScene(s,{...ctx,time:.4,isCancelled:()=>true},owner)).toThrow();expect(owner.iterated.diagnostics().retainedBytes).toBe(0);
  generateScene(s,ctx,owner);const other=createScene(definition('map'));generateScene(other,{...ctx,time:0,width:4,height:4},owner);expect(owner.iterated.diagnostics().retainedBytes).toBe(0);owner.reset();
 });
 it('keeps v2 parameters dormant when switching to single-frame or historical point density',()=>{
  for(const kind of ['map','symmetry']as const)for(const densityAccumulation of ['frame','window']){const s=scene(kind);Object.assign(s.settings,{iteratedMode:'single',presentation:'density',count:20,burnIn:0,densityAccumulation,densitySampleRate:10,densityLifetime:.1});const kept=structuredClone(s.settings),actual=generateScene(s,ctx);s.settings.densityToneModel='white-point-v1';const expected=generateScene(s,ctx);expect(bytes(actual)).toEqual(bytes(expected));s.settings=kept;expect(s.settings.densityToneModel).toBe('normalized-v2');expect(s.settings.normalizedGamma).toBe(2.2);}
 });
 it('exposes only effective controls for normalized Map/Symmetry and leaves Samila/old models alone',()=>{
  const s=scene(),keys=visibleIteratedControls('map',s.settings,definition('map').controls).map(c=>c.key);expect(keys).toContain('normalizedGamma');expect(keys).toContain('iteratedColor');expect(keys).not.toContain('gamma');expect(keys).not.toContain('paletteMode');expect(keys).not.toContain('exposure');
  s.settings.densityToneModel='white-point-v1';const old=visibleIteratedControls('map',s.settings,definition('map').controls).map(c=>c.key);expect(old).toContain('gamma');expect(old).not.toContain('normalizedGamma');
  expect(visibleIteratedControls('samila',{iteratedMode:'continuous',densityToneModel:'white-point-v1'},definition('samila').controls).some(c=>c.key==='normalizedGamma')).toBe(false);
 });
});
