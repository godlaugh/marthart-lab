import type {Settings} from '../types';

export type SamilaHistoryModel='legacy-v1'|'bounded-v2';
export const SAMILA_HISTORY_CEILING=300;
const PARAMETER_EPSILON=1e-9,COMPENSATION_PASSES=6;
export interface SamilaHistoryState {parameters:Readonly<Record<string,number>>;fieldKey:string;}
export interface SamilaHistoryFrame {
 model:'bounded-v2';clear:boolean;passes:number;samples:number;randomFrames:readonly number[];densityCeiling:number;next:SamilaHistoryState;
}
export function samilaHistoryModel(settings:Settings):SamilaHistoryModel {
 const model=settings.samilaHistoryModel??'legacy-v1';
 if(model!=='legacy-v1'&&model!=='bounded-v2')throw new Error('Samila 历史模型无效');return model;
}
/** Explicit authoring action only; imported incompatible models still fail at
 * the tone boundary rather than silently rewriting the saved document. */
export function selectSamilaHistoryModel(settings:Settings,value:unknown):Settings {
 if(value!=='legacy-v1'&&value!=='bounded-v2')throw new Error('Samila 历史模型无效');
 const model=samilaHistoryModel({samilaHistoryModel:value});
 return{...settings,samilaHistoryModel:model,...(model==='legacy-v1'&&settings.densityToneModel==='samila-normalized-v2'?{densityToneModel:'white-point-v1'}:{})};
}
/** Shared source parameter acknowledgement; comparison is Java double. */
export function samilaParametersChanged(parameters:Readonly<Record<string,number>>,previous:Readonly<Record<string,number>>):boolean {
 const keys=Object.keys(parameters);if(keys.some(key=>!Number.isFinite(parameters[key])))throw Error('Samila 历史参数必须有限');
 return keys.length!==Object.keys(previous).length||keys.some(key=>!Object.hasOwn(previous,key)||Math.abs(parameters[key]-previous[key])>PARAMETER_EPSILON);
}
const checkedProduct=(a:number,b:number)=>{const value=a*b;if(!Number.isSafeInteger(value)||value<0)throw new Error('Samila 历史采样计数超出安全整数范围');return value;};
/** Acknowledged parameters are updated only on a parameter clear, not on an
 * unrelated field/structural clear. Small changes accumulate against that same
 * snapshot. Cold replay acknowledges its own starting values, never UI history. */
export function prepareSamilaHistoryFrame(input:{parameters:Readonly<Record<string,number>>;fieldKey:string;frame:number;count:number;record:boolean},previous?:SamilaHistoryState,forceClear=false):SamilaHistoryFrame {
 const {parameters,fieldKey,frame,count,record}=input;
 if(!Number.isSafeInteger(frame)||frame<0||!Number.isSafeInteger(count)||count<1||count>8_000_000||typeof record!=='boolean')throw new Error('Samila 历史帧边界无效');
 const keys=Object.keys(parameters).sort();if(keys.some(key=>!Number.isFinite(parameters[key])))throw new Error('Samila 历史参数必须有限');
 const changed=!!previous&&samilaParametersChanged(parameters,previous.parameters);
 const passes=record?(changed?COMPENSATION_PASSES:1):0,samples=checkedProduct(count,passes),first=checkedProduct(frame,COMPENSATION_PASSES);
 const randomFrames=Array.from({length:passes},(_,pass)=>{const value=first+pass;if(!Number.isSafeInteger(value))throw new Error('Samila 随机批次地址超出安全整数范围');return value;});
 return{model:'bounded-v2',clear:forceClear||!previous||changed||previous.fieldKey!==fieldKey,passes,samples,randomFrames,densityCeiling:SAMILA_HISTORY_CEILING,next:{parameters:!previous||changed?Object.fromEntries(keys.map(key=>[key,parameters[key]])):previous.parameters,fieldKey}};
}
/** Local ink is weighted RGB followed by mass. Copy once per fixed frame,
 * before any of its new batches; the final splat is allowed to exceed 300. */
export function copySamilaHistory(ink:Float64Array,decay:number,ceiling:number,isCancelled?:()=>boolean):void {
 if(ink.length%4||!Number.isFinite(decay)||decay<0||decay>1||ceiling!==SAMILA_HISTORY_CEILING)throw new Error('Samila 历史复制配置无效');
 for(let i=0;i<ink.length;i+=4){
  if((i&65535)===0&&isCancelled?.())throw new DOMException('Samila 历史复制已取消','AbortError');
  for(let k=0;k<4;k++)ink[i+k]*=decay;
  const mass=ink[i+3];if(mass>ceiling){const ratio=ceiling/mass;for(let k=0;k<3;k++)ink[i+k]*=ratio;ink[i+3]=ceiling;}
 }
}
