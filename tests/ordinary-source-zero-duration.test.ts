import {describe,expect,it} from 'vitest';
import type {AnimationAction,AnimationTrack} from '../src/types';
import {RootsSceneClock,type RootsSceneClip} from '../src/engine/rootsSceneClock';
import {evaluateOrdinarySourceCameraTimeline as evaluate,resolveOrdinarySourceCameraTimeline as layout} from '../src/engine/ordinarySourceCameraTimeline';
import {SourceGradientRuntime,type SourceGradientAction,type SourceGradientConfiguration} from '../src/engine/sourceGradientRuntime';
import {SourceOscillatingParameterRuntime,type SourceOscillatingParameterAction} from '../src/engine/sourceOscillatingParameterRuntime';
import {sourceEase} from '../src/engine/sourceEasing';
import type {SourceCameraScalars} from '../src/engine/sourceCamera';
import {parseProjectFile} from '../src/engine/legacyImport';
import {generateScene} from '../src/engine/temporal';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import golden from './fixtures/source-camera/zero-duration.json';

// Independent Python JVM-instruction easing oracle and PC-annotated lifecycle,
// pinned to JAR a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018.
// These are source-derived boundaries, not native JVM/framebuffer parity.
type Scalar=number|'NaN'|'Infinity'|'-Infinity'|'-0';
const number=(value:Scalar):number=>value==='-0'?-0:typeof value==='number'?value:Number(value);
interface Clip {duration:Scalar;actions?:string[];easing?:string;}
interface Gradient {running:boolean;progress:number;speedScale:Scalar;targetSpeed:number;}
interface Expected {
 rawDt:number;activeDt:number;sceneTime:number;queueIndex:number;queueComplete:boolean;cameraFinite:boolean;activeObjectUpdates:number;
 camera:{phi:Scalar;theta:Scalar;gamma:Scalar;zoom:Scalar;focal:Scalar;center:Scalar[];rates:Scalar[]};gradient:Gradient;
 events:{action:string;alpha:Scalar;eased:Scalar;afterOnUpdate:unknown;afterFinish:unknown}[];
}
interface Case {id:string;clips:Clip[];rawDts:number[];expected:Expected[];rawGradientPhase?:boolean;targetDeltaPerActiveFrame?:number;}
const cases=golden.cases as unknown as Case[];
const initial:SourceCameraScalars={phi:golden.initialCamera.phi,theta:golden.initialCamera.theta,gamma:golden.initialCamera.gamma,zoom:golden.initialCamera.zoom,focalDistance:golden.initialCamera.focal,center:[0,0,0]};
const config:SourceGradientConfiguration={mode:'hue_rotate',interpolation:'linear',speed:180};
const gradientAction=(action:string):SourceGradientAction=>action==='gradientStart'?{kind:'start',config}:{kind:'stop'};
const gradientActions=(clip:Clip)=>clip.actions?.filter(a=>a.startsWith('gradient')).map(gradientAction)??[];
const numericCamera=(expected:Expected)=>({phi:number(expected.camera.phi),theta:number(expected.camera.theta),gamma:number(expected.camera.gamma),zoom:number(expected.camera.zoom)});
function clockClip(clip:Clip):RootsSceneClip {
 return{duration:number(clip.duration),easing:clip.easing?.toLowerCase().replaceAll('_','-')??'linear',
  ...(clip.actions?.includes('zoom')?{zoom:2}:{}),...(clip.actions?.includes('rates')?{rates:[1,2,3] as const}:{}),
  ...(gradientActions(clip).length?{gradientActions:gradientActions(clip)}:{})};
}
const action=(method:string,args:Record<string,number>):AnimationAction=>({id:method,method,args});
function tracks(row:Case):AnimationTrack[]{
 return row.clips.map((clip,index)=>{
  const actions=(clip.actions??[]).map((name)=>{
   if(name==='zoom'||name==='focal')return action(name,{value:name==='zoom'?2:40});
   if(name==='phi')return action('rotatePhi',{angle:3});
   if(name==='rates')return action('ambient',{phiSpeed:1,thetaSpeed:2,gammaSpeed:3});
   if(name==='track')return action('track',{index:0});
   throw Error(`Unsupported fixture camera action: ${name}`);
  });
  return{id:`${row.id}-${index}`,type:actions.length?'animate':'wait',target:'camera.actions',from:0,to:0,start:0,
   duration:number(clip.duration),easing:'linear',enabled:true,pingPong:false,actions};
 });
}

