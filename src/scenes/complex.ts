import {parseFractalSourceColorProfile,prepareFractalSourceColor} from '../engine/fractalSourceColor';
import {authoredFractalSourceColor} from '../engine/fractalSourceColorAuthoring';
import {fractalSourceFrameFacts} from '../engine/fractalSourceFrame';
import {fractalViewportRules,prepareFractalViewportNavigation} from '../engine/complexViewport';
import {prepareFractalDistance,beginFractalDistance,advanceFractalDistance,finishFractalDistance,type FractalDistancePlan,type FractalDistanceFacts} from '../engine/fractalDistance';
import {domainGuideExamples} from './domainExamples.generated';
import {rootsControls,rootsDefaults} from '../engine/rootsControls';
import {generateDomain} from '../engine/domain';
import {domainBackendControl} from '../engine/domainModel';
import {usesStepConvergence,usesResidualConvergence,usesConvergenceExit,convergenceStep,convergenceMagnet,convergenceTolerance,CONVERGENCE_CPU_NOTICE,RESIDUAL_GPU_NOTICE,type FractalConvergence} from '../engine/fractalConvergence';
import {compilePolynomial} from '../engine/polynomial';
export {compilePolynomial,evaluatePolynomial,solvePolynomial,polynomialRelativeResidual,type RootSolution} from '../engine/polynomial';
import {prepareRootSampling,prepareRootGeneration} from '../engine/rootsSampling';
export {prepareRootSampling} from '../engine/rootsSampling';
import {parse} from 'mathjs';
import type {ControlSpec, GenerateContext, RootParameter, SceneDefinition, SceneDocument, SceneOutput, Settings} from '../types';
import {numberSetting, random} from '../engine/expression';
import {hexRGB, hsvRGB, paletteColor} from '../engine/palette';
import {densityControls, densityDefaults, presentPoints} from '../engine/density';
import { doubleDoubleOrbit, precisePixel, referenceOrbit, supportsDoubleDouble, supportsPerturbation, perturbationThresholds,parseFractalNumericProfile,type FractalNumericProfile } from '../engine/fractalPrecision';
import {parseFractalViewport,complexPixel} from '../engine/complexViewport';
import { fractalGpu, unpackGpuOrbit } from '../engine/fractalGpu';
import {FractalSourceGpuError,fractalSourceCancel} from '../engine/fractalSourceGpuFailure';
import {FRACTAL_SOURCE_NUMERIC_PROFILE,parseFractalSourcePlan,parseFractalSourceNativePlan,type FractalSourceNativePrecisionInput} from '../engine/fractalSourcePrecision';
import {sourceFractalRenderInput} from '../engine/sourceFractalRender';
import {parseRootParameters,rootParameterBounds,normalizeRootParameter,withRootParameters} from '../engine/rootParameters';
import {parseFractalColors,shadeFractalOrbit,createFractalTrapState,observeFractalTraps,usesFractalTrap,type FractalTrapState} from '../engine/fractalColor';
import {rasterDimensions} from '../engine/rasterDimensions';
import {generateMandelbulb,bulbControls,bulbDefaults} from './mandelbulb';

import {add,sub,mul,scale,abs,finite,div,sin,nodeData,parsed,complexPower,type Complex} from '../engine/complexMath';
export {compileComplex,complexPower,complexFunctionNames,complexConstantNames,type Complex} from '../engine/complexMath';
const TAU=2*Math.PI;
const clamp=(x:number,a=0,b=1)=>Math.max(a,Math.min(b,x));
const frac=(x:number)=>x-Math.floor(x);
function val(s:Settings,k:string,d:number,min=-Infinity,max=Infinity):number {return numberSetting(s,k,d,min,max);}
function integer(s:Settings,k:string,d:number,min:number,max:number):number{
 const n=val(s,k,d,min,max);if(!Number.isInteger(n))throw new Error(k+' 必须为整数');return n;
}
function select(s:Settings,k:string,d:string,options:readonly string[]):string{
 const x=String(s[k]??d);if(!options.includes(x))throw new Error(k+' 不支持选项 '+x);return x;
}
function bool(s:Settings,k:string,d=false):boolean{
 const v=s[k]??d;if(typeof v!=='boolean')throw new Error(k+' 必须为布尔值');return v;
}
function background(scene:SceneDocument):[number,number,number] {return hexRGB(String(scene.settings.background??'#0a0c14'));}
function raster(w:number,h:number,bg:number[]):Uint8ClampedArray{
 const pixels=new Uint8ClampedArray(w*h*4);
 for(let i=0;i<w*h;i++){pixels[i*4]=bg[0]*255;pixels[i*4+1]=bg[1]*255;pixels[i*4+2]=bg[2]*255;pixels[i*4+3]=255;}
 return pixels;
}
function put(p:Uint8ClampedArray,i:number,c:number[]):void {for(let k=0;k<3;k++)p[i*4+k]=Math.round(clamp(c[k])*255);}
const formulaIds=['mandelbrot','julia','newton','nova','phoenix','magnet1','magnet2','lambda','c_sin','spiral_septagon','binocular','mandelbulb_3d'] as const;
const coloringIds=['none','basic','smooth_mandelbrot','decomposition','binary_decomposition','distance_estimator','direct_domain','direct_orbit_trap','direct_normalized_z','orbit_trap_index'] as const;
export interface FractalOrbit {z:Complex;count:number;inside:boolean;invalid:boolean;trap:number;derivative:Complex;converged:boolean;convergence?:FractalConvergence;colorIteration?:number;distance?:FractalDistanceFacts;}
export interface FractalConfig {numericProfile?:FractalNumericProfile;distance?:FractalDistancePlan;formula:string;variant:string;iterations:number;power:Complex;start:Complex;julia:Complex;bailout:number;tolerance:number;convergenceMode:'legacy'|'step'|'residual';convergenceTolerance?:number;relaxation:number;feedback:number;feedbackImag:number;phoenixPower2:number;singularityGuard:number;quad:Complex;constantTerm:Complex;initialCoefficient:Complex;denomOffset:number;trapShape:string;trapRadius:number;trapCenter:Complex;trapRotation:number;trapAspect:number;}
function orbitTrap(z:Complex,c:FractalConfig):number{
 const q=sub(z,c.trapCenter),co=Math.cos(c.trapRotation),si=Math.sin(c.trapRotation);
 const x=(q[0]*co-q[1]*si)/c.trapAspect,y=q[0]*si+q[1]*co;
 return c.trapShape==='ring'?Math.abs(Math.hypot(x,y)-c.trapRadius):c.trapShape==='cross'?Math.min(Math.abs(x),Math.abs(y)):Math.hypot(x,y);
}
/** Shipped Magnet safe division maps a singular denominator to zero.
 * Nonfinite arithmetic still follows the local explicit-invalid orbit boundary. */
