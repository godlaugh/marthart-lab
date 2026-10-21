import {activeFractalFormulaIdentity} from './sourceFractalIdentity';
import {FRACTAL_SOURCE_NUMERIC_PROFILE} from './fractalSourcePrecision';
import {usesCapturedDensityCamera} from './sourceCameraMode';
import {prepareDomainViewport,panDomainViewport,zoomDomainViewport,parseDomainViewportVersion,type PreparedDomainViewport} from './domainViewport';
import {samilaCameraEnabled} from './samilaCamera';
import type {SceneDocument,Settings,DensityBounds} from '../types';
import {hasContinuousDensity,hasProgressiveRoots} from './sceneCamera';
import {parseDensityViewport} from './density';
import {prepareFractalViewportNavigation,type PreparedFractalViewportNavigation} from './complexViewport';
import {bouncingRasterView} from '../scenes/bouncingRaster';
import {dd,ddAdd,type DD} from './doubleDouble';
export {hasMathematicalPlane} from './sceneCamera';

export interface PlaneNavigation {kind:'fractal'|'domain'|'bouncing'|'density';centerX:DD;centerY:DD;width:number;height:number;spanX:number;spanY:number;rotation:number;zoom:number;domainViewport?:PreparedDomainViewport;fractalViewport?:PreparedFractalViewportNavigation;}
export function rasterPresentationRect(canvasWidth:number,canvasHeight:number,rasterWidth:number,rasterHeight:number){
  if(![canvasWidth,canvasHeight,rasterWidth,rasterHeight].every(v=>Number.isFinite(v)&&v>0))throw new Error('视口尺寸必须为正数');
  const scale=Math.min(canvasWidth/rasterWidth,canvasHeight/rasterHeight),width=rasterWidth*scale,height=rasterHeight*scale;
  return{x:(canvasWidth-width)/2,y:(canvasHeight-height)/2,width,height,scale};
}
export function planeNavigation(scene:SceneDocument,width:number,height:number,renderedBounds?:DensityBounds,domainView?:PreparedDomainViewport,fractalView?:PreparedFractalViewportNavigation):PlaneNavigation{
  if(usesCapturedDensityCamera(scene))throw new Error('源密度相机请通过相机面板或时间线调整');
  if(samilaCameraEnabled(scene))throw new Error('Samila 使用临时几何视图；通用平面适配尚未实现');
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('视口尺寸必须为正数');
  if(hasContinuousDensity(scene)||hasProgressiveRoots(scene)){
    const bounds=parseDensityViewport(scene,Math.round(width),Math.round(height)).bounds??renderedBounds;
    if(!bounds)throw new Error('请等待密度画面生成后再调整视口');
    return{kind:'density',centerX:dd((bounds.minX+bounds.maxX)/2),centerY:dd((bounds.minY+bounds.maxY)/2),width,height,spanX:bounds.maxX-bounds.minX,spanY:bounds.maxY-bounds.minY,rotation:0,zoom:1};
  }
  if(scene.kind==='bouncing'&&scene.settings.bouncingPresentation==='raster'){
    const view=bouncingRasterView(scene,Math.max(1,Math.round(width)),Math.max(1,Math.round(height)));
    return{kind:'bouncing',centerX:dd(view.centerX),centerY:dd(view.centerY),width,height,spanX:view.spanX,spanY:view.spanY,rotation:0,zoom:1};
  }
  if(scene.kind!=='domain'&&!(scene.kind==='fractal'&&activeFractalFormulaIdentity(scene)!=='mandelbulb_3d'))throw new Error('此场景没有二维数学视口');
  if(scene.kind==='domain'){
    const view=domainView??prepareDomainViewport(scene.settings),spanY=view.version==='local-v1'?4/view.scale:2*view.halfSpan;
    return{kind:'domain',centerX:dd(view.centerX),centerY:dd(view.centerY),width,height,spanX:spanY*width/height,spanY,rotation:view.angle,zoom:view.effectiveScale,domainViewport:view};
  }
  const facts=fractalView??prepareFractalViewportNavigation(scene.fractalSource?{...scene.settings,formula:activeFractalFormulaIdentity(scene)!,fractalNumericProfile:FRACTAL_SOURCE_NUMERIC_PROFILE}:scene.settings,width,height),view=facts.viewport,spanY=facts.rules.verticalRange/view.zoom;
  // Keep the old multiplication/division sequence for omitted/local profiles.
  const spanX=facts.rules.sourceNewtonNova?spanY*facts.aspect:spanY*width/height;
  return{kind:scene.kind,centerX:dd(view.centerX,view.centerXLow),centerY:dd(view.centerY,view.centerYLow),width,height,spanX,spanY,rotation:facts.rotation,zoom:view.zoom,fractalViewport:facts};
}
function shifted(view:PlaneNavigation,x:number,y:number,spanX=view.spanX,zoom=view.zoom):Settings{
  const co=Math.cos(view.rotation),si=Math.sin(view.rotation),cx=ddAdd(view.centerX,dd(x*co-y*si)),cy=ddAdd(view.centerY,dd(x*si+y*co));
  if(![...cx,...cy,spanX,zoom].every(Number.isFinite))throw new Error('视口超出数值范围');
  if(view.kind==='bouncing')return{bouncingView:'fixed',bouncingViewCenterX:cx[0]+cx[1],bouncingViewCenterY:cy[0]+cy[1],bouncingViewWidth:spanX};
  if(view.kind==='density')return{densityView:'manual',densityCenterX:cx[0]+cx[1],densityCenterY:cy[0]+cy[1],densitySpan:spanX*view.height/view.width};
  return{centerX:cx[0],centerY:cy[0],...(view.kind==='fractal'?{centerXLow:cx[1],centerYLow:cy[1],zoom}:{scale:zoom})};
}
export function panPlane(view:PlaneNavigation,dx:number,dy:number):Settings{if(view.domainViewport&&view.domainViewport.version!=='local-v1')return panDomainViewport(view.domainViewport,dx,dy,view.width,view.height);return shifted(view,-dx/view.width*view.spanX,(view.fractalViewport?.rules.yDirection==='down'?-dy:dy)/view.height*view.spanY);}
/** Keep the mathematical point under the pointer fixed as the scale changes. */
export function zoomPlane(view:PlaneNavigation,x:number,y:number,deltaPixels:number):Settings{
  if(view.domainViewport&&view.domainViewport.version!=='local-v1')return zoomDomainViewport(view.domainViewport,x,y,view.width,view.height,deltaPixels);
  if(![x,y,deltaPixels].every(Number.isFinite))throw new Error('视口输入必须有限');
  const factor=Math.exp(-deltaPixels*.001),zoom=Math.max(1e-6,Math.min(view.kind==='fractal'?1e28:1e12,view.zoom*factor));
  const spanX=view.kind==='density'?Math.max(1e-12,Math.min(1e30,view.spanY/factor))*view.width/view.height:view.kind==='bouncing'?Math.max(1e-6,Math.min(1e12,view.spanX/factor)):view.spanX*view.zoom/zoom,ratio=spanX/view.spanX;
  return shifted(view,(x/view.width-.5)*view.spanX*(1-ratio),(view.fractalViewport?.rules.yDirection==='down'?y/view.height-.5:.5-y/view.height)*view.spanY*(1-ratio),spanX,zoom);
}
export function fitPlane(scene:SceneDocument,domainView?:PreparedDomainViewport):Settings{
  if(usesCapturedDensityCamera(scene))throw new Error('源密度相机请通过相机面板或时间线调整');
  if(samilaCameraEnabled(scene))throw new Error('Samila 使用临时几何视图；通用平面适配尚未实现');
  if(hasContinuousDensity(scene)||hasProgressiveRoots(scene))return{densityView:'auto'};
  if(scene.kind==='bouncing')return{bouncingView:'fit'};
  if(scene.kind==='domain')return{centerX:0,centerY:0,scale:(domainView?.version??parseDomainViewportVersion(scene.settings.domainViewportVersion))==='local-v1'?1:2.5};
  return{centerX:activeFractalFormulaIdentity(scene)==='mandelbrot'?-.5:0,centerY:0,centerXLow:0,centerYLow:0,zoom:1};
}
