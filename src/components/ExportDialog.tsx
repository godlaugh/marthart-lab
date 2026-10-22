import {assertSourceSurfaceRecordingFrame} from '../engine/sourceSurfaceRecording';
import {assertDomainRecordingFrame} from '../engine/sourceDomainRecording';
import {usesSourceFractal} from '../engine/sourceFractalDocument';
import {withFractalFreshRecording,fractalRecordingFrameInput,assertFractalRecordingFrame} from '../engine/sourceFractalRecording';
import {sourceRecordingSize} from '../engine/sourceRecordingSize';
import {assertSourceIteratedRecordingFrame} from '../engine/sourceIteratedRecording';
import {usesSourceMapPresentation} from '../engine/sourceMapPresentation';
import type {SourceIteratedToneReference} from '../engine/sourceIteratedPresentation';
import {sourceLivePreviewKind} from '../engine/sourceLivePreview';
import {usesSourceSymmetryPresentation} from '../engine/sourceSymmetryPresentation';
import {usesSourceSamilaSampling} from '../engine/sourceSamilaSampling';
import {usesSourceSamilaSplat} from '../engine/sourceSamilaSplat';
import {withPerlinFreshRecording,assertPerlinRecordingFrame} from '../engine/sourcePerlinRecording';
import {prepareSourcePausedCaptureSize} from '../engine/sourcePausedCaptureSize';
import {usesSourcePerlin} from '../engine/sourcePerlinIdentity';
import {sourceQueuePresentedScene} from '../engine/sourceQueuePresentation';
import {usesSourceBouncing} from '../engine/sourceBouncingDocument';
import {prepareSourceBouncingExport,sourceBouncingExportContext,assertSourceBouncingExportFrame,type SourceBouncingPresentedExport} from '../engine/sourceBouncingExport';
import {usesSourceImplicitCpuMesh} from '../engine/sourceImplicitPresentation';
import {usesSourceSurfaceParticles} from '../engine/sourceSurfaceIdentity';
import {ordinarySourceViewport} from '../engine/ordinarySourceCamera';
import { useEffect, useRef, useState } from "react";
import { Download, Image, Film, X } from "lucide-react";
import type { SceneDocument,SceneOutput,GenerationStatus,RasterOutput } from "../types";
import type {RootsPausedCaptureSize,SourceRecordingOptions} from '../engine/generationProtocol';
import type {SourceRecordingConsumer} from '../engine/generationQueue';
import {prepareSourcePausedUpscale} from '../engine/sourcePausedUpscale';
import {MAX_RASTER_PIXELS,validateRasterRequest} from '../engine/rasterDimensions';
import {encodeRgbaPng} from '../engine/rgbaPng';
import {encodeSourcePausedPng} from '../engine/sourcePausedPng';
import {encodeFormulaRaster} from '../engine/formulaCanvas';
import { Generator } from "../engine/client";
import { ArtRenderer,artExportPurpose } from "../engine/renderer";
import { sceneAtTime, normalizeTimelineTime,resolveTimeline } from "../engine/timeline";
import {outputCamera} from '../engine/sceneCamera';
import {useI18n} from '../i18n';
import {DomainRenderSummary} from './DomainColorControls';
import {usesSpirographFrameClock,spirographSimulationFps,sourceFrameIndex} from '../engine/spirographFrameConfig';
import {withSpirographReplayFrame} from '../engine/spirographFramePlan';
import {usesRootsNativePresentation} from '../engine/rootsPresentationAuthoring';
import {usesRootsCameraTimeline,usesRootsGradientTimeline} from '../engine/rootsCameraTimeline';
import {withRootsFreshRecording} from '../engine/rootsRecording';
import {exportSessionCleanup,ExportSessionCleanupError,type ExportSessionTicket} from '../engine/exportSessionCleanup';
import {RecordingVideoDelivery} from '../engine/recordingVideoDelivery';
export function ExportDialog({
  scene,
  time,
  mode='export',
  currentSpirographFrame,
  previewLogicalHeight,
  sourcePerlinViewport,
  fractalPixelDensity,
  previewPointPixelDensity,
  samilaPrimaryPixelHeight,
  sourceMapToneReference,sourceSymmetryToneReference,
  currentFractalCapture,currentDomainCapture,domainPixelDensity,
  currentSurfaceCapture,surfacePixelDensity,
  currentRootsCapture,
  currentSamilaCapture,
  currentIteratedCapture,
  iteratedPixelDensity,
  samilaPixelDensity,
  currentPerlinCapture,
  currentSourceRecording,
  currentSourceBouncingFrame,
  onClose,
  onDone,
}: {
  mode?:'export'|'fractal-recording'|'domain-recording'|'surface-recording'|'perlin-recording';
  surfacePixelDensity?:number;
  currentSurfaceCapture?:{ready:boolean;size:RootsPausedCaptureSize;capture:(size:RootsPausedCaptureSize,scale:1|3|5)=>Promise<SceneOutput>};
  domainPixelDensity?:number;
  currentDomainCapture?:{ready:boolean;size:RootsPausedCaptureSize;capture:(size:RootsPausedCaptureSize,scale:1|3|5)=>Promise<SceneOutput>};
  scene: SceneDocument;
  time: number;
  currentSpirographFrame?:number;
  previewLogicalHeight?:number;
  fractalPixelDensity?:number;
  sourcePerlinViewport?:{width:number;height:number;pixelDensity:number};
  previewPointPixelDensity?:number;
  samilaPrimaryPixelHeight?:number;
  sourceMapToneReference?:SourceIteratedToneReference;
  sourceSymmetryToneReference?:SourceIteratedToneReference;
  samilaPixelDensity?:number;
  iteratedPixelDensity?:number;
  currentIteratedCapture?:{ready:boolean;size:RootsPausedCaptureSize;capture:(size:RootsPausedCaptureSize,scale:1|3|5)=>Promise<SceneOutput>};
  currentSamilaCapture?:{ready:boolean;size:RootsPausedCaptureSize;capture:(size:RootsPausedCaptureSize,scale:1|3|5)=>Promise<SceneOutput>};
  currentFractalCapture?:{ready:boolean;size:RootsPausedCaptureSize;capture:(size:RootsPausedCaptureSize,scale:1|3|5)=>Promise<SceneOutput>};
  currentRootsCapture?:{ready:boolean;size:RootsPausedCaptureSize;capture:(size:RootsPausedCaptureSize,scale:1|3|5)=>Promise<SceneOutput>};
  currentPerlinCapture?:{ready:boolean;size:RootsPausedCaptureSize;capture:(size:RootsPausedCaptureSize,scale:1|3|5)=>Promise<SceneOutput>};
  currentSourceRecording?:{ready:boolean;record:(options:SourceRecordingOptions,consumer:SourceRecordingConsumer,signal?:AbortSignal)=>Promise<void>};
  currentSourceBouncingFrame?:SourceBouncingPresentedExport;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const {t}=useI18n();
  const sourceFractal=usesSourceFractal(scene),sourceBouncing=usesSourceBouncing(scene),sourcePerlin=!!scene.perlinSource,sourceSamila=usesSourceSamilaSampling(scene),sourceIterated=sourceLivePreviewKind(scene)==='symmetry'||sourceLivePreviewKind(scene)==='map';
  const sourceSurfaceLive=!!currentSurfaceCapture,sourceFractalLive=!!currentFractalCapture,sourceDomainLive=!!currentDomainCapture,sourceNumericalLive=sourceFractalLive||sourceDomainLive;
  const recordingMode=mode!=='export';
  const recordingTitle=sourceSurfaceLive?'曲面录制':sourceDomainLive?'域着色录制':sourcePerlin?'Perlin 录制':'分形录制';
  const currentPausedCapture=sourceSurfaceLive?currentSurfaceCapture:sourceDomainLive?currentDomainCapture:sourceFractalLive?currentFractalCapture:sourcePerlin?currentPerlinCapture:sourceSamila?currentSamilaCapture:sourceIterated?currentIteratedCapture:currentRootsCapture;
  const [bouncingStart,setBouncingStart]=useState<'current'|'seed'>('seed');
  const sourceFrames=usesSpirographFrameClock(scene);
  const [sourceImageMode,setSourceImageMode]=useState<'current'|'replay'>(()=>sourceSurfaceLive||sourceNumericalLive||usesRootsNativePresentation(scene)||sourcePerlin||sourceSamila||sourceIterated?'current':'replay');
  const [pausedImageScale,setPausedImageScale]=useState<1|3|5>(1);
  const [rootsVideoMode,setRootsVideoMode]=useState<'duration'|'source'>(()=>usesRootsGradientTimeline(scene)?'source':'duration');
  const [surfaceVideoMode,setSurfaceVideoMode]=useState<'duration'|'retained'>('retained');
  const [domainVideoMode,setDomainVideoMode]=useState<'duration'|'retained'>('retained');
  const [fractalVideoMode,setFractalVideoMode]=useState<'duration'|'source'|'retained'>(mode==='fractal-recording'?'retained':'source');
  const fractalFrames=sourceFractal&&fractalVideoMode==='source';
  const [perlinVideoMode,setPerlinVideoMode]=useState<'duration'|'source'|'retained'>(mode==='perlin-recording'?'retained':'duration');
  const [recordingQuality,setRecordingQuality]=useState<'low'|'medium'|'high'|'production'>('high');
  const [iteratedVideoMode,setIteratedVideoMode]=useState<'duration'|'source'>('source');
  const perlinFrames=sourcePerlin&&perlinVideoMode==='source';
  const rootsFrames=usesRootsCameraTimeline(scene)&&rootsVideoMode==='source';
  const [recordingStart,setRecordingStart]=useState<'fresh'|'current'>('fresh');
  const [recordingFps,setRecordingFps]=useState(()=>sourceFrames?spirographSimulationFps(scene):scene.timeline.fps);
  const [sourceVideoFrames,setSourceVideoFrames]=useState<number|null>(null);
  const [kind, setKind] = useState<"image" | "video">(recordingMode?'video':"image"),
    [format, setFormat] = useState(recordingMode?'mp4':"png"),
    [resolution, setResolution] = useState(recordingMode||scene.projectResolution||currentPausedCapture?'custom':"1920x1080"),
    [customWidth,setCustomWidth]=useState(recordingMode?500:scene.projectResolution?.width??currentPausedCapture?.size.width??1920),
    [customHeight,setCustomHeight]=useState(recordingMode?600:scene.projectResolution?.height??currentPausedCapture?.size.height??1080),
    [fps, setFps] = useState(()=>recordingMode?60:sourceFrames?spirographSimulationFps(scene):scene.timeline.fps),
    [duration, setDuration] = useState(()=>sourceFrames||sourceBouncing?scene.timeline.duration:resolveTimeline(scene).duration),
    [working, setWorking] = useState(false),
    [progress, setProgress] = useState(0),
    [generationStatus,setGenerationStatus] = useState<GenerationStatus|null>(null),
    [error, setError] = useState(""),
    [ffmpeg, setFfmpeg] = useState<boolean | null>(null),
    [service, setService] = useState(false),
    [result, setResult] = useState<{url:string;format:string;name:string}|null>(null);
  const [domainFrames,setDomainFrames]=useState<{first:number;last:number;facts:NonNullable<RasterOutput['domainRender']>;key:string}[]>([]);
  const [domainRoutesTruncated,setDomainRoutesTruncated]=useState(false);
  const [saveStage,setSaveStage]=useState<'recording'|'stopping'|'saving'>('recording');
  const [recoveringSave,setRecoveringSave]=useState(false);
  const saveStop=useRef(false),retrySave=useRef<(()=>void)|null>(null);
  const domainRouteKeys=useRef(new Set<string>());
  const cancelRef = useRef(false),
    sessionRef = useRef<ExportSessionTicket | null>(null),
    generator = useRef<Generator | null>(null),
    recordingAbort = useRef<AbortController | null>(null);
  const [width,height]=resolution==='custom'?[customWidth,customHeight]:resolution.split('x').map(Number);
  const retainedPerlin=kind==='video'&&sourcePerlin&&perlinVideoMode==='retained';
  const iteratedRecording=kind==='video'&&sourceIterated&&iteratedVideoMode==='source';
  const retainedSurface=kind==='video'&&sourceSurfaceLive&&surfaceVideoMode==='retained';
  const retainedDomain=kind==='video'&&sourceDomainLive&&domainVideoMode==='retained';
  const retainedNumerical=retainedSurface||retainedDomain||kind==='video'&&sourceFractal&&fractalVideoMode==='retained';
  const fixedRetained=iteratedRecording||retainedNumerical;
  const liveRecording=retainedPerlin||fixedRetained;
  const stoppableRecording=retainedNumerical||retainedPerlin;
  const sharedRecordingFps=fixedRetained||mode==='perlin-recording';
  const fractalVideo=kind==='video'&&fractalFrames;
  const sourceQueueVideo=perlinFrames||fractalVideo||liveRecording;
  const pausedSourceImage=kind==='image'&&(sourceSurfaceLive||sourceNumericalLive||usesRootsNativePresentation(scene)||sourcePerlin||sourceSamila||sourceIterated)&&sourceImageMode==='current';
  let outputBase={width,height},pausedSizeError='';
  if((sourceSurfaceLive||sourceNumericalLive)&&pausedSourceImage){try{outputBase=prepareSourcePausedCaptureSize({width,height},(sourceSurfaceLive?surfacePixelDensity:sourceDomainLive?domainPixelDensity:fractalPixelDensity)??NaN,sourceSurfaceLive?undefined:MAX_RASTER_PIXELS);}catch(error){pausedSizeError=error instanceof Error?error.message:String(error);}}
  else if((sourcePerlin||sourceSamila||sourceIterated)&&(pausedSourceImage||retainedPerlin)){try{outputBase=prepareSourcePausedCaptureSize({width,height},(sourceIterated?iteratedPixelDensity:sourceSamila?samilaPixelDensity:sourcePerlinViewport?.pixelDensity)??NaN);}catch(error){pausedSizeError=error instanceof Error?error.message:String(error);}}
  let recordingSize:{width:number;height:number;logicalWidth?:number;logicalHeight?:number}={width:outputBase.width,height:outputBase.height};
  if(fixedRetained||fractalVideo){try{recordingSize=sourceRecordingSize({width,height},(retainedSurface?surfacePixelDensity:retainedDomain?domainPixelDensity:(fractalVideo||retainedNumerical)?fractalPixelDensity:iteratedPixelDensity)??NaN);}catch(error){pausedSizeError=error instanceof Error?error.message:String(error);}}
  let upscaleError=pausedSizeError;
  if(pausedSourceImage&&pausedImageScale!==1){try{const size=prepareSourcePausedUpscale(outputBase.width,outputBase.height,pausedImageScale);validateRasterRequest({time:0,quality:'export',width:size.width,height:size.height});}catch(error){upscaleError=error instanceof Error?error.message:String(error);}}
  let dimensionError='';
  const videoWidth=retainedPerlin?outputBase.width:fixedRetained||fractalVideo?width-width%2:width,videoHeight=retainedPerlin?outputBase.height:fixedRetained||fractalVideo?height-height%2:height;
  if(kind==='video')dimensionError=![videoWidth,videoHeight].every(Number.isSafeInteger)||videoWidth<16||videoHeight<16||videoWidth>7680||videoHeight>4320?t("宽度需为 16–7680、高度需为 16–4320 的整数。"):(videoWidth%2!==0||videoHeight%2!==0)?t("视频的宽度和高度都必须是偶数。"):'';
  else try{
    // Still images use the raster owner's representation budget. A valid
    // 8192-wide project must not inherit the encoder's narrower video limits.
    validateRasterRequest({time:0,quality:'export',width,height});
    if(width<16||height<16)dimensionError=t('图片宽度和高度至少为 16 像素。');
  }catch(error){dimensionError=t(error instanceof Error?error.message:String(error));}
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => {setFfmpeg(h.ffmpeg);setService(true);})
      .catch(() => setFfmpeg(false));
    return () => {
      cancelRef.current = true;
      recordingAbort.current?.abort();
      try { generator.current?.dispose(); }
      finally {
        // The module owner retains failed cleanup after this dialog unmounts.
        // A later export retries it before creating another server session.
        void sessionRef.current?.cleanup().catch(() => {});
      }
    };
  }, []);
  async function request(url: string, init: RequestInit) {
    const r = await fetch(url, init),
      body = await r.json();
    if (!r.ok) throw new Error(body.error ?? t("导出请求失败 ({value0})",{value0:r.status}));
    return body;
  }
  async function run() {
    if(dimensionError||upscaleError){setError(dimensionError||upscaleError);return;}
    setWorking(true);
    setError("");
    setProgress(0);
    setGenerationStatus(null);
    setSourceVideoFrames(null);
    setResult(null);
    setDomainFrames([]);
    setDomainRoutesTruncated(false);domainRouteKeys.current.clear();
    saveStop.current=false;setSaveStage('recording');setRecoveringSave(false);
    cancelRef.current = false;
    let g:Generator|null=null;
    const abort=new AbortController();recordingAbort.current=abort;
    let r:ArtRenderer|null=null;
    const checkCancelled=()=>{if(cancelRef.current)throw new DOMException(t('导出已取消'),'AbortError');};
    const recoverDelivery=(error:Error)=>new Promise<void>((resolve,reject)=>{
      if(abort.signal.aborted){reject(new DOMException(t('导出已取消'),'AbortError'));return;}
      setError(t('尚未确认录制保存结果，重试会继续同一个任务。')+'\n'+error.message);setRecoveringSave(true);
      const settle=(cancelled:boolean)=>{
        abort.signal.removeEventListener('abort',cancelledRecovery);retrySave.current=null;setRecoveringSave(false);setError('');
        if(cancelled)reject(new DOMException(t('导出已取消'),'AbortError'));else resolve();
      };
      const cancelledRecovery=()=>settle(true);
      retrySave.current=()=>settle(false);abort.signal.addEventListener('abort',cancelledRecovery,{once:true});
    });
    function publishVideoResult(result:{url:string}){
      checkCancelled();setResult({url:result.url,format,name:scene.name});
      const a=document.createElement('a');a.href=result.url;a.download=`${scene.name}.${format}`;a.click();
    }
    async function finishVideo(){
      const ticket=sessionRef.current!;
      const result=await request(`/api/exports/${ticket.id}/finish`,{method:'POST'});
      ticket.finished();sessionRef.current=null;
      publishVideoResult(result);
    }
    try {
      await exportSessionCleanup.flush();
      if(sessionRef.current&&!sessionRef.current.pending)sessionRef.current=null;
      checkCancelled();
      if(pausedSourceImage){
        if(!currentPausedCapture?.ready)throw new Error(t('请等待当前预览完成并暂停后再保存画面'));
        const captured=await currentPausedCapture.capture({width,height},pausedImageScale);
        checkCancelled();
        if(captured.type!=='raster')throw new Error(t('暂停截图没有生成图像'));
        const blob=sourceSurfaceLive||sourceNumericalLive?await encodeFormulaRaster(captured,'image/png',{signal:abort.signal,isCancelled:()=>cancelRef.current}):await encodeRgbaPng(captured.pixels,captured.width,captured.height,()=>cancelRef.current);
        checkCancelled();
        const url=service?(await request('/api/images',{method:'POST',headers:{'content-type':'image/png'},body:blob})).url:URL.createObjectURL(blob);
        checkCancelled();
        setResult({url,format:'png',name:scene.name});
        const a=document.createElement('a');a.href=url;a.download=`${scene.name}.png`;a.click();
        if(!service)setTimeout(()=>URL.revokeObjectURL(url),600000);
        setProgress(1);setWorking(false);onDone(t('图片已导出'));return;
      }
      if(liveRecording){
        if(!currentSourceRecording?.ready)throw new Error(t('请等待当前预览完成并暂停后再录制'));
        let delivery:RecordingVideoDelivery|undefined,noFrames=false;
        await currentSourceRecording.record({width,height,simulationFps:sharedRecordingFps?fps:recordingFps},{
          shouldStop:stoppableRecording?()=>saveStop.current:undefined,
          complete:async(_start,completion)=>{
            checkCancelled();
            if(stoppableRecording){
              setSaveStage('saving');setSourceVideoFrames(completion.encodedFrames);
              if(completion.encodedFrames===0){
                await sessionRef.current?.cleanup();sessionRef.current=null;noFrames=true;setError(t('没有可保存帧'));return;
              }
              const result=await delivery!.finish(completion.encodedFrames);sessionRef.current=null;
              publishVideoResult(result);setProgress(1);
            }else await finishVideo();
            checkCancelled();
          },
          start:async start=>{
            checkCancelled();
            (retainedSurface?assertSourceSurfaceRecordingFrame:retainedDomain?assertDomainRecordingFrame:retainedNumerical?assertFractalRecordingFrame:iteratedRecording?assertSourceIteratedRecordingFrame:assertPerlinRecordingFrame)(start.warmup,start.clock,0);
            if(start.warmup.width!==recordingSize.width||start.warmup.height!==recordingSize.height)throw new Error(t('录制实际尺寸与预检不一致，请等待预览完成后重试'));
            const frames=start.clock.encodedFrames;
            setSourceVideoFrames(frames);
            if(frames===0){if(stoppableRecording)return;throw new Error(t(fixedRetained?'队列在预热帧内已结束，没有可编码帧；请延长队列':'Perlin 队列在预热帧内已结束，没有可编码帧；请延长队列'));}
            const session=await request('/api/exports',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({width:videoWidth,height:videoHeight,fps,frames,format,...(fixedRetained?{inputWidth:recordingSize.width,inputHeight:recordingSize.height,...(format==='mp4'?{profile:'mathart',quality:recordingQuality}:{})}:{})})});
            // Register before observing cancellation, including dialog unmount
            // while the server was accepting the create request.
            sessionRef.current=exportSessionCleanup.registerCreated(session.id);
            if(stoppableRecording)delivery=new RecordingVideoDelivery(sessionRef.current,frames,abort.signal,recoverDelivery);
            checkCancelled();
          },
          frame:async(output,index,start)=>{
            checkCancelled();
            (retainedSurface?assertSourceSurfaceRecordingFrame:retainedDomain?assertDomainRecordingFrame:retainedNumerical?assertFractalRecordingFrame:iteratedRecording?assertSourceIteratedRecordingFrame:assertPerlinRecordingFrame)(output,start.clock,index+1);
            const blob=retainedNumerical?await encodeFormulaRaster(output,'image/png',{signal:abort.signal,isCancelled:()=>cancelRef.current}):await encodeRgbaPng(output.pixels,output.width,output.height,()=>cancelRef.current);
            checkCancelled();
            if(delivery)await delivery.upload(blob,index);
            else await request(`/api/exports/${sessionRef.current!.id}/frames?index=${index}`,{method:'POST',headers:{'content-type':'image/png'},body:blob});
            checkCancelled();setProgress((index+1)/start.clock.encodedFrames);
          },
        },abort.signal);
        // Finalize encoding before the retained owner resumes its live clock.
        checkCancelled();
        if(!noFrames)onDone(t('视频已编码并导出'));setWorking(false);return;
      }
      g=new Generator();generator.current=g;
      const exportScene=kind==='video'?(fractalFrames?withFractalFreshRecording(scene,recordingFps):rootsFrames?withRootsFreshRecording(scene,recordingFps):perlinFrames?withPerlinFreshRecording(scene,recordingFps):scene):scene;
      const bouncingPlan=sourceBouncing?prepareSourceBouncingExport(exportScene,currentSourceBouncingFrame,{kind,start:bouncingStart,width,height,fps}):undefined;
      if(bouncingPlan&&!bouncingPlan.ok)throw new Error(bouncingPlan.error.reason);
      const bouncing=bouncingPlan?.ok?bouncingPlan.value:undefined;
      const timeline=sourceFrames||sourceBouncing||perlinFrames||fractalFrames?exportScene.timeline:resolveTimeline(exportScene);
      if(exportScene.sourceCamera&&previewLogicalHeight===undefined)throw new Error('原版相机导出缺少预览逻辑高度，请等待预览完成');
      if((usesSourceSurfaceParticles(exportScene)||usesSourceImplicitCpuMesh(exportScene))&&previewPointPixelDensity===undefined)throw new Error('源几何导出缺少已呈现预览的像素密度，请等待预览完成');
      if(usesSourcePerlin(exportScene)&&!sourcePerlinViewport)throw new Error('Perlin 导出缺少已呈现的预览尺寸，请等待预览完成');
      if(usesSourceSamilaSplat(exportScene)&&samilaPrimaryPixelHeight===undefined)throw new Error('Samila 导出缺少主画布物理高度，请等待预览完成');
      if(usesSourceMapPresentation(exportScene)&&sourceMapToneReference===undefined)throw Error('Map 导出缺少已呈现主画布尺寸，请等待预览完成');
      if(usesSourceSymmetryPresentation(exportScene)&&sourceSymmetryToneReference===undefined)throw Error('Symmetry 导出缺少已呈现主画布尺寸，请等待预览完成');
      const exportContext={...(usesSourceMapPresentation(exportScene)?{sourceMapToneReference}:{}),...(usesSourceSymmetryPresentation(exportScene)?{sourceSymmetryToneReference}:{}),quality:'export' as const,width,height,...(usesSourceSamilaSplat(exportScene)?{samilaPrimaryPixelHeight}:{}),...(usesSourcePerlin(exportScene)?{sourcePerlinViewport}:{}),...(exportScene.sourceCamera?{sourceViewport:ordinarySourceViewport(exportScene,width,height,'offscreen',previewLogicalHeight!),sourcePointPixelDensity:previewPointPixelDensity}:{}),...(exportScene.kind==='fractal'?{fractalViewport:{logicalWidth:width,logicalHeight:height,target:'offscreen' as const}}:{}),...(usesRootsNativePresentation(exportScene)?{rootsViewport:{logicalWidth:width,logicalHeight:height,referenceLogicalHeight:previewLogicalHeight??height,target:'offscreen' as const}}:{})};
      const fractalContext=fractalVideo?{...exportContext,width:recordingSize.width,height:recordingSize.height,fractalViewport:{logicalWidth:recordingSize.logicalWidth!,logicalHeight:recordingSize.logicalHeight!,target:'offscreen' as const}}:undefined;
      if(!bouncing&&!sourceFractal&&!(kind==='video'&&perlinFrames)){const canvas = document.createElement('canvas');r=new ArtRenderer(canvas,artExportPurpose(exportScene));r.setSize(width,height,1);}
      if(bouncing?.warmup){
        const warmup=await g.generate(exportScene,sourceBouncingExportContext(bouncing,bouncing.warmup));
        checkCancelled();assertSourceBouncingExportFrame(warmup,bouncing,bouncing.warmup);
      }
      const startFrame=sourceFrames?(recordingStart==='current'?currentSpirographFrame:0):undefined;
      if(sourceFrames&&kind==='video'&&startFrame===undefined)throw new Error('当前旋轮帧尚未呈现，无法从当前状态录制');
      const recording=sourceFrames&&kind==='video'?await g.planSpirographRecording(scene,startFrame!,recordingFps):undefined;
      checkCancelled();
      if(recording&&recording.encodedFrames===0)throw new Error('旋轮队列在录制预热帧内已结束，没有可编码帧；请延长队列或从初始状态录制');
      const rootsRecording=rootsFrames&&kind==='video'?await g.planRootsFreshRecording(scene,recordingFps,fps):undefined;
      checkCancelled();
      if(rootsRecording){
        // Warmup is a real rendered update. Predicted completion never substitutes
        // for the worker-owned queue and drained local sample state.
        const warmup=await g.generate(exportScene,{...exportContext,time:0},undefined,status=>{if(!cancelRef.current)setGenerationStatus(status);});
        checkCancelled();
        if(warmup.type!=='raster'||warmup.rootsPresentation?.cameraTimeline?.frame!==0||warmup.rootsPresentation.autoRecording?.complete!==(rootsRecording.encodedFrames===0))throw new Error('复根录制预热状态与计划不一致');
        if(rootsRecording.encodedFrames===0)throw new Error('复根队列在录制预热帧内已结束，没有可编码帧；请延长队列');
      }
      const perlinRecording=perlinFrames&&kind==='video'?await g.planPerlinFreshRecording(scene,recordingFps,fps):undefined;
      checkCancelled();
      if(perlinRecording){
        const warmup=await g.generate(exportScene,{...exportContext,time:0});
        checkCancelled();assertPerlinRecordingFrame(warmup,perlinRecording,0);
        if(perlinRecording.encodedFrames===0)throw new Error('Perlin 队列在预热帧内已结束，没有可编码帧；请延长队列');
      }
      const fractalRecording=fractalVideo?await g.planFractalFreshRecording(scene,recordingFps,fps):undefined;
      checkCancelled();
      if(fractalRecording){
        const warmup=await g.generate(exportScene,{...fractalContext!,time:0,fractalRecording:fractalRecordingFrameInput(fractalRecording,0)});
        checkCancelled();assertFractalRecordingFrame(warmup,fractalRecording,0);
        if(warmup.type!=='raster'||warmup.width!==recordingSize.width||warmup.height!==recordingSize.height)throw Error('分形录制实际尺寸与预检不一致');
        if(fractalRecording.encodedFrames===0)throw Error('分形队列在预热帧内已结束，没有可编码帧；请延长队列');
      }
      const frames=bouncing?.frames.length??(kind==='image'?1:recording?.encodedFrames??rootsRecording?.encodedFrames??perlinRecording?.encodedFrames??fractalRecording?.encodedFrames??Math.max(1,Math.round(duration*fps)));
      if(bouncing||recording||rootsRecording||perlinRecording||fractalRecording)setSourceVideoFrames(frames);
      if (kind === "video") {
        checkCancelled();
        const session = await request("/api/exports", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ width:videoWidth, height:videoHeight, fps, frames, format,...(bouncing?{inputWidth:bouncing.width,inputHeight:bouncing.height}:{}),...(fractalRecording?{inputWidth:recordingSize.width,inputHeight:recordingSize.height,...(format==='mp4'?{profile:'mathart',quality:recordingQuality}:{})}:{}) }),
        });
        sessionRef.current = exportSessionCleanup.registerCreated(session.id);
        checkCancelled();
      }
      for (let frame = 0; frame < frames; frame++) {
        checkCancelled();
        setGenerationStatus(null);
        const frameTime = bouncing?bouncing.frames[frame].sceneTime:kind === "image" ? time : fractalRecording?0:recording?0:rootsRecording?(frame+1)/rootsRecording.simulationFps:perlinRecording?(frame+1)/perlinRecording.simulationFps:normalizeTimelineTime(frame / fps,timeline),
          output = await g.generate(exportScene, bouncing?sourceBouncingExportContext(bouncing,bouncing.frames[frame]):{
            ...(fractalRecording?fractalContext!:exportContext),
            time: frameTime,
            ...(fractalRecording?{fractalRecording:fractalRecordingFrameInput(fractalRecording,frame+1)}:{}),
            ...(sourceFrames?{spirographFrame:recording?{frame:frame+2,recording:{startFrame:startFrame!,fps:recordingFps}}:{frame:currentSpirographFrame??sourceFrameIndex(time,spirographSimulationFps(scene))}}:{}),
          },undefined,status=>{
            if(cancelRef.current)return;
            setGenerationStatus(status);
            const fraction=status.targetSamples>0?Math.min(1,status.attemptedSamples/status.targetSamples):1;
            // Keep room for raster composition and encoding. A finished
            // mathematical frame is not yet an exported file.
            setProgress((frame+.9*fraction)/frames);
          });
        checkCancelled();
        if(output.type==='raster'&&output.domainRender){
          const facts=output.domainRender,key=JSON.stringify({policy:facts.policy,requested:facts.requested,effective:facts.effective,route:facts.route,trigger:facts.trigger});
          if(!domainRouteKeys.current.has(key)&&domainRouteKeys.current.size>=16)setDomainRoutesTruncated(true);
          else {domainRouteKeys.current.add(key);setDomainFrames(previous=>{
            const last=previous.at(-1);if(last?.key===key)return[...previous.slice(0,-1),{...last,last:frame,facts}];
            // At most one entry per distinct completed execution route. Keep
            // the first and last frame, not an unbounded per-frame diagnostic.
            const found=previous.findIndex(item=>item.key===key);
            if(found>=0)return previous.map((item,i)=>i===found?{...item,last:frame,facts}:item);
            return[...previous,{first:frame,last:frame,facts,key}];
          });}
        }
        if(recording&&(!output.spirographFrame||output.spirographFrame.encodedFrameIndex!==frame||frame===frames-1&&!output.spirographFrame.recordingFinished))throw new Error('旋轮录制帧与已解析的队列终点不一致');
        if(rootsRecording&&(output.type!=='raster'||output.rootsPresentation?.cameraTimeline?.frame!==frame+1||output.rootsPresentation.autoRecording?.complete!==(frame===frames-1)))throw new Error('复根录制帧与实际完成状态不一致');
        if(perlinRecording)assertPerlinRecordingFrame(output,perlinRecording,frame+1);
        if(fractalRecording)assertFractalRecordingFrame(output,fractalRecording,frame+1);
        let blob:Blob;
        if(sourceFractal){
          if(output.type!=='raster')throw new Error('分形没有生成图像');
          blob=await encodeFormulaRaster(output,kind==='image'&&format==='jpg'?'image/jpeg':'image/png',{signal:abort.signal,isCancelled:()=>cancelRef.current});
        }else if(bouncing||perlinRecording){
          if(bouncing)assertSourceBouncingExportFrame(output,bouncing,bouncing.frames[frame]);
          if(output.type!=='raster')throw new Error('录制帧没有生成图像');
          blob=bouncing&&kind==='image'
            ?await encodeSourcePausedPng(output.pixels,output.width,output.height,1,{signal:abort.signal,isCancelled:()=>cancelRef.current})
            :await encodeRgbaPng(output.pixels,output.width,output.height,()=>cancelRef.current);
        }else{
          const frameScene=output.spirographFrame?withSpirographReplayFrame(exportScene,output.spirographFrame):usesRootsNativePresentation(exportScene)?exportScene:sourceQueuePresentedScene(exportScene,output)??sceneAtTime(exportScene,output.sourceCameraFrame?.time??frameTime);
          const view=outputCamera(frameScene,output);r!.setOutput(output,frameScene,false,view);
          blob=await r!.blob(kind==='image'&&format==='jpg'?'image/jpeg':'image/png',.95,{sourcePresentationAlpha:kind==='video'?'opaque':'preserve',...(kind==='image'&&format==='png'&&usesSourceImplicitCpuMesh(exportScene)?{sourceImageProcessing:'paused-png' as const}:{}),signal:abort.signal,isCancelled:()=>cancelRef.current});
        }
        checkCancelled();
        if (kind === "image") {
          const url = service ? (await request('/api/images',{method:'POST',headers:{'content-type':blob.type},body:blob})).url : URL.createObjectURL(blob),
            a = document.createElement("a");
          checkCancelled();
          setResult({url,format,name:scene.name});
          a.href = url;
          a.download = `${scene.name}.${format}`;
          a.click();
          if(!service)setTimeout(() => URL.revokeObjectURL(url), 600000);
        } else
          await request(
            `/api/exports/${sessionRef.current!.id}/frames?index=${frame}`,
            {
              method: "POST",
              headers: { "content-type": "image/png" },
              body: blob,
            },
          );
        checkCancelled();
        setProgress((frame + 1) / frames);
      }
      if (kind === "video") {
        checkCancelled();
        await finishVideo();
      }
      checkCancelled();
      onDone(kind === "image" ? t("图片已导出") : t("视频已编码并导出"));
      setWorking(false);
    } catch (e) {
      let message=e instanceof Error&&e.name!=='AbortError'?e.message:'';
      if (sessionRef.current?.pending&&!(e instanceof ExportSessionCleanupError)) {
        try {
          await sessionRef.current.cleanup();
          if(!sessionRef.current.pending)sessionRef.current=null;
        } catch(cleanupError) {
          message=[message,cleanupError instanceof Error?cleanupError.message:String(cleanupError)].filter(Boolean).join('\n');
        }
      }
      if(message)setError(message);
      setWorking(false);
    } finally {
      try { g?.dispose(); }
      finally {
        try { r?.dispose(); }
        finally {
          generator.current = null;
          if(recordingAbort.current===abort)recordingAbort.current=null;
          retrySave.current=null;setRecoveringSave(false);
          setGenerationStatus(null);
        }
      }
    }
  }
  function cancel() {
    cancelRef.current = true;
    recordingAbort.current?.abort();
    generator.current?.cancel();
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal export-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t(recordingMode?recordingTitle:"导出作品")}
      >
        <div className="modal-heading">
          <h2>{t(recordingMode?recordingTitle:"导出作品")}</h2>
          <button aria-label={t("关闭导出")} disabled={working} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className="muted">
          {scene.name} ·{" "}
          {kind === "image"
            ? t("当前帧 {value0} s",{value0:(sourceBouncing?currentSourceBouncingFrame?.frame.checkpoint.sceneTime??0:time).toFixed(2)})
            : t("逐帧渲染，无丢帧编码")}
        </p>
        {domainFrames.length>0&&<details open data-testid="domain-export-rendering"><summary>{t('本次导出的实际执行规则')}</summary>{domainFrames.map(item=><div key={item.key}><p>{t('已完成帧 {first}–{last}',{first:item.first+1,last:item.last+1})}</p><DomainRenderSummary facts={item.facts}/></div>)}{domainFrames.length>1&&<p>{t('本次导出使用了多种执行路径；以下范围记录各路径首次和最后出现的帧，不表示中间所有帧相同。')}</p>}{domainRoutesTruncated&&<p>{t('执行路径详情超过 16 项，后续不同路径未全部列出。')}</p>}</details>}
        {sourceBouncing&&<p role="status" className="muted">{t(kind==='image'?'PNG 保存当前已呈现检查点，不推进模拟；尺寸变化只改变输出投影。':'源弹跳离线逐帧录制，使用源时钟的预热与停止规则。')}{!currentSourceBouncingFrame?.ready&&t('请等待当前预览完成并暂停后再导出。')}</p>}
        {sourceIterated&&!iteratedRecording&&<p role="status" className="muted">{t(pausedSourceImage?'截图会额外绘制导出图和主预览，动画时间保持不变。同尺寸会继续累积或推进重播；改变尺寸会清空累积画面并取消重播。':'从初始状态按固定时间重放，不复制当前实时累积画面。')}</p>}
        {sourceSamila&&<p role="status" className="muted">{t(pausedSourceImage?'截图会新增一次采样，随后重绘预览再采样一次；动画时间保持不变。改变尺寸会清空累积画面。':'从初始状态重放，使用独立随机采样；不会复制当前预览的累积画面。')}</p>}
        {sourcePerlin&&<p role="status" className="muted">{t(pausedSourceImage?'保存当前暂停场景并增强图像，不推进动画；累积效果会保留在独立的导出画布中。':retainedPerlin?'使用上次应用的配置重新开始录制，保留主画布和同尺寸导出画布的累积效果。保存完成后从录制状态继续播放。':'从当前配置的初始状态重放，不保留预览中的后端切换历史。')}</p>}
        {liveRecording&&<><p className="muted">{t('实际视频尺寸：{width} × {height} 像素。',{width:videoWidth,height:videoHeight})}</p>{!working&&!currentSourceRecording?.ready&&<p role="status" className="muted">{t('请等待当前预览完成并暂停后再录制')}</p>}{upscaleError&&<p className="export-error" role="alert">{t(upscaleError)}</p>}</>}
        {usesRootsNativePresentation(scene)&&<p role="status" className="muted">{t(pausedSourceImage?'保存当前暂停场景并增强图像；尺寸变化会清空密度墨迹，点云截图使用独立的累积画布。':'空间复根导出会从初始采样重放到所选时间，使用当前相机和导出尺寸；预览中的历史墨迹与点云拖影不会复制。')}</p>}
        {!recordingMode&&<div className="export-kind">
          <button
            className={kind === "image" ? "active" : ""}
            disabled={working}
            onClick={() => {
              setKind("image");
              setFormat("png");
            }}
          >
            <Image size={15} />{t("静态图像")}</button>
          <button
            className={kind === "video" ? "active" : ""}
            disabled={working}
            onClick={() => {
              setKind("video");
              setFormat("mp4");
            }}
          >
            <Film size={15} />{t("动画视频")}</button>
        </div>}
        {kind==='image'&&(sourceSurfaceLive||sourceNumericalLive||usesRootsNativePresentation(scene)||sourcePerlin||sourceSamila||sourceIterated)&&<label className="field"><span>{t(sourceSurfaceLive?'曲面图像来源':sourceDomainLive?'域着色图像来源':sourceFractalLive?'分形图像来源':sourcePerlin?'Perlin 图像来源':sourceSamila?'Samila 图像来源':sourceIterated?(scene.kind==='map'?'Map 图像来源':'Symmetry 图像来源'):'复根图像来源')}</span><select aria-label={t(sourceSurfaceLive?'曲面图像来源':sourceDomainLive?'域着色图像来源':sourceFractalLive?'分形图像来源':sourcePerlin?'Perlin 图像来源':sourceSamila?'Samila 图像来源':sourceIterated?(scene.kind==='map'?'Map 图像来源':'Symmetry 图像来源'):'复根图像来源')} disabled={working} value={sourceImageMode} onChange={e=>{setSourceImageMode(e.target.value as 'current'|'replay');setFormat('png');}}><option value="current">{t('当前暂停场景')}</option><option value="replay">{t('从初始状态重放')}</option></select></label>}
        {kind==='image'&&sourceDomainLive&&<p className="muted">{t(sourceImageMode==='current'?'保存当前暂停的域着色状态，不推进动画；尺寸只改变导出画面。':'从当前配置按固定时间重放，不复制实时预览的编辑历史。')}</p>}
        {kind==='image'&&sourceFractalLive&&<p className="muted">{t(sourceImageMode==='current'?'保存当前暂停的分形状态，不推进动画；尺寸只改变导出画面。':'从当前配置按固定时间重放，不复制实时预览的编辑历史。')}</p>}
        {pausedSourceImage&&<><label className="field"><span>{t('PNG 放大倍率')}</span><select aria-label={t('PNG 放大倍率')} disabled={working} value={pausedImageScale} onChange={e=>setPausedImageScale(Number(e.target.value) as 1|3|5)}>{([1,3,5] as const).map(scale=><option key={scale} value={scale}>{scale}×</option>)}</select></label><p className="muted">{t(sourceNumericalLive?'按当前暂停状态生成图像，再按所选倍率放大。输出 {width} × {height} 像素。':'先按基础尺寸增强，再放大图像。输出 {width} × {height} 像素。',{width:outputBase.width*pausedImageScale,height:outputBase.height*pausedImageScale})}</p>{upscaleError&&<p className="export-error" role="alert">{t(upscaleError)}</p>}</>}
        <label className="field">
          <span>{t("文件格式")}</span>
          <select
            disabled={working}
            aria-label={t("导出格式")}
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          >
            {(kind === "image" ? pausedSourceImage||sourceBouncing?["png"]:["png", "jpg"] : ["mp4", "webm", "gif"]).map(
              (f) => (
                <option key={f} value={f}>
                  {f.toUpperCase()}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="field">
          <span>{t("分辨率")}</span>
          <select
            disabled={working}
            aria-label={t("导出分辨率")}
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
          >
            {[
              "640x360",
              "1280x720",
              "1920x1080",
              "2560x1440",
              "3840x2160",
              "1080x1080",
              "1080x1920",
            ].map((r) => (
              <option key={r} value={r}>
                {r.replace("x", " × ")}
              </option>
            ))}
            <option value="custom">{t("自定义尺寸")}</option>
          </select>
        </label>
        {!pausedSourceImage&&upscaleError&&<p className="export-error" role="alert">{t(upscaleError)}</p>}
        {resolution==='custom'&&<><label className="field"><span>{t("宽度 · px")}</span><input aria-label={t("导出宽度")} disabled={working} type="number" min={16} max={kind==='video'?7680:16384} step={kind==='video'?2:1} value={customWidth} onChange={e=>setCustomWidth(Number(e.target.value))}/></label><label className="field"><span>{t("高度 · px")}</span><input aria-label={t("导出高度")} disabled={working} type="number" min={16} max={kind==='video'?4320:16384} step={kind==='video'?2:1} value={customHeight} onChange={e=>setCustomHeight(Number(e.target.value))}/></label>{dimensionError&&<p className="export-error" role="alert">{dimensionError}</p>}</>}
        {kind === "video" && (
          <>
            <label className="field">
              <span>{t(sourceFrames||rootsFrames||sourceQueueVideo?'编码帧率':'帧率')}</span>
              <input
                disabled={working}
                type="number"
                aria-label={t("导出帧率")}
                min={1}
                max={120}
                step={1}
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
              />
            </label>
            {usesRootsCameraTimeline(scene)&&<label className="field"><span>{t('复根视频模式')}</span><select aria-label={t('复根视频模式')} disabled={working} value={rootsVideoMode} onChange={event=>setRootsVideoMode(event.target.value as 'duration'|'source')}><option value="duration">{t('按时长导出')}</option><option value="source">{t('按源完成条件录制')}</option></select></label>}
            {sourceSurfaceLive&&!recordingMode&&<label className="field"><span>{t('曲面视频模式')}</span><select aria-label={t('曲面视频模式')} disabled={working} value={surfaceVideoMode} onChange={event=>setSurfaceVideoMode(event.target.value as 'duration'|'retained')}><option value="retained">{t('从上次完整应用的场景录制')}</option><option value="duration">{t('按时长导出')}</option></select></label>}
            {sourceDomainLive&&!recordingMode&&<label className="field"><span>{t('域着色视频模式')}</span><select aria-label={t('域着色视频模式')} disabled={working} value={domainVideoMode} onChange={event=>setDomainVideoMode(event.target.value as 'duration'|'retained')}><option value="retained">{t('从上次完整应用的场景录制')}</option><option value="duration">{t('按时长导出')}</option></select></label>}
            {sourceFractal&&!recordingMode&&<label className="field"><span>{t('分形视频模式')}</span><select aria-label={t('分形视频模式')} disabled={working} value={fractalVideoMode} onChange={event=>setFractalVideoMode(event.target.value as 'duration'|'source'|'retained')}><option value="source">{t('按源完成条件录制')}</option><option value="duration">{t('按时长导出')}</option>{currentSourceRecording&&<option value="retained">{t('从上次完整应用的场景录制')}</option>}</select></label>}
            {sourcePerlin&&!recordingMode&&<label className="field"><span>{t('Perlin 视频模式')}</span><select aria-label={t('Perlin 视频模式')} disabled={working} value={perlinVideoMode} onChange={event=>setPerlinVideoMode(event.target.value as 'duration'|'source'|'retained')}><option value="duration">{t('按时长导出')}</option><option value="source">{t('按源队列结束重放')}</option><option value="retained">{t('保留画布录制')}</option></select></label>}
            {sourceIterated&&<label className="field"><span>{t('迭代场景视频模式')}</span><select aria-label={t('迭代场景视频模式')} disabled={working} value={iteratedVideoMode} onChange={event=>setIteratedVideoMode(event.target.value as 'duration'|'source')}><option value="source">{t('按源完成条件录制')}</option><option value="duration">{t('按时长导出')}</option></select></label>}
            {(fixedRetained||fractalVideo)&&format==='mp4'&&<label className="field"><span>{t('视频质量')}</span><select aria-label={t('视频质量')} disabled={working} value={recordingQuality} onChange={event=>setRecordingQuality(event.target.value as typeof recordingQuality)}><option value="low">{t('低')}</option><option value="medium">{t('中')}</option><option value="high">{t('高')}</option><option value="production">{t('制作级')}</option></select></label>}
            {sourceBouncing?<>
              <label className="field"><span>{t('弹跳录制起点')}</span><select aria-label={t('弹跳录制起点')} disabled={working} value={bouncingStart} onChange={event=>setBouncingStart(event.target.value as 'current'|'seed')}><option value="seed">{t('重建初始状态')}</option><option value="current">{t('当前状态（本地扩展）')}</option></select></label>
              <p className="muted" data-testid="source-bouncing-export-duration">{t('源录制时长（秒）')}：{scene.bouncingSource!.recordDuration}。{t('修改场景的源录制时长可改变停止条件。')}</p>
              <p className="muted">{t('重建初始状态会按当前场景配置生成粒子、恢复作者相机角度并将缩放重置为 1；当前状态选项保留已呈现的粒子与视角。两种方式均将录制时钟清零，先推进并绘制 1 帧预热但不编码，再录制到源时长阈值；帧率同时用于模拟时钟和视频编码。')}</p>
              {sourceVideoFrames!==null&&<p className="muted">{t('本次录制 {frames} 帧',{frames:sourceVideoFrames})}</p>}
            </>:sourceFrames||rootsFrames||sourceQueueVideo?<>
              {sourceFrames&&<label className="field"><span>{t('录制起点')}</span><select aria-label={t('录制起点')} disabled={working} value={recordingStart} onChange={event=>setRecordingStart(event.target.value as 'fresh'|'current')}><option value="fresh">{t('从初始状态')}</option><option value="current" disabled={currentSpirographFrame===undefined}>{t('从当前已呈现帧')}</option></select></label>}
              {!sharedRecordingFps&&<label className="field"><span>{t('录制模拟帧率')}</span><input aria-label={t('录制模拟帧率')} disabled={working} type="number" min={1} max={120} step={1} value={recordingFps} onChange={event=>setRecordingFps(Number(event.target.value))}/></label>}
              <p className="muted">{t(retainedSurface?'从上次完整应用的曲面场景开始，预热后录到队列结束，保存后继续播放。帧率同时用于模拟和编码。要将修改作为录制起点，请先点击“应用场景”。':retainedDomain?'从上次完整应用的域着色场景开始，预热后录到队列结束，保存后继续播放。要将修改作为录制起点，请先点击“应用场景”。':retainedNumerical?'从上次完整应用的场景开始，预热后录到队列结束，编码完成后继续播放。帧率同时用于模拟和编码。要将修改作为录制起点，请先播放并点击“应用场景”。':fractalVideo?'从当前配置重新开始，先绘制一帧预热，再录到队列结束。使用三倍导出画布，MP4 使用原版质量设置。模拟帧率与编码帧率默认相同；分别调整播放速度是本地扩展。':iteratedRecording?'从上次应用的配置开始，首帧预热后按队列结束停止；编码完成后动画继续播放。帧率同时用于模拟和视频编码。':retainedPerlin?'恢复上次应用的模拟配置和后端，首帧预热后录到队列结束，保存后继续播放。导出尺寸变化会重建导出画布。':perlinFrames?'使用当前配置在新画布重放，首帧预热后按源队列结束停止。不会复用预览或上次导出的画面。模拟帧率决定运动步长，编码帧率决定播放速度。':rootsFrames?'从初始状态重放；首帧用于预热。存在源队列时按队列结束停止；空队列等待本地样本提交完成。模拟帧率决定运动步长，编码帧率决定视频播放速度。':'按源队列结束时停止录制；首个已推进帧用于预热，不写入视频。模拟帧率决定运动步长，编码帧率决定视频播放速度。')}</p>
              {sourceVideoFrames!==null&&<p className="muted">{t('本次录制 {frames} 帧',{frames:sourceVideoFrames})}</p>}
            </>:<label className="field">
              <span>{t("时长（秒）")}</span>
              <input
                aria-label={t("导出时长")}
                disabled={working}
                type="number"
                min=".1"
                max="3600"
                step=".1"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </label>}
            {ffmpeg === false && (
              <p className="export-error">{t("视频编码服务尚未运行。请在 studio 目录执行 npm run server，并确保本机可使用 FFmpeg。")}</p>
            )}
          </>
        )}
        {working && (
          <>
            <div className="export-info">
              <span>
                {progress === 1 && kind === "video"
                  ? t("正在完成编码…")
                  : t("正在渲染…")}
              </span>
              <span>{Math.round(progress * 100)}%</span>
            </div>
            <div className="progress-bar">
              <span style={{ width: `${progress * 100}%` }} />
            </div>
            {generationStatus?.kind==='roots'&&<p role="status" className="muted">{t('复根计算：{value0} / {value1} 个当前帧样本；场景总目标 {value2}。',{value0:generationStatus.attemptedSamples.toLocaleString(),value1:generationStatus.targetSamples.toLocaleString(),value2:generationStatus.totalSamples.toLocaleString()})}</p>}
          </>
        )}
        {error && (
          <p className="export-error" role="alert">
            {t(error)}
          </p>
        )}
        {result&&<a className="export-result" href={result.url} download={`${result.name}.${result.format}`} target="_blank" rel="noreferrer">{t("文件已生成 · 下载")}{result.format.toUpperCase()}</a>}
        <div className="modal-actions">
          {working&&stoppableRecording&&<button disabled={saveStage!=='recording'||recoveringSave} onClick={()=>{saveStop.current=true;setSaveStage('stopping');}}>{t('停止并保存')}</button>}
          {working&&recoveringSave&&<button onClick={()=>retrySave.current?.()}>{t('重试保存')}</button>}
          {working ? (
            <button disabled={stoppableRecording&&saveStage!=='recording'&&!recoveringSave} onClick={cancel}>{t(recoveringSave?'丢弃导出':"取消导出")}</button>
          ) : (
            <button onClick={onClose}>{t("关闭")}</button>
          )}
          <button
            className="primary-button"
            disabled={
              working || liveRecording&&!currentSourceRecording?.ready || !!dimensionError || !!upscaleError || sourceBouncing&&!currentSourceBouncingFrame?.ready || pausedSourceImage&&!currentPausedCapture?.ready ||
              (kind === "video" &&
                (ffmpeg !== true || !Number.isSafeInteger(fps)||fps<1||fps>120||
                  (sourceFrames||rootsFrames||sourceQueueVideo&&!sharedRecordingFps)&&(!Number.isSafeInteger(recordingFps)||recordingFps<1||recordingFps>120||sourceFrames&&recordingStart==='current'&&currentSpirographFrame===undefined)||!sourceBouncing&&!sourceFrames&&!rootsFrames&&!sourceQueueVideo&&(!Number.isFinite(duration) ||
                  duration <= 0 ||
                  duration > 3600)))
            }
            onClick={run}
          >
            <Download size={15} />
            {working ? t("导出中…") : t(recordingMode?'开始录制':"开始导出")}
          </button>
        </div>
      </section>
    </div>
  );
}
