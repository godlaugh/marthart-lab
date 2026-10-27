import {describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import native from './fixtures/source-implicit-presentation/native.json';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {generateImplicit,transformFor} from '../src/scenes/geometry';
import {prepareImplicitJob} from '../src/engine/implicitSurface';
import {gpuFormulaSampler} from '../src/engine/gpuSampler';
import {SOURCE_IMPLICIT_CONFIG,sourceImplicitMeshRoute,usesSourceImplicitConfiguration} from '../src/engine/sourceImplicitIdentity';
import {SOURCE_IMPLICIT_DEFAULT_COLORS} from '../src/engine/implicitPaletteEditing';
import type {GenerateContext,SceneOutput} from '../src/types';

type GeometryOutput=Extract<SceneOutput,{type:'geometry'}>;
const context:GenerateContext={time:0,width:500,height:600,quality:'export',sourcePointPixelDensity:2};
const input=(settings:Record<string,unknown>={},extra:Record<string,unknown>={})=>({config_version:'1.0.0',type:'IMPLICIT',name:'source material',parameters:{},equation:{f:'x^2+y^2+z^2-1'},settings:{render_mode:'WIREFRAME',...settings},timeline:[],...extra});
const read=(settings:Record<string,unknown>={},extra:Record<string,unknown>={})=>parseLegacyScene(JSON.stringify(input(settings,extra)));
const hash=(values:Float32Array)=>createHash('sha256').update(new Uint8Array(values.buffer,values.byteOffset,values.byteLength)).digest('hex');
describe('source Implicit mesh import and common numerical producer',()=>{
 it('uses source mesh defaults instead of local MT defaults',()=>{
  const result=read(),s=result.scene.settings;
  expect(s).toMatchObject({implicitSourceVersion:SOURCE_IMPLICIT_CONFIG,computeBackend:'webgl2',renderMode:'mesh',meshFill:true,meshWireframe:true,opacity:Math.fround(.85),isoLevel:0,sourceImplicitIsoThreshold:Math.fround(.06),resolutionX:60,resolutionY:60,resolutionZ:60,minX:Math.fround(-Math.PI),maxZ:Math.fround(Math.PI),scaleX:50,scaleY:50,scaleZ:50});
  expect(s.implicitPresentationVersion).toBeUndefined();expect(result.scene.implicitSourcePalette?.colors).toEqual(SOURCE_IMPLICIT_DEFAULT_COLORS);
  expect(result.warnings.join('')).not.toContain('Marching Tetrahedra');
 });
 it.each([['CPU','CPU'],[' gpu ','GPU'],['aUtO','AUTO'],['unknown','AUTO']])('normalizes source mesh mode %s once and persists its effective request', (raw,expected)=>{
  const scene=read({mesh_mode:raw}).scene;expect(sourceImplicitMeshRoute(scene)?.requestedMeshMode).toBe(expected);
  expect(sourceImplicitMeshRoute(parseScene(serializeScene(scene)))).toEqual(sourceImplicitMeshRoute(scene));
 });
 it.each(['SOLID','WIREFRAME_FILL','WIREFRAME+FILL'])('preserves the original %s fill alias and separate opacity gate',render_mode=>{
  expect(read({render_mode,mesh_fill:false}).scene.settings).toMatchObject({meshFill:true,meshWireframe:true});
  expect(read({render_mode:` ${render_mode} `,mesh_fill:false}).scene.settings).toMatchObject({renderMode:'mesh',meshFill:false});
 });
 it('retains ignored cold material fields without interpreting malformed inactive values',()=>{
  const unused={shininess:{ignored:true},ambient:3,specular:'invalid',procedural_texture:['unused'],mesh_wireframe_color:1,mesh_wireframe:false,material:false};
  const source=input(unused,{material:{shininess:100,ambient:'#000000',proceduralTextureType:4}}),result=parseProjectFile(JSON.stringify(source));
  expect(result.scene.settings).toMatchObject({shininess:32,ambient:'#4d4d4d',specular:'#ffffff',proceduralTexture:'none',meshWireframe:true});
  expect(result.scene.provenance?.original).toEqual(source);
  result.scene.settings.shininess=80;result.scene.settings.proceduralTexture='carbon';
  const restored=parseScene(serializeScene(result.scene));expect(restored.settings).toMatchObject({shininess:80,proceduralTexture:'carbon'});
  expect(()=>read({}, {material:4})).toThrow('material');
 });
 it('preserves packed palette text including cold invalid/empty cases for its existing owner',()=>{
  for(const palette of [[],['#80112233'],['invalid','#ffffff']]){
   const scene=read({}, {palette}).scene;expect(scene.implicitSourcePalette?.colors).toEqual(palette);expect(parseScene(serializeScene(scene)).implicitSourcePalette).toEqual(scene.implicitSourcePalette);
  }
 });
 it('keeps omitted/unknown PREVIEW on the existing sampler without asserting source mesh parity',()=>{
  for(const settings of [{render_mode:undefined},{render_mode:'unknown'},{render_mode:'POINTS'}]){
   const result=read(settings);expect(result.scene.settings.renderMode).toBe('points');expect(usesSourceImplicitConfiguration(result.scene)).toBe(false);
   const job=prepareImplicitJob(result.scene,context,transformFor(result.scene.settings));expect(job.local).toBeDefined();expect(result.warnings.join('')).toContain('未声明');
  }
 });
 it('uses exact source MC positions/normals for GPU and AUTO requests, without WebGL scalar sampling',()=>{
  const source=structuredClone(native.cases[1].input),sample=vi.spyOn(gpuFormulaSampler,'sample').mockImplementation(()=>{throw Error('local sampler must not run');});
  try{
   for(const mesh_mode of ['GPU','AUTO']){
    const scene=parseLegacyScene(JSON.stringify({...source,settings:{...source.settings,mesh_mode}})).scene,job=prepareImplicitJob(scene,context,transformFor(scene.settings));
    expect(job.local).toBeUndefined();expect(job.overlay).toBe(false);expect(job.domainColors).toBe(false);
    const output=generateImplicit(scene,context) as GeometryOutput;
    expect(output.backend).toBe('cpu');expect(output.sourceImplicitMesh?.model).toBe('mathart-1.7.8-cpu-marching-cubes-v1');
    expect(hash(output.positions)).toBe(native.cases[1].mesh.positionsSha256);expect(hash(output.sourceImplicitMesh!.normals)).toBe(native.cases[1].mesh.normalsSha256);
    expect(output.implicit?.latticeValidationSamples).toBe(0);expect(output.meshEdges).toBeUndefined();
    expect(output.sourceImplicitPresentation?.model).toBe('mathart-1.7.8-gpu-material-v1');
   }
   expect(sample).not.toHaveBeenCalled();
  }finally{sample.mockRestore();}
 });
 it('admits the original one-cell minimum and preserves the local resource cap',()=>{
  const scene=read({mesh_mode:'CPU',x_segments:0,y_segments:1,z_segments:2,mesh_fill_opacity:1}).scene;
  expect(prepareImplicitJob(scene,context,transformFor(scene.settings)).dimensions).toEqual([1,1,2]);
  expect((generateImplicit(scene,context) as GeometryOutput).implicit?.requestedCells).toBe(2);
  expect(()=>read({x_segments:201})).toThrow('200');
 });
});
