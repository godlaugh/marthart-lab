import type {SceneDocument} from '../types';

export interface ArtworkFolder {id:string;name:string;parentId:string|null;deletedAt?:number;}
export interface ArtworkLocation {folderId:string|null;updatedAt:number;deletedAt?:number;}
export interface ArtworkLibrary {folders:ArtworkFolder[];items:Record<string,ArtworkLocation>;sort:'name'|'modified';selected:string|null;}
export const emptyLibrary=():ArtworkLibrary=>({folders:[],items:{},sort:'modified',selected:null});
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=300;
const timestamp=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
/** Library identity is workspace metadata, never a filesystem path. */
export function parseLibrary(value:unknown,sceneIds:readonly string[]):ArtworkLibrary {
 if(value===undefined)return emptyLibrary();
 if(!object(value)||!Array.isArray(value.folders)||!object(value.items)||!['name','modified'].includes(String(value.sort)))throw new Error('作品目录格式无效');
 const folders:ArtworkFolder[]=value.folders.map(raw=>{
  if(!object(raw)||!text(raw.id)||!text(raw.name)||!raw.name.trim()||!(raw.parentId===null||text(raw.parentId))||raw.deletedAt!==undefined&&!timestamp(raw.deletedAt))throw new Error('作品文件夹无效');
  return{id:raw.id as string,name:raw.name as string,parentId:raw.parentId as string|null,...(raw.deletedAt===undefined?{}:{deletedAt:raw.deletedAt as number})};
 });
 const byId=new Map(folders.map(f=>[f.id,f])),ids=new Set(byId.keys());if(ids.size!==folders.length)throw new Error('作品文件夹标识重复');
 const validated=new Set<string>();
 for(const folder of folders){const path=new Set<string>();let parent:string|null=folder.id;while(parent!==null&&!validated.has(parent)){if(path.has(parent)||!ids.has(parent))throw new Error('作品目录存在循环或缺失的上级');path.add(parent);parent=byId.get(parent)!.parentId;}for(const id of path)validated.add(id);}
 const items=Object.fromEntries(Object.entries(value.items).map(([id,raw])=>{
  if(!sceneIds.includes(id)||!object(raw)||!(raw.folderId===null||typeof raw.folderId==='string'&&ids.has(raw.folderId))||!timestamp(raw.updatedAt)||raw.deletedAt!==undefined&&!timestamp(raw.deletedAt))throw new Error('作品位置元数据无效');
  return[id,{folderId:raw.folderId as string|null,updatedAt:raw.updatedAt as number,...(raw.deletedAt===undefined?{}:{deletedAt:raw.deletedAt as number})}];
 }));
 if(value.selected!==null&&(typeof value.selected!=='string'||!ids.has(value.selected)))throw new Error('选中的作品文件夹不存在');
 return{folders,items,sort:value.sort as 'name'|'modified',selected:value.selected as string|null};
}
export function folderIsTrashed(library:ArtworkLibrary,id:string|null):boolean {
 while(id!==null){const folder=library.folders.find(f=>f.id===id);if(!folder)throw new Error('作品文件夹不存在');if(folder.deletedAt!==undefined)return true;id=folder.parentId;}return false;
}
export function artworkLocation(library:ArtworkLibrary,id:string):ArtworkLocation|undefined{return Object.hasOwn(library.items,id)?library.items[id]:undefined;}
export function artworkIsTrashed(library:ArtworkLibrary,id:string):boolean {const item=artworkLocation(library,id);return !!item&&(item.deletedAt!==undefined||folderIsTrashed(library,item.folderId));}
export function folderPath(library:ArtworkLibrary,id:string|null):string {
 const names:string[]=[];while(id!==null){const folder=library.folders.find(f=>f.id===id);if(!folder)throw new Error('作品文件夹不存在');names.unshift(folder.name);id=folder.parentId;}return names.join(' / ');
}
/** Iterative traversal also handles deeply nested imported libraries without
 * consuming one JavaScript stack frame per directory. */
