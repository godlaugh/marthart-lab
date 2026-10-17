import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import golden from './fixtures/domain-color-cpu-golden.json';
import {compileDomainPalette} from '../src/engine/domainGradient';
import {compileColorInterpolation} from '../src/engine/colorInterpolation';
import {prepareDomainGpuColor,MAX_DOMAIN_COLOR_TEXTURE_BYTES} from '../src/engine/domainGpuColor';
import {parseDomainModel as parseAnyDomainModel,shadeDomainValue} from '../src/engine/domainModel';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import type {Palette} from '../src/types';
const hash=(data:Float64Array)=>createHash('sha256').update(new Uint8Array(data.buffer)).digest('hex');
const make=()=>{const scene=createScene(definition('domain'));scene.settings={...scene.settings,curveMode:'NONE',curveMix:0,curveBias:0};return scene;};
const parseDomainModel=(...args:Parameters<typeof parseAnyDomainModel>)=>{const m=parseAnyDomainModel(...args);if(m.colorVersion!=='local-v1')throw Error('expected local-v1 fixture');return m;};
describe('Domain GPU color parsed adapter',()=>{
 it('retains all58 pre-refactor CPU Float64 sampling golden rows',()=>{
  const rows=[];for(let p=0;p<golden.palettes.length;p++)for(const runtime of [undefined,...['rgb','linear','oklab','oklch'].map(interpolation=>({running:true,interpolation})),{running:false,interpolation:'oklab'}] as const){
   const r=compileDomainPalette(golden.palettes[p] as Palette,runtime as Parameters<typeof compileDomainPalette>[1]);rows.push({palette:p,runtime:runtime??null,sha256:hash(Float64Array.from(golden.coordinates.flatMap(x=>r.sample(x)))),warnings:r.warnings});
  }
  for(const space of ['rgb','linear','oklab','oklch'] as const){const sample=compileColorInterpolation([1,.1,.5],[.03,.9,.7],space);rows.push({space,sha256:hash(Float64Array.from(golden.coordinates.filter(x=>x>=0&&x<=1).flatMap(sample)))});}
  expect(rows).toEqual(golden.rows);
 });
 it('selects runtime cyclic only through the Domain owner, keeping dormant rich palette facts',()=>{
  const scene=make();for(const mode of ['linear','sine','hsv','cosine','curve'] as const){scene.palette={...scene.palette,mode};scene.evaluatedDomainGradient={running:true,interpolation:'oklch'};const m=parseDomainModel(scene,0);expect(m.paletteFacts.shape.kind).toBe(mode==='linear'?'cyclic':mode==='hsv'?'hsv-wheel':mode==='sine'?'stops':mode);expect(prepareDomainGpuColor(m,1080)).toHaveProperty('plan');}
  scene.palette={...scene.palette,mode:'linear',positions:[0,.2,.9,1]};expect(parseDomainModel(scene,0).paletteFacts.shape.kind).toBe('stops');
 });
 it('admits every runtime interpolation while keeping hot values out of shader identity',()=>{
  const scene=make(),keys=[];for(const interpolation of ['rgb','linear','oklab','oklch'] as const){scene.evaluatedDomainGradient={running:true,interpolation};const p=prepareDomainGpuColor(parseDomainModel(scene,0),2160);if(!('plan'in p))throw Error(p.reason);keys.push(p.plan.key);expect(p.plan.source).toContain('vec3 domainShade(');expect(p.plan.textures[0].data.some(x=>x!==0)).toBe(true);}
  expect(new Set(keys).size).toBe(1);
 });
 it('accounts for exact segment payload before GL allocation and preserves caller palette',()=>{
  const scene=make();scene.palette={...scene.palette,stops:Array.from({length:1024},()=> '#112233')};const before=JSON.stringify(scene),result=prepareDomainGpuColor(parseDomainModel(scene,0),1080);if(!('plan'in result))throw Error(result.reason);
  expect(result.plan.textureBytes).toBe(MAX_DOMAIN_COLOR_TEXTURE_BYTES);expect(result.plan.textures[0].data.byteLength).toBe(MAX_DOMAIN_COLOR_TEXTURE_BYTES);expect(JSON.stringify(scene)).toBe(before);
 });
 it('does not silently reduce huge offsets, collapse knots or truncate cosine coefficients',()=>{
  const scene=make();for(const palette of [{...scene.palette,offset:1e30},{...scene.palette,positions:[0,.5,.5+Number.EPSILON,1]},{...scene.palette,mode:'cosine',cosine:{a:[1e20,0,0],b:[-1e20,1,1],c:[1e-30,1,1],d:[0,0,0]}}] as Palette[]){scene.palette=palette;const before=JSON.stringify(scene),r=prepareDomainGpuColor(parseDomainModel(scene,0),1080);expect(r).toHaveProperty('reason');expect(JSON.stringify(scene)).toBe(before);}
 });
 it('keeps CPU invalid classification and color sampler semantics outside the adapter',()=>{
  const m=parseDomainModel(make(),0);expect(shadeDomainValue([1e13,0],[0,0],m,100)).toBeUndefined();expect(shadeDomainValue([0,0],[0,0],m,100)).toEqual([0,0,0]);expect(()=>prepareDomainGpuColor(m,0)).toThrow();
 });
});
