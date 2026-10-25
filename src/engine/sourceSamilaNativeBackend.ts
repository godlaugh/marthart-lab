import {ensureSourceNativeLease} from './sourceNativeLease';
import {exchangeSourceSamilaNative,type SourceNativeSamilaResponse,SourceNativeError} from './sourceNativeClient';
import {sourceBouncingNativeSession} from './sourceBouncingNativeSession';
import {SOURCE_FRAME_BUDGET} from './sourceDrawingFrame';
import {prepareSourceSamilaNativeCreate,prepareSourceSamilaNativeDisplay,prepareSourceSamilaNativePresent,prepareSourceSamilaNativeProgram} from './sourceSamilaNativeProgram';
import {sourceSamilaNativeProgramBytes,sourceSamilaNativeResidentBytes,SOURCE_SAMILA_NATIVE_STATISTICS_READBACK_BYTES,type SourceSamilaNativeOperation} from './sourceSamilaNativeProtocol';
import type {IteratedDensityAsyncStepResult,IteratedDensityAsyncPresentResult,IteratedDensityPreparedPresent} from './iteratedDensityAsyncBackend';
import type {SourceSamilaAsyncBackend} from './sourceSamilaAsyncSession';
import type {SourceSamilaPreparedDisplay,SourceSamilaDisplayBudget,SourceSamilaDisplayResult} from './sourceSamilaSession';

type State={resource:string;programKey:string;programBytes:number;paletteKey:string;width:number;height:number;pendingTargetBytes:number;index:number;identity?:string;context?:number;session?:number;failed:boolean;};
const resources=new Map<SourceSamilaNativeBackend,State>();
let generation=0;
const bytes=(s:State)=>sourceSamilaNativeResidentBytes(s.programBytes,s.width,s.height)+s.pendingTargetBytes;
const retainedBytes=()=>[...resources.values()].reduce((sum,state)=>sum+bytes(state),sourceBouncingNativeSession.diagnostics().retainedBytes);
const aborted=(signal?:AbortSignal,cancelled?:()=>boolean)=>{if(signal?.aborted||cancelled?.())throw new DOMException('Samila 原生显示已取消','AbortError');};
/** One resource per semantic session. Two bounded Samila owners may coexist,
 * but transport, native context and request capacity are shared with Bouncing.
 * No owner transfer, seed replay or recovery after an uncertain display. */
