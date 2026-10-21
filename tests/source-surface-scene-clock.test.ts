import {describe,expect,it} from 'vitest';
import native from './fixtures/source-surface-scene/native.json';
import {parseProjectFile} from '../src/engine/legacyImport';
import {ordinarySourceCameraInitial} from '../src/engine/ordinarySourceCamera';
import {OrdinarySourceCameraTimelineSession} from '../src/engine/ordinarySourceCameraTimeline';
import {SourceSurfaceHost} from '../src/engine/sourceSurfaceHost';
import {prepareSourceSurfaceParticles,SourceSurfaceParticles} from '../src/engine/sourceSurfaceParticles';
import {replaySourceSurfaceCamera} from '../src/engine/sourceSurfaceReplay';

function setup(trace:typeof native.actual.cases[number],isCancelled?:()=>boolean){
 const scene=parseProjectFile(JSON.stringify(trace.input.project)).scene;scene.timeline.fps=10;
 const initial=ordinarySourceCameraInitial(scene);if(!initial)throw Error('Source camera required');
 const producer=scene.surfaceSource?new SourceSurfaceHost({configuration:scene.surfaceSource,equations:scene.equations,parameters:scene.parameters,palette:scene.surfaceSourcePalette,frameRate:10,coverage:'all',isCancelled}):prepareSourceSurfaceParticles(scene).create('all',isCancelled);
 const session=new OrdinarySourceCameraTimelineSession(initial,scene.timeline.tracks,10,{isCancelled,particleActions:'surface',surfaceMode:scene.surfaceSource?.mode,createParticles:()=>producer});
 return{scene,producer,session};
}
function position(producer:SourceSurfaceHost|SourceSurfaceParticles){
 if(producer instanceof SourceSurfaceParticles)return producer.snapshot().positions[0];
 const s=producer.snapshot();if('gpuPoints' in s)throw Error('CPU observation');return s.mode==='points'?s.points.positions[0]:s.mesh.geometry!.positions[0];
}
describe('original CPU Surface JSON → scene construction → variable-rate Scene.update',()=>{
 for(const trace of native.actual.cases)it(trace.input.name,()=>{
  const {producer,session}=setup(trace);
  expect(session.snapshot()).toMatchObject({sceneTime:trace.initial.sceneTime,queueIndex:trace.initial.queueIndex,queueComplete:trace.initial.queueComplete});
  for(const [index,step]of trace.input.steps.entries()){
   const expected=trace.frames[index],frame=session.step(step.dt,step),label=`${trace.input.name} frame ${index}`;
   expect(frame,label).toMatchObject({sceneTime:expected.sceneTime,rawDt:expected.rawDt,queueIndex:expected.queueIndex,queueComplete:expected.queueComplete});
   for(const key of ['phi','theta','gamma','zoom','focalDistance'] as const)expect(frame.camera[key],`${label} ${key}`).toBe(expected.camera[key]);
   expect(frame.rates,label).toEqual([expected.camera.phiRate,expected.camera.thetaRate,expected.camera.gammaRate]);
   expect(position(producer),`${label} first x`).toBe(expected.firstPosition![0]);
   if(producer instanceof SourceSurfaceParticles)expect(producer.currentAnimationTime,label).toBe(expected.objectTime);
   else{
    expect(producer.mode,label).toBe(expected.mode.toLowerCase());
    expect(producer.generation===0,label).toBe(expected.initialObjectStillCurrent);
    // The local presentation contract carries the draw-time byte, while the
    // native snapshot retains the scene's unquantized Float32 alpha.
    expect(frame.surfaceTransition?.overlayAlpha,label).toBe(Math.floor(Math.fround(expected.overlayAlpha*255)+.5));
    const snapshot=producer.snapshot();if(snapshot.mode==='mesh')expect(snapshot.mesh.animationTime,label).toBe(expected.objectTime);
   }
  }
 });
 it('preserves fixed reconstruction when the caller supplies no live observation',()=>{
  for(const trace of native.actual.cases){
   const {scene,session}=setup(trace);
   for(const time of [0,.2,.7,1.3])expect(session.evaluate(time)).toEqual(replaySourceSurfaceCamera(scene,time));
  }
 });
 for(const name of ['points-start-stop','mesh-start-stop']){
  const trace=native.actual.cases.find(c=>c.input.name===name)!;
  it(`${name} reads the observation only during positive active object updates`,()=>{
   const {session,producer}=setup(trace);
   session.step(0,{actualFrameRate:NaN});session.step(.1,{paused:true,actualFrameRate:Infinity});session.step(-.1,{actualFrameRate:NaN});
   expect(position(producer)).toBe(.25);
   expect(()=>session.step(.1,{actualFrameRate:NaN})).toThrow('有限 Float32');
   expect(()=>producer.snapshot()).toThrow('有限 Float32');
  });
  it(`${name} rejects cancellation without presenting an updated frame`,()=>{
   let cancel=false;const {session,producer}=setup(trace,()=>cancel);
   session.step(.1,{actualFrameRate:37});cancel=true;
   expect(()=>session.step(.1,{actualFrameRate:24})).toThrow('取消');
   expect(()=>producer.snapshot()).toThrow('取消');
  });
  it(`${name} retains time and order failures on the producer`,()=>{
   for(const value of [NaN,Infinity,1e300,null,'0'])for(const field of ['time','deltaTime']){
    const {producer}=setup(trace),frame={frameIndex:0,time:0,deltaTime:0,[field]:value};
    expect(()=>producer.update(frame as never)).toThrow('时间无效');expect(()=>producer.snapshot()).toThrow('时间无效');
   }
   const {producer}=setup(trace);producer.update({frameIndex:0,time:0,deltaTime:0});
   expect(()=>producer.update({frameIndex:0,time:0,deltaTime:0})).toThrow('顺序');
  });
 }

});
