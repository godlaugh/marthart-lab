import {RootsNativeError,rootsNativeAttempt,rootsNativeCapacity,rootsNativeCheck,type RootsNativeResult,type RootsNativeWorkHooks} from './rootsNativeExpression';
import type {RootsNativeCoefficients} from './rootsNativePolynomial';

/** A budget on owned typed arrays, not degree or native correctness. Six double
 * arrays hold normalized/reduced coefficients and roots (48 bytes/slot), plus
 * the interleaved output (16 bytes/root). Peak growth retains old ownership
 * until replacement arrays exist, and preflights both allocations. */
export const ROOTS_NATIVE_SOLVER_LIMITS=Object.freeze({workspaceBytes:64*1024*1024,work:100_000_000});
export interface RootsNativeSolveOptions extends RootsNativeWorkHooks {maxIterations:number;tolerance:number;maxWork?:number;}
export interface RootsNativeSolveResult {
 /** Borrowed interleaved x,y view. Only rootCount*2 entries are current; valid
  * until the next solve/dispose. Each finite pair is independently admissible. */
 readonly roots:Float64Array;readonly rootCount:number;readonly declaredDegree:number;readonly effectiveDegree:number;
 readonly powerSubstitution:number;readonly iterations:number;readonly stop:'constant'|'linear'|'correction'|'iteration-limit';
 readonly maxCorrectionSquared:number;readonly nonfiniteRootCount:number;readonly work:number;
}
export interface RootsNativeSolver {
 solve(coefficients:RootsNativeCoefficients,options:RootsNativeSolveOptions):RootsNativeResult<RootsNativeSolveResult>;
 diagnostics():{workspaceBytes:number;capacity:number;disposed:boolean};dispose():void;
}
const zero=(x:number)=>x===0?0:x;
const gcd=(a:number,b:number)=>{while(b){const r=a%b;a=b;b=r;}return a;};
export function createRootsNativeSolver():RootsNativeSolver {
 let nr=new Float64Array(),ni=new Float64Array(),rr=new Float64Array(),ri=new Float64Array(),reducedR=new Float64Array(),reducedI=new Float64Array(),out=new Float64Array(),capacity=0,disposed=false;
 const bytes=()=>nr.byteLength+ni.byteLength+rr.byteLength+ri.byteLength+reducedR.byteLength+reducedI.byteLength+out.byteLength;
 const ensure=(degree:number)=>{const slots=degree+1;if(slots<=capacity)return;const needed=slots*64,peak=bytes()+needed;if(peak>ROOTS_NATIVE_SOLVER_LIMITS.workspaceBytes)rootsNativeCapacity('solver workspace bytes',peak,ROOTS_NATIVE_SOLVER_LIMITS.workspaceBytes);const next=[new Float64Array(slots),new Float64Array(slots),new Float64Array(slots),new Float64Array(slots),new Float64Array(slots),new Float64Array(slots),new Float64Array(slots*2)];[nr,ni,rr,ri,reducedR,reducedI,out]=next;capacity=slots;};
 return{
  solve(coefficients,options){return rootsNativeAttempt(()=>{
   rootsNativeCheck(options);if(disposed)throw new RootsNativeError('input','Native root solver has been disposed');
   if(!coefficients||!(coefficients.real instanceof Float64Array)||!(coefficients.imag instanceof Float64Array)||!Number.isInteger(coefficients.declaredDegree)||coefficients.declaredDegree<0||coefficients.declaredDegree>2147483647)throw new RootsNativeError('input','Invalid native coefficient buffer');
   if(!Number.isInteger(options.maxIterations)||options.maxIterations < -2147483648||options.maxIterations>2147483647||typeof options.tolerance!=='number')throw new RootsNativeError('input','Invalid native solver options');
   const maximumWork=options.maxWork??ROOTS_NATIVE_SOLVER_LIMITS.work;if(!Number.isSafeInteger(maximumWork)||maximumWork<0)throw new RootsNativeError('input','Native solver work budget must be a nonnegative safe integer');
   let work=0;const tick=(n=1)=>{rootsNativeCheck(options);if(work+n>maximumWork)rootsNativeCapacity('solver work',work+n,maximumWork);work+=n;rootsNativeCheck(options,n);};
   const declared=coefficients.declaredDegree;if(coefficients.real.length<=declared||coefficients.imag.length<=declared)throw new RootsNativeError('input','Native coefficient buffers must cover the declared degree');const limit=declared;
   ensure(limit);
   // PowerSubstitution's array overload examines declared degree before trim.
   let power=0;if(limit>1)for(let i=1;i<=limit;i++){tick();if(Math.hypot(coefficients.real[i],coefficients.imag[i])<=0)continue;power=power===0?i:gcd(power,i);if(power<=1)break;}
   if(power<=1||limit%power!==0)power=1;
   const reducedDegree=Math.floor(limit/power);
   for(let i=0;i<=reducedDegree;i++){tick();reducedR[i]=zero(coefficients.real[i*power]);reducedI[i]=zero(coefficients.imag[i*power]);}
   let n=reducedDegree;while(n>0&&Math.hypot(reducedR[n],reducedI[n])===0){tick();n--;}
   // ComplexPolynomial trims via hypot, then Aberth's array entry trims exact
   // components again. Keep this stage before finite leading validation.
   while(n>0&&reducedR[n]===0&&reducedI[n]===0){tick();n--;}
   let iterations=0,stop:RootsNativeSolveResult['stop']='constant',maxCorrectionSquared=0;
   if(n>0){
    const lr=reducedR[n],li=reducedI[n];if(!Number.isFinite(lr)||!Number.isFinite(li)||lr===0&&li===0)throw new RootsNativeError('evaluation','Polynomial leading coefficient must be finite and non-zero',{stage:'leading-coefficient'});
    if(n===1){tick();const den=lr*lr+li*li,ar=zero(-reducedR[0]),ai=zero(-reducedI[0]);rr[0]=den===0?NaN:(ar*lr+ai*li)/den;ri[0]=den===0?NaN:(ai*lr-ar*li)/den;stop='linear';}
    else{
     const den=lr*lr+li*li;for(let i=0;i<=n;i++){tick();const ar=reducedR[i],ai=reducedI[i];nr[i]=(ar*lr+ai*li)/den;ni[i]=(ai*lr-ar*li)/den;}
     let cauchy=0,fujiwara=0;for(let i=0;i<n;i++){tick();const m=Math.hypot(nr[i],ni[i]);cauchy=Math.max(cauchy,m);if(m!==0&&Number.isFinite(m))fujiwara=Math.max(fujiwara,Math.pow(m,1/(n-i)));}
     cauchy=1+cauchy;fujiwara=fujiwara===0?1:2*fujiwara;const radius=!Number.isFinite(fujiwara)||fujiwara<=0?cauchy:Math.max(1,Math.min(cauchy,fujiwara)),phase=Math.PI/(2*n);
     for(let i=0;i<n;i++){tick();const a=phase+2*Math.PI*i/n;rr[i]=radius*Math.cos(a);ri[i]=radius*Math.sin(a);}
     const maxIterations=Math.max(1,options.maxIterations),tolerance=Math.max(1e-16,options.tolerance),toleranceSquared=tolerance*tolerance;stop='iteration-limit';
     for(let iteration=0;iteration<maxIterations;iteration++){
      tick();iterations++;maxCorrectionSquared=0;
      for(let i=0;i<n;i++){
       tick();const x=rr[i],y=ri[i];let pr=nr[n],pi=ni[n],dr=0,di=0;
       for(let k=n-1;k>=0;k--){tick();const nextDr=dr*x-di*y+pr,nextDi=dr*y+di*x+pi;dr=nextDr;di=nextDi;const nextPr=pr*x-pi*y+nr[k],nextPi=pr*y+pi*x+ni[k];pr=nextPr;pi=nextPi;}
       const derivativeSquared=dr*dr+di*di;if(derivativeSquared<1e-60)continue;
       const newtonR=(pr*dr+pi*di)/derivativeSquared,newtonI=(pi*dr-pr*di)/derivativeSquared;let sumR=0,sumI=0;
       for(let j=0;j<n;j++){tick();if(j===i)continue;let dx=x-rr[j],dy=y-ri[j],d=dx*dx+dy*dy;if(d<1e-60){dx+=1e-12*(i+1);dy-=1e-12*(j+1);d=dx*dx+dy*dy;}sumR+=dx/d;sumI+=-dy/d;}
       const productR=newtonR*sumR-newtonI*sumI,productI=newtonR*sumI+newtonI*sumR;let er=1-productR;const ei=-productI;let d=er*er+ei*ei;if(d<1e-60){er+=1e-12*(i+1);d=er*er+ei*ei;}
       const cr=(newtonR*er+newtonI*ei)/d,ci=(newtonI*er-newtonR*ei)/d;rr[i]=x-cr;ri[i]=y-ci;maxCorrectionSquared=Math.max(maxCorrectionSquared,cr*cr+ci*ci);
      }
      if(maxCorrectionSquared<toleranceSquared){stop='correction';break;}
     }
    }
   }
   const rootCount=n*power;let nonfiniteRootCount=0;
   for(let i=0;i<n;i++){
    // Base solver builds ComplexNumbers before PowerSubstitution lifts them.
    const x=zero(rr[i]),y=zero(ri[i]);if(power===1){tick();out[i*2]=x;out[i*2+1]=y;if(!Number.isFinite(x)||!Number.isFinite(y))nonfiniteRootCount++;}
    else{const radius=Math.pow(Math.hypot(x,y),1/power),angle=Math.atan2(y,x)/power;for(let branch=0;branch<power;branch++){tick();const theta=angle+2*Math.PI*branch/power,at=(i*power+branch)*2;out[at]=zero(radius*Math.cos(theta));out[at+1]=zero(radius*Math.sin(theta));if(!Number.isFinite(out[at])||!Number.isFinite(out[at+1]))nonfiniteRootCount++;}}
   }
   return{roots:out,rootCount,declaredDegree:declared,effectiveDegree:n*power,powerSubstitution:power,iterations,stop,maxCorrectionSquared,nonfiniteRootCount,work};
  });},
  diagnostics(){return{workspaceBytes:bytes(),capacity,disposed};},
  dispose(){disposed=true;nr=new Float64Array();ni=new Float64Array();rr=new Float64Array();ri=new Float64Array();reducedR=new Float64Array();reducedI=new Float64Array();out=new Float64Array();capacity=0;}
 };
}
