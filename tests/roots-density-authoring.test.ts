import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi} from 'vitest';
import type {SceneDocument,Settings} from '../src/types';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {parseProjectFile,parseLegacyScene} from '../src/engine/legacyImport';
import {definitions} from '../src/scenes';
import {copyRootsManualColors,rootsAppearanceControlVisible,visibleRootsControls,withRootsDensityColorVersion} from '../src/engine/rootsControls';
import {DEFAULT_ROOTS_SOURCE_COLORS,prepareRootsDensityColor,ROOTS_DENSITY_COLOR_VERSION,usesRootsSourceDensity} from '../src/engine/rootsDensityColor';
import {RootsDensityColorControls,RootsSourcePaletteEditor} from '../src/components/RootsDensityColorControls';
import {I18nProvider} from '../src/i18n';
const definition=definitions.find(x=>x.kind==='roots')!;
const scene=(settings:Settings={})=>{const s=createScene(definition);s.settings={...s.settings,...settings};return s;};
const raw=(patch:Record<string,unknown>={})=>({config_version:'1.0.0',type:'COMPLEX_ROOTS',name:'Metric source',polynomial:{variable:'z',coefficients:{1:'1',0:'-1'}},root_parameters:{t2:{domain:'FIXED',re:.25,im:.5}},sampling:{sample_count:16},...patch});
const imported=(value:unknown)=>parseProjectFile(JSON.stringify(value));
const markup=(s:SceneDocument,palette=false)=>renderToStaticMarkup(createElement(I18nProvider,{language:'zh',children:createElement(palette?RootsSourcePaletteEditor:RootsDensityColorControls,{scene:s,onChange:()=>{}})}));
describe('Roots metric density authoring and source file boundary',()=>{
 it('keeps every existing root definition and preset on omitted local color rules',()=>{
  for(const preset of [undefined,...definition.presets]){const loaded=parseScene(JSON.stringify(createScene(definition,preset)));expect(loaded.settings.rootDensityColorVersion).toBeUndefined();expect(loaded.rootsSourcePalette).toBeUndefined();expect(usesRootsSourceDensity(loaded.settings)).toBe(false);expect(prepareRootsDensityColor(loaded).kind).toBe('rgb-sum');}
 });
 it('switches only the explicit version and keeps source inactive in single mode',()=>{
  const s=scene({exposure:3,gamma:4,brightness:-.7,paletteMode:'density',transparentBackground:true});s.palette={...s.palette,mode:'cosine',offset:.31,cycles:3};const before=structuredClone(s),source=withRootsDensityColorVersion(s,ROOTS_DENSITY_COLOR_VERSION);
  expect(source.rootsSourcePalette).toBeUndefined();expect(source.palette).toEqual(s.palette);expect(source.settings).toEqual({...s.settings,rootDensityColorVersion:ROOTS_DENSITY_COLOR_VERSION});expect(s).toEqual(before);
  const restored=withRootsDensityColorVersion(source,'local-rgb-v1');expect({...restored.settings,rootDensityColorVersion:undefined}).toEqual({...before.settings,rootDensityColorVersion:undefined});expect(usesRootsSourceDensity(source.settings)).toBe(false);expect(markup(source)).toContain('当前单次根图仍使用本地颜色');expect(markup(source)).not.toContain('control-rootSourceBrightness');expect(parseScene(JSON.stringify(source)).settings.rootDensityColorVersion).toBe(ROOTS_DENSITY_COLOR_VERSION);
 });
 it('copies manual colors only on explicit command without baking a rich palette',()=>{
  const s=withRootsDensityColorVersion(scene(),ROOTS_DENSITY_COLOR_VERSION);s.palette={...s.palette,mode:'cosine',cycles:4,offset:.6};const before=structuredClone(s),copied=copyRootsManualColors(s);
  expect(copied.rootsSourcePalette).toEqual({colors:s.palette.stops});expect(copied.palette).toEqual(s.palette);expect(s).toEqual(before);expect(withRootsDensityColorVersion(copied,'local-rgb-v1').rootsSourcePalette).toEqual(copied.rootsSourcePalette);
 });
 it('imports new native source density and retains inactive local tones, palette and original',()=>{
  const input=raw({palette:['#80112233','0xFF123456','not-a-color'],settings:{brightness:'1/2',gamma:7,dynamic_range:.8}}),s=imported(input).scene;
  expect(s.settings).toMatchObject({rootsMode:'progressive',rootDensityColorVersion:ROOTS_DENSITY_COLOR_VERSION,rootColor:'t2_imag',rootSourceBrightness:.5,rootSourceGamma:7,rootSourceDynamicRange:Math.fround(.8)});
  expect(s.rootsSourcePalette?.colors).toEqual(['#80112233','0xFF123456','not-a-color']);expect(s.palette).toEqual(createScene(definition).palette);expect(s.settings.brightness).toBe(createScene(definition).settings.brightness);expect(s.settings.gamma).toBe(createScene(definition).settings.gamma);expect(s.provenance?.original).toEqual(input);
  const prepared=prepareRootsDensityColor(s);expect(prepared.kind).toBe('metric-sum');if(prepared.kind==='metric-sum')expect(prepared.diagnostics.join()).toContain('白色');
 });
 it('materializes project defaults while retaining source omission and direct runtime defaults',()=>{
  const input=raw(),project=imported(input).scene,runtime=parseLegacyScene(JSON.stringify(input)).scene,projectColors=['#FC6255','#FF862F','#FFFF00','#59743E','#83C167','#1D4A81','#9A72AC'];
  expect(project.rootsSourcePalette).toEqual({colors:projectColors});expect(project.provenance?.original).toEqual(input);expect(project.provenance?.original).not.toHaveProperty('palette');
  expect(runtime.rootsSourcePalette).toBeUndefined();expect(prepareRootsDensityColor(runtime)).toEqual(prepareRootsDensityColor({...runtime,rootsSourcePalette:{colors:[...DEFAULT_ROOTS_SOURCE_COLORS]}}));
  const projectPlan=prepareRootsDensityColor(project);expect(projectPlan).toEqual(prepareRootsDensityColor({...runtime,rootsSourcePalette:{colors:projectColors}}));if(projectPlan.kind!=='metric-sum')throw new Error('source');expect(Array.from(projectPlan.lut.slice(0,4))).toEqual([252,98,85,255]);
  for(const s of [project,runtime]){const saved=JSON.stringify(persistentScene(s));expect(parseScene(saved).rootsSourcePalette).toEqual(s.rootsSourcePalette);expect(imported(JSON.parse(saved)).scene.rootsSourcePalette).toEqual(s.rootsSourcePalette);}
 });
 it('retains empty and singleton palettes through both source entry points and canonical reload',()=>{
  for(const colors of [[],['#123456']])for(const parse of [parseProjectFile,parseLegacyScene]){const s=parse(JSON.stringify(raw({palette:colors}))).scene;expect(s.rootsSourcePalette).toEqual({colors});expect(parseScene(JSON.stringify(persistentScene(s))).rootsSourcePalette).toEqual({colors});if(parse===parseProjectFile)expect(s.provenance?.original).toMatchObject({palette:colors});const plan=prepareRootsDensityColor(s);if(plan.kind!=='metric-sum')throw new Error('source');expect(Array.from(plan.lut.slice(0,4))).toEqual(colors.length?[18,52,86,255]:[255,255,255,255]);}
 });
 it.each([null,{},'red',[null],[1],[true]])('rejects malformed native palette structure %j',palette=>{expect(()=>imported(raw({palette}))).toThrow();});
 it('preserves recoverable invalid strings rather than replacing source content',()=>{const s=imported(raw({palette:['BAD','#123456']})).scene;expect(parseScene(JSON.stringify(persistentScene(s))).rootsSourcePalette).toEqual({colors:['BAD','#123456']});expect(markup(s,true)).toContain('BAD');});
 it('normalizes source metric aliases and unknown fallback',()=>{
  for(const [color_metric,rootColor]of [[' ROOT.RADIO ','radius'],['RE(T2)','t2_real'],['abs(z)','t2_imag'],['unknown','t2_imag']]){const result=imported(raw({settings:{color_metric}}));expect(result.scene.settings.rootColor).toBe(rootColor);expect(result.scene.provenance?.original).toEqual(raw({settings:{color_metric}}));if(color_metric==='abs(z)')expect(result.warnings.join()).toContain('采用 im(t2)');}
 });
 it('uses ConfigUtils grammar, recovery, F32 and finite overflow clamps',()=>{
  const result=imported(raw({settings:{brightness:'1 + 1',contrast:'sin(',gamma:null,dynamic_range:true,saturation:'1e999'}}));expect(result.scene.settings).toMatchObject({rootSourceBrightness:2,rootSourceContrast:0,rootSourceGamma:Math.fround(2.2),rootSourceDynamicRange:0,rootSourceSaturation:1});expect(result.warnings.join()).toContain('原值');expect(parseScene(JSON.stringify(result.scene)).settings).toEqual(result.scene.settings);expect(()=>imported(raw({settings:{brightness:'NaN'}}))).toThrow();
 });
 it('does not invent an unsupported JSON palette_offset mapping',()=>{const result=imported(raw({settings:{palette_offset:.75}}));expect(result.scene.settings.rootSourcePaletteOffset).toBeUndefined();expect(result.warnings.join()).toContain('settings.palette_offset');});
 it('uses source black for absent/null background and preserves string spellings',()=>{
  for(const settings of [{},{background_color:null},{background_color:'#80112233'},{background_color:'not-a-color'}]){const s=imported(raw({settings})).scene;expect(s.settings.background).toBe(settings.background_color??'#000000');expect(parseScene(JSON.stringify(s)).settings.background).toBe(s.settings.background);}
  for(const background_color of [false,true,[],{}]){const result=imported(raw({settings:{background_color}}));expect(result.scene.settings.background).toBe('#FFFFFF');expect(result.warnings.join()).toContain('非字符串');}
 });
 it.each([['1',[0,0,Math.fround(1/255)]],['1.0',[1,1,1]],['1e0',[1,1,1]],['-0',[0,0,0]],['-0.0',[1,1,1]],['9007199254740993',[1,1,1]],['1e999',[1,1,1]],['-65536',[1,0,0]]])('retains consumed background token %s through both import APIs and save', (token,rgb)=>{
  const text=JSON.stringify(raw({settings:{background_color:'TOKEN'}})).replace('"TOKEN"',token),result=parseProjectFile(text),s=result.scene,records=[{path:['settings','background_color'],token}];
  expect(s.settings.background).toBe(token);expect(s.provenance?.sourceNumberTokens).toEqual(records);expect(parseLegacyScene(text).sourceNumberTokens).toEqual(records);
  const plan=prepareRootsDensityColor(s);if(plan.kind!=='metric-sum')throw new Error('source');expect(plan.backgroundRGB).toEqual(rgb);
  const saved=parseScene(JSON.stringify(persistentScene(s)));expect(saved.settings.background).toBe(token);expect(saved.provenance?.sourceNumberTokens).toEqual(records);if(token==='1e999'||token==='9007199254740993')expect(result.warnings.join()).toContain('不能保证精确往返');
 });
 it('binds numeric lexemes to the actual chosen alias and preserves comments',()=>{
  const text='// source numeric color\n'+JSON.stringify(raw({settings:{backgroundColor:'TOKEN'}})).replace('"TOKEN"','1.0'),s=parseProjectFile(text).scene;expect(s.provenance?.sourceNumberTokens).toEqual([{path:['settings','backgroundColor'],token:'1.0'}]);expect(s.settings.background).toBe('1.0');
 });
 it.each([['1','1.0'],['1.0','1']])('reports conflicting alias number classes %s / %s without acknowledging the unused alias', (chosen,other)=>{
  const text=JSON.stringify(raw({settings:{background_color:'CHOSEN',backgroundColor:'OTHER'}})).replace('"CHOSEN"',chosen).replace('"OTHER"',other),result=parseProjectFile(text);
  expect(result.scene.settings.background).toBe(chosen);expect(result.scene.provenance?.sourceNumberTokens).toEqual([{path:['settings','background_color'],token:chosen}]);expect(result.warnings.some(w=>w.startsWith('别名冲突：')&&w.includes('settings.background_color')&&w.includes('settings.backgroundColor'))).toBe(true);expect(result.warnings.some(w=>w.startsWith('以下字段尚未映射')&&w.includes('settings.backgroundColor'))).toBe(true);
 });
 it('preserves numeric spellings without relying on runtime reviver context',()=>{
  const actual=JSON.parse,spy=vi.spyOn(JSON,'parse').mockImplementation((text,reviver)=>actual(text,function(key,value){return reviver?reviver.call(this,key,value):value;}));
  try{expect(imported(raw({settings:{background_color:1}})).scene.provenance?.sourceNumberTokens).toEqual([{path:['settings','background_color'],token:'1'}]);expect(imported(raw({settings:{background_color:'#123456'}})).scene.settings.background).toBe('#123456');}finally{spy.mockRestore();}
 });
 it('validates the small lexical provenance extension without rewriting original values',()=>{
  const s=imported(raw()).scene;for(const sourceNumberTokens of [null,{},[{path:['settings','other'],token:'1'}],[{path:['settings','background_color'],token:'01'}],[{path:['settings','background_color'],token:'1'}, {path:['settings','backgroundColor'],token:'2'}]])expect(()=>parseScene(JSON.stringify({...s,provenance:{...s.provenance,sourceNumberTokens}}))).toThrow();
 });
 it('validates source structures even in inactive single mode',()=>{
  const s=scene();for(const rootDensityColorVersion of ['wrong',null,17])expect(()=>parseScene(JSON.stringify({...s,settings:{...s.settings,rootDensityColorVersion}}))).toThrow();for(const rootSourceGamma of ['2.2',true,null])expect(()=>parseScene(JSON.stringify({...s,settings:{...s.settings,rootSourceGamma}}))).toThrow();for(const rootsSourcePalette of [null,{},[],{colors:[false]}])expect(()=>parseScene(JSON.stringify({...s,rootsSourcePalette}))).toThrow();expect(()=>parseScene(JSON.stringify({...s,kind:'domain',rootsSourcePalette:{colors:[]}}))).toThrow('仅适用于');
 });
 it('strips delivered facts but keeps authored palette and out-of-range finite values',()=>{
  const s={...scene({rootSourceGamma:50}),rootsSourcePalette:{colors:['#80112233']},rootsColor:{version:ROOTS_DENSITY_COLOR_VERSION,submittedFinitePointCount:999}};expect(persistentScene(s)).not.toHaveProperty('rootsColor');const loaded=parseScene(JSON.stringify(s));expect(loaded).not.toHaveProperty('rootsColor');expect(loaded.rootsSourcePalette).toEqual(s.rootsSourcePalette);expect(loaded.settings.rootSourceGamma).toBe(50);
 });
 it('hides only inactive source controls and explains the retained timeline',()=>{
  const s=scene({rootsMode:'progressive',rootDensityColorVersion:ROOTS_DENSITY_COLOR_VERSION}),sourceKeys=visibleRootsControls(definition.controls,s.settings).map(c=>c.key),localKeys=visibleRootsControls(definition.controls,{rootsMode:'progressive'}).map(c=>c.key);
  for(const key of ['exposure','toneMap','gamma','brightness','contrast','saturation','dynamicRange','paletteMode','transparentBackground']){expect(sourceKeys).not.toContain(key);expect(localKeys).toContain(key);}for(const key of ['pointSize','opacity','colorMetric','wireframe'])expect(rootsAppearanceControlVisible(s,key)).toBe(false);expect(rootsAppearanceControlVisible(s,'showGrid')).toBe(true);expect(markup(s)).toContain('control-rootSourceBrightness');expect(markup(s)).toContain('control-rootSourcePaletteOffset');expect(markup(s)).toContain('本地色板、曝光');
 });
});
