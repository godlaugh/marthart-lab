import {planPerlinFreshRecording} from './sourcePerlinRecording';
import { definition } from "../scenes";
import { generateScene, TemporalGenerationSession } from './temporal';
import { searchStableAttractor } from './stableSearch';
import { exploreComplex } from './complexExplore';
import type { GenerationRequest, GenerationPayload } from './generationProtocol';
import {isPausedCaptureOperation,isPerlinRecordingOperation} from './generationProtocol';
import {outputBuffers} from './outputBuffers';
import {planRootsFreshRecording} from './rootsRecording';
import type {GenerationInput,SceneDocument} from '../types';
import {enhanceSourcePausedImage,sourcePausedImageBytes} from './sourcePausedImage';
import {prepareSourcePausedUpscale,upscaleSourcePausedImage} from './sourcePausedUpscale';
import {validateRasterRequest} from './rasterDimensions';
import {prepareSourcePausedCaptureSize} from './sourcePausedCaptureSize';
const temporalSession = new TemporalGenerationSession();
let owner: number | undefined;
let completed:{id:number;scene:SceneDocument;context:GenerationInput}|undefined;
type RuntimeStart=ReturnType<typeof temporalSession.sourcePerlin.beginRecording>;
type RecordingRaster=RuntimeStart['warmup'];
let recording:{id:number;runtime:RuntimeStart;finish?:ReturnType<typeof temporalSession.sourcePerlin.finishRecording>;preview?:RecordingRaster;pendingFrame?:{index:number;output:RecordingRaster}}|undefined;
function retainsRecording(){
 if(!recording)return false;
 return recording.finish?temporalSession.sourcePerlin.matchesCompletedPrimary(recording.finish.scene,recording.finish.context):temporalSession.sourcePerlin.ownsRecording(recording.runtime.handle);
}

