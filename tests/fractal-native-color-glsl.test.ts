import {describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {FRACTAL_NATIVE_COLOR_PARTS,FRACTAL_NATIVE_COLOR_TAIL} from '../src/engine/fractalNativeColorGlsl';
import {FRACTAL_SOURCE_RASTER_FRAGMENT,FRACTAL_SOURCE_COLOR_RASTER_FRAGMENT} from '../src/engine/fractalNativeNewtonRaster';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
// Digests are pinned to the retained MathArt.app shader resources, not outputs
// of the production color implementation. These prove static provenance only.
const retained={
  "palette": "140b2bf318499c23f278ec5e13b0ecc428c321c0acb4e24b0944b796997aaa5b",
  "orbit": "179c8399f23b3fe62bca21f1b49d3e9a2af62e61506ac69c874d1c8695265419",
  "header": "71838c89610fe4d20c137e2326b455df7af5648de83aeba202508e7443865277",
  "algorithms": "1840061f303e13462622b5fa20b583349cd2eeb66fa435b2feaf5e1e834ac2b4",
  "router": "08b708a89d9a2c69f67fe9d6a13ef535a6a264058badd88667c57adcefdb03ef",
  "mapping": "eea0565113bb0b5e44179215ffbc7fa4219d52a1d709c59c97a68f4c33d64bcd"
} as const;
describe('literal source color provenance and old-profile compatibility',()=>{
 it.each(Object.entries(retained))('keeps the entire retained %s body', (name,digest)=>{
  const text=FRACTAL_NATIVE_COLOR_PARTS[name as keyof typeof FRACTAL_NATIVE_COLOR_PARTS];expect(hash(text)).toBe(digest);expect(FRACTAL_SOURCE_COLOR_RASTER_FRAGMENT).toContain(text);
 });
 it('preserves the complete final-color body, including high-word current z and same-DE-params fallback',()=>{
  expect(hash(FRACTAL_NATIVE_COLOR_TAIL)).toBe('be34f0a23c1345891a3e0f56f9126c1131b15eba681973c9c3cf80b571286635');expect(FRACTAL_SOURCE_COLOR_RASTER_FRAGMENT).toContain(FRACTAL_NATIVE_COLOR_TAIL);
 });
 it('leaves the accepted 3549 omitted-color shader byte identical',()=>expect(hash(FRACTAL_SOURCE_RASTER_FRAGMENT)).toBe('0debb41d7cdcd83489f3fe72a5c63881132d17d7b2c8c7609bb3ad8a551fcbf9'));
 it('uses the source trace in the same raster invocation and keeps exactly four MRT outputs',()=>{
  expect(FRACTAL_SOURCE_COLOR_RASTER_FRAGMENT).not.toContain('void traceStep');expect(FRACTAL_SOURCE_COLOR_RASTER_FRAGMENT).not.toContain('traceStep(trapPoint)');
  expect(FRACTAL_SOURCE_COLOR_RASTER_FRAGMENT.match(/layout\(location=/g)).toHaveLength(4);expect(FRACTAL_SOURCE_COLOR_RASTER_FRAGMENT).toContain('sourceInside=fragColor;');
 });
});
