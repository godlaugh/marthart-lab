import {describe,it,expect} from 'vitest';
import fixtures from './fixtures/source-attractor/motion.json';
import {importSourceAttractorConfig} from '../src/engine/sourceAttractorConfig';
import {prepareSourceAttractorEquation,sourceAttractorEulerStep} from '../src/engine/sourceAttractorEquation';
import {SourceAttractorCpuParticles} from '../src/engine/sourceAttractorCpuParticles';
import {evaluateOrdinarySourceCameraTimeline} from '../src/engine/ordinarySourceCameraTimeline';
import type {AnimationTrack} from '../src/types';

function configuration(settings:Record<string,unknown>={},initialization:Record<string,unknown>={}){
 const parsed=importSourceAttractorConfig({particle_count_cpu:2,sub_steps:1,time_step:.1,...settings},initialization);if(!parsed.ok)throw Error(parsed.error.reason);return parsed.value.configuration;
}
function equation(equations:Record<string,string>={dx:'1',dy:'2',dz:'-1'},parameters:Record<string,number>={}){
 const parsed=prepareSourceAttractorEquation({equations,parameters});if(!parsed.ok)throw Error(parsed.error.reason);return parsed.value;
}
const bits=(values:Float32Array)=>Array.from(new Uint32Array(values.buffer,values.byteOffset,values.length));
const request=(index:number)=>({trackId:'track',actionIndex:0,action:{id:'track',method:'track',args:{index}}});
const frame=(frameIndex:number,deltaTime=.25)=>({frameIndex,time:(frameIndex+1)/4,deltaTime});
const bound=(owner:SourceAttractorCpuParticles,index:number)=>{const b=owner.bind(request(index));if(b.kind!=='bound')throw Error('bound required');return b;};

