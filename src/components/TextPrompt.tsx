import {useEffect,useId,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {useI18n} from '../i18n';

export interface TextPromptRequest {title:string;label:string;initial:string;maxLength?:number;validate:(value:string)=>string|undefined;submit:(value:string)=>void;}
/** Native HTML dialog provides focus containment/inert background in both the
 * desktop WebView and browsers; window.prompt is unsupported in those hosts. */
export function TextPrompt({request,onClose}:{request:TextPromptRequest;onClose:()=>void}){
  const {t}=useI18n(),id=useId(),dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null),[value,setValue]=useState(request.initial);
  const error=request.validate(value.trim());
  useEffect(()=>{const element=dialog.current!;element.showModal();input.current?.select();return()=>element.close();},[]);
  return <dialog className="modal text-prompt" ref={dialog} aria-labelledby={`${id}-title`} onCancel={event=>{event.preventDefault();onClose();}}>
    <div className="modal-heading"><h2 id={`${id}-title`}>{t(request.title)}</h2><button type="button" aria-label={t('取消')} onClick={onClose}><X size={18}/></button></div>
    <form onSubmit={event=>{event.preventDefault();if(!error){request.submit(value.trim());onClose();}}}>
      <label className="field"><span>{t(request.label)}</span><input ref={input} aria-label={t(request.label)} aria-invalid={!!error} aria-describedby={error?`${id}-error`:undefined} autoFocus value={value} maxLength={request.maxLength??300} onChange={event=>setValue(event.target.value)}/></label>
      {error&&<p role="status" className="equation-error" id={`${id}-error`}>{t(error)}</p>}
      <div className="modal-actions"><button type="button" onClick={onClose}>{t('取消')}</button><button className="primary-button" type="submit" disabled={!!error}>{t('确定')}</button></div>
    </form>
  </dialog>;
}
