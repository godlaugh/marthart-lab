import {planPerlinRecordingClock,assertPerlinRecordingFrame,type PerlinRecordingClock} from '../engine/sourcePerlinRecording';
import {prepareSourcePerlinCaptureSize} from '../engine/sourcePerlinCaptureSize';
import {sourcePerlinBackgroundRgba} from '../engine/sourcePerlinBackground';
import type {GenerateContext,SceneDocument,SceneOutput} from '../types';
import {GenerationCleanupState} from '../engine/generationCleanup';
import {SourcePerlinCpuModel} from '../engine/sourcePerlinCpuModel';
import {SourcePerlinCpuTarget} from '../engine/sourcePerlinCpuTarget';
import {parseSourcePerlinCpuDocument} from '../engine/sourcePerlinCpuDocument';
import {sourcePerlinCpuConfiguration} from '../engine/sourcePerlinIdentity';
import {parseSourcePerlinDocument} from '../engine/sourcePerlinDocument';
import {SourcePerlinFlowResources} from '../engine/sourcePerlinFlowResources';
import {sourcePerlinGpuLayout,sourcePerlinFlowTextureSize} from '../engine/sourcePerlinGpu';
import {OrdinarySourceCameraTimelineSession,ORDINARY_CAMERA_SEQUENCE,type OrdinarySourceCameraFrame} from '../engine/ordinarySourceCameraTimeline';
import {ordinarySourceCameraInitial,ordinarySourceCameraFrame} from '../engine/ordinarySourceCamera';

const identity=(value:unknown)=>JSON.stringify(value,(_k,v)=>typeof v==='number'?{number:Object.is(v,-0)?'-0':String(v)}:v);
type Raster=Extract<SceneOutput,{type:'raster'}>;
type View=NonNullable<GenerateContext['sourcePerlinViewport']>;
function viewport(context:GenerateContext):View{
 const v=context.sourcePerlinViewport;
 if(!v||!Number.isSafeInteger(v.width)||v.width<1||!Number.isSafeInteger(v.height)||v.height<1||!Number.isSafeInteger(v.pixelDensity)||v.pixelDensity<1)throw new Error('源 Perlin CPU 需要完整的主画布逻辑尺寸与整数像素密度');
 for(const n of [context.width,context.height])if(!Number.isSafeInteger(n)||n<1||n>16384)throw new Error('源 Perlin CPU 输出尺寸无效');
 if(context.width*context.height>16777216)throw new Error('源 Perlin CPU 输出超过 16777216 像素预算');
 return {...v};
}
/** Preview sampling is downstream of the source logical canvas. A quality
 * change must not change particle seeds or their effective domain dimensions. */
function samplePixels(pixels:Uint8ClampedArray,sw:number,sh:number,width:number,height:number,cancelled?:()=>boolean){
 if(sw===width&&sh===height)return pixels;
 if(pixels.byteLength+width*height*4>128*1024*1024)throw new Error('Perlin 预览取样与读回超过 128 MiB 预算');
 const out=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++){
  if(cancelled?.())throw new DOMException('Perlin 已取消','AbortError');
  const sy=Math.min(sh-1,Math.floor((y+.5)*sh/height));
  for(let x=0;x<width;x++){const from=(sy*sw+Math.min(sw-1,Math.floor((x+.5)*sw/width)))*4,to=(y*width+x)*4;out.set(pixels.subarray(from,from+4),to);}
 }
 return out;
}
/** Parse once at the scene boundary. The application snapshot has its own
 * lifetime, independent of target size, replay position and hot backend flags. */
