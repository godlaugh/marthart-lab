import {SOURCE_FRACTAL_RETAINED_LIMITS} from './sourceFractalLimits';
import {sourceFractalFormulaIdentity} from './sourceFractalIdentity';
import type {SceneDocument} from '../types';
import {createSourceFractalFormulaFromConfig,type SourceFractalFormulaConfiguration} from './sourceFractalFormulaRuntime';
import {SourceFractalSceneClock,type SourceFractalAnimationTargets} from './sourceFractalSceneClock';
import type {SourceFractalParameterAction} from './sourceFractalParameterRuntime';
import type {SourceGradientAction} from './sourceGradientRuntime';
import {SOURCE_EASING_NAMES} from './sourceEasing';

export const FRACTAL_SCENE_SEQUENCE='fractal-scene-sequence-v1' as const;
export interface SourceFractalDocumentPayload {model:'mathart-1.7.8-scene-v1';formula:SourceFractalFormulaConfiguration;}
export interface SourceFractalActionsPayload {model:'mathart-1.7.8-actions-v1';targets:SourceFractalAnimationTargets;parameters:readonly SourceFractalParameterAction[];gradient?:SourceGradientAction;}
export type SourceFractalDocumentResult<T>={ok:true;value:T}|{ok:false;error:{kind:'input'|'capacity';path:readonly string[];reason:string}};
class Failure extends Error {constructor(readonly kind:'input'|'capacity',readonly path:readonly string[],reason:string){super(reason);}}
const fail=(path:readonly string[],reason:string,kind:'input'|'capacity'='input'):never=>{throw new Failure(kind,path,reason);};
function exact(raw:unknown,keys:readonly string[],path:string[]):Record<string,unknown>{if(!raw||typeof raw!=='object'||Array.isArray(raw))return fail(path,'需要对象');for(const key of Object.keys(raw))if(!keys.includes(key))fail([...path,key],'未知字段');return raw as Record<string,unknown>;}
const finite=(raw:unknown,path:string[])=>typeof raw==='number'&&Number.isFinite(raw)?raw:fail(path,'需要有限数值');
function numbers(raw:unknown,count:number,path:string[]):number[]{if(!Array.isArray(raw)||raw.length!==count)return fail(path,`需要 ${count} 个分量`);return raw.map((value,i)=>finite(value,[...path,String(i)]));}
function attempt<T>(read:()=>T):SourceFractalDocumentResult<T>{try{return{ok:true,value:read()};}catch(error){return{ok:false,error:{kind:error instanceof Failure?error.kind:'input',path:error instanceof Failure?error.path:[],reason:error instanceof Error?error.message:String(error)}};}}
export function usesSourceFractal(scene:Pick<SceneDocument,'kind'|'fractalSource'>):boolean{return scene.kind==='fractal'&&scene.fractalSource!==undefined;}
/** Readiness is pure document identity, independent of live/GPU resources. */
export function supportsSourceFractalLive(scene:SceneDocument):boolean {
 if(!usesSourceFractal(scene)||scene.timeline.schedule!==FRACTAL_SCENE_SEQUENCE)return false;
 const formula=sourceFractalFormulaIdentity(scene.fractalSource!.formula);return formula==='newton'||formula==='nova'||formula==='mandelbrot'||formula==='julia';
}
export function parseSourceFractalDocument(raw:unknown):SourceFractalDocumentResult<SourceFractalDocumentPayload>{return attempt(()=>{
 const input=exact(raw,['model','formula'],[]);if(input.model!=='mathart-1.7.8-scene-v1')return fail(['model'],'未知分形场景规则');
 const formula=exact(input.formula,['formulaId','fractalType','power','formulaParams','bailout','julia','parameters'],['formula']);
 if(formula.formulaId!==undefined&&formula.formulaId!==null&&typeof formula.formulaId!=='string')fail(['formula','formulaId'],'公式标识需要字符串或 null');
 if(formula.fractalType!=='mandelbrot'&&formula.fractalType!=='julia')fail(['formula','fractalType'],'未知分形变体');
 finite(formula.power,['formula','power']);finite(formula.bailout,['formula','bailout']);numbers(formula.formulaParams,4,['formula','formulaParams']);numbers(formula.julia,2,['formula','julia']);
 if(formula.parameters!==undefined){
  const parameters=exact(formula.parameters,['floats','complex'],['formula','parameters']);
  for(const kind of ['floats','complex'] as const){const values=parameters[kind];if(!values||typeof values!=='object'||Array.isArray(values))fail(['formula','parameters',kind],'需要参数对象');if(Object.keys(values as object).length>64)fail(['formula','parameters',kind],'参数数量超过容量','capacity');for(const[key,value]of Object.entries(values as object)){if(kind==='floats')finite(value,['formula','parameters',kind,key]);else numbers(value,2,['formula','parameters',kind,key]);}}
 }
 const payload=structuredClone(input) as unknown as SourceFractalDocumentPayload;
 createSourceFractalFormulaFromConfig(payload.formula); // Owner validates metadata and native representability.
 return payload;
});}
/** Saved action payload is already interpreted. Never feed it back through the
 * original JSON adapter, which would reapply defaults and HashMap ordering. */
