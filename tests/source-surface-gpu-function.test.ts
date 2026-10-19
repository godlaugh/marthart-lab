import {describe,expect,it} from 'vitest';
import {prepareSourceSurfaceGpuFunction,type SourceSurfaceGpuFunction} from '../src/engine/sourceSurfaceGpuFunction';
import {parseSourceRealExpression,prepareSourceRealExpression} from '../src/engine/domainSourceScalar';
import {prepareSourceSurfaceFunction,type SourceSurfaceFunctionInput} from '../src/engine/sourceSurfaceFunction';

const input=(x='u',parameters:Record<string,number>={}):SourceSurfaceFunctionInput=>({equations:{x,y:'v',z:'0'},parameters,scales:[1,2,3],offsets:[4,5,6]});
function good(value:SourceSurfaceFunctionInput):SourceSurfaceGpuFunction {const result=prepareSourceSurfaceGpuFunction(value);if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;}
function expression(x:string){return good(input(x)).functionBody.split('float x = ')[1].split(';\n')[0];}
// Goldens transcribed from the fixed 1.7.8 classfile instruction branches and
// BootstrapMethods concat recipes. They are source-derived, not native pixels.
describe('native GPU Surface expression and uniform ABI',()=>{
 it.each([
  ['u^2','(u * u)'],['u^3','(u * u * u)'],['u^4','(u * u * u * u)'],
  ['u^6','pow(abs(u), 6.0)'],['u^5','(pow(abs(u), 5.0) * sign(u))'],
  ['u^0','pow(abs(u), 0.0)'],['u^1','(pow(abs(u), 1.0) * sign(u))'],
  ['u^(-2)','pow(u, (-2.0))'],['u^(+2)','pow(u, (+2.0))'],
  ['u^v','pow(u, v)'],['u^2.5','pow(u, 2.5)'],['u^pi','pow(u, PI)'],
  ['u%v','mod(u, v)'],['-u^2','(-(u * u))'],['2u+3v','((2.0 * u) + (3.0 * v))'],
  ['sin(PI)+cos(two_pi)','(sin(PI) + cos(TWO_PI))'],['ln(e)','log(E)'],
  ['atan2(u,v)','atan(u, v)'],['atan(u,v)','atan(u, v)'],['atan2(u)','atan(u)'],
  ['log10(u,v)','(log(u) / 2.30258509)'],['log10(u,tau)','(log(u) / 2.30258509)'],
  ['min(u,v,2,3)','min(min(min(u, v), 2.0), 3.0)'],['max(u)','u'],
  ['arcsin(u)+arccos(v)','(asin(u) + acos(v))'],['|u-v|','abs((u - v))'],
  ['（u＋v）×π','((u + v) * PI)'],['','0.0'],['-0','(-0.0)'],
  ['9223372036854775808','9223372036854775807.0'],
 ])('emits source AST conversion: %s',(raw,expected)=>expect(expression(raw)).toBe(expected));
 it('emits the native body and Java UTF-16 parameter ordering without transforms',()=>{
  const plan=good(input('a*u+Z',{zeta:7,a:.1,Z:-0}));
  expect(plan.parameterNames).toEqual(['Z','a','zeta']);
  expect(plan.functionBody).toBe('const float PI = 3.14159265359;\nconst float TWO_PI = 6.28318530718;\nconst float E = 2.71828182846;\nfloat Z = params[0];\nfloat a = params[1];\nfloat zeta = params[2];\nfloat x = ((a * u) + Z);\nfloat y = v;\nfloat z = 0.0;\nreturn vec3(x, y, z);');
  expect(plan.scales).toEqual([1,2,3]);expect(plan.offsets).toEqual([4,5,6]);
 });
 it('packs current runtime parameter values in independent complete Float32 arrays',()=>{
  const source=input('b*u+a',{b:1.00000007,a:-0}),plan=good(source),runtime=prepareSourceSurfaceFunction(source).create();
  const first=plan.uniforms();if(!first.ok)throw Error('uniforms');
  expect(first.value.length).toBe(32);expect(Object.is(first.value[0],-0)).toBe(true);expect(first.value[1]).toBe(Math.fround(1.00000007));expect(Array.from(first.value.slice(2))).toEqual(Array(30).fill(0));
  runtime.write('b',2.0000002);const second=plan.uniforms(name=>runtime.read(name));if(!second.ok)throw Error('uniforms');
  expect(second.value[1]).toBe(Math.fround(2.0000002));expect(first.value[1]).toBe(Math.fround(1.00000007));
  second.value[0]=999;const third=plan.uniforms();if(!third.ok)throw Error('uniforms');expect(Object.is(third.value[0],-0)).toBe(true);
  expect(plan.uniforms(()=>1e99)).toMatchObject({ok:false,error:{kind:'arithmetic'}});
 });
 it('retains authored values and owns snapshots of names, parameters and Float32 transforms',()=>{
  const scales=[.1,2,3],offsets=[-0,5,6],parameters={a:3},source={...input('a*u'),scales,offsets,parameters};
  const plan=good(source);scales[0]=99;offsets[0]=99;parameters.a=42;
  expect(plan.scales[0]).toBe(Math.fround(.1));expect(Object.is(plan.offsets[0],-0)).toBe(true);expect(plan.uniforms()).toMatchObject({ok:true});
  const packed=plan.uniforms();if(!packed.ok)throw Error('uniforms');expect(packed.value[0]).toBe(3);
 });
 it('admits all 32 native slots and reports 33 before shader construction',()=>{
  const params=Object.fromEntries(Array.from({length:32},(_,i)=>[`p${i}`,i]));expect(good(input('p31',params)).parameterNames.length).toBe(32);
  expect(prepareSourceSurfaceGpuFunction(input('u',{...params,p32:32}))).toMatchObject({ok:false,error:{kind:'capacity'}});
 });
 it.each(['u','v','x','y','z','params','PI','E','TWO_PI','gl_VertexID','a__b','a-b','float','变量'])('does not rename a source-invalid GLSL parameter %s',name=>{
  expect(prepareSourceSurfaceGpuFunction(input('0',{[name]:1}))).toMatchObject({ok:false,error:{kind:'unsupported'}});
 });
 it.each(['TAU','HALF_PI','sin(u,v)','pow(u)','pow(u,v,2)','min()','atan(u,v,2)','log10()'])('rejects native unsupported emission without substituting another formula: %s',raw=>{
  expect(prepareSourceSurfaceGpuFunction(input(raw))).toMatchObject({ok:false,error:{kind:'unsupported'}});
 });
 it('keeps parameter variables distinct from named constants',()=>{
  expect(good(input('pi*u',{pi:3})).functionBody).toContain('float x = (pi * u);');
  expect(good(input('TAU*u',{TAU:3})).functionBody).toContain('float x = (TAU * u);');
  expect(parseSourceRealExpression('pi',[])).toMatchObject({ok:true,value:{kind:'number',name:'PI',value:Math.PI}});
  expect(parseSourceRealExpression('pi',['pi'])).toEqual({ok:true,value:{kind:'variable',slot:0}});
 });
 it('retains CPU semantics where shader source deliberately differs',()=>{
  const cpu=prepareSourceRealExpression('-5%3+sin(0,PI)+atan2(2)',[]);if(!cpu.ok)throw Error('cpu');expect(cpu.value.evaluate([])).toBe(-2);
  expect(expression('-5%3')).toBe('mod((-5.0), 3.0)');expect(expression('atan2(2)')).toBe('atan(2.0)');
 });
 it('fails invalid grammar, nonfinite packing and expansion budgets explicitly',()=>{
  expect(prepareSourceSurfaceGpuFunction(input('u; discard'))).toMatchObject({ok:false,error:{kind:'input'}});
  expect(prepareSourceSurfaceGpuFunction(input('u',{a:Infinity}))).toMatchObject({ok:false,error:{kind:'arithmetic'}});
  expect(prepareSourceSurfaceGpuFunction({...input(),scales:[NaN,1,1]})).toMatchObject({ok:false,error:{kind:'input'}});
  expect(prepareSourceSurfaceGpuFunction(input('9'.repeat(400)))).toMatchObject({ok:false,error:{kind:'unsupported'}});
  let raw='u';for(let i=0;i<12;i++)raw=`(${raw})^4`;
  expect(prepareSourceSurfaceGpuFunction(input(raw))).toMatchObject({ok:false,error:{kind:'capacity'}});
 });
});
