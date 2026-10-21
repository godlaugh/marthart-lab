import {SOURCE_FRACTAL_RETAINED_LIMITS} from './sourceFractalLimits';
import type {OscillationEdgeEasing} from '../types';
import type {SourceFractalAnimationTargets} from './sourceFractalSceneClock';
import type {SourceFractalParameterAction} from './sourceFractalParameterRuntime';
import type {SourceGradientAction,SourceGradientConfiguration} from './sourceGradientRuntime';
import {DOMAIN_SOURCE_SCALAR_LIMITS,parseDomainSourceDouble,parseDomainSourceFloat,prepareDomainSourceScalar} from './domainSourceScalar';
import {lookupSourceEasing} from './sourceEasing';
import {javaTrim,isJavaBlank} from './sourceJavaText';
import {sourceParticleGradientPayload} from './sourceParticleGradientImport';
import {SOURCE_PARTICLE_GRADIENT_MODES,SOURCE_PARTICLE_GRADIENT_INTERPOLATIONS} from './sourceParticleGradientConfig';

/** Local retained-work bounds, not native format limits. Unknown fields are not
 * traversed; each admitted scalar has the shared bounded expression parser. */
export const SOURCE_FRACTAL_ACTION_LIMITS=Object.freeze({...SOURCE_FRACTAL_RETAINED_LIMITS,fieldCharacters:DOMAIN_SOURCE_SCALAR_LIMITS.characters});
export interface SourceFractalActionImportOptions {
 globalEdgeEasing?:unknown;
 /** Already resolved original JSONObject HashMap order, relative to actions.
  * Required for nonempty named parameters; never reinterpret it as insertion order. */
 memberOrder?:(path:readonly string[])=>readonly string[]|undefined;
}
export interface SourceFractalActionImportFacts {
 targets:SourceFractalAnimationTargets;
 parameters:SourceFractalParameterAction[];
 gradient?:SourceGradientAction;
 consumedPaths:string[][];numericPaths:string[][];
 globalConsumedPaths:string[][];globalNumericPaths:string[][];
 diagnostics:string[];
}
export interface SourceFractalActionImportError {kind:'input'|'capacity'|'arithmetic';path:readonly string[];reason:string;}
export type SourceFractalActionImportResult={ok:true;value:SourceFractalActionImportFacts}|{ok:false;error:SourceFractalActionImportError};
class Failure extends Error {constructor(readonly detail:SourceFractalActionImportError){super(detail.reason);}}
const F=Math.fround,own=(o:object,k:PropertyKey)=>Object.hasOwn(o,k);
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fail=(kind:SourceFractalActionImportError['kind'],path:readonly string[],reason:string):never=>{throw new Failure({kind,path:[...path],reason});};
const finite=(n:number,path:readonly string[])=>Number.isFinite(n)?n:fail('arithmetic',path,'本地不能保存或回放非有限源动作数值');
const javaInt=(n:number)=>Number.isNaN(n)?0:Math.min(2147483647,Math.max(-2147483648,Math.trunc(n)));
const bool=(raw:unknown,fallback:boolean,path:readonly string[],strict=false):boolean=>{
 if(typeof raw==='boolean')return raw;
 if(typeof raw==='string'&&/^(true|false)$/i.test(raw))return raw.toLowerCase()==='true';
 return strict?fail('input',path,'原版 enable 需要布尔值或不带空格的 true/false 字符串'):fallback;
};
const defaultEdge:Readonly<OscillationEdgeEasing>=Object.freeze({window:.5,floor:.25,easing:'sine-out'});
export type SourceFractalFloatFieldResult={ok:true;value:{value:number;diagnostics:string[]}}|{ok:false;error:SourceFractalActionImportError};
/** Present object argument: Float.parseFloat first; present object field:
 * JSONObject.getFloat -> Double.parseDouble then F32 first. Both fall back to
 * ConfigUtils expressions, whose invalid input recovers to 0. JSON null is
 * JSONObject.NULL, not absent. Nonfinite source values are preserved here;
 * each consumer owns its clamp/comparison/finite admission. */
