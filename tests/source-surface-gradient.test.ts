import {describe,it,expect} from 'vitest';
import {prepareSourceSurfacePalette,prepareSourceSurfaceColors} from '../src/engine/sourceSurfaceColor';
import {INITIAL_SOURCE_SURFACE_PALETTE_STATE,sourceSurfacePaletteTarget,smoothSourceSurfacePalette,sampleSourceSurfaceGradient,sourceSurfaceTrailAgeKey,type SourceSurfaceGradientMode} from '../src/engine/sourceSurfaceGradient';
import golden from './fixtures/source-surface-gradient/numerics.json';

const mode=(value:string)=>value.toLowerCase() as SourceSurfaceGradientMode;
describe('source surface palette calculations against independent bytecode transcription',()=>{
 it.each(golden.mapping)('maps $name',row=>{
  expect(sourceSurfacePaletteTarget(row.frame,mode(row.mode))).toEqual(row.expected);
 });
 it.each(golden.smoothing)('smooths $name',row=>{
  expect(smoothSourceSurfacePalette(row.previous,row.target)).toEqual({state:row.expected,changed:row.changed});
 });
 it.each(golden.samples)('samples packed color $name',row=>{
  expect(sampleSourceSurfaceGradient(row.palette,row.coordinate,row.state,mode(row.mode),'rgb',row.cyclic)).toBe(row.expected);
 });
 it.each(golden.ages)('quantizes age $name',row=>{
  const special='nonFiniteInputs'in row?row.nonFiniteInputs:undefined;
  const number=(key:'time'|'recordTime')=>special?.[key]?Number(special[key]):row[key]!;
  expect(sourceSurfaceTrailAgeKey(number('time'),number('recordTime'))).toBe(row.expected);
 });
 it('keeps noncyclic RGB interpolation even when a perceptual interpolation is requested',()=>{
  for(const interpolation of ['rgb','linear','oklab','oklch'] as const){
   expect(sampleSourceSurfaceGradient([0xff000000,0xffffffff],.5,INITIAL_SOURCE_SURFACE_PALETTE_STATE,'hue_rotate',interpolation,false)).toBe(0xff7f7f7f);
  }
  // Cyclic midpoint of black/white; ManimColors linear/OKLab/OKLCH goldens.
  expect(sampleSourceSurfaceGradient([0xff000000,0xffffffff],.25,INITIAL_SOURCE_SURFACE_PALETTE_STATE,'hue_rotate','linear',true)).toBe(0xffbcbcbc);
  for(const interpolation of ['oklab','oklch'] as const)expect(sampleSourceSurfaceGradient([0xff000000,0xffffffff],.25,INITIAL_SOURCE_SURFACE_PALETTE_STATE,'hue_rotate',interpolation,true)).toBe(0xff636363);
 });
 it('retains old components for nonfinite targets, and applies repeated callback smoothing separately',()=>{
  const previous={primary:Math.fround(.2),secondary:Math.fround(.4),blend:Math.fround(.3)};
  expect(smoothSourceSurfacePalette(previous,{primary:NaN,secondary:Infinity,blend:-Infinity})).toEqual({state:previous,changed:false});
  const target=sourceSurfacePaletteTarget({palette:0,inside:0,outside:0},'hue_rotate');
  const first=smoothSourceSurfacePalette(INITIAL_SOURCE_SURFACE_PALETTE_STATE,target),second=smoothSourceSurfacePalette(first.state,target);
  expect(first.changed&&second.changed).toBe(true);expect(second.state.secondary).toBeGreaterThan(first.state.secondary);expect(second.state.blend).toBeGreaterThan(first.state.blend);
 });
 it('prepares immutable palette facts once while preserving independent static output ownership',()=>{
  const input={colors:['#FF0000','invalid','#0000FF']},facts=prepareSourceSurfacePalette(input);
  expect(facts.packed).toEqual([0xffff0000,0xffffffff,0xff0000ff]);expect(facts.diagnostics).toHaveLength(1);
  expect(Object.isFrozen(facts)&&Object.isFrozen(facts.packed)&&Object.isFrozen(facts.diagnostics)).toBe(true);
  const out=prepareSourceSurfaceColors(input,4,1,false);out.packed.fill(0);out.diagnostics.length=0;
  expect(facts.packed[0]).toBe(0xffff0000);expect(facts.diagnostics).toHaveLength(1);expect(input.colors[1]).toBe('invalid');
 });
});
