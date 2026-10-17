import {describe,it,expect} from 'vitest';
import {prepareRootsInkView,rootsInkViewSourceIndex,rootsNativeInkStatistics,viewRootsNativeMetricInk,presentRootsNativeMetricInk,rootsNativeKernelWeight,rootsNativeInkViewBytes} from '../src/engine/rootsNativeInk';
import {prepareRootsDensityColor} from '../src/engine/rootsDensityColor';

function numbered(width:number,height:number,Float:Float32ArrayConstructor|Float64ArrayConstructor=Float64Array){const a=new Float(width*height*4);for(let i=0;i<width*height;i++){a[i*4]=i+1;a[i*4+1]=(i+1)*.5;}return a;}
const masses=(a:Float32Array|Float64Array)=>Array.from(a).filter((_,i)=>i%4===0);
const metricColor=()=>{const p=prepareRootsDensityColor({settings:{rootDensityColorVersion:'mathart-1.7.8-metric-v1',rootSourceGamma:1,background:'#000000'},rootsSourcePalette:{colors:['#FFFFFF']}});if(p.kind!=='metric-sum')throw new Error('metric');return p;};

describe('native raw ink view before source tone',()=>{
 it.each([Float32Array,Float64Array])('preserves identity row order and independent ownership (%s)',Float=>{
  const ink=numbered(3,2,Float),copy=viewRootsNativeMetricInk(ink,prepareRootsInkView(3,2,0));
  expect(copy).toEqual(ink);expect(copy).not.toBe(ink);expect(copy.constructor).toBe(Float);copy[0]=0;expect(ink[0]).toBe(1);
 });
 it('uses inverse bottom-up rotation with correct top-down rows for positive and negative right angles',()=>{
  // Independent square-grid permutation: +90 maps output top-left to input top-right.
  const ink=numbered(3,3);
  expect(masses(viewRootsNativeMetricInk(ink,prepareRootsInkView(3,3,Math.PI/2)))).toEqual([3,6,9,2,5,8,1,4,7]);
  expect(masses(viewRootsNativeMetricInk(ink,prepareRootsInkView(3,3,-Math.PI/2)))).toEqual([7,4,1,8,5,2,9,6,3]);
 });
 it('rotates with physical aspect rather than stretching the ink to a square',()=>{
  const ink=numbered(4,2),view=prepareRootsInkView(4,2,Math.PI/2);
  expect(masses(viewRootsNativeMetricInk(ink,view))).toEqual([0,3,7,0,0,2,6,0]);
  expect(rootsInkViewSourceIndex(view,0,0)).toBe(-1);
 });
 it('retains accumulation statistics independently of cropped presentation',()=>{
  const ink=numbered(4,2),result=presentRootsNativeMetricInk(ink,prepareRootsInkView(4,2,Math.PI/2),metricColor(),8);
  expect(result.accumulated).toEqual({occupiedPixels:8,maxCount:8,totalMass:36});
  expect(result.displayed).toEqual({occupiedPixels:4,maxCount:7,totalMass:18});
  expect(Array.from(result.pixels.slice(0,4))).toEqual([0,0,0,255]);expect(result.toneBackend).toBe('cpu');
 });
 it('keeps a clipped-away submitted point in the exposure denominator',()=>{
  const ink=new Float64Array([1,.5,0,0]);
  const a=presentRootsNativeMetricInk(ink,prepareRootsInkView(1,1,0),metricColor(),1),b=presentRootsNativeMetricInk(ink,prepareRootsInkView(1,1,0),metricColor(),1000);
  expect(a.accumulated).toEqual(b.accumulated);expect(a.pixels[0]).toBeGreaterThan(b.pixels[0]);
 });
 it('validates clipped-away malformed ink and leaves original data untouched',()=>{
  const ink=numbered(4,2);ink[1]=NaN;
  expect(()=>viewRootsNativeMetricInk(ink,prepareRootsInkView(4,2,Math.PI/2))).toThrow('无效');expect(Number.isNaN(ink[1])).toBe(true);
 });
 it('rejects unsupported layouts and invalid camera-derived view facts before allocation',()=>{
  expect(()=>viewRootsNativeMetricInk(new Float32Array(3),prepareRootsInkView(1,1,0))).toThrow('完整');
  expect(()=>prepareRootsInkView(0,1,0)).toThrow();expect(()=>prepareRootsInkView(1,1,1e40)).toThrow('float32');
  expect(()=>viewRootsNativeMetricInk(new Float32Array(4),{...prepareRootsInkView(1,1,0),cosine:NaN})).toThrow('计划');
  expect(()=>rootsInkViewSourceIndex(prepareRootsInkView(1,1,0),1,0)).toThrow('越界');
  expect(()=>rootsNativeInkStatistics(new Float32Array([1,2,0,0]),1,1)).toThrow('无效');
 });
 it('accounts representation expansion and cancels without mutating borrowed ink',()=>{
  expect(rootsNativeInkViewBytes(3840,2160,8)).toBe(3840*2160*(32+32+4));
  const ink=numbered(17,11),before=ink.slice();let count=0;
  expect(()=>viewRootsNativeMetricInk(ink,prepareRootsInkView(17,11,.2),()=>++count>4)).toThrow('取消');expect(ink).toEqual(before);
 });
 it('rejects invalid tone/exposure before scanning or selecting full-size ink',()=>{
  const ink=numbered(4,2),view=prepareRootsInkView(4,2,.1);let calls=0;
  const stop=()=>{calls++;return true;};
  expect(()=>presentRootsNativeMetricInk(ink,view,metricColor(),NaN,stop)).toThrow('有限提交点数');
  expect(()=>presentRootsNativeMetricInk(ink,view,{...metricColor(),lut:new Uint8Array(4)},8,stop)).toThrow('合同');
  expect(calls).toBe(0);
 });
});

describe('retained source fragment radial reference',()=>{
 it('uses the points smoothstep .70→1 and circular discard',()=>{
  expect(rootsNativeKernelWeight('points',0,0,1)).toBe(1);
  expect(rootsNativeKernelWeight('points',Math.sqrt(.85),0,3)).toBeCloseTo(.5,14);
  expect(rootsNativeKernelWeight('points',1,0,1)).toBe(0);
  expect(rootsNativeKernelWeight('points',.8,.8,1)).toBe(0);
 });
 it('keeps quad edge coverage and exponential core distinct from the points kernel',()=>{
  // At center diameter=1: t=(-.5+.75)/1.5=1/6, coverage=25/27.
  expect(rootsNativeKernelWeight('quad',0,0,1)).toBeCloseTo(25/27,14);
  expect(rootsNativeKernelWeight('quad',1,0,1)).toBeCloseTo(.5*Math.exp(-.45),14);
  expect(rootsNativeKernelWeight('quad',1,1,1)).toBe(0);
  // Fragment formula alone has support beyond one axis, but quad geometry does not.
  expect(rootsNativeKernelWeight('quad',1.1,0,1)).toBe(0);
 });
 it('does not silently accept malformed kernel inputs',()=>{
  expect(()=>rootsNativeKernelWeight('points',0,NaN,1)).toThrow();expect(()=>rootsNativeKernelWeight('quad',0,0,0)).toThrow();
 });
});
