import {parseDomainSourceFloat,prepareDomainSourceScalar} from './domainSourceScalar';
export type SourceMapScalarResult={ok:true;value:number}|{ok:false;reason:string};
/** ProjectState uses getFloat's Java literal conversion; JsonMap's ConfigUtils
 * also evaluates expressions. The caller owns nonfinite handling and clamps. */
export function importSourceMapFloat(raw:unknown,fallback:number,entry:'project'|'runtime-config'):SourceMapScalarResult {
 let value=Math.fround(fallback);
 if(entry==='runtime-config'){const parsed=prepareDomainSourceScalar(raw,{fallback:value,precision:'float32'});if(!parsed.ok)return{ok:false,reason:'源 Map 标量超过解析容量'};value=parsed.facts.value;}
 else if(typeof raw==='number')value=Math.fround(raw);
 else if(typeof raw==='string'){const parsed=parseDomainSourceFloat(raw);if(parsed.ok)value=parsed.value;else if(parsed.error.kind==='capacity')return{ok:false,reason:'源 Map 字面量超过解析容量'};}
 return{ok:true,value};
}
