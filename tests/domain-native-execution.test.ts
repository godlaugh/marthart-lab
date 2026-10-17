import {describe,it,expect} from 'vitest';
import {parseDomainNativeExpression,NativeExpressionSyntaxError,NativeExpressionCapacityError} from '../src/engine/domainNativeParser';
import {compileDomainNativeNode} from '../src/engine/domainNativeArithmetic';
import {DomainExpressionCache} from '../src/engine/domainExpressions';
import {createScene,parseScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {domainEvaluator,parseDomainModel,domainGpuPrecisionReason} from '../src/engine/domainModel';
import {domainGpuSource} from '../src/engine/domainGpu';
import {generateDomain} from '../src/engine/domain';

const parsed=(formula:string,parameters:Record<string,number>={})=>compileDomainNativeNode(parseDomainNativeExpression(formula),new Set(Object.keys(parameters)),'cpu')({...parameters,z:[3,4],c:[2,1]});
const scene=(version='mathart-1.7.8-cpu')=>{
 const s=createScene(definition('domain'));s.parameters={};s.equations={f:'z+1'};s.timeline.tracks=[];
 Object.assign(s.settings,{domainIterationVersion:version,iterationEnabled:false,seedMode:'ZERO',domainBackend:'cpu',constantReal:2,constantImag:3});return s;
};
describe('source grammar at the shared expression boundary',()=>{
 it.each([['-2^2',-4],['2^3^2',512],['2^-2',.25],['2/3z',2],['1e3',0],['1e-3',Math.E-3],['sin (z)',0],['foo(z)',0],['π',0],['|z|',5],['|z|z',15],['',0],['\t\n',0]])('%s retains the shipped grammar', (formula,real)=>{
  expect(parsed(formula)[0]).toBeCloseTo(real,11);
 });
 it('keeps lowercase identifiers distinct from authored map keys and mathematical constants',()=>{
  expect(parsed('A+_b+π',{A:100,a:2,_b:3,'π':7})).toEqual([12,0]);
  expect(parsed('e+pi',{e:100,pi:200})[0]).toBe(Math.E+Math.PI);
 });
 it.each(['2|z|','sin\t(z)','z\n+1','.','1..2','foo(z,2)','sin(z,2)','pow(z)','(z','|z'])('reports a native syntax failure for %s',formula=>{
  expect(()=>parseDomainNativeExpression(formula)).toThrow(NativeExpressionSyntaxError);
 });
 it('distinguishes resource rejection from source parse recovery',()=>{
  expect(()=>parseDomainNativeExpression('1'.repeat(8193))).toThrow(NativeExpressionCapacityError);
  expect(()=>parseDomainNativeExpression(Array.from({length:300},()=> 'z').join('+'))).toThrow(NativeExpressionCapacityError);
  const s=scene();s.equations.f='1'.repeat(8193);expect(()=>parseDomainModel(s,0)).toThrow(NativeExpressionCapacityError);
 });
 it('normalizes next with Java trim while preserving non-ASCII whitespace failures',()=>{
  const s=scene();s.equations.next='\t w+100 \n';expect(domainEvaluator(parseDomainModel(s,0))([0,0])).toEqual([100,0]);
  s.equations.next='\u00a0w+100\u00a0';const model=parseDomainModel(s,0);expect(model.executionWarnings.join(' ')).toContain('迭代公式无法解析');expect(domainEvaluator(model)([0,0])).toEqual([1,0]);expect(s.equations.next).toBe('\u00a0w+100\u00a0');
  s.equations.next='\u2003';expect(parseDomainModel(s,0).executionWarnings.some(w=>w.includes('无法解析'))).toBe(false);
 });
});
describe('native execution through production scene models',()=>{
 it('separates disabled-next CPU and GPU rules, retaining legacy saved behavior',()=>{
  const s=scene();s.equations.next='w+100';
  for(const [version,expected]of [['local-v1',3],['mathart-1.7.8',100],['mathart-1.7.8-cpu',100],['mathart-1.7.8-gpu',1]] as const){
   s.settings.domainIterationVersion=version;const loaded=parseScene(JSON.stringify(s));
   expect(domainEvaluator(parseDomainModel(loaded,0))([2,3])[0]).toBe(expected);
  }
 });
 it.each([1,2,64,65,100,255,256])('executes %i state-dependent steps in both native reference rules',steps=>{
  for(const version of ['mathart-1.7.8-cpu','mathart-1.7.8-gpu']){
   const s=scene(version);Object.assign(s.settings,{iterationEnabled:true,iterationSteps:steps,iterationMaxSteps:256});s.equations={f:'999',next:'w+1'};
   const m=parseDomainModel(s,0);expect(domainEvaluator(m)([4,5])).toEqual([steps,0]);
   if(version.endsWith('gpu')){expect(domainGpuPrecisionReason(m,32,24)).toBeUndefined();expect(domainGpuSource(m).source).toContain('j<256');}
  }
 });
 it('binds c to the pixel only for next and non-pixel seeds, with no final main evaluation',()=>{
  const s=scene();s.settings.iterationEnabled=true;s.settings.iterationSteps=2;s.equations={f:'999',next:'w+c'};
  expect(domainEvaluator(parseDomainModel(s,0))([4,5])).toEqual([8,10]);
  // Raw main 999 uses the source fallback literal c=1, despite an authored 2+3i.
  s.settings.seedMode='PIXEL_Z';expect(domainEvaluator(parseDomainModel(s,0))([4,5])).toEqual([6,5]);
  s.equations={f:'z+c'};s.settings.seedMode='ZERO';expect(domainEvaluator(parseDomainModel(s,0))([4,5])).toEqual([2,0]);
 });
 it('uses source constant float fields and explicit parameters without injecting time',()=>{
  const s=scene();s.equations={f:'z',next:'c+time'};s.settings.seedMode='PIXEL_Z';s.settings.constantReal=16777217;s.settings.constantImag=0;
  expect(domainEvaluator(parseDomainModel(s,20))([0,0])).toEqual([16777216,0]);
  s.parameters.time=3;expect(domainEvaluator(parseDomainModel(s,20))([0,0])).toEqual([16777219,0]);
 });
 it('preserves distinct double and float squared stopping, including float infinity equality',()=>{
  const s=scene();Object.assign(s.settings,{iterationEnabled:true,iterationSteps:4,iterationMaxSteps:256,seedMode:'CONSTANT_C',constantReal:1e19,constantImag:0,bailout:1e20});s.equations={f:'z',next:'w*10+c*0'};
  const cpu=domainEvaluator(parseDomainModel(s,0))([0,0])[0];s.settings.domainIterationVersion='mathart-1.7.8-gpu';
  const gpuReference=domainEvaluator(parseDomainModel(s,0))([0,0])[0];
  expect(cpu).toBe(Math.fround(1e19)*100);expect(gpuReference).toBeGreaterThan(cpu*90);
 });
 it('retains raw invalid formula text while reporting source effective fallback',()=>{
  const s=scene();s.equations={f:'sin(',next:'pow(z)'};const before=JSON.stringify(s),m=parseDomainModel(s,0);
  expect(m.executionWarnings.filter(w=>w.includes('无法解析'))).toHaveLength(2);expect(domainEvaluator(m)([3,4])[0]).toBeCloseTo(-1,12);expect(JSON.stringify(s)).toBe(before);
  const legacy=scene('mathart-1.7.8');legacy.equations=s.equations;expect(()=>parseDomainModel(legacy,0)).toThrow();
 });
 it('reports CPU arithmetic fallback for a main w unavailable in the shipped GPU scope',()=>{
  const s=scene('mathart-1.7.8-gpu');s.equations={f:'w+1',next:'w+100'};
  const m=parseDomainModel(s,0);expect(m.execution).toMatchObject({version:'mathart-1.7.8-cpu',requestedVersion:'mathart-1.7.8-gpu',arithmetic:'native-cpu',nextEnabled:true});
  expect(domainEvaluator(m)([2,3])).toEqual([100,0]);expect(m.executionWarnings.join(' ')).toContain('w');expect(s.settings.domainIterationVersion).toBe('mathart-1.7.8-gpu');
 });
 it('keeps overflowing native decimal literals and labels their unavailable shader',()=>{
  const s=scene('mathart-1.7.8-gpu');s.equations.f='1'+'0'.repeat(400);
  const m=parseDomainModel(s,0);expect(domainEvaluator(m)([0,0])).toEqual([Infinity,0]);expect(m.execution.fallbackReason).toContain('非有限常量');
 });
 it('separates expression caches by execution version, active next and parameter names, not values',()=>{
  const cache=new DomainExpressionCache(),input={formula:'1/z',next:'w+1',parameters:{a:1}};
  const old=cache.get(input),cpu=cache.get({...input,iterationVersion:'mathart-1.7.8-cpu'}),gpu=cache.get({...input,iterationVersion:'mathart-1.7.8-gpu'});
  expect(cpu).not.toBe(old);expect(gpu).not.toBe(cpu);expect(cache.get({...input,parameters:{a:2},iterationVersion:'mathart-1.7.8-gpu'})).toBe(gpu);
  expect(cache.get({...input,iterationVersion:'mathart-1.7.8-gpu',nextEnabled:false}).next).toBeUndefined();
  expect(old.f({z:[0,0]}).every(Number.isNaN)).toBe(true);expect(cpu.f({z:[0,0]})).toEqual([0,0]);
 });
 it('labels an explicitly selected CPU reference without changing the authored GPU rule',()=>{
  const s=scene('mathart-1.7.8-gpu'),before=JSON.stringify(s),output=generateDomain(s,{width:9,height:7,time:0,quality:'export'});
  expect(output.backend).toBe('cpu');expect(output.warnings?.join(' ')).toContain('float32 参考');expect(JSON.stringify(s)).toBe(before);
 });
 it('applies the raw-formula constant producer before a seeded next expression',()=>{
  const s=scene();s.settings.seedMode='PIXEL_Z';s.equations.next='c';
  for(const [formula,expected]of [['z^2',[2,3]],['z^02',[0,0]],['z^3-2',[2,0]],['z^3+2',[-2,0]],['z+c',[1,0]]] as const){
   s.equations.f=formula;expect(domainEvaluator(parseDomainModel(s,0))([7,8])).toEqual(expected);expect(s.settings.constantReal).toBe(2);expect(s.settings.constantImag).toBe(3);
  }
 });
 it('checks cancellation within a long CPU or GPU-reference orbit',()=>{
  for(const version of ['mathart-1.7.8-cpu','mathart-1.7.8-gpu']){
   const s=scene(version);Object.assign(s.settings,{iterationEnabled:true,iterationSteps:256,iterationMaxSteps:256});s.equations={f:'z',next:'w+0.01'};let checks=0;
   expect(()=>domainEvaluator(parseDomainModel(s,0),()=>++checks===2)([0,0])).toThrow('已取消');expect(checks).toBe(2);
  }
 });
 it('uses the source fresh-uniform zero when a constant seed does not mention c',()=>{
  const s=scene('mathart-1.7.8-gpu');s.settings.seedMode='CONSTANT_C';s.equations={f:'z',next:'w+1'};
  let model=parseDomainModel(s,0);expect(model.sourceConstantUpload).toBe(false);expect(model.nativeConstant?.effectiveConstant).toEqual([2,3]);expect(domainEvaluator(model)([4,5])).toEqual([0,0]);
  s.settings.iterationEnabled=true;s.settings.iterationSteps=1;model=parseDomainModel(s,0);expect(domainEvaluator(model)([4,5])).toEqual([1,0]);
  s.equations.next='w+1+0*c';model=parseDomainModel(s,0);expect(model.sourceConstantUpload).toBe(true);expect(domainEvaluator(model)([4,5])).toEqual([3,3]);
  s.settings.iterationEnabled=false;model=parseDomainModel(s,0);expect(model.sourceConstantUpload).toBe(false);expect(domainEvaluator(model)([4,5])).toEqual([0,0]);
  s.settings.domainIterationVersion='mathart-1.7.8-cpu';model=parseDomainModel(s,0);expect(model.sourceConstantUpload).toBeUndefined();expect(domainEvaluator(model)([4,5])).toEqual([3,3]);
 });
});
