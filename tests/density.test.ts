import {describe,it,expect} from 'vitest';
import {accumulateDensity,accumulateDensityInto,presentPointFrames,toneDensity,presentPoints,densityControls,densityDefaults,type DensityGrid,type DensityRaster} from '../src/engine/density';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import type {Palette,SceneOutput,GenerateContext,SceneKind,Settings} from '../src/types';
const palette:Palette={name:'white',stops:['#ffffff','#ffffff'],mode:'linear',offset:0,cycles:1};
const bounds={minX:-1,maxX:1,minY:-1,maxY:1};
const context:GenerateContext={time:1,quality:'preview',width:64,height:48};
const positions=(values:number[])=>new Float32Array(values);
const pixel=(pixels:Uint8ClampedArray,i=0)=>Array.from(pixels.slice(i*4,i*4+4));
const sum=(a:Uint32Array)=>a.reduce((x,y)=>x+y,0);
const grid=(counts:number[],colors?:number[]):DensityGrid=>({width:counts.length,height:1,counts:new Uint32Array(counts),colorSums:colors?new Float64Array(colors):undefined,stats:{projection:'xy',bounds,inputPoints:counts.reduce((x,y)=>x+y,0),examined:counts.reduce((x,y)=>x+y,0),accepted:counts.reduce((x,y)=>x+y,0),clipped:0,invalid:0,occupiedPixels:counts.filter(Boolean).length,maxCount:Math.max(...counts),cancelled:false}});
const tone={toneMap:'linear',gamma:1,dynamicRange:4,transparentBackground:true};
function output(p:number[],colors?:number[]):SceneOutput{return{type:'geometry',topology:'points',positions:positions(p),colors:colors?positions(colors):undefined,stats:{samples:p.length/3+10,generated:p.length/3,invalid:10}};}

describe('density point-count accumulation',()=>{
 it('conserves counts at all four closed edges and uses upward mathematical y',()=>{
  const result=accumulateDensity({positions:positions([-1,1,0,1,1,0,-1,-1,0,1,-1,0,-1,1,0])},2,2,{bounds});
  expect([...result.counts]).toEqual([2,1,1,1]);expect(sum(result.counts)).toBe(5);expect(result.stats).toMatchObject({accepted:5,examined:5,occupiedPixels:4,maxCount:2,invalid:0,clipped:0});
 });
 it('separates nonfinite coordinates from finite points outside the viewport',()=>{
  const result=accumulateDensity({positions:positions([0,0,0,2,0,0,0,-2,0,NaN,0,0,0,0,Infinity])},4,4,{bounds});
  expect(result.stats).toMatchObject({inputPoints:5,examined:5,accepted:1,clipped:2,invalid:2});expect(sum(result.counts)).toBe(1);
 });
 it('projects the requested coordinate pair without losing counts',()=>{
  const input={positions:positions([0,0,-1,0,0,1])};
  for(const projection of ['xy','xz','yz'] as const){const result=accumulateDensity(input,2,2,{bounds,projection});expect(sum(result.counts)).toBe(2);expect(result.stats.occupiedPixels).toBe(projection==='xy'?1:2);}
 });
 it('fits the aspect ratio and contains degenerate, empty, and large-coordinate inputs',()=>{
  for(const input of [[],[0,0,0],[3e38,3e38,0],[0,-2,0,0,2,0]]){const result=accumulateDensity({positions:positions(input)},12,6,{padding:0});expect(result.stats.accepted).toBe(input.length/3);const b=result.stats.bounds;expect((b.maxX-b.minX)/(b.maxY-b.minY)).toBeCloseTo(2,5);expect(Object.values(b).every(Number.isFinite)).toBe(true);}
 });
 it('accumulates exact per-pixel source color sums',()=>{
  const result=accumulateDensity({positions:positions([0,0,0,0,0,0]),colors:positions([1,0,0,0,0,1])},1,1,{bounds});
  expect([...result.colorSums!]).toEqual([1,0,1]);expect(result.counts[0]).toBe(2);
 });
 it('rejects malformed arrays, invalid viewports, resolutions, projections and colors',()=>{
  const input={positions:positions([0,0,0])};
  expect(()=>accumulateDensity({positions:positions([0,0])},1,1)).toThrow('三元');
  expect(()=>accumulateDensity({...input,colors:positions([1])},1,1)).toThrow('RGB');
  expect(()=>accumulateDensity({...input,colors:positions([NaN,0,0])},1,1)).toThrow('RGB');
  expect(()=>accumulateDensity(input,1.5,2)).toThrow();expect(()=>accumulateDensity(input,8192,8192)).toThrow('像素');
  expect(()=>accumulateDensity(input,2,2,{bounds:{...bounds,minX:1}})).toThrow('递增');
  expect(()=>accumulateDensity(input,2,2,{projection:'bad' as any})).toThrow('投影');
  expect(()=>accumulateDensity(input,2,2,{padding:-1})).toThrow('边距');
 });
 it('stops with a precise prefix count and leaves input arrays unchanged',()=>{
  const p=new Float32Array(8192*3);let calls=0;
  const result=accumulateDensity({positions:p},4,4,{bounds,isCancelled:()=>++calls>=2});
  expect(result.stats).toMatchObject({examined:4096,accepted:4096,cancelled:true});expect(sum(result.counts)).toBe(4096);expect(p.every(v=>v===0)).toBe(true);
  const cancelled=accumulateDensity({positions:p},4,4,{isCancelled:()=>true});expect(cancelled.stats.accepted).toBe(0);expect(cancelled.stats.cancelled).toBe(true);
 });
 it('retains one million distinct samples in a detailed image reproducibly',()=>{
  const n=1_048_576,p=new Float32Array(n*3);
  for(let i=0;i<n;i++){p[i*3]=((i%1024)*2+.5)/2048;p[i*3+1]=(Math.floor(i/1024)*2+.5)/2048;}
  const options={bounds:{minX:0,maxX:1,minY:0,maxY:1}},a=accumulateDensity({positions:p},2048,2048,options),b=accumulateDensity({positions:p},2048,2048,options);
  expect(a.stats).toMatchObject({accepted:n,occupiedPixels:n,maxCount:1,invalid:0,clipped:0});expect(sum(a.counts)).toBe(n);
  expect(Buffer.compare(Buffer.from(a.counts.buffer),Buffer.from(b.counts.buffer))).toBe(0);
  const pixels=toneDensity(a,palette,{...tone,dynamicRange:1});let opaque=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])opaque++;
  expect(opaque).toBe(n);expect(pixels.length).toBe(2048*2048*4);
 },15000);
});

