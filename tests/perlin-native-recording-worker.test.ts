import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {GenerationInput,SceneOutput} from '../src/types';
import type {GenerationRequest,GenerationResponse,GenerationWorkerRequest,GenerationWorkerResponse} from '../src/engine/generationProtocol';
import type {SourcePerlinSession} from '../src/scenes/sourcePerlin';

const graphics=vi.hoisted(()=>({targets:[] as {width:number;height:number;draws:number;disposed:boolean}[]}));
// Only the GL target is replaced. Import, worker, async owner, CPU particles,
// timeline and recording handoff are real; this does not establish GPU parity.
vi.mock('../src/engine/sourcePerlinCpuTarget',()=>{
 class Target {
  readonly width:number;readonly height:number;readonly density:number;readonly samples:number;
  readonly physicalWidth:number;readonly physicalHeight:number;draws=0;disposed=false;
  constructor(o:{width:number;height:number;density:number;samples?:number}){this.width=o.width;this.height=o.height;this.density=o.density;this.samples=o.samples??0;this.physicalWidth=o.width*o.density;this.physicalHeight=o.height*o.density;graphics.targets.push(this);}
  static createSmoothed(o:{width:number;height:number;density:number},samples:number){return new Target({...o,samples});}
  createSibling(o:{width:number;height:number;density:number;samples?:number}){return new Target(o);}
  draw(){this.draws++;}
  drawGpu(){throw Error('CPU fixture must not draw a GPU frame');}
  drawGpuAsync(){throw Error('CPU fixture must not submit a native GPU frame');}
  readPixels(cancelled?:()=>boolean){if(cancelled?.())throw new DOMException('cancelled','AbortError');return new Uint8ClampedArray(this.physicalWidth*this.physicalHeight*4).fill(this.draws);}
  withWorkingBytes<T>(_bytes:number,run:()=>T){return run();}
  async withWorkingBytesAsync<T>(_bytes:number,run:()=>Promise<T>){return await run();}
  releaseSceneGpuBindings(){}
  diagnostics(){return{width:this.width,height:this.height,density:this.density,samples:this.samples,initialized:this.draws>0,draws:this.draws};}
  dispose(){this.disposed=true;}
 }
 return{SourcePerlinCpuTarget:Target};
});

