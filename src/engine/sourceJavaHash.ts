/** Signed-long MurmurHash3 finalizer, with Java overflow and unsigned shifts. */
export function sourceJavaMix64(seed:bigint):bigint {
 let value=BigInt.asUintN(64,seed);
 value=BigInt.asUintN(64,(value^(value>>33n))*-49064778989728563n);
 value=BigInt.asUintN(64,(value^(value>>33n))*-4265267296055464877n);
 return BigInt.asIntN(64,value^(value>>33n));
}
