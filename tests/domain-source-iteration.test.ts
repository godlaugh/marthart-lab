import {describe,expect,it} from 'vitest';
import {parseDomainSourceIteration,parseDomainIterationVersion} from '../src/engine/domainSourceIteration';
import type {Settings} from '../src/types';

describe('explicit source Domain iteration facts',()=>{
 it('selects formula semantics independently of the color version',()=>{
  expect(parseDomainIterationVersion(undefined)).toBe('local-v1');expect(parseDomainIterationVersion('mathart-1.7.8')).toBe('mathart-1.7.8');
  for(const value of['mathart-1.7.8-cpu','mathart-1.7.8-gpu'] as const)expect(parseDomainIterationVersion(value)).toBe(value);
  for(const value of[null,'mathart-1.7.9',true,0])expect(()=>parseDomainIterationVersion(value)).toThrow();
 });
 it('keeps authored steps separate from the source runtime ceiling',()=>{
  for(const [steps,maxSteps,effective]of[[1,64,1],[65,64,64],[65,100,65],[256,999,256],[999,999,256],[-1,0,1]]){
   const settings:Settings={iterationEnabled:true,iterationSteps:steps,iterationMaxSteps:maxSteps},before=JSON.stringify(settings);
   expect(parseDomainSourceIteration(settings)).toMatchObject({authoredSteps:steps,authoredMaxSteps:maxSteps,steps:effective});expect(JSON.stringify(settings)).toBe(before);
  }
  expect(parseDomainSourceIteration({iterationSteps:999,iterationMaxSteps:999})).toMatchObject({enabled:false,steps:1});
 });
 it('uses source defaults and float32 positive escape normalization without UI clamps',()=>{
  expect(parseDomainSourceIteration({})).toEqual({enabled:false,authoredSteps:1,authoredMaxSteps:64,steps:1,escapeRadius:1e6});
  expect(parseDomainSourceIteration({bailout:1.1}).escapeRadius).toBe(Math.fround(1.1));
  expect(parseDomainSourceIteration({bailout:1e-20}).escapeRadius).toBe(1);
  for(const bailout of[NaN,Infinity,-1,0,1e100])expect(parseDomainSourceIteration({bailout}).escapeRadius).toBe(1e6);
 });
 it('rejects wrong types and values that cannot be source integer facts',()=>{
  const cases:Settings[]=[{iterationEnabled:1},{iterationSteps:1.5},{iterationSteps:2147483648},{iterationMaxSteps:-2147483649},{iterationSteps:'2'},{bailout:'2'}];
  for(const settings of cases)expect(()=>parseDomainSourceIteration(settings)).toThrow();
 });
});
