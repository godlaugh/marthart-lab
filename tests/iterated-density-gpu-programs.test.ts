import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import fixture from './fixtures/iterated-density-gpu-programs/5d8c9d2.json';
import {iteratedDensityGpuPrograms,iteratedGpuFieldSource} from '../src/engine/iteratedDensityGpuPrograms';
import {prepareSymmetryCustomSource,bindSymmetryCustomParameters} from '../src/engine/symmetryCustom';
import type {GpuShaderProfile} from '../src/engine/gpuShaderProfile';
import type {IteratedField} from '../src/scenes/iteratedDensity';

const digest=(source:string)=>({sha256:createHash('sha256').update(source).digest('hex'),bytes:Buffer.byteLength(source)});
const expected=(name:string)=>fixture.shaders[name as keyof typeof fixture.shaders];
function field(input:Record<string,unknown>):IteratedField {
 if(input.kind!=='symmetry-custom')return input as unknown as IteratedField;
 const raw=input.customSource as {rawSource:string;compileDegree:number},plan=prepareSymmetryCustomSource(raw.rawSource,raw.compileDegree),parameters=input.parameters as Record<string,number>;
 return{kind:'symmetry-custom',plan,parameters,uniforms:bindSymmetryCustomParameters(plan,parameters),time:input.time as number};
}
const webgl=iteratedDensityGpuPrograms('webgl2'),native=iteratedDensityGpuPrograms('native-gl41');
const esHeader='#version 300 es\nprecision highp float;precision highp int;precision highp sampler2D;precision highp usampler2D;\n';
const customHeader='#version 300 es\nprecision highp float;\nprecision highp int;\n';
const glHeader='#version 410 core\n';
function sameBody(es:string,gl:string,header=esHeader){
 expect(es.startsWith(header)).toBe(true);expect(gl.startsWith(glHeader)).toBe(true);
 expect(gl.slice(glHeader.length)).toBe(es.slice(header.length));
}

describe('iterated shared program source contracts',()=>{
 it('preserves all pre-extraction WebGL stages byte for byte',()=>{
  const entries=Object.entries(webgl).filter((entry):entry is [string,string]=>typeof entry[1]==='string');
  expect(entries.map(([name])=>name).sort()).toEqual(Object.keys(fixture.shaders).filter(name=>!name.includes('.')).sort());
  for(const[name,source]of entries)expect(digest(source),name).toEqual(expected(name));
 });
 for(const[name,record]of Object.entries(fixture.fields))it(`preserves assembled ${name} source, uniforms, identity and stage`,()=>{
  const input=field(record.input),source=iteratedGpuFieldSource(input),program=webgl.iteration(source);
  expect(digest(source.source).sha256).toBe(record.sourceSha256);expect(digest(source.key).sha256).toBe(record.keySha256);
  expect(source.uniforms).toEqual(record.uniforms);expect(source.stage??'vertex').toBe(record.stage);expect(!!source.sourceCalculateNext).toBe(record.sourceCalculateNext);
  expect(digest(program.vertex)).toEqual(expected(name+'.vertex'));expect(digest(program.fragment)).toEqual(expected(name+'.fragment'));
  expect(program.varyings).toEqual(source.stage==='fragment'?undefined:['newState','newMetadata']);
  const nativeSource=iteratedGpuFieldSource(input,'native-gl41'),nativeProgram=native.iteration(nativeSource);
  expect(nativeSource.uniforms).toEqual(source.uniforms);expect(nativeSource.key).toBe(source.key);
  sameBody(program.vertex,nativeProgram.vertex);sameBody(program.fragment,nativeProgram.fragment,source.stage==='fragment'?customHeader:esHeader);
 });
 it('selects only a preamble for native static sources without changing their bodies',()=>{
  for(const[name,source]of Object.entries(webgl))if(typeof source==='string'){
   const other=native[name as keyof typeof native];expect(typeof other).toBe('string');
   if(source.startsWith('#version'))sameBody(source,other as string);else expect(other,name).toBe(source);
  }
  expect(iteratedDensityGpuPrograms('webgl2')).toBe(webgl);expect(iteratedDensityGpuPrograms('native-gl41')).toBe(native);expect(Object.isFrozen(webgl)).toBe(true);
 });
 it('rejects unknown profiles and cross-profile custom fragments before any GL use',()=>{
  expect(()=>iteratedDensityGpuPrograms('future' as GpuShaderProfile)).toThrow('profile');
  const custom=field(fixture.fields.custom.input);
  expect(()=>iteratedGpuFieldSource(custom,'future' as GpuShaderProfile)).toThrow('profile');
  expect(()=>native.iteration(iteratedGpuFieldSource(custom))).toThrow('profile');
  expect(()=>webgl.iteration(iteratedGpuFieldSource(custom,'native-gl41'))).toThrow('profile');
 });
 it('retains authored precision declarations and source line ownership in both profiles',()=>{
  const raw='precision mediump float;\nvoid calculate_next(in vec3 p,out vec3 n,out float m){n=p;m=-1.;}',plan=prepareSymmetryCustomSource(raw,7),custom:IteratedField={kind:'symmetry-custom',plan,parameters:{},uniforms:{},time:0};
  for(const profile of ['webgl2','native-gl41'] as const){
   const program=iteratedDensityGpuPrograms(profile).iteration(iteratedGpuFieldSource(custom,profile));
   expect(program.fragment.slice(program.fragment.indexOf('#line 1 1'))).toBe('#line 1 1\n'+plan.instrumentedSource+'\n');
  }
 });
});
