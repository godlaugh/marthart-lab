import {describe,expect,it} from 'vitest';
import {SourceGradientRuntime,sourceGradientFrame,sourceGradientFrameAtAge,sourceGradientWrap,type SourceGradientAction,type SourceGradientConfiguration,type SourceGradientFrame} from '../src/engine/sourceGradientRuntime';
import targets from './fixtures/roots/gradient-static-targets.json';

const config:SourceGradientConfiguration={mode:'hue_rotate',interpolation:'linear',speed:360};
const start=(overrides:Partial<SourceGradientConfiguration>={}):SourceGradientAction=>({kind:'start',config:{...config,...overrides}});
const stop:SourceGradientAction={kind:'stop'};
function capture(base=0){
 const frames:SourceGradientFrame[]=[],scales:number[]=[];
 const runtime=new SourceGradientRuntime(()=>base,frame=>{frames.push(frame);scales.push(runtime.snapshot().speedScale);});
 return{runtime,frames,scales,setBase(value:number){base=value;}};
}

// Static bytecode witnesses: GradientRuntimeState, GradientAnimator,
// StartGradientAnimation, StopGradientAnimation and AnimationGroup from
// MathArt 1.7.8, JAR SHA a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018.
// These verify source-derived arithmetic/lifecycle, not original-app execution.
describe('shared source gradient arithmetic',()=>{
 it.each(targets.vectors)('matches independent Python frame $mode/$interpolation',row=>{
  const frame=sourceGradientFrame(row.baseAll,{mode:row.mode.toLowerCase() as SourceGradientConfiguration['mode'],interpolation:row.interpolation.toLowerCase() as SourceGradientConfiguration['interpolation'],speed:360},row.progress);
  [frame.palette,frame.inside,frame.outside].forEach((value,index)=>expect(value).toBeCloseTo(row.frame[index],15));
 });
 it('preserves Java remainder signs and wraps negative nonintegers',()=>{
  expect(Object.is(sourceGradientWrap(-1),-0)).toBe(true);
  expect(Object.is(sourceGradientWrap(-0),-0)).toBe(true);
  expect(sourceGradientWrap(-1.25)).toBe(.75);expect(sourceGradientWrap(3.25)).toBe(.25);
 });
 it('retains binary64 progression while accepting the caller’s promoted binary32 dt and easing',()=>{
  const {runtime}=capture();runtime.begin([start({speed:73.125})]);runtime.interpolate(Math.fround(.3),false);
  for(let i=0;i<1000;i++)runtime.update(Math.fround(1/60));
  // Independently evaluated with Python struct.pack/unpack float32 and double
  // arithmetic in bytecode order; rounding every phase to F32 fails this.
  expect(runtime.snapshot().progress).toBe(.01562509332630374);
  expect(runtime.frameAtAge(Math.fround(17/120)).palette).toBe(.006992280543802562);
 });
 it('keeps separate advance phases and their separate remainders',()=>{
  const {runtime}=capture();runtime.begin([start({speed:3.6e18})]);runtime.interpolate(1,true);
  runtime.update(Math.fround(.01));expect(runtime.snapshot().progress).toBe(.828125);
  runtime.update(Math.fround(1/60));expect(runtime.snapshot().progress).toBe(.5);
 });
 it('samples past frames from current speed, without recording historic speed or applying the target',()=>{
  const {runtime,frames}=capture(.125);runtime.begin([start()]);runtime.interpolate(1,true);runtime.update(.25);
  runtime.begin([stop]);runtime.interpolate(.5,false);
  const count=frames.length;
  expect(runtime.frameAtAge(.25)).toEqual({palette:.25,inside:.125,outside:.125});
  expect(runtime.frameAtAge(1)).toEqual({palette:.875,inside:.125,outside:.125});
  expect(runtime.frameAtAge(0)).toEqual({palette:.375,inside:.125,outside:.125});
  expect(runtime.frameAtAge(-1)).toEqual(runtime.frameAtAge(0));expect(frames).toHaveLength(count);
  runtime.interpolate(1,true);
  expect(runtime.frameAtAge(100)).toEqual(runtime.frameAtAge(0));
 });
 it('owns a frozen historical snapshot independently of later restarts and stops',()=>{
  const {runtime,setBase}=capture(.125);runtime.begin([start()]);runtime.interpolate(1,true);runtime.update(.25);
  const snapshot=runtime.snapshot();expect(Object.isFrozen(snapshot)).toBe(true);
  expect(sourceGradientFrameAtAge(snapshot,.125)).toEqual({palette:.25,inside:.125,outside:.125});
  setBase(.75);runtime.begin([start({speed:180,mode:'offset_cycle'}),stop]);runtime.interpolate(1,true);
  expect(runtime.running).toBe(false);
  expect(snapshot).toMatchObject({running:true,base:.125,progress:.25,targetSpeed:360});
  expect(sourceGradientFrameAtAge(snapshot,.125)).toEqual({palette:.25,inside:.125,outside:.125});
 });
});

