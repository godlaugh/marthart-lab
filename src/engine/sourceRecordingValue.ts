/** Compare structured recording facts, preserving signed zero and explicit
 * omissions. These values are data records/arrays, never resource identities. */
export function sameSourceRecordingValue(a:unknown,b:unknown):boolean {
 if(Object.is(a,b))return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 const left=a as Record<string,unknown>,right=b as Record<string,unknown>,keys=Object.keys(left);
 return keys.length===Object.keys(right).length&&keys.every(key=>Object.hasOwn(right,key)&&sameSourceRecordingValue(left[key],right[key]));
}
