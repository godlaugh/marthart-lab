import {describe,it,expect} from 'vitest';
import {prepareSourceCamera,SOURCE_CAMERA_MODEL,type SourceCameraPlan,type SourceCameraScalars} from '../src/engine/sourceCamera';
import {prepareCapturedDensityCamera as prepare,prepareCapturedDensityView as view,projectCapturedDensityPoint as project,sampleCapturedDensity as sample,validateCapturedDensityView,SourceDensityCameraError} from '../src/engine/sourceDensityCamera';

function plan(frame:Partial<SourceCameraScalars>={},width=200,height=100):SourceCameraPlan {
 const result=prepareSourceCamera({model:SOURCE_CAMERA_MODEL,configuration:{kind:'angles',family:'map',phi:0},frame},{logicalWidth:width,logicalHeight:height,referenceLogicalHeight:100,target:'primary',projectionPass:'perspective'});
 if(!result.ok)throw result.error;if(result.value.kind!=='known')throw new Error(result.value.reason);return result.value.plan;
}
describe('source captured density camera lifecycle',()=>{
 it('first capture does not clear, and later focal/resize changes retain the captured matrices',()=>{
  const first=prepare('map',plan());expect(first.clearInk).toBe(false);
  const second=prepare('map',plan({focalDistance:40},400,200),first.anchor);
  expect(second.clearInk).toBe(false);expect(second.anchor.projection).toBe(first.anchor.projection);expect(second.anchor.modelView).toBe(first.anchor.modelView);
  expect(second.anchor.camera.focalDistance).toBe(20);expect(second.anchor.lastCamera.focalDistance).toBe(40);
  const zoom=prepare('map',plan({focalDistance:40,zoom:2},400,200),second.anchor);
  expect(zoom.clearInk).toBe(true);expect(zoom.anchor.camera.focalDistance).toBe(40);expect(zoom.anchor.projection).not.toBe(first.anchor.projection);
 });
 it('Map reanchors each Euler field; Symmetry retains angles and rotates the panel',()=>{
  for(const key of ['phi','theta','gamma'] as const){
   const p=plan({[key]:.5}),m=prepare('map',plan()),s=prepare('symmetry',plan());
   expect(prepare('map',p,m.anchor).clearInk).toBe(true);
   const next=prepare('symmetry',p,s.anchor);expect(next.clearInk).toBe(false);expect(next.anchor.modelView).toBe(s.anchor.modelView);
   expect(view(next.anchor,p.camera.value,200,100).rotation).toBe(key==='gamma'?-.5:.5);
  }
 });
 it('both families reanchor center x/y/z and zoom, not an ordinary ink clear',()=>{
  for(const family of ['map','symmetry'] as const)for(let axis=0;axis<3;axis++){
   const first=prepare(family,plan()),center:[number,number,number]=[0,0,0];center[axis]=2;
   const changed=prepare(family,plan({center}),first.anchor);expect(changed.clearInk).toBe(true);
   expect(prepare(family,plan({center}),changed.anchor).clearInk).toBe(false);
  }
 });
 it('threshold compares consecutive float32 observations instead of total anchor drift',()=>{
  let state=prepare('map',plan());const initial=state.anchor.modelView;
  for(let i=1;i<=40;i++){state=prepare('map',plan({theta:i*.00005}),state.anchor);expect(state.clearInk).toBe(false);}
  expect(state.anchor.modelView).toBe(initial);expect(state.anchor.camera.theta).toBe(0);
  expect(prepare('map',plan({theta:.003}),state.anchor).clearInk).toBe(true);
  const zero=prepare('map',plan());expect(prepare('map',plan({theta:Math.fround(.0001)}),zero.anchor).clearInk).toBe(false);
 });
 it('matrix snapshots detach mutable upload arrays and reject foreign family/invalid boundaries',()=>{
  const p=plan(),state=prepare('map',p);const original=state.anchor.projection.columnMajor[0];p.projection.columnMajor[0]=123;
  expect(state.anchor.projection.columnMajor[0]).toBe(original);
  expect(()=>prepare('symmetry',plan(),state.anchor)).toThrow(SourceDensityCameraError);
  expect(()=>prepare('map',null as never)).toThrow(SourceDensityCameraError);
  expect(()=>project(state.anchor,[NaN,0,0],200,100)).toThrow(SourceDensityCameraError);
 });
});
describe('source captured projection and presentation',()=>{
 it('uses physical output dimensions and retains homogeneous depth/behind-camera clipping',()=>{
  const anchor=prepare('map',plan()).anchor;
  expect(project(anchor,[0,0,0],200,100).pixel).toEqual([100,50]);
  const translated=project(anchor,[10,0,0],200,100);expect(translated.visible).toBe(true);expect(translated.pixel[0]).toBeCloseTo(110,4);
  expect(project(anchor,[10,0,0],400,200).pixel[0]).toBeCloseTo(220,4);
  expect(project(anchor,[0,0,100],200,100).visible).toBe(false);
  expect(project(anchor,[0,0,-10000],200,100).visible).toBe(false);
 });
 it('Map inverse-rotates nearest density samples without an extra vertical flip',()=>{
  const a=prepare('map',plan()).anchor,v=view(a,plan({theta:Math.PI/2}).camera.value,2,2);
  // Top-left output UV (-.25,+.25) samples (+.25,+.25), the top-right input.
  expect([sample(v,0,0)[0].index,sample(v,1,0)[0].index,sample(v,0,1)[0].index,sample(v,1,1)[0].index]).toEqual([1,3,0,2]);
  for(let y=0;y<2;y++)for(let x=0;x<2;x++)expect(sample(view(a,plan().camera.value,2,2),x,y)).toEqual([{index:y*2+x,weight:1}]);
 });
 it('Symmetry interpolates untone-mapped ink with linear clamp and bounded four-tap weights',()=>{
  const a=prepare('symmetry',plan()).anchor,v=view(a,plan({theta:Math.PI/4}).camera.value,4,4),samples=sample(v,1,1);
  expect(samples.map(s=>s.index).sort((a,b)=>a-b)).toEqual([1,2,5,6]);
  expect(samples.reduce((s,v)=>s+v.weight,0)).toBeCloseTo(1,6);
  for(const s of samples)expect(s.weight).toBeCloseTo(s.index<4?.10355339:.39644661,6);
  const edge=sample(view(a,plan({theta:.05}).camera.value,4,4),0,1);
  expect(edge.length).toBeLessThanOrEqual(4);expect(edge.every(s=>s.index>=0&&s.index<16&&s.weight>=0)).toBe(true);
  expect(edge.reduce((n,s)=>n+s.weight,0)).toBeCloseTo(1,6);
 });
 it('aspect-correct panel rotation clips corners instead of expanding the canvas',()=>{
  const a=prepare('symmetry',plan()).anchor,v=view(a,plan({theta:Math.PI/2}).camera.value,8,2);
  expect(sample(v,0,0)).toEqual([]);expect(sample(v,3,0).length).toBeGreaterThan(0);
  expect(()=>validateCapturedDensityView(v,8,3)).toThrow(SourceDensityCameraError);
  expect(()=>sample(v,-1,0)).toThrow(SourceDensityCameraError);
  expect(()=>sample(null as never,0,0)).toThrow(SourceDensityCameraError);
 });
});
