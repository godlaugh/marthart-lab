import {describe,it,expect} from 'vitest';
import {createScene,loadWorkspace,saveWorkspace,STORAGE_KEY} from '../src/engine/document';
import {definition} from '../src/scenes';
import {artworkIsTrashed,availableFolderParents,emptyLibrary,folderRows,moveArtwork,moveFolder,parseLibrary,restoreArtwork,restoreFolder,sortedArtworks,touchArtwork,trashArtwork,trashFolder,type ArtworkLibrary} from '../src/engine/library';

const tree=():ArtworkLibrary=>({...emptyLibrary(),folders:[{id:'a',name:'Art',parentId:null},{id:'b',name:'Curves',parentId:'a'},{id:'c',name:'Other',parentId:null}],items:{scene:{folderId:'b',updatedAt:100}},selected:'b'});
describe('artwork library ownership and persistence',()=>{
 it('migrates workspaces without folders and retains nested scene placement through save/reload',()=>{
  const doc=createScene(definition('surface'));doc.id='scene';const entries=new Map<string,string>(),storage={getItem:(key:string)=>entries.get(key)??null,setItem:(key:string,value:string)=>entries.set(key,value)} as unknown as Storage;
  const state={scenes:[doc],active:doc.id,theme:'dark' as const,language:'zh' as const};saveWorkspace(storage,state);expect(loadWorkspace(storage)?.library).toBeUndefined();expect(parseLibrary(undefined,[doc.id])).toEqual(emptyLibrary());
  saveWorkspace(storage,{...state,library:tree()});expect(loadWorkspace(storage)?.library).toEqual(tree());
  entries.set(STORAGE_KEY,JSON.stringify({...state,library:{...tree(),folders:[]}}));expect(loadWorkspace(storage)?.recovered).toBe(true);expect(entries.get(STORAGE_KEY)).toContain('"folders":[]');
 });
 it('rejects cycles, missing parents, duplicate identity, orphan metadata and nonfinite timestamps',()=>{
  const invalid=[{...tree(),folders:[{id:'a',name:'Loop',parentId:'a'}]},{...tree(),folders:[{id:'a',name:'Lost',parentId:'missing'}]},{...tree(),folders:[...tree().folders,tree().folders[0]]},{...tree(),items:{orphan:{folderId:null,updatedAt:0}}},{...tree(),items:{scene:{folderId:'b',updatedAt:NaN}}}];
  for(const value of invalid)expect(()=>parseLibrary(value,['scene'])).toThrow();
 });
 it('prevents moving a folder into itself or descendants, but allows a whole subtree to move',()=>{
  const library=tree();expect(availableFolderParents(library,'a').map(f=>f.id)).toEqual(['c']);expect(()=>moveFolder(library,'a','b')).toThrow();
  const moved=moveFolder(library,'a','c');expect(moved.items.scene.folderId).toBe('b');expect(folderRows(moved).map(row=>[row.folder.id,row.depth])).toEqual([['c',0],['a',1],['b',2]]);expect(library.folders[0].parentId).toBeNull();
 });
 it('trashes and restores a folder subtree without deleting or rewriting contained documents',()=>{
  const library=tree(),trashed=trashFolder(library,'a',200);expect(artworkIsTrashed(trashed,'scene')).toBe(true);expect(trashed.selected).toBeNull();expect(trashed.items).toBe(library.items);expect(folderRows(trashed).map(row=>row.folder.id)).toEqual(['c']);
  expect(artworkIsTrashed(restoreFolder(trashed,'a'),'scene')).toBe(false);expect(()=>moveArtwork(trashed,'scene','b')).toThrow();
  const individuallyRestored=restoreArtwork(trashed,'scene');expect(individuallyRestored.items.scene.folderId).toBeNull();expect(artworkIsTrashed(individuallyRestored,'scene')).toBe(false);
 });
 it('preserves a separately trashed artwork when its containing folder is restored',()=>{
  const library=trashFolder(trashArtwork(tree(),'scene',200),'a',300),restored=restoreFolder(library,'a');expect(artworkIsTrashed(restored,'scene')).toBe(true);expect(restoreArtwork(restored,'scene').items.scene.folderId).toBe('b');
 });
 it('keeps metadata identities separate from display names and sorts by the selected owner facts',()=>{
  const a={...createScene(definition('surface')),id:'scene',name:'Zebra'},b={...a,id:'other',name:'Apple'},library=touchArtwork(moveArtwork(tree(),'other',null,300),'scene',400);
  expect(sortedArtworks([a,b],library).map(s=>s.id)).toEqual(['scene','other']);expect(sortedArtworks([a,b],{...library,sort:'name'}).map(s=>s.id)).toEqual(['other','scene']);
  expect(library.items.scene.folderId).toBe('b');expect(parseLibrary(JSON.parse(JSON.stringify(library)),['scene','other'])).toEqual(library);
 });
 it('validates and traverses deeply nested imported folders without recursive call-stack growth',()=>{
  const folders=Array.from({length:12000},(_,i)=>({id:String(i),name:'Folder',parentId:i===0?null:String(i-1)})),library=parseLibrary({...emptyLibrary(),folders},[]);
  expect(folderRows(library).length).toBe(12000);expect(folderRows(library,new Set(['0'])).length).toBe(1);
 });
 it('retains source identities that match JavaScript prototype names as ordinary own keys',()=>{
  for(const id of ['__proto__','constructor','toString']){
   expect(artworkIsTrashed(emptyLibrary(),id)).toBe(false);
   const library=moveArtwork(emptyLibrary(),id,null,12),loaded=parseLibrary(JSON.parse(JSON.stringify(library)),[id]);
   expect(Object.hasOwn(loaded.items,id)).toBe(true);expect(loaded.items[id].updatedAt).toBe(12);expect(artworkIsTrashed(loaded,id)).toBe(false);
  }
 });
});
