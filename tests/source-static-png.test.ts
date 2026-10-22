import {afterEach,describe,it,expect,vi} from 'vitest';
import {encodeFormulaRaster} from '../src/engine/formulaCanvas';
import type {RasterOutput,FormulaPresentation} from '../src/types';
const state=vi.hoisted(()=>({events:[] as string[],encoded:undefined as undefined|{pixels:Uint8ClampedArray;scale:number}}));
vi.mock('../src/engine/sourcePausedPng',()=>({encodeSourcePausedPng:async(pixels:Uint8ClampedArray,_w:number,_h:number,scale:number)=>{state.events.push('enhancement');state.encoded={pixels:pixels.slice(),scale};return new Blob(['enhanced'],{type:'image/png'});}}));
vi.mock('../src/engine/rgbaPng',async importOriginal=>({...await importOriginal<typeof import('../src/engine/rgbaPng')>(),encodeRgbaPng:async()=>{state.events.push('raw');return new Blob(['raw'],{type:'image/png'});}}));
vi.mock('../src/engine/sourceFormulaCompositor',()=>({compositeSourceFormulaPixels:async(pixels:Uint8ClampedArray)=>{state.events.push('formula');const result=pixels.slice();result[0]=211;return result;}}));
const presentation=(labels:FormulaPresentation['labels']=[]):FormulaPresentation=>({labels,layout:'source-surface-centered-v1',primaryLogicalHeight:1});
const output=(labels:FormulaPresentation['labels']=[]):RasterOutput=>({type:'raster',width:2,height:1,pixels:new Uint8ClampedArray([2,3,4,255,5,6,7,255]),formulaPresentation:presentation(labels)});
afterEach(()=>{state.events=[];state.encoded=undefined;});
describe('fresh source static PNG joins the shared postprocessing owner',()=>{
 it('enhances unlabelled raw bytes at scale 1 without forging retained-frame identity',async()=>{
  const frame=output(),before=frame.pixels.slice();await encodeFormulaRaster(frame,'image/png',{sourceImageProcessing:'paused-png'});
  expect(state.events).toEqual(['enhancement']);expect(state.encoded).toEqual({pixels:before,scale:1});expect(frame).not.toHaveProperty('sourceCurrentImage');expect(frame.pixels).toEqual(before);
 });
 it('composes source formula pixels before shared enhancement and preserves caller bytes',async()=>{
  const frame=output([{id:'main',latex:'x',color:'#ffffff',scale:.25,x:0,y:0,visible:true}]);await encodeFormulaRaster(frame,'image/png',{sourceImageProcessing:'paused-png'});
  expect(state.events).toEqual(['formula','enhancement']);expect(state.encoded?.pixels[0]).toBe(211);expect(frame.pixels[0]).toBe(2);
 });
 it.each([undefined,null])('rejects an owned snapshot with missing/invalid scale %s before either export route',async scale=>{
  for(const options of [undefined,{sourceImageProcessing:'paused-png' as const}]){
   const frame=output();frame.sourceCurrentImage={model:'local-current-numerical-snapshot',stage:'base-before-formulas',baseSize:[2,1],scale} as unknown as RasterOutput['sourceCurrentImage'];
   await expect(encodeFormulaRaster(frame,'image/png',options)).rejects.toThrow('倍率');expect(state.events).toEqual([]);
  }
 });
 it('keeps raw encoding unchanged without the explicit source operation, rejects JPEG and cancels before work',async()=>{
  await encodeFormulaRaster(output());expect(state.events).toEqual(['raw']);state.events=[];
  await expect(encodeFormulaRaster(output(),'image/jpeg',{sourceImageProcessing:'paused-png'})).rejects.toThrow('仅支持 PNG');
  await expect(encodeFormulaRaster(output(),'image/png',{sourceImageProcessing:'paused-png',isCancelled:()=>true})).rejects.toMatchObject({name:'AbortError'});expect(state.events).toEqual([]);
 });
});
