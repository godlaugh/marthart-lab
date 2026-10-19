import {SOURCE_CAMERA_MODEL,type SourceCameraInput} from './sourceCamera';
import type {SourceBouncingError,SourceBouncingResult} from './sourceBouncingConfig';

export const SOURCE_BOUNCING_VIEW_MODEL='source-bouncing-view-1.7.8' as const;
export interface SourceBouncingAngles {readonly phi:number;readonly theta:number;readonly gamma:number;}
export interface SourceBouncingView extends SourceBouncingAngles {readonly model:typeof SOURCE_BOUNCING_VIEW_MODEL;readonly zoom:number;}
export interface SourceBouncingNavigationState {
 readonly view:SourceBouncingView;readonly paused:boolean;readonly savedAngles:SourceBouncingAngles;
}
export type SourceBouncingNavigationEvent={readonly kind:'drag';readonly dx:number;readonly dy:number}|{readonly kind:'wheel';readonly count:number};
const F=Math.fround,MIN_ZOOM=F(.01),MAX_ZOOM=1000,angleKeys=['phi','theta','gamma'] as const;
class NavigationFailure extends Error {constructor(readonly detail:SourceBouncingError){super(detail.reason);}}
function fail(path:readonly string[],reason:string,kind:SourceBouncingError['kind']='input'):never{throw new NavigationFailure({kind,path,reason});}
function attempt<T>(run:()=>T):SourceBouncingResult<T>{try{return{ok:true,value:run()};}catch(error){if(error instanceof NavigationFailure)return{ok:false,error:error.detail};throw error;}}
function exact(raw:unknown,keys:readonly string[],path:readonly string[]):Record<string,unknown>{
 if(raw===null||typeof raw!=='object'||Array.isArray(raw))fail(path,'源弹跳视角需要对象');
 const value=raw as Record<string,unknown>;
 if(Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))fail(path,'源弹跳视角字段缺失或含未知字段');
 return value;
}
function float(value:unknown,path:readonly string[]):number{
 if(typeof value!=='number')fail(path,'源弹跳视角必须为数值');
 if(!Number.isFinite(value)||!Number.isFinite(F(value)))fail(path,'源弹跳视角必须为有限 Float32','nonfinite');
 if(!Object.is(F(value),value))fail(path,'源弹跳视角必须保留精确 Float32 值');
 return value;
}
function angles(raw:unknown,path:readonly string[]=[]):SourceBouncingAngles{
 const value=exact(raw,angleKeys,path);
 return Object.freeze({phi:float(value.phi,[...path,'phi']),theta:float(value.theta,[...path,'theta']),gamma:float(value.gamma,[...path,'gamma'])});
}
function readView(raw:unknown):SourceBouncingView{
 const value=exact(raw,['model',...angleKeys,'zoom'],[]);
 if(value.model!==SOURCE_BOUNCING_VIEW_MODEL)fail(['model'],'未知源弹跳视角模型');
 const a=angles({phi:value.phi,theta:value.theta,gamma:value.gamma}),zoom=float(value.zoom,['zoom']);
 if(zoom<MIN_ZOOM||zoom>MAX_ZOOM)fail(['zoom'],'源弹跳缩放必须在 Float32(0.01) 至 1000 范围');
 return Object.freeze({model:SOURCE_BOUNCING_VIEW_MODEL,...a,zoom});
}
export function parseSourceBouncingView(raw:unknown):SourceBouncingResult<SourceBouncingView>{return attempt(()=>readView(raw));}
/** Accept a complete delivered camera only when the compact view can represent
 * it losslessly. Do not silently discard a nonzero center or changed focal. */
export function sourceBouncingViewFromCamera(raw:unknown):SourceBouncingResult<SourceBouncingView>{return attempt(()=>{
 const camera=exact(raw,[...angleKeys,'zoom','center','focalDistance'],[]);
 const center=camera.center;
 if(!Array.isArray(center)||center.length!==3||![0,1,2].every(index=>Object.is(center[index],0)))fail(['center'],'源弹跳视角只表示精确的中心 [0,0,0]');
 if(!Object.is(camera.focalDistance,20))fail(['focalDistance'],'源弹跳视角只表示焦距 20');
 return readView({model:SOURCE_BOUNCING_VIEW_MODEL,phi:camera.phi,theta:camera.theta,gamma:camera.gamma,zoom:camera.zoom});
});}
export function sourceBouncingViewMatches(camera:unknown,view:SourceBouncingView):boolean{
 const from=sourceBouncingViewFromCamera(camera),expected=parseSourceBouncingView(view);
 return from.ok&&expected.ok&&sourceBouncingViewsEqual(from.value,expected.value);
}
/** Exact scalar equality also distinguishes source signed zero. */
export function sourceBouncingViewsEqual(a:SourceBouncingView,b:SourceBouncingView):boolean {
 return a.model===b.model&&([...angleKeys,'zoom'] as const).every(key=>Object.is(a[key],b[key]));
}
/** Only validated view facts enter this projection. Preserve the explicit
 * Bouncing baseline rather than using the shared camera's default phi=PI/2. */
