/** MathArt 1.7.8 ComplexCoefficientExpression, independently transcribed from
 * retained classfiles. This is not the Domain/MathJS expression language.
 * Java Math transcendental last bits are not claimed identical to every
 * JavaScript runtime. Character classes use the retained JRE BMP tables. */
export type RootsNativeFailureKind = 'syntax'|'evaluation'|'input'|'capacity';
export class RootsNativeError extends Error {
 constructor(readonly kind:RootsNativeFailureKind,message:string,readonly facts:Readonly<Record<string,string|number>>={}){super(message);this.name='RootsNativeError';}
}
export type RootsNativeResult<T>={ok:true;value:T}|{ok:false;error:RootsNativeError};
export interface RootsNativeWorkHooks {isCancelled?:()=>boolean;onWork?:(operations:number)=>void;}
/** Local admission, not native format limits. Bound parser stack and retained
 * instructions before allocation. The iterative evaluator uses 16 bytes/node. */
export const ROOTS_NATIVE_EXPRESSION_LIMITS=Object.freeze({characters:65536,nodes:8192,depth:128});
export const ROOTS_NATIVE_FUNCTION_NAMES=Object.freeze(['re','im','abs','conj','sin','cos','exp'] as const);
export type RootsNativeComplex=readonly [number,number];
export type RootsNativeScope=ReadonlyMap<string,RootsNativeComplex>;
import {isJavaWhitespace} from './sourceJavaText';
import {sourceJavaDecimalDigit,sourceJavaIsLetter} from './rootsSourceCharacters';
// The public functions synchronously nest (polynomial -> expression). Retain a
// callback exception across those Result boundaries, then rethrow the original
// value at the outer boundary, even when a caller throws a RootsNativeError.
class CallbackFailure {constructor(readonly original:unknown){}}
let attemptDepth=0;
export function rootsNativeCheck(hooks:RootsNativeWorkHooks,work=0):void {
 let cancelled:boolean|undefined;
 try{cancelled=hooks.isCancelled?.();if(!cancelled&&work)hooks.onWork?.(work);}catch(error){if(error instanceof CallbackFailure)throw error;throw attemptDepth?new CallbackFailure(error):error;}
 if(cancelled)throw new DOMException('Roots native calculation cancelled','AbortError');
}
/** Only catch our owned expected failures. Hook/Abort exceptions remain intact. */
export function rootsNativeAttempt<T>(run:()=>T):RootsNativeResult<T>{attemptDepth++;try{return{ok:true,value:run()};}catch(error){if(error instanceof CallbackFailure){if(attemptDepth===1)throw error.original;throw error;}if(error instanceof RootsNativeError)return{ok:false,error};throw error;}finally{attemptDepth--;}}
export function rootsNativeCapacity(resource:string,actual:number,limit:number):never{throw new RootsNativeError('capacity',`Roots native ${resource} exceeds its local resource budget`,{resource,actual,limit});}
const fail=(kind:RootsNativeFailureKind,message:string,facts:Readonly<Record<string,string|number>>={}):never=>{throw new RootsNativeError(kind,message,facts);};
type Instruction={op:'number';value:number;imag?:number}|{op:'variable';name:string}|{op:'unary';sign:'+'|'-';a:number}|{op:'binary';symbol:'+'|'-'|'*'|'/'|'^';a:number;b:number}|{op:'function';name:string;a:number};
const letter=(c:string|undefined)=>c!==undefined&&sourceJavaIsLetter(c);
const digit=(c:string|undefined)=>c!==undefined&&sourceJavaDecimalDigit(c)>=0;
const identifier=(c:string|undefined)=>c==='_'||letter(c)||digit(c);
class Parser {
 private pos=0;private depth=0;readonly instructions:Instruction[]=[];
 constructor(readonly source:string,private hooks:RootsNativeWorkHooks){}
 private space(){while(this.pos<this.source.length&&isJavaWhitespace(this.source[this.pos]))this.pos++;}
 private eat(c:string){this.space();if(this.source[this.pos]!==c)return false;this.pos++;return true;}
 private node(n:Instruction){rootsNativeCheck(this.hooks,1);if(this.instructions.length>=ROOTS_NATIVE_EXPRESSION_LIMITS.nodes)rootsNativeCapacity('expression nodes',this.instructions.length+1,ROOTS_NATIVE_EXPRESSION_LIMITS.nodes);return this.instructions.push(n)-1;}
 private nested<T>(run:()=>T):T{if(++this.depth>ROOTS_NATIVE_EXPRESSION_LIMITS.depth)rootsNativeCapacity('parser depth',this.depth,ROOTS_NATIVE_EXPRESSION_LIMITS.depth);try{return run();}finally{this.depth--;}}
 private syntax(message:string):never{return fail('syntax',message,{offset:this.pos});}
 parse(){const result=this.expression();this.space();if(this.pos!==this.source.length)this.syntax('Unexpected coefficient expression input');return result;}
 private expression():number{let a=this.term();while(true){if(this.eat('+'))a=this.node({op:'binary',symbol:'+',a,b:this.term()});else if(this.eat('-'))a=this.node({op:'binary',symbol:'-',a,b:this.term()});else return a;}}
 private term():number{let a=this.power();while(true){if(this.eat('*'))a=this.node({op:'binary',symbol:'*',a,b:this.power()});else if(this.eat('/'))a=this.node({op:'binary',symbol:'/',a,b:this.power()});else return a;}}
 private power():number{return this.nested(()=>{let a=this.unary();if(this.eat('^'))a=this.node({op:'binary',symbol:'^',a,b:this.power()});return a;});}
 private unary():number{if(this.eat('+'))return this.nested(()=>this.node({op:'unary',sign:'+',a:this.unary()}));if(this.eat('-'))return this.nested(()=>this.node({op:'unary',sign:'-',a:this.unary()}));return this.primary();}
 private primary():number{
  if(this.eat('(')){const result=this.nested(()=>this.expression());if(!this.eat(')'))this.syntax('Missing coefficient closing parenthesis');return result;}
  this.space();const start=this.pos,c=this.source[this.pos];
  if(digit(c)||c==='.'){while(digit(this.source[this.pos])||this.source[this.pos]==='.')this.pos++;if(/[eE]/.test(this.source[this.pos]??'')){this.pos++;if(/[+-]/.test(this.source[this.pos]??''))this.pos++;while(digit(this.source[this.pos]))this.pos++;}const token=this.source.slice(start,this.pos);if(!/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(token))this.syntax('Invalid coefficient number');return this.node({op:'number',value:Number(token)});}
  if(letter(c)||c==='_'){
   while(identifier(this.source[this.pos]))this.pos++;const name=this.source.slice(start,this.pos),lower=name.toLowerCase();
   if(this.eat('(')){const a=this.nested(()=>this.expression());if(!this.eat(')'))this.syntax('Missing coefficient function parenthesis');return this.node({op:'function',name:lower,a});}
   if(lower==='i')return this.node({op:'number',value:0,imag:1});
   if(lower==='pi'||lower==='e')return this.node({op:'number',value:lower==='pi'?Math.PI:Math.E});
   return this.node({op:'variable',name});
  }
  return this.syntax('Expected coefficient expression');
 }
}
/** Evaluator state is private to one compiled expression; result is a scalar
 * tuple, while workspace buffers are reused across calls. */
