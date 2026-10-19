import {describe,it,expect} from 'vitest';
import fixture from './fixtures/source-attractor/visual.json';
import {importSourceAttractorVisualConfig,parseSourceAttractorVisualConfiguration,prepareSourceAttractorInitialColors,SOURCE_ATTRACTOR_PALETTE_LIMITS,type SourceAttractorPalette} from '../src/engine/sourceAttractorVisualConfig';
function visual(settings?:unknown,palette?:unknown){const r=importSourceAttractorVisualConfig(settings,palette);if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;}
function colors(palette:SourceAttractorPalette,count:number){const r=prepareSourceAttractorInitialColors(palette,count);if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;}
function value(palette:SourceAttractorPalette,count:number,index:number){const r=colors(palette,count).colorAt(index);if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;}
describe('source Attractor visual configuration',()=>{
 for(const present of [false,true])it(`retains native defaults for settings ${present?'present':'absent'}`,()=>{
  const c=visual(present?{}:undefined).configuration,expected=present?fixture.defaults.settingsPresent:fixture.defaults.settingsAbsent;
  expect(c.points).toEqual({dotRadius:expected.dotRadius,fadePoints:expected.fadePoints});
  expect(c.trails).toEqual({lineWeight:expected.lineWeight,lifetime:expected.lifetime,show:expected.show,fade:expected.fade});
  expect(c.settingsPresence).toBe(present?'object':'absent');expect(c.palette).toEqual({kind:'absent'});
 });
 it('parses ConfigUtils scalars, preserves negative radius/width/lifetime and ignores unread fields',()=>{
  const result=visual({dot_size:'-PI',line_weight:-3,trail_lifetime:'-1/8',show_trails:'FALSE',fade_trails:'TrUe',fade_points:true,palette:['#000000']},['#ff0000']);
  expect(result.configuration.points).toEqual({dotRadius:Math.fround(-Math.PI),fadePoints:false});
  expect(result.configuration.trails).toEqual({lineWeight:-3,lifetime:-.125,show:false,fade:true});
  expect(result.configuration.palette).toEqual({kind:'colors',colors:['#ff0000']});
  expect(result.consumedPaths).not.toContainEqual(['settings','fade_points']);expect(result.consumedPaths).not.toContainEqual(['settings','palette']);
  expect(result.numericPaths).toEqual([['settings','line_weight']]);
 });
 it('distinguishes null scalar defaults from invalid expressions and strict boolean failure',()=>{
  expect(visual({dot_size:null,line_weight:null,trail_lifetime:null}).configuration).toMatchObject({points:{dotRadius:2},trails:{lineWeight:Math.fround(.8),lifetime:3}});
  const invalid=visual({dot_size:'nonsense',line_weight:true,trail_lifetime:[]});
  expect(invalid.configuration).toMatchObject({points:{dotRadius:0},trails:{lineWeight:0,lifetime:0}});expect(invalid.diagnostics).toHaveLength(3);
  for(const key of ['show_trails','fade_trails'])for(const value of [null,1,{},' true '])expect(importSourceAttractorVisualConfig({[key]:value},undefined).ok).toBe(false);
 });
 it('preserves palette omission/empty/raw invalid text without borrowing Surface empty-palette rejection',()=>{
  expect(visual(undefined,[]).configuration.palette).toEqual({kind:'colors',colors:[]});
  const input=['bogus','#00112233','123'];const result=visual(undefined,input);input[0]='#ffffff';
  expect(result.configuration.palette).toEqual({kind:'colors',colors:['bogus','#00112233','123']});
  expect(result.consumedPaths).toEqual([['palette']]);
  for(const input of [null,{},'red',[1],[null],[true]])expect(importSourceAttractorVisualConfig(undefined,input).ok).toBe(false);
 });
 it('clones saved visual configuration and rejects unknown schema, nonfinite values and unsupported fadePoints',()=>{
  const original=visual({},['#ffffff']).configuration,r=parseSourceAttractorVisualConfiguration(original);if(!r.ok)throw Error(JSON.stringify(r.error));
  original.points.dotRadius=77;original.trails.lifetime=99;if(original.palette.kind==='colors')original.palette.colors[0]='#000000';
  expect(r.value).toEqual(visual({},['#ffffff']).configuration);
  for(const bad of [{...original,extra:1},{...original,model:'local-v1'},{...original,points:{dotRadius:2,fadePoints:true}},{...original,trails:{...original.trails,show:'true'}},{...original,palette:{kind:'absent',colors:[]}},{...original,points:{dotRadius:Infinity,fadePoints:false}}])expect(parseSourceAttractorVisualConfiguration(bad).ok).toBe(false);
  expect(importSourceAttractorVisualConfig({dot_size:'1/0'},undefined)).toMatchObject({ok:false,error:{kind:'nonfinite'}});
  expect(importSourceAttractorVisualConfig({line_weight:'x'.repeat(65537)},undefined)).toMatchObject({ok:false,error:{kind:'capacity'}});
 });
 it('imports GPU tone with source defaults, ConfigUtils expressions, Float32 clamps and consumed paths',()=>{
  const defaults={exposure:8,contrast:1,gamma:Math.fround(2.2),saturation:Math.fround(.82),densityScale:1};
  for(const settings of [undefined,{}, {gpu_exposure:null,gpu_gamma:null}])expect(visual(settings).configuration.gpuTone).toEqual(defaults);
  const imported=visual({gpu_exposure:'128/2',gpu_contrast:-1,gpu_gamma:'PI',gpu_saturation:3,gpu_density_scale:'1/4',density_scale:99});
  expect(imported.configuration.gpuTone).toEqual({exposure:64,contrast:Math.fround(.1),gamma:Math.fround(Math.PI),saturation:2,densityScale:.25});
  expect(imported.consumedPaths).toEqual(['gpu_exposure','gpu_contrast','gpu_gamma','gpu_saturation','gpu_density_scale'].map(key=>['settings',key]));
  expect(imported.numericPaths).toEqual([['settings','gpu_contrast'],['settings','gpu_saturation']]);
  expect(visual({gpu_exposure:'bad',gpu_contrast:[],gpu_gamma:true,gpu_saturation:'-1',gpu_density_scale:99}).configuration.gpuTone).toEqual({exposure:Math.fround(.1),contrast:Math.fround(.1),gamma:Math.fround(.1),saturation:0,densityScale:4});
 });
 it('uses the lower bound for nonfinite source tone, while leaving nonfinite CPU radius rejected',()=>{
  const fields=['gpu_exposure','gpu_contrast','gpu_gamma','gpu_saturation','gpu_density_scale'];
  for(const value of ['1/0','-1/0','0/0',1e300])expect(visual(Object.fromEntries(fields.map(key=>[key,value]))).configuration.gpuTone).toEqual({exposure:Math.fround(.1),contrast:Math.fround(.1),gamma:Math.fround(.1),saturation:0,densityScale:Math.fround(.1)});
  expect(importSourceAttractorVisualConfig({dot_size:'1/0'},undefined)).toMatchObject({ok:false,error:{kind:'nonfinite'}});
  expect(importSourceAttractorVisualConfig({gpu_gamma:'x'.repeat(65537)},undefined)).toMatchObject({ok:false,error:{kind:'capacity',path:['settings','gpu_gamma']}});
 });
 it('migrates only omitted saved GPU tone once and owns strict finite normalized copies',()=>{
  const current=visual({}).configuration,{gpuTone,...legacy}=current;
  const migrated=parseSourceAttractorVisualConfiguration(legacy);expect(migrated).toEqual({ok:true,value:current});expect(legacy).not.toHaveProperty('gpuTone');
  if(!migrated.ok)throw Error('migration');expect(parseSourceAttractorVisualConfiguration(migrated.value)).toEqual(migrated);
  const input={...current,gpuTone:{...gpuTone,exposure:100,gamma:2.1,saturation:-0}},parsed=parseSourceAttractorVisualConfiguration(input);expect(parsed.ok).toBe(true);if(!parsed.ok)throw Error('tone');
  expect(parsed.value.gpuTone).toEqual({...gpuTone,exposure:64,gamma:Math.fround(2.1),saturation:0});expect(Object.is(parsed.value.gpuTone.saturation,0)).toBe(true);
  input.gpuTone.gamma=9;expect(parsed.value.gpuTone.gamma).toBe(Math.fround(2.1));
  for(const tone of [undefined,null,{}, {...gpuTone,extra:1},{...gpuTone,gamma:'2.2'},{...gpuTone,gamma:Infinity},{...gpuTone,gamma:NaN}])expect(parseSourceAttractorVisualConfiguration({...current,gpuTone:tone}).ok).toBe(false);
 });
 it('enforces explicit input budgets before preparing or allocating palette data',()=>{
  for(const input of [new Array(SOURCE_ATTRACTOR_PALETTE_LIMITS.colors+1).fill('#000000'),['x'.repeat(SOURCE_ATTRACTOR_PALETTE_LIMITS.characters+1)]])expect(importSourceAttractorVisualConfig(undefined,input)).toMatchObject({ok:false,error:{kind:'capacity'}});
  expect(prepareSourceAttractorInitialColors({kind:'colors',colors:new Array(SOURCE_ATTRACTOR_PALETTE_LIMITS.colors+1).fill('#000000')},1)).toMatchObject({ok:false,error:{kind:'capacity'}});
 });
});
describe('source Attractor initial Manim palette sampling',()=>{
 for(const row of fixture.cases)it(`matches independent packed color arithmetic: ${row.id}`,()=>{
  const p=colors({kind:'colors',colors:row.colors},row.count);expect(p.count).toBe(row.count);
  for(const sample of row.samples)expect(p.colorAt(sample.index)).toEqual({ok:true,value:sample.packed});
  expect(p.colorAt(row.count)).toMatchObject({ok:false,error:{kind:'input'}});
 });
 it('preserves multiply-before-divide rather than normalizing the slot first',()=>{
  const row=fixture.operationOrderWitness,actual=value({kind:'colors',colors:row.colors},row.count,row.index);
  expect(actual).toBe(row.packed);expect(actual).not.toBe(row.normalizedFirst);
 });
 it('uses final color for count 1, and defaults both absent and empty cache palettes',()=>{
  const p={kind:'colors',colors:['#FF000000','#FFFFFFFF','#FF123456']} as const;
  expect(value({kind:p.kind,colors:[...p.colors]},1,0)).toBe(0xff123456);
  const absent=colors({kind:'absent'},7),empty=colors({kind:'colors',colors:[]},7);
  expect(absent.packedPalette).toEqual(empty.packedPalette);for(let i=0;i<7;i++)expect(absent.colorAt(i)).toEqual(empty.colorAt(i));
  expect(value({kind:'absent'},1,0)).toBe(0xff9a72ac);
 });
 it('returns raw packed ARGB, keeps zero alpha, and uses ConfigUtils white recovery with diagnostics',()=>{
  const p=colors({kind:'colors',colors:['invalid','#00112233']},2);expect(p.packedPalette).toEqual([0xffffffff,0x00112233]);expect(p.diagnostics).toHaveLength(1);
  expect(p.colorAt(1)).toEqual({ok:true,value:0x00112233});
  expect(value({kind:'colors',colors:['123']},1,0)).toBe(123);
 });
 it('owns frozen prepared palette facts without mutating saved source text',()=>{
  const input:SourceAttractorPalette={kind:'colors',colors:['#ff0000','#0000ff']},prepared=colors(input,3);
  input.colors[0]='#00ff00';expect(prepared.colorAt(0)).toEqual({ok:true,value:0xffff0000});
  expect(Object.isFrozen(prepared.packedPalette)).toBe(true);expect(Object.isFrozen(prepared.diagnostics)).toBe(true);
 });
 it('bounds all indices and counts while supporting zero or huge particle counts lazily',()=>{
  for(const count of [-1,1.5,NaN,Infinity,2147483648])expect(prepareSourceAttractorInitialColors({kind:'absent'},count)).toMatchObject({ok:false,error:{kind:'input'}});
  const p=colors({kind:'absent'},2147483647);expect(p.packedPalette).toHaveLength(6);
  for(const index of [-1,1.5,NaN,Infinity,2147483647])expect(p.colorAt(index)).toMatchObject({ok:false,error:{kind:'input'}});
  expect(p.colorAt(2147483646)).toEqual({ok:true,value:0xff9a72ac});expect(colors({kind:'absent'},0).colorAt(0).ok).toBe(false);
 });
});
