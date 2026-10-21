import {useId,useMemo,useRef,useState} from 'react';
import {Check} from 'lucide-react';
import type {SceneDefinition,SceneDocument} from '../types';
import {analyzeEquationDraft,equationCompletion,equationTokens,insertEquationCompletion,type EquationAnalysis,type EquationSuggestion} from '../engine/equationEditor';
import {useI18n} from '../i18n';
import {sourceLivePreviewKind} from '../engine/sourceLivePreview';
import {editableEquations} from '../engine/mapDimension';

function EquationField({label,value,analysis,onChange,onApply,onBlur}:{label:string;value:string;analysis:EquationAnalysis;onChange:(value:string)=>void;onApply:()=>void;onBlur?:()=>void}){
  const {t}=useI18n(),id=useId(),textarea=useRef<HTMLTextAreaElement>(null),paint=useRef<HTMLPreElement>(null);
  const [caret,setCaret]=useState(0),[open,setOpen]=useState(false),[all,setAll]=useState(false),[selected,setSelected]=useState(0);
  const range=equationCompletion(value,caret,analysis.suggestions,all,analysis.native||analysis.sourceReal),items=open?range.items:[];
  const active=Math.min(selected,Math.max(0,items.length-1));
  const tokens=useMemo(()=>equationTokens(value,analysis.suggestions,analysis.native),[value,analysis.suggestions,analysis.native]);
  const complete=(item:EquationSuggestion)=>{
    const next=insertEquationCompletion(value,range,item,analysis.native||analysis.sourceReal);onChange(next.source);setOpen(false);setAll(false);setCaret(next.caret);
    requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(next.caret,next.caret);});
  };
  return <div className="equation-field">
    <label htmlFor={id}>{label}</label>
    <div className={`equation-input ${analysis.error?'is-invalid':''}`}>
      <pre aria-hidden="true" ref={paint}>{tokens.map((token,index)=><span key={index} className={`syntax-${token.kind}`}>{token.text}</span>)}{'\n'}</pre>
      <textarea id={id} ref={textarea} aria-label={label} spellCheck={false} autoComplete="off" autoCapitalize="off" value={value} rows={Math.min(6,Math.max(2,value.split('\n').length))} maxLength={8192}
        aria-invalid={!!analysis.error} aria-describedby={[...(analysis.error?[`${id}-error`]:[]),...(analysis.warnings?.length||analysis.effectiveSource!==undefined?[`${id}-warning`]:[])].join(' ')||undefined} aria-controls={items.length?`${id}-suggestions`:undefined} aria-expanded={!!items.length} aria-autocomplete="list" aria-activedescendant={items.length?`${id}-suggestion-${active}`:undefined}
        onChange={e=>{onChange(e.target.value);setCaret(e.target.selectionStart);setSelected(0);setOpen(true);setAll(false);}}
        onSelect={e=>setCaret(e.currentTarget.selectionStart)} onBlur={()=>{setOpen(false);onBlur?.();}}
        onScroll={e=>{if(paint.current){paint.current.scrollTop=e.currentTarget.scrollTop;paint.current.scrollLeft=e.currentTarget.scrollLeft;}}}
        onKeyDown={e=>{
          if(e.nativeEvent.isComposing)return;
          if(e.ctrlKey&&e.code==='Space'){e.preventDefault();setCaret(e.currentTarget.selectionStart);setSelected(0);setAll(true);setOpen(true);return;}
          if(items.length&&(e.key==='ArrowDown'||e.key==='ArrowUp')){e.preventDefault();setSelected((active+(e.key==='ArrowDown'?1:-1)+items.length)%items.length);return;}
          if(items.length&&(e.key==='Tab'||e.key==='Enter')&&!e.shiftKey&&!e.metaKey&&!e.ctrlKey){e.preventDefault();complete(items[active]);return;}
          if(e.key==='Escape'){setOpen(false);return;}
          if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();setOpen(false);onApply();}
        }}/>
      {!!items.length&&<div className="equation-suggestions" id={`${id}-suggestions`} role="listbox" aria-label={t('公式补全')}>
        {items.map((item,index)=><div role="option" id={`${id}-suggestion-${index}`} aria-selected={index===active} key={`${item.kind}:${item.name}`} onMouseDown={e=>{e.preventDefault();complete(item);}}><code className={`syntax-${item.kind}`}>{item.name}{item.kind==='function'?'(…)':''}</code><small>{t(item.kind==='function'?'函数':item.kind==='variable'?'变量':'常量')}</small></div>)}
      </div>}
    </div>
    {analysis.error&&<p className="equation-error" id={`${id}-error`} role="status">{t(analysis.error.message)}{analysis.error.offset!==undefined&&<button type="button" onClick={()=>{textarea.current?.focus();textarea.current?.setSelectionRange(analysis.error!.offset!,analysis.error!.offset!+1);}}>{t('定位第 {column} 字符',{column:analysis.error.offset+1})}</button>}</p>}
    {!!(analysis.warnings?.length||analysis.effectiveSource!==undefined)&&<div className="formula-help" id={`${id}-warning`} role="status">
      {analysis.warnings?.map((warning,index)=><p key={index}>{t(warning)}</p>)}
      {analysis.effectiveSource!==undefined&&<p>{t('实际求值公式：')} <code>{analysis.effectiveSource}</code></p>}
      <p>{t('可应用并保留原文；求值按上述原产物恢复规则执行。')}</p>
    </div>}
  </div>;
}

