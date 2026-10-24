import type {SceneDocument} from '../types';
import {rootsControlRepresentationBytes,ROOTS_CONTROL_MAX_BYTES} from './rootsControl';
import {prepareImplicitPalette,validateImplicitPaletteColors,validateImplicitSourcePalette,ImplicitPaletteControlError,type ImplicitPaletteFacts} from './sourceImplicitPalette';
export {prepareImplicitPalette,ImplicitPaletteControlError,type ImplicitPaletteFacts} from './sourceImplicitPalette';
import {usesSourceImplicitCpuMesh} from './sourceImplicitPresentation';

export const IMPLICIT_PALETTE_CONTROL_MAX_BYTES=ROOTS_CONTROL_MAX_BYTES;
export type ImplicitPaletteControlPayload={kind:'apply';scene:SceneDocument}|{kind:'palette';colors:string[]}|{kind:'restart'};
export type ImplicitPaletteControlCommand=ImplicitPaletteControlPayload&{revision:number};
export interface ImplicitPaletteControls {acknowledgedRevision:number;commands:ImplicitPaletteControlCommand[];}
/** Last applied command revision; resetRevision counts Apply/restart/record resets. */
export interface ImplicitPaletteControlReceipt {revision:number;applyRevision:number;resetRevision:number;}
const fail=(message:string):never=>{throw new ImplicitPaletteControlError(message);};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const natural=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
function exact(value:Record<string,unknown>,keys:readonly string[],label:string){if(Object.keys(value).some(key=>!keys.includes(key)))fail(`Unknown Implicit ${label} field`);}
function cancelled(check?:()=>boolean){if(check?.())throw new DOMException('Implicit palette control cancelled','AbortError');}
/** Reuse only the shared representation admission, never Roots scene parsing. */
export function implicitPaletteControlRepresentationBytes(value:unknown):number {
 try{return rootsControlRepresentationBytes(value);}catch(error){throw new ImplicitPaletteControlError(error instanceof Error?error.message.replaceAll('复根','隐式'):String(error),object(error)&&error.failureKind==='capacity'?'capacity':'input');}
}
function sceneColors(scene:SceneDocument):string[] {
 const source=scene.implicitSourcePalette;
 if(source!==undefined)return validateImplicitSourcePalette(source).colors;
 if(!object(scene.palette))return fail('Implicit Apply requires a palette');validateImplicitPaletteColors(scene.palette.stops);return scene.palette.stops;
}
function validateScene(raw:unknown):asserts raw is SceneDocument {
 if(!object(raw)||!object(raw.settings)||!usesSourceImplicitCpuMesh(raw as unknown as SceneDocument))return fail('Implicit Apply requires the source CPU mesh profile');
 if(!object(raw.equations)||!object(raw.parameters)||!object(raw.timeline)||!object(raw.palette))fail('Implicit Apply requires a complete scene snapshot');
 sceneColors(raw as unknown as SceneDocument);
}
function freeze<T>(value:T):T {
 const pending:unknown[]=[value],seen=new Set<object>();
 while(pending.length){const v=pending.pop();if(v&&typeof v==='object'&&!seen.has(v)){seen.add(v);for(const child of Object.values(v))pending.push(child);Object.freeze(v);}}return value;
}
function packed(scene:SceneDocument):ImplicitPaletteFacts {return prepareImplicitPalette(sceneColors(scene),'cold');}

