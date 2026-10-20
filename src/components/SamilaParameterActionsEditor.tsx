import {useState} from 'react';
import {useI18n} from '../i18n';
import {SOURCE_SAMILA_PARAMETER_MODEL,normalizeSourceSamilaParameterAction,type SourceSamilaParameterAction} from '../engine/sourceSamilaParameter';

export function SamilaParameterActionsEditor({value,method,names,onChange}:{value?:SourceSamilaParameterAction;method:string;names:readonly string[];onChange:(value:SourceSamilaParameterAction)=>void}){
 const {t}=useI18n(),[error,setError]=useState(''),kind=method==='paramStart'?'start':'stop',parameters=value?.parameters??[];
 const commit=(next:SourceSamilaParameterAction['parameters'])=>{const parsed=normalizeSourceSamilaParameterAction({model:SOURCE_SAMILA_PARAMETER_MODEL,kind,parameters:next});if(!parsed.ok){setError(parsed.error.reason);return;}setError('');onChange(parsed.value);};
 if(kind==='stop')return <p className="muted">{t('片段结束时停止全部 Samila 参数漂移；过渡期间已有漂移继续。')}</p>;
 return <div style={{display:'grid',gap:8}}>
  {parameters.map((p,index)=><div key={p.name} style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
   <span>{p.name}</span>
   {(['min','max','step'] as const).map(key=><label key={key}>{t(key==='min'?'最小值':key==='max'?'最大值':'每帧步长（60 fps 参考）')}<input aria-label={`${p.name} ${key}`} type="number" step="any" value={p[key]} onChange={event=>{const text=event.target.value,n=Number(text);if(text!==''&&Number.isFinite(n))commit(parameters.map((item,i)=>i===index?{...item,[key]:n}:item));}}/></label>)}
   <button onClick={()=>commit(parameters.filter((_,i)=>i!==index))}>{t('删除')}</button>
  </div>)}
  <select aria-label={t('添加 Samila 动画参数')} value="" onChange={event=>{if(event.target.value)commit([...parameters,{name:event.target.value,min:-1,max:1,step:.001}]);}}><option value="">{t('添加 Samila 动画参数')}</option>{names.filter(name=>!parameters.some(p=>p.name===name)).map(name=><option key={name} value={name}>{name}</option>)}</select>
  <p className="muted">{t('初相位来自作品初始参数；片段完成后替换持续漂移列表。步长按每个参考帧计算，负值反向。')}</p>
  {error&&<p role="alert" className="error">{error}</p>}
 </div>;
}
