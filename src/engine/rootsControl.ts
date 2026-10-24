import {sourceHotPalettePackedColor} from './sourceConfigColor';
import type {RootsSourcePalette,SceneDocument} from '../types';
import {parseRootsSourcePalette,normalizeRootsSourceToneField,prepareRootsDensityColor} from './rootsDensityColor';
import {parseRootsPresentationConfiguration,type RootsPresentationConfiguration} from './rootsPresentationConfig';
import {parseRootsMath,usesRootsNativeMath} from './rootsMathConfig';
import {prepareRootsCameraTimeline,usesRootsCameraTimeline} from './rootsCameraTimeline';
import {usesRootsNativePresentation} from './rootsPresentationAuthoring';
import {resolveFormulaContent} from './formulas';
import {RootsGpuError,rootsGpuCancel} from './rootsGpuFailure';

export const ROOTS_CONTROL_MAX_BYTES=768*1024*1024;
export interface RootsControlTone {brightness?:number;contrast?:number;gamma?:number;dynamicRange?:number;saturation?:number;dotSize?:number;}
export type RootsControlPayload=
 |{kind:'apply';scene:SceneDocument}|{kind:'restart'}|{kind:'palette';palette?:RootsSourcePalette}
 |{kind:'tone';tone:RootsControlTone}|{kind:'transform';transform:RootsPresentationConfiguration['transform']}
 |{kind:'camera';camera:Pick<RootsPresentationConfiguration['camera'],'phi'|'theta'|'gamma'|'zoom'>}
 |{kind:'offset';offset:number};
export type RootsControlCommand=RootsControlPayload&{revision:number};
export interface RootsControls {acknowledgedRevision:number;commands:RootsControlCommand[];}
/** resetRevision counts Apply, explicit restart and recording-start resets. */
export interface RootsControlReceipt {revision:number;applyRevision:number;resetRevision:number;}
export class RootsControlError extends RootsGpuError {constructor(message:string,kind:'input'|'capacity'='input'){super(message,kind);}}
const fail=(message:string):never=>{throw new RootsControlError(message);};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const natural=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const toneKeys={brightness:'rootSourceBrightness',contrast:'rootSourceContrast',gamma:'rootSourceGamma',dynamicRange:'rootSourceDynamicRange',saturation:'rootSourceSaturation'} as const;
/** Representation admission, including the expanded serialized size of shared subgraphs.
 * Cyclic or non-data inputs are rejected before cloning/stringification. */