function validateCommand(raw:unknown):asserts raw is ImplicitPaletteControlCommand {
 if(!object(raw)||!natural(raw.revision)||raw.revision<1)return fail('Implicit command revision must start at 1');
 switch(raw.kind){
  case'apply':exact(raw,['kind','revision','scene'],'Apply');validateScene(raw.scene);break;
  case'palette':exact(raw,['kind','revision','colors'],'palette');validateImplicitPaletteColors(raw.colors);break;
  case'restart':exact(raw,['kind','revision'],'restart');break;
  default:fail('Unknown Implicit palette control command');
 }
}
export function validateImplicitPaletteControls(raw:unknown):ImplicitPaletteControls {
 if(!object(raw)||!natural(raw.acknowledgedRevision)||!Array.isArray(raw.commands))return fail('Implicit controls require acknowledgedRevision and commands');
 exact(raw,['acknowledgedRevision','commands'],'controls');implicitPaletteControlRepresentationBytes(raw);
 let previous=raw.acknowledgedRevision;for(const command of raw.commands){validateCommand(command);if(command.revision!==previous+1)fail('Implicit command revision gap: commands must follow acknowledgement contiguously');previous=command.revision;}
 return raw as unknown as ImplicitPaletteControls;
}
export function validateImplicitPaletteControlReceipt(raw:unknown):ImplicitPaletteControlReceipt {
 if(!object(raw)||!natural(raw.revision)||!natural(raw.applyRevision)||!natural(raw.resetRevision)||raw.revision<1||raw.applyRevision<1||raw.applyRevision>raw.revision||raw.resetRevision<1)return fail('Invalid Implicit control receipt');
 exact(raw,['revision','applyRevision','resetRevision'],'receipt');return raw as unknown as ImplicitPaletteControlReceipt;
}
export function implicitPaletteControlReceiptMatches(raw:unknown,input:ImplicitPaletteControls,previous?:ImplicitPaletteControlReceipt,options:{allowRecordingResets?:boolean}={}):boolean {
 try{
  const receipt=validateImplicitPaletteControlReceipt(raw),request=validateImplicitPaletteControls(input),prior=previous&&validateImplicitPaletteControlReceipt(previous),revision=request.commands.at(-1)?.revision??request.acknowledgedRevision;
  if(receipt.revision!==revision||prior&&(request.acknowledgedRevision>prior.revision||revision<prior.revision))return false;
  if(!prior&&request.acknowledgedRevision===0&&(request.commands[0]?.kind!=='apply'||request.commands[0]?.revision!==1))return false;
  let apply=prior?.applyRevision??(request.acknowledgedRevision===0?0:undefined),resets=prior?.resetRevision??0;
  for(const command of request.commands){if(prior&&command.revision<=prior.revision)continue;if(command.kind==='apply'){apply=command.revision;resets++;}else if(command.kind==='restart')resets++;}
  if(apply===undefined?receipt.applyRevision>request.acknowledgedRevision:receipt.applyRevision!==apply)return false;
  const known=!!prior||request.acknowledgedRevision===0;
  return known&&!options.allowRecordingResets?receipt.resetRevision===resets:receipt.resetRevision>=resets+(known?0:1);
 }catch{return false;}
}
/** Exact tagged fingerprint: -0, undefined and user objects cannot collide.
 * Expanded graph admission precedes traversal and string allocation. */
function identity(value:unknown):string {
 const chunks:string[]=[],pending:({value:unknown}|{literal:string})[]=[{value}];
 while(pending.length){const item=pending.pop()!;if('literal'in item){chunks.push(item.literal);continue;}const v=item.value;
  if(v===undefined)chunks.push('u');else if(v===null)chunks.push('n');else if(typeof v==='boolean')chunks.push(v?'b1':'b0');else if(typeof v==='number')chunks.push('d'+(Object.is(v,-0)?'-0':String(v))+';');else if(typeof v==='string')chunks.push('s'+v.length+':'+v);else{const keys=Object.keys(v as object).sort();chunks.push((Array.isArray(v)?'a'+v.length+':':'o')+keys.length+'{');pending.push({literal:'}'});for(let i=keys.length-1;i>=0;i--)pending.push({value:(v as Record<string,unknown>)[keys[i]]},{value:keys[i]});}
 }return chunks.join('');
}
interface State {cold:SceneDocument;current:SceneDocument;coldPalette:ImplicitPaletteFacts;palette:ImplicitPaletteFacts;receipt:ImplicitPaletteControlReceipt;acknowledged:number;fingerprints:Map<number,string>;}
export interface ImplicitPaletteControlStep {readonly kind:ImplicitPaletteControlCommand['kind'];readonly scene:SceneDocument;readonly palette:ImplicitPaletteFacts;readonly reset:boolean;}
export interface PreparedImplicitPaletteControls {readonly steps:readonly ImplicitPaletteControlStep[];readonly cold:SceneDocument;readonly current:SceneDocument;readonly palette:ImplicitPaletteFacts;readonly receipt:ImplicitPaletteControlReceipt;readonly retainedBytes:number;readonly peakBytes:number;}
/** Pure worker-side transaction owner. Geometry/formula/device preflight is the
 * session's responsibility before commit; author documents are never patched. */