describe('density tone mapping and straight alpha',()=>{
 it('uses linear point density and log point density with an explicit white point',()=>{
  expect(pixel(toneDensity(grid([1]),palette,tone))).toEqual([255,255,255,64]);
  expect(pixel(toneDensity(grid([4]),palette,tone))).toEqual([255,255,255,255]);
  expect(pixel(toneDensity(grid([1]),palette,{...tone,toneMap:'log',dynamicRange:9}))[3]).toBe(Math.round(255*Math.log(2)/Math.log(10)));
 });
 it('applies exposure, gamma, contrast, brightness and dynamic range numerically',()=>{
  const image=(settings:Record<string,number>)=>pixel(toneDensity(grid([1]),palette,{...tone,...settings}))[3];
  expect(image({exposure:1})).toBe(128);expect(image({gamma:2})).toBe(128);expect(image({contrast:2})).toBe(0);expect(image({brightness:.25})).toBe(128);expect(image({dynamicRange:2})).toBe(128);
 });
 it('preserves transparent emptiness and composites occupied pixels over an opaque background',()=>{
  expect(pixel(toneDensity(grid([0]),palette,{...tone,brightness:1}))).toEqual([0,0,0,0]);
  expect(pixel(toneDensity(grid([0]),palette,{...tone,transparentBackground:false,background:'#204060',brightness:1}))).toEqual([32,64,96,255]);
  expect(pixel(toneDensity(grid([1]),palette,{...tone,transparentBackground:false,background:'#000000'}))).toEqual([64,64,64,255]);
 });
 it('averages source colors and controls chroma without altering count density',()=>{
  const a=grid([2],[1,0,1]),settings={...tone,paletteMode:'source',dynamicRange:2};
  expect(pixel(toneDensity(a,palette,settings))).toEqual([128,0,128,255]);
  const gray=pixel(toneDensity(a,palette,{...settings,saturation:0}));expect(gray[0]).toBe(gray[1]);expect(gray[1]).toBe(gray[2]);expect(gray[3]).toBe(255);
  const colorful:Palette={...palette,stops:['#ff0000','#0000ff']};expect(pixel(toneDensity(a,colorful,{...settings,paletteMode:'density'}))).toEqual([0,0,255,255]);
 });
 it('is deterministic, monotone in count, and does not mutate its input grid',()=>{
  const a=grid([0,1,2,4,8,16]);const first=toneDensity(a,palette,{...tone,toneMap:'log',dynamicRange:16}),second=toneDensity(a,palette,{...tone,toneMap:'log',dynamicRange:16});expect(first).toEqual(second);
  let previous=-1;for(let i=3;i<first.length;i+=4){expect(first[i]).toBeGreaterThanOrEqual(previous);previous=first[i];}expect([...a.counts]).toEqual([0,1,2,4,8,16]);
 });
 it('rejects malformed tone settings and absent source color evidence',()=>{
  for(const s of [{gamma:0},{exposure:Infinity},{dynamicRange:0},{saturation:-1},{toneMap:'histogram'},{paletteMode:'source'},{transparentBackground:'yes'},{background:'red'}] as Settings[])expect(()=>toneDensity(grid([1]),palette,s)).toThrow();
  expect(()=>toneDensity({...grid([1]),counts:new Uint32Array(2)},palette)).toThrow('长度');
 });
});