export function parseSourceFractalActionsPayload(raw:unknown,reserve?:(actions:number,nameCharacters:number)=>void):SourceFractalDocumentResult<SourceFractalActionsPayload>{return attempt(()=>{
 const value=exact(raw,['model','targets','parameters','gradient'],[]);if(value.model!=='mathart-1.7.8-actions-v1')fail(['model'],'未知分形动作规则');
 const targets=exact(value.targets,['center','zoom','rotation','rotationRate','ambientRates','iterations','bailout','julia'],['targets']);
 for(const[key,item]of Object.entries(targets))if(['center','julia','ambientRates'].includes(key))numbers(item,key==='ambientRates'?3:2,['targets',key]);else finite(item,['targets',key]);
 if(!Array.isArray(value.parameters)||value.parameters.length>SOURCE_FRACTAL_RETAINED_LIMITS.parameters)fail(['parameters'],'分形参数动作需要最多 4096 项数组','capacity');
 let characters=0;
 for(const[index,item]of (value.parameters as unknown[]).entries()){
  const path=['parameters',String(index)],action=exact(item,['kind','scope','configuration'],path);
  if(action.kind!=='start'&&action.kind!=='stop')fail([...path,'kind'],'未知参数操作');
  const scope=exact(action.scope,['kind','name'],[...path,'scope']);if(scope.kind==='named'){if(typeof scope.name!=='string')fail([...path,'scope','name'],'名称需要字符串');characters+=(scope.name as string).length;}else if(scope.kind!=='all'||scope.name!==undefined)fail([...path,'scope'],'无效参数范围');
  if(action.configuration!==undefined){
   if(action.kind!=='start'||scope.kind!=='named')fail([...path,'configuration'],'只有具名开始包含配置');
   const c=exact(action.configuration,['min','max','step','edgeEasing'],[...path,'configuration']);for(const key of ['min','max','step'])finite(c[key],[...path,'configuration',key]);
   if(c.edgeEasing!==undefined){const edge=exact(c.edgeEasing,['window','floor','easing'],[...path,'configuration','edgeEasing']);finite(edge.window,path);finite(edge.floor,path);if(!SOURCE_EASING_NAMES.includes(edge.easing as string))fail(path,'未知端点缓动');}
  }else if(action.kind==='start'&&scope.kind==='named')fail(path,'具名开始缺少参数配置');
 }
 if(characters>SOURCE_FRACTAL_RETAINED_LIMITS.nameCharacters)fail(['parameters'],'参数名称超过字符预算','capacity');
 if(value.gradient!==undefined){const gradient=exact(value.gradient,['kind','config'],['gradient']);if(gradient.kind==='start'){const c=exact(gradient.config,['mode','speed','interpolation','affectInside','affectOutside'],['gradient','config']);if(typeof c.mode!=='string'||!['offset_cycle','hue_rotate','palette_morph','cross_fade'].includes(c.mode)||typeof c.interpolation!=='string'||!['rgb','linear','oklab','oklch'].includes(c.interpolation))fail(['gradient'],'未知渐变规则');finite(c.speed,['gradient','config','speed']);for(const flag of ['affectInside','affectOutside'])if(c[flag]!==undefined&&typeof c[flag]!=='boolean')fail(['gradient','config',flag],'需要布尔值');}else if(gradient.kind!=='stop'||gradient.config!==undefined)fail(['gradient'],'无效渐变停止');}
 reserve?.((value.parameters as unknown[]).length+(value.gradient?1:0),characters);
 const payload=structuredClone(value) as unknown as SourceFractalActionsPayload;
 // The clock owns target narrowing; validate it without advancing callbacks.
 new SourceFractalSceneClock({centerX:0,centerY:0,centerXLow:0,centerYLow:0,zoom:1,rotation:0,rotationRate:0,iterations:1,bailout:4,juliaReal:0,juliaImag:0,ambientAngles:[0,0,0],ambientRates:[0,0,0],currentTime:0},[{kind:'animate',duration:1,easing:'linear',targets:payload.targets}]);
 return payload;
});}