export class ImplicitPaletteControlOwner {
 private state?:State;
 private transactions=new WeakMap<PreparedImplicitPaletteControls,{base:State|undefined;next:State}>();
 constructor(readonly sessionId:string){if(typeof sessionId!=='string'||!sessionId.trim())fail('Implicit controls require a session identity');}
 get initialized(){return this.state!==undefined;}
 private currentState(){return this.state??fail('Implicit control state missing; explicit Apply required');}
 get coldScene(){return this.currentState().cold;}
 get currentScene(){return this.currentState().current;}
 get coldPalette(){return this.currentState().coldPalette;}
 get currentPalette(){return this.currentState().palette;}
 get receipt(){return freeze({...this.currentState().receipt});}
 get retainedBytes(){return this.state?this.measure(this.state):0;}
 private representation(state:State|undefined):unknown {return state&&{cold:state.cold,current:state.current,coldPalette:state.coldPalette,palette:state.palette,receipt:state.receipt,fingerprints:[...state.fingerprints]};}
 private measure(state:State){return implicitPaletteControlRepresentationBytes(this.representation(state));}
 prepare(raw:ImplicitPaletteControls,isCancelled?:()=>boolean):PreparedImplicitPaletteControls {
  cancelled(isCancelled);const request=validateImplicitPaletteControls(raw),base=this.state;
  if(!base&&(request.acknowledgedRevision!==0||request.commands[0]?.kind!=='apply'||request.commands[0]?.revision!==1))fail('Implicit control state missing; explicit Apply 1 required');
  if(base&&(request.acknowledgedRevision<base.acknowledged||request.acknowledgedRevision>base.receipt.revision))fail('Invalid Implicit acknowledgement watermark');
  // Reserve input/detached command, tagged string + temporary chunks, replay
  // steps and candidate facts before cloning or fingerprint expansion.
  const admissionBytes=implicitPaletteControlRepresentationBytes({prior:this.representation(base),input:request,detached:request,fingerprint:request,chunks:request,steps:request,candidate:request});
  let cold=base?.cold,current=base?.current,coldPalette=base?.coldPalette,palette=base?.palette;
  const receipt={...(base?.receipt??{revision:0,applyRevision:0,resetRevision:0})},fingerprints=new Map(base?.fingerprints),steps:ImplicitPaletteControlStep[]=[];
  for(const revision of fingerprints.keys())if(revision<=request.acknowledgedRevision)fingerprints.delete(revision);
  for(const rawCommand of request.commands){
   cancelled(isCancelled);const fingerprint=identity(rawCommand);
   if(rawCommand.revision<=receipt.revision){if(fingerprints.get(rawCommand.revision)!==fingerprint)fail('Implicit revision reused with different or already acknowledged payload');continue;}
   if(rawCommand.revision!==receipt.revision+1)fail('Implicit command revision gap');
   const command=freeze(structuredClone(rawCommand));fingerprints.set(command.revision,fingerprint);
   if(command.kind==='apply'){cold=command.scene;current=cold;coldPalette=packed(cold);palette=coldPalette;receipt.applyRevision=command.revision;receipt.resetRevision++;}
   else if(command.kind==='restart'){current=cold;palette=coldPalette;receipt.resetRevision++;}
   else if(command.colors.length){
    // Only this runtime scene carries opaque Session-parser output. The cold
    // scene and the caller's persisted raw colors are untouched.
    palette=prepareImplicitPalette(command.colors,'hot');
    current=freeze({...current!,implicitSourcePalette:{colors:palette.packed.map(value=>'#'+value.toString(16).padStart(8,'0'))}});
   }
   if(!cold||!current||!coldPalette||!palette)fail('Implicit palette command requires an applied scene');
   receipt.revision=command.revision;if(!Number.isSafeInteger(receipt.resetRevision))fail('Implicit reset counter exceeds safe integer range');
   steps.push(Object.freeze({kind:command.kind,scene:current!,palette:palette!,reset:command.kind==='apply'||command.kind==='restart'}));
  }
  if(!cold||!current||!coldPalette||!palette)fail('Implicit control state missing; explicit Apply required');
  const next:State={cold:cold!,current:current!,coldPalette:coldPalette!,palette:palette!,receipt,acknowledged:request.acknowledgedRevision,fingerprints},retainedBytes=this.measure(next);
  const peakBytes=Math.max(admissionBytes,implicitPaletteControlRepresentationBytes({prior:this.representation(base),next:this.representation(next),steps,request}));cancelled(isCancelled);
  return this.transaction(base,next,steps,retainedBytes,peakBytes);
 }
 prepareRecordingReset(isCancelled?:()=>boolean):PreparedImplicitPaletteControls {
  cancelled(isCancelled);const base=this.currentState(),receipt={...base.receipt,resetRevision:base.receipt.resetRevision+1};if(!Number.isSafeInteger(receipt.resetRevision))fail('Implicit reset counter exceeds safe integer range');
  const next={...base,current:base.cold,palette:base.coldPalette,receipt},steps=[Object.freeze({kind:'restart' as const,scene:base.cold,palette:base.coldPalette,reset:true})];
  const retainedBytes=this.measure(next),peakBytes=implicitPaletteControlRepresentationBytes({prior:this.representation(base),next:this.representation(next),steps});cancelled(isCancelled);
  return this.transaction(base,next,steps,retainedBytes,peakBytes);
 }
 private transaction(base:State|undefined,next:State,steps:ImplicitPaletteControlStep[],retainedBytes:number,peakBytes:number):PreparedImplicitPaletteControls {
  const result=Object.freeze({steps:Object.freeze(steps),cold:next.cold,current:next.current,palette:next.palette,receipt:Object.freeze({...next.receipt}),retainedBytes,peakBytes});this.transactions.set(result,{base,next});return result;
 }
 commit(transaction:PreparedImplicitPaletteControls):void {const prepared=this.transactions.get(transaction);if(!prepared||prepared.base!==this.state)fail('Implicit control transaction is stale or belongs to another owner');this.state=prepared!.next;this.transactions.delete(transaction);}
}
