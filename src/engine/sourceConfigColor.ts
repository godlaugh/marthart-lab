import {javaTrim} from './sourceJavaText';
import {sourceJavaDecimalDigit} from './rootsSourceCharacters';

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

function javaHexText(raw:string):string|undefined {
 let normalized='';
 for(let i=0;i<raw.length;i++){
  const c=raw.charCodeAt(i);
  if(i===0&&(c===43||c===45)){normalized+=raw[i];continue;}
  const decimal=sourceJavaDecimalDigit(raw[i]);
  if(decimal>=0){normalized+=String(decimal);continue;}
  const letter=c>=0xff21&&c<=0xff26?c-0xff21+10:c>=0xff41&&c<=0xff46?c-0xff41+10:c>=65&&c<=70?c-65+10:c>=97&&c<=102?c-97+10:-1;
  if(letter<0)return undefined;
  normalized+=letter.toString(16);
 }
 return normalized;
}

/** ManualGradientPaletteEditorKt's insertion parser, separate from the source
 * configuration/preview format: remove one #, do not trim, Long.parseLong(hex),
 * six/eight UTF-16 units only; failure is black. Caller retains input strings. */
export function sourceManualPalettePackedColor(value:string):number {
 const raw=value.startsWith('#')?value.slice(1):value;
 if(raw.length!==6&&raw.length!==8)return 0xff000000;
 const normalized=javaHexText(raw);if(normalized===undefined)return 0xff000000;
 try{const parsed=integer(normalized,16,64);return Number(BigInt.asUintN(32,raw.length===6?parsed|0xff000000n:parsed));}
 catch(error){if(error instanceof SourceConfigColorError)return 0xff000000;throw error;}
}

/** Manual random-generator main tones: six-digit Integer / eight-digit Long,
 * no trimming, one optional #, discarded alpha, null on failed parsing. */
export function sourceManualMainToneRgb(value:string):number|null {
 const raw=value.startsWith('#')?value.slice(1):value;
 if(raw.length!==6&&raw.length!==8)return null;
 const normalized=javaHexText(raw);if(normalized===undefined)return null;
 try{return Number(BigInt.asUintN(24,integer(normalized,16,raw.length===6?32:64)));}
 catch(error){if(error instanceof SourceConfigColorError)return null;throw error;}
}

/** BouncingBoundaryMobject.parseColor is a distinct source format: remove all
 * hashes after Java trim, then Integer.parseInt(hex), not PApplet.unhex(long).
 * Java radix-16 digits include BMP decimal digits and fullwidth A–F. Only this
 * boundary and the Manual palette parsers use those mappings; ConfigUtils
 * callers keep their existing scope.
 * Invalid/overflow colors recover to source white. */
export function sourceBouncingBoundaryPackedColor(value:string):number {
 const raw=javaTrim(value).replaceAll('#','');
 if(raw.length!==6&&raw.length!==8)return 0xffffffff;
 const normalized=javaHexText(raw);if(normalized===undefined)return 0xffffffff;
 try{const parsed=integer(normalized,16,32);return Number(BigInt.asUintN(32,raw.length===6?parsed|0xff000000n:parsed));}
 catch(error){if(error instanceof SourceConfigColorError)return 0xffffffff;throw error;}
}
