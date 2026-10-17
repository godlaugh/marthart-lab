import type {MathNode} from 'mathjs';
import {nodeData,type Complex,type ComplexFn,type ComplexScope} from './complexMath';

/** MathArt 1.7.8 execution arithmetic. `gpu` is a staged float32 CPU reference,
 * not an emulation of a particular GLSL driver (transcendentals, contraction,
 * subnormal handling and atan(0,0) can differ). */
export type DomainNativeStage='cpu'|'gpu';
export const domainNativeFunctionNames=Object.freeze([
 'sin','cos','tan','sinh','cosh','tanh','asin','acos','atan','acot','asec','acsc','arccsc',
 'asinh','acosh','atanh','acoth','arsech','exp','log','ln','sqrt','abs','arg','conj','pow','re','im',
] as const);
export const domainNativeConstantNames=Object.freeze(['i','pi','e'] as const);

type Unary=(z:Complex)=>Complex;
type Binary=(a:Complex,b:Complex)=>Complex;

/** CPU recipes follow ComplexExpressionParser BinaryOp/FunctionCall bytecode;
 * GPU recipes follow domain_coloring_frag.glsl, SHA256 23aba61177f1534d….
 * Keep their different inverse-function operation order and magnitude rules.
 * In particular, do not replace epsilon division, polar sqrt or general power
 * with the stable/local arithmetic implementation. */
function arithmetic(stage:DomainNativeStage){
 const gpu=stage==='gpu',q=gpu?Math.fround:(v:number)=>v;
 const plus=(a:number,b:number)=>q(a+b),minus=(a:number,b:number)=>q(a-b);
 const times=(a:number,b:number)=>q(a*b),over=(a:number,b:number)=>q(a/b);
 const trig=(fn:(v:number)=>number,v:number)=>q(fn(v));
 const magnitude=(z:Complex)=>gpu?trig(Math.sqrt,plus(times(z[0],z[0]),times(z[1],z[1]))):Math.hypot(z[0],z[1]);
 const argument=(z:Complex)=>q(Math.atan2(z[1],z[0]));
 const add:Binary=(a,b)=>[plus(a[0],b[0]),plus(a[1],b[1])];
 const sub:Binary=(a,b)=>[minus(a[0],b[0]),minus(a[1],b[1])];
 const mul:Binary=(a,b)=>[minus(times(a[0],b[0]),times(a[1],b[1])),plus(times(a[0],b[1]),times(a[1],b[0]))];
 const div:Binary=(a,b)=>{
  const d=plus(plus(times(b[0],b[0]),times(b[1],b[1])),q(1e-18));
  return[over(plus(times(a[0],b[0]),times(a[1],b[1])),d),over(minus(times(a[1],b[0]),times(a[0],b[1])),d)];
 };
 const exp:Unary=z=>{const ex=trig(Math.exp,z[0]);return[times(ex,trig(Math.cos,z[1])),times(ex,trig(Math.sin,z[1]))];};
 const log:Unary=z=>[trig(Math.log,plus(magnitude(z),q(1e-18))),argument(z)];
 const pow:Binary=(z,p)=>exp(mul(log(z),p));
 const sqrt:Unary=z=>{const r=trig(Math.sqrt,magnitude(z)),theta=times(argument(z),.5);return[times(r,trig(Math.cos,theta)),times(r,trig(Math.sin,theta))];};
 const sin:Unary=z=>[times(trig(Math.sin,z[0]),trig(Math.cosh,z[1])),times(trig(Math.cos,z[0]),trig(Math.sinh,z[1]))];
 const cos:Unary=z=>[times(trig(Math.cos,z[0]),trig(Math.cosh,z[1])),times(-trig(Math.sin,z[0]),trig(Math.sinh,z[1]))];
 const sinh:Unary=z=>[times(trig(Math.sinh,z[0]),trig(Math.cos,z[1])),times(trig(Math.cosh,z[0]),trig(Math.sin,z[1]))];
 const cosh:Unary=z=>[times(trig(Math.cosh,z[0]),trig(Math.cos,z[1])),times(trig(Math.sinh,z[0]),trig(Math.sin,z[1]))];
 const asin:Unary=z=>{
  const iz:Complex=gpu?mul([0,1],z):[-z[1],z[0]];
  const a=log(add(iz,sqrt(sub([1,0],mul(z,z)))));
  return gpu?mul([0,-1],a):[a[1],-a[0]];
 };
 const acos:Unary=z=>{const a=asin(z);return gpu?sub([q(1.57079632679),0],a):[Math.PI/2-a[0],-a[1]];};
 const atan:Unary=z=>{
  const iz:Complex=gpu?mul([0,1],z):[-z[1],z[0]];
  const d=sub(log(sub([1,0],iz)),log(add([1,0],iz)));
  return gpu?mul([0,.5],d):[-.5*d[1],.5*d[0]];
 };
 const asinh:Unary=z=>log(add(z,sqrt(add(mul(z,z),[1,0]))));
 const acosh:Unary=z=>log(add(z,mul(sqrt(add(z,[1,0])),sqrt(sub(z,[1,0])))));
 const atanh:Unary=z=>{const d=sub(log(add([1,0],z)),log(sub([1,0],z)));return gpu?mul([.5,0],d):[.5*d[0],.5*d[1]];};
 const acsc:Unary=z=>asin(div([1,0],z));
 const unary:Readonly<Record<string,Unary>>={
  sin,cos,tan:z=>div(sin(z),cos(z)),sinh,cosh,tanh:z=>div(sinh(z),cosh(z)),asin,acos,atan,
  acot:z=>atan(div([1,0],z)),asec:z=>acos(div([1,0],z)),acsc,arccsc:acsc,
  asinh,acosh,atanh,acoth:z=>atanh(div([1,0],z)),arsech:z=>acosh(div([1,0],z)),
  exp,log,ln:log,sqrt,abs:z=>[magnitude(z),0],arg:z=>[argument(z),0],
  conj:z=>[z[0],-z[1]],re:z=>[z[0],0],im:z=>[z[1],0],
 };
 return{q,unary,binary:{add,subtract:sub,multiply:mul,divide:div,pow} as Readonly<Record<string,Binary>>};
}
const cpu=arithmetic('cpu'),gpu=arithmetic('gpu');
const binaryGlsl:Readonly<Record<string,string>>={add:'c_add',subtract:'c_sub',multiply:'c_mul',divide:'c_div',pow:'c_pow'};

