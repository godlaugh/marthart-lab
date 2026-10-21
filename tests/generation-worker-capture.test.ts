import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {GenerationRequest,GenerationResponse} from '../src/engine/generationProtocol';
import type {GenerationInput,SceneDocument,SceneOutput} from '../src/types';
import {sourcePausedImageBytes} from '../src/engine/sourcePausedImage';
import {prepareSourcePausedUpscale} from '../src/engine/sourcePausedUpscale';
const owners=vi.hoisted(()=>({fractal:{capturePaused:vi.fn(),matchesCompletedPrimary:vi.fn(),setPaused:vi.fn()},map:{capturePaused:vi.fn(),matchesCompletedPrimary:vi.fn(),setPaused:vi.fn()},symmetry:{capturePaused:vi.fn(),matchesCompletedPrimary:vi.fn(),setPaused:vi.fn()},generate:vi.fn(),reset:vi.fn(),perlin:{capturePaused:vi.fn(),matchesCompletedPrimary:vi.fn()},roots:{capturePaused:vi.fn(),matchesCompletedPrimary:vi.fn()},samila:{capturePaused:vi.fn(),matchesCompletedPrimary:vi.fn(),setPaused:vi.fn()}}));
vi.mock('../src/engine/temporal',()=>({generateScene:owners.generate,TemporalGenerationSession:class{
 sourceFractal=owners.fractal;sourceMap=owners.map;sourceSymmetry=owners.symmetry;sourcePerlin=owners.perlin;rootsNative=owners.roots;sourceSamila=owners.samila;reset=owners.reset;
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
 owners.fractal.matchesCompletedPrimary.mockReturnValue(true);owners.fractal.capturePaused.mockReturnValue({capture:raster(3,5),preview:raster(32,24)});
 owners.roots.capturePaused.mockReturnValue({capture:raster(3,5),preview:raster(32,24)});
 for(const family of ['map','symmetry'] as const){owners[family].matchesCompletedPrimary.mockReturnValue(true);owners[family].capturePaused.mockReturnValue({capture:raster(4,6),preview:raster(32,24)});}
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


describe.each(['map','symmetry'] as const)('%s live Worker transport',family=>{
 const key=family==='map'?'mapLive':'symmetryLive',playback=family==='map'?'map-playback':'symmetry-playback',capture=family==='map'?'map-paused-capture':'symmetry-paused-capture';
 const liveScene={kind:family,id:'iterated'} as SceneDocument;
 const live:GenerationInput={...context,sourcePointPixelDensity:2,[key]:{sessionId:'iterated',renderFps:60,replayRevision:0,clock:{paused:false,timestampMs:1000}}};
 const start=()=>send({operation:'generate',id:1,sessionId:7,scene:liveScene,context:live});
 it('routes playback without a display and capture through the retained family owner, with renewed capability',()=>{
  start();expect(send({operation:playback,id:2,sessionId:7,sourceId:1,paused:true,timestampMs:1200})).toEqual({operation:playback,id:2,sessionId:7,sourceId:1,paused:true});
  expect(owners[family].setPaused).toHaveBeenCalledWith(true,1200);expect(owners.generate).toHaveBeenCalledOnce();
  const response=send({operation:capture,id:3,sessionId:7,sourceId:1,size:{width:3,height:5},scale:5});
  if(response.operation!==capture||!('result' in response))throw Error('capture');
  expect(owners[family].capturePaused).toHaveBeenCalledWith(liveScene,{...live,quality:'export',width:3,height:5,[key]:{...live[key],clock:{...live[key]!.clock,paused:true}}},{additionalBytes:sourcePausedImageBytes(4,6)-96+prepareSourcePausedUpscale(4,6,5).peakBytes-96});
  expect(response.result.capture).toMatchObject({width:20,height:30,sourcePausedImage:{scale:5,baseSize:[4,6]}});
  expect(owners[family==='map'?'symmetry':'map'].capturePaused).not.toHaveBeenCalled();
  expect(send({operation:playback,id:4,sessionId:7,sourceId:3,paused:false})).not.toHaveProperty('error');expect(owners.generate).toHaveBeenCalledOnce();
 });
 it.each([true,false])('retains preflight failure only from current family owner: %s',retained=>{
  start();owners[family].matchesCompletedPrimary.mockReturnValue(retained);owners[family].capturePaused.mockImplementation(()=>{throw Error('before or after mutation');});
  const response=send({operation:capture,id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
  expect(response).toHaveProperty('error');expect('retainedSourceId' in response?response.retainedSourceId:undefined).toBe(retained?1:undefined);
  expect(owners[family].matchesCompletedPrimary).toHaveBeenCalledWith(liveScene,live);
  expect(owners[family==='map'?'symmetry':'map'].matchesCompletedPrimary).not.toHaveBeenCalled();
 });
 it('rejects foreign family playback, offscreen and stale source without changing either clock',()=>{
  start();expect(send({operation:family==='map'?'symmetry-playback':'map-playback',id:2,sessionId:7,sourceId:1,paused:true})).toHaveProperty('error');
  expect(send({operation:playback,id:3,sessionId:7,sourceId:999,paused:true})).toHaveProperty('error');
  send({operation:'generate',id:4,sessionId:7,scene:liveScene,context:{...live,sourceViewport:{...live.sourceViewport!,target:'offscreen'}}});
  expect(send({operation:playback,id:5,sessionId:7,sourceId:4,paused:true})).toHaveProperty('error');
  expect(owners.map.setPaused).not.toHaveBeenCalled();expect(owners.symmetry.setPaused).not.toHaveBeenCalled();
 });
 it('rejects post-render malformed pixels without retaining the old capability',()=>{
  start();owners[family].capturePaused.mockReturnValue({capture:raster(3,5),preview:raster(32,24)});
  const response=send({operation:capture,id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
  expect(response).toHaveProperty('error');expect(response).not.toHaveProperty('retainedSourceId');expect(owners[family].matchesCompletedPrimary).not.toHaveBeenCalled();
 });
});

describe('Fractal retained live Worker capture and rejection',()=>{
 const liveScene={kind:'fractal',id:'fractal-live'} as SceneDocument;
 // Unrelated density facts deliberately remain present: Fractal uses the
 // requested physical dimensions, independently of point-scene density.
 const live:GenerationInput={...context,sourcePointPixelDensity:2,fractalViewport:{logicalWidth:32,logicalHeight:24,target:'primary'},fractalLive:{sessionId:'fractal-one',revision:0,intent:'apply',actualFrameRate:60,clock:{paused:false,timestampMs:1000}}};
 const start=()=>send({operation:'generate',id:1,sessionId:7,scene:liveScene,context:live});
 it('pauses independently, captures unenhanced pixels through its owner, transfers both frames and renews capability',()=>{
  start();const paused=send({operation:'fractal-playback',id:2,sessionId:7,sourceId:1,paused:true,timestampMs:1200});
  expect(paused).toEqual({operation:'fractal-playback',id:2,sessionId:7,sourceId:1,paused:true});expect(owners.fractal.setPaused).toHaveBeenCalledWith(true,1200);expect(owners.generate).toHaveBeenCalledOnce();
  const capture=raster(3,5),preview=raster(32,24);capture.pixels.set([0,25,190,80,250,99,7,255]);
  const originalPixels=capture.pixels,expectedPixels=originalPixels.slice();owners.fractal.capturePaused.mockReturnValue({capture,preview});
  const response=send({operation:'fractal-paused-capture',id:3,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
  if(response.operation!=='fractal-paused-capture'||!('result' in response))throw Error('capture response');
  expect(owners.fractal.capturePaused).toHaveBeenCalledWith(liveScene,{...live,quality:'export',width:3,height:5,fractalLive:{...live.fractalLive,clock:{...live.fractalLive!.clock,paused:true}}},{additionalBytes:0});
  expect(response.result.capture).toMatchObject({width:3,height:5});
  expect(response.result.capture.fractalCurrentImage).toEqual({model:'local-current-numerical-snapshot',stage:'base-before-formulas',baseSize:[3,5],scale:1});
  expect(response.result.capture.pixels).toBe(originalPixels);expect(response.result.capture.pixels).toEqual(expectedPixels);
  expect(response.result.capture.sourcePausedImage).toBeUndefined();expect(response.result.capture.rootsPausedImage).toBeUndefined();
  const transfers=worker.postMessage.mock.calls.at(-1)![1].transfer;
  expect(new Set(transfers)).toEqual(new Set([capture.pixels.buffer,preview.pixels.buffer]));expect(transfers).toHaveLength(2);
  for(const family of ['map','symmetry','perlin','samila','roots'] as const)expect(owners[family].capturePaused).not.toHaveBeenCalled();
  const resumed=send({operation:'fractal-playback',id:4,sessionId:7,sourceId:3,paused:false,timestampMs:1400});
  expect(resumed).toEqual({operation:'fractal-playback',id:4,sessionId:7,sourceId:3,paused:false});expect(owners.fractal.setPaused).toHaveBeenLastCalledWith(false,1400);expect(owners.generate).toHaveBeenCalledOnce();
 });
 it.each([3,5] as const)('transfers unchanged base pixels before formulas and final scale %s',scale=>{
  start();const capture=raster(3,5),preview=raster(32,24);capture.pixels.set([0,25,190,80,250,99,7,255]);
  const originalPixels=capture.pixels,originalBuffer=originalPixels.buffer,expectedPixels=originalPixels.slice();
  owners.fractal.capturePaused.mockReturnValue({capture,preview});
  const response=send({operation:'fractal-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale});
  if(response.operation!=='fractal-paused-capture'||!('result' in response))throw Error('capture response');
  expect(owners.fractal.capturePaused).toHaveBeenCalledWith(liveScene,{...live,quality:'export',width:3,height:5},{additionalBytes:0});
  expect(response.result.capture).toMatchObject({width:3,height:5});
  expect(response.result.capture.fractalCurrentImage).toEqual({model:'local-current-numerical-snapshot',stage:'base-before-formulas',baseSize:[3,5],scale});
  expect(response.result.capture.pixels).toBe(originalPixels);expect(response.result.capture.pixels.buffer).toBe(originalBuffer);expect(response.result.capture.pixels).toEqual(expectedPixels);
  expect(response.result.capture.sourcePausedImage).toBeUndefined();expect(response.result.capture.rootsPausedImage).toBeUndefined();
  const transfers=worker.postMessage.mock.calls.at(-1)![1].transfer;
  expect(new Set(transfers)).toEqual(new Set([originalBuffer,preview.pixels.buffer]));expect(transfers).toHaveLength(2);
  expect(owners.generate).toHaveBeenCalledOnce();
 });
 it('rejects an over-budget final scale before capturing and preserves the owner-confirmed primary',()=>{
  start();
  // The 2048² base fits the raster budget; its requested 5× final image does not.
  const response=send({operation:'fractal-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:2048,height:2048},scale:5});
  expect(response).toHaveProperty('error');expect(response).toHaveProperty('retainedSourceId',1);
  expect(owners.fractal.capturePaused).not.toHaveBeenCalled();expect(owners.fractal.matchesCompletedPrimary).toHaveBeenLastCalledWith(liveScene,live);
  const paused=send({operation:'fractal-playback',id:3,sessionId:7,sourceId:1,paused:true});
  expect(paused).toEqual({operation:'fractal-playback',id:3,sessionId:7,sourceId:1,paused:true});expect(owners.fractal.setPaused).toHaveBeenCalledWith(true,undefined);
  expect(owners.generate).toHaveBeenCalledOnce();
 });
 it.each([true,false])('retains a rejected capture only when the owner still confirms its primary: %s',retained=>{
  start();owners.fractal.capturePaused.mockImplementation(()=>{owners.fractal.matchesCompletedPrimary.mockReturnValue(retained);throw Error('capacity before mutation');});
  const response=send({operation:'fractal-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
  expect(response).toMatchObject({operation:'fractal-paused-capture',error:'capacity before mutation'});
  expect('retainedSourceId' in response?response.retainedSourceId:undefined).toBe(retained?1:undefined);
  expect(owners.fractal.matchesCompletedPrimary).toHaveBeenLastCalledWith(liveScene,live);
  const control=send({operation:'fractal-playback',id:3,sessionId:7,sourceId:1,paused:true});
  if(retained){expect(control).toEqual({operation:'fractal-playback',id:3,sessionId:7,sourceId:1,paused:true});expect(owners.fractal.setPaused).toHaveBeenCalledOnce();}
  else{expect(control).toHaveProperty('error');expect(owners.fractal.setPaused).not.toHaveBeenCalled();}
  expect(owners.generate).toHaveBeenCalledOnce();
 });
 it('does not retain the old capability after capture completed with invalid dimensions',()=>{
  start();owners.fractal.capturePaused.mockReturnValue({capture:raster(4,6),preview:raster(32,24)});
  const response=send({operation:'fractal-paused-capture',id:2,sessionId:7,sourceId:1,size:{width:3,height:5},scale:1});
  expect(response).toHaveProperty('error');expect(response).not.toHaveProperty('retainedSourceId');
  // One admission check is expected; a completed draw cannot recover an old
  // capability by asking the owner again after postprocessing fails.
  expect(owners.fractal.matchesCompletedPrimary).toHaveBeenCalledOnce();
  expect(send({operation:'fractal-playback',id:3,sessionId:7,sourceId:1,paused:true})).toHaveProperty('error');expect(owners.fractal.setPaused).not.toHaveBeenCalled();
 });
 it.each([true,false])('restores a rejected generate only from the original completed owner: %s',retained=>{
  start();const changed={...liveScene,id:liveScene.id},next:GenerationInput={...live,fractalLive:{...live.fractalLive!,revision:1,intent:'hot',configuration:changed}};
  owners.generate.mockImplementationOnce(()=>{owners.fractal.matchesCompletedPrimary.mockReturnValue(retained);throw Error('configuration or render failure');});
  const rejected=send({operation:'generate',id:2,sessionId:7,scene:changed,context:next});
  expect(rejected).toMatchObject({operation:'generate',id:2,error:'configuration or render failure'});
  expect('retainedSourceId' in rejected?rejected.retainedSourceId:undefined).toBe(retained?1:undefined);
  expect(owners.fractal.matchesCompletedPrimary).toHaveBeenLastCalledWith(liveScene,live);
  const control=send({operation:'fractal-playback',id:3,sessionId:7,sourceId:1,paused:true,timestampMs:1200});
  if(retained){expect(control).toEqual({operation:'fractal-playback',id:3,sessionId:7,sourceId:1,paused:true});expect(owners.fractal.setPaused).toHaveBeenCalledWith(true,1200);}
  else{expect(control).toHaveProperty('error');expect(owners.fractal.setPaused).not.toHaveBeenCalled();}
  expect(owners.generate).toHaveBeenCalledTimes(2);
 });
});
