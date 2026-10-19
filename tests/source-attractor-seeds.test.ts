import {describe,it,expect} from 'vitest';
import fixture from './fixtures/source-attractor/seeds.json';
import {importSourceAttractorConfig} from '../src/engine/sourceAttractorConfig';
import {createSourceAttractorSeedStream} from '../src/engine/sourceAttractorSeeds';
import {JavaSourceRandom48} from '../src/engine/javaSourceRandom';
function config(settings?:unknown,initialization?:unknown){const r=importSourceAttractorConfig(settings,initialization);if(!r.ok)throw Error(JSON.stringify(r.error));return r.value.configuration;}
function stream(settings?:unknown,initialization?:unknown){const r=createSourceAttractorSeedStream(config(settings,initialization));if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;}
describe('source Attractor deterministic seed facts',()=>{
 for(const row of fixture.cases)it(`matches independent source arithmetic: ${row.id}`,()=>{
  const s=stream(row.settings??undefined,row.initialization??undefined);
  expect(s.count).toBe(row.expected.count);expect(s.variableDt).toBe(row.expected.variableDt);
  for(const seed of row.expected.seeds)expect(s.next()).toEqual({ok:true,value:seed});
  if(s.count===row.expected.seeds.length)expect(s.next()).toEqual({ok:true,value:null});
 });
 it('keeps warmup RNG independent of positional dt draws and GPU initial CPU references unmodified',()=>{
  const init={warmup_steps:4,warmup_stagger_min:1,warmup_stagger_max:7};
  const fixed=stream({particle_count:8,time_step:.01},init),varying=stream({particle_count:8},init),gpu=stream({particle_count:8,render_mode:'GPU'},init);
  const a=[],b=[];
  for(let i=0;i<8;i++){
   const x=fixed.next(),y=varying.next(),z=gpu.next();if(!x.ok||!y.ok||!z.ok||!x.value||!y.value||!z.value)throw Error('unexpected seed failure');
   expect(x.value.warmupSteps).toBe(y.value.warmupSteps);expect(z.value.warmupSteps).toBe(0);expect(z.value.raw).toEqual(y.value.raw);expect(z.value.position).toEqual(y.value.position);
   a.push(x.value.raw);b.push(y.value.raw);
  }
  expect(a[0]).toEqual(b[0]);expect(a[1]).not.toEqual(b[1]);
 });
 it('owns immutable detached seed facts and snapshots configuration before iteration',()=>{
  const c=config({particle_count:2}),r=createSourceAttractorSeedStream(c);if(!r.ok)throw Error('unexpected');
  c.bounds.minX=999;c.transform.scaleX=888;c.warmup.steps=777;
  const first=r.value.next(),second=r.value.next();if(!first.ok||!first.value||!second.ok||!second.value)throw Error('unexpected');
  expect(first.value).toEqual(fixture.cases[0].expected.seeds[0]);expect(second.value).toEqual(fixture.cases[0].expected.seeds[1]);
  expect(Object.isFrozen(first.value.raw)).toBe(true);expect(second.value.raw).not.toBe(first.value.raw);
 });
 it('is lazy at Java count limits; rejects negative count and preserves terminal arithmetic failure',()=>{
  const large=stream({render_mode:'GPU',particle_count_gpu:2147483647});expect(large.count).toBe(2147483647);expect(large.next().ok).toBe(true);
  expect(createSourceAttractorSeedStream(config({particle_count:-1}))).toMatchObject({ok:false,error:{kind:'input'}});
  const c=config({particle_count:2});c.bounds.minX=3e38;c.bounds.maxX=3e38;c.transform.scaleX=2;
  const r=createSourceAttractorSeedStream(c);if(!r.ok)throw Error('unexpected');
  const first=r.value.next();expect(first).toMatchObject({ok:false,error:{kind:'nonfinite',path:['particles','0']}});expect(r.value.next()).toEqual(first);
  c.bounds.minX=-3e38;expect(createSourceAttractorSeedStream(c)).toMatchObject({ok:false,error:{kind:'nonfinite'}});
 });
});
describe('shared retained Java Random primitive',()=>{
 for(const row of fixture.rng)it(`matches mixed float/int/double draws and rejection state for ${row.seed}`,()=>{
  const rng=new JavaSourceRandom48(BigInt(row.seed));
  for(const op of row.operations){const value=op.method==='float'?rng.nextFloat():op.method==='int'?rng.nextInt(op.bound):rng.nextDouble();expect(value).toBe(op.value);expect(String(rng.state48)).toBe(op.state);}
 });
 it('has independent fixture witnesses for rejection and bounds and rejects invalid bounds without consuming',()=>{
  expect(fixture.rng.some(row=>row.operations.some(op=>op.method==='int'&&op.steps>1))).toBe(true);
  const rng=new JavaSourceRandom48(12345n),before=rng.state48;
  for(const bound of [0,-1,1.5,NaN,Infinity,2147483648])expect(()=>rng.nextInt(bound)).toThrow(RangeError);
  expect(rng.state48).toBe(before);const clone=rng.clone();expect(clone.nextFloat()).toBe(rng.nextFloat());
 });
});