function prepareConfiguration(scene:SceneDocument){
 const document={...scene};
 const unified=document.perlinSource===undefined?undefined:parseSourcePerlinDocument(document.perlinSource);
 if(unified&&!unified.ok)throw new Error(`Perlin ${unified.error.path.join('.')}: ${unified.error.reason}`);
 const complete=unified?.ok?unified.value:undefined;
 const parsed=complete?{ok:true as const,value:sourcePerlinCpuConfiguration({...document,perlinSource:complete})!}:parseSourcePerlinCpuDocument(sourcePerlinCpuConfiguration(document));
 if(!parsed.ok)throw new Error(`Perlin ${parsed.error.path.join('.')}: ${parsed.error.reason}`);
 const config=parsed.value,camera=ordinarySourceCameraInitial(document);
 if(!camera||document.timeline.schedule!==ORDINARY_CAMERA_SEQUENCE)throw new Error('源 Perlin CPU 需要原版顺序时间线');
 if(complete)document.perlinSource=complete;else document.perlinCpuSource=config;
 return {document,config,complete,camera,key:identity([document.id,config,complete?.gpu,document.sourceCamera,document.settings.sourceCameraProjection,document.timeline])};
}
type Configuration=ReturnType<typeof prepareConfiguration>;
function ownConfiguration(value:Configuration):Configuration{return {...value,document:structuredClone(value.document)};}
function copyContext(c:GenerateContext):GenerateContext{return {...c,sourceViewport:c.sourceViewport?{...c.sourceViewport}:undefined,sourcePerlinViewport:c.sourcePerlinViewport?{...c.sourcePerlinViewport}:undefined};}
type Binding={view:View;width:number;height:number;density:number;kind:'primary'|'offscreen'};
type Recording={handle:object;scene:SceneDocument;context:GenerateContext;clock:PerlinRecordingClock;next:number;frame?:OrdinarySourceCameraFrame};
/** Simulation resources and canvas attachments have separate lifetimes. Local
 * cold replay still resets both. Toolbar recording resets only simulation and
 * uses the last applied snapshot, keeping primary and export pixel history. */
export class SourcePerlinSession{
 private readonly cleanup=new GenerationCleanupState();
 private key='';private model?:SourcePerlinCpuModel;private target?:SourcePerlinCpuTarget;
 private timeline?:OrdinarySourceCameraTimelineSession;private cancelled?:()=>boolean;
 private flow?:SourcePerlinFlowResources;private backend:'cpu'|'gpu'='cpu';
 private constructions=0;private work=0;
 private exportTarget?:SourcePerlinCpuTarget;private releasingExportTarget?:SourcePerlinCpuTarget;
 private configuration?:Configuration;private applied?:Configuration;private observedDocumentKey='';
 private binding?:Binding;private recording?:Recording;private primaryNeedsDraw=false;
 private completed?:{identity:string;context:GenerateContext;metadata:Omit<Raster,'pixels'>;background:readonly[number,number,number,number]};
 private requestIdentity(scene:SceneDocument,c:GenerateContext){return identity([scene.id,scene.perlinSource,scene.perlinCpuSource,scene.sourceCamera,scene.settings.sourceCameraProjection,scene.timeline,c.time,c.sourcePerlinViewport,c.sourceViewport?.referenceLogicalHeight,c.sourceViewport?.projectionPass]);}
 matchesCompletedPrimary(scene:SceneDocument,c:GenerateContext):boolean{
  try{return !this.recording&&!!this.completed&&!!this.target?.diagnostics().initialized&&this.completed.identity===this.requestIdentity(scene,c);}catch{return false;}
 }
 private requireIdle(){if(this.recording)throw new Error('Perlin 录制期间不能修改或生成其它场景');}
 /** Explicit apply includes the selected backend. Non-backend document edits
  * in generate use the local auto-apply policy; resize/rewind/hot switching do
  * not overwrite this snapshot. This is not inferred from model construction. */
 applyConfiguration(scene:SceneDocument):void{
  this.requireIdle();this.cleanup.prepare();const prepared=prepareConfiguration(scene);
  this.applied=ownConfiguration(prepared);this.observedDocumentKey=prepared.key;this.key='';this.completed=undefined;
 }
 capturePaused(scene:SceneDocument,c:GenerateContext,options:{additionalBytes?:number}={}):{capture:Raster;preview:Raster}{
  this.requireIdle();const last=this.completed,extra=options.additionalBytes??0;
  if(!Number.isSafeInteger(extra)||extra<0)throw new Error('Perlin 暂停截图后处理预留无效');
  if(!last||!this.matchesCompletedPrimary(scene,c)||!this.configuration)throw new Error('Perlin 暂停截图需要同实例最后完成的主预览');
  if(c.sourceViewport?.target!=='offscreen'||c.sourceViewport.projectionPass!==last.context.sourceViewport?.projectionPass||c.sourceViewport.referenceLogicalHeight!==last.context.sourceViewport.referenceLogicalHeight)throw new Error('Perlin 暂停截图需要原预览的离屏参考尺寸与投影');
  if(c.isCancelled?.())throw new DOMException('Perlin 已取消','AbortError');
  const size=prepareSourcePerlinCaptureSize(c,last.metadata.sourcePerlinFrame!.sourceViewport.pixelDensity),primary=this.target!,started=performance.now();
  // Both targets reserve their readbacks. Count the optional sampled preview
  // alongside those readbacks and all later enhancement/upscale storage.
  const previewSampleBytes=primary.physicalWidth===last.metadata.width&&primary.physicalHeight===last.metadata.height?0:last.metadata.width*last.metadata.height*4;
  let changed=false;
  try{return primary.withWorkingBytes(extra+previewSampleBytes,()=>{
   if(!this.exportTarget||this.exportTarget.width!==size.logicalWidth||this.exportTarget.height!==size.logicalHeight){
    try{this.ensureExportTarget(size,last.background);}finally{changed=this.completed!==last;}
   }
   const target=this.exportTarget!;
   this.completed=undefined;changed=true;this.cancelled=c.isCancelled;this.work=0;
   this.display(target,'offscreen',true);
   const capture:Raster={...structuredClone(last.metadata),pixels:target.readPixels(c.isCancelled),width:size.width,height:size.height,
    sourceCameraFrame:{...structuredClone(last.metadata.sourceCameraFrame!),viewport:{...last.metadata.sourceCameraFrame!.viewport,logicalWidth:size.logicalWidth,logicalHeight:size.logicalHeight,target:'offscreen'}},
    sourcePerlinFrame:{...last.metadata.sourcePerlinFrame!,samples:0},stats:{...last.metadata.stats,samples:this.backend==='gpu'?size.width*size.height:last.metadata.stats.samples,generated:size.width*size.height,elapsedMs:performance.now()-started}};
   // MathArt.draw continues after savePausedFrameInternal: paused update does
   // not advance simulation, but this primary render can rebuild display caches
   // and adds one more accumulation blend on its own history.
   this.display(primary,'primary',true);
   const preview:Raster={...structuredClone(last.metadata),pixels:samplePixels(primary.readPixels(c.isCancelled),primary.physicalWidth,primary.physicalHeight,last.metadata.width,last.metadata.height,c.isCancelled),stats:{...last.metadata.stats,elapsedMs:performance.now()-started}};
   this.completed=last;return{capture,preview};
  });}catch(error){if(changed)this.reset([error]);throw error;}finally{this.cancelled=undefined;}
 }

