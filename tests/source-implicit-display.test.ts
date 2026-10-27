import {afterEach,describe,expect,it,vi} from 'vitest';
import {SourceImplicitDisplayOwner,sourceImplicitPrimarySize,validateSourceImplicitDisplay} from '../src/engine/sourceImplicitDisplay';
import {createSourceImplicitTimeline} from '../src/engine/sourceImplicitTimeline';
import {SourceImplicitRecordingSession} from '../src/engine/sourceImplicitRecording';
import {generateScene,TemporalGenerationSession} from '../src/engine/temporal';
import {parseProjectFile} from '../src/engine/legacyImport';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {validSourceImplicitOutput} from '../src/engine/sourceImplicitResponse';
import {sourcePaletteRuntimeScene} from '../src/engine/sourcePaletteRuntimeScene';
import * as geometry from '../src/scenes/geometry';
import type {GenerateContext,SceneOutput} from '../src/types';
import native from './fixtures/source-implicit-presentation/parameters.json';

function fixture(parameter=false,cpu=false){
 const raw=structuredClone(native.cases[0].input.project);
 Object.assign(raw.settings,{mesh_mode:cpu?'CPU':'GPU',x_segments:4,y_segments:4,z_segments:4});
 raw.parameters={a:1,b:0.25,flat:1,reverse:0};
 raw.timeline=parameter?[{type:'animate',duration:1,easing:'LINEAR',actions:[{method:'paramStart',args:{parameters:{flat:{min:1,max:1,step:1}}}}]}] as typeof raw.timeline:[{type:'wait',duration:1}] as typeof raw.timeline;
 const scene=sourcePaletteRuntimeScene(parseProjectFile(JSON.stringify(raw)).scene);scene.timeline.fps=4;
 const context:GenerateContext={time:0,width:100,height:120,quality:'preview',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,405,486,'primary',486)};
 return{scene,context};
}
function mesh(output:SceneOutput){if(output.type!=='geometry')throw Error('Expected geometry');return output;}
function receipt(output:SceneOutput){const value=mesh(output).sourceImplicitDisplay;expect(value).toBeDefined();return value!;}
function recording(parameter=false){const f=fixture(parameter),owner=new SourceImplicitRecordingSession(),output=mesh(generateScene(f.scene,f.context));owner.admitPrimary(f.scene,f.context,output);const start=owner.beginRecording(f.scene,f.context,{width:128,height:96,simulationFps:4,actualFrameRate:37});return{...f,owner,start};}
afterEach(()=>vi.restoreAllMocks());

