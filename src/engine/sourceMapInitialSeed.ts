import {sourceJavaMix64,sourceJavaStringHash} from './sourceJavaHash';
import type {SourceMapConfiguration} from './sourceMapConfig';

/** MapAttractorMobject constructor identity, before animation mutates uniforms.
 * Raw formula whitespace and ordered double-valued parameters affect the seed;
 * compiled GLSL, bounds and runtime parameter snapshots cannot replace them. */
export function sourceMapInitialSeed(configuration:SourceMapConfiguration):string {
 const c=configuration.construction,mix=(seed:bigint,value:bigint)=>sourceJavaMix64(seed^value);
 let seed=mix(mix(-7046029254386353131n,BigInt(c.dimension)),BigInt(c.batchSize));
 for(const value of [c.equations.x,c.equations.y,c.equations.z])seed=mix(seed,BigInt(sourceJavaStringHash(value)));
 const bits=new DataView(new ArrayBuffer(8));
 for(const [key,value]of c.parameters){bits.setFloat64(0,value);seed=mix(mix(seed,BigInt(sourceJavaStringHash(key))),bits.getBigInt64(0));}
 return String(seed);
}
