import type {Complex} from './complexMath';

export interface DomainNativeConstantBaseInput {
 /** Explicit local scalar controls, including values captured at native import.
  * Missing axes use the initial source parameter map, then the source defaults. */
 readonly authored?:readonly [unknown,unknown];
 readonly parameters?:Readonly<Record<string,number>>;
}
export interface DomainNativeConstantInput extends DomainNativeConstantBaseInput {readonly formula:string;}
export interface PreparedDomainNativeConstantBase {
 readonly rawBase:readonly [number|undefined,number|undefined];
 readonly baseConstant:Readonly<Complex>;
 readonly baseOrigins:readonly ['authored'|'parameter'|'default','authored'|'parameter'|'default'];
 readonly diagnostics:readonly string[];
}
export interface PreparedDomainNativeConstant extends PreparedDomainNativeConstantBase {
 readonly rawFormula:string;
 readonly effectiveConstant:Readonly<Complex>;
 readonly sourceOverride:'none'|'power-literal'|'fallback-literal';
}
/** readConstantFromParams/toFiniteFloat: a hot apply captures the current map
 * again, without authored scalars. This is the base pair, before text override. */
export function prepareDomainNativeConstantBase(input:DomainNativeConstantBaseInput):PreparedDomainNativeConstantBase {
 const defaults=[1,0] as const,keys=['a','b'] as const,diagnostics:string[]=[];
 const origins:('authored'|'parameter'|'default')[]=[],raw:(number|undefined)[]=[],base:number[]=[];
 for(let i=0;i<2;i++){
  const authored=input.authored?.[i],hasParameter=input.parameters!==undefined&&Object.hasOwn(input.parameters,keys[i]);
  const value=authored!==undefined?authored:hasParameter?input.parameters![keys[i]]:undefined;
  if(value!==undefined&&typeof value!=='number')throw new Error('原产物常量必须为数值');
  origins.push(authored!==undefined?'authored':hasParameter?'parameter':'default');raw.push(value);
  const f=value===undefined?defaults[i]:Math.fround(value);
  if(value!==undefined&&(!Number.isFinite(value)||!Number.isFinite(f))){base.push(defaults[i]);diagnostics.push(`原产物常量 ${keys[i]} 不能表示为有限 float32，使用默认值 ${defaults[i]}；原值保留。`);}else base.push(f);
 }
 return Object.freeze({rawBase:Object.freeze(raw as [number|undefined,number|undefined]),baseConstant:Object.freeze(base as Complex),baseOrigins:Object.freeze([origins[0],origins[1]] as const),diagnostics:Object.freeze(diagnostics)});
}
/** Source applyConfig captures a/b once, then applies detectFormulaMode's raw
 * text override. Parameter animation does not update the captured scalar pair.
 * Importers persist baseConstant; models pass that authored pair thereafter.
 * This owner never modifies the document or uses the recovered AST formula. */
export function prepareDomainNativeConstant(input:DomainNativeConstantInput):PreparedDomainNativeConstant {
 const captured=prepareDomainNativeConstantBase(input),base=captured.baseConstant,diagnostics=[...captured.diagnostics];
 const text=input.formula.toLowerCase().replaceAll(' ',''),preserve=new Set(['z','z^2','z*z','1/z','exp(z)','sin(z)']);
 let override:PreparedDomainNativeConstant['sourceOverride']='none',literal:number|undefined;
 if(!preserve.has(text)){
  const match=/^z\^([0-9]+)([+-][0-9]+(?:\.[0-9]+)?)?$/.exec(text),power=match?.[0]===text?match:null;
  override=power?'power-literal':'fallback-literal';
  literal=power?(power[2]===undefined?0:-Math.fround(Number(power[2]))):1;
 }
 const effective:Complex=literal===undefined?[base[0],base[1]]:[literal,0];
 if(literal!==undefined&&(!Object.is(effective[0],base[0])||!Object.is(effective[1],base[1])))diagnostics.push('原产物主公式文字规则覆盖常量 c；已保留显式常量，仅使用公式推导值。');
 if(literal!==undefined&&!Number.isFinite(literal))diagnostics.push('原产物公式推导常量超出有限 float32；保留其非有限计算结果。');
 return Object.freeze({...captured,rawFormula:input.formula,effectiveConstant:Object.freeze(effective),sourceOverride:override,diagnostics:Object.freeze(diagnostics)});
}
