import {describe,it,expect} from 'vitest';
import fixture from './fixtures/source-perlin/parameters.json';
import {SourcePerlinParameterRuntime,type SourcePerlinFieldEffect,type SourcePerlinParameterOptions} from '../src/engine/sourcePerlinParameterRuntime';
import {SOURCE_PERLIN_PARAMETER_NAMES as names,SOURCE_PERLIN_PARAMETER_DEFAULTS,type SourcePerlinParameterAction} from '../src/engine/sourcePerlinParameterConfig';

const initial={noise_offset:0,noise_scale:12,curve_noise_scale:1.25,curve_angle_scale:3.5};
const start=(name:typeof names[number],min:number,max:number,step:number):SourcePerlinParameterAction=>({kind:'start',parameters:[{name,min,max,step}]});
describe('Perlin specialized parameters against independent static bytecode transcription',()=>{
 for(const name of names)it(`curve animation state follows action and drift owner: ${name}`,()=>{
  const r=new SourcePerlinParameterRuntime({initial,backend:'cpu',style:'field-curves'});
  expect(r.fieldCurvesAnimating).toBe(false);
  const [step,min,max]=SOURCE_PERLIN_PARAMETER_DEFAULTS[name];
  r.begin([start(name,min,max,step)]);
  expect(r.fieldCurvesAnimating).toBe(name!=='noise_scale');
  r.interpolate(1,true,.1);
  expect(r.snapshot().active).toBe(false);
  expect(r.fieldCurvesAnimating).toBe(name!=='noise_scale');
  r.begin([{kind:'stop',parameters:[]}]);
  expect(r.fieldCurvesAnimating).toBe(false);
 });
 for(const c of fixture.cases)it(c.name,()=>{
  const runtime=new SourcePerlinParameterRuntime({initial:c.initial,backend:c.backend==='gpu'?'gpu':'cpu',style:c.backend==='cpu-curves'?'field-curves':'particles'});
  c.operations.forEach((raw,index)=>{
   const op=raw as {op:string;actions?:SourcePerlinParameterAction[];dt:number;eased:number;finished:boolean;objectUpdate?:boolean};
   if(op.op==='begin')runtime.begin(op.actions!);
   else if(op.op==='frame'){runtime.interpolate(op.eased,op.finished,op.dt);if(op.objectUpdate!==false)runtime.update(op.dt);}
   else runtime.update(op.dt);
   const actual=runtime.snapshot(),expected=c.expected[index];
   expect(names.map(n=>actual.values[n])).toEqual(expected.values);
   expect(actual.active).toBe(expected.active);expect(actual.drifts.map(d=>d.running)).toEqual(expected.driftRunning);
   actual.drifts.forEach((d,i)=>expect(d.phase).toBeCloseTo(expected.driftPhases[i],12));
   actual.children.forEach((child,i)=>child.parameters.forEach((p,j)=>expect(p.phase).toBeCloseTo(expected.actionPhases[i][j],12)));
  });
 });
 it('retains independent style effects for GPU direct setters, but skips GPU object drifts',()=>{
  const events:SourcePerlinFieldEffect[]=[];
  const r=new SourcePerlinParameterRuntime({initial,backend:'gpu',style:'field-curves',fieldDimensions:[100,80],onFieldEffect:e=>events.push(e)});
  r.begin([start('curve_noise_scale',.45,5.8,.02)]);r.interpolate(1,true,.25);
  expect(events).toEqual(['rebuild-angle','dirty']);const before=r.snapshot();r.update(.25);expect(r.snapshot()).toEqual(before);
 });
 it('does not rebuild angles with absent dimensions; curve rebuild requests see new fields',()=>{
  const events:{effect:SourcePerlinFieldEffect;value:number}[]=[];
  const r=new SourcePerlinParameterRuntime({initial,backend:'cpu',style:'field-curves',fieldDimensions:[0,80],onFieldEffect:(effect,v)=>events.push({effect,value:v.curve_noise_scale})});
  r.begin([start('curve_noise_scale',.45,5.8,.02)]);r.interpolate(1,false,.25);r.update(.25);
  expect(events.map(e=>e.effect)).toEqual(['dirty','rebuild-curves-if-needed']);expect(events[0].value).toBe(r.snapshot().values.curve_noise_scale);
  events.length=0;r.begin([{kind:'stop',parameters:[]}]);expect(events.map(e=>e.effect)).toEqual(Array(3).fill('rebuild-curves-if-needed'));
 });
 it('initializes fields directly instead of applying setter clamps',()=>{
  const r=new SourcePerlinParameterRuntime({initial:{...initial,noise_offset:2,curve_noise_scale:0},backend:'cpu',style:'particles'});
  expect(r.snapshot().values.noise_offset).toBe(2);expect(r.snapshot().values.curve_noise_scale).toBe(0);
  r.begin([start('noise_offset',-1,1,0)]);r.interpolate(1,false,0);expect(r.snapshot().values.noise_offset).toBe(1);
 });
 it('owns finite float dimensions and backend/style independently from caller mutations',()=>{
  const events:SourcePerlinFieldEffect[]=[],dimensions:[number,number]=[1e-50,80];
  const options:{-readonly[K in keyof SourcePerlinParameterOptions]:SourcePerlinParameterOptions[K]}={initial,backend:'gpu',style:'field-curves',fieldDimensions:dimensions,onFieldEffect:e=>events.push(e)};
  const r=new SourcePerlinParameterRuntime(options);dimensions[0]=100;options.backend='cpu';options.style='particles';
  r.begin([start('curve_noise_scale',.45,5.8,.02)]);r.interpolate(1,true,.25);expect(events).toEqual(['dirty']);const before=r.snapshot();r.update(.25);expect(r.snapshot()).toEqual(before);
  for(const dims of [[],[1,2,3],[1e100,80]])expect(()=>new SourcePerlinParameterRuntime({...options,fieldDimensions:dims as [number,number]})).toThrow(/尺寸/);
 });
 it('retains original defaults in inactive drift snapshots',()=>{
  const r=new SourcePerlinParameterRuntime({initial,backend:'cpu',style:'particles'});
  expect(r.snapshot().drifts.map(d=>[d.step,d.min,d.max])).toEqual([[.01,-1,1],[1,4,30],[.02,.45,5.8],[.05,1.4,8.5]]);
 });
 it('switches only the runtime branch while preserving unfinished actions and resumed drift phases',()=>{
  const retained=new SourcePerlinParameterRuntime({initial,backend:'cpu',style:'particles'}),control=new SourcePerlinParameterRuntime({initial,backend:'cpu',style:'particles'});
  for(const r of [retained,control]){r.begin([start('noise_scale',4,30,1)]);r.interpolate(.5,false,.1);}
  const before=retained.snapshot();retained.setBackend('gpu');expect(retained.snapshot()).toEqual({...before,backend:'gpu'});
  for(const r of [retained,control])r.interpolate(.75,true,.2);
  const gpu=retained.snapshot();retained.update(.8);expect(retained.snapshot()).toEqual(gpu);
  retained.setBackend('cpu');expect(retained.snapshot()).toEqual(control.snapshot());retained.update(.3);control.update(.3);expect(retained.snapshot()).toEqual(control.snapshot());
 });
 it('rejects unknown backend boundaries and prevents reading failed mutable state',()=>{
  expect(()=>new SourcePerlinParameterRuntime(null!)).toThrow(expect.objectContaining({code:'input'}));
  const r=new SourcePerlinParameterRuntime({initial,backend:'cpu',style:'particles'});
  expect(()=>r.setBackend('invalid' as 'cpu')).toThrow(expect.objectContaining({code:'input'}));
  expect(()=>r.snapshot()).toThrow(expect.objectContaining({code:'failed'}));expect(()=>r.setBackend('gpu')).toThrow(expect.objectContaining({code:'failed'}));
 });
 it('retains phase movement when a sub-epsilon setter change is skipped',()=>{
  const r=new SourcePerlinParameterRuntime({initial,backend:'cpu',style:'particles'});r.begin([start('noise_offset',-1,1,1e-8)]);r.interpolate(1,false,.25);
  expect(r.snapshot().values.noise_offset).toBe(0);expect(r.snapshot().children[0].parameters[0].phase).toBeGreaterThan(0);
 });
 it('bounds repeated phase subtraction and invalidates failed owners',()=>{
  const r=new SourcePerlinParameterRuntime({initial,backend:'cpu',style:'particles'});r.begin([start('noise_offset',-1,1,1e12)]);
  expect(()=>r.interpolate(1,false,1)).toThrow(/预算/);expect(()=>r.update(.1)).toThrow(/重建/);expect(()=>r.fieldCurvesAnimating).toThrow(/重建/);
 });
 it('propagates geometry failure without allowing reuse; cancellation is distinct',()=>{
  const r=new SourcePerlinParameterRuntime({initial,backend:'cpu',style:'field-curves',onFieldEffect:()=>{throw Error('geometry failed');}});
  r.begin([start('noise_offset',-1,1,.01)]);expect(()=>r.interpolate(1,false,1)).toThrow('geometry failed');expect(()=>r.begin([])).toThrow(/重建/);
  const cancelled=new SourcePerlinParameterRuntime({initial,backend:'cpu',style:'particles',isCancelled:()=>true});expect(()=>cancelled.update(.1)).toThrow(/取消/);
 });
});
