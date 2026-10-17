import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {bouncingPolygonFacts,prepareBilliard,insideBoundary} from '../src/scenes/bouncing';
import {prepareBouncingGpuBoundary} from '../src/engine/bouncingGpu';
import {readPolygonRows,parsePolygonRows,resetPolygonRows,appendPolygonMidpoint} from '../src/engine/polygonEditor';
import {BouncingPolygonEditor} from '../src/components/BouncingPolygonEditor';
import {I18nProvider} from '../src/i18n';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {generateScene} from '../src/engine/temporal';
describe('polygon editing and shared collision geometry',()=>{
 it('accepts the closing-edge midpoint and feeds the same winding to CPU and GPU',()=>{
  for(const reverse of [false,true]){
   let rows=resetPolygonRows();if(reverse)rows=rows.reverse();rows=appendPolygonMidpoint(rows);
   const facts=parsePolygonRows(rows),boundary={kind:'polygon' as const,vertices:facts.vertices};
   expect(facts.convex).toBe(true);expect(facts.vertices).toHaveLength(7);
   expect(prepareBouncingGpuBoundary(boundary).planeCount).toBe(7);
   const flight=prepareBilliard(boundary,.01).advance([0,0],[.3,.7],3);
   expect(insideBoundary(flight.position,boundary)).toBe(true);expect(Math.hypot(...flight.velocity)).toBeCloseTo(Math.hypot(.3,.7),10);
  }
 });
 it('rejects self contact, collinear overlapping edges and malformed draft values before applying',()=>{
  for(const vertices of [[[0,0],[4,0],[4,4],[1,4],[1,0],[3,0],[3,3],[0,3]],[[0,0],[2,2],[0,2],[2,0]],[[0,0],[2,0],[1,1],[0,0],[0,2]]])expect(()=>bouncingPolygonFacts(vertices)).toThrow();
  for(const bad of ['', 'Infinity','nope']){const rows=resetPolygonRows();rows[2].x=bad;expect(()=>parsePolygonRows(rows)).toThrow('有限数字');}
  expect(()=>readPolygonRows({polygon:'[1,2,3]'})).toThrow();
  const rows=readPolygonRows({sides:64,radius:3});expect(()=>appendPolygonMidpoint(rows)).toThrow('64');
 });
 it('preserves concave legacy data without silently sorting or producing a convex hull',()=>{
  const vertices:[number,number][]=[[-1,-1],[1,-1],[0,0],[1,1],[-1,1]],rows=readPolygonRows({polygon:JSON.stringify(vertices)}),facts=parsePolygonRows(rows);
  expect(facts.vertices).toEqual(vertices);expect(facts.convex).toBe(false);
  expect(prepareBilliard({kind:'polygon',vertices}).boundary).toEqual({kind:'polygon',vertices});
  expect(()=>prepareBouncingGpuBoundary({kind:'polygon',vertices})).toThrow('凸');
 });
 it('retains winding after a large translation and keeps collinear boundary subdivisions',()=>{
  const vertices:[number,number][]=[[0,0],[1,0],[2,0],[2,2],[0,2]];
  expect(bouncingPolygonFacts(vertices.map(([x,y])=>[x+1e8,y-1e8])).orientation).toBe(1);
  expect(bouncingPolygonFacts([...vertices].reverse()).orientation).toBe(-1);
 });
 it('does not merge distinct thin edges through a global geometry tolerance',()=>{
  const rectangle:[number,number][]=[[0,0],[1e11,0],[1e11,.01],[0,.01]];
  for(const vertices of [rectangle,[...rectangle].reverse()]){
   const facts=bouncingPolygonFacts(vertices);expect(facts.vertices).toEqual(vertices);expect(facts.convex).toBe(true);
   expect(prepareBilliard({kind:'polygon',vertices}).boundary).toEqual({kind:'polygon',vertices});
  }
  // A similarly thin, genuinely crossing contour must still be rejected.
  expect(()=>bouncingPolygonFacts([[0,0],[1e11,.01],[0,.01],[1e11,0],[1e11,.02],[0,.02]])).toThrow('自相交');
  // The middle vertex is exactly below AB although binary64 products cancel.
  const near:[number,number][]=[[0,0],[1e11,1e11-1],[(1e11-1)/2,(1e11-2)/2],[0,-10]];
  expect(bouncingPolygonFacts(near).vertices).toEqual(near);
  near[2][1]+=1e-5;expect(()=>bouncingPolygonFacts(near)).toThrow('自相交');
 });
 it('serializes edited vertices and generates the reloaded scene with actual polygon collisions',async()=>{
  const scene=createScene(definition('bouncing'));Object.assign(scene.settings,{boundary:'polygon',polygon:JSON.stringify(parsePolygonRows(appendPolygonMidpoint(resetPolygonRows())).vertices),count:20,initialRadius:.2,bouncingBackend:'cpu'});
  const restored=parseScene(JSON.stringify(persistentScene(scene)));expect(restored.settings.polygon).toBe(scene.settings.polygon);
  const output=await generateScene(restored,{time:2,width:64,height:64,quality:'preview'});
  expect(output.stats.invalid).toBe(0);expect(output.stats.generated).toBeGreaterThan(0);
 });
 it('provides keyboard and numeric access with translated status and preserves invalid source',()=>{
  const render=(settings:Record<string,string|number>)=>renderToStaticMarkup(<I18nProvider language="en"><BouncingPolygonEditor settings={settings} onApply={()=>{}}/></I18nProvider>);
  const html=render({sides:6,radius:3});expect(html).toContain('Polygon editing canvas');expect(html).toContain('Vertex 1 X');expect(html).toContain('Reset six-point outline');expect(html).toContain('tabindex="0"');
  const bad=render({polygon:'broken'});expect(bad).toContain('role="alert"');expect(bad).toContain('disabled=""');
 });
});
