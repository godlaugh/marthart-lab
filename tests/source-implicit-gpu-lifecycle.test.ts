import {describe,expect,it} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {generateScene,TemporalGenerationSession} from '../src/engine/temporal';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {sourceLivePreviewKind} from '../src/engine/sourceLivePreview';
import {validSourceImplicitOutput,validSourceImplicitGenerationOutput} from '../src/engine/sourceImplicitResponse';
import {outputBuffers,outputTransferState} from '../src/engine/outputBuffers';
import {isMeshMaterialControlVisible} from '../src/engine/meshAppearance';
import {usesSourceGeometryImage} from '../src/engine/sourceGeometryImage';
import type {GenerationInput,SceneOutput} from '../src/types';
import native from './fixtures/source-implicit-presentation/recording-clock.json';

function setup(mode:'CPU'|'GPU'|'AUTO'='GPU'){
 const raw=structuredClone(native.cases[0].input.project);
 Object.assign(raw.settings,{mesh_mode:mode,x_segments:4,y_segments:4,z_segments:4});
 const scene=parseProjectFile(JSON.stringify(raw)).scene;
 scene.implicitSourcePalette={colors:['#80112233','#40abcdef']};
 const input:GenerationInput={time:0,width:64,height:48,quality:'preview',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,64,48,'primary',48)};
 return{scene,input};
}
function geometry(output:SceneOutput){if(output.type!=='geometry')throw Error('geometry');return output;}
function gpu(output:SceneOutput){const value=geometry(output).sourceImplicitPresentation;if(value?.model!=='mathart-1.7.8-gpu-material-v1')throw Error('GPU material');return value;}

