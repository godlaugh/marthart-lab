import {CameraBoundaryError,type SourceCameraResult,type SourceCameraScalars} from './sourceCamera';
import {sourceViewportRotation,sourceViewportZoom} from './sourceViewportArithmetic';

export type SourceIteratedNavigationEvent={readonly kind:'drag';readonly dx:number;readonly dy:number}|{readonly kind:'wheel';readonly count:number};
const F=Math.fround;
function float(value:unknown,path:string):number {
 if(typeof value!=='number')throw new CameraBoundaryError(path,'number-required');
 const result=F(value);if(!Number.isFinite(result))throw new CameraBoundaryError(path,'nonfinite-float32');return result;
}
/** Runtime camera only; document identity, saved pause angles and animation
 * child starts belong to their existing owners. Dimensions are logical pixels.
 * Fractional wheel counts are an explicit browser-adapter extension. */
export function navigateSourceIteratedCamera(camera:SourceCameraScalars,mode:'map-2d'|'rotate',event:unknown,width:number,height:number):SourceCameraResult<SourceCameraScalars>{
 try{
  if(mode!=='map-2d'&&mode!=='rotate')throw new CameraBoundaryError('navigation.mode','invalid-choice');
  if(!event||typeof event!=='object'||Array.isArray(event))throw new CameraBoundaryError('navigation.event','object-required');
  const e=event as Record<string,unknown>,keys=e.kind==='drag'?['kind','dx','dy']:e.kind==='wheel'?['kind','count']:undefined;
  if(!keys)throw new CameraBoundaryError('navigation.kind','invalid-choice');
  for(const key of Object.keys(e))if(!keys.includes(key))throw new CameraBoundaryError('navigation.'+key,'unknown-field');
  for(const key of keys)if(!Object.hasOwn(e,key))throw new CameraBoundaryError('navigation.'+key,'missing-field');
  let next={...camera,center:[...camera.center] as [number,number,number]};
  if(e.kind==='wheel')next.zoom=sourceViewportZoom(camera.zoom,float(e.count,'navigation.count'));
  else {
   const dx=float(e.dx,'navigation.dx'),dy=float(e.dy,'navigation.dy');
   if(mode==='rotate')next={...next,...sourceViewportRotation(camera.phi,camera.theta,dx,dy)};
   else {
    const w=Math.max(1,float(width,'navigation.width')),h=Math.max(1,float(height,'navigation.height'));
    const vertical=F(25/Math.max(F(.001),camera.zoom)),horizontal=F(vertical*F(w/h));
    next.center=[F(camera.center[0]-F(F(dx/w)*horizontal)),F(camera.center[1]-F(F(dy/h)*vertical)),camera.center[2]];
   }
  }
  for(const key of ['phi','theta','gamma','zoom','focalDistance'] as const)float(next[key],'navigation.'+key);
  next.center.forEach((v,i)=>float(v,'navigation.center.'+i));
  return{ok:true,value:next};
 }catch(error){if(error instanceof CameraBoundaryError)return{ok:false,error};throw error;}
}
