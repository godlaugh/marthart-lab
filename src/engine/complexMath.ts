import {parse,type MathNode} from 'mathjs';
export type Complex = [number, number];
export type ComplexScope = Record<string, Complex | number>;
export type ComplexFn = (scope: ComplexScope) => Complex;
const add = (a: Complex, b: Complex): Complex => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Complex, b: Complex): Complex => [a[0] - b[0], a[1] - b[1]];
const mul = (a: Complex, b: Complex): Complex => [a[0]*b[0]-a[1]*b[1], a[0]*b[1]+a[1]*b[0]];
const scale = (a: Complex, k: number): Complex => [a[0]*k, a[1]*k];
const abs = (a: Complex): number => Math.hypot(a[0],a[1]);
const finite = (a: Complex): boolean => Number.isFinite(a[0]) && Number.isFinite(a[1]);
function div(a: Complex,b: Complex): Complex {
  // Smith division avoids squaring a very large denominator.
  if (b[0]===0 && b[1]===0) return [NaN,NaN];
  if(Math.abs(b[0])>=Math.abs(b[1])) {const r=b[1]/b[0],d=b[0]+b[1]*r;return [(a[0]+a[1]*r)/d,(a[1]-a[0]*r)/d];}
  const r=b[0]/b[1],d=b[1]+b[0]*r;return [(a[0]*r+a[1])/d,(a[1]*r-a[0])/d];
}
const exp = (z: Complex): Complex => scale([Math.cos(z[1]),Math.sin(z[1])],Math.exp(z[0]));
const log = (z: Complex): Complex => [Math.log(abs(z)),Math.atan2(z[1],z[0])];
export function complexPower(z: Complex, p: Complex): Complex {
  if(p[1]===0 && Number.isInteger(p[0]) && Math.abs(p[0])<=128) {
    let n=Math.abs(p[0]),a:Complex=[1,0],b=z;
    while(n>0){if(n%2===1)a=mul(a,b);b=mul(b,b);n=Math.floor(n/2);}
    return p[0]<0?div([1,0],a):a;
  }
  if(z[0]===0&&z[1]===0) return p[1]===0&&p[0]>0?[0,0]:[NaN,NaN];
  return exp(mul(p,log(z)));
}
const sqrt = (z:Complex):Complex => {
  const r=abs(z);
  return [Math.sqrt(Math.max(0,(r+z[0])/2)),(z[1]<0?-1:1)*Math.sqrt(Math.max(0,(r-z[0])/2))];
};
const sin=(z:Complex):Complex=>[Math.sin(z[0])*Math.cosh(z[1]),Math.cos(z[0])*Math.sinh(z[1])];
const cos=(z:Complex):Complex=>[Math.cos(z[0])*Math.cosh(z[1]),-Math.sin(z[0])*Math.sinh(z[1])];
const sinh=(z:Complex):Complex=>[Math.sinh(z[0])*Math.cos(z[1]),Math.cosh(z[0])*Math.sin(z[1])];
const cosh=(z:Complex):Complex=>[Math.cosh(z[0])*Math.cos(z[1]),Math.sinh(z[0])*Math.sin(z[1])];
const asin=(z:Complex):Complex=>mul([0,-1],log(add(mul([0,1],z),sqrt(sub([1,0],mul(z,z))))));
const acos=(z:Complex):Complex=>sub([Math.PI/2,0],asin(z));
const atan=(z:Complex):Complex=>mul([0,.5],sub(log(sub([1,0],mul([0,1],z))),log(add([1,0],mul([0,1],z)))));
const asinh=(z:Complex):Complex=>log(add(z,sqrt(add(mul(z,z),[1,0]))));
const acosh=(z:Complex):Complex=>log(add(z,mul(sqrt(add(z,[1,0])),sqrt(sub(z,[1,0])))));
const atanh=(z:Complex):Complex=>scale(sub(log(add([1,0],z)),log(sub([1,0],z))),.5);
const unary:Record<string,(z:Complex)=>Complex>={
 sin,cos,tan:z=>div(sin(z),cos(z)),sinh,cosh,tanh:z=>div(sinh(z),cosh(z)),
 asin,acos,atan,arcsin:asin,arccos:acos,arctan:atan,
 acot:z=>atan(div([1,0],z)),asec:z=>acos(div([1,0],z)),acsc:z=>asin(div([1,0],z)),
 asinh,acosh,atanh,acoth:z=>atanh(div([1,0],z)),arsech:z=>acosh(div([1,0],z)),
 exp,log,ln:log,sqrt,abs:z=>[abs(z),0],arg:z=>[Math.atan2(z[1],z[0]),0],
 conj:z=>[z[0],-z[1]],re:z=>[z[0],0],im:z=>[z[1],0],
};
export const complexFunctionNames=Object.freeze([...Object.keys(unary),'pow']);
export const complexConstantNames=Object.freeze(['i','pi','PI','e']);
interface NodeData {type:string;value?:number;name?:string;content?:MathNode;args?:MathNode[];fn?:string|{name:string};}
function nodeData(n:MathNode):NodeData {return n as unknown as NodeData;}
function parsed(source:string):MathNode {
 if(source.length>8192)throw new Error('复数公式超过 8192 字符');
 const n=parse(source.replaceAll('π','pi'));let count=0;
 n.traverse(()=>{if(++count>512)throw new Error('复数公式超过 512 个节点');});
 return n;
}
function compileNode(node:MathNode,allowed?:Set<string>):ComplexFn {
 const n=nodeData(node);
 if(n.type==='ConstantNode'){const v=Number(n.value);if(!Number.isFinite(v))throw new Error('常量必须有限');return()=>[v,0];}
 if(n.type==='SymbolNode'){
  const name=n.name!;
  if(name==='i')return()=>[0,1];
  if(name==='pi'||name==='PI')return()=>[Math.PI,0];
  if(name==='e')return scope=>{const v=Object.hasOwn(scope,'e')?scope.e:Math.E;return typeof v==='number'?[v,0]:v;};
  if(allowed&&!allowed.has(name))throw new Error('未知变量 '+name);
  return scope=>{if(!Object.hasOwn(scope,name))throw new Error('未知变量 '+name);const v=scope[name];return typeof v==='number'?[v,0]:v;};
 }
 if(n.type==='ParenthesisNode')return compileNode(n.content!,allowed);
 if(n.type==='OperatorNode'){
  const args=n.args!.map(a=>compileNode(a,allowed)),[a,b]=args;
  switch(n.fn){
   case 'add':return s=>add(a(s),b(s));case 'subtract':return s=>sub(a(s),b(s));
   case 'multiply':return s=>mul(a(s),b(s));case 'divide':return s=>div(a(s),b(s));
   case 'pow':return s=>complexPower(a(s),b(s));case 'unaryMinus':return s=>scale(a(s),-1);
   case 'unaryPlus':return a;
  }
  throw new Error('复数公式不支持此运算');
 }
 if(n.type==='FunctionNode'){
  const name=typeof n.fn==='object'?n.fn.name:'';
  if(name==='pow'&&n.args?.length===2){const a=compileNode(n.args[0],allowed),b=compileNode(n.args[1],allowed);return s=>complexPower(a(s),b(s));}
  if(!Object.hasOwn(unary,name)||n.args?.length!==1)throw new Error('不支持复函数或参数数量：'+name);
  const a=compileNode(n.args[0],allowed),f=unary[name];return s=>f(a(s));
 }
 throw new Error('复数公式不支持 '+n.type);
}
/** Arithmetic AST only; no assignments, property access, or ambient code execution. */
export function compileComplex(source:string, symbols?:string[]):ComplexFn {
 return compileNode(parsed(source),symbols?new Set(symbols):undefined);
}

export {add,sub,mul,scale,abs,finite,div,sin,nodeData,parsed,compileNode};
