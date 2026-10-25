import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {iteratedGpuFieldSource,sourceIteratedGpuPrograms,type IteratedGpuFieldSource} from '../src/engine/iteratedDensityGpuPrograms';
import {sourceIteratedPrefixWork} from '../src/engine/sourceIteratedWork';
import type {IteratedField} from '../src/scenes/iteratedDensity';
import type {GpuShaderProfile} from '../src/engine/gpuShaderProfile';
import provenance from './fixtures/source-iterated-source-programs/provenance.json';

// CPU contract tests. The frozen mathematical main comes from the independently
// executed prefix prototype, not regenerated from this production builder.
const main=readFileSync(new URL('./fixtures/source-iterated-source-programs/source-prefix-main.glsl',import.meta.url),'utf8');
const fields:IteratedField[]=[
 {kind:'map',mathModel:'mathart-1.7.8-gpu-v1',equations:{x:'x+y',y:'a*y-(a+1)*y*y*y-b*x',z:'0'},parameters:{a:.8,b:.3},dimension:2,time:0},
 {kind:'map',mathModel:'mathart-1.7.8-gpu-v1',equations:{x:'x+a',y:'y+nx',z:'z+ny'},parameters:{a:.02},dimension:3,time:0},
 {kind:'symmetry',mathModel:'mathart-1.7.8-gpu-v1',parameters:{lambda:-1.86,alpha:2.5,beta:0,gamma:-1,omega:0,n:5,template:'standard'},time:0},
];
describe('explicit source-prefix program contracts',()=>{
 it('pins the independently observed mathematical loop without metadata or classification',()=>{
  expect(createHash('sha256').update(main).digest('hex')).toBe(provenance.mainSha256);
  for(const field of fields){
   const source=iteratedGpuFieldSource(field,'native-gl41'),program=sourceIteratedGpuPrograms(source);
   expect(program.vertex).toBe('#version 410 core\nlayout(location=0)in vec4 oldState;out vec4 newState;uniform int steps,dimension;\n'+source.source+'\n'+main);
   expect(program.vertex).not.toMatch(/oldMetadata|newMetadata|finiteFloat|resetCounter|observe/);
   expect(Object.isFrozen(program)).toBe(true);
  }
 });
 it('keeps zero-step counter reset and complete state classification in a separate program',()=>{
  const program=sourceIteratedGpuPrograms(iteratedGpuFieldSource(fields[0]));
  expect(program.diagnosticVertex).toContain('layout(location=0)in vec4 oldState;layout(location=1)in uvec2 oldMetadata;');
  expect(program.diagnosticVertex).toContain('flat out uvec2 newMetadata;uniform int resetCounter,observe;');
  expect(program.diagnosticVertex).toContain('if(observe==0){newMetadata=uvec2(count,oldMetadata.g);}');
  expect(program.diagnosticVertex).toContain('finiteFloat(oldState.x)&&finiteFloat(oldState.y)&&finiteFloat(oldState.z)&&finiteFloat(oldState.w)');
  expect(program.diagnosticVertex).toContain('newMetadata=uvec2(count+uint(!valid),valid?1u:0u)');
  expect(program.diagnosticVertex).not.toMatch(/calculate_next|newState|uniform int steps/);
  expect(program.diagnosticFragment).toBe(program.fragment);
 });
 it('changes only the preamble between profiles and refuses legacy/custom source ownership',()=>{
  const source=iteratedGpuFieldSource(fields[1]),native=sourceIteratedGpuPrograms(source),webgl=sourceIteratedGpuPrograms(source,'webgl2');
  for(const key of ['vertex','fragment','diagnosticVertex','diagnosticFragment'] as const)expect(webgl[key]).toBe(native[key].replace('#version 410 core\n','#version 300 es\nprecision highp float;precision highp int;\n'));
  const legacy:IteratedGpuFieldSource={source:'vec3 nextPoint(vec3 p){return p;}',uniforms:{},key:'legacy'};
  const custom:IteratedGpuFieldSource={source:'#version 410 core\nvoid main(){}',uniforms:{},key:'custom',stage:'fragment',profile:'native-gl41'};
  for(const unsupported of [legacy,custom])expect(()=>sourceIteratedGpuPrograms(unsupported)).toThrow('calculate_next');
  expect(()=>sourceIteratedGpuPrograms(source,'future' as GpuShaderProfile)).toThrow('profile');
 });
});

describe('source-prefix work accounting',()=>{
 it('counts every mathematical prefix and classifier while preserving zero-step reset cost',()=>{
  expect(sourceIteratedPrefixWork(0)).toBe(0);expect(sourceIteratedPrefixWork(0,true)).toBe(1);
  expect(sourceIteratedPrefixWork(1)).toBe(2);expect(sourceIteratedPrefixWork(3)).toBe(9);expect(sourceIteratedPrefixWork(16)).toBe(152);
  expect(sourceIteratedPrefixWork(16,true)+2*sourceIteratedPrefixWork(1)).toBe(156);
 });
 it('rejects the generic 256-step range and malformed work inputs',()=>{
  for(const n of [-1,.5,17,256,NaN,Infinity])expect(()=>sourceIteratedPrefixWork(n)).toThrow('16');
  expect(()=>sourceIteratedPrefixWork(0,1 as unknown as boolean)).toThrow('布尔');
 });
});
