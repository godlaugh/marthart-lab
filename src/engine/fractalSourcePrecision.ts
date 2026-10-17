import type {FractalConfig} from '../scenes/complex';
import type {FractalViewport} from './complexViewport';
import type {DD,DDComplex} from './doubleDouble';

export const FRACTAL_SOURCE_NUMERIC_PROFILE='mathart-1.7.8-newton-nova-v1' as const;
export const FRACTAL_SOURCE_REFERENCE_LIMIT=2048;
/** Local bounded-work admission, not an original application limit or timing guarantee. */
export const MAX_FRACTAL_SOURCE_REFERENCE_WORK=24_000_000;
export type FractalNumericProfile='local-v1'|typeof FRACTAL_SOURCE_NUMERIC_PROFILE;
/** Omission is the existing independent numerical contract. The authored source
 * marker may remain dormant on another formula; activation belongs to caller. */
export function parseFractalNumericProfile(raw:unknown):FractalNumericProfile {
 if(raw===undefined||raw==='local-v1')return 'local-v1';
 if(raw===FRACTAL_SOURCE_NUMERIC_PROFILE)return raw;
 throw new FractalPrecisionInputError({kind:'input',field:'fractalNumericProfile',reason:'Unknown fractal numeric profile'});
}
export interface FractalSourcePlanOptions {readonly precision:unknown}
export type FractalSourcePrecision='low'|'medium'|'high';
const F=Math.fround;
type Result<T,E>={ok:true;value:T}|{ok:false;error:E};
export interface FractalLogicalSize {
 readonly logicalWidth:number;readonly logicalHeight:number;
 readonly provenance:'requested-output-local'|'canvas-logical-local'|'source-logical';
}
export type FractalSourcePrecisionInput=Pick<FractalConfig,'formula'|'variant'|'power'|'start'|'julia'|'iterations'|'tolerance'|'relaxation'>;
export interface FractalPrecisionError {kind:'input'|'capacity';field:string;reason:string}
export class FractalPrecisionInputError extends Error {
 constructor(readonly failure:FractalPrecisionError){super(failure.reason);this.name='FractalPrecisionInputError';}
}
export type FractalPerturbationReason='NEWTON_ELIGIBLE'|'NOVA_ELIGIBLE'|'NEWTON_POWER_CONDITION'|'NOVA_POWER_CONDITION'|'NEWTON_NON_INTEGER_POWER_UNSUPPORTED'|'NOVA_NON_INTEGER_POWER_UNSUPPORTED'|'ZOOM_BELOW_GATE';
export interface FractalSourcePlan {
 readonly profile:typeof FRACTAL_SOURCE_NUMERIC_PROFILE;
 readonly formula:'newton'|'nova';readonly authoredVariant:string;readonly isJulia:boolean;
 readonly iterations:number;readonly maximumShaderIterations:2048;
 readonly shaderPower:readonly[number,number];readonly shaderIntegerPower:number;
 readonly shaderRelaxation:number;readonly sourceJuliaConstant:readonly[number,number];
 readonly shaderJuliaConstant:readonly[number,number,number,number];
 readonly bailout:number;
 /** Staged CPU diagnostic only; the GPU computes the retained expression in
  * its shader, including driver sqrt. This value is not an acceptance oracle. */
 readonly toleranceSquaredReference:number;
 readonly logicalSize:readonly[number,number];readonly logicalSizeProvenance:FractalLogicalSize['provenance'];
 readonly center:DDComplex;readonly shaderCenter:readonly[number,number,number,number];readonly zoom:readonly[number,number];readonly rotation:number;
 readonly ordinary:{readonly enabled:true};
 readonly perturbation:{readonly enabled:boolean;readonly reason:FractalPerturbationReason;readonly precision:FractalSourcePrecision;readonly threshold:number;readonly absFactor:number;readonly relLimit:number};
 readonly reference:{readonly power:number;readonly relaxation:number;readonly initialZ:DDComplex;readonly constant:DDComplex;readonly length:number;readonly nearZeroShift:number;readonly workUnits:number};
 readonly stopRules:{readonly comparison:'strict-high-word-step-squared';readonly ordinaryFinalZ:'next';readonly perturbFinalZ:'current';readonly perturbLastStep:'not-compared';readonly glitch:'continue-ordinary-ds'};
 /** Includes every reference-producing input, including logical dimensions.
  * Unlike the shipped cache, a changed near-zero-origin size cannot reuse it. */
 readonly key:string;
}

