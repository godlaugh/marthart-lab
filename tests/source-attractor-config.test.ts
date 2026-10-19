import {describe,it,expect} from 'vitest';
import {importSourceAttractorConfig,parseSourceAttractorConfiguration} from '../src/engine/sourceAttractorConfig';
function config(settings?:unknown,initialization?:unknown){const r=importSourceAttractorConfig(settings,initialization);if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;}
describe('source Attractor configuration ownership',()=>{
 it('preserves absent versus empty source sections with native constructor defaults',()=>{
  const absent=config(),empty=config({}, {bounds:{}});
  expect(absent.configuration).toMatchObject({model:'attractor-1.7.8',settingsPresence:'absent',initializationPresence:'absent',boundsPresence:'absent',nativeBackend:'cpu',particleCountCPU:250,particleCountGPU:200000,dtRange:{min:Math.fround(.005),max:Math.fround(.01)},stepsPerFrame:5,warmup:{steps:0,staggerMin:0,staggerMax:0}});
  expect(empty.configuration).toMatchObject({settingsPresence:'object',initializationPresence:'object',boundsPresence:'object'});
  expect(empty.consumedPaths).toEqual([['settings'],['initialization','bounds']]);
 });
 it('uses native count alias precedence and only the CPU 10000 clamp',()=>{
  expect(config({particle_count:12000}).configuration).toMatchObject({particleCountCPU:10000,particleCountGPU:12000});
  expect(config({particle_count:19,particle_count_cpu:3}).configuration).toMatchObject({particleCountCPU:3,particleCountGPU:200000});
  expect(config({particle_count:19,particle_count_gpu:23}).configuration).toMatchObject({particleCountCPU:19,particleCountGPU:23});
  const both=config({particle_count:19,particle_count_cpu:3,particle_count_gpu:23});
  expect(both.configuration).toMatchObject({particleCountCPU:3,particleCountGPU:23});
  expect(both.consumedPaths).not.toContainEqual(['settings','particle_count']);
  expect(config({particle_count:-2}).configuration.particleCountCPU).toBe(-2);
 });
 it('supports ConfigUtils empty-scope expressions and Java int casts without treating fallback as a source default',()=>{
  const c=config({particle_count_cpu:'2*3',particle_count_gpu:'bogus',sub_steps:'5.9',scale_x:'PI*2',scale_y:null,scale_z:true,time_step:'1/8'}).configuration;
  expect(c.particleCountCPU).toBe(6);expect(c.particleCountGPU).toBe(0);expect(c.stepsPerFrame).toBe(5);
  expect(c.transform.scaleX).toBe(Math.fround(2*Math.PI));expect(c.transform.scaleY).toBe(1);expect(c.transform.scaleZ).toBe(0);
  expect(c.dtRange).toEqual({min:.125,max:.125});
  expect(config({sub_steps:'Infinity'}).configuration.stepsPerFrame).toBe(0);
  expect(config({sub_steps:'1/0'}).configuration.stepsPerFrame).toBe(2147483647);
  expect(config({sub_steps:'0/0'}).configuration.stepsPerFrame).toBe(0);
  expect(config({particle_count_cpu:null,particle_count_gpu:null}).configuration).toMatchObject({particleCountCPU:2000,particleCountGPU:200000});
 });
 it('preserves Java numeric token interpretation rather than guessing Long or Double narrowing',()=>{
  const source={sub_steps:4294967297};
  expect(importSourceAttractorConfig(source,undefined).ok).toBe(false);
  const integral=importSourceAttractorConfig(source,undefined,{numberToken:path=>path.join('.')==='settings.sub_steps'?'4294967297':undefined});
  const floating=importSourceAttractorConfig(source,undefined,{numberToken:path=>path.join('.')==='settings.sub_steps'?'4294967297.0':undefined});
  expect(integral.ok&&integral.value.configuration.stepsPerFrame).toBe(1);
  expect(floating.ok&&floating.value.configuration.stepsPerFrame).toBe(2147483647);
 });
 it('sorts dt endpoints after source rounding, retains reversed bounds and authored warmup integers',()=>{
  const c=config({time_step:.6,time_step_min:.2,time_step_max:.1},{bounds:{min_x:4,max_x:-2},warmup_steps:-5,warmup_stagger_min:9,warmup_stagger_max:3});
  expect(c.configuration.dtRange).toEqual({min:Math.fround(.1),max:Math.fround(.2)});
  expect(c.consumedPaths).not.toContainEqual(['settings','time_step']);
  expect(c.configuration.bounds).toMatchObject({minX:4,maxX:-2});
  expect(c.configuration.warmup).toEqual({steps:-5,staggerMin:9,staggerMax:3});
 });
 it('returns detached exact saved facts without repeating native normalization',()=>{
  const input=config({render_mode:'gPu'}).configuration;input.particleCountCPU=12000;input.dtRange={min:2,max:1};
  const r=parseSourceAttractorConfiguration(input);if(!r.ok)throw Error(JSON.stringify(r.error));
  expect(r.value).toEqual(input);expect(r.value).not.toBe(input);
  input.bounds.minX=99;expect(r.value.bounds.minX).toBe(-1);
 });
 it('rejects malformed saved contracts, nonfinite transport, excessive text and malformed native sections',()=>{
  for(const bad of [null,[],4]){expect(importSourceAttractorConfig(bad,undefined).ok).toBe(false);expect(importSourceAttractorConfig(undefined,bad).ok).toBe(false);expect(importSourceAttractorConfig(undefined,{bounds:bad}).ok).toBe(false);}
  for(const bad of [true,1,null])expect(importSourceAttractorConfig({render_mode:bad},undefined).ok).toBe(false);
  for(const value of [Infinity,'1/0','NaN'])expect(importSourceAttractorConfig({scale_x:value},undefined)).toMatchObject({ok:false,error:{kind:'nonfinite'}});
  expect(importSourceAttractorConfig({scale_x:'x'.repeat(65537)},undefined)).toMatchObject({ok:false,error:{kind:'capacity'}});
  const c=config().configuration;
  for(const broken of [{...c,unknown:1},{...c,model:'local-v1'},{...c,particleCountCPU:1.5},{...c,stepsPerFrame:2147483648},{...c,bounds:{...c.bounds,minX:Infinity}}])expect(parseSourceAttractorConfiguration(broken).ok).toBe(false);
 });
});
