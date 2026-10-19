import {describe,it,expect} from 'vitest';
import {importSourceAttractorConfig,type SourceAttractorResult} from '../src/engine/sourceAttractorConfig';
import {importSourceAttractorVisualConfig} from '../src/engine/sourceAttractorVisualConfig';
import {prepareSourceAttractorEquation} from '../src/engine/sourceAttractorEquation';
import {SourceAttractorCpuParticles} from '../src/engine/sourceAttractorCpuParticles';
import {generateSourceAttractorCpu,replaySourceAttractorCpu} from '../src/engine/sourceAttractorScene';
import type {AnimationTrack} from '../src/types';

const F=Math.fround;
const value=<T>(r:SourceAttractorResult<T>):T=>{if(!r.ok)throw Error(r.error.reason);return r.value;};
function options(settings:Record<string,unknown>={},warmup=0,palette=['#80ff0000'],dx='1'){
 const all={particle_count_cpu:1,time_step:1,sub_steps:3,scale_x:2,offset_x:1,...settings};
 return{configuration:value(importSourceAttractorConfig(all,{warmup_steps:warmup,bounds:{min_x:0,max_x:0,min_y:0,max_y:0,min_z:0,max_z:0}})).configuration,
 visualConfiguration:value(importSourceAttractorVisualConfig(all,palette)).configuration,
 equation:value(prepareSourceAttractorEquation({equations:{dx,dy:'0',dz:'0'},parameters:{}}))};
}
const frame=(frameIndex:number,time=(frameIndex+1)/4,deltaTime=.25)=>({frameIndex,time,deltaTime});
const x=(a:Float32Array)=>Array.from(a).filter((_,i)=>i%3===0);
const camera={phi:0,theta:0,gamma:0,zoom:1,focalDistance:250,center:[0,0,0] as [number,number,number]};
const wait:AnimationTrack={id:'wait',type:'wait',target:'timeline.wait',from:0,to:0,start:0,duration:1,easing:'linear',enabled:true,pingPong:false};

