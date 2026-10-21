import type {GenerateContext,Palette,SceneDocument,SceneOutput} from '../types';
import {SOURCE_SAMILA_APPEARANCE_FIELDS} from './sourceSamilaFields';
import {sourceSamilaSceneIdentity,sourceSamilaApplyIdentity,SOURCE_SAMILA_HOT_SETTINGS as HOT_SETTINGS} from './sourceSamilaIdentity';
import {prepareIteratedFrame,type IteratedFrameJob} from '../scenes/iteratedDensity';
import {IteratedDensityGpu,iteratedGpuBytes} from './iteratedDensityGpu';
import {GenerationCleanupState} from './generationCleanup';
import {SourceSamilaRandomSource,prepareSourceSamilaLiveBatch,usesSourceSamilaSampling,validateSourceSamilaSampling} from './sourceSamilaSampling';
import {SOURCE_SAMILA_PRESENTATION_MODEL,usesSourceSamilaPresentation,validateSourceSamilaPresentation,sourceSamilaDisplayTransform} from './sourceSamilaPresentation';
import {prepareSourceSamilaSplat,validateSourceSamilaSplat,sourceSamilaFloat,sourceSamilaPointDiameter,sourceSamilaTrailDecay} from './sourceSamilaSplat';
import {SourceSamilaTimelineSession,usesSourceSamilaTimeline} from './sourceSamilaReplay';
import {prepareSamilaView,parseSamilaCamera,SAMILA_CAMERA_MODEL} from './samilaCamera';
import {readSamilaViewport} from './samilaViewport';
import {samilaNdcSamplingRotation} from './samilaProjection';
import {samilaParametersChanged,SAMILA_HISTORY_CEILING} from './samilaHistory';
import {prepareDensityTone} from './density';
import {prepareSourcePausedCaptureSize} from './sourcePausedCaptureSize';
import {exactRasterDimensions} from './rasterDimensions';

export interface SourceSamilaLiveContext {sessionId:string;pixelDensity:number;dirtyRevision?:number;}
export type SourceSamilaHotAction=
 | {kind:'parameter';name:string;value:number}
 | {kind:'rotation';value:number}
 | {kind:'transform';scaleX:number;scaleY:number;offsetX:number;offsetY:number}
 | {kind:'batchSize';value:number}
 | {kind:'palette';value:Palette};
export type SourceSamilaLiveOutput=Extract<SceneOutput,{type:'raster'}>;
const LIMIT=768*1024*1024,F=Math.fround;
const RUNTIME_LIMITS:Record<string,readonly[number,number]>={normalizedBrightness:[0,1],normalizedContrast:[.1,2],normalizedGamma:[.1,10],normalizedDynamicRange:[.1,1],normalizedSaturation:[0,1],colorSpeed:[.1,2],colorPhase:[0,360]};
const cancel=(c:GenerateContext)=>{if(c.isCancelled?.())throw new DOMException('Samila 热显示已取消','AbortError');};
const copy=<T>(value:T):T=>structuredClone(value);
function context(c:GenerateContext):SourceSamilaLiveContext {
 const value=c.samilaLive;
 if(!value||typeof value.sessionId!=='string'||!value.sessionId.length||!Number.isSafeInteger(value.pixelDensity)||value.pixelDensity<1||value.dirtyRevision!==undefined&&(!Number.isSafeInteger(value.dirtyRevision)||value.dirtyRevision<0))throw Error('Samila 热会话上下文无效');
 if(!Number.isFinite(c.time)||c.time<0||c.time>86400)throw Error('Samila 热会话时间无效');return value;
}
function validate(scene:SceneDocument,c:GenerateContext):void {
 context(c);if(!usesSourceSamilaSampling(scene)||!usesSourceSamilaPresentation(scene)||!usesSourceSamilaTimeline(scene))throw Error('Samila 热显示需要完整源采样、呈现和源队列配置');
 validateSourceSamilaSampling(scene);validateSourceSamilaPresentation(scene);validateSourceSamilaSplat(scene);
 if(scene.settings.iteratedBackend==='cpu')throw Error('Samila 热显示需要 WebGL2；不能用冷 CPU 重放替换现有墨迹');
 prepareIteratedFrame(scene,c.time,0);exactRasterDimensions(c);cancel(c);
}
interface Completed {context:GenerateContext;identity:string;width:number;height:number;}
/** One hot mobject owner. Queue updates are fixed-source-clock snapshots; each
 * display is a separate mutation, regardless of that clock's elapsed time. */
