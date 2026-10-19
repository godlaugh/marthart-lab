import {describe,it,expect} from 'vitest';
import {SourcePerlinColorRuntime,SOURCE_PERLIN_DEFAULT_PALETTE,SOURCE_PERLIN_COLOR_LIMIT} from '../src/engine/sourcePerlinColorRuntime';
import type {SourceGradientAction,SourceGradientConfiguration} from '../src/engine/sourceGradientRuntime';
import fixture from './fixtures/source-perlin/colors.json';

const palette=[0x60ff0000,0xa000ff00,0xe00000ff];
const config:SourceGradientConfiguration={mode:'hue_rotate',interpolation:'linear',speed:90};
const start:SourceGradientAction={kind:'start',config};
function advance(owner:SourcePerlinColorRuntime){owner.beginGradientActions([start]);owner.interpolateGradientActions(1,true);owner.update(.25);}
function stop(owner:SourcePerlinColorRuntime){owner.beginGradientActions([{kind:'stop'}]);owner.interpolateGradientActions(1,true);}

type OracleAction={kind:'stop'}|({kind:'start'}&SourceGradientConfiguration);
type OracleOperation={kind:'begin';actions:OracleAction[]}|{kind:'interpolate';eased:number;finished:boolean}|{kind:'update';dt:number}|{kind:'draw'}|{kind:'replace';palette:number[]};

describe('Perlin independent bytecode-derived color oracle (not JVM execution)',()=>{
 it.each(fixture.cases)('$name',testCase=>{
  const owner=new SourcePerlinColorRuntime({palette:testCase.palette});
  const row=(texture?:Uint32Array)=>{
   const snapshot=owner.snapshot(),g=snapshot.gradient;
   return{state:snapshot.state,revision:snapshot.revision,running:g.running,progress:g.progress,speedScale:g.speedScale,base:g.base,
    current:fixture.coordinates.map(t=>owner.sampleCurrent(t)),refreshed:snapshot.refreshed?fixture.coordinates.map(t=>owner.sampleRefreshed(t)):null,
    textureDirty:snapshot.textureDirty,textureBuilds:snapshot.textureBuilds,...(texture?{texture:Array.from(texture)}:{})};
  };
  expect(row()).toEqual(testCase.rows[0]);
  for(const [i,op] of (testCase.operations as OracleOperation[]).entries()){
   let texture:Uint32Array|undefined;
   if(op.kind==='begin')owner.beginGradientActions(op.actions.map(a=>a.kind==='stop'?{kind:'stop'}:{kind:'start',config:{mode:a.mode,interpolation:a.interpolation,speed:a.speed}}));
   else if(op.kind==='interpolate')owner.interpolateGradientActions(op.eased,op.finished);
   else if(op.kind==='update')owner.update(op.dt);
   else if(op.kind==='replace')owner.replacePalette(op.palette);
   else if(op.kind==='draw')texture=owner.paletteTexture();
   else throw Error('Unknown fixture operation');
   expect(row(texture),`${testCase.name} operation ${i} ${op.kind}`).toEqual(testCase.rows[i+1]);
  }
 });
});

