import type {Settings} from '../types';
import {samilaToneParameterSpecs} from './samilaTone';

/** Reader owns source object/type/alias/expression parsing. This migration
 * boundary accepts only its finite scalar facts; undefined preserves absence
 * of the whole settings object, unlike an existing empty object. */
export const samilaToneSourceFields=['brightness','contrast','gamma','dynamic_range','saturation'] as const;
export type SamilaToneSourceField=typeof samilaToneSourceFields[number];
export type SamilaToneSource=Partial<Record<SamilaToneSourceField,number>>;
const fields={
 brightness:{local:'brightness',constructorDefault:.5,jsonDefault:.3,legacyMin:-1,legacyMax:1},
 contrast:{local:'contrast',constructorDefault:1,jsonDefault:1,legacyMin:0,legacyMax:8},
 gamma:{local:'gamma',constructorDefault:2.2,jsonDefault:2.2,legacyMin:.1,legacyMax:8},
 dynamic_range:{local:'dynamicRange',constructorDefault:.5,jsonDefault:.2,legacyMin:.001,legacyMax:1e9},
 saturation:{local:'saturation',constructorDefault:.8,jsonDefault:.8,legacyMin:0,legacyMax:4},
} as const;
export interface SamilaToneImport {normalized:Settings;legacy:Settings;warnings:string[];}
export function importSamilaTone(source:SamilaToneSource|undefined):SamilaToneImport {
 const normalized:Settings={},legacy:Settings={},warnings:string[]=[];
 for(const key of samilaToneSourceFields){
  const field=fields[key],spec=samilaToneParameterSpecs[field.local],explicit=source?.[key];
  if(explicit!==undefined&&(typeof explicit!=='number'||!Number.isFinite(explicit)))throw new Error(`MathArt 导入失败：settings.${key} 必须是有限数值`);
  // JSON constructors do not call runtime clamps. Keep the requested number in
  // dormant normalized fields even if current v2 cannot yet render that value.
  const value=explicit??(source===undefined?field.constructorDefault:field.jsonDefault);normalized[spec.key]=value;
  if(value<spec.min||value>spec.max)warnings.push(`settings.${key}=${value} 已原样保留在 ${spec.key}；启用归一调色后需调整超范围值（当前支持 ${spec.min}..${spec.max}）。`);
  if(explicit!==undefined){
   const effective=Math.min(field.legacyMax,Math.max(field.legacyMin,explicit));legacy[field.local]=effective;
   if(effective!==explicit)warnings.push(`settings.${key}=${explicit}：当前兼容白点模型使用 ${effective}；原值保留在 ${spec.key} 和 source，此转换不是原版构造器的范围限制。`);
  }
 }
 warnings.push('已另存 Samila 的归一调色原值与构造默认值；当前仍使用兼容白点模型，归一调色和有界历史需显式启用。原版点形状、色板分支及像素尚未对照。');
 return{normalized,legacy,warnings};
}
