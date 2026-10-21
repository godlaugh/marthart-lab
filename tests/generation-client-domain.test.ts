import {afterEach,describe,expect,it,vi} from 'vitest';
import {Generator} from '../src/engine/client';
import {generateScene} from '../src/engine/temporal';
import {parseProjectFile} from '../src/engine/legacyImport';
import type {GenerationRequest,GenerationResponse} from '../src/engine/generationProtocol';
import type {GenerationInput,SceneOutput} from '../src/types';

class Transport {
 static instances:Transport[]=[];
 messages:GenerationRequest[]=[];terminated=false;
 onmessage:((event:{data:GenerationResponse})=>void)|null=null;
 constructor(){Transport.instances.push(this);}
 postMessage(message:GenerationRequest){this.messages.push(structuredClone(message));}
 terminate(){this.terminated=true;}
 emit(message:GenerationResponse){this.onmessage?.({data:message});}
}
const input=():GenerationInput=>({time:900,width:8,height:6,quality:'export',domainLive:{sessionId:'domain',revision:0,clock:{paused:true,timestampMs:1000},actualFrameRate:29.97}});
function fixture(){
 const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'transport',domainColoring:{formula:'z^3 - 1'},timeline:[{type:'wait',duration:1}]})).scene;scene.settings.domainBackend='cpu';
 const context=input(),output=generateScene(scene,context);if(output.type!=='raster'||!output.domainLive)throw Error('missing real numerical/render producer');
 Transport.instances=[];vi.stubGlobal('Worker',Transport);return{scene,context,output,g:new Generator()};
}
afterEach(()=>vi.unstubAllGlobals());
describe('Domain live transport identity and failure boundary',()=>{
 it('snapshots Apply input and accepts rounded consumed FPS from the real producer',async()=>{
  const f=fixture(),configuration=structuredClone(f.scene);f.context.domainLive!.configuration=configuration;
  const pending=f.g.generate(f.scene,f.context),w=Transport.instances[0],r=w.messages[0];configuration.settings.centerX=999;
  expect(r.operation==='generate'&&r.context.domainLive!.configuration!.settings.centerX).not.toBe(999);
  w.emit({operation:'generate',sessionId:r.sessionId,id:r.id,output:f.output});expect(await pending).toBe(f.output);expect(f.output.domainLive!.actualFrameRate).toBe(Math.fround(29.97));f.g.dispose();
 });
 const mutations:Record<string,(o:Extract<SceneOutput,{type:'raster'}>)=>void>={
  revision:o=>{o.domainLive!.revision++;},
  session:o=>{o.domainLive!.sessionId='another';},
  pause:o=>{o.domainLive!.paused=false;},
  fps:o=>{o.domainLive!.actualFrameRate=12;},
  clock:o=>{delete (o.domainLive!.presentation.evaluatedDomainScene! as unknown as Record<string,unknown>).clock;},
  sourceClock:o=>{o.domainRender={...o.domainRender!,sourceClock:{...o.domainRender!.sourceClock!,sceneTime:999}};},
  formulas:o=>{delete o.formulaPresentation;},
  dimensions:o=>{o.width=4;o.height=12;},
  snapshotDt:o=>{o.domainLive!.renderKind='snapshot';o.domainLive!.rawDt=1;},
 };
 it.each(Object.entries(mutations))('rejects malformed %s in final and progress responses without leaving a pending promise',async(_name,mutate)=>{
  for(const operation of ['generate','generate-progress'] as const){
   const f=fixture(),pending=f.g.generate(f.scene,f.context),caught=pending.catch(e=>e),w=Transport.instances[0],r=w.messages[0];mutate(f.output);
   const response:GenerationResponse=operation==='generate'?{operation:'generate',sessionId:r.sessionId,id:r.id,output:f.output}:{operation:'generate-progress',sessionId:r.sessionId,id:r.id,output:f.output};
   expect(()=>w.emit(response)).not.toThrow();
   expect(await caught).toBeInstanceOf(Error);expect(w.terminated).toBe(true);await expect(f.g.setDomainPaused(f.output,false)).rejects.toThrow();f.g.dispose();
  }
 });
 it('requires the exact completed image and matching playback acknowledgement',async()=>{
  const f=fixture(),pending=f.g.generate(f.scene,f.context),w=Transport.instances[0],r=w.messages[0];w.emit({operation:'generate',sessionId:r.sessionId,id:r.id,output:f.output});await pending;
  await expect(f.g.setDomainPaused({...f.output},false)).rejects.toThrow();
  const playback=f.g.setDomainPaused(f.output,false,2000),caught=playback.catch(e=>e),p=w.messages.at(-1)!;
  expect(p).toMatchObject({operation:'domain-playback',sourceId:r.id,paused:false,timestampMs:2000});
  w.emit({operation:'domain-playback',sessionId:p.sessionId,id:p.id,sourceId:r.id+1,paused:false});expect(await caught).toBeInstanceOf(Error);expect(w.terminated).toBe(true);f.g.dispose();
 });
});