describe('scene density integration',()=>{
 it('leaves points untouched and rejects unsupported presentation modes',()=>{
  const scene=createScene(definition('map')),source=output([0,0,0]);expect(presentPoints(source,scene,context)).toBe(source);
  scene.settings.presentation='unknown';expect(()=>presentPoints(source,scene,context)).toThrow('presentation');
 });
 it('retains mathematical stats, reports clipping, and selects the actual output projection',()=>{
  const scene=createScene(definition('map'));Object.assign(scene.settings,{presentation:'density',densityView:'manual',densitySpan:2,densityProjection:'xz'});
  const result=presentPoints(output([0,0,0,0,0,2]),scene,{...context,width:16,height:16}) as DensityRaster;
  expect(result.type).toBe('raster');expect(result.dimension).toBe(2);expect(result.stats).toMatchObject({samples:12,generated:1,invalid:10});expect(result.density).toMatchObject({projection:'xz',accepted:1,clipped:1});expect(result.warnings?.join()).toContain('视口之外');
 });
 it('caps output allocation while accumulating every supplied point',()=>{
  const scene=createScene(definition('map'));scene.settings.presentation='density';const result=presentPoints(output([0,0,0,1,1,0]),scene,{...context,width:4096,height:4096}) as DensityRaster;
  expect(result.width*result.height).toBe(1_048_576);expect(result.density.accepted).toBe(2);expect(result.warnings?.join()).toContain('4096');
 });
 for(const kind of ['map','symmetry','samila','roots'] as SceneKind[])it(`${kind} exposes density controls and creates reproducible actual rasters`,()=>{
  const def=definition(kind),scene=createScene(def);Object.assign(scene.settings,{count:2000,sampleCount:20,burnIn:10,presentation:'density'});
  const a=def.generate(scene,context) as DensityRaster,b=def.generate(scene,context) as DensityRaster;
  expect(a.type).toBe('raster');expect(a.pixels).toEqual(b.pixels);expect(a.density.accepted).toBeGreaterThan(0);expect(a.density.accepted).toBe(a.stats.generated);expect(a.density.occupiedPixels).toBeGreaterThan(0);
  const keys=def.controls.map(c=>c.key);for(const control of densityControls)expect(keys).toContain(control.key);expect(new Set(keys).size).toBe(keys.length);
  scene.settings.paletteMode='source';const sourceColors=def.generate(scene,context) as DensityRaster;expect(sourceColors.type).toBe('raster');expect(sourceColors.density.accepted).toBe(a.density.accepted);expect(sourceColors.pixels).not.toEqual(a.pixels);
  scene.settings.presentation='points';const raw=def.generate(scene,context);expect(raw.type).toBe('geometry');expect(raw.stats.samples).toBe(a.stats.samples);expect(raw.stats.generated).toBe(a.density.inputPoints);
  Object.assign(scene.settings,{presentation:'density',paletteMode:'density'});const converted=presentPoints(raw,scene,context) as DensityRaster;expect(converted.pixels).toEqual(a.pixels);
 });
 it('validates every default as a real renderer setting and supports source coloring',()=>{
  const scene=createScene(definition('map'));Object.assign(scene.settings,densityDefaults,{presentation:'density',paletteMode:'source'});
  const image=presentPoints(output([0,0,0],[1,0,0]),scene,context) as DensityRaster;expect(image.density.accepted).toBe(1);expect(image.pixels.some((v,i)=>i%4===0&&v>0)).toBe(true);
 });
 it('returns an honest empty raster when cancelled and rejects nonpoint geometry',()=>{
  const scene=createScene(definition('map'));scene.settings.presentation='density';const result=presentPoints(output([0,0,0]),scene,{...context,isCancelled:()=>true}) as DensityRaster;
  expect(result.density.cancelled).toBe(true);expect(result.stats.generated).toBe(0);expect(result.density.examined).toBe(0);expect(result.warnings?.join()).toContain('取消');
  const lines={...output([0,0,0]),topology:'lines'} as SceneOutput;expect(()=>presentPoints(lines,scene,context)).toThrow('点几何');
 });
});