export function rootsControlRepresentationBytes(value:unknown):number {
 const sizes=new Map<object,number>(),active=new Set<object>();
 type Frame={value:unknown;keys?:string[];index:number;bytes:number};
 const stack:Frame[]=[{value,index:0,bytes:0}];let result=0;
 const done=(bytes:number)=>{stack.pop();if(stack.length){stack[stack.length-1].bytes+=bytes;if(stack[stack.length-1].bytes>ROOTS_CONTROL_MAX_BYTES)throw new RootsControlError('复根控制描述超过 768 MiB','capacity');}else result=bytes;};
 while(stack.length){const frame=stack[stack.length-1],v=frame.value;
  if(frame.keys){if(frame.index===frame.keys.length){active.delete(v as object);sizes.set(v as object,frame.bytes);done(frame.bytes);continue;}const key=frame.keys[frame.index++];frame.bytes+=16+key.length*2;stack.push({value:(v as Record<string,unknown>)[key],index:0,bytes:0});continue;}
  if(v===undefined||v===null||typeof v==='boolean'){done(8);continue;}
  if(typeof v==='number'){if(!Number.isFinite(v))fail('复根控制描述需要有限数字');done(8);continue;}
  if(typeof v==='string'){done(16+v.length*2);continue;}
  if(typeof v!=='object')return fail('复根控制描述只能包含数据');
  if(active.has(v))return fail('复根控制描述不能循环引用');const cached=sizes.get(v);if(cached!==undefined){done(cached);continue;}
  if(Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null&&!Array.isArray(v))return fail('复根控制描述需要普通对象');
  active.add(v);frame.keys=Object.keys(v);frame.bytes=Array.isArray(v)?64+v.length*8:64;if(frame.bytes>ROOTS_CONTROL_MAX_BYTES)throw new RootsControlError('复根控制描述超过 768 MiB','capacity');
 }
 if(result>ROOTS_CONTROL_MAX_BYTES)throw new RootsControlError('复根控制描述超过 768 MiB','capacity');return result;
}
function identity(value:unknown):string {
 rootsControlRepresentationBytes(value);const chunks:string[]=[];
 // Tagged tokens distinguish -0, undefined, arrays and user objects without
 // reserving any authored property name. Expand only after bounded admission.
 const pending:({value:unknown}|{literal:string})[]=[{value}];
 while(pending.length){const item=pending.pop()!;if('literal'in item){chunks.push(item.literal);continue;}const v=item.value;
  if(v===undefined)chunks.push('u');else if(v===null)chunks.push('n');else if(typeof v==='boolean')chunks.push(v?'b1':'b0');else if(typeof v==='number')chunks.push('d'+(Object.is(v,-0)?'-0':String(v))+';');else if(typeof v==='string')chunks.push('s'+v.length+':'+v);else{const keys=Object.keys(v as object).sort();chunks.push((Array.isArray(v)?'a'+v.length+':':'o')+keys.length+'{');pending.push({literal:'}'});for(let i=keys.length-1;i>=0;i--){pending.push({value:(v as Record<string,unknown>)[keys[i]]},{value:keys[i]});}}
 }
 return chunks.join('');
}
function freezeOwned<T>(value:T):T {const pending:unknown[]=[value],seen=new Set<object>();while(pending.length){const v=pending.pop();if(v&&typeof v==='object'&&!seen.has(v)){seen.add(v);for(const child of Object.values(v))pending.push(child);Object.freeze(v);}}return value;}
function exact(value:Record<string,unknown>,keys:readonly string[],label:string){if(Object.keys(value).some(k=>!keys.includes(k)))fail('未知复根'+label+'字段');}
function float(value:unknown):number {if(typeof value!=='number'||!Number.isFinite(value)||!Number.isFinite(Math.fround(value)))return fail('复根热控制必须为有限 Float32');return Math.fround(value);}
function validateScene(scene:SceneDocument):void {
 if(!record(scene)||!usesRootsNativePresentation(scene)||!usesRootsNativeMath(scene)||!record(scene.settings)||scene.settings.rootsMode!=='progressive'||!usesRootsCameraTimeline(scene))fail('Apply 需要完整源复根配置');
 parseRootsMath(scene.rootsMath);const p=parseRootsPresentationConfiguration(scene.rootsPresentation);if(!p.pending)fail('Apply 需要显式待绘制预算');
 if(prepareRootsDensityColor(scene).kind!=='metric-sum')fail('Apply 需要源平均度量配色');
 prepareRootsCameraTimeline(scene);resolveFormulaContent(scene);
}
function validateCommand(raw:unknown):asserts raw is RootsControlCommand {
 if(!record(raw)||!natural(raw.revision)||raw.revision<1)return fail('复根命令 revision 必须从 1 开始');
 switch(raw.kind){
  case'apply':exact(raw,['kind','revision','scene'],'Apply');validateScene(raw.scene as SceneDocument);break;
  case'restart':exact(raw,['kind','revision'],'restart');break;
  case'palette':exact(raw,['kind','revision','palette'],'palette');if(raw.palette!==undefined)parseRootsSourcePalette(raw.palette);break;
  case'tone':exact(raw,['kind','revision','tone'],'tone');if(!record(raw.tone))fail('复根 tone 需要对象');else{exact(raw.tone,[...Object.keys(toneKeys),'dotSize'],'tone');for(const [key,value]of Object.entries(raw.tone)){float(value);if(key==='dotSize'){if((value as number)<=0)fail('复根点尺寸必须为正');}else normalizeRootsSourceToneField(toneKeys[key as keyof typeof toneKeys],value as number);}}break;
  case'transform':exact(raw,['kind','revision','transform'],'transform');if(!record(raw.transform))fail('复根 transform 需要对象');else{exact(raw.transform,['scale','offset','rotationDegrees'],'transform');for(const key of ['scale','offset']){const a=raw.transform[key];if(!Array.isArray(a)||a.length!==3)fail('复根 transform 需要三元数组');else a.forEach(float);}float(raw.transform.rotationDegrees);}break;
  case'camera':exact(raw,['kind','revision','camera'],'camera');if(!record(raw.camera))fail('复根 camera 需要对象');else{exact(raw.camera,['phi','theta','gamma','zoom'],'camera');for(const key of ['phi','theta','gamma','zoom'])float(raw.camera[key]);}break;
  case'offset':exact(raw,['kind','revision','offset'],'offset');normalizeRootsSourceToneField('rootSourcePaletteOffset',float(raw.offset));break;
  default:fail('未知复根控制命令');
 }
}
export function snapshotRootsControlCommand(raw:unknown):RootsControlCommand {rootsControlRepresentationBytes({input:raw,detached:raw});validateCommand(raw);return structuredClone(raw);}
export function validateRootsControls(raw:unknown):RootsControls {
 if(!record(raw)||!natural(raw.acknowledgedRevision)||!Array.isArray(raw.commands))return fail('复根 controls 需要确认水位与命令数组');
 exact(raw,['acknowledgedRevision','commands'],'controls');rootsControlRepresentationBytes(raw);
 let previous=raw.acknowledgedRevision;
 for(const c of raw.commands){validateCommand(c);if(c.revision!==previous+1)fail('复根命令必须从 ack 后连续递增，不能有 revision 缺口');previous=c.revision;}
 return raw as unknown as RootsControls;
}
export function validateRootsControlReceipt(raw:unknown):RootsControlReceipt {
 if(!record(raw)||!natural(raw.revision)||!natural(raw.applyRevision)||!natural(raw.resetRevision)||raw.applyRevision>raw.revision||raw.revision<1||raw.applyRevision<1||raw.resetRevision<1)return fail('复根控制回执无效');
 exact(raw,['revision','applyRevision','resetRevision'],'receipt');return raw as unknown as RootsControlReceipt;
}
/** Check acknowledgements against the actual command prefix. A caller without
 * a previous receipt cannot invent prior Apply/reset facts above its ack. */
