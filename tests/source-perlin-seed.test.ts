import {describe,it,expect} from 'vitest';
import {sourcePerlinSeed,sourcePerlinMix64,SourcePerlinSeedError} from '../src/engine/sourcePerlinSeed';
import fixture from './fixtures/source-perlin/angle-field.json';
describe('source Perlin shared seed ownership',()=>{
 for(const c of fixture.seedCases)it(`preserves independent constructor and curve seed: ${c.rawSeed}`,()=>{
  const seed=sourcePerlinSeed(c.rawSeed);expect(seed.originalSeed).toBe(BigInt(c.rawSeed));expect(seed.randomSeed.toString()).toBe(c.randomSeed);expect(seed.textureSeed).toBe(c.textureSeed);
  expect(sourcePerlinMix64(BigInt(c.rawSeed)^7866515270071974961n).toString()).toBe(c.curveRngSeed);
 });
 it('rejects out-of-long and inexact numeric seeds',()=>{
  for(const seed of [Number.MAX_SAFE_INTEGER+1,'9223372036854775808','-9223372036854775809','',NaN])expect(()=>sourcePerlinSeed(seed)).toThrow(SourcePerlinSeedError);
  expect(()=>sourcePerlinMix64(1n<<63n)).toThrow(SourcePerlinSeedError);
 });
});
