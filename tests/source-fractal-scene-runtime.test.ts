import {describe,expect,it} from 'vitest';
import fixture from './fixtures/source-fractal-runtime/source.json';
import {importSourceFractalActions} from '../src/engine/sourceFractalActionConfig';
import {importSourceFractalFormulaConfiguration} from '../src/engine/sourceFractalFormulaRuntime';
import {prepareRootsSourceMemberOrder} from '../src/engine/rootsSourceOrder';
import {SourceFractalSceneRuntime,type SourceFractalSceneRuntimeConfiguration,type SourceFractalRuntimeClip} from '../src/engine/sourceFractalSceneRuntime';
import {SourceFractalPlaybackSession} from '../src/engine/sourceFractalPlayback';

function configuration(index:number):SourceFractalSceneRuntimeConfiguration {
 const input=fixture.initialInput;
 const imported=importSourceFractalFormulaConfiguration({formula_id:input.formula,type:input.fractalType,power:input.powerBeforeBinder,parameters:input.parameters});
 if(!imported.ok)throw Error(imported.error.reason);
 const clips=fixture.cases[index].input.timeline.map((clip):SourceFractalRuntimeClip=>{
  if(clip.type==='wait')return{kind:'wait',duration:clip.duration};
  const actions='actions'in clip?clip.actions:undefined;
  const parsed=importSourceFractalActions(actions,{memberOrder:path=>{
   let raw:unknown=actions;for(const key of path)raw=(raw as Record<string,unknown>)[key];
   const order=prepareRootsSourceMemberOrder(Object.keys(raw as object));if(!order.ok)throw Error(order.error.kind);return order.value.keys;
  }});
  if(!parsed.ok)throw Error(parsed.error.reason);
  return{kind:'animate',duration:clip.duration,easing:'linear',targets:parsed.value.targets,parameters:parsed.value.parameters,gradient:parsed.value.gradient};
 });
 return{
  initial:{centerX:input.center[0],centerXLow:input.center[1],centerY:input.center[2],centerYLow:input.center[3],zoom:input.zoom,
   rotation:input.rotation,rotationRate:input.rotationRate,iterations:input.iterations,bailout:input.bailoutBeforeBinder,
   juliaReal:input.juliaBeforeBinder[0],juliaImag:input.juliaBeforeBinder[1],ambientAngles:[0,0,0],ambientRates:[...input.ambientRates] as [number,number,number],currentTime:0},
  formula:imported.value.configuration,gradient:{palette:input.gradient[0],inside:input.gradient[1],outside:input.gradient[2]},clips,fps:input.frameRate,
 };
}
const values=(rows:readonly {value:number}[])=>rows.map(row=>row.value);
const near=(actual:number,expected:number)=>expect(Math.abs(actual-expected)).toBeLessThanOrEqual(Math.max(1,Math.abs(expected))*3e-13);
function compare(runtime:SourceFractalSceneRuntime,expected:typeof fixture.cases[number]['initial']){
 const actual=runtime.snapshot(),scene=actual.scene,o=scene.object,p=expected.fractalProperties;
 expect(scene.sceneTime).toBe(expected.sceneTime.value);expect(scene.queueIndex).toBe(expected.managerIndex);expect(scene.queueComplete).toBe(expected.managerFinished);
 expect(o.rotation).toBe(expected.fractalRotation.value);expect(o.currentTime).toBe(expected.fractalTime.value);expect(scene.cameraAngles[1]).toBe(expected.cameraTheta.value);
 expect([o.zoom,o.centerX,o.centerXLow,o.centerY,o.centerYLow]).toEqual(values(expected.viewport));
 expect(o.rotationRate).toBe(p.rotationRate.value);expect(o.ambientRates).toEqual([p.ambientPhiRate.value,p.ambientThetaRate.value,p.ambientGammaRate.value]);
 expect(o.iterations).toBe(p.iterations);expect(o.bailout).toBe(p.bailout.value);expect(o.juliaReal).toBe(p.juliaCx.value);expect(o.juliaImag).toBe(p.juliaCy.value);
 expect(actual.formula.native.power).toBe(expected.formula.power);expect(actual.formula.native.formulaParams).toEqual(values(expected.formula.formulaParams));expect(actual.formula.native.dynamicParams).toEqual(values(expected.formula.dynamicParams));
 expect(actual.formula.parameters.floats).toEqual(Object.fromEntries(Object.entries(expected.formula.storedFloats).map(([key,row])=>[key,row.value])));
 expect(Object.keys(actual.formula.parameters.complex).sort()).toEqual(Object.keys(expected.formula.storedComplex).sort());
 for(const[key,rows]of Object.entries(expected.formula.storedComplex))rows.forEach((row,i)=>near(actual.formula.parameters.complex[key][i],row.value));
 expect(actual.gradient.running).toBe(expected.gradient.running);near(actual.gradient.progress,expected.gradient.progress.value);expect(actual.gradient.speedScale).toBe(expected.gradient.speedScale.value);
 expect([actual.offsets.palette,actual.offsets.inside,actual.offsets.outside]).toEqual(values(expected.gradient.offsets));
}
describe('original complete Fractal numerical scene chain',()=>{
 for(const sample of fixture.cases)it(`matches original Scene, parameter remapping and gradient together: ${sample.id}`,()=>{
  const runtime=new SourceFractalSceneRuntime(configuration(sample.id),{reserve(){}});compare(runtime,sample.initial);
  for(const row of sample.frames){runtime.clock.step(row.rawStep.value,row.paused);compare(runtime,row.state);expect(runtime.snapshot().scene.managerFinishedAtFrameStart).toBe(row.state.managerFinishedAtFrameStart);}
 });
 it('reconstructs the whole parameter and gradient state on backward seeks',()=>{
  let runtime:SourceFractalSceneRuntime,created=0;
  const playback=new SourceFractalPlaybackSession({fps:60,createScene:()=>{created++;runtime=new SourceFractalSceneRuntime(configuration(1),{reserve(){}});return runtime.clock;}});
  playback.evaluate(0);const first=runtime!.snapshot();playback.evaluate(.2);expect(runtime!.snapshot()).not.toEqual(first);
  playback.evaluate(0);expect(created).toBe(2);expect(runtime!.snapshot()).toEqual(first);
 });
 it('preserves the mapper bailout floor until an ordinary setter actually writes',()=>{
  const config=configuration(0);
  const formula={...config.formula,parameters:{floats:{bailout:1e-12,relaxation:1},complex:{exponent:[3,0] as const}}};
  const runtime=new SourceFractalSceneRuntime({...config,formula,clips:[{kind:'wait',duration:1},{kind:'animate',duration:1,easing:'linear',targets:{bailout:0}}]},{reserve(){}});
  expect(runtime.snapshot().scene.object.bailout).toBe(Math.fround(1e-12));runtime.clock.step(.5);expect(runtime.snapshot().scene.object.bailout).toBe(Math.fround(1e-12));
  runtime.clock.step(.5);runtime.clock.step(.5);expect(runtime.snapshot().scene.object.bailout).toBe(Math.fround(1e-6));
 });
 it('rejects partial snapshots after a child budget failure, and reconstructs cleanly',()=>{
  let reject=true;
  let runtime:SourceFractalSceneRuntime;
  const playback=new SourceFractalPlaybackSession({fps:60,createScene:()=>{runtime=new SourceFractalSceneRuntime(configuration(0),{reserve(){if(reject)throw Error('budget exhausted');}});return runtime.clock;}});
  expect(()=>playback.evaluate(.1)).toThrow('budget exhausted');expect(()=>runtime!.snapshot()).toThrow('失败');
  reject=false;expect(()=>playback.snapshot()).toThrow('重置');playback.reset();expect(()=>playback.evaluate(.1)).not.toThrow();
 });
});
