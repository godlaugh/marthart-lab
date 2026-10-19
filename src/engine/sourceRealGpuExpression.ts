import type {SourceRealExpressionNode} from './domainSourceScalar';

/** Local expansion admission, independent of each native shader ABI. */
export const SOURCE_REAL_GPU_EMISSION_LIMITS=Object.freeze({characters:131072,workCharacters:4194304});
export class SourceRealGpuEmissionError extends Error {constructor(readonly kind:'capacity'|'unsupported',message:string){super(message);}}
const fail=(kind:'capacity'|'unsupported',reason:string):never=>{throw new SourceRealGpuEmissionError(kind,reason);};
export function sourceGpuRoundTripLiteral(value:number):string {
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
export function emitSourceRealGlsl(root:SourceRealExpressionNode,names:readonly string[],options:{literal?:(value:number)=>string;namedConstant?:(name:string)=>string;variable?:(name:string)=>string}={}):string {
 let work=0;
 const append=(...parts:string[])=>{
  const size=parts.reduce((sum,part)=>sum+part.length,0);work+=size;
  if(size>SOURCE_REAL_GPU_EMISSION_LIMITS.characters||work>SOURCE_REAL_GPU_EMISSION_LIMITS.workCharacters)fail('capacity','GPU 公式展开超过本地着色器文本或展开工作预算');
  return parts.join('');
 };
 const pending:{node:SourceRealExpressionNode;ready:boolean}[]=[{node:root,ready:false}],values:string[]=[];
 while(pending.length){
  const {node,ready}=pending.pop()!;
  if(node.kind==='number'){
   if(node.name){
    if(options.namedConstant)values.push(append(options.namedConstant(node.name)));
    else {if(!['PI','TWO_PI','E'].includes(node.name))fail('unsupported',`原版 GPU 函数未声明常量 ${node.name}`);values.push(append(node.name));}
   }else values.push(append((options.literal??sourceGpuRoundTripLiteral)(node.value)));
   continue;
  }
  if(node.kind==='variable'){values.push(append(options.variable?options.variable(names[node.slot]):names[node.slot]));continue;}
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
const reserved=new Set(('attribute const uniform varying layout centroid flat smooth noperspective break continue do for while switch case default if else in out inout float double int void bool true false invariant discard return mat2 mat3 mat4 vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 uint uvec2 uvec3 uvec4 lowp mediump highp precision sampler2D sampler3D samplerCube struct common partition active asm class union enum typedef template this resource goto inline noinline public static extern external interface long short half fixed unsigned superp input output hvec2 hvec3 hvec4 fvec2 fvec3 fvec4 sampler1D sampler1DShadow sampler2DShadow sampler2DArray sampler2DArrayShadow samplerCubeShadow isampler2D usampler2D').split(' '));
/** Shared GLSL lexical admission; each source wrapper owns its own symbols. */
export function isSourceGlslIdentifier(name:string):boolean{return /^[A-Za-z_][A-Za-z_0-9]*$/.test(name)&&!name.startsWith('gl_')&&!name.includes('__')&&!reserved.has(name);}
