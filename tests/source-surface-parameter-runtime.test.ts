import {describe,expect,it} from 'vitest';
import {SourceSurfaceParameterRuntime,type SourceSurfaceParameterAction,type SourceSurfaceParameterConfiguration} from '../src/engine/sourceSurfaceParameterRuntime';
import golden from './fixtures/source-surface-parameters/numerics.json';

const config:SourceSurfaceParameterConfiguration={min:-1,max:1,step:.1};
const start=(name:string,overrides:Partial<SourceSurfaceParameterConfiguration>={}):SourceSurfaceParameterAction=>({kind:'start',scope:{kind:'named',name},configuration:{...config,...overrides}});
const startAll:SourceSurfaceParameterAction={kind:'start',scope:{kind:'all'}};
const stopAll:SourceSurfaceParameterAction={kind:'stop',scope:{kind:'all'}};
const stop=(name:string):SourceSurfaceParameterAction=>({kind:'stop',scope:{kind:'named',name}});
function fixture(initial:Record<string,number>={a:.25,b:-.25}){
 const values=new Map(Object.entries(initial)),reads:string[]=[],writes:[string,number][]=[];
 let work=0,limit=Infinity;
 const runtime=new SourceSurfaceParameterRuntime({read:name=>{reads.push(name);return values.get(name)??0;},write:(name,value)=>{writes.push([name,value]);if(values.has(name))values.set(name,value);},reserve:n=>{work+=n;if(work>limit)throw new Error('work budget');}});
 return{runtime,values,reads,writes,get work(){return work;},limitAfter(units:number){limit=work+units;}};
}
function entry(runtime:SourceSurfaceParameterRuntime,name='a'){const found=runtime.snapshot().entries.find(e=>e.name===name);if(!found)throw Error('Missing entry');return found;}

describe('Surface parameter recurrence against independent bytecode witnesses',()=>{
 it.each(golden.witnesses)('$name',row=>{
  const input=row.inputs,{runtime,values}=fixture({a:input.initial});
  runtime.begin([start('a',{min:input.min,max:input.max,step:input.step,edgeEasing:{...input.edge,easing:'sine-out'}})]);
  runtime.interpolate(input.scale,false);
  expect(entry(runtime).phase).toBeCloseTo(row.initialPhase,14);
  for(const expected of row.frames){
   runtime.update(input.dt,input.frameRate);
   expect(entry(runtime).phase).toBeCloseTo(expected.phase,14);
   expect(values.get('a')).toBeCloseTo(expected.value,14);
   expect(Math.fround(values.get('a')!)).toBe(expected.geometryFloat);
  }
 });
 it('defaults null edge to .4/.5, different from named JSON .5/.25',()=>{
  const plain=fixture({a:5}),json=fixture({a:5});
  plain.runtime.begin([start('a')]);json.runtime.begin([start('a',{edgeEasing:{window:.5,floor:.25,easing:'sine-out'}})]);
  for(const current of [plain,json]){current.runtime.interpolate(1,true);current.runtime.update(.25,4);}
  const fallback=golden.witnesses.find(w=>w.name==='outside-positive-starts-upper')!,named=golden.witnesses.find(w=>w.name==='named-json-edge-default-differs')!;
  expect(plain.values.get('a')).toBe(fallback.frames[0].value);expect(json.values.get('a')).toBe(named.frames[0].value);
  expect(plain.values.get('a')).not.toBe(json.values.get('a'));
 });
 it('retains exact source overshoot and clips only the lower gain bound',()=>{
  const {runtime}=fixture();runtime.begin([start('a')]);runtime.interpolate(-0,false);expect(Object.is(entry(runtime).scale,0)).toBe(true);
  runtime.interpolate(-.25,false);expect(entry(runtime).scale).toBe(0);
  runtime.interpolate(1.25,false);expect(entry(runtime).scale).toBe(1.25);
  runtime.interpolate(.5,true);expect(entry(runtime).scale).toBe(1);
 });
});