/** Constant.formatFloat first compares d with (double)(long)d. Java's d2l
 * saturates, so +2^63 also compares equal after Long.MAX_VALUE rounds back to
 * double. BigInt preserves the exact long digits that JS String may shorten.
 * Outside that branch JS's shortest decimal is used; Java Double.toString
 * text/locale equivalence is not claimed. Nonfinite source literals cannot
 * form the native GLSL expression and are reported to the execution owner. */
export function formatDomainNativeGlslFloat(value:number):string{
 if(!Number.isFinite(value))throw new Error('原版 Domain GLSL 无法编译非有限数字常量');
 const boundary=2**63;
 if(Number.isInteger(value)&&value>=-boundary&&value<=boundary){
  const integer=value===boundary?9223372036854775807n:BigInt(value);
  return integer.toString()+'.0';
 }
 const literal=String(value);return /[.e]/i.test(literal)?literal:literal+'.0';
}

/** Identifier normalization and grammar belong to the native parser, not this
 * arithmetic module. `allowed` contains bindable scalar parameter names, not
 * ambient scope names. Reserved z/w/c/i/pi/e always take precedence. Missing
 * scalar parameters are zero; w without an explicit scope uses current z.
 * The caller owns orbit/seed/stop semantics. No integer-power shortcut. */
