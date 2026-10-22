import {afterEach,describe,expect,it,vi} from 'vitest';
import {SourceSurfaceLiveSession} from '../src/engine/sourceSurfaceLiveSession';
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
  formulas:o=>{delete o.formulaPresentation;},formulaModel:o=>{o.formulaPresentation={layout:'future',labels:[]} as never;},
  time:o=>{o.surfaceLive!.frame={...o.surfaceLive!.frame,sceneTime:NaN};},queue:o=>{o.surfaceLive!.frame={...o.surfaceLive!.frame,queueIndex:-1};},
 };
 it.each(Object.entries(mutations))('rejects malformed %s in final and progress delivery',async(_name,mutate)=>{
  for(const operation of ['generate','generate-progress'] as const){
   const f=fixture(),pending=f.g.generate(f.scene,f.context),caught=pending.catch(e=>e),w=Transport.instances[0],r=w.messages[0];mutate(f.output);
   expect(()=>w.emit({operation,sessionId:r.sessionId,id:r.id,output:f.output} as GenerationResponse)).not.toThrow();
   expect(await caught).toBeInstanceOf(Error);expect(w.terminated).toBe(true);f.g.dispose();
  }
 });
 it.each(['generate','generate-progress'] as const)('rejects raster with valid labels for ordinary source Surface %s',async operation=>{
  const f=fixture(),context={...f.context,surfaceLive:undefined},delivered=vi.fn(),pending=f.g.generate(f.scene,context,delivered),caught=pending.catch(e=>e),worker=Transport.instances[0],request=worker.messages[0];
  const output:SceneOutput={type:'raster',width:64,height:48,pixels:new Uint8ClampedArray(64*48*4),stats:{samples:1,generated:1,invalid:0},formulaPresentation:f.output.formulaPresentation};
  if(operation==='generate')worker.emit({operation:'generate',id:request.id,sessionId:request.sessionId,output});else worker.emit({operation:'generate-progress',id:request.id,sessionId:request.sessionId,output});
  expect((await caught).message).toContain('公式标注无效');expect(delivered).not.toHaveBeenCalled();expect(worker.terminated).toBe(true);f.g.dispose();
 });
 it('requires the completed output identity and validates playback acknowledgement',async()=>{
  const f=fixture(),pending=f.g.generate(f.scene,f.context),w=Transport.instances[0],r=w.messages[0];w.emit({operation:'generate',sessionId:r.sessionId,id:r.id,output:f.output});await pending;
  await expect(f.g.setSurfacePaused({...f.output},false)).rejects.toThrow();
  const control=f.g.setSurfacePaused(f.output,false,2000),caught=control.catch(e=>e),p=w.messages.at(-1)!;
  expect(p).toMatchObject({operation:'surface-playback',sourceId:r.id,paused:false,timestampMs:2000});
  w.emit({operation:'surface-playback',sessionId:p.sessionId,id:p.id,sourceId:r.id+1,paused:false,frame:f.output.surfaceLive!.frame});expect(await caught).toBeInstanceOf(Error);expect(w.terminated).toBe(true);f.g.dispose();
 });
 it('serializes parameter edits and preserves the completed frame capability after acknowledgement',async()=>{
  const f=fixture(),pending=f.g.generate(f.scene,f.context),w=Transport.instances[0],r=w.messages[0];w.emit({operation:'generate',sessionId:r.sessionId,id:r.id,output:f.output});await pending;
  await expect(f.g.updateSurfaceParameter({...f.output},'a',.75)).rejects.toThrow();
  await expect(f.g.updateSurfaceParameter(f.output,'a',NaN)).rejects.toThrow('有限数值');
  expect(w.messages).toHaveLength(1);
  const edit=f.g.updateSurfaceParameter(f.output,'a',.75),p=w.messages.at(-1)!;
  expect(p).toMatchObject({operation:'surface-parameter',sourceId:r.id,name:'a',value:.75});
  await expect(f.g.currentSurface(f.output)).rejects.toThrow();
  w.emit({operation:'surface-parameter',sessionId:p.sessionId,id:p.id,sourceId:r.id});await edit;
  const current=f.g.currentSurface(f.output),q=w.messages.at(-1)!;const output=structuredClone(f.output);output.surfaceLive!.renderKind='snapshot';
  w.emit({operation:'surface-current',sessionId:q.sessionId,id:q.id,sourceId:r.id,output});expect(await current).toBe(output);f.g.dispose();
 });
 it('retires a worker on a mismatched parameter acknowledgement',async()=>{
  const f=fixture(),pending=f.g.generate(f.scene,f.context),w=Transport.instances[0],r=w.messages[0];w.emit({operation:'generate',sessionId:r.sessionId,id:r.id,output:f.output});await pending;
  const edit=f.g.updateSurfaceParameter(f.output,'a',.75),caught=edit.catch(e=>e),p=w.messages.at(-1)!;
  w.emit({operation:'surface-parameter',sessionId:p.sessionId,id:p.id,sourceId:r.id+1});expect(await caught).toBeInstanceOf(Error);expect(w.terminated).toBe(true);f.g.dispose();
 });
 it('requires exact Surface capture response identity and rejects before rendering on malformed data',async()=>{
  const f=fixture(),pending=f.g.generate(f.scene,f.context),w=Transport.instances[0],r=w.messages[0];w.emit({operation:'generate',sessionId:r.sessionId,id:r.id,output:f.output});await pending;
  await expect(f.g.captureSurfacePaused({...f.output},{width:64,height:48})).rejects.toThrow();
  const capture=f.g.captureSurfacePaused(f.output,{width:64,height:48}),caught=capture.catch(e=>e),p=w.messages.at(-1)!;
  w.emit({operation:'surface-paused-capture',sessionId:p.sessionId,id:p.id,sourceId:r.id+1,result:{scene:f.scene,capture:f.output,preview:f.output}});
  expect(await caught).toBeInstanceOf(Error);expect(w.terminated).toBe(true);f.g.dispose();
 });
 it('accepts only explicit worker proof when retaining a preview after a rejected capture',async()=>{
  const f=fixture(),pending=f.g.generate(f.scene,f.context),w=Transport.instances[0],r=w.messages[0];w.emit({operation:'generate',sessionId:r.sessionId,id:r.id,output:f.output});await pending;
  const capture=f.g.captureSurfacePaused(f.output,{width:64,height:48}),caught=capture.catch(e=>e),p=w.messages.at(-1)!;
  w.emit({operation:'surface-paused-capture',sessionId:p.sessionId,id:p.id,error:'capacity',retainedSourceId:r.id});
  expect(await caught).toMatchObject({previewRetained:true});expect(w.terminated).toBe(false);
  const current=f.g.currentSurface(f.output),q=w.messages.at(-1)!,copy=structuredClone(f.output);copy.surfaceLive!.renderKind='snapshot';w.emit({operation:'surface-current',sessionId:q.sessionId,id:q.id,sourceId:r.id,output:copy});expect(await current).toBe(copy);f.g.dispose();
 });
 it('cancels capture during asynchronous renderer loading and ignores its late completion',async()=>{
  const f=fixture(),pending=f.g.generate(f.scene,f.context),w=Transport.instances[0],r=w.messages[0];w.emit({operation:'generate',sessionId:r.sessionId,id:r.id,output:f.output});await pending;
  const owner=new SourceSurfaceLiveSession();owner.generate(f.scene,f.context);const result=owner.capturePaused(f.scene,f.context,{width:16,height:12},1);
  const capture=f.g.captureSurfacePaused(f.output,{width:16,height:12}),caught=capture.catch(e=>e),p=w.messages.at(-1)!;
  w.emit({operation:'surface-paused-capture',sessionId:p.sessionId,id:p.id,sourceId:r.id,result});f.g.cancel();expect(await caught).toBeInstanceOf(Error);expect(w.terminated).toBe(true);
  const fresh=f.g.generate(f.scene,f.context),next=Transport.instances[1],q=next.messages[0];next.emit({operation:'generate',sessionId:q.sessionId,id:q.id,output:f.output});expect(await fresh).toBe(f.output);f.g.dispose();
 });
 it.each(['queue','zoom','angle','missing'] as const)('rejects invalid %s in the Surface playback state acknowledgement',async mutation=>{
  const f=fixture(),pending=f.g.generate(f.scene,f.context),w=Transport.instances[0],r=w.messages[0];w.emit({operation:'generate',sessionId:r.sessionId,id:r.id,output:f.output});await pending;
  const control=f.g.setSurfacePaused(f.output,false,2000),caught=control.catch(e=>e),p=w.messages.at(-1)!;let frame=structuredClone(f.output.surfaceLive!.frame);
  if(mutation==='queue')frame={...frame,queueIndex:frame.queueIndex+1};if(mutation==='zoom')frame={...frame,camera:{...frame.camera,zoom:frame.camera.zoom*2}};if(mutation==='angle')frame={...frame,camera:{...frame.camera,phi:Infinity}};
  w.emit({operation:'surface-playback',sessionId:p.sessionId,id:p.id,sourceId:r.id,paused:false,frame:mutation==='missing'?undefined:frame} as GenerationResponse);
  expect(await caught).toBeInstanceOf(Error);expect(w.terminated).toBe(true);f.g.dispose();
 });
 it('accepts the owned navigation frame, invalidates the prior capability and rejects queue advancement',async()=>{
  for(const invalid of [false,true]){
   const f=fixture(),pending=f.g.generate(f.scene,f.context),w=Transport.instances[0],r=w.messages[0];w.emit({operation:'generate',sessionId:r.sessionId,id:r.id,output:f.output});await pending;
   const owner=new SourceSurfaceLiveSession();owner.generate(f.scene,f.context);const output=owner.navigatePaused(f.scene,f.context,{kind:'drag',dx:10,dy:20});if(output.type!=='geometry')throw Error('geometry');
   if(invalid)output.surfaceLive!.frame={...output.surfaceLive!.frame,sceneTime:1};
   const navigation=f.g.navigateSurfacePaused(f.output,{kind:'drag',dx:10,dy:20}),caught=navigation.catch(e=>e),p=w.messages.at(-1)!;
   w.emit({operation:'surface-navigation',sessionId:p.sessionId,id:p.id,sourceId:r.id,output});
   if(invalid){expect(await caught).toBeInstanceOf(Error);expect(w.terminated).toBe(true);}else{expect(await caught).toBe(output);await expect(f.g.navigateSurfacePaused(f.output,{kind:'wheel',count:1})).rejects.toThrow();}
   f.g.dispose();
  }
 });
 it('rejects a current-frame response which advances the owned queue',async()=>{
  const f=fixture(),pending=f.g.generate(f.scene,f.context),w=Transport.instances[0],r=w.messages[0];w.emit({operation:'generate',sessionId:r.sessionId,id:r.id,output:f.output});await pending;
  const request=f.g.currentSurface(f.output),caught=request.catch(e=>e),p=w.messages.at(-1)!,changed=structuredClone(f.output);
  changed.surfaceLive!.renderKind='snapshot';changed.surfaceLive!.frame={...changed.surfaceLive!.frame,queueIndex:changed.surfaceLive!.frame.queueIndex+1};
  w.emit({operation:'surface-current',sessionId:p.sessionId,id:p.id,sourceId:r.id,output:changed});expect(await caught).toBeInstanceOf(Error);expect(w.terminated).toBe(true);f.g.dispose();
 });
});