describe('ordered source action lifecycle and target callbacks',()=>{
 it('applies twice at start and finish, once at each update, and never from stop itself',()=>{
  const {runtime,frames,scales}=capture(.125);runtime.begin([start()]);
  expect(frames).toHaveLength(2);expect(scales).toEqual([0,0]);
  runtime.interpolate(.25,false);runtime.update(.25);
  expect(frames).toHaveLength(4);expect(frames.at(-1)!.palette).toBe(.1875);
  runtime.interpolate(1,true);runtime.update(.25);expect(frames).toHaveLength(7);
  runtime.begin([stop]);runtime.interpolate(.25,false);runtime.update(.25);expect(frames).toHaveLength(9);
  runtime.interpolate(1,true);expect(frames).toHaveLength(11);
  expect(scales.slice(-2)).toEqual([0,0]);
  expect(runtime.snapshot()).toMatchObject({running:false,progress:.5,speedScale:0,targetSpeed:0});
  runtime.update(1);runtime.interpolate(1,true);expect(frames).toHaveLength(11);
 });
 it.each([
  {running:false,names:['stop','start'],expectedRunning:true,scale:1,callbacks:5},
  {running:false,names:['start','stop'],expectedRunning:false,scale:0,callbacks:8},
  {running:true,names:['stop','start'],expectedRunning:false,scale:1,callbacks:6},
 ])('retains all-child start order: initial running=$running actions=$names',row=>{
  const {runtime,frames}=capture();
  if(row.running){runtime.begin([start()]);runtime.interpolate(1,true);}
  frames.length=0;runtime.begin(row.names.map(name=>name==='start'?start():stop));
  runtime.interpolate(.5,false);runtime.interpolate(1,true);
  expect(runtime.snapshot()).toMatchObject({running:row.expectedRunning,speedScale:row.scale,targetSpeed:row.expectedRunning?360:0});
  expect(frames).toHaveLength(row.callbacks);
 });
 it('reads a new primary base for each restart, including intervening target callbacks',()=>{
  let primary=.125;const bases:number[]=[];
  const runtime=new SourceGradientRuntime(()=>{bases.push(primary);return primary;},()=>{primary+=.125;});
  runtime.begin([start(),start({mode:'offset_cycle',speed:180})]);
  expect(bases).toEqual([.125,.375]);expect(primary).toBe(.625);
  expect(runtime.snapshot()).toMatchObject({base:.375,progress:0,targetSpeed:180});
  expect(runtime.frameAtAge(0)).toEqual({palette:.375,inside:.375,outside:.375});
 });
 it('clears completed child actions for an empty group while keeping the animator running',()=>{
  const {runtime,frames}=capture();runtime.begin([start()]);runtime.interpolate(1,true);
  runtime.begin([]);const count=frames.length;runtime.interpolate(.5,false);expect(frames).toHaveLength(count);
  runtime.update(.25);expect(runtime.snapshot()).toMatchObject({running:true,progress:.25,speedScale:1});
 });
 it('reapplies at nonpositive dt while running; the Surface caller owns its stricter guard',()=>{
  const {runtime,frames}=capture();runtime.begin([start()]);runtime.interpolate(1,true);runtime.update(.25);
  const count=frames.length;runtime.update(0);runtime.update(-1);
  expect(frames).toHaveLength(count+2);expect(runtime.snapshot().progress).toBe(.25);
 });
 it('preserves a negative-zero scale and clamps only negative values, allowing easing overshoot',()=>{
  const {runtime}=capture();runtime.begin([start()]);runtime.interpolate(-0,false);
  expect(Object.is(runtime.snapshot().speedScale,-0)).toBe(true);
  runtime.interpolate(-.25,false);expect(runtime.snapshot().speedScale).toBe(0);
  runtime.interpolate(1.25,false);runtime.update(.5);expect(runtime.snapshot().progress).toBe(.625);
 });
 it('retains an immutable started configuration when the caller edits its own object',()=>{
  const input={...config};const {runtime}=capture();runtime.begin([{kind:'start',config:input}]);
  input.speed=0;input.mode='cross_fade';runtime.interpolate(1,true);runtime.update(.25);
  expect(runtime.config).toEqual(config);expect(Object.isFrozen(runtime.config)).toBe(true);
  expect(runtime.frameAtAge(0)).toEqual({palette:.25,inside:0,outside:0});
 });
});