function magnetRatio(numerator:Complex,denominator:Complex):Complex {
 if(abs(denominator)**2<1e-24)return [0,0];
 return div(numerator,denominator);
}
export function fractalOrbit(point:Complex,c:FractalConfig,onStep?:(z:Complex)=>void):FractalOrbit{
 if(fractalViewportRules(c.numericProfile??'local-v1',c.formula).sourceNewtonNova)throw new FractalSourceGpuError('MathArt Newton/Nova 数值规则需要 WebGL2；如需 CPU，请选择本地数值规则。','input');
 const f=c.formula,isJulia=f==='julia'||c.variant==='julia',constant=isJulia?c.julia:point,stepConvergence=usesStepConvergence(c),residualConvergence=usesResidualConvergence(c);
 let z:Complex=f==='newton'||f==='binocular'||isJulia?point:c.start;
 const distance=beginFractalDistance(c.distance);
 // Independent Float64 orbit values are projected to binary32 high inputs.
 // This bridge does not claim equivalence to the original DS orbit arithmetic.
 const complete=(orbit:FractalOrbit):FractalOrbit=>distance?{...orbit,derivative:distance.derivative,distance:finishFractalDistance(distance,{finalZHigh:orbit.z,iteration:orbit.convergence?.iteration??orbit.colorIteration??Math.max(0,orbit.count-1),exitKind:orbit.inside?0:orbit.converged?2:1,residualSquared:Math.fround(Math.fround(orbit.convergence?.colorResidual??0)**2)})}:orbit;
 let previous:Complex=[0,0],derivative:Complex=isJulia?[1,0]:[0,0],trap=Infinity;
 for(let n=0;n<c.iterations;n++){
  const old=z;onStep?.(z);advanceFractalDistance(distance,z);
  if(f==='mandelbrot'||f==='julia'||f==='phoenix'){
   if(!distance)derivative=add(mul(mul(c.power,complexPower(z,sub(c.power,[1,0]))),derivative),isJulia?[0,0]:[1,0]);
   z=add(complexPower(z,c.power),constant);
   if(f==='phoenix')z=add(z,mul(complexPower(previous,[c.phoenixPower2,0]),[c.feedback,c.feedbackImag]));
  }else if(f==='newton'||f==='nova'){
   const zp=complexPower(z,c.power),residual=sub(zp,[1,0]);
   if(!stepConvergence&&f==='newton'&&abs(residual)<c.tolerance)return complete({z,count:n,inside:true,invalid:false,trap:Math.min(trap,orbitTrap(z,c)),derivative,converged:true});
   const dz=mul(c.power,complexPower(z,sub(c.power,[1,0])));
   if(!(stepConvergence&&dz[0]*dz[0]+dz[1]*dz[1]<1e-24))z=sub(z,scale(div(residual,dz),c.relaxation));if(f==='nova')z=add(z,constant);
  }else if(f==='magnet1'){
   const numerator=add(mul(z,z),sub(constant,[1,0])),denominator=add(scale(z,2),sub(constant,[2,0]));
   z=complexPower(residualConvergence?magnetRatio(numerator,denominator):div(numerator,denominator),[2,0]);
  }else if(f==='magnet2'){
   const a=sub(constant,[1,0]),b=sub(constant,[2,0]),ab=mul(a,b);
   const numerator=add(add(complexPower(z,[3,0]),scale(mul(a,z),3)),ab),denominator=add(add(scale(mul(z,z),3),scale(mul(b,z),3)),add(ab,[1,0]));
   z=complexPower(residualConvergence?magnetRatio(numerator,denominator):div(numerator,denominator),[2,0]);
  }else if(f==='lambda')z=mul(constant,mul(z,sub([1,0],z)));
  else if(f==='c_sin')z=mul(sin(z),constant);
  else if(f==='spiral_septagon')z=abs(z)**2<c.singularityGuard?[0,0]:div(add(complexPower(z,[c.power[0],0]),constant),z);
  else if(f==='binocular'){
   const m=Math.max(2,c.power[0]);
   const numerator=add(add(complexPower(z,[m,0]),mul(c.quad,mul(z,z))),c.constantTerm);
   const denominator=add(add(scale(complexPower(z,[m-1,0]),2),mul(c.initialCoefficient,constant)),[c.denomOffset,0]);
   z=abs(denominator)**2<1e-24?[1e30,0]:add(z,scale(sub(div(numerator,denominator),z),c.relaxation));
  }
  else throw new Error('未知分形公式 '+f);
  if(!finite(z))return complete({z:old,count:n+1,inside:false,invalid:true,trap,derivative,converged:false});
  trap=Math.min(trap,orbitTrap(z,c));previous=old;
  if(stepConvergence){
   const convergence=convergenceStep(z[0]-old[0],z[1]-old[1],c.convergenceTolerance??c.tolerance,n);
   if(convergence)return complete({z,count:n+1,inside:false,invalid:false,trap,derivative,converged:true,convergence});
   continue;
  }
  if(residualConvergence){
   const convergence=f==='binocular'?convergenceStep(z[0]-old[0],z[1]-old[1],c.tolerance,n):convergenceMagnet(c,z,old,n);
   if(convergence)return complete({z,count:n+1,colorIteration:n,inside:false,invalid:false,trap,derivative,converged:true,convergence});
   const escaped=f==='binocular'?abs(z)>1e6:abs(z)>=c.bailout;
   if(escaped)return complete({z,count:n+1,colorIteration:n,inside:false,invalid:false,trap,derivative,converged:false});
   continue;
  }
  const converged=((f==='newton'||f==='nova'||f==='binocular')&&abs(sub(z,old))<c.tolerance)||((f==='magnet1'||f==='magnet2')&&(f==='magnet2'&&isJulia?abs(sub(z,old)):abs(sub(z,[1,0])))<c.tolerance);
  if(converged)return complete({z,count:n+1,inside:true,invalid:false,trap,derivative,converged:true});
  const escapeLimit=f==='binocular'?1e6:(f==='newton'||f==='nova')?1e12:c.bailout;
  if(abs(z)>escapeLimit)return complete({z,count:n+1,inside:false,invalid:false,trap,derivative,converged:false});
 }
 return complete({z,count:c.iterations,...(residualConvergence?{colorIteration:c.iterations-1}:{}),inside:true,invalid:false,trap,derivative,converged:false});
}
export function fractalConfig(s:Settings,source?:FractalSourceNativePrecisionInput):FractalConfig {
 const native=source?.native;
 const formula=source?.formula??select(s,'formula','mandelbrot',formulaIds),variant=native?.fractalType??select(s,'variant','mandelbrot',['mandelbrot','julia']);
 const numericProfile=source?FRACTAL_SOURCE_NUMERIC_PROFILE:parseFractalNumericProfile(s.fractalNumericProfile),sourceNumerics=fractalViewportRules(numericProfile,formula).sourceNewtonNova,sourceColor=parseFractalSourceColorProfile(s.fractalColorProfile);
 if(sourceColor&&!sourceNumerics)throw new FractalSourceGpuError('原版分形着色需要启用 MathArt Newton/Nova 数值规则并选择 Newton 或 Nova。','input');
 // Source numerics owns its stopping rule. The independent authored mode is
 // retained so switching back restores the existing document's behavior.
 const convergenceMode=sourceNumerics?'step':select(s,'convergenceMode','legacy',['legacy','step','residual']) as FractalConfig['convergenceMode'],sourceConvergence=usesConvergenceExit({formula,convergenceMode}),residualMagnet=usesResidualConvergence({formula,convergenceMode})&&formula.startsWith('magnet');
 // The source catalog accepts floating input, while its shader rounds both
 // Phoenix exponents. Missing mode preserves existing independent documents.
 const roundedPhoenix=formula==='phoenix'&&select(s,'phoenixExponentMode','complex',['complex','rounded'])==='rounded';
 const rawPower=native?native.dynamicParams[0]:sourceNumerics?val(s,'power',2):val(s,'power',2,.1,32),rawImag=native?native.dynamicParams[1]:sourceNumerics?val(s,'powerImag',0):val(s,'powerImag',0,-16,16),rawHistory=native?0:val(s,'phoenixPower2',1,0,32);
 const shaderRound=(value:number)=>Math.floor(Math.fround(Math.fround(value)+.5));
 const power:Complex=roundedPhoenix?[Math.max(2,shaderRound(rawPower)),0]:[rawPower,rawImag];
 return {formula,variant,...(numericProfile==='local-v1'?{}:{numericProfile}),distance:sourceColor||native?undefined:prepareFractalDistance(s,{formula,variant,power}),
 iterations:source?.iterations??integer(s,'iterations',180,1,4096),power,
 start:native?[...native.julia]:[val(s,'startReal',0),val(s,'startImag',0)],julia:native?[...native.julia]:[val(s,'juliaReal',-.745),val(s,'juliaImag',.186)],
 bailout:native?native.bailout:residualMagnet?Math.max(1e-6,val(s,'bailout',4,0)):val(s,'bailout',formula==='mandelbulb_3d'?2:4,formula==='mandelbulb_3d'?.5:1.000001,1e12),tolerance:native?native.bailout:sourceNumerics?val(s,'tolerance',1e-6):val(s,'tolerance',1e-6,sourceConvergence?0:1e-14,sourceConvergence?Infinity:.1),convergenceMode,
 relaxation:native?native.dynamicParams[2]:sourceNumerics?val(s,'relaxation',1):val(s,'relaxation',1,sourceConvergence&&formula==='binocular'?0:.01,sourceConvergence&&formula==='binocular'?Infinity:3),feedback:native?0:val(s,'feedback',-.5,-2,2),feedbackImag:native?0:val(s,'feedbackImag',0,-2,2),phoenixPower2:Math.max(1,shaderRound(rawHistory)),singularityGuard:native?1e-10:val(s,'singularityGuard',1e-10,1e-24,.1),quad:native?[0,0]:[val(s,'quadReal',1),val(s,'quadImag',0)],constantTerm:native?[0,0]:[val(s,'constReal',1),val(s,'constImag',0)],initialCoefficient:native?[0,0]:[val(s,'z0Real',-1),val(s,'z0Imag',0)],denomOffset:native?1:val(s,'denomOffset',1),
 // The legacy nearest-distance diagnostic is unused by source color. Keep its
 // neutral transport inputs independent of dormant local authoring fields.
 trapShape:sourceColor?'point':select(s,'trapShape','ring',['point','ring','cross']),trapRadius:sourceColor?0:val(s,'trapRadius',.5,0,100),
 trapCenter:sourceColor?[0,0]:[val(s,'trapReal',0),val(s,'trapImag',0)],trapRotation:sourceColor?0:val(s,'trapRotation',0),trapAspect:sourceColor?1:val(s,'trapAspect',1,.01,100)};
}
/** Local-scene description uses the local orbit configuration. Imported source
 * scenes own their constructor-captured text in sourceFractalFormulaLatex. */
