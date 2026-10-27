import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {GenerationInput,SceneDocument,SceneOutput} from '../src/types';
import type {GenerationRequest,GenerationResponse,GenerationWorkerRequest,GenerationWorkerResponse} from '../src/engine/generationProtocol';
import type {RootsNativeCommandRequest,RootsNativeCommandResponse,RootsPointBrokerResult} from '../src/engine/rootsPointCloudBrokerProtocol';
import type {RootsNativePresentationSession} from '../src/engine/rootsNativePresentationSession';
// GPU replacement only. The Worker dispatcher, async effects/session, exact
// source math, clock and owned transfer buffers below are production modules.
vi.mock('../src/engine/rootsNativeDensityGpu',async load=>{
 const real=await load<typeof import('../src/engine/rootsNativeDensityGpu')>();
 class Device{width=0;height=0;initialize(w:number,h:number){this.width=w;this.height=h;}clear(){}flush(){}add(){}presentPixels(){return new Uint8ClampedArray(this.width*this.height*4);}readback(){return new Float32Array(this.width*this.height*4);}diagnostics(){return{retainedBytes:0,submittedPoints:0,lastKernel:'points',handles:0};}dispose(){}}
 return{...real,RootsNativeDensityGpu:Device};
});
class IdleWorker {static instances:IdleWorker[]=[];onmessage=null;onerror=null;onmessageerror=null;terminated=false;constructor(){IdleWorker.instances.push(this);}postMessage(){}terminate(){this.terminated=true;}}
type WorkerSelf={onmessage?:(event:MessageEvent<GenerationWorkerRequest>)=>Promise<void>;postMessage:(value:GenerationWorkerResponse,options?:{transfer:Transferable[]})=>void};
type Target={width:number;height:number;displayIndex:number;totalPoints:number;receivedPoints:number;totalChunks:number;nextChunk:number;fadeDraws:number;clears:number};
let worker:WorkerSelf,received:GenerationWorkerResponse[],commands:RootsNativeCommandRequest[],targets:Map<string,Target>;
let transfers:{kind:string;before:number[];after:number[]}[],held:RootsNativeCommandRequest[],hold:string|undefined,fail:string|undefined,detachFinish:boolean;
let actualOwner:RootsNativePresentationSession|undefined,makeScene:()=>SceneDocument,makeOther:()=>SceneDocument;
const context:GenerationInput={time:0,width:17,height:13,quality:'preview',rootsPixelDensity:1,rootsSessionId:'roots-test',rootsViewport:{logicalWidth:17,logicalHeight:13,referenceLogicalHeight:13,target:'primary'}};
const flush=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
function coverage(t:Target){return{displayIndex:t.displayIndex,totalPoints:t.totalPoints,receivedPoints:t.receivedPoints,totalChunks:t.totalChunks,nextChunk:t.nextChunk,pointDraws:t.nextChunk,fadeDraws:t.fadeDraws,clears:t.clears};}
async function reply(request:RootsNativeCommandRequest,override?:Partial<RootsNativeCommandResponse>){
 const c=request.command;let result:RootsPointBrokerResult;
 if(fail===c.kind){fail=undefined;return worker.onmessage!({data:{operation:'roots-native-result',id:request.id,sessionId:request.sessionId,rpcId:request.rpcId,displayId:request.displayId,error:{kind:'capacity',reason:'bounded page rejection',cleanupPending:false},...override}} as MessageEvent<GenerationWorkerRequest>);}
 if(c.kind==='initialize'){targets.set(c.target,{...c.size,displayIndex:0,totalPoints:0,receivedPoints:0,totalChunks:0,nextChunk:0,fadeDraws:0,clears:0});result={kind:'initialize',...c.size,pointSizeRange:[1,64]};}
 else if(c.kind==='release'){if(c.target)targets.delete(c.target);else targets.clear();result={kind:'release'};}
 else{
  const t=targets.get(c.target)!;if(!t)throw Error('unowned fake page target');
  if(c.kind==='begin'){t.totalPoints=c.rangeCounts.reduce((a,b)=>a+b,0);t.totalChunks=c.rangeCounts.reduce((a,b)=>a+Math.ceil(b/c.chunkPoints),0);t.receivedPoints=0;t.nextChunk=0;t.fadeDraws=Number(!!c.metadata.fade);t.clears=Number(!!c.metadata.clear);result={kind:'begin',...coverage(t)};}
  else if(c.kind==='append'){expect(c.ordinal).toBe(t.nextChunk);t.nextChunk++;t.receivedPoints+=c.points.length/4;result={kind:'append',...coverage(t)};}
  else{expect(t.nextChunk).toBe(t.totalChunks);expect(t.receivedPoints).toBe(t.totalPoints);t.displayIndex++;const pixels=new Uint8ClampedArray(t.width*t.height*4);pixels[0]=t.displayIndex;pixels[3]=81;result={kind:'finish',...coverage(t),width:t.width,height:t.height,pixels,generation:request.sessionId,sequence:request.rpcId,rendererIdentity:'b'.repeat(64),requestBytes:120};}
 }
 const response:RootsNativeCommandResponse={operation:'roots-native-result',id:request.id,sessionId:request.sessionId,rpcId:request.rpcId,displayId:request.displayId,result,...override} as RootsNativeCommandResponse;
 const cloned=structuredClone(response,{transfer:result.kind==='finish'?[result.pixels.buffer]:[]});await worker.onmessage!({data:cloned} as MessageEvent<GenerationWorkerRequest>);
}
async function send(request:GenerationRequest){await worker.onmessage!({data:structuredClone(request)} as MessageEvent<GenerationWorkerRequest>);const response=[...received].reverse().find(v=>v.id===request.id&&v.operation===request.operation);if(!response)throw Error('missing Worker completion '+request.operation);return response as GenerationResponse;}
function result<O extends GenerationResponse['operation']>(response:GenerationResponse,operation:O):Extract<GenerationResponse,{operation:O}>{if(response.operation!==operation||'error'in response)throw Error('unexpected Worker response '+JSON.stringify(response));return response as Extract<GenerationResponse,{operation:O}>;}
function raster(output:SceneOutput){if(output.type!=='raster')throw Error('expected raster');return output;}
beforeEach(async()=>{
 vi.resetModules();vi.stubEnv('VITE_SOURCE_RENDERER','native');IdleWorker.instances=[];vi.stubGlobal('Worker',IdleWorker);vi.stubGlobal('OffscreenCanvas',class{constructor(){throw Error('Unexpected real GL');}});
 received=[];commands=[];targets=new Map();transfers=[];held=[];hold=fail=undefined;detachFinish=false;actualOwner=undefined;
 worker={postMessage(value,options){
  const buffers=(options?.transfer??[]) as ArrayBuffer[],before=buffers.map(b=>b.byteLength),cloned=structuredClone(value,{transfer:options?.transfer??[]});
  received.push(cloned);if(buffers.length)transfers.push({kind:value.operation==='roots-native-command'?value.command.kind:value.operation,before,after:buffers.map(b=>b.byteLength)});
  if(cloned.operation==='roots-native-command'){commands.push(cloned);if(cloned.command.kind===hold)held.push(cloned);else void Promise.resolve().then(()=>reply(cloned));}
  if(detachFinish&&value.operation==='source-recording-finish'&&!('error'in value)){detachFinish=false;throw Error('finish publication failed after transfer');}
 }};vi.stubGlobal('self',worker);
 const {createScene}=await import('../src/engine/document'),{definition}=await import('../src/scenes'),{createRootsNativeMath}=await import('../src/engine/rootsMathConfig'),{defaultRootsPresentationConfiguration}=await import('../src/engine/rootsPresentationConfig');
 makeScene=()=>{const s=createScene(definition('roots'));s.rootsMath=createRootsNativeMath();s.rootsMath.polynomial={variable:'x',coefficients:[{exponent:'1',expression:'1'},{exponent:'0',expression:'-t2'}]};s.rootsMath.parameters=[{name:'t2',domain:'FIXED',minRe:0,maxRe:1,minIm:0,maxIm:1,value:[.25,.5]}];s.rootsMath.sampling={sampleCount:9,batchSize:2,workerCount:1,seed:'0',filter:''};s.rootsPresentation={...defaultRootsPresentationConfiguration(),mode:'point-cloud'};Object.assign(s.settings,{rootsMode:'progressive',rootDensityColorVersion:'mathart-1.7.8-metric-v1',rootSamplesPerFrame:3,rootSamplingFps:4,rootStartTime:0,rootColor:'t2_real'});s.timeline={...s.timeline,schedule:'roots-scene-sequence-v1',fps:4,duration:2,tracks:[]};return s;};
 makeOther=()=>createScene(definition('surface'));
 await import('../src/engine/generate.worker');
});
afterEach(async()=>{
 hold=fail=undefined;for(const request of held.splice(0))await reply(request);
 if(actualOwner||targets.size)await send({operation:'generate',id:900,sessionId:7,scene:makeOther(),context:{time:0,width:8,height:8,quality:'preview'}});
 expect(targets.size).toBe(0);expect(IdleWorker.instances.every(w=>w.terminated)).toBe(true);vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();
});

