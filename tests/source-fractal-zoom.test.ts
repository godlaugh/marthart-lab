import {describe,it,expect} from 'vitest';
import fixture from './fixtures/source-fractal-zoom/source.json';
import {evaluateSourceFractalZoom,parseSourceFractalZoomTarget,normalizeSourceFractalCenter,type SourceFractalZoomState,type SourceFractalZoomTarget} from '../src/engine/sourceFractalZoom';
const fields=['zoom','centerX','centerXLow','centerY','centerYLow'] as const;
const target=(changes:Partial<SourceFractalZoomTarget>={}):SourceFractalZoomTarget=>({model:'mathart-1.7.8-target',zoom:100,maxZoom:1e300,centerX:1,centerXLow:0,centerY:-1,centerYLow:0,...changes});
const start:SourceFractalZoomState={zoom:1,centerX:0,centerXLow:0,centerY:0,centerYLow:0};
function check(actual:SourceFractalZoomState,expected:SourceFractalZoomState){
 for(const key of fields){
  // Transcendental Java Math / V8 last bits can differ. Low coordinates retain
  // sub-double information; compare them at their own scale, not the high part.
  const tolerance=Math.max(Number.MIN_VALUE,Math.abs(expected[key])*Number.EPSILON*8);
  expect(Math.abs(actual[key]-expected[key]),key).toBeLessThanOrEqual(tolerance);
 }
}
describe('original FractalZoomTargetAnimation numerical owner',()=>{
 it.each(fixture.samples)('matches original JVM $id',sample=>{
  const parsed=parseSourceFractalZoomTarget(sample.target);expect(parsed.ok).toBe(true);if(!parsed.ok)return;
  const out=evaluateSourceFractalZoom(sample.start,parsed.value,sample.easing,sample.progress);expect(out.ok).toBe(true);if(out.ok)check(out.value,sample.output);
 });
 it('uses captured start and the source float update trace rather than constructor-time state',()=>{
  const data=fixture.updateTrace;
  for(const frame of data.results){
   const out=evaluateSourceFractalZoom(data.capturedStart,data.target as SourceFractalZoomTarget,'LINEAR',Math.min(1,Math.fround(frame.runTime/data.duration)));
   expect(out.ok).toBe(true);if(out.ok)check(out.value,Object.fromEntries(fields.map((k,i)=>[k,frame.state[i].value])) as unknown as SourceFractalZoomState);
  }
 });
 it('normalizes initial native viewport parts before omitted target fallback',()=>{
  const {parseInitial,parseTargets}=fixture;
  const native=parseTargets[0].target!;
  expect(normalizeSourceFractalCenter(parseInitial.centerX,parseInitial.centerXLow)).toEqual([native[1].value,native[2].value]);
  expect(normalizeSourceFractalCenter(parseInitial.centerY,parseInitial.centerYLow)).toEqual([native[3].value,native[4].value]);
 });
 it('center progress uses unclipped target zoom, while final zoom observes maxZoom',()=>{
  const out=evaluateSourceFractalZoom(start,target({maxZoom:3}),'linear',.5);expect(out.ok).toBe(true);if(out.ok){expect(out.value.zoom).toBe(3);expect(out.value.centerX).toBeCloseTo(10/11,14);}
 });
 it('clamps easing overshoot but does not force non-endpoint easings to the target on finish',()=>{
  const overshoot=evaluateSourceFractalZoom(start,target(),'back-out',.7),finish=evaluateSourceFractalZoom(start,target(),'there-and-back',1);
  expect(overshoot.ok).toBe(true);if(overshoot.ok)expect(overshoot.value.centerX).toBe(1);
  expect(finish.ok).toBe(true);if(finish.ok)expect(finish.value).toEqual(start);
 });
 it('rejects malformed targets and unsupported numerical outputs without mutating inputs',()=>{
  for(const raw of [null,{},target({zoom:0}),target({maxZoom:0}),target({centerX:NaN}),{...target(),unexpected:true}])expect(parseSourceFractalZoomTarget(raw).ok).toBe(false);
  const before=structuredClone(start),t=target({zoom:1e100});expect(evaluateSourceFractalZoom(start,t,'linear',1)).toMatchObject({ok:false,error:{kind:'unsupported'}});
  expect(evaluateSourceFractalZoom(start,target(),'unknown',.5).ok).toBe(false);
  expect(evaluateSourceFractalZoom(start,target(),'linear',Infinity).ok).toBe(false);
  expect(evaluateSourceFractalZoom({...start,centerX:Number.MAX_VALUE},target(),'linear',.5)).toMatchObject({ok:false,error:{kind:'unsupported'}});
  expect(start).toEqual(before);
 });
});
