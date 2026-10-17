import {prepareRootsSourceJsonInt, type RootsSourceJsonIntegerFacts} from './rootsSourceOrder';

/** Authored project canvas dimensions. Omission is owned by the document and
 * retains the caller's existing sizing policy; this payload has no DPI unit. */
export interface ProjectResolution {width:number; height:number}
export const PROJECT_RESOLUTION_MIN=64;
export const PROJECT_RESOLUTION_MAX=8192;
export type ProjectResolutionError = {kind:'input'; field:'resolution'|'width'|'height'; reason:string};
export class ProjectResolutionInputError extends Error {
 readonly kind='input';
 constructor(readonly failure:ProjectResolutionError){super(failure.reason);this.name='ProjectResolutionInputError';}
}
type Result<T,E> = {ok:true; value:T}|{ok:false; error:E};
const object = (raw:unknown):raw is Record<string,unknown> => raw!==null&&typeof raw==='object'&&!Array.isArray(raw);
const own = (raw:Record<string,unknown>, key:string):unknown => Object.hasOwn(raw,key)?raw[key]:undefined;
const validDimension = (raw:unknown):raw is number => typeof raw==='number'&&Number.isInteger(raw)&&raw>=PROJECT_RESOLUTION_MIN&&raw<=PROJECT_RESOLUTION_MAX;

/** Canonical documents carry integer dimensions, never source coercions. */
export function prepareProjectResolution(raw:unknown):Result<ProjectResolution,ProjectResolutionError> {
 if(!object(raw))return {ok:false,error:{kind:'input',field:'resolution',reason:'项目分辨率应为对象'}};
 const width=own(raw,'width'),height=own(raw,'height');
 if(!validDimension(width))return {ok:false,error:{kind:'input',field:'width',reason:'项目宽度应为 64 至 8192 的整数'}};
 if(!validDimension(height))return {ok:false,error:{kind:'input',field:'height',reason:'项目高度应为 64 至 8192 的整数'}};
 return {ok:true,value:{width,height}};
}
export function parseProjectResolution(raw:unknown):ProjectResolution {
 const result=prepareProjectResolution(raw);
 if(!result.ok)throw new ProjectResolutionInputError(result.error);
 return result.value;
}
/** Compare already parsed authored facts; omission has its own identity. */
export function sameProjectResolution(a?:ProjectResolution,b?:ProjectResolution):boolean {
 return a===undefined?b===undefined:b!==undefined&&a.width===b.width&&a.height===b.height;
}

type SourceIntegerError = Extract<ReturnType<typeof prepareRootsSourceJsonInt>,{ok:false}>['error'];
export type SourceProjectResolutionError = {kind:'source-integer';field:'width'|'height';cause:SourceIntegerError};
export type SourceProjectResolutionFacts =
 | {status:'missing'}
 | {status:'ignored';reason:'container';raw:unknown}
 | {status:'ignored';reason:'dimensions';raw:unknown;dimensions:{width:RootsSourceJsonIntegerFacts<number>;height:RootsSourceJsonIntegerFacts<number>}}
 | {status:'applied';value:ProjectResolution;raw:unknown;dimensions:{width:RootsSourceJsonIntegerFacts<number>;height:RootsSourceJsonIntegerFacts<number>}};

/** ProjectState.fromJson @228–342: start with no override, getInt(key,0),
 * commit both dimensions only when both are in [64,8192]. The retained catch
 * covers malformed containers as well as conversion failures. Metadata or
 * local resource failures remain errors; they are not authored fallback.
 * JSONObject integer semantics stay in the existing numeric owner. */
export function prepareSourceProjectResolution(raw:unknown,numberTokens:{width?:string;height?:string}={}):Result<SourceProjectResolutionFacts,SourceProjectResolutionError> {
 if(raw===undefined)return {ok:true,value:{status:'missing'}};
 if(!object(raw))return {ok:true,value:{status:'ignored',reason:'container',raw}};
 const width=prepareRootsSourceJsonInt(own(raw,'width'),0,numberTokens.width);
 if(!width.ok)return {ok:false,error:{kind:'source-integer',field:'width',cause:width.error}};
 const height=prepareRootsSourceJsonInt(own(raw,'height'),0,numberTokens.height);
 if(!height.ok)return {ok:false,error:{kind:'source-integer',field:'height',cause:height.error}};
 const dimensions={width:width.value,height:height.value};
 const prepared=prepareProjectResolution({width:width.value.value,height:height.value.value});
 return {ok:true,value:prepared.ok?{status:'applied',value:prepared.value,raw,dimensions}:{status:'ignored',reason:'dimensions',raw,dimensions}};
}
