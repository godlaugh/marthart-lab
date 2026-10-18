import {describe,it,expect} from 'vitest';
import {importSourceSurfaceParameterAction,importSourceSurfaceParameterClip,importSourceSurfaceParameterEdge,parseSourceSurfaceParameterActions,parseSourceSurfaceParameterClip,SOURCE_SURFACE_PARAMETER_DEFAULT,SOURCE_SURFACE_PARAMETER_MODEL as model,type SourceSurfaceParameterResult} from '../src/engine/sourceSurfaceParameterConfig';
import {prepareOrdinarySourceScalarScope} from '../src/engine/ordinarySourceCameraImport';
import {prepareRootsSourceMemberOrder} from '../src/engine/rootsSourceOrder';
const take=<T>(result:SourceSurfaceParameterResult<T>):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
const prepared=prepareOrdinarySourceScalarScope('surface',{parameters:{a:2},memberOrder:['a']});if(!prepared.ok)throw Error('scope');const scope=prepared.value;
function options(raw:unknown){return {scope,memberOrder:(path:readonly string[])=>{let value:unknown=raw;for(const part of path)value=(value as Record<string,unknown>)[part];const order=prepareRootsSourceMemberOrder(Object.keys(value as object));if(!order.ok)throw Error('order');return order.value.keys;}};}
const action=(args:unknown,method:'paramStart'|'paramStop'='paramStart')=>take(importSourceSurfaceParameterAction(method,args,options(args)));

describe('source Surface parameter import boundary and persisted contracts',()=>{
 it('distinguishes public absent args from helper empty arrays and missing/empty parameter maps',()=>{
  for(const raw of [undefined,null,3,'{}'])expect(action(raw).configuration).toEqual([]);
  for(const raw of [[],[0,{parameters:{a:{}}}],{}, {parameters:{}}])expect(action(raw).configuration).toEqual([{model,scope:{kind:'all'}}]);
 });
 it('preserves exact names and source order, applies float/scalar defaults, skips disabled/nonobjects',()=>{
  const facts=action({parameters:{z:{step:'a/4',min:10,max:-2},a:{},skip:{enable:false,step:null},scalar:9,' space.name ':{enable:'TrUe',step:-.2}}});
  const expected=prepareRootsSourceMemberOrder(['z','a','skip','scalar',' space.name ']);if(!expected.ok)throw Error('order');
  expect(facts.configuration.map(x=>x.scope.kind==='named'?x.scope.name:'*')).toEqual(expected.value.keys.filter(x=>!['skip','scalar'].includes(x)));
  expect(facts.configuration.find(x=>x.scope.kind==='named'&&x.scope.name==='z')!.configuration).toEqual({...SOURCE_SURFACE_PARAMETER_DEFAULT,min:10,max:-2,step:.5});
  expect(facts.configuration.find(x=>x.scope.kind==='named'&&x.scope.name==='a')!.configuration).toEqual(SOURCE_SURFACE_PARAMETER_DEFAULT);
  expect(facts.configuration.find(x=>x.scope.kind==='named'&&x.scope.name===' space.name ')!.configuration!.step).toBe(Math.fround(-.2));
 });
 it('applies exact FRACTAL exclusion and strict native enable/container failures',()=>{
  expect(action({targetDomain:'fRaCtAl',parameters:null}).configuration).toEqual([]);
  expect(action({targetDomain:' FRACTAL '}).configuration).toHaveLength(1);
  for(const raw of [{parameters:null},{parameters:[]},{parameters:{a:{enable:1}}},{parameters:{a:{enable:' true '}}},{edgeEasing:null}])expect(importSourceSurfaceParameterAction('paramStart',raw,options(raw)).ok).toBe(false);
 });
 it('inherits named edge defaults with exact source names and retains raw out-of-range doubles',()=>{
  const raw={edgeEasing:{window:'0x1p-2',floor:-2,easing:'LINEAR'},parameters:{a:{edgeEasing:{floor:2,easing:'unknown'}}}};
  const facts=action(raw);expect(facts.configuration[0].configuration!.edgeEasing).toEqual({window:.25,floor:2,easing:'linear'});
  expect(take(importSourceSurfaceParameterEdge({window:'bad',floor:'0.125',easing:'sine_out'})).configuration).toEqual({window:.5,floor:.125,easing:'sine-out'});
  expect(importSourceSurfaceParameterEdge({window:'NaN'})).toMatchObject({ok:false,error:{kind:'nonfinite'}});
 });
 it('does not read named stop numeric/edge fields but still reads its action-level edge',()=>{
  const raw={parameters:{a:{min:null,step:{bad:true},edgeEasing:null}}};expect(action(raw,'paramStop').configuration).toEqual([{model,scope:{kind:'named',name:'a'}}]);
  expect(importSourceSurfaceParameterAction('paramStop',{...raw,edgeEasing:null},options(raw)).ok).toBe(false);
 });
 it('preserves standalone disabled configs and primitive constants without interpreting expressions',()=>{
  const raw={a:{step:'a/4',min:9,max:-9,enable:false},b:'0x1.8p2',c:'a/4',d:null,e:true};
  const out=take(importSourceSurfaceParameterClip(raw,options(raw))).configuration;
  expect(out.parameters.find(p=>p.name==='a')).toEqual({name:'a',step:.5,min:9,max:-9,enabled:false});
  expect(out.parameters.find(p=>p.name==='b')).toEqual({name:'b',step:0,min:6,max:6,enabled:true});
  for(const key of ['c','d','e'])expect(out.parameters.find(p=>p.name===key)).toEqual({name:key,step:0,min:0,max:0,enabled:true});
  expect(take(importSourceSurfaceParameterClip(undefined,options({}))).configuration.parameters).toEqual([]);
 });
 it('keeps consumed paths separate from lexical-number registrations',()=>{
  const facts=action([{parameters:{'a.b':{step:.1,min:0,edgeEasing:{floor:.2}}}}]);
  expect(facts.numericPaths).toContainEqual(['0','parameters','a.b','step']);expect(facts.numericPaths).toContainEqual(['0','parameters','a.b','edgeEasing','floor']);
  expect(facts.consumedPaths).toContainEqual(['0','parameters','a.b','min']);
 });
 it('saved configurations are explicit and retain signed step/unsorted bounds without source defaulting',()=>{
  const config={...SOURCE_SURFACE_PARAMETER_DEFAULT,min:10,max:-10,step:-.5},raw=[{model,scope:{kind:'named',name:'a.b'},configuration:config}];
  expect(parseSourceSurfaceParameterActions(raw,'paramStart')).toEqual(raw);
  for(const value of [[{model,scope:{kind:'named',name:'a'}}],[{...raw[0],extra:true}]])expect(()=>parseSourceSurfaceParameterActions(value,'paramStart')).toThrow();
  expect(()=>parseSourceSurfaceParameterActions(raw,'paramStop')).toThrow();
  const clip={model,parameters:[{name:'a.b',step:-1,min:3,max:-2,enabled:false}]};expect(parseSourceSurfaceParameterClip(clip)).toEqual(clip);
  expect(()=>parseSourceSurfaceParameterClip({...clip,parameters:[...clip.parameters,...clip.parameters]})).toThrow('重复');
 });
});
