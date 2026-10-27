import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {GenerationRequest,GenerationResponse} from '../src/engine/generationProtocol';
import type {GenerationInput,SceneDocument,SceneOutput} from '../src/types';
import {sourcePausedImageBytes} from '../src/engine/sourcePausedImage';
import {prepareSourcePausedUpscale} from '../src/engine/sourcePausedUpscale';
const owners=vi.hoisted(()=>({fractal:{capturePaused:vi.fn(),matchesCompletedPrimary:vi.fn(),setPaused:vi.fn()},map:{capturePaused:vi.fn(),matchesCompletedPrimary:vi.fn(),setPaused:vi.fn()},symmetry:{capturePaused:vi.fn(),matchesCompletedPrimary:vi.fn(),setPaused:vi.fn()},generate:vi.fn(),reset:vi.fn(),perlin:{capturePaused:vi.fn(),matchesCompletedPrimary:vi.fn()},roots:{capturePaused:vi.fn(),matchesCompletedPrimary:vi.fn(),completedHasFormulas:vi.fn()},samila:{capturePaused:vi.fn(),matchesCompletedPrimary:vi.fn(),setPaused:vi.fn()}}));
vi.mock('../src/engine/temporal',()=>({generateScene:owners.generate,generateSceneAsync:async(...args:unknown[])=>owners.generate(...args),TemporalGenerationSession:class{
 sourceFractal=owners.fractal;sourceMap=owners.map;sourceSymmetry=owners.symmetry;sourcePerlin=owners.perlin;rootsNative=owners.roots;sourceSamila=owners.samila;reset=owners.reset;
}}));
vi.mock('../src/scenes',()=>({definition:()=>({dimension:2})}));
const raster=(width:number,height:number):Extract<SceneOutput,{type:'raster'}>=>({type:'raster',width,height,pixels:new Uint8ClampedArray(width*height*4).fill(127),stats:{samples:1,generated:width*height,invalid:0,elapsedMs:0}});
let worker:{onmessage?:(event:MessageEvent<GenerationRequest>)=>Promise<void>;postMessage:ReturnType<typeof vi.fn>};
const context:GenerationInput={time:2,quality:'preview',width:32,height:24,sourcePerlinViewport:{width:32,height:24,pixelDensity:2},sourceViewport:{logicalWidth:32,logicalHeight:24,referenceLogicalHeight:24,target:'primary',projectionPass:'perspective'}};
// This test isolates protocol ownership. Runtime parsing/GL mutation is covered
// separately; these mocked owners do not establish real renderer behavior.
const scene={kind:'perlin',id:'source',perlinSource:{backend:'cpu'}} as SceneDocument;
async function send(request:GenerationRequest){await worker.onmessage!({data:request} as MessageEvent<GenerationRequest>);return worker.postMessage.mock.calls.at(-1)![0] as GenerationResponse;}
async function generate(input=context){return await send({operation:'generate',id:1,sessionId:7,scene,context:input});}
beforeEach(async()=>{
 vi.resetModules();vi.clearAllMocks();owners.generate.mockReturnValue(raster(32,24));
 owners.perlin.matchesCompletedPrimary.mockReturnValue(true);owners.roots.matchesCompletedPrimary.mockReturnValue(false);owners.roots.completedHasFormulas.mockReturnValue(false);
 owners.perlin.capturePaused.mockReturnValue({capture:raster(4,6),preview:raster(32,24)});
 owners.samila.matchesCompletedPrimary.mockReturnValue(true);owners.samila.capturePaused.mockReturnValue({capture:raster(4,6),preview:raster(32,24)});
 owners.fractal.matchesCompletedPrimary.mockReturnValue(true);owners.fractal.capturePaused.mockReturnValue({capture:raster(3,5),preview:raster(32,24)});
 owners.roots.capturePaused.mockReturnValue({capture:raster(3,5),preview:raster(32,24)});
 for(const family of ['map','symmetry'] as const){owners[family].matchesCompletedPrimary.mockReturnValue(true);owners[family].capturePaused.mockReturnValue({capture:raster(4,6),preview:raster(32,24)});}
 worker={postMessage:vi.fn()};vi.stubGlobal('self',worker);await import('../src/engine/generate.worker');
});
afterEach(()=>vi.unstubAllGlobals());
describe('paused capture worker ownership and routing',()=>{
 it('uses retained Perlin scene/context without replay and budgets/enhances actual density-rounded pixels',async ()=>{
  await generate();const response=await send({operation:'perlin-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:3});
  expect(response.operation).toBe('perlin-paused-capture');if(!('result' in response)||response.operation!=='perlin-paused-capture')throw Error('capture response');
  expect(owners.generate).toHaveBeenCalledTimes(1);expect(owners.roots.capturePaused).not.toHaveBeenCalled();
  const upscale=prepareSourcePausedUpscale(4,6,3);
  expect(owners.perlin.capturePaused).toHaveBeenCalledWith(scene,{...context,quality:'export',width:3,height:5,sourceViewport:{...context.sourceViewport,target:'offscreen'}},{additionalBytes:sourcePausedImageBytes(4,6)-4*6*4+upscale.peakBytes-upscale.inputBytes});
  expect(response.result.capture).toMatchObject({width:12,height:18,sourcePausedImage:{baseSize:[4,6],scale:3,resampling:'openjdk21-software-bicubic',originalRuntimeCompared:false}});
  expect(response.result.capture.rootsPausedImage).toBeUndefined();
  const transfers=worker.postMessage.mock.calls.at(-1)![1].transfer;expect(new Set(transfers).size).toBe(transfers.length);expect(transfers).toContain(response.result.capture.pixels.buffer);expect(transfers).toContain(response.result.preview.pixels.buffer);
  await send({operation:'perlin-paused-capture',id:3,sessionId:7,sourceId:2,size:{width:3,height:5},scale:1});expect(owners.perlin.capturePaused).toHaveBeenCalledTimes(2);expect(owners.generate).toHaveBeenCalledTimes(1);
 });
 it('keeps scale 1 and 5 independent from simulation updates and uses actual base dimensions',async ()=>{
  for(const scale of [1,5] as const){
   await generate();const response=await send({operation:'perlin-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale});
   if(response.operation!=='perlin-paused-capture'||!('result' in response))throw Error('capture response');
   expect(response.result.capture.width).toBe(4*scale);expect(response.result.capture.height).toBe(6*scale);expect(response.result.capture.sourcePausedImage?.baseSize).toEqual([4,6]);
  }
  expect(owners.generate).toHaveBeenCalledTimes(2);
 });
 it('preserves Roots capture dimensions, public metadata and its separate owner',async ()=>{
  await generate();const response=await send({operation:'roots-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
  expect(owners.perlin.capturePaused).not.toHaveBeenCalled();expect(owners.roots.capturePaused).toHaveBeenCalledOnce();expect(owners.roots.completedHasFormulas).toHaveBeenCalledOnce();
  if(response.operation!=='roots-paused-capture'||!('result' in response))throw Error('capture response');
  expect(response.result.capture).toMatchObject({width:3,height:5,rootsPausedImage:{baseSize:[3,5],scale:1}});expect(response.result.capture.sourcePausedImage).toBeUndefined();
 });
 it('uses actual owner confirmation for preflight/capture errors, never matching error text',async ()=>{
  for(const retained of [true,false]){
   await generate();owners.perlin.capturePaused.mockImplementation(()=>{throw new Error('capacity before mutation');});owners.perlin.matchesCompletedPrimary.mockReturnValue(retained);
   const response=await send({operation:'perlin-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
   expect(response).toMatchObject({operation:'perlin-paused-capture',error:'capacity before mutation'});
   expect('retainedSourceId' in response?response.retainedSourceId:undefined).toBe(retained?1:undefined);
   expect(owners.perlin.matchesCompletedPrimary).toHaveBeenLastCalledWith(scene,context);expect(owners.roots.matchesCompletedPrimary).not.toHaveBeenCalled();
  }
 });
 it('does not accept wrong source identity, a replaced session or an unretained result',async ()=>{
  await generate();let response=await send({operation:'perlin-paused-capture',id:2,sessionId:7,sourceId:999,size:{width:3,height:5},scale:1});
  expect(response).toHaveProperty('error');expect(response).not.toHaveProperty('retainedSourceId');expect(owners.perlin.matchesCompletedPrimary).not.toHaveBeenCalled();
  await generate();response=await send({operation:'perlin-paused-capture',id:2,sessionId:8,sourceId:1,size:{width:3,height:5},scale:1});
  expect(response).toHaveProperty('error');expect(response).not.toHaveProperty('retainedSourceId');expect(owners.perlin.capturePaused).not.toHaveBeenCalled();
 });
 it('rejects missing source density or offscreen source without inventing primary facts',async ()=>{
  for(const input of [{...context,sourcePerlinViewport:undefined},{...context,sourceViewport:{...context.sourceViewport!,target:'offscreen' as const}}]){
   await generate(input);owners.perlin.matchesCompletedPrimary.mockReturnValue(false);
   const response=await send({operation:'perlin-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
   expect(response).toHaveProperty('error');expect(response).not.toHaveProperty('retainedSourceId');
  }
  expect(owners.perlin.capturePaused).not.toHaveBeenCalled();
 });
 it('rejects invalid scale and over-budget size before rendering, retaining only owner-confirmed primary',async ()=>{
  await generate();const response=await send({operation:'perlin-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:2 as 1});
  expect(response).toMatchObject({error:expect.stringContaining('1、3 或 5'),retainedSourceId:1});
  const capacity=await send({operation:'perlin-paused-capture',id:3,sessionId:7,sourceId:1,size:{width:16384,height:16384},scale:5});
  expect(capacity).toHaveProperty('error');expect(capacity).toHaveProperty('retainedSourceId',1);expect(owners.perlin.capturePaused).not.toHaveBeenCalled();
 });
 it('invalidates old output after render succeeded but dimensions/postprocessing fail',async ()=>{
  await generate();owners.perlin.capturePaused.mockReturnValue({capture:raster(3,5),preview:raster(32,24)});
  const response=await send({operation:'perlin-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
  expect(response).toHaveProperty('error');expect(response).not.toHaveProperty('retainedSourceId');expect(owners.perlin.matchesCompletedPrimary).not.toHaveBeenCalled();
  const retry=await send({operation:'perlin-paused-capture',id:3,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});expect(retry).toHaveProperty('error');expect(owners.perlin.capturePaused).toHaveBeenCalledTimes(1);
 });
});

describe('Samila paused capture shares the owner and image postprocessing',()=>{
 const samilaScene={kind:'samila',id:'live'} as SceneDocument;
 const liveContext:GenerationInput={time:2,quality:'preview',width:32,height:24,samilaPrimaryPixelHeight:24,samilaLive:{sessionId:'one',pixelDensity:2,dirtyRevision:4}};
 async function start(){await send({operation:'generate',id:1,sessionId:7,scene:samilaScene,context:liveContext});}
 it('routes once to the live owner, uses inherited density, publishes both frames and renews capability',async ()=>{
  await start();const result=await send({operation:'samila-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:3});
  expect(result.operation).toBe('samila-paused-capture');if(result.operation!=='samila-paused-capture'||!('result' in result))throw Error('capture');
  expect(owners.generate).toHaveBeenCalledOnce();expect(owners.perlin.capturePaused).not.toHaveBeenCalled();expect(owners.roots.capturePaused).not.toHaveBeenCalled();
  expect(owners.samila.capturePaused).toHaveBeenCalledWith(samilaScene,{...liveContext,quality:'export',width:3,height:5},{additionalBytes:sourcePausedImageBytes(4,6)-4*6*4+prepareSourcePausedUpscale(4,6,3).peakBytes-4*6*4});
  expect(result.result.capture).toMatchObject({width:12,height:18,sourcePausedImage:{baseSize:[4,6],scale:3,originalRuntimeCompared:false}});
  await send({operation:'samila-paused-capture',id:3,sessionId:7,sourceId:2,size:{width:3,height:5},scale:1});expect(owners.samila.capturePaused).toHaveBeenCalledTimes(2);
 });
 it.each([true,false])('retains a rejected capture only when Samila owner confirms %s',async retained=>{
  await start();owners.samila.matchesCompletedPrimary.mockReturnValue(retained);owners.samila.capturePaused.mockImplementation(()=>{throw Error('partial or preflight');});
  const response=await send({operation:'samila-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
  expect(response).toHaveProperty('error');expect('retainedSourceId' in response?response.retainedSourceId:undefined).toBe(retained?1:undefined);
  expect(owners.samila.matchesCompletedPrimary).toHaveBeenCalledWith(samilaScene,liveContext);expect(owners.perlin.matchesCompletedPrimary).not.toHaveBeenCalled();
 });
 it('does not recover old capability after successful draws but invalid result dimensions',async ()=>{
  await start();owners.samila.capturePaused.mockReturnValue({capture:raster(3,5),preview:raster(32,24)});
  const response=await send({operation:'samila-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
  expect(response).toHaveProperty('error');expect(response).not.toHaveProperty('retainedSourceId');expect(owners.samila.matchesCompletedPrimary).not.toHaveBeenCalled();
 });
});


describe('Samila independent playback worker routing',()=>{
 it('changes only the owner clock and retains the exact source id/context for a subsequent capture',async ()=>{
  const samilaScene={kind:'samila',id:'live'} as SceneDocument;
  const live:GenerationInput={time:2,quality:'preview',width:32,height:24,samilaLive:{sessionId:'one',pixelDensity:2,clock:{paused:false}}};
  await send({operation:'generate',id:1,sessionId:7,scene:samilaScene,context:live});
  const control=await send({operation:'samila-playback',id:2,sessionId:7,sourceId:1,paused:true});
  expect(control).toEqual({operation:'samila-playback',sessionId:7,id:2,sourceId:1,paused:true});expect(owners.samila.setPaused).toHaveBeenCalledWith(true);expect(owners.generate).toHaveBeenCalledOnce();
  await send({operation:'samila-paused-capture',id:3,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
  expect(owners.samila.capturePaused.mock.calls[0][1].samilaLive.clock.paused).toBe(true);
  const resume=await send({operation:'samila-playback',id:4,sessionId:7,sourceId:3,paused:false});expect(resume).not.toHaveProperty('error');expect(owners.samila.setPaused).toHaveBeenLastCalledWith(false);expect(owners.generate).toHaveBeenCalledOnce();
 });
 it('rejects stale and non-realtime source capabilities before touching the clock',async ()=>{
  await generate();expect(await send({operation:'samila-playback',id:2,sessionId:7,sourceId:1,paused:true})).toHaveProperty('error');
  const scene={kind:'samila',id:'one'} as SceneDocument;
  await send({operation:'generate',id:3,sessionId:7,scene,context:{...context,samilaLive:{sessionId:'one',pixelDensity:1,clock:{paused:false}}}});
  expect(await send({operation:'samila-playback',id:4,sessionId:7,sourceId:1,paused:true})).toHaveProperty('error');expect(owners.samila.setPaused).not.toHaveBeenCalled();
 });
});


describe.each(['map','symmetry'] as const)('%s live Worker transport',family=>{
 const key=family==='map'?'mapLive':'symmetryLive',playback=family==='map'?'map-playback':'symmetry-playback',capture=family==='map'?'map-paused-capture':'symmetry-paused-capture';
 const liveScene={kind:family,id:'iterated'} as SceneDocument;
 const live:GenerationInput={...context,sourcePointPixelDensity:2,[key]:{sessionId:'iterated',renderFps:60,replayRevision:0,clock:{paused:false,timestampMs:1000}}};
 const start=async ()=>await send({operation:'generate',id:1,sessionId:7,scene:liveScene,context:live});
 it('routes playback without a display and capture through the retained family owner, with renewed capability',async ()=>{
  await start();expect(await send({operation:playback,id:2,sessionId:7,sourceId:1,paused:true,timestampMs:1200})).toEqual({operation:playback,id:2,sessionId:7,sourceId:1,paused:true});
  expect(owners[family].setPaused).toHaveBeenCalledWith(true,1200);expect(owners.generate).toHaveBeenCalledOnce();
  const response=await send({operation:capture,id:3,sessionId:7,sourceId:1,size:{width:3,height:5},scale:5});
  if(response.operation!==capture||!('result' in response))throw Error('capture');
  expect(owners[family].capturePaused).toHaveBeenCalledWith(liveScene,{...live,quality:'export',width:3,height:5,[key]:{...live[key],clock:{...live[key]!.clock,paused:true}}},{additionalBytes:sourcePausedImageBytes(4,6)-96+prepareSourcePausedUpscale(4,6,5).peakBytes-96});
  expect(response.result.capture).toMatchObject({width:20,height:30,sourcePausedImage:{scale:5,baseSize:[4,6]}});
  expect(owners[family==='map'?'symmetry':'map'].capturePaused).not.toHaveBeenCalled();
  expect(await send({operation:playback,id:4,sessionId:7,sourceId:3,paused:false})).not.toHaveProperty('error');expect(owners.generate).toHaveBeenCalledOnce();
 });
 it.each([true,false])('retains preflight failure only from current family owner: %s',async retained=>{
  await start();owners[family].matchesCompletedPrimary.mockReturnValue(retained);owners[family].capturePaused.mockImplementation(()=>{throw Error('before or after mutation');});
  const response=await send({operation:capture,id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
  expect(response).toHaveProperty('error');expect('retainedSourceId' in response?response.retainedSourceId:undefined).toBe(retained?1:undefined);
  expect(owners[family].matchesCompletedPrimary).toHaveBeenCalledWith(liveScene,live);
  expect(owners[family==='map'?'symmetry':'map'].matchesCompletedPrimary).not.toHaveBeenCalled();
 });
 it('rejects foreign family playback, offscreen and stale source without changing either clock',async ()=>{
  await start();expect(await send({operation:family==='map'?'symmetry-playback':'map-playback',id:2,sessionId:7,sourceId:1,paused:true})).toHaveProperty('error');
  expect(await send({operation:playback,id:3,sessionId:7,sourceId:999,paused:true})).toHaveProperty('error');
  await send({operation:'generate',id:4,sessionId:7,scene:liveScene,context:{...live,sourceViewport:{...live.sourceViewport!,target:'offscreen'}}});
  expect(await send({operation:playback,id:5,sessionId:7,sourceId:4,paused:true})).toHaveProperty('error');
  expect(owners.map.setPaused).not.toHaveBeenCalled();expect(owners.symmetry.setPaused).not.toHaveBeenCalled();
 });
 it('rejects post-render malformed pixels without retaining the old capability',async ()=>{
  await start();owners[family].capturePaused.mockReturnValue({capture:raster(3,5),preview:raster(32,24)});
  const response=await send({operation:capture,id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
  expect(response).toHaveProperty('error');expect(response).not.toHaveProperty('retainedSourceId');expect(owners[family].matchesCompletedPrimary).not.toHaveBeenCalled();
 });
});

describe('Fractal retained live Worker capture and rejection',()=>{
 const liveScene={kind:'fractal',id:'fractal-live'} as SceneDocument;
 // The completed Fractal density is independent of other families and of
 // preview raster/logical ratios, which may reflect coarse preview sampling.
 const live:GenerationInput={...context,sourcePointPixelDensity:2,fractalPixelDensity:1,fractalViewport:{logicalWidth:32,logicalHeight:24,target:'primary'},fractalLive:{sessionId:'fractal-one',revision:0,intent:'apply',actualFrameRate:60,clock:{paused:false,timestampMs:1000}}};
 const start=async ()=>await send({operation:'generate',id:1,sessionId:7,scene:liveScene,context:live});
 it('pauses independently, captures unenhanced pixels through its owner, transfers both frames and renews capability',async ()=>{
  await start();const paused=await send({operation:'fractal-playback',id:2,sessionId:7,sourceId:1,paused:true,timestampMs:1200});
  expect(paused).toEqual({operation:'fractal-playback',id:2,sessionId:7,sourceId:1,paused:true});expect(owners.fractal.setPaused).toHaveBeenCalledWith(true,1200);expect(owners.generate).toHaveBeenCalledOnce();
  const capture=raster(3,5),preview=raster(32,24);capture.pixels.set([0,25,190,80,250,99,7,255]);
  const originalPixels=capture.pixels,expectedPixels=originalPixels.slice();owners.fractal.capturePaused.mockReturnValue({capture,preview});
  const response=await send({operation:'fractal-paused-capture',id:3,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
  if(response.operation!=='fractal-paused-capture'||!('result' in response))throw Error('capture response');
  expect(owners.fractal.capturePaused).toHaveBeenCalledWith(liveScene,{...live,quality:'export',width:3,height:5,fractalLive:{...live.fractalLive,clock:{...live.fractalLive!.clock,paused:true}}},{additionalBytes:0});
  expect(response.result.capture).toMatchObject({width:3,height:5});
  expect(response.result.capture.sourceCurrentImage).toEqual({model:'local-current-numerical-snapshot',stage:'base-before-formulas',requestedSize:[3,5],logicalSize:[3,5],pixelDensity:1,baseSize:[3,5],scale:1});
  expect(response.result.capture.pixels).toBe(originalPixels);expect(response.result.capture.pixels).toEqual(expectedPixels);
  expect(response.result.capture.sourcePausedImage).toBeUndefined();expect(response.result.capture.rootsPausedImage).toBeUndefined();
  const transfers=worker.postMessage.mock.calls.at(-1)![1].transfer;
  expect(new Set(transfers)).toEqual(new Set([capture.pixels.buffer,preview.pixels.buffer]));expect(transfers).toHaveLength(2);
  for(const family of ['map','symmetry','perlin','samila','roots'] as const)expect(owners[family].capturePaused).not.toHaveBeenCalled();
  const resumed=await send({operation:'fractal-playback',id:4,sessionId:7,sourceId:3,paused:false,timestampMs:1400});
  expect(resumed).toEqual({operation:'fractal-playback',id:4,sessionId:7,sourceId:3,paused:false});expect(owners.fractal.setPaused).toHaveBeenLastCalledWith(false,1400);expect(owners.generate).toHaveBeenCalledOnce();
 });
 it.each([3,5] as const)('transfers unchanged base pixels before formulas and final scale %s',async scale=>{
  await start();const capture=raster(3,5),preview=raster(32,24);capture.pixels.set([0,25,190,80,250,99,7,255]);
  const originalPixels=capture.pixels,originalBuffer=originalPixels.buffer,expectedPixels=originalPixels.slice();
  owners.fractal.capturePaused.mockReturnValue({capture,preview});
  const response=await send({operation:'fractal-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale});
  if(response.operation!=='fractal-paused-capture'||!('result' in response))throw Error('capture response');
  expect(owners.fractal.capturePaused).toHaveBeenCalledWith(liveScene,{...live,quality:'export',width:3,height:5},{additionalBytes:0});
  expect(response.result.capture).toMatchObject({width:3,height:5});
  expect(response.result.capture.sourceCurrentImage).toEqual({model:'local-current-numerical-snapshot',stage:'base-before-formulas',requestedSize:[3,5],logicalSize:[3,5],pixelDensity:1,baseSize:[3,5],scale});
  expect(response.result.capture.pixels).toBe(originalPixels);expect(response.result.capture.pixels.buffer).toBe(originalBuffer);expect(response.result.capture.pixels).toEqual(expectedPixels);
  expect(response.result.capture.sourcePausedImage).toBeUndefined();expect(response.result.capture.rootsPausedImage).toBeUndefined();
  const transfers=worker.postMessage.mock.calls.at(-1)![1].transfer;
  expect(new Set(transfers)).toEqual(new Set([originalBuffer,preview.pixels.buffer]));expect(transfers).toHaveLength(2);
  expect(owners.generate).toHaveBeenCalledOnce();
 });
 it('rejects an over-budget final scale before capturing and preserves the owner-confirmed primary',async ()=>{
  await start();
  // The 2048² base fits the raster budget; its requested 5× final image does not.
  const response=await send({operation:'fractal-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:2048,height:2048},scale:5});
  expect(response).toHaveProperty('error');expect(response).toHaveProperty('retainedSourceId',1);
  expect(owners.fractal.capturePaused).not.toHaveBeenCalled();expect(owners.fractal.matchesCompletedPrimary).toHaveBeenLastCalledWith(liveScene,live);
  const paused=await send({operation:'fractal-playback',id:3,sessionId:7,sourceId:1,paused:true});
  expect(paused).toEqual({operation:'fractal-playback',id:3,sessionId:7,sourceId:1,paused:true});expect(owners.fractal.setPaused).toHaveBeenCalledWith(true,undefined);
  expect(owners.generate).toHaveBeenCalledOnce();
 });
 it.each([1,3,5] as const)('keeps density-rounded base pixels and distinct requested/logical facts for scale %s',async scale=>{
  const highDpi={...live,fractalPixelDensity:2};await send({operation:'generate',id:1,sessionId:7,scene:liveScene,context:highDpi});
  const capture=raster(162,122),preview=raster(32,24),pixels=capture.pixels;owners.fractal.capturePaused.mockReturnValue({capture,preview});
  const response=await send({operation:'fractal-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:161,height:121},scale});
  if(response.operation!=='fractal-paused-capture'||!('result' in response))throw Error('capture response');
  expect(owners.fractal.capturePaused).toHaveBeenCalledWith(liveScene,{...highDpi,quality:'export',width:161,height:121},{additionalBytes:0});
  expect(response.result.capture.sourceCurrentImage).toEqual({model:'local-current-numerical-snapshot',stage:'base-before-formulas',requestedSize:[161,121],logicalSize:[81,61],pixelDensity:2,baseSize:[162,122],scale});
  expect(response.result.capture.pixels).toBe(pixels);expect(response.result.capture).toMatchObject({width:162,height:122});
 });
 it.each([undefined,0,1.5,NaN])('rejects density %s before owner capture and preserves primary capability',async fractalPixelDensity=>{
  const input={...live,fractalPixelDensity};await send({operation:'generate',id:1,sessionId:7,scene:liveScene,context:input});
  const response=await send({operation:'fractal-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:161,height:121},scale:1});
  expect(response).toHaveProperty('error');expect(response).toHaveProperty('retainedSourceId',1);expect(owners.fractal.capturePaused).not.toHaveBeenCalled();
  expect(await send({operation:'fractal-playback',id:3,sessionId:7,sourceId:1,paused:true})).toMatchObject({sourceId:1,paused:true});expect(owners.fractal.setPaused).toHaveBeenCalledOnce();
 });
 it('preflights the scale against rounded base dimensions before owner mutation',async ()=>{
  await send({operation:'generate',id:1,sessionId:7,scene:liveScene,context:{...live,fractalPixelDensity:2}});
  // Requested 5461*3 fits 16384, but density-rounded 5462*3 does not.
  const response=await send({operation:'fractal-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:5461,height:1},scale:3});
  expect(response).toHaveProperty('error');expect(response).toHaveProperty('retainedSourceId',1);expect(owners.fractal.capturePaused).not.toHaveBeenCalled();
 });
 it('preserves the Fractal 128 MiB raster admission instead of inheriting the point 64 MiB limit',async ()=>{
  await start();owners.fractal.capturePaused.mockImplementation(()=>{throw Error('owner reached after size admission');});
  const response=await send({operation:'fractal-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:8192,height:2049},scale:1});
  expect(response).toHaveProperty('error','owner reached after size admission');expect(owners.fractal.capturePaused).toHaveBeenCalledOnce();expect(response).toHaveProperty('retainedSourceId',1);
 });
 it.each([true,false])('retains a rejected capture only when the owner still confirms its primary: %s',async retained=>{
  await start();owners.fractal.capturePaused.mockImplementation(()=>{owners.fractal.matchesCompletedPrimary.mockReturnValue(retained);throw Error('capacity before mutation');});
  const response=await send({operation:'fractal-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
  expect(response).toMatchObject({operation:'fractal-paused-capture',error:'capacity before mutation'});
  expect('retainedSourceId' in response?response.retainedSourceId:undefined).toBe(retained?1:undefined);
  expect(owners.fractal.matchesCompletedPrimary).toHaveBeenLastCalledWith(liveScene,live);
  const control=await send({operation:'fractal-playback',id:3,sessionId:7,sourceId:1,paused:true});
  if(retained){expect(control).toEqual({operation:'fractal-playback',id:3,sessionId:7,sourceId:1,paused:true});expect(owners.fractal.setPaused).toHaveBeenCalledOnce();}
  else{expect(control).toHaveProperty('error');expect(owners.fractal.setPaused).not.toHaveBeenCalled();}
  expect(owners.generate).toHaveBeenCalledOnce();
 });
 it('does not retain the old capability after capture completed with invalid dimensions',async ()=>{
  await start();owners.fractal.capturePaused.mockReturnValue({capture:raster(4,6),preview:raster(32,24)});
  const response=await send({operation:'fractal-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
  expect(response).toHaveProperty('error');expect(response).not.toHaveProperty('retainedSourceId');
  // One admission check is expected; a completed draw cannot recover an old
  // capability by asking the owner again after postprocessing fails.
  expect(owners.fractal.matchesCompletedPrimary).toHaveBeenCalledOnce();
  expect(await send({operation:'fractal-playback',id:3,sessionId:7,sourceId:1,paused:true})).toHaveProperty('error');expect(owners.fractal.setPaused).not.toHaveBeenCalled();
 });
 it.each([true,false])('restores a rejected generate only from the original completed owner: %s',async retained=>{
  await start();const changed={...liveScene,id:liveScene.id},next:GenerationInput={...live,fractalLive:{...live.fractalLive!,revision:1,intent:'hot',configuration:changed}};
  owners.generate.mockImplementationOnce(()=>{owners.fractal.matchesCompletedPrimary.mockReturnValue(retained);throw Error('configuration or render failure');});
  const rejected=await send({operation:'generate',id:2,sessionId:7,scene:changed,context:next});
  expect(rejected).toMatchObject({operation:'generate',id:2,error:'configuration or render failure'});
  expect('retainedSourceId' in rejected?rejected.retainedSourceId:undefined).toBe(retained?1:undefined);
  expect(owners.fractal.matchesCompletedPrimary).toHaveBeenLastCalledWith(liveScene,live);
  const control=await send({operation:'fractal-playback',id:3,sessionId:7,sourceId:1,paused:true,timestampMs:1200});
  if(retained){expect(control).toEqual({operation:'fractal-playback',id:3,sessionId:7,sourceId:1,paused:true});expect(owners.fractal.setPaused).toHaveBeenCalledWith(true,1200);}
  else{expect(control).toHaveProperty('error');expect(owners.fractal.setPaused).not.toHaveBeenCalled();}
  expect(owners.generate).toHaveBeenCalledTimes(2);
 });
});
