/** MathArt 1.7.8 Easings.class + Easings$1..$46, statically transcribed.
 * Each helper marks a JVM float arithmetic/result boundary. Math transcendental
 * calls run as JS double then narrow, as the source does with Java Math; their
 * last-bit agreement across runtimes is not guaranteed. No local timeline curve
 * is reused. Native LINEAR does not constrain; other helpers constrain their own
 * inputs and preserve NaN. Overshoot outputs are deliberately not constrained.
 */
const F = Math.fround;
const add = (a:number,b:number)=>F(a+b), sub=(a:number,b:number)=>F(a-b);
const mul = (a:number,b:number)=>F(a*b), div=(a:number,b:number)=>F(a/b);
const pow = (a:number,b:number)=>F(Math.pow(a,b));
const sin = (a:number)=>F(Math.sin(a)), cos=(a:number)=>F(Math.cos(a));
const sqrt = (a:number)=>F(Math.sqrt(a)), exp=(a:number)=>F(Math.exp(a));
const constrain = (x:number)=>x<0?0:x>1?1:x;
const PI=F(Math.PI), BACK=F(1.70158), BACK_PLUS_ONE=add(BACK,1), BACK_IN_OUT=mul(BACK,F(1.525));
const ELASTIC=F(2.094395160675049), ELASTIC_IN_OUT=F(1.3962634801864624);
const sigmoid = (x:number)=>div(1,add(1,exp(-x)));
function smooth(input:number):number {
  const x=constrain(input),error=sigmoid(div(-10,2));
  return constrain(div(sub(sigmoid(mul(10,sub(x,.5))),error),sub(1,mul(2,error))));
}
function bounceOut(input:number):number {
  let x=constrain(input);const n=F(7.5625),d=F(2.75);
  if(x<div(1,d))return mul(mul(n,x),x);
  if(x<div(2,d)){x=sub(x,div(F(1.5),d));return add(mul(mul(n,x),x),F(.75));}
  if(x<div(F(2.5),d)){x=sub(x,div(F(2.25),d));return add(mul(mul(n,x),x),F(.9375));}
  x=sub(x,div(F(2.625),d));return add(mul(mul(n,x),x),F(.984375));
}
function thereAndBack(input:number):number {
  const x=constrain(input);return smooth(x<.5?mul(2,x):mul(2,sub(1,x)));
}
function runningStart(x:number):number {
  // Native Bezier expansion, not the local running-start cubic. Multiplications
  // and summation are left-associated exactly as runningStart(FF) bytecode.
  const x2=mul(x,x),x3=mul(x2,x),x4=mul(x3,x),x5=mul(x4,x),x6=mul(x5,x);
  const y=sub(1,x),y2=mul(y,y),y3=mul(y2,y),y4=mul(y3,y);
  return add(add(add(add(mul(mul(mul(15,x2),y4),-.5),mul(mul(mul(20,x3),y3),-.5)),mul(mul(15,x4),y2)),mul(mul(6,x5),y)),x6);
}
function polynomial(x:number,degree:number,mode:string):number {
  if(mode==='in'){let result=x;for(let i=1;i<degree;i++)result=mul(result,x);return result;}
  if(mode==='out')return degree===2?sub(1,mul(sub(1,x),sub(1,x))):sub(1,pow(sub(1,x),degree));
  if(x<.5){let result=2**(degree-1);for(let i=0;i<degree;i++)result=mul(result,x);return result;}
  return sub(1,div(pow(add(mul(-2,x),2),degree),2));
}
export const SOURCE_EASING_NAMES:readonly string[]=Object.freeze([
  'linear',...['quad','cubic','quart','quint','sine','expo','circ','back','elastic','bounce'].flatMap(base=>[`${base}-in`,`${base}-out`,`${base}-in-out`]),
  'smooth','smooth-step','smoother-step','smootherer-step','rush-in','rush-from','double-smooth','there-and-back','there-and-back-with-pause','running-start','wiggle','lingering','exponential-decay','slow-into','not-quite-there',
]);
const names=new Set(SOURCE_EASING_NAMES);
// Easings.getByName is an exact Map lookup. This is deliberately separate from
// sourceEase's public/local spelling support: importing "sine_in" must not
// silently acquire the native meaning of "SINE_IN".
const sourceNames=new Map(SOURCE_EASING_NAMES.map(name=>[name.toUpperCase().replaceAll('-', '_'),name]));
export function lookupSourceEasing(raw:unknown):string|undefined {
  return typeof raw==='string'?sourceNames.get(raw):undefined;
}
/** Names use the public timeline spelling (also accepting source UPPER_SNAKE).
 * `step` and unknown names are explicit errors, not silently native LINEAR.
 * Input is the source float argument; NaN/Infinity retain per-curve semantics.
 */
