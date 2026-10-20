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
import {OrdinarySourceCameraTimelineSession,ORDINARY_CAMERA_SEQUENCE} from '../engine/ordinarySourceCameraTimeline';
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
/** A retained worker replay owns model, scene history and transparent curve
 * cache together. Rewind or a changed logical target rebuilds all three. */
export class SourcePerlinSession{
 private readonly cleanup=new GenerationCleanupState();
 private key='';private model?:SourcePerlinCpuModel;private target?:SourcePerlinCpuTarget;
 private timeline?:OrdinarySourceCameraTimelineSession;private cancelled?:()=>boolean;
 private flow?:SourcePerlinFlowResources;private backend:'cpu'|'gpu'='cpu';
 private constructions=0;private work=0;
 private exportTarget?:SourcePerlinCpuTarget;private releasingExportTarget?:SourcePerlinCpuTarget;
 private draw?:(target:SourcePerlinCpuTarget,kind:'primary'|'offscreen',final:boolean)=>void;
 private completed?:{identity:string;context:GenerateContext;metadata:Omit<Raster,'pixels'>;background:readonly[number,number,number,number]};
 private requestIdentity(scene:SceneDocument,c:GenerateContext){return identity([scene.id,scene.perlinSource,scene.perlinCpuSource,scene.sourceCamera,scene.settings.sourceCameraProjection,scene.timeline,c.time,c.sourcePerlinViewport,c.sourceViewport?.referenceLogicalHeight,c.sourceViewport?.projectionPass]);}
 matchesCompletedPrimary(scene:SceneDocument,c:GenerateContext):boolean{
  try{return !!this.completed&&!!this.target?.diagnostics().initialized&&this.completed.identity===this.requestIdentity(scene,c);}catch{return false;}
 }
 capturePaused(scene:SceneDocument,c:GenerateContext,options:{additionalBytes?:number}={}):{capture:Raster;preview:Raster}{
  const last=this.completed,extra=options.additionalBytes??0;
  if(!Number.isSafeInteger(extra)||extra<0)throw new Error('Perlin 暂停截图后处理预留无效');
  if(!last||!this.matchesCompletedPrimary(scene,c)||!this.draw)throw new Error('Perlin 暂停截图需要同实例最后完成的主预览');
  if(c.sourceViewport?.target!=='offscreen'||c.sourceViewport.projectionPass!==last.context.sourceViewport?.projectionPass||c.sourceViewport.referenceLogicalHeight!==last.context.sourceViewport.referenceLogicalHeight)throw new Error('Perlin 暂停截图需要原预览的离屏参考尺寸与投影');
  if(c.isCancelled?.())throw new DOMException('Perlin 已取消','AbortError');
  const size=prepareSourcePerlinCaptureSize(c,last.metadata.sourcePerlinFrame!.sourceViewport.pixelDensity),primary=this.target!,started=performance.now();
  // Both targets reserve their readbacks. Count the optional sampled preview
  // alongside those readbacks and all later enhancement/upscale storage.
  const previewSampleBytes=primary.physicalWidth===last.metadata.width&&primary.physicalHeight===last.metadata.height?0:last.metadata.width*last.metadata.height*4;
  let changed=false;
  try{return primary.withWorkingBytes(extra+previewSampleBytes,()=>{
   if(!this.exportTarget||this.exportTarget.width!==size.logicalWidth||this.exportTarget.height!==size.logicalHeight){
    const next=primary.createSibling({width:size.logicalWidth,height:size.logicalHeight,density:size.density,samples:0,initialColor:last.background});
    // Hold both attachment owners until release succeeds. Cleanup failure
    // must not orphan either the former target or the replacement.
    this.completed=undefined;changed=true;
    this.releasingExportTarget=this.exportTarget;this.exportTarget=next;
    this.releasingExportTarget?.dispose();this.releasingExportTarget=undefined;
   }
   const target=this.exportTarget;
   this.completed=undefined;changed=true;this.cancelled=c.isCancelled;this.work=0;
   this.draw!(target,'offscreen',true);
   const capture:Raster={...structuredClone(last.metadata),pixels:target.readPixels(c.isCancelled),width:size.width,height:size.height,
    sourceCameraFrame:{...structuredClone(last.metadata.sourceCameraFrame!),viewport:{...last.metadata.sourceCameraFrame!.viewport,logicalWidth:size.logicalWidth,logicalHeight:size.logicalHeight,target:'offscreen'}},
    sourcePerlinFrame:{...last.metadata.sourcePerlinFrame!,samples:0},stats:{...last.metadata.stats,samples:this.backend==='gpu'?size.width*size.height:last.metadata.stats.samples,generated:size.width*size.height,elapsedMs:performance.now()-started}};
   // MathArt.draw continues after savePausedFrameInternal: paused update does
   // not advance simulation, but this primary render can rebuild display caches
   // and adds one more accumulation blend on its own history.
   this.draw!(primary,'primary',true);
   const preview:Raster={...structuredClone(last.metadata),pixels:samplePixels(primary.readPixels(c.isCancelled),primary.physicalWidth,primary.physicalHeight,last.metadata.width,last.metadata.height,c.isCancelled),stats:{...last.metadata.stats,elapsedMs:performance.now()-started}};
   this.completed=last;return{capture,preview};
  });}catch(error){if(changed)this.reset([error]);throw error;}finally{this.cancelled=undefined;}
 }

