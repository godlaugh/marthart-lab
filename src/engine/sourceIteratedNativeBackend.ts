import type {IteratedFrameJob} from '../scenes/iteratedDensity';
import type {IteratedGpuFacts,IteratedGpuOptions} from './iteratedDensityGpu';
import type {SourceIteratedReplayAsyncBackend,SourceIteratedPresentArguments,SourceIteratedPresented} from './sourceIteratedReplayBackend';
import {iteratedInitialChunk} from './iteratedSeed';
import {iteratedGpuFieldSource,iteratedDensityGpuPrograms} from './iteratedDensityGpuPrograms';
import {prepareSourceIteratedAdvancePlan} from './sourceIteratedAdvancePlan';
import {prepareSourceIteratedDrawPlan,prepareSourceIteratedPresentPlan,sourceIteratedRenderPrograms} from './sourceIteratedRenderPlan';
import {encodeSourceIteratedNativeRequest,sourceIteratedNativeProgramBytes,sourceIteratedNativeResidentBytes,type SourceIteratedNativeOperation} from './sourceIteratedNativeProtocol';
import {encodeSourceIteratedRenderNativeRequest,sourceIteratedNativeViewBytes,sourceIteratedRenderNativeProgramBytes,sourceIteratedRenderNativeResidentBytes,type SourceIteratedRenderNativePrograms,type SourceIteratedRenderNativeOperation} from './sourceIteratedRenderNativeProtocol';
import {exchangeSourceIteratedNative,exchangeSourceIteratedRenderNative,type SourceNativeIteratedResponse,type SourceNativeIteratedRenderResponse} from './sourceNativeClient';
import {ensureSourceNativeLease} from './sourceNativeLease';
import {SourceNativeError} from './sourceNativeError';
import {SOURCE_FRAME_BUDGET} from './sourceDrawingFrame';

type Ink={resource:string;width:number;height:number;lastIndex:number;displays:number;bytes:number;pendingProgramBytes:number};
type State={resource:string;count:number;index:number;bytes:number;viewBytes:number;structuralKey:string;vertex:string;fragment:string};
type Renderer=Pick<SourceNativeIteratedResponse,'rendererIdentity'|'contextSerial'|'sessionSerial'>;
const owners=new Set<SourceIteratedNativeBackend>();
let generation=0;
const token=()=>crypto.randomUUID().replaceAll('-','');
const require=(condition:unknown,message:string)=>{if(!condition)throw new SourceNativeError('input',message);};
const capacity=(n:number)=>{if(!Number.isSafeInteger(n)||n<0||n>SOURCE_FRAME_BUDGET)throw new SourceNativeError('capacity','原生迭代会话超过 256 MiB 工作预算');};
const globalBytes=()=>Array.from(owners).reduce((n,owner)=>n+owner.diagnostics().retainedBytes,0);

/** Production source Symmetry owner. The semantic Session supplies detached
 * frame plans and cancels between acknowledged effects. This adapter never
 * aborts the shared transport or reads particles back to reconstruct history.
 * Other native families are accounted by the service's authoritative registry;
 * this page-side admission accounts all retained iterated owners. */
