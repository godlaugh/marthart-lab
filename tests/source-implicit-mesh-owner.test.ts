import {afterEach,describe,expect,it,vi} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {sourcePaletteRuntimeScene} from '../src/engine/sourcePaletteRuntimeScene';
import {generateScene,TemporalGenerationSession} from '../src/engine/temporal';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {generateImplicit,transformFor} from '../src/scenes/geometry';
import {prepareImplicitJob} from '../src/engine/implicitSurface';
import {prepareSourceImplicitField} from '../src/engine/sourceImplicitField';
import {SourceImplicitMeshOwner} from '../src/engine/sourceImplicitMeshOwner';
import {outputBuffers} from '../src/engine/outputBuffers';
import {IMPLICIT_WORK_BYTES} from '../src/engine/meshEdges';
import * as meshProducer from '../src/engine/sourceImplicitMesh';
import * as presentation from '../src/engine/sourceImplicitPresentation';
import type {GenerateContext,SceneDocument,SceneOutput} from '../src/types';
import native from './fixtures/source-implicit-presentation/parameters.json';

const geometry=(output:SceneOutput)=>{if(output.type!=='geometry')throw Error('geometry required');return output;};
function fixture(cpu=false,parameter=false){
 const raw=structuredClone(native.cases[0].input.project);
 Object.assign(raw.settings,{mesh_mode:cpu?'CPU':'GPU',x_segments:4,y_segments:4,z_segments:4});
 raw.parameters={a:1,b:.25,flat:1,reverse:0};
 raw.timeline=(parameter?[{type:'animate',duration:1,easing:'LINEAR',actions:[{method:'paramStart',args:{parameters:{flat:{min:1,max:1,step:1}}}}]}]:[{type:'wait',duration:1}]) as typeof raw.timeline;
 const scene=sourcePaletteRuntimeScene(parseProjectFile(JSON.stringify(raw)).scene);scene.timeline.fps=4;
 const context:GenerateContext={time:0,width:100,height:120,quality:'preview',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,405,486,'primary',486)};
 return{scene,context};
}
function direct(owner:SourceImplicitMeshOwner,scene:SceneDocument,context:GenerateContext){const job=prepareImplicitJob(scene,context,transformFor(scene.settings));return owner.generate(job,prepareSourceImplicitField(job),context);}
afterEach(()=>vi.restoreAllMocks());

