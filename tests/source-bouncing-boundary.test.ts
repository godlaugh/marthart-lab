import {describe,it,expect} from 'vitest';
import {prepareSourceBouncingBoundary} from '../src/engine/sourceBouncingBoundary';
import {importSourceBouncingVisualConfig,prepareSourceBouncingDisplay,type SourceBouncingDisplay} from '../src/engine/sourceBouncingVisualConfig';
import {SOURCE_CAMERA_MODEL,type SourceCameraPlan} from '../src/engine/sourceCamera';
import type {SourceBouncingUpdate} from '../src/engine/sourceBouncingGpu';
const F=Math.fround;
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function plan(width=100,height=100,projection=identity,modelView=identity):SourceCameraPlan{return{model:SOURCE_CAMERA_MODEL,viewport:{logicalWidth:width,logicalHeight:height,referenceLogicalHeight:100,target:'primary',projectionPass:'perspective'},modelView:{rowMajor:[...modelView]},projection:{rowMajor:[...projection]},transform:{rowMajor:Array(16).fill(999)}} as unknown as SourceCameraPlan;}
function display():SourceBouncingDisplay{const raw=importSourceBouncingVisualConfig({settings:{scale_x:1,scale_y:1,offset_z:9}});if(!raw.ok)throw Error('import');const r=prepareSourceBouncingDisplay(raw.value.configuration,{initialSpeed:1});if(!r.ok)throw Error('display');return r.value;}
function path(boundary:SourceBouncingUpdate['boundary'],d=display(),p=plan()){const r=prepareSourceBouncingBoundary(boundary,d,p);if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;}
const circle=(radius:number):SourceBouncingUpdate['boundary']=>({kind:'circle',center:[0,0],radius});