let worker:{onmessage?:(event:MessageEvent<GenerationWorkerRequest>)=>Promise<void>;postMessage:(data:GenerationWorkerResponse,options?:{transfer:Transferable[]})=>void};
let received:GenerationWorkerResponse[],transferred:{operation:string;before:number[];after:number[]}[],owner:SourcePerlinSession|undefined;
beforeEach(()=>{
 vi.resetModules();graphics.targets.length=0;received=[];transferred=[];owner=undefined;
 vi.stubEnv('VITE_SOURCE_RENDERER','native');
 vi.stubGlobal('OffscreenCanvas',class{constructor(){throw Error('unexpected real GPU canvas');}});
 worker={postMessage(data,options){
  const buffers=(options?.transfer??[]).filter((value):value is ArrayBuffer=>value instanceof ArrayBuffer),before=buffers.map(value=>value.byteLength);
  // This is deliberately the actual browser clone/transfer boundary: a leaked
  // isCancelled, onProgress or onStatus function makes publication fail.
  received.push(structuredClone(data,{transfer:options?.transfer??[]}));
  if(buffers.length)transferred.push({operation:data.operation,before,after:buffers.map(value=>value.byteLength)});
 }};
 vi.stubGlobal('self',worker);
});
afterEach(async()=>{await owner?.resetAsync();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
async function send(request:GenerationRequest){
 await worker.onmessage!({data:structuredClone(request)} as MessageEvent<GenerationWorkerRequest>);
 const response=[...received].reverse().find(value=>value.id===request.id&&value.operation===request.operation);
 if(!response)throw Error('worker did not complete '+request.operation);
 if('error' in response)throw Error(response.error);
 return response;
}
function result<O extends GenerationResponse['operation']>(response:GenerationWorkerResponse,operation:O):Extract<GenerationResponse,{operation:O}>{
 if(response.operation!==operation||'error' in response)throw Error('unexpected worker response');return response as Extract<GenerationResponse,{operation:O}>;
}
function raster(output:SceneOutput){if(output.type!=='raster')throw Error('expected Perlin raster');return output;}

describe('native-policy Perlin recording through the production worker',()=>{
 it('clones async begin and stop contexts while transferring real CPU warmup, frame and restored preview',async()=>{
  const {SourcePerlinSession}=await import('../src/scenes/sourcePerlin');
  const generate=vi.spyOn(SourcePerlinSession.prototype,'generateAsync'),begin=vi.spyOn(SourcePerlinSession.prototype,'beginRecordingAsync'),next=vi.spyOn(SourcePerlinSession.prototype,'nextRecordingFrameAsync'),finish=vi.spyOn(SourcePerlinSession.prototype,'finishRecordingAsync');
  const {parseProjectFile}=await import('../src/engine/legacyImport');
  const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'PERLIN',name:'Authored recording',settings:{render_mode:'CPU',seed:123,particle_count:3,cpu_render_style:'PARTICLES'},timeline:[{type:'wait',duration:.5}]})).scene;
  scene.timeline.fps=4;expect(scene.perlinSource!.backend).toBe('cpu');
  const authored=structuredClone(scene),context:GenerationInput={time:0,width:8,height:6,quality:'preview',sourcePerlinViewport:{width:8,height:6,pixelDensity:1},sourceViewport:{logicalWidth:8,logicalHeight:6,referenceLogicalHeight:6,target:'primary',projectionPass:'perspective'},perlinLive:{sessionId:'native-worker-recording',clock:{paused:true,timestampMs:1000}}};
  await import('../src/engine/generate.worker');
  const initial=result(await send({operation:'generate',id:1,sessionId:7,scene,context,wantsStatus:true}),'generate');
  expect(generate).toHaveBeenCalledOnce();const actualOwner=generate.mock.contexts[0];if(!(actualOwner instanceof SourcePerlinSession))throw Error('missing real async owner');owner=actualOwner;
  expect(generate.mock.calls[0][1].onProgress).toBeTypeOf('function');expect(generate.mock.calls[0][1].onStatus).toBeTypeOf('function');
  expect(raster(initial.output)).toMatchObject({width:8,height:6,perlinLive:{paused:true,sceneTime:0,constructions:1}});
  const primary=graphics.targets[0];

  const start=result(await send({operation:'source-recording-begin',id:2,sessionId:7,sourceId:1,options:{width:4,height:4,simulationFps:4}}),'source-recording-begin');
  expect(begin).toHaveBeenCalledOnce();expect(begin.mock.contexts[0]).toBe(owner);
  expect(start.result.scene).toEqual(authored);
  expect(start.result.clock).toEqual({simulationFps:4,warmupUpdates:1,updates:2,encodedFrames:1,firstEncodedUpdate:2,lastDisplayFrame:1,completionReason:'animation-queue'});
  expect(start.result.context).toMatchObject({time:0,width:8,height:6,perlinLive:{sessionId:'native-worker-recording',clock:{paused:false}}});
  expect(raster(start.result.warmup)).toMatchObject({width:4,height:4,perlinLive:{clockSource:'fixed-step',paused:false,frame:{frameIndex:0,sceneTime:.25}}});
  expect(raster(start.result.warmup).pixels.byteLength).toBe(4*4*4);

  const frame=result(await send({operation:'source-recording-frame',id:3,sessionId:7,recordingId:start.recordingId,displayFrame:1}),'source-recording-frame');
  expect(next).toHaveBeenCalledOnce();expect(next.mock.contexts[0]).toBe(owner);
  expect(raster(frame.output)).toMatchObject({width:4,height:4,perlinLive:{clockSource:'fixed-step',frame:{frameIndex:1,sceneTime:.5,queueComplete:true}}});
  const beforeStop=structuredClone(owner.diagnosticSnapshot()),modelBefore=structuredClone(owner.diagnostics().model);
  const stopped=result(await send({operation:'source-recording-finish',id:4,sessionId:7,recordingId:start.recordingId}),'source-recording-finish');
  expect(finish).toHaveBeenCalledOnce();expect(finish.mock.contexts[0]).toBe(owner);
  expect(stopped.result.scene).toEqual(authored);
  expect(stopped.result.context).toMatchObject({time:.5,width:8,height:6,perlinLive:{sessionId:'native-worker-recording',clock:{paused:false}}});
  expect(raster(stopped.result.preview)).toMatchObject({width:8,height:6,perlinLive:{renderKind:'snapshot',clockSource:'worker-wall-clock',paused:false,sceneTime:.5,frame:{frameIndex:1}}});
  expect(raster(stopped.result.preview).pixels.byteLength).toBe(8*6*4);
  expect(owner.diagnosticSnapshot()).toEqual(beforeStop);expect(modelBefore).toBeDefined();
  expect(owner.diagnostics().model).toEqual({...modelBefore,draws:modelBefore!.draws+1});
  for(const value of [start.result.context,stopped.result.context])for(const key of ['isCancelled','onProgress','onStatus'])expect(value).not.toHaveProperty(key);
  expect(scene).toEqual(authored);expect(graphics.targets).toHaveLength(2);expect(graphics.targets[0]).toBe(primary);expect(primary.disposed).toBe(false);
  expect(received.some(value=>value.operation==='perlin-native-draw')).toBe(false);
  expect(transferred).toEqual([{operation:'generate',before:[192],after:[0]},{operation:'source-recording-begin',before:[64],after:[0]},{operation:'source-recording-frame',before:[64],after:[0]},{operation:'source-recording-finish',before:[192],after:[0]}]);
  expect(await send({operation:'perlin-playback',id:5,sessionId:7,sourceId:stopped.id,paused:true,timestampMs:2000})).toMatchObject({operation:'perlin-playback',sourceId:4,paused:true});
 });
});
