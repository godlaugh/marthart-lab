import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {prepareSourceDomainScene} from '../src/engine/sourceDomainTimeline';
import {SourceDomainHostSession} from '../src/engine/sourceDomainHostSession';
import fixture from './fixtures/source-domain-clock/recording.json';
const bits=(x:number)=>{const v=new DataView(new ArrayBuffer(4));v.setFloat32(0,x);return v.getUint32(0).toString(16).padStart(8,'0');};
describe('Domain numerical recording against original MathArt JVM',()=>{
 for(const c of fixture.cases)it(c.name,()=>{
  const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Recording witness',domainColoring:{formula:'z+a'},...c.input})).scene;
  const plan=prepareSourceDomainScene(scene),i=c.initial;
  const host=new SourceDomainHostSession({...plan,initial:{...plan.initial,rotation:i.rotation.value,rotationRate:i.rotationRate.value,paletteOffset:i.paletteOffset.value,parameters:{a:i.values.a.value,b:i.values.b.value},settings:{...plan.initial.settings,scale:i.values.scale.value}}});
  const {handle,warmup}=host.beginRecording(60,c.frames[0].state.pAppletFrameRate.value);
  let offered=0;
  for(const row of c.frames){
   const actual=row.index===0?warmup:host.nextRecordingFrame(handle,row.index,row.state.pAppletFrameRate.value),s=actual.state,e=row.state;
   expect(bits(s.rotation)).toBe(e.rotation.bits);expect(bits(s.rotationRate)).toBe(e.rotationRate.bits);expect(bits(s.clock.sceneTime)).toBe(e.sceneTime.bits);expect(bits(s.clock.rawDt)).toBe(e.rawDt.bits);expect(bits(s.paletteOffset)).toBe(e.paletteOffset.bits);
   expect(s.parameters.a).toBeCloseTo(e.values.a.value,13);expect(s.parameters.b).toBe(e.values.b.value);expect(s.parameterFps).toBe(e.pAppletFrameRate.value);expect(s.clock.queueIndex).toBe(e.queueIndex);expect(actual.recording?.complete).toBe(row.actualAutoRecordingComplete);
   expect(e.effectiveMathArtFps.value).toBe(60);if(row.index>0)offered++;
  }
  // Count is an explicitly modeled warmup policy, not original encoded output.
  expect(offered).toBe(c.derivedOfferedFrames);expect(host.snapshot().recording?.complete).toBe(true);
 });
});
