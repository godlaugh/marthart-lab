import {sourceJavaMix64} from './sourceJavaHash';
import {parseRootsSignedLongText} from './rootsSourceOrder';
import {isJavaSourceLong} from './javaSourceRandom';
export class SourcePerlinSeedError extends Error {
 constructor(readonly code:'input'|'capacity',message:string){super(message);this.name='SourcePerlinSeedError';}
}
/** Signed long Murmur finalizer used by both constructor and curve RNG. */
export function sourcePerlinMix64(seed:bigint):bigint{
 if(!isJavaSourceLong(seed))throw new SourcePerlinSeedError('input','Perlin mix64 requires a signed Java long.');
 return sourceJavaMix64(seed);
}
/** Constructor only mixes seeds outside signed int32. Random uses the full
 * resulting long; Processing noise uses its sign-extended low int32 bits. */
export function sourcePerlinSeed(seed:string|number){
 if(typeof seed!=='string'&&(typeof seed!=='number'||!Number.isSafeInteger(seed)))throw new SourcePerlinSeedError('input','Perlin seed requires exact Java long text or a safe integer.');
 const parsed=parseRootsSignedLongText(String(seed));
 if(!parsed.ok)throw new SourcePerlinSeedError(parsed.error.kind==='capacity'?'capacity':'input','Perlin seed must be a signed Java long.');
 const originalSeed=parsed.value;
 const randomSeed=originalSeed< -2147483648n||originalSeed>2147483647n?sourcePerlinMix64(originalSeed):originalSeed;
 return Object.freeze({originalSeed,randomSeed,textureSeed:Number(BigInt.asIntN(32,randomSeed))});
}
