import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import type fixtureShape from './fixtures/map/initialization-source.json';
// Preserve -0 in native input values: JSON module compilation may turn -0.0
// into a positive-zero JavaScript literal. Parse the source bytes directly.
const fixture:typeof fixtureShape=JSON.parse(readFileSync(new URL('./fixtures/map/initialization-source.json',import.meta.url),'utf8'));
import {sourceMapInitialSeed} from '../src/engine/sourceMapInitialSeed';
import {SOURCE_MAP_CONFIG,type SourceMapConfiguration} from '../src/engine/sourceMapConfig';
import {iteratedInitialChunk,type IteratedSeedConfig} from '../src/engine/iteratedSeed';

type NativeCase=typeof fixture.cases[number];
const floatBits=(values:Float32Array)=>Array.from(new Uint32Array(values.buffer,values.byteOffset,values.length));
// These are synthetic original object fields, deliberately independent of the
// JSON/config importer. The native oracle bypassed that constructor boundary.
const configuration=(row:NativeCase):SourceMapConfiguration=>({
 model:SOURCE_MAP_CONFIG,entry:'runtime-config',settingsPresence:'object',construction:{
 batchSize:row.batchSize,dimension:row.dimension as 2|3,
 equations:{x:row.equations[0],y:row.equations[1],z:row.equations[2]},
 parameters:row.parameters.map(([key,value])=>[String(key),Number(value)] as [string,number]),
 initial:{xMin:row.bounds[0][0],xMax:row.bounds[0][1],yMin:row.bounds[1][0],yMax:row.bounds[1][1]},
 burnIn:0,iterations:1,
}});
const seedConfig=(row:NativeCase):IteratedSeedConfig=>({
 sourceInitialSeed:sourceMapInitialSeed(configuration(row)),seed:0,count:row.batchSize,dimension:row.dimension as 2|3,
 bounds:[[row.bounds[0][0],row.bounds[0][1]],[row.bounds[1][0],row.bounds[1][1]],[0,0]],
});

describe('source Map constructor seed and original Java initial stream',()=>{
 for(const row of fixture.cases){
  it('preserves original seed identity: '+row.id,()=>{
   expect(sourceMapInitialSeed(configuration(row))).toBe(row.initialStateSeed);
  });
  if(row.preparedRange)it('matches original float bits and partitioned particle addresses: '+row.id,()=>{
   const config=seedConfig(row),expected=row.samplesFloatBits.flat();
   expect(floatBits(iteratedInitialChunk(config,0,8))).toEqual(expected);
   // Odd offsets distinguish the 2D and 3D stride; collapsed axes consume no
   // Random.nextFloat calls, even when the authored doubles differ slightly.
   for(const [offset,count]of [[0,1],[1,3],[4,1],[5,3]]){
    expect(floatBits(iteratedInitialChunk(config,offset,count))).toEqual(expected.slice(offset*4,(offset+count)*4));
   }
  });
 }
 it('rejects unnormalized ranges instead of presenting a direct private-helper probe as constructor output',()=>{
  const row=fixture.cases.find(row=>row.id==='reversed-raw-range')!;
  expect(row.preparedRange).toBe(false);
  expect(()=>iteratedInitialChunk(seedConfig(row),0,8)).toThrow('边界');
 });
 it('uses native fixed Z bounds and keeps the fourth state channel zero',()=>{
  const row=fixture.cases.find(row=>row.id==='base-3d')!,config=seedConfig(row);
  config.bounds[2]=[100,200];
  expect(floatBits(iteratedInitialChunk(config,0,8))).toEqual(row.samplesFloatBits.flat());
 });
 it('does not mix the local counter PRNG seed into a source-owned stream',()=>{
  const row=fixture.cases.find(row=>row.id==='base-3d')!,config=seedConfig(row),original=row.samplesFloatBits.flat();
  // The unrelated local counter seed must not change a source-owned stream.
  expect(floatBits(iteratedInitialChunk({...config,seed:0xffffffff},0,8))).toEqual(original);
 });
 it('rejects invalid signed source seeds before producing an initial block',()=>{
  const config=seedConfig(fixture.cases[0]);
  for(const sourceInitialSeed of ['9223372036854775808','-9223372036854775809','1.5','']){
   expect(()=>iteratedInitialChunk({...config,sourceInitialSeed},0,1)).toThrow();
  }
 });
});
