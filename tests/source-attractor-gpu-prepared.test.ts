import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {parseProjectFile} from '../src/engine/legacyImport';
import {prepareSourceAttractorScene} from '../src/engine/sourceAttractorDocument';
import {prepareSourceAttractorGpuOptions,prepareSourceAttractorGpuInitialData,createSourceAttractorGpuInitialSource,sourceAttractorGpuWarmupPasses,sourceAttractorGpuNormalPass} from '../src/engine/sourceAttractorGpuPrepared';
import * as shader from '../src/engine/sourceAttractorGpuShaders';
const sha=(v:string|ArrayBufferView)=>createHash('sha256').update(typeof v==='string'?v:new Uint8Array(v.buffer,v.byteOffset,v.byteLength)).digest('hex');
const prepared=()=>{const s=parseProjectFile(JSON.stringify({config_version:'1.0',type:'ATTRACTOR',name:'shared GPU',settings:{render_mode:'GPU',particle_count_gpu:65,time_step:.01,sub_steps:3},initialization:{warmup_steps:101,warmup_stagger_min:2,warmup_stagger_max:7},equations:{dx:'y-x',dy:'x-z',dz:'x*y-z'},colors:['#80FC6255','#FF58C4DD','#4083C167'],timeline:[]})).scene;const p=prepareSourceAttractorScene(s);if(p.backend!=='gpu')throw Error('gpu');return prepareSourceAttractorGpuOptions(p);};
describe('shared source Attractor GPU facts',()=>{
 it('preserves the pre-extraction five WebGL program bytes and changes only an explicit profile preamble',()=>{
  const expected={sourceAttractorQuad:'5a6154fec7df28f3b36e5c6705b7f85efb63c1afa94ebeacd3b333bbf2e2dad9',sourceAttractorUpdate:'9003dc365b421fcc1eeb98cf367789118fef1812d61f17ee471295d9008ed5db',sourceAttractorAccumulateVertex:'ccc8bd7adc703672836dd385f084ef4fc5bc0b283fad3d2e5997f15c5c3529e8',sourceAttractorAccumulateFragment:'7f3bd30f3e775d6fea34cc1465f10c2dffa4aa12f4a301070ef4b337b256664a',sourceAttractorPresent:'ba7aec3418de4027125772ed2ef3df01c1a32a61ae7f75dae205eadd88f5ffc3'};
  for(const [name,digest] of Object.entries(expected))expect(sha(shader[name as keyof typeof expected])).toBe(digest);
  const p=prepared(),webgl=shader.sourceAttractorGpuPrograms(p.shader,'webgl2'),native=shader.sourceAttractorGpuPrograms(p.shader,'native-gl41');
  for(const kind of ['update','accumulate','present'] as const)for(const stage of ['vertex','fragment'] as const){expect(native[kind][stage].startsWith('#version 410 core\n')).toBe(true);expect(native[kind][stage].slice('#version 410 core\n'.length)).toBe(webgl[kind][stage].slice('#version 300 es\nprecision highp float;\nprecision highp int;\n'.length));}
 });
 it('uploads the same complete seed words/ARGB/UV with a non-square count, chunks across real slots and padding',()=>{
  const p=prepared(),full=prepareSourceAttractorGpuInitialData(p),source=createSourceAttractorGpuInitialSource(p);
  const positions=new Float32Array(p.layout.texels*4),uv=new Float32Array(p.layout.count*2),colors=new Float32Array(p.layout.count*4);
  for(const n of [1,31,32,4,13]){const chunk=source.next(n);positions.set(chunk.positions,chunk.offset*4);if(chunk.texIndex.length)uv.set(chunk.texIndex,chunk.offset*2);if(chunk.colors.length)colors.set(chunk.colors,chunk.offset*4);}
  expect(source.cursor).toBe(81);expect(sha(positions)).toBe(sha(full.data));expect(sha(uv)).toBe(sha(full.uv));expect(sha(colors)).toBe(sha(full.rgba));expect(Array.from(positions.subarray(65*4))).toEqual(Array(16*4).fill(0));expect(()=>source.next(1)).toThrow('分块');
 });
 it('keeps signed-overflow, negative normal-step and 100-step warmup batching semantics',()=>{
  const p=prepared();p.configuration.warmup={steps:101,staggerMin:2,staggerMax:7};
  expect([...sourceAttractorGpuWarmupPasses(p.configuration)]).toEqual([{steps:100,warmup:true,warmupBase:101,currentStepBase:0,staggerMin:2,staggerRange:5},{steps:8,warmup:true,warmupBase:101,currentStepBase:100,staggerMin:2,staggerRange:5}]);
  p.configuration.warmup={steps:2147483647,staggerMin:0,staggerMax:1};expect([...sourceAttractorGpuWarmupPasses(p.configuration)]).toEqual([]);p.configuration.stepsPerFrame=-1;expect(sourceAttractorGpuNormalPass(p.configuration)).toMatchObject({steps:-1,warmup:false,currentStepBase:0,staggerMin:0,staggerRange:0});
 });
});