export function fractalEquationLatex(settings:Settings):string {
 const c=fractalConfig(settings),n=(v:number)=>String(v).replace(/e([+-]?\d+)/i,'\\times 10^{$1}');
 const z=(v:Complex)=>v[1]===0?n(v[0]):`\\left(${n(v[0])}${v[1]<0?'-':'+'}${n(Math.abs(v[1]))}i\\right)`;
 const p=z(c.power),julia=c.formula==='julia'||c.variant==='julia',constant=julia?z(c.julia):'w';
 let rhs='',seed=c.formula==='newton'||c.formula==='binocular'||julia?'w':z(c.start),extra='';
 switch(c.formula){
  case 'mandelbrot':case 'julia':rhs=`z_n^{${p}}+c`;break;
  case 'phoenix':rhs=`z_n^{${p}}+c+${z([c.feedback,c.feedbackImag])}z_{n-1}^{${c.phoenixPower2}}`;extra=',\\quad z_{-1}=0';break;
  case 'newton':case 'nova':rhs=`z_n-${n(c.relaxation)}\\frac{z_n^{${p}}-1}{${p}z_n^{${z(sub(c.power,[1,0]))}}}${c.formula==='nova'?'+c':''}`;break;
  case 'magnet1':rhs='\\left(\\frac{z_n^2+c-1}{2z_n+c-2}\\right)^2';break;
  case 'magnet2':rhs='\\left(\\frac{z_n^3+3(c-1)z_n+(c-1)(c-2)}{3z_n^2+3(c-2)z_n+(c-1)(c-2)+1}\\right)^2';break;
  case 'lambda':rhs='cz_n(1-z_n)';break;
  case 'c_sin':rhs='c\\sin(z_n)';break;
  case 'spiral_septagon':rhs=`\\begin{cases}0&|z_n|^2<${n(c.singularityGuard)}\\\\\\frac{z_n^{${n(c.power[0])}}+c}{z_n}&\\text{otherwise}\\end{cases}`;break;
  case 'binocular':{const m=Math.max(2,c.power[0]),den=`2z_n^{${n(m-1)}}+${z(c.initialCoefficient)}c+${n(c.denomOffset)}`;rhs=`\\begin{cases}10^{30}&|${den}|^2<10^{-24}\\\\z_n+${n(c.relaxation)}\\left(\\frac{z_n^{${n(m)}}+${z(c.quad)}z_n^2+${z(c.constantTerm)}}{${den}}-z_n\\right)&\\text{otherwise}\\end{cases}`;break;}
  case 'mandelbulb_3d':{const power=val(settings,'power',8,2,32),phase=val(settings,'bulbPhaseShift',0),speed=val(settings,'bulbPhaseSpeed',.05);return `\\mathbf z_{n+1}=r_n^{${n(power)}}\\begin{pmatrix}\\cos(${n(power)}\\phi_n)\\cos(\\alpha_n)\\\\\\sin(${n(power)}\\phi_n)\\cos(\\alpha_n)\\\\\\sin(\\alpha_n)\\end{pmatrix}+\\mathbf c,\\quad\\mathbf z_0=\\mathbf c,\\quad\\alpha_n=${n(power)}\\arcsin(z/r)+${n(phase)}+${n(speed)}t,\\;\\phi=\\operatorname{atan2}(y,x),\\;\\mathbf c=(R(t)\\mathbf w)_{xzy}`;}
 }
 return `z_{n+1}=${rhs},\\quad z_0=${seed},\\quad c=${constant}${extra}`;
}
function transfer(x:number,name:string):number{
 const a=Math.abs(x);
 switch(name){case 'sqr':return x*x;case 'sqrt':return Math.sqrt(a);case 'cube':return x*x*x;case 'cuberoot':return Math.cbrt(x);case 'log':return Math.log1p(a);case 'exp':return Math.expm1(Math.min(x,20));case 'sin':return .5+.5*Math.sin(TAU*x);case 'arctan':return Math.atan(x)/Math.PI+.5;default:return x;}
}
class FractalGpuFallback extends Error {}
/** Saved local color versions keep their own parser and shading contract. A
 * source-color request does not reinterpret or validate dormant local styles. */
