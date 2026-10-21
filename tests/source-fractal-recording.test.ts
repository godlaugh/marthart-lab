import {afterEach,describe,expect,it,vi} from 'vitest';
import clockOracle from './fixtures/source-fractal-clock/source.json';
import runtimeOracle from './fixtures/source-fractal-runtime/source.json';
import {parseProjectFile} from '../src/engine/legacyImport';
import {sceneAtTime} from '../src/engine/timeline';
import {planFractalFreshRecording,planFractalRecordingClock,withFractalFreshRecording,validateFractalRecordingFrameInput,fractalRecordingFrameInput,fractalRecordingFrameFacts,assertFractalRecordingFrame} from '../src/engine/sourceFractalRecording';
import {SourceFractalParameterRuntime} from '../src/engine/sourceFractalParameterRuntime';
import {SourceFractalFormulaRuntime} from '../src/engine/sourceFractalFormulaRuntime';
import {SourceGradientRuntime} from '../src/engine/sourceGradientRuntime';
import {definitions} from '../src/scenes/complex';
import {fractalGpu} from '../src/engine/fractalGpu';
import type {GenerateContext,RasterOutput,SceneOutput} from '../src/types';
import {generateScene} from '../src/engine/temporal';

const source=(timeline:unknown[]=[])=>parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'FRACTAL',name:'fresh recording',fractal:{formula_id:'newton',parameters:runtimeOracle.initialInput.parameters},timeline})).scene;
const options={simulationFps:24,encoderFps:7};
const parameter=(step=.1)=>source([{type:'animate',duration:.001,actions:[{method:'paramStart',args:{parameters:{exponent_re:{min:2,max:4,step}}}}]}]);
afterEach(()=>{vi.restoreAllMocks();fractalGpu.dispose();});

