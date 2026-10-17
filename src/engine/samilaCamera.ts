import type {ControlSpec,SceneDocument,Settings} from '../types';

export const SAMILA_CAMERA_MODEL='anchored-theta-v1' as const;
export interface SamilaCameraFrame {model:typeof SAMILA_CAMERA_MODEL;time:number;theta:number;}
export interface PreparedSamilaView {model:typeof SAMILA_CAMERA_MODEL;width:number;height:number;time:number;currentTheta:number;anchorTheta:number;delta:number;cos:number;sin:number;}
type Scene=Pick<SceneDocument,'kind'|'settings'>;
const finite=(v:unknown,name:string):number=>{if(typeof v!=='number'||!Number.isFinite(v))throw Error(`${name} 必须为有限数值`);return v;};
/** Omission preserves the former mathematical-plane camera behavior. The
 * authored baseline is never inferred from geometry rotation or orbit position. */
export function samilaCameraEnabled(scene:Scene):boolean{return scene.kind==='samila'&&scene.settings.samilaCameraModel===SAMILA_CAMERA_MODEL&&scene.settings.iteratedMode==='continuous'&&scene.settings.samilaHistoryModel==='bounded-v2'&&(scene.settings.densityProjection??'xy')==='xy';}
export function parseSamilaCamera(scene:Scene):{active:boolean;theta:number;warnings:string[]}{
 if(scene.kind!=='samila')return{active:false,theta:0,warnings:[]};
 const model=scene.settings.samilaCameraModel??'legacy-v1';
 if(model!=='legacy-v1'&&model!==SAMILA_CAMERA_MODEL)throw Error('Samila 相机模型无效');
 if(model==='legacy-v1')return{active:false,theta:0,warnings:[]};
 const theta=finite(scene.settings.samilaCameraTheta??0,'Samila 相机 theta'),active=samilaCameraEnabled(scene);
 return{active,theta,warnings:active?[]:['Samila 锚定相机仅在持续批次、限幅历史和 XY 密度投影下生效；当前配置已保留但未应用。']};
}
/** Explicit opt-in; retains every existing setting, including geometry rotation
 * and old tone values. Zero is a local authored default, not a native claim. */
export function initializeSamilaCamera(settings:Settings):Settings{return{samilaCameraTheta:0,...settings,iteratedMode:'continuous',samilaHistoryModel:'bounded-v2',densityProjection:'xy',samilaCameraModel:SAMILA_CAMERA_MODEL};}
export const samilaCameraControls:ControlSpec[]=[{key:'samilaCameraTheta',label:'相机起始 theta · 弧度',type:'number',step:.01,group:'Samila 相机',help:'编辑起始角会确定性重放历史。时间线旋转保留累积；清空时重新捕获锚点，不改变画面旋转或 rotateZ。'}];

// Runtime facts are intentionally absent from the serializable document. The
// timeline owns chronology; this owner only stores/reads its scalar component.
const frames=new WeakMap<SceneDocument,SamilaCameraFrame>();
export function initializeSamilaCameraFrame(scene:SceneDocument,time:number){frames.delete(scene);const parsed=parseSamilaCamera(scene);if(parsed.active)frames.set(scene,{model:SAMILA_CAMERA_MODEL,time:finite(time,'Samila 相机时间'),theta:parsed.theta});}
export function cloneSamilaCameraFrame(from:SceneDocument,to:SceneDocument){const value=frames.get(from);if(value)frames.set(to,{...value});}
export function samilaCameraFrame(scene:SceneDocument):SamilaCameraFrame|undefined{if(!samilaCameraEnabled(scene))return;const value=frames.get(scene);return value?{...value}:{model:SAMILA_CAMERA_MODEL,time:0,theta:parseSamilaCamera(scene).theta};}
export function writeSamilaTheta(scene:SceneDocument,theta:number){const value=samilaCameraFrame(scene);if(!value)throw Error('Samila 锚定相机当前未启用');frames.set(scene,{...value,theta:finite(theta,'Samila 相机 theta')});}
export function refreshSamilaCameraSetting(scene:SceneDocument,key:string){if(key==='samilaCameraTheta'&&samilaCameraEnabled(scene))writeSamilaTheta(scene,finite(scene.settings[key],'Samila 相机 theta'));}
/** Reduce each finite authored phase before combining, avoiding overflow and
 * loss of a small geometry rotation next to a very large retained winding. */
export function samilaSamplingRotation(rotation:number,anchor:number):number{return(finite(rotation,'Samila 采样旋转')%(2*Math.PI)+finite(anchor,'Samila 相机锚点')%(2*Math.PI))%(2*Math.PI);}
export function prepareSamilaView(frame:SamilaCameraFrame,anchorTheta:number,width:number,height:number,time=frame.time):PreparedSamilaView{
 const delta=(finite(frame.theta,'Samila 相机 theta')%(2*Math.PI)-finite(anchorTheta,'Samila 相机锚点')%(2*Math.PI))%(2*Math.PI),view:PreparedSamilaView={model:SAMILA_CAMERA_MODEL,width,height,time:finite(time,'Samila 显示时间'),currentTheta:frame.theta,anchorTheta,delta,cos:Math.cos(delta),sin:Math.sin(delta)};
 validateSamilaView(view,width,height);return view;
}
export function validateSamilaView(view:PreparedSamilaView,width:number,height:number):void{
 if(view.model!==SAMILA_CAMERA_MODEL||view.width!==width||view.height!==height||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>16384||height>16384||![view.time,view.currentTheta,view.anchorTheta,view.delta,view.cos,view.sin].every(Number.isFinite)||Math.abs(view.cos*view.cos+view.sin*view.sin-1)>1e-12)throw Error('Samila 密度显示事实无效');
}
/** Target and returned indices are top-down. Source sampling is explicitly
 * lower-left nearest: flipping before floor is wrong on exact row boundaries. */
export function samilaSourceIndex(view:PreparedSamilaView,x:number,y:number):number{
 const {width:w,height:h,cos:co,sin:si}=view,aspect=w/h,qx=((x+.5)/w-.5)*aspect,qy=.5-(y+.5)/h;
 const u=(co*qx+si*qy)/aspect+.5,v=-si*qx+co*qy+.5;
 if(u<0||u>1||v<0||v>1)return-1;
 const ix=Math.min(w-1,Math.max(0,Math.floor(u*w))),iy=Math.min(h-1,Math.max(0,Math.floor(v*h)));
 return(h-1-iy)*w+ix;
}
export const SAMILA_CAMERA_NAVIGATION_NOTICE='暂停时拖动平移、滚轮缩放会清空并重新采样。图像导出使用临时视图，保存项目保留原配置。';
