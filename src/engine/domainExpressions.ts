import {compileNode,parsed,type ComplexFn} from './complexMath';
import {compileComplexGlslNode,complexGlslPrelude} from './complexGlsl';
import type {MathNode} from 'mathjs';
import {compileDomainNativeNode,compileDomainNativeGlslNode,domainNativeGlslPrelude} from './domainNativeArithmetic';
import {parseDomainNativeExpression,NativeExpressionSyntaxError,NativeExpressionCapacityError} from './domainNativeParser';
import {parseDomainIterationVersion,normalizeDomainNativeNext,type DomainIterationVersion} from './domainSourceIteration';

export const MAX_DOMAIN_EXPRESSIONS=8;
export interface DomainExpressionInput {formula:string;next?:string;parameters:Readonly<Record<string,number>>;iterationVersion?:DomainIterationVersion;nextEnabled?:boolean;}
export interface DomainGpuSource {
 readonly source:string;readonly fragmentLibrary:string;readonly parameters:readonly string[];readonly key:string;
 /** Already lowered by the parsed-expression owner; native drawing must not parse again. */
 readonly formulaSource:string;readonly iterationSource?:string;
 /** Preserve parameterN slots while omitting unreferenced authored values from native uploads. */
 readonly referencedParameterIndices:readonly number[];
}
export interface DomainExpressions {readonly f:ComplexFn;readonly next?:ComplexFn;readonly parameterNames:readonly string[];readonly nodeCost:number;readonly referencesConstant:boolean;readonly warnings:readonly string[];readonly effectiveFormula:string;readonly effectiveNext?:string;readonly nativeGpuFailure?:string;gpuSource():DomainGpuSource;}

/** One worker-local owner for parsed Domain structures. Values, time, camera,
 * palette and iteration uniforms never enter this key or captured evaluators.
 * Rejected GPU structures retain the successful CPU evaluator and the reason. */
