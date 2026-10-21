import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseProjectFile,parseLegacyScene} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {editSourceSymmetryConfiguration,sourceSymmetryInitialSeed} from '../src/engine/sourceSymmetryConfig';
import {sourceSnapshotMapKeys} from '../src/engine/sourceSnapshotMapOrder';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/symmetry/project-import-runtime.json',import.meta.url),'utf8')) as {cases:{id:string;stages:{editorOrder:string[];editorValues:Record<string,string>;exportedSettings:Record<string,unknown>;seed:string}[]}[];inputs:{id:string;document:Record<string,unknown>}[]};
describe('original ProjectState file-import boundary',()=>{
 for(const row of fixture.cases)it(row.id+' import, edit, save and reopen',()=>{
  const input=fixture.inputs.find(v=>v.id===row.id)!;
  const document={name:'Native '+row.id,...input.document};let scene=parseProjectFile(JSON.stringify(document)).scene;
  for(let stage=0;stage<2;stage++){
   if(stage)scene=editSourceSymmetryConfiguration(scene,{...scene,parameters:{...scene.parameters,alpha:2.3}});
   const expected=row.stages[stage],cfg=scene.symmetrySource!;
   expect(sourceSnapshotMapKeys(cfg.editorMap!)).toEqual(expected.editorOrder);
   expect(Object.fromEntries(cfg.editorParameters!)).toEqual(Object.fromEntries(Object.entries(expected.editorValues).map(([k,v])=>[k,Number(v)])));
   expect(sourceSymmetryInitialSeed(cfg)).toBe(expected.seed);
   expect(scene.settings).toMatchObject({batchSize:expected.exportedSettings.batch_size,burnIn:expected.exportedSettings.burn_in_steps,iterationsPerFrame:expected.exportedSettings.iterations_per_frame,iteratedBackend:'gpu',initialXMin:Math.fround(.001),initialXMax:Math.fround(.002),initialYMin:Math.fround(.001),initialYMax:Math.fround(.002)});
   const reopened=parseScene(serializeScene(scene));expect(reopened.symmetrySource).toEqual(cfg);scene=reopened;
  }
  expect(scene.provenance?.original).toEqual(document);
 });
 it('rejects malformed project containers and retains local capacity limits',()=>{
  for(const field of ['settings','parameters','equation'])for(const value of [null,[],false,'bad'])expect(()=>parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'Invalid container',type:'SYMMETRY_CHAOS',[field]:value}))).toThrow();
  expect(()=>parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'Capacity',type:'SYMMETRY_CHAOS',settings:{batch_size:8000001}}))).toThrow('8000000');
 });
 it('keeps direct runtime-config decoding distinct from user file loading',()=>{
  const raw=JSON.stringify({config_version:'1.0.0',name:'Entry routes',type:'SYMMETRY_CHAOS',parameters:{alpha:true,beta:'false',gamma:'bad'}});
  expect(parseLegacyScene(raw).scene.parameters).toEqual({alpha:1,beta:0});
  expect(parseProjectFile(raw).scene.parameters).toEqual({alpha:0,beta:0,gamma:0});
 });
});
