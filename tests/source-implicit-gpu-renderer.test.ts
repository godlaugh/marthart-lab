import {describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import native from './fixtures/source-implicit-presentation/native.json';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {generateImplicit} from '../src/scenes/geometry';
import {prepareSourceCamera} from '../src/engine/sourceCamera';
import {createSourceImplicitMesh} from '../src/engine/sourceImplicitRenderer';
import {SOURCE_IMPLICIT_GPU_PRESENTATION} from '../src/engine/sourceImplicitGpuPresentation';
import {sourceImplicitGpuVertex,sourceImplicitGpuFragment} from '../src/engine/sourceImplicitGpuShader';
import {prepareSourceDrawingPlan,snapshotSourceDrawings,type SourceDrawingResult} from '../src/engine/sourceDrawingSnapshot';
import type {GenerateContext,SceneOutput,Settings} from '../src/types';

type Geometry=Extract<SceneOutput,{type:'geometry'}>;
const context:GenerateContext={time:0,width:500,height:600,quality:'export',sourcePointPixelDensity:2};
const take=<T>(result:SourceDrawingResult<T>):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
const digest=(value:ArrayBufferView)=>createHash('sha256').update(new Uint8Array(value.buffer,value.byteOffset,value.byteLength)).digest('hex');
function fixture(settings:Settings={},palette=['#80112233','#00445566']){
 const input=structuredClone(native.cases[1].input),scene=parseLegacyScene(JSON.stringify({...input,palette,settings:{...input.settings,mesh_mode:'GPU'}})).scene;
 Object.assign(scene.settings,settings);const output=generateImplicit(scene,context) as Geometry;
 const camera=prepareSourceCamera({model:'mathart-1.7.8-v1',configuration:{kind:'absent'}},{logicalWidth:500,logicalHeight:600,referenceLogicalHeight:486,target:'offscreen',projectionPass:'perspective'});
 if(!camera.ok||camera.value.kind!=='known')throw Error('camera fixture');
 return{scene,output,plan:camera.value.plan};
}
function drawing(f:ReturnType<typeof fixture>){
 const rendered=createSourceImplicitMesh(f.output,f.plan,8);
 return{...rendered,dispose(){rendered.fill.geometry.dispose();rendered.fill.material.dispose();rendered.lines?.geometry.dispose();rendered.lines?.material.dispose();}};
}
// Independent original shader goldens from implicit_mesh_{vert,frag}.glsl,
// JAR a6e1da3a…4018. Remove only comments, dialect/precision and whitespace;
// preserve every arithmetic expression, branch and operation ordering.
const body=(source:string)=>source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'').replace(/^\s*#version[^\n]*/gm,'').replace(/precision\s+\w+\s+\w+\s*;/g,'').replace(/\s+/g,'');
describe('source Implicit GPU material and native drawing boundary (CPU only)',()=>{
 it.each([
  [sourceImplicitGpuVertex,'a3f8264579b14c09d41d594c209488bcf805957ba808393577cc836a15f14018'],
  [sourceImplicitGpuFragment,'73ca5302bbc07473d605e12f6de980eb84c89c6f73112f014dc0184788dcf697'],
 ])('retains the original shader arithmetic, including normal and alpha semantics', (source,expected)=>{
  expect(createHash('sha256').update(body(source)).digest('hex')).toBe(expected);
 });
 it('keeps actual CPU computation and the original normals separate from GPU presentation',()=>{
  const f=fixture(),d=drawing(f);try{
   expect(f.output.backend).toBe('cpu');expect(f.output.sourceImplicitPresentation?.model).toBe(SOURCE_IMPLICIT_GPU_PRESENTATION);
   expect(d.fill.geometry.getAttribute('normal').array).toBe(f.output.sourceImplicitMesh!.normals);
   const snapshot=take(snapshotSourceDrawings([d.fill])),command=snapshot.commands[0];
   expect(digest(command.attributes.find(a=>a.name==='normal')!.values)).toBe(native.cases[1].mesh.normalsSha256);
   expect(command.uniforms.find(u=>u.name==='modelview')).toMatchObject({kind:'mat4',values:Float32Array.from(f.plan.modelView.columnMajor)});
   expect(command.uniforms.find(u=>u.name==='transform')).toMatchObject({kind:'mat4',values:Float32Array.from(f.plan.transform.columnMajor)});
   expect(command).toMatchObject({passes:['both'],depthTest:true,depthWrite:true,depthFunction:'less-equal',blend:'source-alpha-over-additive-alpha'});
   expect(()=>createSourceImplicitMesh({...f.output,backend:'webgl2'},f.plan)).toThrow('不匹配');
  }finally{d.dispose();}
 });
 it('binds one opaque RGB palette to both source samplers and resolves native anisotropy on the receiver',()=>{
  const f=fixture({opacity:.5}),d=drawing(f);try{
   const material=d.fill.material,texture=material.uniforms.paletteTex.value as THREE.DataTexture;
   expect(material.uniforms.texMap.value).toBe(texture);expect(texture.anisotropy).toBe(8);
   const snapshot=take(snapshotSourceDrawings([d.fill])),command=snapshot.commands[0];
   expect(snapshot.textures).toHaveLength(1);expect(snapshot.textures[0]).toMatchObject({width:2,height:1,anisotropy:'maximum',pixels:new Uint8Array([17,34,51,255,68,85,102,255])});
   expect(command.uniforms.filter(u=>u.kind==='sampler2d').map(u=>[u.name,u.texture])).toEqual([['paletteTex',0],['texMap',0]]);
   expect(command.uniforms.find(u=>u.name==='meshFillOpacity')).toMatchObject({values:new Float32Array([.5])});
   expect(command.uniforms.find(u=>u.name==='useTexture')).toMatchObject({values:new Int32Array([0])});
   expect(command.uniforms.find(u=>u.name==='meshFillColor')).toMatchObject({values:new Float32Array([1,1,1,1])});
   // The shader golden above fixes alpha=meshFillOpacity. ARGB palette and the
   // retained CPU fillColor alpha must not multiply that opacity again.
   expect(f.output.sourceImplicitPresentation?.fillColors.some((v,i)=>i%4===3&&v<.5)).toBe(true);
  }finally{d.dispose();}
 });
 it('captures independent frame data and disposes the shared texture exactly once',()=>{
  const f=fixture({opacity:1}),d=drawing(f),texture=d.fill.material.uniforms.paletteTex.value as THREE.DataTexture,dispose=vi.spyOn(texture,'dispose');
  const snapshot=take(snapshotSourceDrawings([d.fill])),normal=snapshot.commands[0].attributes.find(a=>a.name==='normal')!.values,original=digest(normal),firstPixel=snapshot.textures[0].pixels[0];
  f.output.sourceImplicitMesh!.normals.fill(0);f.scene.settings.shininess=100;f.scene.implicitSourcePalette!.colors=['#ffffff'];texture.image.data[0]=255;d.fill.material.uniforms.meshFillOpacity.value=.1;
  d.dispose();expect(dispose).toHaveBeenCalledTimes(1);expect(digest(normal)).toBe(original);expect(snapshot.textures[0].pixels[0]).toBe(firstPixel);
  expect(snapshot.commands[0].uniforms.find(u=>u.name==='meshFillOpacity')).toMatchObject({values:new Float32Array([1])});
 });
 it('preserves cold empty GPU paletteSize while the CPU fill and contour colors use source white',()=>{
  const gpu=fixture({opacity:.5},[]),cpu=fixture({opacity:.5,computeBackend:'cpu'},[]),d=drawing(gpu);
  try{
   const facts=gpu.output.sourceImplicitPresentation!;if(facts.model!==SOURCE_IMPLICIT_GPU_PRESENTATION)throw Error('GPU fixture');
   expect(gpu.scene.implicitSourcePalette!.colors).toEqual([]);expect(facts.palette).toEqual(new Uint32Array());
   expect(facts.fillColors).toEqual(cpu.output.sourceImplicitPresentation!.fillColors);
   expect(facts.fillColors.length).toBeGreaterThan(0);
   expect(Array.from(facts.fillColors.subarray(0,4))).toEqual([1,1,1,Math.fround(127/255)]);
   expect(facts.wire!.colors.length).toBeGreaterThan(0);expect(facts.wire!.colors.every(v=>v===1)).toBe(true);expect(facts.wire!.alphas.every(v=>v===1)).toBe(true);
   const snapshot=take(snapshotSourceDrawings([d.fill]));
   expect(snapshot.textures).toHaveLength(1);expect(snapshot.textures[0]).toMatchObject({width:1,height:1,pixels:new Uint8Array([255,255,255,255]),anisotropy:'maximum'});
   expect(snapshot.commands[0].uniforms.find(u=>u.name==='paletteSize')).toMatchObject({kind:'int',values:new Int32Array([0])});
  }finally{d.dispose();}
 });
 it('keeps signed source bounds and uses the same slice-line owner for transparent and wire-only GPU meshes',()=>{
  const f=fixture({scaleX:-2,opacity:.5}),d=drawing(f);try{
   const facts=f.output.sourceImplicitPresentation!;if(facts.model!==SOURCE_IMPLICIT_GPU_PRESENTATION)throw Error('GPU fixture');
   expect(facts.boundsMin[0]).toBeGreaterThan(facts.boundsMax[0]);expect(d.lines).toBeDefined();
   const cpu=fixture({scaleX:-2,opacity:.5,computeBackend:'cpu'}),cpuDraw=drawing(cpu);try{
    expect(d.lines!.geometry.getAttribute('colorA').array).toEqual(cpuDraw.lines!.geometry.getAttribute('colorA').array);
    expect(d.lines!.material.uniforms).toEqual(cpuDraw.lines!.material.uniforms);
   }finally{cpuDraw.dispose();}
  }finally{d.dispose();}
  const opaque=drawing(fixture({opacity:1}));expect(opaque.lines).toBeUndefined();opaque.dispose();
  const wire=drawing(fixture({opacity:1,meshFill:false}));try{
   expect(wire.fill.visible).toBe(false);expect(wire.lines).toBeDefined();const snapshot=take(snapshotSourceDrawings([wire.fill,wire.lines!]));
   expect(snapshot.commands).toHaveLength(1);expect(snapshot.textures).toHaveLength(0);
  }finally{wire.dispose();}
 });
 it('rejects whole-drawing capacity before delivery while preserving the owned mesh for cleanup',()=>{
  const f=fixture(),d=drawing(f);try{
   expect(snapshotSourceDrawings([d.fill],{maxBytes:1})).toMatchObject({ok:false,error:{kind:'capacity'}});
   expect(prepareSourceDrawingPlan([d.fill],{additionalBytes:256*1024*1024})).toMatchObject({ok:false,error:{kind:'capacity'}});
   expect(snapshotSourceDrawings([d.fill],{isCancelled:()=>true})).toMatchObject({ok:false,error:{kind:'cancelled'}});
   expect(take(snapshotSourceDrawings([d.fill])).commands).toHaveLength(1);
   const mesh=f.output.sourceImplicitMesh!,invalid={...f.output,sourceImplicitMesh:{...mesh,normals:mesh.normals.subarray(3)}};
   expect(()=>createSourceImplicitMesh(invalid,f.plan)).toThrow('法线');
  }finally{d.dispose();}
 });
});
