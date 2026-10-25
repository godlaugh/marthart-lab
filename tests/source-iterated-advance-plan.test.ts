import {describe,expect,it} from 'vitest';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {prepareIteratedFrame} from '../src/scenes/iteratedDensity';
import {prepareSourceIterationFramePlan,prepareSourceIterationReplayFrame} from '../src/engine/sourceIterationFramePlan';
import {prepareSourceIteratedAdvancePlan} from '../src/engine/sourceIteratedAdvancePlan';

function job(family:'map'|'symmetry',burn=513){
 const scene=(family==='map'?parseLegacyScene:parseProjectFile)(JSON.stringify({config_version:'1.0.0',name:'Advance boundary',type:family==='map'?'MAP_ATTRACTOR':'SYMMETRY_CHAOS',parameters:family==='map'?{gain:.001}:{alpha:2.5},equations:family==='map'?{x_next:'x+gain',y_next:'y'}:undefined,settings:{batch_size:8,burn_in_steps:burn,iterations_per_frame:2}}),{sourceEntry:'runtime-config'}).scene;
 return prepareIteratedFrame(scene,0,0);
}
describe('prepared Map/Symmetry compute calls',()=>{
 it.each(['map','symmetry'] as const)('keeps %s first-update warmup and two ordered parameter snapshots',family=>{
  const j=job(family),a={...j.field,time:1},b={...j.field,time:2};j.iterationUpdates=[a,b];
  j.iterationFrame=prepareSourceIterationFramePlan(family,{frameIndex:0,updateCount:2},false,j.config.burn,j.config.iterations);
  const p=prepareSourceIteratedAdvancePlan(j,true),warm=p.advances.filter(v=>v.phase==='warmup'),updates=p.advances.filter(v=>v.phase==='update');
  expect(warm.map(v=>[v.steps,v.serial,v.resetCounter])).toEqual(family==='map'?[[256,1,true],[256,257,false],[1,513,false]]:[[16,1,true]]);
  expect(warm.every(v=>v.field===a)).toBe(true);expect(updates.map(v=>[v.steps,v.serial,v.resetCounter])).toEqual([[2,514,false],[2,516,false]]);
  expect(updates[0].field).toBe(a);expect(updates[1].field).toBe(b);expect(p.publishState&&p.reportInvalid).toBe(true);
 });
 it('clears invalid counters once per later display without resetting the trajectory',()=>{
  const j=job('map');j.frame=3;j.iterationUpdates=[{...j.field,time:3},{...j.field,time:4}];j.iterationFrame=prepareSourceIterationFramePlan('map',{frameIndex:3,updateCount:2},true,513,2);
  const p=prepareSourceIteratedAdvancePlan(j,false);expect(p.resetParticles).toBe(false);expect(p.warmupSteps).toBe(0);
  expect(p.advances.map(v=>[v.serial,v.resetCounter])).toEqual([[610,true],[612,false]]);
 });
 it('restores canonical seeds on an initial paused display without inventing a shader call',()=>{
  const j=job('symmetry');j.iterationUpdates=[];j.iterationFrame=prepareSourceIterationFramePlan('symmetry',{frameIndex:0,updateCount:0},false,513,2);
  expect(prepareSourceIteratedAdvancePlan(j,true)).toMatchObject({resetParticles:true,advances:[],publishState:true,reportInvalid:false,warmupSteps:0,iterationSteps:0});
  expect(prepareSourceIteratedAdvancePlan(j,false)).toMatchObject({resetParticles:false,advances:[],publishState:false,reportInvalid:false});
 });
 it('keeps replay advances distinct from ordinary object updates, including burn-only frames',()=>{
  const j=job('symmetry');j.frame=4;j.iterationFrame=prepareSourceIterationReplayFrame('symmetry',4,8,2);
  expect(prepareSourceIteratedAdvancePlan(j,true).advances.map(v=>[v.phase,v.steps,v.serial,v.resetCounter])).toEqual([['warmup',8,1,true],['frame',2,578,false]]);
  j.iterationFrame=prepareSourceIterationReplayFrame('symmetry',4,8,0);
  expect(prepareSourceIteratedAdvancePlan(j,false)).toMatchObject({iterationSteps:0,reportInvalid:true,publishState:true,advances:[{phase:'warmup',steps:8}]});
  j.iterationFrame=prepareSourceIterationReplayFrame('symmetry',4,0,0);
  expect(prepareSourceIteratedAdvancePlan(j,false)).toMatchObject({advances:[],publishState:false,reportInvalid:false});
 });
 it('preserves an absent event as the local single-field path rather than a paused empty event',()=>{
  const j=job('map',0);j.frame=3;
  expect(prepareSourceIteratedAdvancePlan(j,false).advances.map(v=>[v.phase,v.steps,v.serial,v.resetCounter])).toEqual([['frame',2,49,true]]);
  j.iterationFrame=prepareSourceIterationFramePlan('map',{frameIndex:3,updateCount:0},true,0,2);j.iterationUpdates=[];
  expect(prepareSourceIteratedAdvancePlan(j,false).advances).toEqual([]);
 });
 it.each(['missing-fields','sparse-fields','wrong-field','wrong-model','bad-warmup','replay-updates','bad-work','serial-overflow'] as const)('rejects %s before an execution plan can escape',caseName=>{
  const j=job('map');j.iterationFrame=prepareSourceIterationFramePlan('map',{frameIndex:0,updateCount:2},false,513,2);j.iterationUpdates=[j.field,j.field];
  if(caseName==='missing-fields')j.iterationUpdates=undefined;
  if(caseName==='sparse-fields')j.iterationUpdates=new Array(2);
  if(caseName==='wrong-field')j.iterationUpdates=[j.field,job('symmetry').field];
  if(caseName==='wrong-model')j.iterationFrame={...j.iterationFrame,model:'symmetry-frame-1.7.8'};
  if(caseName==='bad-warmup')j.iterationFrame={...j.iterationFrame,warmupSteps:514};
  if(caseName==='replay-updates')j.iterationFrame=prepareSourceIterationReplayFrame('map',0,8,2);
  if(caseName==='bad-work')j.config.burn=Infinity;
  if(caseName==='serial-overflow')j.frame=0xffffffff;
  expect(()=>prepareSourceIteratedAdvancePlan(j,true)).toThrow();
 });
});
