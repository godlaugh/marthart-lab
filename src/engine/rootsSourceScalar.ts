import {prepareDomainSourceScalar} from './domainSourceScalar';

const F=Math.fround;

/** ConfigUtils.parseValue: missing/null use the supplied config default; a
 * present value tries JSONObject.getDouble then the existing FastExpression
 * parser. Invalid expressions recover to zero, not the missing-field default.
 * Capacity is an explicit local error. Import preserves the original in provenance. */
export function parseRootsSourceScalar(raw:unknown,fallback:number):{value:number;diagnostics:string[]} {
 if(!Number.isFinite(fallback))throw new Error('复根源数值缺省值必须有限');
 if(raw===undefined||raw===null)return{value:F(fallback),diagnostics:[]};
 if(typeof raw!=='number'&&typeof raw!=='string')return{value:0,diagnostics:['原版复根数值表达式无法解析，采用 0；原值已保留。']};
 const result=prepareDomainSourceScalar(raw,{fallback:0,precision:'float32'});
 if(!result.ok)throw new Error(`复根源数值表达式超过本地 ${result.error.resource} 预算 ${result.error.limit}`);
 return{value:result.facts.value,diagnostics:result.facts.route==='fallback'?['原版复根数值表达式无法解析，采用 0；原值已保留。']:[]};
}
