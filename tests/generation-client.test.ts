import {describe,it,expect,vi,afterEach} from 'vitest';
import {Generator} from '../src/engine/client';
import type {GenerationRequest,GenerationResponse} from '../src/engine/generationProtocol';
import type {SceneOutput,GenerationStatus,GenerationInput} from '../src/types';
import {parseProjectFile} from '../src/engine/legacyImport';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
class FakeWorker{
 static instances:FakeWorker[]=[];messages:GenerationRequest[]=[];terminated=false;
 onmessage:((event:{data:GenerationResponse})=>void)|null=null;
 onerror:((event:{message:string})=>void)|null=null;
 constructor(){FakeWorker.instances.push(this);}
 postMessage(message:GenerationRequest){this.messages.push(structuredClone(message));}
 terminate(){this.terminated=true;}
 emit(message:GenerationResponse){this.onmessage?.({data:message});}
}
const ctx={time:2,width:32,height:24,quality:'export' as const};
const scene=()=>createScene(definition('roots'));
const output:SceneOutput={type:'raster',width:1,height:1,pixels:new Uint8ClampedArray([0,0,0,255]),stats:{samples:0,generated:0,invalid:0,elapsedMs:0}};
const status:GenerationStatus={kind:'roots',attemptedSamples:32,targetSamples:128,totalSamples:47550000};
const rootsOutput:Extract<SceneOutput,{type:'raster'}>={...output,rootsPresentation:{model:'mathart-1.7.8-v1',mode:'density',clockPolicy:'local-fixed-sample-clock-v1',streamPolicy:'global-ordinal',presentationAlpha:'opaque-framebuffer-rgb',instance:1,restartReason:'initial',attemptedSamples:1,newSamples:1,newRawPoints:2,totalRawPoints:2,physicalSize:[1,1],logicalSize:[1,1],referenceLogicalHeight:1,target:'primary'}};
function setup(){FakeWorker.instances=[];vi.stubGlobal('Worker',FakeWorker);return new Generator();}
afterEach(()=>vi.unstubAllGlobals());
describe('generation status protocol ownership',()=>{
 it('preserves source Samila primary height through direct Worker requests',async()=>{
  for(const height of [undefined,1080,0,NaN]){
   const g=setup(),s=createScene(definition('samila')),pending=g.generate(s,{...ctx,samilaPrimaryPixelHeight:height}),worker=FakeWorker.instances[0],request=worker.messages[0];
   expect(request.operation).toBe('generate');if(request.operation!=='generate')throw Error('request');
   expect(Object.hasOwn(request.context,'samilaPrimaryPixelHeight')).toBe(height!==undefined);expect(request.context.samilaPrimaryPixelHeight).toBe(height);
   worker.emit({operation:'generate',id:request.id,sessionId:request.sessionId,output});await pending;g.dispose();
  }
 });

 it('preserves source fractal logical-size presence, including malformed values, for the owning worker validator',async()=>{
  for(const raw of [undefined,null,false,{logicalWidth:null,logicalHeight:97,target:'primary'}, {logicalWidth:257,logicalHeight:193,target:'offscreen'}]){
   const g=setup(),s=createScene(definition('fractal')),pending=g.generate(s,{...ctx,fractalViewport:raw as unknown as GenerationInput['fractalViewport']}),worker=FakeWorker.instances[0],request=worker.messages[0];
   expect(request.operation).toBe('generate');if(request.operation!=='generate')throw Error('request');
   expect(Object.hasOwn(request.context,'fractalViewport')).toBe(raw!==undefined);expect(request.context.fractalViewport).toEqual(raw);
   if(raw&&typeof raw==='object'){const original=raw.logicalHeight;raw.logicalHeight=999;expect(request.context.fractalViewport?.logicalHeight).toBe(original);}
   worker.emit({operation:'generate',id:request.id,sessionId:request.sessionId,output});await pending;g.dispose();
  }
 });

 it('restores a rejected capture only with matching retained-preview evidence, including synchronous send failure',async()=>{
  const g=setup(),s=scene(),first=g.generate(s,ctx),worker=FakeWorker.instances[0],request=worker.messages[0];worker.emit({operation:'generate',id:request.id,sessionId:request.sessionId,output:rootsOutput});await first;
  const denied=g.captureRootsPaused(rootsOutput,{width:7680,height:4320}),deniedError=denied.catch(e=>e),r=worker.messages.at(-1)!;
  worker.emit({operation:'roots-paused-capture',id:r.id,sessionId:r.sessionId,error:'capacity before mutation',retainedSourceId:request.id});expect((await deniedError).previewRetained).toBe(true);
  const post=worker.postMessage;worker.postMessage=()=>{throw new DOMException('clone failed','DataCloneError');};
  await expect(g.captureRootsPaused(rootsOutput,{width:1,height:1})).rejects.toMatchObject({previewRetained:true});worker.postMessage=post;
  const retry=g.captureRootsPaused(rootsOutput,{width:1,height:1}),rr=worker.messages.at(-1)!;expect(rr.operation==='roots-paused-capture'&&rr.sourceId).toBe(request.id);
  worker.emit({operation:'roots-paused-capture',id:rr.id,sessionId:rr.sessionId,result:{capture:rootsOutput,preview:{...rootsOutput}}});await retry;g.dispose();
 });
 it('never restores a capture from mismatched retention evidence or a post-render failure',async()=>{
  for(const retainedSourceId of [undefined,999]){
   const g=setup(),first=g.generate(scene(),ctx),worker=FakeWorker.instances[0],request=worker.messages[0];worker.emit({operation:'generate',id:request.id,sessionId:request.sessionId,output:rootsOutput});await first;
   const pending=g.captureRootsPaused(rootsOutput,{width:1,height:1}),caught=pending.catch(e=>e),r=worker.messages.at(-1)!;
   worker.emit({operation:'roots-paused-capture',id:r.id,sessionId:r.sessionId,error:'no usable old preview',retainedSourceId});expect((await caught).previewRetained).toBe(false);
   await expect(g.captureRootsPaused(rootsOutput,{width:1,height:1})).rejects.toThrow('过期');g.dispose();
  }
 });
 it('captures only the exact completed frame and transfers eligibility to the primary refresh',async()=>{
  const g=setup(),s=scene(),first=g.generate(s,ctx),worker=FakeWorker.instances[0],request=worker.messages[0];
  await expect(g.captureRootsPaused(rootsOutput,{width:1,height:1})).rejects.toThrow('尚未完成');
  worker.emit({operation:'generate',id:request.id,sessionId:request.sessionId,output:rootsOutput});await first;
  await expect(g.captureRootsPaused({...rootsOutput},{width:1,height:1})).rejects.toThrow('过期');
  const size={width:17,height:19},capture=g.captureRootsPaused(rootsOutput,size),r=worker.messages.at(-1)!;size.width=99;
  expect(r.operation).toBe('roots-paused-capture');if(r.operation!=='roots-paused-capture')throw new Error('request');
  expect(r.sourceId).toBe(request.id);expect(r.size).toEqual({width:17,height:19});
  await expect(g.captureRootsPaused(rootsOutput,{width:1,height:1})).rejects.toThrow('尚未完成');
  const preview={...rootsOutput},result={capture:rootsOutput,preview};
  worker.emit({operation:'roots-paused-capture',id:r.id,sessionId:r.sessionId,result});expect(await capture).toBe(result);
  await expect(g.captureRootsPaused(rootsOutput,{width:1,height:1})).rejects.toThrow('过期');
  const second=g.captureRootsPaused(preview,{width:1,height:1}),r2=worker.messages.at(-1)!;
  expect(r2.operation==='roots-paused-capture'&&r2.sourceId).toBe(r.id);
  worker.emit({operation:'roots-paused-capture',id:r2.id,sessionId:r2.sessionId,result:{capture:rootsOutput,preview:{...preview}}});await second;
  expect(FakeWorker.instances).toHaveLength(1);expect(worker.terminated).toBe(false);g.dispose();
 });
 it('revokes capture on generation failure, replacement and cancellation',async()=>{
  const g=setup(),first=g.generate(scene(),ctx),worker=FakeWorker.instances[0],r=worker.messages[0];worker.emit({operation:'generate',id:r.id,sessionId:r.sessionId,output:rootsOutput});await first;
  const next=g.generate(scene(),ctx),bad=worker.messages.at(-1)!;
  await expect(g.captureRootsPaused(rootsOutput,{width:1,height:1})).rejects.toThrow('尚未完成');
  const caught=next.catch(e=>e);worker.emit({operation:'generate',id:bad.id,sessionId:bad.sessionId,error:'failed'});await caught;
  await expect(g.captureRootsPaused(rootsOutput,{width:1,height:1})).rejects.toThrow('过期');
  const retry=g.generate(scene(),ctx),rr=worker.messages.at(-1)!;worker.emit({operation:'generate',id:rr.id,sessionId:rr.sessionId,output:rootsOutput});await retry;
  const capture=g.captureRootsPaused(rootsOutput,{width:1,height:1}),captureError=capture.catch(e=>e);g.cancel();expect((await captureError).name).toBe('AbortError');
  await expect(g.captureRootsPaused(rootsOutput,{width:1,height:1})).rejects.toThrow('过期');expect(worker.terminated).toBe(true);
 });
 it('captures the exact completed Perlin output, transfers eligibility, and never sends a replacement scene',async()=>{
  const s=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'PERLIN',name:'capture',settings:{seed:'1',particle_count:2}})).scene;
  const frame={...output,sourcePerlinFrame:{sourceViewport:{width:32,height:24,pixelDensity:2},samples:4,frameIndex:60,updates:61,queueComplete:false,queueIndex:0,sceneTime:1}};
  const g=setup(),pending=g.generate(s,{...ctx,quality:'preview',sourcePerlinViewport:{width:32,height:24,pixelDensity:2}}),worker=FakeWorker.instances[0],r=worker.messages[0];
  await expect(g.capturePerlinPaused(frame,{width:3,height:5})).rejects.toThrow('尚未完成');
  worker.emit({operation:'generate',id:r.id,sessionId:r.sessionId,output:frame});await pending;
  await expect(g.capturePerlinPaused({...frame},{width:3,height:5})).rejects.toThrow('过期');
  const size={width:3,height:5},capture=g.capturePerlinPaused(frame,size,3),c=worker.messages.at(-1)!;size.width=999;
  expect(c).toEqual({operation:'perlin-paused-capture',id:c.id,sessionId:r.sessionId,sourceId:r.id,size:{width:3,height:5},scale:3});
  const preview={...frame};worker.emit({operation:'perlin-paused-capture',id:c.id,sessionId:c.sessionId,result:{capture:frame,preview}});expect(await capture).toEqual({capture:frame,preview});
  await expect(g.capturePerlinPaused(frame,{width:3,height:5})).rejects.toThrow('过期');
  const again=g.capturePerlinPaused(preview,{width:3,height:5},5),a=worker.messages.at(-1)!;expect(a.operation==='perlin-paused-capture'&&a.sourceId).toBe(c.id);
  worker.emit({operation:'perlin-paused-capture',id:a.id,sessionId:a.sessionId,result:{capture:frame,preview:{...preview}}});await again;g.dispose();
 });
 it('requires matching Perlin owner retention, never another family, missing evidence or send failure',async()=>{
  for(const response of ['matching','wrong-id','roots','missing','send'] as const){
   const s=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'PERLIN',name:'capture',settings:{seed:'1'}})).scene;
   const frame={...output,sourcePerlinFrame:{sourceViewport:{width:32,height:24,pixelDensity:1},samples:4,frameIndex:60,updates:61,queueComplete:false,queueIndex:0,sceneTime:1}};
   const g=setup(),pending=g.generate(s,ctx),worker=FakeWorker.instances[0],r=worker.messages[0];worker.emit({operation:'generate',id:r.id,sessionId:r.sessionId,output:frame});await pending;
   if(response==='send')worker.postMessage=()=>{throw new Error('transport failed');};
   const capture=g.capturePerlinPaused(frame,{width:1,height:1}),caught=capture.catch(error=>error),c=worker.messages.at(-1)!;
   if(response!=='send')worker.emit({operation:response==='roots'?'roots-paused-capture':'perlin-paused-capture',id:c.id,sessionId:c.sessionId,error:'capacity before mutation',...(response==='missing'?{}:{retainedSourceId:response==='wrong-id'?999:r.id})});
   expect(await caught).toMatchObject({name:'PerlinPausedCaptureError',previewRetained:response==='matching'});
   if(response==='matching'){
    const retry=g.capturePerlinPaused(frame,{width:1,height:1}),retryCaught=retry.catch(error=>error);g.cancel();expect((await retryCaught).name).toBe('AbortError');
   }else await expect(g.capturePerlinPaused(frame,{width:1,height:1})).rejects.toThrow('过期');
   g.dispose();
  }
 });
 it('does not grant Perlin capture to legacy-only documents or unrelated output metadata',async()=>{
  for(const full of [false,true]){
   const s=createScene(definition('perlin'));
   if(full)s.perlinSource=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'PERLIN',name:'capture',settings:{seed:'1'}})).scene.perlinSource;
   const frame=full?output:{...output,sourcePerlinFrame:{sourceViewport:{width:1,height:1,pixelDensity:1},samples:4,frameIndex:0,updates:1,queueComplete:false,queueIndex:0,sceneTime:0}};
   const g=setup(),pending=g.generate(s,ctx),worker=FakeWorker.instances[0],r=worker.messages[0];worker.emit({operation:'generate',id:r.id,sessionId:r.sessionId,output:frame});await pending;
   await expect(g.capturePerlinPaused(frame,{width:1,height:1})).rejects.toThrow('过期');g.dispose();
  }
 });
 it('forwards explicitly resolved Roots logical, physical and reference sizes without aliasing the caller',async()=>{
  const g=setup(),rootsViewport={logicalWidth:101,logicalHeight:79,referenceLogicalHeight:151,target:'offscreen' as const};
  const pending=g.generate(scene(),{...ctx,width:202,height:158,rootsViewport,rootsSessionId:'live-owner'});
  rootsViewport.logicalWidth=999;
  const worker=FakeWorker.instances[0],request=worker.messages[0];
  expect(request.operation).toBe('generate');if(request.operation!=='generate')throw new Error('request');
  expect(request.context.rootsViewport).toEqual({logicalWidth:101,logicalHeight:79,referenceLogicalHeight:151,target:'offscreen'});
  expect(request.context.width).toBe(202);expect(request.context.height).toBe(158);
  expect(request.context.rootsSessionId).toBe('live-owner');
  worker.emit({operation:'generate',id:request.id,sessionId:request.sessionId,output});await pending;g.dispose();
 });
 it('delivers lightweight status separately from pixels without settling the pending request or sending callbacks',async()=>{
  const g=setup(),onProgress=vi.fn(),onStatus=vi.fn(),done=vi.fn(),pending=g.generate(scene(),ctx,onProgress,onStatus);pending.then(done);
  const worker=FakeWorker.instances[0],request=worker.messages[0];expect(request.operation).toBe('generate');if(request.operation!=='generate')throw new Error('request');expect(request.context).toEqual(ctx);expect(request.wantsStatus).toBe(true);
  worker.emit({operation:'generate-status',id:request.id,sessionId:request.sessionId,status});expect(onStatus).toHaveBeenCalledWith(status);expect(onProgress).not.toHaveBeenCalled();await Promise.resolve();expect(done).not.toHaveBeenCalled();
  worker.emit({operation:'generate-progress',id:request.id,sessionId:request.sessionId,output});expect(onProgress).toHaveBeenCalledWith(output);
  worker.emit({operation:'generate',id:request.id,sessionId:request.sessionId,output});expect(await pending).toBe(output);expect(done).toHaveBeenCalledOnce();g.dispose();
 });
 it('ignores status with wrong request/session identity, after completion and after cancellation even if old worker calls back',async()=>{
  const g=setup(),onStatus=vi.fn(),pending=g.generate(scene(),ctx,undefined,onStatus),rejected=pending.catch(e=>e),first=FakeWorker.instances[0],request=first.messages[0];
  first.emit({operation:'generate-status',id:request.id+1,sessionId:request.sessionId,status});first.emit({operation:'generate-status',id:request.id,sessionId:request.sessionId+1,status});expect(onStatus).not.toHaveBeenCalled();
  g.cancel();expect((await rejected).name).toBe('AbortError');expect(first.terminated).toBe(true);first.emit({operation:'generate-status',id:request.id,sessionId:request.sessionId,status});expect(onStatus).not.toHaveBeenCalled();
  const next=g.generate(scene(),ctx,undefined,onStatus),second=FakeWorker.instances[1],r=second.messages[0];first.emit({operation:'generate-status',id:r.id,sessionId:request.sessionId,status});expect(onStatus).not.toHaveBeenCalled();second.emit({operation:'generate-status',id:r.id,sessionId:r.sessionId,status});expect(onStatus).toHaveBeenCalledOnce();second.emit({operation:'generate',id:r.id,sessionId:r.sessionId,output});await next;second.emit({operation:'generate-status',id:r.id,sessionId:r.sessionId,status});expect(onStatus).toHaveBeenCalledOnce();g.dispose();
 });
 it('cleans status callbacks on a real worker error and preserves the old three-argument generate API',async()=>{
  const g=setup(),progress=vi.fn(),pending=g.generate(scene(),ctx,progress),rejected=pending.catch(e=>e),worker=FakeWorker.instances[0],request=worker.messages[0];expect('wantsStatus' in request).toBe(false);worker.emit({operation:'generate-status',id:request.id,sessionId:request.sessionId,status});worker.onerror?.({message:'worker failed'});expect((await rejected).message).toBe('worker failed');expect(worker.terminated).toBe(true);worker.emit({operation:'generate-progress',id:request.id,sessionId:request.sessionId,output});expect(progress).not.toHaveBeenCalled();g.dispose();
 });
});

