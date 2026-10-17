import {describe,it,expect} from 'vitest';
import {createScene,parseScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {domainEvaluator,parseDomainModel} from '../src/engine/domainModel';
import type {DomainIterationVersion} from '../src/engine/domainSourceIteration';
import type {Complex} from '../src/engine/complexMath';

// Public guide blocks 107/108 claim that next=w preserves an initial f(z).
// Shipped DomainColoringMobject.evalFormulaIterated instead starts with the
// selected seed, calls evalIterationStep and returns current (offsets 8-160).
// The retained fragment's eval_formula_iterated lines 182-212 does the same.
// These deliberately independent expected values preserve that conflict.
// The GPU cases below exercise its staged-f32 CPU reference, not actual GL.
const versions=['mathart-1.7.8-cpu','mathart-1.7.8-gpu'] as const;
const seeds=['PIXEL_Z','ZERO','CONSTANT_C'] as const;
type Seed=typeof seeds[number];
const point:Complex=[2,3];
function scene(version:DomainIterationVersion,seed:Seed,steps:number){
 const s=createScene(definition('domain'));
 s.equations={f:'2*z+1',next:'w'};
 s.parameters={};s.timeline.tracks=[];
 Object.assign(s.settings,{domainIterationVersion:version,domainBackend:'cpu',iterationEnabled:true,iterationSteps:steps,iterationMaxSteps:256,seedMode:seed,constantReal:7,constantImag:8,bailout:1e6});
 return s;
}
const cases=versions.flatMap(version=>seeds.flatMap(seed=>[1,8,64,256].map(steps=>({version,seed,steps}))));

describe('source identity next preserves the seed, not an initial main-formula result',()=>{
 it.each(cases)('$version / $seed / $steps steps',({version,seed,steps})=>{
  const s=scene(version,seed,steps),before=JSON.stringify(s),model=parseDomainModel(s,0);
  // Raw main 2*z+1 selects the source fallback literal c=1. Without a c
  // reference, the fresh native GPU program does not upload even that value.
  const expected:Complex=seed==='PIXEL_Z'?[2,3]:seed==='ZERO'?[0,0]:version==='mathart-1.7.8-cpu'?[1,0]:[0,0];
  expect(model.steps).toBe(steps);expect(model.nextEnabled).toBe(true);
  expect(model.nativeConstant?.baseConstant).toEqual([7,8]);
  expect(model.nativeConstant?.effectiveConstant).toEqual([1,0]);
  expect(model.sourceConstantUpload).toBe(version==='mathart-1.7.8-gpu'?false:undefined);
  const evaluate=domainEvaluator(model);
  expect(evaluate(point)).toEqual(expected);
  expect(evaluate(point)).not.toEqual([5,6]); // Guide's f(2+3i) prediction.
  expect(evaluate([-4,1])).toEqual(seed==='PIXEL_Z'?[-4,1]:expected);
  expect(evaluate(point)).toEqual(expected); // Reused evaluator has no accumulation.
  expect(JSON.stringify(s)).toBe(before);
 });

 it.each(seeds)('disabled next keeps the CPU/GPU distinction for %s',seed=>{
  const cpuScene=scene('mathart-1.7.8-cpu',seed,256);cpuScene.settings.iterationEnabled=false;
  const gpuScene=scene('mathart-1.7.8-gpu',seed,256);gpuScene.settings.iterationEnabled=false;
  const cpu=parseDomainModel(cpuScene,0),gpu=parseDomainModel(gpuScene,0);
  expect(cpu.steps).toBe(1);expect(gpu.steps).toBe(1);
  expect(cpu.nextEnabled).toBe(true);expect(gpu.nextEnabled).toBe(false);
  expect(cpu.next).toBe('w');expect(gpu.next).toBe('w'); // Raw text stays authored.
  expect(domainEvaluator(cpu)(point)).toEqual(seed==='PIXEL_Z'?[2,3]:seed==='ZERO'?[0,0]:[1,0]);
  expect(domainEvaluator(gpu)(point)).toEqual(seed==='PIXEL_Z'?[5,6]:[1,0]);
 });

 it.each(versions)('absent next applies the main formula, unlike identity next in %s',version=>{
  const s=scene(version,'ZERO',8);
  expect(domainEvaluator(parseDomainModel(s,0))(point)).toEqual([0,0]);
  s.equations.next='';
  // Eight applications of 2*w+1 from zero: 1,3,7,15,31,63,127,255.
  expect(domainEvaluator(parseDomainModel(s,0))(point)).toEqual([255,0]);
 });
});

describe('raw main and active expression references own identity constant seeds',()=>{
 it.each(versions)('retains raw-main constant selection even when main is not evaluated in %s',version=>{
  const s=scene(version,'CONSTANT_C',64);s.equations.f='z';
  let model=parseDomainModel(s,0);
  expect(model.nativeConstant?.effectiveConstant).toEqual([7,8]);
  expect(domainEvaluator(model)(point)).toEqual(version==='mathart-1.7.8-cpu'?[7,8]:[0,0]);
  // This is algebraically identity for finite inputs, but c must be uploaded:
  // the source gate uses collected references, not an optimizer's live use.
  s.equations.next='w+0*c';model=parseDomainModel(s,0);
  expect(domainEvaluator(model)(point)).toEqual([7,8]);
  if(version==='mathart-1.7.8-gpu')expect(model.sourceConstantUpload).toBe(true);
  s.equations.f=' z ^ 3 - 2 ';model=parseDomainModel(s,0);
  expect(model.nativeConstant?.effectiveConstant).toEqual([2,0]);
  expect(domainEvaluator(model)(point)).toEqual([2,0]);
  expect(s.equations.f).toBe(' z ^ 3 - 2 ');
 });

 it('includes main c references in the GPU gate although next=w bypasses main evaluation',()=>{
  const s=scene('mathart-1.7.8-gpu','CONSTANT_C',8);s.equations.f='2*z+1+c';
  const model=parseDomainModel(s,0);
  expect(model.sourceConstantUpload).toBe(true);
  expect(model.constant).toEqual([1,0]);
  expect(domainEvaluator(model)(point)).toEqual([1,0]);
 });

 it('disabling next removes its c upload requirement and survives document roundtrip',()=>{
  const s=scene('mathart-1.7.8-gpu','CONSTANT_C',8);s.equations={f:'z',next:'w+0*c'};
  expect(domainEvaluator(parseDomainModel(s,0))(point)).toEqual([7,8]);
  s.settings.iterationEnabled=false;
  const loaded=parseScene(JSON.stringify(s)),model=parseDomainModel(loaded,0);
  expect(loaded.equations).toEqual(s.equations);
  expect(loaded.settings.iterationSteps).toBe(8);
  expect(model.sourceConstantUpload).toBe(false);
  expect(model.constant).toEqual([0,0]);
  expect(domainEvaluator(model)(point)).toEqual([0,0]);
  loaded.settings.domainIterationVersion='mathart-1.7.8-cpu';
  expect(domainEvaluator(parseDomainModel(loaded,0))(point)).toEqual([7,8]);
 });
});