describe('Implicit source mesh dirty and display consumption',()=>{
 it('uses actual primary physical dimensions and holds a failed display ticket for retry',()=>{
  const {context}=fixture(),owner=new SourceImplicitDisplayOwner(),offscreen={...context,width:500,height:600,sourceViewport:{...context.sourceViewport!,target:'offscreen' as const},sourceImplicitPrimarySize:[810,972] as const};
  expect(sourceImplicitPrimarySize(context)).toEqual([810,972]);
  const first=owner.prepare(offscreen);expect(first).toMatchObject({rebuilt:true,displayIndex:1,meshRevision:1,viewport:[0,0,810,972]});expect(owner.prepare(offscreen)).toBe(first);expect(Object.isFrozen(first.viewport)).toBe(true);
  owner.commit(first);const next=owner.prepare(offscreen);expect(next).toMatchObject({rebuilt:false,displayIndex:2,meshRevision:1,viewport:[0,0,500,600]});owner.commit(next);
  owner.markDirty();expect(owner.prepare(offscreen)).toMatchObject({rebuilt:true,displayIndex:3,meshRevision:2,viewport:[0,0,810,972]});
 });
 it('rejects unknown offscreen primary size and foreign commits before consuming a display',()=>{
  const {context}=fixture(),owner=new SourceImplicitDisplayOwner(),offscreen={...context,sourceViewport:{...context.sourceViewport!,target:'offscreen' as const}};
  expect(()=>owner.prepare(offscreen)).toThrow('主视口');expect(()=>sourceImplicitPrimarySize({...context,sourcePointPixelDensity:1.5})).toThrow('整数');
  const current=owner.prepare(context);expect(()=>owner.commit({...current})).toThrow('不属于');expect(owner.prepare(context)).toBe(current);owner.commit(current);
 });
 it('keeps same-time primary redraw and palette hot commands on the same clean instance; Apply rebuilds',()=>{
  const f=fixture(),session=new TemporalGenerationSession(),initial={...f.context,implicitControls:{sessionId:'display',acknowledgedRevision:0,commands:[{kind:'apply' as const,revision:1,scene:f.scene}]}};
  try{
   const first=generateScene(f.scene,initial,session),held={...f.context,implicitControls:{sessionId:'display',acknowledgedRevision:1,commands:[]}};
   const redraw=generateScene(f.scene,held,session);expect(receipt(redraw)).toMatchObject({instance:receipt(first).instance,displayIndex:2,rebuilt:false,meshRevision:receipt(first).meshRevision});
   const staged=structuredClone(f.scene);staged.settings.opacity=.1;staged.settings.scaleX=99;
   const hot=generateScene(staged,{...f.context,implicitControls:{sessionId:'display',acknowledgedRevision:1,commands:[{kind:'palette',revision:2,colors:['#ff0000']}]}},session);
   expect(receipt(hot)).toMatchObject({instance:receipt(first).instance,displayIndex:3,rebuilt:false,meshRevision:receipt(first).meshRevision});
   const apply=generateScene(staged,{...f.context,implicitControls:{sessionId:'display',acknowledgedRevision:2,commands:[{kind:'apply',revision:3,scene:staged}]}},session);
   expect(receipt(apply).instance).not.toBe(receipt(first).instance);expect(receipt(apply)).toMatchObject({displayIndex:1,rebuilt:true});
  }finally{session.reset();}
 });
 it('consumes historical replay displays and reconstructs on backward seek without another clock',()=>{
  const f=fixture(),session=new TemporalGenerationSession();try{
   const late=generateScene(f.scene,{...f.context,time:.5},session);expect(receipt(late)).toMatchObject({displayIndex:3,rebuilt:false});
   const early=generateScene(f.scene,f.context,session);expect(receipt(early)).toMatchObject({displayIndex:1,rebuilt:true});expect(receipt(early).instance).not.toBe(receipt(late).instance);
   const redraw=generateScene(f.scene,f.context,session);expect(receipt(redraw)).toMatchObject({displayIndex:2,rebuilt:false,instance:receipt(early).instance});
  }finally{session.reset();}
 });
 it('marks every successful same-value parameter write dirty and stops after the original queue guard',()=>{
  const f=fixture(true),numerical=createSourceImplicitTimeline(f.scene,4);try{
   let prior=1;
   for(let i=0;i<4;i++){numerical.beginOperation();numerical.queue.step(.25,{actualFrameRate:37});expect(numerical.parameters().flat).toBe(1);const display=numerical.display.prepare(f.context);expect(display.rebuilt).toBe(true);expect(display.meshRevision).toBe(prior+1);prior=display.meshRevision;numerical.display.commit(display);}
   numerical.queue.step(.25,{actualFrameRate:37});const complete=numerical.display.prepare(f.context);expect(complete.rebuilt).toBe(false);expect(complete.meshRevision).toBe(prior);
  }finally{numerical.queue.reset();}
 });
 it('does not put GPU display side effects on the existing CPU path',()=>{
  const f=fixture(false,true),output=mesh(generateScene(f.scene,{...f.context,sourcePointPixelDensity:1.5}));expect(output.sourceImplicitDisplay).toBeUndefined();expect(output.formulaPresentation).not.toHaveProperty('drawingViewport');
 });
 it('binds source formulas and rejects missing or mismatched delivered display facts',()=>{
  const f=fixture(),output=mesh(generateScene(f.scene,f.context)),formula=output.formulaPresentation;if(formula?.layout!=='source-surface-centered-v1')throw Error('Source formula');expect(formula.drawingViewport).toEqual(receipt(output).viewport);expect(validSourceImplicitOutput(output,f.context)).toBe(true);
  const display=output.sourceImplicitDisplay;delete output.sourceImplicitDisplay;expect(validSourceImplicitOutput(output,f.context)).toBe(false);output.sourceImplicitDisplay=display;
  output.formulaPresentation={...formula,drawingViewport:[0,0,1,1]};expect(validSourceImplicitOutput(output,f.context)).toBe(false);
  expect(()=>validateSourceImplicitDisplay({...display,viewport:[0,0,NaN,600]})).toThrow();
 });
});

