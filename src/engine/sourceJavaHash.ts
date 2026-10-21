/** Signed-long MurmurHash3 finalizer, with Java overflow and unsigned shifts. */
export function sourceJavaMix64(seed:bigint):bigint {
 let value=BigInt.asUintN(64,seed);
 value=BigInt.asUintN(64,(value^(value>>33n))*-49064778989728563n);
 value=BigInt.asUintN(64,(value^(value>>33n))*-4265267296055464877n);
 return BigInt.asIntN(64,value^(value>>33n));
}
/** Java String.hashCode consumes UTF-16 code units, including lone surrogates. */
export function sourceJavaStringHash(value:string):number {
 let hash=0;for(let i=0;i<value.length;i++)hash=(Math.imul(hash,31)+value.charCodeAt(i))|0;return hash;
}
