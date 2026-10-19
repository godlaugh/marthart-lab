import {describe,it,expect} from 'vitest';
import {prepareSourceAttractorGpuFunction} from '../src/engine/sourceAttractorGpuFunction';
import {prepareSourceAttractorEquation} from '../src/engine/sourceAttractorEquation';

const input=(dx='x',parameters:Record<string,number>={})=>({equations:{dx,dy:'y',dz:'z'},parameters});
const good=(value:unknown)=>{const result=prepareSourceAttractorGpuFunction(value);if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
// Source-derived goldens: fixed 1.7.8 JsonAttractorConfig.getGLSLFunction
// PC90-160 and PC170-289, and retained FastExpression toGLSL branches.
// These do not claim a native shader execution or Java decimal text oracle.
describe('source Attractor GPU formula owner',()=>{
 it('emits the native global declarations and derivative wrapper',()=>{
  const result=good(input('A*x+a',{z:2,A:3,a:4,B:5}));
  expect(result.parameterNames).toEqual(['A','a','B','z']);
  expect(result.code).toBe('float A = 3.0;\nfloat a = 4.0;\nfloat B = 5.0;\nfloat z = 2.0;\nvoid calculate_derivative(vec3 pos_arg, out vec3 dp) {\n  float x = pos_arg.x;\n  float y = pos_arg.y;\n  float z = pos_arg.z;\n  dp.x = ((A * x) + a);\n  dp.y = y;\n  dp.z = z;\n}\n');
  expect(result.operations).toBe(7);
 });
 it('uses two source HashMap constructions, including collision tree ordering',()=>{
  const keys=['BBAaBBBB','BBBBAaAa','BBBBAaBB','BBBBBBAa','BBBBBBBB','AaAaAaAa','AaAaAaBB','AaAaBBAa','AaAaBBBB','AaBBAaAa','AaBBAaBB'];
  // First map puts AaAaBBBB at its tree root; rebuilding from that iteration
  // moves BBAaBBBB to the front. This is not the first map's iteration.
  expect(good(input('x',Object.fromEntries(keys.map((key,i)=>[key,i])))).parameterNames).toEqual(['BBAaBBBB','AaAaBBBB','BBBBAaAa','BBBBAaBB','BBBBBBAa','BBBBBBBB','AaAaAaAa','AaAaAaBB','AaAaBBAa','AaBBAaAa','AaBBAaBB']);
 });
 it('preserves GPU coordinate shadowing while CPU parameter shadowing remains unchanged',()=>{
  const source=input('x+y+z',{x:11,y:12,z:13}),gpu=good(source),cpu=prepareSourceAttractorEquation(source);
  if(!cpu.ok)throw Error('CPU');const derivative=new Float32Array(3);cpu.value.create().compute(1,2,3,derivative);
  expect(Array.from(derivative)).toEqual([36,12,13]);
  expect(gpu.code).toContain('float x = 11.0;');expect(gpu.code).toContain('  float x = pos_arg.x;');expect(gpu.code).toContain('dp.x = ((x + y) + z);');
 });
 it.each([
  [-0,'0.0'],[1000000000000000100,'1000000000000000128.0'],[2**63,'9223372036854775807.0'],[-(2**63),'-9223372036854775808.0'],[2**63-1024,'9223372036854774784.0'],
 ])('retains source double-to-long formatting for %s',(value,expected)=>{
  expect(good(input('p',{p:value})).code).toContain(`float p = ${expected};`);
 });
 it('preserves representative Lorenz decimal parameter Float32 value without claiming Java text identity',()=>{
  const value=8/3,source=good(input('p*z',{p:value})),literal=source.code.match(/float p = ([^;]+);/)![1];
  expect(Number(literal)).toBe(value);expect(Math.fround(Number(literal))).toBe(Math.fround(value));
  for(const value of [.1,1e-7,2**63+2048,1e23]){
   const literal=good(input('p',{p:value})).code.match(/float p = ([^;]+);/)![1];expect(Number(literal)).toBe(value);
  }
 });
 it('takes an immutable parameter snapshot and has no Surface 32-slot limit',()=>{
  const parameters=Object.fromEntries(Array.from({length:33},(_,i)=>[`p${i}`,i])),result=good(input('p32',parameters));
  parameters.p32=999;expect(result.parameterNames).toHaveLength(33);expect(Object.isFrozen(result.parameterNames)).toBe(true);
  expect(result.code).toContain('float p32 = 32.0;');expect(result.code).not.toContain('params[');
 });
 it.each(['PI','E','TWO_PI','TAU','HALF_PI'])('never repairs undeclared native constant %s',name=>{
  expect(prepareSourceAttractorGpuFunction(input(name))).toMatchObject({ok:false,error:{kind:'unsupported',path:['equations','dx']}});
  expect(good(input(name.toLowerCase(),{[name]:3})).code).toContain(`dp.x = ${name};`);
 });
 it.each([
  ['x^2','(x * x)'],['x^5','(pow(abs(x), 5.0) * sign(x))'],['x^6','pow(abs(x), 6.0)'],['x^(-2)','pow(x, (-2.0))'],['x%y','mod(x, y)'],['atan2(x,y)','atan(x, y)'],['min(x,y,z)','min(min(x, y), z)'],['log10(x,PI)','(log(x) / 2.30258509)'],
 ])('uses retained FastExpression emission for %s',(raw,expected)=>expect(good(input(raw)).code).toContain(`dp.x = ${expected};`));
 it('counts source AST arguments even when GLSL ignores them',()=>expect(good(input('log10(x,PI)')).operations).toBe(5));
 it.each(['float','gl_VertexID','a__b','a-b','变量','posTex','steps','calculate_derivative','rk4'])('reports invalid shader global %s without renaming',name=>{
  expect(prepareSourceAttractorGpuFunction(input('x',{[name]:1}))).toMatchObject({ok:false,error:{kind:'unsupported',path:['parameters',name]}});
 });
 it.each(['pos_arg','dp'])('rejects formula use of vec3 local shadow %s',name=>{
  expect(prepareSourceAttractorGpuFunction(input(name,{[name]:1}))).toMatchObject({ok:false,error:{kind:'unsupported',path:['equations','dx']}});
  expect(good(input('x',{[name]:1})).code).toContain(`float ${name} = 1.0;`);
  expect(good(input(`log10(x,${name})`,{[name]:1})).code).toContain('dp.x = (log(x) / 2.30258509);');
 });
 it.each(['pow(x)','sin(x,y)','min()','atan(x,y,z)'])('rejects invalid native function arity %s',raw=>expect(prepareSourceAttractorGpuFunction(input(raw))).toMatchObject({ok:false,error:{kind:'unsupported'}}));
 it('preserves bounded failures for malformed input, values and emission expansion',()=>{
  expect(prepareSourceAttractorGpuFunction(null)).toMatchObject({ok:false,error:{kind:'input'}});
  expect(prepareSourceAttractorGpuFunction(input('x;discard'))).toMatchObject({ok:false,error:{kind:'input',path:['equations','dx']}});
  expect(prepareSourceAttractorGpuFunction(input('x',{p:Infinity}))).toMatchObject({ok:false,error:{kind:'input',path:['parameters','p']}});
  expect(prepareSourceAttractorGpuFunction(input('x',{p:1e100}))).toMatchObject({ok:false,error:{kind:'unsupported',path:['parameters','p']}});
  expect(prepareSourceAttractorGpuFunction(input('x',{['p'.repeat(65536)]:1}))).toMatchObject({ok:false,error:{kind:'capacity'}});
  let expression='x';for(let i=0;i<12;i++)expression=`(${expression})^4`;
  expect(prepareSourceAttractorGpuFunction(input(expression))).toMatchObject({ok:false,error:{kind:'capacity',path:['equations','dx']}});
 });
});
