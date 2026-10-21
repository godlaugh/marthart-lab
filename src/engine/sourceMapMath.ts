import type {SceneDocument} from '../types';
import {parseSourceRealExpression,sourceRealFunctionNames} from './domainSourceScalar';
import {emitSourceRealGlsl,isSourceGlslIdentifier,SourceRealGpuEmissionError} from './sourceRealGpuExpression';
import {javaTrim} from './sourceJavaText';

export const SOURCE_MAP_MATH='mathart-1.7.8-gpu-v1' as const;
export {sourceRealFunctionNames as sourceMapFunctionNames};
export function usesSourceMapMath(scene:Pick<SceneDocument,'kind'|'settings'>):boolean {
 const model=scene.settings.mapMathModel;
 if(model===undefined||model==='legacy-v1')return false;
 if(model!==SOURCE_MAP_MATH||scene.kind!=='map'||scene.settings.iteratedMode!=='continuous')throw Error('源 Map 数学模型需要持续批次 Map');
 return true;
}
const coordinates=['x','y','z'],aliases=['nx','ny','nz','x_next','y_next','z_next'];
const reserved=new Set([...coordinates,...aliases,'pos','nextPos','stepMetric','calculate_next','main','stateTex','iterations','dimension','texCoord','newState',...sourceRealFunctionNames,'constructor','prototype','__proto__']);
/** MapAttractorExpressionCompiler + FastExpressionParser, MathArt 1.7.8.
 * Arithmetic is owned by the shared source parser/emitter. This wrapper owns
 * ordered coordinate aliases and uniforms, without implicit t/time bindings.
 * Invalid GLSL identifiers/arity and undeclared template constants fail closed.
 * Function names and original shader globals are excluded even when unused,
 * so uniform renaming cannot silently repair a source namespace collision.
 * Successful source generation alone does not prove native GL compilation.
 */
export function sourceMapVariables(parameterNames:readonly string[],axis:'x'|'y'|'z'):string[]{
 return [...coordinates,...parameterNames,...(axis!=='x'?['x_next','nx']:[]),...(axis==='z'?['y_next','ny']:[])];
}
export function prepareSourceMapExpressions(equations:{x:string;y:string;z?:string},parameterNames:readonly string[],dimension:2|3){
 if(dimension!==2&&dimension!==3)throw Error('源 Map 维度须为 2 或 3');
 // Canonical ordering changes only uniform declaration/binding order. Values
 // never enter the compiled program identity; original keys stay in the document.
 const keys=[...parameterNames].sort();
 if(new Set(keys).size!==keys.length)throw Error('源 Map 参数名重复');
 for(const key of keys)if(!isSourceGlslIdentifier(key)||reserved.has(key))throw Error(`源 Map 参数 ${key} 与着色器标识符冲突`);
 const expressions=(['x','y','z'] as const).map(axis=>{
  if(axis==='z'&&dimension===2)return '0.0';
  const names=sourceMapVariables(keys,axis),raw=equations[axis]??'';
  const ast=parseSourceRealExpression(javaTrim(raw),names);
  if(!ast.ok)throw Error(`源 Map ${axis}_next 公式无效：${JSON.stringify(ast.error)}`);
  return emitSourceRealGlsl(ast.value,names,{
   variable(name){const index=keys.indexOf(name);return index<0?name:`sourceMapParameter${index}`;},
   namedConstant(name){throw new SourceRealGpuEmissionError('unsupported',`源 Map 更新模板未声明常量 ${name}；请使用数值或显式参数`);},
  });
 });
 const source=`${keys.map((_,i)=>`uniform float sourceMapParameter${i};`).join('\n')}${keys.length?'\n\n':''}void calculate_next(in vec3 pos, out vec3 nextPos, out float stepMetric) {
  float x = pos.x;
  float y = pos.y;
  float z = pos.z;
  float x_next = ${expressions[0]};
  float nx = x_next;
  float y_next = ${expressions[1]};
  float ny = y_next;
  float z_next = ${expressions[2]};
  float nz = z_next;
${dimension===2?'  z_next = 0.0;\n  nz = 0.0;\n':''}  nextPos = vec3(nx, ny, nz);
  stepMetric = length(nextPos - pos);
}
`;
 const key=SOURCE_MAP_MATH+':'+source;
 return Object.freeze({source,key,bind(parameters:Readonly<Record<string,number>>){
  const uniforms:Record<string,number>=Object.create(null);
  keys.forEach((name,i)=>{const value=parameters[name];if(!Object.hasOwn(parameters,name)||!Number.isFinite(value)||!Number.isFinite(Math.fround(value)))throw Error(`源 Map 参数 ${name} 超出有限 GPU Float32`);uniforms[`sourceMapParameter${i}`]=value;});
  return{source,key,uniforms,sourceCalculateNext:true as const};
 }});
}
export function sourceMapGpuField(field:{equations:{x:string;y:string;z?:string};parameters:Readonly<Record<string,number>>;dimension:2|3}){
 return prepareSourceMapExpressions(field.equations,Object.keys(field.parameters),field.dimension).bind(field.parameters);
}