// Static transcription of mathart.fractal.math.DoubleDouble. These are NOT
// the independent local DD helpers: its multiply/divide rounding order differs.
const of=(x:number):DD=>[x,0];
function add(a:DD,b:DD):DD {const s=a[0]+b[0],v=s-a[0],e=((b[0]-v)+(a[0]-(s-v))+a[1])+b[1],h=s+e;return[h,e-(h-s)];}
function sub(a:DD,b:DD):DD {const s=a[0]-b[0],v=s-a[0],e=((-b[0]-v)+(a[0]-(s-v))+a[1])-b[1],h=s+e;return[h,e-(h-s)];}
function mul(a:DD,b:DD):DD {
 const p=a[0]*b[0],ac=a[0]*134217729,bc=b[0]*134217729;
 const ah=ac-(ac-a[0]),bh=bc-(bc-b[0]),al=a[0]-ah,bl=b[0]-bh;
 let error=ah*bh-p;error=error+(ah*bl+al*bh);error=error+al*bl;
 const cross=a[0]*b[1]+a[1]*b[0],s=p+cross,v=s-p;
 const e=(a[1]*b[1]+((cross-v)+(p-(s-v))))+error,h=s+e;
 return[h,e-(h-s)];
}
function div(a:DD,b:DD):DD {const q=of(a[0]/b[0]),r=sub(a,mul(b,q));return add(q,of(r[0]/b[0]));}
const parts=(high:number,low:number):DD=>add(of(high),of(low));
const complex=(re:number,im:number):DDComplex=>[of(re),of(im)];
const sum=(a:DD)=>a[0]+a[1];
const cloneComplex=(a:DDComplex):DDComplex=>[[a[0][0],a[0][1]],[a[1][0],a[1][1]]];
const product=(a:DDComplex,b:DDComplex):DDComplex=>[sub(mul(a[0],b[0]),mul(a[1],b[1])),add(mul(a[0],b[1]),mul(a[1],b[0]))];
function roundLongToInt(value:number):number {
 const n=value>=2**63?9223372036854775807n:value<=-(2**63)?-9223372036854775808n:BigInt(Math.round(value)||0);
 return Number(BigInt.asIntN(32,n));
}
function floatRoundInt(value:number):number {return Math.min(2147483647,Math.max(-2147483648,Math.round(value)||0));}
const identity=(value:unknown)=>JSON.stringify(value,(_k,v:unknown)=>typeof v==='number'&&Object.is(v,-0)?{negativeZero:true}:v);
const failed=(field:string,reason:string,kind:FractalPrecisionError['kind']='input'):Result<never,FractalPrecisionError>=>({ok:false,error:{kind,field,reason}});
const pair=(value:unknown):value is [number,number]=>Array.isArray(value)&&value.length===2&&value.every(v=>typeof v==='number'&&Number.isFinite(v));
const preparedPlans=new WeakSet<object>();

/** Typed config -> source runtime facts. No settings parsing or source aliases
 * occur here. FormulaRuntimeMapper selects Nova start_value/julia_seed BEFORE
 * the Mobject passes juliaCx/Cy to the reference service; Newton forces Mandel.
 * The dimension provenance is explicit: output pixels do not prove native DPI. */