describe('source Attractor CPU motion owner',()=>{
 it.each(fixtures.cases)('matches independent staged Float32 trajectory: $name',c=>{
  const [x,y,z]=c.initial,configurationValue=configuration({particle_count_cpu:1,sub_steps:c.substeps,time_step:c.dt,scale_x:c.scale[0],scale_y:c.scale[1],scale_z:c.scale[2],offset_x:c.offset[0],offset_y:c.offset[1],offset_z:c.offset[2]},
   {warmup_steps:c.warmup,bounds:{min_x:x,max_x:x,min_y:y,max_y:y,min_z:z,max_z:z}});
  const parameters=Object.fromEntries(Object.entries(c.parameters).filter((row):row is [string,number]=>typeof row[1]==='number'));
  const owner=new SourceAttractorCpuParticles({configuration:configurationValue,equation:equation(fixtures.equations,parameters)});
  for(let i=0;i<c.rows.length;i++){
   if(i)owner.update(frame(i-1,i===1?0:999));
   const state=owner.snapshot(),expected=c.rows[i];expect(bits(state.rawPositions)).toEqual(expected.rawBits);expect(bits(state.positions)).toEqual(expected.positionBits);expect(state.integrationSteps[0]).toBe(expected.steps);
  }
 });
 it('captures independent stable slots before playback and preserves source out-of-range no-ops',()=>{
  const owner=new SourceAttractorCpuParticles({configuration:configuration(),equation:equation()}),a=bound(owner,0),b=bound(owner,1),same=bound(owner,.9),beforeA=a.readPosition(),beforeB=b.readPosition();
  expect(beforeA).not.toEqual(beforeB);expect(same.readPosition()).toEqual(beforeA);
  expect(owner.bind(request(2)).kind).toBe('ignored');expect(owner.bind(request(-1)).kind).toBe('ignored');
  owner.update(frame(0));const snapshot=owner.snapshot();expect(a.readPosition()).toEqual(Array.from(snapshot.positions.subarray(0,3)));expect(b.readPosition()).toEqual(Array.from(snapshot.positions.subarray(3,6)));expect(a.readPosition()).not.toEqual(beforeA);
  snapshot.positions.fill(0);snapshot.rawPositions.fill(0);expect(a.readPosition()).not.toEqual([0,0,0]);expect(same.readPosition()).toEqual(a.readPosition());
 });
 it('copies authored configuration and snapshots; isolated owners never borrow state',()=>{
  const config=configuration(),field=equation(),first=new SourceAttractorCpuParticles({configuration:config,equation:field}),second=new SourceAttractorCpuParticles({configuration:config,equation:field});
  const before=second.snapshot();config.stepsPerFrame=50;config.transform.scaleX=0;first.update(frame(0));
  expect(second.snapshot().positions).toEqual(before.positions);expect(first.snapshot().integrationSteps).toEqual(new Float64Array([1,1]));expect(first.configuration.stepsPerFrame).toBe(1);
 });
 it('uses source pre-integration interpolation and post-integration target on transition completion',()=>{
  const config=configuration({particle_count_cpu:1,time_step:1},{bounds:{min_x:0,max_x:0,min_y:0,max_y:0,min_z:0,max_z:0}}),field=equation({dx:'1',dy:'0',dz:'0'});
  const initial={phi:0,theta:0,gamma:0,center:[0,0,0] as [number,number,number],zoom:1,focalDistance:250};
  const tracks:AnimationTrack[]=[{id:'follow',type:'animate',target:'camera.actions',from:0,to:0,start:0,duration:.5,easing:'linear',enabled:true,pingPong:false,actions:[request(0).action]},{id:'wait',type:'wait',target:'timeline.wait',from:0,to:0,start:0,duration:.5,easing:'linear',enabled:true,pingPong:false}];
  const rows=[0,.25,.5,.75,1,2].map(time=>{
   let owner:SourceAttractorCpuParticles|undefined;const camera=evaluateOrdinarySourceCameraTimeline(initial,tracks,4,time,{createParticles:()=>owner=new SourceAttractorCpuParticles({configuration:config,equation:field})});
   return{camera,state:owner!.snapshot()};
  });
  expect(rows.map(r=>r.camera.camera.center[0])).toEqual([0,2,3,4,4,4]);expect(rows.map(r=>r.state.rawPositions[0])).toEqual([1,2,3,4,4,4]);expect(rows.at(-1)!.camera.queueComplete).toBe(true);
 });
 it('retains nonfinite trajectories and slot identity rather than stopping or respawning',()=>{
  const owner=new SourceAttractorCpuParticles({configuration:configuration({particle_count_cpu:1}),equation:equation({dx:'1/0',dy:'0',dz:'0'})}),target=bound(owner,0);
  owner.update(frame(0));expect(owner.snapshot().rawPositions[0]).toBe(Infinity);expect(target.readPosition()[0]).toBe(Infinity);owner.update(frame(1));expect(owner.snapshot().integrationSteps[0]).toBe(2);
 });
 it('honors cancellation, poisons captured bindings, and rejects work before starting an oversized frame',()=>{
  let cancelled=false;const owner=new SourceAttractorCpuParticles({configuration:configuration(),equation:equation(),isCancelled:()=>cancelled}),target=bound(owner,0);
  cancelled=true;expect(()=>owner.update(frame(0))).toThrow('取消');cancelled=false;expect(()=>target.readPosition()).toThrow('取消');expect(()=>owner.snapshot()).toThrow('取消');
  const large=new SourceAttractorCpuParticles({configuration:configuration({sub_steps:2147483647}),equation:equation()});expect(()=>large.update(frame(0))).toThrow('预算');expect(()=>large.snapshot()).toThrow('预算');
 });
 it('rejects out-of-order updates and late binds, including reuse after failure',()=>{
  const a=new SourceAttractorCpuParticles({configuration:configuration(),equation:equation()});expect(()=>a.update(frame(1))).toThrow('顺序');expect(()=>a.update(frame(0))).toThrow('顺序');
  const b=new SourceAttractorCpuParticles({configuration:configuration(),equation:equation()});b.update(frame(0));expect(()=>b.bind(request(0))).toThrow('播放前');
 });
 it('pins execution cost to the constructed equation instead of later caller options',()=>{
  const field=equation(),options={configuration:configuration({sub_steps:2147483647}),equation:field};
  const owner=new SourceAttractorCpuParticles(options);options.equation={operations:-12,create:field.create};
  expect(()=>owner.update(frame(0))).toThrow('预算');
 });
 it('preserves zero-count state and rejects using the CPU owner for source GPU',()=>{
  const empty=new SourceAttractorCpuParticles({configuration:configuration({particle_count_cpu:0,sub_steps:2147483647}),equation:equation()});expect(empty.bind(request(0)).kind).toBe('ignored');empty.update(frame(0));expect(empty.snapshot().positions).toHaveLength(0);expect(empty.snapshot().frameIndex).toBe(0);
  expect(()=>new SourceAttractorCpuParticles({configuration:configuration({render_mode:'GPU'}),equation:equation()})).toThrow('GPU');
 });
});

describe('source Attractor differential equation',()=>{
 it('evaluates all axes from the old coordinate snapshot and keeps double parameter precision',()=>{
  const p={a:1+2**-40},prepared=equation({dx:'(a-1)*1099511627776',dy:'x',dz:'y'},p);p.a=0;const raw=new Float32Array([3,4,5]);sourceAttractorEulerStep(prepared.create(),raw,0,1,new Float32Array(3));expect(Array.from(raw)).toEqual([4,7,9]);
 });
 it('does not fuse Float32 multiply/add or replace syntax failures with zero',()=>{
  const raw=new Float32Array([-1,0,0]),a=1+2**-23,dt=1-2**-23;
  sourceAttractorEulerStep(equation({dx:String(a),dy:'0',dz:'0'}).create(),raw,0,dt,new Float32Array(3));expect(raw[0]).toBe(0);expect(Math.fround(a*dt-1)).not.toBe(0);
  expect(prepareSourceAttractorEquation({equations:{dx:'(',dy:'0',dz:'0'},parameters:{}})).toMatchObject({ok:false,error:{kind:'input',path:['equations','dx']}});
  expect(prepareSourceAttractorEquation({equations:{dx:'0',dy:'0',dz:'0'},parameters:{a:Infinity}})).toMatchObject({ok:false,error:{kind:'input'}});
 });
});
