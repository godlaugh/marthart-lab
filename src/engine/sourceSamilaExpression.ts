import {parseSourceRealExpression,prepareSourceRealExpressionAst,sourceRealFunctionNames} from './domainSourceScalar';
import {emitSourceRealGlsl,isSourceGlslIdentifier,SourceRealGpuEmissionError} from './sourceRealGpuExpression';
import {sourceSamilaUniform} from './sourceSamilaMath';
export {sourceRealFunctionNames as sourceSamilaFunctionNames};
export const SOURCE_SAMILA_EXPRESSION_VARIABLES=Object.freeze(['x','y','a','b','c','d']);
const shaderGlobals=new Set('PI QUAD_CORNERS u_rangeStart u_rangeStop u_frameSeed u_generateMode u_projection scale offset u_rotation radius u_quadSplat u_viewportSize u_aspectRatio noiseFrequency noiseAmplitude noiseLUT noiseLutScale useNoiseLUT u_particleCount vTexCoord vValidFlag vLocalRadius vNdcCoord vQuadLocal vPointDiameter vPaletteU applyGenerateMode applyProjection pcgHash randFloat mod289_vs permute_vs snoise main samila_f1 samila_f2'.split(' '));
/** This wrapper owns SamilaExpressionCompiler's symbol ABI. The generic source
 * parser and emitter own arithmetic; neither local mathjs compiler is used. */
export function prepareSourceSamilaExpressions(equations:{f1:string;f2:string},parameterNames:readonly string[]){
 const keys=[...parameterNames].sort(),names=[...SOURCE_SAMILA_EXPRESSION_VARIABLES,...keys.filter(k=>!SOURCE_SAMILA_EXPRESSION_VARIABLES.includes(k))];
 for(const key of keys)if(!isSourceGlslIdentifier(key)||shaderGlobals.has(key))throw Error(`源 Samila 参数 ${key} 与着色器标识符冲突`);
 const expressions=[equations.f1,equations.f2].map((source,i)=>{
  const ast=parseSourceRealExpression(source,names);
  if(!ast.ok)throw Error(`源 Samila f${i+1} 公式无效：${JSON.stringify(ast.error)}`);
  const cpu=prepareSourceRealExpressionAst(ast.value,names);
  if(!cpu.ok)throw Error(`源 Samila f${i+1} 公式无效：${JSON.stringify(cpu.error)}`);
  const glsl=emitSourceRealGlsl(ast.value,names,{variable(name){if(name==='x'||name==='y')return `samplePosition.${name}`;return `sourceSamilaParameter${names.indexOf(name)-2}`;},namedConstant(name){throw new SourceRealGpuEmissionError('unsupported',`源 Samila 原模板不支持此处的命名常量 ${name}（未声明或声明晚于公式）`);}});
  return{cpu:cpu.value,glsl};
 });
 return Object.freeze({names:Object.freeze(names),glsl:Object.freeze(expressions.map(x=>x.glsl)),operations:expressions.reduce((sum,e)=>sum+e.cpu.operations,0),
  bind(parameters:Readonly<Record<string,number>>){
   const slots=new Float64Array(names.length);names.forEach((name,i)=>{if(i>=2)slots[i]=sourceSamilaUniform(parameters[name]);});
   const uniforms=Object.fromEntries(names.slice(2).map((name,i)=>[`sourceSamilaParameter${i}`,slots[i+2]]));
   return{uniforms,evaluate(x:number,y:number):[number,number]{slots[0]=Math.fround(x);slots[1]=Math.fround(y);return[Math.fround(expressions[0].cpu.evaluate(slots)),Math.fround(expressions[1].cpu.evaluate(slots))];}};
  },
 });
}
export type PreparedSourceSamilaExpressions=ReturnType<typeof prepareSourceSamilaExpressions>;
