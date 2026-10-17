import {describe,it,expect} from 'vitest';
import {enhanceRootsPausedImage,rootsPausedImageBytes,RootsPausedImageError} from '../src/engine/rootsPausedImage';
import {MAX_RASTER_PIXELS} from '../src/engine/rasterDimensions';

const gray=(values:number[],alpha=255)=>new Uint8ClampedArray(values.flatMap(value=>[value,value,value,alpha]));
const channels=(pixels:Uint8ClampedArray)=>Array.from(pixels).filter((_,i)=>i%4===0);

describe('source paused PNG base enhancement',()=>{
 it('keeps a one-pixel ARGB value and returns independent top-down RGBA ownership',()=>{
  const input=new Uint8ClampedArray([19,37,211,78]);
  const output=enhanceRootsPausedImage(input,1,1);
  expect(output).toEqual(input);expect(output.buffer).not.toBe(input.buffer);
  output[0]=0;expect(input[0]).toBe(19);
 });
 it('retains all alpha bytes and uniform color without premultiplication',()=>{
  const input=new Uint8ClampedArray(Array.from({length:12},(_,i)=>[93,17,201,i*23]).flat());
  expect(enhanceRootsPausedImage(input,4,3)).toEqual(input);
 });
 it('skips AA on short images but still applies clamped-edge Gaussian sharpening',()=>{
  // [100,200] has Gaussian luma [125,175]. F32 shifts -10.5/+10.5
  // use Java round (-10/+11), not symmetric rounding away from zero.
  expect(channels(enhanceRootsPausedImage(gray([100,200]),2,1))).toEqual([90,211]);
  expect(channels(enhanceRootsPausedImage(gray([100,200]),1,2))).toEqual([90,211]);
  // At each 2x2 corner the source Gaussian weights are 9,3,3,1 /16.
  expect(channels(enhanceRootsPausedImage(gray([0,100,200,255]),2,2))).toEqual([0,93,214,255]);
 });
 it('uses the strict sharpen dead band abs(delta)<2',()=>{
  expect(channels(enhanceRootsPausedImage(gray([100,104]),2,1))).toEqual([100,104]);
  expect(channels(enhanceRootsPausedImage(gray([100,108]),2,1))).toEqual([99,109]);
 });
 it('keeps edge20 unchanged but admits edge21 in the AA stage',()=>{
  // Alpha0 skips the later sharpen only, exposing the source AA boundary.
  const at20=gray([255,255,255,235,0,255,255,255,255],0);
  const at21=gray([255,255,255,234,0,255,255,255,255],0);
  expect(enhanceRootsPausedImage(at20,3,3).slice(16,20)).toEqual(new Uint8ClampedArray([0,0,0,0]));
  expect(enhanceRootsPausedImage(at21,3,3).slice(16,20)).toEqual(new Uint8ClampedArray([1,1,1,0]));
 });
 it('rounds each AA float stage and preserves transparent hidden RGB',()=>{
  // Source edge24, center20, neighbor mean145 gives F32 21.5 =>22.
  // Collapsing the expression into double arithmetic gives 21 here.
  const input=gray([145,145,145,133,20,157,145,145,145],0),before=input.slice();
  const output=enhanceRootsPausedImage(input,3,3);
  expect(output.slice(16,20)).toEqual(new Uint8ClampedArray([22,22,22,0]));
  expect(input).toEqual(before);expect(output.slice(0,16)).toEqual(input.slice(0,16));
 });
 it.each([1,128,255])('sharpens the same RGB independently of nonzero alpha %i',alpha=>{
  const input=gray([0,0,0,0,100,0,0,0,0],alpha);
  // Gaussian center25 gives delta75: F32(.42F*75)=31.499998,
  // so the source adds31 rather than double .42*75's rounded32.
  expect(enhanceRootsPausedImage(input,3,3).slice(16,20)).toEqual(new Uint8ClampedArray([131,131,131,alpha]));
 });
 it('matches a separately transcribed packed-ARGB source fixture with mixed RGB/alpha',()=>{
  // Independent Python integer-ARGB transcript of the retained three methods,
  // .cache/roots-paused-image-oracle.py; not produced by this TS implementation.
  const input=new Uint8ClampedArray(Array.from({length:140},(_,i)=>(i*73+11)%256));
  const expected=[8,81,154,230,48,121,194,10,86,159,232,46,118,191,8,82,175,248,65,118,172,0,62,154,231,48,121,190,3,76,149,226,43,116,189,6,81,154,219,42,114,187,12,78,165,219,55,114,172,8,62,150,226,43,116,186,0,68,141,222,38,111,184,2,76,149,214,38,110,183,17,74,156,210,46,110,165,20,55,146,217,34,107,182,255,78,151,218,32,104,177,254,72,145,218,34,110,183,239,70,148,221,46,106,198,233,88,142,205,22,95,178,253,70,143,214,25,98,171,250,67,140,213,30,105,178,251,66,138,211,28,102,196,255,86,138,196,13,86,174];
  expect(Array.from(enhanceRootsPausedImage(input,7,5))).toEqual(expected);
 });
 it('accepts an unshared RGBA view without copying or changing surrounding input bytes',()=>{
  const backing=new Uint8ClampedArray([7,7,7,7,19,37,211,78,9,9,9,9]);
  expect(enhanceRootsPausedImage(backing.subarray(4,8),1,1)).toEqual(new Uint8ClampedArray([19,37,211,78]));
  expect(Array.from(backing)).toEqual([7,7,7,7,19,37,211,78,9,9,9,9]);
 });
 it('preflights the existing raster budget and exact input/result/luma representation cost',()=>{
  expect(rootsPausedImageBytes(3840,2160)).toBe(3840*2160*9);
  expect(rootsPausedImageBytes(MAX_RASTER_PIXELS,1)).toBe(MAX_RASTER_PIXELS*9);
  expect(()=>enhanceRootsPausedImage(new Uint8ClampedArray(),MAX_RASTER_PIXELS+1,1)).toThrow(RootsPausedImageError);
  try{rootsPausedImageBytes(MAX_RASTER_PIXELS+1,1);}catch(error){expect((error as RootsPausedImageError).kind).toBe('capacity');}
 });
 it('rejects malformed dimensions, incomplete layout, wrong storage and shared buffers',()=>{
  for(const [w,h] of [[0,1],[-1,1],[1.5,2],[NaN,1],[Infinity,1]])expect(()=>enhanceRootsPausedImage(new Uint8ClampedArray(4),w,h)).toThrow(RootsPausedImageError);
  expect(()=>enhanceRootsPausedImage(new Uint8ClampedArray(3),1,1)).toThrow('complete');
  expect(()=>enhanceRootsPausedImage(new Uint8Array(4) as unknown as Uint8ClampedArray,1,1)).toThrow('RGBA8');
  expect(()=>enhanceRootsPausedImage(new Uint8ClampedArray(new SharedArrayBuffer(4)),1,1)).toThrow('unshared');
 });
 it('rejects a detached input rather than emitting an empty image',()=>{
  const input=new Uint8ClampedArray(4);structuredClone(input,{transfer:[input.buffer]});
  expect(()=>enhanceRootsPausedImage(input,1,1)).toThrow(RootsPausedImageError);
 });
});