// Source-derived CPU integration, Dot3D FIFO, drawTrailsLines and Scene queue
// contracts. Native JVM/framebuffer parity is not established by these tests.
describe('source Attractor visible history shares motion and tracking state',()=>{
 it('does not record warmup, records every transformed substep, and uses one scene timestamp per frame',()=>{
  const owner=new SourceAttractorCpuParticles(options({},2));
  const target=owner.bind({trackId:'follow',actionIndex:0,action:{id:'target',method:'track',args:{index:0}}});if(target.kind!=='bound')throw Error('bound');
  expect(owner.snapshot().trails!.records).toBe(0);expect(target.readPosition()).toEqual([5,0,0]);
  owner.update(frame(0,.25,0));const state=owner.snapshot();
  expect(x(state.trails!.positions)).toEqual([7,9,11]);expect(state.trails!.oldestTime).toBe(.25);
  expect(state.trails!.indices).toEqual(new Uint32Array([0,1,1,2]));expect(target.readPosition()).toEqual([11,0,0]);expect(state.positions[0]).toBe(11);expect(state.integrationSteps[0]).toBe(5);
 });
 it('expires strictly by frame age, keeping same-frame substeps even at zero lifetime',()=>{
  const a=new SourceAttractorCpuParticles(options({trail_lifetime:.5}));
  for(let i=0;i<3;i++)a.update(frame(i));expect(a.snapshot().trails!.records).toBe(9);
  a.update(frame(3));const t=a.snapshot().trails!;expect(t.records).toBe(9);expect(t.oldestTime).toBe(.5);expect(x(t.positions)).toEqual([9,11,13,15,17,19,21,23,25]);
  const b=new SourceAttractorCpuParticles(options({trail_lifetime:0}));b.update(frame(0));b.update(frame(1));expect(x(b.snapshot().trails!.positions)).toEqual([9,11,13]);
 });
 it('enforces the source per-particle capacity before expiration and keeps source signed overflow',()=>{
  const a=new SourceAttractorCpuParticles(options({trail_lifetime:1,sub_steps:200}));a.update(frame(0));const t=a.snapshot().trails!;expect(t.records).toBe(180);expect(x(t.positions)[0]).toBe(43);expect(t.positions.at(-3)).toBe(401);
  for(const lifetime of [-1,1e10]){const b=new SourceAttractorCpuParticles(options({trail_lifetime:lifetime}));b.update(frame(0));expect(b.snapshot().trails!.records).toBe(0);}
 });
 it('uses packed source alpha for whole-history fade, including alpha-zero fallback and original ordinals',()=>{
  const a=new SourceAttractorCpuParticles(options({fade_trails:true}));a.update(frame(0));expect(Array.from(a.snapshot().trails!.alphas)).toEqual([0,F(64/255),F(128/255)]);
  const b=new SourceAttractorCpuParticles(options({fade_trails:true},0,['#00000080']));b.update(frame(0));const s=b.snapshot();
  // tint(int) interprets the head as opaque gray; stroke(r,g,b,a) retains blue.
  expect(Array.from(s.colors!)).toEqual([F(128/255),F(128/255),F(128/255)]);expect(s.pointAlphas![0]).toBe(1);
  expect(Array.from(s.trails!.colors.slice(0,3))).toEqual([0,0,F(128/255)]);expect(Array.from(s.trails!.alphas)).toEqual([0,F(127/255),1]);
 });
 it('keeps separate slot histories, detached snapshots and copied configuration',()=>{
  const input=options({particle_count_cpu:2}),owner=new SourceAttractorCpuParticles(input);input.visualConfiguration.trails.show=false;input.visualConfiguration.palette={kind:'colors',colors:['#fff']};
  owner.update(frame(0));const s=owner.snapshot();expect(s.trails!.particleIds).toEqual(new Uint32Array([0,0,0,1,1,1]));expect(s.trails!.indices).toEqual(new Uint32Array([0,1,1,2,3,4,4,5]));
  s.colors!.fill(0);s.packedColors!.fill(0);s.trails!.positions.fill(0);expect(owner.snapshot().trails!.positions[0]).toBe(3);expect(owner.snapshot().packedColors![0]).toBe(0x80ff0000);
 });
 it('filters nonfinite trail edges without compacting or reseeding the head slot',()=>{
  // Explicit equation with first finite update then infinity: dx=1/(1-x).
  const b=options({},0,['#ff0000'],'1/(1-x)');const owner=new SourceAttractorCpuParticles(b);owner.update(frame(0));const s=owner.snapshot();
  expect(s.positions[0]).toBe(Infinity);expect(s.particleIds).toEqual(new Uint32Array([0]));expect(s.trails!.records).toBe(3);expect(s.trails!.positions).toEqual(new Float32Array([3,0,0]));expect(s.trails!.indices.length).toBe(0);expect(s.integrationSteps[0]).toBe(3);
 });
 it('does no visible recording or gradient work for showTrails=false but still integrates',()=>{
  const owner=new SourceAttractorCpuParticles(options({show_trails:false})),before=owner.snapshot();owner.beginGradientActions([{kind:'start',config:{mode:'hue_rotate',interpolation:'rgb',speed:360}}]);owner.interpolateGradientActions(1,true);owner.update(frame(0));const after=owner.snapshot();expect(after.trails!.records).toBe(0);expect(after.colors).toEqual(before.colors);expect(after.positions[0]).toBe(7);
 });
 it('recolors existing history from current baseCol when source gradient refreshes, without historical-age colors',()=>{
  const owner=new SourceAttractorCpuParticles(options({},0,['#ff0000','#00ff00','#0000ff']));owner.update(frame(0));const before=owner.snapshot();
  owner.beginGradientActions([{kind:'start',config:{mode:'hue_rotate',interpolation:'rgb',speed:360}}]);owner.interpolateGradientActions(1,true);owner.update(frame(1));const s=owner.snapshot();expect(s.packedColors![0]).not.toBe(before.packedColors![0]);
  for(let i=0;i<s.trails!.positions.length;i+=3)expect(s.trails!.colors.slice(i,i+3)).toEqual(s.colors);
 });
 it('cancels and poisons history snapshots and captured targets',()=>{
  let cancelled=false;const owner=new SourceAttractorCpuParticles({...options(),isCancelled:()=>cancelled}),target=owner.bind({trackId:'t',actionIndex:0,action:{id:'t',method:'track',args:{index:0}}});owner.update(frame(0));cancelled=true;expect(()=>owner.snapshot()).toThrow('取消');cancelled=false;expect(()=>owner.update(frame(1))).toThrow('取消');if(target.kind==='bound')expect(()=>target.readPosition()).toThrow('取消');
 });
});

