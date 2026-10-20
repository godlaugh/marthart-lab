import {packSourceProcessingMatrix as matrix,applySourceProcessingMatrix as apply,translateSourceProcessingMatrix as translate,rotateSourceProcessingMatrix as rotate,sourceProcessingCameraMatrix as cameraMatrix,sourceProcessingPerspective as perspective,sourceProcessingOrthographic as orthographic,SourceProcessingMatrixError} from './sourceProcessingMatrix';
/** MathArt 1.7.8 Scene/CameraController contract shared by source renderers.
 * Legacy local orbit documents retain their own model. Input is decoded numeric source facts, NOT native JSON expressions.
 * Source: CameraController.applyTransform; Scene.<init>/applyPerspective/render;
 * Processing PGraphicsOpenGL camera/perspective and PMatrix3D operations.
 * See tests/fixtures/source-camera/matrices.json for bytecode identities.
 */
export const SOURCE_CAMERA_MODEL = 'mathart-1.7.8-v1' as const;
export type SourceCameraVec3 = readonly [number, number, number];
export interface SourceCameraMatrix {
 readonly rowMajor: readonly number[];
 /** Detached upload representation; mutating it never changes rowMajor facts. */
 readonly columnMajor: Float32Array;
}
export interface SourceCameraScalars {
 readonly phi: number; readonly theta: number; readonly gamma: number;
 readonly center: SourceCameraVec3; readonly zoom: number; readonly focalDistance: number;
}
export type SourceCameraField = keyof SourceCameraScalars;
export type SourceCameraOrigin = 'controller-default' | 'scene-default' | 'configuration-default' | 'configuration' | 'frame';
export interface SourceCameraState {
 readonly model: typeof SOURCE_CAMERA_MODEL;
 /** Authored numeric values before the source float assignment, including underflow. */
 readonly authored: SourceCameraScalars;
 readonly value: SourceCameraScalars;
 readonly origins: Readonly<Record<SourceCameraField, SourceCameraOrigin>>;
}
export type SourceCameraResolution = {readonly kind:'known'; readonly state:SourceCameraState} |
 {readonly kind:'unknown'; readonly reason:string};
export type SourceCameraResult<T> = {readonly ok:true; readonly value:T} |
 {readonly ok:false; readonly error:CameraBoundaryError};
export class CameraBoundaryError extends Error {
 readonly kind='source-camera-input';
 constructor(readonly path:string, readonly reason:'object-required'|'missing-field'|'unknown-field'|'invalid-choice'|'number-required'|'nonfinite-float32'|'triple-required'|'dimension-required'|'singular-camera') {
  super(`Source camera ${path}: ${reason}`); this.name='CameraBoundaryError';
 }
}
const CONFIG_FAMILIES = ['surface','attractor','implicit','perlin','map','symmetry'] as const;
export type SourceCameraConfigFamily = typeof CONFIG_FAMILIES[number];
/** A missing upstream observation must use unknown, not absent. Numeric values
 * are already decoded by the source expression owner. This module does not
 * invent expression coercion or infer camera applicability from preset keys. */