 private reserve=(units:number)=>{if(!Number.isSafeInteger(units)||units<0||this.work+units>20_000_000)throw new Error('Perlin CPU 单次请求超过 2000 万处理项预算；请分段播放或减少轨迹规模');this.work+=units;};
 private releaseSimulation(){
  this.target?.releaseSceneGpuBindings();this.exportTarget?.releaseSceneGpuBindings();
  this.model?.dispose();this.model=undefined;this.flow?.dispose();this.flow=undefined;
 }
 private releaseCanvases(){
  this.releasingExportTarget?.dispose();this.releasingExportTarget=undefined;
  this.exportTarget?.dispose();this.exportTarget=undefined;this.target?.dispose();this.target=undefined;
 }
 private releaseRuntime(){
  this.completed=undefined;this.releaseSimulation();this.releaseCanvases();
  this.timeline?.reset();this.timeline=undefined;this.configuration=undefined;this.binding=undefined;this.key='';this.primaryNeedsDraw=false;this.constructions=0;
 }
 reset(failures:readonly unknown[]=[]){this.cleanup.reset(()=>{
  this.recording=undefined;this.releaseRuntime();this.applied=undefined;this.observedDocumentKey='';this.cancelled=undefined;
 },failures);}
 diagnostics(){return{constructions:this.constructions,target:this.target?.diagnostics(),exportTarget:this.exportTarget?.diagnostics(),model:this.model?.diagnostics(),flow:this.flow?.diagnostics(),appliedBackend:this.applied?.complete?.backend,recording:this.recording?{nextFrame:this.recording.next,complete:this.recording.frame?.queueComplete}:undefined};}
 diagnosticSnapshot(){return this.model?.diagnosticSnapshot();}
 private ensureExportTarget(size:ReturnType<typeof prepareSourcePerlinCaptureSize>,background:readonly[number,number,number,number]){
  if(this.exportTarget&&this.exportTarget.width===size.logicalWidth&&this.exportTarget.height===size.logicalHeight)return this.exportTarget;
  const next=this.target!.createSibling({width:size.logicalWidth,height:size.logicalHeight,density:size.density,samples:0,initialColor:background});
  // Retain both owners until release succeeds. Failed cleanup cannot leave a
  // seemingly valid completed preview behind after target replacement.
  this.completed=undefined;this.releasingExportTarget=this.exportTarget;this.exportTarget=next;
  this.releasingExportTarget?.dispose();this.releasingExportTarget=undefined;return next;
 }
 private display(target:SourcePerlinCpuTarget,kind:'primary'|'offscreen',final:boolean){
  const {config,complete}=this.configuration!,model=this.model!,view=this.binding!.view;
  if(this.backend==='gpu'){
   const gpu=complete!.gpu;sourcePerlinGpuLayout(target.physicalWidth,target.physicalHeight,gpu.uniforms.marchSteps);
   const facts=model.gpuDisplayFacts(),style=Math.max(0,Math.min(5,gpu.textureStyle)) as 0|1|2|3|4|5;
   const channel=this.flow!.channel(style,sourcePerlinFlowTextureSize(target.physicalWidth,target.physicalHeight));
   if(final)target.drawGpu({...gpu.uniforms,...facts,width:target.physicalWidth,height:target.physicalHeight},channel,()=>this.cancelled?.()??false,this.flow!.diagnostics().retainedBytes);
  }else if(final||config.display.accumulation||config.cpuStyle==='field-curves')model.draw({target,kind,sourcePixelDensity:view.pixelDensity});
 }
 private initializeTimeline(configuration:Configuration,binding:Binding,retainCanvases:boolean){
  this.configuration=configuration;this.binding=binding;
  this.backend=configuration.complete?.backend??'cpu';let initialized=false;
  const {document,config,camera}=configuration,{view,width,height,density,kind}=binding;
  this.timeline=new OrdinarySourceCameraTimelineSession(camera,document.timeline.tracks,document.timeline.fps,{
   particleActions:'perlin',isCancelled:()=>this.cancelled?.()??false,
   createParticles:()=>{
    this.completed=undefined;this.releaseSimulation();
    // Backward seeking is the explicit local cold-replay policy. Only the
    // first creation of a recording keeps existing target pixels.
    if(!retainCanvases||initialized)this.releaseCanvases();
    if(!this.target){const options={width,height,density,initialColor:sourcePerlinBackgroundRgba(config.display.backgroundColor,false,0)};
     this.target=kind==='primary'?SourcePerlinCpuTarget.createSmoothed(options,8):new SourcePerlinCpuTarget({...options,samples:0});}
    const flow=this.flow=new SourcePerlinFlowResources({seed:config.seed,isCancelled:()=>this.cancelled?.()??false});
    const model=this.model=new SourcePerlinCpuModel({config,sourceWidth:view.width,sourceHeight:view.height,curveCacheSamples:4,backend:this.backend,noise:flow.noise,reserve:this.reserve,isCancelled:()=>this.cancelled?.()??false});
    initialized=true;this.constructions++;
    return {bind:()=>{throw new Error('原版 Perlin 不支持粒子跟踪');},update:frame=>model.update(frame.time,frame.deltaTime),
     displayFrame:(_index,final)=>{const active=this.recording;this.display(active?this.exportTarget!:this.target!,active?'offscreen':kind,final);},
     setShowTrails:enabled=>model.setShowTrails(enabled),
     beginPerlinParameterActions:actions=>model.beginPerlinParameterActions(actions),interpolatePerlinParameterActions:(eased,finished,dt)=>model.interpolatePerlinParameterActions(eased,finished,dt),
     beginGradientActions:actions=>model.beginGradientActions(actions),interpolateGradientActions:(eased,finished)=>model.interpolateGradientActions(eased,finished),
    };
   },
  });
 }
 private renderOutput(scene:SceneDocument,context:GenerateContext,frame:OrdinarySourceCameraFrame,target:SourcePerlinCpuTarget,kind:'primary'|'offscreen',started:number):Raster{
  const {config}=this.configuration!,view=this.binding!.view,facts=this.model!.diagnostics();
  const sampleBytes=target.physicalWidth===context.width&&target.physicalHeight===context.height?0:context.width*context.height*4;
  const pixels=target.withWorkingBytes(sampleBytes,()=>samplePixels(target.readPixels(context.isCancelled),target.physicalWidth,target.physicalHeight,context.width,context.height,context.isCancelled));
  return {type:'raster',pixels,width:context.width,height:context.height,dimension:2,cameraResolved:true,backend:this.backend==='cpu'?'cpu':'webgl2',
   sourceCameraFrame:ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:frame},{...context,sourceViewport:{...context.sourceViewport!,logicalWidth:target.width,logicalHeight:target.height,target:kind}}),
   sourcePerlinFrame:{sourceViewport:{...view},samples:target.diagnostics().samples,frameIndex:frame.frameIndex,updates:facts.updates,queueComplete:frame.queueComplete,queueIndex:frame.queueIndex,sceneTime:frame.sceneTime},
   stats:{samples:this.backend==='gpu'?context.width*context.height:config.cpuStyle==='particles'?config.particles.count:config.curves.count*config.curves.length,generated:context.width*context.height,invalid:0,elapsedMs:performance.now()-started},
   warnings:['源 Perlin 保留 CPU/GPU 运行状态；倒退或修改配置会按当前后端重放。原版 JVM／JOGL 整图尚未验收。']};
 }
 private remember(scene:SceneDocument,context:GenerateContext,output:Raster){
  const {pixels:_,...metadata}=output;
  this.completed={identity:this.requestIdentity(scene,context),context:copyContext(context),metadata:structuredClone(metadata),background:sourcePerlinBackgroundRgba(this.configuration!.config.display.backgroundColor,false,0)};
 }
 generate(scene:SceneDocument,context:GenerateContext):SceneOutput{
  this.requireIdle();this.cleanup.prepare();const started=performance.now();
  try{
   const prepared=prepareConfiguration(scene),view=viewport(context),initial=ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:{time:0,frameIndex:0,camera:prepared.camera}},context),kind=initial.viewport.target;
   if(kind!=='primary'&&kind!=='offscreen')throw new Error('源 Perlin CPU 需要明确的显示目标');
   const density=view.pixelDensity,width=kind==='primary'?initial.viewport.logicalWidth:Math.round(context.width/density),height=kind==='primary'?initial.viewport.logicalHeight:Math.round(context.height/density);
   if(width<1||height<1)throw new Error('Perlin 导出尺寸小于一个逻辑像素');
   if(kind==='primary'&&(width!==view.width||height!==view.height))throw new Error('Perlin 主画布尺寸与模拟参考尺寸不一致');
   // Actual document edits auto-apply locally. Canvas resize, cold replay and
   // hot backend selection are deliberately not application events.
   if(prepared.key!==this.observedDocumentKey){this.applied=ownConfiguration(prepared);this.observedDocumentKey=prepared.key;}
   const key=identity([prepared.key,view,width,height,kind]);
   if(key!==this.key){this.releaseRuntime();this.key=key;this.initializeTimeline(ownConfiguration(prepared),{view,width,height,density,kind},false);}
   this.completed=undefined;this.cancelled=context.isCancelled;this.work=0;
   const requestedBackend=prepared.complete?.backend??'cpu',switched=this.backend!==requestedBackend;
   if(switched){this.backend=requestedBackend;this.model?.setBackend(requestedBackend);}
   const previousDraws=this.target?.diagnostics().draws,frame=this.timeline!.evaluate(context.time),target=this.target!;
   if((switched||this.primaryNeedsDraw)&&target.diagnostics().draws===previousDraws)this.display(target,kind,true);
   this.primaryNeedsDraw=false;
   const output=this.renderOutput(scene,context,frame,target,kind,started);
   if(kind==='primary')this.remember(scene,context,output);return output;
  }catch(error){this.reset([error]);throw error;}finally{this.cancelled=undefined;}
 }
 /** Requires the exact completed primary input. No initial primary draw is
  * inserted: setup -> fixed update -> export draw is the one warmup. Returned
  * scene is the effective applied backend/FPS; callers must publish that state
  * on stop rather than implicitly hot-switching back to an older document. */
 beginRecording(scene:SceneDocument,context:GenerateContext,options:{width:number;height:number;simulationFps:number}){
  this.requireIdle();this.cleanup.prepare();
  if(!this.matchesCompletedPrimary(scene,context)||context.sourceViewport?.target!=='primary'||!this.applied?.complete)throw new Error('Perlin 录制需要最后完成的主预览和完整已应用配置');
  if(context.width!==this.completed!.metadata.width||context.height!==this.completed!.metadata.height)throw new Error('Perlin 录制的主预览输出尺寸已改变');
  if(context.isCancelled?.())throw new DOMException('Perlin 已取消','AbortError');
  const clock=planPerlinRecordingClock(this.applied.document,options.simulationFps,context.isCancelled);
  const size=prepareSourcePerlinCaptureSize(options,this.binding!.density);
  // Restore initialization inputs without reverting unrelated current labels,
  // project metadata or source provenance held by the caller.
  const effective={...structuredClone(scene),perlinSource:structuredClone(this.applied.complete),
   sourceCamera:structuredClone(this.applied.document.sourceCamera),timeline:{...structuredClone(this.applied.document.timeline),fps:options.simulationFps},
   settings:{...scene.settings,sourceCameraProjection:this.applied.document.settings.sourceCameraProjection}};
  const configuration=prepareConfiguration(effective),binding=this.binding!,primary=copyContext({...context,time:0});
  const record:Recording={handle:Object.freeze({}),scene:effective,context:primary,clock,next:0};
  const started=performance.now();let changed=false;
  try{
   this.cancelled=context.isCancelled;this.work=0;
   // Allocation preflight may reject without touching the completed primary.
   const last=this.completed;
   try{this.ensureExportTarget(size,sourcePerlinBackgroundRgba(configuration.config.display.backgroundColor,false,0));}
   finally{changed=this.completed!==last;}
   this.completed=undefined;changed=true;this.releaseSimulation();this.timeline?.reset();
   this.initializeTimeline(configuration,binding,true);
   this.key=identity([configuration.key,binding.view,binding.width,binding.height,binding.kind]);
   this.observedDocumentKey=configuration.key;this.recording=record;
   const warmup=this.advanceRecording(record,0,started);
   return {handle:record.handle,scene:structuredClone(effective),context:copyContext(primary),clock:{...clock},warmup};
  }catch(error){if(changed)this.reset([error]);throw error;}finally{this.cancelled=undefined;}
 }
 private advanceRecording(record:Recording,displayFrame:number,started:number):Raster{
  this.work=0;
  const time=displayFrame/record.clock.simulationFps,frame=this.timeline!.evaluate(time),target=this.exportTarget!;
  const context={...record.context,time,quality:'export' as const,width:target.physicalWidth,height:target.physicalHeight};
  const output=this.renderOutput(record.scene,context,frame,target,'offscreen',started);
  assertPerlinRecordingFrame(output,record.clock,displayFrame);
  record.frame=frame;record.next=displayFrame+1;return output;
 }
 ownsRecording(handle:object):boolean{return !!this.recording&&this.recording.handle===handle;}
 nextRecordingFrame(handle:object,displayFrame:number):Raster{
  const record=this.recording;
  if(!record||record.handle!==handle||displayFrame!==record.next||displayFrame>record.clock.lastDisplayFrame)throw new Error('Perlin 录制身份或连续帧序号无效');
  if(record.context.isCancelled?.())throw new DOMException('Perlin 已取消','AbortError');
  this.cancelled=record.context.isCancelled;
  try{return this.advanceRecording(record,displayFrame,performance.now());}catch(error){this.reset([error]);throw error;}finally{this.cancelled=undefined;}
 }
 /** Stop does not draw, update, restore an old model or clear canvases. The
  * caller chooses when to resume live updates or render a paused primary frame.
  * Returning explicit state prevents accidental restoration of a hot backend. */
 finishRecording(handle:object):{scene:SceneDocument;context:GenerateContext}{
  const record=this.recording;if(!record||record.handle!==handle||!record.frame)throw new Error('Perlin 录制身份无效');
  const context=copyContext({...record.context,time:record.frame.time});
  this.recording=undefined;this.primaryNeedsDraw=true;
  return {scene:structuredClone(record.scene),context};
 }
}
