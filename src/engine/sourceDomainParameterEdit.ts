import type {SceneDocument} from '../types';
import {usesSourceDomain} from './sourceDomainTimeline';

/** Explicit value-editor events only. Other changes may be staged in the
 * author document, but are never inferred as runtime writes or applied here. */
export function sourceDomainParameterWrites(before:SceneDocument,next:SceneDocument,writes:unknown):readonly (readonly [string,number])[]|undefined {
 if(!usesSourceDomain(before)||!usesSourceDomain(next)||before.id!==next.id||!Array.isArray(writes)||!writes.length)return;
 const result:(readonly [string,number])[]=[];
 for(const entry of writes){
  if(!Array.isArray(entry)||entry.length!==2)return;
  const [name,value]=entry;
  if(typeof name!=='string'||typeof value!=='number'||!Number.isFinite(value)||!Object.hasOwn(next.parameters,name)||!Object.is(next.parameters[name],value))return;
  result.push([name,value]);
 }
 return result;
}
