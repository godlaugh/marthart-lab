import type {GenerationInput,SceneOutput} from '../types';
/** Wire facts must describe the same completed Perlin update as the raster.
 * This validates transport identity, not the noise algorithm or GPU arithmetic. */
export function validSourcePerlinLiveOutput(output:SceneOutput,input:GenerationInput,options:{recording?:boolean;dimensions?:readonly[number,number];paused?:boolean}={}):boolean {
 try{
  if(output?.type!=='raster'||!input.perlinLive)return false;
  const live=output.perlinLive,frame=live?.frame,source=output.sourcePerlinFrame;
  const [width,height]=options.dimensions??[input.width,input.height];
  if(!live||!frame||!source||output.width!==width||output.height!==height||!(output.pixels instanceof Uint8ClampedArray)||output.pixels.length!==width*height*4)return false;
  if(live.sessionId!==input.perlinLive.sessionId||live.paused!==(options.paused??input.perlinLive.clock.paused)||!Number.isSafeInteger(live.constructions)||live.constructions<1||!['update','snapshot'].includes(live.renderKind))return false;
  // Snapshots retain the last actual clock observation; an unused request
  // timestamp is not evidence that the owner read an injected clock.
  if(!(options.recording?live.clockSource==='fixed-step':['worker-wall-clock','injected'].includes(live.clockSource))||!Number.isFinite(live.sceneTime)||live.sceneTime<0||live.sceneTime!==frame.sceneTime||live.sceneTime!==source.sceneTime)return false;
  if(!Number.isSafeInteger(frame.frameIndex)||frame.frameIndex<0||frame.frameIndex!==source.frameIndex||frame.queueIndex!==source.queueIndex||frame.queueComplete!==source.queueComplete||typeof frame.queueComplete!=='boolean')return false;
  if(!Number.isSafeInteger(frame.queueIndex)||frame.queueIndex<0||![frame.time,frame.activeDt,frame.rawDt,...frame.rates,...Object.values(frame.camera).flat()].every(v=>typeof v==='number'&&Number.isFinite(v)))return false;
  return true;
 }catch{return false;}
}
