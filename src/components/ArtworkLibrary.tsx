import {useMemo,useState} from 'react';
import {ChevronDown,ChevronRight,Copy,Folder,FolderPlus,MoreHorizontal,Plus,Star,Trash2,Undo2,X} from 'lucide-react';
import type {SceneDocument,SceneKind} from '../types';
import {definition} from '../scenes';
import {creationDefinitions} from '../scenes/releaseCatalog';
import {artworkLocation,artworkIsTrashed,availableFolderParents,folderIsTrashed,folderPath,folderRows,moveArtwork,moveFolder,restoreArtwork,restoreFolder,sortedArtworks,trashArtwork,trashFolder,type ArtworkLibrary as Library} from '../engine/library';
import {TextPrompt,type TextPromptRequest} from './TextPrompt';
import {useI18n} from '../i18n';

export function ArtworkLibrary({library,scenes,drafts,active,search,onChange,onLoad,onCreate,onRename,onDuplicate,onFavorite}:{library:Library;scenes:SceneDocument[];drafts:SceneDocument[];active:string;search:string;onChange:(value:Library)=>void;onLoad:(scene:SceneDocument)=>void;onCreate:(kind:SceneKind,folderId:string|null)=>void;onRename:(scene:SceneDocument,name:string)=>void;onDuplicate:(scene:SceneDocument)=>void;onFavorite:(scene:SceneDocument)=>void;}){
 const {t,language}=useI18n(),[view,setView]=useState<'all'|'folder'|'trash'|'drafts'>(library.selected?'folder':'all'),[closed,setClosed]=useState(new Set<string>()),[menu,setMenu]=useState<{kind:'folder'|'artwork';id:string}|null>(null),[prompt,setPrompt]=useState<TextPromptRequest|null>(null),[newScene,setNewScene]=useState(false),[error,setError]=useState('');
 const parent=view==='folder'?library.selected:null;
 const validate=(name:string)=>!name.trim()||name.length>300?'名称需为 1–300 个字符':undefined;
 function act(action:()=>void){try{action();setError('');setMenu(null);}catch(error){setError(error instanceof Error?error.message:String(error));}}
 function newFolder(){setPrompt({title:'新建文件夹',label:'文件夹名称',initial:t('新文件夹'),validate,submit:name=>onChange({...library,folders:[...library.folders,{id:crypto.randomUUID(),name,parentId:parent}]})});}
 const draftItems=useMemo(()=>drafts.filter(d=>!artworkIsTrashed(library,d.id)&&JSON.stringify(d)!==JSON.stringify(scenes.find(s=>s.id===d.id))),[drafts,scenes,library]);
 const filtered=sortedArtworks((view==='drafts'?draftItems:scenes).filter(scene=>{
  if(view==='trash')return artworkIsTrashed(library,scene.id);
  if(artworkIsTrashed(library,scene.id))return false;
  return search||view==='all'||view==='drafts'||(artworkLocation(library,scene.id)?.folderId??null)===parent;
 }).filter(scene=>`${scene.name} ${scene.description??''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())),library);
 function folderOptions(moving?:string){return <><option value="">{t('我的作品根目录')}</option>{availableFolderParents(library,moving).map(f=><option key={f.id} value={f.id}>{folderPath(library,f.id)}</option>)}</>;}
 function actions(kind:'folder'|'artwork',id:string){
  if(menu?.id!==id||menu.kind!==kind)return null;
  const folder=library.folders.find(f=>f.id===id),scene=scenes.find(s=>s.id===id),trashed=kind==='folder'?folderIsTrashed(library,id):artworkIsTrashed(library,id);
  return <div className="library-actions" role="group" aria-label={t('作品操作')}>
   <button title={t('关闭菜单')} onClick={()=>setMenu(null)}><X size={12}/></button>
   {trashed?<button onClick={()=>act(()=>onChange(kind==='folder'?restoreFolder(library,id):restoreArtwork(library,id)))}><Undo2 size={13}/>{t('恢复')}</button>:<>
    <button onClick={()=>{setMenu(null);setPrompt({title:'重命名',label:kind==='folder'?'文件夹名称':'场景名称',initial:kind==='folder'?folder!.name:scene!.name,validate,submit:name=>kind==='folder'?onChange({...library,folders:library.folders.map(f=>f.id===id?{...f,name}:f)}):onRename(scene!,name)});}}>{t('重命名')}</button>
    {kind==='artwork'&&<><button onClick={()=>act(()=>onDuplicate(scene!))}><Copy size={13}/>{t('创建副本')}</button><button onClick={()=>act(()=>onFavorite(scene!))}><Star size={13}/>{t(scene!.favorite?'取消收藏':'收藏作品')}</button></>}
    <label>{t('移动到')}<select aria-label={t('移动到')} value={kind==='folder'?folder!.parentId??'':artworkLocation(library,id)?.folderId??''} onChange={event=>act(()=>onChange(kind==='folder'?moveFolder(library,id,event.target.value||null):moveArtwork(library,id,event.target.value||null)))}>{folderOptions(kind==='folder'?id:undefined)}</select></label>
    <button onClick={()=>act(()=>onChange(kind==='folder'?trashFolder(library,id):trashArtwork(library,id)))}><Trash2 size={13}/>{t('移至回收站')}</button>
   </>}
  </div>;
 }
 function folders(){
  return folderRows(library,closed).map(({folder,depth})=><div key={folder.id}>
   <div className={`folder-row ${view==='folder'&&library.selected===folder.id?'active':''}`} style={{paddingLeft:depth*12}} onContextMenu={e=>{e.preventDefault();setMenu({kind:'folder',id:folder.id});}}>
    <button aria-label={t(closed.has(folder.id)?'展开文件夹':'折叠文件夹')} aria-expanded={!closed.has(folder.id)} onClick={()=>setClosed(previous=>{const next=new Set(previous);if(next.has(folder.id))next.delete(folder.id);else next.add(folder.id);return next;})}>{closed.has(folder.id)?<ChevronRight size={12}/>:<ChevronDown size={12}/>}</button>
    <button className="folder-name" onClick={()=>{setView('folder');onChange({...library,selected:folder.id});}}><Folder size={14}/>{folder.name}</button>
    <button aria-label={t('文件夹操作：{name}',{name:folder.name})} onClick={()=>setMenu({kind:'folder',id:folder.id})}><MoreHorizontal size={14}/></button>
   </div>{actions('folder',folder.id)}
  </div>);
 }
 return <section className="artwork-library" aria-label={t('作品文件夹')} onContextMenu={event=>{if((event.target as HTMLElement).closest('.artwork-item,.folder-row'))return;event.preventDefault();setNewScene(true);}}>
  <div className="library-tools"><button onClick={newFolder} title={t('新建文件夹')}><FolderPlus size={15}/></button><button onClick={()=>setNewScene(!newScene)} title={t('在此创建场景')}><Plus size={15}/></button><select aria-label={t('作品排序')} value={library.sort} onChange={e=>onChange({...library,sort:e.target.value as Library['sort']})}><option value="modified">{t('最近修改')}</option><option value="name">{t('名称排序')}</option></select></div>
  {newScene&&<div className="library-actions">{creationDefinitions.map(d=><button key={d.kind} onClick={()=>{setNewScene(false);onCreate(d.kind,parent);}}>{language==='en'?d.englishName:d.name}</button>)}</div>}
  <nav aria-label={t('作品目录')}>
   <button className={`folder-root ${view==='all'?'active':''}`} onClick={()=>setView('all')}>{t('全部作品')}</button>
   <button className={`folder-root ${view==='drafts'?'active':''}`} onClick={()=>{setView('drafts');setMenu(null);}}>{t('草稿箱')}<span>{draftItems.length}</span></button>
   <button className={`folder-root ${view==='folder'&&library.selected===null?'active':''}`} onClick={()=>{setView('folder');onChange({...library,selected:null});}}>{t('未分类')}</button>
   {folders()}
   <button className={`folder-root ${view==='trash'?'active':''}`} onClick={()=>{setView('trash');setMenu(null);}}><Trash2 size={13}/>{t('回收站')}</button>
  </nav>
  {view==='trash'&&<><p className="muted">{t('回收站中的作品和文件夹可随时恢复。')}</p>{library.folders.filter(f=>f.deletedAt!==undefined).map(f=><div key={f.id} className="trash-folder"><Folder size={14}/><span>{f.name}</span><button onClick={()=>act(()=>onChange(restoreFolder(library,f.id)))}>{t('恢复文件夹')}</button></div>)}</>}
  {error&&<p role="alert" className="equation-error">{t(error)}</p>}
  {view==='drafts'&&<p className="muted">{t('打开草稿继续编辑；点击顶部保存可加入我的作品。')}</p>}
  <div className="library-label">{view==='trash'?t('回收站'):view==='drafts'?t('草稿箱'):search?t('搜索结果'):view==='all'?t('全部作品'):parent?folderPath(library,parent):t('未分类')}<span>{filtered.length}</span></div>
  <div className="artwork-items">{filtered.map(scene=><div key={scene.id} className={`artwork-item ${active===scene.id?'selected':''}`} onContextMenu={event=>{if(view==='drafts')return;event.preventDefault();setMenu({kind:'artwork',id:scene.id});}}>
   <div className="artwork-row"><button className="artwork-open" onClick={()=>onLoad(scene)}><strong>{scene.name}</strong><small>{language==='en'?definition(scene.kind).englishName:definition(scene.kind).name}</small></button>{scene.favorite&&<Star size={12}/>} {view!=='drafts'&&<button aria-label={t('作品操作：{name}',{name:scene.name})} onClick={()=>setMenu({kind:'artwork',id:scene.id})}><MoreHorizontal size={15}/></button>}</div>{view!=='drafts'&&actions('artwork',scene.id)}
  </div>)}</div>
  {!filtered.length&&<p className="empty-state">{t(search?'未找到匹配场景':'此处暂无作品')}</p>}
  {prompt&&<TextPrompt request={prompt} onClose={()=>setPrompt(null)}/>}
 </section>;
}