function prepareLocalFractalColoring(scene:SceneDocument,c:FractalConfig){
 const s=scene.settings;
 const colors=parseFractalColors(scene);
 if(usesResidualConvergence(c)&&colors.version!==2)throw new Error('收敛残差模式需要独立内外着色；请启用独立着色或选择兼容旧文档。');
 const traceColors=colors.version===2&&(usesFractalTrap(colors.inside)||usesFractalTrap(colors.outside))?colors:undefined;
 const inside=select(s,'insideColoring','none',coloringIds),outside=select(s,'outsideColoring','smooth_mandelbrot',coloringIds);
 if(!c.distance&&(inside==='distance_estimator'||outside==='distance_estimator')&&!['mandelbrot','julia'].includes(c.formula))throw new Error('距离估算仅支持 Mandelbrot / Julia 幂函数族');
 const transferName=select(s,'transfer','linear',['none','linear','sqr','sqrt','cube','cuberoot','log','exp','sin','arctan']);
 const density=val(s,'colorDensity',3,.01,100),offset=val(s,'gradientOffset',0),repeat=bool(s,'repeatGradient',true);
 const metric=select(s,'metric','iteration',['iteration','real','imaginary','sum']),binary=select(s,'binaryAxis','imaginary',['real','imaginary']);
 const directScale=val(s,'directScale',1,.001,100),gamma=val(s,'directGamma',1,.1,10),sat=val(s,'directSaturation',.8,0,1),mix=val(s,'directMix',.5,0,1);
 const solid=hexRGB(String(s.solidColor??'#05070d'));
 function colorOrbit(o:FractalOrbit,traps?:FractalTrapState):number[]|undefined {
   if(colors.version===2)return shadeFractalOrbit(o,c,colors,traps);
   if(o.invalid)return undefined;
   const algorithm=o.inside?inside:outside,angle=frac(Math.atan2(o.z[1],o.z[0])/TAU),r=abs(o.z);
   let t=0,color:number[]|undefined;
   switch(algorithm){
    case 'none':color=solid;break;
    case 'basic':t=metric==='iteration'?o.count/c.iterations:metric==='real'?o.z[0]:metric==='imaginary'?o.z[1]:o.z[0]+o.z[1];break;
    case 'smooth_mandelbrot':t=(o.count+1-Math.log(Math.max(1e-12,Math.log(Math.max(r,1.000001))))/Math.log(Math.max(1.001,abs(c.power))))/c.iterations;break;
    case 'decomposition':t=angle;break;
    case 'binary_decomposition':t=(binary==='real'?o.z[0]:o.z[1])>=0?.15:.65;break;
    case 'distance_estimator':t=o.inside?0:Math.log1p(r*Math.log(r)/Math.max(abs(o.derivative),1e-30));break;
    case 'orbit_trap_index':t=Math.exp(-o.trap*directScale);break;
    case 'direct_domain':color=hsvRGB(angle,sat,Math.pow(r/(1+r),1/gamma));break;
    case 'direct_normalized_z':{const denom=Math.max(1,r);color=[.5+.5*o.z[0]/denom,.5+.5*o.z[1]/denom,.5+.5*Math.sin(r*directScale)];break;}
    case 'direct_orbit_trap':{const a=paletteColor(scene.palette,angle),b=hsvRGB(Math.exp(-o.trap*directScale),sat,Math.pow(Math.exp(-o.trap*directScale),1/gamma));color=a.map((v,k)=>v*(1-mix)+b[k]*mix);break;}
   }
   if(!color){t=transfer(t,transferName)*density+offset;color=!repeat&&(t<0||t>1)?solid:paletteColor(scene.palette,t);}
   return color.some(v=>!Number.isFinite(v))?undefined:color;

 }
 return {traceColors,shade:colorOrbit};
}
/** Pure render admission shared by retained live configuration and drawing. */
export function prepareFractalRender(scene:SceneDocument,ctx:GenerateContext){
 const s=scene.settings,source=scene.fractalSource?sourceFractalRenderInput(scene.evaluatedFractalScene):undefined,c=fractalConfig(s,source);
 const sourceColorProfile=parseFractalSourceColorProfile(s.fractalColorProfile);
 const coloring=sourceColorProfile?undefined:prepareLocalFractalColoring(scene,c),traceColors=coloring?.traceColors;
 const view=parseFractalViewport(s);
 // Prepare the requested-frame convergence threshold once, before probing or
 // selecting a backend. Preview passes and GPU batches consume this same fact.
 const sourceNumerics=fractalViewportRules(c.numericProfile??'local-v1',c.formula).sourceNewtonNova;
 const orbitConfig=!sourceNumerics&&usesStepConvergence(c)?{...c,convergenceTolerance:convergenceTolerance(c,view.zoom,ctx.width,ctx.height)}:c;
 const requestedBackend=select(s,'fractalBackend','auto',['auto','cpu','webgl2']),method=select(s,'renderMethod','multi-pass',['guessing','multi-pass','one-pass']);
 const precision=sourceNumerics?undefined:select(s,'perturbationPrecision','high',Object.keys(perturbationThresholds)) as keyof typeof perturbationThresholds|undefined;
 if(sourceNumerics&&ctx.fractalViewport!==undefined&&(!ctx.fractalViewport||!['primary','offscreen'].includes(ctx.fractalViewport.target)))throw new FractalSourceGpuError('Unknown source fractal viewport target','input');
 const preparePlan=(size:Parameters<typeof parseFractalSourcePlan>[2])=>source?parseFractalSourceNativePlan(source,view,size,{precision:s.perturbationPrecision??'high'}):parseFractalSourcePlan(c,view,size,{precision:s.perturbationPrecision??'high'});
 const sourcePlan=sourceNumerics?preparePlan({
  logicalWidth:ctx.fractalViewport===undefined?ctx.width:ctx.fractalViewport.logicalWidth,logicalHeight:ctx.fractalViewport===undefined?ctx.height:ctx.fractalViewport.logicalHeight,
  provenance:ctx.fractalViewport?.target==='primary'?'canvas-logical-local':'requested-output-local',
 }):undefined;
 if(sourcePlan&&requestedBackend==='cpu')throw new FractalSourceGpuError('MathArt Newton/Nova 数值规则需要 WebGL2；如需 CPU，请选择本地数值规则。','input');
 const colorPlan=sourceColorProfile&&sourcePlan?prepareFractalSourceColor({configuration:authoredFractalSourceColor(scene),formulaPower:sourcePlan.reference.power,bailout:sourcePlan.bailout,runtime:scene.evaluatedFractalGradient}):undefined;
 const sourceNavigation=sourcePlan?prepareFractalViewportNavigation({...s,formula:sourcePlan.formula,fractalNumericProfile:sourcePlan.profile},sourcePlan.logicalSize[0],sourcePlan.logicalSize[1]):undefined;
 return{s,source,c,coloring,traceColors,view,orbitConfig,requestedBackend,method,precision,sourcePlan,colorPlan,sourceNavigation};
}
export function generateFractal(scene:SceneDocument,ctx:GenerateContext):SceneOutput{
 const start=performance.now();
 if(!scene.fractalSource&&scene.settings.formula==='mandelbulb_3d')return generateMandelbulb(scene,ctx,fractalConfig(scene.settings));
 const {s,c,coloring,traceColors,view,orbitConfig,requestedBackend,method,precision,sourcePlan,colorPlan,sourceNavigation}=prepareFractalRender(scene,ctx);
 const sourceBefore=sourcePlan?fractalGpu.sourceDiagnostics():undefined;
 const preparedSource=sourcePlan?fractalGpu.prepareSourceReference(sourcePlan,{isCancelled:ctx.isCancelled}):undefined;
 const precise=view.zoom>100||view.centerXLow!==0||view.centerYLow!==0,useDD=!sourcePlan&&precise&&supportsDoubleDouble(c),reference=!sourcePlan&&precise&&supportsPerturbation(c)?referenceOrbit(c,view):undefined;
 const bg=background(scene),warnings:string[]=[];
 let useGpu=!!sourcePlan||requestedBackend!=='cpu'&&(!precise||!!reference)&&!usesStepConvergence(c);
 if(sourcePlan){
  warnings.push(colorPlan?'MathArt 1.7.8 Newton/Nova 数值与着色规则：轨道与颜色在同一 GPU 片段计算，预览调度沿用本地实现。':'MathArt 1.7.8 Newton/Nova 数值规则：WebGL2 双 float 轨道；异常扰动继续普通 GPU 迭代。着色和预览调度沿用本地实现。');
  if(colorPlan)warnings.push(...colorPlan.diagnostics);
  if(sourcePlan.perturbation.enabled&&preparedSource?.reference.kind==='unavailable')warnings.push(`参考轨道不可用（${preparedSource.reference.reason}）；使用普通 GPU 迭代。`);
 }else{
  if(requestedBackend!=='cpu'&&usesStepConvergence(c))warnings.push(CONVERGENCE_CPU_NOTICE);
  if(useGpu){const probe=fractalGpu.sample(new Float32Array([0,0]),1,1,view,orbitConfig,reference,perturbationThresholds[precision!],traceColors);if(!probe.values){useGpu=false;warnings.push(probe.warning!);}}
  if(requestedBackend!=='cpu'&&precise&&!reference)warnings.push(useDD?'此公式深缩放使用直接 CPU DoubleDouble；尚未实现其 GPU 有理函数扰动。':'此公式/指数不支持高精度扰动，使用 CPU 双精度。');
  warnings.push(useGpu?(usesResidualConvergence(c)?RESIDUAL_GPU_NOTICE:reference?'WebGL2 扰动 + CPU DoubleDouble 参考轨道；异常像素直接 DD 修复。':'WebGL2 float32 轨道计算；着色与 CPU 共享，停止迭代与 CPU 可能存在舍入差异。'):(useDD?'CPU DoubleDouble 整数幂计算。':'CPU IEEE-754 双精度计算。'));
  if(!useDD&&(view.zoom>1e8||view.centerXLow!==0||view.centerYLow!==0))warnings.push('当前公式/指数仍受标准双精度限制；中心低位或相邻像素可能丢失。');
 }
 const budget=24_000_000;
 const [w,h]=rasterDimensions(ctx,c.iterations*(!useGpu&&useDD?12:1),useGpu?'webgl2':'cpu',warnings);
 const actualMethod=ctx.quality==='export'?'one-pass':method;
 if(ctx.quality==='export'&&method!=='one-pass')warnings.push('导出自动使用 One Pass，全部实际输出像素直接求值。');
 let samples=0,invalid=0,repairCount=0;
 function evaluate(points:Float32Array,width:number,height:number):Array<number[]|undefined>{
  let sourceRGBA:Uint8Array|undefined,gpu:Float32Array|undefined,gpuTraps:Float32Array|undefined,gpuResidual:Float32Array|undefined,gpuDistance:Float32Array|undefined;
  if(useGpu){const result=fractalGpu.sample(points,width,height,view,orbitConfig,reference,precision?perturbationThresholds[precision]:undefined,traceColors,sourcePlan?{plan:sourcePlan,colorPlan,isCancelled:ctx.isCancelled}:undefined);if(!result.values){if(sourcePlan)throw new FractalSourceGpuError('Source GPU did not return orbit facts','device');throw new FractalGpuFallback(result.warning);}gpu=result.values;gpuTraps=result.traps;gpuResidual=result.residual;gpuDistance=result.distance;sourceRGBA=result.sourceRGBA;}
  if(colorPlan&&(!sourceRGBA||sourceRGBA.length!==points.length*2))throw new FractalSourceGpuError('Source GPU did not return the complete RGBA frame','device');
  const colors:Array<number[]|undefined>=[];
  for(let i=0;i<points.length/2;i++){
   if(colorPlan){
    if(sourceRGBA![i*4+3]!==255)throw new FractalSourceGpuError('Source GPU returned nonopaque RGBA','device');
    // UNORM bytes are already the final shader color; no CPU orbit unpacking
    // or color interpretation participates. put() preserves these exact bytes.
    colors.push([sourceRGBA![i*4]/255,sourceRGBA![i*4+1]/255,sourceRGBA![i*4+2]/255]);samples++;continue;
   }
   const x=points[i*2],y=points[i*2+1];let orbit:FractalOrbit,traps:FractalTrapState|undefined;
   if(traceColors){traps=createFractalTrapState();if(gpuTraps){const k=i*8;traps.inside={minimum:gpuTraps[k],color:[gpuTraps[k+1],gpuTraps[k+2],gpuTraps[k+3]]};traps.outside={minimum:gpuTraps[k+4],color:[gpuTraps[k+5],gpuTraps[k+6],gpuTraps[k+7]]};}}
   if(sourcePlan&&gpu&&gpu[i*8+7]!==0)throw new FractalSourceGpuError('Source orbit requested an undefined CPU repair','device');
   if(gpu&&gpu[i*8+7]===0)orbit=unpackGpuOrbit(gpu,i,gpuResidual,c,gpuDistance);
   else{
    if(gpu){repairCount++;if(ctx.quality!=='export'&&repairCount*c.iterations*(useDD?12:1)>budget)throw new FractalGpuFallback('GPU 数值修复像素过多；按 CPU 工作预算重新计算。');}
    if(traceColors)traps=createFractalTrapState();
    const observe=traceColors?(z:Complex)=>observeFractalTraps(z,traceColors,traps!):undefined;
    orbit=useDD?doubleDoubleOrbit(precisePixel(x,y,width,height,view),orbitConfig,observe):fractalOrbit(complexPixel(x,y,width,height,view),orbitConfig,observe);
   }
   const color=coloring!.shade(orbit,traps);samples++;if(!color)invalid++;colors.push(color);
  }return colors;
 }
 function output(pixels:Uint8ClampedArray,width:number,height:number,generated:number,extra:string[]=[]):SceneOutput {
  if(sourcePlan)fractalSourceCancel(ctx.isCancelled);
  const allResidualRepaired=useGpu&&usesResidualConvergence(c)&&samples>0&&repairCount===samples;
  const sourceAfter=sourcePlan?fractalGpu.sourceDiagnostics():undefined;
  const fractalRender=sourcePlan&&sourceNavigation&&preparedSource&&sourceAfter?fractalSourceFrameFacts(sourcePlan,sourceNavigation,preparedSource.reference,[ctx.width,ctx.height],[width,height],sourceBefore,sourceAfter,colorPlan):undefined;
  return {type:'raster',...(fractalRender?{fractalRender}:{}),dimension:2,cameraResolved:true,backend:useGpu&&!allResidualRepaired?'webgl2':'cpu',width,height,pixels,stats:{samples,generated,invalid,elapsedMs:performance.now()-start},warnings:[...warnings.filter(w=>!allResidualRepaired||w!==RESIDUAL_GPU_NOTICE),...extra,...(repairCount?[`${repairCount} 个 GPU 数值不确定像素已用 CPU ${useDD?'DoubleDouble':'双精度'} 修复。`]:[])]};
 }
 function pass(width:number,height:number):SceneOutput {
  const pixels=raster(width,height,bg);let generated=0;
  const batch=Math.max(64,Math.min(16384,Math.floor(2_000_000/c.iterations)));
  for(let base=0;base<width*height;base+=batch){
   if(ctx.isCancelled?.())return output(pixels,width,height,generated,['计算已取消，剩余像素保留背景。']);
   const n=Math.min(batch,width*height-base),points=new Float32Array(n*2);
   for(let i=0;i<n;i++){points[2*i]=(base+i)%width;points[2*i+1]=Math.floor((base+i)/width);}
   const colors=evaluate(points,width,height);for(let i=0;i<n;i++){if(colors[i]){put(pixels,base+i,colors[i]!);generated++;}}
  }return output(pixels,width,height,generated);
 }
 try{
  // Each progress frame owns its arrays: worker transfer cannot detach final data.
  if(actualMethod==='multi-pass'&&ctx.onProgress&&Math.min(w,h)>=32){for(const divisor of [8,4,2]){if(ctx.isCancelled?.())break;ctx.onProgress(pass(Math.max(1,Math.ceil(w/divisor)),Math.max(1,Math.ceil(h/divisor))));}}
  if(actualMethod==='guessing'){
   // Conservative block prediction: compare corners and center in color space,
   // refine non-uniform blocks. Uniform predictions can still miss tiny islands.
   const pixels=raster(w,h,bg);let generated=0,predicted=0;
   for(let by=0;by<h;by+=4){if(ctx.isCancelled?.())return output(pixels,w,h,generated,['计算已取消，剩余像素保留背景。']);
    const blocks:Array<{x:number;y:number;width:number;height:number}>=[];const seeds:number[]=[];
    for(let bx=0;bx<w;bx+=4){const bw=Math.min(4,w-bx),bh=Math.min(4,h-by);blocks.push({x:bx,y:by,width:bw,height:bh});for(const [dx,dy]of [[0,0],[bw-1,0],[0,bh-1],[bw-1,bh-1],[sourcePlan?Math.floor((bw-1)/2):(bw-1)/2,sourcePlan?Math.floor((bh-1)/2):(bh-1)/2]])seeds.push(bx+dx,by+dy);}
    const colors=evaluate(Float32Array.from(seeds),w,h),refine:number[]=[],indices:number[]=[];
    blocks.forEach((b,i)=>{const local=colors.slice(i*5,i*5+5),first=local[0];const uniform=first&&local.every(color=>color&&color.every((v,k)=>Math.abs(v-first[k])<=1/255));
     for(let dy=0;dy<b.height;dy++)for(let dx=0;dx<b.width;dx++){const index=(b.y+dy)*w+b.x+dx;if(uniform){put(pixels,index,first);generated++;predicted++;}else{refine.push(b.x+dx,b.y+dy);indices.push(index);}}
    });
    const refined=evaluate(Float32Array.from(refine),w,h);refined.forEach((color,i)=>{if(color){put(pixels,indices[i],color);generated++;}});
   }
   return output(pixels,w,h,generated,[`Guessing 独立块预测：${predicted} 个像素使用相近样本颜色；细小孤岛可能遗漏，最终导出改为 One Pass。`]);
  }
  return pass(w,h);
 }catch(error){
  if(sourcePlan||!(error instanceof FractalGpuFallback))throw error;
  const result=generateFractal({...scene,settings:{...s,fractalBackend:'cpu'}},ctx);
  result.warnings=[error.message,...(result.warnings??[])];result.stats.elapsedMs=performance.now()-start;return result;
 }
}


