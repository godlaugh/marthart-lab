import type {FractalConfig} from '../scenes/complex';

/** The stopping distance and the coloring residual have different owners in
 * the reference shader: Magnet I tests distance to one but colors residual 0.
 * Preserve both facts; neither coloring nor consumers should reconstruct them. */
export interface FractalConvergence {iteration:number;metric:'step'|'fixed-point';distance:number;colorResidual:number;}
export const stepTolerance=(value:number)=>Math.max(value,1e-12);
export function usesStepConvergence(c:Pick<FractalConfig,'formula'|'convergenceMode'>):boolean {
 return c.convergenceMode==='step'&&(c.formula==='newton'||c.formula==='nova');
}
export function usesResidualConvergence(c:Pick<FractalConfig,'formula'|'convergenceMode'>):boolean {
 return c.convergenceMode==='residual'&&['magnet1','magnet2','binocular'].includes(c.formula);
}
export function usesConvergenceExit(c:Pick<FractalConfig,'formula'|'convergenceMode'>):boolean {
 return usesStepConvergence(c)||usesResidualConvergence(c);
}
export function convergenceStep(dx:number,dy:number,tolerance:number,iteration:number):FractalConvergence|undefined {
 const distance=Math.hypot(dx,dy);
 return distance<stepTolerance(tolerance)?{iteration,metric:'step',distance,colorResidual:distance}:undefined;
}
export function convergenceMagnet(c:Pick<FractalConfig,'formula'|'variant'|'tolerance'|'bailout'>,z:readonly[number,number],previous:readonly[number,number],iteration:number):FractalConvergence|undefined {
 if(!(c.tolerance>0&&Math.hypot(...z)<c.bailout))return;
 const step=c.formula==='magnet2'&&c.variant==='julia';
 const distance=Math.hypot(z[0]-(step?previous[0]:1),z[1]-(step?previous[1]:0));
 return distance<c.tolerance?{iteration,metric:step?'step':'fixed-point',distance,colorResidual:c.formula==='magnet1'?0:distance}:undefined;
}
/** Source Nova contracts the user's tolerance with the requested view's pixel
 * span, independently of preview scale. Never overwrite the scene tolerance. */
export function convergenceTolerance(c:FractalConfig,zoom:number,width:number,height:number):number {
 if(!usesStepConvergence(c))return c.tolerance;
 const user=stepTolerance(c.tolerance);
 if(c.formula!=='nova')return user;
 const pixelSpan=2/(Math.max(zoom,1e-12)*Math.max(Math.min(width,height),1));
 return Math.max(Math.min(user,Math.max(pixelSpan*64,1e-16)),Math.max(user*1e-3,1e-12));
}
export function convergenceColorIndex(exit:Pick<FractalConvergence,'iteration'|'colorResidual'>):number {
 const distance=Math.max(exit.colorResidual,1e-30);
 return .05*(exit.iteration+1-Math.log(Math.max(-Math.log(distance),1e-12))/.69314718056);
}
export const CONVERGENCE_CPU_NOTICE='Newton/Nova 步长收敛使用 CPU，保留残差与退出迭代供平滑着色；尚未启用此模式的 GPU 数值验证。';
export const RESIDUAL_CPU_NOTICE='Magnet/Binocular 收敛残差模式使用 CPU，分别保留停止距离与着色残差；此模式的 GPU 数值路径尚未验证。';
export const RESIDUAL_GPU_NOTICE='WebGL2 双 float 有理轨道与收敛残差；临界比较或数值不确定像素使用 CPU 双精度修复。';