describe('Implicit recording and paired capture display identity',()=>{
 it('starts a fresh dirty instance, then steady offscreen, and republishes finish without another display',()=>{
  const f=recording();try{
   expect(receipt(f.start.warmup)).toMatchObject({displayIndex:1,rebuilt:true,viewport:[0,0,810,972]});
   const frame=f.owner.nextRecordingFrame(f.start.handle,1,37);expect(receipt(frame)).toMatchObject({displayIndex:2,rebuilt:false,viewport:[0,0,384,288]});
   const stop=f.owner.finishRecording(f.start.handle,1000),retry=f.owner.finishRecording(f.start.handle,2000);expect(receipt(stop.preview)).toBe(receipt(retry.preview));expect(stop.preview.sourceCameraFrame).toEqual(retry.preview.sourceCameraFrame);
  }finally{f.owner.reset();}
 });
 it('retries dirty recording geometry without repeating its parameter write or display consumption',()=>{
  const f=recording(true);try{
   const before=receipt(f.start.warmup);vi.spyOn(geometry,'generateImplicit').mockImplementationOnce(()=>{throw Error('mesh failed');});
   expect(()=>f.owner.nextRecordingFrame(f.start.handle,1,37)).toThrow('mesh failed');
   const frame=f.owner.nextRecordingFrame(f.start.handle,1,37);expect(receipt(frame)).toMatchObject({instance:before.instance,displayIndex:before.displayIndex+1,meshRevision:before.meshRevision+1,rebuilt:true,viewport:[0,0,810,972]});
  }finally{f.owner.reset();}
 });
 it('abandons a failed offscreen display on stop without consuming its ordinal twice',()=>{
  const f=recording();try{
   vi.spyOn(geometry,'generateImplicit').mockImplementationOnce(()=>{throw Error('offscreen failed');});expect(()=>f.owner.nextRecordingFrame(f.start.handle,1,37)).toThrow('offscreen failed');
   const stop=f.owner.finishRecording(f.start.handle,1000);expect(receipt(stop.preview)).toMatchObject({displayIndex:2,rebuilt:false,viewport:[0,0,810,972]});expect(stop.preview.sourceCameraFrame?.frameIndex).toBe(1);
  }finally{f.owner.reset();}
 });
 it('keeps capture then primary display order and rolls back the pair when primary production fails',()=>{
  const f=recording();try{
   const stop=f.owner.finishRecording(f.start.handle,1000),paused=f.owner.setPaused(stop.scene,stop.context,true,2000),before=receipt(stop.preview);
   const original=geometry.generateImplicit,spy=vi.spyOn(geometry,'generateImplicit');spy.mockImplementationOnce(original).mockImplementationOnce(()=>{throw Error('primary failed');});
   expect(()=>f.owner.capturePaused(stop.scene,paused,{width:500,height:600},1)).toThrow('primary failed');expect(f.owner.matchesCompletedPrimary(stop.scene,paused)).toBe(true);
   const result=f.owner.capturePaused(stop.scene,paused,{width:500,height:600},1);expect(receipt(result.capture)).toMatchObject({instance:before.instance,displayIndex:before.displayIndex+1,rebuilt:false,viewport:[0,0,500,600]});expect(receipt(result.preview)).toMatchObject({displayIndex:before.displayIndex+2,rebuilt:false,viewport:[0,0,810,972]});expect(result.preview.sourceCameraFrame).toEqual(stop.preview.sourceCameraFrame);
  }finally{f.owner.reset();}
 });
});
