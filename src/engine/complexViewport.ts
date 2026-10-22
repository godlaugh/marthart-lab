import {createSourceFractalFormulaFromConfig} from './sourceFractalFormulaRuntime';
import type {SceneDocument,Settings} from '../types';
import {numberSetting} from './expression';
import {FRACTAL_SOURCE_NUMERIC_PROFILE,FRACTAL_SOURCE_POWER_PROFILE,parseFractalNumericProfile,type FractalNumericProfile} from './fractalSourcePrecision';
export interface FractalViewport {centerX:number;centerY:number;centerXLow:number;centerYLow:number;zoom:number;rotation:number;}
export function parseFractalViewport(settings:Settings):FractalViewport{
  const n=(key:string,fallback:number,min=-Infinity,max=Infinity)=>numberSetting(settings,key,fallback,min,max);
  return{centerX:n('centerX',-.5),centerY:n('centerY',0),centerXLow:n('centerXLow',0),centerYLow:n('centerYLow',0),zoom:n('zoom',1,1e-6,1e28),rotation:n('rotation',0)};
}
/** Applicability is shared by configuration, raster and interaction consumers.
 * Each source marker remains dormant outside its own formula family. */
export function fractalViewportRules(profile:FractalNumericProfile,formula:unknown):FractalViewportRules {
 const sourceArithmetic=profile===FRACTAL_SOURCE_NUMERIC_PROFILE&&(formula==='newton'||formula==='nova')||profile===FRACTAL_SOURCE_POWER_PROFILE&&(formula==='mandelbrot'||formula==='julia');
 return sourceArithmetic?{sourceArithmetic:true,verticalRange:2,yDirection:'down'}:{sourceArithmetic:false,verticalRange:4,yDirection:'up'};
}
export interface FractalViewportRules {readonly sourceArithmetic:boolean;readonly verticalRange:2|4;readonly yDirection:'down'|'up';}
export interface PreparedFractalViewportNavigation {
 readonly profile:FractalNumericProfile;
 readonly formula:string;
 readonly rules:FractalViewportRules;
 readonly viewport:Readonly<FractalViewport>;
 readonly logicalSize:readonly[number,number];
 readonly aspect:number;
 /** Source angle is uploaded as F32; trigonometry and gesture arithmetic here
  * remain a local double reference, not the driver's varying/DS coordinates. */
 readonly rotation:number;
 readonly coordinateContract:'local-independent'|'source-navigation-reference';
}
/** Serializable completed-frame navigation facts. Logical size is independent
 * of physical/quality raster dimensions, exactly as in the source shader.
 * Source host aspect uses F32 resolution/max(height,1)/division. */
export function prepareFractalViewportNavigation(settings:Settings,logicalWidth:number,logicalHeight:number):PreparedFractalViewportNavigation {
 if(![logicalWidth,logicalHeight].every(v=>Number.isFinite(v)&&v>0))throw new Error('视口尺寸必须为正数');
 const profile=parseFractalNumericProfile(settings.fractalNumericProfile),formula=typeof settings.formula==='string'?settings.formula:'mandelbrot';
 const rules=fractalViewportRules(profile,formula),viewport=parseFractalViewport(settings);
 const logicalSize:readonly[number,number]=rules.sourceArithmetic?[Math.fround(logicalWidth),Math.fround(logicalHeight)]:[logicalWidth,logicalHeight];
 if(!logicalSize.every(v=>Number.isFinite(v)&&v>0))throw new Error('Source logical dimensions exceed finite float32 representation');
 const aspect=rules.sourceArithmetic?Math.fround(logicalSize[0]/Math.max(logicalSize[1],1)):logicalWidth/logicalHeight;
 const rotation=rules.sourceArithmetic?Math.fround(viewport.rotation):viewport.rotation;
 if(!Number.isFinite(aspect)||!Number.isFinite(rotation))throw new Error('视口超出数值范围');
 return Object.freeze({profile,formula,rules:Object.freeze(rules),viewport:Object.freeze(viewport),logicalSize:Object.freeze(logicalSize),aspect,rotation,coordinateContract:rules.sourceArithmetic?'source-navigation-reference':'local-independent'});
}
/** Coordinates use pixel centers; pointer edges pass x-.5/y-.5 explicitly. */
export function pixelOffset(x:number,y:number,width:number,height:number,view:FractalViewport):[number,number]{
  const re=((x+.5)/width-.5)*4*width/height/view.zoom,im=(.5-(y+.5)/height)*4/view.zoom;
  const co=Math.cos(view.rotation),si=Math.sin(view.rotation);return[re*co-im*si,re*si+im*co];
}
export function complexPixel(x:number,y:number,width:number,height:number,view:FractalViewport):[number,number]{
  const offset=pixelOffset(x,y,width,height,view);return[view.centerX+view.centerXLow+offset[0],view.centerY+view.centerYLow+offset[1]];
}
/** Pointer coordinates use the displayed raster edge, not a sampled pixel center. */
export function juliaSeedAtPointer(settings:Settings,x:number,y:number,width:number,height:number):Settings{
 if(settings.formula!=='mandelbrot'||settings.variant==='julia')throw new Error('请在 Mandelbrot 参数平面选择 Julia 种子');
 if(![x,y,width,height].every(Number.isFinite)||width<=0||height<=0||x<0||y<0||x>width||y>height)throw new Error('请选择分形图像内部的点');
 const facts=prepareFractalViewportNavigation(settings,width,height),view=facts.viewport;
 const offset=facts.rules.sourceArithmetic?[(x/width-.5)*2*facts.aspect/view.zoom,(y/height-.5)*2/view.zoom]:pixelOffset(x-.5,y-.5,width,height,view);
 const co=Math.cos(facts.rotation),si=Math.sin(facts.rotation);
 const [juliaReal,juliaImag]=facts.rules.sourceArithmetic?[view.centerX+view.centerXLow+offset[0]*co-offset[1]*si,view.centerY+view.centerYLow+offset[0]*si+offset[1]*co]:[view.centerX+view.centerXLow+offset[0],view.centerY+view.centerYLow+offset[1]];
 if(!Number.isFinite(juliaReal)||!Number.isFinite(juliaImag))throw new Error('Julia 种子超出有限范围');
 return{variant:'julia',juliaReal,juliaImag,centerX:0,centerY:0,centerXLow:0,centerYLow:0,zoom:1};
}

/** Picking a source Julia seed changes the formula owner, not dormant local settings. */
export function applyFractalJuliaSeed(scene:SceneDocument,values:Settings):SceneDocument {
 if(!scene.fractalSource)return{...scene,settings:{...scene.settings,...values}};
 const native=createSourceFractalFormulaFromConfig(scene.fractalSource.formula).nativeState();
 const real=Number(values.juliaReal),imag=Number(values.juliaImag);
 if(!Number.isFinite(real)||!Number.isFinite(imag))throw Error('Julia 种子超出有限范围');
 return{...scene,settings:{...scene.settings,...values,formula:'julia',fractalNumericProfile:FRACTAL_SOURCE_POWER_PROFILE},fractalSource:{...scene.fractalSource,formula:{...scene.fractalSource.formula,formulaId:'julia',fractalType:'julia',parameters:{floats:{power:native.formulaParams[0],bailout:native.bailout},complex:{julia_seed:[real,imag]}}}}};
}