export interface SourceCameraInput {
 readonly model: typeof SOURCE_CAMERA_MODEL;
 readonly configuration: {readonly kind:'absent'} |
  {readonly kind:'angles'; readonly family:SourceCameraConfigFamily; readonly phi?:number; readonly theta?:number; readonly gamma?:number} |
  {readonly kind:'unknown'; readonly reason:string};
 readonly frame?: Partial<SourceCameraScalars>;
}
function record(value:unknown,path:string):Record<string,unknown> {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new CameraBoundaryError(path,'object-required');
 return value as Record<string,unknown>;
}
function required(value:Record<string,unknown>,key:string,path=key):unknown {
 if(!Object.hasOwn(value,key))throw new CameraBoundaryError(path,'missing-field');return value[key];
}
function fields(value:Record<string,unknown>, allowed:readonly string[], path:string):void {
 for(const key of Object.keys(value))if(!allowed.includes(key))throw new CameraBoundaryError(`${path}.${key}`,'unknown-field');
}
function scalar(value:unknown,path:string):number {
 if(typeof value!=='number')throw new CameraBoundaryError(path,'number-required');
 if(!Number.isFinite(value)||!Number.isFinite(Math.fround(value)))throw new CameraBoundaryError(path,'nonfinite-float32');return value;
}
function triple(value:unknown,path:string):SourceCameraVec3 {
 if(!Array.isArray(value)||value.length!==3)throw new CameraBoundaryError(path,'triple-required');
 return Object.freeze(value.map((x,i)=>scalar(x,`${path}[${i}]`))) as unknown as SourceCameraVec3;
}
function attempt<T>(run:()=>T):SourceCameraResult<T>{try{return{ok:true,value:run()};}catch(error){if(error instanceof SourceProcessingMatrixError)return{ok:false,error:new CameraBoundaryError('projection','singular-camera')};if(error instanceof CameraBoundaryError)return{ok:false,error};throw error;}}
/** Owns controller -> Scene -> family configuration -> evaluated frame precedence.
 * Rates and tracking lifetimes belong to the future timeline owner, not this snapshot. */
export function resolveSourceCamera(input:unknown):SourceCameraResult<SourceCameraResolution>{return attempt(()=>{
 const raw=record(input,'camera');fields(raw,['model','configuration','frame'],'camera');if(required(raw,'model')!==SOURCE_CAMERA_MODEL)throw new CameraBoundaryError('model','invalid-choice');
 const config=record(required(raw,'configuration'),'configuration');const kind=required(config,'kind','configuration.kind');
 if(kind==='unknown'){
  fields(config,['kind','reason'],'configuration');
  const reason=required(config,'reason','configuration.reason');if(typeof reason!=='string'||!reason.trim())throw new CameraBoundaryError('configuration.reason','invalid-choice');
  return{kind:'unknown',reason};
 }
 if(kind!=='absent'&&kind!=='angles')throw new CameraBoundaryError('configuration.kind','invalid-choice');
 fields(config,kind==='angles'?['kind','family','phi','theta','gamma']:['kind'],'configuration');
 const authored:{-readonly[K in keyof SourceCameraScalars]:SourceCameraScalars[K]}={phi:Math.fround(Math.PI/2),theta:0,gamma:0,center:[0,0,0],zoom:1,focalDistance:20};
 const origins:Record<SourceCameraField,SourceCameraOrigin>={phi:'scene-default',theta:'scene-default',gamma:'scene-default',center:'controller-default',zoom:'controller-default',focalDistance:'controller-default'};
 if(kind==='angles'){
  if(!CONFIG_FAMILIES.includes(required(config,'family','configuration.family') as SourceCameraConfigFamily))throw new CameraBoundaryError('configuration.family','invalid-choice');
  for(const key of ['phi','theta','gamma'] as const){
   if(Object.hasOwn(config,key)){authored[key]=scalar(config[key],`configuration.${key}`);origins[key]='configuration';}
   else origins[key]='configuration-default';
  }
 }
 if(Object.hasOwn(raw,'frame')){
  const frame=record(raw.frame,'frame');fields(frame,Object.keys(authored),'frame');
  for(const key of Object.keys(authored) as SourceCameraField[])if(Object.hasOwn(frame,key)){
   if(key==='center')authored.center=triple(frame.center,'frame.center');else authored[key]=scalar(frame[key],`frame.${key}`);
   origins[key]='frame';
  }
 }
 const value=Object.freeze({...authored,phi:Math.fround(authored.phi),theta:Math.fround(authored.theta),gamma:Math.fround(authored.gamma),zoom:Math.fround(authored.zoom),focalDistance:Math.fround(authored.focalDistance),center:Object.freeze(authored.center.map(Math.fround)) as unknown as SourceCameraVec3});
 return{kind:'known',state:Object.freeze({model:SOURCE_CAMERA_MODEL,authored:Object.freeze({...authored,center:Object.freeze([...authored.center]) as unknown as SourceCameraVec3}),value,origins:Object.freeze(origins)})};
});}
export type SourceCameraDisplayPolicy =
 {readonly kind:'ordinary-scene';readonly family:'surface'|'attractor'|'implicit'|'perlin'} |
 {readonly kind:'captured-density';readonly family:'map'|'symmetry';readonly angleChanges:'reanchor'|'retain-and-rotate';readonly viewport:'not-derived'} |
 {readonly kind:'fullscreen-viewport';readonly family:'fractal'|'domain';readonly sceneEuler:'bypassed';readonly viewport:'not-derived'} |
 {readonly kind:'samila-theta';readonly viewport:'not-derived'} |
 {readonly kind:'roots-owner';readonly viewport:'not-derived'} |
 {readonly kind:'unknown';readonly reason:string};
