import {describe,it,expect} from 'vitest';
import fixture from './fixtures/spirograph/source-easing-1.7.8.json';
import {sourceEase,SOURCE_EASING_NAMES} from '../src/engine/sourceEasing';
import {EASING_NAMES,easingCurve} from '../src/engine/timeline';
const data=new DataView(new ArrayBuffer(4));
const value=(hex:string)=>{data.setUint32(0,Number.parseInt(hex,16));return data.getFloat32(0);};
const bits=(x:number)=>{data.setFloat32(0,x);return data.getUint32(0).toString(16).padStart(8,'0');};

describe('retained source Spirograph easing',()=>{
 it('has the same 46 public names, independently resolved from each retained inner apply',()=>{
  expect(SOURCE_EASING_NAMES).toEqual(EASING_NAMES);
  expect([...SOURCE_EASING_NAMES].sort()).toEqual(fixture.registry.map(r=>r.name).sort());
  expect(new Set(fixture.registry.map(r=>r.classSha256)).size).toBe(46);
 });
 for(const [name,outputs] of Object.entries(fixture.outputBits))it(`${name}: matches independent float-stage transcription at 161 inputs`,()=>{
  for(let i=0;i<fixture.inputBits.length;i++){
   const input=value(fixture.inputBits[i]),actual=sourceEase(name,input),expected=value(outputs[i]);
   if(Number.isNaN(expected))expect(actual,`${name}(${fixture.inputBits[i]})`).toBeNaN();
   else expect(bits(actual),`${name}(${fixture.inputBits[i]})`).toBe(outputs[i]);
  }
 });
 it('does not silently native-map unknown or historical step and accepts public/source spelling',()=>{
  for(const name of ['step','unknown','',' sine-in','toString'])expect(()=>sourceEase(name,.3)).toThrow('未知源缓动');
  expect(sourceEase('SINE_IN_OUT',.3)).toBe(sourceEase('sine-in-out',.3));
 });
 it('preserves LINEAR range/negative zero/NaN while named helpers apply native constrain',()=>{
  expect(sourceEase('linear',2)).toBe(2);expect(sourceEase('linear',Infinity)).toBe(Infinity);
  expect(Object.is(sourceEase('linear',-0),-0)).toBe(true);
  expect(sourceEase('quad-in',-Infinity)).toBe(0);expect(sourceEase('quad-in',Infinity)).toBe(1);
  for(const name of SOURCE_EASING_NAMES)expect(sourceEase(name,NaN)).toBeNaN();
  expect(sourceEase('linear',1/3)).toBe(Math.fround(1/3));
 });
 it('keeps overshoot and non-unit endpoints instead of normalizing results',()=>{
  expect(sourceEase('back-in',.25)).toBeLessThan(0);expect(sourceEase('back-out',.75)).toBeGreaterThan(1);
  expect(sourceEase('elastic-out',.15)).toBeGreaterThan(1);
  expect(sourceEase('not-quite-there',1)).toBe(Math.fround(.7));
  expect(sourceEase('there-and-back',1)).toBe(0);
  expect(sourceEase('exponential-decay',1)).toBeLessThan(1);
 });
 it('retains known source algorithms instead of merely frounding the local curves',()=>{
  expect(sourceEase('running-start',.25)).not.toBe(Math.fround(easingCurve('running-start')(.25)));
  expect(sourceEase('wiggle',.25)).toBeGreaterThan(.49);
  expect(Math.abs(easingCurve('wiggle')(.25))).toBeLessThan(1e-8);
  expect(sourceEase('lingering',.6)).toBe(.75);
  expect(sourceEase('exponential-decay',.1)).toBeGreaterThan(.63);
 });
});
