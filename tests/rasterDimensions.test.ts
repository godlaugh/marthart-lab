import {describe,it,expect} from 'vitest';
import {rasterDimensions} from '../src/engine/rasterDimensions';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';

describe('mathematical raster resolution',()=>{
 it('preserves requested export dimensions even for expensive formulas and guards allocation',()=>{
  for(const backend of ['cpu','webgl2'] as const)expect(rasterDimensions({time:0,quality:'export',width:3840,height:2160},4096*12,backend,[])).toEqual([3840,2160]);
  expect(()=>rasterDimensions({time:0,quality:'export',width:16384,height:16384},1,'cpu',[])).toThrow('128 MiB');
  const warnings:string[]=[];expect(rasterDimensions({time:0,quality:'preview',width:3840,height:2160},4096,'cpu',warnings)[0]).toBeLessThan(3840);expect(warnings).toHaveLength(1);
 });
 it('computes every export pixel on the CPU fallback instead of resizing a coarse image',()=>{
  const d=definition('fractal'),scene=createScene(d);Object.assign(scene.settings,{fractalBackend:'cpu',centerX:20,centerY:20,iterations:4096});
  const output=d.generate(scene,{time:0,quality:'export',width:224,height:192});
  expect(output.type).toBe('raster');if(output.type!=='raster')return;
  expect([output.width,output.height]).toEqual([224,192]);expect(output.stats.samples).toBe(224*192);expect(output.pixels.length).toBe(224*192*4);
 });
 it('preserves domain dimensions and cancellation at high supersampling cost',()=>{
  const d=definition('domain'),scene=createScene(d);Object.assign(scene.settings,{domainBackend:'cpu',iterationEnabled:true,iterationSteps:64,supersampling:3,centerX:20,centerY:20,bailout:4});
  expect(()=>d.generate(scene,{time:0,quality:'export',width:400,height:300,isCancelled:()=>true})).toThrowError(expect.objectContaining({name:'AbortError'}));
  const output=d.generate(scene,{time:0,quality:'export',width:400,height:300});
  expect(output.type).toBe('raster');if(output.type!=='raster')return;
  expect([output.width,output.height]).toEqual([400,300]);expect(output.stats.samples).toBe(400*300*9);expect(output.pixels.length).toBe(400*300*4);
 });
});
