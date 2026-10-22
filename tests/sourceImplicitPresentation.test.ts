import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import fixture from './fixtures/source-implicit-presentation/native.json';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {prepareImplicitJob} from '../src/engine/implicitSurface';
import {generateImplicit,transformFor} from '../src/scenes/geometry';
import {sourceImplicitSliceLines,usesSourceImplicitCpuMesh,sourceImplicitHeightColor} from '../src/engine/sourceImplicitPresentation';
import {outputBuffers,outputTransferState} from '../src/engine/outputBuffers';
import {createSourceImplicitMesh} from '../src/engine/sourceImplicitRenderer';
import {prepareSourceCamera} from '../src/engine/sourceCamera';
import {isMeshMaterialControlVisible} from '../src/engine/meshAppearance';
import {IMPLICIT_WORK_BYTES} from '../src/engine/meshEdges';
import type {GenerateContext,SceneOutput} from '../src/types';
type GeometryOutput=Extract<SceneOutput,{type:'geometry'}>;
const context:GenerateContext={time:0,width:500,height:600,quality:'export',sourcePointPixelDensity:2};
const parsed=(i=0)=>parseLegacyScene(JSON.stringify(fixture.cases[i].input)).scene;
const job=(i=0)=>{const scene=parsed(i);return prepareImplicitJob(scene,context,transformFor(scene.settings));};
const hash=(array:Float32Array)=>createHash('sha256').update(new Uint8Array(array.buffer,array.byteOffset,array.byteLength)).digest('hex');

describe('native implicit CPU display producer',()=>{
 it.each([0,1])('reproduces complete original two-axis contour stream %i',i=>{
  const source=fixture.cases[i],j=job(i),wire=sourceImplicitSliceLines(j,context);
  expect(j.iso).toBe(0);expect(j.overlay).toBe(false);expect(wire.axes).toEqual(source.axes);
  expect(wire.positions.length).toBe(source.wireFloatCount);expect(hash(wire.positions)).toBe(source.wireFloat32LittleEndianSha256);
 });
 it('cancels before sampling and admits retained memory before allocation',()=>{
  expect(()=>sourceImplicitSliceLines(job(1),{...context,isCancelled:()=>true})).toThrow('取消');
  expect(()=>sourceImplicitSliceLines(job(1),context,IMPLICIT_WORK_BYTES)).toThrow('预算');
 });
 it('uses z,min,span and native quantized RGB',()=>{
  expect(sourceImplicitHeightColor([0xff000000,0xffffffff],0,-1,2)).toBe(0xff7f7f7f);
  expect(sourceImplicitHeightColor([0xff000000,0xffffffff],1,-1,2)).toBe(0xffffffff);
 });
 it('owns fill and slice colors in worker transfer, without triangle edge overlays',()=>{
  const scene=parsed(1),output=generateImplicit(scene,context) as GeometryOutput;
  expect(output.sourceImplicitPresentation?.wire?.positions.length).toBe(fixture.cases[1].wireFloatCount);
  expect(output.sourceImplicitPresentation?.lineWeight).toBe(Math.fround(.68));expect(output.meshEdges).toBeUndefined();
  const transfer=outputBuffers(output),facts=output.sourceImplicitPresentation!;
  expect(transfer).toContain(facts.fillColors.buffer);expect(transfer).toContain(facts.wire!.positions.buffer);expect(transfer).toContain(facts.wire!.alphas.buffer);
  const ownership=outputTransferState(output);structuredClone(output,{transfer});expect(ownership.intact()).toBe(false);
 });
 it('suppresses source slice overlay at opaque fill, preserves wire-only display',()=>{
  const scene=parsed(1);scene.settings.opacity=1;let output=generateImplicit(scene,context) as GeometryOutput;expect(output.sourceImplicitPresentation?.wire).toBeUndefined();
  scene.settings.meshFill=false;output=generateImplicit(scene,context) as GeometryOutput;expect(output.sourceImplicitPresentation?.fill).toBe(false);expect(output.sourceImplicitPresentation?.wire?.positions.length).toBe(fixture.cases[1].wireFloatCount);
 });
 it('hands the renderer unlit source RGBA and owned slice segments, with meaningful controls only',()=>{
  const scene=parsed(1),output=generateImplicit(scene,context) as GeometryOutput;
  const camera=prepareSourceCamera({model:'mathart-1.7.8-v1',configuration:{kind:'absent'}},{logicalWidth:500,logicalHeight:600,referenceLogicalHeight:486,target:'offscreen',projectionPass:'perspective'});
  if(!camera.ok||camera.value.kind!=='known')throw Error('camera fixture');
  const plan=camera.value.plan,rendered=createSourceImplicitMesh(output,plan);
  expect(output.colors).toBeUndefined();expect(rendered.fill.geometry.getAttribute('color').array).toBe(output.sourceImplicitPresentation!.fillColors);
  expect(rendered.fill.material.toneMapped).toBe(false);
  expect(rendered.lines?.geometry.getAttribute('colorA')).toBeDefined();
  expect(isMeshMaterialControlVisible(scene,'meshWireframeWidth')).toBe(true);expect(isMeshMaterialControlVisible(scene,'meshWireframeColor')).toBe(false);expect(isMeshMaterialControlVisible(scene,'shininess')).toBe(false);
  rendered.fill.geometry.dispose();rendered.fill.material.dispose();rendered.lines?.geometry.dispose();rendered.lines?.material.dispose();
  expect(()=>createSourceImplicitMesh({...output,indices:new Uint32Array([0,1,output.positions.length/3])},plan)).toThrow('索引');
 });
 it('leaves ordinary, points and selected GPU routing outside the source CPU path',()=>{
  const scene=parsed(1);scene.settings.renderMode='points';expect(usesSourceImplicitCpuMesh(scene)).toBe(false);expect((generateImplicit(scene,context) as GeometryOutput).sourceImplicitPresentation).toBeUndefined();
  scene.settings.renderMode='mesh';scene.settings.computeBackend='webgl2';expect(usesSourceImplicitCpuMesh(scene)).toBe(false);expect(prepareImplicitJob(scene,context,transformFor(scene.settings)).overlay).toBe(true);
  scene.settings.computeBackend='cpu';delete scene.settings.implicitPresentationVersion;expect(usesSourceImplicitCpuMesh(scene)).toBe(false);expect((generateImplicit(scene,context) as GeometryOutput).meshEdges?.length).toBeGreaterThan(0);
 });
});
