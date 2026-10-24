import {useEffect,useRef,useState} from 'react';
import {useI18n} from '../i18n';
import {formatSourceNumber,parseSourceNumberInput,type SourceNumberRules} from './sourceBouncingNumbers';

/** The visible draft and the precise canonical value have different owners.
 * Merely focusing a rounded display must never rewrite the stored Float32. */
export function SourceBouncingNumberField({id,label,value,rules,onCommit}:{id:string;label:string;value:number;rules:SourceNumberRules;onCommit:(value:number)=>string|undefined}){
 const {t}=useI18n(),[draft,setDraft]=useState(()=>formatSourceNumber(value,rules.precision,rules.integer)),[error,setError]=useState('');
 const dirty=useRef(false),input=useRef<HTMLInputElement>(null);
 useEffect(()=>{setDraft(formatSourceNumber(value,rules.precision,rules.integer));dirty.current=false;setError('');},[value,rules.precision,rules.integer]);
 function reset(message=''){setDraft(formatSourceNumber(value,rules.precision,rules.integer));dirty.current=false;setError(message);}
 function accept(parsed:number|undefined){
  if(parsed===undefined){reset(t('请输入有限数值'));return;}
  const number=rules.integer?parsed:Math.fround(parsed),failure=onCommit(number);
  if(failure){reset(failure);return;}
  dirty.current=false;setDraft(formatSourceNumber(number,rules.precision,rules.integer));setError('');
 }
 function step(direction:1|-1){
  const current=dirty.current?parseSourceNumberInput(input.current?.value??draft,rules):value;
  if(current===undefined){reset(t('请输入有限数值'));return;}
  const amount=typeof rules.step==='function'?rules.step(current):rules.step;
  accept(parseSourceNumberInput(String(current+direction*amount),rules));
 }
 return <label className="field"><span>{label}</span><span className="source-number-input">
  <input ref={input} data-testid={`source-bouncing-${id}`} aria-label={label} aria-invalid={false} aria-describedby={error?`source-bouncing-${id}-error`:undefined} type="text" inputMode="decimal" value={draft}
   onChange={event=>{dirty.current=true;setDraft(event.currentTarget.value);setError('');}}
   onBlur={event=>{if(dirty.current)accept(parseSourceNumberInput(event.currentTarget.value,rules));}}
   onKeyDown={event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();step(event.key==='ArrowUp'?1:-1);}else if(event.key==='Enter'){event.preventDefault();if(dirty.current)accept(parseSourceNumberInput(event.currentTarget.value,rules));event.currentTarget.blur();}else if(event.key==='Escape'){event.preventDefault();reset();}}}/>
  <button type="button" aria-label={t('减少 {name}',{name:label})} onPointerDown={e=>e.preventDefault()} onClick={()=>step(-1)}>−</button>
  <button type="button" aria-label={t('增加 {name}',{name:label})} onPointerDown={e=>e.preventDefault()} onClick={()=>step(1)}>+</button>
 </span>{error&&<span id={`source-bouncing-${id}-error`} role="alert">{error}</span>}</label>;
}