export function rootsControlReceiptMatches(raw:unknown,input:RootsControls,previous?:RootsControlReceipt,options:{allowRecordingResets?:boolean}={}):boolean {
 try{
  const receipt=validateRootsControlReceipt(raw),request=validateRootsControls(input),prior=previous&&validateRootsControlReceipt(previous);
  const revision=request.commands.at(-1)?.revision??request.acknowledgedRevision;if(receipt.revision!==revision)return false;
  if(prior&&(request.acknowledgedRevision>prior.revision||revision<prior.revision))return false;
  if(!prior&&request.acknowledgedRevision===0&&(request.commands[0]?.kind!=='apply'||request.commands[0]?.revision!==1))return false;
  let applyRevision=prior?.applyRevision??(request.acknowledgedRevision===0?0:undefined),resets=prior?.resetRevision??0;
  for(const command of request.commands){if(prior&&command.revision<=prior.revision)continue;if(command.kind==='apply'){applyRevision=command.revision;resets++;}else if(command.kind==='restart')resets++;}
  if(applyRevision===undefined){if(receipt.applyRevision>request.acknowledgedRevision)return false;}else if(receipt.applyRevision!==applyRevision)return false;
  const known=!!prior||request.acknowledgedRevision===0;
  if(known&&!options.allowRecordingResets)return receipt.resetRevision===resets;
  return receipt.resetRevision>=resets+(known?0:1);
 }catch{return false;}
}
interface State {cold:SceneDocument;current:SceneDocument;receipt:RootsControlReceipt;acknowledged:number;fingerprints:Map<number,string>;}
export interface RootsControlStep {kind:RootsControlCommand['kind'];scene:SceneDocument;reset:boolean;}
export interface PreparedRootsControls {readonly steps:readonly RootsControlStep[];readonly current:SceneDocument;readonly receipt:RootsControlReceipt;readonly retainedBytes:number;readonly peakBytes:number;}
/** Worker authority for cold/current. UI author documents never enter a hot
 * transition. Prepared transactions contain no GPU/Worker side effects. */