export class SourceSamilaNativeBackend implements SourceSamilaAsyncBackend {
 private readonly generation=++generation;private sequence=0;
 private state?:State;private active?:AbortController;private retiring?:Promise<void>;
 private counters={creations:0,displays:0,steps:0,presentations:0,requestBytes:0};
 private identity(){if(this.sequence===0xffffffff)throw new SourceNativeError('capacity','Samila 请求序号已耗尽');return{generation:this.generation,sequence:++this.sequence};}
 private async exchange(operation:SourceSamilaNativeOperation,width=1,height=1,signal?:AbortSignal,additionalBytes=0){
  const reply=await exchangeSourceSamilaNative({...this.identity(),width,height,operation},{signal,retainedBytes:retainedBytes()-(operation.kind==='display'||operation.kind==='step'?(this.state?.pendingTargetBytes??0):0)+additionalBytes});this.counters.requestBytes+=reply.requestBytes;return reply;
 }
 private checkIdentity(state:State,reply:SourceNativeSamilaResponse){
  if(state.identity&&(state.identity!==reply.rendererIdentity||state.context!==reply.contextSerial||state.session!==reply.sessionSerial))throw new SourceNativeError('state-lost','Samila 所属原生 context 已变化，不能重建为同一随机历史');
  state.identity=reply.rendererIdentity;state.context=reply.contextSerial;state.session=reply.sessionSerial;
 }
 admitDisplay({job,width,height,additionalBytes,stateBytes}:SourceSamilaDisplayBudget):void {
  if(this.state?.failed)throw new SourceNativeError('state-lost','Samila 原生会话已失效，请重新应用场景');
  if(!this.state&&resources.size>=2)throw new SourceNativeError('capacity','最多同时保留主预览和一个 Samila 导出会话');
  const {shaders}=prepareSourceSamilaNativeProgram(job),programBytes=sourceSamilaNativeProgramBytes(shaders);
  // Includes old retained targets during resize, every packet expansion, actual
  // stats readback and caller-owned preview/enhancement storage. Conservative;
  // not a GPU/RSS measurement. Native independently validates its whole registry.
  const createBytes=this.state?0:sourceSamilaNativeResidentBytes(programBytes)+(programBytes/3+256*256*4+1024*3*4+256)*6;
  const peak=retainedBytes()+createBytes+width*height*84+SOURCE_SAMILA_NATIVE_STATISTICS_READBACK_BYTES+programBytes*2+additionalBytes+stateBytes;
  if(!Number.isSafeInteger(peak)||peak>SOURCE_FRAME_BUDGET)throw new SourceNativeError('capacity','Samila 原生显示和保留图像超过 256 MiB 工作预算');
 }
 async draw(prepared:SourceSamilaPreparedDisplay):Promise<SourceSamilaDisplayResult> {return this.accumulate(prepared,'display') as Promise<SourceSamilaDisplayResult>;}
 async step(prepared:SourceSamilaPreparedDisplay):Promise<IteratedDensityAsyncStepResult> {return this.accumulate(prepared,'step');}
 private async accumulate(prepared:SourceSamilaPreparedDisplay,kind:'display'|'step'):Promise<SourceSamilaDisplayResult|IteratedDensityAsyncStepResult> {
  if(this.active||this.retiring)throw new SourceNativeError('capacity','Samila 原生事务或清理尚未完成');
  if(this.state?.failed)throw new SourceNativeError('state-lost','Samila 原生会话已经失效');
  const controller=new AbortController();this.active=controller;const signal=controller.signal,{job,options,tone,view}=prepared;
  // Cold replay cancels at its owner boundary. Never abort shared transport or
  // discard an acknowledged checkpoint when only that export was cancelled.
  const isCancelled=kind==='display'?options.isCancelled:undefined;
  try{
   aborted(signal,isCancelled);await ensureSourceNativeLease(signal);aborted(signal,isCancelled);
   const program=prepareSourceSamilaNativeProgram(job),paletteKey=JSON.stringify(job.palette);
   if(this.state&&this.state.programKey!==program.key)throw new SourceNativeError('input','Samila 程序变化必须先释放旧会话');
   if(!this.state){
    if(resources.size>=2)throw new SourceNativeError('capacity','最多保留两个 Samila 原生会话');
    const state:State={resource:crypto.randomUUID().replaceAll('-',''),programKey:program.key,programBytes:sourceSamilaNativeProgramBytes(program.shaders),paletteKey,width:0,height:0,pendingTargetBytes:0,index:0,failed:false};
    // Retain ownership BEFORE transport; a lost create acknowledgement cannot
    // prove that the remote resource was never created.
    this.state=state;resources.set(this,state);
    const response=await this.exchange(prepareSourceSamilaNativeCreate(job,state.resource),1,1,signal);this.checkIdentity(state,response);this.counters.creations++;
   }
   const state=this.state;aborted(signal,isCancelled);
   const operation={...prepareSourceSamilaNativeDisplay(job,tone,view,{width:options.width,height:options.height,clearInk:options.clearInk||options.resetParticles,resource:state.resource,expectedIndex:state.index,paletteChanged:state.paletteKey!==paletteKey}),kind};
   // A lost response does not establish whether resize allocated its targets.
   // Keep the possible new generation as well as the old one until ACK/release.
   state.pendingTargetBytes=state.width!==options.width||state.height!==options.height?options.width*options.height*52:0;
   const response=await this.exchange(operation,options.width,options.height,signal);this.checkIdentity(state,response);
   if(kind==='display'&&!response.pixels)throw new SourceNativeError('protocol','Samila display 缺少像素');
   state.width=options.width;state.height=options.height;state.pendingTargetBytes=0;state.paletteKey=paletteKey;state.index=response.committedDisplays;this.counters[kind==='display'?'displays':'steps']++;aborted(signal,isCancelled);
   const result={facts:{bounds:{minX:-1,maxX:1,minY:-1,maxY:1},steps:response.steps,accepted:response.accepted,clipped:response.clipped,invalid:response.invalid,sampleInvalid:response.invalid},sourcePixelRenderer:this.renderer(response)};
   return kind==='step'?result:{...result,shown:this.shown(response)};
  }catch(error){if(this.state)this.state.failed=true;throw error;}
  finally{if(this.active===controller)this.active=undefined;}
 }
 private renderer(response:SourceNativeSamilaResponse){return{backend:'native' as const,identity:response.rendererIdentity,generation:response.generation,sequence:response.sequence,samples:0};}
 private shown(response:SourceNativeSamilaResponse):SourceSamilaDisplayResult['shown'] {
  if(!response.pixels)throw new SourceNativeError('protocol','Samila 呈现缺少像素');
  return{pixels:response.pixels,occupiedPixels:response.occupiedPixels,maxCount:response.maxCount,toneBackend:'native',warnings:[]};
 }
 async present({tone,view,width,height}:IteratedDensityPreparedPresent):Promise<IteratedDensityAsyncPresentResult> {
  if(this.active||this.retiring)throw new SourceNativeError('capacity','Samila 原生事务或清理尚未完成');
  const state=this.state;if(!state||state.failed)throw new SourceNativeError('state-lost','Samila 原生墨迹不存在或已失效');
  if(width!==state.width||height!==state.height||state.index===0)throw new SourceNativeError('input','Samila 呈现必须使用已完成累积的尺寸');
  const controller=new AbortController();this.active=controller;
  try{
   const operation=prepareSourceSamilaNativePresent(tone,view,width,height,state.resource,state.index);
   const response=await this.exchange(operation,width,height,controller.signal);this.checkIdentity(state,response);
   const shown=this.shown(response);this.counters.presentations++;return{shown,sourcePixelRenderer:this.renderer(response)};
  }catch(error){state.failed=true;throw error;}finally{if(this.active===controller)this.active=undefined;}
 }
 cancel(){this.active?.abort();}
 reset():Promise<void> {
  if(this.retiring)return this.retiring;if(this.active)return Promise.reject(new SourceNativeError('cleanup','Samila 显示尚未结束，不能释放其资源'));
  const state=this.state;if(!state)return Promise.resolve();state.failed=true;
  this.retiring=(async()=>{
   const response=await this.exchange({kind:'release',resource:state.resource});
   if(response.disposition==='owned')throw new SourceNativeError('protocol','Samila 释放未确认');
   if(this.state===state){this.state=undefined;resources.delete(this);}
  })().finally(()=>{this.retiring=undefined;});return this.retiring;
 }
 diagnostics(){return{...this.counters,owned:!!this.state,active:!!this.active,cleanupPending:!!this.state?.failed,displayIndex:this.state?.index??0,retainedBytes:this.state?bytes(this.state):0,resources:resources.size};}
}
