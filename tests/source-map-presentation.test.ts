import {describe,it,expect} from 'vitest';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {prepareSourceMapTone} from '../src/engine/sourceMapPresentation';
import {deriveSourceIteratedNormalization} from '../src/engine/sourceIteratedPresentation';
import {snapshotGenerationInput} from '../src/engine/generationInput';
import {prepareDensityGpuTone} from '../src/engine/densityGpuTone';
import {toneDensityRgbaPrepared} from '../src/engine/density';
import {generateIteratedDensity,visibleIteratedControls} from '../src/scenes/iteratedDensity';
import {normalizedDensityControls} from '../src/engine/densityNormalization';
import {importSourceMapFloat} from '../src/engine/sourceMapScalar';
const raw=(settings:Record<string,unknown>={})=>JSON.stringify({config_version:'1.0.0',type:'MAP_ATTRACTOR',name:'Map tone',equations:{x_next:'x',y_next:'y'},settings:{batch_size:4,burn_in_steps:0,...settings}});
describe('Map source final presentation boundary',()=>{
 it('versions new imports and preserves older splat-only saved scenes',()=>{
  for(const parse of [parseProjectFile,parseLegacyScene]){
   const scene=parseScene(serializeScene(parse(raw()).scene));expect(scene.settings.mapPresentationModel).toBe('map-present-1.7.8');
   expect(prepareSourceMapTone(scene,{width:9,height:7}).sourceMapPresentation?.referenceKind).toBe('local-output');
   const old=structuredClone(scene);delete old.settings.mapPresentationModel;expect(parseScene(serializeScene(old)).settings.mapPresentationModel).toBeUndefined();
  }
 });
 it('keeps primary reference independent of output dimensions and caller mutation',()=>{
  const scene=parseProjectFile(raw()).scene,reference={width:901,height:701};
  const context={time:0,quality:'export' as const,width:192,height:128,sourceMapToneReference:reference},copy=snapshotGenerationInput(context);
  const tone=prepareSourceMapTone(scene,context);reference.width=3;
  expect(copy.sourceMapToneReference).toEqual({width:901,height:701});expect(tone.sourceMapPresentation?.reference).toEqual({width:901,height:701});
  expect(tone.sourceMapPresentation?.referenceKind).toBe('primary-canvas');
  expect(()=>toneDensityRgbaPrepared(1,1,new Float32Array(4),tone)).toThrow('需要 GPU');
 });
 it('rejects malformed geometry and mismatched source model contracts',()=>{
  const scene=parseProjectFile(raw()).scene;
  for(const width of [0,.5,NaN,Infinity,16385])expect(()=>prepareSourceMapTone(scene,{width:9,height:7,sourceMapToneReference:{width,height:7}})).toThrow('尺寸');
  for(const key of ['mapSplatModel','mapMathModel']){const invalid=structuredClone(scene);delete invalid.settings[key];expect(()=>parseScene(serializeScene(invalid))).toThrow();}
  scene.settings.densityToneModel='white-point-v1';expect(()=>parseScene(serializeScene(scene))).toThrow('归一调色');
 });
 it('uses original Float32 reference ratio before the final scale rounding',()=>{
  const facts={kind:'map' as const,width:17,height:9,recordedPasses:3,batchSize:4096},reference={width:901,height:701};
  const expected=Math.fround(3*4096/(17*9)*Math.max(1e-6,Math.fround(17*9/(901*701))));
  expect(deriveSourceIteratedNormalization(facts,reference).scale).toBe(expected);
  expect(()=>deriveSourceIteratedNormalization({...facts,recordedPasses:-1},reference)).toThrow('批次');
 });
 it('does not expose manual reference or transparency for an already composited target',()=>{
  const scene=parseProjectFile(raw()).scene;
  const controls=visibleIteratedControls('map',scene.settings,normalizedDensityControls);
  expect(controls.some(x=>x.key==='transparentBackground'||x.key.startsWith('densityReference'))).toBe(false);
 });
 it('returns only the scene background before local replay start',()=>{
  const scene=parseProjectFile(raw({background_color:'#123456'})).scene;scene.settings.iteratedStartTime=1;
  const output=generateIteratedDensity(scene,{time:0,quality:'export',width:4,height:3,sourceViewport:{logicalWidth:4,logicalHeight:3,referenceLogicalHeight:3,target:'primary',projectionPass:'perspective'}});
  expect(output.type).toBe('raster');if(output.type!=='raster')return;
  expect(output.sourceMapPresentation?.model).toBe('map-present-1.7.8');expect(output.stats.samples).toBe(0);
  expect(Array.from(output.pixels)).toEqual(Array.from({length:12},()=>[18,52,86,255]).flat());
 });
 it('preserves separate shader RGB and Processing clear RGBA after edits and reopening',()=>{
  const scene=parseScene(serializeScene(parseProjectFile(raw({background_color:128,brightness:.123456789,contrast:1.1,gamma:2.1,dynamic_range:.3,saturation:.7,accumulation_decay:1.1})).scene));
  expect(scene.settings.background).toBe('#000080');expect(scene.settings.mapBackgroundAlpha).toBe(0);
  const job=prepareSourceMapTone(scene,{width:9,height:7});expect(job.background).toEqual([0,0,128/255]);expect(job.sceneBackground).toEqual([Math.fround(128/255),Math.fround(128/255),Math.fround(128/255),1]);
  scene.settings.background='#123456';scene.settings.mapBackgroundAlpha=128;
  const edited=prepareSourceMapTone(parseScene(serializeScene(scene)),{width:9,height:7});expect(edited.sceneBackground).toEqual([Math.fround(18/255),Math.fround(52/255),Math.fround(86/255),Math.fround(128/255)]);
  for(const value of [-1,256,.5]){scene.settings.mapBackgroundAlpha=value;expect(()=>parseScene(serializeScene(scene))).toThrow('alpha');}
 });
 it('preserves unused source palettes without applying local palette validation',()=>{
  const input=JSON.parse(raw());input.palette={unrecognized:true};input.color={use_cosine_palette:true,use_curve_palette:true};
  const parsed=parseProjectFile(JSON.stringify(input));expect(parsed.warnings.join()).toContain('固定余弦');
  const scene=parseScene(serializeScene(parsed.scene));expect(scene.provenance?.original).toEqual(input);
  expect(prepareSourceMapTone(scene,{width:9,height:7}).tone.paletteMode).toBe('source');
 });
 it('admits one matched source family and requires Map scene clear facts',()=>{
  const scene=parseProjectFile(raw()).scene,job=prepareSourceMapTone(scene,{width:9,height:7});
  expect(prepareDensityGpuTone(job).plan?.sourceFamily).toBe('map');
  const noClear={...job};delete noClear.sceneBackground;expect(prepareDensityGpuTone(noClear).reason).toContain('RGBA');
  expect(prepareDensityGpuTone({...job,sourcePresentation:{model:'samila-present-1.7.8'}}).reason).toContain('混用');
  if(job.model!=='normalized-v2')throw Error('test setup');
  expect(prepareDensityGpuTone({...job,normalization:{...job.normalization,kind:'symmetry'}}).reason).toContain('身份');
 });
 it('reads project float through getDouble narrowing, retaining JSON signed-zero rules',()=>{
  // Exact decimal lies just above a float midpoint, but rounds to that midpoint
  // in double. Original getFloat first uses getDouble, so the final float is 1.
  expect(importSourceMapFloat('1.000000059604644775390625000001',0,'project')).toEqual({ok:true,value:1});
  expect(importSourceMapFloat(-0,1,'project','-0')).toEqual({ok:true,value:0});
  expect(importSourceMapFloat(-0,1,'project','-0.0')).toEqual({ok:true,value:-0});
 });
});
