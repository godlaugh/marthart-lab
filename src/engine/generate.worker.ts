import {planFractalFreshRecording} from './sourceFractalRecording';
import {planPerlinFreshRecording} from './sourcePerlinRecording';
import { definition } from "../scenes";
import { generateScene, TemporalGenerationSession } from './temporal';
import { searchStableAttractor } from './stableSearch';
import { exploreComplex } from './complexExplore';
import type { GenerationRequest, GenerationPayload } from './generationProtocol';
import {isPausedCaptureOperation,isSourceRecordingOperation} from './generationProtocol';
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
function recordingProducer(scene:SceneDocument){return scene.kind==='fractal'?temporalSession.sourceFractal:scene.kind==='perlin'?temporalSession.sourcePerlin:scene.kind==='map'?temporalSession.sourceMap:scene.kind==='symmetry'?temporalSession.sourceSymmetry:undefined;}
type RecordingProducer=NonNullable<ReturnType<typeof recordingProducer>>;
type RuntimeStart=ReturnType<RecordingProducer['beginRecording']>;
type RecordingRaster=RuntimeStart['warmup'];
let recording:{id:number;producer:RecordingProducer;runtime:RuntimeStart;finish?:ReturnType<RecordingProducer['finishRecording']>;preview?:RecordingRaster;pendingFrame?:{index:number;output:RecordingRaster}}|undefined;
function retainsRecording(){
 if(!recording)return false;
 return recording.finish?recording.producer.matchesCompletedPrimary(recording.finish.scene,recording.finish.context):recording.producer.ownsRecording(recording.runtime.handle);
}

