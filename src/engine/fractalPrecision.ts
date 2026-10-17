import {beginFractalDistance,advanceFractalDistance,finishFractalDistance} from './fractalDistance';
import type { FractalConfig, FractalOrbit } from '../scenes/complex';
import {usesStepConvergence,convergenceStep} from './fractalConvergence';
import { dc, dcAdd, dcSub, dcMul, dcDiv, dcScale, dcPow, dcNumbers, type DDComplex } from './doubleDouble';
import {pixelOffset,fractalViewportRules,type FractalViewport} from './complexViewport';
import {FractalPrecisionInputError} from './fractalSourcePrecision';
export {pixelOffset,type FractalViewport} from './complexViewport';
export * from './fractalSourcePrecision';
export function precisePixel(x:number,y:number,width:number,height:number,view:FractalViewport):DDComplex {
 const offset=pixelOffset(x,y,width,height,view);
 return dcAdd(dc(view.centerX,view.centerY,view.centerXLow,view.centerYLow),dc(...offset));
}
export function supportsDoubleDouble(c:FractalConfig):boolean {
 if(fractalViewportRules(c.numericProfile??'local-v1',c.formula).sourceNewtonNova)return false;
 return ['mandelbrot','julia','newton','nova'].includes(c.formula)&&c.power[1]===0&&Number.isInteger(c.power[0])&&c.power[0]>=1&&c.power[0]<=32;
}
export function supportsPerturbation(c:FractalConfig):boolean {
 return ['mandelbrot','julia'].includes(c.formula)&&supportsDoubleDouble(c);
}
function trapAt(z:[number,number],c:FractalConfig):number{
 const re=z[0]-c.trapCenter[0],im=z[1]-c.trapCenter[1],co=Math.cos(c.trapRotation),si=Math.sin(c.trapRotation);
 const x=(re*co-im*si)/c.trapAspect,y=re*si+im*co;
 return c.trapShape==='ring'?Math.abs(Math.hypot(x,y)-c.trapRadius):c.trapShape==='cross'?Math.min(Math.abs(x),Math.abs(y)):Math.hypot(x,y);
}
/** Direct independent DD oracle and repair path; Newton/Nova are evaluated
 * directly, without claiming that their rational perturbation is implemented. */
export function doubleDoubleOrbit(point:DDComplex,c:FractalConfig,onStep?:(z:[number,number])=>void):FractalOrbit {
 if(fractalViewportRules(c.numericProfile??'local-v1',c.formula).sourceNewtonNova)throw new FractalPrecisionInputError({kind:'input',field:'fractalNumericProfile',reason:'Source Newton/Nova requires its source GPU arithmetic; independent DoubleDouble is not a fallback'});
 if(!supportsDoubleDouble(c))throw new Error('此公式/指数不支持 DoubleDouble');
 const julia=c.formula==='julia'||c.variant==='julia',constant=julia?dc(...c.julia):point,p=c.power[0],stepConvergence=usesStepConvergence(c);
 const distance=beginFractalDistance(c.distance);
 // The local DD high word is projected to F32; its residual is not a DE input.
 const complete=(orbit:FractalOrbit,high:DDComplex):FractalOrbit=>distance?{...orbit,derivative:distance.derivative,distance:finishFractalDistance(distance,{finalZHigh:[Math.fround(high[0][0]),Math.fround(high[1][0])],iteration:orbit.convergence?.iteration??Math.max(0,orbit.count-1),exitKind:orbit.inside?0:orbit.converged?2:1,residualSquared:Math.fround(Math.fround(orbit.convergence?.colorResidual??0)**2)})}:orbit;
 let z=c.formula==='newton'||julia?point:dc(...c.start),derivative=dc(julia?1:0,0),trap=Infinity;
 for(let i=0;i<c.iterations;i++){
  const old=z,zp=dcPow(z,p);onStep?.(dcNumbers(z));advanceFractalDistance(distance,[Math.fround(z[0][0]),Math.fround(z[1][0])]);
  if(c.formula==='newton'||c.formula==='nova'){
   const residual=dcSub(zp,dc(1,0));
   if(!stepConvergence&&c.formula==='newton'&&Math.hypot(...dcNumbers(residual))<c.tolerance)return complete({z:dcNumbers(z),count:i,inside:true,invalid:false,trap:Math.min(trap,trapAt(dcNumbers(z),c)),derivative:dcNumbers(derivative),converged:true},z);
   const slope=dcScale(dcPow(z,p-1),p),[sr,si]=dcNumbers(slope);
   if(!(stepConvergence&&sr*sr+si*si<1e-24))z=dcSub(z,dcScale(dcDiv(residual,slope),c.relaxation));
   if(c.formula==='nova')z=dcAdd(z,constant);
  }else{
   if(!distance)derivative=dcAdd(dcMul(dcScale(dcPow(z,p-1),p),derivative),dc(julia?0:1,0));
   z=dcAdd(zp,constant);
  }
  const value=dcNumbers(z);
  if(!value.every(Number.isFinite))return complete({z:dcNumbers(old),count:i+1,inside:false,invalid:true,trap,derivative:dcNumbers(derivative),converged:false},old);
  trap=Math.min(trap,trapAt(value,c));
  if(stepConvergence){
   const [dx,dy]=dcNumbers(dcSub(z,old)),convergence=convergenceStep(dx,dy,c.convergenceTolerance??c.tolerance,i);
   if(convergence)return complete({z:value,count:i+1,inside:false,invalid:false,trap,derivative:dcNumbers(derivative),converged:true,convergence},z);
   continue;
  }
  const converged=['newton','nova'].includes(c.formula)&&Math.hypot(...dcNumbers(dcSub(z,old)))<c.tolerance;
  const inside=converged||Math.hypot(...value)<=(['newton','nova'].includes(c.formula)?1e12:c.bailout);
  if(converged||!inside)return complete({z:value,count:i+1,inside,invalid:false,trap,derivative:dcNumbers(derivative),converged},z);
 }
 return complete({z:dcNumbers(z),count:c.iterations,inside:true,invalid:false,trap,derivative:dcNumbers(derivative),converged:false},z);
}
export interface ReferenceOrbit { kind?:'local-power';layout?:'real-hi-imag-hi-real-low-imag-low';values:Float32Array; length:number; }
/** CPU DD reference split into float32 high/residual RGBA. Stops before
 * overflow; a GPU pixel that outlives this reference requests direct DD repair. */
export function referenceOrbit(c:FractalConfig,view:FractalViewport):ReferenceOrbit {
 if(!supportsPerturbation(c))throw new Error('不支持此公式的参考轨道');
 const julia=c.formula==='julia'||c.variant==='julia',center=dc(view.centerX,view.centerY,view.centerXLow,view.centerYLow);
 let z=julia?center:dc(...c.start);const constant=julia?dc(...c.julia):center,values:number[]=[];
 for(let i=0;i<=c.iterations;i++){
  const [re,im]=dcNumbers(z);if(!Number.isFinite(re)||!Number.isFinite(im)||Math.hypot(re,im)>1e30)break;
  const rh=Math.fround(z[0][0]),ih=Math.fround(z[1][0]);values.push(rh,ih,Math.fround((z[0][0]-rh)+z[0][1]),Math.fround((z[1][0]-ih)+z[1][1]));
  if(i<c.iterations)z=dcAdd(dcPow(z,c.power[0]),constant);
 }
 return {kind:'local-power',layout:'real-hi-imag-hi-real-low-imag-low',values:Float32Array.from(values),length:values.length/4};
}
export const perturbationThresholds={low:1e-2,medium:1e-4,high:1e-6,ultra:1e-8} as const;