describe('Perlin source color refresh ownership',()=>{
 it('keeps initial particle ownership separate from shifted curve/image sampling',()=>{
  let calls=0;const owner=new SourcePerlinColorRuntime({palette,onRefresh:()=>calls++});
  expect(owner.sampleRefreshed(1)).toBeUndefined();expect(owner.sampleCurrent(1)).toBe(palette[0]);
  expect(owner.paletteTexture()).toHaveLength(256);expect(calls).toBe(0);
  owner.beginGradientActions([start]);owner.interpolateGradientActions(1,true);owner.update(0);
  expect(owner.snapshot().revision).toBe(0);expect(owner.sampleRefreshed(1)).toBeUndefined();
 });
 it('preserves immediate CPU colors and already built GPU texture across stop',()=>{
  const owner=new SourcePerlinColorRuntime({palette});advance(owner);
  const color=owner.sampleRefreshed(.5),image=owner.paletteTexture(),before=owner.snapshot();
  stop(owner);owner.update(10);
  expect(owner.sampleRefreshed(.5)).toBe(color);expect(owner.sampleCurrent(.5)).not.toBe(color);
  expect(owner.paletteTexture()).toEqual(image);expect(owner.snapshot().textureBuilds).toBe(before.textureBuilds);
  expect(owner.snapshot().revision).toBe(before.revision);expect(owner.snapshot().gradient.running).toBe(false);
 });
 it('builds a dirty GPU texture from current state, even if stopped after CPU refresh',()=>{
  const owner=new SourcePerlinColorRuntime({palette});advance(owner);stop(owner);
  const image=owner.paletteTexture();
  expect(image[128]).toBe(owner.sampleCurrent(Math.fround(128/255)));
  expect(image[128]).not.toBe(owner.sampleRefreshed(Math.fround(128/255)));
  expect(owner.snapshot().refreshed?.running).toBe(true);expect(owner.snapshot().textureDirty).toBe(false);
 });
 it('does not invalidate on interpolation/running-only changes but first GPU draw observes them',()=>{
  const seen:((t:number)=>number)[]=[];
  const owner=new SourcePerlinColorRuntime({palette,onRefresh:sample=>seen.push(sample)});
  owner.beginGradientActions([{kind:'start',config:{...config,speed:0,interpolation:'oklab'}}]);
  const live=owner.sampleCurrent(.125);expect(owner.snapshot().revision).toBe(0);
  const texture=owner.paletteTexture();
  owner.beginGradientActions([{kind:'start',config:{...config,speed:0,interpolation:'rgb'}}]);
  expect(owner.sampleCurrent(.125)).not.toBe(live);expect(owner.paletteTexture()).toEqual(texture);
  expect(seen).toHaveLength(0);expect(owner.snapshot().textureBuilds).toBe(1);
 });
 it('captures immutable refresh recipes; palette edits refresh without regenerating geometry',()=>{
  const recipes:((t:number)=>number)[]=[];
  const input=[...palette],owner=new SourcePerlinColorRuntime({palette:input,onRefresh:sample=>recipes.push(sample)});
  input.fill(0);expect(owner.sampleCurrent(0)).toBe(palette[0]);advance(owner);
  const first=recipes.at(-1)!,color=first(.5),revision=owner.snapshot().revision;
  owner.update(.25);expect(first(.5)).toBe(color);expect(owner.sampleRefreshed(.5)).not.toBe(color);
  owner.replacePalette([]);expect(owner.snapshot().revision).toBe(revision+1);
  owner.replacePalette([0x00123456]);expect(owner.sampleRefreshed(.5)).toBe(0x00123456);
  expect(first(.5)).toBe(color);expect(owner.snapshot().textureDirty).toBe(true);
  const snapshot=owner.snapshot();expect(Object.isFrozen(snapshot.state)).toBe(true);expect(Object.isFrozen(snapshot.refreshed)).toBe(true);
  const texture=owner.paletteTexture();texture.fill(0);expect(owner.paletteTexture()[0]).toBe(0x00123456);
 });
 it('uses source default for initial empty palette and keeps raw packed image alpha',()=>{
  const empty=new SourcePerlinColorRuntime({palette:[]}),absent=new SourcePerlinColorRuntime();
  expect(empty.sampleCurrent(0)).toBe(SOURCE_PERLIN_DEFAULT_PALETTE[0]);expect(empty.paletteTexture()).toEqual(absent.paletteTexture());
  const single=new SourcePerlinColorRuntime({palette:[0x00000080]});advance(single);
  expect(single.paletteTexture()[0]).toBe(128);expect(single.sampleRefreshed(.5)).toBe(128);
 });
 it('validates decoded boundaries before allocation and preserves failures',()=>{
  expect(()=>new SourcePerlinColorRuntime({palette:new Array(SOURCE_PERLIN_COLOR_LIMIT+1)})).toThrow('预算');
  for(const value of [-1,1.5,NaN,Infinity,0x100000000])expect(()=>new SourcePerlinColorRuntime({palette:[value]})).toThrow('ARGB');
  let flag=false;const cancelled=new SourcePerlinColorRuntime({isCancelled:()=>flag});
  flag=true;expect(()=>cancelled.update(.25)).toThrow('取消');flag=false;expect(()=>cancelled.snapshot()).toThrow('取消');
 });
 it('latches synchronous consumer failures instead of publishing partially recolored output',()=>{
  let reject=true;const error=Error('particle color capacity'),owner=new SourcePerlinColorRuntime({palette,onRefresh:()=>{if(reject)throw error;}});
  expect(()=>advance(owner)).toThrow(error);reject=false;
  expect(()=>owner.paletteTexture()).toThrow(error);expect(()=>owner.snapshot()).toThrow(error);
 });
 it('keeps completed easing repair and rejects invalid frame clock/action inputs',()=>{
  const owner=new SourcePerlinColorRuntime({palette});owner.beginGradientActions([start]);
  owner.interpolateGradientActions(NaN,true);owner.update(.25);expect(owner.snapshot().gradient.speedScale).toBe(1);
  expect(()=>new SourcePerlinColorRuntime().update(Infinity)).toThrow('帧时长');
  expect(()=>new SourcePerlinColorRuntime().beginGradientActions([{kind:'start',config:{...config,speed:-1}}])).toThrow('非负');
  expect(()=>new SourcePerlinColorRuntime().beginGradientActions(Array.from({length:65},()=>start))).toThrow('预算');
 });
});
