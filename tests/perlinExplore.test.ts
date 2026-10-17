import {describe,it,expect} from 'vitest';
import {explorePerlin} from '../src/scenes/perlinExplore';
import {definitions} from '../src/scenes/particles';
import type {Settings} from '../src/types';
const defaults=definitions.find(d=>d.kind==='perlin')!.defaults.settings;
const settings=(style:string,patch:Settings={}):Settings=>({...defaults,style,...patch});

describe('mode-preserving constrained Perlin exploration',()=>{
 for(const style of ['streams','particles','continuous','field-curves','filament','water'])it(`${style} yields seeded production samples and leaves the source untouched`,()=>{
  const source=settings(style,{particleCount:5000,curveCount:1500,textureStyle:'silk',background:'#123456'}),before=structuredClone(source),a=explorePerlin(source,42),b=explorePerlin(source,42);
  expect(a).toEqual(b);expect(source).toEqual(before);expect(a.settings.style).toBe(style);expect(a.settings.textureStyle).toBe('silk');expect(a.settings.flow).toBe(source.flow);expect(a.settings.seed).toBe(source.seed);expect(a.settings.particleCount).toBe(5000);expect(a.settings.curveCount).toBe(1500);expect(a.settings.background).toBe('#123456');expect(a.metrics.samples).toBeGreaterThan(0);expect(a.metrics.score).toBeGreaterThan(0);expect(a.changed.length).toBeGreaterThan(0);expect(a.candidates).toBe(1);expect(explorePerlin(source,43).settings).not.toEqual(a.settings);
 });
 it('has three operative intensity scales for the same random draw',()=>{
  const source=settings('filament'),results=['conservative','balanced','aggressive'].map(intensity=>explorePerlin(source,17,{intensity:intensity as 'balanced'}));
  const distance=results.map(r=>Math.abs(Number(r.settings.directionOffset)-Number(source.directionOffset)));expect(distance[0]).toBeLessThan(distance[1]);expect(distance[1]).toBeLessThan(distance[2]);
 });
 it('constrains high frequency particle steps and large warp texture steps as coupled parameters',()=>{
  const cpu=explorePerlin(settings('continuous',{noiseScale:90,particleSpeed:900}),71),gpu=explorePerlin(settings('water',{warpAmplitude:9,marchStepSize:.4}),71);
  expect(Number(cpu.settings.particleSpeed)*Number(cpu.settings.noiseScale)/Number(cpu.settings.simulationFps)).toBeLessThanOrEqual(.40000001);
  expect(Number(gpu.settings.marchStepSize)*(1+2*Number(gpu.settings.warpAmplitude))).toBeLessThanOrEqual(.060000001);
 });
 it('deep exploration selects actual families only within the CPU or texture category',()=>{
  const cpuFamilies=new Set<string>(),textureFamilies=new Set<string>();
  for(const seed of [1,2,3,4]){
   const cpu=explorePerlin(settings('continuous'),seed,{action:'deep',intensity:'aggressive'});expect(cpu.settings.style).toBe('continuous');expect(cpu.settings.seed).not.toBe(defaults.seed);expect(cpu.candidates).toBe(6);cpuFamilies.add(String(cpu.settings.flow));
   const gpu=explorePerlin(settings('filament'),seed,{action:'deep',intensity:'aggressive'});expect(['filament','water']).toContain(gpu.settings.style);textureFamilies.add(`${gpu.settings.style}/${gpu.settings.textureStyle}`);expect(gpu.metrics.samples).toBeGreaterThan(0);
  }
  expect(cpuFamilies.size).toBeGreaterThan(1);expect(textureFamilies.size).toBeGreaterThan(1);
 });
 it('rejects malformed source inputs rather than hiding them behind probe count reductions',()=>{
  for(const patch of [{style:'unknown'},{style:'continuous',particleCount:0},{style:'continuous',particleCount:1.5},{style:'field-curves',curveLength:1},{style:'filament',marchSteps:0},{style:'filament',warpAmplitude:NaN}] as Settings[])expect(()=>explorePerlin({...defaults,...patch},42)).toThrow();
  expect(()=>explorePerlin(defaults,-1)).toThrow('种子');expect(()=>explorePerlin(defaults,1,{action:'bad' as never})).toThrow('动作');expect(()=>explorePerlin(defaults,1,{intensity:'bad' as never})).toThrow('强度');expect(()=>explorePerlin(defaults,1,{isCancelled:()=>true})).toThrow('取消');
 });
});
