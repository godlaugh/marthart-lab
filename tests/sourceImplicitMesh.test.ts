import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import fixture from './fixtures/source-implicit-presentation/native.json';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {generateImplicit,transformFor} from '../src/scenes/geometry';
import {prepareImplicitJob} from '../src/engine/implicitSurface';
import {prepareSourceImplicitField} from '../src/engine/sourceImplicitField';
import {generateSourceImplicitMesh,sourceImplicitMeshAllocation} from '../src/engine/sourceImplicitMesh';
import {outputBuffers} from '../src/engine/outputBuffers';
import type {GenerateContext,SceneOutput} from '../src/types';
type Output=Extract<SceneOutput,{type:'geometry'}>;
const context:GenerateContext={time:0,width:500,height:600,quality:'export',sourcePointPixelDensity:2};
const parsed=(i=1)=>parseLegacyScene(JSON.stringify(fixture.cases[i].input)).scene;
const hash=(a:Float32Array)=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
describe('original implicit CPU Marching Cubes production boundary',()=>{
 it.each([0,1])('matches every native position, normal and fill byte, including topology order: %i',i=>{
  const output=generateImplicit(parsed(i),context) as Output,expected=fixture.cases[i].mesh,mesh=output.sourceImplicitMesh!;
  expect(output.positions.length/3).toBe(expected.vertices);expect(output.indices).toBeUndefined();
  expect(hash(output.positions)).toBe(expected.positionsSha256);expect(hash(mesh.normals)).toBe(expected.normalsSha256);
  expect(hash(output.sourceImplicitPresentation!.fillColors)).toBe(expected.fillRgbaSha256);
  expect(mesh.retainedRepeatedVertexTriangles).toBe(expected.repeatedVertexTriangles);
  expect(output.implicit?.rootEvaluations).toBe(0);expect(output.implicit?.refinedEdges).toBe(0);
  expect(outputBuffers(output)).toContain(mesh.normals.buffer);
 });
 it('keeps source scalar parsing separate and nonfinite replacement threshold separate from mesh iso',()=>{
  const input=structuredClone(fixture.cases[1].input);Object.assign(input.settings,{iso_threshold:.2});input.equation.f='1/x';
  const scene=parseLegacyScene(JSON.stringify(input)).scene,job=prepareImplicitJob(scene,context,transformFor(scene.settings)),field=prepareSourceImplicitField(job);
  expect(job.local).toBeUndefined();expect(job.iso).toBe(0);expect(field.isoThreshold).toBe(Math.fround(.2));
  const output=generateSourceImplicitMesh(job,field,context);expect(output.stats.invalid).toBe(11*13);expect(output.positions.length).toBeGreaterThan(0);
  expect(output.warnings?.join('')).toContain('isoThreshold');
  const alternate={...field,isoThreshold:Math.fround(.8)},changed=generateSourceImplicitMesh(job,alternate,context);
  expect(hash(output.positions)).not.toBe(hash(changed.positions));
 });
 it('cancels after sampling starts and rejects buffers before output allocation',()=>{
  const scene=parsed(),job=prepareImplicitJob(scene,context,transformFor(scene.settings)),field=prepareSourceImplicitField(job);let checks=0;
  expect(()=>generateSourceImplicitMesh(job,field,{...context,isCancelled:()=>++checks>40})).toThrow('取消');
  expect(checks).toBe(41);
  expect(()=>sourceImplicitMeshAllocation(1,3,3*Math.ceil(128*1024*1024/120))).toThrow('128 MiB');
  expect(()=>sourceImplicitMeshAllocation(17_000_000,3,0)).toThrow('256 MiB');
  expect(()=>sourceImplicitMeshAllocation(1,3,2)).toThrow('计数');
 });
});
