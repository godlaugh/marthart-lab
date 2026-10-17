import {useI18n} from '../i18n';
import {useEffect,useState} from 'react';
export function SceneName({name,onChange,onError}:{name:string;onChange:(name:string)=>void;onError:(message:string)=>void}){
  const {t}=useI18n();
  const [draft,setDraft]=useState(name);
  useEffect(()=>setDraft(name),[name]);
  function commit(){const value=draft.trim();if(!value){setDraft(name);onError('场景名称不能为空');return;}if(value!==name)onChange(value);}
  return <input className="scene-name" aria-label={t("场景名称")} maxLength={300} value={draft} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape'){setDraft(name);e.stopPropagation();}}}/>;
}
