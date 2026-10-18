import {describe,it,expect} from 'vitest';
import {createSourceSurfaceMeshWireframe,type SourceSurfaceMeshWireframeConfiguration} from '../src/engine/sourceSurfaceMeshWireframe';
import {createSourceSurfaceMeshGeometry,type SourceSurfaceMeshGeometryFrame} from '../src/engine/sourceSurfaceMeshGeometry';
import {prepareSourceSurfaceFunction} from '../src/engine/sourceSurfaceFunction';
import golden from './fixtures/source-surface-mesh/wireframe.json';
const config=(extra:Partial<SourceSurfaceMeshWireframeConfiguration>={}):SourceSurfaceMeshWireframeConfiguration=>({numU:2,numV:2,uMin:0,uMax:1,vMin:0,vMax:1,sample:(u,v)=>[u,v,Math.fround(u*v)],reserve:()=>{},parameterNormal:()=>[1,0,0],scaleX:1,scaleY:1,scaleZ:1,wireframeUSegments:-1,wireframeVSegments:-1,curveSamples:16,fillEnabled:false,lineWeight:2,packedColor:0x80ff8000,...extra});
const frame=(triangles:readonly number[],numU=2,numV=2):SourceSurfaceMeshGeometryFrame=>({positions:new Float32Array(Array.from({length:numU*numV},(_,i)=>[i%numU,Math.floor(i/numU),0]).flat()),normals:new Float32Array(),triangles:new Uint32Array(triangles),sourceColorIndices:new Uint32Array(),seams:{wrapU:false,wrapV:false,twistedU:false,twistedV:false,shiftU:0},wireframeIndexedTriangles:new Uint32Array(triangles),wireframeUSeamQuads:new Float32Array()});
describe('retained CPU MeshSurface wireframe',()=>{
 it.each(golden.hashEdges)('retains native long hash slot emission order for $numU × $numV',row=>{
  const source=frame(row.triangles,row.numU,row.numV),out=createSourceSurfaceMeshWireframe(config({numU:row.numU,numV:row.numV})).render(source);
  const expected=row.expected.flatMap(pair=>pair.flatMap(i=>[i%row.numU,Math.floor(i/row.numU),0]));
  expect([...out.positions]).toEqual(expected);expect(out.packedColor).toBe(0x80ff8000);expect(out.lineWidth).toBe(Math.fround(2*Math.fround(.95)));expect(out.mode).toBe('coupled');
 });
 it('appends U seam perimeter and short diagonal after hash edges without dedup or corner edges',()=>{
  const source=frame([]);source.wireframeUSeamQuads=new Float32Array([0,0,0,2,0,0,1,1,0,0,1,0]);
  source.triangles=new Uint32Array([0,1,2]); // Combined fill triangles are deliberately ignored.
  const out=createSourceSurfaceMeshWireframe(config()).render(source);
  expect([...out.positions]).toEqual([0,0,0,2,0,0,2,0,0,1,1,0,1,1,0,0,1,0,0,1,0,0,0,0,0,0,0,1,1,0]);
  source.wireframeUSeamQuads[8]=NaN;expect(createSourceSurfaceMeshWireframe(config()).render(source).positions).toHaveLength(0);
 });
 it('consumes actual shared function and geometry facts, including its chosen diagonal',()=>{
  const fn=prepareSourceSurfaceFunction({equations:{x:'u',y:'v',z:'0'},parameters:{},scales:[1,1,1],offsets:[0,0,0]}).create(),scratch=new Float32Array(3);
  const sample=(u:number,v:number)=>{fn.position(u,v,scratch);return [scratch[0],scratch[1],scratch[2]] as const;};
  const geometry=createSourceSurfaceMeshGeometry({...config(),sample,meshWrapU:false,meshWrapV:false,meshWrapThreshold:0});
  const out=createSourceSurfaceMeshWireframe(config({sample,parameterNormal:geometry.sampleParameterNormal})).render(geometry.render());
  expect([...out.positions]).toEqual(golden.hashEdges[0].expected.flatMap(pair=>pair.flatMap(i=>[i%2,Math.floor(i/2),0])));
 });
 it('samples inclusive U curves then V curves; zero axis count does not add a curve',()=>{
  const u=createSourceSurfaceMeshWireframe(config({wireframeUSegments:1,wireframeVSegments:0})).render(undefined);
  expect([...u.positions]).toEqual(golden.decoupled.uOnly);expect(u.mode).toBe('decoupled');
  expect([...createSourceSurfaceMeshWireframe(config({wireframeUSegments:1,wireframeVSegments:1})).render(undefined).positions]).toEqual(golden.decoupled.bothAxes);
 });
 it('breaks a curve at invalid source positions instead of joining across the hole',()=>{
  const out=createSourceSurfaceMeshWireframe(config({wireframeUSegments:1,sample:(u,v)=>[u,v,v===.5?NaN:Math.fround(u*v)]})).render(undefined);
  expect([...out.positions]).toEqual(golden.decoupled.invalidMidpoint);
 });
 it('uses native minimum normal displacement only when fill and positive depth bias are enabled',()=>{
  const out=createSourceSurfaceMeshWireframe(config({wireframeUSegments:1,fillEnabled:true})).render(undefined);
  expect([...out.positions]).toEqual(golden.decoupled.offset);
  const disabled=createSourceSurfaceMeshWireframe(config({wireframeUSegments:1,fillEnabled:true,depthBias:0,parameterNormal:()=>{throw Error('must not sample');}})).render(undefined);
  expect([...disabled.positions]).toEqual(golden.decoupled.uOnly);
 });
 it('preserves native nonfinite normal-displacement evidence without bridging its next edge',()=>{
  const out=createSourceSurfaceMeshWireframe(config({wireframeUSegments:1,fillEnabled:true,parameterNormal:(_u,v)=>[v===.5?NaN:1,0,0]})).render(undefined);
  // The incoming edge is emitted before previous.x becomes NaN. The outgoing
  // edge is skipped; the owner must not silently repair this source evidence.
  expect(out.positions.length).toBe(15*2*6);
  expect([...out.positions].filter(Number.isNaN)).toHaveLength(2);
 });
 it('keeps positive lineScale independent of viewport magnitude and preserves raw alpha',()=>{
  const owner=createSourceSurfaceMeshWireframe(config({lineWeight:-2})),source=frame([]);
  for(const scale of [1,2,100,0,-1,NaN,Infinity])expect(owner.render(source,scale).lineWidth).toBe(Math.fround(.1));
  const larger=createSourceSurfaceMeshWireframe(config());
  expect(larger.render(source,100).lineWidth).toBe(larger.render(source,1).lineWidth);
  expect(larger.render(source,0).lineWidth).toBe(2);expect(larger.render(source,NaN).lineWidth).toBe(2);
 });
 it('clamps curveSamples to16, defaults128, and does not need fill geometry for decoupled',()=>{
  expect(createSourceSurfaceMeshWireframe(config({numU:1,numV:1,wireframeUSegments:1,curveSamples:-2})).render(undefined).positions.length).toBe(16*2*6);
  expect(createSourceSurfaceMeshWireframe(config({wireframeUSegments:1,curveSamples:undefined})).render(undefined).positions.length).toBe(128*2*6);
  expect(createSourceSurfaceMeshWireframe(config({numU:1})).render(frame([])).positions.length).toBe(0);
 });
 it('admits bounded work before sampling and returns independently owned frames',()=>{
  let sampled=0;const guarded=createSourceSurfaceMeshWireframe(config({wireframeUSegments:1,reserve:()=>{throw Error('budget');},sample:()=>{sampled++;return[0,0,0];}}));
  expect(()=>guarded.render(undefined)).toThrow('budget');expect(sampled).toBe(0);
  expect(()=>createSourceSurfaceMeshWireframe(config({wireframeUSegments:2147483647})).render(undefined)).toThrow('64 MiB');
  const owner=createSourceSurfaceMeshWireframe(config({wireframeUSegments:1})),first=owner.render(undefined);first.positions.fill(99);
  expect([...owner.render(undefined).positions]).toEqual(golden.decoupled.uOnly);
 });
});
