import {describe,it,expect} from 'vitest';
import {prepareSourceSurfaceColors,refreshSourceSurfaceColors} from '../src/engine/sourceSurfaceColor';
import {smoothSourceSurfaceCyclicRows,type SourceSurfaceGradientMode} from '../src/engine/sourceSurfaceGradient';

// Independent Python integer/Float32 transcription, retained MathArt JAR SHA256
// a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018.
// ParametricSurface.blurColor PC0–147; smoothCyclicGradientInPlace PC0–127;
// refreshParticleColorsByOffset PC207–248; MeshSurface smoothing passes=3.
// RGB sample oracle is scripts/source-surface-gradient-oracle.py. Expected
// constants below are generated independently; no production outputs used.
const golden={
 palette:[301924352, 2298543872, 4009754879],
 samples:[
  {"mode":"hue_rotate","numU":1,"cyclic":false,"state":{"primary":0,"secondary":0,"blend":0},"expected":[301924352]},
  {"mode":"hue_rotate","numU":1,"cyclic":true,"state":{"primary":0,"secondary":0,"blend":0},"expected":[301924352]},
  {"mode":"hue_rotate","numU":2,"cyclic":false,"state":{"primary":0,"secondary":0,"blend":0},"expected":[301924352,301924352]},
  {"mode":"hue_rotate","numU":2,"cyclic":true,"state":{"primary":0,"secondary":0,"blend":0},"expected":[301924352,301924352]},
  {"mode":"hue_rotate","numU":3,"cyclic":false,"state":{"primary":0,"secondary":0,"blend":0},"expected":[301924352,2298543872,301924352]},
  {"mode":"hue_rotate","numU":3,"cyclic":true,"state":{"primary":0,"secondary":0,"blend":0},"expected":[301924352,3154149247,301924352]},
  {"mode":"hue_rotate","numU":4,"cyclic":false,"state":{"primary":0,"secondary":0,"blend":0},"expected":[301924352,1633004032,2868947541,301924352]},
  {"mode":"hue_rotate","numU":4,"cyclic":true,"state":{"primary":0,"secondary":0,"blend":0},"expected":[2186826836,2220120148,2236896344,2186826836]},
  {"mode":"hue_rotate","numU":7,"cyclic":false,"state":{"primary":0,"secondary":0,"blend":0},"expected":[301924352,967464192,1633004032,2298543872,2868947541,3439351209,301924352]},
  {"mode":"hue_rotate","numU":7,"cyclic":true,"state":{"primary":0,"secondary":0,"blend":0},"expected":[1602959930,1634692896,2235206458,2803920751,2788833931,2188320879,1602959930]},
  {"mode":"offset_cycle","numU":7,"cyclic":false,"state":{"primary":0.1875,"secondary":0.625,"blend":0.375},"expected":[1932772103,2318438205,1532927744,1736391236,2670161512,3355467423,1932772103]},
  {"mode":"offset_cycle","numU":7,"cyclic":true,"state":{"primary":0.1875,"secondary":0.625,"blend":0.375},"expected":[2235855176,2235660612,2069194563,1919635014,1936541258,2086295372,2235855176]},
  {"mode":"cross_fade","numU":7,"cyclic":false,"state":{"primary":0.1875,"secondary":0.625,"blend":0.375},"expected":[1067536905,2117378853,2969606500,2319153226,3138086795,3724552405,1567196431]},
  {"mode":"cross_fade","numU":7,"cyclic":true,"state":{"primary":0.1875,"secondary":0.625,"blend":0.375},"expected":[1785877050,2153012302,2454276461,2404920952,2037720675,1719875396,1785877050]},
  {"mode":"palette_morph","numU":7,"cyclic":false,"state":{"primary":0.1875,"secondary":0.625,"blend":0.375},"expected":[1484677916,2451871554,2986382696,1800897824,2955427733,3037556608,1984466216]},
  {"mode":"palette_morph","numU":7,"cyclic":true,"state":{"primary":0.1875,"secondary":0.625,"blend":0.375},"expected":[2019774029,2203471960,2237155678,2053587542,1853112904,1852983109,2019774029]}
 ],
 blur:[
  {"input":[0,16909060,84281096,3735928559],"expected":[33751812,33751812,50529284,3735928559]},
  {"input":[4278190080,16711680,65280,255,4286611584,287454020],"expected":[2337946170,1482574378,944397898,1480219246,2336506980,287454020]},
  {"input":[4294967295,0,2864434397],"expected":[4294967295,0,2864434397]}
 ]
} as const;
const palette={colors:golden.palette.map(color=>'#'+color.toString(16).padStart(8,'0'))};
describe('native mesh cyclic palette smoothing',()=>{
 it.each(golden.blur)('convolves ARGB integer channels using separate pass buffers: $input',row=>{
  const actual=new Uint32Array(row.input);smoothSourceSurfaceCyclicRows(actual,3);
  expect([...actual]).toEqual(row.expected);
  // The helper never writes the redundant seam; owner replaces it afterward.
  expect(actual.at(-1)).toBe(row.input.at(-1));
 });
 it.each(golden.samples)('samples $mode rows=$numU cyclic=$cyclic with three source passes',row=>{
  const out=prepareSourceSurfaceColors(palette,row.numU,2,row.cyclic,3);
  if(row.mode==='hue_rotate')expect([...out.packed]).toEqual(row.expected.flatMap(color=>[color,color]));
  refreshSourceSurfaceColors(out,row.numU,2,row.state,row.mode as SourceSurfaceGradientMode,'rgb',row.cyclic,undefined,3);
  expect([...out.packed]).toEqual(row.expected.flatMap(color=>[color,color]));
  expect([...out.colors]).toEqual(row.expected.flatMap(color=>{
   const rgb=[Math.fround(((color>>>16)&255)/255),Math.fround(((color>>>8)&255)/255),Math.fround((color&255)/255)];return[...rgb,...rgb];
  }));
 });
 it('leaves point smoothing disabled and does not mutate authored palette',()=>{
  const before=JSON.stringify(palette),rows=new Uint32Array([0xff000000,0xffffffff,0xffff0000,0xff000000]);
  smoothSourceSurfaceCyclicRows(rows,0);expect([...rows]).toEqual([0xff000000,0xffffffff,0xffff0000,0xff000000]);
  const points=prepareSourceSurfaceColors(palette,4,1,true);
  // Native applyPalette overwrites initDots reversed gradient, using increasing U.
  expect([...points.packed]).toEqual([0x11ff0000,0x8900ff00,0xef0000ff,0x11ff0000]);
  expect(JSON.stringify(palette)).toBe(before);
 });
});
