import {describe,it,expect} from 'vitest';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {parseScene} from '../src/engine/document';
import {importSamilaTone,type SamilaToneSource} from '../src/engine/samilaToneImport';
import {initializeSamilaTone} from '../src/engine/samilaTone';
import {generateScene} from '../src/engine/temporal';
import type {SceneDocument,SceneOutput} from '../src/types';

const source=(settings?:unknown)=>({config_version:'1.0.0',type:'SAMILA',name:'Tone import',parameters:{a:3},equations:{f1:'sin(x)',f2:'cos(y)'},...(settings===undefined?{}:{settings})});
const parse=(settings?:unknown)=>parseLegacyScene(JSON.stringify(source(settings)));
function small(scene:SceneDocument){Object.assign(scene.settings,{batchSize:32,iteratedBackend:'cpu',iteratedFps:10,showTrails:false});return scene;}
const context={time:.1,width:16,height:12,quality:'export' as const};
function pixels(output:SceneOutput){if(output.type!=='raster')throw Error('expected raster');return output.pixels;}

describe('Samila source tone import and inactive compatibility',()=>{
 it('distinguishes absent, empty, and partial settings without enabling either new model',()=>{
  for(const [input,brightness,dynamicRange,gamma] of [[undefined,.5,.5,2.2],[{},.3,.2,2.2],[{gamma:3},.3,.2,3]] as const){
   const out=parse(input);expect(out.scene.settings).toMatchObject({normalizedBrightness:brightness,normalizedDynamicRange:dynamicRange,normalizedGamma:gamma,normalizedContrast:1,normalizedSaturation:.8,samilaHistoryModel:'legacy-v1'});
   expect(out.scene.settings.densityToneModel).not.toBe('samila-normalized-v2');expect(out.source).toEqual(source(input));
   expect(out.scene.settings.brightness).toBe(0);expect(out.scene.settings.dynamicRange).toBe(32);
   if(input&&'gamma'in input)expect(out.scene.settings.gamma).toBe(3);
  }
 });
 it('copies all finite source values exactly and keeps the compatible old fields',()=>{
  const out=parse({brightness:.7,contrast:1.3,gamma:2.6,dynamic_range:.4,saturation:.9});
  expect(out.scene.settings).toMatchObject({normalizedBrightness:.7,normalizedContrast:1.3,normalizedGamma:2.6,normalizedDynamicRange:.4,normalizedSaturation:.9,brightness:.7,contrast:1.3,gamma:2.6,dynamicRange:.4,saturation:.9});
  expect(out.warnings.join()).not.toContain('使用 8');
 });
 it('keeps extended finite constructor values and warns for each local preview clamp',()=>{
  const out=parse({gamma:9,brightness:1.2});expect(out.scene.settings).toMatchObject({gamma:8,brightness:1,normalizedGamma:9,normalizedBrightness:1.2});expect(out.warnings.join()).toContain('兼容白点模型使用 8');expect(out.warnings.join()).toContain('兼容白点模型使用 1');
  const scene=small(out.scene);expect(generateScene(scene,context).stats.samples).toBe(64);scene.settings=initializeSamilaTone(scene.settings);expect(generateScene(scene,context).stats.samples).toBe(64);
 });
 it('retains unsupported v2 values dormant and makes activation errors repairable',()=>{
  const out=parse({contrast:.05,dynamic_range:.01,saturation:2,gamma:100,brightness:5}),scene=small(out.scene);
  expect(scene.settings).toMatchObject({normalizedContrast:.05,normalizedDynamicRange:.01,normalizedSaturation:2,normalizedGamma:100,normalizedBrightness:5,gamma:8,brightness:1});expect(out.warnings.filter(w=>w.includes('启用归一调色后需调整超范围值'))).toHaveLength(5);
  expect(generateScene(scene,context)).toMatchObject({type:'raster'});scene.settings=initializeSamilaTone(scene.settings);expect(()=>generateScene(scene,context)).toThrow(/normalized/);
  Object.assign(scene.settings,{normalizedContrast:1,normalizedDynamicRange:.5,normalizedSaturation:.8,normalizedGamma:2.2,normalizedBrightness:.5});expect(generateScene(scene,context)).toMatchObject({type:'raster'});
 });
 it('preserves explicit zeros rather than replacing them with defaults',()=>{
  const out=parse({brightness:0,contrast:0,gamma:0,dynamic_range:0,saturation:0});expect(out.scene.settings).toMatchObject({normalizedBrightness:0,normalizedContrast:0,normalizedGamma:0,normalizedDynamicRange:0,normalizedSaturation:0,gamma:.1,dynamicRange:.001});
  expect(out.warnings.filter(w=>w.includes('启用归一调色后需调整超范围值'))).toHaveLength(3);
 });
 it('rejects malformed settings containers, wrong scalar types and nonfinite expressions',()=>{
  for(const settings of [null,[],true,'oops',3])expect(()=>parse(settings)).toThrow('settings 应为对象');
  for(const gamma of [null,[],{},true,'1/0','sqrt(-1)'])expect(()=>parse({gamma})).toThrow(/gamma/);
  for(const gamma of [Infinity,NaN])expect(()=>importSamilaTone({gamma})).toThrow('有限');
  expect(()=>importSamilaTone({gamma:'3'}as unknown as SamilaToneSource)).toThrow('有限');
 });
 it('uses Reader alias/expression provenance and leaves unrelated children visible',()=>{
  const input={dynamic_range:'a/10',dynamicRange:.9,gamma:'a',future_tone:{value:17}},out=parse(input);
  expect(out.scene.settings).toMatchObject({normalizedDynamicRange:.3,normalizedGamma:3,dynamicRange:.3,gamma:3});expect(out.source).toEqual(source(input));expect(out.warnings.join()).toContain('别名冲突');expect(out.warnings.join()).toContain('settings.future_tone.value');
 });
 it('roundtrips dormant and explicit model values with real generation and restores v1 pixels',()=>{
  const out=parse({brightness:.4,gamma:3,dynamic_range:.6,saturation:.7,unknown_source:'retained'}),scene=small(out.scene),before=generateScene(scene,context);
  const saved=JSON.parse(JSON.stringify({scene,source:out.source})),restored=parseScene(JSON.stringify(saved.scene));expect(saved.source).toEqual(out.source);expect(restored.settings).toEqual(scene.settings);expect(pixels(generateScene(restored,context))).toEqual(pixels(before));
  restored.settings=initializeSamilaTone(restored.settings);const v2=parseScene(JSON.stringify(restored));expect(v2.settings).toMatchObject({normalizedBrightness:.4,normalizedGamma:3,densityToneModel:'samila-normalized-v2',samilaHistoryModel:'bounded-v2'});expect(generateScene(v2,context)).toMatchObject({type:'raster'});
  v2.settings.densityToneModel='white-point-v1';v2.settings.samilaHistoryModel='legacy-v1';expect(pixels(generateScene(v2,context))).toEqual(pixels(before));
 });
 it('keeps legacy omission pixels independent of new dormant constructor defaults',()=>{
  const absent=small(parse().scene),empty=small(parse({}).scene);expect(pixels(generateScene(absent,context))).toEqual(pixels(generateScene(empty,context)));
  for(const key of Object.keys(empty.settings))if(key.startsWith('normalized'))delete empty.settings[key];expect(pixels(generateScene(empty,context))).toEqual(pixels(generateScene(absent,context)));
 });
});