self.onmessage = (
  event: MessageEvent<GenerationRequest>,
) => {
  const { id, operation, sessionId } = event.data;
  const send = (payload: GenerationPayload, transfer: Transferable[] = []) => self.postMessage({ ...payload, sessionId }, { transfer });
  const start = performance.now();
  let captureSource:typeof completed;
  let recordingSource:typeof completed;
  const leaseAtEntry=recording;
  let captureRendered=false;
  let captureSourceMatched=false;
  try {
    // A failed release keeps the old owner and must still answer this request.
    if(recording&&(owner!==sessionId||!isPerlinRecordingOperation(operation)))throw new Error('Perlin 录制期间不能执行其它后台任务');
    if (owner !== sessionId) { temporalSession.reset(); owner = sessionId; completed=undefined; }
    if(event.data.operation==='samila-playback'){
      const source=completed;
      if(!source||source.id!==event.data.sourceId||source.scene.kind!=='samila'||!source.context.samilaLive?.clock||typeof event.data.paused!=='boolean')throw new Error('Samila 播放控制对应的实时主预览已过期');
      temporalSession.sourceSamila.setPaused(event.data.paused);
      completed={...source,context:{...source.context,samilaLive:{...source.context.samilaLive,clock:{...source.context.samilaLive.clock,paused:event.data.paused}}}};
      send({operation:'samila-playback',id,sourceId:source.id,paused:event.data.paused});return;
    }
    if(event.data.operation==='perlin-recording-begin'){
      if(recording)throw new Error('Perlin 录制已开始');
      const source=recordingSource=completed;
      if(!source||source.id!==event.data.sourceId)throw new Error('Perlin 录制对应的主预览已过期');
      const runtime=temporalSession.sourcePerlin.beginRecording(source.scene,source.context,event.data.options);
      recording={id,runtime};completed=undefined;
      send({operation:event.data.operation,id,recordingId:id,result:{scene:runtime.scene,context:runtime.context,clock:runtime.clock,warmup:runtime.warmup}},outputBuffers(runtime.warmup));return;
    }
    if(event.data.operation==='perlin-recording-frame'||event.data.operation==='perlin-recording-finish'){
      const lease=recording;
      if(!lease||lease.id!==event.data.recordingId)throw new Error('Perlin 录制身份已过期');
      if(event.data.operation==='perlin-recording-frame'){
        if(lease.finish)throw new Error('Perlin 录制已停止，等待主预览恢复');
        const displayFrame=event.data.displayFrame;
        if(!Number.isSafeInteger(displayFrame)||displayFrame<1)throw new Error('Perlin 录制帧序号无效');
        const pending=lease.pendingFrame;
        if(pending&&pending.index!==displayFrame)throw new Error('Perlin 上一录制帧尚未交付，请重试该帧或结束录制');
        const output=pending?.output??temporalSession.sourcePerlin.nextRecordingFrame(lease.runtime.handle,displayFrame);
        if(output.pixels.byteLength!==output.width*output.height*4)throw new Error('Perlin 录制帧传输状态未知，请结束录制');
        lease.pendingFrame={index:displayFrame,output};
        send({operation:event.data.operation,id,recordingId:lease.id,displayFrame,output},outputBuffers(output));lease.pendingFrame=undefined;return;
      }
      // finishRecording mutates runtime ownership exactly once. If publication
      // fails, retain its result and completed preview for an explicit retry.
      lease.finish??=temporalSession.sourcePerlin.finishRecording(lease.runtime.handle);
      const {scene,context}=lease.finish;
      if(!lease.preview||lease.preview.pixels.byteLength!==lease.preview.width*lease.preview.height*4){
        const output=generateScene(scene,context,temporalSession);
        if(output.type!=='raster')throw new Error('Perlin 录制结束没有生成主预览');
        lease.preview=output;
      }
      send({operation:event.data.operation,id,recordingId:lease.id,result:{scene,context,preview:lease.preview}},outputBuffers(lease.preview));
      completed={id,scene,context};recording=undefined;return;
    }
    if(event.data.operation==='roots-paused-capture'||event.data.operation==='perlin-paused-capture'||event.data.operation==='samila-paused-capture'){
      const source=captureSource=completed;
      if(!source||source.id!==event.data.sourceId)throw new Error('暂停截图对应的预览已过期');
      captureSourceMatched=true;
      const perlin=event.data.operation==='perlin-paused-capture',samila=event.data.operation==='samila-paused-capture';
      const {width,height}=event.data.size,scale=event.data.scale;
      if(scale!==1&&scale!==3&&scale!==5)throw new Error('暂停 PNG 放大倍率须为 1、3 或 5');
      if(perlin&&(!source.scene.perlinSource||source.scene.kind!=='perlin'||!source.context.sourcePerlinViewport||source.context.sourceViewport?.target!=='primary'))
        throw new Error('Perlin 暂停截图需要完整配置和已完成主画布的实际尺寸与密度');
      if(samila&&(!source.context.samilaLive||source.scene.kind!=='samila'))throw new Error('Samila 暂停截图需要已完成的实时主预览');
      // Perlin and Samila inherit parent density. Native render-buffer rounding can make
      // actual physical base dimensions differ from the user's requested size.
      const base=perlin||samila?prepareSourcePausedCaptureSize({width,height},samila?source.context.samilaLive!.pixelDensity:source.context.sourcePerlinViewport!.pixelDensity):{width,height};
      const upscale=scale===1?undefined:prepareSourcePausedUpscale(base.width,base.height,scale);
      if(upscale)validateRasterRequest({time:0,quality:'export',width:upscale.width,height:upscale.height});
      const additionalBytes=sourcePausedImageBytes(base.width,base.height)-base.width*base.height*4+(upscale?upscale.peakBytes-upscale.inputBytes:0);
      // The request carries only a completed-frame capability. The worker owns
      // scene history and its original primary context; no fresh replay occurs.
      completed=undefined;
      const result=samila
        ?temporalSession.sourceSamila.capturePaused(source.scene,{...source.context,quality:'export',width,height},{additionalBytes})
        :perlin
        ?temporalSession.sourcePerlin.capturePaused(source.scene,{...source.context,quality:'export',width,height,sourceViewport:{...source.context.sourceViewport!,target:'offscreen'}},{additionalBytes})
        :temporalSession.rootsNative.capturePaused(source.scene,{...source.context,quality:'export',width,height,rootsViewport:{logicalWidth:width,logicalHeight:height,referenceLogicalHeight:source.context.rootsViewport?.referenceLogicalHeight??source.context.height,target:'offscreen'}},{additionalBytes});
      captureRendered=true;
      if(result.capture.type!=='raster'||result.preview.type!=='raster')throw new Error('暂停截图没有生成图像');
      const captureWidth=result.capture.width,captureHeight=result.capture.height;
      if(captureWidth!==base.width||captureHeight!==base.height)throw new Error('暂停截图实际尺寸与已核验的后处理预算不一致');
      const enhanced=enhanceSourcePausedImage(result.capture.pixels,captureWidth,captureHeight);
      result.capture.pixels=scale===1?enhanced:upscaleSourcePausedImage(enhanced,captureWidth,captureHeight,scale);
      result.capture.width=upscale?.width??captureWidth;result.capture.height=upscale?.height??captureHeight;
      const imageFacts={enhancement:'mathart-1.7.8-scale1' as const,baseSize:[captureWidth,captureHeight] as const,scale,resampling:upscale?'openjdk21-software-bicubic' as const:'none' as const,originalRuntimeCompared:false as const};
      if(perlin||samila)result.capture.sourcePausedImage=imageFacts;else result.capture.rootsPausedImage=imageFacts;
      completed={...source,id};
      send({operation:event.data.operation,id,result:{capture:result.capture,preview:result.preview}},[...new Set([...outputBuffers(result.capture),...outputBuffers(result.preview)])]);
      return;
    }
    const {scene}=event.data;
    if(event.data.operation==='perlin-recording-plan'){
      const result=planPerlinFreshRecording(scene,{simulationFps:event.data.simulationFps,encoderFps:event.data.encoderFps});
      send({operation:'perlin-recording-plan',id,result});return;
    }
    if(event.data.operation==='roots-recording-plan'){
      const result=planRootsFreshRecording(scene,{simulationFps:event.data.simulationFps,encoderFps:event.data.encoderFps});
      send({operation:'roots-recording-plan',id,result});return;
    }
    if(event.data.operation==='spirograph-recording-plan'){
      const result=temporalSession.spirograph.recordingPlan(scene,event.data.startFrame,event.data.fps);
      send({operation:'spirograph-recording-plan',id,result});return;
    }
    if (event.data.operation === 'explore-complex') {
      const result = exploreComplex(scene, event.data.options, {
        onProgress: progress => send({ operation: 'explore-complex', id, progress }),
      });
      send({ operation: 'explore-complex', id, result });
      return;
    }
    if (event.data.operation === 'search-stable') {
      const result = searchStableAttractor(scene, event.data.options, {
        onProgress: progress => send({ operation: 'search-stable', id, progress }),
      });
      send({ operation: 'search-stable', id, result });
      return;
    }
    const { context } = event.data;
    completed=undefined;
    const output = generateScene(scene, { ...context, onStatus: event.data.wantsStatus ? status => send({operation:'generate-status',id,status}) : undefined, onProgress: output => {
      output.dimension ??= definition(scene.kind).dimension;
      send({ operation: 'generate-progress', id, output }, outputBuffers(output));
    } }, temporalSession);
    output.dimension ??= definition(scene.kind).dimension;
    output.stats.elapsedMs = performance.now() - start;
    completed={id,scene,context};
    send({ operation: 'generate', id, output }, outputBuffers(output));
  } catch (error) {
    const message=error instanceof Error?error.message:String(error);
    if(isPerlinRecordingOperation(operation)||leaseAtEntry){
      const retained=owner===sessionId&&retainsRecording();
      // Foreign and stale requests cannot revoke the actual lease. A runtime
      // failure does revoke it, even if the textual error looks recoverable.
      if(recording&&!retainsRecording()){recording=undefined;completed=undefined;}
      const previewRetained=!recording&&!!recordingSource&&owner===sessionId&&temporalSession.sourcePerlin.matchesCompletedPrimary(recordingSource.scene,recordingSource.context);
      if(recordingSource)completed=previewRetained?recordingSource:undefined;
      send({id,operation,error:message,...(retained?{retainedRecordingId:recording!.id}:{}),...(previewRetained?{retainedSourceId:recordingSource!.id}:{})});
    }else     if(isPausedCaptureOperation(operation)){
      // Check the session owner, not an error category: a late capacity or
      // readback failure may already have changed/retired shared density ink.
      const retained=!captureRendered&&captureSourceMatched&&!!captureSource&&(operation==='samila-paused-capture'
        ?temporalSession.sourceSamila.matchesCompletedPrimary(captureSource.scene,captureSource.context)
        :operation==='perlin-paused-capture'
        ?temporalSession.sourcePerlin.matchesCompletedPrimary(captureSource.scene,captureSource.context)
        :temporalSession.rootsNative.matchesCompletedPrimary(captureSource.scene,captureSource.context));
      completed=retained?captureSource:undefined;
      send({id,operation,error:message,...(retained?{retainedSourceId:captureSource!.id}:{})});
    }else send({id,operation,error:message});
  }
};