 private reserve=(units:number)=>{if(!Number.isSafeInteger(units)||units<0||this.work+units>20_000_000)throw new Error('Perlin CPU 单次请求超过 2000 万处理项预算；请分段播放或减少轨迹规模');this.work+=units;};
 reset(failures:readonly unknown[]=[]){this.cleanup.reset(()=>{this.completed=undefined;this.draw=undefined;this.releasingExportTarget?.dispose();this.releasingExportTarget=undefined;this.exportTarget?.dispose();this.exportTarget=undefined;this.model?.dispose();this.model=undefined;this.target?.dispose();this.target=undefined;this.flow?.dispose();this.flow=undefined;this.timeline?.reset();this.timeline=undefined;this.key='';this.cancelled=undefined;this.constructions=0;},failures);}
 diagnostics(){return{constructions:this.constructions,target:this.target?.diagnostics(),exportTarget:this.exportTarget?.diagnostics(),model:this.model?.diagnostics(),flow:this.flow?.diagnostics()};}
 diagnosticSnapshot(){return this.model?.diagnosticSnapshot();}
 generate(scene:SceneDocument,context:GenerateContext):SceneOutput{
  this.cleanup.prepare();const started=performance.now();
  try{
   const unified=scene.perlinSource===undefined?undefined:parseSourcePerlinDocument(scene.perlinSource);
   if(unified&&!unified.ok)throw new Error(`Perlin ${unified.error.path.join('.')}: ${unified.error.reason}`);
   const complete=unified?.ok?unified.value:undefined;
   const parsed=parseSourcePerlinCpuDocument(sourcePerlinCpuConfiguration(scene));if(!parsed.ok)throw new Error(`Perlin ${parsed.error.path.join('.')}: ${parsed.error.reason}`);
   const config=parsed.value,view=viewport(context),camera=ordinarySourceCameraInitial(scene);
   if(!camera||scene.timeline.schedule!==ORDINARY_CAMERA_SEQUENCE)throw new Error('源 Perlin CPU 需要原版顺序时间线');
   const initial=ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:{time:0,frameIndex:0,camera}},context),kind=initial.viewport.target;
   if(kind!=='primary'&&kind!=='offscreen')throw new Error('源 Perlin CPU 需要明确的显示目标');
   const density=view.pixelDensity;
   // ensureRenderBuffer divides desired physical export dimensions by the
   // parent density, rounds to logical pixels, then inherits that same density.
   const width=kind==='primary'?initial.viewport.logicalWidth:Math.round(context.width/density),height=kind==='primary'?initial.viewport.logicalHeight:Math.round(context.height/density);
   if(width<1||height<1)throw new Error('Perlin 导出尺寸小于一个逻辑像素');
   if(kind==='primary'&&(width!==view.width||height!==view.height))throw new Error('Perlin 主画布尺寸与模拟参考尺寸不一致');
   const requestedBackend=complete?.backend??'cpu';
   // Backend selection is a live flag, not part of initialization identity.
   const key=identity([scene.id,config,complete?.gpu,scene.sourceCamera,scene.timeline,view,width,height,kind]);
   const display=(target:SourcePerlinCpuTarget,kind:'primary'|'offscreen',final:boolean)=>{
    const model=this.model!;
    if(this.backend==='gpu'){
     const gpu=complete!.gpu;
     sourcePerlinGpuLayout(target.physicalWidth,target.physicalHeight,gpu.uniforms.marchSteps);
     // GPU display, including a skipped intermediate framebuffer, owns lazy
     // palette/flow construction. Subsequent CPU setters observe its noise.
     const facts=model.gpuDisplayFacts(),style=Math.max(0,Math.min(5,gpu.textureStyle)) as 0|1|2|3|4|5;
     const channel=this.flow!.channel(style,sourcePerlinFlowTextureSize(target.physicalWidth,target.physicalHeight));
     if(final)target.drawGpu({...gpu.uniforms,...facts,width:target.physicalWidth,height:target.physicalHeight},channel,()=>this.cancelled?.()??false,this.flow!.diagnostics().retainedBytes);
    }else if(final||config.display.accumulation||config.cpuStyle==='field-curves')model.draw({target,kind,sourcePixelDensity:view.pixelDensity});
   };
   if(key!==this.key){
    this.reset();this.key=key;this.backend=requestedBackend;
    this.timeline=new OrdinarySourceCameraTimelineSession(camera,scene.timeline.tracks,scene.timeline.fps,{
     particleActions:'perlin',isCancelled:()=>this.cancelled?.()??false,
     createParticles:()=>{
      this.completed=undefined;this.exportTarget?.dispose();this.exportTarget=undefined;this.model?.dispose();this.model=undefined;this.target?.dispose();this.target=undefined;this.flow?.dispose();this.flow=undefined;
      // Offscreen creation clears to the configured background before fading.
      // A fresh local preview uses the same explicit background; native scene
      // reload may retain a previous scene background and is not inferred here.
      const options={width,height,density,initialColor:sourcePerlinBackgroundRgba(config.display.backgroundColor,false,0)};
      this.target=kind==='primary'?SourcePerlinCpuTarget.createSmoothed(options,8):new SourcePerlinCpuTarget({...options,samples:0});
      const flow=this.flow=new SourcePerlinFlowResources({seed:config.seed,isCancelled:()=>this.cancelled?.()??false});
      const model=this.model=new SourcePerlinCpuModel({config,sourceWidth:view.width,sourceHeight:view.height,curveCacheSamples:4,backend:this.backend,noise:flow.noise,reserve:this.reserve,isCancelled:()=>this.cancelled?.()??false});this.constructions++;
      return{bind:()=>{throw new Error('原版 Perlin 不支持粒子跟踪');},
       update:frame=>model.update(frame.time,frame.deltaTime),displayFrame:(_frameIndex,final)=>{
        // Nonaccumulating particle display only clears and draws the current
        // retained trails. Intermediate cold-seek images have no consumer and
        // no model/cache effects. Still execute every motion/color/trail update.
        // Curve caches and accumulation retain display history and cannot skip.
        this.draw!(this.target!,kind,final);
       },
       setShowTrails:enabled=>model.setShowTrails(enabled),
       beginPerlinParameterActions:actions=>model.beginPerlinParameterActions(actions),interpolatePerlinParameterActions:(eased,finished,dt)=>model.interpolatePerlinParameterActions(eased,finished,dt),
       beginGradientActions:actions=>model.beginGradientActions(actions),interpolateGradientActions:(eased,finished)=>model.interpolateGradientActions(eased,finished),
      };
     },
    });
   }
   this.draw=display;this.completed=undefined;this.cancelled=context.isCancelled;this.work=0;
   const switched=this.backend!==requestedBackend;
   if(switched){this.backend=requestedBackend;this.model?.setBackend(requestedBackend);}
   const previousDraws=this.target?.diagnostics().draws;
   const frame=this.timeline!.evaluate(context.time),target=this.target!;
   // A paused backend switch redraws the retained scene without another clock
   // update. Ordinary replay intentionally emits nothing for the same frame.
   if(switched&&target.diagnostics().draws===previousDraws)display(target,kind,true);
   const facts=this.model!.diagnostics();
   const pixels=samplePixels(target.readPixels(context.isCancelled),target.physicalWidth,target.physicalHeight,context.width,context.height,context.isCancelled);
   const output:Raster={type:'raster',pixels,width:context.width,height:context.height,dimension:2,cameraResolved:true,backend:this.backend==='cpu'?'cpu':'webgl2',sourceCameraFrame:ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:frame},{...context,sourceViewport:{...initial.viewport,logicalWidth:width,logicalHeight:height}}),
    sourcePerlinFrame:{sourceViewport:view,samples:target.diagnostics().samples,frameIndex:frame.frameIndex,updates:facts.updates},
    stats:{samples:this.backend==='gpu'?context.width*context.height:config.cpuStyle==='particles'?config.particles.count:config.curves.count*config.curves.length,generated:context.width*context.height,invalid:0,elapsedMs:performance.now()-started},
    warnings:['源 Perlin 保留 CPU/GPU 运行状态；倒退或修改配置会按当前后端重放。原版 JVM／JOGL 整图尚未验收。'],
   };
   if(kind==='primary'){const {pixels:_,...metadata}=output;this.completed={identity:this.requestIdentity(scene,context),context:{...context,sourceViewport:context.sourceViewport?{...context.sourceViewport}:undefined,sourcePerlinViewport:context.sourcePerlinViewport?{...context.sourcePerlinViewport}:undefined},metadata:structuredClone(metadata),background:sourcePerlinBackgroundRgba(config.display.backgroundColor,false,0)};}
   return output;
  }catch(error){this.reset([error]);throw error;}finally{this.cancelled=undefined;}
 }
}
