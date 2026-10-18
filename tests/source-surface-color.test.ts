import {describe,expect,it} from 'vitest';
import {parseSourceSurfacePalette,prepareSourceSurfaceColors} from '../src/engine/sourceSurfaceColor';

// Hand-derived static bytecode witnesses, not original-app executions:
// GenericSurfaceScene.createSurfaceForMode PCs1016–1033;
// ParametricSurface.refreshParticleColorsByOffset PCs130–302,
// sampleShiftedPalette PCs0–192; ManimColors.lerp PCs89–167.
const palette=(...colors:string[])=>({colors}),F=Math.fround;
describe('source surface final static palette owner',()=>{
 it('uses positive U-major rows after applyPalette overwrites reversed initialization',()=>{
  const out=prepareSourceSurfaceColors(palette('#FF0000','#0000FF'),5,2,false);
  expect(Array.from(out.packed)).toEqual([0xffff0000,0xffff0000,0xffbf003f,0xffbf003f,0xff7f007f,0xff7f007f,0xff3f00bf,0xff3f00bf,0xffff0000,0xffff0000]);
  expect(Array.from(out.colors.slice(6,9))).toEqual([F(191/255),0,F(63/255)]);
 });
 it('wraps the nonperiodic endpoint instead of preserving the final reference color',()=>{
  expect(Array.from(prepareSourceSurfaceColors(palette('#000000','#FFFFFF'),2,1,false).packed)).toEqual([0xff000000,0xff000000]);
 });
 it('samples cyclic palettes with n equal segments and closes the final U row',()=>{
  expect(Array.from(prepareSourceSurfaceColors(palette('#FF0000','#0000FF'),5,1,true).packed)).toEqual([0xffff0000,0xff7f007f,0xff0000ff,0xff7f007f,0xffff0000]);
 });
 it('does not allocate segment lengths by color distance',()=>{
  expect(Array.from(prepareSourceSurfaceColors(palette('#000000','#010000','#FFFFFF'),5,1,false).packed)).toEqual([0xff000000,0xff000000,0xff010000,0xff807f7f,0xff000000]);
 });
 it('keeps float32 thirds and packed-byte truncation across adjacent segments',()=>{
  expect(Array.from(prepareSourceSurfaceColors(palette('#FF0000','#00FF00','#0000FF'),4,1,false).packed)).toEqual([0xffff0000,0xff55aa00,0xff00aa55,0xffff0000]);
 });
 it('uses first reference at a single U row and retains single-color ARGB verbatim',()=>{
  expect(Array.from(prepareSourceSurfaceColors(palette('#010203','#FFFFFF'),1,3,true).packed)).toEqual([0xff010203,0xff010203,0xff010203]);
  const out=prepareSourceSurfaceColors(palette('#40010203'),4,1,false);
  expect(Array.from(out.packed)).toEqual([0x40010203,0x40010203,0x40010203,0x40010203]);
  expect(Array.from(out.colors.slice(0,3))).toEqual([F(1/255),F(2/255),F(3/255)]);
 });
 it('interpolates alpha in packed colors independently of RGB output',()=>{
  const out=prepareSourceSurfaceColors(palette('#00112233','#FF556677'),3,1,false);
  expect(Array.from(out.packed)).toEqual([0x00112233,0x7f334455,0x00112233]);
  expect(Array.from(out.colors.slice(3,6))).toEqual([F(51/255),F(68/255),F(85/255)]);
 });
 it('uses all six source default colors in cyclic order, then repeats the first',()=>{
  expect(Array.from(prepareSourceSurfaceColors(undefined,7,1,true).packed)).toEqual([0xfffc6255,0xffff862f,0xffffcd62,0xff83c167,0xff58c4dd,0xff9a72ac,0xfffc6255]);
 });
 it('retains invalid authored strings and recovers each with source white diagnostics',()=>{
  const input={colors:['bogus','0XFFFFFF','2147483648']},parsed=parseSourceSurfacePalette(input);
  expect(parsed).toEqual(input);expect(parsed.colors).not.toBe(input.colors);
  const out=prepareSourceSurfaceColors(parsed,4,1,false);
  expect(Array.from(out.packed)).toEqual([0xffffffff,0xffffffff,0xffffffff,0xffffffff]);
  expect(out.diagnostics).toHaveLength(3);expect(out.diagnostics[1]).toContain('第 2 色');expect(parsed.colors).toEqual(input.colors);
 });
 it('shares source decimal and 0x parsing without converting stored text',()=>{
  const input=palette('-65536','0x0000FF');expect(parseSourceSurfacePalette(input)).toEqual(input);
  expect(Array.from(prepareSourceSurfaceColors(input,3,1,false).packed)).toEqual([0xffff0000,0xff7f007f,0xffff0000]);
 });
 it.each([{},null,[],{colors:[]},{colors:[123]},{colors:[null]},{colors:new Array(1)}])('rejects malformed or empty explicit palettes: %j',input=>{
  expect(()=>parseSourceSurfacePalette(input)).toThrow();
 });
 it('bounds color count and aggregate text before color preparation',()=>{
  expect(()=>parseSourceSurfacePalette({colors:new Array(65_537).fill('0')})).toThrow('65536');
  expect(()=>parseSourceSurfacePalette(palette('0'.repeat(524_289),'0'.repeat(524_288)))).toThrow('1 MiB');
  expect(parseSourceSurfacePalette(palette('0'.repeat(1_048_576))).colors[0]).toHaveLength(1_048_576);
 });
 it.each([0,513,1.5,NaN,Infinity])('rejects invalid grid size %s',size=>{
  expect(()=>prepareSourceSurfaceColors(undefined,size,1,false)).toThrow('1 至 512');
  expect(()=>prepareSourceSurfaceColors(undefined,1,size,false)).toThrow('1 至 512');
 });
 it('rejects invalid runtime palette and periodic flags instead of supplying defaults',()=>{
  expect(()=>prepareSourceSurfaceColors(null as unknown as undefined,1,1,false)).toThrow('colors 数组');
  expect(()=>prepareSourceSurfaceColors(undefined,1,1,'false' as unknown as boolean)).toThrow('布尔值');
 });
 it('creates independent results and never mutates an authored palette',()=>{
  const input=palette('#FFFFFF'),a=prepareSourceSurfaceColors(input,1,1,false),b=prepareSourceSurfaceColors(input,1,1,false);
  a.colors.fill(0);a.packed.fill(0);a.diagnostics.push('changed');
  expect(b.packed[0]).toBe(0xffffffff);expect(Array.from(b.colors)).toEqual([1,1,1]);expect(b.diagnostics).toEqual([]);expect(input.colors).toEqual(['#FFFFFF']);
 });
});
