import {describe,it,expect} from 'vitest';
import {prepareSourcePausedCaptureSize} from '../src/engine/sourcePausedCaptureSize';
import {MAX_RASTER_PIXELS} from '../src/engine/rasterDimensions';
describe('source Perlin paused render-buffer dimensions',()=>{
 it('keeps inherited density and Java-rounds logical size before physical pixels',()=>{
  expect(prepareSourcePausedCaptureSize({width:255,height:193},2)).toEqual({logicalWidth:128,logicalHeight:97,width:256,height:194,density:2});
  expect(prepareSourcePausedCaptureSize({width:255,height:193},1)).toEqual({logicalWidth:255,logicalHeight:193,width:255,height:193,density:1});
 });
 it.each([[0,10,1],[10,10,0],[10,10,1.5],[1,1,4],[16385,10,1],[8192,8192,1],[Infinity,10,1]])('rejects unsupported target size %s/%s at density %s',(width,height,density)=>{
  expect(()=>prepareSourcePausedCaptureSize({width,height},density)).toThrow();
 });
 it('preserves separate point/recording and full raster admission budgets',()=>{
  const request={width:8191,height:4095};
  expect(()=>prepareSourcePausedCaptureSize(request,2)).toThrow('预算');
  expect(prepareSourcePausedCaptureSize(request,2,MAX_RASTER_PIXELS)).toEqual({logicalWidth:4096,logicalHeight:2048,width:8192,height:4096,density:2});
  expect(()=>prepareSourcePausedCaptureSize({width:8193,height:4095},2,MAX_RASTER_PIXELS)).toThrow('预算');
 });
 it.each([0,-1,1.5,NaN,MAX_RASTER_PIXELS+1])('rejects an invalid explicit storage budget: %s',budget=>{
  expect(()=>prepareSourcePausedCaptureSize({width:16,height:16},1,budget)).toThrow('预算');
 });
});
