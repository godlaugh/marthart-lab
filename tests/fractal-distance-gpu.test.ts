import {describe,it,expect} from 'vitest';
import {unpackGpuOrbit} from '../src/engine/fractalGpu';
import {FRACTAL_DISTANCE_GPU_STRIDE,prepareFractalDistance} from '../src/engine/fractalDistance';

const config=(formula='mandelbrot')=>({distance:prepareFractalDistance({fractalDistanceVersion:'mathart-1.7.8-v1',fractalColorVersion:2,outsideColoring:'distance_estimator'},{formula,power:[2,0],variant:'mandelbrot'})});
const values=Float32Array.of(10,0,3,0,17,0,1,0);
describe('actual GPU DE result decoding',()=>{
 it('preserves captured value/validity and high coordinates without CPU recomputation',()=>{
  const record=Float32Array.of(65,0,Math.fround(20*Math.log(10)/65),1,10,0,2,1,0,1,0,0);
  const orbit=unpackGpuOrbit(values,0,undefined,config(),record);
  expect(record.length).toBe(FRACTAL_DISTANCE_GPU_STRIDE);
  expect(orbit.distance).toEqual({version:'mathart-1.7.8-v1',path:'perturbation',derivative:[65,0],estimate:{valid:true,value:record[2]},finalZHigh:[10,0],iteration:2,exitKind:1,residualSquared:0});
  // The captured source derivative also owns the common orbit field.
  // Keeping the old derivative=17 would leave two conflicting interpretations.
  expect(orbit.derivative).toEqual([65,0]);
 });
 it('accepts nonfinite derivative as an invalid estimate, not an invalid orbit',()=>{
  const record=Float32Array.of(Infinity,NaN,0,0,10,0,2,1,0,0,0,0);
  const orbit=unpackGpuOrbit(values,0,undefined,config(),record);
  expect(orbit.invalid).toBe(false);expect(orbit.distance?.derivative[0]).toBe(Infinity);expect(orbit.distance?.derivative[1]).toBeNaN();expect(orbit.distance?.estimate).toEqual({valid:false,value:0,reason:'invalid-distance'});
 });
 it('keeps residual high-only facts separate from reconstructed dual-float orbit',()=>{
  const residual=Float32Array.of(1e-7,2e-8,.25,1e-9,.25,1e-9,1,2),record=Float32Array.of(1,0,.5,1,10,0,2,2,.0625,0,0,0);
  const orbit=unpackGpuOrbit(Float32Array.of(10,0,3,4,1,0,1,0),0,residual,config('binocular'),record);
  expect(orbit.z[0]).toBe(10+residual[0]);expect(orbit.distance?.finalZHigh).toEqual([10,0]);expect(orbit.distance?.residualSquared).toBe(.0625);
 });
 it('capability-disabled and inside facts retain distinct reasons',()=>{
  const record=Float32Array.of(0,0,0,0,10,0,2,1,0,0,0,0);
  expect(unpackGpuOrbit(values,0,undefined,config('magnet1'),record).distance?.estimate).toEqual({valid:false,value:0,reason:'capability-disabled'});
  record[7]=0;expect(unpackGpuOrbit(values,0,undefined,config(),record).distance?.estimate).toEqual({valid:false,value:0,reason:'not-escaped'});
 });
 it('rejects absent or malformed required side records; omission still decodes legacy output',()=>{
  expect(unpackGpuOrbit(values,0).distance).toBeUndefined();expect(()=>unpackGpuOrbit(values,0,undefined,config())).toThrow('missing');
  for(const [index,value]of [[3,2],[6,-1],[7,3],[9,2],[2,Infinity]] as const){const record=Float32Array.of(1,0,.5,1,10,0,2,1,0,0,0,0);record[index]=value;expect(()=>unpackGpuOrbit(values,0,undefined,config(),record)).toThrow('invalid');}
 });
});