describe('one numerical Implicit raw mesh owner',()=>{
 it.each([false,true])('reuses complete math and slices after actual transfer, with fresh presentation (CPU=%s)',cpu=>{
  const {scene,context}=fixture(cpu),session=new TemporalGenerationSession();
  try{
   const first=geometry(generateScene(scene,context,session)),expected=structuredClone(first),buffers=outputBuffers(first);
   expect(first.sourceImplicitPresentation?.wire).toBeDefined();
   structuredClone(first,{transfer:buffers});expect(first.positions.byteLength).toBe(0);
   const second=geometry(generateScene(scene,{...context,width:80,height:90,sourcePointPixelDensity:1},session));
   expect(second.positions).toEqual(expected.positions);expect(second.sourceImplicitMesh?.normals).toEqual(expected.sourceImplicitMesh?.normals);expect(second.sourceImplicitPresentation?.wire?.positions).toEqual(expected.sourceImplicitPresentation?.wire?.positions);
   expect(second.sourceImplicitPresentation?.referencePixelDensity).toBe(1);expect(second.stats.samples).toBe(0);expect(second.implicit?.latticeSamples).toBe(0);expect(second.implicit?.examinedCells).toBe(0);
   expect(second.sourceImplicitPresentation?.wire?.samples).toBe(0);expect(second.implicit!.estimatedPeakWorkingBytes).toBeGreaterThanOrEqual(second.positions.length/3*96);
   expect(session.sourceImplicit.diagnostics()).toMatchObject({meshBuilds:1,meshCacheHits:1,sliceBuilds:1});expect(session.diagnostics().retainedBytes).toBeGreaterThan(0);
   second.positions.fill(99);const third=geometry(generateScene(scene,context,session));expect(third.positions).toEqual(expected.positions);
  }finally{session.reset();}expect(session.sourceImplicit.diagnostics().retainedBytes).toBe(0);
 });
 it('distinguishes a historical clean display from materialization, while camera-only advance reuses it',()=>{
  const {scene,context}=fixture(),session=new TemporalGenerationSession();
  try{
   const late=geometry(generateScene(scene,{...context,time:.5},session));expect(late.sourceImplicitDisplay?.rebuilt).toBe(false);expect(late.stats.samples).toBeGreaterThan(0);
   const next=geometry(generateScene(scene,{...context,time:.75},session));expect(next.stats.samples).toBe(0);expect(next.positions).toEqual(late.positions);
   const back=geometry(generateScene(scene,context,session));expect(back.sourceImplicitDisplay?.instance).not.toBe(late.sourceImplicitDisplay?.instance);expect(back.sourceImplicitDisplay?.rebuilt).toBe(true);expect(back.stats.samples).toBeGreaterThan(0);
  }finally{session.reset();}
 });
 it('rebuilds after each successful same-value write, even with equal mesh bytes',()=>{
  const {scene,context}=fixture(false,true),session=new TemporalGenerationSession();try{
   const a=geometry(generateScene(scene,context,session)),b=geometry(generateScene(scene,{...context,time:.25},session));
   expect(b.positions).toEqual(a.positions);expect(b.sourceImplicitDisplay?.meshRevision).toBe(a.sourceImplicitDisplay!.meshRevision+1);expect(b.stats.samples).toBeGreaterThan(0);expect(session.sourceImplicit.diagnostics().meshBuilds).toBe(2);
  }finally{session.reset();}
 });
 it('uses complete parsed bounds, exact parameter identity and a separate optional slice materialization',()=>{
  const {scene,context}=fixture(),owner=new SourceImplicitMeshOwner(()=>1);scene.settings.meshWireframe=false;scene.settings.minX='t-1.5';scene.settings.maxX='t+1.5';scene.parameters.unused=-0;
  direct(owner,scene,context);direct(owner,scene,{...context,time:.25});expect(owner.diagnostics().meshBuilds).toBe(2);
  scene.parameters.unused=0;direct(owner,scene,{...context,time:.25});expect(owner.diagnostics().meshBuilds).toBe(3);
  scene.settings.meshWireframe=true;const lines=direct(owner,scene,{...context,time:.25});expect(lines.sourceImplicitPresentation?.wire).toBeDefined();expect(owner.diagnostics()).toMatchObject({meshBuilds:3,meshCacheHits:1,sliceBuilds:1});
  const fresh=geometry(generateImplicit(scene,{...context,time:.25}));expect(lines.positions).toEqual(fresh.positions);expect(lines.sourceImplicitPresentation?.wire).toEqual(fresh.sourceImplicitPresentation?.wire);
 });
 it('recolors hot palette without resampling or consuming staged geometry; Apply replaces the raw owner',()=>{
  const {scene,context}=fixture(),session=new TemporalGenerationSession();try{
   const first=geometry(generateScene(scene,{...context,implicitControls:{sessionId:'raw',acknowledgedRevision:0,commands:[{kind:'apply',revision:1,scene}]}},session));
   const staged=structuredClone(scene);staged.settings.scaleX=77;
   const hot=geometry(generateScene(staged,{...context,implicitControls:{sessionId:'raw',acknowledgedRevision:1,commands:[{kind:'palette',revision:2,colors:['#ff0000']}]}},session));
   expect(hot.positions).toEqual(first.positions);expect(hot.sourceImplicitPresentation?.fillColors).not.toEqual(first.sourceImplicitPresentation?.fillColors);expect(session.sourceImplicit.diagnostics()).toMatchObject({meshBuilds:1,meshCacheHits:1,sliceBuilds:1});
   const applied=geometry(generateScene(staged,{...context,implicitControls:{sessionId:'raw',acknowledgedRevision:2,commands:[{kind:'apply',revision:3,scene:staged}]}},session));expect(applied.positions).not.toEqual(hot.positions);expect(applied.stats.samples).toBeGreaterThan(0);
  }finally{session.reset();}
 });
 it('keeps a previous valid raw artifact on failed presentation and cancellation',()=>{
  const {scene,context}=fixture(),owner=new SourceImplicitMeshOwner(()=>1),before=direct(owner,scene,context),retained=owner.diagnostics().retainedBytes;
  expect(()=>direct(owner,scene,{...context,isCancelled:()=>true})).toThrow('取消');
  expect(()=>direct(owner,{...scene,settings:{...scene.settings,opacity:NaN}},context)).toThrow('有限');
  expect(owner.diagnostics().retainedBytes).toBe(retained);expect(direct(owner,scene,context).positions).toEqual(before.positions);expect(owner.diagnostics().meshBuilds).toBe(1);
 });
 it('rolls back a successful candidate when its surrounding display pair fails',()=>{
  const {scene,context}=fixture(),owner=new SourceImplicitMeshOwner(()=>1),before=direct(owner,scene,context),retained=owner.diagnostics().retainedBytes;
  expect(()=>owner.transaction(()=>{direct(owner,{...scene,parameters:{...scene.parameters,a:2}},context);throw Error('paired display failed');})).toThrow('paired display failed');
  expect(owner.diagnostics().retainedBytes).toBe(retained);expect(direct(owner,scene,context).positions).toEqual(before.positions);expect(owner.diagnostics()).toMatchObject({meshBuilds:2,meshCacheHits:1});
 });
 it('shares raw geometry through recording, finish retry, continuation and paired capture, then clears it',()=>{
  const {scene,context}=fixture(),session=new TemporalGenerationSession(),owner=session.sourceImplicit;
  try{
   const primary=geometry(generateScene(scene,context,session));owner.admitPrimary(scene,context,primary);
   const start=owner.beginRecording(scene,context,{width:128,height:96,simulationFps:4,actualFrameRate:37});expect(start.warmup.stats.samples).toBeGreaterThan(0);
   structuredClone(start.warmup,{transfer:outputBuffers(start.warmup)});
   const frame=owner.nextRecordingFrame(start.handle,1,37);expect(frame.stats.samples).toBe(0);const expected=frame.positions.slice();structuredClone(frame,{transfer:outputBuffers(frame)});
   const stop=owner.finishRecording(start.handle,1000),identity=stop.preview.sourceImplicitDisplay;expect(stop.preview.stats.samples).toBe(0);structuredClone(stop.preview,{transfer:outputBuffers(stop.preview)});
   const retry=owner.finishRecording(start.handle,2000);expect(retry.preview.positions).toEqual(expected);expect(retry.preview.sourceImplicitDisplay).toBe(identity);
   const paused=owner.setPaused(retry.scene,retry.context,true,2100),capture=owner.capturePaused(retry.scene,paused,{width:500,height:600},1);
   expect(capture.capture.positions).toEqual(expected);expect(capture.preview.positions).toEqual(expected);expect(capture.capture.positions.buffer).not.toBe(capture.preview.positions.buffer);expect(capture.capture.stats.samples).toBe(0);expect(capture.preview.stats.samples).toBe(0);
   structuredClone(capture,{transfer:[...outputBuffers(capture.capture),...outputBuffers(capture.preview)]});
   const continued=owner.generateContinuation(retry.scene,paused);expect(continued.positions).toEqual(expected);expect(continued.stats.samples).toBe(0);expect(owner.diagnostics().meshBuilds).toBe(1);expect(owner.diagnostics().meshCacheHits).toBe(6);
  }finally{session.reset();}expect(owner.diagnostics().retainedBytes).toBe(0);
 });
 it('evicts optional old storage before a maximal valid cold admission, preserving the previous capacity',()=>{
  const {scene,context}=fixture();let revision=1;const owner=new SourceImplicitMeshOwner(()=>revision);direct(owner,scene,context);revision++;
  const original=meshProducer.generateSourceImplicitMesh;let admitted=false;
  vi.spyOn(meshProducer,'generateSourceImplicitMesh').mockImplementationOnce((job,field,c,admit)=>{admit!(IMPLICIT_WORK_BYTES);expect(owner.diagnostics().retainedBytes).toBe(0);admitted=true;return original(job,field,c,admit);});
  expect(direct(owner,scene,context).positions.length).toBeGreaterThan(0);expect(admitted).toBe(true);expect(owner.diagnostics().peakWorkingBytes).toBe(IMPLICIT_WORK_BYTES);
 });
 it('unwinds a borrowed hit before cold capacity retry and includes the first capture output in admission',()=>{
  const {scene,context}=fixture(),owner=new SourceImplicitMeshOwner(()=>1);direct(owner,scene,context);
  const original=presentation.bindSourceImplicitPresentation,producer=meshProducer.generateSourceImplicitMesh;let cold=0;
  vi.spyOn(presentation,'bindSourceImplicitPresentation').mockImplementationOnce((output,job,c,field,reuse)=>{reuse!.admitWorking(IMPLICIT_WORK_BYTES);original(output,job,c,field,reuse);});
  vi.spyOn(meshProducer,'generateSourceImplicitMesh').mockImplementation((...args)=>{expect(owner.diagnostics().retainedBytes).toBe(0);cold++;return producer(...args);});
  const output=direct(owner,scene,context);expect(cold).toBe(1);
  vi.spyOn(presentation,'bindSourceImplicitPresentation').mockImplementationOnce((out,job,c,field,reuse)=>{reuse!.admitWorking(IMPLICIT_WORK_BYTES);original(out,job,c,field,reuse);});
  expect(()=>owner.withOutput(output,()=>direct(owner,scene,context))).toThrow('256 MiB');expect(output.positions.byteLength).toBeGreaterThan(0);
 });
});
