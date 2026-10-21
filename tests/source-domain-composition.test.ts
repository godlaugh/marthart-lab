import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {prepareSourceDomainScene} from '../src/engine/sourceDomainTimeline';
import {SourceDomainSceneRuntime} from '../src/engine/sourceDomainSceneRuntime';
import fixture from './fixtures/source-domain-clock/active.json';

const bits=(value:number)=>{const v=new DataView(new ArrayBuffer(4));v.setFloat32(0,value);return v.getUint32(0).toString(16).padStart(8,'0');};
describe('composed Domain source Scene against original active JNI traces',()=>{
 for(const c of fixture.cases)it(c.name,()=>{
  const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Original active trace',domainColoring:{formula:'z+a'},...c.input})).scene;
  const plan=prepareSourceDomainScene(scene),initial=c.initial;
  const curve=initial.curve.fields;
  const runtime=new SourceDomainSceneRuntime({...plan,parameterFps:initial.pAppletFrameRate.value,initial:{rotation:initial.rotation.value,rotationRate:initial.rotationRate.value,paletteOffset:initial.paletteOffset.value,
   parameters:Object.fromEntries(initial.formulaParams.map(p=>[p.key,p.value.value])),
   settings:{...plan.initial.settings,scale:initial.values.scale.value,curveMode:curve.mode,phaseDensity:curve.phaseDensity.value,modDensity:curve.modDensity.value,phaseSharpness:curve.phaseSharpness.value,modSharpness:curve.modSharpness.value,curveBias:curve.bias.value,curveMix:curve.mix.value}}},{reserve:()=>{}});
  for(const row of c.frames){
   const expected=row.state;runtime.setParameterFrameRate(expected.pAppletFrameRate.value);
   const out=runtime.step(row.inputStep.value,row.paused),label=`case ${c.id} frame ${row.index}`;
   expect(bits(out.rotation),label+' rotation').toBe(expected.rotation.bits);
   expect(bits(out.rotationRate),label+' rate').toBe(expected.rotationRate.bits);
   expect(bits(out.clock.sceneTime),label+' time').toBe(expected.sceneTime.bits);
   expect(out.clock.queueIndex,label+' queue').toBe(expected.queueIndex);expect(out.clock.queueComplete).toBe(expected.complete);
   expect(bits(out.paletteOffset),label+' palette').toBe(expected.paletteOffset.bits);
   for(const value of expected.formulaParams)expect(out.parameters[value.key],label+' parameter '+value.key).toBeCloseTo(value.value.value,13);
   expect(out.settings.scale,label+' scale').toBeCloseTo(expected.values.scale.value,13);
   for(const key of ['phaseDensity','modDensity','phaseSharpness','modSharpness'] as const)expect(bits(Number(out.settings[key])),label+' curve '+key).toBe(expected.curve.fields[key].bits);
   const gradient=expected.gradientAnimator.fields.state.fields;
   expect(out.gradient.running,label+' gradient running').toBe(gradient.running);
   for(const key of ['progress','speedScale','targetSpeed'] as const)expect(out.gradient[key],label+' gradient '+key).toBeCloseTo(gradient[key].value,13);
   expect(out.parameterState.running,label+' parameter running').toBe(expected.parameterAnimator.fields.running);
  }
 });
});
