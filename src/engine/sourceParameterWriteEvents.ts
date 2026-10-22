import type {SceneDocument} from '../types';

/** Explicit editor events, never inferred differences. Validate the complete
 * batch before any consumer starts mutating its retained runtime. */
export function sourceParameterWriteEvents(before:SceneDocument,next:SceneDocument,writes:unknown):readonly (readonly [string,number])[]|undefined {
 if(before.id!==next.id||!Array.isArray(writes)||!writes.length)return;
 const result:(readonly [string,number])[]=[];
 for(const entry of writes){
  if(!Array.isArray(entry)||entry.length!==2)return;
  const [name,value]=entry;
  if(typeof name!=='string'||typeof value!=='number'||!Number.isFinite(value)||!Object.hasOwn(next.parameters,name)||!Object.is(next.parameters[name],value))return;
  result.push([name,value]);
 }
 return result;
}
