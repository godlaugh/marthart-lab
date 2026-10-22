import {generateScene,TemporalGenerationSession} from '../src/engine/temporal';
import type {GenerateContext} from '../src/types';
import {describe,it,expect} from 'vitest';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {sourceLivePreviewKind} from '../src/engine/sourceLivePreview';
import {sourceQueuePresentedScene} from '../src/engine/sourceQueuePresentation';
import {ordinarySourceCameraInitial,ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {SOURCE_CAMERA_MODEL} from '../src/engine/sourceCamera';
import {timelineWarnings} from '../src/engine/timeline';
import type {SceneOutput} from '../src/types';
const scene=()=>parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:'Live preview',parameters:{lambda:.25},settings:{batch_size:4,burn_in_steps:3},timeline:[]})).scene;
describe('source live preview compatibility and delivered presentation',()=>{
 it('opts complete source documents in without migrating older parameter or gradient models',()=>{
  const source=scene();expect(sourceLivePreviewKind(source)).toBe('symmetry');
  for(const key of ['symmetryParameterModel','symmetryGradientModel','symmetryPresentationModel']){
   const legacy=structuredClone(source);delete legacy.settings[key];expect(sourceLivePreviewKind(legacy)).toBeUndefined();expect(sourceLivePreviewKind(source)).toBe('symmetry');
  }
  expect(sourceLivePreviewKind({...source,settings:{...source.settings,iteratedBackend:'cpu'}})).toBeUndefined();
  expect(sourceLivePreviewKind({...source,settings:{...source.settings,iteratedStartTime:.2}})).toBeUndefined();
  expect(sourceLivePreviewKind({...source,settings:{...source.settings,recordTrails:false}})).toBeUndefined();
 });
 it('admits Map only with source parameter/presentation contracts and uses its delivered camera',()=>{
  const source=parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'MAP_ATTRACTOR',name:'Map live',equations:{x_next:'x',y_next:'y'},parameters:{a:1},settings:{batch_size:4},timeline:[]}),{sourceEntry:'runtime-config'}).scene;
  expect(sourceLivePreviewKind(source)).toBe('map');
  for(const key of ['mapParameterModel','mapPresentationModel']){const old=structuredClone(source);delete old.settings[key];expect(sourceLivePreviewKind(old)).toBeUndefined();}
  expect(sourceLivePreviewKind({...source,settings:{...source.settings,recordTrails:false}})).toBeUndefined();
 });
 it('opts explicit Domain queues in while preserving legacy fixed preview and clock guidance',()=>{
  const source=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Domain live',domainColoring:{formula:'z'},timeline:[]})).scene;
  expect(sourceLivePreviewKind(source)).toBe('domain');
  const legacy=structuredClone(source);delete legacy.timeline.schedule;
  expect(sourceLivePreviewKind(legacy)).toBeUndefined();
  expect(timelineWarnings(source,'fixed').some(text=>text.includes('固定回放'))).toBe(true);
  expect(timelineWarnings(source,'realtime').some(text=>text.includes('实际经过时间'))).toBe(true);
  expect(timelineWarnings(source,'realtime').some(text=>text.includes('固定回放'))).toBe(false);
 });
 it('opts source Surface into live preview and presents its delivered camera without replay',()=>{
  const source=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SURFACE',name:'Surface live',equations:{x:'u',y:'v',z:'0'},settings:{surface_mode:'MESH',mesh_u_segments:2,mesh_v_segments:2},timeline:[{type:'animate',duration:1,actions:[{method:'ambient',args:[.1,.2,.3]}]}]})).scene;
  expect(sourceLivePreviewKind(source)).toBe('surface');
  const local=structuredClone(source);delete local.settings.surfaceGeometryVersion;expect(sourceLivePreviewKind(local)).toBeUndefined();
  const context=(timestampMs:number):GenerateContext=>({time:999,quality:'preview',width:64,height:48,sourceViewport:ordinarySourceViewport(source,64,48,'primary',48),surfaceLive:{sessionId:'surface',revision:0,clock:{paused:false,timestampMs},actualFrameRate:37}});
  const owner=new TemporalGenerationSession();generateScene(source,context(1000),owner);const output=generateScene(source,context(1237),owner);
  const presented=sourceQueuePresentedScene(source,output)!;
  expect(presented.evaluatedSourceCamera).toBe(output.sourceCameraFrame);expect(presented.timeline).toBe(source.timeline);
  expect(presented.evaluatedSourceCamera!.camera).not.toEqual(ordinarySourceCameraInitial(source));expect(source.evaluatedSourceCamera).toBeUndefined();
 });
 it('presents the delivered live camera even at signed time, without fixed reconstruction or authored changes',()=>{
  const source=scene(),before=structuredClone(source);
  const frame={model:SOURCE_CAMERA_MODEL,frameIndex:2,time:-.5,camera:{...ordinarySourceCameraInitial(source)!,phi:.3},viewport:ordinarySourceViewport(source,64,48,'primary',48)};
  const output:SceneOutput={type:'raster',width:64,height:48,pixels:new Uint8ClampedArray(64*48*4),stats:{samples:0,generated:0,invalid:0},sourceCameraFrame:frame,symmetryLive:{sessionId:'live',clock:'realtime-source-queue',clockSource:'injected',sceneTime:-.5,rawDt:-.5,activeDt:-.5,queueIndex:0,queueComplete:true,paused:false,objectUpdates:1,replayRevision:0,display:{displayIndex:2,replayed:false,resized:false,cleared:false,passes:1,accumulationPasses:3,warmupApplied:true,replayActive:false,remainingBurnInSteps:0,remainingReplaySteps:0,phases:[],gpu:{steps:4,accepted:4,invalid:0,clipped:0,sampleInvalid:0,bounds:{minX:-1,maxX:1,minY:-1,maxY:1}}}}};
  const presented=sourceQueuePresentedScene(source,output)!;expect(presented.evaluatedSourceCamera).toBe(frame);expect(presented.parameters).toBe(source.parameters);expect(presented.palette).toBe(source.palette);expect(source).toEqual(before);
  expect(sourceQueuePresentedScene(source,{...output,symmetryLive:undefined})).toBeUndefined();
 });
 it('keeps fixed-replay guidance scoped to fixed generation, not live controls',()=>{
  const source=scene(),fixed=timelineWarnings(source),live=timelineWarnings(source,'realtime');
  expect(fixed.some(text=>text.includes('固定帧率'))).toBe(true);expect(live.some(text=>text.includes('固定帧率'))).toBe(false);
 });
});
