import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import type fixtureShape from './fixtures/symmetry/snapshot-map-runtime.json';
// Read literal JSON: Vite's JSON module transform normalizes -0 to +0.
const fixture:typeof fixtureShape=JSON.parse(readFileSync(new URL('./fixtures/symmetry/snapshot-map-runtime.json',import.meta.url),'utf8'));
import {prepareSourceSnapshotMap,parseSourceSnapshotMap,sourceSnapshotMapKeys,type SourceSnapshotMap} from '../src/engine/sourceSnapshotMapOrder';
import {prepareRootsSourceMemberOrder} from '../src/engine/rootsSourceOrder';
import {createSourceSymmetryConfiguration,editSourceSymmetryConfiguration,sourceSymmetryInitialSeed,parseSourceSymmetryConfiguration,importSourceSymmetryParameters} from '../src/engine/sourceSymmetryConfig';
import {parseProjectFile} from '../src/engine/legacyImport';
import {serializeScene,parseScene} from '../src/engine/document';
describe('original bundled Compose SnapshotStateMap runtime order',()=>{
 for(const row of fixture.cases)it(row.id,()=>{
  let keys:string[]=[],order:string[]=[],state:SourceSnapshotMap|undefined;const values=new Map<string,number>();
  for(const action of row.operations){const operation=String(action[0]),key=String(action[1]);
   if(operation==='clear')values.clear();else if(operation==='remove')values.delete(key);else values.set(key,Number(action[2]??1));
   if(operation==='clear')keys=[];else if(operation==='remove')keys=keys.filter(k=>k!==key);else if(!keys.includes(key))keys.push(key);
   const prepared=prepareSourceSnapshotMap(keys,state);if(!prepared.ok)throw Error(prepared.error.reason);order=prepared.keys;state=prepared.state;
  }
  expect(order).toEqual(row.snapshotOrder);const json=prepareRootsSourceMemberOrder(order);if(!json.ok)throw Error(JSON.stringify(json.error));expect(json.value.keys).toEqual(row.jsonOrder);
  const parsed=importSourceSymmetryParameters(Object.fromEntries(values),row.jsonOrder,'standard');if(!parsed.ok)throw Error(parsed.error.reason);
  const config=createSourceSymmetryConfiguration(262144,parsed.value.ordered);if(!config.ok)throw Error(config.error.reason);expect(sourceSymmetryInitialSeed(config.value)).toBe(row.constructorSeed);
 });
 it('rejects invalid/capacity input and preserves caller arrays',()=>{
  const input=['AaAa','BBBB','AaBB'],copy=[...input];expect(prepareSourceSnapshotMap(input).ok).toBe(true);expect(input).toEqual(copy);
  expect(prepareSourceSnapshotMap(['x','x']).ok).toBe(false);expect(prepareSourceSnapshotMap(['x'],{data:['x','x'],children:[]}).ok).toBe(false);
  expect(prepareSourceSnapshotMap(['x'.repeat(8*1024*1024+1)])).toMatchObject({ok:false,error:{kind:'capacity'}});
  expect(prepareSourceSnapshotMap(Array.from({length:65537},(_,i)=>String(i)))).toMatchObject({ok:false,error:{kind:'capacity'}});
 });
 it('retains deletion history across serialized tree checkpoints',()=>{
  for(const row of fixture.cases.filter(row=>row.operations.some(action=>action[0]==='remove'))){
   const keys=new Set<string>();let state:SourceSnapshotMap|undefined;
   for(const action of row.operations){const operation=String(action[0]),key=String(action[1]);if(operation==='clear')keys.clear();else if(operation==='remove')keys.delete(key);else keys.add(key);
    const prepared=prepareSourceSnapshotMap([...keys],state);if(!prepared.ok)throw Error(prepared.error.reason);
    const reopened=parseSourceSnapshotMap(JSON.parse(JSON.stringify(prepared.state)));if(!reopened.ok)throw Error(reopened.error.reason);state=reopened.state;
   }
   expect(sourceSnapshotMapKeys(state!)).toEqual(row.snapshotOrder);
  }
 });
 it('rejects invalid saved hash paths and empty children without mutating state',()=>{
  const prepared=prepareSourceSnapshotMap(['AaAa','BBBB','AaBB']);if(!prepared.ok)throw Error(prepared.error.reason);
  const original=JSON.stringify(prepared.state),wrong=structuredClone(prepared.state);wrong.children[0][0]=(wrong.children[0][0]+1)%32;
  expect(parseSourceSnapshotMap(wrong).ok).toBe(false);expect(parseSourceSnapshotMap({data:[],children:[[0,{data:[],children:[]}]]}).ok).toBe(false);
  const next=prepareSourceSnapshotMap(['AaAa'],prepared.state);expect(next.ok).toBe(true);expect(JSON.stringify(prepared.state)).toBe(original);
 });
 it('rebuilds public imported coefficients in measured native order and persists the editor map',()=>{
  const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'Editor fixture',type:'SYMMETRY_CHAOS',parameters:{lambda:2,alpha:-2.43,beta:1,gamma:.05,omega:0,symmetry_degree:3}})).scene;
  const next=editSourceSymmetryConfiguration(scene,{...scene,parameters:{...scene.parameters,alpha:-2.5}}),row=fixture.cases.find(r=>r.id==='standard')!;
  expect(sourceSnapshotMapKeys(next.symmetrySource!.editorMap!)).toEqual(row.snapshotOrder);expect(next.symmetrySource!.construction.parameters.map(([k])=>k)).toEqual(row.jsonOrder);
  const expected=createSourceSymmetryConfiguration(Number(next.settings.batchSize),row.jsonOrder.map(k=>[k,next.parameters[k]]));if(!expected.ok)throw Error(expected.error.reason);
  expect(sourceSymmetryInitialSeed(next.symmetrySource!)).toBe(sourceSymmetryInitialSeed(expected.value));expect(parseScene(serializeScene(next)).symmetrySource).toEqual(next.symmetrySource);
 });
 it('does not reinsert collision keys during scalar edits or reopening',()=>{
  const keys=['AaAaAaAa','AaAaAaBB','AaAaBBAa','AaAaBBBB'];
  let scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'Collision fixture',type:'SYMMETRY_CHAOS',parameters:Object.fromEntries(keys.map(k=>[k,1]))})).scene;
  const order=sourceSnapshotMapKeys(scene.symmetrySource!.editorMap!);
  for(let i=2;i<6;i++){scene=editSourceSymmetryConfiguration(scene,{...scene,parameters:{...scene.parameters,[keys[0]]:i}});scene=parseScene(serializeScene(scene));expect(sourceSnapshotMapKeys(scene.symmetrySource!.editorMap!)).toEqual(order);}
  const malformed=structuredClone(scene.symmetrySource!);malformed.editorMap={data:[...keys,'missing'],children:[]};expect(parseSourceSymmetryConfiguration(malformed).ok).toBe(false);
 });
});
