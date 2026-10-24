import {usesSourceSymmetryConfiguration} from '../engine/sourceSymmetryConfig';
import {SourceParameterInput} from './SourceParameterInput';
import {usesSourceSymmetryMath} from '../engine/sourceSymmetryMath';
import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {useI18n} from '../i18n';
import type {SceneDocument} from '../types';
import {readParameterEditing,withParameterRange,withParameterValue,withoutEditableParameter,resetParameterRanges,type ParameterEditingSpec} from '../engine/parameterEditing';

const display=(spec:ParameterEditingSpec)=>spec.displayDecimals===undefined?String(spec.value):spec.value.toFixed(spec.displayDecimals);
function ParameterRow({scene,spec,onChange,metadataError}:{scene:SceneDocument;spec:ParameterEditingSpec;onChange:(next:SceneDocument,intent?:'value'|'structure'|'metadata',name?:string)=>void;metadataError:boolean}){
 const {t}=useI18n(),focused=useRef(false),[value,setValue]=useState(display(spec)),[valueError,setValueError]=useState(''),[rangeError,setRangeError]=useState('');
 const [draft,setDraft]=useState({min:String(spec.range?.min??-3),max:String(spec.range?.max??3),step:String(spec.range?.step??.001)});
 useEffect(()=>{if(!focused.current){setValue(display(spec));setValueError('');}},[spec.value,spec.displayDecimals]);
 useEffect(()=>{setDraft({min:String(spec.range?.min??-3),max:String(spec.range?.max??3),step:String(spec.range?.step??.001)});setRangeError('');},[spec.range?.min,spec.range?.max,spec.range?.step]);
 const commit=(raw:string)=>{if(!raw.trim()||!Number.isFinite(Number(raw))){setValueError(t('请输入有限数值；已保存的参数未改变。'));return;}try{const next=Number(raw);if(next!==spec.value)onChange(withParameterValue(scene,spec.name,next),'value',spec.name);setValueError('');}catch(e){setValueError(e instanceof Error?e.message:String(e));}};
 const fieldLabels={min:t('下限'),max:t('上限'),step:t('步长')};
 const outOfRange=spec.range&&(spec.value<spec.range.min||spec.value>spec.range.max);
 const changed=spec.range&&(['min','max','step']as const).some(key=>draft[key]!==String(spec.range![key]));
 function applyRange(){try{
  const number=(text:string)=>{if(!text.trim()||!Number.isFinite(Number(text)))throw new Error('范围输入必须是有限数值');return Number(text);};
  onChange(withParameterRange(scene,spec.name,{min:number(draft.min),max:number(draft.max),step:number(draft.step)}),'metadata');setRangeError('');
 }catch(e){setRangeError(e instanceof Error?e.message:String(e));}}
 return <div style={{display:'grid',gap:5,paddingBottom:8}}>
  <div className="parameter-row"><label htmlFor={`param-${spec.name}`} className="parameter-symbol">{spec.name}</label>
   {(usesSourceSymmetryConfiguration(scene)||scene.samilaSourcePalette!==undefined)?<SourceParameterInput name={spec.name} value={spec.value} step={spec.range?.step??.001} displayDecimals={spec.displayDecimals} onCommit={value=>onChange(withParameterValue(scene,spec.name,value),'value',spec.name)}/>:<input id={`param-${spec.name}`} aria-label={t('参数 {value0}',{value0:spec.name})} type="number" step={spec.range?.step??'any'} value={value} aria-invalid={!!valueError} title={String(spec.value)} onFocus={()=>{focused.current=true;setValue(String(spec.value));}} onChange={e=>{setValue(e.target.value);commit(e.target.value);}} onBlur={()=>{focused.current=false;if(!valueError)setValue(display(spec));}} onKeyDown={e=>{if(e.key==='Escape'){setValue(display(spec));setValueError('');e.currentTarget.blur();}}}/>
   }{spec.canDelete&&<button title={t('删除参数 {value0}',{value0:spec.name})} disabled={metadataError} onClick={()=>{try{onChange(withoutEditableParameter(scene,spec.name),'structure');}catch(e){setValueError(e instanceof Error?e.message:String(e));}}}><X size={12}/></button>}
  </div>
  {spec.customBinding&&<small className="muted">{t(spec.customBinding==='matched'?'匹配源码中的 float uniform；是否影响结果取决于公式。':spec.customBinding==='unmatched'?'保留参数；未匹配源码中的 float uniform。':'保留参数；源码尚无法准备，绑定状态未知。')}</small>}
  {spec.range&&<><input type="range" style={{width:'100%'}} aria-label={t('参数 {value0} 滑块',{value0:spec.name})} min={spec.range.min} max={spec.range.max} step={spec.range.step} value={Math.min(spec.range.max,Math.max(spec.range.min,spec.value))} aria-valuetext={String(spec.value)} onChange={e=>{const next=Number(e.target.value);onChange(withParameterValue(scene,spec.name,next),'value',spec.name);setValue(spec.displayDecimals===undefined?String(next):next.toFixed(spec.displayDecimals));setValueError('');}}/>
   <small className="muted">{t('滑块范围 {min} 至 {max}，步长 {step}',{min:spec.range.min,max:spec.range.max,step:spec.range.step})}</small></>}
  {outOfRange&&<small role="status" className="muted">{t('当前值 {value} 超出滑块范围；数值与动画保持不变。',{value:spec.value})}</small>}
  {valueError&&<small role="alert" className="export-error">{t(valueError)}</small>}
  {spec.editableRange&&<details><summary>{t('编辑参数范围')}</summary><div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:5}}>
   {(['min','max','step']as const).map(key=><label key={key} style={{display:'grid',gap:3,minWidth:0}}><span>{fieldLabels[key]}</span><input style={{width:'100%',minWidth:0}} aria-label={t('参数 {name} {field}',{name:spec.name,field:fieldLabels[key]})} type="number" step="any" value={draft[key]} onChange={e=>{setDraft({...draft,[key]:e.target.value});setRangeError('');}}/></label>)}
  </div><button disabled={!changed} onClick={applyRange}>{t('应用参数范围')}</button><small className="muted">{t('范围用于滑块和随机参数；不会限制直接输入，也不会改写已有动画。')}</small>{rangeError&&<p role="alert" className="export-error">{t(rangeError)}</p>}</details>}
 </div>;
}
/** Only replaces the two requested families. Roots and all other parameter UIs
 * retain their own contracts; this component does not render them. */
