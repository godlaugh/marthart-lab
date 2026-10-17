import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,persistentScene} from '../src/engine/document';
import {createRootsNativeMath} from '../src/engine/rootsMathConfig';
import {prepareRootsNativePolynomial} from '../src/engine/rootsNativePolynomial';
const header='"config_version":"1.0.0","type":"COMPLEX_ROOTS","name":"Native"';
const load=(tail='')=>parseProjectFile('{'+header+(tail?','+tail:'')+'}');
const imported=(extra:Record<string,unknown>)=>parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'COMPLEX_ROOTS',name:'Native',...extra}));
describe('Native Roots JSON selects its own mathematical input',()=>{
 it('selects explicit source defaults and distinguishes missing and empty tables',()=>{
  const defaults=load();expect(defaults.scene.rootsMath).toEqual(createRootsNativeMath());expect(defaults.warnings.join()).toContain('逻辑工作器');
  for(const polynomial of [{},{coefficients:{}}]){const value=imported({polynomial});expect(value.scene.rootsMath?.polynomial.coefficients).toEqual('coefficients'in polynomial?[]:createRootsNativeMath().polynomial.coefficients);}
  expect(imported({root_parameters:{}}).scene.rootsMath?.parameters.map(x=>x.name)).toEqual(['t1','t2']);
 });
 it.each([1,true,null,{},[]])('rejects source coefficient value %j instead of local coercion',value=>{expect(()=>imported({polynomial:{coefficients:{1:value}}})).toThrow('应为字符串');});
 it('retains HashMap order, exponent aliases and explicit high zero without concatenating a formula',()=>{
  const result=load('"polynomial":{"variable":" unusual.name ","coefficients":{"17":"2","1":"3","+1":"4","01":"5","3":"0"}}'),p=result.scene.rootsMath!.polynomial;
  expect(p.variable).toBe(' unusual.name ');expect(p.coefficients).toHaveLength(5);expect(new Map(p.coefficients.map(r=>[r.exponent,r.expression])).get('3')).toBe('0');expect(result.scene.equations.polynomial).not.toContain('unusual');expect(parseScene(JSON.stringify(result.scene)).rootsMath).toEqual(result.scene.rootsMath);
  const compiled=prepareRootsNativePolynomial(p);expect(compiled.ok).toBe(true);if(compiled.ok){expect(compiled.value.declaredDegree).toBe(17);compiled.value.dispose();}
 });
 it('rejects original duplicate JSON keys even in an inactive field',()=>{expect(()=>load('"polynomial":{"coefficients":{"1":"1","1":"2"}}')).toThrow('duplicate-key');expect(()=>load('"ignored":{"a":1,"a":2}')).toThrow('duplicate-key');});
 it('keeps exact names, reverse ranges and fixed domains, without generic binding injection',()=>{
  const result=imported({parameters:{time:9,'bad.dot':8},root_parameters:{' a ':{domain:'REAL_RANGE',min:2,max:-2},a:{domain:'FIXED',re:3,im:4},'原.名':{domain:'COMPLEX_RECT',min_re:7,max_re:-1},' x':{domain:' UNIT_CIRCLE '}}});
  const p=result.scene.rootsMath!.parameters,byName=new Map(p.map(x=>[x.name,x]));expect(byName.get(' a ')).toMatchObject({minRe:2,maxRe:-2});expect(byName.get('a')?.value).toEqual([3,4]);expect(byName.get('原.名')).toMatchObject({minRe:7,maxRe:-1});expect(byName.get(' x')?.domain).toBe('UNIT_CIRCLE');expect(result.scene.parameters).not.toHaveProperty('time');expect(result.warnings.join()).toContain('parameters');expect(parseScene(JSON.stringify(result.scene)).rootsMath?.parameters).toEqual(p);
 });
 it.each([' ', '\t','\u2000'])('rejects source blank name %j',name=>{expect(()=>imported({root_parameters:{[name]:{}}})).toThrow('不能为空白');});
 it('preserves a NUL name which source isBlank accepts before trimming',()=>{const s=imported({root_parameters:{'\u0000':{domain:'FIXED'}}}).scene;expect(s.rootsMath?.parameters[0].name).toBe('\u0000');});
 it.each([['9223372036854775807','9223372036854775807'],['-9223372036854775808','-9223372036854775808'],['9007199254740993','9007199254740993'],['1.9','1'],['1e999','0'],['9223372036854775808','0']])('retains seed token %s with source effective %s',(token,effective)=>{
  const result=load('"sampling":{"seed":'+token+'}'),s=result.scene;expect(s.rootsMath?.sampling.seed).toBe(effective);expect(s.provenance?.sourceNumberTokens).toContainEqual({path:['sampling','seed'],token});expect(parseScene(JSON.stringify(persistentScene(s))).rootsMath?.sampling.seed).toBe(effective);
 });
 it('distinguishes Long.intValue wrapping from Double.intValue saturation',()=>{
  expect(load('"sampling":{"sample_count":4294967296}').scene.rootsMath?.sampling.sampleCount).toBe(1);
  expect(load('"sampling":{"sample_count":4294967296.0}').scene.rootsMath?.sampling.sampleCount).toBe(2147483647);
  expect(imported({sampling:{batch_size:'bad'},settings:{solver_max_iterations:0,solver_tolerance:1e-30,worker_count:2}}).scene.rootsMath).toMatchObject({solver:{maxIterations:1,tolerance:1e-16},sampling:{workerCount:2,batchSize:256}});
 });
 it('keeps unknown Java label formatting explicit without blocking polynomial math',()=>{
  for(const token of ['1.0','1e0','{"a":1}','[1]']){const s=load('"polynomial":{"variable":'+token+',"coefficients":{"1":"1","0":"-1"}}').scene;expect(typeof s.rootsMath!.polynomial.variable).toBe('object');const reloaded=parseScene(JSON.stringify(s));expect(reloaded.rootsMath).toEqual(s.rootsMath);const compiled=prepareRootsNativePolynomial(s.rootsMath!.polynomial);expect(compiled.ok).toBe(true);if(compiled.ok){expect(compiled.value.variable).toBeUndefined();compiled.value.dispose();}}
  expect(load('"polynomial":{"variable":1}').scene.rootsMath?.polynomial.variable).toBe('1');expect(load('"polynomial":{"variable":true}').scene.rootsMath?.polynomial.variable).toBe('true');
 });
});
