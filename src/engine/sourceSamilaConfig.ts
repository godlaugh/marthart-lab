import {parseDomainSourceDouble} from './domainSourceScalar';
import {prepareRootsSourceJsonInt,prepareRootsSourceJsonString} from './rootsSourceOrder';
import {SOURCE_SAMILA_MATH_MODEL,sourceSamilaModeFromConfig,sourceSamilaProjectionFromConfig} from './sourceSamilaMath';
import {SOURCE_SAMILA_PARAMETER_LIMIT} from './sourceSamilaFields';
import {javaTrim} from './sourceJavaText';

export interface SourceSamilaConfigFacts {
 equations:{f1:string;f2:string};parameters:Record<string,number>;
 settings:{samilaMathModel:typeof SOURCE_SAMILA_MATH_MODEL;mapping:string;projection:string;start:number;stop:number;seed:number;funcSeed:number};
 consumedPaths:string[][];numericPaths:string[][];diagnostics:string[];
}
type FailureDetail={kind:'input'|'capacity'|'nonfinite';path:string[];reason:string};
type Result={ok:true;value:SourceSamilaConfigFacts}|{ok:false;error:FailureDetail};
class Failure extends Error {constructor(readonly detail:FailureDetail){super(detail.reason);}}
const object=(raw:unknown):raw is Record<string,unknown>=>!!raw&&typeof raw==='object'&&!Array.isArray(raw);
/** JsonSamilaConfig constructor fields. The entire root samila object wins
 * over settings; ignored fallback fields must not be parsed or acknowledged. */
export function importSourceSamilaConfig(root:Record<string,unknown>,numberToken:(path:readonly string[])=>string|undefined):Result {
 try{
  const consumedPaths:string[][]=[],numericPaths:string[][]=[],diagnostics:string[]=[];
  const fail=(kind:FailureDetail['kind'],path:string[],reason:string):never=>{throw new Failure({kind,path,reason});};
  const section=(key:string)=>{if(!Object.hasOwn(root,key))return;const raw=root[key];if(!object(raw))fail('input',[key],'源配置必须为对象');if(!Object.keys(raw as object).length)consumedPaths.push([key]);return raw as Record<string,unknown>;};
  const read=(raw:Record<string,unknown>|undefined,key:string,parent:string)=>{if(raw&&Object.hasOwn(raw,key)){const path=[parent,key];consumedPaths.push(path);if(typeof raw[key]==='number')numericPaths.push(path);return raw[key];}};
  const double=(raw:unknown,fallback:number,path:string[]):number=>{
   let value=fallback,defaulted=raw!==undefined&&raw!==null;
   if(typeof raw==='number'){
    // Processing parses the integer token -0 through Long/Integer, losing its
    // sign before doubleValue. Decimal/exponent tokens retain negative zero.
    value=Object.is(raw,-0)&&numberToken(path)==='-0'?0:raw;defaulted=false;
   }
   else if(typeof raw==='string'){const parsed=parseDomainSourceDouble(raw);if(parsed.ok){value=parsed.value;defaulted=false;}else if(parsed.error.kind==='capacity')fail('capacity',path,JSON.stringify(parsed.error));}
   if(!Number.isFinite(value))fail('nonfinite',path,'源 getDouble 返回非有限数值，本地文档要求有限值');
   if(defaulted)diagnostics.push(`${path.join('.')}: 按源 getDouble 使用 ${fallback}，不求值表达式；原值保留。`);
   return value;
  };
  const integer=(raw:unknown,path:string[]):number=>{const parsed=prepareRootsSourceJsonInt(raw,0,numberToken(path));if(!parsed.ok)return fail(parsed.error.kind==='capacity'?'capacity':'input',path,JSON.stringify(parsed.error));if(parsed.value.route==='fallback'&&raw!=null)diagnostics.push(`${path.join('.')}: 按源 getInt 使用 0；原值保留。`);return parsed.value.value;};
  const formula=(raw:unknown,fallback:string,path:string[]):string=>{
   const parsed=prepareRootsSourceJsonString(raw,fallback,numberToken(path));
   if(!parsed.ok)return fail(parsed.error.kind==='capacity'?'capacity':'input',path,JSON.stringify(parsed.error));
   if(parsed.value.status==='unknown')return fail('input',path,`源公式字符串化未确定：${parsed.value.reason}`);
   const value=parsed.value.value;if(value.length>8192)return fail('capacity',path,'公式超过本地 8192 字符容量');return javaTrim(value)===''?'0.0':value;
  };
  const eq=section('equations'),params=section('parameters'),samila=section('samila'),settings=section('settings');
  const equations={f1:formula(read(eq,'f1','equations'),'sin(x*y)',['equations','f1']),f2:formula(read(eq,'f2','equations'),'cos(x-y)',['equations','f2'])};
  const parameters:Record<string,number>={};
  if(params){const keys=Object.keys(params);if(keys.length>SOURCE_SAMILA_PARAMETER_LIMIT)fail('capacity',['parameters'],'参数数量超过本地 8192 项容量');for(const key of keys){if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)||['constructor','prototype'].includes(key))fail('input',['parameters',key],'参数名不受本地项目模型支持');parameters[key]=double(read(params,key,'parameters'),0,['parameters',key]);}}
  const parent=samila?'samila':'settings',selected=samila??settings;
  const sourceSeed=integer(read(selected,'seed',parent),[parent,'seed']),funcSeed=integer(read(selected,'func_seed',parent),[parent,'func_seed']);
  const start=double(read(selected,'start',parent),-Math.PI,[parent,'start']),stop=double(read(selected,'stop',parent),Math.PI,[parent,'stop']);
  // getString nonstrings cannot spell one of the alphabetic source enum names.
  // Null/omission uses the constructor default; other values reach enum fallback.
  const mode=read(selected,'generate_mode',parent),projection=read(selected,'projection',parent);
  const modeText=mode==null?'f1_vs_f2':typeof mode==='string'?mode:'',projectionText=projection==null?'polar':typeof projection==='string'?projection:'';
  if(sourceSeed<0)diagnostics.push(`源 seed=${sourceSeed} 保留在来源中，文档保存同一 32 位模式 ${sourceSeed>>>0}；是否参与本地采样由采样版本决定，不能据此还原原版逐帧随机流。`);
  return{ok:true,value:{equations,parameters,settings:{samilaMathModel:SOURCE_SAMILA_MATH_MODEL,mapping:sourceSamilaModeFromConfig(modeText),projection:sourceSamilaProjectionFromConfig(projectionText),start,stop,seed:sourceSeed>>>0,funcSeed},consumedPaths,numericPaths,diagnostics}};
 }catch(error){if(error instanceof Failure)return{ok:false,error:error.detail};throw error;}
}
