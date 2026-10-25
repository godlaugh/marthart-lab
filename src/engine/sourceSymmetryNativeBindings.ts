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
export function sourceSymmetryNativeBooleanType(type:number):boolean{return[35670,35671,35672,35673].includes(type);}
export const SOURCE_SYMMETRY_BINDING_SCRATCH=262144;
const demand=(ok:unknown,message:string)=>{if(!ok)throw new SourceNativeError('input',message);};
export function sourceSymmetryNativeBindingName(name:string):boolean {
 return typeof name==='string'&&/^[A-Za-z_]\w*$/.test(name)&&!name.startsWith('gl_')&&!['stateTex','iterations'].includes(name);
}
/** Logical allowance for retained/parsed strings, collections and records;
 * separate from packet copies and GL storage, not a process RSS measurement. */
export function sourceSymmetryNativeNamesBytes(names:readonly string[]):number {
 demand(Array.isArray(names)&&names.length<=65536,'Symmetry 匹配名称集合无效');const seen=new Set<string>();let bytes=0;
 for(const name of names){demand(sourceSymmetryNativeBindingName(name)&&!seen.has(name),'Symmetry 匹配名称无效或重复');seen.add(name);bytes+=256+name.length*3;}
 return bytes;
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
