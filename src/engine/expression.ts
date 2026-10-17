import { parse, type MathNode } from "mathjs";
import {canonicalRealFunctionName,realFunctionAliasNames} from './realFunctionAliases';
const functions: Record<string, (...args: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  log: Math.log,
  ln: Math.log,
  log10: Math.log10,
  sqrt: Math.sqrt,
  abs: Math.abs,
  sign: Math.sign,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  mod: (x, y) => ((x % y) + y) % y,
  clamp: (x, a, b) => Math.max(a, Math.min(b, x)),
  mix: (a, b, t) => a + (b - a) * t,
  fract: (x) => x - Math.floor(x),
  step: (edge, x) => (x < edge ? 0 : 1),
};
export type Scope = Record<string, number>;
const realConstants:Scope={pi:Math.PI,PI:Math.PI,TWO_PI:2*Math.PI,HALF_PI:Math.PI/2,e:Math.E};
export const realFunctionNames=Object.freeze([...Object.keys(functions),...realFunctionAliasNames]);
export const realConstantNames=Object.freeze(Object.keys(realConstants));
/** Parameter names must not shadow the coordinates supplied by the scene evaluator.
 * Constants such as e remain valid parameters because shipped presets use them. */
function validateParameterName(name: string, kind: string | undefined, existing: boolean): string | undefined {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) return '参数名需要以字母开头，只包含字母、数字和下划线';
  const coordinates = kind === 'domain' ? ['z','w','c','time'] : kind === 'roots' ? ['z','t1','t2','time'] : kind === 'surface' ? ['u','v','t','time'] : kind === 'map' ? ['x','y','z','nx','ny','nz','x_next','y_next','z_next','t','time'] : ['x','y','z','t','time'];
  const canonical=canonicalRealFunctionName(name);
  if ([...coordinates,'__proto__','prototype','constructor'].includes(name) || Object.hasOwn(functions,canonical)&&(!existing||canonical===name)) return `“${name}”是当前场景的坐标、时间或函数保留名`;
}
/** New parameters cannot shadow advertised function names. */
export function parameterNameError(name: string, kind?: string): string | undefined {return validateParameterName(name,kind,false);}
/** Newly added call aliases must not invalidate previously valid saved symbols.
 * The earlier canonical-function and coordinate restrictions remain unchanged. */
export function existingParameterNameError(name: string, kind?: string): string | undefined {return validateParameterName(name,kind,true);}
type Evaluate = (scope: Scope) => number;
export type RealEvaluator=Evaluate&{readonly symbols:readonly string[]};
/** Trusted structure produced by the same restricted compiler as evaluation.
 * Symbol lookup is owned here, including caller scope precedence over constants. */
export type RealExpressionFacts =
  | {readonly kind:'constant';readonly value:number}
  | {readonly kind:'symbol';readonly name:string;readonly resolve:RealEvaluator}
  | {readonly kind:'call'|'operator';readonly name:string;readonly args:readonly RealExpressionFacts[]}
  | {readonly kind:'conditional';readonly args:readonly RealExpressionFacts[]};
