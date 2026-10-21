import {describe,expect,it} from 'vitest';
import type {DomainParameterAction} from '../src/types';
import {SourceDomainParameterRuntime,type SourceDomainParameterRuntimeAction} from '../src/engine/sourceDomainParameterRuntime';

const F=Math.fround;
function start(name?:string,configuration:NonNullable<DomainParameterAction['configuration']>={min:-1,max:1,step:.1}):SourceDomainParameterRuntimeAction {
 return{method:'paramStart',spec:{model:'domain-registry-1.7.8',scope:name===undefined?{kind:'all'}:{kind:'named',name},...(name===undefined?{}:{configuration})}};
}
function stop(name?:string):SourceDomainParameterRuntimeAction {
 return{method:'paramStop',spec:{model:'domain-registry-1.7.8',scope:name===undefined?{kind:'all'}:{kind:'named',name}}};
}
function setup(initial:Record<string,number>={},reserve:(n:number)=>void=()=>{}){
 const values={...initial},reads:string[]=[],writes:string[]=[];
 const runtime=new SourceDomainParameterRuntime({readScalar:name=>{reads.push(name);return values[name];},writeScalar:(name,value)=>{writes.push(name);values[name]=value;},reserve});
 return{runtime,values,reads,writes};
}
const uniform={min:-1,max:1,step:1,edgeEasing:{window:.5,floor:1,easing:'linear'}};

