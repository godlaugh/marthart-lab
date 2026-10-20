import {sourcePerlinBackgroundRgba} from '../engine/sourcePerlinBackground';
import type {GenerateContext,SceneDocument,SceneOutput} from '../types';
import {GenerationCleanupState} from '../engine/generationCleanup';
import {SourcePerlinCpuModel} from '../engine/sourcePerlinCpuModel';
import {SourcePerlinCpuTarget} from '../engine/sourcePerlinCpuTarget';
import {parseSourcePerlinCpuDocument} from '../engine/sourcePerlinCpuDocument';
import {usesSourcePerlinCpu} from '../engine/sourcePerlinIdentity';
import {OrdinarySourceCameraTimelineSession,ORDINARY_CAMERA_SEQUENCE} from '../engine/ordinarySourceCameraTimeline';
import {ordinarySourceCameraInitial,ordinarySourceCameraFrame} from '../engine/ordinarySourceCamera';

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
export class SourcePerlinCpuSession{
 private readonly cleanup=new GenerationCleanupState();
 private key='';private model?:SourcePerlinCpuModel;private target?:SourcePerlinCpuTarget;
 private timeline?:OrdinarySourceCameraTimelineSession;private cancelled?:()=>boolean;
 private constructions=0;private work=0;
 private reserve=(units:number)=>{if(!Number.isSafeInteger(units)||units<0||this.work+units>20_000_000)throw new Error('Perlin CPU 单次请求超过 2000 万处理项预算；请分段播放或减少轨迹规模');this.work+=units;};
 reset(failures:readonly unknown[]=[]){this.cleanup.reset(()=>{this.model?.dispose();this.model=undefined;this.target?.dispose();this.target=undefined;this.timeline?.reset();this.timeline=undefined;this.key='';this.cancelled=undefined;this.constructions=0;},failures);}
 diagnostics(){return{constructions:this.constructions,target:this.target?.diagnostics(),model:this.model?.diagnostics()};}
 generate(scene:SceneDocument,context:GenerateContext):SceneOutput{
  this.cleanup.prepare();const started=performance.now();
  try{
   if(!usesSourcePerlinCpu(scene))throw new Error('缺少源 Perlin CPU 配置');
   const parsed=parseSourcePerlinCpuDocument(scene.perlinCpuSource);if(!parsed.ok)throw new Error(`Perlin ${parsed.error.path.join('.')}: ${parsed.error.reason}`);
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
   const key=JSON.stringify([scene.id,config,scene.sourceCamera,scene.timeline,view,width,height,kind],(_k,v)=>typeof v==='number'?{number:Object.is(v,-0)?'-0':String(v)}:v);
   if(key!==this.key){
    this.reset();this.key=key;
    this.timeline=new OrdinarySourceCameraTimelineSession(camera,scene.timeline.tracks,scene.timeline.fps,{
     particleActions:'perlin',isCancelled:()=>this.cancelled?.()??false,
     createParticles:()=>{
      this.model?.dispose();this.model=undefined;this.target?.dispose();this.target=undefined;
      // Offscreen creation clears to the configured background before fading.
      // A fresh local preview uses the same explicit background; native scene
      // reload may retain a previous scene background and is not inferred here.
      const options={width,height,density,initialColor:sourcePerlinBackgroundRgba(config.display.backgroundColor,false,0)};
      this.target=kind==='primary'?SourcePerlinCpuTarget.createSmoothed(options,8):new SourcePerlinCpuTarget({...options,samples:0});
      const model=this.model=new SourcePerlinCpuModel({config,sourceWidth:view.width,sourceHeight:view.height,curveCacheSamples:4,reserve:this.reserve,isCancelled:()=>this.cancelled?.()??false});this.constructions++;
      return{bind:()=>{throw new Error('原版 Perlin 不支持粒子跟踪');},
       update:frame=>model.update(frame.time,frame.deltaTime),displayFrame:()=>model.draw({target:this.target!,kind,sourcePixelDensity:view.pixelDensity}),
       setShowTrails:enabled=>model.setShowTrails(enabled),
       beginPerlinParameterActions:actions=>model.beginPerlinParameterActions(actions),interpolatePerlinParameterActions:(eased,finished,dt)=>model.interpolatePerlinParameterActions(eased,finished,dt),
       beginGradientActions:actions=>model.beginGradientActions(actions),interpolateGradientActions:(eased,finished)=>model.interpolateGradientActions(eased,finished),
      };
     },
    });
   }
   this.cancelled=context.isCancelled;this.work=0;
   const frame=this.timeline!.evaluate(context.time),target=this.target!,facts=this.model!.diagnostics();
   const pixels=samplePixels(target.readPixels(context.isCancelled),target.physicalWidth,target.physicalHeight,context.width,context.height,context.isCancelled);
   return{type:'raster',pixels,width:context.width,height:context.height,dimension:2,cameraResolved:true,backend:'cpu',sourceCameraFrame:ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:frame},{...context,sourceViewport:{...initial.viewport,logicalWidth:width,logicalHeight:height}}),
    sourcePerlinFrame:{sourceViewport:view,samples:target.diagnostics().samples,frameIndex:frame.frameIndex,updates:facts.updates},
    stats:{samples:config.cpuStyle==='particles'?config.particles.count:config.curves.count*config.curves.length,generated:context.width*context.height,invalid:0,elapsedMs:performance.now()-started},
    warnings:['源 Perlin CPU 按固定帧率执行运动与累积绘制；原版 JVM／JOGL 整图尚未验收。'],
   };
  }catch(error){this.reset([error]);throw error;}finally{this.cancelled=undefined;}
 }
}
