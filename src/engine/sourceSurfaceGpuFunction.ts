import {emitSourceRealGlsl,isSourceGlslIdentifier,SourceRealGpuEmissionError,SOURCE_REAL_GPU_EMISSION_LIMITS} from './sourceRealGpuExpression';
import type {SourceSurfaceMeshConfiguration} from './sourceSurfaceMeshConfig';
import {parseSourceRealExpression} from './domainSourceScalar';
import type {SourceSurfaceFunctionInput} from './sourceSurfaceFunction';

export const SOURCE_SURFACE_GPU_PARAMETER_CAPACITY=32;
export type SourceSurfaceGpuFunctionError={kind:'input'|'capacity'|'unsupported'|'arithmetic';reason:string};
export type SourceSurfaceGpuResult<T>={ok:true;value:T}|{ok:false;error:SourceSurfaceGpuFunctionError};
export interface SourceSurfaceGpuFunction {
 /** Body of the source calculateSurface(float u, float v), without transforms. */
 readonly functionBody:string;
 readonly parameterNames:readonly string[];
 readonly scales:readonly number[];
 readonly offsets:readonly number[];
 /** Upload values at render time from the current runtime owner. Never parses
  * expressions again; returns an independent complete params[32] allocation. */
 uniforms(read?:(name:string)=>number):SourceSurfaceGpuResult<Float32Array>;
}
class Rejected extends Error {constructor(readonly kind:SourceSurfaceGpuFunctionError['kind'],message:string){super(message);}}
const fail=(kind:SourceSurfaceGpuFunctionError['kind'],reason:string):never=>{throw new Rejected(kind,reason);};
const wrapperNames=new Set('u v x y z params PI TWO_PI E'.split(' '));
/** Static source contract: JsonSurfaceFunction.getGLSLFunction/setUniforms and
 * FastExpressionParser nested toGLSL methods, MathArt 1.7.8 fixed JAR. Actual
 * WebGL shader compilation remains the renderer's responsibility. */
export function prepareSourceSurfaceGpuFunction(input:SourceSurfaceFunctionInput):SourceSurfaceGpuResult<SourceSurfaceGpuFunction>{
 try{
  if(!input||!input.parameters||typeof input.parameters!=='object'||Array.isArray(input.parameters)||!input.equations||typeof input.equations!=='object')fail('input','GPU 曲面需要公式和参数对象');
  // Java String natural order and JS default sort both compare UTF-16 units.
  const parameterNames=Object.freeze(Object.keys(input.parameters).sort());
  if(parameterNames.length>SOURCE_SURFACE_GPU_PARAMETER_CAPACITY)fail('capacity','原版 GPU 曲面着色器仅声明 32 个参数槽');
  for(const name of parameterNames){
   if(!isSourceGlslIdentifier(name)||wrapperNames.has(name))fail('unsupported',`参数名 ${name} 与原版 GPU 函数或 GLSL 标识符规则冲突`);
  }
  const transform=(values:readonly number[],label:string)=>{
   if(!Array.isArray(values)||values.length!==3||values.some(value=>typeof value!=='number'||!Number.isFinite(Math.fround(value))))fail('input',`GPU 曲面 ${label} 需要三个有限 Float32 数值`);
   return Object.freeze(values.map(Math.fround));
  };
  const scales=transform(input.scales,'分轴缩放'),offsets=transform(input.offsets,'坐标偏移');
  const initial=parameterNames.map(name=>input.parameters[name]);
  const uniforms=(read?:(name:string)=>number):SourceSurfaceGpuResult<Float32Array>=>{
   const packed=new Float32Array(SOURCE_SURFACE_GPU_PARAMETER_CAPACITY);
   for(let i=0;i<parameterNames.length;i++){
    const value=read?read(parameterNames[i]):initial[i];
    if(typeof value!=='number'||!Number.isFinite(Math.fround(value)))return{ok:false,error:{kind:'arithmetic',reason:`GPU 参数 ${parameterNames[i]} 不是有限 Float32 数值`}};
    packed[i]=value;
   }
   return{ok:true,value:packed};
  };
  const initialUniforms=uniforms();if(!initialUniforms.ok)return initialUniforms;
  const names=['u','v',...parameterNames];
  const expressions=['x','y','z'].map(axis=>{
   const parsed=parseSourceRealExpression(input.equations[axis],names);
   if(!parsed.ok)return fail(parsed.error.kind,`GPU 曲面公式 ${axis}：${JSON.stringify(parsed.error)}`);
   return emitSourceRealGlsl(parsed.value,names);
  });
  const functionBody='const float PI = 3.14159265359;\nconst float TWO_PI = 6.28318530718;\nconst float E = 2.71828182846;\n'+parameterNames.map((name,i)=>`float ${name} = params[${i}];\n`).join('')+expressions.map((expression,i)=>`float ${['x','y','z'][i]} = ${expression};\n`).join('')+'return vec3(x, y, z);';
  if(functionBody.length>SOURCE_REAL_GPU_EMISSION_LIMITS.characters)fail('capacity','GPU 曲面函数文本超过本地着色器容量');
  return{ok:true,value:Object.freeze({functionBody,parameterNames,scales,offsets,uniforms})};
 }catch(error){if(error instanceof Rejected||error instanceof SourceRealGpuEmissionError)return{ok:false,error:{kind:error.kind,reason:error.message}};throw error;}
}

export function sourceSurfaceGpuFunction(equations:Readonly<Record<string,string>>,parameters:Readonly<Record<string,number>>,configuration:SourceSurfaceMeshConfiguration):SourceSurfaceGpuFunction {
 const t=configuration.transform,result=prepareSourceSurfaceGpuFunction({equations,parameters,scales:[t.scaleX,t.scaleY,t.scaleZ],offsets:[t.offsetX,t.offsetY,t.offsetZ]});
 if(!result.ok)throw new Error(`原版 GPU 曲面公式 ${result.error.kind}: ${result.error.reason}`);return result.value;
}
