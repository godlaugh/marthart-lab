import {SourcePerlinSession} from '../scenes/sourcePerlin';
import {sourceDrawingPolicy} from './sourceDrawingPixels';
import type {GenerationWorkerRequest,PerlinNativeDrawRequest,PerlinNativeDrawResponse} from './generationProtocol';
import type {SourceNativePixels} from './sourceNativeClient';
import type {GenerateContext} from '../types';
import {usesSourceImplicitCpuMesh} from './sourceImplicitPresentation';
import {planFractalFreshRecording} from './sourceFractalRecording';
import {planPerlinFreshRecording} from './sourcePerlinRecording';
import { definition } from "../scenes";
import { generateScene, TemporalGenerationSession } from './temporal';
import { searchStableAttractor } from './stableSearch';
import { exploreComplex } from './complexExplore';
import type { GenerationRequest, GenerationPayload } from './generationProtocol';
import {isPausedCaptureOperation,isSourceRecordingOperation} from './generationProtocol';
import {outputBuffers,outputTransferState} from './outputBuffers';
import {planRootsFreshRecording} from './rootsRecording';
import type {GenerationInput,SceneDocument} from '../types';
import {enhanceSourcePausedImage,sourcePausedImageBytes} from './sourcePausedImage';
import {prepareSourcePausedUpscale,upscaleSourcePausedImage} from './sourcePausedUpscale';
import {MAX_RASTER_PIXELS,validateRasterRequest} from './rasterDimensions';
import {prepareSourcePausedCaptureSize} from './sourcePausedCaptureSize';
import {sourceDomainParameterWrites} from './sourceDomainParameterEdit';
const temporalSession = new TemporalGenerationSession();
let activeRequest:{id:number;sessionId:number}|undefined;
let drawSequence=0;
let nativeDraw:{id:number;sessionId:number;drawId:number;resolve:(result:SourceNativePixels)=>void;reject:(error:Error)=>void}|undefined;
const nativePerlin=new SourcePerlinSession({gpuRender:(frame,channel,options)=>{
 if(!activeRequest||nativeDraw)return Promise.reject(Error('Perlin 原生绘制缺少独占 Worker 请求'));
 if(drawSequence>=0xffffffff)return Promise.reject(Error('Perlin 原生绘制序号已耗尽'));
 const request:PerlinNativeDrawRequest={operation:'perlin-native-draw',...activeRequest,drawId:++drawSequence,frame,channel,retainedBytes:options.retainedBytes};
 return new Promise((resolve,reject)=>{nativeDraw={...activeRequest!,drawId:request.drawId,resolve,reject};
  try{self.postMessage(request);}catch(error){nativeDraw=undefined;reject(error);}
 });
}});
let nativePerlinActive=false;
const perlinOwner=()=>nativePerlinActive?nativePerlin:temporalSession.sourcePerlin;
function nativePerlinScene(scene:SceneDocument){return sourceDrawingPolicy()==='native'&&scene.kind==='perlin'&&scene.perlinSource!==undefined;}
function receiveNativePerlin(result:PerlinNativeDrawResponse):void {
 const pending=nativeDraw;if(!pending)return;nativeDraw=undefined;
 if(result.id!==pending.id||result.sessionId!==pending.sessionId||result.drawId!==pending.drawId){pending.reject(Error('Perlin 原生绘制响应不属于当前 Worker 请求'));return;}
 if('error' in result)pending.reject(Error(typeof result.error==='string'?result.error:'Perlin 原生绘制失败'));
 else if(result.result?.generation!==pending.sessionId||result.result.sequence!==pending.drawId)pending.reject(Error('Perlin 原生像素响应身份无效'));
 else pending.resolve(result.result);
}
async function generateNativePerlin(scene:SceneDocument,context:GenerateContext){
 if([context.rootsLive,context.implicitLive,context.surfaceLive,context.domainLive,context.fractalLive,context.samilaLive,context.mapLive,context.symmetryLive,context.fractalRecording].some(value=>value!==undefined))throw Error('一次生成只能拥有一个 Perlin 实时或录制时钟');
 if(!nativePerlinActive){temporalSession.reset();nativePerlinActive=true;}
 return nativePerlin.generateAsync(scene,context);
}