export function prepareFractalSourcePlan(config:FractalSourcePrecisionInput,view:FractalViewport,size:FractalLogicalSize,options:FractalSourcePlanOptions):Result<FractalSourcePlan,FractalPrecisionError> {
 if(!config||!view||!size)return failed('plan','Source fractal precision inputs are required');
 const precision=options?.precision;
 if(precision!=='low'&&precision!=='medium'&&precision!=='high')return failed('precision','Source precision requires low, medium or high');
 if(config.formula!=='newton'&&config.formula!=='nova')return failed('formula','Source numeric profile requires Newton or Nova');
 if(!['mandelbrot','julia'].includes(config.variant))return failed('variant','Unknown fractal variant');
 for(const key of ['power','start','julia'] as const)if(!pair(config[key]))return failed(key,'Source complex parameters require two finite numbers');
 if(!Number.isInteger(config.iterations)||config.iterations<1||config.iterations>4096)return failed('iterations','Fractal request supports 1–4096 iterations','capacity');
 if(!Number.isFinite(config.tolerance)||!Number.isFinite(config.relaxation))return failed('parameters','Tolerance and relaxation must be finite');
 for(const key of ['centerX','centerY','centerXLow','centerYLow','zoom','rotation'] as const)if(!Number.isFinite(view[key]))return failed(key,'Viewport values must be finite');
 if(view.zoom<=0)return failed('zoom','Source viewport zoom must be positive');
 if(!['requested-output-local','canvas-logical-local','source-logical'].includes(size.provenance))return failed('logicalSizeProvenance','Logical size provenance is required');
 if(![size.logicalWidth,size.logicalHeight].every(n=>Number.isFinite(n)&&n>0&&Number.isFinite(F(n))&&F(n)>0))return failed('logicalSize','Logical dimensions must remain finite and positive in float32');
 const shaderPower=[F(config.power[0]),F(config.power[1])] as const,shaderRelaxation=F(config.relaxation),rotation=F(view.rotation);
 const bailout=Math.max(F(1e-12),F(config.tolerance)),zoom=[F(view.zoom),F(view.zoom-F(view.zoom))] as const;
 if(![...shaderPower,shaderRelaxation,bailout,...zoom,rotation].every(Number.isFinite))return failed('float32','Source scalar upload exceeds finite float32 representation','capacity');
 const shaderIntegerPower=Math.floor(F(shaderPower[0]+F(.5)));
 if(shaderIntegerPower<-2147483648||shaderIntegerPower>2147483647)return failed('power','Source shader int(power) conversion is outside its defined range','capacity');
 const power=roundLongToInt(config.power[0]),formula=config.formula,isJulia=formula==='nova'&&config.variant==='julia';
 // Java host Math.round(float) gate and GLSL floor(float+.5) are separate facts.
 const roundedPower=Math.max(0,floatRoundInt(shaderPower[0]));
 const integerPower=Math.abs(shaderPower[1])<F(1e-6)&&Math.abs(F(shaderPower[0]-F(floatRoundInt(shaderPower[0]))))<F(1e-6);
 let reason:FractalPerturbationReason=roundedPower<2?(formula==='nova'?'NOVA_POWER_CONDITION':'NEWTON_POWER_CONDITION'):!integerPower?(formula==='nova'?'NOVA_NON_INTEGER_POWER_UNSUPPORTED':'NEWTON_NON_INTEGER_POWER_UNSUPPORTED'):view.zoom<100?'ZOOM_BELOW_GATE':formula==='nova'?'NOVA_ELIGIBLE':'NEWTON_ELIGIBLE';
 const enabled=reason==='NOVA_ELIGIBLE'||reason==='NEWTON_ELIGIBLE';
 // One unit per complex product or remaining DD operation (division is one
 // operation here), including the last unconsumed next-state calculation. This
 // is a bounded algorithm-work proxy, not a source power limit.
 const referenceLength=Math.min(config.iterations,FRACTAL_SOURCE_REFERENCE_LIMIT);
 const workUnits=referenceLength*(Math.max(1,power-1)+(formula==='nova'?20:18));
 if(enabled&&(!Number.isSafeInteger(workUnits)||workUnits>MAX_FRACTAL_SOURCE_REFERENCE_WORK))return failed('referenceWork','Source reference exceeds the 24,000,000 operation-proxy work budget','capacity');
 const logicalSize=[F(size.logicalWidth),F(size.logicalHeight)] as const;
 const center:DDComplex=[parts(view.centerX,view.centerXLow),parts(view.centerY,view.centerYLow)];
 if(!center.flat().every(Number.isFinite))return failed('center','Source DoubleDouble center is nonfinite','capacity');
 const shaderCenter=[F(center[0][0]),F((center[0][0]-F(center[0][0]))+center[0][1]),F(center[1][0]),F((center[1][0]-F(center[1][0]))+center[1][1])] as const;
 const sourceJuliaConstant=[...(formula==='nova'&&!isJulia?config.start:config.julia)] as [number,number];
 const shaderJuliaConstant=[F(sourceJuliaConstant[0]),F(sourceJuliaConstant[0]-F(sourceJuliaConstant[0])),F(sourceJuliaConstant[1]),F(sourceJuliaConstant[1]-F(sourceJuliaConstant[1]))] as const;
 const zoomProgress=Math.min(1,Math.max(0,(Math.log10(Math.max(1,view.zoom))-2)/28));
 const perturbation:FractalSourcePlan['perturbation']={enabled,reason,precision,threshold:F(precision==='low'?.01:precision==='high'?1e-6:1e-4),absFactor:F(4096*(1+zoomProgress*.5)),relLimit:F(1e6*(1+zoomProgress*9))};
 let initialZ=isJulia||formula==='newton'?center:complex(...sourceJuliaConstant);
 const constant=isJulia?complex(...sourceJuliaConstant):center;
 let nearZeroShift=0;
 if(formula==='newton'&&Math.abs(sum(initialZ[0]))+Math.abs(sum(initialZ[1]))<1e-24){nearZeroShift=Math.max(2/Math.max(1,Math.min(...logicalSize))*.5,1e-18);initialZ=[add(initialZ[0],of(nearZeroShift)),initialZ[1]];}
 const relaxation=shaderRelaxation>0?shaderRelaxation:1;
 let toleranceSquared=F(bailout*bailout);
 if(formula==='nova'){
  const z=Math.max(F(zoom[0]+zoom[1]),F(1e-12)),minRes=Math.max(Math.min(...logicalSize),1);
  const pixelSpan=F(2/F(z*minRes)),user=F(Math.sqrt(Math.max(toleranceSquared,F(1e-30))));
  const auto=Math.max(F(pixelSpan*64),F(1e-16)),minimum=Math.max(F(user*F(1e-3)),F(1e-12));
  const threshold=Math.max(Math.min(user,auto),minimum);toleranceSquared=F(threshold*threshold);
 }
 const reference={power,relaxation,initialZ:cloneComplex(initialZ),constant:cloneComplex(constant),length:referenceLength,nearZeroShift,workUnits};
 const key=identity([FRACTAL_SOURCE_NUMERIC_PROFILE,formula,config.variant,isJulia,config.iterations,config.power,config.start,config.julia,config.relaxation,config.tolerance,[view.centerX,view.centerXLow,view.centerY,view.centerYLow,view.zoom,view.rotation],logicalSize,size.provenance,precision,reference]);
 const plan:FractalSourcePlan={profile:FRACTAL_SOURCE_NUMERIC_PROFILE,formula,authoredVariant:config.variant,isJulia,iterations:config.iterations,maximumShaderIterations:2048,shaderPower,shaderIntegerPower,shaderRelaxation,sourceJuliaConstant,shaderJuliaConstant,bailout,toleranceSquaredReference:toleranceSquared,logicalSize,logicalSizeProvenance:size.provenance,center:cloneComplex(center),shaderCenter,zoom,rotation,ordinary:{enabled:true},perturbation,reference,stopRules:{comparison:'strict-high-word-step-squared',ordinaryFinalZ:'next',perturbFinalZ:'current',perturbLastStep:'not-compared',glitch:'continue-ordinary-ds'},key};
 // Plans are immutable owned facts; later consumers cannot mutate a cache key's
 // computation by changing a nested tuple after admission.
 freezePlan(plan);preparedPlans.add(plan);return {ok:true,value:plan};
}
function freezePlan(value:unknown):void {if(value&&typeof value==='object'){for(const item of Object.values(value))freezePlan(item);Object.freeze(value);}}
export function parseFractalSourcePlan(config:FractalSourcePrecisionInput,view:FractalViewport,size:FractalLogicalSize,options:FractalSourcePlanOptions):FractalSourcePlan {const r=prepareFractalSourcePlan(config,view,size,options);if(!r.ok)throw new FractalPrecisionInputError(r.error);return r.value;}
export function validateFractalSourcePlan(plan:FractalSourcePlan):void {if(!plan||!preparedPlans.has(plan))throw new FractalPrecisionInputError({kind:'input',field:'plan',reason:'Source precision plan must be prepared by its owner'});}

