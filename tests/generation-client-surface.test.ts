import {afterEach,describe,expect,it,vi} from 'vitest';
import {Generator} from '../src/engine/client';
import {generateScene} from '../src/engine/temporal';
import {parseProjectFile} from '../src/engine/legacyImport';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import type {GenerationRequest,GenerationResponse} from '../src/engine/generationProtocol';
import type {GenerationInput,SceneOutput} from '../src/types';
class Transport {
 static instances:Transport[]=[];messages:GenerationRequest[]=[];terminated=false;
 onmessage:((event:{data:GenerationResponse})=>void)|null=null;
 constructor(){Transport.instances.push(this);}
 postMessage(message:GenerationRequest){this.messages.push(structuredClone(message));}
 terminate(){this.terminated=true;}
 emit(message:GenerationResponse){this.onmessage?.({data:message});}
}
function fixture(){
 const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SURFACE',name:'transport',equations:{x:'u',y:'v',z:'0'},settings:{surface_mode:'MESH',mesh_u_segments:2,mesh_v_segments:2,mesh_wireframe:false},timeline:[{type:'wait',duration:1}]})).scene;
 const context:GenerationInput={time:999,width:64,height:48,quality:'preview',sourceViewport:ordinarySourceViewport(scene,64,48,'primary',48),surfaceLive:{sessionId:'surface',revision:0,clock:{paused:true,timestampMs:1000},actualFrameRate:37}};
 const output=generateScene(scene,context);if(output.type!=='geometry'||!output.surfaceLive)throw Error('missing production geometry');
 Transport.instances=[];vi.stubGlobal('Worker',Transport);return{scene,context,output,g:new Generator()};
}
afterEach(()=>vi.unstubAllGlobals());
describe('Surface transport capabilities',()=>{
 const mutations:Record<string,(o:Extract<SceneOutput,{type:'geometry'}>)=>void>={
  session:o=>{o.surfaceLive!.sessionId='foreign';},revision:o=>{o.surfaceLive!.revision++;},pause:o=>{o.surfaceLive!.paused=false;},
  frame:o=>{o.surfaceLive!.frame={...o.surfaceLive!.frame,frameIndex:o.surfaceLive!.frame.frameIndex+1};},camera:o=>{o.sourceCameraFrame!.camera={...o.sourceCameraFrame!.camera,phi:99};},viewport:o=>{o.sourceCameraFrame!.viewport={...o.sourceCameraFrame!.viewport,logicalWidth:3};},
  time:o=>{o.surfaceLive!.frame={...o.surfaceLive!.frame,sceneTime:NaN};},queue:o=>{o.surfaceLive!.frame={...o.surfaceLive!.frame,queueIndex:-1};},
 };
 it.each(Object.entries(mutations))('rejects malformed %s in final and progress delivery',async(_name,mutate)=>{
  for(const operation of ['generate','generate-progress'] as const){
   const f=fixture(),pending=f.g.generate(f.scene,f.context),caught=pending.catch(e=>e),w=Transport.instances[0],r=w.messages[0];mutate(f.output);
   expect(()=>w.emit({operation,sessionId:r.sessionId,id:r.id,output:f.output} as GenerationResponse)).not.toThrow();
   expect(await caught).toBeInstanceOf(Error);expect(w.terminated).toBe(true);f.g.dispose();
  }
 });
 it('requires the completed output identity and validates playback acknowledgement',async()=>{
  const f=fixture(),pending=f.g.generate(f.scene,f.context),w=Transport.instances[0],r=w.messages[0];w.emit({operation:'generate',sessionId:r.sessionId,id:r.id,output:f.output});await pending;
  await expect(f.g.setSurfacePaused({...f.output},false)).rejects.toThrow();
  const control=f.g.setSurfacePaused(f.output,false,2000),caught=control.catch(e=>e),p=w.messages.at(-1)!;
  expect(p).toMatchObject({operation:'surface-playback',sourceId:r.id,paused:false,timestampMs:2000});
  w.emit({operation:'surface-playback',sessionId:p.sessionId,id:p.id,sourceId:r.id+1,paused:false});expect(await caught).toBeInstanceOf(Error);expect(w.terminated).toBe(true);f.g.dispose();
 });
 it('rejects a current-frame response which advances the owned queue',async()=>{
  const f=fixture(),pending=f.g.generate(f.scene,f.context),w=Transport.instances[0],r=w.messages[0];w.emit({operation:'generate',sessionId:r.sessionId,id:r.id,output:f.output});await pending;
  const request=f.g.currentSurface(f.output),caught=request.catch(e=>e),p=w.messages.at(-1)!,changed=structuredClone(f.output);
  changed.surfaceLive!.renderKind='snapshot';changed.surfaceLive!.frame={...changed.surfaceLive!.frame,queueIndex:changed.surfaceLive!.frame.queueIndex+1};
  w.emit({operation:'surface-current',sessionId:p.sessionId,id:p.id,sourceId:r.id,output:changed});expect(await caught).toBeInstanceOf(Error);expect(w.terminated).toBe(true);f.g.dispose();
 });
});
