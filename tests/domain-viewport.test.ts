import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {createScene,parseScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {complexPixel} from '../src/engine/complexViewport';
import {domainPixel,domainExplorePoint,domainIdealPoint,domainPixelSpan,domainViewportGpuReason,parseDomainViewportVersion,prepareDomainViewport,type DomainViewportVersion} from '../src/engine/domainViewport';
import {planeNavigation,panPlane,zoomPlane,fitPlane} from '../src/engine/planeNavigation';
import {parseDomainModel,domainEvaluator,shadeDomainValue,domainControlSettings,visibleDomainControls} from '../src/engine/domainModel';
import {generateDomain} from '../src/engine/domain';
import {domainGpu} from '../src/engine/domainGpu';
import {prepareDomainRaster,domainRasterFragment,DOMAIN_TILE_WIDTH,DOMAIN_TILE_HEIGHT} from '../src/engine/domainGpuRaster';
import type {DomainGpuSource} from '../src/engine/domainExpressions';
import type {DomainGpuColorPlan} from '../src/engine/domainGpuColor';
import {domainGpuSource} from '../src/engine/domainGpu';
const sourceVersions=['mathart-1.7.8-cpu','mathart-1.7.8-gpu'] as const;
const scene=(version:DomainViewportVersion='local-v1')=>{const s=createScene(definition('domain'));Object.assign(s.settings,{domainViewportVersion:version,domainBackend:'cpu',scale:2.5,rotation:.7,centerX:.13,centerY:-.27});s.equations={f:'sin(z)+z/3'};return s;};
afterEach(()=>vi.restoreAllMocks());
describe('Domain viewport interpretation and production',()=>{
 it('defaults only omission to legacy and retains authored source scalar values',()=>{
  expect(parseDomainViewportVersion(undefined)).toBe('local-v1');
  for(const invalid of[null,'mathart-1.7.8',0,false,''])expect(()=>parseDomainViewportVersion(invalid)).toThrow();
  for(const version of sourceVersions){
   expect(prepareDomainViewport({domainViewportVersion:version})).toMatchObject({scale:2.5,effectiveScale:2.5,inverseScale:.4,yDirection:1});
   for(const scale of[-1e300,0,1e-10,1e308]){const settings={domainViewportVersion:version,scale},prepared=prepareDomainViewport(settings);expect(prepared.scale).toBe(scale);expect(prepared.effectiveScale).toBe(Math.max(1e-9,scale));expect(settings.scale).toBe(scale);}
  }
  for(const scale of[NaN,Infinity,'2',true])expect(()=>prepareDomainViewport({domainViewportVersion:'mathart-1.7.8-cpu',scale})).toThrow();
 });
 it('retains every local pixel arithmetic order including supersampling and jitter',()=>{
  for(const scale of[.000001,1,2.5,1e12])for(const rotation of[0,.3,1e8]){
   const settings={scale,rotation,centerX:.12345,centerY:-.75},v=prepareDomainViewport(settings),old={...settings,zoom:scale,centerXLow:0,centerYLow:0};
   for(const [w,h] of[[17,13],[13,17]])for(const ss of[1,2,3])for(let j=0;j<ss*ss;j++)for(const [x,y] of[[0,0],[7,3],[w-1,h-1]]){
    const ox=(j%ss+.5)/ss,oy=(Math.floor(j/ss)+.5)/ss;
    expect(domainPixel(x,y,w,h,v,ox,oy)).toEqual(complexPixel(x+ox-.5,y+oy-.5,w,h,old));
   }
   const re=((7+.37)/17-.5)*4*17/13/scale,im=(.5-(3+.61)/13)*4/scale,co=Math.cos(rotation),si=Math.sin(rotation);
   expect(domainExplorePoint(7,3,17,13,v)).toEqual([settings.centerX+re*co-im*si,settings.centerY+re*si+im*co]);
   expect(domainPixelSpan(v,257,.3)).toBe(4/(257*scale*.3));
  }
 });
 it('keeps source CPU low center bits and GPU selected-reference rounding distinct',()=>{
  const settings={centerX:1.00000002,centerY:-2.00000003,scale:1e7,rotation:.7};
  const cpu=prepareDomainViewport({...settings,domainViewportVersion:'mathart-1.7.8-cpu'}),gpu=prepareDomainViewport({...settings,domainViewportVersion:'mathart-1.7.8-gpu'});
  expect(domainPixel(2,1,5,3,cpu)).toEqual([settings.centerX,settings.centerY]);
  expect(domainPixel(2,1,5,3,gpu)).toEqual([Math.fround(settings.centerX),Math.fround(settings.centerY)]);
  expect(domainViewportGpuReason(cpu,5,3)).toMatch(/CPU 视口/);
  const extreme=prepareDomainViewport({domainViewportVersion:'mathart-1.7.8-gpu',scale:1e308,centerX:1.00000002});
  expect(domainPixel(0,0,5,3,extreme)).toEqual([1,0]);expect(domainViewportGpuReason(extreme,5,3)).toBeUndefined();
  const overflow=prepareDomainViewport({domainViewportVersion:'mathart-1.7.8-gpu',centerX:1e300});expect(domainPixel(0,0,5,3,overflow)[0]).toBe(Infinity);expect(domainViewportGpuReason(overflow,5,3)).toMatch(/uniform/);
  expect(domainViewportGpuReason(prepareDomainViewport({domainViewportVersion:'mathart-1.7.8-gpu',scale:1e40}),5,3)).toMatch(/次正规/);
 });
 it('has source y-down and positive rotation, with no downstream conjugation',()=>{
  const cpu=prepareDomainViewport({domainViewportVersion:'mathart-1.7.8-cpu',scale:1});
  expect(domainPixel(1,0,3,3,cpu)[1]).toBeLessThan(0);expect(domainPixel(1,2,3,3,cpu)[1]).toBeGreaterThan(0);
  const rotated=prepareDomainViewport({domainViewportVersion:'mathart-1.7.8-cpu',scale:1,rotation:Math.PI/2});
  const right=domainPixel(2,1,3,3,rotated);expect(right[0]).toBeCloseTo(0,6);expect(right[1]).toBeGreaterThan(0);
  const local=prepareDomainViewport({scale:1});expect(domainPixel(1,0,3,3,local)[1]).toBeGreaterThan(0);
 });
 it('persists raw versions and keeps color, iteration and viewport independent',()=>{
  for(const version of sourceVersions)for(const color of['local-v1','mathart-1.7.8-gpu','mathart-1.7.8-cpu']){
   const s=scene(version);s.settings.domainColorVersion=color;s.settings.iterationEnabled=false;s.equations.next='w+100';
   const parsed=parseScene(JSON.stringify(s)),model=parseDomainModel(parsed,0);expect(model.view.version).toBe(version);expect(model.colorVersion).toBe(color);expect(model.iteration).toBe(false);expect(parsed.settings.scale).toBe(2.5);
  }
 });
 it('uses the declared source reference for full CPU repair and sourceCPU admission',()=>{
  for(const version of sourceVersions){
   const s=scene(version),ctx={width:17,height:13,time:.2,quality:'export' as const},cpu=generateDomain(s,ctx);
   const spy=vi.spyOn(domainGpu,'render').mockImplementation((m,w,h,_pixels,repair)=>{expect(m.view.version).toBe(version);for(let i=0;i<w*h;i++)repair(i);return{samples:w*h,generated:w*h,invalid:0,invalidSamples:0,repaired:w*h,tiles:1,readbackBytes:w*h*8,estimatedScratchBytes:524288};});
   s.settings.domainBackend='gpu';const result=generateDomain(s,ctx);expect(result.backend).toBe(version==='mathart-1.7.8-cpu'?'cpu':'webgl2');if(cpu.type==='raster'&&result.type==='raster')expect(result.pixels).toEqual(cpu.pixels);
   if(version==='mathart-1.7.8-cpu'){expect(spy).not.toHaveBeenCalled();expect(result.warnings?.join(' ')).toMatch(/CPU 视口/);}else expect(spy).toHaveBeenCalledOnce();vi.restoreAllMocks();
  }
 });
 it('keeps omitted/explicit local full images exact and GPU recipe selection explicit',()=>{
  const s=scene(),ctx={width:17,height:13,time:0,quality:'export' as const};delete s.settings.domainViewportVersion;
  const a=generateDomain(s,ctx);s.settings.domainViewportVersion='local-v1';const b=generateDomain(s,ctx);if(a.type==='raster'&&b.type==='raster')expect(a.pixels).toEqual(b.pixels);
  const gpu=parseDomainModel(scene('mathart-1.7.8-gpu'),0),prepared=prepareDomainRaster(gpu,17,13),shader=domainRasterFragment(domainGpuSource(gpu),prepared.color,gpu.view);expect(shader).toContain('cos(viewAngle)');expect(shader).toContain('plane.x*co-plane.y*si');expect(shader).not.toContain('viewZoom');
  const cpu=parseDomainModel(scene('mathart-1.7.8-cpu'),0);expect(()=>prepareDomainRaster(cpu,17,13)).toThrow(/CPU 视口/);
 });
 it('supplies source scale display defaults without modifying or clamping raw values',()=>{
  const settings={domainViewportVersion:'mathart-1.7.8-cpu'};expect(domainControlSettings(settings).scale).toBe(2.5);expect(settings).not.toHaveProperty('scale');
  for(const scale of[-3,1e308])expect(domainControlSettings({...settings,scale}).scale).toBe(scale);
  expect(visibleDomainControls(definition('domain').controls,settings).find(c=>c.key==='scale')).toMatchObject({min:1e-9,max:undefined});
  expect(visibleDomainControls(definition('domain').controls,{}).find(c=>c.key==='scale')?.max).toBe(definition('domain').controls.find(c=>c.key==='scale')?.max);
 });
 it('retains the exact frozen1318 local fragment template and bounds source capture expansion',()=>{
  const fragment=domainRasterFragment({fragmentLibrary:'O'} as DomainGpuSource,{source:'C'} as DomainGpuColorPlan);
  // Generated from the immutable1318 template with O/C library placeholders.
  expect(createHash('sha256').update(fragment).digest('hex')).toBe('c635016a7f81b30d0c21869859251fb0d84989adb9bd47d398bb9b2c6a80b9eb');
  const s=scene('mathart-1.7.8-gpu');s.settings.supersampling=3;const source=prepareDomainRaster(parseDomainModel(s,0),3840,2160);s.settings.domainViewportVersion='local-v1';const local=prepareDomainRaster(parseDomainModel(s,0),3840,2160);
  expect(source.stagingBytes-local.stagingBytes).toBe(DOMAIN_TILE_WIDTH*DOMAIN_TILE_HEIGHT*(4+9*8));
  expect(source.stagingBytes).toBeLessThan(8*1024*1024);expect(source.attachmentBytes).toBe(3840*2160*8);expect(source.outputBytes).toBe(3840*2160*4);expect(source.estimatedTotalBytes).toBe(source.attachmentBytes+source.stagingBytes+source.outputBytes);
 });
 it('uses captured GPU sample facts for every repaired subsample instead of another viewport',()=>{
  const s=scene('mathart-1.7.8-gpu');Object.assign(s.settings,{domainBackend:'gpu',supersampling:2,rotation:12345.6789});const model=parseDomainModel(s,0),evaluate=domainEvaluator(model);
  const values=new Float32Array([99,99,-.7,.13,.21,-.37,.53,.91,-.31,-.81]),sum=[0,0,0];
  for(let j=0;j<4;j++){const point:[number,number]=[values[2+j*2],values[3+j*2]],rgb=shadeDomainValue(evaluate(point),point,model,1)!;for(let k=0;k<3;k++)sum[k]+=rgb[k];}
  vi.spyOn(domainGpu,'render').mockImplementation((_m,w,h,_pixels,repair)=>{expect([w,h]).toEqual([1,1]);expect(repair(0,{values,offset:2})).toBe(4);return{samples:4,generated:1,invalid:0,invalidSamples:0,repaired:4,tiles:1,readbackBytes:40,estimatedScratchBytes:1048576,coordinatePasses:4,coordinateReadbackBytes:32};});
  const output=generateDomain(s,{time:0,width:1,height:1,quality:'export'});if(output.type!=='raster')throw Error('Expected raster');
  expect(output.backend).toBe('webgl2');expect(output.warnings?.join(' ')).toContain('全部 4 个子像素');
  expect([...output.pixels]).toEqual([...sum.map(v=>Math.round(Math.max(0,Math.min(1,v/4))*255)),255]);expect(output.warnings?.join(' ')).toContain('捕获的坐标');
 });
});
describe('source Domain gesture ownership',()=>{
 it('anchors ideal rotated zoom and actual quantized samples within recipe resolution',()=>{
  for(const version of sourceVersions)for(const [width,height] of[[228,630],[800,500]]){
   const s=scene(version),x=width*.713,y=height*.237,prepared=prepareDomainViewport(s.settings),before=domainIdealPoint(x,y,width,height,prepared),sample=domainPixel(Math.floor(x),Math.floor(y),width,height,prepared,x%1,y%1);
   const next={...s,settings:{...s.settings,...zoomPlane(planeNavigation(s,width,height),x,y,-300)}},after=domainIdealPoint(x,y,width,height,prepareDomainViewport(next.settings)),afterSample=domainPixel(Math.floor(x),Math.floor(y),width,height,prepareDomainViewport(next.settings),x%1,y%1);
   for(let k=0;k<2;k++){expect(after[k]).toBeCloseTo(before[k],14);expect(Math.abs(afterSample[k]-sample[k])).toBeLessThan(3e-7);}
   expect(next.settings.scale).toBeGreaterThan(s.settings.scale as number);expect(next.camera).toEqual(s.camera);
  }
 });
 it('pans in source screen direction, retains finite raw floor values and resets independently',()=>{
  const s=scene('mathart-1.7.8-cpu');Object.assign(s.settings,{rotation:0,centerX:0,centerY:0,scale:2.5});
  expect(panPlane(planeNavigation(s,800,500),100,50)).toEqual({centerX:-.16,centerY:-.08000000000000002,scale:2.5});
  s.settings.scale=-12;expect(panPlane(planeNavigation(s,800,500),0,0).scale).toBe(-12);expect(zoomPlane(planeNavigation(s,800,500),400,250,0).scale).toBe(1e-9);
  expect(zoomPlane(planeNavigation(s,800,500),400,250,-1e6).scale).toBe(Number.MAX_VALUE);
  expect(fitPlane(s)).toEqual({centerX:0,centerY:0,scale:2.5});expect(()=>panPlane(planeNavigation(s,800,500),NaN,0)).toThrow();
 });
});
