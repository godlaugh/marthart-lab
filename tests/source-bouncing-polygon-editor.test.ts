import {describe,it,expect} from 'vitest';
import {importSourceBouncingDocument} from '../src/engine/sourceBouncingDocument';
import {SOURCE_BOUNCING_DEFAULT_POLYGON} from '../src/engine/sourceBouncingConfig';
import {appendSourcePolygonMidpoint,parseSourcePolygonRows,regularSourcePolygon,sourcePolygonCoordinate,sourcePolygonRows} from '../src/engine/sourceBouncingPolygonEditor';
import guide from './fixtures/source-bouncing-guide-compositions/cases.json';
function config(){const result=importSourceBouncingDocument({settings:{particle_count:64}});if(!result.ok)throw Error('fixture');return result.value.payload.configuration;}
describe('canonical polygon editing boundary',()=>{
 it('recreates the pinned source-derived hexagon recipe, retaining Float32 operation order',()=>{
  expect(regularSourcePolygon(6,.62)).toEqual(guide.cases['guide-hexagon'].polygon.flat());
  const triangle=regularSourcePolygon(3,.6);expect(triangle).toHaveLength(6);expect(triangle[1]).toBe(Math.fround(-.6));
  expect(regularSourcePolygon(3,-1)).toEqual(regularSourcePolygon(3,Math.fround(.001)));
  expect(()=>regularSourcePolygon(6,1e100)).toThrow('有限');
 });
 it('preserves imported coordinates, order, concavity, repeated points and degenerate edges',()=>{
  const raw=[3,0,3,0,1,.1,0,0,-2,-2],c=config();
  expect(parseSourcePolygonRows(c,sourcePolygonRows(raw))).toEqual(raw.map(Math.fround));
  expect(sourcePolygonCoordinate(9)).toBe(2);expect(sourcePolygonCoordinate(-9)).toBe(-2);
  expect(sourcePolygonCoordinate(.1)).toBe(Math.fround(.1));
  expect(c.polygonVertices).toEqual(SOURCE_BOUNCING_DEFAULT_POLYGON);
 });
 it('uses the source closing-edge midpoint and the canonical 3–64 point capacity',()=>{
  const c=config(),points=appendSourcePolygonMidpoint(SOURCE_BOUNCING_DEFAULT_POLYGON);
  expect(points.slice(0,-2)).toEqual(SOURCE_BOUNCING_DEFAULT_POLYGON);
  expect(points.slice(-2)).toEqual([Math.fround(Math.fround(Math.fround(-.82)+Math.fround(-.95))*.5),Math.fround(Math.fround(Math.fround(.58)+Math.fround(-.5))*.5)]);
  for(const count of [3,64])expect(parseSourcePolygonRows(c,sourcePolygonRows(Array(count*2).fill(0)))).toHaveLength(count*2);
  for(const count of [2,65])expect(()=>parseSourcePolygonRows(c,sourcePolygonRows(Array(count*2).fill(0)))).toThrow();
  expect(()=>appendSourcePolygonMidpoint(Array(128).fill(0))).toThrow('64');
  for(const bad of ['', 'NaN','Infinity','bad']){const rows=sourcePolygonRows(c.polygonVertices);rows[0].x=bad;expect(()=>parseSourcePolygonRows(c,rows)).toThrow('有限');}
 });
});