function parsedScalar(raw:unknown,field:boolean):SourceFractalFloatFieldResult {
 if(typeof raw==='number')return{ok:true,value:{value:F(raw),diagnostics:[]}};
 if(typeof raw==='string'){
  const literal=field?parseDomainSourceDouble(raw):parseDomainSourceFloat(raw);
  if(literal.ok)return{ok:true,value:{value:F(literal.value),diagnostics:[]}};
  if(literal.error.kind==='capacity')return{ok:false,error:{kind:'capacity',path:[],reason:'动作标量超过本地字符预算'}};
  const expression=prepareDomainSourceScalar(raw,{fallback:0,precision:'float32'});
  if(!expression.ok)return{ok:false,error:{kind:'capacity',path:[],reason:`动作表达式超过本地 ${expression.error.resource} 预算`}};
  return{ok:true,value:{value:expression.facts.value,diagnostics:expression.facts.route==='fallback'?['原版数值解析失败，采用 0。']:[]}};
 }
 return{ok:true,value:{value:0,diagnostics:['原版数值解析失败，采用 0。']}};
}
/** JsonComplexFractalConfig.getJsonFloat, shared by duration, key time and
 * parameter fields. Undefined denotes an absent JSON member; null is present. */
export function parseSourceFractalFloatField(raw:unknown,fallback:number):SourceFractalFloatFieldResult {
 return raw===undefined?{ok:true,value:{value:F(fallback),diagnostics:[]}}:parsedScalar(raw,true);
}
function admittedScalar(raw:unknown,path:readonly string[],diagnostics:string[],field:boolean):number {
 const result=field?parseSourceFractalFloatField(raw,0):parsedScalar(raw,false);
 if(!result.ok)return fail(result.error.kind,path,result.error.reason);
 diagnostics.push(...result.value.diagnostics.map(message=>`${path.join('.')}: ${message}`));
 return finite(result.value.value,path);
}
const scalar=(raw:unknown,path:readonly string[],diagnostics:string[])=>admittedScalar(raw,path,diagnostics,false);
const fieldScalar=(raw:unknown,path:readonly string[],diagnostics:string[])=>admittedScalar(raw,path,diagnostics,true);
function edge(raw:unknown,inherited:OscillationEdgeEasing,path:string[],consumed:string[][],numeric:string[][],diagnostics:string[]):OscillationEdgeEasing {
 if(!object(raw))return fail('input',path,'原版 edgeEasing 需要 JSON 对象');
 const out={...inherited};if(!Object.keys(raw).length)consumed.push(path);
 for(const key of ['window','floor'] as const){if(!own(raw,key))continue;const p=[...path,key],v=raw[key];consumed.push(p);if(typeof v==='number')numeric.push(p);
  if(typeof v==='number')out[key]=finite(v,p);
  else if(typeof v==='string'){const parsed=parseDomainSourceDouble(v);if(parsed.ok)out[key]=finite(parsed.value,p);else if(parsed.error.kind==='capacity')fail('capacity',p,'端点数值超过本地字符预算');else diagnostics.push(`${p.join('.')}: 无法解析 Java double，保留继承值。`);}
  else diagnostics.push(`${p.join('.')}: 无法解析 Java double，保留继承值。`);
 }
 if(own(raw,'easing')){const p=[...path,'easing'];if(typeof raw.easing==='string'&&raw.easing.length>SOURCE_FRACTAL_ACTION_LIMITS.fieldCharacters)fail('capacity',p,'缓动名称超过本地字符预算');consumed.push(p);if(typeof raw.easing==='number')numeric.push(p);const easing=lookupSourceEasing(raw.easing);if(easing)out.easing=easing;else diagnostics.push(`${p.join('.')}: 未识别缓动，保留继承值。`);}
 return out;
}
function text(raw:unknown):string|undefined {if(raw==null)return undefined;if(typeof raw==='string')return raw;if(typeof raw==='number'||typeof raw==='boolean')return String(raw);return Array.isArray(raw)?'[]':'{}';}
function enumText(raw:unknown,fallback:string,diagnostics:string[]):string {
 const value=text(raw);if(value===undefined||isJavaBlank(value))return fallback;
 const trimmed=javaTrim(value),upper=trimmed.toUpperCase();
 if(trimmed!==upper&&/[i\u0080-\uffff]/.test(trimmed))diagnostics.push('原版渐变枚举使用 JVM 默认区域大小写规则；本地采用 Unicode 映射，原环境区域未知。');
 return upper.toLowerCase();
}
/** Pure source ingress. Ordinary targets overwrite by field; parameter children
 * remain in action/JSONObject order; only the last valid gradient child survives.
 * All returned paths are exact arrays, retaining dots and unusual parameter names. */
