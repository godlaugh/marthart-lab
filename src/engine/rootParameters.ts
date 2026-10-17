import type {RootParameter,RootParameterDomain,Settings} from '../types';
import {numberSetting} from './expression';

export const ROOT_PARAMETER_DOMAINS:readonly RootParameterDomain[]=['UNIT_CIRCLE','REAL_RANGE','COMPLEX_RECT','FIXED'];
// Bound the editable scope as well as formula AST complexity (512 nodes).
export const MAX_ROOT_PARAMETERS=256;
const reserved=new Set(['i','pi','PI','time','constructor','prototype']);
export function rootParameterNameAllowed(name:string):boolean{return /^[A-Za-z][A-Za-z0-9_]*$/.test(name)&&name.length<=100&&!reserved.has(name);}
export function validateRootVariable(variable:string,parameters:readonly string[]=[]):void {
 if(!rootParameterNameAllowed(variable)||variable==='e'||parameters.includes(variable))throw new Error('多项式变量名无效或与参数/保留名冲突');
}
export function defaultRootParameter(name:string,domain:RootParameterDomain='UNIT_CIRCLE'):RootParameter{return{name,domain,minRe:-1,maxRe:1,minIm:-1,maxIm:1,value:[1,0]};}
const object=(x:unknown):x is Record<string,unknown>=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export function validateRootParameters(raw:unknown,variable='z',scalarNames:readonly string[]=[]):RootParameter[]{
 if(!Array.isArray(raw)||raw.length>MAX_ROOT_PARAMETERS)throw new Error(`复根参数须为至多 ${MAX_ROOT_PARAMETERS} 项的数组`);
 const names=new Set<string>();
 const result=raw.map((p,index):RootParameter=>{
  const at=`复根参数 ${index+1}`;
  if(!object(p)||typeof p.name!=='string'||!rootParameterNameAllowed(p.name))throw new Error(at+' 名称无效');
  if(names.has(p.name)||scalarNames.includes(p.name))throw new Error(at+' 名称重复或与实数参数冲突：'+p.name);names.add(p.name);
  if(!ROOT_PARAMETER_DOMAINS.includes(p.domain as RootParameterDomain))throw new Error(at+' 采样域无效');
  for(const key of ['minRe','maxRe','minIm','maxIm'])if(typeof p[key]!=='number'||!Number.isFinite(p[key]))throw new Error(at+' '+key+' 必须有限');
  if(Number(p.minRe)>Number(p.maxRe)||Number(p.minIm)>Number(p.maxIm))throw new Error(at+' 范围下限不能大于上限');
  if(!Array.isArray(p.value)||p.value.length!==2||p.value.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw new Error(at+' 固定值须为两个有限数');
  return{name:p.name,domain:p.domain as RootParameterDomain,minRe:p.minRe as number,maxRe:p.maxRe as number,minIm:p.minIm as number,maxIm:p.maxIm as number,value:[p.value[0],p.value[1]]};
 });
 validateRootVariable(variable,[...names,...scalarNames]);return result;
}
/** Omission alone selects the legacy model. A malformed explicit model never falls back. */
export function parseRootParameters(settings:Settings,variable=String(settings.variable??'z'),scalarNames:readonly string[]=[]):RootParameter[]{
 if(settings.rootParameters!==undefined){
  if(typeof settings.rootParameters!=='string'||settings.rootParameters.length>256*1024)throw new Error('复根参数 JSON 无效或超过 256 KiB');
  let raw:unknown;try{raw=JSON.parse(settings.rootParameters);}catch{throw new Error('复根参数 JSON 无法解析');}
  return validateRootParameters(raw,variable,scalarNames);
 }
 const min=numberSetting(settings,'rangeMin',-1),max=numberSetting(settings,'rangeMax',1);
 return validateRootParameters([1,2,3].map(i=>({name:'t'+i,domain:settings['domain'+i]??(i===3?'FIXED':'UNIT_CIRCLE'),minRe:min,maxRe:max,minIm:min,maxIm:max,value:[numberSetting(settings,'fixed'+i+'Real',1),numberSetting(settings,'fixed'+i+'Imag',0)]})),variable,scalarNames);
}
/** Convert once and remove superseded aliases so inactive settings cannot masquerade as controls. */
export function withRootParameters(settings:Settings,parameters:RootParameter[],scalarNames:readonly string[]=[]):Settings{
 const validated=validateRootParameters(parameters,String(settings.variable??'z'),scalarNames),next={...settings};
 for(const key of ['rangeMin','rangeMax',...[1,2,3].flatMap(i=>['domain'+i,'fixed'+i+'Real','fixed'+i+'Imag'])])delete next[key];
 next.rootParameters=JSON.stringify(validated);return next;
}
export function rootParameterBounds(parameter:RootParameter,component:0|1):[number,number]{
 if(parameter.domain==='UNIT_CIRCLE')return[-1,1];
 if(parameter.domain==='FIXED')return[parameter.value[component],parameter.value[component]];
 if(parameter.domain==='REAL_RANGE'&&component===1)return[0,0];
 return component===0?[parameter.minRe,parameter.maxRe]:[parameter.minIm,parameter.maxIm];
}
export function normalizeRootParameter(value:number,bounds:[number,number]):number{
 const [lo,hi]=bounds;if(lo===hi)return 0;
 // Avoid overflowing hi-lo for finite, opposite-sign endpoints.
 const span=hi-lo;return Number.isFinite(span)?(value-lo)/span:(value/2-lo/2)/(hi/2-lo/2);
}
