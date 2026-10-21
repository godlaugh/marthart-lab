import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {importSourceMapConfiguration,parseSourceMapConfiguration,createSourceMapConfiguration,editSourceMapConfiguration,type SourceMapEditState,type SourceMapConfiguration,type SourceMapResult} from '../src/engine/sourceMapConfig';
import {prepareRootsSourceMemberOrder} from '../src/engine/rootsSourceOrder';
const get=<T>(r:SourceMapResult<T>)=>{if(!r.ok)throw Error(r.error.reason);return r.value;};
const raw=(extra:Record<string,unknown>={})=>({type:'MAP_ATTRACTOR',config_version:'1.0.0',...extra});
const direct=(extra:Record<string,unknown>={})=>get(importSourceMapConfiguration(raw(extra),{entry:'runtime-config'})).configuration;
const project=(extra:Record<string,unknown>={})=>get(importSourceMapConfiguration(raw(extra),{entry:'project'})).configuration;
const math={x_next:'x',y_next:'y',z_next:'z'};
const state=(c:SourceMapConfiguration):SourceMapEditState=>({...c.construction,parameters:Object.fromEntries(c.construction.parameters),equations:{...c.construction.equations},initial:{...c.construction.initial}});
// Values below are reduced goldens from actual bundled JVM execution, not
// outputs produced by this implementation: .cache/source-map-config/results.json
// (32 cases × direct config / ProjectState.fromJson.toJson then config).
// JAR a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018;
// JsonMap class 344b186b6f4bd3dc7cb77315f62e0f36f43ef9d73e787e4cd0998e310e27988f.
const fixture=JSON.parse(readFileSync(new URL('./fixtures/map/configuration-source.json',import.meta.url),'utf8')) as {cases:{id:string;document:Record<string,unknown>;routes:{entry:'project'|'runtime-config';error?:string;construction?:SourceMapConfiguration['construction'];editorEquations?:SourceMapConfiguration['editorEquations'];editorParameters?:Record<string,number>}[]}[]};
describe('source Map configuration owner',()=>{
 for(const row of fixture.cases)for(const route of row.routes)it(`original JVM ${row.id}: ${route.entry}`,()=>{
  const result=importSourceMapConfiguration(row.document,{entry:route.entry,numberToken(path){let v:unknown=row.document;for(const key of path)v=(v as Record<string,unknown>)?.[key];return typeof v==='number'?String(v):undefined;}});
  if(route.error){expect(result.ok).toBe(false);return;}
  const actual=get(result).configuration;expect(actual.construction).toEqual(route.construction);
  if(route.entry==='project'){expect(actual.editorEquations).toEqual(route.editorEquations);expect(Object.fromEntries(actual.editorParameters!)).toEqual(route.editorParameters);}
 });
 it('matches original no-settings early return, including ignored authoring fields',()=>{
  const c=direct({parameters:{alpha:2},equations:math});expect(c.settingsPresence).toBe('absent');
  expect(c.construction).toEqual({batchSize:262144,dimension:2,iterations:1,burnIn:100,initial:{xMin:-1,xMax:1,yMin:-1,yMax:1},equations:{x:'sin(a*y) + c*cos(a*x)',y:'sin(b*x) + d*cos(b*y)',z:''},parameters:[['a',-1.7],['b',1.8],['c',1.6],['d',.9]]});
  expect(direct({settings:{}}).construction.equations.z).toBe('0.0');
 });
 it('does not invent project parameters and rejects the resulting original compile failure',()=>{
  expect(importSourceMapConfiguration(raw(),{entry:'project'}).ok).toBe(false);
  expect(importSourceMapConfiguration(raw({settings:{},parameters:{}}),{entry:'runtime-config'}).ok).toBe(false);
  expect(project({equations:math}).construction.parameters).toEqual([]);
 });
 it('uses distinct dimension rules and config-injected parameters',()=>{
  const input={settings:{dimension:4},equations:math,parameters:{}};
  expect(direct(input).construction.dimension).toBe(2);
  expect(project(input).construction).toMatchObject({dimension:3,parameters:[['p0',.9],['p1',1.2],['p2',.7]]});
  const one=direct({settings:{dimension:3},equations:math,parameters:{p0:2}});expect(one.construction.parameters).toEqual([['p0',2]]);
 });
 it('keeps raw runtime whitespace and applies project trim before dimensional defaults',()=>{
  const input={settings:{dimension:3},equations:{x_next:' ',y_next:' ',z_next:' '}};
  expect(direct(input).construction.equations).toEqual({x:' ',y:' ',z:' '});
  expect(project(input).construction.equations).toEqual({x:'p0 + y - y*z',y:'p1 + z - x*z',z:'p2 + x - x*y'});
  expect(project({...input,equations:{x_next:'\u00a0x\u2007',y_next:'y',z_next:'z'}}).construction.equations.x).toBe('x');
  const defaults=direct({settings:{dimension:3}});expect(defaults.construction.parameters.map(([k])=>k)).toEqual(['a','b','c','d','p0','p1','p2']);expect(defaults.construction.equations.x).toBe('sin(a*y) + c*cos(a*x)');expect(defaults.construction.equations.z).toBe('p2 + x - x*y');
 });
 it('matches original parameter parsing and retains separate editor/runtime entries',()=>{
  const input={settings:{},equations:{x_next:'alpha*x',y_next:'y'},parameters:{alpha:'1/3'}};
  expect(importSourceMapConfiguration(raw(input),{entry:'runtime-config'}).ok).toBe(false);
  expect(project(input).construction.parameters).toEqual([['alpha',0]]);
  const three=project({settings:{dimension:3},equations:math,parameters:{alpha:'1.25'}});expect(three.editorParameters).toEqual([['alpha',1.25]]);expect(three.construction.parameters).toEqual([['alpha',1.25],['p0',.9],['p1',1.2],['p2',.7]]);
 });
 it('consumes producer HashMap order without reordering and reproduces project export order',()=>{
  const parameters={zeta:1,alpha:2,Aa:3,BB:4,theta:5};
  const c=direct({settings:{},equations:math,parameters});expect(c.construction.parameters.map(([k])=>k)).toEqual(['zeta','Aa','BB','alpha','theta']);
  expect(project({settings:{},equations:math,parameters}).construction.parameters).toEqual(c.construction.parameters);
  const supplied=['theta','BB','Aa','alpha','zeta'];const r=get(importSourceMapConfiguration(raw({settings:{},equations:math,parameters}),{entry:'runtime-config',memberKeys:()=>supplied}));expect(r.configuration.construction.parameters.map(([k])=>k)).toEqual(supplied);
  expect(importSourceMapConfiguration(raw({settings:{},parameters}),{entry:'runtime-config',memberKeys:()=>['a']}).ok).toBe(false);
 });
 it('uses config float expressions versus project float defaults, and swaps inverted boxes',()=>{
  const input={settings:{x0_min:'1/3',x0_max:'2/3',y0_min:'bad',y0_max:'2'},equations:math,parameters:{}};
  expect(direct(input).construction.initial).toEqual({xMin:Math.fround(1/3),xMax:Math.fround(2/3),yMin:0,yMax:2});
  expect(project(input).construction.initial).toEqual({xMin:-1,xMax:1,yMin:-1,yMax:2});
  for(const entry of ['runtime-config','project'] as const){const c=get(importSourceMapConfiguration(raw({settings:{x0_min:5,x0_max:-2,y0_min:4,y0_max:-3},equations:math,parameters:{}}),{entry})).configuration;expect(c.construction.initial).toEqual({xMin:-2,xMax:5,yMin:-3,yMax:4});}
  expect(direct({settings:{x0_min:.25,x0_max:.25}}).construction.initial.xMin).toBe(.25);
 });
 it('preserves configured iteration counts and uses retained JSON tokens for integer narrowing',()=>{
  const input={settings:{batch_size:3.9,iterations_per_frame:17.2,burn_in_steps:5.9},equations:math,parameters:{}};
  for(const entry of ['runtime-config','project'] as const){const c=get(importSourceMapConfiguration(raw(input),{entry,numberToken:path=>String(input.settings[path[1] as keyof typeof input.settings])})).configuration;expect(c.construction).toMatchObject({batchSize:3,iterations:17,burnIn:5});}
  expect(importSourceMapConfiguration(raw(input),{entry:'project'}).ok).toBe(false);
  const negative=project({settings:{batch_size:-3,iterations_per_frame:-2,burn_in_steps:-1},equations:math,parameters:{}});expect(negative.construction).toMatchObject({batchSize:1,iterations:1,burnIn:0});
  const wrap=get(importSourceMapConfiguration(raw({settings:{batch_size:4294967297},equations:math,parameters:{}}),{entry:'project',numberToken:()=> '4294967297'})).configuration;expect(wrap.construction.batchSize).toBe(1);
 });
 it('reports local capacity and nonfinite failures without changing the supplied configuration',()=>{
  for(const settings of [{batch_size:8000001},{burn_in_steps:100001}]){const r=importSourceMapConfiguration(raw({settings,equations:math,parameters:{}}));expect(r.ok).toBe(false);if(!r.ok)expect(r.error.kind).toBe('capacity');}
  expect(importSourceMapConfiguration(raw({settings:{x0_min:'Infinity'},equations:math,parameters:{}})).ok).toBe(false);
  expect(importSourceMapConfiguration(raw({settings:{},equations:math,parameters:{q:'NaN'}})).ok).toBe(false);
 });
 it('parses persisted facts without normalizing raw strings or changing identity and detaches nested objects',()=>{
  const original=direct({settings:{},equations:{x_next:' x ',y_next:' y ',z_next:' '}}),parsed=get(parseSourceMapConfiguration(original));expect(parsed).toEqual(original);parsed.construction.equations.x='new';expect(original.construction.equations.x).toBe(' x ');
  const bad=structuredClone(original);bad.construction.parameters.push(['a',1]);expect(parseSourceMapConfiguration(bad).ok).toBe(false);
  const badBounds=structuredClone(original);badBounds.construction.initial.xMin=4;expect(parseSourceMapConfiguration(badBounds).ok).toBe(false);
  expect(createSourceMapConfiguration(original.construction,{entry:'project'}).ok).toBe(false);
 });
 it('keeps the exact anchor for no edit and rebuilds only explicit authored changes',()=>{
  const anchor=project({settings:{dimension:3},equations:math,parameters:{alpha:1}}),before=state(anchor);
  expect(get(editSourceMapConfiguration(anchor,before,structuredClone(before))).configuration).toBe(anchor);
  const next={...before,batchSize:17},rebuilt=get(editSourceMapConfiguration(anchor,before,next));expect(rebuilt.configuration.construction.batchSize).toBe(17);expect(rebuilt.configuration.editorParameters).toEqual([['alpha',1]]);expect(rebuilt.configuration.construction.parameters).toEqual(anchor.construction.parameters);
  const edited=get(editSourceMapConfiguration(anchor,before,{...before,parameters:{...before.parameters,p1:9}}));expect(edited.configuration.editorParameters).toEqual([['alpha',1],['p1',9]]);expect(edited.parameters).toEqual({alpha:1,p1:9}); // any p key suppresses all injected defaults
  const zero=project({equations:math,parameters:{q:'-0'}}),zbefore=state(zero);expect(Object.is(zbefore.parameters.q,-0)).toBe(true);expect(get(editSourceMapConfiguration(zero,zbefore,{...zbefore,parameters:{q:0}})).configuration).not.toBe(zero);
 });
 it('retains dormant editor formula defaults across a dimension-only edit',()=>{
  const c=project({equations:{x_next:'x',y_next:'y'},parameters:{alpha:1}}),before=state(c);expect(c.editorEquations!.z).toBe('');expect(c.construction.equations.z).toBe('0.0');const edited=get(editSourceMapConfiguration(c,before,{...before,dimension:3}));expect(edited.configuration.construction.equations.z).toBe('p2 + x - x*y');expect(edited.configuration.editorEquations!.z).toBe('');
 });
 it('applies Mobject Math.min/max signed-zero range ownership after config parsing',()=>{
  const c=direct({settings:{x0_min:'0',x0_max:'-0',y0_min:'-0',y0_max:'0'}});expect(Object.is(c.construction.initial.xMin,-0)).toBe(true);expect(Object.is(c.construction.initial.xMax,0)).toBe(true);expect(Object.is(c.construction.initial.yMin,-0)).toBe(true);
  const corrupt=structuredClone(c);corrupt.construction.initial.xMin=0;corrupt.construction.initial.xMax=-0;expect(parseSourceMapConfiguration(corrupt).ok).toBe(false);
 });
 it('validates numeric provenance and order rather than trusting stale metadata',()=>{
  expect(importSourceMapConfiguration(raw({settings:{},equations:math,parameters:{q:1}}),{numberToken:()=> '2'}).ok).toBe(false);
  const producer=prepareRootsSourceMemberOrder(['Aa','BB']);expect(producer.ok).toBe(true);
  const c=project({equations:math,parameters:{Aa:1,BB:2}});const corrupt=structuredClone(c);corrupt.editorMap!.data.push('alien');expect(parseSourceMapConfiguration(corrupt).ok).toBe(false);
 });
});
