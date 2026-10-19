import {useState} from 'react';
import {useI18n} from '../i18n';
import {parseSourcePerlinParameterAction,SOURCE_PERLIN_PARAMETER_NAMES,SOURCE_PERLIN_PARAMETER_DEFAULTS,type SourcePerlinParameterAction,type SourcePerlinParameterConfiguration,type SourcePerlinParameterName} from '../engine/sourcePerlinParameterConfig';

const labels:Record<SourcePerlinParameterName,string>={noise_offset:'噪声偏移',noise_scale:'噪声尺度',curve_noise_scale:'曲线噪声尺度',curve_angle_scale:'曲线角度尺度'};
function ParameterNumber({label,value,commit}:{label:string;value:number;commit:(value:number)=>string|undefined}){
 const {t}=useI18n(),[draft,setDraft]=useState(Object.is(value,-0)?'-0':String(value)),[error,setError]=useState('');
 const apply=()=>{if(!draft.trim()){setError(t('请输入数值'));return;}const n=Number(draft);if(!Number.isFinite(n)){setError(t('请输入有限数值'));return;}setError(commit(n)??'');};
 return <label>{label}<input aria-label={label} type="text" inputMode="decimal" value={draft} aria-invalid={!!error} style={{width:105}}
  onChange={event=>{setDraft(event.target.value);setError('');}} onBlur={apply} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}}}/>{error&&<span role="alert">{error}</span>}</label>;
}
/** The canonical parser owns ordering/bounds; rejected edits stay as drafts. */
export function PerlinParameterActionsEditor({value,method,onChange}:{value?:SourcePerlinParameterAction;method:'paramStart'|'paramStop';onChange:(value:SourcePerlinParameterAction)=>void}){
 const {t}=useI18n(),[error,setError]=useState(''),kind=method==='paramStart'?'start':'stop';
 const parsed=value===undefined?undefined:parseSourcePerlinParameterAction(value);
 if(!parsed?.ok||parsed.value.kind!==kind)return <div data-testid="perlin-parameters-unconfigured"><p>{t('保留的参数动作尚无有效源配置。')}</p>
  {parsed&&!parsed.ok&&<p role="alert">{t(parsed.error.reason)}</p>}
  <button onClick={()=>onChange({kind,parameters:[]})}>{t('设置 Perlin 参数配置')}</button>
 </div>;
 const action=parsed.value;
 const emit=(parameters:readonly SourcePerlinParameterConfiguration[]):string|undefined=>{
  const checked=parseSourcePerlinParameterAction({kind,parameters});
  if(!checked.ok)return t(checked.error.reason);
  onChange(checked.value);setError('');return undefined;
 };
 const patch=(name:SourcePerlinParameterName,key:'min'|'max'|'step',n:number)=>emit(action.parameters.map(item=>item.name===name?{...item,[key]:n}:item));
 return <div data-testid="perlin-parameter-actions" style={{display:'grid',gap:8}}>
  <p className="muted">{t(kind==='start'?'选择要动画的参数。步长符号决定起始方向，片段缓动控制速度；未选择参数时不改变当前动画。':'选择要停止的参数；全部取消选择时停止所有参数动画。')}</p>
  {SOURCE_PERLIN_PARAMETER_NAMES.map(name=>{
   const config=action.parameters.find(item=>item.name===name),label=t(labels[name]);
   return <fieldset key={name} style={{display:'flex',gap:8,flexWrap:'wrap'}}><legend><label>
    <input type="checkbox" aria-label={t('Perlin 参数 {name}',{name:label})} checked={!!config} onChange={event=>{
     const enabled=event.target.checked,[step,min,max]=SOURCE_PERLIN_PARAMETER_DEFAULTS[name];
     const parameters=SOURCE_PERLIN_PARAMETER_NAMES.flatMap(key=>{const current=action.parameters.find(item=>item.name===key);return key===name?(enabled?[current??{name,step,min,max}]:[]):current?[current]:[];});
     setError(emit(parameters)??'');
    }}/>{label}</label></legend>
    {config&&kind==='start'&&(['min','max','step'] as const).map(key=><ParameterNumber key={`${key}:${config[key]}`} label={t('{name} · {field}',{name:label,field:t(key==='min'?'最小值':key==='max'?'最大值':'每帧步长（60 fps 参考）')})} value={config[key]} commit={n=>patch(name,key,n)}/>)}
   </fieldset>;
  })}
  {kind==='start'&&<p className="muted">{t('噪声偏移范围为 −1 至 1；噪声尺度、曲线噪声尺度、曲线角度尺度的下限分别为 0.0001、0.01、0.1。最大值不得小于最小值。')}</p>}
  <p className="muted">{t('GPU 纹理不使用这些 CPU 参数，保留动作可维持导入作品的队列时序。')}</p>
  {error&&<p role="alert">{error}</p>}
 </div>;
}
