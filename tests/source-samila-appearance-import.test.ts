import {describe,it,expect} from 'vitest';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {DEFAULT_SOURCE_SURFACE_COLORS} from '../src/engine/sourceSurfaceColor';
const raw=(patch:Record<string,unknown>={})=>({config_version:'1.0.0',type:'SAMILA',name:'Source appearance',...patch});
const parse=(patch:Record<string,unknown>={})=>parseProjectFile(JSON.stringify(raw(patch)));
describe('source Samila appearance import',()=>{
 it('distinguishes base and JSON defaults and keeps literal F32 values',()=>{
  const base=parse().scene,json=parse({settings:{}}).scene;
  expect(base.settings).toMatchObject({samilaSplatModel:'samila-splat-1.7.8',batchSize:262144,normalizedBrightness:.5,normalizedDynamicRange:.5,samilaSpotSize:Math.fround(.01),iteratedBackend:'gpu'});
  expect(json.settings).toMatchObject({normalizedBrightness:Math.fround(.3),normalizedDynamicRange:Math.fround(.2),normalizedGamma:Math.fround(2.2),colorPhase:180});
  const {scene}=parse({settings:{batch_size:'3',spot_size:'0x1p-2',alpha:'PI',gamma:-2,trail_lifetime:0,show_trails:'FALSE'}});
  expect(scene.settings).toMatchObject({batchSize:3,samilaSpotSize:.25,alpha:Math.fround(.1),normalizedGamma:-2,trailLifetime:0,showTrails:false});
  expect(()=>parse({settings:{spot_size:'Infinity'}})).toThrow('有限 Float32');
 });
 it('reads only root palette and active spot_size, retaining dormant generic fields',()=>{
  const value=raw({palette:['#80ff0000','invalid','0x123456'],color:{use_cosine_palette:true,use_curve_palette:true},settings:{dot_size:'bad',render_mode:'bad',spot_size:.03}}),result=parseProjectFile(JSON.stringify(value));
  expect(result.scene.palette).toMatchObject({mode:'linear',cycles:1,stops:['#ff0000','#ffffff','#123456']});
  expect(result.scene.settings.samilaSpotSize).toBe(Math.fround(.03));expect(result.scene.settings.iteratedBackend).toBe('gpu');
  expect(result.scene.provenance?.original).toEqual(value);
  expect(parse().scene.palette.stops).toEqual(DEFAULT_SOURCE_SURFACE_COLORS.map(c=>c.toLowerCase()));
 });
 it('preserves empty palette fallback through saving and reopening',()=>{
  const scene=parse({palette:[]}).scene;expect(scene.settings.samilaUsePaletteLut).toBe(false);
  const reopened=parseScene(serializeScene(scene));expect(reopened.settings.samilaUsePaletteLut).toBe(false);expect(reopened.palette).toEqual(scene.palette);
  expect(parse({palette:['#abc']}).scene.palette.stops).toEqual(['#0ffabc','#0ffabc']);
  for(const palette of [null,{},[1]])expect(()=>parse({palette})).toThrow('字符串数组');
 });
 it('keeps previous saved rendering versions opt-in and preserves numeric provenance',()=>{
  const text=JSON.stringify(raw({settings:{batch_size:1,spot_size:.03,alpha:-0.0}})).replace('"alpha":0','"alpha":-0.0');
  const scene=parseLegacyScene(text,{samilaSplat:'legacy-v1'}).scene;expect(scene.settings.samilaSplatModel).toBeUndefined();
  expect(parseScene(serializeScene(scene)).settings).toEqual(scene.settings);
  const result=parseProjectFile(text);expect(Object.is(result.scene.settings.alpha,-0)).toBe(true);
  expect(result.scene.provenance?.sourceNumberTokens).toContainEqual({path:['settings','alpha'],token:'-0.0'});
  expect(()=>parse({settings:{batch_size:8000001}})).toThrow('容量');
 });
 it('rejects edited documents with incompatible source rendering contracts at load',()=>{
  const scene=parse({settings:{batch_size:8}}).scene;
  for(const patch of [{samilaSplatModel:'unknown'},{samilaUsePaletteLut:'false'},{densityToneModel:'white-point-v1'},{samilaHistoryModel:'legacy-v1'},{samilaSpotSize:1e100}]){
   const value={...scene,settings:{...scene.settings,...patch}};expect(()=>parseScene(JSON.stringify(value))).toThrow();
  }
  expect(()=>parseScene(JSON.stringify({...scene,palette:{...scene.palette,cycles:2}}))).toThrow('cycles');
 });

 it('reads source background aliases and packed colors without consuming generic aliases',()=>{
  expect(parse({settings:{bgcolor:'#80ff0000'}}).scene.settings.background).toBe('#ff0000');
  expect(parse({settings:{background_color:'0x123456',bgcolor:'#ff0000'}}).scene.settings.background).toBe('#123456');
  expect(parse({settings:{background_color:null,bgcolor:'#ff0000'}}).scene.settings.background).toBe('#000000');
  expect(parse({settings:{backgroundColor:'#ff0000'}}).scene.settings.background).toBe('#000000');
  expect(parse({settings:{background_color:255}}).scene.settings.background).toBe('#0000ff');
  expect(parseProjectFile(JSON.stringify(raw({settings:{bgcolor:255}})).replace(':255',':255.0')).scene.settings.background).toBe('#ffffff');
  expect(parseScene(serializeScene(parse({settings:{bgcolor:255}}).scene)).settings.background).toBe('#0000ff');
 });

});
