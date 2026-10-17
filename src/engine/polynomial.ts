import type {MathNode} from 'mathjs';
import {add,sub,mul,scale,abs,finite,div,nodeData,parsed,compileNode,type Complex,type ComplexScope} from './complexMath';
const TAU=2*Math.PI;
export type PolynomialFn=(scope:ComplexScope)=>Complex[];
function polyAdd(a:Complex[],b:Complex[],sign=1):Complex[]{return Array.from({length:Math.max(a.length,b.length)},(_,i)=>add(a[i]??[0,0],scale(b[i]??[0,0],sign)));}
function polyMultiply(a:Complex[],b:Complex[]):Complex[]{
 if(a.length+b.length-2>48)throw new Error('多项式最高支持48次');
 const result:Complex[]=Array.from({length:a.length+b.length-1},()=>[0,0]);
 for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++)result[i+j]=add(result[i+j],mul(a[i],b[j]));
 return result;
}
/** Coefficients are returned in ascending powers. Variable powers must be nonnegative integers. */
export function compilePolynomial(source:string,variable='z',parameters:string[]=[]):PolynomialFn {
 const allowed=new Set(parameters),tree=parsed(source);
 function containsVariable(node:MathNode):boolean {let yes=false;node.traverse(n=>{if(nodeData(n).type==='SymbolNode'&&nodeData(n).name===variable)yes=true;});return yes;}
 function compile(node:MathNode):PolynomialFn {
  const n=nodeData(node);
  if(!containsVariable(node)){const constant=compileNode(node,allowed);return s=>[constant(s)];}
  if(n.type==='SymbolNode'&&n.name===variable)return()=>[[0,0],[1,0]];
  if(n.type==='ParenthesisNode')return compile(n.content!);
  if(n.type==='OperatorNode'){
   const args=n.args!,a=compile(args[0]);
   if(n.fn==='unaryMinus')return s=>a(s).map(z=>scale(z,-1));
   if(n.fn==='unaryPlus')return a;
   if(n.fn==='pow'){
    const b=nodeData(args[1]);
    if(b.type!=='ConstantNode'||!Number.isInteger(Number(b.value))||Number(b.value)<0||Number(b.value)>48)throw new Error('多项式变量幂次必须为0–48的整数');
    const exponent=Number(b.value);return s=>{let r:Complex[]=[[1,0]],v=a(s);for(let i=0;i<exponent;i++)r=polyMultiply(r,v);return r;};
   }
   const b=compile(args[1]);
   if(n.fn==='add')return s=>polyAdd(a(s),b(s));
   if(n.fn==='subtract')return s=>polyAdd(a(s),b(s),-1);
   if(n.fn==='multiply')return s=>polyMultiply(a(s),b(s));
   if(n.fn==='divide'){
    if(containsVariable(args[1]))throw new Error('多项式不能除以包含 '+variable+' 的表达式');
    return s=>a(s).map(z=>div(z,b(s)[0]));
   }
  }
  throw new Error('仅支持 '+variable+' 的多项式，系数可使用复函数和变化参数');
 }
 const evaluate=compile(tree);
 return scope=>{const coefficients=evaluate(scope);if(coefficients.some(z=>!finite(z)))throw new Error('多项式系数包含无定义或非有限数');return coefficients;};
}
export function evaluatePolynomial(coefficients:Complex[],z:Complex):Complex{
 let value:Complex=[0,0];for(let i=coefficients.length-1;i>=0;i--)value=add(mul(value,z),coefficients[i]);return value;
}
/** Backward-error residual |p(z)| / sum |a_i z^i|. Both numerator and
 * denominator use the same finite scaling; overflow must never certify a root.
 * This does not bound forward error for ill-conditioned or repeated roots. */
export function polynomialRelativeResidual(coeff:Complex[],z:Complex):number {
 if(!finite(z)||!coeff.length||coeff.some(c=>!finite(c)))return Infinity;
 const m=Math.max(...coeff.map(c=>Math.max(Math.abs(c[0]),Math.abs(c[1]))));
 if(m===0)return Infinity;
 let degree=coeff.length-1;while(degree>0&&abs(coeff[degree])===0)degree--;
 const r=abs(z);if(!Number.isFinite(r))return Infinity;
 let value:Complex=[0,0],bound=0;
 if(r<=1){for(let i=degree;i>=0;i--){const c:Complex=[coeff[i][0]/m,coeff[i][1]/m];value=add(mul(value,z),c);bound=bound*r+abs(c);}}
 else {const w:Complex=[z[0]/r,z[1]/r];let factor=1;for(let i=degree;i>=0;i--){const c:Complex=[coeff[i][0]/m*factor,coeff[i][1]/m*factor];value=add(mul(value,w),c);bound+=abs(c);factor/=r;}}
 if(!finite(value)||!Number.isFinite(bound))return Infinity;
 return bound===0?(r===0&&abs(coeff[0])===0?0:Infinity):abs(value)/bound;
}
export interface RootSolution {roots:Complex[];converged:boolean;iterations:number;residual:number;work:number;}
export interface RootSolveOptions {isCancelled?:()=>boolean;/** Actual complex Horner/pair operations, emitted before each iteration. */onWork?:(operations:number)=>void;}
/** Simultaneous Durand–Kerner correction, with independently scaled residual
 * acceptance. Runtime work is counted, not estimated from the iteration limit. */
