import type {Settings} from '../types';
import type {Complex} from './complexMath';

export const FRACTAL_DISTANCE_VERSION='mathart-1.7.8-v1' as const;
/** D.xy, estimate, valid; high.xy, iteration, exitKind; residualSquared, path, reserved.xy. */
export const FRACTAL_DISTANCE_GPU_STRIDE=12;
export type FractalDistanceVersion=typeof FRACTAL_DISTANCE_VERSION;
export interface FractalDistanceCapability {
 supported:boolean;power:number;powerF:number;isIntegerPower:boolean;
 reason?:'unsupported-formula'|'formula-type'|'complex-power'|'non-integer-power';
}
export interface FractalDistancePlan {
 version:FractalDistanceVersion;requested:boolean;julia:boolean;capability:FractalDistanceCapability;
}
export type FractalDistanceEstimate={valid:true;value:number}|{valid:false;value:0;reason:'capability-disabled'|'not-escaped'|'invalid-distance'};
export interface FractalDistanceTerminal {
 finalZHigh:Complex;iteration:number;exitKind:0|1|2;residualSquared:number;
}
export interface FractalDistanceFacts extends FractalDistanceTerminal {
 version:FractalDistanceVersion;path:'ordinary'|'perturbation';derivative:Complex;estimate:FractalDistanceEstimate;
}
export interface FractalDistanceState {plan:FractalDistancePlan;path:FractalDistanceFacts['path'];derivative:Complex;}
const f=Math.fround;
const excluded=new Set(['newton','nova','phoenix','magnet1','magnet2','lambda','c_sin','spiral_septagon','mandelbulb_3d']);
export function parseFractalDistanceVersion(raw:unknown):FractalDistanceVersion|undefined {
 if(raw===undefined)return;
 if(raw!==FRACTAL_DISTANCE_VERSION)throw new Error('Unsupported fractal distance model version');
 return raw;
}
/** Native FLOAT ingress: nonfinite becomes zero before the metadata minimum.
 * This is an effective parameter; callers retain their authored source value. */
export function normalizeFractalDistancePower(raw:number):number {
 const value=f(raw);return Math.max(2,Number.isFinite(value)?value:0);
}
function integerPower(powerF:number):boolean {return f(Math.abs(f(powerF-f(Math.floor(f(powerF+f(.5)))))))<f(1e-6);}
function sourceCapabilityFacts(input:{formula:string;formulaType:number;powerF:number;p:number}) {
 return {formulaSupported:!excluded.has(input.formula),typeSupported:input.formulaType===0,isIntegerPower:integerPower(f(input.powerF)),powerSupported:input.p>=2};
}
/** Already prepared shader inputs. Binocular deliberately is not excluded. */
export function supportsSourceFractalDistance(input:{formula:string;formulaType:number;powerF:number;p:number;requested:boolean}):boolean {
 const facts=sourceCapabilityFacts(input);
 return input.requested&&facts.formulaSupported&&facts.typeSupported&&facts.isIntegerPower&&facts.powerSupported;
}
export function fractalDistanceCapability(input:{formula:string;power:Complex;formulaType?:number;powerF?:number}):FractalDistanceCapability {
 const powerF=f(input.powerF??input.power[0]),power=Math.max(2,Math.floor(f(f(input.power[0])+f(.5))));
 const facts=sourceCapabilityFacts({formula:input.formula,formulaType:input.formulaType??0,powerF,p:power});
 const reason=!facts.formulaSupported||!['mandelbrot','julia','binocular'].includes(input.formula)?'unsupported-formula':!facts.typeSupported?'formula-type':input.power[1]!==0?'complex-power':!facts.isIntegerPower||!facts.powerSupported?'non-integer-power':undefined;
 return {supported:reason===undefined,power,powerF,isIntegerPower:facts.isIntegerPower,...(reason?{reason}:{})};
}
export function prepareFractalDistance(settings:Settings,input:{formula:string;power:Complex;variant:string}):FractalDistancePlan|undefined {
 const version=parseFractalDistanceVersion(settings.fractalDistanceVersion);if(!version)return;
 if(settings.fractalColorVersion!==2)throw new Error('Source distance estimation requires fractalColorVersion 2');
 return {version,requested:settings.insideColoring==='distance_estimator'||settings.outsideColoring==='distance_estimator',julia:input.formula==='julia'||input.variant==='julia',capability:fractalDistanceCapability(input)};
}
function multiply(a:Complex,b:Complex):Complex {return [f(f(a[0]*b[0])-f(a[1]*b[1])),f(f(a[0]*b[1])+f(a[1]*b[0]))];}
function length(z:Complex):number {return f(Math.sqrt(f(f(z[0]*z[0])+f(z[1]*z[1]))));}
/** Source's sequential 64-multiply helper, not exponentiation by squaring.
 * Callers supply the high components at their actual derivative update stage. */
