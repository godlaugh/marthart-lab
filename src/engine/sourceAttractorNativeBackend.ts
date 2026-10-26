import {prepareSourceAttractorGpuOptions,createSourceAttractorGpuInitialSource,sourceAttractorGpuWarmupPasses,sourceAttractorGpuNormalPass,prepareSourceAttractorGpuDisplay,SOURCE_ATTRACTOR_GPU_LIMITS,SourceAttractorGpuError,type SourceAttractorGpuAsyncBackend,type SourceAttractorGpuOptions,type SourceAttractorGpuDisplay,type SourceAttractorGpuPass,type SourceAttractorGpuRaster} from './sourceAttractorGpuPrepared';
import {sourceAttractorGpuPrograms} from './sourceAttractorGpuShaders';
import {sourceAttractorNativeProgramBytes,sourceAttractorNativeResidentBytes,sourceAttractorNativeTargetBytes,sourceAttractorNativeUploadPlan,type SourceAttractorNativeOperation,type SourceAttractorNativeTarget} from './sourceAttractorNativeProtocol';
import {exchangeSourceAttractorNative,releaseSourceAttractorNative} from './sourceNativeClient';
import {ensureSourceNativeLease} from './sourceNativeLease';
import {SourceNativeError} from './sourceNativeError';
import {SOURCE_FRAME_BUDGET} from './sourceDrawingFrame';

type Reply=Awaited<ReturnType<typeof exchangeSourceAttractorNative>>;
type Renderer=Pick<Reply,'rendererIdentity'|'contextSerial'|'sessionSerial'>;
type State={resource:string;index:number;renderIndex:number;uploaded:number;bytes:number;target?:SourceAttractorNativeTarget;targetBytes:number;pendingTargetBytes:number};
const owners=new Set<SourceAttractorNativeBackend>();let generation=0;
const globalBytes=()=>Array.from(owners).reduce((n,owner)=>n+owner.ownedBytes(),0);
const capacity=(n:number)=>{if(!Number.isSafeInteger(n)||n<0||n>SOURCE_FRAME_BUDGET)throw new SourceNativeError('capacity','原生吸引子联合表示超过 256 MiB 预算');};

/** One retained native object. No source configuration/RNG interpretation is
 * duplicated remotely. Cancellation is soft: complete ACKs are committed before
 * the semantic session can revoke output, and disposal never aborts the shared
 * native context. Uncertain creation and failed release keep exact custody. */
