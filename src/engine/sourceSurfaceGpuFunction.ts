import type {SourceSurfaceMeshConfiguration} from './sourceSurfaceMeshConfig';
import {parseSourceRealExpression,type SourceRealExpressionNode} from './domainSourceScalar';
import type {SourceSurfaceFunctionInput} from './sourceSurfaceFunction';

export const SOURCE_SURFACE_GPU_PARAMETER_CAPACITY=32;
/** Local emission bounds, separate from the shader's actual params[32] ABI. */
export const SOURCE_SURFACE_GPU_EMISSION_LIMITS=Object.freeze({characters:131072,workCharacters:4194304});
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
const reserved=new Set(('u v x y z params PI TWO_PI E attribute const uniform varying layout centroid flat smooth noperspective break continue do for while switch case default if else in out inout float double int void bool true false invariant discard return mat2 mat3 mat4 vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 uint uvec2 uvec3 uvec4 lowp mediump highp precision sampler2D sampler3D samplerCube struct common partition active asm class union enum typedef template this resource goto inline noinline public static extern external interface long short half fixed unsigned superp input output hvec2 hvec3 hvec4 fvec2 fvec3 fvec4 sampler1D sampler1DShadow sampler2DShadow sampler2DArray sampler2DArrayShadow samplerCubeShadow isampler2D usampler2D').split(' '));
function literal(value:number):string {
 if(!Number.isFinite(Math.fround(value)))return fail('unsupported','GPU 公式常量超出有限 Float32 范围');
 // Constant.toGLSL compares against Java's saturating double-to-long cast.
 if(Number.isInteger(value)&&value>=-(2**63)&&value<=2**63){
  const integer=value===2**63?9223372036854775807n:BigInt(value);
  return `${integer}.0`;
 }
 // Decimal spelling may differ from Java Double.toString; retain its numeric
 // round-trip value rather than reducing constants to Float32 before parsing.
 const text=String(value);return /[.eE]/.test(text)?text:`${text}.0`;
}
/** FastExpressionParser.toGLSL, not the local mathjs emitter. In particular,
 * native '%' emits mod, and integer powers have source-specific negative-base
 * handling. This intentionally does not reproduce CPU-double arithmetic. */
function emit(root:SourceRealExpressionNode,names:readonly string[]):string {
 let work=0;
 const append=(...parts:string[])=>{
  const size=parts.reduce((sum,part)=>sum+part.length,0);work+=size;
  if(size>SOURCE_SURFACE_GPU_EMISSION_LIMITS.characters||work>SOURCE_SURFACE_GPU_EMISSION_LIMITS.workCharacters)fail('capacity','GPU 公式展开超过本地着色器文本或展开工作预算');
  return parts.join('');
 };
 const pending:{node:SourceRealExpressionNode;ready:boolean}[]=[{node:root,ready:false}],values:string[]=[];
 while(pending.length){
  const {node,ready}=pending.pop()!;
  if(node.kind==='number'){
   if(node.name&&!['PI','TWO_PI','E'].includes(node.name))fail('unsupported',`原版 GPU 函数未声明常量 ${node.name}`);
   values.push(append(node.name??literal(node.value)));continue;
  }
  if(node.kind==='variable'){values.push(append(names[node.slot]));continue;}
  const children=node.kind==='unary'?[node.argument]:node.kind==='binary'?[node.left,node.right]:node.name==='log10'?node.args.slice(0,1):node.args;
  if(!ready){
   if(node.kind==='call'){
    const count=node.args.length,name=node.name;
    const valid=name==='min'||name==='max'||name==='log10'?count>=1:name==='pow'?count===2:name==='atan'||name==='atan2'?count===1||count===2:count===1;
    if(!valid)fail('unsupported',`原版 GPU 函数 ${name} 的 ${count} 个参数不能生成有效 GLSL`);
   }
   pending.push({node,ready:true});for(let i=children.length-1;i>=0;i--)pending.push({node:children[i],ready:false});continue;
  }
  const args=values.splice(values.length-children.length,children.length),[a,b]=args;let result:string;
  if(node.kind==='unary')result=append('(',node.op,a,')');
  else if(node.kind==='binary'){
   if(node.op==='%')result=append('mod(',a,', ',b,')');
   else if(node.op==='^'){
    const exponent=node.right.kind==='number'&&!node.right.name?node.right.value:NaN;
    if(Number.isInteger(exponent)&&exponent>=-(2**63)&&exponent<=2**63){
     if(exponent===2||exponent===3||exponent===4)result=append('(',...Array.from({length:exponent},(_,i)=>i===0?a:` * ${a}`),')');
     else if(exponent%2===0)result=append('pow(abs(',a,'), ',b,')');
     else result=append('(pow(abs(',a,'), ',b,') * sign(',a,'))');
    }else result=append('pow(',a,', ',b,')');
   }else result=append('(',a,' ',node.op,' ',b,')');
  }else if(node.name==='log10')result=append('(log(',a,') / 2.30258509)');
  else if(node.name==='min'||node.name==='max'){
   result=a;for(let i=1;i<args.length;i++)result=append(node.name,'(',result,', ',args[i],')');
  }else result=append(node.name==='ln'?'log':node.name==='atan2'?'atan':node.name,'(',args.join(', '),')');
  values.push(result);
 }
 return values[0];
}
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
   if(!/^[A-Za-z_][A-Za-z_0-9]*$/.test(name)||name.startsWith('gl_')||name.includes('__')||reserved.has(name))fail('unsupported',`参数名 ${name} 与原版 GPU 函数或 GLSL 标识符规则冲突`);
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
   return emit(parsed.value,names);
  });
  const functionBody='const float PI = 3.14159265359;\nconst float TWO_PI = 6.28318530718;\nconst float E = 2.71828182846;\n'+parameterNames.map((name,i)=>`float ${name} = params[${i}];\n`).join('')+expressions.map((expression,i)=>`float ${['x','y','z'][i]} = ${expression};\n`).join('')+'return vec3(x, y, z);';
  if(functionBody.length>SOURCE_SURFACE_GPU_EMISSION_LIMITS.characters)fail('capacity','GPU 曲面函数文本超过本地着色器容量');
  return{ok:true,value:Object.freeze({functionBody,parameterNames,scales,offsets,uniforms})};
 }catch(error){if(error instanceof Rejected)return{ok:false,error:{kind:error.kind,reason:error.message}};throw error;}
}

export function sourceSurfaceGpuFunction(equations:Readonly<Record<string,string>>,parameters:Readonly<Record<string,number>>,configuration:SourceSurfaceMeshConfiguration):SourceSurfaceGpuFunction {
 const t=configuration.transform,result=prepareSourceSurfaceGpuFunction({equations,parameters,scales:[t.scaleX,t.scaleY,t.scaleZ],offsets:[t.offsetX,t.offsetY,t.offsetZ]});
 if(!result.ok)throw new Error(`原版 GPU 曲面公式 ${result.error.kind}: ${result.error.reason}`);return result.value;
}
