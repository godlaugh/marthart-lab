import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const {transport,lease}=vi.hoisted(()=>({transport:vi.fn(),lease:vi.fn()}));
vi.mock('../src/engine/sourceNativeClient',async actual=>({...await actual<typeof import('../src/engine/sourceNativeClient')>(),renderSourceNativeFrame:transport}));
vi.mock('../src/engine/sourceNativeLease',async actual=>({...await actual<typeof import('../src/engine/sourceNativeLease')>(),ensureSourceNativeLease:lease}));
import {Generator} from '../src/engine/client';
import {parseProjectFile} from '../src/engine/legacyImport';
import {encodeSourceDrawingFrame,type SourceDrawingFrame} from '../src/engine/sourceDrawingFrame';
import type {SourceNativePixels} from '../src/engine/sourceNativeClient';
import type {GenerationWorkerRequest,GenerationWorkerResponse,GenerationRequest,PerlinNativeDrawRequest,PerlinNativeDrawResponse} from '../src/engine/generationProtocol';
import type {GenerationInput,SceneOutput} from '../src/types';

// The real client and pure Perlin drawing/codec owners run. A simulated worker
// requests legal frames and normally ends with an explicit fixture error. The
// capture-budget case supplies a primary capability fixture, not GPU pixels or
// evidence of the Perlin algorithm's numerical correctness.
class WorkerPort {
 static all:WorkerPort[]=[];
 onmessage:((event:{data:GenerationWorkerResponse})=>void)|null=null;
 onerror:((event:{message:string})=>void)|null=null;
 messages:GenerationWorkerRequest[]=[];
 transfers:{operation:string;buffers:Transferable[]}[]=[];
 terminated=false;
 constructor(){WorkerPort.all.push(this);}
 postMessage(value:GenerationWorkerRequest,options?:Transferable[]|StructuredSerializeOptions){
  const transfer=Array.isArray(options)?options:options?.transfer??[];
  this.transfers.push({operation:value.operation,buffers:[...transfer]});this.messages.push(structuredClone(value,{transfer}));
 }
 terminate(){this.terminated=true;}
 emit(value:GenerationWorkerResponse){this.onmessage?.({data:value});}
 replies(){return this.messages.filter((value):value is PerlinNativeDrawResponse=>value.operation==='perlin-native-result');}
}
type NativeOptions={retainedBytes?:number;signal?:AbortSignal};
type NativeCall={frame:SourceDrawingFrame;options:NativeOptions;result:SourceNativePixels};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
type Gate={entered:ReturnType<typeof deferred<NativeCall>>;ack:ReturnType<typeof deferred<void>>};
const clients:Generator[]=[],gates:Gate[]=[],queued:Gate[]=[],calls:NativeCall[]=[];
const fixtureError='simulated worker ends generation after broker assertions';
function client(){const generator=new Generator();clients.push(generator);return generator;}
function hold(){const gate={entered:deferred<NativeCall>(),ack:deferred<void>()};gates.push(gate);queued.push(gate);return gate;}
function scene(){return parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'Broker boundary',type:'PERLIN',settings:{render_mode:'GPU',seed:123,particle_count:1},timeline:[]})).scene;}
const context=():GenerationInput=>({time:0,quality:'preview',width:4,height:3,sourcePerlinViewport:{width:4,height:3,pixelDensity:1},sourceViewport:{logicalWidth:4,logicalHeight:3,referenceLogicalHeight:3,target:'primary',projectionPass:'perspective'},perlinLive:{sessionId:'broker',clock:{paused:true,timestampMs:1000}}});
function requestFor(request:GenerationRequest,drawId=1):PerlinNativeDrawRequest{
 const s=scene();return{operation:'perlin-native-draw',id:request.id,sessionId:request.sessionId,drawId,retainedBytes:4096,
  frame:{...s.perlinSource!.gpu.uniforms,time:0,width:4,height:3,palette:new Uint32Array(256).fill(0xff124578)},channel:{size:512,pixels:new Uint32Array(512*512).fill(0xff234567)}};
}
async function started(generator=client()){
 const pending=generator.generate(scene(),context()),caught=pending.catch(error=>error);
 await vi.waitFor(()=>expect(WorkerPort.all.at(-1)?.messages.some(value=>value.operation==='generate')).toBe(true));
 const worker=WorkerPort.all.at(-1)!,request=worker.messages.find((value):value is Extract<GenerationRequest,{operation:'generate'}>=>value.operation==='generate')!;
 return{generator,worker,request,pending,caught};
}
function finish(worker:WorkerPort,request:GenerationRequest){worker.emit({operation:request.operation,id:request.id,sessionId:request.sessionId,error:fixtureError});}
async function flush(){for(let index=0;index<8;index++)await Promise.resolve();}
async function exchange(frame:SourceDrawingFrame,options:NativeOptions={}):Promise<SourceNativePixels>{
 const encoded=encodeSourceDrawingFrame(frame,options);if(!encoded.ok)throw Error(encoded.error.reason);
 const result:SourceNativePixels={width:frame.width,height:frame.height,pixels:new Uint8ClampedArray(frame.width*frame.height*4).fill(67),generation:frame.generation,sequence:frame.sequence,rendererIdentity:'d'.repeat(64),requestBytes:encoded.value.byteLength},call={frame,options,result};calls.push(call);
 const gate=queued.shift();if(gate){gate.entered.resolve(call);await gate.ack.promise;}return result;
}
beforeEach(()=>{
 WorkerPort.all.length=0;calls.length=0;queued.length=0;gates.length=0;
 transport.mockReset().mockImplementation(exchange);lease.mockReset().mockResolvedValue(undefined);
 vi.stubEnv('VITE_SOURCE_RENDERER','native');vi.stubGlobal('Worker',WorkerPort);
 vi.stubGlobal('OffscreenCanvas',class{constructor(){throw Error('unexpected GPU canvas');}});
});
afterEach(async()=>{
 queued.length=0;for(const gate of gates)gate.ack.resolve();
 for(const generator of clients.splice(0)){generator.dispose();await generator.settledNativeCleanup();}
 vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();
});

