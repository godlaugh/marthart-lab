import type {AnimationAction,AnimationTrack} from '../types';
import {prepareDomainSourceScalar,parseDomainSourceDouble} from './domainSourceScalar';
import {lookupSourceEasing} from './sourceEasing';
import {javaEqualsIgnoreCaseAscii} from './sourceJavaText';
import {normalizeSourceSamilaParameterAction} from './sourceSamilaParameter';
import {timelineTrackCost,TIMELINE_OPERATION_LIMIT} from './timelineCapacity';

type Path=readonly string[];
interface SourcePorts {numberToken(path:Path):string|undefined;memberKeys(path:Path):readonly string[];}
interface Facts {tracks:AnimationTrack[];consumedPaths:string[][];numericPaths:string[][];warnings:string[];}
type Result={ok:true;value:Facts}|{ok:false;error:{kind:'input'|'capacity';path:Path;reason:string}};
class ImportFailure extends Error {constructor(readonly detail:Extract<Result,{ok:false}>['error']){super(detail.reason);}}
const object=(raw:unknown):raw is Record<string,unknown>=>!!raw&&typeof raw==='object'&&!Array.isArray(raw);
/** JsonSamilaConfig.setupTimeline. Preserve source dispatch and getter facts;
 * the replay owner alone interprets normalized children and frame chronology. */
