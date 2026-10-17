import {useEffect,useState} from 'react';
import {useI18n} from '../i18n';
import {parseProjectResolution,sameProjectResolution,PROJECT_RESOLUTION_MIN,PROJECT_RESOLUTION_MAX,type ProjectResolution} from '../engine/projectResolution';

/** Editing stays local until Apply; there is no per-keystroke scene restart. */
export function ProjectResolutionControls({resolution,onChange}:{resolution?:ProjectResolution;onChange:(resolution?:ProjectResolution)=>void}){
 const {t}=useI18n();
 const [mode,setMode]=useState<'viewport'|'fixed'>(resolution?'fixed':'viewport');
 // This is an explicit local authoring choice, not a native missing-value default.
 const [width,setWidth]=useState(String(resolution?.width??1280));
 const [height,setHeight]=useState(String(resolution?.height??720));
 const [error,setError]=useState('');
 useEffect(()=>{
  setMode(resolution?'fixed':'viewport');setWidth(String(resolution?.width??1280));setHeight(String(resolution?.height??720));setError('');
 },[resolution?.width,resolution?.height]);
 let candidate:ProjectResolution|undefined,validationError='';
 if(mode==='fixed')try{candidate=parseProjectResolution({width:Number(width),height:Number(height)});}catch(cause){validationError=cause instanceof Error?cause.message:String(cause);}
 const unchanged=!validationError&&sameProjectResolution(resolution,candidate);
 function apply(){
  if(validationError){setError(validationError);return;}
  try{onChange(candidate);setError('');}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
 }
 return <details open className="inspector-section"><summary>{t('项目尺寸')}</summary><div className="section-body">
  <label className="field"><span>{t('尺寸模式')}</span><select aria-label={t('尺寸模式')} value={mode} onChange={event=>{setMode(event.target.value as 'viewport'|'fixed');setError('');}}>
   <option value="viewport">{t('跟随视口')}</option><option value="fixed">{t('固定项目尺寸')}</option>
  </select></label>
  {mode==='fixed'&&<>
   <label className="field"><span>{t('项目宽度')}</span><input aria-label={t('项目宽度')} type="number" min={PROJECT_RESOLUTION_MIN} max={PROJECT_RESOLUTION_MAX} step={1} value={width} onChange={event=>{setWidth(event.target.value);setError('');}}/></label>
   <label className="field"><span>{t('项目高度')}</span><input aria-label={t('项目高度')} type="number" min={PROJECT_RESOLUTION_MIN} max={PROJECT_RESOLUTION_MAX} step={1} value={height} onChange={event=>{setHeight(event.target.value);setError('');}}/></label>
   <p className="muted">{t('画布按项目比例居中适配窗口；预览质量仍决定采样像素。应用尺寸会从初始状态重新生成。')}</p>
  </>}
  <button disabled={unchanged||!!validationError} onClick={apply}>{t('应用项目尺寸')}</button>
  {(validationError||error)&&<p role="alert">{t(validationError||error)}</p>}
 </div></details>;
}
