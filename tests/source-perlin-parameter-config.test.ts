import {describe,it,expect} from 'vitest';
import {importSourcePerlinParameterAction,parseSourcePerlinParameterAction,type SourcePerlinParameterResult} from '../src/engine/sourcePerlinParameterConfig';
import {validateTimelineExtensions} from '../src/engine/timeline';
import type {AnimationTrack} from '../src/types';
const take=<T>(r:SourcePerlinParameterResult<T>)=>{if(!r.ok)throw Error(r.error.reason);return r.value;};
const read=(args:unknown,method:'paramStart'|'paramStop'='paramStart')=>take(importSourcePerlinParameterAction(method,args));
describe('Perlin parameter parsed boundary',()=>{
 it('distinguishes missing args from empty payloads and inspects only first array element',()=>{
  for(const raw of [undefined,null,1,true,'{}'])expect(read(raw).skipped).toBe(true);
  for(const raw of [{},[],[null,{parameters:{noise_scale:{}}}]])expect(read(raw).action).toEqual({kind:'start',parameters:[]});
  expect(read([{parameters:{noise_scale:{}}},{parameters:{noise_offset:{}}}]).action?.parameters.map(p=>p.name)).toEqual(['noise_scale']);
 });
 it('uses fixed order, defaults, swaps and clamps double bounds',()=>{
  const action=read({parameters:{curve_angle_scale:{min:-5,max:-3},noise_scale:{min:30,max:4},noise_offset:{min:4,max:-8},curve_noise_scale:{}}}).action;
  expect(action?.parameters).toEqual([{name:'noise_offset',step:.01,min:-1,max:1},{name:'noise_scale',step:1,min:4,max:30},{name:'curve_noise_scale',step:.02,min:.45,max:5.8},{name:'curve_angle_scale',step:.05,min:.1,max:.1}]);
 });
 it('uses getDouble fallback, never float rounding or expression evaluation',()=>{
  expect(read({parameters:{noise_scale:{step:'0.123456789123',min:'0x1p2',max:'2*PI'}}}).action?.parameters[0]).toEqual({name:'noise_scale',step:.123456789123,min:4,max:30});
  for(const step of [null,true,{},'bad'])expect(read({parameters:{noise_scale:{step}}}).action?.parameters[0].step).toBe(1);
 });
 it('default enable catches malformed values, while exact false strings skip configs',()=>{
  for(const enable of [null,1,{},' false ',true])expect(read({parameters:{noise_scale:{enable}}}).action?.parameters).toHaveLength(1);
  for(const enable of [false,'FaLsE','falſe'])expect(read({parameters:{noise_scale:{enable,step:'NaN'}}}).action?.parameters).toEqual([]);
 });
 it('stop still parses numeric configuration and empty stop means all',()=>{
  expect(read({},'paramStop').action).toEqual({kind:'stop',parameters:[]});
  expect(read({parameters:{noise_offset:{step:-.03}}},'paramStop').action?.parameters[0].step).toBe(-.03);
  expect(importSourcePerlinParameterAction('paramStop',{parameters:{noise_offset:{step:'NaN'}}})).toMatchObject({ok:false,error:{kind:'nonfinite'}});
 });
 it('retains consumed and numeric paths without claiming unknown parameter fields',()=>{
  const input=[{parameters:{noise_offset:{min:0,other:4},unknown:{step:2}}}];const before=structuredClone(input),facts=read(input);
  expect(facts.numericPaths).toEqual([['0','parameters','noise_offset','min']]);expect(facts.consumedPaths).toEqual(facts.numericPaths);expect(input).toEqual(before);
 });
 it('rejects malformed containers and unsupported nonfinite local representation',()=>{
  for(const parameters of [null,[],true])expect(importSourcePerlinParameterAction('paramStart',{parameters}).ok).toBe(false);
  for(const step of [Infinity,NaN,'Infinity'])expect(importSourcePerlinParameterAction('paramStart',{parameters:{noise_scale:{step}}})).toMatchObject({ok:false,error:{kind:'nonfinite'}});
 });
 it('validates canonical ordering, representation and detached immutable facts',()=>{
  const valid={kind:'start',parameters:[{name:'noise_scale',step:-1,min:4,max:30}]};const parsed=take(parseSourcePerlinParameterAction(valid));valid.parameters[0].step=8;expect(parsed.parameters[0].step).toBe(-1);expect(Object.isFrozen(parsed.parameters[0])).toBe(true);
  for(const raw of [{...valid,other:true},{kind:'unknown',parameters:[]},{...valid,parameters:[...valid.parameters,...valid.parameters]},{...valid,parameters:[{...valid.parameters[0],min:0}]}])expect(parseSourcePerlinParameterAction(raw).ok).toBe(false);
 });
 it('does not silently execute source parameters as a local document animation',()=>{
  const track={actions:[{method:'paramStart',perlinParameters:{kind:'start',parameters:[]}}]} as unknown as AnimationTrack;
  expect(()=>validateTimelineExtensions(track,'perlin')).toThrow(/只能用于源 Perlin 作品/);
 });
});
