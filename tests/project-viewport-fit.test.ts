import {describe,expect,it} from 'vitest';
import {parseProjectResolution} from '../src/engine/projectResolution';
import {projectViewportFit} from '../src/engine/projectViewportFit';

describe('project aspect in the local browser viewport',()=>{
 it('preserves omitted-profile fractional host dimensions exactly',()=>{
  expect(projectViewportFit(undefined,1000.123456789,701.987654321)).toEqual({width:1000.123456789,height:701.987654321,left:0,top:0});
 });
 it.each([
  [{width:1280,height:720},1000,1000,{width:1000,height:562.5,left:0,top:218.75}],
  [{width:720,height:1280},1000,1000,{width:562.5,height:1000,left:218.75,top:0}],
  [{width:512,height:512},300,200,{width:200,height:200,left:50,top:0}],
  [{width:64,height:8192},1024,1024,{width:8,height:1024,left:508,top:0}],
  [{width:8192,height:64},1024,1024,{width:1024,height:8,left:0,top:508}],
 ] as const)('fits %j into %s × %s without stretching', (resolution,width,height,expected)=>{
  const parsed=parseProjectResolution(resolution),before={...parsed};
  expect(projectViewportFit(parsed,width,height)).toEqual(expected);expect(parsed).toEqual(before);
 });
 it('retains the source float32 ratio/multiply before local CSS centering',()=>{
  // 800/600 -> float32 1.3333333730697632; times 700 -> 933.3333740234375.
  // Centering is intentionally browser CSS arithmetic, not a Swing pixel claim.
  expect(projectViewportFit(parseProjectResolution({width:800,height:600}),1000,700)).toEqual({width:933.3333740234375,height:700,left:33.33331298828125,top:0});
 });
 it('uses the same aspect for different configured sizes without treating them as canvas pixels',()=>{
  expect(projectViewportFit({width:1280,height:720},1000,1000)).toEqual(projectViewportFit({width:640,height:360},1000,1000));
 });
 it.each([0,-1,NaN,Infinity,-Infinity])('rejects unavailable host extent %s',value=>{
  expect(()=>projectViewportFit(undefined,value,200)).toThrow();expect(()=>projectViewportFit({width:64,height:64},200,value)).toThrow();
 });
 it('does not silently turn float32-overflow or underflow host sizes into a source fit',()=>{
  expect(()=>projectViewportFit({width:64,height:64},1e100,200)).toThrow('浮点范围');
  expect(()=>projectViewportFit({width:64,height:64},1e-100,200)).toThrow('浮点范围');
 });
});