describe('actual Roots Worker duplex and async owner integration (CPU page/GL substitute)',()=>{
 it('uses one real owner, transfers only independent raw chunks, snapshots captures and awaits family cleanup',async()=>{
  const {RootsNativePresentationSession}=await import('../src/engine/rootsNativePresentationSession');const generate=vi.spyOn(RootsNativePresentationSession.prototype,'generateAsync'),capture=vi.spyOn(RootsNativePresentationSession.prototype,'capturePausedAsync');
  const scene=makeScene(),first=result(await send({operation:'generate',id:1,sessionId:7,scene,context}),'generate');actualOwner=generate.mock.contexts[0] as RootsNativePresentationSession;expect(actualOwner).toBeInstanceOf(RootsNativePresentationSession);
  expect(raster(first.output)).toMatchObject({backend:'native',rootsPresentation:{pointCloud:{totalWrites:'3'}},sourcePixelRenderer:{identity:'b'.repeat(64),generation:7}});
  expect(commands.map(c=>c.command.kind)).toEqual(['initialize','begin','append','finish']);const append=commands[2].command;if(append.kind!=='append')throw Error('append');expect(Array.from(append.points)).toEqual([.25,.5,.5,.25,.25,.5,.5,.25,.25,.5,.5,.25]);
  expect(transfers.find(t=>t.kind==='append')).toEqual({kind:'append',before:[48],after:[0]});expect(transfers.find(t=>t.kind==='generate')?.after).toEqual([0]);
  const pair=await send({operation:'roots-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:19,height:11},scale:1});if(pair.operation!=='roots-paused-capture'||!('result'in pair))throw Error('capture failed');
  expect(capture.mock.contexts[0]).toBe(actualOwner);expect(pair.result.capture.rootsPresentation?.pointCloud?.totalWrites).toBe('3');expect(pair.result.preview.rootsPresentation?.target).toBe('primary');expect(targets.size).toBe(2);
  const before=commands.length;hold='release';const changing=send({operation:'generate',id:3,sessionId:7,scene:makeOther(),context:{time:0,width:8,height:8,quality:'preview'}});await flush();expect(held).toHaveLength(1);expect(received.some(v=>v.operation==='generate'&&v.id===3)).toBe(false);
  hold=undefined;await reply(held.shift()!);const other=await changing;expect(other).toHaveProperty('output');expect(commands.slice(before).map(c=>c.command.kind)).toEqual(['release','release']);expect(targets.size).toBe(0);
 });
 it('ignores wrong id/session/display/rpc ACKs without advancing and rejects overlapping tasks',async()=>{
  const scene=makeScene();hold='initialize';const pending=send({operation:'generate',id:1,sessionId:7,scene,context});await flush();const request=held[0];expect(commands).toHaveLength(1);
  for(const override of [{id:2},{sessionId:8},{displayId:1},{rpcId:99}])await worker.onmessage!(new MessageEvent<GenerationWorkerRequest>('message',{data:{operation:'roots-native-result',id:request.id,sessionId:request.sessionId,rpcId:request.rpcId,displayId:request.displayId,result:{kind:'initialize',width:17,height:13,pointSizeRange:[1,64]},...override}}));
  expect(commands).toHaveLength(1);expect(await send({operation:'generate',id:2,sessionId:7,scene,context})).toMatchObject({error:expect.stringContaining('尚未结束')});
  hold=undefined;await reply(held.shift()!);expect(await pending).toHaveProperty('output');expect(commands.map(c=>c.command.kind)).toEqual(['initialize','begin','append','finish']);
 });
 it('preserves typed page failure, releases its target and never falls back to WebGL',async()=>{
  const {RootsNativePresentationSession}=await import('../src/engine/rootsNativePresentationSession');const generate=vi.spyOn(RootsNativePresentationSession.prototype,'generateAsync');fail='append';
  const response=await send({operation:'generate',id:1,sessionId:7,scene:makeScene(),context});actualOwner=generate.mock.contexts[0] as RootsNativePresentationSession;expect(response).toMatchObject({error:'bounded page rejection'});
  const failure=await generate.mock.results[0].value.catch((e:unknown)=>e);expect(failure).toMatchObject({name:'SourceNativeError',kind:'capacity',reason:'bounded page rejection',cleanupPending:false});
  expect(commands.map(c=>c.command.kind)).toEqual(['initialize','begin','append','release']);expect(targets.size).toBe(0);expect(response).not.toHaveProperty('output');
 });
 it('keeps staged density authoring on the same native point owner, then applies density through that owner',async()=>{
  const {RootsNativePresentationSession}=await import('../src/engine/rootsNativePresentationSession'),{defaultRootsPendingConfiguration}=await import('../src/engine/rootsPresentationConfig');const generate=vi.spyOn(RootsNativePresentationSession.prototype,'generateAsync');
  const scene=makeScene();scene.rootsPresentation!.pending=defaultRootsPendingConfiguration();const live={sessionId:'controlled',maximumWorkers:1,clock:{paused:true,timestampMs:1000}};
  const c={...context,rootsLive:{...live,controls:{acknowledgedRevision:0,commands:[{kind:'apply' as const,revision:1,scene:structuredClone(scene)}]}}};
  const first=result(await send({operation:'generate',id:1,sessionId:7,scene,context:c}),'generate');actualOwner=generate.mock.contexts[0] as RootsNativePresentationSession;const instance=raster(first.output).rootsPresentation!.instance;
  scene.rootsPresentation!.mode='density';const staged={...context,rootsLive:{...live,controls:{acknowledgedRevision:1,commands:[]}}};
  const second=result(await send({operation:'generate',id:2,sessionId:7,scene,context:staged}),'generate');expect(generate.mock.contexts[1]).toBe(actualOwner);expect(raster(second.output)).toMatchObject({backend:'native',rootsPresentation:{mode:'point-cloud',instance}});expect(IdleWorker.instances).toHaveLength(1);
  const applied={...context,rootsLive:{...live,controls:{acknowledgedRevision:1,commands:[{kind:'apply' as const,revision:2,scene}]}}};
  const third=result(await send({operation:'generate',id:3,sessionId:7,scene,context:applied}),'generate');expect(generate.mock.contexts[2]).toBe(actualOwner);expect(raster(third.output)).toMatchObject({backend:'webgl2',rootsPresentation:{mode:'density',instance:instance+1}});expect(targets.size).toBe(0);
 });
 it('uses async retained recording and republishes a detached finish snapshot without another clock step',async()=>{
  const {RootsNativePresentationSession}=await import('../src/engine/rootsNativePresentationSession'),{defaultRootsPendingConfiguration}=await import('../src/engine/rootsPresentationConfig');const generate=vi.spyOn(RootsNativePresentationSession.prototype,'generateAsync'),begin=vi.spyOn(RootsNativePresentationSession.prototype,'beginRecordingAsync'),next=vi.spyOn(RootsNativePresentationSession.prototype,'nextRecordingFrameAsync'),finish=vi.spyOn(RootsNativePresentationSession.prototype,'finishRecordingAsync');
  const scene=makeScene();scene.rootsPresentation!.pending=defaultRootsPendingConfiguration();scene.timeline.tracks=[{id:'wait',label:'wait',type:'animate',target:'timeline.animate',enabled:true,start:0,duration:1,from:0,to:0,pingPong:false,easing:'linear',actions:[]}];
  const live={...context,rootsLive:{sessionId:'live',maximumWorkers:1,clock:{paused:true,timestampMs:1000}}};
  await send({operation:'generate',id:1,sessionId:7,scene,context:live});actualOwner=generate.mock.contexts[0] as RootsNativePresentationSession;
  const start=result(await send({operation:'source-recording-begin',id:2,sessionId:7,sourceId:1,options:{width:9,height:7,simulationFps:4}}),'source-recording-begin');
  expect(begin.mock.contexts[0]).toBe(actualOwner);expect(raster(start.result.warmup).rootsLive?.recording).toMatchObject({displayFrame:0,warmup:true});expect(start.result.context).not.toHaveProperty('isCancelled');
  const frame=result(await send({operation:'source-recording-frame',id:3,sessionId:7,recordingId:2,displayFrame:1}),'source-recording-frame');expect(next.mock.contexts[0]).toBe(actualOwner);const time=raster(frame.output).rootsLive!.sceneTime;
  detachFinish=true;const failure=await send({operation:'source-recording-finish',id:4,sessionId:7,recordingId:2});expect(failure).toMatchObject({error:'finish publication failed after transfer',retainedRecordingId:2});
  const stop=result(await send({operation:'source-recording-finish',id:5,sessionId:7,recordingId:2}),'source-recording-finish');expect(finish).toHaveBeenCalledTimes(2);expect(finish.mock.contexts.every(o=>o===actualOwner)).toBe(true);expect(stop.result.context.time).toBe(time);expect(raster(stop.result.preview).rootsLive).toMatchObject({sceneTime:time,renderKind:'snapshot',paused:false});expect(IdleWorker.instances).toHaveLength(2);
  expect(await send({operation:'roots-playback',id:6,sessionId:7,sourceId:5,paused:true,timestampMs:2000})).toMatchObject({paused:true});
 });
});