export function stepFractalDistanceDerivative(derivative:Complex,zHigh:Complex,power:number,julia:boolean):Complex {
 let zp:Complex=[1,0];const z:Complex=[f(zHigh[0]),f(zHigh[1])];
 for(let i=0;i<Math.min(power-1,64);i++)zp=multiply(zp,z);
 const d=multiply([f(power),0],multiply(zp,derivative));
 return [f(d[0]+(julia?0:1)),f(d[1]+0)];
}
export function estimateFractalDistance(input:{power:number;capable:boolean;escaped:boolean;finalZHigh:Complex;derivative:Complex}):FractalDistanceEstimate {
 if(!input.capable)return {valid:false,value:0,reason:'capability-disabled'};
 if(!input.escaped)return {valid:false,value:0,reason:'not-escaped'};
 const radius=Math.max(length(input.finalZHigh),f(1e-9)),dLength=Math.max(length(input.derivative),f(1e-9));
 const value=f(f(f(f(input.power)*f(Math.log(radius)))*radius)/dLength);
 return Number.isFinite(value)&&value>=0?{valid:true,value}:{valid:false,value:0,reason:'invalid-distance'};
}
export function beginFractalDistance(plan?:FractalDistancePlan,path:FractalDistanceFacts['path']='ordinary'):FractalDistanceState|undefined {
 return plan?.requested?{plan,path,derivative:plan.julia?[1,0]:[0,0]}:undefined;
}
export function advanceFractalDistance(state:FractalDistanceState|undefined,zHigh:Complex):void {
 if(state?.plan.capability.supported)state.derivative=stepFractalDistanceDerivative(state.derivative,zHigh,state.plan.capability.power,state.plan.julia);
}
export function finishFractalDistance(state:FractalDistanceState|undefined,terminal:FractalDistanceTerminal):FractalDistanceFacts|undefined {
 if(!state)return;
 const finalZHigh:Complex=[f(terminal.finalZHigh[0]),f(terminal.finalZHigh[1])];
 return {...terminal,finalZHigh,version:state.plan.version,path:state.path,derivative:state.derivative,
  estimate:estimateFractalDistance({power:state.plan.capability.power,capable:state.plan.capability.supported,escaped:terminal.exitKind!==0,finalZHigh,derivative:state.derivative})};
}
/** DE's invalid-value route uses its own packed p0=(0,1,DEpower,bailout).
 * Dormant Smooth controls are not inputs to this operation. */
export function fractalDistanceColorIndex(facts:Pick<FractalDistanceFacts,'exitKind'|'iteration'|'finalZHigh'|'residualSquared'|'estimate'>,distancePower:number):number {
 if(facts.exitKind===0)return 0;
 const power=normalizeFractalDistancePower(distancePower);
 if(facts.estimate.valid)return f(Math.pow(Math.max(facts.estimate.value,0),f(1/power)));
 const iteration=f(f(facts.iteration)+1);
 if(facts.exitKind===2){
  const d=Math.max(f(Math.sqrt(Math.max(f(facts.residualSquared),0))),f(1e-30)),conv=Math.max(f(-f(Math.log(d))),f(1e-12));
  return f(f(.05)*f(iteration-f(f(Math.log(conv))/f(.69314718056))));
 }
 const exponent=f(1.000001),r=Math.max(length(facts.finalZHigh),exponent),il=f(1/Math.max(f(Math.log(exponent)),f(1e-12)));
 const lp=f(Math.log(Math.max(f(Math.log(Math.max(power,exponent))),f(1e-12))));
 return f(f(.05)*f(f(iteration+f(il*lp))-f(il*f(Math.log(Math.max(f(Math.log(r)),f(1e-12)))))));
}
/** Shared shader arithmetic for both ordinary and residual GPU producers.
 * Device log/length and fusion are verified separately from the staged CPU reference. */
export const FRACTAL_DISTANCE_GLSL=`
vec2 sourceDistanceMul(vec2 a,vec2 b){return vec2(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);}
vec2 sourceDistanceStep(vec2 d,vec2 high,int p,bool julia){
 vec2 zp=vec2(1.,0.);for(int i=0;i<64;i++){if(i>=p-1)break;zp=sourceDistanceMul(zp,high);}
 return sourceDistanceMul(vec2(float(p),0.),sourceDistanceMul(zp,d))+(julia?vec2(0.):vec2(1.,0.));
}
vec2 sourceDistanceEstimate(vec2 high,vec2 d,int p,bool capable,bool escaped){
 if(!capable||!escaped)return vec2(0.);
 float r=max(length(high),1e-9),dl=max(length(d),1e-9),value=float(p)*log(r)*r/dl;
 return !isnan(value)&&!isinf(value)&&value>=0.?vec2(value,1.):vec2(0.);
}
`;
