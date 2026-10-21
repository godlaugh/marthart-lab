import {describe,it,expect} from 'vitest';
import fixture from './fixtures/source-fractal-clock/source.json';
import {SourceFractalSceneClock,type SourceFractalObjectState,type SourceFractalSceneClip,type SourceFractalAnimationTargets} from '../src/engine/sourceFractalSceneClock';
const F=Math.fround;
const initial=():SourceFractalObjectState=>({centerX:0,centerY:0,centerXLow:0,centerYLow:0,zoom:1,rotation:0,rotationRate:.25,iterations:127,bailout:4,juliaReal:-.7,juliaImag:.27015,ambientAngles:[0,0,0],ambientRates:[0,.5,0],currentTime:0});
/** Fixture inputs are canonicalized into the clock API, never used to compute
 * expected motion. Every comparison below reads independently executed JVM
 * results. Raw JSON parser parity is a separate integration boundary. */
function clips(raw:unknown):SourceFractalSceneClip[]{
 return (raw as {timeline:{type:string;duration:number;enabled?:boolean;easing?:string;zoom?:number;center?:[number,number];actions?:{method:string;args:number[]}[]}[]}).timeline.filter(c=>c.enabled!==false).map(c=>{
  if(c.type==='fractal_zoom')return{kind:'target',duration:c.duration,easing:(c.easing??'SINE_IN_OUT').toLowerCase().replaceAll('_','-'),target:{model:'mathart-1.7.8-target',zoom:c.zoom??1,centerX:c.center?.[0]??0,centerY:c.center?.[1]??0,centerXLow:0,centerYLow:0,maxZoom:1e300}};
  if(c.type!=='animate')return{kind:'wait',duration:c.duration};
  const targets:SourceFractalAnimationTargets={};for(const action of c.actions??[]){const args=action.args.map(F);switch(action.method){
   case 'center':targets.center=[args[0],args[1]];break;case 'zoomFractal':targets.zoom=args[0];break;case 'rotation':targets.rotation=args[0];break;case 'fractalRotate':targets.rotationRate=args[0];break;
   case 'ambient':targets.ambientRates=args.length>=3?[args[0],args[1],args[2]]:[args[0],args[0],0];break;case 'stopAmbient':targets.ambientRates=[0,0,0];targets.rotationRate=0;break;
   case 'iterations':targets.iterations=Math.trunc(args[0]);break;case 'bailout':targets.bailout=args[0];break;case 'julia':targets.julia=[args[0],args[1]];break;
  }}return{kind:'animate',duration:c.duration,easing:(c.easing??'SINE_IN_OUT').toLowerCase().replaceAll('_','-'),targets};
 });
}
const near=(actual:number,expected:number)=>expect(Math.abs(actual-expected)).toBeLessThanOrEqual(Math.max(Number.MIN_VALUE,Math.abs(expected)*Number.EPSILON*8));
describe('actual original Scene → SceneManager → Fractal execution',()=>{
 it.each(fixture.cases.filter(c=>c.id!==8))('matches source scene case $id',sample=>{
  const clock=new SourceFractalSceneClock(initial(),clips(sample.input));
  for(const row of sample.frames){const expected=row.state,out=clock.step('rawStep' in row?Number(row.rawStep!.value):sample.id===4?F(1/24):row.index===0?0:F(1/60),row.paused);
   expect(out.sceneTime).toBe(expected.sceneTime.value);expect(out.rawDt).toBe(expected.frameDeltaTime.value);expect(out.queueIndex).toBe(expected.managerIndex);expect(out.queueComplete).toBe(expected.managerFinished);expect(out.managerFinishedAtFrameStart).toBe(expected.managerFinishedAtFrameStart);
   expect(out.object.rotation).toBe(expected.fractalRotation.value);expect(out.object.currentTime).toBe(expected.fractalTime.value);expect(out.cameraAngles[1]).toBe(expected.cameraTheta.value);
   for(const [i,k]of (['zoom','centerX','centerXLow','centerY','centerYLow'] as const).entries())near(out.object[k],Number(expected.viewport[i].value));
   const p=expected.fractalProperties;expect(out.object.rotationRate).toBe(p.rotationRate.value);expect(out.object.ambientRates).toEqual([p.ambientPhiRate.value,p.ambientThetaRate.value,p.ambientGammaRate.value]);expect(out.object.bailout).toBe(p.bailout.value);expect(out.object.iterations).toBe(p.iterations);near(out.object.juliaReal,Number(p.juliaCx.value));near(out.object.juliaImag,Number(p.juliaCy.value));
  }
 });
 it('reports native zero-duration NaN instead of manufacturing an endpoint',()=>{
  const sample=fixture.cases.find(c=>c.id===8)!,clock=new SourceFractalSceneClock(initial(),clips(sample.input));expect(sample.frames[0].state.fractalRotation.value).toBe('NaN');expect(()=>clock.step(0)).toThrow('有限');expect(()=>clock.snapshot()).toThrow('必须重置');clock.reset();expect(clock.snapshot().object).toEqual(initial());
 });
 it('restores normalized initial camera state and native initial completion flag',()=>{
  for(const queue of [[],[{kind:'wait' as const,duration:1}]]){
   const clock=new SourceFractalSceneClock(initial(),queue,{},[.1,.2,.3]);
   const start=clock.snapshot();expect(start.managerFinishedAtFrameStart).toBe(false);expect(start.cameraAngles).toEqual([.1,.2,.3].map(F));
   clock.step(.1);clock.reset();expect(clock.snapshot()).toEqual(start);
  }
 });
 it('preserves frame phases and stops at most one clip per update',()=>{
  const events:string[]=[],clock=new SourceFractalSceneClock(initial(),[{kind:'wait',duration:0},{kind:'wait',duration:.01}],{update:p=>events.push(p.kind+':'+p.dt)});
  const first=clock.step(.1);expect(first.queueIndex).toBe(1);expect(first.objectUpdates.map(v=>v.kind)).toEqual(['active']);expect(first.activeDt).toBe(F(.01));
  const last=clock.step(.1);expect(last.objectUpdates.map(v=>v.kind)).toEqual(['active','completed']);expect(last.objectUpdates.map(v=>v.dt)).toEqual([F(.01),F(.1)]);
  expect(clock.step(.1,true).objectUpdates).toEqual([]);expect(clock.step(.1).objectUpdates.map(v=>v.kind)).toEqual(['completed']);expect(events).toHaveLength(4);
 });
 it('invalidates failed/cancelled hooks and reconstructs owned state on reset',()=>{
  let fail=true,resets=0;const clock=new SourceFractalSceneClock(initial(),[{kind:'wait',duration:1}],{update(){if(fail)throw Error('hook failure');},reset(){resets++;}});
  expect(()=>clock.step(.1)).toThrow('hook failure');expect(()=>clock.step(.1)).toThrow('必须重置');fail=false;clock.reset();expect(resets).toBe(1);expect(clock.step(.1).object.rotation).toBe(F(.025));
  expect(()=>clock.step(.1,false,()=>true)).toThrow();expect(()=>clock.snapshot()).toThrow('必须重置');
  let resetFailure=false;const owned=new SourceFractalSceneClock(initial(),[],{reset(){if(resetFailure)throw Error('reset failed');}});
  resetFailure=true;expect(()=>owned.reset()).toThrow('reset failed');expect(()=>owned.snapshot()).toThrow('必须重置');
  resetFailure=false;owned.reset();expect(owned.snapshot().object).toEqual(initial());
 });
});
