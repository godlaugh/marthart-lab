import {explorationBaselineChanged,restoreExplorationBaseline} from '../src/components/ExplorePanel';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {createRootsNativeMath,parseRootsMath,rootMathControlVisible,usesRootsNativeMath,withRootsMathModel} from '../src/engine/rootsMathConfig';
import {RootsMathControls} from '../src/components/RootsMathControls';
import {I18nProvider} from '../src/i18n';
import {definitions} from '../src/scenes';
const definition=definitions.find(d=>d.kind==='roots')!;
const local=()=>createScene(definition);
const html=(scene:ReturnType<typeof local>)=>renderToStaticMarkup(createElement(I18nProvider,{language:'zh',children:createElement(RootsMathControls,{scene,onChange:()=>{}})}));
describe('Roots native math authoring boundary',()=>{
 it('keeps every saved local default and preset on omission',()=>{
  for(const preset of [undefined,...definition.presets]){const scene=createScene(definition,preset),loaded=parseScene(JSON.stringify(scene));expect(loaded.rootsMath).toBeUndefined();expect(usesRootsNativeMath(loaded)).toBe(false);expect(loaded.equations).toEqual(scene.equations);expect(withRootsMathModel(loaded,'local-v1')).toBe(loaded);}
 });
 it('creates explicit source defaults once without changing local math/color/projection',()=>{
  const scene=local(),before=structuredClone(scene),source=withRootsMathModel(scene,'mathart-1.7.8-v1');
  expect(scene).toEqual(before);expect(source.rootsMath).toEqual(createRootsNativeMath());expect(source.equations).toEqual(scene.equations);expect(source.parameters).toEqual(scene.parameters);expect(source.settings).toEqual(scene.settings);expect(source.palette).toEqual(scene.palette);expect(source.camera).toEqual(scene.camera);expect(source.rootsMath?.sampling.seed).toBe('0');expect(source.rootsMath?.parameters.map(p=>p.name)).toEqual(['t1','t2']);
 });
 it('round trips raw names, reversed ranges, coefficient aliases, highest zero and signed64 seed',()=>{
  const scene=withRootsMathModel(local(),'mathart-1.7.8-v1'),config=scene.rootsMath!;config.polynomial={variable:' \u0000x ',coefficients:[{exponent:'+01',expression:'t1'},{exponent:'01',expression:'t2'},{exponent:'3',expression:'0'}]};config.parameters=[{name:' 原.名 ',domain:'REAL_RANGE',minRe:9,maxRe:-2,minIm:1,maxIm:-1,value:[3,4]},{name:'原.名',domain:'FIXED',minRe:0,maxRe:0,minIm:0,maxIm:0,value:[1,2]}];config.sampling.seed='-9223372036854775808';
  const loaded=parseScene(JSON.stringify(persistentScene(scene)));expect(loaded.rootsMath).toEqual(config);const restored=withRootsMathModel(loaded,'local-v1');expect(restored.rootsMath).toEqual({...config,model:'local-v1'});expect(withRootsMathModel(restored,'mathart-1.7.8-v1').rootsMath).toEqual(config);
 });
 it('does not compile dormant coefficient source or reinterpret an empty table',()=>{
  const config=createRootsNativeMath();config.model='local-v1';config.polynomial.coefficients=[{exponent:'not an integer',expression:'sin('}];expect(parseRootsMath(config)).toEqual(config);
  const scene={...local(),rootsMath:config};expect(parseScene(JSON.stringify(scene)).rootsMath).toEqual(config);config.polynomial.coefficients=[];expect(parseRootsMath(config).polynomial.coefficients).toEqual([]);
 });
 it('skips inactive legacy parameter semantics only while source is active',()=>{
  const scene=withRootsMathModel(local(),'mathart-1.7.8-v1');scene.settings.rootParameters='not JSON';scene.settings.variable='not an identifier';expect(parseScene(JSON.stringify(scene)).settings.rootParameters).toBe('not JSON');expect(()=>parseScene(JSON.stringify(withRootsMathModel(scene,'local-v1')))).toThrow();
 });
 it('rejects malformed payload structure and source-only payload on a different kind',()=>{
  const config=createRootsNativeMath();for(const bad of [null,{}, {...config,model:'unknown'}, {...config,polynomial:{variable:'x',coefficients:[{exponent:'1',expression:1}]}}, {...config,parameters:[{...config.parameters[0],value:[0,Infinity]}]}, {...config,sampling:{...config.sampling,workerCount:1.5}}, {...config,solver:{...config.solver,tolerance:0}}])expect(()=>parseRootsMath(bad)).toThrow();expect(()=>parseScene(JSON.stringify({...local(),kind:'domain',rootsMath:config}))).toThrow('仅适用于');
 });
 it.each(['9223372036854775808','-9223372036854775809',' 1','1e2','1.0'])('rejects noncanonical signed-long seed %s',seed=>{const c=createRootsNativeMath();expect(()=>parseRootsMath({...c,sampling:{...c.sampling,seed}})).toThrow();});
 it.each(['9223372036854775807','-9223372036854775808','+0001','-0'])('preserves signed-long authored spelling %s',seed=>{const c=createRootsNativeMath();expect(parseRootsMath({...c,sampling:{...c.sampling,seed}}).sampling.seed).toBe(seed);});
 it('restores source-only exploration changes and the originally omitted payload',()=>{
  const baseline=withRootsMathModel(local(),'mathart-1.7.8-v1'),candidate=structuredClone(baseline);candidate.rootsMath!.polynomial.coefficients=[{exponent:'1',expression:'t1'}];candidate.rootsMath!.sampling.seed='99';
  expect(explorationBaselineChanged(candidate,baseline)).toBe(true);candidate.palette.offset=.4;const restored=restoreExplorationBaseline(candidate,baseline);expect(restored.rootsMath).toEqual(baseline.rootsMath);expect(restored.palette.offset).toBe(.4);expect(explorationBaselineChanged(restored,baseline)).toBe(false);
  restored.rootsMath!.parameters[0].name='changed';expect(baseline.rootsMath!.parameters[0].name).toBe('t1');const omitted=restoreExplorationBaseline(candidate,local());expect(Object.hasOwn(omitted,'rootsMath')).toBe(false);
 });
 it('shows unresolved source label metadata without inventing a mathematical variable',()=>{
  const scene=withRootsMathModel(local(),'mathart-1.7.8-v1');scene.rootsMath!.polynomial.variable={sourceValue:{label:1}};expect(html(scene)).toContain('Java 文本尚未确定');expect(parseScene(JSON.stringify(scene)).rootsMath!.polynomial.variable).toEqual({sourceValue:{label:1}});
 });
 it('hides only inactive math controls and explains explicit defaults and names',()=>{
  const source=withRootsMathModel(local(),'mathart-1.7.8-v1');for(const key of ['variable','seed','rootIterations','rootTolerance','rootTotalSamples','rootBatchSize','rootSampleFilter','rootParameters'])expect(rootMathControlVisible(source,key)).toBe(false);
  for(const key of ['rootSamplingFps','rootSamplesPerFrame','rootStartTime','rootScale','rootColor','rootDensityBackend'])expect(rootMathControlVisible(source,key)).toBe(true);
  const markup=html(source);expect(markup).toContain('源 64 位整数种子');expect(markup).toContain('系数表达式 1');expect(markup).toContain('不转换本地公式');expect(markup).toContain('不隐式绑定时间');expect(html(withRootsMathModel(source,'local-v1'))).not.toContain('系数表达式 1');
 });
});
