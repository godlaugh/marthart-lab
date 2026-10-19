import {describe,it,expect} from 'vitest';
import fixture from './fixtures/source-attractor/colors.json';
import {SourceAttractorColorRuntime} from '../src/engine/sourceAttractorColorRuntime';
import type {SourceGradientAction,SourceGradientConfiguration} from '../src/engine/sourceGradientRuntime';

const palette={kind:'colors' as const,colors:fixture.palette.map(n=>'#'+n.toString(16).padStart(8,'0'))};
const config:SourceGradientConfiguration={mode:'hue_rotate',interpolation:'rgb',speed:90};
const start:SourceGradientAction={kind:'start',config};
describe('source Attractor current color owner',()=>{
 it.each(fixture.cases)('matches independent source color lifecycle: $name',c=>{
  const owner=new SourceAttractorColorRuntime({count:3,nativeBackend:'cpu',showTrails:true,palette});
  const rows=[owner.snapshot()];
  for(const actions of c.groups){
   owner.beginGradientActions(actions.map(kind=>kind==='stop'?{kind:'stop'}:{kind:'start',config:{mode:c.mode,interpolation:c.interpolation,speed:90}}) as SourceGradientAction[]);
   for(const eased of [.5,1]){owner.interpolateGradientActions(eased,eased===1);owner.update(.25);rows.push(owner.snapshot());}
  }
  owner.update(0);rows.push(owner.snapshot());
  expect(rows.map(r=>({packed:Array.from(r.packed),state:r.state,running:r.gradient.running,progress:r.gradient.progress,speedScale:r.gradient.speedScale,base:r.gradient.base}))).toEqual(c.rows);
 });
 it('keeps shared current packed identity, refreshes all history colors together, and publishes copies',()=>{
  const owner=new SourceAttractorColorRuntime({count:3,nativeBackend:'cpu',showTrails:true,palette}),borrowed=owner.packed,before=borrowed.slice();
  owner.beginGradientActions([start]);owner.interpolateGradientActions(1,true);owner.update(.25);
  expect(owner.packed).toBe(borrowed);expect(borrowed).not.toEqual(before);expect(borrowed[0]).toBe(borrowed[2]);
  const snap=owner.snapshot();snap.packed.fill(0);snap.colors.fill(0);snap.alphas.fill(0);expect(owner.packed[0]).not.toBe(0);expect(owner.alphas[0]).toBeGreaterThan(0);
 });
 it('preserves initial single-slot last color until a changed gradient callback',()=>{
  const owner=new SourceAttractorColorRuntime({count:1,nativeBackend:'cpu',showTrails:true,palette});
  expect(owner.packed[0]).toBe(fixture.palette[2]);owner.beginGradientActions([start]);expect(owner.packed[0]).toBe(fixture.palette[2]);
  owner.interpolateGradientActions(1,true);owner.update(.25);expect(owner.packed[0]).not.toBe(fixture.palette[2]);
 });
 it('uses Processing tint interpretation without changing packed trail color',()=>{
  const owner=new SourceAttractorColorRuntime({count:1,nativeBackend:'cpu',showTrails:true,palette:{kind:'colors',colors:['#00000080']}});
  expect(owner.packed[0]).toBe(128);expect(Array.from(owner.colors)).toEqual(Array(3).fill(Math.fround(128/255)));expect(owner.alphas[0]).toBe(1);
  const transparent=new SourceAttractorColorRuntime({count:1,nativeBackend:'cpu',showTrails:true,palette:{kind:'colors',colors:['#00123456']}});expect(transparent.alphas[0]).toBe(0);
 });
 it.each([{nativeBackend:'gpu' as const,showTrails:true},{nativeBackend:'cpu' as const,showTrails:false}])('gates unsupported gradient lifecycle at source admission: %o',gate=>{
  const owner=new SourceAttractorColorRuntime({count:3,...gate,palette}),before=owner.packed.slice();owner.beginGradientActions([start]);owner.interpolateGradientActions(1,true);owner.update(100);
  expect(owner.packed).toEqual(before);expect(owner.snapshot().gradient.running).toBe(false);
 });
 it('snapshots caller options, handles explicit empty palette, and admits empty particle arrays',()=>{
  const options={count:1,nativeBackend:'cpu' as const,showTrails:true,palette:{kind:'colors' as const,colors:[] as string[]}};
  const a=new SourceAttractorColorRuntime(options),b=new SourceAttractorColorRuntime({count:1,nativeBackend:'cpu',showTrails:true});expect(a.packed).toEqual(b.packed);options.palette.colors.push('#000000');options.showTrails=false;
  a.beginGradientActions([start]);a.interpolateGradientActions(1,true);a.update(.25);expect(a.snapshot().gradient.running).toBe(true);
  const empty=new SourceAttractorColorRuntime({count:0,nativeBackend:'cpu',showTrails:true});empty.beginGradientActions([start]);empty.interpolateGradientActions(1,true);empty.update(.25);expect(empty.snapshot().packed).toHaveLength(0);
 });
 it('rejects oversized allocation and retains cancellation/refresh budget failure',()=>{
  expect(()=>new SourceAttractorColorRuntime({count:2147483647,nativeBackend:'cpu',showTrails:true})).toThrow('预算');
  let cancelled=false;const a=new SourceAttractorColorRuntime({count:3,nativeBackend:'cpu',showTrails:true,isCancelled:()=>cancelled});cancelled=true;expect(()=>a.update(.25)).toThrow('取消');cancelled=false;expect(()=>a.snapshot()).toThrow('取消');
  let reject=false;const b=new SourceAttractorColorRuntime({count:3,nativeBackend:'cpu',showTrails:true,reserve:()=>{if(reject)throw Error('shared budget');}});b.beginGradientActions([start]);b.interpolateGradientActions(1,true);reject=true;expect(()=>b.update(.25)).toThrow('shared budget');reject=false;expect(()=>b.update(.25)).toThrow('shared budget');
 });
});

describe('source color operation budget scope',()=>{
 it('allows long bounded color updates while retaining cumulative work statistics',()=>{
  const owner=new SourceAttractorColorRuntime({count:1000,nativeBackend:'cpu',showTrails:true,palette});
  owner.beginGradientActions([start]);owner.interpolateGradientActions(1,true);
  const before=owner.packed.slice();
  for(let i=0;i<700;i++)owner.update(1/30);
  expect(owner.snapshot().workUnits).toBeGreaterThan(20_000_000);expect(owner.packed).not.toEqual(before);
 });
 it('includes nested gradient callbacks in one operation and latches rejection',()=>{
  const owner=new SourceAttractorColorRuntime({count:625000,nativeBackend:'cpu',showTrails:true,palette});
  owner.beginGradientActions([start]);owner.interpolateGradientActions(1,true);
  // update's scalar charge plus the color callback exceeds20M; each alone fits.
  expect(()=>owner.update(.25)).toThrow('2000 万');
  expect(()=>owner.snapshot()).toThrow('2000 万');
 });
});
