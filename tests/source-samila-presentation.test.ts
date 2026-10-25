import {describe,it,expect} from 'vitest';
import {SOURCE_SAMILA_PRESENTATION_MODEL,sourceSamilaBlendTarget,sourceSamilaDisplayTransform,validateSourceSamilaPresentation,validateSourceSamilaPresentationFacts,sourceSamilaSceneBackgroundRgba8} from '../src/engine/sourceSamilaPresentation';
import {prepareDensityTone,toneDensityRgbaPrepared} from '../src/engine/density';
import {prepareDensityGpuTone,sourceDensityPresentationBytes,densityGpuToneBytes} from '../src/engine/densityGpuTone';
import {iteratedGpuBytes} from '../src/engine/iteratedDensityGpu';
import {prepareSamilaView} from '../src/engine/samilaCamera';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {IteratedDensitySession} from '../src/scenes/iteratedDensity';
import type {Palette,Settings} from '../src/types';
import type {SamilaToneFacts} from '../src/engine/samilaTone';
const palette:Palette={name:'white',mode:'linear',stops:['#ffffff','#ffffff'],cycles:1,offset:0};
const settings:Settings={samilaPresentationModel:SOURCE_SAMILA_PRESENTATION_MODEL,samilaSplatModel:'samila-splat-1.7.8',samilaMathModel:'mathart-1.7.8',samilaProjectionModel:'source-ndc-v1',samilaCameraModel:'anchored-theta-v1',samilaHistoryModel:'bounded-v2',densityToneModel:'samila-normalized-v2',iteratedMode:'continuous',normalizedBrightness:.5,normalizedContrast:1,normalizedGamma:1,normalizedDynamicRange:1,normalizedSaturation:1,background:'#102030'};
const facts:SamilaToneFacts={kind:'samila',historyModel:'bounded-v2',width:1,height:1,completedPasses:1,baseBatchSize:1,alpha:.1,combinedDecay:1,splat:{model:'samila-splat-1.7.8',nominalRadius:1}};
function job(extra:Record<string,Settings[string]|undefined>={}){const cfg={...settings};for(const [key,value]of Object.entries(extra))if(value===undefined)delete cfg[key];else cfg[key]=value;const out=prepareDensityTone(palette,cfg,facts);if(out.model!=='samila-normalized-v2')throw Error('type');out.normalization.scale=1;return out;}
describe('versioned original Samila presentation endpoint',()=>{
 it('preserves constructor packed alpha and Processing grayscale separately from shader RGB',()=>{
  expect(sourceSamilaSceneBackgroundRgba8({samilaSceneBackgroundColor:1},[0,0,1/255])).toEqual([1,1,1,255]);
  expect(sourceSamilaSceneBackgroundRgba8({samilaSceneBackgroundColor:0x00102030},[16/255,32/255,48/255])).toEqual([16,32,48,0]);
  expect(sourceSamilaSceneBackgroundRgba8({samilaSceneBackgroundColor:0x80102030},[16/255,32/255,48/255])).toEqual([16,32,48,128]);
  expect(sourceSamilaSceneBackgroundRgba8({},[0,0,1/255])).toEqual([0,0,1,255]);
  expect(()=>sourceSamilaSceneBackgroundRgba8({samilaSceneBackgroundColor:-1},[0,0,0])).toThrow('uint32');
 });
 it('accepts explicit opaque-copy and recording-screen facts, without inferring a mode or background',()=>{
  const common={model:SOURCE_SAMILA_PRESENTATION_MODEL,stage:'present-target-rgba8',backend:'native'};
  expect(()=>validateSourceSamilaPresentationFacts({...common,display:'opaque-rgb-copy'})).not.toThrow();
  expect(()=>validateSourceSamilaPresentationFacts({...common,display:'recording-preview-over-background',backgroundRgba8:Object.freeze([16,32,48,128])})).not.toThrow();
  for(const value of [null,[],common,{...common,display:'source-over'},{...common,display:'opaque-rgb-copy',backgroundRgba8:[0,0,0,255]},{...common,display:'opaque-rgb-copy',backgroundRgba8:undefined},{...common,display:'recording-preview-over-background'},...[Array(4),[0,,0,255],[0,0,0],[0,0,0,-1],[0,0,0,256],[0,0,0,.5],[0,0,0,NaN],new Uint8Array([0,0,0,255])].map(backgroundRgba8=>({...common,display:'recording-preview-over-background',backgroundRgba8})),{...common,display:'opaque-rgb-copy',backend:'unknown'},{...common,display:'opaque-rgb-copy',model:'unknown'},{...common,display:'opaque-rgb-copy',stage:'shader-rgba'}])expect(()=>validateSourceSamilaPresentationFacts(value)).toThrow();
 });
 it('budgets the complete source MRT only for the selected presentation version',()=>{
  const w=513,h=517,extra=sourceDensityPresentationBytes(w,h);expect(extra).toBe(w*h*20);
  const old=iteratedGpuBytes(100,w,h,2048,true,false,true),source=iteratedGpuBytes(100,w,h,2048,true,false,true,true);expect(source-old).toBe(extra);
  expect(source).toBeGreaterThan(extra+densityGpuToneBytes()+w*h*48);
  for(const pair of [[0,1],[1,.5],[8192,8192],[16385,1]])expect(()=>sourceDensityPresentationBytes(...pair as [number,number])).toThrow();
 });
 it('clamps raw RGBA before ordinary source-alpha blending, preserving the squared alpha target',()=>{
  // Independent original shader GL observation, not a producer-derived golden.
  expect(sourceSamilaBlendTarget([4.61844,-1.42006,-.994889,.549808])).toEqual([140,0,0,77]);
  expect(sourceSamilaBlendTarget([1,.5,0,.5])).toEqual([128,64,0,64]);
  expect(()=>sourceSamilaBlendTarget([NaN,0,0,1])).toThrow('非有限');
 });
 it('uses Java float operands before subtraction and preserves large windings',()=>{
  const view=prepareSamilaView({model:'anchored-theta-v1',time:0,theta:2**24+1},2**24,17,9);
  expect(sourceSamilaDisplayTransform(view,17,9)).toEqual({delta:0,aspect:Math.fround(17/9)});
  view.currentTheta=1e8;view.anchorTheta=0;expect(sourceSamilaDisplayTransform(view,17,9).delta).toBe(1e8);
  view.currentTheta=1e39;expect(()=>sourceSamilaDisplayTransform(view,17,9)).toThrow('float32');
 });
 it('keeps background opaque and ignores the old transparent toggle only for the marked endpoint',()=>{
  const ink=new Float32Array([1,0,0,1,0,0,0,0]);
  const a=toneDensityRgbaPrepared(2,1,ink,job({transparentBackground:true})),b=toneDensityRgbaPrepared(2,1,ink,job({transparentBackground:false}));
  expect(a).toEqual(b);expect([...a.slice(4)]).toEqual([16,32,48,255]);expect(a[3]).toBeLessThan(255);
  const old=job({samilaPresentationModel:undefined,transparentBackground:true});expect(old.sourcePresentation).toBeUndefined();expect([...toneDensityRgbaPrepared(2,1,ink,old).slice(4)]).toEqual([0,0,0,0]);
 });
 it('rejects literal source arithmetic overflow instead of applying the legacy stable curve',()=>{
  const ink=new Float32Array([.02,0,0,.02]);
  expect(()=>toneDensityRgbaPrepared(1,1,ink,job({normalizedDynamicRange:.001,normalizedBrightness:100}))).toThrow('非有限');
  expect(prepareDensityGpuTone(job({normalizedContrast:1e-25})).plan).toBeDefined();
  expect(()=>toneDensityRgbaPrepared(1,1,ink,job(),()=>true)).toThrow('取消');
 });
 it('validates full profile dependencies at direct generation, before acquiring resources',()=>{
  const scene=createScene(definition('samila'));scene.settings={...scene.settings,...settings,iteratedBackend:'cpu',batchSize:1};scene.equations={f1:'0',f2:'0'};scene.palette=palette;scene.parameters={};scene.timeline.tracks=[];
  expect(()=>validateSourceSamilaPresentation(scene)).not.toThrow();
  for(const patch of [{samilaPresentationModel:'unknown'},{samilaMathModel:undefined},{samilaCameraModel:'legacy-v1'},{samilaProjectionModel:undefined},{iteratedMode:'single'},{samilaHistoryModel:'legacy-v1'},{densityProjection:'xz'},{samilaSceneBackgroundColor:-1},{samilaSceneBackgroundColor:0x100000000},{samilaSceneBackgroundColor:'255'}]){
   const owner=new IteratedDensitySession();try{expect(()=>owner.generate({...scene,settings:{...scene.settings,...patch} as unknown as Settings},{time:0,width:9,height:9,quality:'export'})).toThrow();expect(owner.diagnostics().retainedBytes).toBe(0);}finally{owner.reset();}
  }
  const owner=new IteratedDensitySession();try{const out=owner.generate(scene,{time:0,width:9,height:9,quality:'export',samilaPrimaryPixelHeight:1080});expect(out.type==='raster'&&out.sourceSamilaPresentation).toEqual({model:SOURCE_SAMILA_PRESENTATION_MODEL,stage:'present-target-rgba8',display:'opaque-rgb-copy',backend:'cpu-derived'});expect(out.warnings?.some(w=>w.includes('CPU float32 派生近似'))).toBe(true);}finally{owner.reset();}
 });
});
