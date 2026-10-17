/** Retained LevelCurveParams.normalized float boundary, shared by initial color
 * preparation and the native animator's previous-value-preserving setter. */
export const DOMAIN_LEVEL_DEFAULTS={phaseDensity:12,modDensity:8,phaseSharpness:1,modSharpness:1} as const;
export type DomainLevelKey=keyof typeof DOMAIN_LEVEL_DEFAULTS;
export type DomainLevelMode='PHASE_MODULUS'|'PHASE'|'MODULUS'|'NONE';
export interface DomainLevelInput {curveMode?:unknown;phaseDensity?:unknown;modDensity?:unknown;phaseSharpness?:unknown;modSharpness?:unknown;bias?:unknown;mix?:unknown;}
export interface DomainLevelFacts {curveMode:DomainLevelMode;phaseDensity:number;modDensity:number;phaseSharpness:number;modSharpness:number;bias:number;mix:number;}
export function domainLevelValue(raw:unknown,key:DomainLevelKey):number {
 if(raw!==undefined&&typeof raw!=='number')throw new Error(`原版域着色 ${key} 必须是数值`);
 const value=Math.fround(raw===undefined?DOMAIN_LEVEL_DEFAULTS[key]:raw);
 return Number.isFinite(value)&&value>0?value:DOMAIN_LEVEL_DEFAULTS[key];
}
export function writeDomainLevelValue(value:number,previous:number,key:DomainLevelKey):number {
 const converted=Math.fround(value);
 return domainLevelValue(Number.isFinite(value)&&Number.isFinite(converted)?converted:previous,key);
}
function bounded(raw:unknown,fallback:number,min:number,max:number,name:string):number {
 if(raw!==undefined&&typeof raw!=='number')throw new Error(`原版域着色 ${name} 必须是数值`);
 const value=Math.fround(raw===undefined?fallback:raw);
 return Number.isFinite(value)?Math.max(min,Math.min(max,value)):Math.fround(fallback);
}
export function prepareDomainLevelCurve(input:DomainLevelInput):DomainLevelFacts {
 const mode=input.curveMode??'PHASE_MODULUS';
 if(mode!=='PHASE_MODULUS'&&mode!=='PHASE'&&mode!=='MODULUS'&&mode!=='NONE')throw new Error('原版域等值线模式无效');
 // Preserve the established authored-input rejection of null; native enum null
 // has already become the default in the source import boundary.
 if(input.curveMode===null)throw new Error('原版域等值线模式无效');
 return{curveMode:mode,phaseDensity:domainLevelValue(input.phaseDensity,'phaseDensity'),modDensity:domainLevelValue(input.modDensity,'modDensity'),phaseSharpness:domainLevelValue(input.phaseSharpness,'phaseSharpness'),modSharpness:domainLevelValue(input.modSharpness,'modSharpness'),bias:bounded(input.bias,.15,-1,1,'bias'),mix:bounded(input.mix,1,0,1,'mix')};
}
