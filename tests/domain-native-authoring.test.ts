import {describe,it,expect} from 'vitest';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {parseProjectFile} from '../src/engine/legacyImport';
import {withDomainIterationVersion} from '../src/engine/domainAuthoring';
import {parseDomainNativeParameters} from '../src/engine/domainNativeParameters';
import {parseDomainModel,domainEvaluator} from '../src/engine/domainModel';
import {definition} from '../src/scenes';

const native=(mode:'CPU'|'GPU',patch:Record<string,unknown>={})=>({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Native execution',settings:{render_mode:mode},domainColoring:{formula:'z+1'},...patch});
const read=(source:unknown)=>parseProjectFile('// preserved comment\n'+JSON.stringify(source));

describe('explicit native Domain execution authoring boundary',()=>{
 it.each(['CPU','GPU'] as const)('selects %s execution from the source setting independently of backend/color/viewport edits',mode=>{
  const input=native(mode),result=read(input),s=result.scene;
  expect(s.settings.domainIterationVersion).toBe(mode==='CPU'?'mathart-1.7.8-cpu':'mathart-1.7.8-gpu');
  expect(s.settings.domainBackend).toBe('auto');expect(s.provenance?.original).toEqual(input);
  s.settings.domainBackend='cpu';s.settings.domainColorVersion='local-v1';s.settings.domainViewportVersion='local-v1';
  expect(parseScene(JSON.stringify(s)).settings.domainIterationVersion).toBe(result.scene.settings.domainIterationVersion);
 });
 it('keeps native dictionary keys exact, including dots, case, Unicode, reserved names and prototype-shaped keys',()=>{
  const params=Object.fromEntries([['A',30],['a',2],['a_b',3],['aB',40],['ab',5],['π',7],['_v',11],['constructor',13],['prototype',17],['__proto__',19],['',23],['a.b',29],['e',99],['pi',99]]);
  const input=native('CPU',{parameters:params,domainColoring:{formula:'A+a_b+ab+π+_v+constructor+prototype+__proto__+e+pi',formulaParams:{a:100,a_b:100,'a.b':100}}});
  const result=read(input),s=result.scene;
  expect(s.parameters).toEqual(params);expect(Object.hasOwn(s.parameters,'__proto__')).toBe(true);expect(Object.getPrototypeOf(s.parameters)).toBe(Object.prototype);
  expect(domainEvaluator(parseDomainModel(s,0))([0,0])[0]).toBeCloseTo(2+3+5+7+11+13+17+19+Math.E+Math.PI,12);
  expect(parseScene(JSON.stringify(s)).parameters).toEqual(params);expect(s.provenance?.original).toEqual(input);
  expect(result.warnings.filter(w=>w.includes('尚未映射')).join()).not.toContain('a.b');
 });
 it('owns a safe parameter copy and rejects nonfinite/type values without silently using zero',()=>{
  const source=Object.fromEntries([['__proto__',5],['x',2]]),result=parseDomainNativeParameters(source);result.x=3;
  expect(source.x).toBe(2);expect(Object.hasOwn(result,'__proto__')).toBe(true);
  for(const bad of [null,[],{x:NaN},{x:Infinity},{x:'3'}])expect(()=>parseDomainNativeParameters(bad)).toThrow();
  const fallback=read(native('CPU',{parameters:{x:'not + valid('}}));expect(fallback.scene.parameters.x).toBe(0);expect(fallback.warnings.join()).toContain('原版标量转换规则');
 });
 it('keeps raw failed formulas in both import and saved docs while the producer exposes recovery',()=>{
  const raw={formula:'sin(',iteration:{enabled:true,nextFormula:'pow(z)',steps:1}},s=read(native('CPU',{domainColoring:raw})).scene;
  expect(s.equations).toMatchObject({f:'sin(',next:'pow(z)'});
  const model=parseDomainModel(s,0);expect(domainEvaluator(model)([2,0])[0]).toBeCloseTo(7,10);
  expect(model.executionWarnings.join()).toContain('z^3 - 1');expect(model.executionWarnings.join()).toContain('迭代公式');
  expect(parseScene(JSON.stringify(persistentScene(s))).equations).toEqual(s.equations);
 });
 it('captures initial native a/b once and leaves the unrecognized iteration.constant in provenance',()=>{
  const original=native('CPU',{parameters:{a:2.1,b:-.3},domainColoring:{formula:'z',iteration:{enabled:true,seedMode:'CONSTANT_C',steps:1,nextFormula:'w',constant:[91,92]}}});
  const imported=read(original),s=imported.scene,expected=[Math.fround(2.1),Math.fround(-.3)];
  expect([s.settings.constantReal,s.settings.constantImag]).toEqual(expected);
  expect(domainEvaluator(parseDomainModel(s,0))([0,0])).toEqual(expected);
  expect(imported.warnings.join()).toContain('原版运行时不读取此字段');
  s.parameters.a=20;s.parameters.b=30;
  expect(domainEvaluator(parseDomainModel(s,1))([0,0])).toEqual(expected);
  const restored=parseScene(JSON.stringify(persistentScene(s)));
  expect(domainEvaluator(parseDomainModel(restored,1))([0,0])).toEqual(expected);
  expect(restored.provenance?.original).toEqual(original);
 });
 it('preserves imported base controls while the raw main formula owns the effective literal constant',()=>{
  const s=read(native('GPU',{parameters:{a:7,b:8},domainColoring:{formula:'z^3-2',iteration:{enabled:true,seedMode:'CONSTANT_C',steps:1,nextFormula:'w+0*c'}}})).scene;
  expect([s.settings.constantReal,s.settings.constantImag]).toEqual([7,8]);
  expect(domainEvaluator(parseDomainModel(s,0))([0,0])).toEqual([2,0]);
  const restored=parseScene(JSON.stringify(s));expect(restored.equations.f).toBe('z^3-2');
  expect(domainEvaluator(parseDomainModel(restored,0))([0,0])).toEqual([2,0]);
 });
 it('shows the fresh GPU constant upload gate independently of the captured source base',()=>{
  const s=read(native('GPU',{parameters:{a:7,b:8},domainColoring:{formula:'z',iteration:{enabled:true,seedMode:'CONSTANT_C',steps:1,nextFormula:'w+1'}}})).scene;
  const model=parseDomainModel(s,0);expect(model.nativeConstant?.effectiveConstant).toEqual([7,8]);expect(model.constant).toEqual([0,0]);
  expect(domainEvaluator(model)([0,0])).toEqual([1,0]);
  const cpu=withDomainIterationVersion(s,'mathart-1.7.8-cpu');expect(domainEvaluator(parseDomainModel(cpu,0))([0,0])).toEqual([8,8]);
 });
 it('does not promote an oversized native formula into the syntax fallback',()=>{
  const s=read(native('CPU')).scene;s.equations.f='1+'.repeat(300)+'1';
  expect(()=>parseDomainModel(s,0)).toThrow('512');
  s.equations.f='z'.repeat(8193);expect(()=>parseScene(JSON.stringify(s))).toThrow('公式');
 });
 it('retains old local/compatibility syntax and explicitly changes only the execution version',()=>{
  const s=createScene(definition('domain'));s.equations.f='1e3';s.equations.next='';s.settings.iterationEnabled=false;s.settings.seedMode='PIXEL_Z';
  const old=domainEvaluator(parseDomainModel(s,0))([2,0]);expect(old[0]).toBe(1000);
  const compat=withDomainIterationVersion(s,'mathart-1.7.8'),nativeScene=withDomainIterationVersion(s,'mathart-1.7.8-cpu');
  expect(domainEvaluator(parseDomainModel(compat,0))([2,0])[0]).toBeCloseTo(old[0],12);
  expect(domainEvaluator(parseDomainModel(nativeScene,0))([2,0])[0]).toBe(0);
  expect(nativeScene.equations).toEqual(s.equations);expect(nativeScene.settings.domainBackend).toBe(s.settings.domainBackend);expect(nativeScene.palette).toEqual(s.palette);
  const back=withDomainIterationVersion(parseScene(JSON.stringify(nativeScene)),'local-v1');expect(domainEvaluator(parseDomainModel(back,0))([2,0])).toEqual(old);
 });
 it('leaves the old parameter validation unchanged and accepts retained native maps only under explicit new versions',()=>{
  const s=createScene(definition('domain'));s.parameters={'π':2};
  for(const version of [undefined,'local-v1','mathart-1.7.8']){s.settings.domainIterationVersion=version??'local-v1';expect(()=>parseScene(JSON.stringify(s))).toThrow('参数');}
  for(const version of ['mathart-1.7.8-cpu','mathart-1.7.8-gpu']){s.settings.domainIterationVersion=version;expect(parseScene(JSON.stringify(s)).parameters).toEqual({'π':2});}
 });
});