export class SourceAttractorNativeBackend implements SourceAttractorGpuAsyncBackend {
 private readonly prepared;readonly layout;
 private readonly generation=++generation;private sequence=0;private state?:State;private renderer?:Renderer;
 private active?:Promise<unknown>;private retiring?:Promise<void>;private failed=false;private disposed=false;private initialized=false;
 private updatePasses=0;private warmupPasses=0;private rendered=0;private work=0;private readbackBytes=0;
 constructor(private readonly options:SourceAttractorGpuOptions,private readonly memory:{retainedBytes?:()=>number}={}){this.prepared=prepareSourceAttractorGpuOptions(options);this.layout=this.prepared.layout;}
 ownedBytes(){const s=this.state;return s?s.bytes+s.targetBytes+s.pendingTargetBytes:0;}
 diagnostics(){return{contextOwned:!!this.state,handles:this.state?1:0,initialized:this.initialized,disposed:this.disposed,failed:this.failed,cleanupPending:this.failed&&!!this.state,texSize:this.layout.size,particleCount:this.layout.count,updatePasses:this.updatePasses,warmupPasses:this.warmupPasses,rendered:this.rendered,nodeWork:this.work,readbackBytes:this.readbackBytes,estimatedBytes:this.ownedBytes()};}
 private externalBytes(){const n=(this.memory.retainedBytes?.()??0)+(this.options.retainedBytes?.()??0);capacity(n);return n;}
 private identity(){if(this.sequence===0xffffffff)throw new SourceNativeError('capacity','原生吸引子请求序号已耗尽');return{generation:this.generation,sequence:++this.sequence};}
 private check(){if(this.options.isCancelled?.())throw new SourceAttractorGpuError('cancelled','源 GPU 吸引子已取消');}
 private acknowledge(reply:Reply,release=false){
  if(this.renderer&&(!release||reply.disposition==='released')&&(this.renderer.rendererIdentity!==reply.rendererIdentity||this.renderer.contextSerial!==reply.contextSerial||this.renderer.sessionSerial!==reply.sessionSerial))throw new SourceNativeError('state-lost','原生吸引子 context 已变化，不能沿用原轨迹');
  if(!release){this.renderer={rendererIdentity:reply.rendererIdentity,contextSerial:reply.contextSerial,sessionSerial:reply.sessionSerial};const s=this.state!;s.index=reply.passIndex;s.renderIndex=reply.renderIndex;s.uploaded=reply.uploaded;}
 }
 private checkpoint(){const s=this.state!;return{resource:s.resource,expectedIndex:s.index,expectedRenderIndex:s.renderIndex,expectedUploaded:s.uploaded,expectedCount:this.layout.count,expectedTexSize:this.layout.size};}
 private async exchange(operation:SourceAttractorNativeOperation,width=1,height=1){
  const s=this.state!,provisional=operation.kind==='create'?s.bytes:operation.kind==='render'?s.pendingTargetBytes:0;
  const reply=await exchangeSourceAttractorNative({...this.identity(),width,height,operation},{retainedBytes:globalBytes()-provisional+this.externalBytes(),...(operation.kind==='render'&&s.target?{retainedTarget:s.target}:{})});
  this.acknowledge(reply);return reply;
 }
 private transaction<T>(operation:()=>Promise<T>):Promise<T>{
  if(this.active||this.retiring)return Promise.reject(new SourceNativeError('capacity','原生吸引子请求或清理尚未完成'));
  if(this.failed||this.disposed)return Promise.reject(new SourceNativeError('state-lost','原生吸引子已失效；需要释放并重新生成'));
  const pending=(async()=>{try{this.check();return await operation();}catch(error){this.failed=true;throw error;}})();
  const settled=pending.finally(()=>{if(this.active===settled)this.active=undefined;});this.active=settled;return settled;
 }
 private async initializeOwned(){
  if(this.initialized)return;this.check();
  if(owners.size>=2)throw new SourceNativeError('capacity','原生吸引子最多保留两个独立资源');
  const programs=sourceAttractorGpuPrograms(this.prepared.shader,'native-gl41'),bytes=sourceAttractorNativeResidentBytes(this.layout.count,this.layout.size,sourceAttractorNativeProgramBytes(programs));
  capacity(globalBytes()+bytes+this.externalBytes());
  this.state={resource:crypto.randomUUID().replaceAll('-',''),index:0,renderIndex:0,uploaded:0,bytes,targetBytes:0,pendingTargetBytes:0};owners.add(this);
  await ensureSourceNativeLease(new AbortController().signal);this.check();
  try{await this.exchange({kind:'create',resource:this.state.resource,count:this.layout.count,texSize:this.layout.size,shaderOperations:this.prepared.shader.operations,programs});}
  catch(error){
   // An explicit ownership rejection proves this token belongs elsewhere.
   // No create was accepted for us; releasing it would destroy another owner.
   // Transport/runtime/unknown ACK failures retain provisional custody instead.
   if(error instanceof SourceNativeError&&error.kind==='ownership'){this.state=undefined;owners.delete(this);}
   throw error;
  }this.check();
  const source=createSourceAttractorGpuInitialSource(this.prepared,()=>this.check());
  while(source.cursor<this.layout.texels){
   this.check();
   // Admit both canonical arrays and packet copies before source.next allocates.
   // Recompute after every ACK so sibling resources and caller-held pixels are
   // included; reduced headroom changes chunking only, never canonical samples.
   const plan=sourceAttractorNativeUploadPlan(this.layout.count,this.layout.size,source.cursor,globalBytes()+this.externalBytes());
   const chunk=source.next(plan.texels);await this.exchange({kind:'upload',...this.checkpoint(),...chunk});this.check();
  }
  for(const pass of sourceAttractorGpuWarmupPasses(this.prepared.configuration)){await this.passOwned(pass);this.check();}
  this.initialized=true;
 }
 initialize():Promise<void>{return this.transaction(()=>this.initializeOwned());}
 private async passOwned(pass:SourceAttractorGpuPass){
  this.check();const work=this.layout.texels*Math.max(0,pass.steps)*(this.prepared.shader.operations*4+40);
  if(!Number.isSafeInteger(work)||work>SOURCE_ATTRACTOR_GPU_LIMITS.drawNodeWork||this.work+work>SOURCE_ATTRACTOR_GPU_LIMITS.replayNodeWork||this.warmupPasses+this.updatePasses>=SOURCE_ATTRACTOR_GPU_LIMITS.passes)throw new SourceAttractorGpuError('capacity','源 GPU 吸引子 RK4 工作量超过本地预算；不改变作者配置');
  await this.exchange({kind:'pass',...this.checkpoint(),pass});this.work+=work;if(pass.warmup)this.warmupPasses++;else this.updatePasses++;
 }
 advance():Promise<void>{return this.transaction(async()=>{await this.initializeOwned();await this.passOwned(sourceAttractorGpuNormalPass(this.prepared.configuration));this.check();});}
 render(options:SourceAttractorGpuDisplay):Promise<SourceAttractorGpuRaster>{
  // Capture mutable caller matrices before initialize/upload can yield.
  const display=prepareSourceAttractorGpuDisplay(this.prepared,options),preparedDisplay={...display,projection:new Float32Array(display.projection),modelview:new Float32Array(display.modelview)};
  return this.transaction(async()=>{
   await this.initializeOwned();this.check();const s=this.state!,d=preparedDisplay.layout;
   const target={resource:s.resource,width:d.width,height:d.height,accumWidth:d.accumWidth,accumHeight:d.accumHeight},same=s.target&&Object.keys(target).every(k=>target[k as keyof typeof target]===s.target![k as keyof typeof target]);
   const targetBytes=sourceAttractorNativeTargetBytes(d.width,d.height,d.accumWidth,d.accumHeight);s.pendingTargetBytes=same?0:targetBytes;
   const reply=await this.exchange({kind:'render',...this.checkpoint(),display:preparedDisplay},d.width,d.height);
   // Target/counters belong to the received ACK even if cancellation arrived.
   s.target=target;s.targetBytes=targetBytes;s.pendingTargetBytes=0;this.rendered++;this.readbackBytes+=reply.pixels!.byteLength;this.check();
   return{width:d.width,height:d.height,pixels:reply.pixels!,sourcePixelRenderer:{backend:'native',identity:reply.rendererIdentity,generation:reply.generation,sequence:reply.sequence,samples:0}};
  });
 }
 dispose():Promise<void>{
  if(this.retiring)return this.retiring;
  const pending=(async()=>{
   await this.active?.catch(()=>{});const state=this.state;
   if(state){try{const reply=await releaseSourceAttractorNative({...this.identity(),width:1,height:1,operation:{kind:'release',resource:state.resource}});this.acknowledge(reply,true);}catch(error){this.failed=true;throw error;}this.state=undefined;}
   owners.delete(this);this.renderer=undefined;this.initialized=false;this.disposed=true;
  })();
  const settled=pending.finally(()=>{if(this.retiring===settled)this.retiring=undefined;});this.retiring=settled;return settled;
 }
}
