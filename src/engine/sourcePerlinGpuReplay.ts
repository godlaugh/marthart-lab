import type {SceneDocument} from '../types';
import {SourcePerlinColorRuntime} from './sourcePerlinColorRuntime';
import {SourcePerlinParameterRuntime} from './sourcePerlinParameterRuntime';
import {OrdinarySourceCameraTimelineSession,ORDINARY_CAMERA_SEQUENCE} from './ordinarySourceCameraTimeline';
import {ordinarySourceCameraInitial} from './ordinarySourceCamera';
import {parseSourcePerlinGpuDocument,usesSourcePerlinGpu} from './sourcePerlinGpuDocument';

/** The same queue owns image time, palette refresh and parameter actions. GPU
 * pixels have no frame history, but palette texture construction does: stopping
 * a gradient must retain the last displayed palette, even on a cold seek. */
export function createSourcePerlinGpuReplay(scene:SceneDocument,isCancelled?:()=>boolean){
 if(!usesSourcePerlinGpu(scene))throw new Error('缺少源 Perlin GPU 配置');
 const parsed=parseSourcePerlinGpuDocument(scene.perlinGpuSource);
 if(!parsed.ok)throw new Error(`源 Perlin ${parsed.error.path.join('.')}: ${parsed.error.reason}`);
 const camera=ordinarySourceCameraInitial(scene);
 if(!camera||scene.timeline.schedule!==ORDINARY_CAMERA_SEQUENCE)throw new Error('源 Perlin GPU 需要原版顺序时间线');
 const config=parsed.value;let time=0;let palette:Uint32Array=new Uint32Array(256);
 const timeline=new OrdinarySourceCameraTimelineSession(camera,scene.timeline.tracks,scene.timeline.fps,{
  particleActions:'perlin',isCancelled,createParticles:()=>{
   time=0;
   const colors=new SourcePerlinColorRuntime({palette:config.palette,isCancelled});
   const parameters=new SourcePerlinParameterRuntime({initial:config.parameters,backend:'gpu',style:config.cpuStyle,isCancelled});
   return{
    bind:()=>{throw new Error('原版 Perlin 不支持粒子跟踪');},
    // GPU display does not consume trails; CPU field identity is not borrowed.
    setShowTrails:()=>{},
    beginPerlinParameterActions:actions=>parameters.begin(actions),
    interpolatePerlinParameterActions:(eased,finished,dt)=>parameters.interpolate(eased,finished,dt),
    beginGradientActions:actions=>colors.beginGradientActions(actions),
    interpolateGradientActions:(eased,finished)=>colors.interpolateGradientActions(eased,finished),
    update:frame=>{time=Math.fround(frame.time);colors.update(frame.deltaTime);parameters.update(frame.deltaTime);},
    displayFrame:()=>{palette=colors.paletteTexture();},
   };
  },
 });
 return{config,camera,timeline,display:()=>({time,palette})};
}
export function replaySourcePerlinGpuCamera(scene:SceneDocument,time:number){
 const owner=createSourcePerlinGpuReplay(scene);try{return owner.timeline.evaluate(time);}finally{owner.timeline.reset();}
}