export interface PreparedRootsNativeExpression {
 readonly source:string;readonly nodeCount:number;readonly workspaceBytes:number;
 evaluate(scope:RootsNativeScope,hooks?:RootsNativeWorkHooks):RootsNativeResult<RootsNativeComplex>;
 dispose():void;
}
function powInto(out:Float64Array,at:number,x:number,y:number,p:number,q:number,hooks:RootsNativeWorkHooks){
 if(q===0&&p===Math.round(p)){
  // Java d2i saturates infinities/out-of-range values. INT_MIN's native
  // recursive negation never progresses: diagnose instead of overflowing stack.
  const exponent=Math.max(-2147483648,Math.min(2147483647,p));
  if(exponent===-2147483648)rootsNativeCapacity('negative integer power recursion',2147483648,2147483647);
  let k=Math.abs(exponent),r=1,i=0,br=x,bi=y;
  while(k>0){rootsNativeCheck(hooks,1);if(k%2===1){const nr=r*br-i*bi,ni=r*bi+i*br;r=nr;i=ni;}const nr=br*br-bi*bi,ni=br*bi+bi*br;br=nr;bi=ni;k=Math.floor(k/2);}
  if(exponent<0){const d=r*r+i*i;out[at]=r/d;out[at+1]=-i/d;}else{out[at]=r;out[at+1]=i;}return;
 }
 const radius=Math.hypot(x,y),theta=Math.atan2(y,x),l=Math.log(radius),real=l*p-theta*q,imag=l*q+theta*p,e=Math.exp(real);out[at]=e*Math.cos(imag);out[at+1]=e*Math.sin(imag);
}
export function prepareRootsNativeExpression(raw:string,hooks:RootsNativeWorkHooks={}):RootsNativeResult<PreparedRootsNativeExpression>{return rootsNativeAttempt(()=>{
 rootsNativeCheck(hooks);if(typeof raw!=='string')return fail('input','Coefficient expression must be a string');if(raw.length>ROOTS_NATIVE_EXPRESSION_LIMITS.characters)rootsNativeCapacity('expression characters',raw.length,ROOTS_NATIVE_EXPRESSION_LIMITS.characters);
 // Scan work is charged independently of AST size (a huge whitespace prefix is work).
 rootsNativeCheck(hooks,raw.length);const parser=new Parser(raw,hooks),result=parser.parse(),instructions=parser.instructions;let values=new Float64Array(instructions.length*2),disposed=false;
 const plan:PreparedRootsNativeExpression={source:raw,nodeCount:instructions.length,workspaceBytes:values.byteLength,
 evaluate(scope,h={}){return rootsNativeAttempt(()=>{
  rootsNativeCheck(h);if(disposed)return fail('input','Coefficient expression has been disposed');
  for(let k=0;k<instructions.length;k++){
   rootsNativeCheck(h,1);const n=instructions[k],at=k*2;let x=0,y=0;
   if(n.op==='number'){x=n.value;y=n.imag??0;}
   else if(n.op==='variable'){
    const value=scope.get(n.name);if(value===undefined||value===null)return fail('evaluation','Undefined coefficient parameter: '+n.name,{parameter:n.name});if(value.length!==2||typeof value[0]!=='number'||typeof value[1]!=='number')return fail('input','Coefficient parameter must be a complex pair',{parameter:n.name});// Sample values are source ComplexNumbers: their constructor canonicalizes zero.
    x=value[0]===0?0:value[0];y=value[1]===0?0:value[1];
   }else{
    const a=n.a*2,ar=values[a],ai=values[a+1];
    if(n.op==='unary'){x=n.sign==='-'?-ar:ar;y=n.sign==='-'?-ai:ai;}
    else if(n.op==='binary'){
     const b=n.b*2,br=values[b],bi=values[b+1];switch(n.symbol){case'+':x=ar+br;y=ai+bi;break;case'-':x=ar-br;y=ai-bi;break;case'*':x=ar*br-ai*bi;y=ar*bi+ai*br;break;case'/':{const d=br*br+bi*bi;if(d===0){x=y=NaN;}else{x=(ar*br+ai*bi)/d;y=(ai*br-ar*bi)/d;}break;}case'^':powInto(values,at,ar,ai,br,bi,h);continue;}
    }else{switch(n.name){case're':x=ar;break;case'im':x=ai;break;case'abs':x=Math.hypot(ar,ai);break;case'conj':x=ar;y=-ai;break;case'sin':x=Math.sin(ar)*Math.cosh(ai);y=Math.cos(ar)*Math.sinh(ai);break;case'cos':x=Math.cos(ar)*Math.cosh(ai);y=-Math.sin(ar)*Math.sinh(ai);break;case'exp':{const e=Math.exp(ar);x=e*Math.cos(ai);y=e*Math.sin(ai);break;}default:return fail('evaluation','Unsupported coefficient function: '+n.name,{function:n.name});}}
   }
   values[at]=x;values[at+1]=y;
  }
  return[values[result*2],values[result*2+1]] as const;
 });},dispose(){disposed=true;values=new Float64Array();instructions.length=0;}};
 return plan;
});}