export class DomainExpressionCache {
 private entries=new Map<string,DomainExpressions>();
 private parses=0;private sourceBuilds=0;private hits=0;
 diagnostics(){return{entries:this.entries.size,parses:this.parses,sourceBuilds:this.sourceBuilds,hits:this.hits};}
 clear(){this.entries.clear();this.parses=0;this.sourceBuilds=0;this.hits=0;}
 get(input:DomainExpressionInput):DomainExpressions{
  const version=parseDomainIterationVersion(input.iterationVersion),native=version==='mathart-1.7.8-cpu'||version==='mathart-1.7.8-gpu',nextEnabled=input.nextEnabled!==false;
  const parameters=Object.freeze(Object.keys(input.parameters).sort()),key=JSON.stringify([input.formula,input.next??null,parameters,version,nextEnabled]);
  const cached=this.entries.get(key);if(cached){this.hits++;this.entries.delete(key);this.entries.set(key,cached);return cached;}
  const allowed=new Set([...parameters,'z','w','c']);
  const parse=(source:string)=>{this.parses++;return native?parseDomainNativeExpression(source):parsed(source);};
  if(native&&input.next!==undefined&&input.next.length>8192)throw new NativeExpressionCapacityError('复数公式超过 8192 字符');
  // DomainIterationParams uses Java String.trim (code units <= U+0020).
  // MathJS/local document semantics intentionally keep their old caller path.
  const candidateNext=native?normalizeDomainNativeNext(input.next):input.next;
  const warnings:string[]=[];let effectiveFormula=input.formula,effectiveNext=candidateNext,tree:MathNode,nextTree:MathNode|undefined;
  try{tree=parse(input.formula);}catch(error){if(!native||!(error instanceof NativeExpressionSyntaxError))throw error;effectiveFormula='z^3 - 1';tree=parse(effectiveFormula);warnings.push('原产物公式无法解析，保留原文并使用 z^3 - 1：'+error.message);}
  if(candidateNext)try{nextTree=parse(candidateNext);}catch(error){if(!native||!(error instanceof NativeExpressionSyntaxError))throw error;effectiveNext=undefined;warnings.push('原产物迭代公式无法解析，保留原文并使用主公式：'+error.message);}
  const stage=version==='mathart-1.7.8-gpu'?'gpu':'cpu';
  const compile=(node:MathNode)=>native?compileDomainNativeNode(node,allowed,stage):compileNode(node,allowed);
  const f=compile(tree),next=nextEnabled&&nextTree?compile(nextTree):undefined;
  let nodeCost=0,referencesConstant=false;const referencedParameters=new Set<string>();
  const collect=(n:MathNode)=>{nodeCost++;if(n.type==='SymbolNode'){const name=(n as unknown as {name:string}).name;if(name==='c')referencesConstant=true;else if(!['z','w','i','pi','e'].includes(name))referencedParameters.add(name);}};
  tree.traverse(collect);if(nextEnabled)nextTree?.traverse(collect);
  let nativeGpuFailure:string|undefined;
  if(native){
   tree.traverse(n=>{if(n.type==='SymbolNode'&&(n as unknown as {name:string}).name==='w')nativeGpuFailure='原产物 GPU 主公式的 w 未声明；按原产物规则使用 CPU 公式执行';});
   const checkLiteral=(n:MathNode)=>{if(n.type==='ConstantNode'&&!Number.isFinite(Number((n as unknown as {value:unknown}).value)))nativeGpuFailure='原产物 GPU 公式包含不能编译的非有限常量；使用 CPU 公式执行';};
   tree.traverse(checkLiteral);if(nextEnabled)nextTree?.traverse(checkLiteral);
  }
  let gpu:DomainGpuSource|undefined,gpuError:unknown,gpuAttempted=false;
  const value:DomainExpressions=Object.freeze({f,next,parameterNames:parameters,nodeCost,referencesConstant,warnings:Object.freeze(warnings),effectiveFormula,effectiveNext,nativeGpuFailure,gpuSource:()=>{
   if(gpuAttempted){if(gpu)return gpu;throw gpuError;}
   gpuAttempted=true;this.sourceBuilds++;
   try{if(version==='mathart-1.7.8-cpu')throw new Error('原产物 CPU 公式执行规则不能由 float32 shader 替代');
    if(nativeGpuFailure&&native)throw new Error(nativeGpuFailure);
    const lower=native?compileDomainNativeGlslNode:compileComplexGlslNode;
    gpu=buildSource(parameters,lower(tree,parameters),nextEnabled&&nextTree?lower(nextTree,parameters):undefined,native,Object.freeze(parameters.flatMap((name,index)=>referencedParameters.has(name)?[index]:[])));return gpu;}catch(error){gpuError=error;throw error;}
  }});
  this.entries.set(key,value);if(this.entries.size>MAX_DOMAIN_EXPRESSIONS)this.entries.delete(this.entries.keys().next().value!);
  return value;
 }
}
export const domainExpressions=new DomainExpressionCache();
function buildSource(parameters:readonly string[],f:string,next:string|undefined,native:boolean,referencedParameterIndices:readonly number[]):DomainGpuSource{
 const uniforms=`uniform vec2 constantValue;uniform int iterate,iterationSteps,seedMode;uniform float bailout;
${parameters.map((_,i)=>`uniform float parameter${i};`).join('\n')}`;
 const functions=`${native?domainNativeGlslPrelude:complexGlslPrelude}
vec2 evaluateF(vec2 z,vec2 w,vec2 c){return ${f};}
${next?`vec2 evaluateNext(vec2 z,vec2 w,vec2 c){return ${next};}`:''}`;
 // Both execution stages consume one AST-lowered orbit body. The compatibility
 // transform-feedback source retains its previous arithmetic order verbatim.
 const body=native?`complexRepair=false;vec2 z=pixel,w=seedMode==0?pixel:seedMode==1?vec2(0.):constantValue,c=seedMode==0?constantValue:pixel,value;
 float escapeRadiusSq=bailout*bailout;
 for(int j=0;j<256;j++){if(j>=iterationSteps)break;${next?'w=evaluateNext(pixel,w,c);':'w=evaluateF(w,w,constantValue);'}float magSq=dot(w,w);if(!(magSq<=escapeRadiusSq))break;}
 value=w;`:`complexRepair=false;vec2 z=pixel,w=vec2(0.),c=constantValue,value;
 if(iterate==0)value=evaluateF(z,w,c);
 else{w=seedMode==0?pixel:seedMode==1?vec2(0.):constantValue;c=seedMode==0?constantValue:pixel;
  for(int j=0;j<64;j++){if(j>=iterationSteps)break;${next?'w=evaluateNext(pixel,w,c);':'w=evaluateF(w,w,constantValue);'}float magnitude=cMagnitude(w);if(abs(magnitude-bailout)<=max(1.,bailout)*4e-6)complexRepair=true;if(!cFinite2(w)||magnitude>bailout)break;}
  value=w;
 }`;
 const source=`#version 300 es
precision highp float;precision highp int;
layout(location=0)in vec2 pixel;
${uniforms}
out vec4 result;
${functions}
void main(){${body}
 result=vec4(value,complexRepair?1.:0.,0.);gl_Position=vec4(0.);
}`;
 const fragmentLibrary=`${uniforms}\n${functions}\nvec2 domainEvaluate(vec2 pixel){${body}return value;}`;
 return Object.freeze({source,fragmentLibrary,parameters,key:source,formulaSource:f,iterationSource:next,referencedParameterIndices});
}