describe('source Bouncing closed boundary path',()=>{
 it('applies visual scale/offset once to already translated polygon coordinates, preserving order and duplicates',()=>{
  const d=display();d.transform={scaleX:-2,scaleY:3,scaleZ:999,offsetX:.25,offsetY:-.5,offsetZ:7};
  const b:SourceBouncingUpdate['boundary']={kind:'polygon',vertices:[[1,2],[1,2],[-3,4],[0,0]]},r=path(b,d);
  expect(Array.from(r.positions)).toEqual([-1.75,5.5,7,-1.75,5.5,7,6.25,11.5,7,.25,-.5,7]);expect(r.detail).toBeNull();expect(r.closed).toBe(true);expect(r.lineWidth).toBe(F(1.6));expect(r.packedColor).toBe(0xd2ffffff);
  expect(r.positions.length).toBe(12);expect(r.positions.slice(0,3)).not.toEqual(r.positions.slice(-3));
 });
 it('matches source PC294 skip for polygons below three vertices and enforces the retained64 point limit',()=>{
  for(const vertices of [[],[[1,2]],[[1,2],[3,4]]] as [number,number][][])expect(path({kind:'polygon',vertices}).positions).toHaveLength(0);
  expect(path({kind:'polygon',vertices:Array.from({length:64},(_,i)=>[i,0])}).positions).toHaveLength(192);
  expect(prepareSourceBouncingBoundary({kind:'polygon',vertices:Array.from({length:65},()=>[0,0])},display(),plan())).toMatchObject({ok:false,error:{kind:'capacity'}});
 });
 it('uses logical projected bounding-box diagonal for detail20, intermediate and200',()=>{
  expect(path(circle(.1)).detail).toBe(20);expect(path(circle(1)).detail).toBe(88);expect(path(circle(10)).detail).toBe(200);
  const r=path(circle(1));expect(r.positions.length).toBe(88*3);expect(Array.from(r.positions.slice(0,3))).toEqual([1,0,0]);expect(r.positions[3]).toBe(F(Math.cos(F(F(8*F(Math.PI/180))*.5))));
  expect(r.positions[3]).not.toBe(F(Math.cos(2*Math.PI/88)));
  const offscreen=plan(200,200);Reflect.set(offscreen,'viewport',{...offscreen.viewport,target:'offscreen'});expect(path(circle(1),display(),offscreen).detail).toBe(177);
  const ortho=plan();Reflect.set(ortho,'viewport',{...ortho.viewport,projectionPass:'scene-fade-orthographic'});expect(path(circle(1),display(),ortho).positions).toEqual(r.positions);
 });
 it('preserves CENTER to corner to center rounding rather than algebraically cancelling it',()=>{
  const d=display(),center=F(-52.790382385253906),radius=F(11.2134370803833);
  const r=path({kind:'ellipse',center:[center,0],a:radius,b:1},d,plan(1,1));
  // This source center conversion changes the first vertex by one Float32 ULP.
  const rebuilt=F(F(center-radius)+radius);expect(rebuilt).not.toBe(center);
  expect(r.positions[0]).toBe(F(rebuilt+radius));expect(r.positions[0]).not.toBe(F(center+radius));
  expect(r.positions[2]).toBe(0);
 });
 it('keeps circles elliptical under unequal/negative visual scales and handles zero axes without repairs',()=>{
  const d=display();d.transform.scaleX=-2;d.transform.scaleY=0;
  const r=path({kind:'circle',center:[1,2],radius:1},d);
  expect(Array.from(r.positions.slice(0,3))).toEqual([0,0,0]);for(let i=0;i<r.positions.length;i+=3){expect(r.positions[i+1]).toBe(0);expect(r.positions[i+2]).toBe(0);}
  const zero=path(circle(0));expect(zero.detail).toBe(20);expect(Array.from(zero.positions)).toEqual(Array(60).fill(0));
 });
 it('uses separate modelview then projection and the exact nonZero epsilon division threshold',()=>{
  const projection=[...identity];projection[15]=2**-24;
  expect(path(circle(1),display(),plan(100,100,projection)).detail).toBe(88);
  projection[15]=2**-23;expect(path(circle(1),display(),plan(100,100,projection)).detail).toBe(200);
  projection[15]=-(2**-24);expect(path(circle(1),display(),plan(100,100,projection)).detail).toBe(88);
  const model=[...identity];model[0]=.25;model[5]=.25;
  expect(path(circle(1),display(),plan(100,100,identity,model)).detail).toBe(22);
 });
 it('preserves native projected overflow detail recovery while rejecting nonfinite final geometry',()=>{
  const projection=[...identity];projection[0]=F(3e38);
  expect(path(circle(1),display(),plan(100,100,projection)).detail).toBe(200);
  const model=[...identity];model[0]=F(3e38);model[3]=F(3e38);
  // Both projected corners become Infinity: dist(NaN) -> f2i0 -> detail20.
  expect(path({kind:'circle',center:[4,0],radius:1},display(),plan(100,100,identity,model)).detail).toBe(20);
  const d=display();d.transform.scaleX=F(3e38);
  expect(prepareSourceBouncingBoundary(circle(2),d,plan())).toMatchObject({ok:false,error:{kind:'nonfinite'}});
 });
 it('fails explicitly for unknown/malformed projection and nonfinite style/input',()=>{
  const p=plan();Reflect.set(p,'viewport',{...p.viewport,projectionPass:'unknown'});
  expect(prepareSourceBouncingBoundary(circle(1),display(),p)).toMatchObject({ok:false,error:{kind:'input',path:['cameraPlan']}});
  const malformed=plan();Reflect.set(malformed.projection.rowMajor,0,NaN);
  expect(prepareSourceBouncingBoundary(circle(1),display(),malformed)).toMatchObject({ok:false,error:{kind:'nonfinite'}});
  expect(prepareSourceBouncingBoundary(circle(NaN),display(),plan())).toMatchObject({ok:false,error:{kind:'nonfinite'}});
  const d=display();d.boundaryStrokeWeight=Infinity;expect(prepareSourceBouncingBoundary(circle(1),d,plan())).toMatchObject({ok:false,error:{kind:'nonfinite'}});
 });
});