export type FractalSourceReferenceFailure=FractalPerturbationReason|'REF_DERIV_SINGULAR'|'NOVA_REF_DERIV_SINGULAR'|'REF_STEP_INVALID'|'NOVA_REF_STEP_INVALID';
export interface FractalSourceReferenceReady {
 readonly kind:'ready';readonly profile:typeof FRACTAL_SOURCE_NUMERIC_PROFILE;
 readonly layout:'real-hi-low-imag-hi-low';readonly values:Float32Array;readonly length:number;
 readonly key:string;readonly bytes:number;readonly initialZ:DDComplex;readonly constant:DDComplex;
}
export type FractalSourceReferenceResult=FractalSourceReferenceReady|{readonly kind:'unavailable';readonly reason:FractalSourceReferenceFailure;readonly key:string;readonly length:0;readonly bytes:0;readonly failedStep?:number};
export interface FractalReferenceBuildOptions {isCancelled?:()=>boolean;onBytes?:(bytes:number)=>void}
const aborted=(options:FractalReferenceBuildOptions)=>{if(options.isCancelled?.())throw new DOMException('Fractal reference cancelled','AbortError');};
/** PerturbationReferenceOrbitService.buildOrbit/iterateNewtonLike transcription.
 * All current states are packed before stepping, including the final unused
 * step's failure check. No early convergence or finite-prefix substitution. */