describe('native nonpositive queue clock against independent lifecycle fixtures',()=>{
 const clockCases=cases.filter(row=>row.clips.every(c=>(c.actions??[]).every(a=>['zoom','rates','wait'].includes(a)))||row.rawGradientPhase);
 it.each(clockCases)('$id',row=>{
  const clock=new RootsSceneClock(initial,row.clips.map(clockClip),row.rawGradientPhase?{gradient:{initialOffset:0}}:{});
  for(const [index,dt] of row.rawDts.entries()){
   const expected=row.expected[index],before=clock.snapshot();
   if(!expected.cameraFinite){
    expect(()=>clock.step(dt)).toThrow('非有限');expect(clock.snapshot()).toEqual(before);break;
   }
   const actual=clock.step(dt);
   expect(actual).toMatchObject({queueIndex:expected.queueIndex,queueComplete:expected.queueComplete,sceneTime:expected.sceneTime,camera:numericCamera(expected),rates:expected.camera.rates.map(number)});
   // After queue completion the legacy clock reports raw dt in this field;
   // actual Mobject dispatch is gated by queue state, tested below.
   if(!before.queueComplete)expect(actual.activeDt).toBe(expected.activeDt);
   if(row.rawGradientPhase)expect(actual.gradient).toMatchObject({...expected.gradient,speedScale:number(expected.gradient.speedScale)});
  }
 });
 it('keeps InstantAction separate from a zero-duration interpolated child',()=>{
  const clock=new RootsSceneClock(initial,[{duration:0,easing:'linear',instant:true}]);
  expect(clock.step(0)).toMatchObject({queueComplete:true,sceneTime:0,camera:{zoom:1}});
  expect(()=>new RootsSceneClock(initial,[{duration:0,easing:'linear',instant:true,zoom:2}])).toThrow('没有插值');
  expect(()=>new RootsSceneClock(initial,[{duration:-1,easing:'linear',instant:true}])).toThrow('零时长');
  expect(()=>new RootsSceneClock(initial,[{duration:NaN,easing:'linear'}])).toThrow('有限');
 });
 it.each(golden.easings)('preserves source NaN and endpoint behavior for $name',row=>{
  for(const [input,expected]of [[NaN,row.nan],[-0,row.negativeZero],[0,row.zero],[1,row.one]] as const){
   const output=sourceEase(row.name,input),wanted=number(expected as Scalar);
   if(Number.isNaN(wanted))expect(output).toBeNaN();else expect(output).toBe(wanted);
  }
 });
});

