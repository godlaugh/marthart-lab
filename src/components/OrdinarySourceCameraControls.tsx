import {sourceLivePreviewKind} from '../engine/sourceLivePreview';
import {useEffect,useState} from 'react';
import {useI18n} from '../i18n';
import type {SceneDocument} from '../types';
import {ordinarySourceCameraInitial} from '../engine/ordinarySourceCamera';
import type {SourceCameraScalars} from '../engine/sourceCamera';

const fields=['phi','theta','gamma','centerX','centerY','centerZ','zoom','focalDistance'] as const;
const labels=['Phi · 弧度','Theta · 弧度','Gamma · 弧度','中心 X','中心 Y','中心 Z','初始缩放','初始焦距'];
const texts=(value:SourceCameraScalars)=>[value.phi,value.theta,value.gamma,...value.center,value.zoom,value.focalDistance].map(String);
/** Atomic baseline edits; playback frames never replace authored camera values. */
export function OrdinarySourceCameraControls({scene,onChange,disabled=false,draftValues,onDraftChange}:{scene:SceneDocument;onChange:(scene:SceneDocument)=>void;disabled?:boolean;draftValues?:string[];onDraftChange?:(values:string[])=>void}){
 const {t}=useI18n();let initial:SourceCameraScalars|undefined,problem='';
 try{initial=ordinarySourceCameraInitial(scene);}catch(cause){problem=cause instanceof Error?cause.message:String(cause);}
 const family=sourceLivePreviewKind(scene),iterated=family==='map'||family==='symmetry';
 const identity=JSON.stringify(initial);
 const [localDraft,setDraft]=useState(()=>initial?texts(initial):[]),[error,setError]=useState('');
 useEffect(()=>{setDraft(initial?texts(initial):[]);setError('');},[identity]);
 const draft=onDraftChange?(draftValues??(initial?texts(initial):[])):localDraft;
 if(problem)return <p role="alert">{t(problem)}</p>;
 if(!initial||!scene.sourceCamera)return null;
 const apply=()=>{
  try{
   const values=draft.map(value=>{if(!value.trim()||!Number.isFinite(Number(value)))throw new Error('请输入有限数值');return Number(value);});
   const [phi,theta,gamma,x,y,z,zoom,focalDistance]=values;
   const next={...scene,sourceCamera:{...scene.sourceCamera!,frame:{phi,theta,gamma,center:[x,y,z] as [number,number,number],zoom,focalDistance}}};
   ordinarySourceCameraInitial(next);onChange(next);setError('');
  }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
 };
 return <details open className="inspector-section" data-testid="ordinary-source-camera"><summary>{t('原版相机')}</summary><div className="section-body">
  <p className="muted">{t(iterated?'应用后从头重建场景，并保留当前播放或暂停状态。':'通过初始参数和时间线调整视角；修改后重新计算动画。')}</p>
  {fields.map((field,index)=><label className="field" key={field}><span>{t(labels[index])}</span><input aria-label={t(labels[index])} type="text" inputMode="decimal" disabled={disabled} value={draft[index]??''} onChange={event=>{(onDraftChange??setDraft)(draft.map((value,i)=>i===index?event.target.value:value));setError('');}}/></label>)}
  <button disabled={disabled||!iterated&&JSON.stringify(draft)===JSON.stringify(texts(initial))} onClick={apply}>{t('应用初始相机')}</button>
  {error&&<p role="alert">{t(error)}</p>}
 </div></details>;
}