/** Classification facts only. No generic 2D transform is fabricated. */
export function sourceCameraDisplayPolicy(family:string,mode:'ordinary'|'density'|'fullscreen'):SourceCameraDisplayPolicy {
 if((family==='map'||family==='symmetry')&&mode==='density')return{kind:'captured-density',family,angleChanges:family==='map'?'reanchor':'retain-and-rotate',viewport:'not-derived'};
 if((family==='fractal'||family==='domain')&&mode==='fullscreen')return{kind:'fullscreen-viewport',family,sceneEuler:'bypassed',viewport:'not-derived'};
 if(family==='samila'&&mode==='density')return{kind:'samila-theta',viewport:'not-derived'};
 if(family==='roots')return{kind:'roots-owner',viewport:'not-derived'};
 if((family==='surface'||family==='attractor'||family==='implicit'||family==='perlin')&&mode==='ordinary')return{kind:'ordinary-scene',family};
 return{kind:'unknown',reason:`Unverified source camera display path: ${family}/${mode}`};
}
export interface SourceCameraViewport {
 readonly logicalWidth:number;readonly logicalHeight:number;readonly referenceLogicalHeight:number;
 readonly target:'primary'|'offscreen';
 /** Scene fade resets projection to ortho; unknown must not default to perspective. */
 readonly projectionPass:'perspective'|'scene-fade-orthographic'|'unknown';
}
export interface SourceCameraPlan {
 readonly model:typeof SOURCE_CAMERA_MODEL;readonly camera:SourceCameraState;
 readonly viewport:SourceCameraViewport;readonly displayScale:number;
 readonly projection:SourceCameraMatrix;readonly modelView:SourceCameraMatrix;
 /** Processing's independently maintained projmodelview, including the final
  * center translate. It cannot be reconstructed from the final P and M. */
 readonly transform:SourceCameraMatrix;
 readonly optics:Readonly<{halfSensorOverFocal:number;fov:number;cameraZ:number;aspect:number;near:number;far:number;orthographicFar:number|null}>;
 readonly arithmetic:'staged-float32-host-libm';
}
export type SourceCameraProjection = {readonly kind:'known';readonly plan:SourceCameraPlan}|{readonly kind:'unknown';readonly reason:string};
const F = Math.fround;
const add = (a: number, b: number) => F(a + b);
const sub = (a: number, b: number) => F(a - b);
const mul = (a: number, b: number) => F(a * b);
const div = (a: number, b: number) => F(a / b);
const finite = (values: readonly number[]) => values.every(Number.isFinite);



/** Only ordinary Scene matrices; no object transform, accumulation cache, pixel
 * density, auto-fit, 2D display transform or GL rasterization is implied. */