export function solvePolynomial(input:Complex[],maxIterations=300,tolerance=1e-9,phase=.123,options:RootSolveOptions={}):RootSolution {
 const check=()=>{if(options.isCancelled?.())throw new DOMException('复根求解已取消','AbortError');};check();
 if(!Number.isInteger(maxIterations)||maxIterations<1||maxIterations>2000)throw new Error('求根迭代次数须为1–2000');
 if(!Number.isFinite(tolerance)||tolerance<=0||tolerance>.1)throw new Error('求根容差无效');
 if(!Number.isFinite(phase))throw new Error('求根初始相位必须有限');
 if(input.some(z=>!finite(z)))throw new Error('多项式系数必须有限');
 const a=input.map(z=>[...z] as Complex);
 while(a.length&&abs(a[a.length-1])===0)a.pop();
 if(a.length===0)throw new Error('零多项式有无限多个根');
 if(a.length===1)return {roots:[],converged:true,iterations:0,residual:0,work:0};
 if(a.length>49)throw new Error('多项式最高支持48次');
 const leading=a[a.length-1];for(let i=0;i<a.length;i++)a[i]=div(a[i],leading);
 if(a.some(z=>!finite(z)))throw new Error('多项式系数比例超出双精度范围');
 const n=a.length-1;
 if(n===1){const root=scale(a[0],-1),residual=polynomialRelativeResidual(input,root);options.onWork?.(2);return {roots:[root],converged:residual<=tolerance,iterations:0,residual,work:2};}
 let zeros=0;while(zeros<n&&abs(a[zeros])===0)zeros++;
 if(zeros){const rest=solvePolynomial(a.slice(zeros),maxIterations,tolerance,phase,options);return {...rest,roots:[...Array.from({length:zeros},()=>[0,0] as Complex),...rest.roots]};}
 // If every surviving exponent is a multiple of k, solve q(w), w=z^k,
 // then lift all k branches. This exact algebraic reduction improves sparse
 // polynomials without changing their roots or accepting unchecked samples.
 const gcd=(a:number,b:number):number=>{while(b){const r=a%b;a=b;b=r;}return a;};
 let power=0;for(let i=1;i<=n;i++)if(abs(a[i])!==0)power=gcd(power,i);
 if(power>1){
  const reduced:Complex[]=Array.from({length:n/power+1},(_,i)=>a[i*power]),small=solvePolynomial(reduced,maxIterations,tolerance,phase,options),roots:Complex[]=[];
  for(const root of small.roots){check();const radius=abs(root)**(1/power),angle=Math.atan2(root[1],root[0]);for(let k=0;k<power;k++){const theta=(angle+TAU*k)/power;roots.push([radius*Math.cos(theta),radius*Math.sin(theta)]);}}
  const extra=roots.length*(n+1);options.onWork?.(extra);
  const residual=Math.max(...roots.map(root=>polynomialRelativeResidual(input,root)));
  roots.sort((x,y)=>x[0]-y[0]||x[1]-y[1]);return{roots,converged:small.converged&&roots.every(finite)&&residual<=tolerance,iterations:small.iterations,residual,work:small.work+extra};
 }
 const radius=Math.max(.01,2*Math.max(...a.slice(0,-1).map((v,i)=>abs(v)**(1/(n-i)))));
 if(!Number.isFinite(radius))throw new Error('求根初始半径超出双精度范围');
 let roots:Complex[]=Array.from({length:n},(_,i)=>scale([Math.cos(TAU*i/n+phase),Math.sin(TAU*i/n+phase)],radius*(1+.01*i/n)));
 let residual=Infinity,iterations=0,work=0;
 for(let iteration=0;iteration<maxIterations;iteration++){
  check();const operations=2*n*n;options.onWork?.(operations);work+=operations;iterations++;
  const next:Complex[]=[];
  for(let i=0;i<n;i++){
   let denom:Complex=[1,0];for(let j=0;j<n;j++)if(i!==j)denom=mul(denom,sub(roots[i],roots[j]));
   if(abs(denom)<1e-280)denom=add(denom,scale([Math.cos(i+iteration),Math.sin(i+iteration)],1e-14));
   next.push(sub(roots[i],div(evaluatePolynomial(a,roots[i]),denom)));
  }
  if(next.some(z=>!finite(z)))break;
  roots=next;const residualWork=n*(n+1);options.onWork?.(residualWork);work+=residualWork;residual=Math.max(...roots.map(z=>polynomialRelativeResidual(input,z)));
  if(residual<=tolerance)break;
 }
 roots.sort((x,y)=>x[0]-y[0]||x[1]-y[1]);
 return {roots,converged:residual<=tolerance&&roots.every(finite),iterations,residual,work};
}
