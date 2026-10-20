import {usesSourcePerlinCpu} from '../engine/sourcePerlinIdentity';
import {sourceQueuePresentedScene} from '../engine/sourceQueuePresentation';
import {usesSourceBouncing} from '../engine/sourceBouncingDocument';
import {prepareSourceBouncingExport,sourceBouncingExportContext,assertSourceBouncingExportFrame,type SourceBouncingPresentedExport} from '../engine/sourceBouncingExport';
import {usesSourceSurfaceParticles} from '../engine/sourceSurfaceIdentity';
import {ordinarySourceViewport} from '../engine/ordinarySourceCamera';
import { useEffect, useRef, useState } from "react";
import { Download, Image, Film, X } from "lucide-react";
import type { SceneDocument,SceneOutput,GenerationStatus,RasterOutput } from "../types";
import type {RootsPausedCaptureSize} from '../engine/generationProtocol';
import {prepareRootsPausedUpscale} from '../engine/rootsPausedUpscale';
import {validateRasterRequest} from '../engine/rasterDimensions';
import {encodeRgbaPng} from '../engine/rgbaPng';
import { Generator } from "../engine/client";
import { ArtRenderer } from "../engine/renderer";
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
export function ExportDialog({
  scene,
  time,
  currentSpirographFrame,
  previewLogicalHeight,
  sourcePerlinViewport,
  previewPointPixelDensity,
  currentRootsCapture,
  currentSourceBouncingFrame,
  onClose,
  onDone,
}: {
  scene: SceneDocument;
  time: number;
  currentSpirographFrame?:number;
  previewLogicalHeight?:number;
  sourcePerlinViewport?:{width:number;height:number;pixelDensity:number};
  previewPointPixelDensity?:number;
  currentRootsCapture?:{ready:boolean;size:RootsPausedCaptureSize;capture:(size:RootsPausedCaptureSize,scale:1|3|5)=>Promise<SceneOutput>};
  currentSourceBouncingFrame?:SourceBouncingPresentedExport;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const {t}=useI18n();
  const sourceBouncing=usesSourceBouncing(scene);
  const [bouncingStart,setBouncingStart]=useState<'current'|'seed'>('seed');
  const sourceFrames=usesSpirographFrameClock(scene);
  const [rootsImageMode,setRootsImageMode]=useState<'current'|'replay'>(()=>usesRootsNativePresentation(scene)?'current':'replay');
  const [rootsImageScale,setRootsImageScale]=useState<1|3|5>(1);
  const [rootsVideoMode,setRootsVideoMode]=useState<'duration'|'source'>(()=>usesRootsGradientTimeline(scene)?'source':'duration');
  const rootsFrames=usesRootsCameraTimeline(scene)&&rootsVideoMode==='source';
  const [recordingStart,setRecordingStart]=useState<'fresh'|'current'>('fresh');
  const [recordingFps,setRecordingFps]=useState(()=>sourceFrames?spirographSimulationFps(scene):scene.timeline.fps);
  const [sourceVideoFrames,setSourceVideoFrames]=useState<number|null>(null);
  const [kind, setKind] = useState<"image" | "video">("image"),
    [format, setFormat] = useState("png"),
    [resolution, setResolution] = useState(scene.projectResolution||currentRootsCapture?'custom':"1920x1080"),
    [customWidth,setCustomWidth]=useState(scene.projectResolution?.width??currentRootsCapture?.size.width??1920),
    [customHeight,setCustomHeight]=useState(scene.projectResolution?.height??currentRootsCapture?.size.height??1080),
    [fps, setFps] = useState(()=>sourceFrames?spirographSimulationFps(scene):scene.timeline.fps),
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
  const domainRouteKeys=useRef(new Set<string>());
  const cancelRef = useRef(false),
    sessionRef = useRef<ExportSessionTicket | null>(null),
    generator = useRef<Generator | null>(null);
  const [width,height]=resolution==='custom'?[customWidth,customHeight]:resolution.split('x').map(Number);
  const pausedRootsImage=kind==='image'&&usesRootsNativePresentation(scene)&&rootsImageMode==='current';
  let upscaleError='';
  if(pausedRootsImage&&rootsImageScale!==1){try{const size=prepareRootsPausedUpscale(width,height,rootsImageScale);validateRasterRequest({time:0,quality:'export',width:size.width,height:size.height});}catch(error){upscaleError=error instanceof Error?error.message:String(error);}}
  let dimensionError='';
  if(kind==='video')dimensionError=![width,height].every(Number.isSafeInteger)||width<16||height<16||width>7680||height>4320?t("宽度需为 16–7680、高度需为 16–4320 的整数。"):(width%2!==0||height%2!==0)?t("视频的宽度和高度都必须是偶数。"):'';
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
    cancelRef.current = false;
    const g = new Generator();
    generator.current = g;
    let r:ArtRenderer|null=null;
    const checkCancelled=()=>{if(cancelRef.current)throw new DOMException(t('导出已取消'),'AbortError');};
    try {
      await exportSessionCleanup.flush();
      if(sessionRef.current&&!sessionRef.current.pending)sessionRef.current=null;
      checkCancelled();
      if(pausedRootsImage){
        if(!currentRootsCapture?.ready)throw new Error(t('请等待当前复根预览完成后再保存暂停画面'));
        const captured=await currentRootsCapture.capture({width,height},rootsImageScale);
        checkCancelled();
        if(captured.type!=='raster')throw new Error(t('复根暂停截图没有生成图像'));
        const blob=await encodeRgbaPng(captured.pixels,captured.width,captured.height,()=>cancelRef.current);
        checkCancelled();
        const url=service?(await request('/api/images',{method:'POST',headers:{'content-type':'image/png'},body:blob})).url:URL.createObjectURL(blob);
        checkCancelled();
        setResult({url,format:'png',name:scene.name});
        const a=document.createElement('a');a.href=url;a.download=`${scene.name}.png`;a.click();
        if(!service)setTimeout(()=>URL.revokeObjectURL(url),600000);
        setProgress(1);setWorking(false);onDone(t('图片已导出'));return;
      }
      const exportScene=rootsFrames&&kind==='video'?withRootsFreshRecording(scene,recordingFps):scene;
      const bouncingPlan=sourceBouncing?prepareSourceBouncingExport(exportScene,currentSourceBouncingFrame,{kind,start:bouncingStart,width,height,fps}):undefined;
      if(bouncingPlan&&!bouncingPlan.ok)throw new Error(bouncingPlan.error.reason);
      const bouncing=bouncingPlan?.ok?bouncingPlan.value:undefined;
      const timeline=sourceFrames||sourceBouncing?exportScene.timeline:resolveTimeline(exportScene);
      if(exportScene.sourceCamera&&previewLogicalHeight===undefined)throw new Error('原版相机导出缺少预览逻辑高度，请等待预览完成');
      if(usesSourceSurfaceParticles(exportScene)&&previewPointPixelDensity===undefined)throw new Error('源曲面点导出缺少已呈现预览的像素密度，请等待预览完成');
      if(usesSourcePerlinCpu(exportScene)&&!sourcePerlinViewport)throw new Error('Perlin CPU 导出缺少已呈现的预览尺寸，请等待预览完成');
      const exportContext={quality:'export' as const,width,height,...(usesSourcePerlinCpu(exportScene)?{sourcePerlinViewport}:{}),...(exportScene.sourceCamera?{sourceViewport:ordinarySourceViewport(exportScene,width,height,'offscreen',previewLogicalHeight!),sourcePointPixelDensity:previewPointPixelDensity}:{}),...(exportScene.kind==='fractal'?{fractalViewport:{logicalWidth:width,logicalHeight:height,target:'offscreen' as const}}:{}),...(usesRootsNativePresentation(exportScene)?{rootsViewport:{logicalWidth:width,logicalHeight:height,referenceLogicalHeight:previewLogicalHeight??height,target:'offscreen' as const}}:{})};
      if(!bouncing){const canvas = document.createElement('canvas');r=new ArtRenderer(canvas);r.setSize(width,height,1);}
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
      const frames=bouncing?.frames.length??(kind==='image'?1:recording?.encodedFrames??rootsRecording?.encodedFrames??Math.max(1,Math.round(duration*fps)));
      if(bouncing||recording||rootsRecording)setSourceVideoFrames(frames);
      if (kind === "video") {
        checkCancelled();
        const session = await request("/api/exports", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ width, height, fps, frames, format }),
        });
        sessionRef.current = exportSessionCleanup.registerCreated(session.id);
        checkCancelled();
      }
      for (let frame = 0; frame < frames; frame++) {
        checkCancelled();
        setGenerationStatus(null);
        const frameTime = bouncing?bouncing.frames[frame].sceneTime:kind === "image" ? time : recording?0:rootsRecording?(frame+1)/rootsRecording.simulationFps:normalizeTimelineTime(frame / fps,timeline),
          output = await g.generate(exportScene, bouncing?sourceBouncingExportContext(bouncing,bouncing.frames[frame]):{
            ...exportContext,
            time: frameTime,
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
        let blob:Blob;
        if(bouncing){
          assertSourceBouncingExportFrame(output,bouncing,bouncing.frames[frame]);
          blob=await encodeRgbaPng(output.pixels,output.width,output.height,()=>cancelRef.current);
        }else{
          const frameScene=output.spirographFrame?withSpirographReplayFrame(exportScene,output.spirographFrame):usesRootsNativePresentation(exportScene)?exportScene:sourceQueuePresentedScene(exportScene,output)??sceneAtTime(exportScene,output.sourceCameraFrame?.time??frameTime);
          const view=outputCamera(frameScene,output);r!.setOutput(output,frameScene,false,view);
          blob=await r!.blob(kind==='image'&&format==='jpg'?'image/jpeg':'image/png');
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
        const result = await request(
          `/api/exports/${sessionRef.current!.id}/finish`,
          { method: "POST" },
        );
        sessionRef.current!.finished();sessionRef.current=null;
        checkCancelled();
        const a = document.createElement("a");
        a.href = result.url;
        setResult({url:result.url,format,name:scene.name});
        a.download = `${scene.name}.${format}`;
        a.click();
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
      try { g.dispose(); }
      finally {
        try { r?.dispose(); }
        finally {
          generator.current = null;
          setGenerationStatus(null);
        }
      }
    }
  }
  function cancel() {
    cancelRef.current = true;
    generator.current?.cancel();
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal export-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("导出作品")}
      >
        <div className="modal-heading">
          <h2>{t("导出作品")}</h2>
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
        {usesRootsNativePresentation(scene)&&<p role="status" className="muted">{t(pausedRootsImage?'保存当前暂停场景并增强图像；尺寸变化会清空密度墨迹，点云截图使用独立的累积画布。':'空间复根导出会从初始采样重放到所选时间，使用当前相机和导出尺寸；预览中的历史墨迹与点云拖影不会复制。')}</p>}
        <div className="export-kind">
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
        </div>
        {kind==='image'&&usesRootsNativePresentation(scene)&&<label className="field"><span>{t('复根图像来源')}</span><select aria-label={t('复根图像来源')} disabled={working} value={rootsImageMode} onChange={e=>{setRootsImageMode(e.target.value as 'current'|'replay');setFormat('png');}}><option value="current">{t('当前暂停场景')}</option><option value="replay">{t('从初始状态重放')}</option></select></label>}
        {pausedRootsImage&&<><label className="field"><span>{t('PNG 放大倍率')}</span><select aria-label={t('PNG 放大倍率')} disabled={working} value={rootsImageScale} onChange={e=>setRootsImageScale(Number(e.target.value) as 1|3|5)}>{([1,3,5] as const).map(scale=><option key={scale} value={scale}>{scale}×</option>)}</select></label><p className="muted">{t('先按基础尺寸增强，再放大图像。输出 {width} × {height} 像素。',{width:width*rootsImageScale,height:height*rootsImageScale})}</p>{upscaleError&&<p className="export-error" role="alert">{t(upscaleError)}</p>}</>}
        <label className="field">
          <span>{t("文件格式")}</span>
          <select
            disabled={working}
            aria-label={t("导出格式")}
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          >
            {(kind === "image" ? pausedRootsImage||sourceBouncing?["png"]:["png", "jpg"] : ["mp4", "webm", "gif"]).map(
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
        {resolution==='custom'&&<><label className="field"><span>{t("宽度 · px")}</span><input aria-label={t("导出宽度")} disabled={working} type="number" min={16} max={kind==='video'?7680:16384} step={kind==='video'?2:1} value={customWidth} onChange={e=>setCustomWidth(Number(e.target.value))}/></label><label className="field"><span>{t("高度 · px")}</span><input aria-label={t("导出高度")} disabled={working} type="number" min={16} max={kind==='video'?4320:16384} step={kind==='video'?2:1} value={customHeight} onChange={e=>setCustomHeight(Number(e.target.value))}/></label>{dimensionError&&<p className="export-error" role="alert">{dimensionError}</p>}</>}
        {kind === "video" && (
          <>
            <label className="field">
              <span>{t(sourceFrames||rootsFrames?'编码帧率':'帧率')}</span>
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
            {sourceBouncing?<>
              <label className="field"><span>{t('弹跳录制起点')}</span><select aria-label={t('弹跳录制起点')} disabled={working} value={bouncingStart} onChange={event=>setBouncingStart(event.target.value as 'current'|'seed')}><option value="seed">{t('重建初始状态')}</option><option value="current">{t('当前状态（本地扩展）')}</option></select></label>
              <p className="muted" data-testid="source-bouncing-export-duration">{t('源录制时长（秒）')}：{scene.bouncingSource!.recordDuration}。{t('修改场景的源录制时长可改变停止条件。')}</p>
              <p className="muted">{t('重建初始状态会按当前场景配置生成粒子、恢复作者相机角度并将缩放重置为 1；当前状态选项保留已呈现的粒子与视角。两种方式均将录制时钟清零，先推进并绘制 1 帧预热但不编码，再录制到源时长阈值；帧率同时用于模拟时钟和视频编码。')}</p>
              {sourceVideoFrames!==null&&<p className="muted">{t('本次录制 {frames} 帧',{frames:sourceVideoFrames})}</p>}
            </>:sourceFrames||rootsFrames?<>
              {sourceFrames&&<label className="field"><span>{t('录制起点')}</span><select aria-label={t('录制起点')} disabled={working} value={recordingStart} onChange={event=>setRecordingStart(event.target.value as 'fresh'|'current')}><option value="fresh">{t('从初始状态')}</option><option value="current" disabled={currentSpirographFrame===undefined}>{t('从当前已呈现帧')}</option></select></label>}
              <label className="field"><span>{t('录制模拟帧率')}</span><input aria-label={t('录制模拟帧率')} disabled={working} type="number" min={1} max={120} step={1} value={recordingFps} onChange={event=>setRecordingFps(Number(event.target.value))}/></label>
              <p className="muted">{t(rootsFrames?'从初始状态重放；首帧用于预热。存在源队列时按队列结束停止；空队列等待本地样本提交完成。模拟帧率决定运动步长，编码帧率决定视频播放速度。':'按源队列结束时停止录制；首个已推进帧用于预热，不写入视频。模拟帧率决定运动步长，编码帧率决定视频播放速度。')}</p>
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
          {working ? (
            <button onClick={cancel}>{t("取消导出")}</button>
          ) : (
            <button onClick={onClose}>{t("关闭")}</button>
          )}
          <button
            className="primary-button"
            disabled={
              working || !!dimensionError || !!upscaleError || sourceBouncing&&!currentSourceBouncingFrame?.ready || pausedRootsImage&&!currentRootsCapture?.ready ||
              (kind === "video" &&
                (ffmpeg !== true || !Number.isSafeInteger(fps)||fps<1||fps>120||
                  (sourceFrames||rootsFrames)&&(!Number.isSafeInteger(recordingFps)||recordingFps<1||recordingFps>120||sourceFrames&&recordingStart==='current'&&currentSpirographFrame===undefined)||!sourceBouncing&&!sourceFrames&&!rootsFrames&&(!Number.isFinite(duration) ||
                  duration <= 0 ||
                  duration > 3600)))
            }
            onClick={run}
          >
            <Download size={15} />
            {working ? t("导出中…") : t("开始导出")}
          </button>
        </div>
      </section>
    </div>
  );
}
