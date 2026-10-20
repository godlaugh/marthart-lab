export const SOURCE_SAMILA_PARAMETER_MODEL='samila-param-1.7.8' as const;
export interface SourceSamilaParameterConfiguration {readonly name:string;readonly min:number;readonly max:number;readonly step:number;}
export interface SourceSamilaParameterAction {readonly model:typeof SOURCE_SAMILA_PARAMETER_MODEL;readonly kind:'start'|'stop';readonly parameters:readonly SourceSamilaParameterConfiguration[];}
export type SourceSamilaParameterResult={ok:true;value:SourceSamilaParameterAction}|{ok:false;error:{kind:'input'|'capacity';reason:string}};
/** Canonical owner for both imported and edited actions. Array order is the
 * source JSONObject member order; sorting numeric bounds does not reorder it. */
export function normalizeSourceSamilaParameterAction(raw:unknown):SourceSamilaParameterResult {
 const fail=(reason:string,kind:'input'|'capacity'='input'):SourceSamilaParameterResult=>({ok:false,error:{kind,reason}});
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return fail('源 Samila 参数动作需要对象');
 const value=raw as Record<string,unknown>;
 if(Object.keys(value).some(k=>!['model','kind','parameters'].includes(k))||value.model!==SOURCE_SAMILA_PARAMETER_MODEL||typeof value.kind!=='string'||!['start','stop'].includes(value.kind)||!Array.isArray(value.parameters))return fail('源 Samila 参数动作模型或字段无效');
 if(value.parameters.length>8192)return fail('源 Samila 参数动作超过 8192 项','capacity');
 let characters=0;const seen=new Set<string>(),parameters:SourceSamilaParameterConfiguration[]=[];
 for(const item of value.parameters){
  if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['name','min','max','step'].includes(k)))return fail('源 Samila 参数配置无效');
  const p=item as Record<string,unknown>;
  if(typeof p.name!=='string'||!(/^[A-Za-z][A-Za-z0-9_]*$/).test(p.name)||['constructor','prototype'].includes(p.name)||[p.min,p.max,p.step].some(n=>typeof n!=='number'||!Number.isFinite(n))||seen.has(p.name))return fail('源 Samila 参数名称或数值无效');
  characters+=p.name.length;if(characters>262144)return fail('源 Samila 参数名称总长度超过容量','capacity');seen.add(p.name);
  const lo=p.min as number,hi=p.max as number,min=Math.min(lo,hi),max=Math.max(lo,hi);
  if(!Number.isFinite(max-min)||!Number.isFinite(min+max))return fail('源 Samila 参数中值或幅度溢出本地有限数值范围');
  parameters.push({name:p.name,min,max,step:p.step as number});
 }
 return{ok:true,value:{model:SOURCE_SAMILA_PARAMETER_MODEL,kind:value.kind as 'start'|'stop',parameters}};
}