let owner: number | undefined;
let completed:{id:number;scene:SceneDocument;context:GenerationInput}|undefined;
function recordingProducer(scene:SceneDocument){return scene.kind==='implicit'&&usesSourceImplicitCpuMesh(scene)?temporalSession.sourceImplicit:scene.kind==='roots'?temporalSession.rootsNative:scene.kind==='surface'?temporalSession.sourceSurface:scene.kind==='domain'?temporalSession.sourceDomain:scene.kind==='fractal'?temporalSession.sourceFractal:scene.kind==='perlin'?perlinOwner():scene.kind==='map'?temporalSession.sourceMap:scene.kind==='symmetry'?temporalSession.sourceSymmetry:undefined;}
type RecordingProducer=NonNullable<ReturnType<typeof recordingProducer>>;
type RuntimeStart=ReturnType<RecordingProducer['beginRecording']>;
type RecordingOutput=RuntimeStart['warmup'];
type PublishedOutput={output:RecordingOutput;storage:ReturnType<typeof outputTransferState>};
const publication=(output:RecordingOutput):PublishedOutput=>({output,storage:outputTransferState(output)});
let recording:{id:number;producer:RecordingProducer;runtime:RuntimeStart;finish?:ReturnType<RecordingProducer['finishRecording']>;preview?:PublishedOutput;pendingFrame?:PublishedOutput&{index:number;actualFrameRate?:number}}|undefined;
function retainsRecording(){
 if(!recording)return false;
 return recording.finish?recording.producer.matchesCompletedPrimary(recording.finish.scene,recording.finish.context):recording.producer.ownsRecording(recording.runtime.handle);
}