describe('source Attractor replay binds geometry, gradient and camera to one clock',()=>{
 const gradient:AnimationTrack={...wait,id:'gradient',type:'animate',target:'camera.actions',duration:.5,actions:[{id:'g',method:'gradientStart',gradient:{model:'offsets',mode:'hue_rotate',interpolation:'rgb',speed:90,affectInside:true,affectOutside:true}},{id:'t',method:'track',args:{index:0}}]};
 const run=(time:number)=>{const p=replaySourceAttractorCpu({...options({},0,['#ff0000','#00ff00','#0000ff']),camera,tracks:[gradient,{...wait,duration:.5}],fps:4,time});return{frame:p.frame,state:p.particles.snapshot()};};
 it('uses post-update head position at track completion, and freezes motion/color/trails after queue completion',()=>{
  const a=run(.25);expect(a.frame.camera.center).toEqual(Array.from(a.state.positions));const end=run(1),later=run(2);
  expect(end.frame.queueComplete).toBe(true);expect(later.state.positions).toEqual(end.state.positions);expect(later.state.colors).toEqual(end.state.colors);expect(later.state.trails).toEqual(end.state.trails);expect(later.state.trails!.records).toBe(12);
 });
 it('repeated and reverse seeks reconstruct the identical visual and camera state',()=>{
  const a=run(.75);run(2);run(0);const b=run(.75);expect(b).toEqual(a);
 });
 it('allows a numerical-only replay with empty gradient lifecycle, while refusing actual gradient actions',()=>{
  const {visualConfiguration:_,...motion}=options();const run=(tracks:AnimationTrack[])=>replaySourceAttractorCpu({...motion,camera,tracks,fps:4,time:0});
  expect(run([wait]).particles.snapshot().colors).toBeUndefined();expect(()=>run([gradient])).toThrow('视觉配置');
 });
 it('rejects unsupported parameter animation rather than executing a silent placeholder',()=>{
  const track={...gradient,actions:[{id:'p',method:'paramStart'}]};expect(()=>replaySourceAttractorCpu({...options(),camera,tracks:[track],fps:4,time:0})).toThrow('尚未接入');
 });
});


describe('source Attractor complete generated display frame',()=>{
 const viewport={logicalWidth:200,logicalHeight:100,referenceLogicalHeight:100,target:'primary' as const,projectionPass:'perspective' as const};
 const input=()=>({...options(),camera,tracks:[wait],fps:4,time:.25,viewport,backgroundColor:0xff102030});
 it('pairs the source point and indexed line contracts with the same motion/camera frame',()=>{
  const out=generateSourceAttractorCpu(input());
  expect(out.positions[0]).toBe(13);expect(out.sourceCameraFrame!.frameIndex).toBe(1);expect(out.temporal!.recordedPoints).toBe(6);
  expect(out.sourceBackgroundColor).toBe(0xff102030);expect(out.trails!.appearance).toEqual({model:'processing-lines-1.7.8',overlay:true,width:F(F(.8)*F(.95))});
  expect(out.trails!.positions.at(-3)).toBe(out.positions[0]);expect(out.sourcePointAppearance!.dotRadius).toBe(2);
 });
 it('keeps native trail width independent of offscreen scale and pixel density',()=>{
  const base=generateSourceAttractorCpu(input()),large=generateSourceAttractorCpu({...input(),viewport:{...viewport,logicalWidth:400,logicalHeight:200,target:'offscreen'},referencePixelDensity:2});
  expect(large.trails!.appearance!.width).toBe(base.trails!.appearance!.width);expect(large.sourcePointAppearance!.radius).not.toBe(base.sourcePointAppearance!.radius);
 });
 it('omits disabled visible history and rejects malformed display inputs before allocating motion',()=>{
  const v=input();v.visualConfiguration.trails.show=false;expect(generateSourceAttractorCpu(v).trails).toBeUndefined();
  expect(()=>generateSourceAttractorCpu({...input(),backgroundColor:-1})).toThrow('uint32');
  expect(()=>generateSourceAttractorCpu({...input(),viewport:{...viewport,projectionPass:'unknown'}})).toThrow('投影');
 });
});
