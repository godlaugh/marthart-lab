import {prepareSymmetryCustomAuthoring} from '../engine/symmetryCustomExecution';
import {useEffect,useRef,useState} from 'react';
import type {SceneDocument} from '../types';
import {symmetryFormula} from '../scenes/symmetryFormula';
import {useI18n} from '../i18n';
import {hasSymmetryCustom} from '../engine/symmetryCustom';
import {withSymmetryTemplate,withSymmetryCustomSource,symmetryTemplateSelectionError} from '../engine/symmetryEditing';
import {beginSymmetryCustomValidation,type SymmetryCustomValidation} from '../engine/symmetryCustomValidation';

function CustomSourceEditor({scene,onChange}:{scene:SceneDocument;onChange:(next:SceneDocument)=>void}){
 const {t}=useI18n(),[draft,setDraft]=useState(scene.equations.glsl??''),[failure,setFailure]=useState<string>(),[busy,setBusy]=useState(false);
 const active=useRef<SymmetryCustomValidation|null>(null),current=useRef(scene);current.current=scene;
 // A changed document invalidates the exact candidate being checked, including
 // parameter edits and Undo. Never overwrite a newer document after GPU work.
 useEffect(()=>{active.current?.cancel();active.current=null;setBusy(false);return()=>{active.current?.cancel();active.current=null;};},[scene]);
 let syntax:string|undefined;try{prepareSymmetryCustomAuthoring(scene,draft);}catch(e){syntax=e instanceof Error?e.message:String(e);}
 const dirty=draft!==(scene.equations.glsl??'');
 const cancel=()=>{active.current?.cancel();active.current=null;setBusy(false);};
 const apply=async()=>{
  if(busy||!dirty||syntax)return;
  const base=scene,next=withSymmetryCustomSource(base,draft),validation=beginSymmetryCustomValidation(next);
  active.current=validation;setBusy(true);setFailure(undefined);
  try{
   await validation.promise;
   if(active.current===validation&&current.current===base)onChange(next);
  }catch(e){if(active.current===validation&&current.current===base)setFailure(e instanceof Error?e.message:String(e));}
  finally{if(active.current===validation){active.current=null;setBusy(false);}}
 };
 return <div className="equation-field">
  <textarea aria-label={t('自定义 GLSL 源码')} value={draft} spellCheck={false} autoComplete="off" autoCapitalize="off" rows={12} aria-invalid={!!(syntax||failure)} style={{width:'100%',fontFamily:'monospace',resize:'vertical'}} onChange={e=>{cancel();setDraft(e.target.value);setFailure(undefined);}}/>
  <p className="muted">{t('草稿不会改变当前画面。验证首帧成功后应用；需要 GPU 持续批次模式。')}</p>
  {(syntax||failure)&&<p role="alert" className="export-error">{t(syntax??failure!)}</p>}
  <button className="apply-button" disabled={busy||!dirty||!!syntax} onClick={()=>void apply()}>{t(busy?'正在验证 GLSL…':'验证并应用 GLSL')}</button>
  {busy&&<button onClick={cancel}>{t('取消验证')}</button>}
  {dirty&&<button onClick={()=>{cancel();setDraft(scene.equations.glsl??'');setFailure(undefined);}}>{t('放弃源码草稿')}</button>}
 </div>;
}

interface StagedSourceProps {scene:SceneDocument;onStage:(next:SceneDocument)=>void;onApply:()=>void;appliedSource?:string;applying?:boolean}
function StagedSourceEditor({scene,onStage,onApply,appliedSource,applying}:StagedSourceProps){
 const {t}=useI18n(),draft=scene.equations.glsl??'';
 let syntax:string|undefined;try{prepareSymmetryCustomAuthoring(scene,draft);}catch(e){syntax=e instanceof Error?e.message:String(e);}
 return <div className="equation-field">
  <textarea aria-label={t('自定义 GLSL 源码')} value={draft} spellCheck={false} autoComplete="off" autoCapitalize="off" rows={12} aria-invalid={!!syntax} style={{width:'100%',fontFamily:'monospace',resize:'vertical'}} onChange={e=>onStage({...scene,equations:{...scene.equations,glsl:e.target.value}})}/>
  <p className="muted">{t('草稿不会改变当前画面。验证首帧成功后应用；需要 GPU 持续批次模式。')}</p>
  {syntax&&<p role="alert" className="export-error">{t(syntax)}</p>}
  <button className="apply-button" disabled={applying||!!syntax} onClick={onApply}>{t(applying?'正在验证 GLSL…':'验证并应用 GLSL')}</button>
  {draft!==(appliedSource??'')&&<button onClick={()=>{const equations={...scene.equations};if(appliedSource===undefined)delete equations.glsl;else equations.glsl=appliedSource;onStage({...scene,equations});}}>{t('放弃源码草稿')}</button>}
 </div>;
}