export function sourceEase(name:string,input:number):number {
  const key=typeof name==='string'?name.toLowerCase().replaceAll('_','-'):'';
  if(!names.has(key))throw new Error(`未知源缓动：${String(name)}`);
  const raw=F(input);if(key==='linear')return raw;
  const x=constrain(raw);
  const polynomialMatch=/^(quad|cubic|quart|quint)-(in|out|in-out)$/.exec(key);
  if(polynomialMatch)return polynomial(x,{quad:2,cubic:3,quart:4,quint:5}[polynomialMatch[1] as 'quad'|'cubic'|'quart'|'quint'],polynomialMatch[2]);
  switch(key){
    case 'sine-in':return sub(1,cos(div(mul(x,PI),2)));
    case 'sine-out':return sin(div(mul(x,PI),2));
    case 'sine-in-out':return div(-sub(cos(mul(PI,x)),1),2);
    case 'expo-in':return x===0?0:pow(2,sub(mul(10,x),10));
    case 'expo-out':return x===1?1:sub(1,pow(2,mul(-10,x)));
    case 'expo-in-out':return x===0?0:x===1?1:x<.5?div(pow(2,sub(mul(20,x),10)),2):div(sub(2,pow(2,add(mul(-20,x),10))),2);
    case 'circ-in':return sub(1,sqrt(sub(1,pow(x,2))));
    case 'circ-out':case 'slow-into':return sqrt(sub(1,pow(sub(x,1),2)));
    case 'circ-in-out':return x<.5?div(sub(1,sqrt(sub(1,pow(mul(2,x),2)))),2):div(add(sqrt(sub(1,pow(add(mul(-2,x),2),2))),1),2);
    case 'back-in':return sub(mul(mul(mul(BACK_PLUS_ONE,x),x),x),mul(mul(BACK,x),x));
    case 'back-out':return add(add(1,mul(BACK_PLUS_ONE,pow(sub(x,1),3))),mul(BACK,pow(sub(x,1),2)));
    case 'back-in-out':return x<.5
      ?div(mul(pow(mul(2,x),2),sub(mul(mul(add(BACK_IN_OUT,1),2),x),BACK_IN_OUT)),2)
      :div(add(mul(pow(sub(mul(2,x),2),2),add(mul(add(BACK_IN_OUT,1),sub(mul(x,2),2)),BACK_IN_OUT)),2),2);
    case 'elastic-in':return x===0?0:x===1?1:mul(-pow(2,sub(mul(10,x),10)),sin(mul(sub(mul(x,10),F(10.75)),ELASTIC)));
    case 'elastic-out':return x===0?0:x===1?1:add(mul(pow(2,mul(-10,x)),sin(mul(sub(mul(x,10),F(.75)),ELASTIC))),1);
    case 'elastic-in-out':return x===0?0:x===1?1:x<.5
      ?div(-mul(pow(2,sub(mul(20,x),10)),sin(mul(sub(mul(20,x),F(11.125)),ELASTIC_IN_OUT))),2)
      :add(div(mul(pow(2,add(mul(-20,x),10)),sin(mul(sub(mul(20,x),F(11.125)),ELASTIC_IN_OUT))),2),1);
    case 'bounce-in':return sub(1,bounceOut(sub(1,x)));
    case 'bounce-out':return bounceOut(x);
    case 'bounce-in-out':return x<.5?div(sub(1,bounceOut(sub(1,mul(2,x)))),2):div(add(1,bounceOut(sub(mul(2,x),1))),2);
    case 'smooth':return smooth(x);
    case 'smooth-step':return sub(mul(mul(3,x),x),mul(mul(mul(2,x),x),x));
    case 'smoother-step':return add(sub(mul(6,pow(x,5)),mul(15,pow(x,4))),mul(10,pow(x,3)));
    case 'smootherer-step':return sub(add(sub(mul(35,pow(x,4)),mul(84,pow(x,5))),mul(70,pow(x,6))),mul(20,pow(x,7)));
    case 'rush-in':return mul(2,smooth(div(x,2)));
    case 'rush-from':return sub(mul(2,smooth(add(div(x,2),.5))),1);
    case 'double-smooth':return x<.5?mul(.5,smooth(mul(2,x))):mul(.5,add(1,smooth(sub(mul(2,x),1))));
    case 'there-and-back':return thereAndBack(x);
    case 'there-and-back-with-pause':{
      const pause=F(1/3),scale=div(2,sub(1,pause));
      return x<sub(.5,div(pause,2))?smooth(mul(scale,x)):x<add(.5,div(pause,2))?1:smooth(sub(scale,mul(scale,x)));
    }
    case 'running-start':return runningStart(x);
    case 'wiggle':return mul(thereAndBack(x),sin(mul(mul(2,PI),x)));
    case 'lingering':return x<0?0:x>F(.8)?1:div(sub(x,0),sub(F(.8),0));
    case 'exponential-decay':return sub(1,exp(div(-x,F(.1))));
    case 'not-quite-there':return mul(F(.7),smooth(x));
    default:throw new Error(`未知源缓动：${name}`);
  }
}
