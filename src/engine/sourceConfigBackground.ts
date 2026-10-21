import {prepareRootsSourceJsonString} from './rootsSourceOrder';
import {SOURCE_COLOR_TEXT_BUDGET,SourceConfigColorError,sourceConfigPackedColor} from './sourceConfigColor';
export class SourceConfigBackgroundError extends Error {constructor(readonly code:'input'|'capacity',message:string){super(message);this.name='SourceConfigBackgroundError';}}
/** getString(default) -> ConfigUtils.parseColor, with number-token identity.
 * Malformed color text recovers white in the source; capacity never does. */
export function importSourceConfigBackground(raw:unknown,numberToken?:string):{color:number;diagnostics:string[]}{
 let text='#000000';const diagnostics:string[]=[];
 if(typeof raw==='number'){
  const result=prepareRootsSourceJsonString(raw,text,numberToken);
  if(!result.ok)throw new SourceConfigBackgroundError(result.error.kind==='capacity'?'capacity':'input',JSON.stringify(result.error));
  if(result.value.status==='unknown'){
   if(result.value.reason!=='java-double-format')throw new SourceConfigBackgroundError('input',`源背景数字文本不明确：${result.value.reason}`);
   text='NaN'; // Any Java double spelling is not an Integer.parseInt color.
  }else text=result.value.value;
 }else if(raw!=null)text=typeof raw==='string'?raw:typeof raw==='boolean'?String(raw):Array.isArray(raw)?'[]':'{}';
 if(text.length>SOURCE_COLOR_TEXT_BUDGET)throw new SourceConfigBackgroundError('capacity','源背景文本超过本地 1 MiB 容量');
 try{return{color:sourceConfigPackedColor(text),diagnostics};}catch(error){if(!(error instanceof SourceConfigColorError))throw error;diagnostics.push('settings.background_color: 源颜色解析失败，采用白色；原值保留在 source。');return{color:0xffffffff,diagnostics};}
}
