import { describe, expect, it } from 'vitest';
import { prepareSourceCamera, resolveSourceCamera, sourceCameraDisplayPolicy, SOURCE_CAMERA_MODEL, type SourceCameraInput, type SourceCameraPlan } from '../src/engine/sourceCamera';
const base:SourceCameraInput={model:SOURCE_CAMERA_MODEL,configuration:{kind:'absent'}};
const viewport={logicalWidth:96,logicalHeight:64,referenceLogicalHeight:64,target:'primary',projectionPass:'perspective'};
function plan(input:unknown=base,view:unknown=viewport):SourceCameraPlan {
 const r=prepareSourceCamera(input,view);if(!r.ok)throw r.error;if(r.value.kind!=='known')throw Error(r.value.reason);return r.value.plan;
}
function reason(input:unknown){const r=resolveSourceCamera(input);return r.ok?undefined:{path:r.error.path,reason:r.error.reason};}

describe('MathArt 1.7.8 source camera staged owner',()=>{
 it('owns defaults and precedence while preserving authored numeric facts',()=>{
  const input:SourceCameraInput={...base,configuration:{kind:'angles',family:'surface',phi:.2,theta:1+2**-25},frame:{phi:.3,center:[1e-50,-2,3]}};
  const snapshot=structuredClone(input),p=plan(input);expect(input).toEqual(snapshot);
  expect(p.camera.authored.theta).toBe(1+2**-25);expect(p.camera.value.theta).toBe(1);
  expect(p.camera.authored.center[0]).toBe(1e-50);expect(p.camera.value.center[0]).toBe(0);
  expect(p.camera.origins).toEqual({phi:'frame',theta:'configuration',gamma:'configuration-default',center:'frame',zoom:'controller-default',focalDistance:'controller-default'});
  expect(plan().camera.value).toEqual({phi:Math.fround(Math.PI/2),theta:0,gamma:0,center:[0,0,0],zoom:1,focalDistance:20});
  expect(plan({...base,configuration:{kind:'angles',family:'symmetry'}}).camera.value).toEqual(plan().camera.value);
 });
 it('does not interpret missing or unresolved observations as source defaults',()=>{
  expect(reason({model:SOURCE_CAMERA_MODEL})).toEqual({path:'configuration',reason:'missing-field'});
  expect(resolveSourceCamera({...base,configuration:{kind:'unknown',reason:'Initial config unavailable'}})).toEqual({ok:true,value:{kind:'unknown',reason:'Initial config unavailable'}});
  expect(prepareSourceCamera(base,{...viewport,projectionPass:'unknown'})).toEqual({ok:true,value:{kind:'unknown',reason:'Scene projection pass has not been observed'}});
  expect(reason({...base,configuration:{kind:'angles',family:'samila'}})?.reason).toBe('invalid-choice');
  expect(reason({...base,configuration:{kind:'angles',family:'surface',phi:'PI/2'}})?.reason).toBe('number-required');
  expect(reason({...base,configuration:{kind:'absent',phi:0}})?.reason).toBe('unknown-field');
 });
 it('rejects malformed numeric boundaries rather than silently coercing or clamping',()=>{
  for(const theta of [NaN,Infinity,1e40])expect(reason({...base,frame:{theta}})).toEqual({path:'frame.theta',reason:'nonfinite-float32'});
  for(const theta of [null,'0',true])expect(reason({...base,frame:{theta}})?.reason).toBe('number-required');
  expect(reason({...base,frame:{center:[0,1]}})?.reason).toBe('triple-required');
  expect(reason({...base,frame:{theta:undefined}})?.reason).toBe('number-required');
  for(const logicalWidth of [0,-1,1.5,2147483648]){const r=prepareSourceCamera(base,{...viewport,logicalWidth});expect(r.ok).toBe(false);}
  // Scalars remain source facts even when projection cannot be constructed.
  expect(resolveSourceCamera({...base,frame:{focalDistance:0}}).ok).toBe(true);
  const singular=prepareSourceCamera({...base,frame:{focalDistance:0}},viewport);expect(singular.ok).toBe(false);if(!singular.ok)expect(singular.error.reason).toBe('singular-camera');
 });
 it('has the source Z-X-Z basis rather than Y-axis orbit interpretation',()=>{
  const theta=plan({...base,frame:{phi:0,theta:Math.PI/2}}).modelView.rowMajor;
  expect(theta[0]).toBeCloseTo(0,6);expect(theta[4]).toBeCloseTo(1,6);expect(theta[8]).toBe(0);
  const combined=plan({...base,frame:{phi:Math.PI/2,theta:Math.PI/2}}).modelView.rowMajor;
  expect(combined[0]).toBeCloseTo(0,6);expect(combined[4]).toBeCloseTo(0,6);expect(combined[8]).toBeCloseTo(1,6);
  expect(plan({...base,frame:{phi:1.58}}).modelView.rowMajor[0]).toBe(0.9999999403953552);
 });
 it('keeps projection pass, display scale and translated center explicit',()=>{
  const a=plan({...base,frame:{phi:0}}),b=plan({...base,frame:{phi:0,center:[1,2,3]}});
  expect(b.modelView.rowMajor[3]).toBe(-1);expect(b.modelView.rowMajor[7]).toBe(-2);expect(b.modelView.rowMajor[11]).toBe(Math.fround(a.modelView.rowMajor[11]-3));
  expect(a.projection.rowMajor[5]).toBeLessThan(0); // Processing's top-down Y.
  const ortho=plan(base,{...viewport,projectionPass:'scene-fade-orthographic'});
  expect(ortho.modelView.rowMajor).toEqual(plan().modelView.rowMajor);expect(ortho.projection.rowMajor[15]).toBe(1);
 });
 it('keeps family display policies distinct without fabricating a 2D viewport',()=>{
  expect(sourceCameraDisplayPolicy('map','density')).toMatchObject({kind:'captured-density',angleChanges:'reanchor',viewport:'not-derived'});
  expect(sourceCameraDisplayPolicy('symmetry','density')).toMatchObject({kind:'captured-density',angleChanges:'retain-and-rotate'});
  for(const family of ['fractal','domain'])expect(sourceCameraDisplayPolicy(family,'fullscreen')).toMatchObject({kind:'fullscreen-viewport',sceneEuler:'bypassed',viewport:'not-derived'});
  expect(sourceCameraDisplayPolicy('samila','density').kind).toBe('samila-theta');expect(sourceCameraDisplayPolicy('roots','density').kind).toBe('roots-owner');
  expect(sourceCameraDisplayPolicy('bouncing','ordinary').kind).toBe('unknown');
 });
 it('detaches prepared facts from request and upload-buffer mutations',()=>{
  const input={...base,frame:{center:[1,2,3]}};const p=plan(input);input.frame.center[0]=100;expect(p.camera.value.center[0]).toBe(1);
  const before=p.modelView.rowMajor[0];p.modelView.columnMajor[0]=999;expect(p.modelView.rowMajor[0]).toBe(before);
  expect(Object.isFrozen(p.camera.value.center)).toBe(true);expect(Object.isFrozen(p.modelView.rowMajor)).toBe(true);
 });
});
