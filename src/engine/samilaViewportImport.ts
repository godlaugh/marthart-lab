import {parseDomainSourceDouble} from './domainSourceScalar';

export const SAMILA_VIEWPORT_SOURCE_FIELDS=['scale_x','scale_y','offset_x','offset_y','rotation'] as const;
export type SamilaViewportSourceField=typeof SAMILA_VIEWPORT_SOURCE_FIELDS[number];
type Result={ok:true;value:number;defaulted:boolean}|{ok:false;reason:string};
/** JsonSamilaConfig uses JSONObject.getFloat(key, fallback), not ConfigUtils
 * expressions. Omitted scale retains BaseSamilaConfig's .33f; a present but
 * invalid scale uses the getter's 1f. Number/string → double → float. */
export function importSamilaViewportScalar(field:SamilaViewportSourceField,raw:unknown,present:boolean):Result{
 const scale=field==='scale_x'||field==='scale_y',fallback=scale?1:0;
 if(!present)return{ok:true,value:Math.fround(scale ? .33 : 0),defaulted:false};
 let value:number|undefined;
 if(typeof raw==='number')value=raw;
 else if(typeof raw==='string'){
  const parsed=parseDomainSourceDouble(raw);
  if(parsed.ok)value=parsed.value;
  else if(parsed.error.kind==='capacity')return{ok:false,reason:`数值文本超过 ${parsed.error.limit} 字符预算`};
 }
 if(value===undefined)return{ok:true,value:fallback,defaulted:true};
 value=Math.fround(value);
 if(!Number.isFinite(value))return{ok:false,reason:'源 getFloat 得到非有限数值，本地持久化与渲染要求有限 float32'};
 return{ok:true,value,defaulted:false};
}
