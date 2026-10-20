import {describe,it,expect} from 'vitest';
import fixture from './fixtures/source-paused-upscale-openjdk21.json';
import {prepareSourcePausedUpscale,upscaleSourcePausedImage,type SourcePausedUpscale} from '../src/engine/sourcePausedUpscale';
import {SourcePausedImageError} from '../src/engine/sourcePausedImage';
import {MAX_RASTER_PIXELS} from '../src/engine/rasterDimensions';

describe('source paused OpenJDK21 software upscale',()=>{
 // Independently transcribed Python full LUT/BigInt-coordinate oracle.
 // These are software-algorithm vectors, not captured original JVM pixels.
 for(const c of fixture.cases)it(`${c.name} at ${c.scale}x matches the independent integer oracle`,()=>{
  const source=new Uint8ClampedArray(c.pixels),before=source.slice();
  const result=upscaleSourcePausedImage(source,c.width,c.height,c.scale as SourcePausedUpscale);
  expect([...result]).toEqual(c.expected);expect(source).toEqual(before);expect(result.buffer).not.toBe(source.buffer);
 });
 it('retains fixed-point step truncation at nominal pixel centers',()=>{
  const c=fixture.cases.find(c=>c.name==='fixed-center'&&c.scale===5)!;
  const output=upscaleSourcePausedImage(new Uint8ClampedArray(c.pixels),5,3,5);
  expect([...output.slice((7*25+12)*4,(7*25+13)*4)]).toEqual([117,134,195,255]);
  expect(c.pixels.slice((1*5+2)*4,(1*5+3)*4)).toEqual([117,135,196,255]);
 });
 it('uses premultiply/unpremultiply byte tables and removes hidden transparent RGB',()=>{
  const opaque=upscaleSourcePausedImage(new Uint8ClampedArray([1,127,253,255]),1,1,3);
  const partial=upscaleSourcePausedImage(new Uint8ClampedArray([1,127,253,128]),1,1,3);
  const transparent=upscaleSourcePausedImage(new Uint8ClampedArray([255,255,255,0]),1,1,3);
  expect([...opaque.slice(0,4)]).toEqual([1,127,253,255]);
  expect([...partial.slice(0,4)]).toEqual([2,128,253,128]);expect([...transparent]).toEqual(Array(36).fill(0));
 });
 it('budgets the complete owned workspace and returns actual size',()=>{
  expect(prepareSourcePausedUpscale(7,5,3)).toEqual({width:21,height:15,inputBytes:140,outputBytes:1260,workspaceBytes:172,peakBytes:3622,method:'openjdk21-software-bicubic'});
  expect(prepareSourcePausedUpscale(768,432,5).outputBytes).toBe(3840*2160*4);
 });
 it('rejects capacity before examining or allocating image storage',()=>{
  expect(()=>upscaleSourcePausedImage(null as unknown as Uint8ClampedArray,MAX_RASTER_PIXELS,1,3)).toThrow(/upscaled RGBA output/);
  expect(()=>prepareSourcePausedUpscale(Number.MAX_SAFE_INTEGER,2,5)).toThrow(/RGBA input/);
 });
 it('does not accept other scale values as silently approximate recipes',()=>{
  for(const scale of [1,2,4,0,-1,NaN,Infinity])expect(()=>prepareSourcePausedUpscale(1,1,scale as SourcePausedUpscale)).toThrow(/must be 3 or 5/);
 });
 it('rejects malformed input dimensions and incomplete/wrong storage',()=>{
  for(const dimensions of [[0,1],[1,-1],[1.2,1],[Infinity,1]])expect(()=>prepareSourcePausedUpscale(dimensions[0],dimensions[1],3)).toThrow(/dimensions/);
  expect(()=>upscaleSourcePausedImage(new Uint8ClampedArray(3),1,1,3)).toThrow(/complete unshared/);
  expect(()=>upscaleSourcePausedImage(new Uint8Array(4) as unknown as Uint8ClampedArray,1,1,3)).toThrow(/complete unshared/);
  const shared=new Uint8ClampedArray(new SharedArrayBuffer(4));
  expect(()=>upscaleSourcePausedImage(shared,1,1,3)).toThrow(/complete unshared/);
  const detached=new Uint8ClampedArray(4);structuredClone(detached,{transfer:[detached.buffer]});
  expect(()=>upscaleSourcePausedImage(detached,1,1,3)).toThrow(SourcePausedImageError);
 });
 it('borrows a subview without mutating surrounding data',()=>{
  const buffer=new Uint8ClampedArray([88,89,90,91,12,45,78,255,92,93,94,95]),before=buffer.slice();
  const result=upscaleSourcePausedImage(buffer.subarray(4,8),1,1,3);
  expect([...result.slice(0,4)]).toEqual([12,45,78,255]);expect(buffer).toEqual(before);
  result[0]=255;expect(buffer).toEqual(before);
 });
 it('cancels before allocation and during processing without affecting later requests',()=>{
  const input=new Uint8ClampedArray(4*20*20).fill(199),before=input.slice();let checks=0;
  expect(()=>upscaleSourcePausedImage(input,20,20,3,()=>true)).toThrow(/cancelled/);
  expect(()=>upscaleSourcePausedImage(input,20,20,3,()=>++checks===5)).toThrow(/cancelled/);
  expect(input).toEqual(before);expect(upscaleSourcePausedImage(input,20,20,3).length).toBe(60*60*4);
 });
 it('preserves caller callback errors rather than classifying them as allocation failure',()=>{
  const error=new Error('caller cancellation probe failed');
  expect(()=>upscaleSourcePausedImage(new Uint8ClampedArray(4),1,1,3,()=>{throw error;})).toThrow(error);
 });
});