export function compileDomainNativeNode(tree:MathNode,allowed:ReadonlySet<string>,stage:DomainNativeStage):ComplexFn{
 const ops=stage==='gpu'?gpu:cpu;
 const coordinate=(scope:ComplexScope,name:string):Complex=>{
  const value=Object.hasOwn(scope,name)?scope[name]:0;
  return typeof value==='number'?[ops.q(value),0]:[ops.q(value[0]),ops.q(value[1])];
 };
 function compile(node:MathNode):ComplexFn{
  const n=nodeData(node);
  if(n.type==='ConstantNode'){const value=ops.q(Number(n.value));return()=>[value,0];}
  if(n.type==='SymbolNode'){
   const name=n.name!;
   if(name==='i')return()=>[0,1];
   if(name==='pi')return()=>[stage==='gpu'?Math.fround(3.14159265359):Math.PI,0];
   if(name==='e')return()=>[stage==='gpu'?Math.fround(2.71828182846):Math.E,0];
   if(name==='z'||name==='c')return scope=>coordinate(scope,name);
   if(name==='w')return scope=>coordinate(scope,Object.hasOwn(scope,'w')?'w':'z');
   if(!allowed.has(name))return()=>[0,0];
   return scope=>{
    const value=Object.hasOwn(scope,name)?scope[name]:0;
    if(typeof value!=='number')throw new Error('原版 Domain 参数必须是实数：'+name);
    return[ops.q(value),0];
   };
  }
  if(n.type==='ParenthesisNode')return compile(n.content!);
  if(n.type==='OperatorNode'){
   const name=typeof n.fn==='string'?n.fn:'',args=n.args??[];
   if((name==='unaryPlus'||name==='unaryMinus')&&args.length===1){const a=compile(args[0]);return name==='unaryPlus'?a:scope=>{const z=a(scope);return[-z[0],-z[1]];};}
   if(Object.hasOwn(ops.binary,name)&&args.length===2){const a=compile(args[0]),b=compile(args[1]),fn=ops.binary[name];return scope=>fn(a(scope),b(scope));}
   throw new Error('原版 Domain 不支持此运算或参数数量：'+name);
  }
  if(n.type==='FunctionNode'){
   const name=typeof n.fn==='object'?n.fn.name:'',args=n.args??[];
   if(name==='pow'&&args.length===2){const a=compile(args[0]),b=compile(args[1]);return scope=>ops.binary.pow(a(scope),b(scope));}
   if(Object.hasOwn(ops.unary,name)&&args.length===1){const a=compile(args[0]),fn=ops.unary[name];return scope=>fn(a(scope));}
   throw new Error('原版 Domain 不支持此函数或参数数量：'+name);
  }
  throw new Error('原版 Domain 不支持 '+n.type);
 }
 return compile(tree);
}

/** Native GLSL lowering keeps native operation names and general log-exp power.
 * Names are numeric uniform slots: no source identifier is pasted into GLSL.
 * An unbound ordinary variable is the fresh native uniform's default zero.
 * `w` is left as w: the orbit owner must enforce its native scope availability.
 * Nonfinite literals are an explicit compilation limitation, never rewritten
 * into a different shader expression. Finite subnormal/overflowing-f32 literals
 * remain driver inputs rather than being admitted by local precision guards. */
export function compileDomainNativeGlslNode(tree:MathNode,parameters:readonly string[]):string{
 compileDomainNativeNode(tree,new Set(parameters),'gpu');
 function emit(node:MathNode):string{
  const n=nodeData(node);
  if(n.type==='ConstantNode'){
   const value=Number(n.value);
   return `vec2(${formatDomainNativeGlslFloat(value)},0.0)`;
  }
  if(n.type==='SymbolNode'){
   const name=n.name!;
   if(name==='i')return 'vec2(0.0,1.0)';
   if(name==='pi')return 'vec2(3.14159265359,0.0)';
   if(name==='e')return 'vec2(2.71828182846,0.0)';
   if(name==='z'||name==='w'||name==='c')return name;
   const index=parameters.indexOf(name);return index<0?'vec2(0.0)':`vec2(parameter${index},0.0)`;
  }
  if(n.type==='ParenthesisNode')return `(${emit(n.content!)})`;
  if(n.type==='OperatorNode'){
   const args=n.args!.map(emit),name=n.fn as string;
   if(name==='unaryPlus')return args[0];
   if(name==='unaryMinus')return `(-${args[0]})`;
   return `${binaryGlsl[name]}(${args.join(',')})`;
  }
  if(n.type==='FunctionNode'){
   const name=(n.fn as {name:string}).name;
   return `c_${name==='ln'?'log':name}(${n.args!.map(emit).join(',')})`;
  }
  throw new Error('原版 Domain GLSL 不支持 '+n.type);
 }
 return emit(tree);
}

/** Shipped native helper bodies, with no stable-math substitutions or repair
 * instrumentation. The two finite predicates and false flag are adapter facts
 * only; color repair must consume the actual GPU result, never rerun this orbit
 * with local CPU arithmetic. GLSL ES 3.00 supplies the same function vocabulary;
 * driver precision/undefined domains remain explicit compatibility boundaries. */