export function updateRootParameters(scene:SceneDocument,parameters:RootParameter[],renames:ReadonlyMap<string,string>=new Map(),displayName=String(scene.settings.rootDisplayParameter??'t2')):SceneDocument{
 const settings=withRootParameters(scene.settings,parameters,Object.keys(scene.parameters));
 let polynomial=scene.equations.polynomial;
 if(renames.size)polynomial=parsed(polynomial).transform((node,path)=>node.type==='SymbolNode'&&path!=='fn'&&renames.has(nodeData(node).name!)?parse(renames.get(nodeData(node).name!)!):node).toString();
 compilePolynomial(polynomial,String(settings.variable??'z'),[...Object.keys(scene.parameters),...parameters.map(p=>p.name),'time']);
 if((settings.rootRender==='DEPTH'||settings.rootColor!==undefined&&settings.rootColor!=='radius')&&!parameters.some(p=>p.name===displayName))throw new Error('请选择存在的颜色/深度参数，或改用平面与根半径颜色');
 settings.rootDisplayParameter=displayName;
 return {...scene,settings,equations:{...scene.equations,polynomial}};
}
function generateRoots(scene:SceneDocument,ctx:GenerateContext):SceneOutput{
 const started=performance.now(),s=scene.settings,job=prepareRootGeneration(scene),native=job.math.model==='mathart-1.7.8-v1';
 try{
 const count=job.math.ensemble?.sampleCount??integer(s,'sampleCount',1500,1,100000),rng=native?()=>0:random(integer(s,'seed',42,0,4294967295));
 const needsColors=s.presentation!=='density'||s.paletteMode==='source',positions:number[]=[],colors:number[]=[],warnings=[native?'源 Aberth–Ehrlich 与幂代换求根；逐根提交有限结果，迭代上限不作为整组丢弃条件。':'CPU Durand–Kerner 求根；仅输出通过归一化残差检查的根。'];
 let samples=0,invalid=0,invalidSamples=0,invalidPoints=0,work=0,nonconvergent=0,limited=false;
 const workBudget=ctx.quality==='export'?150_000_000:30_000_000;
 class Limit extends Error {}
 const root:Complex=[0,0];
 for(let i=0;i<count;i++){
  if(ctx.isCancelled?.())throw new DOMException('复根求解已取消','AbortError');
  samples++;let result;
  try{result=job.math.sample(i,ctx.time,{sample:rng,phase:()=>rng()*TAU},{isCancelled:ctx.isCancelled,onWork:n=>{work+=n;if(work>workBudget)throw new Limit();}});}
  catch(error){if(error instanceof Limit){samples--;limited=true;break;}throw error;}
  if(result.status==='filtered')continue;
  if(result.status==='invalid'){invalid++;invalidSamples++;continue;}
  if(result.iterationLimit)nonconvergent++;
  if(!result.admitted){invalid++;continue;}
  for(let r=0;r<result.rootCount;r++){
   root[0]=result.roots[r*2];root[1]=result.roots[r*2+1];
   const admission=job.project(root,result.parameters);if(admission.kind==='filtered')continue;if(admission.kind==='invalid'){invalid++;invalidPoints++;continue;}const point=admission.point;if(point.some(v=>Math.abs(v)>3.4e38)){invalid++;invalidPoints++;continue;}
   // Bound the retained JS arrays and transfer output before another append.
   if(native&&(positions.length+3)*(needsColors?2:1)*16>256*1024*1024)throw new Error('复根单次几何缓冲超过 256 MiB；请使用渐进密度模式完成采样目标');
   positions.push(...point);if(needsColors)colors.push(...paletteColor(scene.palette,job.metric(root,result.parameters)));
  }
 }
 if(limited)warnings.push('已达到 CPU 求根工作量上限，完成 '+samples+' / '+count+' 个参数样本；渐进模式可分步完成完整目标。');
 if(invalidSamples)warnings.push(invalidSamples+' 个参数样本的多项式无效，已跳过。');
 if(invalidPoints)warnings.push(invalidPoints+' 个根点非有限或超出坐标范围，已跳过。');
 if(nonconvergent)warnings.push(nonconvergent+(native?' 个参数样本达到源求根迭代上限，有限近似根仍参与绘图。':' 个参数样本在迭代上限内未通过求根残差检查；未作为真实根输出。'));
 if(native)warnings.push('采样使用源 Java 随机数与逻辑工作线程分区；按样本序号确定性重放，未复现原版线程到达顺序、投影与点核。');
 return presentPoints({type:'geometry',dimension:job.render==='DEPTH'?3:2,topology:'points',positions:new Float32Array(positions),...(needsColors?{colors:new Float32Array(colors)}:{}),stats:{samples,generated:positions.length/3,invalid,elapsedMs:performance.now()-started},warnings},scene,ctx);
 }finally{job.dispose();}
}

