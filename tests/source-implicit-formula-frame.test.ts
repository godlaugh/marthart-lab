import {afterEach,describe,it,expect,vi} from 'vitest';
import fixture from './fixtures/source-implicit-presentation/native.json';
import nativeFormula from './fixtures/source-implicit-presentation/formula-frame.json';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,createScene} from '../src/engine/document';
import {defaultFormulas,formulaPlacement,formulaPresentation} from '../src/engine/formulas';
import {generateScene} from '../src/engine/temporal';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {Generator} from '../src/engine/client';
import {definition} from '../src/scenes';
import type {GenerationInput} from '../src/types';
import type {GenerationRequest,GenerationResponse} from '../src/engine/generationProtocol';
function imported(){const raw=structuredClone(fixture.cases[0].input);raw.settings.x_segments=raw.settings.y_segments=raw.settings.z_segments=4;return parseProjectFile(JSON.stringify(raw)).scene;}
function context(scene:ReturnType<typeof imported>,target:'primary'|'offscreen'='offscreen'):GenerationInput{return{time:0,width:500,height:600,quality:'export',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,target==='primary'?405:500,target==='primary'?486:600,target,486)};}
class Transport {
 static instances:Transport[]=[];messages:GenerationRequest[]=[];terminated=false;
 onmessage:((event:{data:GenerationResponse})=>void)|null=null;
 constructor(){Transport.instances.push(this);}
 postMessage(message:GenerationRequest){this.messages.push(structuredClone(message));}
 terminate(){this.terminated=true;}
 emit(message:GenerationResponse){this.onmessage?.({data:message});}
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('source implicit formula frame owner',()=>{
 it('preserves source offsets/scale through save and produces native symbolic text with actual primary height',()=>{
  const scene=parseScene(JSON.stringify(imported())),config=scene.formulas!;expect(config).toMatchObject({layout:'source-surface-centered-v1',main:{x:0,y:200,scale:.25,anchor:'center'}});
  expect(config).not.toHaveProperty('primaryLogicalHeight');expect(scene.provenance?.original).toMatchObject({main_equation:{position:[0,200],scale:.25}});
  for(const target of ['primary','offscreen'] as const){const input=context(scene,target),output=generateScene(scene,input),p=output.formulaPresentation!;
   expect(p).toMatchObject({layout:'source-surface-centered-v1',primaryLogicalHeight:486,labels:[nativeFormula.label]});
   expect(output.sourceCameraFrame?.viewport).toEqual(input.sourceViewport);
   const placement=formulaPlacement(p,p.labels[0],500,600,{width:0,height:0,fontSize:50});expect(placement).toEqual({x:250,y:300+200*600/486,scale:.25*600/486});
  }
 });
 it('requires the producing viewport and preserves old saved local formulas without inferring migration from provenance',()=>{
  const scene=imported();expect(()=>generateScene(scene,{...context(scene),sourceViewport:undefined})).toThrow('主画布');
  scene.formulas=defaultFormulas();scene.formulas.main={visible:true,x:640,y:560,scale:.625,anchor:'center',color:'#ffffff',latex:'old authored text'};
  const restored=parseProjectFile(JSON.stringify(scene)).scene,p=formulaPresentation(restored);expect(restored.formulas).toEqual(scene.formulas);expect(p.labels[0].latex).toBe('old authored text');expect(p).not.toHaveProperty('layout');expect(generateScene(restored,context(restored)).formulaPresentation).toEqual(p);
  const local=createScene(definition('implicit'));local.formulas=imported().formulas;expect(()=>parseScene(JSON.stringify(local))).toThrow('源曲面');
 });
 it('delivers immutable initial labels to every progress frame and final frame',()=>{
  const scene=imported(),input=context(scene),observed:unknown[]=[];
  vi.spyOn(definition('implicit'),'generate').mockImplementation((_s,c)=>{const output={type:'geometry' as const,topology:'mesh' as const,positions:new Float32Array(),stats:{samples:0,generated:0,invalid:0}};c.onProgress?.(output);return output;});
  const output=generateScene(scene,{...input,onProgress:frame=>{observed.push(structuredClone(frame.formulaPresentation));frame.formulaPresentation!.labels[0].latex='consumer mutation';}});
  expect(observed).toEqual([output.formulaPresentation]);expect(output.formulaPresentation!.labels[0].latex).not.toBe('consumer mutation');
 });
 it.each(['missing','height','layout','local-missing','local-layout'] as const)('rejects %s producer formula facts at the Worker boundary for progress and final',async mutation=>{
  for(const operation of ['generate','generate-progress'] as const){
   const scene=imported();if(mutation.startsWith('local-'))scene.formulas=defaultFormulas();const input=context(scene),output=generateScene(scene,input);if(output.type!=='geometry')throw Error('geometry');
   if(mutation==='local-layout')output.formulaPresentation={layout:'source-surface-centered-v1',primaryLogicalHeight:486,labels:[]};
   else if(mutation==='missing'||mutation==='local-missing')delete output.formulaPresentation;
   else if(mutation==='height')output.formulaPresentation={...output.formulaPresentation!,primaryLogicalHeight:600} as never;
   else output.formulaPresentation={referenceWidth:1280,referenceHeight:720,labels:[]};
   Transport.instances=[];vi.stubGlobal('Worker',Transport);const generator=new Generator(),pending=generator.generate(scene,input),caught=pending.catch(e=>e),worker=Transport.instances[0],request=worker.messages[0];
   if(operation==='generate')worker.emit({operation,id:request.id,sessionId:request.sessionId,output});else worker.emit({operation,id:request.id,sessionId:request.sessionId,output});expect(await caught).toBeInstanceOf(Error);expect(worker.terminated).toBe(true);generator.dispose();
  }
 });
});