export class SourceIteratedNativeBackend implements SourceIteratedReplayAsyncBackend {
 private readonly generation=++generation;private sequence=0;
 private state?:State;private ink?:Ink;private readonly inks=new Map<string,Ink>();
 private programs?:SourceIteratedRenderNativePrograms;private renderer?:Renderer;
 private active=false;private failed=false;private retiring?:Promise<void>;private frame=-1;
 private bounds={minX:-1,maxX:1,minY:-1,maxY:1};
 private counters={requests:0,requestBytes:0,creations:0,programReplacements:0,presentations:0};
 private identity(){if(this.sequence===0xffffffff)throw new SourceNativeError('capacity','原生迭代请求序号已耗尽');return{generation:this.generation,sequence:++this.sequence};}
 private acknowledge(reply:SourceNativeIteratedResponse|SourceNativeIteratedRenderResponse,release=false){
  this.counters.requests++;this.counters.requestBytes+=reply.requestBytes;
  if(release)return;
  const old=this.renderer;
  if(old&&(old.rendererIdentity!==reply.rendererIdentity||old.contextSerial!==reply.contextSerial||old.sessionSerial!==reply.sessionSerial))throw new SourceNativeError('state-lost','原生迭代 context 已变化，不能恢复为同一轨迹');
  this.renderer={rendererIdentity:reply.rendererIdentity,contextSerial:reply.contextSerial,sessionSerial:reply.sessionSerial};
 }
 private async compute(operation:SourceIteratedNativeOperation){
  const reply=await exchangeSourceIteratedNative({...this.identity(),operation},{retainedBytes:globalBytes()-(operation.kind==='create'?this.state!.bytes:0)});
  this.acknowledge(reply,operation.kind==='release');if(operation.kind!=='release')this.state!.index=reply.index;return reply;
 }
 private async render(operation:SourceIteratedRenderNativeOperation,width=this.ink?.width??1,height=this.ink?.height??1){
  const target=this.inks.get(operation.resource),proposed=operation.kind==='create'?target!.bytes:operation.kind==='replace-programs'?target!.pendingProgramBytes:0;
  const reply=await exchangeSourceIteratedRenderNative({...this.identity(),width,height,operation},{retainedBytes:globalBytes()-proposed});
  this.acknowledge(reply,operation.kind==='release');return reply;
 }
 private checkpoint(ink:Ink,index=ink.lastIndex){return{resource:ink.resource,stateResource:this.state!.resource,expectedIndex:index,expectedDisplays:ink.displays,expectedCount:this.state!.count};}
 private async transaction<T>(work:()=>Promise<T>):Promise<T>{
  if(this.active||this.retiring)throw new SourceNativeError('capacity','原生迭代事务或清理尚未完成');
  if(this.failed)throw new SourceNativeError('state-lost','原生迭代会话已失效，请重新应用场景');
  this.active=true;try{return await work();}catch(error){this.failed=true;throw error;}finally{this.active=false;}
 }
 private async releaseOwners(){
  // Release acknowledgements may report absence after the service retired its
  // exact child. Failed releases retain every unresolved dependency locally.
  for(const ink of this.inks.values()){
   await this.render({kind:'release',resource:ink.resource},1,1);this.inks.delete(ink.resource);if(this.ink===ink)this.ink=undefined;
  }
  if(this.state){await this.compute({kind:'release',resource:this.state.resource});this.state=undefined;}
  owners.delete(this);this.programs=undefined;this.renderer=undefined;this.frame=-1;
 }
 private async target(width:number,height:number):Promise<boolean>{
  if(this.ink?.width===width&&this.ink.height===height)return false;
  if(!this.state||!this.programs)throw new SourceNativeError('state-lost','原生迭代尚未建立粒子状态');
  const state=this.state,old=this.ink,ink:Ink={resource:token(),width,height,lastIndex:state.index,displays:0,bytes:sourceIteratedRenderNativeResidentBytes(state.count,width,height,sourceIteratedRenderNativeProgramBytes(this.programs)),pendingProgramBytes:0};
  capacity(globalBytes()+ink.bytes+sourceIteratedNativeViewBytes(state.count));
  this.inks.set(ink.resource,ink); // Keep uncertain create ownership before await.
  await this.render({...this.checkpoint(ink),kind:'create',expectedDisplays:0,programs:this.programs},width,height);this.ink=ink;
  if(old){await this.render({kind:'release',resource:old.resource},1,1);this.inks.delete(old.resource);}return true;
 }
 async step(job:IteratedFrameJob,options:Omit<IteratedGpuOptions,'isCancelled'>):Promise<IteratedGpuFacts>{
  return this.transaction(async()=>{
   const plan=prepareSourceIteratedAdvancePlan(job,options.resetParticles),field=iteratedGpuFieldSource(job.field,'native-gl41'),program=iteratedDensityGpuPrograms('native-gl41').iteration(field);
   require(job.kind==='symmetry'&&field.sourceCalculateNext&&field.stage!=='fragment'&&job.config.dimension===2,'原生迭代后端目前支持二维源 Symmetry calculate_next');
   const bounds=job.sourceCamera?{minX:-1,maxX:1,minY:-1,maxY:1}:options.bounds;
   require(bounds,'原生迭代绘制需要源相机或明确视口');
   const draw=prepareSourceIteratedDrawPlan(job,{width:options.width,height:options.height,stateWidth:Math.min(2048,job.config.count),bounds:bounds!,projection:options.projection});
   const selected=sourceIteratedRenderPrograms('native-gl41','symmetry',draw.sourceSplatProgram),selectedBytes=sourceIteratedRenderNativeProgramBytes(selected);
   const advances=plan.advances.map(a=>{const f=iteratedGpuFieldSource(a.field,'native-gl41'),p=iteratedDensityGpuPrograms('native-gl41').iteration(f);require(p.vertex===program.vertex&&p.fragment===program.fragment,'一次原生迭代更新不能切换计算程序');return{...a,uniforms:Object.entries(f.uniforms).map(([name,value])=>({name,value}))};});
   const changed=this.state&&(this.state.structuralKey!==job.structuralKey||this.state.vertex!==program.vertex||this.state.fragment!==program.fragment||this.state.count!==job.config.count);
   require(!changed||options.resetParticles,'原生迭代结构变化需要重置');require(options.resetParticles||!!this.state&&job.frame===this.frame+1,'原生迭代仅允许顺序推进；seek 必须由会话重放');
   const palette={key:draw.palette.key,format:draw.palette.format,values:draw.palette.createValues()},drawPlan={drawUniforms:draw.drawUniforms,statsUniforms:draw.statsUniforms,palette,noise:draw.noisePermutation,primitive:draw.primitive};
   // Admit the complete draw before creating or advancing remote state.
   const preflight=encodeSourceIteratedRenderNativeRequest({generation:this.generation,sequence:1,width:options.width,height:options.height,operation:{kind:'draw',resource:this.ink?.resource??'12'.repeat(16),stateResource:this.state?.resource??'34'.repeat(16),expectedIndex:this.state?.index??0,expectedDisplays:this.ink?.displays??0,expectedCount:job.config.count,clear:options.clearInk||options.resetParticles,record:job.config.record,decay:job.config.decay,plan:drawPlan}},{retainedBytes:globalBytes()});
   if(!preflight.ok)throw new SourceNativeError(preflight.error.kind,preflight.error.reason);
   for(const advance of advances){
    const checked=encodeSourceIteratedNativeRequest({generation:this.generation,sequence:1,operation:{kind:'advance',resource:this.state?.resource??'34'.repeat(16),expectedIndex:this.state?.index??0,expectedCount:job.config.count,reset:false,resetCounter:advance.resetCounter,dimension:2,steps:advance.steps,uniforms:advance.uniforms}});
    if(!checked.ok)throw new SourceNativeError(checked.error.kind,checked.error.reason);
   }
   if(changed)await this.releaseOwners();
   if(!this.state){
    if(owners.size>=2)throw new SourceNativeError('capacity','最多保留主预览和一个原生迭代导出会话');
    const first=iteratedInitialChunk(job.config,0,Math.min(65536,job.config.count));
    const state:State={resource:token(),count:job.config.count,index:0,bytes:sourceIteratedNativeResidentBytes(job.config.count,sourceIteratedNativeProgramBytes(program)),viewBytes:0,structuralKey:job.structuralKey,...program};
    capacity(globalBytes()+state.bytes+sourceIteratedNativeViewBytes(state.count)+sourceIteratedRenderNativeResidentBytes(state.count,options.width,options.height,selectedBytes));
    await ensureSourceNativeLease(new AbortController().signal);
    this.state=state;owners.add(this);this.programs=selected;
    await this.compute({kind:'create',resource:state.resource,count:state.count,...program});this.counters.creations++;
    for(let offset=0;offset<state.count;offset+=65536)await this.compute({kind:'upload',resource:state.resource,expectedIndex:0,expectedCount:state.count,offset,positionsAndMetric:offset===0?first:iteratedInitialChunk(job.config,offset,Math.min(65536,state.count-offset))});
   }
   await this.target(options.width,options.height);
   const state=this.state,ink=this.ink!;
   if(this.programs!==selected){
    ink.pendingProgramBytes=selectedBytes;
    await this.render({...this.checkpoint(ink),kind:'replace-programs',programs:selected});
    ink.bytes=sourceIteratedRenderNativeResidentBytes(state.count,ink.width,ink.height,selectedBytes);ink.pendingProgramBytes=0;this.programs=selected;this.counters.programReplacements++;
   }
   let reset=plan.resetParticles;
   for(const a of advances){await this.compute({kind:'advance',resource:state.resource,expectedIndex:state.index,expectedCount:state.count,reset,resetCounter:reset||a.resetCounter,dimension:2,steps:a.steps,uniforms:a.uniforms});reset=false;}
   if(reset)await this.compute({kind:'advance',resource:state.resource,expectedIndex:state.index,expectedCount:state.count,reset:true,resetCounter:true,dimension:2,steps:0,uniforms:Object.entries(field.uniforms).map(([name,value])=>({name,value}))});
   // A failed draw may already have materialized the borrowed GPU view.
   state.viewBytes=sourceIteratedNativeViewBytes(state.count);
   const reply=await this.render({...this.checkpoint(ink,state.index),kind:'draw',clear:options.clearInk||options.resetParticles,record:job.config.record,decay:job.config.decay,plan:drawPlan});
   ink.displays=reply.displays;ink.lastIndex=reply.index;this.frame=job.frame;this.bounds={...bounds!};
   return{bounds:{...this.bounds},steps:state.count*(plan.warmupSteps+plan.iterationSteps),invalid:plan.reportInvalid?reply.invalid:0,accepted:reply.accepted,clipped:reply.clipped,sampleInvalid:reply.sampleInvalid};
  });
 }
 resizeAccumulation(width:number,height:number):Promise<boolean>{return this.transaction(()=>this.target(width,height));}
 validateAccumulationCapture(width:number,height:number,additionalBytes:number):void{
  require(Number.isSafeInteger(additionalBytes)&&additionalBytes>=0,'原生迭代截图额外容量无效');
  if(this.failed||!this.state||!this.programs)throw new SourceNativeError('state-lost','原生迭代截图需要有效的保留状态');
  const target=sourceIteratedRenderNativeResidentBytes(this.state.count,width,height,sourceIteratedRenderNativeProgramBytes(this.programs));
  capacity(globalBytes()+(this.ink?.width===width&&this.ink.height===height?0:target)+(this.state.viewBytes?0:sourceIteratedNativeViewBytes(this.state.count))+width*height*8+width*4+additionalBytes);
 }
 async present(tone:SourceIteratedPresentArguments[0],view?:SourceIteratedPresentArguments[2]):Promise<SourceIteratedPresented>{
  return this.transaction(async()=>{
   const ink=this.ink;if(!ink||!ink.displays)throw new SourceNativeError('state-lost','原生迭代呈现需要已完成的累积');
   const p=prepareSourceIteratedPresentPlan(tone,ink.width,ink.height,view);
   const reply=await this.render({...this.checkpoint(ink),kind:'present',plan:{uniforms:p.uniforms,clear:Array.from(p.clear),filter:p.filter}});
   if(!reply.pixels)throw new SourceNativeError('protocol','原生迭代呈现缺少像素');this.counters.presentations++;
   return{pixels:reply.pixels,occupiedPixels:reply.occupiedPixels,maxCount:reply.maxCount,toneBackend:'native',sourcePixelRenderer:{backend:'native',identity:reply.rendererIdentity,generation:reply.generation,sequence:reply.sequence,samples:0},warnings:[]};
  });
 }
 diagnostics(){return{...this.counters,active:this.active,failed:this.failed,owned:!!this.state,inkOwners:this.inks.size,index:this.state?.index??0,displays:this.ink?.displays??0,frame:this.frame,retainedBytes:(this.state?this.state.bytes+this.state.viewBytes:0)+Array.from(this.inks.values()).reduce((n,i)=>n+i.bytes+i.pendingProgramBytes,0)};}
 dispose():Promise<void>{
  if(this.retiring)return this.retiring;if(this.active)return Promise.reject(new SourceNativeError('cleanup','原生迭代事务尚未结束，不能释放其状态'));
  this.failed=true;const pending=this.releaseOwners();this.retiring=pending;
  void pending.then(()=>{this.retiring=undefined;this.failed=false;},()=>{this.retiring=undefined;});return pending;
 }
}