export function folderRows(library:ArtworkLibrary,closed:ReadonlySet<string>=new Set()):{folder:ArtworkFolder;depth:number}[]{
 const children=new Map<string|null,ArtworkFolder[]>();for(const folder of library.folders){const siblings=children.get(folder.parentId)??[];siblings.push(folder);children.set(folder.parentId,siblings);}
 for(const siblings of children.values())siblings.sort((a,b)=>a.name.localeCompare(b.name));
 const stack=(children.get(null)??[]).map(folder=>({folder,depth:0})).reverse(),rows:{folder:ArtworkFolder;depth:number}[]=[];
 while(stack.length){const row=stack.pop()!;if(row.folder.deletedAt!==undefined)continue;rows.push(row);if(!closed.has(row.folder.id))for(const folder of [...(children.get(row.folder.id)??[])].reverse())stack.push({folder,depth:row.depth+1});}return rows;
}
export function availableFolderParents(library:ArtworkLibrary,movingId?:string):ArtworkFolder[]{
 return library.folders.filter(f=>{if(folderIsTrashed(library,f.id))return false;let id:string|null=f.id;while(id!==null){if(id===movingId)return false;id=library.folders.find(v=>v.id===id)!.parentId;}return true;});
}
export function moveArtwork(library:ArtworkLibrary,id:string,folderId:string|null,now=Date.now()):ArtworkLibrary {
 if(folderId!==null&&folderIsTrashed(library,folderId))throw new Error('不能移动到回收站中的文件夹');
 return{...library,items:{...library.items,[id]:{folderId,updatedAt:now}}};
}
export function touchArtwork(library:ArtworkLibrary,id:string,now=Date.now()):ArtworkLibrary {
 return{...library,items:{...library.items,[id]:{...(artworkLocation(library,id)??{folderId:library.selected}),updatedAt:now}}};
}
export function moveFolder(library:ArtworkLibrary,id:string,parentId:string|null):ArtworkLibrary {
 if(!library.folders.some(f=>f.id===id)||parentId!==null&&!availableFolderParents(library,id).some(f=>f.id===parentId))throw new Error('不能将文件夹移入自身、子目录或回收站');
 return{...library,folders:library.folders.map(f=>f.id===id?{...f,parentId}:f)};
}
export function trashArtwork(library:ArtworkLibrary,id:string,now=Date.now()):ArtworkLibrary {return{...library,items:{...library.items,[id]:{...(artworkLocation(library,id)??{folderId:null,updatedAt:now}),deletedAt:now}}};}
export function restoreArtwork(library:ArtworkLibrary,id:string):ArtworkLibrary {
 const old=artworkLocation(library,id);if(!old)return library;const {deletedAt:_,...item}=old;void _;
 return{...library,items:{...library.items,[id]:{...item,folderId:folderIsTrashed(library,item.folderId)?null:item.folderId}}};
}
export function trashFolder(library:ArtworkLibrary,id:string,now=Date.now()):ArtworkLibrary {
 const next={...library,folders:library.folders.map(f=>f.id===id?{...f,deletedAt:now}:f)};
 return{...next,selected:folderIsTrashed(next,next.selected)?null:next.selected};
}
export function restoreFolder(library:ArtworkLibrary,id:string):ArtworkLibrary {
 return{...library,folders:library.folders.map(f=>{if(f.id!==id)return f;const {deletedAt:_,...folder}=f;void _;return{...folder,parentId:folderIsTrashed(library,folder.parentId)?null:folder.parentId};})};
}
export function sortedArtworks(scenes:SceneDocument[],library:ArtworkLibrary):SceneDocument[]{
 return [...scenes].sort((a,b)=>library.sort==='modified'?(artworkLocation(library,b.id)?.updatedAt??0)-(artworkLocation(library,a.id)?.updatedAt??0)||a.name.localeCompare(b.name):a.name.localeCompare(b.name,undefined,{numeric:true})||a.id.localeCompare(b.id));
}
