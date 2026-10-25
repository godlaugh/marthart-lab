import {SourceNativeError} from './sourceNativeError';

/** GL 4.1 types admitted by the fragment owner. Values are scalar components,
 * in GL column-major order for matrices; integer types stay signed on wire. */
export const SOURCE_SYMMETRY_BINDING_TYPES={
 5126:{width:1,integer:false},5124:{width:1,integer:true},35670:{width:1,integer:true},35678:{width:1,integer:true},
 35664:{width:2,integer:false},35665:{width:3,integer:false},35666:{width:4,integer:false},
 35667:{width:2,integer:true},35668:{width:3,integer:true},35669:{width:4,integer:true},
 35671:{width:2,integer:true},35672:{width:3,integer:true},35673:{width:4,integer:true},
 35675:{width:9,integer:false},35676:{width:16,integer:false},
} as const;
export interface SourceSymmetryNativeBinding {name:string;type:keyof typeof SOURCE_SYMMETRY_BINDING_TYPES;values:readonly number[];}
/** Setter intent, not reflected storage type. The linked native program owns
 * alias selection and GL's conversion/rejection behavior. Each writes item 0. */
export interface SourceSymmetryAutomaticSetter {names:readonly string[];type:5124|35664|35665|35666|35675|35676;values:readonly number[];}
export interface SourceSymmetryMatchedParameter {name:string;value:number;}
export function sourceSymmetryNativeBooleanType(type:number):boolean{return[35670,35671,35672,35673].includes(type);}
export const SOURCE_SYMMETRY_BINDING_SCRATCH=262144;
const demand=(ok:unknown,message:string)=>{if(!ok)throw new SourceNativeError('input',message);};
export function sourceSymmetryNativeBindingName(name:string):boolean {
 return typeof name==='string'&&/^[A-Za-z_]\w*$/.test(name)&&!name.startsWith('gl_')&&!['stateTex','iterations'].includes(name);
}
/** Raw source matcher facts include comments and names with no GL location.
 * They are not permission to perform arbitrary typed writes to those names. */
export function sourceSymmetryNativeMatchedName(name:string):boolean{return typeof name==='string'&&/^\w+$/.test(name);}
/** Logical allowance for retained/parsed strings, collections and records;
 * separate from packet copies and GL storage, not a process RSS measurement. */
export function sourceSymmetryNativeNamesBytes(names:readonly string[]):number {
 demand(Array.isArray(names)&&names.length<=65536,'Symmetry 匹配名称集合无效');const seen=new Set<string>();let bytes=0;
 for(const name of names){demand(sourceSymmetryNativeMatchedName(name)&&!seen.has(name),'Symmetry 匹配名称无效或重复');seen.add(name);bytes+=256+name.length*3;}
 return bytes;
}
/** Charge parsed values, names and the bounded per-setter reply before wire or
 * native allocation. Missing author parameters have already become safeFloat(0)
 * at bindSymmetryCustomParameters; this boundary accepts a complete name set. */
export function sourceSymmetryNativeProcessingBytes(automatic:readonly SourceSymmetryAutomaticSetter[],parameters:readonly SourceSymmetryMatchedParameter[]):number {
 demand(Array.isArray(automatic)&&Array.isArray(parameters)&&automatic.length+parameters.length<=65536,'Symmetry source setter 集合超过容量');
 // Per-result allowance covers native result/reply copies, the Node payload,
 // detached decoder objects and array references, not just four wire bytes.
 let names=0,scalars=parameters.length,bytes=SOURCE_SYMMETRY_BINDING_SCRATCH+128+(automatic.length+parameters.length)*320;
 for(const setter of automatic){
  demand(setter&&Array.isArray(setter.names)&&setter.names.length>0&&[5124,35664,35665,35666,35675,35676].includes(setter.type),'Symmetry automatic setter 无效');
  names+=setter.names.length;demand(names<=65536,'Symmetry automatic alias 集合超过容量');const seen=new Set<string>();
  for(const name of setter.names){demand(sourceSymmetryNativeBindingName(name)&&!seen.has(name),'Symmetry automatic alias 无效或重复');seen.add(name);bytes+=256+name.length*3;}
  const shape=SOURCE_SYMMETRY_BINDING_TYPES[setter.type];demand(Array.isArray(setter.values)&&setter.values.length===shape.width,'Symmetry automatic setter 只写一个完整值');
  for(const n of setter.values)demand(typeof n==='number'&&Number.isFinite(Math.fround(n))&&(setter.type!==5124||Number.isInteger(n)&&n>=-2147483648&&n<=2147483647),'Symmetry automatic setter 分量无效');
  scalars+=setter.values.length;bytes+=256+setter.values.length*32;
 }
 const seen=new Set<string>();for(const parameter of parameters){demand(parameter&&sourceSymmetryNativeMatchedName(parameter.name)&&!seen.has(parameter.name)&&typeof parameter.value==='number'&&Number.isFinite(Math.fround(parameter.value)),'Symmetry matched float 无效或重复');seen.add(parameter.name);bytes+=256+parameter.name.length*3+32;}
 demand(scalars<=65536,'Symmetry source setter 分量超过容量');return bytes;
}
export function sourceSymmetryNativeBindingsBytes(bindings:readonly SourceSymmetryNativeBinding[]):number {
 demand(Array.isArray(bindings)&&bindings.length<=65536,'Symmetry 类型绑定集合无效');const seen=new Set<string>();let values=0,bytes=SOURCE_SYMMETRY_BINDING_SCRATCH;
 for(const binding of bindings){
  demand(binding&&sourceSymmetryNativeBindingName(binding.name)&&!seen.has(binding.name),'Symmetry 类型绑定名称无效或重复');seen.add(binding.name);
  demand(Object.hasOwn(SOURCE_SYMMETRY_BINDING_TYPES,binding.type),'Symmetry 类型绑定 GL 类型无效');const type=SOURCE_SYMMETRY_BINDING_TYPES[binding.type];
  demand(Array.isArray(binding.values)&&binding.values.length>0&&binding.values.length%type.width===0,'Symmetry 类型绑定维度无效');values+=binding.values.length;demand(values<=65536,'Symmetry 类型绑定分量超过容量');
  for(const n of binding.values){demand(typeof n==='number'&&Number.isFinite(Math.fround(n))&&(!type.integer||Number.isInteger(n)&&n>=-2147483648&&n<=2147483647),'Symmetry 类型绑定数值无效');demand(binding.type!==35678||n===0,'Symmetry 采样器只能引用自有状态单元 0');demand(!sourceSymmetryNativeBooleanType(binding.type)||n===0||n===1,'Symmetry 布尔绑定只能为 0 或 1');}
  bytes+=256+binding.name.length*3+binding.values.length*32;
 }
 return bytes;
}