describe('Surface shared registry and ordered child lifecycles',()=>{
 it('overwrites the shared same-name config and captures the unmodified scalar at every start',()=>{
  const {runtime,reads,writes}=fixture();runtime.begin([start('a',{step:-.1}),start('a',{step:.2})]);
  expect(reads).toEqual(['a','a']);expect(writes).toEqual([]);
  expect(runtime.snapshot().entries).toHaveLength(1);expect(entry(runtime).configuration.step).toBe(.2);
  expect(entry(runtime).phase).toBe(Math.asin(.25));expect(entry(runtime).scale).toBe(0);
  runtime.interpolate(.5,false);expect(entry(runtime).scale).toBe(.5);
 });
 it('finishes named stop without stopping other names or the shared registry',()=>{
  const {runtime,values}=fixture();runtime.begin([start('a'),start('b')]);runtime.interpolate(1,true);runtime.update(.25,4);
  runtime.begin([stop('a')]);runtime.interpolate(.5,false);expect(entry(runtime).scale).toBe(.5);expect(entry(runtime,'b').scale).toBe(1);
  runtime.interpolate(1,true);const before=new Map(values);runtime.update(.25,4);
  expect(runtime.running).toBe(true);expect(values.get('a')).toBe(before.get('a'));expect(values.get('b')).not.toBe(before.get('b'));
 });
 it('all stop captures old names then its finish stops later same-group registrations too',()=>{
  const {runtime}=fixture();runtime.begin([start('a')]);runtime.interpolate(1,true);
  runtime.begin([stopAll,start('b')]);runtime.interpolate(.5,false);
  expect(entry(runtime).scale).toBe(.5);expect(entry(runtime,'b').scale).toBe(.5);
  runtime.interpolate(1,true);
  expect(runtime.running).toBe(false);expect(entry(runtime).scale).toBe(0);expect(entry(runtime,'b').scale).toBe(1);
 });
 it('idle stop is finished at group start and cannot stop a later start',()=>{
  const {runtime}=fixture();runtime.begin([stopAll,start('a')]);runtime.interpolate(1,true);
  expect(runtime.running).toBe(true);expect(entry(runtime).scale).toBe(1);
 });
 it('same-group start then stop captures zero scale and stops globally at completion',()=>{
  const {runtime,values}=fixture();runtime.begin([start('a'),stopAll]);runtime.interpolate(.5,false);
  expect(entry(runtime).scale).toBe(0);runtime.update(.25,4);expect(values.get('a')).toBeCloseTo(.25,15);
  runtime.interpolate(1,true);expect(runtime.running).toBe(false);
 });
 it('restart-all rephases only when idle and preserves current gains until its start callback resets them',()=>{
  const {runtime,values}=fixture();runtime.begin([start('a')]);runtime.interpolate(1,true);runtime.update(.25,4);
  const phase=entry(runtime).phase;values.set('a',-.5);
  runtime.begin([startAll]);expect(entry(runtime).phase).toBe(phase);expect(entry(runtime).scale).toBe(0);
  runtime.stop();runtime.begin([startAll]);expect(entry(runtime).phase).toBe(Math.asin(-.5));expect(entry(runtime).scale).toBe(0);
 });
 it('keeps unknown-name registry recurrence but never invents a geometry parameter slot',()=>{
  const {runtime,values,writes}=fixture();runtime.begin([start('missing'),stop('other')]);runtime.interpolate(1,true);runtime.update(.25,4);
  expect(runtime.snapshot().entries.map(e=>e.name)).toEqual(['missing']);expect(entry(runtime,'missing').phase).toBe(.1);
  expect(writes).toEqual([['missing',Math.sin(.1)]]);expect(values.has('missing')).toBe(false);expect(runtime.running).toBe(true);
 });
 it('standalone replacement clears all maps, resets gains1, ignores supplied edge and preserves enabled=false',()=>{
  const {runtime,values,writes}=fixture();runtime.begin([start('b')]);runtime.interpolate(.25,false);runtime.update(.25,4);
  runtime.replace([{name:'a',...config,edgeEasing:{window:2,floor:0,easing:'linear'}},{name:'b',...config,enabled:false}]);
  expect(runtime.running).toBe(true);expect(entry(runtime).scale).toBe(1);expect(entry(runtime).configuration.edge).toEqual({window:.4,floor:.5,easing:'sine-out'});
  const before=values.get('b'),count=writes.length;runtime.update(.25,4);expect(values.get('b')).toBe(before);expect(writes.length).toBe(count+1);
  // AnimateSurfaceParam.onFinish runs before Surface.update for its last frame.
  runtime.stop();runtime.update(.25,4);expect(writes.length).toBe(count+1);
 });
 it('standalone empty replacement clears all prior registrations and still starts an empty runtime',()=>{
  const {runtime,writes}=fixture();runtime.begin([start('a')]);runtime.interpolate(1,true);
  runtime.replace([]);expect(runtime.running).toBe(true);expect(runtime.snapshot().entries).toEqual([]);
  runtime.update(.25,4);expect(writes).toEqual([]);runtime.stop();expect(runtime.running).toBe(false);
 });
 it('empty action groups clear child ramps while retaining registered running phases',()=>{
  const {runtime}=fixture();runtime.begin([start('a')]);runtime.interpolate(.5,false);runtime.begin([]);runtime.interpolate(1,true);
  expect(entry(runtime).scale).toBe(.5);expect(runtime.running).toBe(true);
 });
 it('owns configuration and scope facts after the caller changes the action',()=>{
  const {runtime}=fixture();const action={kind:'start' as const,scope:{kind:'named' as const,name:'a'},configuration:{...config,edgeEasing:{window:.4,floor:.5,easing:'sine-out'}}};
  runtime.begin([action]);const snapshot=runtime.snapshot();action.scope.name='b';action.configuration.step=99;action.configuration.edgeEasing.floor=0;
  runtime.interpolate(.75,false);expect(entry(runtime).scale).toBe(.75);expect(entry(runtime).configuration.step).toBe(.1);expect(entry(runtime).configuration.edge.floor).toBe(.5);
  expect(snapshot.entries[0].scale).toBe(0);expect(Object.isFrozen(snapshot.entries[0].configuration.edge)).toBe(true);
 });
});