describe('streamed and weighted history density',()=>{
 it('retains exact raw observations while applying weights to intensity and source RGB',()=>{
  const a=accumulateDensity({positions:positions([0,0,0]),colors:positions([1,0,0])},1,1,{bounds,weight:.25});
  const counts=a.counts,colors=a.colorSums;
  accumulateDensityInto(a,{positions:positions([0,0,0]),colors:positions([0,0,1])},undefined,1);
  expect(a.counts).toBe(counts);expect(a.colorSums).toBe(colors);expect([...a.counts]).toEqual([2]);expect([...a.weights!]).toEqual([1.25]);expect([...a.colorSums!]).toEqual([.25,0,1]);
  expect(a.stats).toMatchObject({accepted:2,inputPoints:2,examined:2,maxCount:2});
  expect(pixel(toneDensity(a,palette,{...tone,dynamicRange:2,paletteMode:'source'}))).toEqual([51,0,204,159]);
 });
 it('supports a zero-weight historical frame without losing count statistics',()=>{
  const a=accumulateDensity({positions:positions([0,0,0])},1,1,{bounds,weight:0});
  expect(a.stats.accepted).toBe(1);expect(a.counts[0]).toBe(1);expect(pixel(toneDensity(a,palette,tone))).toEqual([0,0,0,0]);
  accumulateDensityInto(a,{positions:positions([0,0,0])});expect(a.weights![0]).toBe(1);expect(a.counts[0]).toBe(2);
 });
 it('uses one viewport across all frames and equals concatenated point counts before tone mapping',()=>{
  const scene=createScene(definition('map'));Object.assign(scene.settings,{presentation:'density',densityPadding:0,...tone,dynamicRange:2});scene.palette=palette;
  const frames=[output([-2,0,0,0,0,0]),output([2,0,0,0,0,0])];
  const a=presentPointFrames(frames,scene,{...context,width:4,height:2}),b=presentPoints(output([-2,0,0,0,0,0,2,0,0,0,0,0]),scene,{...context,width:4,height:2}) as DensityRaster;
  expect(a.pixels).toEqual(b.pixels);expect(a.density).toEqual(b.density);expect(a.density.accepted).toBe(4);
  expect(a.density.bounds.minX).toBe(-2);expect(a.density.bounds.maxX).toBe(2);
 });
 it('uses the palette owner for curve mode instead of restricting it to legacy modes',()=>{
  const curved:Palette={...palette,mode:'curve',curves:{red:[{x:0,y:1},{x:1,y:1}],green:[{x:0,y:0},{x:1,y:0}],blue:[{x:0,y:0},{x:1,y:0}]}};
  expect(pixel(toneDensity(grid([1]),curved,tone))).toEqual([255,0,0,64]);
 });
 it('rejects mismatched accumulation buffers and weights before adding observations',()=>{
  const a=grid([1]);a.weights=new Float64Array(2);
  expect(()=>accumulateDensityInto(a,{positions:positions([0,0,0])})).toThrow('长度');expect(a.stats.accepted).toBe(1);
  expect(()=>accumulateDensity({positions:positions([0,0,0])},1,1,{bounds,weight:-1})).toThrow('权重');
  const scene=createScene(definition('map'));expect(()=>presentPointFrames([output([0,0,0])],scene,context,[1,1])).toThrow('权重');
 });
});