describe('ordinary source evaluator retains finite nonpositive authored durations',()=>{
 const cameraCases=cases.filter(row=>row.rawDts.every(dt=>dt===.25)&&row.clips.every(c=>(c.actions??[]).every(a=>['zoom','rates','wait','track'].includes(a))));
 it.each(cameraCases)('$id',row=>{
  const source=tracks(row);
  for(const [index,expected]of row.expected.entries()){
   const updates:{time:number;deltaTime:number}[]=[],position:[number,number,number]=[4,5,6];
   const run=()=>evaluate(initial,source,4,index/4,{createParticles:()=>({
    bind:()=>({kind:'bound',readPosition:()=>position}),
    update:frame=>{updates.push({time:frame.time,deltaTime:frame.deltaTime});for(let k=0;k<3;k++)position[k]+=row.targetDeltaPerActiveFrame??0;},
   })});
   if(!expected.cameraFinite){expect(run).toThrow('非有限');continue;}
   const actual=run();
   expect(actual).toMatchObject({queueIndex:expected.queueIndex,queueComplete:expected.queueComplete,sceneTime:expected.sceneTime,
    camera:{...numericCamera(expected),focalDistance:number(expected.camera.focal),center:expected.camera.center.map(number)}});
   expect(updates).toHaveLength(expected.activeObjectUpdates);
   expect(updates).toEqual(row.expected.slice(0,index+1).filter((frame,i)=>i===0||!row.expected[i-1].queueComplete).map(frame=>({time:frame.sceneTime,deltaTime:frame.activeDt})));
  }
  expect(layout(initial,source,4).clips.map(c=>c.sourceDuration)).toEqual(row.clips.map(c=>number(c.duration)));
 });
 it('rejects persistent zoom, angle, align and focal NaN without snapping or hiding the failed state',()=>{
  for(const value of ['zoom','rotatePhi','focal','align'] as const){
   const clip:AnimationTrack={id:value,type:value==='align'?'align':'animate',target:'camera.actions',from:0,to:0,start:0,duration:0,easing:'linear',enabled:true,pingPong:false,
    ...(value==='align'?{orientation:{phi:.5}}:{actions:[action(value,value==='rotatePhi'?{angle:3}:{value:2})]})};
   expect(()=>evaluate(initial,[clip],4,0)).toThrow('非有限');
   expect(()=>evaluate(initial,[clip],4,1)).toThrow('非有限');
  }
 });
 it('keeps signed-zero scalar cache keys separate when a later wait gives the zero child positive dt',()=>{
  const positive=cases.find(row=>row.id==='zero-zoom-positive-following-wait')!,negative=cases.find(row=>row.id==='negative-zero-zoom-positive-following-wait')!;
  const plus=tracks(positive),minus=structuredClone(plus);minus[0].duration=-0;
  expect(evaluate(initial,plus,4,0).camera.zoom).toBe(number(positive.expected[0].camera.zoom));
  expect(evaluate(initial,minus,4,0).camera.zoom).toBe(number(negative.expected[0].camera.zoom));
  expect(evaluate(initial,plus,4,0).camera.zoom).toBe(2);
 });
 it('dispatches real CPU Attractor substeps on zero-active-dt frames, then freezes after the queue',()=>{
  const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'ATTRACTOR',name:'Zero queue',equations:{dx:'1',dy:'0',dz:'0'},
   settings:{render_mode:'CPU',particle_count_cpu:1,time_step:1,sub_steps:3,show_trails:true},
   initialization:{warmup_steps:0,bounds:{min_x:0,max_x:0,min_y:0,max_y:0,min_z:0,max_z:0}},
   timeline:[{type:'animate',duration:0,actions:[{method:'track',args:[0]}]},{type:'wait',duration:0}],
  })).scene;scene.timeline.fps=4;
  const expected=cases.find(row=>row.id==='zero-waits-one-per-frame')!.expected;
  for(const [index,frame]of expected.entries()){
   const out=generateScene(scene,{time:index/4,width:32,height:24,quality:'export',sourceViewport:ordinarySourceViewport(scene,32,24,'primary',24)});
   if(out.type!=='geometry')throw Error('Expected source geometry');
   const x=frame.activeObjectUpdates*3;
   expect(Array.from(out.positions)).toEqual([x,0,0]);expect(out.sourceCameraFrame!.camera.center).toEqual([x,0,0]);
   expect(out.temporal!.recordedPoints).toBe(x);
  }
 });
});

