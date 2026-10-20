import {packSourceProcessingMatrix} from './sourceProcessingMatrix';
import {SOURCE_CAMERA_MODEL,type SourceCameraMatrix,type SourceCameraPlan,type SourceCameraScalars,type SourceCameraVec3} from './sourceCamera';

/** MapAttractorMobject / SymmetryChaosMobject from MathArt 1.7.8.
 * Camera matrices are captured by display, independently of density clears and
 * attachment resizes. See .cache/v2-iterated-camera-audit.md for bytecode PCs.
 */
export type CapturedDensityFamily='map'|'symmetry';
export interface CapturedDensityAnchor {
 readonly family:CapturedDensityFamily;
 /** Camera at the matrix capture, used by present's panel rotation. */
 readonly camera:SourceCameraScalars;
 /** Previous display observation, NOT the capture baseline. */
 readonly lastCamera:SourceCameraScalars;
 readonly projection:SourceCameraMatrix;
 readonly modelView:SourceCameraMatrix;
}
export interface PreparedDensityCameraFrame {readonly anchor:CapturedDensityAnchor;readonly clearInk:boolean;}
export interface PreparedCapturedDensityView {
 readonly family:CapturedDensityFamily;readonly width:number;readonly height:number;
 readonly rotation:number;readonly cos:number;readonly sin:number;readonly aspect:number;
 readonly filter:'nearest'|'linear';
}
export class SourceDensityCameraError extends Error {
 constructor(readonly kind:'input'|'nonfinite',message:string){super(message);this.name='SourceDensityCameraError';}
}
const F=Math.fround;
const preparedAnchors=new WeakSet<object>(),preparedViews=new WeakSet<object>();
const add=(a:number,b:number)=>F(a+b),sub=(a:number,b:number)=>F(a-b),mul=(a:number,b:number)=>F(a*b),div=(a:number,b:number)=>F(a/b);
function check(ok:unknown,message:string):asserts ok {if(!ok)throw new SourceDensityCameraError('input',message);}
function family(value:unknown):asserts value is CapturedDensityFamily {check(value==='map'||value==='symmetry','Captured density family is invalid');}
function size(width:number,height:number){check(Number.isSafeInteger(width)&&width>0&&Number.isSafeInteger(height)&&height>0&&Number.isSafeInteger(width*height),'Captured density dimensions are invalid');}
function camera(value:SourceCameraScalars):SourceCameraScalars {
 check(value&&typeof value==='object'&&Array.isArray(value.center)&&value.center.length===3,'Captured density camera is invalid');
 const values=[value.phi,value.theta,value.gamma,value.zoom,value.focalDistance,...value.center];
 check(values.every(v=>typeof v==='number'&&Number.isFinite(v)&&Number.isFinite(F(v))),'Captured density camera must be finite float32');
 return Object.freeze({phi:F(value.phi),theta:F(value.theta),gamma:F(value.gamma),zoom:F(value.zoom),focalDistance:F(value.focalDistance),center:Object.freeze(value.center.map(F)) as unknown as SourceCameraVec3});
}
function matrix(value:SourceCameraMatrix):SourceCameraMatrix {
 check(value&&Array.isArray(value.rowMajor)&&value.rowMajor.length===16&&value.rowMajor.every(v=>typeof v==='number'&&Number.isFinite(v)&&Number.isFinite(F(v))),'Captured density matrix is invalid');
 return packSourceProcessingMatrix(value.rowMajor.map(F));
}
function validateAnchor(value:CapturedDensityAnchor){
 if(value&&preparedAnchors.has(value))return;
 check(value&&typeof value==='object','Captured density anchor is invalid');family(value.family);camera(value.camera);camera(value.lastCamera);
 for(const m of [value.projection,value.modelView])check(m&&Array.isArray(m.rowMajor)&&m.rowMajor.length===16&&m.rowMajor.every(Number.isFinite),'Captured density anchor matrix is invalid');
}
/** The source always advances lastCam fields, even below the threshold. This
 * prevents small per-display changes from accumulating into a false clear.
 * Replay hosts must skip this call while replayActive/replayPending, as source
 * display does; clearing ink by itself must retain the returned anchor.
 */
export function prepareCapturedDensityCamera(kind:CapturedDensityFamily,plan:SourceCameraPlan,previous?:CapturedDensityAnchor):PreparedDensityCameraFrame {
 family(kind);check(plan&&plan.model===SOURCE_CAMERA_MODEL&&plan.camera,'Captured density requires a source camera plan');
 const current=camera(plan.camera.value);
 if(previous){validateAnchor(previous);check(previous.family===kind,'Captured density family changed without reset');}
 const old=previous?.lastCamera;
 const changed=old!==undefined&&[sub(current.zoom,old.zoom),...current.center.map((v,i)=>sub(v,old.center[i])),...(kind==='map'?[sub(current.phi,old.phi),sub(current.theta,old.theta),sub(current.gamma,old.gamma)]:[])].some(v=>Math.abs(v)>F(.0001));
 const anchor=Object.freeze({family:kind,camera:!previous||changed?current:previous.camera,lastCamera:current,projection:!previous||changed?matrix(plan.projection):previous.projection,modelView:!previous||changed?matrix(plan.modelView):previous.modelView});
 preparedAnchors.add(anchor);
 return Object.freeze({anchor,clearInk:changed});
}
type Vec4=readonly[number,number,number,number];
function product(m:readonly number[],p:Vec4):Vec4 {
 const row=(i:number)=>add(add(add(mul(m[i],p[0]),mul(m[i+1],p[1])),mul(m[i+2],p[2])),mul(m[i+3],p[3]));
 return[row(0),row(4),row(8),row(12)];
}
/** Input has already received mathematical scale/offset. Pixel coordinates use
 * top-down edges: pixel (i,j) has center (i+.5,j+.5). Projection remains P*(M*p)
 * rather than the independently maintained Processing projmodelview matrix.
 * GPU shader contraction/libm may differ in low bits from this CPU staging.
 */
