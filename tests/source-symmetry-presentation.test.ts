import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {parseProjectFile,parseLegacyScene} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {snapshotGenerationInput} from '../src/engine/generationInput';
import {toneDensityRgbaPrepared} from '../src/engine/density';
import {prepareSourceSymmetryTone,deriveSourceSymmetryNormalization} from '../src/engine/sourceSymmetryPresentation';
import {visibleIteratedControls,generateIteratedDensity} from '../src/scenes/iteratedDensity';
import {normalizedDensityControls} from '../src/engine/densityNormalization';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/symmetry/normalization-runtime.json',import.meta.url),'utf8')) as {rows:{width:number;height:number;referenceWidth:number;referenceHeight:number;recordedPasses:number;batchSize:number;scale:number}[]};
const input={name:'Native tone',type:'SYMMETRY_CHAOS',config_version:'1.0.0',settings:{batch_size:8}};
describe('Symmetry source normalization and presentation boundaries',()=>{
 for(const [index,row]of fixture.rows.entries())it('original normalization '+index,()=>{
  const facts={kind:'symmetry' as const,...row},reference={width:row.referenceWidth,height:row.referenceHeight};
  if([row.width,row.height,row.referenceWidth,row.referenceHeight].some(v=>v<=0)){
   // Native helper accepts invalid geometry, but an actual render cannot.
   expect(()=>deriveSourceSymmetryNormalization(facts,reference)).toThrow('尺寸');return;
  }
  expect(deriveSourceSymmetryNormalization(facts,reference).scale).toBe(row.scale);
 });
 it('uses source presentation by project import and preserves its fields on reopening',()=>{
  const scene=parseScene(serializeScene(parseProjectFile(JSON.stringify(input)).scene));
  expect(scene.settings).toMatchObject({symmetryPresentationModel:'symmetry-present-1.7.8',densityToneModel:'normalized-v2',background:'#000000'});
  const tone=prepareSourceSymmetryTone(scene,{width:192,height:128,sourceSymmetryToneReference:{width:901,height:701}});
  expect(tone.sourceSymmetryPresentation).toMatchObject({referenceKind:'primary-canvas',reference:{width:901,height:701}});
  expect(tone.tone).toMatchObject({brightness:Math.fround(.3),gamma:Math.fround(2.2),dynamicRange:Math.fround(.2)});
  expect(()=>toneDensityRgbaPrepared(1,1,new Float32Array(4),tone)).toThrow('需要 GPU');
  expect(parseLegacyScene(JSON.stringify(input)).scene.settings.symmetryPresentationModel).toBeUndefined();
 });
 it('labels an omitted reference as local output and does not replace malformed caller facts',()=>{
  const scene=parseProjectFile(JSON.stringify(input)).scene;
  expect(prepareSourceSymmetryTone(scene,{width:192,height:128}).sourceSymmetryPresentation?.referenceKind).toBe('local-output');
  for(const width of [0,NaN,Infinity,.5,16385])expect(()=>prepareSourceSymmetryTone(scene,{width:192,height:128,sourceSymmetryToneReference:{width,height:128}})).toThrow('尺寸');
 });
 it('snapshots the complete measured reference independently from export output size',()=>{
  const reference={width:901,height:701},context={time:0,quality:'export' as const,width:192,height:128,sourceSymmetryToneReference:reference},request=snapshotGenerationInput(context);
  reference.width=5;expect(request.sourceSymmetryToneReference).toEqual({width:901,height:701});
 });
 it('rejects mismatched model documents and hides manual reference overrides',()=>{
  const scene=parseProjectFile(JSON.stringify(input)).scene;
  const controls=visibleIteratedControls(scene.kind,scene.settings,normalizedDensityControls);
  expect(controls.some(c=>c.key.startsWith('densityReference'))).toBe(false);
  scene.settings.densityToneModel='white-point-v1';expect(()=>parseScene(JSON.stringify(scene))).toThrow('归一调色');
 });
 it('shows only the scene background when seeking before the chosen replay start',()=>{
  const scene=parseProjectFile(JSON.stringify({...input,settings:{...input.settings,background_color:'#123456'}})).scene;
  scene.settings.iteratedStartTime=1;
  const output=generateIteratedDensity(scene,{time:0,quality:'export',width:4,height:3,sourceViewport:{logicalWidth:4,logicalHeight:3,referenceLogicalHeight:3,target:'primary',projectionPass:'perspective'}});
  expect(output.type).toBe('raster');if(output.type!=='raster')return;
  expect(output.stats.samples).toBe(0);expect(output.temporal?.frames).toBe(0);
  expect(Array.from(output.pixels)).toEqual(Array.from({length:12},()=>[18,52,86,255]).flat());
 });
});
