import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {importSourceMapParameterAction,parseSourceMapParameterActions,SOURCE_MAP_PARAMETER_MODEL as model,SOURCE_MAP_PARAMETER_DEFAULT,type SourceRegistryParameterResult} from '../src/engine/sourceRegistryParameterConfig';
import {prepareOrdinarySourceScalarScope} from '../src/engine/ordinarySourceCameraImport';
import {prepareRootsSourceMemberOrder} from '../src/engine/rootsSourceOrder';
import {SourceIteratedParameterRuntime,type SourceIteratedParameterAction} from '../src/engine/sourceIteratedParameterRuntime';
import {sourceMapColorValue} from '../src/engine/sourceMapRuntimeColors';
import {isJavaBlank} from '../src/engine/sourceJavaText';
import {lookupSourceEasing} from '../src/engine/sourceEasing';
const take=<T>(result:SourceRegistryParameterResult<T>):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
const prepared=prepareOrdinarySourceScalarScope('map');if(!prepared.ok)throw Error('scope');const scope=prepared.value;
function options(raw:unknown){return {scope,memberOrder:(path:readonly string[])=>{let value:unknown=raw;for(const part of path)value=(value as Record<string,unknown>)[part];const order=prepareRootsSourceMemberOrder(Object.keys(value as object));if(!order.ok)throw Error('order');return order.value.keys;}};}
const action=(args:unknown,method:'paramStart'|'paramStop'='paramStart')=>take(importSourceMapParameterAction(method,args,options(args)));
type State={built?:SourceIteratedParameterAction[];running:boolean;values:Record<string,number>;phases:Record<string,number>;scales:Record<string,number>;children:{runtime:number;finished:boolean}[];acknowledged:Record<string,number>;parametersChanged:boolean;colorSpeed:number;colorPhase:number};
type Input={method:'paramStart'|'paramStop';args?:unknown;duration:number;easing:string};
type Case={id:string;initial:State;steps:{dt:number;rate?:number;actions?:Input[]}[];frames:State[]};
const fixture=JSON.parse(readFileSync(new URL('./fixtures/map/parameter-runtime.json',import.meta.url),'utf8')) as {cases:Case[]};
const numbers=(actual:Readonly<Record<string,number>>,expected:Record<string,number>,label:string)=>{expect(Object.keys(actual).sort(),label).toEqual(Object.keys(expected).sort());for(const key of Object.keys(expected))expect(actual[key],label+'/'+key).toBeCloseTo(expected[key],12);};

