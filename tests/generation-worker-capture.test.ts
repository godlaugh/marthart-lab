import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {GenerationRequest,GenerationResponse} from '../src/engine/generationProtocol';
import type {GenerationInput,SceneDocument,SceneOutput} from '../src/types';
import {sourcePausedImageBytes} from '../src/engine/sourcePausedImage';
import {prepareSourcePausedUpscale} from '../src/engine/sourcePausedUpscale';
const owners=vi.hoisted(()=>({generate:vi.fn(),reset:vi.fn(),perlin:{capturePaused:vi.fn(),matchesCompletedPrimary:vi.fn()},roots:{capturePaused:vi.fn(),matchesCompletedPrimary:vi.fn()},samila:{capturePaused:vi.fn(),matchesCompletedPrimary:vi.fn(),setPaused:vi.fn()}}));
vi.mock('../src/engine/temporal',()=>({generateScene:owners.generate,TemporalGenerationSession:class{
 sourcePerlin=owners.perlin;rootsNative=owners.roots;sourceSamila=owners.samila;reset=owners.reset;
}}));
vi.mock('../src/scenes',()=>({definition:()=>({dimension:2})}));
const raster=(width:number,height:number):Extract<SceneOutput,{type:'raster'}>=>({type:'raster',width,height,pixels:new Uint8ClampedArray(width*height*4).fill(127),stats:{samples:1,generated:width*height,invalid:0,elapsedMs:0}});
let worker:{onmessage?:(event:MessageEvent<GenerationRequest>)=>void;postMessage:ReturnType<typeof vi.fn>};
const context:GenerationInput={time:2,quality:'preview',width:32,height:24,sourcePerlinViewport:{width:32,height:24,pixelDensity:2},sourceViewport:{logicalWidth:32,logicalHeight:24,referenceLogicalHeight:24,target:'primary',projectionPass:'perspective'}};
// This test isolates protocol ownership. Runtime parsing/GL mutation is covered
// separately; these mocked owners do not establish real renderer behavior.
const scene={kind:'perlin',id:'source',perlinSource:{backend:'cpu'}} as SceneDocument;
function send(request:GenerationRequest){worker.onmessage!({data:request} as MessageEvent<GenerationRequest>);return worker.postMessage.mock.calls.at(-1)![0] as GenerationResponse;}
function generate(input=context){return send({operation:'generate',id:1,sessionId:7,scene,context:input});}
beforeEach(async()=>{
 vi.resetModules();vi.clearAllMocks();owners.generate.mockReturnValue(raster(32,24));
 owners.perlin.matchesCompletedPrimary.mockReturnValue(true);owners.roots.matchesCompletedPrimary.mockReturnValue(false);
 owners.perlin.capturePaused.mockReturnValue({capture:raster(4,6),preview:raster(32,24)});
 owners.samila.matchesCompletedPrimary.mockReturnValue(true);owners.samila.capturePaused.mockReturnValue({capture:raster(4,6),preview:raster(32,24)});
 owners.roots.capturePaused.mockReturnValue({capture:raster(3,5),preview:raster(32,24)});
 worker={postMessage:vi.fn()};vi.stubGlobal('self',worker);await import('../src/engine/generate.worker');
});
afterEach(()=>vi.unstubAllGlobals());
describe('paused capture worker ownership and routing',()=>{
 it('uses retained Perlin scene/context without replay and budgets/enhances actual density-rounded pixels',()=>{
  generate();const response=send({operation:'perlin-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:3});
  expect(response.operation).toBe('perlin-paused-capture');if(!('result' in response)||response.operation!=='perlin-paused-capture')throw Error('capture response');
  expect(owners.generate).toHaveBeenCalledTimes(1);expect(owners.roots.capturePaused).not.toHaveBeenCalled();
  const upscale=prepareSourcePausedUpscale(4,6,3);
  expect(owners.perlin.capturePaused).toHaveBeenCalledWith(scene,{...context,quality:'export',width:3,height:5,sourceViewport:{...context.sourceViewport,target:'offscreen'}},{additionalBytes:sourcePausedImageBytes(4,6)-4*6*4+upscale.peakBytes-upscale.inputBytes});
  expect(response.result.capture).toMatchObject({width:12,height:18,sourcePausedImage:{baseSize:[4,6],scale:3,resampling:'openjdk21-software-bicubic',originalRuntimeCompared:false}});
  expect(response.result.capture.rootsPausedImage).toBeUndefined();
  const transfers=worker.postMessage.mock.calls.at(-1)![1].transfer;expect(new Set(transfers).size).toBe(transfers.length);expect(transfers).toContain(response.result.capture.pixels.buffer);expect(transfers).toContain(response.result.preview.pixels.buffer);
  send({operation:'perlin-paused-capture',id:3,sessionId:7,sourceId:2,size:{width:3,height:5},scale:1});expect(owners.perlin.capturePaused).toHaveBeenCalledTimes(2);expect(owners.generate).toHaveBeenCalledTimes(1);
 });
 it('keeps scale 1 and 5 independent from simulation updates and uses actual base dimensions',()=>{
  for(const scale of [1,5] as const){
   generate();const response=send({operation:'perlin-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale});
   if(response.operation!=='perlin-paused-capture'||!('result' in response))throw Error('capture response');
   expect(response.result.capture.width).toBe(4*scale);expect(response.result.capture.height).toBe(6*scale);expect(response.result.capture.sourcePausedImage?.baseSize).toEqual([4,6]);
  }
  expect(owners.generate).toHaveBeenCalledTimes(2);
 });
 it('preserves Roots capture dimensions, public metadata and its separate owner',()=>{
  generate();const response=send({operation:'roots-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
  expect(owners.perlin.capturePaused).not.toHaveBeenCalled();expect(owners.roots.capturePaused).toHaveBeenCalledOnce();
  if(response.operation!=='roots-paused-capture'||!('result' in response))throw Error('capture response');
  expect(response.result.capture).toMatchObject({width:3,height:5,rootsPausedImage:{baseSize:[3,5],scale:1}});expect(response.result.capture.sourcePausedImage).toBeUndefined();
 });
 it('uses actual owner confirmation for preflight/capture errors, never matching error text',()=>{
  for(const retained of [true,false]){
   generate();owners.perlin.capturePaused.mockImplementation(()=>{throw new Error('capacity before mutation');});owners.perlin.matchesCompletedPrimary.mockReturnValue(retained);
   const response=send({operation:'perlin-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
   expect(response).toMatchObject({operation:'perlin-paused-capture',error:'capacity before mutation'});
   expect('retainedSourceId' in response?response.retainedSourceId:undefined).toBe(retained?1:undefined);
   expect(owners.perlin.matchesCompletedPrimary).toHaveBeenLastCalledWith(scene,context);expect(owners.roots.matchesCompletedPrimary).not.toHaveBeenCalled();
  }
 });
 it('does not accept wrong source identity, a replaced session or an unretained result',()=>{
  generate();let response=send({operation:'perlin-paused-capture',id:2,sessionId:7,sourceId:999,size:{width:3,height:5},scale:1});
  expect(response).toHaveProperty('error');expect(response).not.toHaveProperty('retainedSourceId');expect(owners.perlin.matchesCompletedPrimary).not.toHaveBeenCalled();
  generate();response=send({operation:'perlin-paused-capture',id:2,sessionId:8,sourceId:1,size:{width:3,height:5},scale:1});
  expect(response).toHaveProperty('error');expect(response).not.toHaveProperty('retainedSourceId');expect(owners.perlin.capturePaused).not.toHaveBeenCalled();
 });
 it('rejects missing source density or offscreen source without inventing primary facts',()=>{
  for(const input of [{...context,sourcePerlinViewport:undefined},{...context,sourceViewport:{...context.sourceViewport!,target:'offscreen' as const}}]){
   generate(input);owners.perlin.matchesCompletedPrimary.mockReturnValue(false);
   const response=send({operation:'perlin-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
   expect(response).toHaveProperty('error');expect(response).not.toHaveProperty('retainedSourceId');
  }
  expect(owners.perlin.capturePaused).not.toHaveBeenCalled();
 });
 it('rejects invalid scale and over-budget size before rendering, retaining only owner-confirmed primary',()=>{
  generate();const response=send({operation:'perlin-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:2 as 1});
  expect(response).toMatchObject({error:expect.stringContaining('1、3 或 5'),retainedSourceId:1});
  const capacity=send({operation:'perlin-paused-capture',id:3,sessionId:7,sourceId:1,size:{width:16384,height:16384},scale:5});
  expect(capacity).toHaveProperty('error');expect(capacity).toHaveProperty('retainedSourceId',1);expect(owners.perlin.capturePaused).not.toHaveBeenCalled();
 });
 it('invalidates old output after render succeeded but dimensions/postprocessing fail',()=>{
  generate();owners.perlin.capturePaused.mockReturnValue({capture:raster(3,5),preview:raster(32,24)});
  const response=send({operation:'perlin-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
  expect(response).toHaveProperty('error');expect(response).not.toHaveProperty('retainedSourceId');expect(owners.perlin.matchesCompletedPrimary).not.toHaveBeenCalled();
  const retry=send({operation:'perlin-paused-capture',id:3,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});expect(retry).toHaveProperty('error');expect(owners.perlin.capturePaused).toHaveBeenCalledTimes(1);
 });
});

describe('Samila paused capture shares the owner and image postprocessing',()=>{
 const samilaScene={kind:'samila',id:'live'} as SceneDocument;
 const liveContext:GenerationInput={time:2,quality:'preview',width:32,height:24,samilaPrimaryPixelHeight:24,samilaLive:{sessionId:'one',pixelDensity:2,dirtyRevision:4}};
 function start(){send({operation:'generate',id:1,sessionId:7,scene:samilaScene,context:liveContext});}
 it('routes once to the live owner, uses inherited density, publishes both frames and renews capability',()=>{
  start();const result=send({operation:'samila-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:3});
  expect(result.operation).toBe('samila-paused-capture');if(result.operation!=='samila-paused-capture'||!('result' in result))throw Error('capture');
  expect(owners.generate).toHaveBeenCalledOnce();expect(owners.perlin.capturePaused).not.toHaveBeenCalled();expect(owners.roots.capturePaused).not.toHaveBeenCalled();
  expect(owners.samila.capturePaused).toHaveBeenCalledWith(samilaScene,{...liveContext,quality:'export',width:3,height:5},{additionalBytes:sourcePausedImageBytes(4,6)-4*6*4+prepareSourcePausedUpscale(4,6,3).peakBytes-4*6*4});
  expect(result.result.capture).toMatchObject({width:12,height:18,sourcePausedImage:{baseSize:[4,6],scale:3,originalRuntimeCompared:false}});
  send({operation:'samila-paused-capture',id:3,sessionId:7,sourceId:2,size:{width:3,height:5},scale:1});expect(owners.samila.capturePaused).toHaveBeenCalledTimes(2);
 });
 it.each([true,false])('retains a rejected capture only when Samila owner confirms %s',retained=>{
  start();owners.samila.matchesCompletedPrimary.mockReturnValue(retained);owners.samila.capturePaused.mockImplementation(()=>{throw Error('partial or preflight');});
  const response=send({operation:'samila-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
  expect(response).toHaveProperty('error');expect('retainedSourceId' in response?response.retainedSourceId:undefined).toBe(retained?1:undefined);
  expect(owners.samila.matchesCompletedPrimary).toHaveBeenCalledWith(samilaScene,liveContext);expect(owners.perlin.matchesCompletedPrimary).not.toHaveBeenCalled();
 });
 it('does not recover old capability after successful draws but invalid result dimensions',()=>{
  start();owners.samila.capturePaused.mockReturnValue({capture:raster(3,5),preview:raster(32,24)});
  const response=send({operation:'samila-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
  expect(response).toHaveProperty('error');expect(response).not.toHaveProperty('retainedSourceId');expect(owners.samila.matchesCompletedPrimary).not.toHaveBeenCalled();
 });
});


describe('Samila independent playback worker routing',()=>{
 it('changes only the owner clock and retains the exact source id/context for a subsequent capture',()=>{
  const samilaScene={kind:'samila',id:'live'} as SceneDocument;
  const live:GenerationInput={time:2,quality:'preview',width:32,height:24,samilaLive:{sessionId:'one',pixelDensity:2,clock:{paused:false}}};
  send({operation:'generate',id:1,sessionId:7,scene:samilaScene,context:live});
  const control=send({operation:'samila-playback',id:2,sessionId:7,sourceId:1,paused:true});
  expect(control).toEqual({operation:'samila-playback',sessionId:7,id:2,sourceId:1,paused:true});expect(owners.samila.setPaused).toHaveBeenCalledWith(true);expect(owners.generate).toHaveBeenCalledOnce();
  send({operation:'samila-paused-capture',id:3,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
  expect(owners.samila.capturePaused.mock.calls[0][1].samilaLive.clock.paused).toBe(true);
  const resume=send({operation:'samila-playback',id:4,sessionId:7,sourceId:3,paused:false});expect(resume).not.toHaveProperty('error');expect(owners.samila.setPaused).toHaveBeenLastCalledWith(false);expect(owners.generate).toHaveBeenCalledOnce();
 });
 it('rejects stale and non-realtime source capabilities before touching the clock',()=>{
  generate();expect(send({operation:'samila-playback',id:2,sessionId:7,sourceId:1,paused:true})).toHaveProperty('error');
  const scene={kind:'samila',id:'one'} as SceneDocument;
  send({operation:'generate',id:3,sessionId:7,scene,context:{...context,samilaLive:{sessionId:'one',pixelDensity:1,clock:{paused:false}}}});
  expect(send({operation:'samila-playback',id:4,sessionId:7,sourceId:1,paused:true})).toHaveProperty('error');expect(owners.samila.setPaused).not.toHaveBeenCalled();
 });
});
