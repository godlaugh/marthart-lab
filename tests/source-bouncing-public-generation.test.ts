import {describe,it,expect,vi} from 'vitest';
import {createScene,serializeScene,parseScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {importSourceBouncingDocument} from '../src/engine/sourceBouncingDocument';
import {generateScene,TemporalGenerationSession} from '../src/engine/temporal';
import {sceneAtTime} from '../src/engine/timeline';
import {sourceBouncingSeedCheckpoint,stepSourceBouncingRealtime} from '../src/engine/sourceBouncingReplay';
import {GenerationQueue} from '../src/engine/generationQueue';
import {JavaSourceRandom48} from '../src/engine/javaSourceRandom';
import type {GenerateContext,SceneOutput} from '../src/types';

function source(){
 const scene=createScene(definition('bouncing'));
 const imported=importSourceBouncingDocument({settings:{particle_count:4,seed:'9223372036854775807'},camera:{phi:-0},palette:[]});
 if(!imported.ok)throw Error(imported.error.reason);
 scene.bouncingSource=imported.value.payload;scene.settings={};scene.equations={};scene.parameters={};
 scene.timeline={duration:10,fps:60,loop:false,tracks:[]};return scene;
}
const context:GenerateContext={time:0,width:96,height:64,quality:'preview',sourceViewport:{logicalWidth:96,logicalHeight:64,referenceLogicalHeight:64,target:'primary',projectionPass:'perspective'}};
describe('source Bouncing canonical/public boundary',()=>{
 it('saves and reopens authored source values without native provenance reinterpretation',()=>{
  const scene=source();scene.bouncingSource!.visual.dotSize=7;
  const reopened=parseScene(serializeScene(scene));
  expect(reopened.bouncingSource).toEqual(scene.bouncingSource);
  expect(Object.is(reopened.bouncingSource!.camera.phi,-0)).toBe(true);
  expect(reopened.bouncingSource!.configuration.seed).toBe('9223372036854775807');
  expect(reopened.bouncingSource!.visual.palette).toEqual({kind:'colors',colors:[]});
  const local=createScene(definition('bouncing'));expect(parseScene(serializeScene(local)).bouncingSource).toBeUndefined();
 });
 it('owns detached display snapshots without evaluating physics or ordinary queues',()=>{
  const scene=source(),snapshot=sceneAtTime(scene,120);
  expect(snapshot.bouncingSource).toEqual(scene.bouncingSource);
  snapshot.bouncingSource!.configuration.polygonVertices[0]=123;
  expect(scene.bouncingSource!.configuration.polygonVertices[0]).not.toBe(123);
  expect(snapshot.evaluatedSourceCamera).toBeUndefined();expect(snapshot.evaluatedCamera).toBeUndefined();
 });
 it('rejects malformed owned documents and local timeline fields instead of falling back',()=>{
  const scene=source();scene.bouncingSource=undefined;
  expect(()=>generateScene(scene,{...context,sourceBouncingFrame:sourceBouncingSeedCheckpoint()})).toThrow('检查点');
  const owned=source();owned.timeline.tracks=createScene(definition('bouncing')).timeline.tracks;
  expect(()=>parseScene(serializeScene(owned))).toThrow('时间轴');
  expect(()=>generateScene(owned,context)).toThrow('时间轴');
  const wrong=source();wrong.kind='surface';expect(()=>generateScene(wrong,context)).toThrow('配置只能');
  const corrupt=source();corrupt.bouncingSource=null as never;
  expect(()=>generateScene(corrupt,context)).toThrow('文档必须');
 });
 it('requires explicit matching checkpoint and viewport facts before allocating GPU state',()=>{
  const owner=new TemporalGenerationSession(),scene=source();
  expect(()=>generateScene(scene,{...context,time:1},owner)).toThrow('显式更新检查点');
  expect(()=>generateScene(scene,{...context,sourceViewport:undefined},owner)).toThrow('逻辑画布');
  expect(()=>generateScene(scene,{...context,width:100000},owner)).toThrow('容量');
  expect(owner.diagnostics().sourceBouncing).toMatchObject({retainedBytes:0,simulationUpdates:0});
  owner.reset();
 });
 it('retires the old local owner when switching model within the bouncing family',()=>{
  const owner=new TemporalGenerationSession(),local=createScene(definition('bouncing'));
  const releaseLocal=vi.spyOn(owner.bouncing,'reset'),releaseSource=vi.spyOn(owner.sourceBouncing,'reset');
  owner.select(local,context);releaseLocal.mockClear();releaseSource.mockClear();
  owner.select(source(),context);expect(releaseLocal).toHaveBeenCalledTimes(1);
  owner.select(local,context);expect(releaseSource).toHaveBeenCalledTimes(1);
  owner.reset();
 });
 it('rejects excessive whole-request replay before drawing any random initial particles',()=>{
  const scene=source(),owner=new TemporalGenerationSession();scene.bouncingSource!.configuration.particleCount=200000;
  const checkpoint={...sourceBouncingSeedCheckpoint(),simulationUpdates:10000};
  const random=vi.spyOn(JavaSourceRandom48.prototype,'nextFloat');
  try{
   expect(()=>generateScene(scene,{...context,sourceBouncingFrame:checkpoint},owner)).toThrow('碰撞工作量');
   expect(random).not.toHaveBeenCalled();expect(owner.diagnostics().sourceBouncing.retainedBytes).toBe(0);
  }finally{random.mockRestore();owner.reset();}
 });
 it('coalesces absolute checkpoints and preserves the worker across source display edits',async()=>{
  const requests:{context:GenerateContext;resolve:(output:SceneOutput)=>void}[]=[];
  const port={generate:vi.fn((_scene:unknown,c:GenerateContext)=>new Promise<SceneOutput>(resolve=>requests.push({context:c,resolve}))),cancel:vi.fn(),dispose:vi.fn()};
  const callbacks={output:vi.fn(),error:vi.fn(),busy:vi.fn()},queue=new GenerationQueue(port,callbacks),scene=source();
  const first=stepSourceBouncingRealtime(sourceBouncingSeedCheckpoint(),{paused:false,deltaTime:0});if(!first.ok)throw Error('clock');
  queue.request(scene,{...context,sourceBouncingFrame:first.value});
  const second=stepSourceBouncingRealtime(first.value,{paused:false,deltaTime:.02});if(!second.ok)throw Error('clock');
  queue.request(scene,{...context,time:second.value.sceneTime,sourceBouncingFrame:second.value});
  const changed=structuredClone(scene);changed.bouncingSource!.visual.dotSize=9;
  const third=stepSourceBouncingRealtime(second.value,{paused:false,deltaTime:.03});if(!third.ok)throw Error('clock');
  queue.request(changed,{...context,time:third.value.sceneTime,sourceBouncingFrame:third.value});
  expect(port.cancel).toHaveBeenCalledTimes(1);
  const image:SceneOutput={type:'raster',width:1,height:1,pixels:new Uint8ClampedArray(4),stats:{samples:0,generated:0,invalid:0}};
  requests[0].resolve(image);for(let i=0;i<5;i++)await Promise.resolve();
  expect(requests.map(x=>x.context.sourceBouncingFrame!.simulationUpdates)).toEqual([1,3]);
  expect(callbacks.output).not.toHaveBeenCalled();requests[1].resolve(image);
  for(let i=0;i<5;i++)await Promise.resolve();expect(callbacks.output).toHaveBeenCalledTimes(1);queue.dispose();
 });
});
