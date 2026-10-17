import {afterEach,describe,expect,it,vi} from 'vitest';
import * as math from '../src/engine/complexMath';
import {DomainExpressionCache,domainExpressions,MAX_DOMAIN_EXPRESSIONS} from '../src/engine/domainExpressions';
import {parseDomainModel,domainEvaluator} from '../src/engine/domainModel';
import {domainGpuSource} from '../src/engine/domainGpu';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
afterEach(()=>{vi.restoreAllMocks();domainExpressions.clear();});
describe('Domain parsed structure ownership',()=>{
 it('parses each equation once across validation, evaluators and many GPU batches',()=>{
  domainExpressions.clear();const parse=vi.spyOn(math,'parsed'),s=createScene(definition('domain'));s.equations={f:'a*z+time',next:'w+c+time'};s.parameters={a:2};s.settings.iterationEnabled=true;
  const model=parseDomainModel(s,.5);domainEvaluator(model);const first=domainGpuSource(model);
  for(let batch=0;batch<20;batch++)expect(domainGpuSource(model)).toBe(first);
  const edited={...s,parameters:{a:3}};domainEvaluator(parseDomainModel(edited,1));
  expect(parse.mock.calls.map(call=>call[0])).toEqual(['a*z+time','w+c+time']);expect(domainExpressions.diagnostics()).toMatchObject({entries:1,parses:2,sourceBuilds:1});
  expect(Object.isFrozen(first)).toBe(true);expect(Object.isFrozen(first.parameters)).toBe(true);
 });
 it('reuses only structure while keeping independent numerical scopes and parameter order',()=>{
  const s=createScene(definition('domain'));s.equations={f:'a*z+time+c',next:''};s.parameters={a:2,b:3};s.settings.constantReal=4;s.settings.constantImag=5;
  const a=parseDomainModel(s,.5),evalA=domainEvaluator(a),sourceA=domainGpuSource(a);
  const next={...s,parameters:{b:9,a:7},settings:{...s.settings,constantReal:1,constantImag:-2}};
  const b=parseDomainModel(next,10),evalB=domainEvaluator(b);expect(domainGpuSource(b)).toBe(sourceA);
  expect(evalA([1,2])).toEqual([6.5,9]);expect(evalB([1,2])).toEqual([18,12]);expect(evalA([1,2])).toEqual([6.5,9]);
  expect(domainExpressions.diagnostics()).toMatchObject({entries:1,parses:1,sourceBuilds:1});
 });
 it('invalidates formula, next-expression and symbol structure without aliasing natural e',()=>{
  const cache=new DomainExpressionCache(),input={formula:'e*z',parameters:{}};
  const natural=cache.get(input),named=cache.get({...input,parameters:{e:2}});expect(natural.f({z:[1,0]})).toEqual([Math.E,0]);expect(named.f({e:2,z:[1,0]})).toEqual([2,0]);expect(natural.gpuSource().source).not.toBe(named.gpuSource().source);
  expect(cache.get({...input,next:'w+c'})).not.toBe(natural);expect(cache.get({...input,formula:'e*z+1'})).not.toBe(natural);
  expect(()=>cache.get({...input,formula:'missing+z'})).toThrow('未知变量');expect(cache.get({...input,formula:'missing+z',parameters:{missing:5}}).f({missing:5,z:[1,0]})).toEqual([6,0]);
 });
 it('keeps an unsupported GPU structure CPU-valid and remembers the same failed build',()=>{
  const cache=new DomainExpressionCache(),entry=cache.get({formula:'1e100+z',parameters:{}});
  expect(entry.f({z:[0,2]})).toEqual([1e100,2]);for(let i=0;i<3;i++)expect(()=>entry.gpuSource()).toThrow('float32');expect(cache.diagnostics()).toMatchObject({parses:1,sourceBuilds:1});
 });
 it('bounds retained structures and releases least recently used entries without corrupting live evaluators',()=>{
  const cache=new DomainExpressionCache(),input={formula:'z',parameters:{}},first=cache.get(input);
  for(let i=1;i<MAX_DOMAIN_EXPRESSIONS;i++)cache.get({...input,formula:`z+${i}`});expect(cache.get(input)).toBe(first);
  cache.get({...input,formula:'z+999'});expect(cache.get(input)).toBe(first);expect(cache.diagnostics().entries).toBe(MAX_DOMAIN_EXPRESSIONS);
  for(let i=0;i<MAX_DOMAIN_EXPRESSIONS;i++)cache.get({...input,formula:`z-${i}`});expect(cache.get(input)).not.toBe(first);expect(first.f({z:[2,3]})).toEqual([2,3]);
  cache.clear();expect(cache.diagnostics()).toEqual({entries:0,parses:0,sourceBuilds:0,hits:0});
 });
 it('does not compile a dormant next expression until iteration is enabled',()=>{
  const s=createScene(definition('domain'));s.equations={f:'z',next:'undeclared+w'};s.settings.iterationEnabled=false;expect(domainEvaluator(parseDomainModel(s,0))([3,4])).toEqual([3,4]);
  s.settings.iterationEnabled=true;expect(()=>parseDomainModel(s,0)).toThrow('未知变量');
 });
});