describe('source Domain parameter runtime',()=>{
 it('matches original active/raw numerical phases with the actual 37 fps caller',()=>{
  // Original DomainScene.update -> DomainParameterAnimator, active-source.json
  // case 0 frames 0..4. Two original JVM runs were identical. Source SHA-256:
  // 50a8ccb9ccb0e96311f25ff1b189cdf4f44c6a4c5cd6d3b2a69d4788d5458a1f.
  // This prescribed caller test does not claim to implement the scene queue.
  const {runtime,values}=setup({a:0,scale:2.5});
  runtime.begin([start('a',{min:-1,max:1,step:.02}),start('scale',{min:1,max:3,step:.03})]);
  const rows=[
   {dt:0,paused:false,eased:0,finished:false,phase:[0,.5235987755982989],gain:0,a:0,scale:2.5},
   {dt:F(.1),paused:false,eased:.3333333134651184,finished:false,phase:[.049333330025275554,.5975987706362123],gain:.3333333134651184,a:.04931332140255464,scale:2.5626590273501004},
   {dt:F(.1),paused:true,eased:.3333333134651184,finished:false,phase:[.049333330025275554,.5975987706362123],gain:.3333333134651184,a:.04931332140255464,scale:2.5626590273501004},
   {dt:F(.15),paused:false,eased:.8333333134651184,finished:false,phase:[.23433332883069888,.8750987688443472],gain:.8333333134651184,a:.23219458654376213,scale:2.767606809011032},
   {dt:F(.2),paused:false,eased:1,finished:true,phase:[.530333326625327,1.3185306661609826],gain:1,a:.5058209096845893,scale:2.9683494019607135},
  ];
  for(const row of rows){
   if(!row.paused){runtime.interpolate(row.eased,row.finished);if(row.dt>0){runtime.update(row.dt,37);runtime.update(row.dt,37);}}
   const s=runtime.snapshot();expect(s.entries.map(e=>e.name)).toEqual(['a','scale']);
   s.entries.forEach((e,i)=>{expect(e.phase).toBeCloseTo(row.phase[i],13);expect(e.scale).toBe(row.gain);});
   expect(values.a).toBeCloseTo(row.a,13);expect(values.scale).toBeCloseTo(row.scale,13);
  }
 });
 it('chooses an out-of-range endpoint by step sign and does not read degenerate ranges',()=>{
  const {runtime,reads}=setup({positive:10,negative:-10});
  runtime.begin([start('positive',{min:1,max:-1,step:.1}),start('negative',{min:1,max:-1,step:-.1}),start('narrow',{min:2,max:2+1e-12,step:1})]);
  const entries=Object.fromEntries(runtime.snapshot().entries.map(e=>[e.name,e]));
  expect(entries.positive.phase).toBe(-Math.PI/2);expect(entries.negative.phase).toBe(Math.PI/2);
  expect(entries.narrow.phase).toBe(0);expect(reads).not.toContain('narrow');
  expect(entries.positive.configuration).toEqual({min:1,max:-1,step:F(.1),edgeEasing:{window:.5,floor:.25,easing:'sine-out'}});
 });
 it('begins all children before interpolation and preserves inactive Stop completion',()=>{
  const {runtime,reads,values}=setup({a:.5});
  runtime.begin([stop(),start('a',{min:-1,max:1,step:.01}),start('a',{min:-2,max:2,step:-.04})]);
  expect(runtime.snapshot().children).toEqual([{finished:true},{finished:false},{finished:false}]);
  expect(reads).toEqual(['a','a']);expect(values.a).toBe(.5);
  expect(runtime.snapshot().entries[0].phase).toBe(Math.PI-Math.asin(.25));
  runtime.interpolate(.25,false);expect(runtime.snapshot().entries[0].scale).toBe(.25);
  runtime.interpolate(0,true);expect(runtime.snapshot().entries[0].scale).toBe(1);
 });
 it('captures Stop scales before later Start children and finishes against the current registry',()=>{
  const {runtime}=setup({a:0,b:0});
  runtime.begin([start('a')]);runtime.interpolate(.25,false);
  runtime.begin([stop(),start('b')]);runtime.interpolate(.5,false);
  expect(runtime.snapshot().entries.map(e=>[e.name,e.scale])).toEqual([['a',.125],['b',.5]]);
  runtime.interpolate(1,true);
  expect(runtime.running).toBe(false);expect(runtime.snapshot().entries.map(e=>[e.name,e.scale])).toEqual([['a',0],['b',1]]);
 });
 it('uses double Stop subtraction and does not register unknown Stop names',()=>{
  const {runtime}=setup({a:0});runtime.begin([start('a')]);runtime.interpolate(1,true);
  runtime.begin([stop('a'),stop('unknown')]);runtime.interpolate(.1,false);
  expect(runtime.snapshot().entries).toHaveLength(1);
  expect(runtime.snapshot().entries[0].scale).toBe(1-F(.1));
  expect(runtime.snapshot().entries[0].scale).not.toBe(F(1-F(.1)));
  runtime.interpolate(1,true);expect(runtime.running).toBe(true);
 });
 it('restarts from the currently bound value, retaining registration and replacing phases',()=>{
  const {runtime,values}=setup({a:0});runtime.begin([start('a',uniform)]);runtime.interpolate(1,true);runtime.update(.25,2);
  runtime.begin([stop()]);runtime.interpolate(1,true);values.a=.75;
  runtime.begin([start()]);expect(runtime.snapshot().entries[0].phase).toBe(Math.asin(.75));
  expect(runtime.snapshot().entries[0].scale).toBe(0);expect(runtime.running).toBe(true);
 });
 it('keeps double phases, wraps negative deltas, and uses fps <= 1 fallback 60',()=>{
  const negative=setup({a:0});negative.runtime.begin([start('a',uniform)]);negative.runtime.interpolate(1,true);negative.runtime.update(-1,2);
  expect(negative.runtime.snapshot().entries[0].phase).toBe(2*Math.PI-2);
  const one=setup({a:0}),sixty=setup({a:0});
  for(const r of [one.runtime,sixty.runtime]){r.begin([start('a')]);r.interpolate(1,true);}
  one.runtime.update(.01,1);sixty.runtime.update(.01,60);
  expect(one.runtime.snapshot()).toEqual(sixty.runtime.snapshot());expect(one.values).toEqual(sixty.values);
  const phase=one.runtime.snapshot().entries[0].phase!;expect(phase).not.toBe(F(phase));
 });
 it('retains Java HashMap capacity across clear, without reviving captured children',()=>{
  const {runtime,writes}=setup();runtime.begin(Array.from({length:13},(_,i)=>start(`k${i}`)));
  runtime.clear();runtime.interpolate(1,true);runtime.update(.1,60);expect(writes).toEqual([]);
  runtime.begin([start('q'),start('a')]);expect(runtime.snapshot().entries.map(e=>e.name)).toEqual(['a','q']);
  const fresh=setup();fresh.runtime.begin([start('q'),start('a')]);expect(fresh.runtime.snapshot().entries.map(e=>e.name)).toEqual(['q','a']);
 });
 it('owns immutable configuration and snapshots',()=>{
  const {runtime}=setup({a:0}),c={...uniform,edgeEasing:{...uniform.edgeEasing}};
  runtime.begin([start('a',c)]);c.min=99;c.edgeEasing.floor=0;
  const before=runtime.snapshot();expect(before.entries[0].configuration.min).toBe(-1);expect(before.entries[0].configuration.edgeEasing.floor).toBe(1);
  expect(Object.isFrozen(before.entries[0].configuration.edgeEasing)).toBe(true);
  runtime.interpolate(.5,false);expect(before.entries[0].scale).toBe(0);expect(runtime.snapshot().entries[0].scale).toBe(.5);
 });
 it('restores zero-duration NaN gains before update and rejects malformed boundaries',()=>{
  const {runtime,values}=setup({a:0});runtime.begin([start('a')]);runtime.interpolate(NaN,true);runtime.update(.01,60);
  expect(Number.isFinite(values.a)).toBe(true);expect(runtime.snapshot().entries[0].scale).toBe(1);
  for(const action of [start('a',{...uniform,min:Infinity}),{...start(),spec:{...start().spec,configuration:null}},stop('a')]){
   const r=setup().runtime;
   if(action.method==='paramStop')action.spec.configuration={...uniform};
   expect(()=>r.begin([action as SourceDomainParameterRuntimeAction])).toThrow();expect(()=>r.snapshot()).toThrow('需要重建');
  }
 });
 it('fails closed after shared work cancellation, partial write failure and nonfinite fps',()=>{
  let cancelled=false;const r=setup({a:0},()=>{if(cancelled)throw new DOMException('cancelled','AbortError');}).runtime;
  r.begin([start('a')]);r.interpolate(1,true);cancelled=true;expect(()=>r.update(.1,60)).toThrow('cancelled');expect(()=>r.snapshot()).toThrow('需要重建');
  let writes=0;const partial=new SourceDomainParameterRuntime({readScalar:()=>0,writeScalar:()=>{if(++writes===2)throw Error('setter failed');},reserve:()=>{}});
  partial.begin([start('a'),start('b')]);partial.interpolate(1,true);expect(()=>partial.update(.1,60)).toThrow('setter failed');expect(()=>partial.running).toThrow('需要重建');
  const fps=setup().runtime;fps.begin([start('a')]);expect(()=>fps.update(.1,Number.MAX_VALUE)).toThrow('必须有限');expect(()=>fps.update(.1,60)).toThrow('需要重建');
 });
 it('charges phase reduction and stops before an unbounded source wrap',()=>{
  let work=0;const {runtime}=setup({a:0},n=>{work+=n;if(work>100)throw Error('work exhausted');});
  runtime.begin([start('a',{...uniform,step:1e9})]);runtime.interpolate(1,true);
  expect(()=>runtime.update(1,60)).toThrow('work exhausted');expect(()=>runtime.snapshot()).toThrow('需要重建');
 });
});
