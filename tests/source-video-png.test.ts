import {afterEach,describe,expect,it,vi} from 'vitest';
import {encodeFormulaRaster} from '../src/engine/formulaCanvas';
import type {RasterOutput} from '../src/types';
import {decodePng} from '../scripts/lib/verify-png.mjs';
const calls=vi.hoisted(()=>({enhance:vi.fn(),compose:vi.fn(async(p:Uint8ClampedArray)=>{const next=p.slice();next[0]=211;return next;})}));
vi.mock('../src/engine/sourcePausedPng',()=>({encodeSourcePausedPng:calls.enhance}));
vi.mock('../src/engine/sourceFormulaCompositor',()=>({compositeSourceFormulaPixels:calls.compose}));
const frame=(labels=false):RasterOutput=>({type:'raster',width:2,height:1,pixels:new Uint8ClampedArray([21,31,41,0,51,61,71,63]),formulaPresentation:{layout:'source-surface-centered-v1',primaryLogicalHeight:1,labels:labels?[{id:'x',visible:true,latex:'x',color:'#ffffff',scale:1,x:0,y:0}]:[]}});
afterEach(()=>vi.clearAllMocks());
describe('video PNG alpha boundary',()=>{
 it.each([false,true])('preserves raw RGB after optional formula composition (%s) without enhancement or caller mutation',async labels=>{
  const f=frame(labels),before=f.pixels.slice();const blob=await encodeFormulaRaster(f,'image/png',{sourcePresentationAlpha:'opaque'});const decoded=decodePng(Buffer.from(await blob.arrayBuffer()));
  expect(Array.from(decoded.rgba)).toEqual([labels?211:21,31,41,255,51,61,71,255]);expect(f.pixels).toEqual(before);expect(calls.enhance).not.toHaveBeenCalled();expect(calls.compose).toHaveBeenCalledTimes(labels?1:0);
 });
 it('keeps default PNG alpha and rejects combining video alpha with enhancement or JPEG',async()=>{
  const f=frame();const decoded=decodePng(Buffer.from(await(await encodeFormulaRaster(f)).arrayBuffer()));expect(Array.from(decoded.rgba)).toEqual(Array.from(f.pixels));
  await expect(encodeFormulaRaster(f,'image/png',{sourcePresentationAlpha:'opaque',sourceImageProcessing:'paused-png'})).rejects.toThrow('未经图像增强');await expect(encodeFormulaRaster(f,'image/jpeg',{sourcePresentationAlpha:'opaque'})).rejects.toThrow('未经图像增强');expect(calls.enhance).not.toHaveBeenCalled();
 });
});
