import {useState} from 'react';
type Commit=(text:string)=>string|undefined;

/** Only a valid committed value enters the document. The parent keys this field
 * by its own canonical value, so unrelated edits preserve an invalid draft. */
export function SourcePerlinDraftField({id,label,value,commit,multiline=false,numeric=false,prefix='source-perlin-gpu'}:{id:string;label:string;value:string;commit:Commit;multiline?:boolean;numeric?:boolean;prefix?:string}){
 const [draft,setDraft]=useState(value),[error,setError]=useState('');
 const props={
  'data-testid':`${prefix}-${id}`,'aria-label':label,'aria-invalid':!!error,
  'aria-describedby':error?`${prefix}-${id}-error`:undefined,
  value:draft,
  onChange:(event:{currentTarget:{value:string}})=>{setDraft(event.currentTarget.value);setError('');},
  onBlur:()=>setError(commit(draft)??''),
  onKeyDown:(event:{key:string;ctrlKey:boolean;metaKey:boolean;preventDefault:()=>void;currentTarget:{blur:()=>void}})=>{
   if(event.key==='Enter'&&(!multiline||event.ctrlKey||event.metaKey)){event.preventDefault();event.currentTarget.blur();}
  },
 };
 return <label className="field"><span>{label}</span>
  {multiline?<textarea {...props} rows={6} spellCheck={false}/>:<input {...props} type="text" inputMode={numeric?'decimal':undefined} spellCheck={false}/>}
  {error&&<span id={`${prefix}-${id}-error`} role="alert">{error}</span>}
 </label>;
}
