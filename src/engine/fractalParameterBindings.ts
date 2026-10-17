import type {ParameterAnimation,SceneDocument} from '../types';
interface ParameterSlot {name:string;real:string;imag?:string;}
const complex=(name:string,real:string,imag:string):ParameterSlot=>({name,real,imag});
const scalar=(name:string,real=name):ParameterSlot=>({name,real});
const start=complex('start_value','startReal','startImag'),seed=complex('julia_seed','juliaReal','juliaImag'),exponent=complex('exponent','power','powerImag'),bailout=scalar('bailout'),power=scalar('power'),relaxation=scalar('relaxation');
/** Observed formula catalog types are retained: scalar power is not implicitly
 * promoted to a complex binding merely because the renderer also has powerImag. */
const slots:Record<string,ParameterSlot[]>={
 mandelbrot:[power,bailout,complex('start_point','startReal','startImag')],julia:[power,bailout,seed],
 newton:[exponent,scalar('bailout','tolerance'),relaxation],nova:[exponent,scalar('bailout','tolerance'),start,relaxation,seed],
 phoenix:[start,seed,scalar('exponent1','power'),scalar('exponent2','phoenixPower2'),complex('distortion','feedback','feedbackImag'),bailout],
 magnet1:[complex('perturbation','startReal','startImag'),complex('parameter','juliaReal','juliaImag'),bailout,scalar('convergent_bailout','tolerance')],
 magnet2:[complex('perturbation','startReal','startImag'),complex('parameter','juliaReal','juliaImag'),bailout,scalar('convergent_bailout','tolerance')],
 lambda:[start,seed,bailout],c_sin:[start,seed,bailout],spiral_septagon:[start,seed,scalar('exponent','power'),scalar('singularity_guard_eps','singularityGuard'),bailout],
 binocular:[power,complex('quad_coeff','quadReal','quadImag'),complex('const_term','constReal','constImag'),complex('z0_coeff','z0Real','z0Imag'),scalar('denom_offset','denomOffset'),relaxation,seed,scalar('bailout','tolerance')],
 mandelbulb_3d:[power,bailout,scalar('phase_shift','bulbPhaseShift'),scalar('phase_speed','bulbPhaseSpeed'),scalar('camera_pitch','bulbCameraPitch'),scalar('surface_epsilon','bulbSurfaceEpsilon'),scalar('shadow_strength','bulbShadowStrength')],
};
export interface ResolvedParameterBinding {target:string;binding?:ParameterAnimation['binding'];}
export function resolveFractalParameterBinding(scene:SceneDocument,name:string):ResolvedParameterBinding|undefined {
 if(scene.kind!=='fractal')return;
 const suffix=name.endsWith('_re')?'real':name.endsWith('_im')?'imag':undefined,base=suffix?name.slice(0,-3):name;
 const slot=slots[String(scene.settings.formula??'mandelbrot')]?.find(s=>s.name===base);if(!slot)return;
 const key=suffix==='imag'&&slot.imag?slot.imag:slot.real;
 if(typeof scene.settings[key]!=='number')return;
 if(slot.imag&&!suffix){if(typeof scene.settings[slot.imag]!=='number')return;return{target:'settings.'+key,binding:{mode:'complex-full',imaginaryTarget:'settings.'+slot.imag}};}
 return{target:'settings.'+key};
}
export function fractalParameterTargets(scene:SceneDocument):string[]{
 if(scene.kind!=='fractal')return[];
 return [...new Set((slots[String(scene.settings.formula??'mandelbrot')]??[]).flatMap(slot=>[slot.real,...(slot.imag?[slot.imag]:[])])).values()].filter(key=>typeof scene.settings[key]==='number').map(key=>'settings.'+key);
}
export function complexCompanion(scene:SceneDocument,target:string):string|undefined{
 if(scene.kind!=='fractal')return;
 const slot=slots[String(scene.settings.formula??'mandelbrot')]?.find(slot=>'settings.'+slot.real===target&&slot.imag);return slot?'settings.'+slot.imag:undefined;
}
