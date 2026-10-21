import {parseDomainSourceDouble,prepareDomainSourceScalar} from './domainSourceScalar';
export type SourceMapScalarResult={ok:true;value:number}|{ok:false;reason:string};
/** ProjectState getFloat reads a Java double literal, then narrows to Float32; JsonMap's ConfigUtils
 * also evaluates expressions. The caller owns nonfinite handling and clamps. */
export function importSourceMapFloat(raw:unknown,fallback:number,entry:'project'|'runtime-config',numberToken?:string):SourceMapScalarResult {
 if(Object.is(raw,-0)&&numberToken==='-0')raw=0;
 let value=Math.fround(fallback);
 if(entry==='runtime-config'){const parsed=prepareDomainSourceScalar(raw,{fallback:raw==null?value:0,precision:'float32'});if(!parsed.ok)return{ok:false,reason:'源 Map 标量超过解析容量'};value=parsed.facts.value;}
 else if(typeof raw==='number')value=Math.fround(raw);
 else if(typeof raw==='string'){const parsed=parseDomainSourceDouble(raw);if(parsed.ok)value=Math.fround(parsed.value);else if(parsed.error.kind==='capacity')return{ok:false,reason:'源 Map 字面量超过解析容量'};}
 return{ok:true,value};
}
