import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import type {SceneDocument} from '../src/types';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {editSourceMapScene} from '../src/engine/sourceMapScene';
import {sourceMapInitialSeed} from '../src/engine/sourceMapInitialSeed';
import {editSourceSymmetryConfiguration,sourceSymmetryInitialSeed,parseSourceSymmetryConfiguration,usesSourceSymmetryProject} from '../src/engine/sourceSymmetryConfig';
import {sourceSnapshotMapKeys} from '../src/engine/sourceSnapshotMapOrder';
const inputs=JSON.parse(readFileSync(new URL('./fixtures/source-iterated-apply/input.json',import.meta.url),'utf8')) as {cases:{id:string;document:Record<string,unknown>}[]};
type Stage={seed?:string;error?:string;parameters?:Record<string,string>;parameterOrder?:string[];editorParameters?:Record<string,string>;editorParameterOrder?:string[];RawEquationXNext?:string;RawEquationYNext?:string;RawEquationZNext?:string};
const fixture=JSON.parse(readFileSync(new URL('./fixtures/source-iterated-apply/source.json',import.meta.url),'utf8')) as {cases:{id:string;stages:Stage[]}[]};
const apply=(scene:SceneDocument,next=scene)=>scene.kind==='map'?editSourceMapScene(scene,next,'apply'):editSourceSymmetryConfiguration(scene,next,'apply');
const numbers=(values:Record<string,string>)=>Object.fromEntries(Object.entries(values).map(([k,v])=>[k,Number(v)]));
function matches(scene:SceneDocument,expected:Stage,editor:boolean){
 const cfg=scene.mapSource??scene.symmetrySource!;
 expect(scene.mapSource?sourceMapInitialSeed(scene.mapSource):sourceSymmetryInitialSeed(scene.symmetrySource!)).toBe(expected.seed);
 expect(cfg.construction.parameters.map(([k])=>k)).toEqual(expected.parameterOrder);
 expect(Object.fromEntries(cfg.construction.parameters)).toEqual(numbers(expected.parameters!));
 if(scene.mapSource)expect(scene.mapSource.construction.equations).toEqual({x:expected.RawEquationXNext,y:expected.RawEquationYNext,z:expected.RawEquationZNext});
 if(editor){expect(Object.fromEntries(cfg.editorParameters!)).toEqual(numbers(expected.editorParameters!));expect(sourceSnapshotMapKeys(cfg.editorMap!)).toEqual(expected.editorParameterOrder);}
}
describe('explicit iterated Apply against original JVM configuration boundaries',()=>{
 for(const row of fixture.cases)it(row.id+' preserves direct/project routes and repeated Apply',()=>{
  const text=JSON.stringify({name:row.id,...inputs.cases.find(c=>c.id===row.id)!.document});
  const direct=row.stages[0];if(direct.error)expect(()=>parseLegacyScene(text)).toThrow();else {
   const runtime=parseLegacyScene(text).scene;matches(runtime,direct,false);
   if(row.stages[1].error)expect(()=>apply(runtime)).toThrow();else matches(apply(runtime),row.stages[1],true);
  }
  if(row.stages[1].error){expect(()=>parseProjectFile(text)).toThrow();return;}
  const initial=parseProjectFile(text).scene;matches(initial,row.stages[1],true);
  const next=apply(initial);matches(next,row.stages[2],true);
  expect(next.mapSource??next.symmetrySource).not.toBe(initial.mapSource??initial.symmetrySource);
  matches(apply(parseScene(serializeScene(next))),row.stages[2],true);
 });
 it('normalizes a hot standard delta_power only when Apply is explicit',()=>{
  const input=inputs.cases.find(c=>c.id==='Sym-standard-delta-power-2.25')!,expected=fixture.cases.find(c=>c.id===input.id)!.stages[2];
  const initial=parseProjectFile(JSON.stringify({name:'Apply hot value',...input.document})).scene;
  const hot=editSourceSymmetryConfiguration(initial,{...initial,parameters:{...initial.parameters,delta_power:2.25}},'parameters');
  expect(hot.parameters.delta_power).toBe(2.25);expect(hot.symmetrySource!.editorParameters!.find(([k])=>k==='delta_power')![1]).toBe(2.25);
  const equalEdit=editSourceSymmetryConfiguration(hot,hot);expect(equalEdit.symmetrySource).toBe(hot.symmetrySource);
  matches(apply(hot),expected,true);
 });
 it('retains explicit import identity and refuses missing editor evidence without mutation',()=>{
  const input=inputs.cases.find(c=>c.id==='SYMMETRY_CHAOS-default')!;
  const runtime=parseLegacyScene(JSON.stringify({name:'runtime',...input.document})).scene;
  expect(usesSourceSymmetryProject(runtime)).toBe(false);
  expect(usesSourceSymmetryProject(parseScene(serializeScene(runtime)))).toBe(false);
  expect(parseSourceSymmetryConfiguration({...runtime.symmetrySource,entry:'unknown'}).ok).toBe(false);
  for(const scene of [runtime,parseLegacyScene(JSON.stringify({name:'old Map',config_version:'1.0.0',type:'MAP_ATTRACTOR'})).scene]){
   const old=structuredClone(scene);if(old.symmetrySource)delete old.symmetrySource.editorParameters;
   const before=structuredClone(old);expect(()=>apply(old)).toThrow('编辑参数来源');expect(old).toEqual(before);
  }
 });
 it('camera-only Apply trims raw Map equations while field editing keeps construction',()=>{
  const input=inputs.cases.find(c=>c.id==='Map-raw-spaces')!,row=fixture.cases.find(c=>c.id===input.id)!;
  const initial=parseLegacyScene(JSON.stringify({name:'Raw camera Apply',...input.document})).scene;
  const next={...initial,sourceCamera:{...initial.sourceCamera!,frame:{...initial.sourceCamera!.frame,phi:.45}}};
  expect(editSourceMapScene(initial,next).mapSource).toBe(initial.mapSource);
  const applied=apply(initial,next);matches(applied,row.stages[1],false);
  expect(applied.sourceCamera).toEqual(next.sourceCamera);
 });
});