export function SymmetryFormula({scene,onChange,onStage,onApply,customSelected,appliedSource,applying}:{scene:SceneDocument;onChange?:(next:SceneDocument)=>void;onStage?:(next:SceneDocument)=>void;onApply?:()=>void;customSelected?:boolean;appliedSource?:string;applying?:boolean}){
 const {t}=useI18n();
 if(scene.kind!=='symmetry')return null;
 const editor=onStage&&onApply?<StagedSourceEditor scene={scene} onStage={onStage} onApply={onApply} appliedSource={appliedSource} applying={applying}/>:onChange?<CustomSourceEditor key={scene.id+'\0'+scene.equations.glsl} scene={scene} onChange={onChange}/>:null;
 if(customSelected??hasSymmetryCustom(scene)){
  const templateError=symmetryTemplateSelectionError(scene);
  let bindings:readonly string[]|undefined,error:string|undefined;
  try{bindings=prepareSymmetryCustomAuthoring(scene,scene.equations.glsl).bindingNames;}catch(e){error=e instanceof Error?e.message:String(e);}
  return <details open className="inspector-section symmetry-formula"><summary>{t('自定义 GLSL 方程')}</summary><div className="section-body">
   {scene.equations.formula&&<p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{scene.equations.formula}</p>}
   {editor??<pre aria-label={t('自定义 GLSL 源码')} style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:'inherit'}}>{scene.equations.glsl}</pre>}
   <p className="muted">{t('参数按声明的 float uniform 传入；缺失值为 0。源码与说明文字会随项目保存。')}</p>
   {bindings&&<p className="muted">{t('匹配到的参数：{names}',{names:bindings.length?bindings.join(', '):t('无')})}</p>}
   {bindings&&<p className="muted">{t('匹配列表不代表每个参数都影响结果；未被公式使用的参数仍会保留。')}</p>}
   {error&&<p role="alert" className="export-error">{t(error)}</p>}
   <p className="muted">{t('自定义公式需要 GPU。切换模板会停用当前源码，保留已有参数；可撤销恢复。')}</p>
   {onChange&&<button disabled={!!templateError} onClick={()=>(onStage??onChange)(withSymmetryTemplate(scene,scene.settings.template==='modified'?'modified':'standard'))}>{t('使用模板公式')}</button>}
   {templateError&&<p role="status" className="muted">{t(templateError)}</p>}
  </div></details>;
 }
 const tokens=symmetryFormula(scene.settings),keys=[...new Set(tokens.flatMap(v=>v.key?[v.key]:[]))];
 // Fixed owner-generated keys only; user formula text is never a CSS selector.
 const style=keys.map(key=>{
  const token=tokens.find(v=>v.key===key)!;
  return `.inspector-scroll:has([data-symmetry-key="${key}"]:hover) #${token.target},.inspector-scroll:has([data-symmetry-key="${key}"]:focus-visible) #${token.target}{outline:2px solid var(--accent,#65dec9);outline-offset:2px}.inspector-scroll:has(#${token.target}:focus) [data-symmetry-key="${key}"]{background:#244e47;color:#c7fff0}`;
 }).join('');
 return <><details open className="inspector-section symmetry-formula"><summary>{t('只读方程')}</summary><div className="section-body">
  <style>{style}</style>
  <div className="symmetry-equation" aria-label={t('只读方程')}>{tokens.map((token,i)=>token.key?<button type="button" key={i} data-symmetry-key={token.key} title={t('定位参数 {value0}',{value0:token.key})} onClick={()=>{const field=document.getElementById(token.target!);field?.closest('details')?.setAttribute('open','');field?.focus();field?.scrollIntoView({block:'nearest'});}}>{token.text}</button>:<span key={i}>{token.text}</span>)}</div>
  <p className="muted">{t('悬停高亮对应参数；点击变量可跳到输入框。')}</p>
 </div></details>{onChange&&<details className="inspector-section"><summary>{t('自定义 GLSL 方程')}</summary><div className="section-body">{editor}</div></details>}</>;
}