export function projectCapturedDensityPoint(anchor:CapturedDensityAnchor,point:SourceCameraVec3,width:number,height:number):{readonly clip:Vec4;readonly pixel:readonly[number,number];readonly visible:boolean} {
 validateAnchor(anchor);size(width,height);check(Array.isArray(point)&&point.length===3,'Captured density point must be a triple');
 if(!point.every(v=>typeof v==='number'&&Number.isFinite(F(v))))throw new SourceDensityCameraError('nonfinite','Captured density point is nonfinite');
 const clip=product(anchor.projection.rowMajor,product(anchor.modelView.rowMajor,[F(point[0]),F(point[1]),F(point[2]),1]));
 const [x,y,z,w]=clip,finite=clip.every(Number.isFinite),visible=finite&&w>0&&x>=-w&&x<=w&&y>=-w&&y<=w&&z>=-w&&z<=w;
 const pixel:readonly[number,number]=finite&&w!==0?[mul(add(div(x,w),1),F(width/2)),mul(sub(1,div(y,w)),F(height/2))]:[NaN,NaN];
 return{clip,pixel,visible};
}
export function prepareCapturedDensityView(anchor:CapturedDensityAnchor,current:SourceCameraScalars,width:number,height:number):PreparedCapturedDensityView {
 validateAnchor(anchor);size(width,height);const c=camera(current),base=anchor.camera;
 const rotation=sub(add(sub(c.phi,base.phi),sub(c.theta,base.theta)),sub(c.gamma,base.gamma));
 if(!Number.isFinite(rotation))throw new SourceDensityCameraError('nonfinite','Captured density rotation overflowed float32');
 const view=Object.freeze({family:anchor.family,width,height,rotation,cos:F(Math.cos(-rotation)),sin:F(Math.sin(-rotation)),aspect:div(F(width),F(height)),filter:anchor.family==='map'?'nearest' as const:'linear' as const});
 preparedViews.add(view);return view;
}
export function validateCapturedDensityView(view:PreparedCapturedDensityView,width:number,height:number):void {
 if(view&&preparedViews.has(view)&&view.width===width&&view.height===height)return;
 check(view&&typeof view==='object','Captured density view is invalid');family(view.family);size(width,height);
 check(view.width===width&&view.height===height,'Captured density view dimensions differ');
 check(view.filter===(view.family==='map'?'nearest':'linear'),'Captured density filter is invalid');
 check([view.rotation,view.cos,view.sin,view.aspect].every(v=>typeof v==='number'&&Number.isFinite(v))&&view.aspect===div(F(width),F(height))&&view.cos===F(Math.cos(-view.rotation))&&view.sin===F(Math.sin(-view.rotation)),'Captured density view scalars differ');
}
export interface CapturedDensitySample {readonly index:number;readonly weight:number;}
/** Source present samples un-tonemapped accumulation. GL UV is bottom-up;
 * exposed indices are top-down. No expanded canvas or second image flip.
 */
export function sampleCapturedDensity(view:PreparedCapturedDensityView,x:number,y:number):readonly CapturedDensitySample[] {
 validateCapturedDensityView(view,view?.width,view?.height);const {width,height,aspect,cos,sin}=view;
 check(Number.isInteger(x)&&x>=0&&x<width&&Number.isInteger(y)&&y>=0&&y<height,'Captured density output pixel is invalid');
 // Start at the bottom-up fragment center; subtracting an already rounded
 // top-down UV from one would introduce an extra rounding operation.
 const u=div(add(F(x),.5),F(width)),v=div(sub(F(height-y),.5),F(height));
 const cx=mul(sub(u,.5),aspect),cy=sub(v,.5);
 const sourceU=add(div(sub(mul(cx,cos),mul(cy,sin)),aspect),.5),sourceV=add(add(mul(cx,sin),mul(cy,cos)),.5);
 if(sourceU<0||sourceU>1||sourceV<0||sourceV>1)return[];
 const clamp=(n:number,limit:number)=>Math.max(0,Math.min(limit-1,n));
 if(view.filter==='nearest')return[{index:(height-1-clamp(Math.floor(mul(sourceV,F(height))),height))*width+clamp(Math.floor(mul(sourceU,F(width))),width),weight:1}];
 const sx=sub(mul(sourceU,F(width)),.5),sy=sub(mul(sourceV,F(height)),.5),ix=Math.floor(sx),iy=Math.floor(sy),fx=sub(sx,ix),fy=sub(sy,iy);
 const samples:CapturedDensitySample[]=[];
 for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
  const weight=mul(dx?fx:sub(1,fx),dy?fy:sub(1,fy));if(weight===0)continue;
  const index=(height-1-clamp(iy+dy,height))*width+clamp(ix+dx,width),existing=samples.find(s=>s.index===index);
  if(existing){const n=samples.indexOf(existing);samples[n]={index,weight:add(existing.weight,weight)};}else samples.push({index,weight});
 }
 return samples;
}
