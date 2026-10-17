import type {RootNativeVariable} from '../types';
import {parseSourceJson,SOURCE_JSON_LIMITS,SourceJsonCapacityError} from './sourceJson';
import {sourceNumberTokenValid} from './sourceNumberTokens';
import {prepareRootsSourceJsonString,type RootsSourceJsonStringFacts} from './rootsSourceOrder';
import {RootsNativeError,rootsNativeAttempt,rootsNativeCapacity,type RootsNativeResult} from './rootsNativeExpression';
export interface PreparedRootsVariableLabel {authored:RootNativeVariable;facts:RootsSourceJsonStringFacts;characters:number;}
/** Label metadata owns its lossless wrapper. sourceJson is explicitly authored
 * JSON text, not a marker inferred from null or from an arbitrary source object.
 * Earlier sourceValue wrappers remain accepted without rewriting stored data. */
export function prepareRootsVariableLabel(raw:unknown,maxCharacters:number=SOURCE_JSON_LIMITS.characters):RootsNativeResult<PreparedRootsVariableLabel>{return rootsNativeAttempt(()=>{
 let authored:RootNativeVariable,value:unknown,token:string|undefined,characters:number;
 if(typeof raw==='string'){authored=raw;value=raw;characters=raw.length;}
 else if(raw&&typeof raw==='object'&&!Array.isArray(raw)){
  const v=raw as Record<string,unknown>,json=Object.hasOwn(v,'sourceJson'),legacy=Object.hasOwn(v,'sourceValue');
  if(json===legacy)throw new RootsNativeError('input','Source Roots variable metadata requires exactly one explicit representation');
  if(json){
   if(typeof v.sourceJson!=='string')throw new RootsNativeError('input','Source Roots variable JSON must be text');
   characters=v.sourceJson.length;if(characters>maxCharacters)rootsNativeCapacity('variable label characters',characters,maxCharacters);
   try{value=parseSourceJson(v.sourceJson).value;}catch(e){if(e instanceof SourceJsonCapacityError)rootsNativeCapacity('variable label '+e.resource,e.actual,e.limit);if(e instanceof SyntaxError)throw new RootsNativeError('input','Invalid source Roots variable JSON');throw e;}
   token=typeof value==='number'?v.sourceJson.trim():undefined;authored={sourceJson:v.sourceJson};
  }else{
   if(v.sourceValue===undefined)throw new RootsNativeError('input','Source Roots variable original value is missing');
   if(v.numberToken!==undefined&&(typeof v.numberToken!=='string'||!sourceNumberTokenValid(v.numberToken)||typeof v.sourceValue!=='number'||!Object.is(Number(v.numberToken),v.sourceValue)))throw new RootsNativeError('input','Invalid source Roots variable numeric spelling');
   value=v.sourceValue;token=v.numberToken as string|undefined;characters=token?.length??0;authored=structuredClone(raw) as RootNativeVariable;
  }
 }else throw new RootsNativeError('input','Invalid source Roots variable metadata');
 if(characters>maxCharacters)rootsNativeCapacity('variable label characters',characters,maxCharacters);
 const result=prepareRootsSourceJsonString(value,'x',token);
 if(!result.ok){const e=result.error;if(e.kind==='capacity')rootsNativeCapacity(e.resource,e.actual,e.limit);throw new RootsNativeError('input','Invalid source Roots variable label');}
 return{authored,facts:result.value,characters};
});}
