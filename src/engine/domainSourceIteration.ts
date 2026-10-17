import type {Settings} from '../types';
import {isJavaBlank,javaTrim} from './sourceJavaText';
export {isJavaBlank} from './sourceJavaText';

export type DomainIterationVersion='local-v1'|'mathart-1.7.8'|'mathart-1.7.8-cpu'|'mathart-1.7.8-gpu';
export function parseDomainIterationVersion(value:unknown):DomainIterationVersion {
 if(value===undefined||value==='local-v1')return'local-v1';
 if(value==='mathart-1.7.8'||value==='mathart-1.7.8-cpu'||value==='mathart-1.7.8-gpu')return value;
 throw new Error('域着色公式执行规则无效');
}

export function normalizeDomainNativeNext(source:string|undefined):string|undefined {
 const value=source===undefined?undefined:javaTrim(source);
 return value===undefined||isJavaBlank(value)?undefined:value;
}

export interface DomainExecutionPolicy {
 readonly version:DomainIterationVersion;
 readonly requestedVersion:DomainIterationVersion;
 readonly fallbackReason?:string;
 readonly arithmetic:'local'|'native-cpu'|'native-gpu';
 readonly source?:DomainSourceIteration;
 readonly iteration:boolean;
 /** A parsed next is applicable independently of whether more than one step runs. */
 readonly nextEnabled:boolean;
 readonly stop:'stable-magnitude'|'double-squared'|'float-squared';
 readonly repair:'whole-orbit'|'captured-value-color-only';
}

/** Sole owner of execution-version decisions. Backend preference and the color
 * and viewport versions cannot silently select another arithmetic contract. */
export function prepareDomainExecution(settings:Settings):DomainExecutionPolicy {
 const version=parseDomainIterationVersion(settings.domainIterationVersion);
 const enabled=settings.iterationEnabled??false;
 if(typeof enabled!=='boolean')throw new Error('iterationEnabled 必须为布尔值');
 if(version==='local-v1')return Object.freeze({version,requestedVersion:version,arithmetic:'local',iteration:enabled,nextEnabled:enabled,stop:'stable-magnitude',repair:'whole-orbit'});
 const source=Object.freeze(parseDomainSourceIteration(settings));
 const arithmetic=version==='mathart-1.7.8-cpu'?'native-cpu':version==='mathart-1.7.8-gpu'?'native-gpu':'local';
 return Object.freeze({version,requestedVersion:version,arithmetic,source,iteration:true,nextEnabled:arithmetic!=='native-gpu'||enabled,stop:arithmetic==='native-cpu'?'double-squared':arithmetic==='native-gpu'?'float-squared':'stable-magnitude',repair:arithmetic==='native-gpu'?'captured-value-color-only':'whole-orbit'});
}

/** Source expressions that cannot form a native GPU program follow its CPU
 * expression fallback. Keep requested identity and reason separate from facts. */
export function nativeCpuExpressionFallback(policy:DomainExecutionPolicy,reason:string):DomainExecutionPolicy {
 if(policy.arithmetic!=='native-gpu')throw new Error('只有原产物 GPU 公式可以使用此回退');
 return Object.freeze({...policy,version:'mathart-1.7.8-cpu',arithmetic:'native-cpu',nextEnabled:true,stop:'double-squared',repair:'whole-orbit',fallbackReason:reason});
}

export interface DomainSourceIteration {
 /** Authored values are facts, never written back as normalized settings. */
 enabled:boolean;authoredSteps:number;authoredMaxSteps:number;
 steps:number;escapeRadius:number;
}

/** DomainIterationParams.normalized + resolveIterationSteps, for the explicit
 * explicit source iteration version only. Source enabled=false still executes one seeded
 * step; it does not select the local-v1 direct-formula branch. */
export function parseDomainSourceIteration(settings:Settings):DomainSourceIteration {
 const enabled=settings.iterationEnabled??false;
 if(typeof enabled!=='boolean')throw new Error('iterationEnabled 必须为布尔值');
 const integer=(key:string,fallback:number)=>{
  const value=settings[key]??fallback;
  if(typeof value!=='number'||!Number.isInteger(value)||value < -2147483648||value>2147483647)throw new Error(key+' 必须为有符号 32 位整数');
  return value;
 };
 const authoredSteps=integer('iterationSteps',1),authoredMaxSteps=integer('iterationMaxSteps',64);
 const normalizedMax=authoredMaxSteps>0?authoredMaxSteps:64;
 const normalizedSteps=authoredSteps>0?Math.min(authoredSteps,normalizedMax):1;
 const rawEscape=settings.bailout??1e6;
 if(typeof rawEscape!=='number')throw new Error('bailout 必须为数值');
 const escape=Math.fround(rawEscape),normalizedEscape=Number.isFinite(escape)&&escape>0?escape:1e6;
 return{enabled,authoredSteps,authoredMaxSteps,steps:enabled?Math.min(Math.max(normalizedSteps,1),Math.max(1,Math.min(normalizedMax,256))):1,escapeRadius:Math.max(normalizedEscape,1)};
}
