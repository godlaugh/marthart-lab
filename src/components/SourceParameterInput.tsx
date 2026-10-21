import {useEffect,useRef,useState} from 'react';
import {useI18n} from '../i18n';
/** Original parameter steppers commit typed text on blur/Enter. A deliberate
 * same-value commit remains an event: animation may have changed the runtime. */
export function SourceParameterInput({name,value,step,displayDecimals,onCommit}:{name:string;value:number;step:number;displayDecimals?:number;onCommit:(value:number)=>void}){
 const {t}=useI18n(),focused=useRef(false),edited=useRef(false),format=(v:number)=>displayDecimals===undefined?String(v):v.toFixed(displayDecimals);
 const [text,setText]=useState(format(value)),[invalid,setInvalid]=useState(false);
 useEffect(()=>{if(!focused.current){setText(format(value));setInvalid(false);}},[value,displayDecimals]);
 const commit=()=>{if(!edited.current)return;const n=Number(text);if(!text.trim()||!Number.isFinite(n)){setInvalid(true);return;}edited.current=false;onCommit(n);setInvalid(false);setText(format(n));};
 return <input id={`param-${name}`} aria-label={t('参数 {value0}',{value0:name})} type="number" step={step} value={text} aria-invalid={invalid} title={invalid?t('请输入有限数值；已保存的参数未改变。'):String(value)} onFocus={()=>{focused.current=true;setText(String(value));}} onInput={()=>{edited.current=true;}} onChange={e=>{setText(e.target.value);edited.current=true;}} onBlur={()=>{focused.current=false;commit();}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}else if(e.key==='Escape'){edited.current=false;setText(format(value));setInvalid(false);e.currentTarget.blur();}else if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();const base=Number(text),next=(Number.isFinite(base)?base:value)+(e.key==='ArrowUp'?step:-step);if(Number.isFinite(next)){edited.current=false;setText(String(next));setInvalid(false);onCommit(next);}}}}/>;
}
