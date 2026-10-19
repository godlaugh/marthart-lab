import {describe,it,expect} from 'vitest';
import {SourcePerlinParticleMotion,type SourcePerlinParticleFrame} from '../src/engine/sourcePerlinParticleMotion';
import {sourcePerlinSeed} from '../src/engine/sourcePerlinSeed';
import fixture from './fixtures/source-perlin/particles.json';
const config={seed:'12345',count:4,width:800,height:600};
const frame:SourcePerlinParticleFrame={time:1,deltaTime:1/60,noiseScale:8,noiseOffset:0,stepSize:.15,timeScale:0,respawnRate:0,flowMode:'ANGLE_FIELD',angleMap:'LINEAR'};
const xy=(p:number[][])=>p.flatMap(v=>v.slice(0,2));
describe('source Perlin CPU particle motion',()=>{
 for(const c of fixture.cases.filter(c=>!('diagnostic' in c&&c.diagnostic)))it(`matches independent source trajectory: ${c.name}`,()=>{
  const p=c.config,motion=new SourcePerlinParticleMotion({seed:p.seed,count:p.particleCount,width:p.width,height:p.height});
  expect(sourcePerlinSeed(p.seed).randomSeed.toString()).toBe(c.initial.randomSeed);
  expect(motion.textureSeed).toBe(c.initial.textureSeed);
  let snapshot=motion.snapshot();expect([...snapshot.positions]).toEqual(xy(c.initial.positions));expect([...snapshot.velocities]).toEqual(c.initial.velocities.flat());expect(snapshot.randomState48).toBe(c.initial.randomState);
  for(const f of c.frames){
   motion.update({...p,flowMode:p.flowMode as SourcePerlinParticleFrame['flowMode'],angleMap:p.angleMap as SourcePerlinParticleFrame['angleMap'],...f.input,deltaTime:f.input.dt});
   snapshot=motion.snapshot();expect([...snapshot.positions]).toEqual(xy(f.expected.positions));expect([...snapshot.velocities]).toEqual(f.expected.velocities.flat());
   expect([...new Uint32Array(snapshot.actualSteps.buffer)]).toEqual(f.expected.actualStepBits);expect([...snapshot.flags].map(v=>!!(v&1))).toEqual(f.expected.wrapped);expect([...snapshot.flags].map(v=>!!(v&2))).toEqual(f.expected.respawned);expect(snapshot.randomState48).toBe(f.expected.randomState);
  }
 });
 it('returns isolated snapshots and keeps independent owners deterministic',()=>{
  const a=new SourcePerlinParticleMotion(config),b=new SourcePerlinParticleMotion(config);a.snapshot().positions.fill(0);
  a.update(frame);b.update(frame);expect(a.snapshot()).toEqual(b.snapshot());expect(a.diagnostics().particleStateBytes).toBe(84);expect(a.diagnostics().retainedBytes).toBe(84+16384);
 });
 it('rejects excessive allocations and invalid count before sampling noise',()=>{
  for(const count of [-1,.5,NaN])expect(()=>new SourcePerlinParticleMotion({...config,count})).toThrow(expect.objectContaining({code:'input'}));
  expect(()=>new SourcePerlinParticleMotion({...config,count:250001})).toThrow(expect.objectContaining({code:'capacity'}));
 });
 it('invalid and partially failed updates cannot publish corrupted motion',()=>{
  const bad=new SourcePerlinParticleMotion(config);expect(()=>bad.update({...frame,time:Infinity})).toThrow(expect.objectContaining({code:'nonfinite'}));expect(()=>bad.snapshot()).toThrow(expect.objectContaining({code:'failed'}));
  let calls=0;const motion=new SourcePerlinParticleMotion({...config,noise:{sample:()=>++calls>3?NaN:.5}});
  expect(()=>motion.update(frame)).toThrow(expect.objectContaining({code:'nonfinite'}));expect(()=>motion.snapshot()).toThrow(expect.objectContaining({code:'failed'}));
 });
 it('honors cancellation before initialization and during an update',()=>{
  expect(()=>new SourcePerlinParticleMotion({...config,isCancelled:()=>true})).toThrow(expect.objectContaining({code:'cancelled'}));
  let checks=0,armed=false;const motion=new SourcePerlinParticleMotion({...config,isCancelled:()=>armed&&++checks===3});armed=true;
  expect(()=>motion.update(frame)).toThrow(expect.objectContaining({code:'cancelled'}));armed=false;expect(()=>motion.snapshot()).toThrow(expect.objectContaining({code:'failed'}));
 });
});
