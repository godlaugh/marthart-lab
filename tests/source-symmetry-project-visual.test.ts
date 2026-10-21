import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseProjectFile,parseLegacyScene} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {editSourceSymmetryConfiguration} from '../src/engine/sourceSymmetryConfig';
import {prepareIteratedFrame,visibleIteratedControls,iteratedDensityControls} from '../src/scenes/iteratedDensity';
import {iteratedBaselineKey} from '../src/engine/iteratedIdentity';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/symmetry/project-visual-runtime.json',import.meta.url),'utf8')) as {cases:{id:string;input:Record<string,unknown>;exportedSettings:Record<string,number>}[];separateFailures:{id:string;input:Record<string,unknown>}[]};
const keys:Record<string,string>={brightness:'normalizedBrightness',contrast:'normalizedContrast',gamma:'normalizedGamma',dynamic_range:'normalizedDynamicRange',saturation:'normalizedSaturation',accumulation_decay:'accumulationDecay',scale_x:'scaleX',scale_y:'scaleY',scale_z:'scaleZ',offset_x:'offsetX',offset_y:'offsetY',offset_z:'offsetZ',dot_size:'pointSize'};
const load=(input:Record<string,unknown>)=>parseProjectFile(JSON.stringify({name:'Native visual',config_version:'1.0.0',...input})).scene;
describe('original ProjectState visual values through user file import',()=>{
 for(const row of fixture.cases)it(row.id+' import, parameter edit, save/reopen',()=>{
  const scene=load(row.input),expected=Object.fromEntries(Object.entries(keys).map(([source,local])=>[local,row.exportedSettings[source]]));
  // JSONObject output canonicalizes signed zero; these observations do not
  // establish its intermediate float sign. Compare serialized values here.
  const saved=parseScene(serializeScene(scene));expect(saved.settings).toMatchObject(expected);
  const edited=editSourceSymmetryConfiguration(saved,{...saved,parameters:{...saved.parameters,alpha:2.3}});
  expect(parseScene(serializeScene(edited)).settings).toMatchObject(expected);
  expect(saved.provenance?.original).toEqual(JSON.parse(JSON.stringify({name:'Native visual',...row.input})));
 });
 for(const row of fixture.separateFailures)it(row.id+' rejects the same non-finite project output',()=>{
  expect(()=>load(row.input)).toThrow('非有限 Float32');
 });
 it('keeps project scalar semantics distinct from direct runtime inputs',()=>{
  const input={config_version:'1.0.0',name:'Entry routes',type:'SYMMETRY_CHAOS',settings:{scale_x:'1+2'}};
  expect(load(input).settings.scaleX).toBe(35);
  expect(parseLegacyScene(JSON.stringify(input)).scene.settings.scaleX).toBe(3);
 });
 it('uses fixed source GPU color uniforms for built-in and custom kernels, including after reopening',()=>{
  const scene=load({type:'SYMMETRY_CHAOS',settings:{batch_size:8}});
  for(const glsl of ['', 'void calculate_next(in vec3 pos,out vec3 nextPos,out float stepMetric){nextPos=pos;stepMetric=1.0;}']){
   const current={...scene,settings:{...scene.settings},equations:{...scene.equations,glsl}},key=iteratedBaselineKey(current);
   Object.assign(current.settings,{stepMetricMin:'unused',stepMetricMax:-1,stepMetricNormalize:'invalid',colorSpeed:99,colorPhase:50,iteratedColor:'height',accumulationDecay:2});
   const reopened=parseScene(serializeScene(current));
   expect(prepareIteratedFrame(reopened,0,0).config).toMatchObject({metricMin:0,metricMax:2,metricMode:'robust',color:'step',colorSpeed:1,colorPhase:0,decay:1});
   current.settings.accumulationDecay=1;expect(iteratedBaselineKey(current)).toBe(key);
   const controls=visibleIteratedControls('symmetry',current.settings,iteratedDensityControls,undefined,undefined,current.equations);
   expect(controls.some(c=>['colorSpeed','colorPhase','iteratedColor','stepMetricMin','stepMetricMax','stepMetricNormalize'].includes(c.key))).toBe(false);
   current.settings.accumulationDecay=-2;expect(prepareIteratedFrame(current,0,0).config.decay).toBe(0);
  }
 });
});
