import {describe,expect,it} from 'vitest';
import {prepareSourceImplicitOffscreenTarget} from '../src/engine/sourceImplicitViewport';
import {SOURCE_IMPLICIT_PRESENTATION} from '../src/engine/sourceImplicitIdentity';
import {SOURCE_IMPLICIT_GPU_PRESENTATION} from '../src/engine/sourceImplicitGpuPresentation';
import {sourcePaletteRuntimeScene} from '../src/engine/sourcePaletteRuntimeScene';
import {parseProjectFile} from '../src/engine/legacyImport';
import {generateScene,TemporalGenerationSession} from '../src/engine/temporal';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {sourceRecordingSize} from '../src/engine/sourceRecordingSize';
import {SourceGeometryRecordingLease} from '../src/engine/sourceGeometryRecordingLease';
import {sourceGeometryCapturePlan} from '../src/engine/sourceGeometryCapture';
import type {GenerationInput} from '../src/types';

const CPU=SOURCE_IMPLICIT_PRESENTATION,GPU=SOURCE_IMPLICIT_GPU_PRESENTATION;
function setup(mode:'CPU'|'GPU'){
 const scene=sourcePaletteRuntimeScene(parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'IMPLICIT',name:'Implicit viewport',palette:['#80112233','#40abcdef'],equation:{f:'x^2+y^2+z^2-1'},settings:{render_mode:'SOLID',mesh_mode:mode,x_segments:4,y_segments:4,z_segments:4},timeline:[{type:'wait',duration:1}]})).scene);
 const context:GenerationInput={time:0,width:810,height:972,quality:'preview',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,405,486,'primary',486),implicitControls:{sessionId:'viewport',acknowledgedRevision:0,commands:[{kind:'apply',revision:1,scene}]}};
 return{scene,context};
}
describe('implicit source offscreen viewport owner',()=>{
 it('separates GPU logical matrices from CPU immediate physical coordinates at the same physical image',()=>{
  const size={width:500,height:600},cpu=prepareSourceImplicitOffscreenTarget(CPU,size,2,486),gpu=prepareSourceImplicitOffscreenTarget(GPU,size,2,486);
  expect(cpu).toEqual({width:500,height:600,sourceViewport:{logicalWidth:500,logicalHeight:600,referenceLogicalHeight:486,target:'offscreen'},drawing:{width:500,height:600,pixelRatio:1}});
  expect(gpu).toEqual({width:500,height:600,sourceViewport:{logicalWidth:250,logicalHeight:300,referenceLogicalHeight:486,target:'offscreen'},drawing:{width:250,height:300,pixelRatio:2}});
  expect(cpu.sourceViewport).not.toHaveProperty('projectionPass');expect(gpu.sourceViewport).not.toHaveProperty('projectionPass');
 });
 it('rounds GPU physical requests once, preserves CPU odd dimensions and rejects unknown GPU density',()=>{
  const size={width:503,height:607};expect(prepareSourceImplicitOffscreenTarget(GPU,size,2,486)).toMatchObject({width:504,height:608,drawing:{width:252,height:304,pixelRatio:2}});
  expect(prepareSourceImplicitOffscreenTarget(CPU,size,2,486)).toMatchObject({width:503,height:607,drawing:{width:503,height:607,pixelRatio:1}});
  expect(prepareSourceImplicitOffscreenTarget(CPU,size,1.5,486).width).toBe(503);
  for(const density of [NaN,0,1.5])expect(()=>prepareSourceImplicitOffscreenTarget(GPU,size,density,486)).toThrow();
  expect(()=>prepareSourceImplicitOffscreenTarget('future' as typeof GPU,size,2,486)).toThrow();
 });
 it('retains the existing cold image capacity and composes the already admitted recording 3x size without another multiplier',()=>{
  expect(prepareSourceImplicitOffscreenTarget(GPU,{width:8192,height:4096},2,486).width).toBe(8192);
  const size=sourceRecordingSize({width:128,height:96},2);expect(size).toMatchObject({width:384,height:288});
  expect(prepareSourceImplicitOffscreenTarget(GPU,size,2,486)).toMatchObject({width:384,height:288,drawing:{width:192,height:144,pixelRatio:2}});
 });
 it.each(['CPU','GPU'] as const)('%s recording/capture use the completed material despite the opposite staged backend',mode=>{
  const f=setup(mode),session=new TemporalGenerationSession();
  try{
   const first=generateScene(f.scene,f.context,session);if(first.type!=='geometry')throw Error('geometry');
   const staged=structuredClone(f.scene);staged.settings.computeBackend=mode==='CPU'?'webgl2':'cpu';
   const context:GenerationInput={...f.context,implicitControls:{sessionId:'viewport',acknowledgedRevision:1,commands:[]}};
   const output=generateScene(staged,context,session);if(output.type!=='geometry')throw Error('geometry');
   const options={width:128,height:96,simulationFps:4,actualFrameRate:37},lease=new SourceGeometryRecordingLease(staged,context,output,options);
   const start=session.sourceImplicit.beginRecording(staged,context,options);lease.acceptStart(start);
   expect(start.warmup.sourceCameraFrame?.viewport).toMatchObject({logicalWidth:mode==='GPU'?192:384,logicalHeight:mode==='GPU'?144:288,referenceLogicalHeight:486});
   const stop=session.sourceImplicit.finishRecording(start.handle,1000);lease.acceptStop(stop);
   const paused=session.sourceImplicit.setPaused(stop.scene,stop.context,true,1100),model=output.sourceImplicitPresentation!.model;
   expect(()=>sourceGeometryCapturePlan(paused,{width:65,height:49},1)).toThrow('显示模型');
   const plan=sourceGeometryCapturePlan(paused,{width:65,height:49},1,model),captured=session.sourceImplicit.capturePaused(stop.scene,paused,{width:65,height:49},1);
   expect(plan.base).toMatchObject({width:66,height:50});expect(captured.capture.sourceCameraFrame?.viewport).toEqual(plan.captureContext.sourceViewport);
   expect(plan.drawing).toEqual(mode==='GPU'?{width:33,height:25,pixelRatio:2}:{width:66,height:50,pixelRatio:1});
   expect(captured.preview.sourceCameraFrame).toEqual(stop.preview.sourceCameraFrame);expect(captured.capture.sourceImplicitPresentation?.model).toBe(model);
  }finally{session.reset();}
 });
});
