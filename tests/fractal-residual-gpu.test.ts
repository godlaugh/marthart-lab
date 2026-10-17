import {describe,it,expect} from 'vitest';
import {fractalConfig,definitions} from '../src/scenes/complex';
import {unpackGpuOrbit,FractalGpu} from '../src/engine/fractalGpu';
import {FractalResidualGpu,residualGpuCapability} from '../src/engine/fractalResidualGpu';
const def=definitions.find(d=>d.kind==='fractal')!;
const config=(patch={})=>fractalConfig({...def.defaults.settings,formula:'magnet1',convergenceMode:'residual',...patch});
const view={centerX:0,centerY:0,centerXLow:0,centerYLow:0,zoom:1,rotation:0};
describe('residual GPU producer contracts',()=>{
 it('unpacks zero-based color iteration and separate metric/residual without changing legacy records',()=>{
  const values=Float32Array.from([.25,0,1,4,0,0,.5,0]),facts=Float32Array.from([1e-9,0,.75,1e-9,0,0,2,0]);
  expect(unpackGpuOrbit(values,0,facts)).toMatchObject({z:[.25+facts[0],0],count:1,colorIteration:0,inside:false,converged:true,convergence:{iteration:0,metric:'fixed-point',distance:.75+facts[3],colorResidual:0}});
  expect(unpackGpuOrbit(values,0)).not.toHaveProperty('convergence');expect(unpackGpuOrbit(values,0)).not.toHaveProperty('colorIteration');
  facts[6]=1;facts[4]=.125;facts[7]=7;expect(unpackGpuOrbit(values,0,facts).convergence).toMatchObject({metric:'step',iteration:7,colorResidual:.125});
 });
 it('retains iteration-limit inside classification independently of residual metadata',()=>{const values=Float32Array.from([1,0,32,1,0,0,.5,0]),facts=Float32Array.from([0,0,0,0,0,0,0,31]);expect(unpackGpuOrbit(values,0,facts)).toMatchObject({inside:true,converged:false,count:32,colorIteration:31});expect(unpackGpuOrbit(values,0,facts).convergence).toBeUndefined();});
 it('bounds batches before GL allocation and preserves explicit non-capability reasons',()=>{const g=new FractalResidualGpu();try{expect(g.sample(new Float32Array([NaN,0]),1,1,view,config()).warning).toContain('有限像素');expect(g.sample(new Float32Array(131074),1,1,view,config()).warning).toContain('65536');expect(g.sample(new Float32Array([0,0]),0,1,view,config()).warning).toContain('正整数');expect(g.sample(new Float32Array(),1,1,view,config())).toEqual({values:new Float32Array(),residual:new Float32Array()});expect(residualGpuCapability(config({formula:'mandelbrot'}))).toContain('只接受');expect(residualGpuCapability(config({formula:'binocular',power:2.5}))).toContain('非整数');expect(residualGpuCapability(config({formula:'binocular',power:4}))).toBeUndefined();}finally{g.dispose();}});
 it('keeps Newton/Nova step separate from the rational residual kernel',()=>{const g=new FractalGpu();try{expect(g.sample(new Float32Array([0,0]),1,1,view,config({formula:'newton',convergenceMode:'step'})).warning).toContain('Newton/Nova');}finally{g.dispose();}});
});
