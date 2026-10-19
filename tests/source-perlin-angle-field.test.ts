import {describe,it,expect} from 'vitest';
import {SourceProcessingNoise} from '../src/engine/sourceProcessingNoise';
import {sourcePerlinSeed} from '../src/engine/sourcePerlinSeed';
import {SourcePerlinAngleField,sourcePerlinAngleLerp} from '../src/engine/sourcePerlinAngleField';
import fixture from './fixtures/source-perlin/angle-field.json';
const options={width:22,height:10,fieldCellSize:4,textureSeed:0,curveNoiseScale:1.2,curveNoiseOctaves:2,curveNoiseOffset:0,curveAngleScale:4,noise:new SourceProcessingNoise(0n)};
describe('source Perlin angle field',()=>{
 it('keeps static numerical evidence distinct from native rendering',()=>{
  expect(fixture.provenance.nativeExecution).toBe(false);
  expect(fixture.provenance.classSha256).toBe('ef1de66f25e6fed5a126cb260005d0b5d7fd161118cc83993f0648009de96d92');
 });
 for(const c of fixture.cases)it(`matches all independent grid and sample values: ${c.name}`,()=>{
  const textureSeed=sourcePerlinSeed(c.input.seed).textureSeed;
  const noiseSeed='noiseSeed' in c.input?BigInt(c.input.noiseSeed!):BigInt(textureSeed);
  const field=new SourcePerlinAngleField({...c.input,textureSeed,noise:new SourceProcessingNoise(noiseSeed)});
  expect(field.diagnostics()).toEqual({nx:c.nx,ny:c.ny,retainedBytes:c.nx*c.ny*4});
  expect([...field.copyAngles()]).toEqual(c.angles.flat());
  expect(c.points.map(([x,y])=>field.sample(x,y,c.input.noiseOffset))).toEqual(c.samples);
  const a=c.alternateExtent;expect(field.sample(a.point[0],a.point[1],c.input.noiseOffset,a.width,a.height)).toBe(a.expected);
 });
 for(const c of fixture.angleLerpCases)it(`preserves native angle remainder: ${c.name}`,()=>expect(sourcePerlinAngleLerp(c.a,c.b,c.t)).toBe(c.expected));
 it('owns the grid and preserves the caller noise lifecycle',()=>{
  const noise=new SourceProcessingNoise(12345n),before=noise.sample(1.2,3.4),field=new SourcePerlinAngleField({...options,noise});
  const initial=field.sample(1,2,0),copy=field.copyAngles();copy.fill(NaN);
  expect(field.sample(1,2,0)).toBe(initial);expect(noise.sample(1.2,3.4)).toBe(before);
  expect(field.sample(1,2,.3)).not.toBe(initial);expect(field.sample(1,2,0)).toBe(initial);
 });
 it('bounds representation before allocation or noise sampling',()=>{
  let calls=0;const noise={sample:()=>{calls++;return 0;}};
  for(const width of [1e6,3.4e38])expect(()=>new SourcePerlinAngleField({...options,width,height:1e6,noise})).toThrow(expect.objectContaining({code:'capacity'}));
  expect(calls).toBe(0);
 });
 it('rejects malformed and nonfinite boundary inputs',()=>{
  for(const width of [0,-1])expect(()=>new SourcePerlinAngleField({...options,width})).toThrow(expect.objectContaining({code:'input'}));
  for(const width of [NaN,Infinity,Number.MAX_VALUE])expect(()=>new SourcePerlinAngleField({...options,width})).toThrow(expect.objectContaining({code:'nonfinite'}));
  for(const fieldCellSize of [.5,NaN,2147483648])expect(()=>new SourcePerlinAngleField({...options,fieldCellSize})).toThrow(expect.objectContaining({code:'input'}));
  expect(()=>new SourcePerlinAngleField({...options,noise:{sample:()=>NaN}})).toThrow(expect.objectContaining({code:'nonfinite'}));
  const field=new SourcePerlinAngleField(options);expect(()=>field.sample(Infinity,0,0)).toThrow(expect.objectContaining({code:'nonfinite'}));
 });
 it('cancels before allocation, during construction and later sampling',()=>{
  let cancelled=true;expect(()=>new SourcePerlinAngleField({...options,isCancelled:()=>cancelled})).toThrow(expect.objectContaining({code:'cancelled'}));
  let checks=0;expect(()=>new SourcePerlinAngleField({...options,isCancelled:()=>++checks===3})).toThrow(expect.objectContaining({code:'cancelled'}));
  cancelled=false;const field=new SourcePerlinAngleField({...options,isCancelled:()=>cancelled});cancelled=true;
  expect(()=>field.copyAngles()).toThrow(expect.objectContaining({code:'cancelled'}));expect(()=>field.sample(0,0,0)).toThrow(expect.objectContaining({code:'cancelled'}));
 });
});
