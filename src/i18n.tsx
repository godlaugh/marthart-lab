import {createContext,useContext,useMemo,type ReactNode} from 'react';
import type {SceneDefinition} from './types';
import componentEnglish from './locales/components.en.json';
import metadataEnglish from './locales/metadata.en.json';
import applicationEnglish from './locales/application.en.json';

export type Language='zh'|'en';
export type TranslationValues=Record<string,string|number>;
export const ENGLISH_CATALOG:Readonly<Record<string,string>>={...metadataEnglish,...componentEnglish,...applicationEnglish};
const interpolate=(text:string,values:TranslationValues)=>text.replace(/\{([\w]+)\}/g,(token,key)=>Object.hasOwn(values,key)?String(values[key]):token);
const escapeRegex=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const patterns=Object.entries(ENGLISH_CATALOG).filter(([source])=>/\{\w+\}/.test(source)).map(([source,translation])=>{
 const keys:string[]=[],parts:string[]=[];let at=0;for(const match of source.matchAll(/\{(\w+)\}/g)){parts.push(escapeRegex(source.slice(at,match.index)),'([\\s\\S]*?)');keys.push(match[1]);at=match.index!+match[0].length;}parts.push(escapeRegex(source.slice(at)));return{match:new RegExp('^'+parts.join('')+'$'),keys,translation};
});
/** Explicit UI boundary only. Unknown text and interpolated user values are preserved. */
export function translate(language:Language,source:string,values:TranslationValues={}):string{
 if(language==='zh')return interpolate(source,values);
 if(Object.hasOwn(ENGLISH_CATALOG,source))return interpolate(ENGLISH_CATALOG[source],values);
 if(source.length<=8192&&/[\u3400-\u9fff]/.test(source))for(const pattern of patterns){const result=pattern.match.exec(source);if(result)return interpolate(pattern.translation,Object.fromEntries(pattern.keys.map((key,i)=>[key,result[i+1]])));}
 return interpolate(source,values);
}
type I18n={language:Language;t:(source:string,values?:TranslationValues)=>string};
const Context=createContext<I18n>({language:'zh',t:(source,values)=>translate('zh',source,values)});
export function I18nProvider({language,children}:{language:Language;children:ReactNode}){
 const value=useMemo<I18n>(()=>({language,t:(source,values)=>translate(language,source,values)}),[language]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useI18n=()=>useContext(Context);
/** Built-in catalog metadata only. Never pass a saved user's scene through this helper. */
export function localizeDefinition(definition:SceneDefinition,language:Language):SceneDefinition{
 if(language==='zh')return definition;const t=(s:string)=>translate(language,s);
 return{...definition,name:definition.englishName,description:t(definition.description),equations:definition.equations.map(e=>({...e,label:t(e.label)})),controls:definition.controls.map(c=>({...c,label:t(c.label),group:t(c.group),...(c.help?{help:t(c.help)}:{}),...(c.options?{options:c.options.map(o=>({...o,label:t(o.label)}))}:{})})),presets:definition.presets.map(p=>({...p,name:t(p.name),...(p.description?{description:t(p.description)}:{})}))};
}
