import {describe,it,expect} from 'vitest';
import {deriveSamilaNormalization,initializeSamilaTone,samilaToneControlSettings,samilaToneParameters,samilaDensityValue,type SamilaToneFacts} from '../src/engine/samilaTone';
import {prepareDensityTone,toneDensityRgbaPrepared,type DensityToneJob} from '../src/engine/density';
import {prepareDensityGpuTone} from '../src/engine/densityGpuTone';
import {normalizedDensityValue} from '../src/engine/densityNormalization';
import type {Palette,Settings} from '../src/types';
const palette:Palette={name:'test',mode:'linear',stops:['#ff0000','#0000ff'],cycles:1,offset:0};
const facts:SamilaToneFacts & {splat:{model:'local-feathered-disc-v1';radiusPixels:number}}={kind:'samila',historyModel:'bounded-v2',width:1080,height:1080,completedPasses:1,baseBatchSize:1000,alpha:.1,combinedDecay:1,splat:{model:'local-feathered-disc-v1',radiusPixels:1}};
const settings=(extra:Settings={})=>({...initializeSamilaTone({iteratedMode:'continuous'}),...extra});
function unitJob(extra:Settings={}):DensityToneJob {const job=prepareDensityTone(palette,settings({normalizedBrightness:.5,normalizedDynamicRange:1,normalizedGamma:1,normalizedSaturation:1,background:'#000000',transparentBackground:true,...extra}),facts);if(job.model!=='samila-normalized-v2')throw Error('Samila job');return{...job,normalization:{...job.normalization,scale:1}};}
describe('Samila versioned normalized tone',()=>{
 it('opts in atomically without changing legacy controls or saving a second radius',()=>{
  const old={iteratedMode:'continuous',gamma:3,brightness:-.2,pointSize:2,densityToneModel:'white-point-v1',samilaHistoryModel:'legacy-v1'},out=initializeSamilaTone(old);
  expect(out).toMatchObject({gamma:3,brightness:-.2,pointSize:2,densityToneModel:'samila-normalized-v2',samilaHistoryModel:'bounded-v2',samilaToneBranch:'palette-average'});expect(old.samilaHistoryModel).toBe('legacy-v1');expect('nominalRadius'in out).toBe(false);
  expect(out).toMatchObject({normalizedBrightness:.5,normalizedDynamicRange:.5});
  expect(initializeSamilaTone({...out,normalizedGamma:4,normalizedBrightness:.3,normalizedDynamicRange:.2})).toMatchObject({normalizedGamma:4,normalizedBrightness:.3,normalizedDynamicRange:.2});expect(samilaToneControlSettings({densityToneModel:'samila-normalized-v2'})).toMatchObject({normalizedBrightness:.5,normalizedDynamicRange:.5});expect(samilaToneControlSettings(old)).toBe(old);expect(()=>initializeSamilaTone({iteratedMode:'single'})).toThrow();
  expect(samilaToneParameters({samilaHistoryModel:'bounded-v2'})).toMatchObject({brightness:.5,dynamicRange:.5});
 });
 it('derives nominal radius solely from actual disc geometry and physical dimensions',()=>{
  const a=deriveSamilaNormalization(facts),b=deriveSamilaNormalization({...facts,height:2160,width:2160,splat:{...facts.splat,radiusPixels:2}});
  expect(a.nominalRadius).toBe(1);expect(b.nominalRadius).toBe(1);expect(a.scale).toBeCloseTo(100*Math.PI/(1080*1080)*Math.sqrt(60),14);expect(b.scale).toBeCloseTo(a.scale/4,14);
  const six=deriveSamilaNormalization({...facts,completedPasses:6});expect(six.scale/a.scale).toBeCloseTo(Math.sqrt(6),14);expect(deriveSamilaNormalization({...facts,completedPasses:0}).scale).toBe(a.scale);
  expect(deriveSamilaNormalization({...facts,alpha:0}).scale).toBe(1e-8);expect(facts.splat.radiusPixels).toBe(1);
 });
 it('uses the Samila decay cap before its scale floor, independently of ink mass and the copy cap',()=>{
  const dense={...facts,width:1,height:1080,baseBatchSize:8000000,alpha:1,combinedDecay:.5},capped=deriveSamilaNormalization(dense);expect(capped.scale).toBe(300/8);
  const b=100*Math.PI/(1080*1080);expect(deriveSamilaNormalization({...facts,combinedDecay:.5}).scale).toBeCloseTo(b/.5/8,14);
  const threshold=Math.fround(.999);expect(deriveSamilaNormalization({...facts,combinedDecay:threshold}).scale).toBe(deriveSamilaNormalization(facts).scale);
  const many={...facts,completedPasses:100000};expect(deriveSamilaNormalization({...many,combinedDecay:threshold-Number.EPSILON}).scale).toBeLessThan(deriveSamilaNormalization({...many,combinedDecay:threshold}).scale);
 });
 it('keeps the positive Samila limiting curve distinct from the existing complement',()=>{
  expect(samilaDensityValue(0,1,.5,1)).toBe(.5);expect(samilaDensityValue(Math.log(1000),1,.5,1)).toBeCloseTo(5/6,14);expect(normalizedDensityValue(Math.log(1000),1,.5,1)).toBeCloseTo(1/6,14);
  const values=[-1000,-100,-1,0,1,100,1000].map(v=>samilaDensityValue(v,2,.3,.1));expect(values.every(Number.isFinite)).toBe(true);expect([...values].sort((a,b)=>a-b)).toEqual(values);expect(values[0]).toBeGreaterThanOrEqual(0);expect(values.at(-1)).toBeLessThanOrEqual(1);
 });
 it('uses distinct LUT/YUV gamma, saturation and alpha order with analytic pixels',()=>{
  const ink=new Float64Array([1,0,0,1]);
  expect([...toneDensityRgbaPrepared(1,1,ink,unitJob())]).toEqual([128,0,0,253]);
  expect([...toneDensityRgbaPrepared(1,1,ink,unitJob({samilaToneBranch:'yuv-average'}))]).toEqual([255,51,51,250]);
  expect([...toneDensityRgbaPrepared(1,1,ink,unitJob({normalizedGamma:2,normalizedSaturation:0}))]).toEqual([54,54,54,253]);
  expect([...toneDensityRgbaPrepared(1,1,ink,unitJob({samilaToneBranch:'yuv-average',normalizedGamma:2,normalizedSaturation:0}))]).toEqual([180,180,180,250]);
 });
 it('composites opaque output once and preserves straight-alpha transparent bytes and empty behavior',()=>{
  const ink=new Float64Array([1,0,0,1,0,0,0,0]),transparent=toneDensityRgbaPrepared(2,1,ink,unitJob()),opaque=toneDensityRgbaPrepared(2,1,ink,unitJob({transparentBackground:false}));
  expect([...transparent]).toEqual([128,0,0,253,0,0,0,0]);expect([...opaque]).toEqual([126,0,0,255,0,0,0,255]);
  const destination=new Uint8ClampedArray(8).fill(255);expect(toneDensityRgbaPrepared(2,1,ink,unitJob(),undefined,destination)).toBe(destination);expect(destination).toEqual(transparent);
 });
 it('rejects malformed owner facts and unsupported history instead of guessing from a scene',()=>{
  for(const patch of [{kind:'map'},{historyModel:'legacy-v1'},{completedPasses:-1},{completedPasses:.5},{baseBatchSize:0},{alpha:NaN},{combinedDecay:2},{width:0},{height:.5},{splat:{model:'unknown',radiusPixels:1}},{splat:{model:'local-feathered-disc-v1',radiusPixels:0}}])expect(()=>deriveSamilaNormalization({...facts,...patch}as SamilaToneFacts)).toThrow();
  expect(()=>prepareDensityTone(palette,settings())).toThrow('事实');expect(()=>prepareDensityTone(palette,settings({samilaHistoryModel:'legacy-v1'}),facts)).toThrow('bounded-v2');expect(()=>prepareDensityTone(palette,settings({samilaToneBranch:'automatic'}),facts)).toThrow();
  for(const patch of [{normalizedBrightness:2},{normalizedContrast:0},{normalizedGamma:0},{normalizedDynamicRange:32},{normalizedSaturation:2}]as Settings[])expect(()=>prepareDensityTone(palette,settings(patch),facts)).toThrow();
 });
 it('uses shared finite/weight boundaries and does not fabricate negative-gamma colors',()=>{
  for(const ink of [[1,0,0,NaN],[0,0,0,-1],[Infinity,0,0,1],[NaN,0,0,0],[-1,0,0,1]])expect(()=>toneDensityRgbaPrepared(1,1,Float64Array.from(ink),unitJob())).toThrow();
  expect(()=>toneDensityRgbaPrepared(1,1,new Float64Array([1,0,0,1]),unitJob(),()=>true)).toThrow('取消');
  const tiny=toneDensityRgbaPrepared(1,1,new Float64Array([1e-13,0,0,1e-13]),unitJob());expect([...tiny]).toEqual([0,0,0,0]);
 });
 it('uses source-color GPU admission for all palettes and retains explicit precision fallback',()=>{
  for(const mode of ['linear','sine','cosine','hsv','curve']as const){const job=prepareDensityTone({...palette,mode,cycles:1e200,offset:1e200},settings(),facts);expect(prepareDensityGpuTone(job).plan).toBeDefined();}
  const job=unitJob();if(job.model!=='samila-normalized-v2')throw Error('Samila job');expect(prepareDensityGpuTone({...job,normalization:{...job.normalization,scale:1e100}}).reason).toContain('CPU');
 });
 it('leaves old omitted/v1 output identical with dormant malformed Samila settings',()=>{
  const old:Settings={paletteMode:'source',toneMap:'linear',dynamicRange:2,gamma:1,transparentBackground:true},ink=new Float64Array([1,0,0,1]);
  expect(toneDensityRgbaPrepared(1,1,ink,prepareDensityTone(palette,old))).toEqual(toneDensityRgbaPrepared(1,1,ink,prepareDensityTone(palette,{...old,densityToneModel:'white-point-v1',samilaToneBranch:'broken',normalizedGamma:NaN})));
 });
});
