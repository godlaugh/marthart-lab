import {prepareDomainSourceScalar} from '../engine/domainSourceScalar';
export interface SourceNumberRules {integer?:boolean;min?:number;max?:number;precision:number;step:number|((value:number)=>number);}
export const SOURCE_FLOAT_MAX=3.4028234663852886e38;
const sourceInteger=(value:number)=>Math.max(-2147483648,Math.min(2147483647,Math.trunc(value)));
/** NumberDragger's Double parse/evaluation precedes integer conversion and UI
 * bounds. The Float callback conversion is separate from display rounding. */
export function parseSourceNumberInput(raw:string,rules:SourceNumberRules):number|undefined {
 const text=raw.trim();if(!text)return undefined;
 const parsed=prepareDomainSourceScalar(text,{fallback:0,precision:'float64'});
 if(!parsed.ok||parsed.facts.route==='fallback'||!Number.isFinite(parsed.facts.value))return undefined;
 let value=parsed.facts.value;
 if(rules.integer)value=sourceInteger(value);
 return Math.max(rules.min??-SOURCE_FLOAT_MAX,Math.min(rules.max??SOURCE_FLOAT_MAX,value));
}
const formats=new Map<number,Intl.NumberFormat>();
export function formatSourceNumber(value:number,precision:number,integer=false):string {
 if(integer)value=sourceInteger(value);
 let format=formats.get(precision);if(!format){format=new Intl.NumberFormat('en-US',{useGrouping:false,minimumFractionDigits:0,maximumFractionDigits:precision});formats.set(precision,format);}
 const text=format.format(value);return text==='-0'?'0':text;
}
export const bouncingNumberRules={
 particleCount:{integer:true,min:1,max:2147483647,precision:0,step:1000},
 subSteps:{integer:true,min:1,max:16,precision:0,step:(value:number)=>value>=15?2:1},
 timeStep:{min:Math.fround(.0001),max:.25,precision:4,step:Math.fround(.001)},
 initialSpeed:{min:0,max:SOURCE_FLOAT_MAX,precision:3,step:Math.fround(.05)},
 initialAngle:{precision:1,step:5},
 initialAngleSpread:{min:0,max:360,precision:1,step:5},
 shapeLissajousDelta:{precision:1,step:15},
} satisfies Record<string,SourceNumberRules>;
