import type {Scope,RealExpressionFacts} from './expression';
type Interval=readonly[number,number];type Point=readonly[number,number,number];
type Bound=(box:readonly Interval[],scope:Scope)=>Interval|undefined;
const view=new DataView(new ArrayBuffer(8));
/** Adjacent IEEE754 double, including subnormal underflow. */
export function adjacentImplicitFloat(value:number,up:boolean):number {
 if(Number.isNaN(value)||value===(up?Infinity:-Infinity))return value;
 if(value===0)return up?Number.MIN_VALUE:-Number.MIN_VALUE;
 view.setFloat64(0,value,true);let low=view.getUint32(0,true),high=view.getUint32(4,true);
 if((value>0)===up){low=(low+1)>>>0;if(low===0)high=(high+1)>>>0;}else{if(low===0)high=(high-1)>>>0;low=(low-1)>>>0;}
 view.setUint32(0,low,true);view.setUint32(4,high,true);return view.getFloat64(0,true);
}
const finite=(lo:number,hi:number):Interval|undefined=>Number.isFinite(lo)&&Number.isFinite(hi)&&lo<=hi?[lo,hi]:undefined;
const outward=(lo:number,hi:number)=>finite(adjacentImplicitFloat(lo,false),adjacentImplicitFloat(hi,true));
const zero=(a:Interval)=>a[0]<=0&&a[1]>=0;
function multiply(a:Interval,b:Interval){const values=[a[0]*b[0],a[0]*b[1],a[1]*b[0],a[1]*b[1]];return outward(Math.min(...values),Math.max(...values));}
function divide(a:Interval,b:Interval){if(zero(b))return;const reciprocal=outward(1/b[1],1/b[0]);return reciprocal?multiply(a,reciprocal):undefined;}
function positivePower(value:number,exponent:number):Interval|undefined {let lo=1,hi=1;for(let i=0;i<exponent;i++){const bound=outward(lo*value,hi*value);if(!bound)return;lo=Math.max(0,bound[0]);hi=bound[1];}return[lo,hi];}
function integerPower(a:Interval,b:Interval):Interval|undefined {
 if(b[0]!==b[1]||!Number.isInteger(b[0])||Math.abs(b[0])>64)return;
 const n=b[0];if(n<0){if(zero(a))return;const positive=integerPower(a,[-n,-n]);return positive?divide([1,1],positive):undefined;}
 if(n===0)return[1,1];
 const lowerMagnitude=positivePower(Math.min(Math.abs(a[0]),Math.abs(a[1])),n),upperMagnitude=positivePower(Math.max(Math.abs(a[0]),Math.abs(a[1])),n);if(!lowerMagnitude||!upperMagnitude)return;
 if(n%2===0)return[zero(a)?0:lowerMagnitude[0],upperMagnitude[1]];
 const left=positivePower(Math.abs(a[0]),n)!,right=positivePower(Math.abs(a[1]),n)!;
 return finite(a[0]<0?-left[1]:left[0],a[1]<0?-right[0]:right[1]);
}
/** A sufficient local certificate, not a universal continuity decision. Unknown
 * operations/domains fail closed. AST closures are compiled once; every call
 * binds fresh raw CPU edge coordinates and the current numeric scope. */
export function compileImplicitContinuity(expression:RealExpressionFacts) {
 function compile(node:RealExpressionFacts):Bound {
  if(node.kind==='constant')return()=>finite(node.value,node.value);
  if(node.kind==='symbol'){const axis=['x','y','z'].indexOf(node.name);if(axis>=0)return box=>box[axis];return(_box,scope)=>{try{const value=node.resolve(scope);return finite(value,value);}catch{return undefined;}};}
  if(node.kind==='conditional')return()=>undefined;
  const children=node.args.map(compile),name=node.name;
  if(node.kind==='call'&&(['sin','cos','sqrt','abs'].includes(name)?children.length!==1:name==='pow'?children.length!==2:['min','max'].includes(name)?children.length<1:true))return()=>undefined;
  return(box,scope)=>{
   const args=children.map(child=>child(box,scope));if(args.some(a=>!a))return;const values=args as Interval[],[a,b]=values;
   if(name==='unaryPlus')return a;if(name==='unaryMinus')return finite(-a[1],-a[0]);
   if(name==='add')return outward(a[0]+b[0],a[1]+b[1]);
   if(name==='subtract')return outward(a[0]-b[1],a[1]-b[0]);
   if(name==='multiply')return multiply(a,b);if(name==='divide')return divide(a,b);
   if(name==='pow')return integerPower(a,b);
   if(name==='sqrt'&&a[0]>=0){const out=outward(Math.sqrt(a[0]),Math.sqrt(a[1]));return out?[Math.max(0,out[0]),out[1]]:undefined;}
   if(name==='sin'||name==='cos')return[-1,1];
   if(name==='abs')return[zero(a)?0:Math.min(Math.abs(a[0]),Math.abs(a[1])),Math.max(Math.abs(a[0]),Math.abs(a[1]))];
   if(name==='min')return finite(Math.min(...values.map(v=>v[0])),Math.min(...values.map(v=>v[1])));
   if(name==='max')return finite(Math.max(...values.map(v=>v[0])),Math.max(...values.map(v=>v[1])));
   return;
  };
 }
 const bound=compile(expression);
 const box=(a:Point,b:Point)=>a.map((v,i)=>[Math.min(v,b[i]),Math.max(v,b[i])] as Interval);
 const continuous=(a:Point,b:Point,scope:Scope)=>a.every(Number.isFinite)&&b.every(Number.isFinite)&&bound(box(a,b),scope)!==undefined;
 const crossing=(a:Point,b:Point,scope:Scope,iso:number,sign:number,va:number,vb:number)=>{
  if(!continuous(a,b,scope)||!Number.isFinite(iso))return false;
  const left=bound(box(a,a),scope),right=bound(box(b,b),scope);if(!left||!right)return false;
  const classify=(value:Interval)=>value[1]<iso?-sign:value[0]>iso?sign:0,sa=classify(left),sb=classify(right);
  return sa!==0&&sb!==0&&sa!==sb&&sa===Math.sign(va)&&sb===Math.sign(vb);
 };
 return{continuous,crossing};
}