describe('fresh source Fractal recording planning and delivered ordinals',()=>{
 it('stops on the original fixed24 completion display after one discarded warmup',()=>{
  const sample=clockOracle.cases[4],scene=source(sample.input.timeline),before=structuredClone(scene),last=sample.frames.find(row=>row.state.autoRecordingComplete)!.index;
  const plan=planFractalFreshRecording(scene,options);
  expect(last).toBe(12);
  expect(plan).toMatchObject({policy:'fresh-local-source-queue-replay',simulationFps:24,encoderFps:7,warmupUpdates:1,updates:13,encodedFrames:12,firstEncodedUpdate:2,lastDisplayFrame:12,completionReason:'animation-queue'});
  expect(plan.workUnits).toBeGreaterThanOrEqual(plan.updates);expect(plan).not.toHaveProperty('finalFrame');expect(scene).toEqual(before);
  expect(fractalRecordingFrameInput(plan,0)).toEqual({displayFrame:0,simulationFps:24});
  expect(fractalRecordingFrameInput(plan,last)).toEqual({displayFrame:last,simulationFps:24});
  expect(()=>fractalRecordingFrameInput(plan,last+1)).toThrow('完成规划');
 });
 it.each([{timeline:[]},{timeline:[{type:'wait',duration:0}]},{timeline:[{type:'wait',duration:-2}]}])('renders one warmup and encodes no frames for an immediately completed queue $timeline',({timeline})=>{
  expect(planFractalRecordingClock(source(timeline),60)).toMatchObject({updates:1,encodedFrames:0,firstEncodedUpdate:null,lastDisplayFrame:0});
 });
 it('executes the real parameter mapper and gradient owners while sharing the planning budget',()=>{
  // These are observed local fixed60 executions of the fixture's real coupled
  // configuration. The fixture's variable/paused dt rows remain separate goldens.
  const parameterUpdate=vi.spyOn(SourceFractalParameterRuntime.prototype,'update');
  const gradientUpdate=vi.spyOn(SourceGradientRuntime.prototype,'update');
  const writes=vi.spyOn(SourceFractalFormulaRuntime.prototype,'writeScalar');
  const coupled=source(runtimeOracle.cases[1].input.timeline),before=structuredClone(coupled);
  const plan=planFractalFreshRecording(coupled,{simulationFps:60,encoderFps:24});
  expect(parameterUpdate).toHaveBeenCalled();expect(gradientUpdate).toHaveBeenCalled();expect(writes).toHaveBeenCalled();
  expect(parameterUpdate).toHaveBeenCalledTimes(plan.updates+1);expect(gradientUpdate).toHaveBeenCalledTimes(plan.updates+1);
  expect(parameterUpdate.mock.calls.every(([,fps])=>fps===60)).toBe(true);
  expect((parameterUpdate.mock.contexts.at(-1)! as SourceFractalParameterRuntime).snapshot().running).toBe(true);
  const gradient=(gradientUpdate.mock.contexts.at(-1)! as SourceGradientRuntime).snapshot();expect(gradient.running).toBe(true);expect(gradient.progress).toBeGreaterThan(0);
  const native=(writes.mock.contexts.at(-1)! as SourceFractalFormulaRuntime).nativeState();expect(native.dynamicParams[0]).not.toBe(3);expect(native.dynamicParams[2]).not.toBe(1);
  const bare=source([{type:'animate',duration:.15,actions:[]}]);
  expect(plan.workUnits).toBeGreaterThan(planFractalFreshRecording(bare,{simulationFps:60,encoderFps:24}).workUnits);
  expect(coupled).toEqual(before);
 });
 it('separates encoder fps and clears evaluated facts without mutating the authored scene',()=>{
  const scene=source(clockOracle.cases[4].input.timeline),before=structuredClone(scene);
  const a=planFractalFreshRecording(scene,options),b=planFractalFreshRecording(scene,{...options,encoderFps:120});
  expect({...a,encoderFps:120}).toEqual(b);expect(scene).toEqual(before);
  const evaluated=sceneAtTime(scene,.1),fresh=withFractalFreshRecording(evaluated,24);
  expect(fresh.timeline.fps).toBe(24);expect(fresh.evaluatedFractalScene).toBeUndefined();expect(fresh.evaluatedFractalGradient).toBeUndefined();expect(evaluated.evaluatedFractalScene).toBeDefined();
 });
 it('rejects malformed configurations, non-integer rates and cancellation before planning',()=>{
  const scene=source([{type:'wait',duration:1}]);
  for(const rate of [NaN,Infinity,0,121,1.5]){
   expect(()=>planFractalFreshRecording(scene,{...options,simulationFps:rate})).toThrow('模拟帧率');
   expect(()=>planFractalFreshRecording(scene,{...options,encoderFps:rate})).toThrow('编码帧率');
  }
  expect(()=>withFractalFreshRecording({...scene,fractalSource:undefined},24)).toThrow('完整配置');
  const bad=structuredClone(scene);bad.timeline.tracks[0].actions=[];
  expect(()=>planFractalFreshRecording(bad,options)).toThrow('混用');
  expect(()=>planFractalFreshRecording(scene,{...options,isCancelled:()=>true})).toThrow(expect.objectContaining({name:'AbortError'}));
 });
 it('cancels inside real phase work and uses a fresh scene for the next request',()=>{
  const scene=parameter(1e8),before=structuredClone(scene);let checks=0;
  expect(()=>planFractalFreshRecording(scene,{...options,isCancelled:()=>++checks>200})).toThrow(expect.objectContaining({name:'AbortError'}));
  expect(checks).toBeGreaterThan(200);expect(scene).toEqual(before);
  const valid=parameter();expect(planFractalFreshRecording(valid,options).updates).toBe(1);
 });
 it('bounds parameter phase loops together with clock work even for a one-frame queue',()=>{
  expect(()=>planFractalFreshRecording(parameter(1e8),options)).toThrow(expect.objectContaining({code:'capacity',message:expect.stringContaining('共享')}));
  expect(planFractalFreshRecording(parameter(),options).updates).toBe(1);
 });
 it('requires facts from the exact evaluated ordinal and simulation rate',()=>{
  const scene=withFractalFreshRecording(source([{type:'wait',duration:1}]),24),frame=sceneAtTime(scene,0).evaluatedFractalScene!;
  expect(fractalRecordingFrameFacts(frame,{displayFrame:0,simulationFps:24})).toMatchObject({displayFrame:0,simulationFps:24,warmup:true,complete:false,queueIndex:0});
  for(const input of [{displayFrame:1,simulationFps:24},{displayFrame:0,simulationFps:60},{displayFrame:.5,simulationFps:24}])expect(()=>fractalRecordingFrameFacts(frame,input)).toThrow();
  expect(()=>fractalRecordingFrameFacts({...frame,simulationFps:1.5},{displayFrame:0,simulationFps:1.5})).toThrow('模拟帧率');
 });
 it('validates unknown recording requests before callers start replay or rendering',()=>{
  for(const input of [undefined,null,false,24,'frame',[],[0,24],{},
   {displayFrame:0,simulationFps:'24'},
   ...[undefined,null,NaN,Infinity,0,121,1.5].map(simulationFps=>({displayFrame:0,simulationFps})),
   ...[undefined,null,'0',NaN,Infinity,-1,.5,Number.MAX_SAFE_INTEGER,86400*24+1].map(displayFrame=>({displayFrame,simulationFps:24})),
  ])expect(()=>validateFractalRecordingFrameInput(input)).toThrow(expect.objectContaining({code:'input'}));
  const input={displayFrame:86400*24,simulationFps:24},validated=validateFractalRecordingFrameInput(input);
  expect(validated).toEqual(input);expect(validated).not.toBe(input);
  input.displayFrame=0;expect(validated.displayFrame).toBe(86400*24);
  const clock=planFractalRecordingClock(source(),24);
  expect(()=>fractalRecordingFrameInput({...clock,simulationFps:1.5},0)).toThrow('模拟帧率');
 });
 it('rejects malformed public generation requests before invoking the scene renderer',()=>{
  const scene=source(),render=vi.spyOn(definitions.find(d=>d.kind==='fractal')!,'generate');
  const context={time:0,width:3,height:2,quality:'export' as const};
  for(const input of [null,[],{displayFrame:0,simulationFps:'24'},{displayFrame:.5,simulationFps:24}]){
   expect(()=>generateScene(scene,{...context,fractalRecording:input} as GenerateContext)).toThrow();
  }
  scene.timeline.fps=1.5;
  expect(()=>generateScene(scene,{...context,fractalRecording:{displayFrame:0,simulationFps:1.5}})).toThrow('模拟帧率');
  expect(render).not.toHaveBeenCalled();
 });
 it('rejects missing render facts, wrong ordinal, rate, warmup, early/late completion and raster size',()=>{
  const scene=withFractalFreshRecording(source([{type:'wait',duration:.001},{type:'wait',duration:.001}]),24),plan=planFractalFreshRecording(scene,options),evaluated=sceneAtTime(scene,0),frame=evaluated.evaluatedFractalScene!;
  vi.spyOn(fractalGpu,'sample').mockImplementation(points=>({values:new Float32Array(points.length*4),sourceRGBA:new Uint8Array(points.length*2).fill(255)}));
  // Production render-fact construction with a sampled-GPU test double. This
  // test proves the delivery contract, not native GL pixels or encoder behavior.
  evaluated.settings.fractalBackend='webgl2';evaluated.settings.renderMethod='one-pass';
  const output=definitions.find(d=>d.kind==='fractal')!.generate(evaluated,{time:0,width:3,height:2,quality:'export'}) as SceneOutput&RasterOutput;
  output.fractalRecording=fractalRecordingFrameFacts(frame,fractalRecordingFrameInput(plan,0));
  expect(()=>assertFractalRecordingFrame(output,plan,0)).not.toThrow();
  for(const facts of [undefined,{...output.fractalRecording,displayFrame:1},{...output.fractalRecording,simulationFps:60},{...output.fractalRecording,warmup:false},{...output.fractalRecording,complete:true}])expect(()=>assertFractalRecordingFrame({...output,fractalRecording:facts},plan,0)).toThrow();
  expect(()=>assertFractalRecordingFrame({...output,fractalRender:undefined},plan,0)).toThrow();
  expect(()=>assertFractalRecordingFrame({type:'geometry',positions:new Float32Array(),topology:'points',stats:{generated:0,samples:0,invalid:0}},plan,0)).toThrow('栅格帧');
  expect(()=>assertFractalRecordingFrame({...output,width:4},plan,0)).toThrow();
  const finalScene=sceneAtTime(scene,plan.lastDisplayFrame/24),final=finalScene.evaluatedFractalScene!;
  const complete=definitions.find(d=>d.kind==='fractal')!.generate(finalScene,{time:plan.lastDisplayFrame/24,width:3,height:2,quality:'export'}) as SceneOutput&RasterOutput;
  complete.fractalRecording=fractalRecordingFrameFacts(final,fractalRecordingFrameInput(plan,plan.lastDisplayFrame));
  expect(()=>assertFractalRecordingFrame(complete,plan,plan.lastDisplayFrame)).not.toThrow();
  expect(()=>assertFractalRecordingFrame({...complete,fractalRecording:{...complete.fractalRecording!,complete:false}},plan,plan.lastDisplayFrame)).toThrow();
 });
});
