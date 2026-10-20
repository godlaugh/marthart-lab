import {describe,it,expect} from 'vitest';
import {prepareSourcePerlinCaptureSize} from '../src/engine/sourcePerlinCaptureSize';
describe('source Perlin paused render-buffer dimensions',()=>{
 it('keeps inherited density and Java-rounds logical size before physical pixels',()=>{
  expect(prepareSourcePerlinCaptureSize({width:255,height:193},2)).toEqual({logicalWidth:128,logicalHeight:97,width:256,height:194,density:2});
  expect(prepareSourcePerlinCaptureSize({width:255,height:193},1)).toEqual({logicalWidth:255,logicalHeight:193,width:255,height:193,density:1});
 });
 it.each([[0,10,1],[10,10,0],[10,10,1.5],[1,1,4],[16385,10,1],[8192,8192,1],[Infinity,10,1]])('rejects unsupported target size %s/%s at density %s',(width,height,density)=>{
  expect(()=>prepareSourcePerlinCaptureSize({width,height},density)).toThrow();
 });
});
