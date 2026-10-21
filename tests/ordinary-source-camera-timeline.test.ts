import {describe,it,expect} from 'vitest';
import type {AnimationTrack,AnimationAction} from '../src/types';
import type {SourceCameraScalars} from '../src/engine/sourceCamera';
import {evaluateOrdinarySourceCameraTimeline as evaluate,resolveOrdinarySourceCameraTimeline as layout,OrdinarySourceCameraTimelineError,OrdinarySourceCameraTimelineSession,clearOrdinarySourceCameraTimelineCache} from '../src/engine/ordinarySourceCameraTimeline';
import {RootsSceneClock} from '../src/engine/rootsSceneClock';
import goldens from './fixtures/source-camera/ordinary-timeline.json';
const initial:SourceCameraScalars={phi:0,theta:.25,gamma:0,center:[1,2,3],zoom:1,focalDistance:20};
const action=(method:string,args:AnimationAction['args']={}):AnimationAction=>({id:crypto.randomUUID(),method,args});
const clip=(actions:AnimationAction[]=[],patch:Partial<AnimationTrack>={}):AnimationTrack=>({id:crypto.randomUUID(),type:'animate',target:'camera.actions',from:0,to:0,start:0,duration:1,easing:'linear',pingPong:false,enabled:true,actions,...patch});
const bits=(v:number)=>{const view=new DataView(new ArrayBuffer(4));view.setFloat32(0,v);return view.getUint32(0).toString(16).padStart(8,'0');};
const errorCode=(run:()=>unknown)=>{try{run();throw Error('expected error');}catch(e){expect(e).toBeInstanceOf(OrdinarySourceCameraTimelineError);return(e as OrdinarySourceCameraTimelineError).code;}};
describe('ordinary source scalar camera queue',()=>{
 it('builds both relative targets against initial but captures each runtime start',()=>{
  const tracks=[clip([action('rotateTheta',{angle:1})]),clip([action('rotateTheta',{angle:1})])],before=JSON.stringify(tracks);
  expect(Array.from({length:8},(_,i)=>evaluate(initial,tracks,4,i/4).camera.theta)).toEqual([.5,.75,1,1.25,1.25,1.25,1.25,1.25]);
  expect(JSON.stringify(tracks)).toBe(before);expect(initial.theta).toBe(.25);
 });
 it('honors builder last-write per axis and action-level source enabled behavior',()=>{
  const tracks=[clip([action('rotateTo',{phi:2,theta:3,gamma:4}),{...action('rotateTheta',{angle:1}),enabled:false},action('rotatePhi',{angle:1})])];
  const out=evaluate(initial,tracks,4,.75);expect(out.camera).toMatchObject({phi:1,theta:1.25,gamma:4});expect(out.diagnostics.map(x=>x.code)).toContain('action-enabled');
 });
 it.each(goldens.frames)('matches independent Float32 instruction golden $kind/$frameIndex',row=>{
  const base={...goldens.initial,center:[1,2,3] as const};
  const tracks=row.kind==='align'?[clip([],{type:'align',orientation:goldens.alignOffsets,alignMode:'next-turn'})]:[clip([action('rotateTo',goldens.absolute),action('zoom',{value:goldens.absolute.zoom}),action('focal',{value:goldens.absolute.focalDistance})])];
  const frame=evaluate(base,tracks,4,row.time);for(const [key,wanted]of Object.entries(row.bits))expect(bits(frame.camera[key as 'phi'])).toBe(wanted);expect(frame.frameIndex).toBe(row.frameIndex);
 });
 it('uses retained ambient/zoom queue owner, including Float32 partial final frame and post-queue drift',()=>{
  const tracks=[clip([action('ambient',{phiSpeed:.3,thetaSpeed:-.7,gammaSpeed:.1}),action('zoom',{value:1.7})],{duration:.12,easing:'sine-in-out'}),clip([action('stopAmbient')],{duration:.17})];
  const clock=new RootsSceneClock(initial,[{duration:Math.fround(.12),easing:'sine-in-out',zoom:Math.fround(1.7),rates:[Math.fround(.3),Math.fround(-.7),Math.fround(.1)]},{duration:Math.fround(.17),easing:'linear',rates:[0,0,0]}]);
  for(let i=0;i<15;i++){const expected=clock.step(Math.fround(1/30)),actual=evaluate(initial,tracks,30,i/30);expect(actual.camera).toMatchObject(expected.camera);expect(actual.sceneTime).toBe(expected.sceneTime);expect(actual.queueIndex).toBe(expected.queueIndex);}
 });
 it('applies MoveCamera first and ambient component increment afterwards',()=>{
  const tracks=[clip([action('rotateTheta',{angle:1}),action('ambient',{thetaSpeed:1})])];
  expect(Array.from({length:4},(_,i)=>evaluate(initial,tracks,4,i/4).camera.theta)).toEqual([.5625,.875,1.1875,1.5]);expect(evaluate(initial,tracks,4,1).camera.theta).toBe(1.75);
 });
 it('does not let an unrelated hidden ambient angle history reject finite MoveCamera frames',()=>{
  const max=3.4028234663852886e38,tracks=[clip([action('rotateTo',{phi:0,theta:0,gamma:0}),action('ambient',{thetaSpeed:max})])];
  expect(evaluate({...initial,theta:max},tracks,1,0).camera.theta).toBe(max);
 });
 it('transitions stopTracking to the actual fixed origin instead of freezing local orbit center',()=>{
  const tracks=[clip([action('stopTracking')])];expect(evaluate(initial,tracks,4,0).camera.center).toEqual([.75,1.5,2.25]);expect(evaluate(initial,tracks,4,.75).camera.center).toEqual([0,0,0]);expect(evaluate(initial,tracks,4,2).camera.center).toEqual([0,0,0]);
 });
 it('requires explicit production tracking and reads a bound PVector before/after object update',()=>{
  const tracks=[clip([action('track',{index:3})])];expect(errorCode(()=>evaluate(initial,tracks,4,0))).toBe('unsupported');
  const calls:string[]=[];const frame=evaluate(initial,tracks,4,1,{createParticles:()=>{
   let x=0;return{bind:r=>{calls.push(`bind:${r.action.args?.index}`);return{kind:'bound',readPosition:()=>{calls.push(`read:${x}`);return[x,0,0];}};},update:r=>{calls.push(`update:${r.frameIndex}`);x++;}};
  }});
  expect(calls).toEqual(['bind:3','read:0','update:0','read:1','update:1','read:2','update:2','read:3','update:3','read:4','read:4']);expect(frame.camera.center).toEqual([4,0,0]);
 });
 it('keeps source sequence display layout separate from authored starts/repeat/durations',()=>{
  const tracks=[clip([],{type:'wait',start:20,duration:.3,repeat:5,pingPong:true}),clip([],{type:'param',start:40,duration:.3})],before=JSON.stringify(tracks),out=layout(initial,tracks,4);
  expect(out.clips.map(c=>[c.start,c.duration])).toEqual([[0,.5],[.5,.5]]);expect(out.clips.map(c=>c.sourceDuration)).toEqual([Math.fround(.3),Math.fround(.3)]);expect(out.span).toBe(1);expect(out.diagnostics.map(x=>x.code)).toContain('noncamera-clock');expect(JSON.stringify(tracks)).toBe(before);
 });
 it('fails closed on source timing/semantics that the shared authored tracks cannot express',()=>{
  for(const track of [clip([],{type:'numeric',target:'camera.theta'}),clip([],{type:'align',alignMode:'absolute'}),clip([action('unknown')])])expect(errorCode(()=>evaluate(initial,[track],4,0))).toBe('unsupported');
  expect(errorCode(()=>evaluate(initial,[clip([],{duration:NaN})],4,0))).toBe('input');
 });
 it('rejects malformed trail clips before requiring a producer',()=>{expect(errorCode(()=>evaluate(initial,[clip([],{type:'trails'})],4,0))).toBe('input');});
 it('keeps incremental cache isolated across reverse seeks, changed inputs, caller mutations and cancelled replay',()=>{
  const tracks=[clip([action('ambient',{thetaSpeed:.3})],{duration:2})];clearOrdinarySourceCameraTimelineCache();
  const first=evaluate(initial,tracks,30,.5),later=evaluate(initial,tracks,30,1);(later.camera.center as unknown as number[])[0]=999;
  expect(evaluate(initial,tracks,30,1).camera.center).toEqual([1,2,3]);expect(evaluate(initial,tracks,30,.5)).toEqual(first);
  clearOrdinarySourceCameraTimelineCache();expect(evaluate(initial,tracks,30,1).camera).not.toEqual(later.camera);
  const changed=structuredClone(tracks);changed[0].actions![0].args!.thetaSpeed=.4;expect(evaluate(initial,changed,30,1).camera.theta).not.toBe(later.camera.theta);
  let n=0;expect(()=>evaluate(initial,tracks,30,2,{isCancelled:()=>++n===9})).toThrow('取消');const recovered=evaluate(initial,tracks,30,2);clearOrdinarySourceCameraTimelineCache();expect(evaluate(initial,tracks,30,2)).toEqual(recovered);
 });
 it('bounds work, validates finite source scalars and preserves input on cancellation',()=>{
  expect(errorCode(()=>evaluate({...initial,phi:NaN},[],4,0))).toBe('input');expect(errorCode(()=>evaluate(initial,[],120,86400))).toBe('capacity');
  const tracks=[clip([action('ambient',{thetaSpeed:.1})])],before=JSON.stringify(tracks);let checks=0;expect(()=>evaluate(initial,tracks,30,2,{isCancelled:()=>++checks===8})).toThrow('取消');expect(JSON.stringify(tracks)).toBe(before);
 });
 it('owns one real-dt queue, initializes without update, and keeps paused/signed updates distinct from fixed replay',()=>{
  const updates:number[]=[],tracks=[clip([action('ambient',{thetaSpeed:2})])],owner=new OrdinarySourceCameraTimelineSession(initial,tracks,60,{createParticles:()=>({bind(){return{kind:'ignored',reason:'unused'};},update(frame){updates.push(frame.deltaTime);}})});
  expect(owner.snapshot()).toMatchObject({frameIndex:-1,sceneTime:0,camera:initial});expect(updates).toEqual([]);
  expect(owner.step(.25)).toMatchObject({sceneTime:.25,activeDt:.25,rawDt:.25,camera:{theta:.375}});
  expect(owner.step(5,{paused:true})).toMatchObject({sceneTime:.25,activeDt:0,rawDt:0,camera:{theta:.375}});expect(updates).toEqual([.25]);
  expect(owner.step(-.125)).toMatchObject({sceneTime:.125,activeDt:-.125,rawDt:-.125,camera:{theta:.375}});expect(updates).toEqual([.25,-.125]);
  expect(()=>owner.evaluate(1)).toThrow('实时队列');owner.reset();owner.evaluate(0);expect(()=>owner.step(.1)).toThrow('固定帧');
 });

 it('validates live initialization and cancellation before creating a provider',()=>{
  let created=0,cancelled=true;const options={isCancelled:()=>cancelled,createParticles:()=>{created++;return{bind(){return{kind:'ignored' as const,reason:'unused'};},update(){}};}};
  const owner=new OrdinarySourceCameraTimelineSession(initial,[],60,options);expect(()=>owner.snapshot()).toThrow('取消');expect(created).toBe(0);
  cancelled=false;const malformed=new OrdinarySourceCameraTimelineSession(initial,[],NaN,options);expect(()=>malformed.snapshot()).toThrow('帧率');expect(created).toBe(0);
  owner.snapshot();expect(created).toBe(1);cancelled=true;expect(()=>owner.snapshot()).toThrow('取消');expect(created).toBe(1);
 });

 it('skips bound tracking reads on zero and negative live camera intervals',()=>{
  let x=4,reads=0;const owner=new OrdinarySourceCameraTimelineSession(initial,[clip([action('track',{index:0})])],60,{createParticles:()=>({bind:()=>({kind:'bound',readPosition:()=>{reads++;return[x,0,0];}}),update(){}})});
  expect(owner.step(1).camera.center).toEqual([4,0,0]);const completedReads=reads;x=9;
  expect(owner.step(0).camera.center).toEqual([4,0,0]);expect(owner.step(-.25).camera.center).toEqual([4,0,0]);expect(reads).toBe(completedReads);
  expect(owner.step(.25).camera.center).toEqual([9,0,0]);expect(reads).toBe(completedReads+1);
 });

});
