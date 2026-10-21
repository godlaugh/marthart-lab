import {describe,expect,it} from 'vitest';
import oracle from './fixtures/source-fractal-gradient/source.json';
import {SourceGradientRuntime,type SourceGradientConfiguration,type SourceGradientFrame} from '../src/engine/sourceGradientRuntime';
const fields=['palette','inside','outside'] as const;
const close=(actual:number,expected:number)=>expect(Math.abs(actual-expected)).toBeLessThanOrEqual(Math.max(Number.MIN_VALUE,Math.abs(expected)*Number.EPSILON*8));

/** Original numerical target and animation callbacks, independent of the local
 * scene clock. This adapter only narrows the target's finite values to Float32;
 * it does not generate expected values or claim renderer/JSON integration. */
describe('original Fractal gradient side routing and lifecycle',()=>{
 it.each(oracle.cases)('matches original mode/flags case $id',sample=>{
  let applied=Object.fromEntries(fields.map((key,i)=>[key,Math.fround(sample.initialInput[i])])) as unknown as SourceGradientFrame;
  let dirty=false;
  const runtime=new SourceGradientRuntime(()=>applied,frame=>{
   const next=Object.fromEntries(fields.map(key=>[key,Math.fround(frame[key])])) as unknown as SourceGradientFrame;
   dirty ||= fields.some(key=>next[key]!==applied[key]);applied=next;
  });
  const config:SourceGradientConfiguration={mode:sample.mode.toLowerCase() as SourceGradientConfiguration['mode'],interpolation:sample.interpolation.toLowerCase() as SourceGradientConfiguration['interpolation'],speed:sample.speed,affectInside:sample.inside,affectOutside:sample.outside};
  for(const row of sample.samples){
   dirty=false;
   switch(row.operation){
    case 'initial':break;
    case 'start.update(0)':runtime.begin([{kind:'start',config}]);runtime.interpolate(0,false);break;
    case 'start.update(.25)':runtime.interpolate(.25,false);break;
    case 'animator.update(.125)':runtime.update(Math.fround(.125));break;
    case 'start.update(.75)':runtime.interpolate(1,true);break;
    case 'animator.update(2.75)':runtime.update(Math.fround(2.75));break;
    case 'animator.update(0)':runtime.update(0);break;
    case 'animator.update(-.25)':runtime.update(Math.fround(-.25));break;
    case 'stop.update(.125)':runtime.begin([{kind:'stop'}]);runtime.interpolate(.25,false);break;
    case 'animator.update(.2)':runtime.update(Math.fround(.2));break;
    case 'stop.update(.375)':runtime.interpolate(1,true);break;
    case 'stopped animator.update(.5)':runtime.update(Math.fround(.5));break;
    case 'idle stop.update(.25)':runtime.begin([{kind:'stop'}]);runtime.interpolate(.5,false);break;
    // begin applies twice, whereas direct native start applies once. Fractal's
    // target has no callback smoothing, so only resulting state is compared.
    case 'direct restart':runtime.begin([{kind:'start',config}]);break;
    default:throw Error(`Unmodeled oracle operation ${row.operation}`);
   }
   const state=runtime.snapshot();expect(state.running).toBe(row.running);close(state.progress,row.progress.value);close(state.speedScale,row.speedScale.value);close(state.targetSpeed,row.targetSpeed.value);
   fields.forEach((key,i)=>{close(state.baseOffsets?.[key]??state.base,row.base[i].value);expect(applied[key]).toBe(row.applied[i].value);});
   expect(dirty).toBe(row.dirty);
   if(row.operation!=='initial')fields.forEach((key,i)=>close(runtime.frameAtAge(0)[key],row.frame[i].value));
  }
 });
});
