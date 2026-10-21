import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {prepareSourceDomainScene} from '../src/engine/sourceDomainTimeline';
import {SourceDomainHostSession} from '../src/engine/sourceDomainHostSession';
import fixture from './fixtures/source-domain-clock/live.json';
const bits=(x:number)=>{const v=new DataView(new ArrayBuffer(4));v.setFloat32(0,x);return v.getUint32(0).toString(16).padStart(8,'0');};
describe('Domain host against original realtime Scene and MathArt pause methods',()=>{
 for(const c of fixture.cases)it(c.name,()=>{
  const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Live witness',domainColoring:{formula:'z+a'},...c.input})).scene;
  const plan=prepareSourceDomainScene(scene),i=c.initial;let now=0,reads=0;
  const host=new SourceDomainHostSession({...plan,initial:{...plan.initial,rotation:i.rotation.value,rotationRate:i.rotationRate.value,paletteOffset:i.paletteOffset.value,parameters:{a:i.values.a.value,b:i.values.b.value},settings:{...plan.initial.settings,scale:i.values.scale.value}}},{paused:i.hostPaused,now:()=>{reads++;return now;}});
  for(const row of c.operations){
   reads=0;now=row.requestedMillis;
   const actual=row.operation==='update'?host.update({paused:row.state.hostPaused},row.inputFps.value):row.operation==='togglePause'?host.setPaused(row.state.hostPaused):host.forceResume();
   const s=actual.state,e=row.state,label=`${c.name} operation ${row.index}`;
   expect(reads,label+' millis reads').toBe(row.operationMillisCalls);expect(actual.paused,label+' pause').toBe(e.hostPaused);expect(bits(actual.hostClock.lastTime),label+' wall origin').toBe(e.lastTime.bits);
   expect(bits(s.rotation),label+' rotation').toBe(e.rotation.bits);expect(bits(s.rotationRate),label+' rate').toBe(e.rotationRate.bits);expect(bits(s.clock.sceneTime),label+' scene time').toBe(e.sceneTime.bits);expect(bits(s.clock.rawDt),label+' dt').toBe(e.rawDt.bits);expect(bits(s.paletteOffset),label+' palette').toBe(e.paletteOffset.bits);
   expect(s.parameters.a,label+' a').toBeCloseTo(e.values.a.value,13);expect(s.parameters.b,label+' b').toBe(e.values.b.value);expect(s.clock.queueIndex,label+' queue').toBe(e.queueIndex);expect(s.clock.queueComplete,label+' complete').toBe(e.complete);
  }
 });
});