export function buildFractalSourceReference(plan:FractalSourcePlan,options:FractalReferenceBuildOptions={}):FractalSourceReferenceResult {
 validateFractalSourcePlan(plan);aborted(options);
 const unavailable=(reason:FractalSourceReferenceFailure,failedStep?:number):FractalSourceReferenceResult=>({kind:'unavailable',reason,key:plan.key,length:0,bytes:0,...(failedStep===undefined?{}:{failedStep})});
 if(!plan.perturbation.enabled)return unavailable(plan.perturbation.reason);
 const r=plan.reference;options.onBytes?.(r.length*16);aborted(options);
 const values=new Float32Array(r.length*4),p=of(r.power),relax=of(r.relaxation),one=of(1);
 let z=cloneComplex(r.initialZ);
 for(let i=0;i<r.length;i++){
  aborted(options);const re=sum(z[0]),im=sum(z[1]),rh=F(re),ih=F(im);values.set([rh,F(re-rh),ih,F(im-ih)],i*4);
  let pm1:DDComplex=[one,of(0)];
  if(r.power>1){pm1=z;for(let n=1;n<r.power-1;n++){if((n&255)===0)aborted(options);pm1=product(pm1,z);}}
  const zp=product(pm1,z),fr=sub(zp[0],one),fi=zp[1],dr=mul(pm1[0],p),di=mul(pm1[1],p);
  const denominator=add(mul(dr,dr),mul(di,di)),denom=sum(denominator);
  if(!Number.isFinite(denom)||Math.abs(denom)<1e-30)return unavailable(plan.formula==='nova'?'NOVA_REF_DERIV_SINGULAR':'REF_DERIV_SINGULAR',i);
  let qr=div(add(mul(fr,dr),mul(fi,di)),denominator),qi=div(sub(mul(fi,dr),mul(fr,di)),denominator);
  if(!Number.isFinite(sum(qr))||!Number.isFinite(sum(qi)))return unavailable(plan.formula==='nova'?'NOVA_REF_STEP_INVALID':'REF_STEP_INVALID',i);
  qr=mul(qr,relax);qi=mul(qi,relax);z=[sub(z[0],qr),sub(z[1],qi)];
  if(plan.formula==='nova')z=[add(z[0],r.constant[0]),add(z[1],r.constant[1])];
 }
 aborted(options);return{kind:'ready',profile:plan.profile,layout:'real-hi-low-imag-hi-low',values,length:r.length,key:plan.key,bytes:values.byteLength,initialZ:cloneComplex(r.initialZ),constant:cloneComplex(r.constant)};
}

/** One reference entry; returned arrays are borrowed until clear/replacement.
 * A build/cancel/caller-budget failure never replaces the prior owned entry. */
export class FractalSourceReferenceCache {
 private cached?:FractalSourceReferenceResult;private hits=0;private builds=0;
 prepare(plan:FractalSourcePlan,options:FractalReferenceBuildOptions={}):{reference:FractalSourceReferenceResult;cacheHit:boolean} {
  validateFractalSourcePlan(plan);aborted(options);
  if(this.cached?.key===plan.key){this.hits++;return{reference:this.cached,cacheHit:true};}
  const retained=this.cached?.bytes??0;
  const next=buildFractalSourceReference(plan,{...options,onBytes:bytes=>options.onBytes?.(retained+bytes)});
  this.cached=next;this.builds++;return{reference:next,cacheHit:false};
 }
 clear(){this.cached=undefined;}
 dispose(){this.clear();}
 diagnostics(){return{retainedBytes:this.cached?.bytes??0,entries:this.cached?1:0,builds:this.builds,hits:this.hits};}
}