describe('original Map action builder through parameter runtime',()=>{
 for(const row of fixture.cases)it(row.id+' imports raw actions and reproduces all native snapshots',()=>{
  const values=new Map(Object.entries(row.initial.values));let work=0,colorSpeed=row.initial.colorSpeed,colorPhase=row.initial.colorPhase;
  expect(row.initial.acknowledged).toEqual(row.initial.values);expect(row.initial.parametersChanged).toBe(false);
  const runtime=new SourceIteratedParameterRuntime({read:name=>isJavaBlank(name)?undefined:name==='colorSpeed'?colorSpeed:name==='colorPhase'?colorPhase:values.get(name),write:(name,value)=>{if(isJavaBlank(name))return;if(name==='colorSpeed')colorSpeed=sourceMapColorValue('colorSpeed',value);else if(name==='colorPhase')colorPhase=sourceMapColorValue('colorPhase',value);else values.set(name,value);},reserve:n=>{work+=n;if(work>100000)throw Error('work budget');}});
  row.steps.forEach((step,i)=>{work=0;
   if(step.actions){
    const operations=step.actions.flatMap(input=>parseSourceMapParameterActions(action(input.args,input.method).configuration,input.method).map(operation=>({kind:input.method==='paramStart'?'start' as const:'stop' as const,scope:operation.scope,...(operation.configuration?{configuration:operation.configuration}:{}),duration:Math.fround(input.duration),easing:lookupSourceEasing(input.easing)!})));
    // Original builder exposes runtime edge clamps; persisted source values
    // remain untouched until the runtime constructs its configuration.
    const expected=row.frames[i].built!.map(op=>({...op,easing:lookupSourceEasing(op.easing)!,...(op.configuration?{configuration:{...op.configuration,edgeEasing:{...op.configuration.edgeEasing!,easing:lookupSourceEasing(op.configuration.edgeEasing!.easing)!}}}:{})}));
    const built=operations.map(op=>({...op,...(op.configuration?{configuration:{...op.configuration,edgeEasing:{...op.configuration.edgeEasing,window:Math.max(1e-6,op.configuration.edgeEasing.window),floor:Math.max(0,Math.min(1,op.configuration.edgeEasing.floor))}}}:{})}));
    expect(built,'built frame '+i).toEqual(expected);runtime.begin(operations);
   }
   runtime.advance(step.dt);runtime.update(step.dt,step.rate??60);const actual=runtime.snapshot(),expected=row.frames[i];
   expect(colorSpeed,'colorSpeed frame '+i).toBe(expected.colorSpeed);expect(colorPhase,'colorPhase frame '+i).toBe(expected.colorPhase);
   expect(actual.running,'frame '+i).toBe(expected.running);expect(actual.children,'child frame '+i).toEqual(expected.children);
   expect(expected.acknowledged).toEqual(row.initial.values);
   const initial=row.initial.acknowledged,changed=values.size!==Object.keys(initial).length||[...values].some(([name,value])=>!Object.hasOwn(initial,name)||Math.abs(value-initial[name])>1e-9);
   expect(changed).toBe(expected.parametersChanged);
   numbers(actual.phases,expected.phases,'phases frame '+i);numbers(actual.scales,expected.scales,'scales frame '+i);numbers(Object.fromEntries(values),expected.values,'values frame '+i);
  });
 });
});
describe('Map parameter parsing and saved contracts',()=>{
 it('separates helper all defaults from the outer source Scene argument filter',()=>{
  for(const raw of [undefined,null,3,'{}',[],[0,{parameters:{a:{}}}],{}, {parameters:{}}])expect(action(raw).configuration).toEqual([{model,scope:{kind:'all'}}]);
 });
 it('uses Map scalar defaults and an empty expression scope',()=>{
  const result=action({parameters:{a:{},b:{step:'lambda/4'},c:{min:9,max:-2,step:-.3}}});
  expect(result.configuration.find(p=>p.scope.kind==='named'&&p.scope.name==='a')!.configuration).toEqual(SOURCE_MAP_PARAMETER_DEFAULT);
  expect(result.configuration.find(p=>p.scope.kind==='named'&&p.scope.name==='c')!.configuration).toEqual({...SOURCE_MAP_PARAMETER_DEFAULT,min:9,max:-2,step:Math.fround(-.3)});
  expect(result.configuration.find(p=>p.scope.kind==='named'&&p.scope.name==='b')!.configuration!.step).toBe(Math.fround(.1));
 });
 it('applies Java trim to target domains without normalizing parameter identity',()=>{
  for(const targetDomain of [' surface ','map_attractor','\u0000SURFACE\n','', ' \t',null])expect(action({targetDomain,parameters:{' a.b ':{}}}).configuration[0].scope).toEqual({kind:'named',name:' a.b '});
  for(const targetDomain of ['SYMMETRY_CHAOS','FRACTAL','ANY','\u00a0SURFACE\u00a0','\u2003',123,true,{},[]])expect(action({targetDomain,parameters:null}).configuration).toEqual([]);
 });
 it('rejects malformed used containers and boolean flags, but ignores disabled and stop configuration fields',()=>{
  for(const raw of [{parameters:null},{parameters:[]},{parameters:{a:{enable:1}}},{parameters:{a:{enable:' true '}}},{edgeEasing:null}])expect(importSourceMapParameterAction('paramStart',raw,options(raw)).ok).toBe(false);
  expect(action({parameters:{a:{enable:false,edgeEasing:null},b:9}}).configuration).toEqual([]);
  expect(action({parameters:{a:{step:null,edgeEasing:null}}},'paramStop').configuration).toEqual([{model,scope:{kind:'named',name:'a'}}]);
 });
 it('retains numeric provenance for disabled members and excluded domains',()=>{
  for(const raw of [[{parameters:{'a.b':{enable:false,step:.1,min:0,edgeEasing:{floor:.2}}}}],[{targetDomain:'FRACTAL',parameters:{'a.b':{step:.1,min:0,edgeEasing:{floor:.2}}}}]]){
   const facts=action(raw);expect(facts.configuration).toEqual([]);expect(facts.numericPaths).toContainEqual(['0','parameters','a.b','step']);expect(facts.numericPaths).toContainEqual(['0','parameters','a.b','edgeEasing','floor']);
  }
 });
 it('requires explicit saved configs, correct family and owned copies, without normalizing names/ranges',()=>{
  const raw=[{model,scope:{kind:'named' as const,name:'__proto__'},configuration:{...SOURCE_MAP_PARAMETER_DEFAULT,min:9,max:-9}}];
  const parsed=parseSourceMapParameterActions(raw,'paramStart');expect(parsed).toEqual(raw);raw[0].configuration.min=100;expect(parsed[0].configuration!.min).toBe(9);
  for(const value of [[{model,scope:{kind:'named',name:'a'}}],[{...raw[0],extra:true}],[{...raw[0],model:'surface-registry-1.7.8'},{...raw[0],model:'symmetry-registry-1.7.8'}]])expect(()=>parseSourceMapParameterActions(value,'paramStart')).toThrow();
  expect(()=>parseSourceMapParameterActions(raw,'paramStop')).toThrow();
 });
});