self.onmessage = (
  event: MessageEvent<GenerationRequest>,
) => {
  const { id, operation, sessionId } = event.data;
  const send = (payload: GenerationPayload, transfer: Transferable[] = []) => self.postMessage({ ...payload, sessionId }, { transfer });
  const start = performance.now();
  let captureSource:typeof completed;
  let recordingSource:typeof completed;
  let generationSource:typeof completed;
  const leaseAtEntry=recording;
  let captureRendered=false;
  let captureSourceMatched=false;
  try {
    // A failed release keeps the old owner and must still answer this request.
    if(recording&&(owner!==sessionId||!isSourceRecordingOperation(operation)))throw new Error('源场景录制期间不能执行其它后台任务');
    if (owner !== sessionId) { temporalSession.reset(); owner = sessionId; completed=undefined; }
    if(event.data.operation==='iterated-navigation'){
      const source=completed;
      if(!source||source.id!==event.data.sourceId||(source.scene.kind!=='map'&&source.scene.kind!=='symmetry'))throw Error('迭代视口对应的主预览已过期');
      const output=temporalSession[source.scene.kind==='map'?'sourceMap':'sourceSymmetry'].navigatePaused(source.scene,source.context,event.data.event);
      completed={...source,id};send({operation:'iterated-navigation',id,sourceId:source.id,output},[output.pixels.buffer]);return;
    }
    if(event.data.operation==='iterated-parameters'){
      const source=completed;
      if(!source||source.id!==event.data.sourceId||(source.scene.kind!=='map'&&source.scene.kind!=='symmetry'))throw Error('迭代参数对应的主预览已过期');
      temporalSession[source.scene.kind==='map'?'sourceMap':'sourceSymmetry'].updateParameters(source.scene,event.data.scene,source.context,event.data.writes);
      completed={...source,scene:event.data.scene};send({operation:'iterated-parameters',id,sourceId:source.id});return;
    }
    if(event.data.operation==='symmetry-playback' ||event.data.operation==='map-playback'){
      const source=completed,family=event.data.operation==='map-playback'?'map':'symmetry',key=family==='map'?'mapLive':'symmetryLive';
      const live=source?.context[key];
      if(!source||source.id!==event.data.sourceId||source.scene.kind!==family||!live||source.context.sourceViewport?.target!=='primary'||typeof event.data.paused!=='boolean')throw new Error('迭代场景播放控制对应的实时主预览已过期');
      temporalSession[family==='map'?'sourceMap':'sourceSymmetry'].setPaused(event.data.paused,event.data.timestampMs);
      completed={...source,context:{...source.context,[key]:{...live,clock:{...live.clock,paused:event.data.paused}}}};
      send({operation:event.data.operation,id,sourceId:source.id,paused:event.data.paused});return;
    }
    if(event.data.operation==='samila-playback'){
      const source=completed;
      if(!source||source.id!==event.data.sourceId||source.scene.kind!=='samila'||!source.context.samilaLive?.clock||typeof event.data.paused!=='boolean')throw new Error('Samila 播放控制对应的实时主预览已过期');
      temporalSession.sourceSamila.setPaused(event.data.paused);
      completed={...source,context:{...source.context,samilaLive:{...source.context.samilaLive,clock:{...source.context.samilaLive.clock,paused:event.data.paused}}}};
      send({operation:'samila-playback',id,sourceId:source.id,paused:event.data.paused});return;
    }
    if(event.data.operation==='fractal-playback'){
      const source=completed,live=source?.context.fractalLive;
      if(!source||source.id!==event.data.sourceId||source.scene.kind!=='fractal'||!live||typeof event.data.paused!=='boolean'||!temporalSession.sourceFractal.matchesCompletedPrimary(source.scene,source.context))throw Error('分形播放控制对应的实时主预览已过期');
      temporalSession.sourceFractal.setPaused(event.data.paused,event.data.timestampMs);
      completed={...source,context:{...source.context,fractalLive:{...live,clock:{...live.clock,paused:event.data.paused}}}};
      send({operation:'fractal-playback',id,sourceId:source.id,paused:event.data.paused});return;
    }
    if(event.data.operation==='source-recording-begin'){
      if(recording)throw new Error('源场景录制已开始');
      const source=recordingSource=completed;
      if(!source||source.id!==event.data.sourceId)throw new Error('源场景录制对应的主预览已过期');
      const producer=recordingProducer(source.scene);if(!producer)throw new Error('当前场景不支持源录制');
      const runtime=producer.beginRecording(source.scene,source.context,event.data.options);
      recording={id,producer,runtime};completed=undefined;
      send({operation:event.data.operation,id,recordingId:id,result:{scene:runtime.scene,context:runtime.context,clock:runtime.clock,warmup:runtime.warmup}},outputBuffers(runtime.warmup));return;
    }
    if(event.data.operation==='source-recording-frame'||event.data.operation==='source-recording-finish'){
      const lease=recording;
      if(!lease||lease.id!==event.data.recordingId)throw new Error('源场景录制身份已过期');
      if(event.data.operation==='source-recording-frame'){
        if(lease.finish)throw new Error('源场景录制已停止，等待主预览恢复');
        const displayFrame=event.data.displayFrame;
        if(!Number.isSafeInteger(displayFrame)||displayFrame<1)throw new Error('源场景录制帧序号无效');
        const pending=lease.pendingFrame;
        if(pending&&pending.index!==displayFrame)throw new Error('源场景上一录制帧尚未交付，请重试该帧或结束录制');
        const output=pending?.output??lease.producer.nextRecordingFrame(lease.runtime.handle,displayFrame);
        if(output.pixels.byteLength!==output.width*output.height*4)throw new Error('源场景录制帧传输状态未知，请结束录制');
        lease.pendingFrame={index:displayFrame,output};
        send({operation:event.data.operation,id,recordingId:lease.id,displayFrame,output},outputBuffers(output));lease.pendingFrame=undefined;return;
      }
      // finishRecording mutates runtime ownership exactly once. If publication
      // fails, retain its result and completed preview for an explicit retry.
      lease.finish??=lease.producer.finishRecording(lease.runtime.handle);
      if('preview' in lease.finish&&lease.finish.preview.pixels.byteLength!==lease.finish.preview.width*lease.finish.preview.height*4){
        // The owner retains a bounded, same-handle snapshot handoff until the
        // next live operation. Rebind pixels detached by uncertain publication
        // without resetting host time or advancing the scene a second time.
        lease.finish=lease.producer.finishRecording(lease.runtime.handle);
      }
      const {scene,context}=lease.finish;
      if(!lease.preview||lease.preview.pixels.byteLength!==lease.preview.width*lease.preview.height*4){
        // Fractal stop already restores primary from the final numerical
        // snapshot. A generic generate here would advance its live queue.
        const output='preview' in lease.finish?lease.finish.preview:generateScene(scene,context,temporalSession);
        if(output.type!=='raster')throw new Error('源场景录制结束没有生成主预览');
        lease.preview=output;
      }
      const resumed={...context,time:lease.preview.fractalLive?.sceneTime??lease.preview.mapLive?.sceneTime??lease.preview.symmetryLive?.sceneTime??context.time};
      send({operation:event.data.operation,id,recordingId:lease.id,result:{scene,context:resumed,preview:lease.preview}},outputBuffers(lease.preview));
      completed={id,scene,context:resumed};recording=undefined;return;
    }
    if(event.data.operation==='roots-paused-capture'||event.data.operation==='perlin-paused-capture'||event.data.operation==='samila-paused-capture'||event.data.operation==='symmetry-paused-capture'||event.data.operation==='map-paused-capture'||event.data.operation==='fractal-paused-capture'){
      const source=captureSource=completed;
      if(!source||source.id!==event.data.sourceId)throw new Error('暂停截图对应的预览已过期');
      captureSourceMatched=true;
      const fractal=event.data.operation==='fractal-paused-capture',perlin=event.data.operation==='perlin-paused-capture',samila=event.data.operation==='samila-paused-capture',iterated=event.data.operation==='symmetry-paused-capture'||event.data.operation==='map-paused-capture',family=event.data.operation==='map-paused-capture'?'map':'symmetry',liveKey=family==='map'?'mapLive':'symmetryLive';
      const {width,height}=event.data.size,scale=event.data.scale;
      if(scale!==1&&scale!==3&&scale!==5)throw new Error('暂停 PNG 放大倍率须为 1、3 或 5');
      if(perlin&&(!source.scene.perlinSource||source.scene.kind!=='perlin'||!source.context.sourcePerlinViewport||source.context.sourceViewport?.target!=='primary'))
        throw new Error('Perlin 暂停截图需要完整配置和已完成主画布的实际尺寸与密度');
      if(samila&&(!source.context.samilaLive||source.scene.kind!=='samila'))throw new Error('Samila 暂停截图需要已完成的实时主预览');
      if(iterated&&(!source.context[liveKey]||source.scene.kind!==family||source.context.sourceViewport?.target!=='primary'))throw new Error('迭代场景暂停截图需要已完成的实时主预览');
      if(fractal&&(source.scene.kind!=='fractal'||!temporalSession.sourceFractal.matchesCompletedPrimary(source.scene,source.context)))throw Error('分形当前帧截图对应的实时主预览已过期');
      // Source scenes inherit parent density. Native render-buffer rounding can make
      // actual physical base dimensions differ from the user's requested size.
      const base=perlin||samila||iterated?prepareSourcePausedCaptureSize({width,height},iterated?source.context.sourcePointPixelDensity??NaN:samila?source.context.samilaLive!.pixelDensity:source.context.sourcePerlinViewport!.pixelDensity):{width,height};
      const upscale=scale===1?undefined:prepareSourcePausedUpscale(base.width,base.height,scale);
      if(upscale||fractal)validateRasterRequest({time:0,quality:'export',width:upscale?.width??base.width,height:upscale?.height??base.height});
      // Fractal's formula composition and whole-image enhancement/upscale run
      // after this base capture is delivered, under a separate resource owner.
      const additionalBytes=fractal?0:sourcePausedImageBytes(base.width,base.height)-base.width*base.height*4+(upscale?upscale.peakBytes-upscale.inputBytes:0);
      // The request carries only a completed-frame capability. The worker owns
      // scene history and its original primary context; no fresh replay occurs.
      completed=undefined;
      const result=fractal?temporalSession.sourceFractal.capturePaused(source.scene,{...source.context,quality:'export',width,height},{additionalBytes}):iterated
        ?temporalSession[family==='map'?'sourceMap':'sourceSymmetry'].capturePaused(source.scene,{...source.context,quality:'export',width,height},{additionalBytes})
        :samila
        ?temporalSession.sourceSamila.capturePaused(source.scene,{...source.context,quality:'export',width,height},{additionalBytes})
        :perlin
        ?temporalSession.sourcePerlin.capturePaused(source.scene,{...source.context,quality:'export',width,height,sourceViewport:{...source.context.sourceViewport!,target:'offscreen'}},{additionalBytes})
        :temporalSession.rootsNative.capturePaused(source.scene,{...source.context,quality:'export',width,height,rootsViewport:{logicalWidth:width,logicalHeight:height,referenceLogicalHeight:source.context.rootsViewport?.referenceLogicalHeight??source.context.height,target:'offscreen'}},{additionalBytes});
      captureRendered=true;
      if(result.capture.type!=='raster'||result.preview.type!=='raster')throw new Error('暂停截图没有生成图像');
      const captureWidth=result.capture.width,captureHeight=result.capture.height;
      if(captureWidth!==base.width||captureHeight!==base.height)throw new Error('暂停截图实际尺寸与已核验的后处理预算不一致');
      if(fractal)result.capture.fractalCurrentImage={model:'local-current-numerical-snapshot',stage:'base-before-formulas',baseSize:[captureWidth,captureHeight],scale};
      else{
        const enhanced=enhanceSourcePausedImage(result.capture.pixels,captureWidth,captureHeight);
        result.capture.pixels=scale===1?enhanced:upscaleSourcePausedImage(enhanced,captureWidth,captureHeight,scale);
        result.capture.width=upscale?.width??captureWidth;result.capture.height=upscale?.height??captureHeight;
        const imageFacts={enhancement:'mathart-1.7.8-scale1' as const,baseSize:[captureWidth,captureHeight] as const,scale,resampling:upscale?'openjdk21-software-bicubic' as const:'none' as const,originalRuntimeCompared:false as const};
        if(perlin||samila||iterated)result.capture.sourcePausedImage=imageFacts;else result.capture.rootsPausedImage=imageFacts;
      }
      completed={...source,id};
      send({operation:event.data.operation,id,result:{capture:result.capture,preview:result.preview}},[...new Set([...outputBuffers(result.capture),...outputBuffers(result.preview)])]);
      return;
    }
    const {scene}=event.data;
    if(event.data.operation==='fractal-recording-plan'){
      const result=planFractalFreshRecording(scene,{simulationFps:event.data.simulationFps,encoderFps:event.data.encoderFps});
      send({operation:'fractal-recording-plan',id,result});return;
    }
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
    generationSource=context.fractalLive?completed:undefined;
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
    if(isSourceRecordingOperation(operation)||leaseAtEntry){
      const retained=owner===sessionId&&retainsRecording();
      // Foreign and stale requests cannot revoke the actual lease. A runtime
      // failure does revoke it, even if the textual error looks recoverable.
      if(recording&&!retainsRecording()){recording=undefined;completed=undefined;}
      const previewRetained=!recording&&!!recordingSource&&owner===sessionId&&recordingProducer(recordingSource.scene)?.matchesCompletedPrimary(recordingSource.scene,recordingSource.context);
      if(recordingSource)completed=previewRetained?recordingSource:undefined;
      send({id,operation,error:message,...(retained?{retainedRecordingId:recording!.id}:{}),...(previewRetained?{retainedSourceId:recordingSource!.id}:{})});
    }else     if(isPausedCaptureOperation(operation)){
      // Check the session owner, not an error category: a late capacity or
      // readback failure may already have changed/retired shared density ink.
      const retained=!captureRendered&&captureSourceMatched&&!!captureSource&&(operation==='fractal-paused-capture'?temporalSession.sourceFractal.matchesCompletedPrimary(captureSource.scene,captureSource.context):operation==='symmetry-paused-capture'||operation==='map-paused-capture'
        ?temporalSession[operation==='map-paused-capture'?'sourceMap':'sourceSymmetry'].matchesCompletedPrimary(captureSource.scene,captureSource.context)
        :operation==='samila-paused-capture'
        ?temporalSession.sourceSamila.matchesCompletedPrimary(captureSource.scene,captureSource.context)
        :operation==='perlin-paused-capture'
        ?temporalSession.sourcePerlin.matchesCompletedPrimary(captureSource.scene,captureSource.context)
        :temporalSession.rootsNative.matchesCompletedPrimary(captureSource.scene,captureSource.context));
      completed=retained?captureSource:undefined;
      send({id,operation,error:message,...(retained?{retainedSourceId:captureSource!.id}:{})});
    }else if(operation==='generate'&&generationSource?.context.fractalLive){
      const retained=owner===sessionId&&temporalSession.sourceFractal.matchesCompletedPrimary(generationSource.scene,generationSource.context);
      completed=retained?generationSource:undefined;
      send({id,operation,error:message,...(retained?{retainedSourceId:generationSource.id}:{})});
    }else send({id,operation,error:message});
  }
};
