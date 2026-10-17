import {describe,expect,it} from 'vitest';
import {compileReal,existingParameterNameError,parameterNameError,realFunctionNames} from '../src/engine/expression';
import {compileGlslExpression} from '../src/engine/gpuSampler';
import {attractorGpuFieldSource} from '../src/engine/attractorGpu';
import {compileSamilaGpuField} from '../src/engine/iteratedGpuSamila';
import {analyzeEquation,equationCompletion,insertEquationCompletion} from '../src/engine/equationEditor';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {generateScene} from '../src/engine/temporal';
import {prepareAttractorFrame} from '../src/scenes/geometry';
import {prepareIteratedFrame} from '../src/scenes/iteratedDensity';
import {compileComplex} from '../src/scenes/complex';
import {definition} from '../src/scenes';
import type {GenerateContext} from '../src/types';

const pairs=[['arcsin','asin'],['arccos','acos'],['arctan','atan']] as const;
const context:GenerateContext={time:0,width:32,height:32,quality:'preview'};

describe('real inverse-trigonometric call aliases',()=>{
 it('uses canonical numerical semantics at endpoints, signed zero and outside the real domain',()=>{
  for(const [alias,canonical] of pairs){
   const a=compileReal(`${alias}(x)`,['x']),b=compileReal(`${canonical}(x)`,['x']);
   for(const x of [-Infinity,-2,-1,-.5,-0,0,.5,1,2,Infinity,NaN])expect(a({x})).toBe(b({x}));
   expect(realFunctionNames.filter(name=>name===alias)).toHaveLength(1);
  }
  expect(compileReal('arcsin(2)')({})).toBeNaN();
  expect(compileReal('arccos(-2)')({})).toBeNaN();
  expect(compileReal('arctan(1e300)')({})).toBeCloseTo(Math.PI/2);
 });

 it('compiles only function calls to canonical GLSL and preserves separate parameter symbols',()=>{
  for(const [alias,canonical] of pairs){
   expect(compileGlslExpression(`${alias}(x)`,['x'],[])).toBe(compileGlslExpression(`${canonical}(x)`,['x'],[]));
   const call=compileGlslExpression(`${canonical}(x)`,['x'],[]);
   expect(compileGlslExpression(`${alias}+${alias}(x)`,['x'],[alias])).toBe(`(parameter0+${call})`);
   expect(()=>compileGlslExpression(`${alias}(x,x)`,['x'],[])).toThrow(alias);
   expect(()=>compileGlslExpression(`${alias}()`,['x'],[])).toThrow(alias);
  }
  for(const source of ['Arcsin(x)','arcsinh(x)','arcsin.constructor(x)','arcsin[x]','arcsin(x)=x']){
   expect(()=>compileReal(source,['x'])).toThrow();
   expect(()=>compileGlslExpression(source,['x'],[])).toThrow();
  }
 });

 it('generates the same implicit surface after a lossless document round trip',()=>{
  const scene=createScene(definition('implicit'));
  scene.parameters={arcsin:.25,arccos:.5,arctan:2};
  scene.equations={f:'arcsin(x/2)^2 + (arccos(y/2)-pi/2)^2 + arctan(z/arctan)^2 - arcsin'};
  Object.assign(scene.settings,{resolution:12,computeBackend:'cpu',minX:-1.5,maxX:1.5,minY:-1.5,maxY:1.5,minZ:-1.5,maxZ:1.5});
  const restored=parseScene(JSON.stringify(persistentScene(scene))),before=JSON.stringify(restored);
  expect(restored.equations).toEqual(scene.equations);expect(restored.parameters).toEqual(scene.parameters);
  const result=generateScene(restored,context),reference=generateScene({...restored,equations:{f:'asin(x/2)^2 + (acos(y/2)-pi/2)^2 + atan(z/arctan)^2 - arcsin'}},context);
  expect(result.type).toBe('geometry');expect(reference.type).toBe('geometry');
  if(result.type!=='geometry'||reference.type!=='geometry')throw Error('expected implicit meshes');
  expect(result.stats.generated).toBeGreaterThan(0);expect(result.positions).toEqual(reference.positions);expect(result.indices).toEqual(reference.indices);
  expect(JSON.stringify(restored)).toBe(before);
 });

 it('reserves new alias parameters while retaining formerly valid saved names at producer boundaries',()=>{
  for(const [alias,canonical] of pairs){
   expect(parameterNameError(alias,'attractor')).toContain('保留名');
   expect(existingParameterNameError(alias,'attractor')).toBeUndefined();
   expect(existingParameterNameError(canonical,'attractor')).toContain('保留名');
   expect(compileReal(`${alias}+${alias}(x)`)( {[alias]:2,x:.5})).toBe(2+compileReal(`${canonical}(x)`)({x:.5}));
  }
  for(const name of ['x','time','constructor','__proto__','a;discard'])expect(existingParameterNameError(name,'attractor')).toBeDefined();
  const scene=createScene(definition('attractor'));scene.parameters={arcsin:2,arccos:3,arctan:4};scene.equations={dx:'arcsin+arcsin(x)',dy:'arccos+arccos(y)',dz:'arctan+arctan(z)'};
  const job=prepareAttractorFrame(parseScene(JSON.stringify(persistentScene(scene)))),gpu=attractorGpuFieldSource(job.field);
  expect(job.derivative([.5,.5,.5],0)).toEqual([2+Math.asin(.5),3+Math.acos(.5),4+Math.atan(.5)]);
  expect(gpu.parameters).toEqual(['arccos','arcsin','arctan']);
  expect(gpu.source).toContain('(parameter1+realAsin(samplePosition.x))');expect(gpu.source).toContain('(parameter0+realAcos(samplePosition.y))');expect(gpu.uniforms).toEqual({parameter0:3,parameter1:2,parameter2:4});
 });

 it('preserves alias parameters through continuous Map and Samila field admission',()=>{
  for(const kind of ['map','samila'] as const){
   const scene=createScene(definition(kind));scene.parameters={arcsin:.1,arccos:.2,arctan:.3};
   scene.equations=kind==='map'?{x:'arcsin+arcsin(x/2)',y:'arccos+arccos(y/2)'}:{f1:'arcsin+arcsin(x/2)',f2:'arctan+arctan(y/2)'};
   Object.assign(scene.settings,{iteratedMode:'continuous',iteratedBackend:'cpu',batchSize:4,burnIn:0,iterationsPerFrame:1,iteratedFps:10,densityView:'manual',densitySpan:8,start:-1,stop:1,mapping:'f1_f2',projection:'cartesian'});
   const restored=parseScene(JSON.stringify(persistentScene(scene))),job=prepareIteratedFrame(restored,0,0);
   expect(job.field.parameters).toEqual(scene.parameters);
   const output=generateScene(restored,context);expect(output.stats.generated).toBeGreaterThan(0);
   if(job.field.kind==='samila'){
    const gpu=compileSamilaGpuField(job.field);expect(gpu.source).toContain('realAsin((samplePosition.x/2.0))');expect(gpu.source).toContain('atan((samplePosition.y/2.0))');
   }
  }
 });

 it('offers aliases in real equation completion and keeps calls distinct from legacy same-name symbols',()=>{
  const scene=createScene(definition('implicit'));scene.parameters={arcsin:2};
  const analysis=analyzeEquation(scene,'f','arcsin + arcsin(x) + arccos(y) + arctan(z)');expect(analysis.error).toBeUndefined();
  const suggestions=equationCompletion('arc',3,analysis.suggestions).items;
  for(const [alias] of pairs)expect(suggestions).toContainEqual({name:alias,kind:'function'});
  const range={start:0,end:3};
  expect(insertEquationCompletion('arc',range,{name:'arcsin',kind:'function'})).toEqual({source:'arcsin()',caret:7});
  expect(insertEquationCompletion('arc',range,{name:'arcsin',kind:'variable'})).toEqual({source:'arcsin',caret:6});
  expect(analyzeEquation(scene,'f','arcsin(2)').error?.message).toContain('有限实数');
  expect(analyzeEquation(scene,'f','arcsin(x)').error).toBeUndefined();
  const complex=analyzeEquation(createScene(definition('domain')),'f','arcsin(z)');
  expect(complex.suggestions.some(item=>item.name==='arcsin')).toBe(true);expect(complex.error).toBeUndefined();
  expect(compileComplex('arcsin(z)')({z:[2,0]})).toEqual(compileComplex('asin(z)')({z:[2,0]}));
 });
});
