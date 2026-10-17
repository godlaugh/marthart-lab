/** Shared successful ConfigUtils.parseColor/PApplet.unhex parsing. Recovery is
 * owned by each format adapter: Domain rejects invalid strings; Roots retains
 * them and reports the source white-color recovery. */
export const SOURCE_COLOR_TEXT_BUDGET=1_048_576;
export class SourceConfigColorError extends Error {
 constructor(readonly kind:'format'|'range'){super(kind==='format'?'Source color format is invalid':'Source color integer is out of range');this.name='SourceConfigColorError';}
}
function integer(text:string,radix:10|16,bits:32|64):bigint {
 if(!(radix===16?/^[+-]?[0-9a-fA-F]+$/:/^[+-]?[0-9]+$/).test(text))throw new SourceConfigColorError('format');
 const negative=text[0]==='-',digits=/^[+-]/.test(text)?text.slice(1):text,significant=digits.replace(/^0+/,'')||'0';
 if(significant.length>(radix===16?bits/4:bits===32?10:19))throw new SourceConfigColorError('range');
 const n=BigInt((radix===16?'0x':'')+significant)*(negative?-1n:1n),limit=1n<<BigInt(bits-1);
 if(n< -limit||n>=limit)throw new SourceConfigColorError('range');return n;
}
export function sourceConfigPackedColor(value:string):number {
 let result:bigint;
 if(value.startsWith('#')){const hex=value.slice(1);result=integer(hex.length===8?hex:'FF'+hex,16,64);}
 else if(value.startsWith('0x')){result=integer(value.slice(2),16,64);if((result&1095216660480n)===0n&&value.length<=8)result|=0xff000000n;}
 else result=integer(value,10,32);
 return Number(BigInt.asUintN(32,result));
}