describe('source implicit GPU material common lifecycle (CPU execution)',()=>{
 it('uses the shared parameter/camera replay and captured formulas without turning initial fixed preview into live',()=>{
  const a=setup('CPU'),b=setup('GPU');
  expect(sourceLivePreviewKind(b.scene)).toBeUndefined();expect(usesSourceGeometryImage(b.scene)).toBe(true);
  for(const time of [0,.25,.5,1]){
   const cpu=geometry(generateScene(a.scene,{...a.input,time})),out=geometry(generateScene(b.scene,{...b.input,time}));
   expect(out.positions).toEqual(cpu.positions);expect(out.sourceCameraFrame).toEqual(cpu.sourceCameraFrame);
   expect(out.sourceImplicitParameters).toEqual(cpu.sourceImplicitParameters);expect(out.formulaPresentation).toEqual(cpu.formulaPresentation);
   expect(out).not.toHaveProperty('implicitLive');expect(validSourceImplicitGenerationOutput(out,{...b.input,time},b.scene)).toBe(true);
   expect(validSourceImplicitGenerationOutput(out,{...b.input,time},a.scene)).toBe(false);
  }
 });
 it('keeps staged material and equation edits outside hot palette, then changes route only through explicit Apply',()=>{
  const f=setup(),owner=new TemporalGenerationSession();
  const initial:GenerationInput={...f.input,implicitControls:{sessionId:'gpu-controls',acknowledgedRevision:0,commands:[{kind:'apply',revision:1,scene:f.scene}]}};
  try{
   const cold=generateScene(f.scene,initial,owner),staged=structuredClone(f.scene);
   staged.settings.computeBackend='cpu';staged.settings.shininess=99;staged.equations.f='unapplied()';
   const hot:GenerationInput={...f.input,implicitControls:{sessionId:'gpu-controls',acknowledgedRevision:1,commands:[{kind:'palette',revision:2,colors:['#8000ff00']}]}};
   const updated=generateScene(staged,hot,owner);
   expect(gpu(updated).material).toEqual(gpu(cold).material);expect(gpu(updated).palette).toEqual(new Uint32Array([0xff00ff00]));
   expect(updated.sourceCameraFrame).toEqual(cold.sourceCameraFrame);expect(updated.formulaPresentation).toEqual(cold.formulaPresentation);
   expect(validSourceImplicitGenerationOutput(updated,hot,staged,cold)).toBe(true);
   staged.equations=f.scene.equations;
   const applied=generateScene(staged,{...f.input,implicitControls:{sessionId:'gpu-controls',acknowledgedRevision:2,commands:[{kind:'apply',revision:3,scene:staged}]}},owner);
   expect(geometry(applied).sourceImplicitPresentation?.model).toBe('mathart-1.7.8-cpu-slices-v1');
   expect(applied.implicitControls).toMatchObject({revision:3,applyRevision:3,resetRevision:2});
  }finally{owner.reset();}
 });
 it('inventories the actual palette/fill storage once and observes palette-only transfer detachment',()=>{
  const f=setup(),out=geometry(generateScene(f.scene,f.input)),facts=gpu(out),buffers=outputBuffers(out),state=outputTransferState(out);
  expect(buffers.filter(b=>b===facts.palette.buffer)).toHaveLength(1);expect(buffers).toContain(facts.fillColors.buffer);
  const received=structuredClone(facts.palette,{transfer:[facts.palette.buffer]});expect(received).toEqual(new Uint32Array([0x80112233,0x40abcdef]));
  expect(state.intact()).toBe(false);expect(validSourceImplicitOutput(out,f.input)).toBe(false);
 });
 it('accepts an explicitly empty GPU palette while retaining the delivered size-zero identity',()=>{
  const f=setup(),out=geometry(generateScene(f.scene,f.input));Object.assign(gpu(out),{palette:new Uint32Array()});expect(validSourceImplicitOutput(out,f.input)).toBe(true);
 });
 it.each(['model','palette-type','bounds','opacity','material','texture','mesh-mode','computation','fill-length','wire'] as const)('rejects malformed delivered %s without consulting author settings',mutation=>{
  const f=setup(),out=geometry(generateScene(f.scene,f.input)),facts=gpu(out);
  switch(mutation){
   case'model':Object.assign(facts,{model:'future-model'});break;
   case'palette-type':Object.assign(facts,{palette:[0xffffffff]});break;
   case'bounds':Object.assign(facts,{boundsMin:[0,0,NaN]});break;
   case'opacity':Object.assign(facts,{fillOpacity:2});break;
   case'material':Object.assign(facts,{material:{...facts.material,ambient:-1}});break;
   case'texture':Object.assign(facts,{material:{...facts.material,proceduralTextureType:5}});break;
   case'mesh-mode':Object.assign(facts,{meshMode:'CPU'});break;
   case'computation':Object.assign(facts,{meshComputation:'gpu-compute'});break;
   case'fill-length':Object.assign(facts,{fillColors:new Float32Array(1)});break;
   case'wire':Object.assign(facts,{wire:{positions:new Float32Array(3),colors:new Float32Array(3),alphas:new Float32Array(1),axes:[0,1],samples:1}});break;
  }
  expect(validSourceImplicitOutput(out,f.input)).toBe(false);
 });
 it('only exposes source-backed GPU material controls while sharing fill and retained slice controls',()=>{
  const f=setup();f.scene.settings.meshWireframe=true;
  for(const key of ['meshFill','meshWireframe','meshWireframeWidth','shininess','ambient','specular','proceduralTexture'])expect(isMeshMaterialControlVisible(f.scene,key),key).toBe(true);
  for(const key of ['textureScale','meshWireframeColor','meshWireframeDecoupled','meshWireframeULines','meshWireframeVLines','meshWireframeCurveSamples'])expect(isMeshMaterialControlVisible(f.scene,key),key).toBe(false);
  f.scene.settings.computeBackend='cpu';expect(isMeshMaterialControlVisible(f.scene,'shininess')).toBe(false);expect(isMeshMaterialControlVisible(f.scene,'meshWireframeWidth')).toBe(true);
 });
});
