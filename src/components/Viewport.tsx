import {sourceIteratedLiveKind} from '../engine/sourceLivePreview';
import type {SourceIteratedNavigationEvent} from '../engine/sourceIteratedNavigation';
import {usesSourceSamilaSplat} from '../engine/sourceSamilaSplat';
import {sourceQueuePresentedScene} from '../engine/sourceQueuePresentation';
import {sourceBouncingViewFromCamera,type SourceBouncingView,type SourceBouncingNavigationEvent} from '../engine/sourceBouncingNavigation';
import type {SourceBouncingCheckpoint} from '../engine/sourceBouncingReplay';
import {usesSourceBouncing} from '../engine/sourceBouncingDocument';
import {samilaCameraEnabled,SAMILA_CAMERA_NAVIGATION_NOTICE} from '../engine/samilaCamera';
import {captureSamilaViewport,navigateSamilaViewport,type SamilaViewportCommit} from '../engine/samilaViewport';
import {PresentedFrameOwner,applyPresentedCamera,type PresentedFrame} from '../engine/presentedFrame';
import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { sceneAtTime,timelineControlsTarget } from "../engine/timeline";
import {withSpirographReplayFrame} from '../engine/spirographFramePlan';
import {outputCamera,isRaymarchScene} from '../engine/sceneCamera';
import { ArtRenderer } from "../engine/renderer";
import type { SceneDocument, SceneOutput, CameraState, Settings } from "../types";
import type {RecordingFrame} from '../engine/realtimeRecorder';
import {useI18n} from '../i18n';
import {parseBulbCameraSettings} from '../engine/mandelbulb';
import {juliaSeedAtPointer} from '../engine/complexViewport';
import {hasMathematicalPlane,planeNavigation,panPlane,zoomPlane,fitPlane,rasterPresentationRect,type PlaneNavigation} from '../engine/planeNavigation';
import {usesRootsNativePresentation,navigateRootsPresentation,type RootsPresentationCommit} from '../engine/rootsPresentationAuthoring';
import type {RootsPresentationConfiguration} from '../engine/rootsPresentationConfig';
import type {ProjectResolution} from '../engine/projectResolution';
import {projectViewportFit} from '../engine/projectViewportFit';
export interface ViewportHandle {
  fit: () => void;
  camera: () => CameraState;
  frame:()=>RecordingFrame|null;
}
export const Viewport = forwardRef<
  ViewportHandle,
  {
    output: SceneOutput | null;
    scene: SceneDocument;
    outputScene?:SceneDocument|null;
    onPresented?:(frame:PresentedFrame|null)=>void;
    onRenderError?:(message:string)=>void;
    playing: boolean;
    renderPending?:boolean;
    /** App-owned final presentation eligibility, including cancel/error/time. */
    planeFrameReady?:boolean;
    time: number;
    pixelRatio?:number;
    onCamera?: (c: CameraState) => void;
    onSize?:(width:number,height:number,resolution?:ProjectResolution,pixelRatio?:number)=>void;
    onViewSettings?: (values:Settings)=>void;
    onSourceIteratedNavigate?:(expected:SceneDocument,sessionId:string,event:SourceIteratedNavigationEvent)=>boolean;
    sourceBouncingInteractionEpoch?:number;
    onSourceBouncingNavigate?:(expected:SceneDocument,view:SourceBouncingView,checkpoint:SourceBouncingCheckpoint,event:SourceBouncingNavigationEvent,begin:boolean,epoch:number)=>SourceBouncingView|undefined;
    onSamilaViewport?:SamilaViewportCommit;
    onRootsPresentation?:RootsPresentationCommit;
    pickingJulia?:boolean;
    onPickJulia?:(values:Settings)=>void;
  }
