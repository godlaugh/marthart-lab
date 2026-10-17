import {describe,it,expect} from 'vitest';
import {createScene,parseScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {generateScene} from '../src/engine/temporal';
import {planeNavigation,panPlane,zoomPlane,fitPlane,rasterPresentationRect} from '../src/engine/planeNavigation';
import {previewDimensions,previewProfile} from '../src/engine/preferences';
import {parseFractalViewport,juliaSeedAtPointer,complexPixel} from '../src/engine/complexViewport';
import {precisePixel} from '../src/engine/fractalPrecision';
import {ddSub,ddNumber} from '../src/engine/doubleDouble';
describe('mathematical plane navigation',()=>{
 it('picks Julia seed from the actual rotated complex pixel and retains source parameters',()=>{
  const scene=createScene(definition('fractal'));Object.assign(scene.settings,{formula:'mandelbrot',variant:'parameter',rotation:.72,zoom:3,centerX:-.7,centerY:.2,power:3});
  const original=structuredClone(scene),width=827,height=470,x=600,y=120,expected=complexPixel(x-.5,y-.5,width,height,parseFractalViewport(scene.settings)),patch=juliaSeedAtPointer(scene.settings,x,y,width,height);
  expect([patch.juliaReal,patch.juliaImag]).toEqual(expected);expect(patch).toMatchObject({variant:'julia',centerX:0,centerY:0,centerXLow:0,centerYLow:0,zoom:1});expect(scene).toEqual(original);
  const next=parseScene(JSON.stringify({...scene,settings:{...scene.settings,...patch}}));expect(next.settings.power).toBe(3);expect(next.settings.rotation).toBe(.72);
  const output=generateScene(next,{time:0,width:48,height:32,quality:'export'});expect(output.type).toBe('raster');expect(output.stats.generated).toBeGreaterThan(0);
  for(const xy of [[-1,20],[width+1,20],[20,-1],[20,height+1],[NaN,20]])expect(()=>juliaSeedAtPointer(scene.settings,...xy as [number,number],width,height)).toThrow();
  expect(()=>juliaSeedAtPointer({...scene.settings,variant:'julia'},10,10,width,height)).toThrow();expect(()=>juliaSeedAtPointer({...scene.settings,formula:'newton'},10,10,width,height)).toThrow();
 });
 it('maps CSS gestures through letterboxing to the same sampled mathematical coordinates',()=>{
  const scene=createScene(definition('fractal')),width=720,height=540,rect=rasterPresentationRect(702,399,width,height),view=planeNavigation(scene,width,height);
  const sourceX=600,sourceY=100,cssX=rect.x+sourceX*rect.scale,cssY=rect.y+sourceY*rect.scale;
  const viaCss=zoomPlane(view,(cssX-rect.x)/rect.scale,(cssY-rect.y)/rect.scale,-100),direct=zoomPlane(view,sourceX,sourceY,-100);
  for(const key of Object.keys(direct))expect(Number(viaCss[key])).toBeCloseTo(Number(direct[key]),14);
  const panned=panPlane(view,74/rect.scale,0);
  expect(Number(panned.centerX)-Number(scene.settings.centerX)).toBeCloseTo(-74*4/399,14);
  expect(rect.x).toBeGreaterThan(0);expect(rect.y).toBe(0);
 });
 it('samples resized landscape and portrait canvases at their aspect within the selected quality budget',()=>{
  for(const quality of ['low','standard','high'] as const)for(const [width,height] of [[702,399],[399,702],[1440,360]]){
   const size=previewDimensions(quality,width,height),profile=previewProfile(quality);
   expect(size.width*size.height).toBeLessThanOrEqual(profile.width*profile.height);
   // Flooring either dimension can move the corresponding raster edge by less than one pixel.
   expect(Math.abs(size.width/size.height-width/height)).toBeLessThan((1+width/height)/size.height);
  }
  expect(()=>previewDimensions('standard',0,400)).toThrow();
 });
 it('keeps the world coordinate under an off-center pointer fixed while zooming a rotated plane',()=>{
  const scene=createScene(definition('fractal'));Object.assign(scene.settings,{rotation:.72,zoom:3,centerXLow:1e-17,centerYLow:-2e-18});
  const x=671,y=135,width=800,height=500,before=precisePixel(x-.5,y-.5,width,height,parseFractalViewport(scene.settings));
  const next={...scene,settings:{...scene.settings,...zoomPlane(planeNavigation(scene,width,height),x,y,-500)}};
  const after=precisePixel(x-.5,y-.5,width,height,parseFractalViewport(next.settings));
  expect(Math.abs(ddNumber(ddSub(before[0],after[0])))).toBeLessThan(1e-15);expect(Math.abs(ddNumber(ddSub(before[1],after[1])))).toBeLessThan(1e-15);
  expect(next.settings.zoom).toBeGreaterThan(scene.settings.zoom as number);
 });
 it('retains sub-ULP movement at deep zoom and persists both high and low components',()=>{
  const scene=createScene(definition('fractal'));Object.assign(scene.settings,{zoom:1e24,centerX:-.743643887037151,centerY:.13182590420533});
  const changed={...scene,settings:{...scene.settings,...panPlane(planeNavigation(scene,800,600),1,0)}};
  expect(changed.settings.centerX).toBe(scene.settings.centerX);expect(changed.settings.centerXLow).not.toBe(0);
  expect(Number(changed.settings.centerXLow)).toBeCloseTo(-4/600/1e24,35);
  expect(parseScene(JSON.stringify(changed)).settings.centerXLow).toBe(changed.settings.centerXLow);
 });
 it('changes actual sampled pixels for a domain drag rather than transforming its carrier camera',()=>{
  const scene=createScene(definition('domain')),context={width:32,height:24,time:0,quality:'export' as const};
  const moved={...scene,settings:{...scene.settings,...panPlane(planeNavigation(scene,800,600),80,0)}};
  const a=generateScene(scene,context),b=generateScene(moved,context);expect(a.type).toBe('raster');expect(b.type).toBe('raster');
  if(a.type==='raster'&&b.type==='raster')expect(a.pixels).not.toEqual(b.pixels);expect(moved.camera).toEqual(scene.camera);
  expect(fitPlane(moved)).toEqual({centerX:0,centerY:0,scale:1});
 });
 it('uses the Bouncing boundary owner for fit and writes explicit fixed view coordinates on navigation',()=>{
  const scene=createScene(definition('bouncing'));Object.assign(scene.settings,{bouncingPresentation:'raster',radius:2});
  const view=planeNavigation(scene,800,400),move=panPlane(view,100,50);expect(move).toMatchObject({bouncingView:'fixed',bouncingViewCenterX:-1.1,bouncingViewCenterY:.55,bouncingViewWidth:8.8});
  const zoom=zoomPlane(view,400,200,-500);expect(zoom.bouncingViewWidth).toBeLessThan(8.8);expect(zoom.bouncingViewCenterX).toBe(0);expect(fitPlane(scene)).toEqual({bouncingView:'fit'});
 });
 it('bounds scale before overflow and rejects nonfinite input',()=>{
  const scene=createScene(definition('fractal')),view=planeNavigation(scene,800,600);
  expect(zoomPlane(view,400,300,-1e6).zoom).toBe(1e28);expect(zoomPlane(view,400,300,1e6).zoom).toBe(1e-6);
  expect(()=>zoomPlane(view,400,300,NaN)).toThrow();expect(()=>planeNavigation(scene,0,600)).toThrow();expect(()=>panPlane(view,NaN,0)).toThrow();
 });
 it('uses the density producer bounds for first navigation and persists a manual mathematical view',()=>{
  for(const kind of ['map','roots'] as const){
  const scene=createScene(definition(kind));if(kind==='map')scene.settings.iteratedMode='continuous';else scene.settings.rootsMode='progressive';
  const view=planeNavigation(scene,800,400,{minX:-8,maxX:4,minY:-2,maxY:4});
  expect(panPlane(view,100,50)).toMatchObject({densityView:'manual',densityCenterX:-3.5,densityCenterY:1.75,densitySpan:6});
  const moved={...scene,settings:{...scene.settings,...zoomPlane(view,400,200,-100)}};
  expect(planeNavigation(moved,800,400).spanY).toBeLessThan(6);expect(fitPlane(scene)).toEqual({densityView:'auto'});
  }
 });
});