export function EquationEditor({scene,equations,draft,onChange,onApply,applyOnBlur=false}:{scene:SceneDocument;equations:SceneDefinition['equations'];draft:Record<string,string>;onChange:(draft:Record<string,string>)=>void;onApply:()=>void;applyOnBlur?:boolean}){
  const {t}=useI18n();
  const fields=useMemo(()=>{
    const editable=editableEquations(scene,equations),values=Object.fromEntries(editable.map(eq=>[eq.key,draft[eq.key]??scene.equations[eq.key]??''])),analyses=analyzeEquationDraft(scene,values);
    return editable.map(eq=>({key:eq.key,label:analyses[eq.key].sourceReal?(eq.key==='f1'?'f₁(x, y)':'f₂(x, y)'):eq.label,value:values[eq.key],analysis:analyses[eq.key]}));
  },[equations,draft,scene]);
  const invalid=fields.some(field=>field.analysis.error);
  const dirty=fields.some(field=>field.value!==scene.equations[field.key]);
  const apply=()=>{if(!invalid&&(dirty||sourceLivePreviewKind(scene)==='map'))onApply();};
  return <><div className="equation-editors">{fields.map(field=><EquationField key={field.key} label={t(field.label)} value={field.value} analysis={field.analysis} onChange={value=>onChange({...draft,[field.key]:value})} onApply={apply} onBlur={applyOnBlur?apply:undefined}/>)}</div>
    {fields.some(field=>field.analysis.native)&&<div className="formula-help">{t('原产物语法：函数名须紧邻左括号；未绑定变量按 0 求值。π 为普通变量，科学计数写法不作为数值解析。')}</div>}
    {fields.some(field=>field.analysis.sourceReal)&&<div className="formula-help">{t('源 Samila 实数语法：函数名紧邻左括号；x、y 为采样坐标，a–d 缺省为 0。其他变量必须显式声明为参数；不注入时间。')}</div>}
    <div className="formula-help">{t(applyOnBlur?'失焦或 Enter 应用有效公式 · Shift+Enter 换行 · Ctrl+空格补全':'Enter 应用 · Shift+Enter 换行 · Ctrl+空格补全')}</div>
    <button className="apply-button" disabled={invalid} onClick={apply}><Check size={14}/>{t('应用公式')}</button>
  </>;
}