describe('Surface parameter resource and arithmetic admission',()=>{
 it('charges every edge phase reduction and aborts without silently applying modulo',()=>{
  const {runtime,writes,limitAfter}=fixture({a:0});runtime.begin([start('a',{step:1000})]);runtime.interpolate(1,true);runtime.update(.25,4);
  expect(entry(runtime).phase).toBe(1000-2*Math.PI);const count=writes.length;limitAfter(10);
  expect(()=>runtime.update(.25,4)).toThrow('work budget');expect(writes).toHaveLength(count);
 });
 it('rejects nonprogressing huge phase reduction rather than hanging',()=>{
  const {runtime}=fixture({a:0});runtime.begin([start('a',{step:1e100})]);runtime.interpolate(1,true);runtime.update(.25,4);
  expect(()=>runtime.update(.25,4)).toThrow('约简无法推进');
 });
 it('validates source numeric and easing facts before replacing a live registry',()=>{
  const {runtime}=fixture();runtime.begin([start('a')]);const before=runtime.snapshot();
  expect(()=>runtime.replace([{name:'b',...config,step:Infinity}])).toThrow('有限');expect(runtime.snapshot()).toEqual(before);
  expect(()=>runtime.begin([start('b',{edgeEasing:{window:.5,floor:.25,easing:'invented'}})])).toThrow('未知源缓动');expect(runtime.snapshot()).toEqual(before);
 });
});
