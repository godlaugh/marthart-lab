import {describe,expect,it} from 'vitest';
import fixture from './fixtures/source-fractal-apply/source.json';
import capacityFixture from './fixtures/source-fractal-apply/capacity.json';
import {parseProjectFile} from '../src/engine/legacyImport';
import {prepareSourceFractalScene} from '../src/engine/sourceFractalTimeline';
import {SourceFractalSceneRuntime} from '../src/engine/sourceFractalSceneRuntime';

const load=(input:object)=>prepareSourceFractalScene(parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'original apply probe',...input})).scene);
const near=(actual:number,expected:number)=>expect(Math.abs(actual-expected)).toBeLessThanOrEqual(Math.max(1,Math.abs(expected))*3e-13);
const numeric=(row:{value:number;bits:string})=>row.value===0&&/^80+$/.test(row.bits)?-0:row.value;
const values=(rows:readonly {value:number;bits:string}[])=>rows.map(numeric);
function configuration(index:number,source:typeof fixture|typeof capacityFixture=fixture){
 const input=source.initialInput,c=load({type:'FRACTAL',fractal:{formula_id:input.formula,type:input.fractalType,power:input.powerBeforeBinder,parameters:input.parameters},timeline:source.cases[index].input.timeline});
 // Explicit JNI probe seeds; these rates/offsets are not product defaults.
 Object.assign(c.initial,{centerX:input.center[0],centerXLow:input.center[1],centerY:input.center[2],centerYLow:input.center[3],zoom:input.zoom,rotation:input.rotation,rotationRate:input.rotationRate,iterations:input.iterations,ambientRates:[...input.ambientRates]});
 return{...c,gradient:{palette:input.gradient[0],inside:input.gradient[1],outside:input.gradient[2]},cameraAngles:[0,0,0] as const,fps:input.frameRate};
}
function compare(runtime:SourceFractalSceneRuntime,expected:typeof fixture.cases[number]['initial']){
 const a=runtime.snapshot(),s=a.scene,o=s.object,p=expected.fractalProperties;
 expect(s.sceneTime).toBe(expected.sceneTime.value);expect(s.queueIndex).toBe(expected.managerIndex);expect(s.queueComplete).toBe(expected.managerFinished);
 expect(o.rotation).toBe(expected.fractalRotation.value);expect(o.currentTime).toBe(expected.fractalTime.value);expect(s.cameraAngles[1]).toBe(expected.cameraTheta.value);
 for(const [i,key]of (['zoom','centerX','centerXLow','centerY','centerYLow'] as const).entries())near(o[key],expected.viewport[i].value);
 expect(o.ambientAngles).toEqual(values(expected.ambientAngles));expect(o.rotationRate).toBe(p.rotationRate.value);expect(o.ambientRates).toEqual([p.ambientPhiRate.value,p.ambientThetaRate.value,p.ambientGammaRate.value]);
 expect(o.iterations).toBe(p.iterations);expect(o.bailout).toBe(p.bailout.value);expect(o.juliaReal).toBe(p.juliaCx.value);expect(o.juliaImag).toBe(p.juliaCy.value);
 expect(a.formula.formulaId).toBe(expected.activeFormulaId);
 expect(a.parameters.running).toBe(expected.parameterAnimator.running);expect(a.parameters.entries.length).toBe(expected.parameterAnimator.paramConfigsCount);
 expect(a.formula.native.power).toBe(expected.formula.power);expect(a.formula.native.formulaParams).toEqual(values(expected.formula.formulaParams));expect(a.formula.native.dynamicParams).toEqual(values(expected.formula.dynamicParams));
 expect(a.formula.parameters.floats).toEqual(Object.fromEntries(Object.entries(expected.formula.storedFloats).map(([k,v])=>[k,v.value])));
 expect(Object.keys(a.formula.parameters.complex).sort()).toEqual(Object.keys(expected.formula.storedComplex).sort());
 for(const[k,rows]of Object.entries(expected.formula.storedComplex))rows.forEach((v,i)=>near(a.formula.parameters.complex[k][i],v.value));
 expect(a.gradient.running).toBe(expected.gradient.running);near(a.gradient.progress,expected.gradient.progress.value);expect(a.gradient.speedScale).toBe(numeric(expected.gradient.speedScale));
 expect(a.gradient.targetSpeed).toBe(numeric(expected.gradient.targetSpeed));
 if(a.gradient.baseOffsets)expect(a.gradient.baseOffsets).toEqual({palette:numeric(expected.gradient.basePaletteOffset),inside:numeric(expected.gradient.baseInsideOffset),outside:numeric(expected.gradient.baseOutsideOffset)});
 expect([a.offsets.palette,a.offsets.inside,a.offsets.outside]).toEqual(values(expected.gradient.offsets));
}
describe('original same-instance Fractal applyConfig chain through public configuration parsing',()=>{
 for(const [kind,source] of [['apply',fixture],['retained-capacity',capacityFixture]] as const)for(const sample of source.cases)it(`preserves original state and update order: ${kind}/${sample.id}`,()=>{
  const runtime=new SourceFractalSceneRuntime(configuration(sample.id,source),{reserve(){}});compare(runtime,sample.initial);
  for(const row of sample.frames){
   if(row.index===sample.applyBeforeFrame){
    compare(runtime,row.beforeApply!);const before=runtime.snapshot();
    runtime.applyConfiguration(load(sample.applyInput));compare(runtime,row.afterApply!);
    const after=runtime.snapshot();expect(after.scene.sceneTime).toBe(before.scene.sceneTime);expect(after.scene.queueIndex).toBe(before.scene.queueIndex);expect(after.scene.clipRuntime).toBe(before.scene.clipRuntime);expect(after.scene.cameraAngles).toEqual(before.scene.cameraAngles);expect(after.scene.cameraRates).toEqual(before.scene.cameraRates);
    expect(after.parameters.running).toBe(false);expect(after.parameters.entries).toEqual([]);expect(after.parameters.children).toEqual(before.parameters.children);
   }
   runtime.clock.step(row.rawStep.value,row.paused);compare(runtime,row.state);
   if('order' in row.state.parameterAnimator)expect(runtime.snapshot().parameters.entries.map(e=>e.name)).toEqual(row.state.parameterAnimator.order);
  }
 });
 it('rejects malformed replacements before mutation and invalidates partial mutation on budget failure',()=>{
  let fail=false;const runtime=new SourceFractalSceneRuntime(configuration(0),{reserve(){if(fail)throw Error('budget');}});
  runtime.clock.step(.05);const before=runtime.snapshot(),next=load(fixture.cases[0].applyInput);
  expect(()=>runtime.applyConfiguration({...next,gradient:{...next.gradient,inside:Infinity}})).toThrow();expect(runtime.snapshot()).toEqual(before);
  expect(()=>runtime.applyConfiguration({...next,initial:{...next.initial,centerX:NaN}})).toThrow();expect(runtime.snapshot()).toEqual(before);
  fail=true;expect(()=>runtime.applyConfiguration(next)).toThrow('budget');expect(()=>runtime.snapshot()).toThrow('需要重建');
 });
 it('restores only camera angles without advancing the queue or changing object motion',()=>{
  const runtime=new SourceFractalSceneRuntime(configuration(0),{reserve(){}});runtime.clock.step(.05);
  const before=runtime.snapshot();runtime.clock.writeCameraAngles([.2,.3,.4]);const after=runtime.snapshot();
  expect(after).toEqual({...before,scene:{...before.scene,cameraAngles:[.2,.3,.4].map(Math.fround)}});
  expect(()=>runtime.clock.writeCameraAngles([0,Infinity,0])).toThrow();expect(runtime.snapshot()).toEqual(after);
 });
 it('takes explicit host frame rate independently of dt and applies the original <=1 fallback',()=>{
  const c=configuration(0),a=new SourceFractalSceneRuntime(c,{reserve(){}}),b=new SourceFractalSceneRuntime(c,{reserve(){}});
  a.setEffectiveFrameRate(0);b.setEffectiveFrameRate(60);a.clock.step(.05);b.clock.step(.05);expect(a.snapshot()).toEqual(b.snapshot());
  const before=a.snapshot();for(const fps of [NaN,Infinity,-Infinity,1e100])expect(()=>a.setEffectiveFrameRate(fps)).toThrow();expect(a.snapshot()).toEqual(before);
  a.setEffectiveFrameRate(120);a.clock.step(.05);b.clock.step(.05);expect(a.snapshot().formula.parameters).not.toEqual(b.snapshot().formula.parameters);
 });
});
