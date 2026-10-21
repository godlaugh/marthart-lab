import {describe,expect,it} from 'vitest';
import {sourceRecordingSize} from '../src/engine/sourceRecordingSize';

describe('shared MathArt recording render-buffer dimensions',()=>{
 it('keeps logical viewport size and physical input pixels from the same inherited-density calculation',()=>{
  // MathArt.ensureRenderBuffer(F) PCs0–42: round(F(F(request*3)/density)).
  expect(sourceRecordingSize({width:17,height:13},2)).toEqual({logicalWidth:26,logicalHeight:20,width:52,height:40,density:2});
  expect(sourceRecordingSize({width:255,height:193},2)).toEqual({logicalWidth:383,logicalHeight:290,width:766,height:580,density:2});
  expect(sourceRecordingSize({width:255,height:193},1)).toEqual({logicalWidth:765,logicalHeight:579,width:765,height:579,density:1});
 });
 it('does not subtract odd encoder output dimensions before constructing the input',()=>{
  const requested={width:17,height:13},copy={...requested},result=sourceRecordingSize(requested,2);
  expect(result.width).not.toBe(16*3);expect(result.height).not.toBe(12*3);expect(requested).toEqual(copy);
 });
 it('inherits the existing physical target budget without silently reducing scale',()=>{
  expect(sourceRecordingSize({width:960,height:540},2)).toEqual({logicalWidth:1440,logicalHeight:810,width:2880,height:1620,density:2});
  expect(()=>sourceRecordingSize({width:1920,height:1080},2)).toThrow('预算');
 });
 it.each([[0,13,1],[-1,13,1],[17.5,13,1],[17,Infinity,1],[17,13,0],[17,13,1.5],[17,13,NaN],[1,1,10],[6000,1,1],[Number.MAX_SAFE_INTEGER,13,1]])('rejects unsupported dimensions %s×%s at density %s',(width,height,density)=>{
  expect(()=>sourceRecordingSize({width,height},density)).toThrow();
 });
});
