import formulaNative from './fixtures/source-implicit-presentation/formula-recording.json';
import parameterNative from './fixtures/source-implicit-presentation/parameters.json';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import native from './fixtures/source-implicit-presentation/recording-clock.json';
import {serializeScene} from '../src/engine/document';
import {parseProjectFile} from '../src/engine/legacyImport';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import type {GenerationInput} from '../src/types';
import type {GenerationRequest,GenerationResponse} from '../src/engine/generationProtocol';
let worker:{onmessage?:(e:MessageEvent<GenerationRequest>)=>Promise<void>;postMessage:(data:GenerationResponse,options:{transfer:Transferable[]})=>void};
let response:GenerationResponse,sequence:number,fail:{operation:string;detached:boolean}|undefined;
beforeEach(async()=>{
 vi.resetModules();sequence=0;fail=undefined;
 worker={postMessage:(data,options)=>{
  const fault=fail?.operation===data.operation&&!('error' in data)?fail:undefined;
  if(fault){fail=undefined;if(!fault.detached)throw Error('publication failed');}
  const delivered=structuredClone(data,{transfer:options.transfer});
  if(fault)throw Error('publication failed after transfer');response=delivered;
 }};
 vi.stubGlobal('self',worker);await import('../src/engine/generate.worker');
});
afterEach(()=>vi.unstubAllGlobals());
async function send(data:Record<string,unknown>){await worker.onmessage!({data:structuredClone({sessionId:7,id:++sequence,...data})} as MessageEvent<GenerationRequest>);return response;}
function result<O extends GenerationResponse['operation']>(response:GenerationResponse,operation:O):Extract<GenerationResponse,{operation:O}>{
 if(response.operation!==operation||'error' in response)throw Error('error' in response?response.error:'operation mismatch');return response as Extract<GenerationResponse,{operation:O}>;
}
async function setup(name='fps4-varying',full=false,unsupported=false,mode:'CPU'|'GPU'|'AUTO'='CPU'){
 const row=native.cases.find(c=>c.name===name)!,project=structuredClone(row.input.project);
 if(!full)project.settings.x_segments=project.settings.y_segments=project.settings.z_segments=4;
 Object.assign(project.settings,{mesh_mode:mode});
 const scene=parseProjectFile(JSON.stringify(project)).scene;
 if(unsupported){scene.parameters.a=0;scene.timeline.tracks.push({...scene.timeline.tracks[1],id:'unsupported-parameter',actions:[{id:'parameter-action',method:'paramStart',parameters:[{target:'parameters.a',step:.1,min:0,max:1,enabled:true}]}]});}
 const context:GenerationInput={time:0,width:810,height:972,quality:'preview',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,405,486,'primary',486)};
 const first=result(await send({operation:'generate',scene,context}),'generate');
 return{row,scene,context,sourceId:first.id,options:{width:128,height:96,simulationFps:row.input.simulationFps,actualFrameRate:row.input.steps[0].actualFrameRate}};
}
async function begin(f:Awaited<ReturnType<typeof setup>>){return result(await send({operation:'source-recording-begin',sourceId:f.sourceId,options:f.options}),'source-recording-begin');}
describe('Implicit recording production Worker transport',()=>{
 for(const row of native.cases)it('matches original clock/camera after real geometry buffer transfer: '+row.name,async ()=>{
  const f=await setup(row.name,true),start=await begin(f);expect(start.result.clock).toMatchObject({updates:row.frames.length,encodedFrames:row.frames.length-1,warmupUpdates:1});
  for(const [i,expected]of row.frames.entries()){
   const out=i===0?start.result.warmup:result(await send({operation:'source-recording-frame',recordingId:start.recordingId,displayFrame:i,actualFrameRate:row.input.steps[i].actualFrameRate}),'source-recording-frame').output;
   if(out.type!=='geometry')throw Error('geometry');
   expect(out.positions.byteLength).toBeGreaterThan(0);expect(out.sourceImplicitPresentation).toBeDefined();
   expect(out.implicitRecording).toEqual({displayFrame:i,simulationFps:row.input.simulationFps,actualFrameRate:row.input.steps[i].actualFrameRate,warmup:i===0,complete:expected.complete});
   const {phiRate:_,thetaRate:__,gammaRate:___,...camera}=expected.camera;
   expect(out.sourceCameraFrame).toMatchObject({frameIndex:i,sceneTime:expected.sceneTime,rawDt:expected.rawDt,queueComplete:expected.complete,rates:[expected.camera.phiRate,expected.camera.thetaRate,expected.camera.gammaRate],camera,viewport:{logicalWidth:384,logicalHeight:288,target:'offscreen',referenceLogicalHeight:486}});
  }
  expect(await send({operation:'source-recording-frame',recordingId:start.recordingId,displayFrame:row.frames.length,actualFrameRate:37})).toHaveProperty('error');
  const stop=result(await send({operation:'source-recording-finish',recordingId:start.recordingId}),'source-recording-finish');
  expect(stop.result.preview).toMatchObject({sourceCameraFrame:{frameIndex:row.frames.length-1,sceneTime:row.frames.at(-1)!.sceneTime,viewport:{target:'primary',logicalWidth:405,logicalHeight:486}}});expect(stop.result.preview).not.toHaveProperty('implicitRecording');
  expect(stop.result.scene.timeline.fps).toBe(f.scene.timeline.fps);
  const again=result(await send({operation:'source-recording-begin',sourceId:stop.id,options:f.options}),'source-recording-begin');expect(again.result.warmup).toMatchObject({implicitRecording:{displayFrame:0}});
  result(await send({operation:'source-recording-finish',recordingId:again.recordingId}),'source-recording-finish');
 },15000);
 it.each(['GPU','AUTO'] as const)('shares the original numerical queue, formulas and transfer ownership with %s material',async mode=>{
  const f=await setup('fps4-varying',false,false,mode),start=await begin(f);
  // This exercises the production numerical Worker and real ArrayBuffer
  // transfers. Shader/pixel equivalence is deliberately outside this CPU test.
  for(const [i,expected] of f.row.frames.entries()){
   const out=i===0?start.result.warmup:result(await send({operation:'source-recording-frame',recordingId:start.recordingId,displayFrame:i,actualFrameRate:f.row.input.steps[i].actualFrameRate}),'source-recording-frame').output;
   if(out.type!=='geometry')throw Error('geometry');
   expect(out.sourceImplicitPresentation).toMatchObject({model:'mathart-1.7.8-gpu-material-v1',meshMode:mode,meshComputation:'source-cpu-fallback'});
   const facts=out.sourceImplicitPresentation!;if(facts.model!=='mathart-1.7.8-gpu-material-v1')throw Error('GPU material');
   expect(facts.palette).toBeInstanceOf(Uint32Array);expect(facts.palette.byteLength).toBeGreaterThan(0);expect(facts.fillColors.byteLength).toBe(out.positions.length/3*16);
   expect(out.sourceCameraFrame).toMatchObject({frameIndex:i,sceneTime:expected.sceneTime,rawDt:expected.rawDt,queueComplete:expected.complete});
   expect(out.formulaPresentation).toEqual({...start.result.warmup.formulaPresentation,drawingViewport:out.sourceImplicitDisplay!.viewport});
  }
  const stop=result(await send({operation:'source-recording-finish',recordingId:start.recordingId}),'source-recording-finish');
  expect(stop.result.preview.implicitLive?.renderKind).toBe('snapshot');expect(stop.result.preview.sourceCameraFrame?.frameIndex).toBe(f.row.frames.length-1);
 });
 it.each([false,true])('stops an undelivered warmup without another update (detached=%s)',async detached=>{
  const f=await setup();fail={operation:'source-recording-begin',detached};const error=await send({operation:'source-recording-begin',sourceId:f.sourceId,options:f.options});
  if(!('error' in error))throw Error('failure');expect(error.retainedRecordingId).toBe(sequence);
  const stop=result(await send({operation:'source-recording-finish',recordingId:error.retainedRecordingId}),'source-recording-finish');expect(stop.result.preview).toMatchObject({sourceCameraFrame:{frameIndex:0}});
 });
 it.each([false,true])('never consumes a failed frame publication twice (detached=%s)',async detached=>{
  const start=await begin(await setup());fail={operation:'source-recording-frame',detached};const request={operation:'source-recording-frame',recordingId:start.recordingId,displayFrame:1,actualFrameRate:12};
  expect(await send(request)).toMatchObject({retainedRecordingId:start.recordingId});expect(await send({...request,actualFrameRate:24})).toHaveProperty('error');expect(await send({...request,displayFrame:2})).toHaveProperty('error');
  const retried=await send(request);if(detached)expect(retried).toMatchObject({error:expect.stringContaining('传输状态未知'),retainedRecordingId:start.recordingId});else expect(retried).toMatchObject({output:{implicitRecording:{displayFrame:1}}});
  expect(result(await send({operation:'source-recording-finish',recordingId:start.recordingId}),'source-recording-finish').result.preview).toMatchObject({sourceCameraFrame:{frameIndex:1}});
 });
 it.each([false,true])('re-materializes stopped geometry after failed publication (detached=%s)',async detached=>{
  const start=await begin(await setup()),frame=result(await send({operation:'source-recording-frame',recordingId:start.recordingId,displayFrame:1,actualFrameRate:12}),'source-recording-frame').output;
  fail={operation:'source-recording-finish',detached};expect(await send({operation:'source-recording-finish',recordingId:start.recordingId})).toMatchObject({retainedRecordingId:start.recordingId});
  expect(await send({operation:'source-recording-frame',recordingId:start.recordingId,displayFrame:2,actualFrameRate:12})).toHaveProperty('error');
  const stop=result(await send({operation:'source-recording-finish',recordingId:start.recordingId}),'source-recording-finish');
  if(frame.type!=='geometry'||stop.result.preview.type!=='geometry')throw Error('geometry');expect(stop.result.preview.positions).toEqual(frame.positions);expect(stop.result.preview.sourceCameraFrame?.camera).toEqual(frame.sourceCameraFrame?.camera);
  expect(await send({operation:'source-recording-finish',recordingId:start.recordingId})).toHaveProperty('error');
 });
 it('retains the exact preview on admission failure and the real lease on foreign requests',async ()=>{
  const f=await setup();expect(await send({operation:'source-recording-begin',sourceId:f.sourceId,options:{...f.options,width:999999}})).toMatchObject({retainedSourceId:f.sourceId});
  expect(await send({operation:'source-recording-begin',sourceId:f.sourceId,options:{...f.options,actualFrameRate:NaN}})).toMatchObject({retainedSourceId:f.sourceId});
  const start=await begin(f);expect(await send({operation:'generate',scene:f.scene,context:f.context})).toMatchObject({retainedRecordingId:start.recordingId});expect(await send({operation:'source-recording-frame',recordingId:999,displayFrame:1,actualFrameRate:12})).toMatchObject({retainedRecordingId:start.recordingId});expect(await send({operation:'source-recording-finish',sessionId:8,recordingId:start.recordingId})).not.toHaveProperty('retainedRecordingId');
  result(await send({operation:'source-recording-finish',recordingId:start.recordingId}),'source-recording-finish');
 });
 it('does not silently ignore unimplemented parameter actions',async ()=>{
  const f=await setup('fps4-varying',false,true);expect(await send({operation:'source-recording-begin',sourceId:f.sourceId,options:f.options})).toMatchObject({error:expect.stringContaining('非相机动作'),retainedSourceId:f.sourceId});
 });
 it('retains an unmapped imported effect through save/load and rejects recording',async ()=>{
  const raw=JSON.parse(JSON.stringify(native.cases[0].input.project));raw.settings.x_segments=raw.settings.y_segments=raw.settings.z_segments=4;
  raw.timeline[1].actions.push({method:'paramStart',args:{a:{step:.1,min:0,max:1}}});
  const imported=parseProjectFile(JSON.stringify(raw));
  // Existing saved unmapped actions remain explicit, never silently migrated
  // to the newly supported source registry without rereading source args.
  imported.scene.timeline.tracks[1].actions![imported.scene.timeline.tracks[1].actions!.length-1]={id:'old-unmapped',method:'paramStart',enabled:true,sourceEffect:'unmapped'};
  const scene=parseProjectFile(serializeScene(imported.scene)).scene,action=scene.timeline.tracks[1].actions!.at(-1)!;
  expect(action).toMatchObject({method:'paramStart',enabled:true,sourceEffect:'unmapped'});
  const context:GenerationInput={time:0,width:810,height:972,quality:'preview',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,405,486,'primary',486)};
  const primary=result(await send({operation:'generate',scene,context}),'generate');
  expect(await send({operation:'source-recording-begin',sourceId:primary.id,options:{width:128,height:96,simulationFps:4,actualFrameRate:37}})).toMatchObject({error:expect.stringContaining('非相机动作'),retainedSourceId:primary.id});
  action.args={value:1};expect(()=>parseProjectFile(serializeScene(scene))).toThrow('未映射源效果');
  delete action.args;scene.timeline.schedule=undefined;expect(()=>parseProjectFile(serializeScene(scene))).toThrow('未映射源效果');
 });
});

