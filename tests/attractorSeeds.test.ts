import {describe,it,expect} from 'vitest';
import {AttractorSeedStream,parseAttractorInitial} from '../src/engine/attractorSeeds';
import {prepareAttractorParticles,definitions,prepareAttractorFrame} from '../src/scenes/geometry';
import {createScene} from '../src/engine/document';
import {random} from '../src/engine/expression';
describe('canonical attractor initialization boundary',()=>{
 it('keeps CPU double seeds and chunked GPU float32 uploads identical at the conversion boundary',()=>{
  for(const useInitialBounds of [false,true])for(const variableTimeStep of [false,true])for(const particleCount of [1,17]){
   const scene=createScene(definitions.find(d=>d.kind==='attractor')!);Object.assign(scene.settings,{particleCount,useInitialBounds,variableTimeStep,staggerMin:5,staggerMax:17,burnIn:11});
   const config=parseAttractorInitial(scene.settings),cpu=prepareAttractorParticles(scene),whole=new AttractorSeedStream(config).chunk(particleCount),split=new AttractorSeedStream(config),left=split.chunk(1),right=particleCount>1?split.chunk(particleCount-1):null;
   expect([...left.positions,...(right?.positions??[])]).toEqual([...whole.positions]);expect([...left.initial,...(right?.initial??[])]).toEqual([...whole.initial]);
   for(let i=0;i<particleCount;i++){expect([...whole.positions.slice(i*4,i*4+4)]).toEqual([...cpu[i].point.map(Math.fround),0]);expect(whole.initial[i*2]).toBe(Math.fround(cpu[i].dtFraction));expect(whole.initial[i*2+1]).toBe(cpu[i].warmup);}
   expect(split.nextIndex).toBe(particleCount);expect(()=>split.chunk(1)).toThrow();
  }
 });
 it('preserves the established no-position-random-draw case for one particle and independent fixed-dt seed',()=>{
  const config=parseAttractorInitial({particleCount:1,variableTimeStep:true,burnIn:0,staggerMin:0,staggerMax:0}),chunk=new AttractorSeedStream(config).chunk(1);expect([...chunk.positions]).toEqual([Math.fround(.1),0,0,0]);expect(chunk.initial[0]).toBe(Math.fround(random(42)()));
  config.variableTimeStep=false;expect(new AttractorSeedStream(config).chunk(1).initial[0]).toBe(Math.fround(random((42^Math.imul(1,2654435761))>>>0)()));
 });
 it('separates supported caller count from CPU capacity and bounds GPU staging chunks',()=>{
  expect(parseAttractorInitial({particleCount:2000000}).count).toBe(2000000);expect(()=>parseAttractorInitial({particleCount:2000001})).toThrow();const stream=new AttractorSeedStream(parseAttractorInitial({particleCount:100000}));expect(()=>stream.chunk(65537)).toThrow();expect(stream.nextIndex).toBe(0);
  const scene=createScene(definitions.find(d=>d.kind==='attractor')!);scene.settings.particleCount=10001;expect(()=>prepareAttractorParticles(scene)).toThrow('CPU');
 });
 it('checks cancellation during initialization and rejects nonfinite GPU coordinates',()=>{
  const stream=new AttractorSeedStream(parseAttractorInitial({particleCount:10000}));let checks=0;expect(()=>stream.chunk(10000,()=>++checks>2)).toThrow('取消');expect(stream.nextIndex).toBe(2048);
  const invalid=new AttractorSeedStream(parseAttractorInitial({particleCount:1,initialX:1e100}));expect(()=>invalid.chunk(1)).toThrow('float32');
 });
 it('gives both backends the same parsed equation, scoped parameters and integration facts',()=>{
  const scene=createScene(definitions.find(d=>d.kind==='attractor')!);scene.equations={dx:'e*x+t',dy:'time',dz:'0'};scene.parameters={e:3};const job=prepareAttractorFrame(scene);expect(job.derivative([2,0,0],5)).toEqual([11,5,0]);expect(job.field.parameters).toEqual({e:3});expect(job.field.equations).toEqual(['e*x+t','time','0']);scene.parameters.e=7;expect(job.derivative([2,0,0],5)).toEqual([11,5,0]);
 });
});

describe('seed stream failure identity',()=>{it('does not reuse a partially consumed seed after an interrupted visitor',()=>{const cfg=parseAttractorInitial({particleCount:3}),stream=new AttractorSeedStream(cfg);expect(()=>stream.read(3,()=>{throw Error('visitor failed');})).toThrow('visitor failed');expect(()=>stream.chunk(1)).toThrow('种子流已失败');expect(new AttractorSeedStream(cfg).chunk(3).positions).toEqual(new AttractorSeedStream(cfg).chunk(3).positions);});});