export const domainNativeGlslPrelude=`
bool complexRepair=false;
bool cFinite(float v){return (floatBitsToUint(v)&0x7f800000u)!=0x7f800000u;}
bool cFinite2(vec2 v){return cFinite(v.x)&&cFinite(v.y);}
vec2 c_mul(vec2 a, vec2 b) {
    return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

vec2 c_div(vec2 a, vec2 b) {
    float d = dot(b, b) + 1e-18;
    return vec2((a.x * b.x + a.y * b.y) / d, (a.y * b.x - a.x * b.y) / d);
}

vec2 c_add(vec2 a, vec2 b) { return a + b; }
vec2 c_sub(vec2 a, vec2 b) { return a - b; }

vec2 c_exp(vec2 z) {
    float ex = exp(z.x);
    return vec2(ex * cos(z.y), ex * sin(z.y));
}

vec2 c_log(vec2 z) {
    return vec2(log(length(z) + 1e-18), atan(z.y, z.x));
}

vec2 c_pow(vec2 z, vec2 w) {
    return c_exp(c_mul(c_log(z), w));
}

vec2 c_sin(vec2 z) {
    return vec2(sin(z.x) * cosh(z.y), cos(z.x) * sinh(z.y));
}

vec2 c_cos(vec2 z) {
    return vec2(cos(z.x) * cosh(z.y), -sin(z.x) * sinh(z.y));
}

vec2 c_tan(vec2 z) {
    return c_div(c_sin(z), c_cos(z));
}

vec2 c_sinh(vec2 z) {
    return vec2(sinh(z.x) * cos(z.y), cosh(z.x) * sin(z.y));
}

vec2 c_cosh(vec2 z) {
    return vec2(cosh(z.x) * cos(z.y), sinh(z.x) * sin(z.y));
}

vec2 c_tanh(vec2 z) {
    return c_div(c_sinh(z), c_cosh(z));
}

vec2 c_sqrt(vec2 z) {
    float r = length(z);
    float theta = atan(z.y, z.x) * 0.5;
    return sqrt(r) * vec2(cos(theta), sin(theta));
}

vec2 c_asin(vec2 z) {
    vec2 iz = c_mul(vec2(0.0, 1.0), z);
    vec2 oneMinusZSquared = c_sub(vec2(1.0, 0.0), c_mul(z, z));
    vec2 root = c_sqrt(oneMinusZSquared);
    return c_mul(vec2(0.0, -1.0), c_log(c_add(iz, root)));
}

vec2 c_acos(vec2 z) {
    return c_sub(vec2(1.57079632679, 0.0), c_asin(z));
}

vec2 c_atan(vec2 z) {
    vec2 iz = c_mul(vec2(0.0, 1.0), z);
    vec2 logMinus = c_log(c_sub(vec2(1.0, 0.0), iz));
    vec2 logPlus = c_log(c_add(vec2(1.0, 0.0), iz));
    return c_mul(vec2(0.0, 0.5), c_sub(logMinus, logPlus));
}

vec2 c_acot(vec2 z) {
    return c_atan(c_div(vec2(1.0, 0.0), z));
}

vec2 c_asec(vec2 z) {
    return c_acos(c_div(vec2(1.0, 0.0), z));
}

vec2 c_acsc(vec2 z) {
    return c_asin(c_div(vec2(1.0, 0.0), z));
}

vec2 c_arccsc(vec2 z) {
    return c_acsc(z);
}

vec2 c_asinh(vec2 z) {
    return c_log(c_add(z, c_sqrt(c_add(c_mul(z, z), vec2(1.0, 0.0)))));
}

vec2 c_acosh(vec2 z) {
    vec2 zPlusOne = c_add(z, vec2(1.0, 0.0));
    vec2 zMinusOne = c_sub(z, vec2(1.0, 0.0));
    return c_log(c_add(z, c_mul(c_sqrt(zPlusOne), c_sqrt(zMinusOne))));
}

vec2 c_atanh(vec2 z) {
    vec2 onePlusZ = c_add(vec2(1.0, 0.0), z);
    vec2 oneMinusZ = c_sub(vec2(1.0, 0.0), z);
    return c_mul(vec2(0.5, 0.0), c_sub(c_log(onePlusZ), c_log(oneMinusZ)));
}

vec2 c_acoth(vec2 z) {
    return c_atanh(c_div(vec2(1.0, 0.0), z));
}

vec2 c_arsech(vec2 z) {
    return c_acosh(c_div(vec2(1.0, 0.0), z));
}

vec2 c_conj(vec2 z) { return vec2(z.x, -z.y); }
vec2 c_inv(vec2 z) { return c_div(vec2(1.0, 0.0), z); }
vec2 c_abs(vec2 z) { return vec2(length(z), 0.0); }
vec2 c_arg(vec2 z) { return vec2(atan(z.y, z.x), 0.0); }
vec2 c_re(vec2 z) { return vec2(z.x, 0.0); }
vec2 c_im(vec2 z) { return vec2(z.y, 0.0); }

`;