export class RootsControlOwner {
 private state?:State;
 private transactions=new WeakMap<PreparedRootsControls,{base:State|undefined;next:State}>();
 constructor(readonly sessionId:string){}
 get initialized(){return this.state!==undefined;}
 get currentScene(){if(!this.state)return fail('复根控制状态缺失，请重新 Apply');return this.state.current;}
 get coldScene(){if(!this.state)return fail('复根控制状态缺失，请重新 Apply');return this.state.cold;}
 get receipt(){if(!this.state)return fail('复根控制状态缺失，请重新 Apply');return {...this.state.receipt};}
 get retainedBytes(){return this.state?this.measure(this.state):0;}
 private measure(s:State){return rootsControlRepresentationBytes({cold:s.cold,current:s.current,receipt:s.receipt,fingerprints:[...s.fingerprints]});}
 prepare(raw:RootsControls,isCancelled?:()=>boolean):PreparedRootsControls {
  rootsGpuCancel(isCancelled);const request=validateRootsControls(raw),base=this.state;
  if(!base&&(request.acknowledgedRevision!==0||request.commands[0]?.revision!==1||request.commands[0]?.kind!=='apply'))fail('复根控制状态缺失，请重新 Apply（首条必须为 apply 1）');
  if(base&&(request.acknowledgedRevision<base.acknowledged||request.acknowledgedRevision>base.receipt.revision))fail('复根确认水位无效');
  // Account for detached commands, expanded fingerprints and candidate states
  // before any command clone. Existing state remains owned through admission.
  rootsControlRepresentationBytes({prior:base&&{cold:base.cold,current:base.current,fingerprints:[...base.fingerprints]},request,candidate:request,fingerprints:request});
  let cold=base?.cold,current=base?.current,receipt={...(base?.receipt??{revision:0,applyRevision:0,resetRevision:0})};
  const fingerprints=new Map(base?.fingerprints),steps:RootsControlStep[]=[];
  for(const revision of fingerprints.keys())if(revision<=request.acknowledgedRevision)fingerprints.delete(revision);
  for(const rawCommand of request.commands){
   rootsGpuCancel(isCancelled);const key=identity(rawCommand);
   if(rawCommand.revision<=receipt.revision){if(fingerprints.get(rawCommand.revision)!==key)fail('复根 revision 被重复用于不同或已确认的命令');continue;}
   if(rawCommand.revision!==receipt.revision+1)fail('复根命令 revision 缺口');
   const command=freezeOwned(structuredClone(rawCommand));fingerprints.set(command.revision,key);
   if(command.kind==='apply'){cold=command.scene;current=cold;receipt.applyRevision=command.revision;receipt.resetRevision++;}
   else if(command.kind==='restart'){current=cold;receipt.resetRevision++;}
   else if(current){
    if(command.kind==='palette'){if(command.palette?.colors.length)current={...current,rootsSourcePalette:{colors:parseRootsSourcePalette(command.palette).colors.map(text=>'#'+sourceHotPalettePackedColor(text).toString(16).padStart(8,'0'))}};}
    else if(command.kind==='tone'){
     const settings={...current.settings};for(const [key,value]of Object.entries(command.tone))if(key!=='dotSize')settings[toneKeys[key as keyof typeof toneKeys]]=normalizeRootsSourceToneField(toneKeys[key as keyof typeof toneKeys],value!);
     current={...current,settings,rootsPresentation:{...current.rootsPresentation!,...(command.tone.dotSize===undefined?{}:{dotSize:float(command.tone.dotSize)})}};
    }else if(command.kind==='transform')current={...current,rootsPresentation:{...current.rootsPresentation!,transform:command.transform}};
    else if(command.kind==='camera')current={...current,rootsPresentation:{...current.rootsPresentation!,camera:{...current.rootsPresentation!.camera,...Object.fromEntries(Object.entries(command.camera).map(([key,value])=>[key,float(value)]))}}};
    else if(command.kind==='offset')current={...current,settings:{...current.settings,rootSourcePaletteOffset:float(command.offset)}};
   }
   if(!current||!cold)fail('复根命令缺少已应用配置');
   receipt.revision=command.revision;if(!Number.isSafeInteger(receipt.resetRevision))fail('复根 reset 计数超出安全整数');
   steps.push({kind:command.kind,scene:freezeOwned(current!),reset:command.kind==='apply'||command.kind==='restart'});
  }
  if(!current||!cold)fail('复根控制状态缺失，请重新 Apply');
  const next:State={cold:cold!,current:current!,receipt,acknowledged:request.acknowledgedRevision,fingerprints};
  const retainedBytes=this.measure(next),peakBytes=rootsControlRepresentationBytes({prior:base&&{cold:base.cold,current:base.current,fingerprints:[...base.fingerprints]},next:{cold,current,fingerprints:[...fingerprints]},steps,request});
  rootsGpuCancel(isCancelled);const result:PreparedRootsControls=Object.freeze({steps:Object.freeze(steps.map(s=>Object.freeze(s))),current:current!,receipt:Object.freeze({...receipt}),retainedBytes,peakBytes});this.transactions.set(result,{base,next});return result;
 }
 prepareRecordingReset():PreparedRootsControls {
  const base=this.state;if(!base)return fail('复根录制缺少已应用配置');
  const receipt={...base.receipt,resetRevision:base.receipt.resetRevision+1};if(!Number.isSafeInteger(receipt.resetRevision))fail('复根 reset 计数超出安全整数');
  const next={...base,current:base.cold,receipt},retainedBytes=this.measure(next),result:PreparedRootsControls=Object.freeze({steps:Object.freeze([Object.freeze({kind:'restart' as const,scene:base.cold,reset:true})]),current:base.cold,receipt:Object.freeze({...receipt}),retainedBytes,peakBytes:this.retainedBytes+retainedBytes});
  this.transactions.set(result,{base,next});return result;
 }
 commit(transaction:PreparedRootsControls):void {const t=this.transactions.get(transaction);if(!t||t.base!==this.state)fail('复根控制事务已过期');this.state=t!.next;this.transactions.delete(transaction);}
}
