import {SourceDomainLiveSession} from '../src/engine/sourceDomainLiveSession';
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
const input=():GenerationInput=>({time:900,width:8,height:6,quality:'export',domainLive:{sessionId:'domain',revision:0,clock:{paused:true,timestampMs:1000},actualFrameRate:29.97,viewport:{logicalWidth:8,logicalHeight:6,pixelDensity:1}}});
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
  recordingFacts:o=>{o.domainLive!.recording={simulationFps:60,ordinal:0,warmup:true,complete:false};},
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
 it('rejects uncertain parameter acknowledgements and mismatched navigation state',async()=>{
  for(const kind of ['parameters','navigation'] as const){
   const f=fixture(),first=f.g.generate(f.scene,f.context),w=Transport.instances[0],r=w.messages[0];w.emit({operation:'generate',sessionId:r.sessionId,id:r.id,output:f.output});await first;
   const next={...f.scene,parameters:{...f.scene.parameters,a:.7}};
   const pending=kind==='parameters'?f.g.updateDomainParameters(f.output,next,[['a',.7]]):f.g.navigateDomainPaused(f.output,{kind:'pan',dx:1,dy:2}),caught=pending.catch(e=>e),p=w.messages.at(-1)!;
   if(kind==='parameters')w.emit({operation:'domain-parameters',sessionId:p.sessionId,id:p.id,sourceId:r.id+1});
   else{const changed=structuredClone(f.output);changed.domainLive!.renderKind='snapshot';changed.domainLive!.updateOrdinal++;w.emit({operation:'domain-navigation',sessionId:p.sessionId,id:p.id,sourceId:r.id,output:changed});}
   expect(await caught).toBeInstanceOf(Error);expect(w.terminated).toBe(true);await expect(f.g.navigateDomainPaused(f.output,{kind:'wheel',count:1})).rejects.toThrow();f.g.dispose();
  }
 });
});

describe('Domain capture transport validation',()=>{
 for(const corrupt of ['none','time','target','size','formula','paired-state'] as const)it(`validates ${corrupt} capture response against the completed capability`,async()=>{
  const f=fixture(),initial=f.g.generate(f.scene,f.context),w=Transport.instances[0],r=w.messages[0];w.emit({operation:'generate',sessionId:r.sessionId,id:r.id,output:f.output});await initial;
  const owner=new SourceDomainLiveSession();owner.generate(f.scene,f.context);const result=owner.capturePaused(f.scene,{...f.context,width:4,height:2});result.capture.sourceCurrentImage={model:'local-current-numerical-snapshot',stage:'base-before-formulas',requestedSize:[4,2],logicalSize:[4,2],pixelDensity:1,baseSize:[4,2],scale:3};
  if(corrupt==='time')result.capture.domainLive!.sceneTime++;
  if(corrupt==='target')result.capture.domainLive!.target='primary';
  if(corrupt==='size')result.capture.sourceCurrentImage.scale=5;
  if(corrupt==='formula')Object.assign(result.capture.formulaPresentation!,{referenceWidth:0});
  if(corrupt==='paired-state')result.capture.domainLive!.presentation.parameters.a=123;
  const pending=f.g.captureDomainPaused(f.output,{width:4,height:2},3),caught=pending.catch(e=>e),p=w.messages.at(-1)!;w.emit({operation:'domain-paused-capture',sessionId:p.sessionId,id:p.id,result});
  const response=await caught;if(corrupt==='none'){expect(response).toBe(result);expect(w.terminated).toBe(false);}else{expect(response).toBeInstanceOf(Error);expect(w.terminated).toBe(true);}f.g.dispose();
 });
});