export function ParameterEditor({scene,onChange}:{scene:SceneDocument;onChange:(next:SceneDocument,intent?:'value'|'structure'|'metadata',name?:string)=>void}){
 const {t}=useI18n();if(scene.kind!=='samila'&&scene.kind!=='symmetry')return null;
 const state=readParameterEditing(scene);
 return <div className="parameter-editor">{state.error&&<div role="alert" className="export-error"><p>{t(state.error)}</p><p>{t('编辑范围数据无效；公式计算和参数值保持原样。可重置范围后继续编辑。')}</p>{scene.kind==='samila'&&<button onClick={()=>onChange(resetParameterRanges(scene),'metadata')}>{t('重置编辑范围')}</button>}</div>}
  {state.specs.map(spec=><ParameterRow key={`${scene.id}:${spec.name}`} scene={scene} spec={spec} onChange={onChange} metadataError={!!state.error}/>)}
  {usesSourceSymmetryMath(scene)&&<details className="muted"><summary>{t('对称参数如何影响图案')}</summary>
   <p>{t('阶数 n 决定公式的 n 重旋转关系；有限采样不保证画面完整对称。')}</p>
   <p>{t('omega = 0 时公式同时具有镜像关系；非零 omega 保留 n 重旋转关系，并打破原有镜像关系。')}</p>
   <p>{t('gamma 调整复共轭项的强度，并非固定角度的旋转。要旋转画面，请使用相机角度。')}</p>
  </details>}
 </div>;
}
