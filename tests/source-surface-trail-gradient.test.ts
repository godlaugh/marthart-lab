import {describe,it,expect} from 'vitest';
import {SourceGradientRuntime} from '../src/engine/sourceGradientRuntime';
import {prepareSourceSurfacePalette} from '../src/engine/sourceSurfaceColor';
import type {SourceSurfaceGradientMode} from '../src/engine/sourceSurfaceGradient';
import {createSourceSurfaceTrailGradient} from '../src/engine/sourceSurfaceTrailGradient';

const palette=prepareSourceSurfacePalette({colors:['#60FF0000','#A000FF00','#E00000FF']});
function running(mode:SourceSurfaceGradientMode='hue_rotate'){
 const runtime=new SourceGradientRuntime(()=>.125,()=>{});
 runtime.begin([{kind:'start',config:{mode,interpolation:'rgb',speed:90}}]);runtime.interpolate(1,true);runtime.update(1);
 return runtime;
}
function resolver(runtime=running(),numU=5,reserve:((units:number)=>void)=()=>{}){
 return createSourceSurfaceTrailGradient({palette,runtime,time:10,numU,numV:2,reserve});
}

describe('source surface historical gradient sampling',()=>{
 // Independent Python source-surface-gradient-oracle.py mapping/sample,
 // driven by double phase (.25 - 90 * F(F(ageKey)/120) / 360) modulo 1,
 // cubic easing and retained native mode equations; no product output oracle.
 // Packed alpha is retained here, then ignored by active trail stroke alpha.
 it.each([
  ['hue_rotate',[0x9821d605,0xaa00d429,0xd90b00f2,0x8aa90054,0x9821d605,0xc7005e9f]],
  ['offset_cycle',[0x9c32a724,0x9e13d910,0xbb351fa8,0xa17b0082,0x9c32a724,0xbd008578]],
  ['cross_fade',[0x87619a02,0xa500e518,0xcd0b2dc4,0xad63009a,0x9138c500,0xc300708d]],
  ['palette_morph',[0xaa00d12c,0x9a28c212,0xd11a02e1,0x83b60047,0x846b9200,0xb7009e5f]],
 ] as const)('matches independent RGB history witnesses for %s',(mode,expected)=>{
  const sample=resolver(running(mode));
  const points=[[0,10],[1,9],[2,9.5],[3,5],[4,10],[1,9.9958]];
  expect(points.map(([row,time])=>sample(row*2,time,0))).toEqual(expected);
 });
 it('shares row colors, quantizes age, retains sentinel fallback and samples future records at age zero',()=>{
  const sample=resolver();
  expect(sample(2,9.9958,0)).toBe(sample(3,9.993,0));
  expect(sample(0,NaN,0x12345678)).toBe(0x12345678);
  expect(sample(0,Infinity,0x87654321)).toBe(0x87654321);
  expect(sample(0,11,0)).toBe(sample(0,10,0));
 });
 it('owns an immutable draw snapshot across later runtime updates, stops and restarts',()=>{
  const runtime=running(),sample=resolver(runtime),initial=sample(0,10,0);
  runtime.update(1);expect(resolver(runtime)(0,10,0)).not.toBe(initial);
  runtime.begin([{kind:'stop'}]);runtime.interpolate(1,true);
  runtime.begin([{kind:'start',config:{mode:'cross_fade',interpolation:'oklch',speed:300}}]);runtime.interpolate(1,true);
  // A previously uncached row/age still uses the earlier snapshot.
  expect(sample(2,9,0)).toBe(0xaa00d429);expect(sample(0,10,0)).toBe(initial);
 });
 it('preserves native full-hash collisions and resets caches on a new draw',()=>{
  const runtime=running(),sample=resolver(runtime,512),firstTime=10-13/120,secondTime=10-247/120;
  // (age 13,row 469) and (age 247,row 23) both hash to 0x25d30bf2.
  const first=sample(469*2,firstTime,0),collision=sample(23*2,secondTime,0);
  expect(collision).toBe(first);
  expect(resolver(runtime,512)(23*2,secondTime,0)).not.toBe(first);
 });
 it('evicts direct-mapped slots without confusing distinct hashes or ages',()=>{
  const runtime=running(),sample=resolver(runtime),initial=sample(0,10,0);
  for(let age=1;age<=8192;age++)sample(0,10-age/120,0);
  expect(sample(0,10,0)).toBe(initial);
  expect(sample(2,9,0)).toBe(resolver(runtime)(2,9,0));
 });
 it('charges cache hits and fails before uncached work when the caller budget is exhausted',()=>{
  let units=0;const sample=resolver(running(),5,n=>{units+=n;if(units>200)throw new Error('budget');});
  const first=sample(0,10,0);expect(sample(1,10,0)).toBe(first);
  expect(()=>sample(2,9,0)).toThrow('budget');
 });
 it('rejects idle runtimes so static rendering remains the history owner’s decision',()=>{
  expect(()=>resolver(new SourceGradientRuntime(()=>0,()=>{}))).toThrow('正在运行');
 });
});