describe('Perlin native worker broker ownership',()=>{
 it('runs the real pure producer for an active request and transfers only the acknowledged RGBA result',async()=>{
  const state=await started(),draw=requestFor(state.request),gate=hold();let completed=false;void state.pending.then(()=>{completed=true;},()=>{completed=true;});
  const channelBytes=draw.channel.pixels.byteLength,paletteBytes=draw.frame.palette.byteLength;
  state.worker.emit(draw);const call=await gate.entered.promise;
  expect(lease).toHaveBeenCalled();expect(call.frame).toMatchObject({width:4,height:3,samples:0});
  expect(call.frame.drawing.textures.map(texture=>[texture.width,texture.height])).toEqual([[256,1],[512,512]]);
  expect(call.frame.drawing.commands[0].uniforms).toContainEqual(expect.objectContaining({name:'u_resolution',values:new Float32Array([4,3])}));
  expect(call.result.requestBytes).toBeGreaterThan(channelBytes);expect(state.worker.replies()).toHaveLength(0);expect(completed).toBe(false);
  gate.ack.resolve();await vi.waitFor(()=>expect(state.worker.replies()).toHaveLength(1));
  const reply=state.worker.replies()[0];expect(reply).toMatchObject({operation:'perlin-native-result',id:draw.id,sessionId:draw.sessionId,drawId:draw.drawId,result:{width:4,height:3,rendererIdentity:'d'.repeat(64)}});
  if(!('result' in reply))throw Error('expected acknowledged native pixels');expect(reply.result.pixels).toEqual(new Uint8ClampedArray(48).fill(67));
  expect(call.result.pixels.byteLength).toBe(0);const transfers=state.worker.transfers.filter(value=>value.operation==='perlin-native-result');expect(transfers).toHaveLength(1);expect(transfers[0].buffers).toHaveLength(1);
  expect(transfers[0].buffers).not.toContain(draw.channel.pixels.buffer);expect(transfers[0].buffers).not.toContain(draw.frame.palette.buffer);
  expect(draw.channel.pixels.byteLength).toBe(channelBytes);expect(draw.frame.palette.byteLength).toBe(paletteBytes);expect(completed).toBe(false);
  finish(state.worker,state.request);expect(await state.caught).toMatchObject({message:fixtureError});
 });

 it.each(['active','acknowledged'] as const)('does not submit HTTP work for foreign ids or a repeated %s draw',async phase=>{
  const state=await started(),draw=requestFor(state.request);
  state.worker.emit({...draw,id:draw.id+10});state.worker.emit({...draw,sessionId:draw.sessionId+10});await flush();expect(transport).not.toHaveBeenCalled();
  const gate=hold();state.worker.emit(draw);await gate.entered.promise;
  if(phase==='acknowledged'){gate.ack.resolve();await vi.waitFor(()=>expect(state.worker.replies()).toHaveLength(1));}
  state.worker.emit(draw);expect(await state.caught).toMatchObject({message:expect.stringContaining('身份')});expect(transport).toHaveBeenCalledTimes(1);
  if(phase==='active'){expect(state.worker.terminated).toBe(false);gate.ack.resolve();}
  await state.generator.settledNativeCleanup();expect(state.worker.terminated).toBe(true);expect(state.worker.replies()).toHaveLength(phase==='active'?0:1);
  state.worker.emit(draw);await flush();expect(transport).toHaveBeenCalledTimes(1);
 });

 it('requires a rendering operation instead of granting native work to any matching pending id',async()=>{
  const generator=client(),pending=generator.planPerlinFreshRecording(scene(),4,4),caught=pending.catch(error=>error),worker=WorkerPort.all.at(-1)!,request=worker.messages.at(-1)!;
  if(request.operation!=='perlin-recording-plan')throw Error('expected the real planning request');
  worker.emit(requestFor(request));await flush();expect(transport).not.toHaveBeenCalled();expect(lease).not.toHaveBeenCalled();
  finish(worker,request);expect(await caught).toBeInstanceOf(Error);
 });

 it.each([undefined,NaN,-1])('rejects retainedBytes=%s without native transport',async retainedBytes=>{
  const state=await started(),{retainedBytes:_,...base}=requestFor(state.request),request=retainedBytes===undefined?base:{...base,retainedBytes};
  state.worker.emit(request as PerlinNativeDrawRequest);expect(await state.caught).toBeInstanceOf(Error);
  expect(transport).not.toHaveBeenCalled();expect(lease).not.toHaveBeenCalled();expect(state.worker.terminated).toBe(true);
 });

 it('adds the main-thread primary pixels to the worker hint during public paused capture',async()=>{
  const state=await started(),input=context();
  const primary:Extract<SceneOutput,{type:'raster'}>={type:'raster',width:4,height:3,pixels:new Uint8ClampedArray(48),stats:{samples:12,generated:12,invalid:0,elapsedMs:0},
   sourcePerlinFrame:{sourceViewport:input.sourcePerlinViewport!,samples:0,frameIndex:0,updates:0,queueComplete:false,queueIndex:0,sceneTime:0},
   perlinLive:{sessionId:input.perlinLive!.sessionId,paused:true,clockSource:'injected',renderKind:'snapshot',sceneTime:0,constructions:1,
    frame:{time:0,sceneTime:0,frameIndex:0,queueIndex:0,queueComplete:false,rawDt:0,activeDt:0,rates:[0,0,0],diagnostics:[],camera:{phi:0,theta:0,gamma:0,center:[0,0,0],zoom:1,focalDistance:20}}}};
  state.worker.emit({operation:'generate',id:state.request.id,sessionId:state.request.sessionId,output:primary});await state.pending;
  const capture=state.generator.capturePerlinPaused(primary,{width:4,height:3}),caught=capture.catch(error=>error);
  await vi.waitFor(()=>expect(state.worker.messages.some(value=>value.operation==='perlin-paused-capture')).toBe(true));
  const request=state.worker.messages.find(value=>value.operation==='perlin-paused-capture');if(!request||request.operation!=='perlin-paused-capture')throw Error('expected public paused capture request');
  const draw=requestFor(request),gate=hold();state.worker.emit(draw);const call=await gate.entered.promise;
  expect(call.options.retainedBytes).toBe(draw.retainedBytes+primary.pixels.byteLength);expect(primary.pixels.byteLength).toBe(48);
  gate.ack.resolve();await vi.waitFor(()=>expect(state.worker.replies()).toHaveLength(1));finish(state.worker,request);expect(await caught).toMatchObject({message:fixtureError});
 });

 it('returns a failed native request to its exact worker without inventing a successful generation',async()=>{
  const state=await started(),draw=requestFor(state.request),gate=hold();state.worker.emit(draw);await gate.entered.promise;
  gate.ack.reject(Error('native transport unavailable'));await vi.waitFor(()=>expect(state.worker.replies()).toHaveLength(1));
  expect(state.worker.replies()[0]).toMatchObject({id:draw.id,sessionId:draw.sessionId,drawId:draw.drawId,error:'native transport unavailable'});
  expect(state.worker.transfers.filter(value=>value.operation==='perlin-native-result')[0].buffers).toHaveLength(0);
  finish(state.worker,state.request);expect(await state.caught).toMatchObject({message:fixtureError});
 });

 it.each(['cancel','dispose'] as const)('waits for submitted HTTP ACK before %s terminates the old worker and never sends its result to a replacement',async action=>{
  const state=await started(),draw=requestFor(state.request),gate=hold();state.worker.emit(draw);const call=await gate.entered.promise;
  state.generator[action]();expect(await state.caught).toMatchObject({name:'AbortError'});expect(state.worker.terminated).toBe(false);expect(call.options.signal?.aborted).not.toBe(true);
  let cleaned=false;const cleanup=state.generator.settledNativeCleanup().then(()=>{cleaned=true;});await flush();expect(cleaned).toBe(false);
  const nextGenerator=action==='cancel'?state.generator:client(),nextPending=nextGenerator.generate(scene(),context()),nextCaught=nextPending.catch(error=>error);
  if(action==='cancel'){
   await flush();expect(WorkerPort.all).toHaveLength(1);expect(transport).toHaveBeenCalledTimes(1);expect(state.worker.terminated).toBe(false);
  }
  gate.ack.resolve();await cleanup;expect(state.worker.terminated).toBe(true);expect(state.worker.replies()).toHaveLength(0);
  await vi.waitFor(()=>expect(WorkerPort.all.length).toBe(2));const nextWorker=WorkerPort.all[1];
  const nextRequest=nextWorker.messages.find((value):value is Extract<GenerationRequest,{operation:'generate'}>=>value.operation==='generate')!;expect(nextRequest).toBeDefined();
  state.worker.emit(draw);await flush();
  expect(transport).toHaveBeenCalledTimes(1);expect(nextWorker.replies()).toHaveLength(0);nextWorker.emit(requestFor(nextRequest));
  await vi.waitFor(()=>expect(nextWorker.replies()).toHaveLength(1));expect(transport).toHaveBeenCalledTimes(2);expect(state.worker.replies()).toHaveLength(0);
  finish(nextWorker,nextRequest);expect(await nextCaught).toMatchObject({message:fixtureError});
 });
});