// Use the actual Worker, including detached geometry publication. Capturing
// must not consume a queue update, even after an unsuccessful delivery.
describe('Implicit paused capture production transport',()=>{
 for(const detached of [false,true])it(`retries failed capture publication without changing the queue (detached=${detached})`,async ()=>{
  const f=await setup(),start=await begin(f);
  result(await send({operation:'source-recording-frame',recordingId:start.recordingId,displayFrame:1,actualFrameRate:12}),'source-recording-frame');
  const stop=result(await send({operation:'source-recording-finish',recordingId:start.recordingId,timestampMs:1000}),'source-recording-finish');
  const sourceId=stop.id;
  expect(await send({operation:'implicit-paused-capture',sourceId,size:{width:65,height:49},scale:1})).toMatchObject({retainedSourceId:sourceId,error:expect.any(String)});
  result(await send({operation:'implicit-playback',sourceId,paused:true,timestampMs:2000}),'implicit-playback');
  const request={operation:'implicit-paused-capture',sourceId,size:{width:65,height:49},scale:3};
  fail={operation:'implicit-paused-capture',detached};expect(await send(request)).toMatchObject({retainedSourceId:sourceId,error:expect.stringContaining('publication')});
  for(const scale of [1,3,5]){
   const pair=result(await send({...request,scale}),'implicit-paused-capture').result;
   expect(pair.capture.positions.byteLength).toBeGreaterThan(0);
   expect(pair.capture.sourceCameraFrame).toEqual({...stop.result.preview.sourceCameraFrame,viewport:{...stop.result.preview.sourceCameraFrame!.viewport,logicalWidth:66,logicalHeight:50,target:'offscreen'}});
   expect(pair.preview.sourceCameraFrame).toEqual(stop.result.preview.sourceCameraFrame);
   expect(pair.capture.implicitLive).toMatchObject({paused:true,renderKind:'snapshot',actualFrameRate:12});
  }
  expect(await send({...request,size:{width:30000,height:30000}})).toMatchObject({retainedSourceId:sourceId});
  expect(await send({...request,sourceId:sourceId+500})).toMatchObject({retainedSourceId:sourceId});
  result(await send({operation:'implicit-playback',sourceId,paused:false,timestampMs:10000}),'implicit-playback');
  const continued=result(await send({operation:'generate',scene:stop.result.scene,context:{...stop.result.context,implicitLive:{...stop.result.context.implicitLive!,clock:{paused:false,timestampMs:10125}}}}),'generate');
  expect(continued.output.sourceCameraFrame).toMatchObject({sceneTime:.625,frameIndex:2,rawDt:.125});
 });
});