describe('Samila live capture capability',()=>{
 const liveOutput:SceneOutput={...output,samilaLive:{sessionId:'live',target:'primary',displayIndex:3,accumulationPasses:4,anchorTheta:0,parameterChanged:false,cleared:false,clock:'fixed-source-queue'}};
 it('keeps runtime context by value and transfers capability to the two-display result',async()=>{
  const g=setup(),s=createScene(definition('samila')),live={sessionId:'live',pixelDensity:2,dirtyRevision:4};
  const pending=g.generate(s,{...ctx,samilaLive:live}),w=FakeWorker.instances[0],r=w.messages[0];live.dirtyRevision=8;
  expect(r.operation==='generate'&&r.context.samilaLive).toEqual({sessionId:'live',pixelDensity:2,dirtyRevision:4});
  w.emit({operation:'generate',id:r.id,sessionId:r.sessionId,output:liveOutput});await pending;
  await expect(g.captureSamilaPaused({...liveOutput},{width:3,height:5})).rejects.toThrow('过期');
  const capture=g.captureSamilaPaused(liveOutput,{width:3,height:5},3),c=w.messages.at(-1)!;expect(c).toMatchObject({operation:'samila-paused-capture',sourceId:r.id,scale:3});
  const preview={...liveOutput};w.emit({operation:'samila-paused-capture',id:c.id,sessionId:c.sessionId,result:{capture:liveOutput,preview}});await capture;
  await expect(g.captureSamilaPaused(liveOutput,{width:3,height:5})).rejects.toThrow('过期');
  const next=g.captureSamilaPaused(preview,{width:3,height:5}),caught=next.catch(e=>e),n=w.messages.at(-1)!;
  w.emit({operation:'samila-paused-capture',id:n.id,sessionId:n.sessionId,error:'preflight',retainedSourceId:c.id});expect(await caught).toMatchObject({name:'SamilaPausedCaptureError',previewRetained:true});g.dispose();
 });
 it('rejects cold replay and cross-family retention evidence',async()=>{
  for(const frame of [output,liveOutput]){
   const g=setup(),pending=g.generate(createScene(definition('samila')),ctx),w=FakeWorker.instances[0],r=w.messages[0];w.emit({operation:'generate',id:r.id,sessionId:r.sessionId,output:frame});await pending;
   if(!frame.samilaLive)await expect(g.captureSamilaPaused(frame,{width:1,height:1})).rejects.toThrow('过期');
   else {const p=g.captureSamilaPaused(frame,{width:1,height:1}),caught=p.catch(e=>e),c=w.messages.at(-1)!;w.emit({operation:'perlin-paused-capture',id:c.id,sessionId:c.sessionId,error:'same text',retainedSourceId:r.id});expect(await caught).toMatchObject({name:'SamilaPausedCaptureError',previewRetained:false});}
   g.dispose();
  }
 });
});