export function importSourceFractalActions(actions:unknown,options:SourceFractalActionImportOptions={}):SourceFractalActionImportResult {
 try{
  const facts:SourceFractalActionImportFacts={targets:{},parameters:[],consumedPaths:[],numericPaths:[],globalConsumedPaths:[],globalNumericPaths:[],diagnostics:[]};
  const {consumedPaths:used,numericPaths:numeric,diagnostics}=facts;
  const read=(o:Record<string,unknown>,key:string,path:string[])=>{if(own(o,key)){const p=[...path,key];if(typeof o[key]==='string'&&o[key].length>SOURCE_FRACTAL_ACTION_LIMITS.fieldCharacters)fail('capacity',p,'动作字段超过本地字符预算');used.push(p);if(typeof o[key]==='number')numeric.push(p);}return o[key];};
  const global=options.globalEdgeEasing===undefined?{...defaultEdge}:edge(options.globalEdgeEasing,{...defaultEdge},[],facts.globalConsumedPaths,facts.globalNumericPaths,diagnostics);
  if(actions===undefined)return{ok:true,value:facts};
  if(!Array.isArray(actions))return fail('input',[],'原版 actions 需要数组');
  if(actions.length>SOURCE_FRACTAL_ACTION_LIMITS.actions)return fail('capacity',[],'动作数量超过本地预算');
  if(!actions.length)used.push([]);let nameCharacters=0;
  for(let index=0;index<actions.length;index++){
   const action=actions[index],path=[String(index)];if(!object(action))return fail('input',path,'原版 action 需要对象');
   const methodValue=read(action,'method',path),method=text(methodValue);if(method===undefined)return fail('input',[...path,'method'],'原版 action 缺少 method');
   const args=action.args,argsPath=[...path,'args'];
   if(method==='paramStart'||method==='paramStop'||method==='fractalParamStart'||method==='fractalParamStop'){
    const start=method==='paramStart'||method==='fractalParamStart',payload=sourceParticleGradientPayload(args),raw=payload?.value??{},base=[...argsPath,...payload?.path??[]];
    if(payload&&!Object.keys(raw).length)used.push(base);
    const domain=read(raw,'targetDomain',base);if(domain!=null&&(typeof domain!=='string'||javaTrim(domain)!==''&&domain.toUpperCase()!=='FRACTAL')){diagnostics.push(`${base.join('.')}: targetDomain 不匹配 FRACTAL，跳过参数动作。`);continue;}
    let params:Record<string,unknown>|undefined;if(own(raw,'parameters')){if(!object(raw.parameters))return fail('input',[...base,'parameters'],'原版 parameters 需要对象');params=raw.parameters;}
    const inherited=own(raw,'edgeEasing')?edge(raw.edgeEasing,global,[...base,'edgeEasing'],used,numeric,diagnostics):global;
    if(!params||!Object.keys(params).length){if(params)used.push([...base,'parameters']);facts.parameters.push({kind:start?'start':'stop',scope:{kind:'all'}});}
    else{
     const p=[...base,'parameters'],keys=options.memberOrder?.(p),actual=Object.keys(params);
     if(actual.length>SOURCE_FRACTAL_ACTION_LIMITS.parameters)return fail('capacity',p,'参数数量超过本地预算');
     if(!keys||keys.length!==actual.length||new Set(keys).size!==keys.length||keys.some(k=>typeof k!=='string'||!own(params!,k)))return fail('input',p,'需要完整原生 JSONObject 成员顺序');
     for(const name of keys){nameCharacters+=name.length;if(nameCharacters>SOURCE_FRACTAL_ACTION_LIMITS.nameCharacters)return fail('capacity',p,'参数名称超过本地字符预算');const config=params[name],cp=[...p,name];
      if(!object(config)){diagnostics.push(`${cp.join('.')}: 原版跳过非对象参数配置。`);continue;}
      if(own(config,'enable')&&!bool(read(config,'enable',cp),true,[...cp,'enable'],true))continue;
      if(!Object.keys(config).length)used.push(cp);
      if(start){const value=(key:'step'|'min'|'max',fallback:number)=>own(config,key)?fieldScalar(read(config,key,cp),[...cp,key],diagnostics):F(fallback);
       const step=value('step',.1),min=value('min',-1),max=value('max',1),selected=own(config,'edgeEasing')?edge(config.edgeEasing,inherited,[...cp,'edgeEasing'],used,numeric,diagnostics):inherited;
       facts.parameters.push({kind:'start',scope:{kind:'named',name},configuration:{step,min,max,edgeEasing:{window:Math.max(1e-6,selected.window),floor:Math.max(0,Math.min(1,selected.floor)),easing:selected.easing}}});
      }else facts.parameters.push({kind:'stop',scope:{kind:'named',name}});
     }
    }
    if(facts.parameters.length>SOURCE_FRACTAL_ACTION_LIMITS.parameters)return fail('capacity',path,'参数动作总数超过本地预算');
    continue;
   }
   if(method==='gradientStop'){facts.gradient={kind:'stop'};continue;}
   if(method==='gradientStart'){
    const payload=sourceParticleGradientPayload(args),raw=payload?.value??{},base=[...argsPath,...payload?.path??[]];if(payload&&!Object.keys(raw).length)used.push(base);
    const mode=enumText(read(raw,'mode',base),'hue_rotate',diagnostics),interpolation=enumText(read(raw,'interpolation',base),'oklab',diagnostics),speedRaw=read(raw,'speed',base);let speed=60;
    if(typeof speedRaw==='number')speed=Number.isFinite(speedRaw)?Math.max(0,speedRaw):60;
    else if(typeof speedRaw==='string'){const parsed=parseDomainSourceDouble(speedRaw);if(parsed.ok)speed=Number.isFinite(parsed.value)?Math.max(0,parsed.value):60;else if(parsed.error.kind==='capacity')return fail('capacity',[...base,'speed'],'渐变速度超过本地字符预算');}
    const affectInside=bool(read(raw,'affectInside',base),true,[]),affectOutside=bool(read(raw,'affectOutside',base),true,[]);
    if(!(SOURCE_PARTICLE_GRADIENT_MODES as readonly string[]).includes(mode)){diagnostics.push(`${base.join('.')}: 未识别渐变模式，保留此前有效渐变动作。`);continue;}
    if(!affectInside&&!affectOutside){diagnostics.push(`${base.join('.')}: 内外部均关闭，保留此前有效渐变动作。`);continue;}
    const validInterpolation=(SOURCE_PARTICLE_GRADIENT_INTERPOLATIONS as readonly string[]).includes(interpolation);
    if(!validInterpolation)diagnostics.push(`${base.join('.')}: 未识别渐变插值，采用 OKLAB。`);
    facts.gradient={kind:'start',config:{mode:mode as SourceGradientConfiguration['mode'],interpolation:validInterpolation?interpolation as SourceGradientConfiguration['interpolation']:'oklab',speed,affectInside,affectOutside}};continue;
   }
   const list=Array.isArray(args)?args:[],target=facts.targets;
   const arg=(i:number)=>{const p=[...argsPath,String(i)];used.push(p);if(typeof list[i]==='number')numeric.push(p);return scalar(list[i],p,diagnostics);};
   switch(method){
    case'center':if(list.length>=2)target.center=[arg(0),arg(1)];break;
    case'zoomFractal':if(list.length)target.zoom=arg(0);break;
    case'rotation':if(list.length)target.rotation=arg(0);break;
    case'fractalRotate':if(list.length)target.rotationRate=arg(0);break;
    case'ambient':if(list.length>=3)target.ambientRates=[arg(0),arg(1),arg(2)];else if(list.length){const v=arg(0);target.ambientRates=[v,v,0];}break;
    case'stopAmbient':target.ambientRates=[0,0,0];target.rotationRate=0;break;
    case'iterations':if(list.length)target.iterations=javaInt(arg(0));break;
    case'bailout':if(list.length)target.bailout=arg(0);break;
    case'julia':if(list.length>=2)target.julia=[arg(0),arg(1)];break;
    default:diagnostics.push(`${path.join('.')}: 原版分形忽略动作 ${method}。`);
   }
  }
  facts.diagnostics=[...new Set(diagnostics)];return{ok:true,value:facts};
 }catch(error){if(error instanceof Failure)return{ok:false,error:error.detail};throw error;}
}