describe('source gradient and parameter callbacks admit recoverable NaN',()=>{
 it.each(cases.filter(row=>row.clips.some(c=>gradientActions(c).length)))('$id gradient owner',row=>{
  const scales:number[]=[],runtime=new SourceGradientRuntime(()=>0,frame=>{
   scales.push(runtime.snapshot().speedScale);expect(Object.values(frame).every(Number.isFinite)).toBe(true);
  });
  let previousQueue=-1;
  for(const [index,expected]of row.expected.entries()){
   const queue=index===0?0:row.expected[index-1].queueIndex,clip=row.clips[queue];
   if(clip){
    if(queue!==previousQueue){runtime.begin(gradientActions(clip));previousQueue=queue;}
    const event=expected.events.find(e=>e.action.startsWith('gradient'));
    if(event)runtime.interpolate(number(event.eased),expected.queueIndex!==queue);
    runtime.update(expected.activeDt);
   }
   if(row.rawGradientPhase)runtime.update(row.rawDts[index]);
   expect(runtime.snapshot()).toMatchObject({...expected.gradient,speedScale:number(expected.gradient.speedScale)});
  }
  if(row.expected.some(frame=>frame.events.some(e=>e.action.startsWith('gradient')&&e.eased==='NaN')))expect(scales.some(Number.isNaN)).toBe(true);
 });
 it('allows an unused NaN in an empty/finished group but still rejects nonfinite progress at actual use',()=>{
  const runtime=new SourceGradientRuntime(()=>0,()=>{});
  runtime.begin([]);expect(()=>runtime.interpolate(NaN,true)).not.toThrow();
  runtime.begin([{kind:'stop'}]);expect(()=>runtime.interpolate(NaN,true)).not.toThrow();
  runtime.begin([{kind:'start',config}]);runtime.interpolate(NaN,false);
  expect(()=>runtime.update(.25)).toThrow('非有限');
 });
 const start:SourceOscillatingParameterAction={kind:'start',scope:{kind:'named',name:'a'},configuration:{min:-1,max:1,step:.1}};
 const stop:SourceOscillatingParameterAction={kind:'stop',scope:{kind:'all'}};
 function parameters(){
  const writes:number[]=[],runtime=new SourceOscillatingParameterRuntime({read:()=>0,write:(_name,value)=>writes.push(value),reserve:()=>{}});
  return{runtime,writes,scale:()=>runtime.snapshot().entries[0]?.scale};
 }
 it.each(golden.surfaceParameterScales)('restores parameter scales duration=$duration dt=$activeDt',row=>{
  for(const stopping of [false,true]){
   const transient=parameters(),finished=parameters();
   for(const {runtime}of [transient,finished]){
    runtime.begin([start]);if(stopping){runtime.interpolate(1,true);runtime.begin([stop]);}
   }
   const expected=stopping?row.stopWhileRunning:row.start;
   transient.runtime.interpolate(number(row.eased as Scalar),false);
   expect(transient.scale()).toBe(number(expected.onUpdate as Scalar));
   finished.runtime.interpolate(number(row.eased as Scalar),true);
   expect(finished.scale()).toBe(expected.onFinish);
   expect(()=>finished.runtime.update(row.activeDt,4)).not.toThrow();
   expect(finished.writes.every(Number.isFinite)).toBe(true);
   if(stopping)expect(finished.runtime.running).toBe(false);
  }
 });
 it('retains parameter child start ordering and does not reject unused or already-finished NaN',()=>{
  const {runtime,scale}=parameters();runtime.begin([]);expect(()=>runtime.interpolate(NaN,true)).not.toThrow();
  runtime.begin([stop,start]);runtime.interpolate(NaN,true);expect(runtime.running).toBe(true);expect(scale()).toBe(1);
  runtime.begin([start,stop]);runtime.interpolate(NaN,true);expect(runtime.running).toBe(false);expect(scale()).toBe(0);
  runtime.begin([start]);runtime.interpolate(NaN,false);expect(()=>runtime.update(.25,4)).toThrow('有限');
 });
});