self.onmessage = async (
  event: MessageEvent<GenerationWorkerRequest>,
) => {
  if(event.data.operation==='perlin-native-result'){receiveNativePerlin(event.data);return;}
  const { id, operation, sessionId } = event.data;
  const send = (payload: GenerationPayload, transfer: Transferable[] = []) => self.postMessage({ ...payload, sessionId }, { transfer });
  if(activeRequest){send({id,operation,error:'Worker 当前生成请求尚未结束'});return;}
  const active=activeRequest={id,sessionId};
  const start = performance.now();
  let captureSource:typeof completed;
  let recordingSource:typeof completed;
  let generationSource:typeof completed;
  let surfaceSource:typeof completed;
  let implicitCaptureSource:typeof completed;
  const leaseAtEntry=recording;
  let captureRendered=false;
  let captureSourceMatched=false;
  try {
    // A failed release keeps the old owner and must still answer this request.
    if(recording&&(owner!==sessionId||!isSourceRecordingOperation(operation)))throw new Error('源场景录制期间不能执行其它后台任务');
    if (owner !== sessionId) { if(nativePerlinActive){await nativePerlin.resetAsync();nativePerlinActive=false;}temporalSession.reset(); owner = sessionId; completed=undefined; }
    if(event.data.operation==='implicit-paused-capture'){
      const source=implicitCaptureSource=completed;
      if(!source||source.id!==event.data.sourceId||source.scene.kind!=='implicit'||!temporalSession.sourceImplicit.matchesCompletedPrimary(source.scene,source.context))throw Error('隐式截图对应的实时主预览已过期');
      const result=temporalSession.sourceImplicit.capturePaused(source.scene,source.context,event.data.size,event.data.scale);
      send({operation:event.data.operation,id,sourceId:source.id,result},[...new Set([...outputBuffers(result.capture),...outputBuffers(result.preview)])]);return;
    }
    if(event.data.operation==='surface-navigation'||event.data.operation==='surface-paused-capture'||event.data.operation==='surface-parameter'||event.data.operation==='surface-playback'||event.data.operation==='surface-current'){
      const source=surfaceSource=completed,live=source?.context.surfaceLive;
      if(!source||source.id!==event.data.sourceId||source.scene.kind!=='surface'||!live||!temporalSession.sourceSurface.matchesCompletedPrimary(source.scene,source.context))throw Error('曲面操作对应的实时主预览已过期');
      if(event.data.operation==='surface-navigation'){
        const output=temporalSession.sourceSurface.navigatePaused(source.scene,source.context,event.data.event);completed={...source,id};
        send({operation:'surface-navigation',id,sourceId:source.id,output},outputBuffers(output));
      }else if(event.data.operation==='surface-paused-capture'){
        const result=temporalSession.sourceSurface.capturePaused(source.scene,source.context,event.data.size,event.data.scale);
        send({operation:'surface-paused-capture',id,sourceId:source.id,result},[...new Set([...outputBuffers(result.capture),...outputBuffers(result.preview)])]);
      }else if(event.data.operation==='surface-parameter'){
        temporalSession.sourceSurface.updateParameter(source.scene,source.context,event.data.name,event.data.value);
        send({operation:'surface-parameter',id,sourceId:source.id});
      }else if(event.data.operation==='surface-playback'){
        const frame=temporalSession.sourceSurface.setPaused(event.data.paused,event.data.timestampMs);
        completed={...source,context:{...source.context,surfaceLive:{...live,clock:{...live.clock,paused:event.data.paused}}}};
        send({operation:'surface-playback',id,sourceId:source.id,paused:event.data.paused,frame});
      }else{
        const output=temporalSession.sourceSurface.current(source.scene,source.context);completed={...source,id};
        send({operation:'surface-current',id,sourceId:source.id,output},outputBuffers(output));
      }
      return;
    }
    if(event.data.operation==='domain-navigation'){
      const source=completed;
      if(!source||source.id!==event.data.sourceId||source.scene.kind!=='domain')throw Error('域着色视口对应的主预览已过期');
      const output=temporalSession.sourceDomain.navigatePaused(source.scene,source.context,event.data.event);
      completed={...source,id};send({operation:'domain-navigation',id,sourceId:source.id,output},[output.pixels.buffer]);return;
    }
    if(event.data.operation==='domain-parameters'){
      const source=completed;
      if(!source||source.id!==event.data.sourceId||!temporalSession.sourceDomain.matchesCompletedPrimary(source.scene,source.context))throw Error('域着色参数对应的主预览已过期');
      const writes=sourceDomainParameterWrites(source.scene,event.data.scene,event.data.writes);
      if(!writes)throw Error('域着色参数更新需要明确的有限数值事件');
      temporalSession.sourceDomain.updateParameters(source.scene,source.context,writes);
      completed={...source,scene:event.data.scene};send({operation:'domain-parameters',id,sourceId:source.id});return;
    }
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
    if(event.data.operation==='roots-playback'){
      const source=completed,live=source?.context.rootsLive;
      if(!source||source.id!==event.data.sourceId||source.scene.kind!=='roots'||!live||typeof event.data.paused!=='boolean'||!temporalSession.rootsNative.matchesCompletedPrimary(source.scene,source.context))throw Error('复根 播放控制对应的实时主预览已过期');
      temporalSession.rootsNative.setPaused(event.data.paused,event.data.timestampMs);
      completed={...source,context:{...source.context,rootsLive:{...live,clock:{...live.clock,paused:event.data.paused}}}};
      send({operation:'roots-playback',id,sourceId:source.id,paused:event.data.paused});return;
    }
    if(event.data.operation==='implicit-playback'){
      const source=completed;
      if(!source||source.id!==event.data.sourceId||!source.context.implicitLive)throw Error('隐式播放控制对应的主预览已过期');
      const context=temporalSession.sourceImplicit.setPaused(source.scene,source.context,event.data.paused,event.data.timestampMs);
      completed={...source,context};send({operation:'implicit-playback',id,sourceId:source.id,paused:event.data.paused});return;
    }
    if(event.data.operation==='perlin-playback'){
      const source=completed,live=source?.context.perlinLive;
      if(!source||source.id!==event.data.sourceId||source.scene.kind!=='perlin'||!live||typeof event.data.paused!=='boolean'||!perlinOwner().matchesCompletedPrimary(source.scene,source.context))throw Error('Perlin 播放控制对应的实时主预览已过期');
      perlinOwner().setPaused(event.data.paused,event.data.timestampMs);
      completed={...source,context:{...source.context,perlinLive:{...live,clock:{...live.clock,paused:event.data.paused}}}};
      send({operation:'perlin-playback',id,sourceId:source.id,paused:event.data.paused});return;
    }
    if(event.data.operation==='domain-playback'){
      const source=completed,live=source?.context.domainLive;
      if(!source||source.id!==event.data.sourceId||source.scene.kind!=='domain'||!live||typeof event.data.paused!=='boolean'||!temporalSession.sourceDomain.matchesCompletedPrimary(source.scene,source.context))throw Error('域着色播放控制对应的实时主预览已过期');
      temporalSession.sourceDomain.setPaused(event.data.paused,event.data.timestampMs);
      completed={...source,context:{...source.context,domainLive:{...live,clock:{...live.clock,paused:event.data.paused}}}};
      send({operation:'domain-playback',id,sourceId:source.id,paused:event.data.paused});return;
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
      const runtime=producer===nativePerlin?await nativePerlin.beginRecordingAsync(source.scene,source.context,event.data.options):producer.beginRecording(source.scene,source.context,event.data.options);
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
        if(pending&&(lease.producer===temporalSession.sourceDomain||lease.producer===temporalSession.sourceSurface||lease.producer===temporalSession.sourceImplicit)&&!Object.is(pending.actualFrameRate,event.data.actualFrameRate))throw new Error('源场景未交付帧重试不能改变实际帧率');
        if(pending&&!pending.storage.intact())throw new Error('源场景录制帧传输状态未知，请结束录制');
        const output=pending?.output??(lease.producer===nativePerlin?await nativePerlin.nextRecordingFrameAsync(lease.runtime.handle,displayFrame):lease.producer===temporalSession.sourceDomain||lease.producer===temporalSession.sourceSurface||lease.producer===temporalSession.sourceImplicit?lease.producer.nextRecordingFrame(lease.runtime.handle,displayFrame,event.data.actualFrameRate):lease.producer.nextRecordingFrame(lease.runtime.handle,displayFrame));
        if(output.type==='raster'&&output.pixels.byteLength!==output.width*output.height*4)throw new Error('源场景录制帧传输状态未知，请结束录制');
        lease.pendingFrame=pending??{...publication(output),index:displayFrame,actualFrameRate:event.data.actualFrameRate};
        send({operation:event.data.operation,id,recordingId:lease.id,displayFrame,output},outputBuffers(output));lease.pendingFrame=undefined;return;
      }
      // finishRecording mutates runtime ownership exactly once. If publication
      // fails, retain its result and completed preview for an explicit retry.
      if(event.data.timestampMs!==undefined&&lease.producer!==temporalSession.sourceImplicit)throw Error('注入停止时钟仅支持隐式录制');
      lease.finish??=lease.producer===nativePerlin?await nativePerlin.finishRecordingAsync(lease.runtime.handle):lease.producer===temporalSession.sourceImplicit?lease.producer.finishRecording(lease.runtime.handle,event.data.timestampMs):lease.producer.finishRecording(lease.runtime.handle);
      if(lease.preview&&!lease.preview.storage.intact()&&'preview' in lease.finish){
        // The retained numerical handoff republishes detached buffers without
        // another update or host-clock reset, for raster and geometry owners.
        lease.finish=lease.producer===nativePerlin?await nativePerlin.finishRecordingAsync(lease.runtime.handle):lease.producer.finishRecording(lease.runtime.handle);
      }
      const {scene,context}=lease.finish;
      if(!lease.preview||!lease.preview.storage.intact()){
        const output='preview' in lease.finish?lease.finish.preview:lease.producer===nativePerlin?await generateNativePerlin(scene,context):generateScene(scene,context,temporalSession);
        if(output.type!=='raster'&&!(output.type==='geometry'&&(output.surfaceLive||lease.producer===temporalSession.sourceImplicit)))throw new Error('源场景录制结束没有生成主预览');
        lease.preview=publication(output);
      }
      const preview=lease.preview.output;
      const resumed=lease.producer===temporalSession.sourceImplicit?context:{...context,time:preview.type==='geometry'?preview.surfaceLive!.frame.sceneTime:preview.rootsLive?.sceneTime??preview.perlinLive?.sceneTime??preview.domainLive?.sceneTime??preview.fractalLive?.sceneTime??preview.mapLive?.sceneTime??preview.symmetryLive?.sceneTime??context.time};
      send({operation:event.data.operation,id,recordingId:lease.id,result:{scene,context:resumed,preview}},outputBuffers(preview));
      completed={id,scene,context:resumed};recording=undefined;return;
    }
    if(event.data.operation==='roots-paused-capture'||event.data.operation==='perlin-paused-capture'||event.data.operation==='samila-paused-capture'||event.data.operation==='symmetry-paused-capture'||event.data.operation==='map-paused-capture'||event.data.operation==='fractal-paused-capture'||event.data.operation==='domain-paused-capture'){
      const source=captureSource=completed;
      if(!source||source.id!==event.data.sourceId)throw new Error('暂停截图对应的预览已过期');
      captureSourceMatched=true;
      const domain=event.data.operation==='domain-paused-capture',fractal=event.data.operation==='fractal-paused-capture',perlin=event.data.operation==='perlin-paused-capture',samila=event.data.operation==='samila-paused-capture',iterated=event.data.operation==='symmetry-paused-capture'||event.data.operation==='map-paused-capture',family=event.data.operation==='map-paused-capture'?'map':'symmetry',liveKey=family==='map'?'mapLive':'symmetryLive';
      const {width,height}=event.data.size,scale=event.data.scale;
      if(scale!==1&&scale!==3&&scale!==5)throw new Error('暂停 PNG 放大倍率须为 1、3 或 5');
      if(perlin&&(!source.scene.perlinSource||source.scene.kind!=='perlin'||!source.context.sourcePerlinViewport||source.context.sourceViewport?.target!=='primary'))
        throw new Error('Perlin 暂停截图需要完整配置和已完成主画布的实际尺寸与密度');
      if(samila&&(!source.context.samilaLive||source.scene.kind!=='samila'))throw new Error('Samila 暂停截图需要已完成的实时主预览');
      if(iterated&&(!source.context[liveKey]||source.scene.kind!==family||source.context.sourceViewport?.target!=='primary'))throw new Error('迭代场景暂停截图需要已完成的实时主预览');
      if(fractal&&(source.scene.kind!=='fractal'||!temporalSession.sourceFractal.matchesCompletedPrimary(source.scene,source.context)))throw Error('分形当前帧截图对应的实时主预览已过期');
      if(domain&&(source.scene.kind!=='domain'||!temporalSession.sourceDomain.matchesCompletedPrimary(source.scene,source.context)))throw Error('域着色当前帧截图对应的实时主预览已过期');
      // Source scenes inherit parent density. Native render-buffer rounding can make
      // actual physical base dimensions differ from the user's requested size.
      const rootsFormulas=event.data.operation==='roots-paused-capture'&&temporalSession.rootsNative.completedHasFormulas();
      const currentBase=rootsFormulas?{width,height,logicalWidth:width,logicalHeight:height,density:1}:fractal||domain?prepareSourcePausedCaptureSize({width,height},domain?source.context.domainLive?.viewport?.pixelDensity??NaN:source.context.fractalPixelDensity??NaN,MAX_RASTER_PIXELS):undefined;
      const base=currentBase??(perlin||samila||iterated?prepareSourcePausedCaptureSize({width,height},iterated?source.context.sourcePointPixelDensity??NaN:samila?source.context.samilaLive!.pixelDensity:source.context.sourcePerlinViewport!.pixelDensity):{width,height});
      const upscale=scale===1?undefined:prepareSourcePausedUpscale(base.width,base.height,scale);
      if(upscale||currentBase)validateRasterRequest({time:0,quality:'export',width:upscale?.width??base.width,height:upscale?.height??base.height});
      // Current numerical-raster formula composition and whole-image enhancement/upscale run
      // after this base capture is delivered, under a separate resource owner.
      const additionalBytes=currentBase?0:sourcePausedImageBytes(base.width,base.height)-base.width*base.height*4+(upscale?upscale.peakBytes-upscale.inputBytes:0);
      // The request carries only a completed-frame capability. The worker owns
      // scene history and its original primary context; no fresh replay occurs.
      completed=undefined;
      const result=domain?temporalSession.sourceDomain.capturePaused(source.scene,{...source.context,quality:'export',width,height},{additionalBytes}):fractal?temporalSession.sourceFractal.capturePaused(source.scene,{...source.context,quality:'export',width,height},{additionalBytes}):iterated
        ?temporalSession[family==='map'?'sourceMap':'sourceSymmetry'].capturePaused(source.scene,{...source.context,quality:'export',width,height},{additionalBytes})
        :samila
        ?temporalSession.sourceSamila.capturePaused(source.scene,{...source.context,quality:'export',width,height},{additionalBytes})
        :perlin
        ?nativePerlinActive?await nativePerlin.capturePausedAsync(source.scene,{...source.context,quality:'export',width,height,sourceViewport:{...source.context.sourceViewport!,target:'offscreen'}},{additionalBytes}):temporalSession.sourcePerlin.capturePaused(source.scene,{...source.context,quality:'export',width,height,sourceViewport:{...source.context.sourceViewport!,target:'offscreen'}},{additionalBytes})
        :temporalSession.rootsNative.capturePaused(source.scene,{...source.context,quality:'export',width,height,rootsViewport:{logicalWidth:width,logicalHeight:height,referenceLogicalHeight:source.context.rootsViewport?.referenceLogicalHeight??source.context.height,target:'offscreen'}},{additionalBytes});
      captureRendered=true;
      if(result.capture.type!=='raster'||result.preview.type!=='raster')throw new Error('暂停截图没有生成图像');
      const captureWidth=result.capture.width,captureHeight=result.capture.height;
      if(captureWidth!==base.width||captureHeight!==base.height)throw new Error('暂停截图实际尺寸与已核验的后处理预算不一致');
      if(currentBase)result.capture.sourceCurrentImage={model:'local-current-numerical-snapshot',stage:'base-before-formulas',requestedSize:[width,height],logicalSize:[currentBase.logicalWidth,currentBase.logicalHeight],pixelDensity:currentBase.density,baseSize:[captureWidth,captureHeight],scale};
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
    generationSource=context.fractalLive||context.surfaceLive||context.rootsLive?.controls||context.implicitControls?completed:undefined;
    completed=undefined;
    const executionContext = { ...context, onStatus: event.data.wantsStatus ? status => send({operation:'generate-status',id,status}) : undefined, onProgress: output => {
      output.dimension ??= definition(scene.kind).dimension;
      send({ operation: 'generate-progress', id, output }, outputBuffers(output));
    } } satisfies GenerateContext;
    const native=nativePerlinScene(scene);
    if(!native&&nativePerlinActive){await nativePerlin.resetAsync();nativePerlinActive=false;}
    const output = native?await generateNativePerlin(scene,executionContext):generateScene(scene, executionContext, temporalSession);
    output.dimension ??= definition(scene.kind).dimension;
    output.stats.elapsedMs = performance.now() - start;
    if(usesSourceImplicitCpuMesh(scene)){if(output.type!=='geometry')throw Error('隐式主预览缺少几何');if(context.sourceViewport?.target==='primary'&&!context.implicitLive&&!context.implicitControls)temporalSession.sourceImplicit.admitPrimary(scene,context,output);}
    completed={id,scene,context:context.implicitLive||context.implicitControls?executionContext:context};
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
      const retained=!captureRendered&&captureSourceMatched&&!!captureSource&&(operation==='domain-paused-capture'?temporalSession.sourceDomain.matchesCompletedPrimary(captureSource.scene,captureSource.context):operation==='fractal-paused-capture'?temporalSession.sourceFractal.matchesCompletedPrimary(captureSource.scene,captureSource.context):operation==='symmetry-paused-capture'||operation==='map-paused-capture'
        ?temporalSession[operation==='map-paused-capture'?'sourceMap':'sourceSymmetry'].matchesCompletedPrimary(captureSource.scene,captureSource.context)
        :operation==='samila-paused-capture'
        ?temporalSession.sourceSamila.matchesCompletedPrimary(captureSource.scene,captureSource.context)
        :operation==='perlin-paused-capture'
        ?perlinOwner().matchesCompletedPrimary(captureSource.scene,captureSource.context)
        :temporalSession.rootsNative.matchesCompletedPrimary(captureSource.scene,captureSource.context));
      completed=retained?captureSource:undefined;
      send({id,operation,error:message,...(retained?{retainedSourceId:captureSource!.id}:{})});
    }else if(implicitCaptureSource){
      const source=implicitCaptureSource,retained=owner===sessionId&&temporalSession.sourceImplicit.matchesCompletedPrimary(source.scene,source.context);
      completed=retained?source:undefined;send({id,operation,error:message,...(retained?{retainedSourceId:source.id}:{})});
    }else if(surfaceSource||operation==='generate'&&generationSource?.context.surfaceLive){
      const source=surfaceSource??generationSource!;
      const retained=owner===sessionId&&temporalSession.sourceSurface.matchesCompletedPrimary(source.scene,source.context);
      completed=retained?source:undefined;
      send({id,operation,error:message,...(retained?{retainedSourceId:source.id}:{})});
    }else if(operation==='generate'&&generationSource?.context.implicitControls){
      const retained=owner===sessionId&&temporalSession.sourceImplicit.matchesCompletedPrimary(generationSource.scene,generationSource.context);
      completed=retained?generationSource:undefined;
      send({id,operation,error:message,...(retained?{retainedSourceId:generationSource.id}:{})});
    }else if(operation==='generate'&&generationSource?.context.rootsLive?.controls){
      const retained=owner===sessionId&&temporalSession.rootsNative.matchesCompletedPrimary(generationSource.scene,generationSource.context);
      completed=retained?generationSource:undefined;
      send({id,operation,error:message,...(retained?{retainedSourceId:generationSource.id}:{})});
    }else if(operation==='generate'&&generationSource?.context.fractalLive){
      const retained=owner===sessionId&&temporalSession.sourceFractal.matchesCompletedPrimary(generationSource.scene,generationSource.context);
      completed=retained?generationSource:undefined;
      send({id,operation,error:message,...(retained?{retainedSourceId:generationSource.id}:{})});
    }else send({id,operation,error:message});
  }finally{if(activeRequest===active)activeRequest=undefined;}
};
