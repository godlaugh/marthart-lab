import {parseSourceRealExpression,DOMAIN_SOURCE_SCALAR_LIMITS,type SourceRealExpressionNode} from './domainSourceScalar';
import {prepareRootsSourceMemberOrder} from './rootsSourceOrder';
import {emitSourceRealGlsl,isSourceGlslIdentifier,sourceGpuRoundTripLiteral,SourceRealGpuEmissionError,SOURCE_REAL_GPU_EMISSION_LIMITS} from './sourceRealGpuExpression';

export type SourceAttractorGpuFunctionError={kind:'input'|'capacity'|'unsupported';path:readonly string[];reason:string};
export type SourceAttractorGpuFunctionResult<T>={ok:true;value:T}|{ok:false;error:SourceAttractorGpuFunctionError};
export interface SourceAttractorGpuFunction {
 /** Native globals plus calculate_derivative; no Surface preamble/uniform ABI.
  * Integral literals reproduce native long narrowing. Other literals retain
  * the double round-trip value; exact Java Double.toString text is unproven. */
 readonly code:string;
 readonly parameterNames:readonly string[];
 /** Parsed AST nodes, including arguments which native GLSL subsequently ignores.
  * Admission metadata, not a count of compiled GPU instructions or RK4 calls. */
 readonly operations:number;
}
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
// Global declarations in the retained attractor_update.frag and its injected
// function. Local x/y/z deliberately do NOT appear here: they shadow globals.
const shaderGlobals=new Set('posTex steps isWarmup warmupBase staggerMin staggerRange currentStepBase texCoord newPos calculate_derivative rand rk4'.split(' '));
function nodes(root:SourceRealExpressionNode):number {
 let count=0;const pending=[root];while(pending.length){const node=pending.pop()!;count++;if(node.kind==='unary')pending.push(node.argument);else if(node.kind==='binary')pending.push(node.left,node.right);else if(node.kind==='call')pending.push(...node.args);}return count;
}
/** JsonAttractorConfig.parseConfig PC909-955 builds a second HashMap from
 * JSONObject iteration; getGLSLFunction PC34-289 emits its globals, then the
 * FastExpression trees. This prepares source-derived shader text; compilation
 * belongs to the GPU context owner and never falls back to another formula. */
export function prepareSourceAttractorGpuFunction(input:unknown):SourceAttractorGpuFunctionResult<SourceAttractorGpuFunction>{
 const bad=(kind:SourceAttractorGpuFunctionError['kind'],path:readonly string[],reason:string):SourceAttractorGpuFunctionResult<never>=>({ok:false,error:{kind,path,reason}});
 if(!object(input)||!object(input.equations)||!object(input.parameters))return bad('input',[],'原版 GPU 吸引子需要公式和参数对象');
 const keys=Object.keys(input.parameters);
 if(keys.reduce((sum,key)=>sum+key.length,3)>DOMAIN_SOURCE_SCALAR_LIMITS.characters)return bad('capacity',['parameters'],'GPU 吸引子参数名超过本地表达式文本容量');
 if(keys.length>8191)return bad('capacity',['parameters'],'GPU 吸引子参数超过本地表达式变量容量');
 const first=prepareRootsSourceMemberOrder(keys);if(!first.ok)return bad(first.error.kind==='capacity'?'capacity':'input',['parameters'],JSON.stringify(first.error));
 const second=prepareRootsSourceMemberOrder(first.value.keys);if(!second.ok)return bad(second.error.kind==='capacity'?'capacity':'input',['parameters'],JSON.stringify(second.error));
 const parameterNames=second.value.keys,declared=new Set(parameterNames),declarations:string[]=[];
 let path:readonly string[]=['parameters'];
 try{
  for(const name of parameterNames){
   path=['parameters',name];
   if(!isSourceGlslIdentifier(name)||shaderGlobals.has(name))return bad('unsupported',path,'参数名与原版 GPU 着色器或 GLSL 标识符冲突');
   const value=input.parameters[name];
   if(typeof value!=='number'||!Number.isFinite(value))return bad('input',path,'GPU 吸引子参数需要有限 double 数值');
   declarations.push(`float ${name} = ${sourceGpuRoundTripLiteral(value)};\n`);
  }
  // Parameter values are global constants in GLSL. The wrapper's coordinates
  // are local floats and therefore win, unlike GenericDifferentialEquation.
  const names=[...parameterNames,'x','y','z'];let operations=0;
  const expressions:string[]=[];
  for(const axis of ['dx','dy','dz']){
   path=['equations',axis];
   const parsed=parseSourceRealExpression(input.equations[axis],names);
   if(!parsed.ok)return bad(parsed.error.kind,path,JSON.stringify(parsed.error));
   operations+=nodes(parsed.value);
   expressions.push(emitSourceRealGlsl(parsed.value,names,{variable(name){
    if(name==='pos_arg'||name==='dp')throw new SourceRealGpuEmissionError('unsupported','参数引用被原版函数的 vec3 局部参数遮蔽，不能作为标量 GLSL 公式');
    return name;
   },namedConstant(name){
    if(!declared.has(name))throw new SourceRealGpuEmissionError('unsupported',`原版 GPU 吸引子函数未声明常量 ${name}`);
    return name;
   }}));
  }
  const code=declarations.join('')+'void calculate_derivative(vec3 pos_arg, out vec3 dp) {\n  float x = pos_arg.x;\n  float y = pos_arg.y;\n  float z = pos_arg.z;\n'+expressions.map((expression,i)=>`  dp.${'xyz'[i]} = ${expression};\n`).join('')+'}\n';
  if(code.length>SOURCE_REAL_GPU_EMISSION_LIMITS.characters)return bad('capacity',[],'GPU 吸引子函数文本超过本地着色器容量');
  return{ok:true,value:Object.freeze({code,operations,parameterNames})};
 }catch(error){if(error instanceof SourceRealGpuEmissionError)return bad(error.kind,path,error.message);throw error;}
}