export function sourceBouncingViewInput(view:SourceBouncingView):SourceCameraInput{
 return{model:SOURCE_CAMERA_MODEL,configuration:{kind:'absent'},frame:{phi:view.phi,theta:view.theta,gamma:view.gamma,zoom:view.zoom,center:[0,0,0],focalDistance:20}};
}
function state(view:SourceBouncingView,paused:boolean,savedAngles:SourceBouncingAngles):SourceBouncingNavigationState{
 return Object.freeze({view,paused,savedAngles});
}
function readState(raw:SourceBouncingNavigationState):SourceBouncingNavigationState{
 const value=exact(raw,['view','paused','savedAngles'],[]);
 if(typeof value.paused!=='boolean')fail(['paused'],'暂停状态必须为布尔值');
 return state(readView(value.view),value.paused,angles(value.savedAngles,['savedAngles']));
}
/** Local initialization/reload starts paused and snapshots the authored angles.
 * Runtime state is separate from the caller's canonical authoring object. */
export function initialSourceBouncingNavigation(cameraAngles:unknown):SourceBouncingResult<SourceBouncingNavigationState>{return attempt(()=>{
 const saved=angles(cameraAngles);return state(Object.freeze({model:SOURCE_BOUNCING_VIEW_MODEL,...saved,zoom:1}),true,saved);
});}
/** MathArt.togglePause: snapshot angles at PC90..129; restore at PC189..228.
 * Zoom is deliberately absent from that saved snapshot. Repeated state-setting
 * is idempotent; it must not overwrite the saved angles during paused drags. */
export function setSourceBouncingPaused(current:SourceBouncingNavigationState,paused:boolean):SourceBouncingNavigationState{
 if(current.paused===paused)return current;
 if(paused)return state(current.view,true,Object.freeze({phi:current.view.phi,theta:current.view.theta,gamma:current.view.gamma}));
 const unchanged=angleKeys.every(key=>Object.is(current.view[key],current.savedAngles[key]));
 return state(unchanged?current.view:Object.freeze({...current.view,...current.savedAngles}),false,current.savedAngles);
}
/** MathArt.updateCameraAngles PC17..47 writes current angles only. Editing the
 * separately owned author document is a caller policy; this must not overwrite
 * the pause snapshot. Reloading the author document creates a new initial state. */
export function editSourceBouncingAngles(current:SourceBouncingNavigationState,cameraAngles:unknown):SourceBouncingResult<SourceBouncingNavigationState>{return attempt(()=>{
 const previous=readState(current),next=angles(cameraAngles);
 return state(Object.freeze({...previous.view,...next}),previous.paused,previous.savedAngles);
});}
function eventFloat(raw:unknown,path:readonly string[]):number{
 if(typeof raw!=='number')fail(path,'视角交互增量必须为数值');
 const value=F(raw);if(!Number.isFinite(value))fail(path,'视角交互增量必须为有限 Float32','nonfinite');return value;
}
/** MathArt.mouseDragged PC663..739 and mouseWheel PC244..304. Deltas are
 * incremental, not accumulated from drag start. Native wheel getCount is int;
 * accepting a fractional count here is an explicit browser mapping extension.
 * Browser coordinates/count conversion belong to the caller, not this owner. */
export function navigateSourceBouncing(current:SourceBouncingNavigationState,event:SourceBouncingNavigationEvent):SourceBouncingResult<SourceBouncingNavigationState>{return attempt(()=>{
 const previous=readState(current);if(!previous.paused)fail(['paused'],'只能在暂停时调整源弹跳视角');
 if(event===null||typeof event!=='object')fail(['event'],'视角交互需要对象');
 let view:SourceBouncingView;
 if(event.kind==='drag'){
  const e=exact(event,['kind','dx','dy'],['event']),dx=eventFloat(e.dx,['event','dx']),dy=eventFloat(e.dy,['event','dy']);
  const theta=F(previous.view.theta-F(dx*F(.01))),phi=F(previous.view.phi+F(dy*F(.01)));
  if(!Number.isFinite(theta)||!Number.isFinite(phi))fail(['event'],'拖动后源相机角度溢出','nonfinite');
  view=Object.freeze({...previous.view,theta,phi});
 }else if(event.kind==='wheel'){
  const e=exact(event,['kind','count'],['event']),count=eventFloat(e.count,['event','count']);
  // Native widens zoom and 1.05f, uses double pow/product, narrows once,
  // then constrains. Intermediate infinity is clamped rather than rejected.
  const scaled=F(previous.view.zoom*Math.pow(F(1.05),-count));
  if(Number.isNaN(scaled))fail(['event','count'],'缩放结果不是数值','nonfinite');
  view=Object.freeze({...previous.view,zoom:Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,scaled))});
 }else return fail(['event','kind'],'未知源弹跳视角交互');
 return state(view,true,previous.savedAngles);
});}
