import {describe,it,expect,vi} from 'vitest';
import {SourcePerlinGpu,prepareSourcePerlinGpuUniforms,sourcePerlinFlowTextureSize,sourcePerlinGpuLayout,type SourcePerlinGpuFrame} from '../src/engine/sourcePerlinGpu';
const frame=():SourcePerlinGpuFrame=>({width:64,height:48,palette:new Uint32Array(256).fill(0xff808080),time:0,noiseFrequency:1.5,warpAmplitude:.1,warpFrequency:2,directionOffset:0,timeSpeed:1,marchSteps:32,stepSize:.008,brightness:1.7,vignettePower:.1,fiberStrength:.7,renderStyle:0});
const channel=()=>({size:512 as const,pixels:new Uint32Array(512*512)});
describe('source Perlin GPU admission and host uniform boundary',()=>{
 it('chooses source physical-size buckets at exact thresholds',()=>{
  expect([1079,1080,2159,2160].map(w=>sourcePerlinFlowTextureSize(w,1))).toEqual([512,1024,1024,2048]);
  expect(sourcePerlinFlowTextureSize(10,2161)).toBe(2048);
 });
 it('applies source host clamps while preserving shader-owned style and upper march bounds',()=>{
  const p=prepareSourcePerlinGpuUniforms({...frame(),noiseFrequency:-1,warpAmplitude:-1,warpFrequency:-1,stepSize:-1,brightness:-1,vignettePower:-1,fiberStrength:2,marchSteps:1000,renderStyle:2,timeSpeed:-3});
  expect(p).toMatchObject({noiseFrequency:Math.fround(.01),warpAmplitude:0,warpFrequency:0,stepSize:Math.fround(.0001),brightness:0,vignettePower:Math.fround(.001),fiberStrength:1,marchSteps:1000,renderStyle:2,timeSpeed:-3});
  expect(Object.isFrozen(p)).toBe(true);
 });
 it('counts complete mipmapped texture and output representations before allocation',()=>{
  expect(sourcePerlinGpuLayout(3840,2160,128)).toMatchObject({size:2048,work:3840*2160*128});
  expect(()=>sourcePerlinGpuLayout(8192,4096,32)).toThrow(/像素/);
  expect(()=>sourcePerlinGpuLayout(4096,4096,128)).toThrow(/迭代/);
 });
 it.each([NaN,Infinity,1e40])('rejects nonfinite shader state %s',time=>expect(()=>prepareSourcePerlinGpuUniforms({...frame(),time})).toThrow(/float/));
 it('requires complete source channel/palette arrays rather than local LUTs',()=>{
  expect(()=>new SourcePerlinGpu({size:512,pixels:new Uint32Array(1)})).toThrow(/ARGB/);
  const g=new SourcePerlinGpu(channel());expect(()=>g.render({...frame(),palette:new Uint32Array(1024)})).toThrow(/256/);g.dispose();
 });
 it('rejects bucket changes before creating a GPU context',()=>{
  const canvas=vi.fn();vi.stubGlobal('OffscreenCanvas',canvas);
  try{const g=new SourcePerlinGpu(channel());expect(()=>g.render({...frame(),width:1081})).toThrow(/档位/);expect(canvas).not.toHaveBeenCalled();g.dispose();}finally{vi.unstubAllGlobals();}
 });
 it('cancellation invalidates the owner without GPU allocation',()=>{
  const canvas=vi.fn();vi.stubGlobal('OffscreenCanvas',canvas);
  try{const g=new SourcePerlinGpu(channel());expect(()=>g.render(frame(),()=>true)).toThrow(/取消/);expect(()=>g.render(frame())).toThrow(/重建/);expect(canvas).not.toHaveBeenCalled();g.dispose();g.dispose();}finally{vi.unstubAllGlobals();}
 });
 it('does not label a fallback as a source GPU image',()=>{
  vi.stubGlobal('OffscreenCanvas',undefined);
  try{const g=new SourcePerlinGpu(channel());expect(()=>g.render(frame())).toThrow(/OffscreenCanvas/);g.dispose();expect(()=>g.render(frame())).toThrow(/释放/);}finally{vi.unstubAllGlobals();}
 });
});
