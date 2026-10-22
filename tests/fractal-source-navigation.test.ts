import {describe,it,expect} from 'vitest';
import {createScene,parseScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {FRACTAL_SOURCE_NUMERIC_PROFILE,FractalPrecisionInputError} from '../src/engine/fractalSourcePrecision';
import {fractalViewportRules,prepareFractalViewportNavigation} from '../src/engine/complexViewport';
import {planeNavigation,panPlane,zoomPlane,rasterPresentationRect} from '../src/engine/planeNavigation';
import {dd,ddAdd,ddSub,ddNumber,type DDComplex} from '../src/engine/doubleDouble';
import {doubleDoubleOrbit,supportsDoubleDouble,supportsPerturbation} from '../src/engine/fractalPrecision';
import {fractalConfig} from '../src/scenes/complex';
import type {Settings} from '../src/types';

const scene=()=>{const s=createScene(definition('fractal'));Object.assign(s.settings,{formula:'newton',fractalNumericProfile:FRACTAL_SOURCE_NUMERIC_PROFILE,centerX:0,centerY:0,centerXLow:0,centerYLow:0,rotation:0,zoom:1});return s;};
/** Retained main's uv*2-1, aspect, rotateVec, reciprocal zoom, with
 * double interaction arithmetic. This deliberately is not a driver oracle. */
function sourcePointer(s:Settings,x:number,y:number,w:number,h:number,lw=w,lh=h):DDComplex {
 const u=(2*x/w-1)*Math.fround(Math.fround(lw)/Math.max(Math.fround(lh),1)),v=2*y/h-1,a=Math.fround(Number(s.rotation)),c=Math.cos(a),t=Math.sin(a),z=Number(s.zoom);
 return[ddAdd(dd(Number(s.centerX),Number(s.centerXLow)),dd((u*c-v*t)/z)),ddAdd(dd(Number(s.centerY),Number(s.centerYLow)),dd((u*t+v*c)/z))];
}
const delta=(a:DDComplex,b:DDComplex)=>Math.max(...a.map((v,i)=>Math.abs(ddNumber(ddSub(v,b[i])))));
const nav=(s:ReturnType<typeof scene>,w:number,h:number,lw=w,lh=h)=>planeNavigation(s,w,h,undefined,undefined,prepareFractalViewportNavigation(s.settings,lw,lh));

describe('source Newton/Nova viewport applicability and completed facts',()=>{
 it('centralizes source activation and leaves the marker dormant for other formulas',()=>{
  for(const formula of ['newton','nova'])expect(fractalViewportRules(FRACTAL_SOURCE_NUMERIC_PROFILE,formula)).toEqual({sourceArithmetic:true,verticalRange:2,yDirection:'down'});
  for(const formula of ['mandelbrot','julia','binocular','newton-custom'])expect(fractalViewportRules(FRACTAL_SOURCE_NUMERIC_PROFILE,formula)).toEqual({sourceArithmetic:false,verticalRange:4,yDirection:'up'});
  expect(fractalViewportRules('local-v1','newton').sourceArithmetic).toBe(false);
  const s=scene();s.settings.formula='mandelbrot';expect(nav(s,400,200).spanY).toBe(4);expect(s.settings.fractalNumericProfile).toBe(FRACTAL_SOURCE_NUMERIC_PROFILE);
 });
 it('prevents a direct old DD call from silently evaluating source Newton/Nova',()=>{
  const s=scene();for(const formula of ['newton','nova']){s.settings.formula=formula;const c=fractalConfig(s.settings);
   expect(supportsDoubleDouble(c)).toBe(false);expect(supportsPerturbation(c)).toBe(false);expect(()=>doubleDoubleOrbit([[1,0],[0,0]],c)).toThrow('not a fallback');
   try{doubleDoubleOrbit([[1,0],[0,0]],c);throw Error('source DD accepted');}catch(error){expect(error).toBeInstanceOf(FractalPrecisionInputError);expect((error as FractalPrecisionInputError).failure).toMatchObject({kind:'input',field:'fractalNumericProfile'});}
   expect(supportsDoubleDouble({...c,numericProfile:'local-v1'})).toBe(true);
  }
  s.settings.formula='mandelbrot';const dormant=fractalConfig(s.settings);expect(supportsDoubleDouble(dormant)).toBe(true);expect(supportsPerturbation(dormant)).toBe(true);
  expect(doubleDoubleOrbit([[1,0],[0,0]],dormant)).toEqual(doubleDoubleOrbit([[1,0],[0,0]],{...dormant,numericProfile:'local-v1'}));
 });
 it('rejects unknown profiles and unrepresentable source dimension/angle inputs',()=>{
  const s=scene();s.settings.fractalNumericProfile='future';expect(()=>nav(s,400,200)).toThrow('Unknown');
  s.settings.fractalNumericProfile=FRACTAL_SOURCE_NUMERIC_PROFILE;
  for(const n of [0,-1,NaN,Infinity,1e300,1e-300])expect(()=>prepareFractalViewportNavigation(s.settings,n,200)).toThrow();
  s.settings.rotation=1e300;expect(()=>nav(s,400,200)).toThrow();
 });
 it('keeps serializable independent facts from a completed logical frame',()=>{
  const s=scene();s.settings.rotation=.72;const facts=prepareFractalViewportNavigation(s.settings,257,193);
  expect(facts).toMatchObject({profile:FRACTAL_SOURCE_NUMERIC_PROFILE,formula:'newton',rotation:Math.fround(.72),aspect:Math.fround(257/193),logicalSize:[257,193],coordinateContract:'source-navigation-reference'});
  const clone=structuredClone(facts);s.settings.rotation=2;s.settings.zoom=9;const actual=planeNavigation(s,17,13,undefined,undefined,clone);
  expect(actual.rotation).toBe(Math.fround(.72));expect(actual.zoom).toBe(1);expect(actual.spanX).toBe(2*Math.fround(257/193));expect(actual.fractalViewport).toBe(clone);
  expect(Object.isFrozen(facts.viewport)).toBe(true);expect(Object.isFrozen(facts.rules)).toBe(true);
 });
 it('preserves every old omitted/explicit-local navigation result',()=>{
  const s=scene();delete s.settings.fractalNumericProfile;Object.assign(s.settings,{centerX:-.7,centerY:.3,centerXLow:1e-25,centerYLow:-1e-25,rotation:.72,zoom:3});
  const a=nav(s,827,470);s.settings.fractalNumericProfile='local-v1';const b=nav(s,827,470);
  expect(a.spanY).toBe(4/3);expect(a.spanX).toBe(4/3*827/470);expect(a.rotation).toBe(.72);
  expect(panPlane(a,47,-23)).toEqual(panPlane(b,47,-23));expect(zoomPlane(a,674,93,-150)).toEqual(zoomPlane(b,674,93,-150));
  const simple=scene();delete simple.settings.fractalNumericProfile;expect(panPlane(nav(simple,800,400),100,50)).toMatchObject({centerX:-1,centerY:.5});
 });
});

describe('source direction, logical aspect and DD gesture preservation',()=>{
 it('moves the source image with the pointer under range2/Y-down',()=>{
  const s=scene(),n=nav(s,800,400);expect(n.spanY).toBe(2);expect(n.spanX).toBe(4);
  expect(panPlane(n,100,50)).toMatchObject({centerX:-.5,centerY:-.25,zoom:1});
  expect(sourcePointer(s.settings,400,0,800,400)[1][0]).toBe(-1);expect(sourcePointer(s.settings,400,400,800,400)[1][0]).toBe(1);
 });
 it.each(['newton','nova'])('keeps a dragged %s point fixed to the pointer through positive and negative rotations',formula=>{
  for(const angle of [.72,-1.3,Math.PI/2]){const s=scene();Object.assign(s.settings,{formula,rotation:angle,zoom:7,centerX:.9,centerY:-.2});const x=13,y=41,dx=31,dy=-23,w=257,h=193;
   const before=sourcePointer(s.settings,x,y,w,h),patch=panPlane(nav(s,w,h),dx,dy),after=sourcePointer({...s.settings,...patch},x+dx,y+dy,w,h);
   expect(delta(before,after)).toBeLessThan(2e-16);
  }
 });
 it.each([-600,400])('holds the pointer anchor during zoom delta=%s using the rendered logical aspect',scroll=>{
  const s=scene();Object.assign(s.settings,{rotation:.72,zoom:3,centerXLow:1e-17,centerYLow:-2e-18});const w=17,h=13,lw=257,lh=193,x=15.25,y=2.5;
  const before=sourcePointer(s.settings,x,y,w,h,lw,lh),patch=zoomPlane(nav(s,w,h,lw,lh),x,y,scroll),after=sourcePointer({...s.settings,...patch},x,y,w,h,lw,lh);
  expect(delta(before,after)).toBeLessThan(2e-16);
  expect(nav(s,w,h,lw,lh).spanX).not.toBe(nav(s,w,h).spanX);
 });
 it('retains sub-ULP movement and saves high/low center without collapsing',()=>{
  const s=scene();Object.assign(s.settings,{zoom:1e24,centerX:-.743643887037151,centerY:.13182590420533});const patch=panPlane(nav(s,800,600),1,1);
  expect(patch.centerX).toBe(s.settings.centerX);expect(patch.centerY).toBe(s.settings.centerY);
  expect(Number(patch.centerXLow)).toBeCloseTo(-Math.fround(800/600)*2/800/1e24,40);expect(Number(patch.centerYLow)).toBeCloseTo(-2/600/1e24,40);
  const saved=parseScene(JSON.stringify({...s,settings:{...s.settings,...patch}}));expect(saved.settings.centerXLow).toBe(patch.centerXLow);expect(saved.settings.centerYLow).toBe(patch.centerYLow);
 });
 it('keeps the deep-zoom anchored point and makes opposite drags reversible',()=>{
  const s=scene();Object.assign(s.settings,{zoom:1e24,rotation:-.81,centerX:.73,centerY:-.21,centerXLow:2e-28,centerYLow:-3e-28});
  const before=sourcePointer(s.settings,671,135,800,500),patch=zoomPlane(nav(s,800,500),671,135,-500),after=sourcePointer({...s.settings,...patch},671,135,800,500);expect(delta(before,after)).toBeLessThan(1e-39);
  const p=panPlane(nav(s,800,500),37,-52),moved={...s,settings:{...s.settings,...p}},back=panPlane(nav(moved,800,500),-37,52);
  expect(Math.abs(ddNumber(ddSub(dd(Number(back.centerX),Number(back.centerXLow)),dd(Number(s.settings.centerX),Number(s.settings.centerXLow)))))).toBeLessThan(1e-39);
 });
 it('maps letterboxed CSS gestures once and uses local bounded zoom policy',()=>{
  const s=scene(),rect=rasterPresentationRect(702,399,720,540),facts=nav(s,720,540),x=600,y=100;
  const direct=zoomPlane(facts,x,y,-100),css=zoomPlane(facts,((rect.x+x*rect.scale)-rect.x)/rect.scale,((rect.y+y*rect.scale)-rect.y)/rect.scale,-100);
  for(const key of Object.keys(direct))expect(Number(css[key])).toBeCloseTo(Number(direct[key]),15);expect(zoomPlane(facts,360,270,-1e6).zoom).toBe(1e28);expect(zoomPlane(facts,360,270,1e6).zoom).toBe(1e-6);
  expect(()=>panPlane(facts,NaN,0)).toThrow();expect(()=>zoomPlane(facts,1,1,Infinity)).toThrow();
 });
});