const numeric=(key:string,label:string,group:string,min:number,max:number,step=.01,help?:string):ControlSpec=>({key,label,group,type:'number',min,max,step,help});
const choice=(key:string,label:string,group:string,options:readonly string[],labels?:string[]):ControlSpec=>({key,label,group,type:'select',options:options.map((value,i)=>({value,label:labels?.[i]??value}))});
const toggle=(key:string,label:string,group:string):ControlSpec=>({key,label,group,type:'toggle'});
const viewport=[numeric('centerX','中心 X','视口',-1e12,1e12),numeric('centerY','中心 Y','视口',-1e12,1e12),numeric('rotation','旋转（弧度）','视口',-1000,1000)];
const fractalControls:ControlSpec[]=[
 choice('formula','分形公式','公式',formulaIds,['Mandelbrot','Julia','Newton','Nova','Phoenix','Magnet I','Magnet II','Lambda','Complex Sin · c·sin(z)','Spiral Septagon','Binocular','Mandelbulb 3D']),
 choice('variant','参数空间 / Julia','公式',['mandelbrot','julia']),numeric('power','幂次 / 指数实部','公式',.1,32,.1),numeric('powerImag','指数虚部','公式',-16,16),
 numeric('iterations','最大迭代','计算',1,4096,1),numeric('bailout','逃逸半径','计算',1.000001,1e12),
 numeric('juliaReal','Julia 常数实部','公式',-100,100),numeric('juliaImag','Julia 常数虚部','公式',-100,100),
 numeric('startReal','初始值实部','公式',-100,100),numeric('startImag','初始值虚部','公式',-100,100),
 numeric('relaxation','Newton 松弛系数','公式',.01,3),numeric('tolerance','收敛阈值','计算',1e-14,.1,1e-6),
 choice('convergenceMode','收敛判定','计算',['legacy','step'],['兼容旧文档','迭代步长与残差着色']),
 numeric('feedback','Phoenix 扭曲实部','公式',-2,2),numeric('feedbackImag','Phoenix 扭曲虚部','公式',-2,2),numeric('phoenixPower2','Phoenix 历史指数','公式',0,32,.01,'保留小数输入，计算时四舍五入；0 和 1 都使用前一次迭代值。'),choice('phoenixExponentMode','Phoenix 指数方式','公式',['rounded','complex'],['原版取整','复幂（兼容旧文档）']),numeric('singularityGuard','Spiral 奇点保护（模平方）','公式',1e-24,.1,1e-10),
 numeric('quadReal','Binocular 二次系数实部','公式',-100,100),numeric('quadImag','Binocular 二次系数虚部','公式',-100,100),numeric('constReal','Binocular 常数实部','公式',-100,100),numeric('constImag','Binocular 常数虚部','公式',-100,100),numeric('z0Real','Binocular 初点系数实部','公式',-100,100),numeric('z0Imag','Binocular 初点系数虚部','公式',-100,100),numeric('denomOffset','Binocular 分母偏移','公式',-100,100),...viewport,numeric('centerXLow','中心 X 低位（与高位相加）','高精度',-1e12,1e12,1e-20),numeric('centerYLow','中心 Y 低位（与高位相加）','高精度',-1e12,1e12,1e-20),numeric('zoom','缩放','视口',1e-6,1e28,.1),
 choice('fractalBackend','计算后端','计算',['auto','cpu','webgl2']),choice('renderMethod','渲染方法','计算',['guessing','multi-pass','one-pass']),choice('perturbationPrecision','扰动精度','高精度',['low','medium','high','ultra']),
 choice('outsideColoring','外部着色','颜色',coloringIds),choice('insideColoring','内部着色','颜色',coloringIds),
 choice('metric','Basic 度量','颜色',['iteration','real','imaginary','sum']),choice('binaryAxis','二值分解轴','颜色',['real','imaginary']),
 numeric('colorDensity','颜色密度','颜色',.01,100),numeric('gradientOffset','渐变偏移','颜色',-100,100),
 choice('transfer','传递函数','颜色',['none','linear','sqr','sqrt','cube','cuberoot','log','exp','sin','arctan']),toggle('repeatGradient','循环渐变','颜色'),
 {key:'solidColor',label:'固定颜色（HEX）',group:'颜色',type:'text'},
 choice('trapShape','轨道陷阱','直接着色',['point','ring','cross']),numeric('trapRadius','陷阱半径','直接着色',0,100),
 numeric('trapReal','陷阱中心 X','直接着色',-100,100),numeric('trapImag','陷阱中心 Y','直接着色',-100,100),
 numeric('trapRotation','陷阱旋转','直接着色',-100,100),numeric('trapAspect','陷阱纵横比','直接着色',.01,100),
 numeric('directScale','直接颜色缩放','直接着色',.001,100),numeric('directGamma','直接颜色伽马','直接着色',.1,10),
 numeric('directSaturation','直接颜色饱和度','直接着色',0,1),numeric('directMix','陷阱颜色混合','直接着色',0,1),
 ...bulbControls,
];
export const definitions:SceneDefinition[]=[
 {kind:'fractal',name:'分形',englishName:'Fractal',description:'复平面迭代与轨道着色；含 Mandelbulb 三维距离估计光线步进与体素点云。',dimension:2,equations:[],controls:fractalControls,
 defaults:{equations:{},parameters:{},settings:{...bulbDefaults,fractalColorVersion:2,fractalDistanceVersion:'mathart-1.7.8-v1',formula:'mandelbrot',variant:'mandelbrot',power:2,powerImag:0,iterations:180,bailout:4,juliaReal:-.745,juliaImag:.186,startReal:0,startImag:0,relaxation:1,tolerance:1e-6,feedback:-.5,feedbackImag:0,phoenixPower2:1,phoenixExponentMode:'rounded',singularityGuard:1e-10,quadReal:1,quadImag:0,constReal:1,constImag:0,z0Real:-1,z0Imag:0,denomOffset:1,centerX:-.5,centerY:0,centerXLow:0,centerYLow:0,rotation:0,zoom:1,fractalBackend:'auto',renderMethod:'multi-pass',perturbationPrecision:'high',insideColoring:'none',outsideColoring:'smooth_mandelbrot',metric:'iteration',binaryAxis:'imaginary',colorDensity:3,gradientOffset:0,transfer:'linear',repeatGradient:true,solidColor:'#070913',trapShape:'ring',trapRadius:.5,trapReal:0,trapImag:0,trapRotation:0,trapAspect:1,directScale:1,directGamma:1,directSaturation:.8,directMix:.5,bulbResolution:44,bulbRange:1.3}},
 presets:[
 {id:'mandelbrot',name:'Mandelbrot · 经典',settings:{formula:'mandelbrot',centerX:-.5,zoom:1}},
 {id:'julia',name:'Julia · 海马',settings:{formula:'julia',centerX:0,zoom:1,juliaReal:-.745,juliaImag:.186}},
 {id:'newton',name:'Newton · 三根吸引域',settings:{formula:'newton',power:3,centerX:0,insideColoring:'decomposition',outsideColoring:'basic'}},
 {id:'nova',name:'Nova · 星云',settings:{formula:'nova',power:3,startReal:1,centerX:0,zoom:2,insideColoring:'decomposition'}},
 {id:'phoenix',name:'Phoenix · 反馈',settings:{formula:'phoenix',centerX:0,feedback:-.5}},
 {id:'magnet',name:'Magnet I',settings:{formula:'magnet1',centerX:1,insideColoring:'direct_domain'}},
 {id:'complex-sin',name:'Complex Sin · 正弦参数空间',settings:{formula:'c_sin',startReal:Math.PI/2,startImag:0,centerX:0,zoom:.3,bailout:16,iterations:420}},
 {id:'spiral',name:'Spiral Septagon · 七重螺旋',settings:{formula:'spiral_septagon',variant:'julia',power:7,powerImag:0,juliaReal:-.2,juliaImag:.433,centerX:0,zoom:.8,bailout:32,iterations:300}},
 {id:'binocular',name:'Binocular · 双目',settings:{formula:'binocular',power:4,centerX:1,zoom:.3,tolerance:.001,insideColoring:'basic',outsideColoring:'basic',iterations:128}},
 {id:'lambda',name:'Lambda · 复逻辑斯蒂',settings:{formula:'lambda',startReal:.5,centerX:1,zoom:.6}},
 {id:'bulb',name:'Mandelbulb · 三维',settings:{formula:'mandelbulb_3d',power:8,bailout:2,iterations:24,bulbResolution:44}},
 ],generate:generateFractal},
 {kind:'domain',name:'域着色',englishName:'Domain Coloring',description:'复变函数的相位、模与迭代等值线。',dimension:2,
 equations:[{key:'f',label:'f(z)'},{key:'next',label:'迭代 w →（w 当前值，z 像素，c 常量）'}],
 controls:[domainBackendControl,...viewport,numeric('scale','复平面缩放','视口',1e-6,1e12,.1),toggle('iterationEnabled','启用迭代','迭代'),choice('seedMode','初始种子','迭代',['PIXEL_Z','ZERO','CONSTANT_C']),numeric('iterationSteps','迭代步数','迭代',1,64,1),numeric('constantReal','c 实部','迭代',-100,100),numeric('constantImag','c 虚部','迭代',-100,100),numeric('bailout','迭代逃逸半径','迭代',1,1e12),
 choice('curveMode','等值线模式','等值线',['PHASE','MODULUS','PHASE_MODULUS','NONE']),numeric('phaseDensity','相位密度','等值线',.01,1e6,.5),numeric('modDensity','模密度','等值线',.01,1e6,.5),numeric('phaseSharpness','相位锐度','等值线',.01,100,.1),numeric('modSharpness','模锐度','等值线',.01,100,.1),numeric('curveBias','亮度偏置','等值线',-1,1,.05),numeric('curveMix','等值线混合','等值线',0,1,.05),numeric('paletteOffset','调色板偏移','颜色',-100,100),toggle('complexGrid','复平面网格','视口'),numeric('gridSpacing','网格间距','视口',.001,1e6,.1),numeric('supersampling','每轴子像素数','计算',1,3,1)],
 defaults:{equations:{f:'z^3-1',next:'w^2+z'},parameters:{a:1,t:.95},settings:{domainBackend:'auto',centerX:0,centerY:0,rotation:0,scale:1,iterationEnabled:false,seedMode:'PIXEL_Z',iterationSteps:12,constantReal:0,constantImag:0,bailout:1e6,curveMode:'PHASE_MODULUS',phaseDensity:12,modDensity:8,phaseSharpness:1,modSharpness:1,curveBias:.15,curveMix:1,paletteOffset:0,complexGrid:false,gridSpacing:1,supersampling:1}},
 presets:[...domainGuideExamples,{id:'cubic',name:'三次多项式',equations:{f:'z^3-1'}},{id:'sine-ratio',name:'正弦零极点',equations:{f:'sin(z-i)/sin(z+i)'},settings:{scale:.6,phaseDensity:4,modDensity:16}},{id:'complex-power',name:'复数幂 · 螺旋',equations:{f:'z^(a+3i)'},parameters:{a:1},settings:{scale:2.6}},{id:'newton-domain',name:'Newton 映射',equations:{f:'z',next:'w-(w^3-1)/(3*w^2)'},settings:{iterationEnabled:true,seedMode:'PIXEL_Z',iterationSteps:12}},{id:'sine-iteration',name:'三角迭代',equations:{f:'z',next:'sin(w)*cos(w)/(1+w)'},settings:{iterationEnabled:true,seedMode:'PIXEL_Z',iterationSteps:32,bailout:64}},{id:'essential',name:'本性奇点',equations:{f:'exp(1/z)'},settings:{scale:2}}],
 generate:generateDomain},
 {kind:'roots',name:'复根图谱',englishName:'Complex Roots',description:'抽样复系数多项式，按所选数学规则求解并绘制根的分布。',dimension:3,
 equations:[{key:'polynomial',label:'多项式 = 0 · 可使用采样参数面板中的名称'}],
 controls:[...rootsControls,{key:'variable',label:'多项式变量',group:'多项式',type:'text'},numeric('sampleCount','系数样本数','采样',1,100000,100),numeric('seed','随机种子','采样',0,4294967295,1),numeric('rootIterations','求根迭代上限','求根',10,1000,10),numeric('rootTolerance','相对残差容差','求根',1e-14,.01,1e-9),
 choice('filter','根过滤','构图',['ALL','UPPER_HALF']),choice('rootRender','平面 / 参数虚部深度','构图',['FLAT','DEPTH']),choice('rootColor','颜色度量','构图',['radius','t2_real','t2_imag'],['根半径','参数实部','参数虚部']),numeric('rootScale','根坐标缩放','构图',.001,10000),numeric('depthScale','深度缩放','构图',0,100),numeric('rotation','平面旋转','构图',-1000,1000),...densityControls],
 defaults:{equations:{polynomial:'z^8+t1*z^3+t2'},parameters:{},settings:{...densityDefaults,...rootsDefaults,variable:'z',sampleCount:1500,seed:42,rootIterations:150,rootTolerance:1e-8,domain1:'UNIT_CIRCLE',domain2:'UNIT_CIRCLE',domain3:'FIXED',fixed3Real:1,fixed3Imag:0,rangeMin:-1,rangeMax:1,fixed1Real:1,fixed1Imag:0,fixed2Real:1,fixed2Imag:0,filter:'ALL',rootRender:'FLAT',rootColor:'radius',rootScale:1,depthScale:1,rotation:0}},
 presets:[{id:'roots-bloom',name:'八重根簇',equations:{polynomial:'z^8+t1*z^3+t2'}},{id:'roots-ring',name:'单位圆环',equations:{polynomial:'z^12-t1'},settings:{domain2:'FIXED'}},{id:'roots-web',name:'分支网',equations:{polynomial:'z^6+t1*z^2+t2'},settings:{domain1:'REAL_RANGE',domain2:'REAL_RANGE'}},{id:'roots-depth',name:'复根深度',equations:{polynomial:'z^10+t1*z^4+t2'},settings:{rootRender:'DEPTH',rootColor:'t2_imag'}}],
 generate:generateRoots},
];