// Persist/reopen the imported authoring model before it crosses the real
// Worker boundary. Every numerical expectation comes from the pinned JVM.
describe('Implicit parameter queue through production Worker',()=>{
 for(const row of [...parameterNative.cases,...formulaNative.cases])it('matches original parameter/camera facts: '+row.name,async ()=>{
  const scene=parseProjectFile(serializeScene(parseProjectFile(JSON.stringify(row.input.project)).scene)).scene;
  const context:GenerationInput={time:0,width:810,height:972,quality:'preview',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,405,486,'primary',486)};
  const primary=result(await send({operation:'generate',scene,context}),'generate');
  let output=primary.output,sourceId=primary.id,recordingId:number|undefined,index=0,paused=false,stop:Awaited<ReturnType<typeof finished>>|undefined;
  async function finished(timestampMs=1000){return result(await send({operation:'source-recording-finish',recordingId,timestampMs}),'source-recording-finish');}
  for(const [i,step]of row.input.steps.entries()){
   if(step.action==='record'){
    if(recordingId===undefined){const begin=result(await send({operation:'source-recording-begin',sourceId,options:{width:128,height:96,simulationFps:row.input.simulationFps,actualFrameRate:step.actualFrameRate}}),'source-recording-begin');recordingId=begin.recordingId;output=begin.result.warmup;}
    else output=result(await send({operation:'source-recording-frame',recordingId,displayFrame:++index,actualFrameRate:step.actualFrameRate}),'source-recording-frame').output;
   }else if(step.action==='stop'){stop=await finished(step.timestampMs);sourceId=stop.id;output=stop.result.preview;}
   else if(step.action==='pause'||step.action==='resume'){paused=step.action==='pause';result(await send({operation:'implicit-playback',sourceId,paused,timestampMs:step.timestampMs}),'implicit-playback');}
   else{
    const next=result(await send({operation:'generate',scene:stop!.result.scene,context:{...stop!.result.context,implicitLive:{...stop!.result.context.implicitLive!,actualFrameRate:step.actualFrameRate,clock:{paused,timestampMs:step.timestampMs}}}}),'generate');output=next.output;sourceId=next.id;
   }
   if(paused){const pair=result(await send({operation:'implicit-paused-capture',sourceId,size:{width:384,height:288},scale:1}),'implicit-paused-capture').result;expect(pair.capture.sourceImplicitParameters).toEqual(pair.preview.sourceImplicitParameters);output=pair.preview;}
   const reference=row.frames[i],{phiRate,thetaRate,gammaRate,...camera}=reference.camera;
   expect(output.sourceCameraFrame).toMatchObject({camera,rates:[phiRate,thetaRate,gammaRate],sceneTime:reference.sceneTime,rawDt:reference.rawDt,queueComplete:reference.complete});
   if('formulas' in reference)expect(output.formulaPresentation!.labels.map(({latex,x,y,scale,color})=>({latex,x,y,scale,color:parseInt(color.slice(1),16)|0xff000000}))).toEqual(reference.formulas);
   const values=output.sourceImplicitParameters!.values;expect(Object.keys(values).sort()).toEqual(Object.keys(reference.parameters).sort());
   for(const [name,value]of Object.entries(reference.parameters))expect(Math.abs(values[name]-value)).toBeLessThanOrEqual(2e-14);
  }
 });
 it('ordinary fixed preview uses the same parameter owner, including seeks and replay',async ()=>{
  const row=parameterNative.cases.find(c=>c.name==='fixed-parameters')!,scene=parseProjectFile(serializeScene(parseProjectFile(JSON.stringify(row.input.project)).scene)).scene;scene.timeline.fps=row.input.simulationFps;
  for(const i of [0,3,10,2,10]){
   const output=result(await send({operation:'generate',scene,context:{time:i/scene.timeline.fps,width:384,height:288,quality:'preview',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,384,288,'offscreen',486)}}),'generate').output;
   const reference=row.frames[i];expect(output.sourceCameraFrame).toMatchObject({sceneTime:reference.sceneTime,queueComplete:reference.complete});
   for(const [name,value]of Object.entries(reference.parameters))expect(Math.abs(output.sourceImplicitParameters!.values[name]-value)).toBeLessThanOrEqual(2e-14);
  }
 });
});