export function compileReal(source:string,symbols?:readonly string[]):RealEvaluator {return compileOwnedReal(source,symbols,false).evaluate;}
export function compileRealWithFacts(source:string,symbols?:readonly string[]):{evaluate:RealEvaluator;facts:RealExpressionFacts} {const compiled=compileOwnedReal(source,symbols,true);return{evaluate:compiled.evaluate,facts:compiled.facts!};}
// Parse expressions once into a restricted arithmetic evaluator. No JS evaluation,
// assignments, object access or ambient function calls are accepted.
function compileOwnedReal(source:string,symbols:readonly string[]|undefined,includeFacts:boolean):{evaluate:RealEvaluator;facts?:RealExpressionFacts} {
  const allowed=symbols?new Set(symbols):undefined;
  const referenced=new Set<string>();
  const facts=includeFacts?new WeakMap<Evaluate,RealExpressionFacts>():undefined;
  const owned=(evaluate:Evaluate,describe:()=>RealExpressionFacts)=>{if(facts)facts.set(evaluate,Object.freeze(describe()));return evaluate;};
  const parts=(evaluators:Evaluate[])=>Object.freeze(evaluators.map(evaluate=>facts!.get(evaluate)!));
  if (source.length > 8192) throw new Error("公式超过 8192 字符");
  let count = 0;
  function compile(n: MathNode): Evaluate {
    if (++count > 512) throw new Error("公式过于复杂（超过 512 个节点）");
    const a = n as unknown as Record<string, any>;
    if (n.type === "ConstantNode") {
      const v = Number(a.value);
      return owned(()=>v,()=>({kind:'constant',value:v}));
    }
    if (n.type === "SymbolNode") {
      const k = String(a.name);
      referenced.add(k);
      if(allowed&&!allowed.has(k)&&!Object.hasOwn(realConstants,k))throw new Error(`未知变量 ${k}`);
      const lookup:Evaluate=(s) => {
        if (Object.hasOwn(s, k)) return s[k];
        if (Object.hasOwn(realConstants, k)) return realConstants[k];
        throw new Error(`未知变量 ${k}`);
      };
      return owned(lookup,()=>({kind:'symbol',name:k,resolve:Object.assign(lookup,{symbols:Object.freeze([k])})}));
    }
    if (n.type === "ParenthesisNode") return compile(a.content);
    if (n.type === "ConditionalNode") {
      const c = compile(a.condition),
        y = compile(a.trueExpr),
        z = compile(a.falseExpr);
      return owned(s=>c(s)?y(s):z(s),()=>({kind:'conditional',args:parts([c,y,z])}));
    }
    if (n.type === "FunctionNode") {
      const name=canonicalRealFunctionName(a.fn.name),f = Object.hasOwn(functions,name)?functions[name]:undefined;
      if (!f) throw new Error(`不支持函数 ${a.fn.name}`);
      const v = a.args.map(compile);
      return owned(s=>f(...v.map((g:Evaluate)=>g(s))),()=>({kind:'call',name,args:parts(v)}));
    }
    if (n.type === "OperatorNode") {
      const v: Evaluate[] = a.args.map(compile);
      const [x, y] = v;
      const operation=(():Evaluate=>{switch (a.fn) {
        case "add":
          return (s) => x(s) + y(s);
        case "subtract":
          return (s) => x(s) - y(s);
        case "multiply":
          return (s) => x(s) * y(s);
        case "divide":
          return (s) => x(s) / y(s);
        case "pow":
          return (s) => x(s) ** y(s);
        case "unaryMinus":
          return (s) => -x(s);
        case "unaryPlus":
          return x;
        case "mod":
          return (s) => x(s) % y(s);
        case "smaller":
          return (s) => Number(x(s) < y(s));
        case "larger":
          return (s) => Number(x(s) > y(s));
        case "smallerEq":
          return (s) => Number(x(s) <= y(s));
        case "largerEq":
          return (s) => Number(x(s) >= y(s));
        case "equal":
          return (s) => Number(x(s) === y(s));
        case "unequal":
          return (s) => Number(x(s) !== y(s));
        case "and":
          return (s) => Number(!!x(s) && !!y(s));
        case "or":
          return (s) => Number(!!x(s) || !!y(s));
        default:
          throw new Error(`不支持运算 ${a.op}`);
      }})();
      return owned(operation,()=>({kind:'operator',name:a.fn,args:parts(v)}));
    }
    throw new Error(`不支持表达式类型 ${n.type}`);
  }
  const evaluate=compile(parse(source.replaceAll("π", "pi")));
  return{evaluate:Object.assign(evaluate,{symbols:Object.freeze([...referenced])}),...(facts?{facts:facts.get(evaluate)!}:{})};
}
export function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} 必须是有限数值`);
  return value;
}
export function numberSetting(
  settings: Record<string, unknown>,
  key: string,
  fallback: number,
  min = -Infinity,
  max = Infinity,
): number {
  const v = Number(settings[key] ?? fallback);
  if (!Number.isFinite(v) || v < min || v > max)
    throw new Error(`${key} 必须在 ${min} ~ ${max} 之间`);
  return v;
}
export function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