export function prepareSourceCamera(input:unknown,viewportInput:unknown):SourceCameraResult<SourceCameraProjection>{return attempt(()=>{
 const resolved=resolveSourceCamera(input);if(!resolved.ok)throw resolved.error;
 if(resolved.value.kind==='unknown')return resolved.value;
 const raw=record(viewportInput,'viewport');fields(raw,['logicalWidth','logicalHeight','referenceLogicalHeight','target','projectionPass'],'viewport');
 const dimension=(key:string)=>{const v=required(raw,key,`viewport.${key}`);if(typeof v!=='number'||!Number.isInteger(v)||v<=0||v>2147483647)throw new CameraBoundaryError(`viewport.${key}`,'dimension-required');return v;};
 const logicalWidth=dimension('logicalWidth'),logicalHeight=dimension('logicalHeight'),referenceLogicalHeight=dimension('referenceLogicalHeight');
 const target=required(raw,'target','viewport.target'),projectionPass=required(raw,'projectionPass','viewport.projectionPass');
 if(target!=='primary'&&target!=='offscreen')throw new CameraBoundaryError('viewport.target','invalid-choice');
 if(projectionPass==='unknown')return{kind:'unknown',reason:'Scene projection pass has not been observed'};
 if(projectionPass!=='perspective'&&projectionPass!=='scene-fade-orthographic')throw new CameraBoundaryError('viewport.projectionPass','invalid-choice');
 const camera=resolved.value.state,c=camera.value,w=F(logicalWidth),h=F(logicalHeight);
 const displayScale=target==='primary'?1:div(h,F(referenceLogicalHeight));
 const halfSensorOverFocal=div(div(25,2),c.focalDistance);
 const fov=Math.max(F(.001),Math.min(F(3.1405928134918213),mul(2,F(Math.atan(div(halfSensorOverFocal,c.zoom))))));
 const cameraZ=div(div(h,2),halfSensorOverFocal),aspect=div(w,h),near=div(cameraZ,100),far=mul(cameraZ,50);
 if(!finite([halfSensorOverFocal,fov,cameraZ,aspect,near,far])||cameraZ===0||near===far)throw new CameraBoundaryError('projection','singular-camera');
 const modelViewValues=cameraMatrix(w,h,cameraZ);translate(modelViewValues,div(w,2),div(h,2),0);
 if(Math.abs(sub(displayScale,1))>F(.001))for(let i=0;i<16;i++)if(i%4!==3)modelViewValues[i]=mul(modelViewValues[i],displayScale);
 // Apply each source operation in sequence: multiplying by the combined
 // rotation would reassociate Float32 sums and change low bits.
 rotate(modelViewValues,'z',-c.gamma);rotate(modelViewValues,'x',c.phi);rotate(modelViewValues,'z',c.theta);
 // Scene.render's fade wrapper calls camera()+ortho(), then popMatrix().
 // popMatrix restores modelview but not projection, so ortho is already active
 // during the scene transform. Every rotateImpl rebuilds projmodelview=P*M;
 // only the last rebuild survives to the draw, so earlier products need not
 // be allocated. translateImpl then translates M and P*M independently.
 const ortho=projectionPass==='scene-fade-orthographic'?orthographic(w,h):null;
 const projectionValues=ortho?.values??perspective(fov,aspect,near,far);
 const transformValues=[...projectionValues];apply(transformValues,modelViewValues);
 translate(modelViewValues,-c.center[0],-c.center[1],-c.center[2]);
 translate(transformValues,-c.center[0],-c.center[1],-c.center[2]);
 if(!finite([...modelViewValues,...projectionValues,...transformValues])||projectionValues[0]===0||projectionValues[5]===0||projectionValues[10]===0)throw new CameraBoundaryError('projection','singular-camera');
 return{kind:'known',plan:Object.freeze({model:SOURCE_CAMERA_MODEL,camera,viewport:Object.freeze({logicalWidth,logicalHeight,referenceLogicalHeight,target,projectionPass}),displayScale,projection:matrix(projectionValues),modelView:matrix(modelViewValues),transform:matrix(transformValues),optics:Object.freeze({halfSensorOverFocal,fov,cameraZ,aspect,near,far,orthographicFar:ortho?.far??null}),arithmetic:'staged-float32-host-libm'})};
});}