describe('Samila independent playback capability',()=>{
 const live:SceneOutput={...output,samilaLive:{sessionId:'live',target:'primary',displayIndex:3,accumulationPasses:4,anchorTheta:0,parameterChanged:false,cleared:false,clock:'realtime-source-queue'}};
 async function ready(){
  const g=setup(),p=g.generate(createScene(definition('samila')),{...ctx,samilaLive:{sessionId:'live',pixelDensity:1,clock:{paused:false}}}),w=FakeWorker.instances[0],r=w.messages[0];
  w.emit({operation:'generate',sessionId:r.sessionId,id:r.id,output:live});await p;return{g,w,r};
 }
 it('controls the exact completed source without renewing it or generating pixels',async()=>{
  const {g,w,r}=await ready();await expect(g.setSamilaPaused({...live},true)).rejects.toThrow('已完成');
  for(const paused of [true,false,true]){
   const p=g.setSamilaPaused(live,paused),c=w.messages.at(-1)!;expect(c).toMatchObject({operation:'samila-playback',sourceId:r.id,paused});
   await expect(g.generate(createScene(definition('samila')),ctx)).rejects.toThrow('尚未完成');
   await expect(g.captureSamilaPaused(live,{width:1,height:1})).rejects.toThrow('尚未完成');
   w.emit({operation:'samila-playback',sessionId:c.sessionId,id:c.id,sourceId:r.id,paused});await p;
  }
  const capture=g.captureSamilaPaused(live,{width:1,height:1}),c=w.messages.at(-1)!;expect(c).toMatchObject({operation:'samila-paused-capture',sourceId:r.id});
  w.emit({operation:'samila-paused-capture',sessionId:c.sessionId,id:c.id,result:{capture:live,preview:{...live}}});await capture;g.dispose();
 });
 it.each(['source','paused','operation','error','send'] as const)('retires uncertain playback ownership after %s failure',async failure=>{
  const {g,w,r}=await ready();if(failure==='send')w.postMessage=()=>{throw Error('send failed');};
  const p=g.setSamilaPaused(live,true).catch(e=>e),c=w.messages.at(-1)!;
  if(failure==='error')w.emit({operation:'samila-playback',sessionId:c.sessionId,id:c.id,error:'failed',retainedSourceId:r.id});
  else if(failure==='operation')w.emit({operation:'generate',sessionId:c.sessionId,id:c.id,output:live});
  else if(failure!=='send')w.emit({operation:'samila-playback',sessionId:c.sessionId,id:c.id,sourceId:failure==='source'?999:r.id,paused:failure!=='paused'});
  expect(await p).toBeInstanceOf(Error);expect(w.terminated).toBe(true);await expect(g.setSamilaPaused(live,false)).rejects.toThrow('已完成');g.dispose();
 });
});
