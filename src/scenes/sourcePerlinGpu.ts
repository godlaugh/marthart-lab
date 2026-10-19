import type {GenerateContext,SceneDocument,SceneOutput} from '../types';
import {GenerationCleanupState} from '../engine/generationCleanup';
import {SourcePerlinGpu,sourcePerlinFlowTextureSize,sourcePerlinGpuLayout} from '../engine/sourcePerlinGpu';
import {SourcePerlinFlowTexture} from '../engine/sourcePerlinFlowTexture';
import {createSourcePerlinGpuReplay} from '../engine/sourcePerlinGpuReplay';
import {ordinarySourceCameraFrame} from '../engine/ordinarySourceCamera';

/** Worker lifetime owns one authored source configuration and one texture
 * bucket. Display dimensions may change without advancing the simulation. */
export class SourcePerlinGpuSession {
 private readonly cleanup=new GenerationCleanupState();
 private key='';private gpu?:SourcePerlinGpu;private size=0;private retainedBytes=0;
 private replay?:ReturnType<typeof createSourcePerlinGpuReplay>;
 private cancelled?:()=>boolean;private constructions=0;
 reset(failures:readonly unknown[]=[]){this.cleanup.reset(()=>{this.gpu?.dispose();this.gpu=undefined;this.replay?.timeline.reset();this.replay=undefined;this.key='';this.size=0;this.retainedBytes=0;this.cancelled=undefined;this.constructions=0;},failures);}
 diagnostics(){return{constructions:this.constructions,retainedBytes:this.retainedBytes};}
 generate(scene:SceneDocument,context:GenerateContext):SceneOutput{
  this.cleanup.prepare();const started=performance.now();
  try{
   const key=JSON.stringify([scene.id,scene.perlinGpuSource,scene.sourceCamera,scene.timeline],(_k,v)=>typeof v==='number'?{number:Object.is(v,-0)?'-0':String(v)}:v);
   if(key!==this.key){this.reset();this.key=key;this.replay=createSourcePerlinGpuReplay(scene,()=>this.cancelled?.()??false);}
   this.cancelled=context.isCancelled;
   const owner=this.replay!,config=owner.config;
   const layout=sourcePerlinGpuLayout(context.width,context.height,config.uniforms.marchSteps);
   // Validate viewport before expensive CPU flow texture or GL allocation.
   ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:{time:0,frameIndex:0,camera:owner.camera}},context);
   const frame=owner.timeline.evaluate(context.time),display=owner.display();
   const size=sourcePerlinFlowTextureSize(context.width,context.height);
   if(!this.gpu||this.size!==size){
    this.gpu?.dispose();this.gpu=undefined;this.size=0;
    const pixels=new SourcePerlinFlowTexture({seed:config.seed,style:Math.max(0,Math.min(5,config.textureStyle)) as 0|1|2|3|4|5,size,isCancelled:context.isCancelled}).generate();
    this.gpu=new SourcePerlinGpu({size,pixels});this.size=size;this.constructions++;
   }
   this.retainedBytes=layout.bytes;
   const pixels=this.gpu.render({...config.uniforms,...display,width:context.width,height:context.height},context.isCancelled);
   const sourceCameraFrame=ordinarySourceCameraFrame({...scene,evaluatedSourceCamera:frame},context);
   return{type:'raster',pixels,width:context.width,height:context.height,dimension:2,cameraResolved:true,backend:'webgl2',sourceCameraFrame,
    stats:{samples:layout.pixels,generated:layout.pixels,invalid:0,elapsedMs:performance.now()-started},
    warnings:['源 Perlin GPU 使用独立 Processing 纹理与原包着色器适配；原版 JVM／JOGL 完整画面尚未验收。'],
   };
  }catch(error){this.reset([error]);throw error;}finally{this.cancelled=undefined;}
 }
}