>(function Viewport({ output, scene, outputScene, onPresented,onRenderError,playing,renderPending,planeFrameReady, time, pixelRatio, onCamera, onSize, onViewSettings,onSourceIteratedNavigate,sourceBouncingInteractionEpoch,onSourceBouncingNavigate,onSamilaViewport,onRootsPresentation,pickingJulia,onPickJulia }, ref) {
  const {t}=useI18n();
  const [renderError,setRenderError]=useState('');
  const [navigationNotice,setNavigationNotice]=useState('');
  useEffect(()=>setNavigationNotice(''),[scene]);
  const sourceBouncing=usesSourceBouncing(scene);
  const bulb=isRaymarchScene(scene);
  const plane=hasMathematicalPlane(scene),managed=bulb||plane||sourceBouncing||!!sourceIteratedLiveKind(scene);
  const interaction=useRef({scene,playing,renderPending,planeFrameReady,bulb,plane,managed,onViewSettings,onSourceIteratedNavigate,sourceBouncingInteractionEpoch,onSourceBouncingNavigate,onSamilaViewport,onRootsPresentation,pickingJulia,onPickJulia});interaction.current={scene,playing,renderPending,planeFrameReady,bulb,plane,managed,onViewSettings,onSourceIteratedNavigate,sourceBouncingInteractionEpoch,onSourceBouncingNavigate,onSamilaViewport,onRootsPresentation,pickingJulia,onPickJulia};
  const canvas = useRef<HTMLCanvasElement>(null),
    renderer = useRef<ArtRenderer | null>(null),
    lastId = useRef("");
  const renderedScene=useRef<SceneDocument|null>(null),presented=useRef(new PresentedFrameOwner());
  const deliveredOutput=useRef<{source:SceneDocument;output:SceneOutput}|null>(null);
  const source=outputScene??scene;
  const presentationCallbacks=useRef({onPresented,onRenderError});presentationCallbacks.current={onPresented,onRenderError};
  function failed(error:unknown){const message=error instanceof Error?error.message:String(error);presented.current.clear();deliveredOutput.current=null;presentationCallbacks.current.onPresented?.(null);presentationCallbacks.current.onRenderError?.(message);setRenderError(message);}
  const callback = useRef(onCamera),sizeCallback=useRef(onSize),latestOutput=useRef(output);sizeCallback.current=onSize;latestOutput.current=output;
  const ratio=useRef(pixelRatio);ratio.current=pixelRatio;
  const resolution=useRef(scene.projectResolution);resolution.current=scene.projectResolution;
  const refit=useRef<(()=>void)|null>(null);
  callback.current = onCamera;
  function completedPlaneNavigation(){
    const current=interaction.current;
    if(current.playing||current.renderPending||current.planeFrameReady===false)return;
    const frame=presented.current.read(),delivered=deliveredOutput.current,evaluated=renderedScene.current;
    // Navigation consumes delivered rule facts and the evaluated scene; authored
    // edits waiting for a frame cannot reinterpret the previous image.
    if(!frame||!delivered||!evaluated||frame.source!==current.scene||delivered.source!==current.scene||delivered.output.type!=='raster')return;
    if((evaluated.kind==='fractal'?['centerX','centerY','centerXLow','centerYLow','zoom','rotation']:['centerX','centerY','scale']).some(key=>timelineControlsTarget(evaluated,'settings.'+key))){
      setNavigationNotice('视口由时间线控制；请先停用对应轨道，再调整视口。');return;
    }
    setNavigationNotice('');
    return{evaluated,output:delivered.output};
  }
  useImperativeHandle(ref, () => ({
    fit: () => {
      if(usesRootsNativePresentation(scene)||scene.sourceCamera||sourceBouncing)return;
      if(samilaCameraEnabled(scene)||output?.type==='raster'&&output.samilaView)return;
      const needsFrame=scene.kind==='domain'||scene.kind==='fractal'&&!bulb,completed=needsFrame?completedPlaneNavigation():undefined;
      if(needsFrame&&!completed)return;
      renderer.current?.fit();presented.current.appearance();
      if(bulb)onViewSettings?.({bulbCameraYaw:0,bulbCameraPitch:.78,zoom:1,bulbCameraRadius:3.2,bulbRayScale:3});else if(plane)onViewSettings?.(fitPlane(completed?.evaluated??scene,completed?.output.domainRender?.view));
    },
    camera: () => scene.sourceCamera||sourceBouncing?scene.camera:renderer.current?.cameraState() ?? scene.camera,
    frame:()=>{const frame=presented.current.read();return canvas.current&&frame?{canvas:canvas.current,...frame}:null;},
  }));
  useEffect(() => {
    let r:ArtRenderer;
    try{r=new ArtRenderer(canvas.current!);}catch(error){failed(error);return;}
    renderer.current = r;
    let available:{width:number;height:number}|undefined;
    const resize=()=>{
      if(!available)return;
      try{
        const configured=resolution.current,fit=projectViewportFit(configured,available.width,available.height),element=canvas.current!;
        if(configured){Object.assign(element.style,{width:fit.width+'px',height:fit.height+'px',left:fit.left+'px',top:fit.top+'px',right:'auto',bottom:'auto'});}
        else {for(const property of ['width','height','left','top','right','bottom'])element.style.removeProperty(property);}
        const width=Math.round(fit.width),height=Math.round(fit.height);
        const sourceCamera=!!interaction.current.scene.sourceCamera||usesSourceBouncing(interaction.current.scene)||usesSourceSamilaSplat(interaction.current.scene);
        r.setSize(sourceCamera?width:fit.width,sourceCamera?height:fit.height,ratio.current);presented.current.appearance();
        if(width>0&&height>0)sizeCallback.current?.(width,height,configured,r.renderer.getPixelRatio());
      }catch(error){failed(error);}
    };
    refit.current=resize;
    const ro = new ResizeObserver(([entry]) => {
      const {width,height}=entry.contentRect;if(width<=0||height<=0)return;
      available={width,height};resize();
    });
    ro.observe(canvas.current!.parentElement!);
    r.onCamera((c) => {if(!interaction.current.managed&&!interaction.current.scene.sourceCamera&&!usesSourceBouncing(interaction.current.scene)){const frame=presented.current.read();if(frame)presented.current.appearance({...frame.scene,camera:c});callback.current?.(c);}});
    return () => {
      ro.disconnect();
      refit.current=null;
      r.dispose();
      renderer.current = null;deliveredOutput.current=null;presented.current.clear();presentationCallbacks.current.onPresented?.(null);
    };
  }, []);
  useEffect(()=>{
    const element=canvas.current!;
    type SamilaCapture=ReturnType<typeof captureSamilaViewport>;
    type NavigationDrag={id:number;x:number;y:number;camera:{yaw:number;pitch:number}|PlaneNavigation;mode:'bulb'|'plane';scale:number};
    type SamilaDrag={id:number;x:number;y:number;mode:'samila';scale:number;width:number;height:number;view:SamilaCapture;expected:SceneDocument;began:boolean;lastX:number;lastY:number};
    type RootsDrag={id:number;x:number;y:number;mode:'roots';expected:SceneDocument;view:RootsPresentationConfiguration;began:boolean;width:number;height:number};
    type BouncingCapture={epoch:number;view:SourceBouncingView;expected:SceneDocument;checkpoint:SourceBouncingCheckpoint};
    type IteratedCapture={expected:SceneDocument;sessionId:string};
    type IteratedDrag=IteratedCapture&{id:number;x:number;y:number;mode:'iterated'};
    const captureIterated=():IteratedCapture|undefined=>{
      const current=interaction.current,frame=presented.current.read(),delivered=deliveredOutput.current;
      if(current.renderPending||current.planeFrameReady===false||frame?.source!==current.scene||delivered?.source!==current.scene||delivered.output.type!=='raster')return;
      const facts=delivered.output.mapLive??delivered.output.symmetryLive;
      if(!facts?.paused||!current.onSourceIteratedNavigate)return;return{expected:current.scene,sessionId:facts.sessionId};
    };
    let iteratedWheel:(IteratedCapture&{last:number})|undefined;
    type BouncingDrag=BouncingCapture&{id:number;x:number;y:number;mode:'bouncing';began:boolean};
    let drag:NavigationDrag|SamilaDrag|RootsDrag|BouncingDrag|IteratedDrag|undefined,revision=0;
    let bouncingWheel:(BouncingCapture&{last:number})|undefined;
    const captureBouncing=():BouncingCapture|undefined=>{
      const current=interaction.current,frame=presented.current.read(),delivered=deliveredOutput.current;
      if(current.renderPending||current.planeFrameReady===false||!frame||frame.source!==current.scene||delivered?.source!==current.scene||!delivered.output.sourceBouncingFrame)return;
      const facts=delivered.output.sourceBouncingFrame,view=sourceBouncingViewFromCamera(facts.camera);
      if(!view.ok)return;return{epoch:current.sourceBouncingInteractionEpoch??0,view:view.value,expected:current.scene,checkpoint:facts.checkpoint};
    };
    let wheelGesture:{expected:SceneDocument;view:SamilaCapture;last:number}|undefined;
    const active=()=>interaction.current.managed&&!interaction.current.playing&&(!interaction.current.scene.sourceCamera||!!sourceIteratedLiveKind(interaction.current.scene));
    const samila=()=>samilaCameraEnabled(interaction.current.scene);
    const hasDeliveredSamila=()=>deliveredOutput.current?.output.type==='raster'&&deliveredOutput.current.output.samilaView;
    const capture=()=>{
      const current=interaction.current,frame=presented.current.read(),delivered=deliveredOutput.current;
      if(!frame||!delivered||frame.source!==current.scene||delivered.source!==frame.source||delivered.output.type!=='raster')return;
      const out=delivered.output,view=captureSamilaViewport(current.scene,out);
      revision=Math.max(revision,current.scene.runtimeSamilaViewport?.revision??0);
      const rect=rasterPresentationRect(element.clientWidth,element.clientHeight,out.width,out.height);
      // Source drag is measured in logical screen dimensions; DPR never changes
      // NDC delta. Legacy gestures retain their original physical-to-CSS mapping.
      return view.projectionModel?{view,expected:current.scene,width:rect.width,height:rect.height,scale:1}:{view,expected:current.scene,width:out.width,height:out.height,scale:rect.scale};
    };
    const planeView=()=>{
      const current=interaction.current;
      if(current.scene.kind==='domain'||current.scene.kind==='fractal'){
        const navigation=completedPlaneNavigation();if(!navigation)return;
        const {evaluated,output}=navigation;
        return{view:planeNavigation(evaluated,output.width,output.height,output.density?.bounds,output.domainRender?.view,output.fractalRender?.view),rect:rasterPresentationRect(element.clientWidth,element.clientHeight,output.width,output.height)};
      }
      const output=latestOutput.current,width=output?.type==='raster'?output.width:element.clientWidth,height=output?.type==='raster'?output.height:element.clientHeight;
      return{view:planeNavigation(interaction.current.scene,width,height,output?.density?.bounds),rect:rasterPresentationRect(element.clientWidth,element.clientHeight,width,height)};
    };
    const down=(event:PointerEvent)=>{
      if(!active()||event.button!==0&&!usesSourceBouncing(interaction.current.scene)&&!sourceIteratedLiveKind(interaction.current.scene))return;
      try{const current=interaction.current;wheelGesture=undefined;bouncingWheel=undefined;iteratedWheel=undefined;
        if(sourceIteratedLiveKind(current.scene)){
          const captured=captureIterated();if(!captured)return;
          drag={...captured,id:event.pointerId,x:event.clientX,y:event.clientY,mode:'iterated'};
        }else if(usesSourceBouncing(current.scene)){
          const captured=captureBouncing();if(!captured||!current.onSourceBouncingNavigate)return;
          drag={...captured,id:event.pointerId,x:event.clientX,y:event.clientY,mode:'bouncing',began:false};
        }else if(usesRootsNativePresentation(current.scene)){
          const frame=presented.current.read();
          if(current.renderPending||frame?.source!==current.scene||!current.onRootsPresentation)return;
          drag={id:event.pointerId,x:event.clientX,y:event.clientY,mode:'roots',expected:current.scene,view:current.scene.rootsPresentation!,began:false,width:element.clientWidth,height:element.clientHeight};
        }else if(samila()){
          const captured=capture();if(!captured||!current.onSamilaViewport)return;
          drag={...captured,id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,mode:'samila',began:false};
        }else{
          if(hasDeliveredSamila())return;
          if(current.pickingJulia){const scene=renderedScene.current,output=latestOutput.current;if(!scene||output?.type!=='raster')return;const bounds=element.getBoundingClientRect(),rect=rasterPresentationRect(element.clientWidth,element.clientHeight,output.width,output.height),x=(event.clientX-bounds.left-rect.x)/rect.scale,y=(event.clientY-bounds.top-rect.y)/rect.scale;current.onPickJulia?.(juliaSeedAtPointer(scene.settings,x,y,output.width,output.height));event.preventDefault();return;}
          const plane=current.plane?planeView():undefined;if(current.plane&&!plane)return;
          const view=current.bulb?parseBulbCameraSettings(current.scene.settings):plane!.view;
          drag={id:event.pointerId,x:event.clientX,y:event.clientY,camera:view,mode:current.bulb?'bulb':'plane',scale:plane?.rect.scale??1};
        }
        element.setPointerCapture(event.pointerId);event.preventDefault();
      }catch(error){setRenderError(error instanceof Error?error.message:String(error));}
    };
    const move=(event:PointerEvent)=>{
      if(!active()){drag=undefined;return;}if(!drag||event.pointerId!==drag.id)return;
      try{
        if(drag.mode==='iterated'){
          const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(!dx&&!dy)return;
          if(!interaction.current.onSourceIteratedNavigate?.(drag.expected,drag.sessionId,{kind:'drag',dx,dy})){drag=undefined;return;}
          drag.x=event.clientX;drag.y=event.clientY;
        }else if(drag.mode==='bouncing'){
          const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(!dx&&!dy)return;
          const accepted=interaction.current.onSourceBouncingNavigate?.(drag.expected,drag.view,drag.checkpoint,{kind:'drag',dx,dy},!drag.began,drag.epoch);
          if(!accepted){drag=undefined;return;}drag.view=accepted;drag.x=event.clientX;drag.y=event.clientY;drag.began=true;
        }else if(drag.mode==='roots'){
          const next=navigateRootsPresentation(drag.view,{kind:'rotate',dx:event.clientX-drag.x,dy:event.clientY-drag.y,width:drag.width,height:drag.height});
          const accepted=interaction.current.onRootsPresentation?.(drag.expected,next,!drag.began);
          if(!accepted){drag=undefined;return;}drag.expected=accepted;drag.began=true;
        }else if(drag.mode==='samila'){
          if(!samila()||(event.clientX===drag.lastX&&event.clientY===drag.lastY))return;
          const next=navigateSamilaViewport(drag.view,{kind:'pan',dx:(event.clientX-drag.x)/drag.scale,dy:(event.clientY-drag.y)/drag.scale,width:drag.width,height:drag.height},++revision);
          const accepted=interaction.current.onSamilaViewport?.(drag.expected,next,!drag.began);
          if(!accepted){drag=undefined;return;}
          drag.expected=accepted;drag.began=true;drag.lastX=event.clientX;drag.lastY=event.clientY;
          // Native drag adds each event's float32 delta. Recomputing a total
          // displacement from pointerdown would discard that rounding history.
          if(drag.view.projectionModel){drag.view=next;drag.x=event.clientX;drag.y=event.clientY;}
        }else if(drag.mode==='plane')interaction.current.onViewSettings?.(panPlane(drag.camera as PlaneNavigation,(event.clientX-drag.x)/drag.scale,(event.clientY-drag.y)/drag.scale));
        else {const view=drag.camera as {yaw:number;pitch:number},width=Math.max(1,element.clientWidth),height=Math.max(1,element.clientHeight);interaction.current.onViewSettings?.({bulbCameraYaw:view.yaw-(event.clientX-drag.x)/width*2*Math.PI,bulbCameraPitch:Math.max(-1.55,Math.min(1.55,view.pitch+(event.clientY-drag.y)/height*Math.PI))});}
      }catch(error){setRenderError(error instanceof Error?error.message:String(error));}
    };
    const end=()=>{drag=undefined;};
    const wheel=(event:WheelEvent)=>{
      if(!active()){bouncingWheel=undefined;iteratedWheel=undefined;return;}if(drag?.mode==='samila'||drag?.mode==='bouncing'||drag?.mode==='iterated')return;event.preventDefault();
      try{
        const current=interaction.current,pixels=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?element.clientHeight:1);
        if(sourceIteratedLiveKind(current.scene)){
          if(!pixels)return;const now=performance.now(),captured=iteratedWheel&&now-iteratedWheel.last<250?iteratedWheel:captureIterated();if(!captured)return;
          // DOM line=one count; pixel=1/16 count. Keep every event's rounding.
          const accepted=current.onSourceIteratedNavigate?.(captured.expected,captured.sessionId,{kind:'wheel',count:pixels/16});
          iteratedWheel=accepted?{...captured,last:now}:undefined;
        }else if(usesSourceBouncing(current.scene)){
          if(!pixels)return;const now=performance.now(),continuing=!!bouncingWheel&&now-bouncingWheel.last<250;
          const captured=continuing?bouncingWheel:captureBouncing();if(!captured)return;
          // Local DOM mapping: a line is one count; pixel events use 16 px.
          // Native Processing receives integer counts, not browser deltas.
          const accepted=current.onSourceBouncingNavigate?.(captured.expected,captured.view,captured.checkpoint,{kind:'wheel',count:pixels/16},!continuing,captured.epoch);
          bouncingWheel=accepted?{...captured,view:accepted,last:now}:undefined;
        }else if(usesRootsNativePresentation(current.scene)){
          if(current.renderPending||presented.current.read()?.source!==current.scene||!pixels)return;
          const next=navigateRootsPresentation(current.scene.rootsPresentation!,{kind:'zoom',deltaPixels:pixels});
          current.onRootsPresentation?.(current.scene,next,true);
        }else if(samila()){
          if(!pixels)return;
          const now=performance.now(),continuing=wheelGesture&&now-wheelGesture.last<250;
          const captured=continuing?wheelGesture:capture();if(!captured)return;
          // A browser line is one local wheel count; pixel events use 16px per
          // count. The native platform's event granularity is not assumed equal.
          const next=navigateSamilaViewport(captured.view,{kind:'zoom',wheelCount:pixels/16},++revision);
          let accepted=current.onSamilaViewport?.(captured.expected,next,!continuing),view=next;
          // Undo or another edit may end an earlier wheel transaction. Start a
          // new one only from an already-delivered, matching current document.
          if(!accepted&&continuing){const fresh=capture();if(fresh){view=navigateSamilaViewport(fresh.view,{kind:'zoom',wheelCount:pixels/16},++revision);accepted=current.onSamilaViewport?.(fresh.expected,view,true);}}
          wheelGesture=accepted?{expected:accepted,view,last:now}:undefined;
        }else{
          if(hasDeliveredSamila())return;
          if(current.plane){const rect=element.getBoundingClientRect(),plane=planeView();if(!plane)return;current.onViewSettings?.(zoomPlane(plane.view,(event.clientX-rect.left-plane.rect.x)/plane.rect.scale,(event.clientY-rect.top-plane.rect.y)/plane.rect.scale,pixels));}
          else {const view=parseBulbCameraSettings(current.scene.settings);current.onViewSettings?.({zoom:Math.max(.05,Math.min(12,view.zoom*Math.exp(-pixels*.001)))});}
        }
      }catch(error){setRenderError(error instanceof Error?error.message:String(error));}
    };
    const contextMenu=(event:MouseEvent)=>{if(usesSourceBouncing(interaction.current.scene)||sourceIteratedLiveKind(interaction.current.scene))event.preventDefault();};
    element.addEventListener('contextmenu',contextMenu);
    element.addEventListener('pointerdown',down);element.addEventListener('pointermove',move);element.addEventListener('pointerup',end);element.addEventListener('pointercancel',end);element.addEventListener('lostpointercapture',end);element.addEventListener('wheel',wheel,{passive:false});
    return()=>{element.removeEventListener('contextmenu',contextMenu);element.removeEventListener('pointerdown',down);element.removeEventListener('pointermove',move);element.removeEventListener('pointerup',end);element.removeEventListener('pointercancel',end);element.removeEventListener('lostpointercapture',end);element.removeEventListener('wheel',wheel);};
  },[]);
  // Report every authored configuration change, even if its aspect is unchanged.
  // App binds a measurement to this exact pair before starting a new instance.
  useEffect(()=>{refit.current?.();},[pixelRatio,scene.projectResolution?.width,scene.projectResolution?.height,!!scene.sourceCamera,sourceBouncing,scene.settings.samilaSplatModel]);
  useEffect(() => {
    if (output&&renderer.current) {
      const changed = lastId.current !== source.id;
      const resolved=usesSourceBouncing(source)||hasMathematicalPlane(source)||isRaymarchScene(source);
      let frameScene:SceneDocument,view:ReturnType<typeof outputCamera>;
      const authoredCamera=!output.sourceBouncingFrame&&!output.sourceCameraFrame&&applyPresentedCamera(presented.current.read(),source,!!output.cameraFrame,resolved);
      try{frameScene=output.spirographFrame?withSpirographReplayFrame(source,output.spirographFrame):sourceQueuePresentedScene(source,output)??sceneAtTime(source,(output.type==='raster'?output.samilaView?.time:undefined)??output.sourceBouncingFrame?.checkpoint.sceneTime??output.sourceCameraFrame?.time??output.cameraFrame?.time??time);view=outputCamera(frameScene,output);renderer.current?.setOutput(output, frameScene, changed,{roll:resolved?0:view.roll,focalLength:resolved?35:view.focalLength,...(authoredCamera?{camera:view.camera}:{})});setRenderError('');}catch(error){failed(error);return;}
      renderer.current.setInteractive(!playing&&!managed&&!sourceBouncing);
      renderedScene.current=frameScene;
      lastId.current = source.id;
      deliveredOutput.current={source,output};
      presented.current.present(source,output.sourceCameraFrame?{...frameScene,evaluatedSourceCamera:output.sourceCameraFrame}:{...frameScene,camera:renderer.current.cameraState()},(output.type==='raster'?output.samilaView?.time:undefined)??output.sourceBouncingFrame?.checkpoint.sceneTime??output.sourceCameraFrame?.time??output.cameraFrame?.time??time);
      presentationCallbacks.current.onPresented?.(presented.current.read());
    }
    else {deliveredOutput.current=null;presented.current.clear();presentationCallbacks.current.onPresented?.(null);}
  }, [output, source, time]);
  useEffect(() => {
    renderer.current?.setInteractive(!playing&&!managed&&!sourceBouncing);
  }, [playing,managed,sourceBouncing]);
  return (
    <><canvas
      ref={canvas}
      className="art-canvas"
      style={pickingJulia?{cursor:'crosshair'}:undefined}
      aria-label={t("数学艺术画布")}
      data-testid="art-canvas"
    />{sourceBouncing&&<div className="viewport-note" role="status">{t("暂停时可拖动旋转、滚轮缩放；恢复播放会还原旋转角度，保留缩放。")}</div>}{scene.sourceCamera&&<div className="viewport-note" role="status">{t(sourceIteratedLiveKind(scene)?scene.kind==='map'&&scene.mapSource?.construction.dimension===2?"暂停时拖动平移、滚轮缩放；恢复播放保留平移和缩放。":"暂停时拖动旋转、滚轮缩放；恢复播放还原旋转角度、保留缩放。":"当前使用原版相机，请在右侧相机面板或时间线调整视角。")}</div>}{(samilaCameraEnabled(scene)||output?.type==='raster'&&output.samilaView)&&<div className="viewport-note" role="status">{t(SAMILA_CAMERA_NAVIGATION_NOTICE)}</div>}{navigationNotice&&<div className="viewport-note" role="status">{t(navigationNotice)}</div>}{renderError&&<div className="error-card" role="alert"><strong>{t('画布无法显示')}</strong><p>{t(renderError)}</p><small>{t('请检查浏览器的图形加速是否可用，再重新加载页面。场景数据仍保留在本地。')}</small></div>}</>
  );
});