export function importSourceSamilaTimeline(raw:unknown,ports:SourcePorts):Result {
 const consumedPaths:string[][]=[],numericPaths:string[][]=[],warnings:string[]=[];
 const fail=(path:Path,reason:string,kind:'input'|'capacity'='input'):never=>{throw new ImportFailure({kind,path,reason});};
 const use=(value:unknown,path:Path)=>{consumedPaths.push([...path]);return value;};
 const get=(value:Record<string,unknown>,key:string,path:Path)=>Object.hasOwn(value,key)?use(value[key],[...path,key]):undefined;
 const numberClass=(value:unknown,path:Path)=>Object.is(value,-0)&&ports.numberToken(path)==='-0'?0:value;
 const scalar=(value:unknown,path:Path,fallback:number)=>{
  if(typeof value==='number')numericPaths.push([...path]);
  const result=prepareDomainSourceScalar(numberClass(value,path),{fallback,precision:'float32'});
  if(!result.ok)return fail(path,'源标量解析超过本地容量','capacity');
  if(!Number.isFinite(result.facts.value))return fail(path,'源时间线数值不是有限 Float32');
  return result.facts.value;
 };
 const boolean=(value:unknown,path:Path,fallback:boolean,strict=false)=>{
  if(value===undefined)return fallback;if(typeof value==='boolean')return value;
  if(typeof value==='string'){if(javaEqualsIgnoreCaseAscii(value,'true'))return true;if(javaEqualsIgnoreCaseAscii(value,'false'))return false;}
  if(strict)return fail(path,'源片段 enabled 必须为布尔值或 true/false 字符串');return fallback;
 };
 const double=(value:unknown,path:Path,fallback:number)=>{
  if(typeof value==='number')numericPaths.push([...path]);
  let parsed=fallback;
  if(typeof value==='number')parsed=numberClass(value,path) as number;
  else if(typeof value==='string'){const result=parseDomainSourceDouble(value);if(result.ok)parsed=result.value;else if(result.error.kind==='capacity')return fail(path,'参数字面量超过本地容量','capacity');}
  if(!Number.isFinite(parsed))return fail(path,'源参数动画需要有限 double');return parsed;
 };
 try{
  if(raw===undefined)return{ok:true,value:{tracks:[],consumedPaths,numericPaths,warnings}};
  if(!Array.isArray(raw))return fail(['timeline'],'源时间线必须为数组');
  if(raw.length>1000)return fail(['timeline'],'源时间线超过本地 1000 段容量','capacity');
  if(!raw.length)consumedPaths.push(['timeline']);
  const tracks:AnimationTrack[]=[];let work=0;
  for(let i=0;i<raw.length;i++){
   const clip=raw[i],path=['timeline',String(i)];if(!object(clip))return fail(path,'源片段必须为对象');
   if(!boolean(get(clip,'enabled',path),[...path,'enabled'],true,Object.hasOwn(clip,'enabled'))){consumedPaths.push(path);continue;}
   const rawType=get(clip,'type',path),type=rawType==null?'wait':typeof rawType==='string'?rawType.toLowerCase():'unknown';
   const duration=scalar(get(clip,'duration',path),[...path,'duration'],1);
   if(duration>86400)return fail([...path,'duration'],'源片段超过本地 24 小时容量','capacity');
   const track:AnimationTrack={id:crypto.randomUUID(),type:type==='animate'?'animate':'wait',target:type==='animate'?'camera.actions':'timeline.wait',from:0,to:0,start:0,duration,easing:'linear',pingPong:false,enabled:true,label:typeof rawType==='string'?rawType:type};
   if(type!=='wait'&&type!=='animate')warnings.push(`${path.join('.')}：原版将此类型作为等待，未执行其本地同名动作；原值保留。`);
   if(type==='animate'){
    track.easing=lookupSourceEasing(get(clip,'easing',path))??'sine-in-out';track.actions=[];
    const actions=clip.actions;if(Array.isArray(actions)&&!actions.length)consumedPaths.push([...path,'actions']);
    if(actions!==undefined){
     if(!Array.isArray(actions))return fail([...path,'actions'],'源动作必须为数组');
     if(actions.length>64)return fail([...path,'actions'],'源片段超过本地 64 个动作容量','capacity');
     for(let j=0;j<actions.length;j++){
      const action=actions[j],ap=[...path,'actions',String(j)];if(!object(action))return fail(ap,'源动作必须为对象');
      const method=get(action,'method',ap),args=action.args,argPath=[...ap,'args'];
      if(typeof method!=='string'||(!Array.isArray(args)&&!object(args)))continue;
      if(method==='paramStart'||method==='paramStop'){
       const payload=Array.isArray(args)?args[0]:args,pp=Array.isArray(args)?[...argPath,'0']:argPath;
       if(!object(payload))continue;
       const values=payload.parameters;if(object(values)&&!Object.keys(values).length)consumedPaths.push([...pp,'parameters']);if(!Object.keys(payload).length)consumedPaths.push([...pp]);const parameters:{name:string;min:number;max:number;step:number}[]=[];
       if(values!==undefined){
        if(!object(values))return fail([...pp,'parameters'],'源 parameters 必须为对象');
        for(const name of ports.memberKeys([...pp,'parameters'])){
         const value=values[name],vp=[...pp,'parameters',name];if(!object(value))continue;
         if(!boolean(get(value,'enable',vp),[...vp,'enable'],true))continue;
         parameters.push({name,min:double(get(value,'min',vp),[...vp,'min'],-1),max:double(get(value,'max',vp),[...vp,'max'],1),step:double(get(value,'step',vp),[...vp,'step'],.001)});
         if(parameters.length>4096)return fail(vp,'源参数动作超过本地总工作容量','capacity');
        }
       }
       const normalized=normalizeSourceSamilaParameterAction({model:'samila-param-1.7.8',kind:method==='paramStart'?'start':'stop',parameters});
       if(!normalized.ok)return fail(pp,normalized.error.reason,normalized.error.kind);
       track.actions.push({id:crypto.randomUUID(),method,samilaParameters:normalized.value});continue;
      }
      if(!Array.isArray(args))continue;
      const argument=(index:number)=>scalar(index<args.length?use(args[index],[...argPath,String(index)]):undefined,[...argPath,String(index)],0);
      let normalized:AnimationAction['args']|undefined;
      if(['rotateTheta','rotatePhi','rotateGamma'].includes(method))normalized={angle:argument(0)};
      else if(method==='zoom'||method==='focal')normalized={value:argument(0)};
      else if(method==='rotateTo'&&args.length>=3)normalized={phi:argument(0),theta:argument(1),gamma:argument(2)};
      else if(method==='ambient'&&args.length>=2)normalized={phiSpeed:argument(0),thetaSpeed:argument(1),gammaSpeed:args.length>=3?argument(2):0};
      else if(method==='stopAmbient')normalized={};
      if(normalized)track.actions.push({id:crypto.randomUUID(),method,args:normalized});
     }
    }
   }
   work+=timelineTrackCost(track);if(work>TIMELINE_OPERATION_LIMIT)return fail(path,'时间线动作与参数总数超过4096个','capacity');tracks.push(track);
  }
  return{ok:true,value:{tracks,consumedPaths,numericPaths,warnings}};
 }catch(error){if(error instanceof ImportFailure)return{ok:false,error:error.detail};throw error;}
}