export class SourceSamilaSession {
 private gpu?:IteratedDensityGpu;
 private readonly random:SourceSamilaRandomSource;
 private readonly cleanup=new GenerationCleanupState();
 private authored?:SceneDocument;private current?:SceneDocument;private timeline?:SourceSamilaTimelineSession;
 private sessionId='';private structure='';private acknowledged:Record<string,number>={};
 private dirty=true;private dirtyRevision=0;private writeRevision=0;private anchor?:number;
 private width=0;private height=0;private count=0;private displayIndex=0;private passes=0;private time=0;private theta=0;
 private trailDecay=1;private runtimeSettingsApplied=false;
 private steps=0;private accepted=0;private clipped=0;private invalid=0;private clears=0;
 private completed?:Completed;private busy=false;private failed=false;
 constructor(options:{samilaSeedProvider?:()=>number}={}){this.random=new SourceSamilaRandomSource({nextSeed:options.samilaSeedProvider});}
 reset(failures:readonly unknown[]=[]):void {
  this.completed=undefined;this.failed=true;
  this.cleanup.reset(()=>{this.gpu?.dispose();this.gpu=undefined;this.timeline?.reset();this.timeline=undefined;this.authored=undefined;this.current=undefined;this.sessionId='';this.structure='';this.acknowledged={};this.dirty=true;this.dirtyRevision=0;this.writeRevision=0;this.anchor=undefined;this.trailDecay=1;this.runtimeSettingsApplied=false;this.width=0;this.height=0;this.count=0;this.displayIndex=0;this.passes=0;this.time=0;this.theta=0;this.steps=0;this.accepted=0;this.clipped=0;this.invalid=0;this.clears=0;this.failed=false;},failures);
 }
 diagnostics(){return{sessionId:this.sessionId,displayIndex:this.displayIndex,accumulationPasses:this.passes,anchorTheta:this.anchor,dirty:this.dirty,parameterSnapshot:{...this.acknowledged},parameters:{...this.current?.parameters},width:this.width,height:this.height,clears:this.clears,failed:this.failed,random:this.random.diagnostics(),gpu:this.gpu?.diagnostics(),retainedBytes:(this.gpu?.diagnostics().retainedBytes??0)+this.stateBytes()};}
 private stateBytes():number{if(!this.current&&!this.authored)return 0;return (this.authored?JSON.stringify(this.authored).length*2:0)+(this.current?JSON.stringify(this.current).length*2:0)+this.structure.length*2+JSON.stringify(this.acknowledged).length*2+(this.completed?.identity.length??0)*2;}
 snapshotInk():Float32Array {if(this.failed||!this.gpu)throw Error('Samila 热墨迹不可读取');if(this.diagnostics().retainedBytes+this.width*this.height*16>LIMIT)throw Error('Samila 热墨迹复制超过 768 MiB');return this.gpu.readback();}
 private replace(scene:SceneDocument,c:GenerateContext):void {
  this.reset();this.authored=copy(scene);this.current=copy(scene);this.sessionId=context(c).sessionId;this.structure=sourceSamilaApplyIdentity(scene);this.acknowledged={...scene.parameters};this.trailDecay=sourceSamilaTrailDecay(scene.settings);this.theta=F(parseSamilaCamera(scene).theta);this.timeline=new SourceSamilaTimelineSession(copy(scene));this.dirtyRevision=context(c).dirtyRevision??0;
 }
 applyHot(action:SourceSamilaHotAction):void {
  if(this.busy||this.failed||!this.current)throw Error('Samila 热操作需要已初始化且空闲的会话');
  this.applyAction(action);this.completed=undefined;
 }
 private applyAction(action:SourceSamilaHotAction):void {
  const scene=this.current!;
  if(action.kind==='parameter'){
   if(!Object.hasOwn(scene.parameters,action.name)||!Number.isFinite(action.value))throw Error('Samila 热参数需要既有名称与有限值；新增参数需要完整应用');
   this.timeline!.writeParameter(action.name,action.value);scene.parameters={...scene.parameters,[action.name]:action.value};this.dirty=true;
  }else if(action.kind==='palette'){
   const next={...scene,palette:copy(action.value)};validateSourceSamilaSplat(next);scene.palette=next.palette;this.dirty=true;
  }else if(action.kind==='transform'){
   const settings={...scene.settings};for(const key of ['scaleX','scaleY','offsetX','offsetY'] as const)settings[key]=sourceSamilaFloat({[key]:action[key]},key,0);
   scene.settings=settings;this.dirty=true;
  }else if(action.kind==='rotation'){scene.settings.rotation=sourceSamilaFloat({rotation:action.value},'rotation',0);this.dirty=true;
  }else if(action.kind==='batchSize'){
   if(!Number.isSafeInteger(action.value)||action.value<1||action.value>8_000_000)throw Error('Samila 热批次必须为 1–8000000');
   if(scene.settings.batchSize!==action.value){scene.settings.batchSize=action.value;this.dirty=true;}
  }else throw Error('未知 Samila 热操作');
 }
 private sync(scene:SceneDocument,c:GenerateContext):void {
  const live=context(c),key=sourceSamilaApplyIdentity(scene);
  if(!this.current||this.sessionId!==live.sessionId||this.structure!==key||c.time<this.time)this.replace(scene,c);
  else{
   const before=this.authored!,next=this.current!,oldColorSpeed=sourceSamilaFloat(next.settings,'colorSpeed',.22),oldColorPhase=sourceSamilaFloat(next.settings,'colorPhase',180);let runtimeSettingsChanged=false;
   for(const [name,value]of Object.entries(scene.parameters))if(!Object.is(before.parameters[name],value))this.applyAction({kind:'parameter',name,value});
   for(const key of HOT_SETTINGS){const value=scene.settings[key];if(Object.is(before.settings[key],value))continue;
    if(key==='rotation')this.applyAction({kind:'rotation',value:sourceSamilaFloat(scene.settings,key,0)});
    else if(key==='batchSize')this.applyAction({kind:'batchSize',value:Number(value??4096)});
    else if(['scaleX','scaleY','offsetX','offsetY'].includes(key)){next.settings[key]=sourceSamilaFloat(scene.settings,key,key.startsWith('scale')?.33:0);this.dirty=true;}
    else if(key==='samilaCameraTheta'){this.theta=sourceSamilaFloat(scene.settings,key,0);this.timeline!.writeTheta(this.theta);next.settings[key]=this.theta;}
    else{
     if(key==='samilaUsePaletteLut')this.dirty=true;else runtimeSettingsChanged=true;
     if(value===undefined)delete next.settings[key];else next.settings[key]=value;
    }
   }
   if(runtimeSettingsChanged){
    // One native setter receives the entire group: editing background can also
    // clamp a previously imported out-of-range phase/gamma. Constructor values
    // remain literal until this explicit local hot-authoring operation.
    for(const [source,field]of Object.entries(SOURCE_SAMILA_APPEARANCE_FIELDS)){
     if(source==='trail_lifetime')continue;const value=sourceSamilaFloat(next.settings,field.key,field.base),limit=RUNTIME_LIMITS[field.key];
     next.settings[field.key]=limit?F(Math.max(F(limit[0]),Math.min(F(limit[1]),value))):value;
    }
    this.runtimeSettingsApplied=true;
    if(Math.abs(F(Number(next.settings.colorSpeed)-oldColorSpeed))>F(1e-6)||Math.abs(F(Number(next.settings.colorPhase)-oldColorPhase))>F(1e-6))this.dirty=true;
   }
   if(JSON.stringify(before.palette)!==JSON.stringify(scene.palette)){
    if(JSON.stringify({...before.palette,offset:0})===JSON.stringify({...scene.palette,offset:0}))next.palette={...next.palette,offset:scene.palette.offset};
    else this.applyAction({kind:'palette',value:scene.palette});
   }
   this.authored=copy(scene);
  }
  const revision=live.dirtyRevision??0;if(revision<this.dirtyRevision)throw Error('Samila 热操作版本倒退；需要新的会话');if(revision!==this.dirtyRevision){this.dirty=true;this.dirtyRevision=revision;}
  const frame=this.timeline!.evaluate(c.time);if(Object.keys(frame.parameters).some(name=>!Object.hasOwn(this.authored!.parameters,name)))throw Error('Samila 热时间线新增 uniform 尚不支持；请完整应用参数配置');this.current!.parameters={...frame.parameters};if(frame.parameterWriteRevision!==this.writeRevision){this.dirty=true;this.writeRevision=frame.parameterWriteRevision;}
  this.theta=F(frame.camera.theta);
  this.time=c.time;
  const viewport=readSamilaViewport(scene);
  if(viewport){const values={scaleX:viewport.scaleX,scaleY:viewport.scaleY,offsetX:viewport.offsetX,offsetY:viewport.offsetY};if(Object.entries(values).some(([key,value])=>this.current!.settings[key]!==value)){this.applyAction({kind:'transform',...values});}}
 }
 private preflight(scene:SceneDocument,c:GenerateContext,additionalBytes=0):{job:IteratedFrameJob;width:number;height:number} {
  const [width,height]=exactRasterDimensions(c),job=prepareIteratedFrame(scene,c.time,this.displayIndex);
  if(this.runtimeSettingsApplied)job.config.decay=Math.max(0,Math.min(1,F(this.trailDecay*sourceSamilaFloat(scene.settings,'accumulationDecay',1))));
  job.samilaSplat=prepareSourceSamilaSplat(scene,{width,height,primaryPixelHeight:c.samilaPrimaryPixelHeight,path:'points'});
  const budget=iteratedGpuBytes(job.config.count,width,height,2048,true,false,true,true,true)+width*height*4+this.stateBytes()+additionalBytes;
  if(!Number.isSafeInteger(additionalBytes)||additionalBytes<0||budget>LIMIT)throw Error('Samila 热显示超过 768 MiB 工作预算');
  const radius=Math.max(sourceSamilaPointDiameter(job.samilaSplat!),F(job.samilaSplat!.radius*F(.6)),F(.8));
  if(job.config.count*6*6>2_000_000_000||job.config.count*6*(Math.ceil(radius)+2)**2>2_000_000_000)throw Error('Samila 热显示超过 20 亿次工作预算');
  return{job,width,height};
 }
 private display(c:GenerateContext,target:'primary'|'offscreen',additionalBytes=0):SourceSamilaLiveOutput {
  cancel(c);const scene=this.current!,{job,width,height}=this.preflight(scene,c,additionalBytes),resized=width!==this.width||height!==this.height;
  // Resize precedes comparison and clears only the dirty bit, not the anchor or
  // acknowledged map. A later significant parameter change can still reanchor.
  let dirty=resized?false:this.dirty;const changed=samilaParametersChanged(scene.parameters,this.acknowledged),clear=resized||changed||dirty;
  const anchor=this.anchor===undefined||changed||dirty?this.theta:this.anchor,passes=changed?6:1,completedPasses=(clear?0:this.passes)+passes;
  if(!Number.isSafeInteger(completedPasses)||completedPasses>0x7fffffff||!Number.isSafeInteger(this.displayIndex+1))throw Error('Samila 热显示计数超过整数容量');
  if(job.field.kind!=='samila'||!job.samilaProjection||!job.samilaSplat)throw Error('Samila 热显示缺少已解析字段');
  job.field={...job.field,rotation:samilaNdcSamplingRotation(job.field.rotation,anchor)};
  job.history={model:'bounded-v2',clear,passes,samples:job.config.count*passes,randomFrames:[],densityCeiling:SAMILA_HISTORY_CEILING,next:{parameters:changed?{...scene.parameters}:this.acknowledged,fieldKey:job.fieldKey}};
  const tone=prepareDensityTone(scene.palette,scene.settings,{kind:'samila',historyModel:'bounded-v2',width,height,completedPasses,baseBatchSize:job.config.count,alpha:job.config.alpha,combinedDecay:job.config.decay,splat:{model:job.samilaSplat.model,nominalRadius:job.samilaSplat.nominalRadius}});
  const view=prepareSamilaView({model:SAMILA_CAMERA_MODEL,time:c.time,theta:this.theta},anchor,width,height,c.time),{delta}=sourceSamilaDisplayTransform(view,width,height);view.delta=delta;view.cos=Math.cos(delta);view.sin=Math.sin(delta);
  cancel(c);job.samilaSampling=prepareSourceSamilaLiveBatch(this.random,this.displayIndex,job.config.count,passes);
  this.gpu??=new IteratedDensityGpu();
  // From this call onward failure may have partially copied/drawn/swapped ink.
  // The transaction deliberately fails closed instead of pretending rollback.
  const facts=this.gpu.step(job,{resetParticles:resized||this.count!==job.config.count,clearInk:clear,width,height,projection:'xy',padding:0,bounds:{minX:-1,maxX:1,minY:-1,maxY:1},isCancelled:c.isCancelled});
  const shown=this.gpu.present(tone,c.isCancelled,view);cancel(c);
  if(clear){this.accepted=0;this.clipped=0;this.invalid=0;this.steps=0;this.clears++;}
  this.accepted+=facts.accepted;this.clipped+=facts.clipped;this.invalid+=facts.invalid;this.steps+=facts.steps;
  this.width=width;this.height=height;this.count=job.config.count;this.passes=completedPasses;this.anchor=anchor;this.dirty=false;if(changed)this.acknowledged={...scene.parameters};
  const index=this.displayIndex++;
  return{type:'raster',cameraResolved:true,dimension:2,backend:'webgl2',width,height,pixels:shown.pixels,samilaLive:{sessionId:this.sessionId,target,displayIndex:index,accumulationPasses:this.passes,anchorTheta:anchor,parameterChanged:changed,cleared:clear,clock:'fixed-source-queue'},samilaSampling:job.samilaSampling,samilaSplat:{...job.samilaSplat},samilaView:view,samilaViewportTransform:{scaleX:job.samilaProjection.scaleX,scaleY:job.samilaProjection.scaleY,offsetX:job.samilaProjection.offsetX,offsetY:job.samilaProjection.offsetY},sourceSamilaPresentation:{model:SOURCE_SAMILA_PRESENTATION_MODEL,stage:'present-target-rgba8',display:'opaque-rgb-copy',backend:shown.toneBackend==='webgl2'?'webgl2':'cpu-derived'},density:{projection:'xy',bounds:facts.bounds,inputPoints:this.steps,examined:this.steps,accepted:this.accepted,clipped:this.clipped,invalid:this.invalid,occupiedPixels:shown.occupiedPixels,maxCount:shown.maxCount,toneBackend:shown.toneBackend,cancelled:false},temporal:{time:c.time,windowStart:0,frames:this.displayIndex,samplingFps:scene.timeline.fps,recordedPoints:this.steps,cacheHits:0},stats:{samples:facts.steps,generated:facts.accepted,invalid:facts.invalid},warnings:[...shown.warnings,'Samila 热显示每次绘制使用新的运行时随机字；模拟时钟仍为本地固定源队列，未验证原生 UI 时序、随机流或跨设备整图一致性。']};
 }
 private identity(scene:SceneDocument,c:GenerateContext):string{return JSON.stringify([sourceSamilaSceneIdentity(scene),c.time,c.samilaLive,c.samilaPrimaryPixelHeight]);}
 matchesCompletedPrimary(scene:SceneDocument,c:GenerateContext):boolean {return !this.failed&&!!this.completed&&this.completed.identity===this.identity(scene,c)&&this.completed.width===c.width&&this.completed.height===c.height;}
 generate(scene:SceneDocument,c:GenerateContext):SourceSamilaLiveOutput {
  if(this.busy)throw Error('Samila 热会话正在执行');this.cleanup.prepare();validate(scene,c);this.preflight(scene,c);this.busy=true;
  try{this.sync(scene,c);const output=this.display(c,'primary');this.completed={context:{...c,samilaLive:{...context(c)}},identity:this.identity(scene,c),width:output.width,height:output.height};return output;}
  catch(error){this.reset([error]);throw error;}finally{this.busy=false;}
 }
 capturePaused(scene:SceneDocument,c:GenerateContext,options:{additionalBytes?:number}={}):{capture:SourceSamilaLiveOutput;preview:SourceSamilaLiveOutput} {
  if(this.busy||this.failed||!this.completed||this.completed.identity!==this.identity(scene,c))throw Error('Samila 暂停截图需要相同已完成主画布');
  const additionalBytes=options.additionalBytes??0;if(!Number.isSafeInteger(additionalBytes)||additionalBytes<0)throw Error('Samila 暂停截图附加内存必须为非负安全整数');
  this.cleanup.prepare();const primary=this.completed!,size=prepareSourcePausedCaptureSize(c,context(c).pixelDensity),exportContext={...c,width:size.width,height:size.height};
  this.preflight(this.current!,exportContext,additionalBytes+primary.width*primary.height*4);this.preflight(this.current!,primary.context,additionalBytes+size.width*size.height*4);cancel(c);this.busy=true;
  try{const capture=this.display(exportContext,'offscreen',additionalBytes+primary.width*primary.height*4),preview=this.display({...primary.context,isCancelled:c.isCancelled},'primary',additionalBytes+capture.pixels.byteLength);this.completed=primary;return{capture,preview};}
  catch(error){this.reset([error]);throw error;}finally{this.busy=false;}
 }
}
