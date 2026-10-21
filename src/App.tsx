import {sourceSamilaApplyIdentity} from './engine/sourceSamilaIdentity';
import {usesSourceSamilaSampling} from './engine/sourceSamilaSampling';
import {SourceSamilaPaletteEditor} from './components/SourceSamilaPaletteEditor';
import {usesSourceSamilaSplat} from './engine/sourceSamilaSplat';
import {usesSourceSamilaPresentation} from './engine/sourceSamilaPresentation';
import {usesSamilaSourceProjection} from './engine/samilaProjection';
import {SourcePerlinCpuControls} from './components/SourcePerlinCpuControls';
import {sourcePerlinPreviewViewport} from './engine/sourcePerlinViewport';
import {usesSourcePerlin,usesSourcePerlinCpu} from './engine/sourcePerlinIdentity';
import {SourcePerlinGpuControls} from './components/SourcePerlinGpuControls';
import {usesSourcePerlinGpu} from './engine/sourcePerlinIdentity';
import {SourcePerlinBackendControls} from './components/SourcePerlinBackendControls';
import {initialSourceBouncingNavigation,setSourceBouncingPaused,editSourceBouncingAngles,navigateSourceBouncing,sourceBouncingViewMatches,sourceBouncingViewsEqual,type SourceBouncingNavigationState} from './engine/sourceBouncingNavigation';
import {SourceBouncingControls} from './components/SourceBouncingControls';
import {SourceBouncingTransport} from './components/SourceBouncingTransport';
import {usesSourceBouncing,sourceBouncingInitializationKey,prepareSourceBouncingScene} from './engine/sourceBouncingDocument';
import {sourceBouncingSeedCheckpoint,stepSourceBouncingRealtime,planSourceBouncingFixedReplay,type SourceBouncingCheckpoint} from './engine/sourceBouncingReplay';
import {SourceAttractorControls,SourceAttractorBackground} from './components/SourceAttractorControls';
import {SourceAttractorPaletteEditor} from './components/SourceAttractorPaletteEditor';
import {usesSourceAttractor,prepareSourceAttractorScene} from './engine/sourceAttractorDocument';
import {SourceSurfaceControls} from './components/SourceSurfaceControls';
import {usesSourceSurfaceGeometry,usesSourceSurfaceHost,usesSourceSurfaceParticles} from './engine/sourceSurfaceIdentity';
import {prepareSourceSurfaceScene} from './engine/sourceSurfaceScene';
import {SourceSurfacePaletteEditor} from './components/SourceSurfacePaletteEditor';
import {ordinarySourceViewport,ordinarySourceCameraInitial} from './engine/ordinarySourceCamera';
import {prepareSourceSurfaceParticles} from './engine/sourceSurfaceParticles';
import {OrdinarySourceCameraControls} from './components/OrdinarySourceCameraControls';
import {version as appVersion} from '../package.json';
import {TextPrompt,type TextPromptRequest} from "./components/TextPrompt";
import {ArtworkLibrary} from './components/ArtworkLibrary';
import {ProjectResolutionControls} from './components/ProjectResolutionControls';
import {sameProjectResolution,type ProjectResolution} from './engine/projectResolution';
import {GeometryColorControls} from './components/GeometryColorControls';
import {hasGeometryColorOverride} from './engine/geometryColor';
import {artworkLocation,artworkIsTrashed,emptyLibrary,moveArtwork,touchArtwork,type ArtworkLibrary as Library} from './engine/library';
import {hasMathematicalPlane} from "./engine/planeNavigation";
import {EquationEditor} from "./components/EquationEditor";
import {changeMapDimension} from './engine/mapDimension';
import {reconcileEquationDraft} from './engine/equationEditor';
import {BouncingPolygonEditor} from './components/BouncingPolygonEditor';
import {PerlinPresetControls} from './components/PerlinPresetControls';
import {ParameterEditor} from './components/ParameterEditor';
import {matchingPerlinPreset} from './engine/perlinPreset';
import {densityToneControlSettings,initializeNormalizedDensity} from './engine/densityNormalization';
import {initializeSamilaTone,samilaToneControlSettings} from './engine/samilaTone';
import {selectSamilaHistoryModel} from './engine/samilaHistory';
import {commitSamilaViewport,retainSamilaViewportOnSave} from './engine/samilaViewport';
import {initializeSamilaCamera,samilaCameraEnabled,samilaCameraControls,SAMILA_CAMERA_MODEL} from './engine/samilaCamera';
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Atom,
  AudioLines,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  Command,
  Copy,
  Download,
  Expand,
  Eye,
  FileDown,
  FolderOpen,
  Grid2X2,
  HelpCircle,
  Image,
  Layers,
  Maximize,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import type {
  SceneDocument,
  SceneKind,
  SceneOutput,
  CameraState,
} from "./types";
import { definition } from "./scenes";
import {creationDefinitions,defaultCreationTemplate,isCreationKind} from './scenes/releaseCatalog';
import {
  createScene,
  parseScene,
  serializeScene,
  loadWorkspace,
  saveWorkspace,
} from "./engine/document";
import {scenePlaybackTime,playbackAnchor} from './engine/scenePlayback';
import {resolveTimeline} from './engine/timeline';
import {bouncingExperience,continuousBouncing,bouncingCanvasControl,bouncingControlSettings,sceneRecordingDuration} from './engine/bouncingExperience';
import { parameterNameError } from './engine/expression';
import {supportsGenericParameters,genericParameterNotice} from './engine/sceneParameters';
import { Generator } from "./engine/client";
import {GenerationQueue} from "./engine/generationQueue";
import {isMeshMaterialControlVisible,meshAppearanceControlSettings} from './engine/meshAppearance';
import {DEFAULT_RENDER_PREFERENCES,previewProfile,previewDimensions,type RenderPreferences} from './engine/preferences';
import {visiblePerlinControls} from "./scenes/perlin";
import {visibleBouncingControls} from './scenes/bouncing';
import {visibleIteratedControls} from './scenes/iteratedDensity';
import {domainControlSettings,visibleDomainControls} from './engine/domainModel';
import {visibleRootsControls,rootsControlSettings,rootsAppearanceControlVisible} from './engine/rootsControls';
import {rootsSourceColorRgbHex,usesRootsSourceDensity} from './engine/rootsDensityColor';
import {RootsDensityColorControls,RootsSourcePaletteEditor} from './components/RootsDensityColorControls';
import {visibleAttractorControls} from './engine/attractorControls';
import {rootsCompletionTime,rootsSchedule} from './scenes/rootsDensity';
import {readyPlaybackStep} from './engine/previewPlayback';
import {parseTrailAppearance} from './engine/trailAppearance';
import {SymmetryFormula} from './components/SymmetryFormula';
import {withSymmetryTemplate,symmetryAuthoringControls} from './engine/symmetryEditing';
import {hasSymmetryCustom,symmetryCustomParameterNameError} from './engine/symmetryCustom';
import {hasContinuousDensity,hasProgressiveRoots} from './engine/sceneCamera';
import {FractalControls} from './components/FractalControls';
import {FractalSourcePaletteEditor} from './components/FractalSourceColorControls';
import {usesFractalSourceColor} from './engine/fractalSourceColorAuthoring';
import { PaletteEditor } from "./components/PaletteEditor";
import {DomainColorControls,DomainSourcePaletteEditor} from './components/DomainColorControls';
import {parseDomainColorVersion} from './engine/domainSourceColor';
import {withDomainRenderPolicy} from './engine/domainAuthoring';
import {parseDomainRenderPolicy} from './engine/domainRenderPolicy';
import { Viewport, type ViewportHandle } from "./components/Viewport";
import { SettingsFields, Control } from "./components/Fields";
import { Timeline } from "./components/Timeline";
import { ExportDialog } from "./components/ExportDialog";
import { ExplorePanel } from './components/ExplorePanel';
import { SpirographEditor } from './components/SpirographEditor';
import {spirographAuthoringControls} from './engine/spirographAuthoring';
import { FormulaEditor } from './components/FormulaEditor';
import { FormulaOverlay } from './components/FormulaOverlay';
import { SurfaceTopology } from './components/SurfaceTopology';
import {SceneName} from './components/SceneName';
import {DesktopSettings} from './components/DesktopSettings';
import {RootsParameterEditor} from './components/RootsParameterEditor';
import {RootsMathControls} from './components/RootsMathControls';
import {RootsPresentationControls} from './components/RootsPresentationControls';
import {usesRootsNativePresentation,rootsPresentationControlVisible} from './engine/rootsPresentationAuthoring';
import {usesRootsCameraTimeline} from './engine/rootsCameraTimeline';
import {rootMathControlVisible,usesRootsNativeMath} from './engine/rootsMathConfig';
import {RecordDialog} from './components/RecordDialog';
import {I18nProvider,translate,type Language} from './i18n';
const icons: Record<SceneKind, typeof Activity> = {
  surface: Layers,
  attractor: Activity,
  map: Atom,
  implicit: Box,
  fractal: Sparkles,
  domain: CircleDot,
  symmetry: Sun,
  perlin: AudioLines,
  spirograph: Circle,
  bouncing: CircleDot,
  samila: WandSparkles,
  roots: Atom,
};
const initial = () => {
  try {
    return loadWorkspace(localStorage);
  } catch (error) {
    return { scenes: [], active: '', theme: 'dark' as const, language: 'zh' as const, startupError: `本地工作区读取失败，原始数据已保留：${String(error)}` };
  }
};
export default function App() {
  const [restored] = useState(initial);
  const [language,setLanguage]=useState<Language>(restored?.language??'zh');
  const t=(text:string,values?:Record<string,string|number>)=>translate(language,text,values);
  const [scene, setSceneState] = useState<SceneDocument>(
    () =>
      restored?.drafts?.[restored.active] ?? restored?.scenes.find((s) => s.id === restored.active) ??
      createScene(defaultCreationTemplate.definition, defaultCreationTemplate.preset),
  );
  const [saved, setSaved] = useState<SceneDocument[]>(restored?.scenes ?? []),
    [library,setLibrary]=useState<Library>(restored?.library??emptyLibrary()),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState<
      SceneKind | "all" | "saved" | "favorites"
    >("all");
  const [bouncingCheckpoint,setBouncingCheckpoint]=useState(sourceBouncingSeedCheckpoint);
  const [bouncingGestureEpoch,setBouncingGestureEpoch]=useState(0);
  const [bouncingNavigation,setBouncingNavigationState]=useState(()=>{
    const result=initialSourceBouncingNavigation(scene.bouncingSource?.camera??{phi:0,theta:0,gamma:0});
    if(!result.ok)throw new Error(result.error.reason);return result.value;
  });
  const [output, setOutput] = useState<SceneOutput | null>(null),
    [outputScene,setOutputScene]=useState<SceneDocument|null>(null),
    [presentedSource,setPresentedSource]=useState<SceneDocument|null>(null),
    [presentedOutput,setPresentedOutput]=useState<SceneOutput|null>(null),
    [generationActive,setGenerationActive]=useState(false),
    [busy, setBusy] = useState(false),
    [previewCancelled,setPreviewCancelled] = useState(false),
    [generationRevision,setGenerationRevision] = useState(0),
    [samilaTickRevision,setSamilaTickRevision] = useState(0),
    [renderTime,setRenderTime]=useState(0),
    [error, setError] = useState(""),
    [playhead, setPlayhead] = useState(0),
    [finalPreview, setFinalPreview] = useState(scene.kind==='spirograph'),
    [playing, setPlaying] = useState(false),
    [toast, setToast] = useState(restored?.startupError ?? (restored?.recovered ? t("已从上一次有效备份恢复工作区；损坏数据已保留。") : '')),
    [exporting, setExporting] = useState(false),
    [recording,setRecording]=useState(false),
    [tab, setTab] = useState<"geometry" | "appearance">("geometry");
  const [theme, setTheme] = useState<"dark" | "light">(
      restored?.theme ?? "dark",
    ),
    [showSettings, setShowSettings] = useState(false),
    [renderPreferences,setRenderPreferences]=useState<RenderPreferences>(restored?.render??DEFAULT_RENDER_PREFERENCES),
    [sidebar, setSidebar] = useState(true),
    [inspector, setInspector] = useState(true),
    [newMenu, setNewMenu] = useState(false),
    [inputDialog,setInputDialog]=useState<TextPromptRequest|null>(null),
    [cameraRevision, setCameraRevision] = useState(0),
    [viewportMeasurement,setViewportMeasurement]=useState<{size:[number,number];resolution?:ProjectResolution;pixelRatio:number}|null>(null),
    [pickingJulia,setPickingJulia]=useState(false),
    [formulaDraft, setFormulaDraft] = useState(scene.equations);
  // Selection previews the resolved endpoint without changing the authored
  // document. Geometry edits can move that endpoint; manual transport leaves
  // preview mode and owns its own playhead from then on.
  const finalPreviewTime=useMemo(()=>{
    if(!finalPreview)return null;
    try{return resolveTimeline(scene).duration;}
    catch{return null;} // Timeline displays the schedule error; allow repair.
  },[scene,finalPreview]);
  const time=finalPreviewTime??playhead;
  function setTime(value:number){setFinalPreview(false);setPlayhead(value);}
  const viewport = useRef<ViewportHandle>(null),
    generationQueue=useRef<GenerationQueue|null>(null),
    generationScene=useRef<SceneDocument|null>(null),
    generationPending=useRef(false),
    bouncingFrame=useRef(bouncingCheckpoint),
    bouncingGestureEpochRef=useRef(0),
    bouncingNavigationRef=useRef(bouncingNavigation),
    bouncingLastFrameAt=useRef<number|undefined>(undefined),
    bouncingPresented=useRef(false),
    file = useRef<HTMLInputElement>(null),
    camera = useRef<CameraState>(scene.camera),
    sceneRef = useRef(scene),
    timeRef = useRef(time),
    playingRef = useRef(playing),
    history = useRef<SceneDocument[]>([]),
    future = useRef<SceneDocument[]>([]),
    playbackClock = useRef(0),
    playbackStartedAt = useRef<number|undefined>(undefined),
    autoPlayPending = useRef(continuousBouncing(scene)),
    drafts = useRef<Record<string,SceneDocument>>(restored?.drafts??Object.create(null)),
    persistWorkspace = useRef<()=>void>(()=>{}),
    cameraTimer = useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  sceneRef.current = scene;
  timeRef.current = time;
  playingRef.current = playing;
  // Event handlers and worker callbacks share one current document boundary,
  // including multiple inputs queued before React commits its next render.
  function retireBouncingGesture(){
    bouncingGestureEpochRef.current++;setBouncingGestureEpoch(bouncingGestureEpochRef.current);
  }
  function setBouncingNavigation(next:SourceBouncingNavigationState){
    const previous=bouncingNavigationRef.current;
    // Keep one view identity for equal facts so pause alone does not redraw.
    if(sourceBouncingViewsEqual(previous.view,next.view))next={...next,view:previous.view};
    else {bouncingPresented.current=false;generationPending.current=true;}
    bouncingNavigationRef.current=next;setBouncingNavigationState(next);
  }
  function interruptSourceBouncingInteraction(){
    if(!usesSourceBouncing(sceneRef.current))return;
    retireBouncingGesture();playingRef.current=false;setPlaying(false);bouncingPresented.current=false;
    setBouncingNavigation(setSourceBouncingPaused(bouncingNavigationRef.current,true));
  }
  function resetBouncingNavigation(next:SceneDocument){
    retireBouncingGesture();
    const result=initialSourceBouncingNavigation(next.bouncingSource!.camera);
    if(!result.ok)throw new Error(result.error.reason);setBouncingNavigation(result.value);
  }
  function showBouncingCheckpoint(checkpoint:SourceBouncingCheckpoint){
    bouncingFrame.current=checkpoint;setBouncingCheckpoint(checkpoint);
    bouncingPresented.current=false;timeRef.current=checkpoint.sceneTime;setTime(checkpoint.sceneTime);
  }
  function setScene(value:SceneDocument|((current:SceneDocument)=>SceneDocument)) {
    const current=sceneRef.current,next=typeof value==='function'?value(current):value;
    if(usesSourceSamilaSampling(current)&&usesSourceSamilaSampling(next)&&sourceSamilaApplyIdentity(current)!==sourceSamilaApplyIdentity(next))restartSamila();
    if(usesSourceBouncing(next)){
      bouncingPresented.current=false;
      if(!usesSourceBouncing(current)||sourceBouncingInitializationKey(current.bouncingSource!.configuration)!==sourceBouncingInitializationKey(next.bouncingSource!.configuration)){
        playingRef.current=false;setPlaying(false);autoPlayPending.current=false;
        showBouncingCheckpoint(sourceBouncingSeedCheckpoint());bouncingLastFrameAt.current=undefined;resetBouncingNavigation(next);
      }else if((['phi','theta','gamma'] as const).some(key=>!Object.is(current.bouncingSource!.camera[key],next.bouncingSource!.camera[key]))){
        const edited=editSourceBouncingAngles(bouncingNavigationRef.current,next.bouncingSource!.camera);if(!edited.ok)throw new Error(edited.error.reason);setBouncingNavigation(edited.value);
      }
    }
    if(!sameProjectResolution(current.projectResolution,next.projectResolution)){
      // ProjectState render dimensions recreate the sketch. This differs from
      // fitting the existing canvas after a host window resize, which stays hot.
      // Reuse the existing resume-after-presentation barrier. An old RAF must
      // not advance time while the new host measurement is still pending.
      autoPlayPending.current=autoPlayPending.current||playingRef.current;
      playingRef.current=false;setPlaying(false);
      generationQueue.current?.cancel();rootsSessionId.current=crypto.randomUUID();replaceSamilaSession();
      playbackClock.current=0;timeRef.current=0;setPlayhead(0);
      if(usesSourceBouncing(next)){showBouncingCheckpoint(sourceBouncingSeedCheckpoint());bouncingLastFrameAt.current=undefined;resetBouncingNavigation(next);}
      setOutput(null);setOutputScene(null);setPresentedSource(null);setPresentedOutput(null);
      setPreviewCancelled(false);
    }
    sceneRef.current=next;setSceneState(next);
  }
  // Bind measured host dimensions to the authored resolution that produced
  // them. A new aspect must not consume its first samples at the old size.
  const viewportSize=viewportMeasurement&&sameProjectResolution(viewportMeasurement.resolution,scene.projectResolution)?viewportMeasurement.size:null;
  const libraryDrafts=useMemo(()=>Object.values({...drafts.current,[scene.id]:scene}),[scene,saved]);
  const def = definition(scene.kind),
    Icon = icons[scene.kind];
  const experience=bouncingExperience(scene),sourceBouncing=usesSourceBouncing(scene);
  const samilaSourceProjection=usesSamilaSourceProjection(scene),samilaCameraActive=samilaCameraEnabled(scene),samilaNavigationLocked=samilaCameraActive||!!(output?.type==='raster'&&output.samilaView);
  const equationBasis=useRef({id:scene.id,equations:scene.equations});
  const perlinPreset=useMemo(()=>matchingPerlinPreset(scene,def),[scene,def]);
  let rootCompletion:number|undefined,rootSamplingFps:number|undefined,rootScheduleError='';
  if(hasProgressiveRoots(scene))try{
    rootCompletion=rootsCompletionTime(scene.settings,scene.rootsMath);
    // Pending splats belong to display frames. Stepping by a different sample
    // FPS would request extra same-frame redraws and consume extra budgets.
    rootSamplingFps=scene.rootsPresentation?.pending&&usesRootsCameraTimeline(scene)?scene.timeline.fps:rootsSchedule(scene.settings,scene.rootsMath).fps;
  }catch(error){rootScheduleError=error instanceof Error?error.message:String(error);}
  function notify(message: string) {
    setToast(t(message));
  }
  const rootsSessionId=useRef(crypto.randomUUID());
  const samilaSessionId=useRef(crypto.randomUUID()),samilaDirtyRevision=useRef(0),samilaDisplayRequested=useRef(false),samilaLastFrameAt=useRef<number|undefined>(undefined),samilaPlaybackTransition=useRef<object|undefined>(undefined);
  function replaceSamilaSession(){samilaSessionId.current=crypto.randomUUID();samilaDirtyRevision.current=0;samilaPlaybackTransition.current=undefined;samilaLastFrameAt.current=undefined;}
  function interruptSamilaPlayback(){
    if(!usesSourceSamilaSampling(sceneRef.current))return;
    playingRef.current=false;setPlaying(false);replaceSamilaSession();
    // A failed/cancelled live clock is no longer a retained ink session. Retry
    // uses the visible playhead as an explicit local reconstruction start.
    generationQueue.current?.cancel();setPreviewCancelled(true);
  }
  function restartSamila(){if(usesSourceSamilaSampling(sceneRef.current)){replaceSamilaSession();playbackClock.current=0;timeRef.current=0;setTime(0);}}
  function dirtySamila(){if(usesSourceSamilaSampling(sceneRef.current))samilaDirtyRevision.current++;}
  function edit(next: SceneDocument, samilaDirty=false, samilaDisplay=true) {
    if(usesSourceBouncing(next)){const parsed=prepareSourceBouncingScene(next);if(!parsed.ok){notify(parsed.error.reason);return;}}
    if(next.sourceCamera)try{ordinarySourceCameraInitial(next);if(usesSourceSurfaceParticles(next))prepareSourceSurfaceParticles(next);if(usesSourceSurfaceHost(next))prepareSourceSurfaceScene(next);if(usesSourceAttractor(next))prepareSourceAttractorScene(next);}catch(error){notify(error instanceof Error?error.message:String(error));return;}
    if(samilaDisplay&&usesSourceSamilaSampling(next))samilaDisplayRequested.current=true;
    if(samilaDirty)dirtySamila();
    history.current.push(sceneRef.current);
    if (history.current.length > 40) history.current.shift();
    future.current=[];
    setScene(next);
  }
  function retryDomainGpu(){
    if(sceneRef.current.kind!=='domain'||playingRef.current||recording)return;
    generationQueue.current?.cancel();setPreviewCancelled(false);setError('');
    if(parseDomainRenderPolicy(sceneRef.current.settings.domainRenderPolicy)==='source-cpu-always-v1')edit(withDomainRenderPolicy(sceneRef.current,'source-cpu-on-gpu-failure-v1'));
    setGenerationRevision(value=>value+1);
  }
  function changeSetting(key: string, value: number | string | boolean) {
    try {
      if(scene.kind==='map'&&key==='dimension'){const next=changeMapDimension(scene,value);if(next!==scene)edit(next);return;}
      if(scene.kind==='symmetry'&&key==='template'){edit(withSymmetryTemplate(scene,value));return;}
      if(scene.kind==='bouncing'&&key==='bouncingPlaybackModel'){setPlaying(false);playbackClock.current=playbackAnchor(timeRef.current);autoPlayPending.current=value==='continuous-v2';}
      const settings=scene.kind==='samila'&&key==='samilaHistoryModel'
        ?selectSamilaHistoryModel(scene.settings,value)
        :{...scene.settings,[key]:value};
      edit({...scene,settings},usesSourceSamilaSampling(scene)&&['rotation','scaleX','scaleY','offsetX','offsetY'].includes(key));
    } catch(error) {setToast(error instanceof Error?error.message:String(error));}
  }
  function workingDocument(item: SceneDocument): SceneDocument {
    const current=sceneRef.current;
    return current.id===item.id?{...current,camera:camera.current}:drafts.current[item.id]??item;
  }
  function load(next: SceneDocument, source: 'library' | 'document') {
    showBouncingCheckpoint(sourceBouncingSeedCheckpoint());bouncingLastFrameAt.current=undefined;
    rootsSessionId.current=crypto.randomUUID();replaceSamilaSession();
    // A file/new document is a new renderer instance even when its saved id
    // matches the open work. Ordinary edits retain the current failure latch.
    if(source==='document'){generationQueue.current?.cancel();setPreviewCancelled(false);}
    setPickingJulia(false);
    const current=sceneRef.current;
    drafts.current[current.id]=workingDocument(current);
    clearTimeout(cameraTimer.current);
    // Library navigation resumes work; an explicit file or new document owns
    // its contents even when its identity matches an existing draft.
    if(source==='library')next=workingDocument(next);
    if(usesSourceBouncing(next))resetBouncingNavigation(next);
    autoPlayPending.current=continuousBouncing(next);
    playingRef.current=false;
    setPlaying(false);
    setTime(0);
    playbackClock.current=0;
    history.current=[];
    future.current=[];
    setScene(structuredClone(next));
    setFinalPreview(next.kind==='spirograph');
    setFormulaDraft(next.equations);
    setError("");
    camera.current = next.camera;
  }
  function save(favorite?: boolean) {
    try {
    const builtin=def.presets.some(p=>scene.id===`preset:${def.kind}:${p.id}`);
    const item = parseScene(serializeScene({ ...scene,id:builtin?crypto.randomUUID():scene.id,favorite:favorite??scene.favorite,camera:{...camera.current,autoFit:false} }));
    if(builtin)drafts.current[scene.id]=scene;
    setScene(retainSamilaViewportOnSave(scene,item));camera.current=item.camera;
    setSaved((current) => {
      const others = current.filter((s) => s.id !== item.id);
      return [...others, item];
    });
    setLibrary(current=>touchArtwork(current,item.id));
    notify(favorite===undefined?t("场景已保存到「我的作品」"):favorite?t("已保存并收藏场景"):t("已取消收藏"));
    } catch(error) {notify(t("场景保存失败：{value0}",{value0:error instanceof Error?error.message:String(error)}));}
  }
  function validateName(name:string){return !name.trim()||name.length>300?"场景名称需为 1–300 个字符":undefined;}
  function renameScene(name:string){
    const value=name.trim();if(!value||value.length>300){notify(t("场景名称需为 1–300 个字符"));return;}
    edit({...scene,name:value},false,false);
    setSaved(current=>current.map(item=>item.id===scene.id?{...item,name:value}:item));
    if(saved.some(item=>item.id===scene.id))setLibrary(current=>touchArtwork(current,scene.id));
  }
  function changeArtworkMetadata(item:SceneDocument,values:Partial<Pick<SceneDocument,'name'|'favorite'>>){
    setSaved(current=>current.map(doc=>doc.id===item.id?{...doc,...values}:doc));
    if(drafts.current[item.id])drafts.current[item.id]={...drafts.current[item.id],...values};
    if(sceneRef.current.id===item.id)edit({...workingDocument(item),...values},false,false);
    setLibrary(current=>touchArtwork(current,item.id));
  }
  function createArtwork(kind:SceneKind,folderId:string|null){
    const model=definition(kind);
    setInputDialog({title:'新建场景',label:'新场景名称',initial:language==='en'?model.englishName:model.name,validate:validateName,submit:name=>{
      const item={...createScene(model),name};setSaved(current=>[...current,item]);setLibrary(current=>moveArtwork(current,item.id,folderId));load(item,'document');
    }});
  }
  function duplicateArtwork(item:SceneDocument){
    const current=workingDocument(item);
    const copy={...structuredClone(current),id:crypto.randomUUID(),name:current.name+t(' 副本')};
    setSaved(current=>[...current,copy]);setLibrary(current=>moveArtwork(current,copy.id,artworkLocation(current,item.id)?.folderId??null));load(copy,'document');
  }
  function duplicate() {
    const current=workingDocument(sceneRef.current);
    load({
      ...structuredClone(current),
      id: crypto.randomUUID(),
      name: current.name + t(" 副本"),
    },'document');
    notify(t("已创建独立副本"));
  }
  function undo() {
    const prev = history.current.pop();
    if (prev) {
      future.current.push(sceneRef.current);
      setScene(prev);
      notify(t("已撤销"));
    }
  }
  function redo() {
    const next=future.current.pop();
    if(next){history.current.push(sceneRef.current);setScene(next);notify(t("已重做"));}
  }
  function seekBouncingUpdates(updates:number){
    retireBouncingGesture();
    const planned=planSourceBouncingFixedReplay({updates,fps:sceneRef.current.timeline.fps});
    if(!planned.ok){setError(planned.error.reason);return;}
    playingRef.current=false;setPlaying(false);autoPlayPending.current=false;
    setBouncingNavigation(setSourceBouncingPaused(bouncingNavigationRef.current,true));
    setError('');generationPending.current=true;showBouncingCheckpoint(planned.value.checkpoint);
    // Same-index retry must still trigger a request after cancellation/error.
    setGenerationRevision(value=>value+1);
  }
  function seek(value:number) {
    if(usesSourceSamilaSampling(sceneRef.current)){replaceSamilaSession();setGenerationRevision(n=>n+1);}
    autoPlayPending.current=false;
    playbackClock.current=value;
    setTime(value);
  }
  function play(value:boolean) {
    if(value&&experience.error){setToast(t(experience.error));return;}
    autoPlayPending.current=false;
    if(usesSourceSamilaSampling(sceneRef.current)){
      if(samilaPlaybackTransition.current)return;
      const queue=generationQueue.current;if(!queue)return;
      const ticket={},sessionId=samilaSessionId.current;samilaPlaybackTransition.current=ticket;
      // Stop scheduling immediately; a running display completes before the
      // queue acknowledges pause. Resume starts scheduling only after its ack.
      playingRef.current=false;setPlaying(false);
      void queue.setSamilaPaused(!value).then(()=>{
        if(samilaPlaybackTransition.current!==ticket||samilaSessionId.current!==sessionId)return;
        samilaLastFrameAt.current=undefined;playingRef.current=value;setPlaying(value);
        if(value)setPickingJulia(false);
      }).catch(error=>{
        if(samilaPlaybackTransition.current===ticket&&error.name!=='AbortError')setError(error instanceof Error?error.message:String(error));
      }).finally(()=>{if(samilaPlaybackTransition.current===ticket)samilaPlaybackTransition.current=undefined;});
      return;
    }
    if(sourceBouncing){
      retireBouncingGesture();
      setBouncingNavigation(setSourceBouncingPaused(bouncingNavigationRef.current,!value));
      playingRef.current=value;
      bouncingLastFrameAt.current=value&&bouncingFrame.current.simulationUpdates>0?performance.now():undefined;
      setPlaying(value);return;
    }
    if(value)playbackStartedAt.current=performance.now();
    if(value)setPickingJulia(false);
    if(value&&finalPreview){playbackClock.current=0;timeRef.current=0;setTime(0);}
    if(value&&!continuousBouncing(scene)&&!playingRef.current&&(scene.timeline.playbackMode==='once'||(!scene.timeline.playbackMode&&!scene.timeline.loop))&&timeRef.current>=resolveTimeline(scene).duration){playbackClock.current=0;setTime(0);}
    setPlaying(value);
  }
  function cameraChanged(next:CameraState) {
    camera.current=next;
    const {id,camera:sourceCamera}=sceneRef.current;
    clearTimeout(cameraTimer.current);
    cameraTimer.current=setTimeout(()=>{
      const current=sceneRef.current;
      if(current.id!==id||current.camera!==sourceCamera)return;
      setCameraRevision(v=>v+1);setScene({...current,camera:next});
    },250);
  }
  function downloadProject() {
    try {
      const text=serializeScene({ ...scene, camera: camera.current });
      download(new Blob([text], { type: "application/json" }),`${scene.name}.mathart.json`);
      notify(t("项目文件已导出"));
    } catch(error) {notify(error instanceof Error?error.message:String(error));}
  }
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(()=>{document.documentElement.lang=language==='zh'?'zh-CN':'en';document.title=`MathArt Lab — ${t('数学艺术工作室')}`;},[language]);
  useEffect(()=>window.mathartDesktop?.onDownloadStatus(({state,filename})=>setToast(state==='completed'?t("已保存：{value0}",{value0:filename}):t("下载{value0}：请检查输出目录的可用空间和写入权限。",{value0:state==='cancelled'?t('已取消'):t('失败')}))),[language]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(id);
  }, [toast]);
  persistWorkspace.current=()=>{
      try {
        drafts.current[scene.id]={...scene,camera:camera.current};
        const scenes = saved;
        saveWorkspace(localStorage, {
          scenes,
          drafts: drafts.current,
          active: scene.id,
          theme,
          language,
          render:renderPreferences,
          library,
        });
      } catch (e) {
        setError(t("草稿保存失败：{value0}",{value0:String(e)}));
      }
  };
  useEffect(() => {
    const id = setTimeout(() => persistWorkspace.current(), 600);
    return () => clearTimeout(id);
  }, [scene, saved, theme, cameraRevision,renderPreferences,language,library]);
  useEffect(()=>{
    // Flush the latest render synchronously before reload/close, including a
    // camera gesture whose debounced React update has not fired yet.
    const flush=()=>persistWorkspace.current();
    const hidden=()=>{if(document.visibilityState==='hidden')flush();};
    window.addEventListener('pagehide',flush);document.addEventListener('visibilitychange',hidden);
    return()=>{window.removeEventListener('pagehide',flush);document.removeEventListener('visibilitychange',hidden);};
  },[]);
  useEffect(() => {
    const previous=equationBasis.current,next={id:scene.id,equations:scene.equations};
    setFormulaDraft(draft=>reconcileEquationDraft(previous,next,draft));
    equationBasis.current=next;
  }, [scene.id,scene.equations]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if(recording){if(event.key==='Escape')setRecording(false);return;}
      if(exporting){if(event.key==='Escape')setExporting(false);return;}
      if(target.closest('dialog[open]'))return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        document
          .querySelector<HTMLInputElement>(".search-field input")
          ?.focus();
      }
      if (event.code === "Space") {
        event.preventDefault();
        play(!playingRef.current);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        save();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if(event.shiftKey)redo();else undo();
      }
      if (event.key === "F2") {
        event.preventDefault();
        setInputDialog({title:'重命名',label:'场景名称',initial:scene.name,validate:validateName,submit:renameScene});
      }
      if (event.key === "Escape") {
        setPickingJulia(false);
        setExporting(false);
        setRecording(false);
        setShowSettings(false);
        setNewMenu(false);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [scene,language,recording,exporting,finalPreview]);
  useEffect(()=>{
    // Errors/cancellation may stop playback outside the transport handler.
    if(sourceBouncing&&bouncingNavigationRef.current.paused===playing){retireBouncingGesture();setBouncingNavigation(setSourceBouncingPaused(bouncingNavigationRef.current,!playing));}
  },[playing,sourceBouncing]);
  useEffect(() => {
    let id: number,
      prev = playbackStartedAt.current??performance.now();
    playbackStartedAt.current=undefined;
    function tick() {
      if(!playingRef.current)return;
      // Start/resume/recording anchors use performance.now(). RAF's frame
      // timestamp can precede those anchors, so use RAF only for scheduling.
      const now=performance.now();
      if(usesSourceSamilaSampling(sceneRef.current)){
        const last=samilaLastFrameAt.current;
        if(!generationPending.current&&!samilaPlaybackTransition.current&&(last===undefined||now-last>=1000/renderPreferences.frameRate)){
          samilaLastFrameAt.current=now;generationPending.current=true;setSamilaTickRevision(value=>value+1);
        }
        id=requestAnimationFrame(tick);return;
      }
      if(usesSourceBouncing(sceneRef.current)){
        const last=bouncingLastFrameAt.current;
        if(generationPending.current||!bouncingPresented.current||last!==undefined&&now-last<1000/renderPreferences.frameRate){id=requestAnimationFrame(tick);return;}
        const next=stepSourceBouncingRealtime(bouncingFrame.current,{paused:false,deltaTime:last===undefined?0:(now-last)/1000});
        if(!next.ok){playingRef.current=false;setPlaying(false);setError(next.error.reason);return;}
        bouncingLastFrameAt.current=now;generationPending.current=true;showBouncingCheckpoint(next.value);
        id=requestAnimationFrame(tick);return;
      }
      if(rootSamplingFps!==undefined){
        const step=readyPlaybackStep(playbackClock.current,prev,now,rootSamplingFps,renderPreferences.frameRate,generationPending.current);
        if(!step.advanced){id=requestAnimationFrame(tick);return;}
        playbackClock.current=step.clock;
      }else playbackClock.current += (now-prev)/1000;
      const next=scenePlaybackTime(scene,playbackClock.current),nextTime=next.time;
      // Reserve the next request before React commits its generation effect;
      // another animation frame must not advance the work clock twice.
      if(rootSamplingFps!==undefined&&nextTime!==timeRef.current)generationPending.current=true;
      setTime(nextTime);
      if(next.finished){setPlaying(false);if(experience.continuous)setToast(t('连续预览已到达 24 小时上限；可返回起点重新运行。'));}
      prev = now;
      id = requestAnimationFrame(tick);
    }
    if (playing) {id = requestAnimationFrame(tick);}
    return () => cancelAnimationFrame(id);
  }, [playing, scene.timeline.duration, scene.timeline.loop, scene.timeline.playbackMode,scene.timeline.schedule,scene.timeline.schedule?scene:undefined,rootSamplingFps,renderPreferences.frameRate,experience.continuous,sourceBouncing]);
  useEffect(()=>{
    const queue=new GenerationQueue(new Generator(),{
      output:(output,time,source)=>{
        setOutput(output);setOutputScene(source);setRenderTime(time);setError('');
        // The worker's scene clock owns elapsed time. Updating the displayed
        // playhead must not itself request another random display.
        if(output.type==='raster'&&output.samilaLive?.clock==='realtime-source-queue'){
          timeRef.current=time;playbackClock.current=time;setTime(time);
        }
      },
      recordingStopped:(result,originalScene)=>{
        // The queue finishes the owned recording even if its dialog unmounted.
        // Do not replace a document the user selected or edited meanwhile.
        if(sceneRef.current!==originalScene)return;
        autoPlayPending.current=false;playingRef.current=false;setPlaying(false);
        sceneRef.current=result.scene;generationScene.current=result.scene;
        camera.current=result.scene.camera;setSceneState(result.scene);
        timeRef.current=result.context.time;playbackClock.current=result.context.time;
        setTime(result.context.time);setPreviewCancelled(false);
      },
      error:error=>{autoPlayPending.current=false;interruptSourceBouncingInteraction();interruptSamilaPlayback();playingRef.current=false;setError(error.message);setPlaying(false);},
      busy:value=>{generationPending.current=value;setGenerationActive(value);setBusy(value&&!playingRef.current);},
    });
    generationQueue.current=queue;
    return()=>{queue.dispose();generationQueue.current=null;clearTimeout(cameraTimer.current);};
  },[]);
  useEffect(()=>{
    // A provisional size would consume progressive samples before the first
    // measured viewport, whose resize then legitimately clears their ink.
    if(!viewportSize)return;
    setPreviewCancelled(false);
    const changed=generationScene.current!==scene;
    if(generationScene.current?.id!==scene.id)setOutput(null);
    generationScene.current=scene;
    if(sourceBouncing)bouncingPresented.current=false;
    const profile=previewProfile(renderPreferences.quality),sourceSplat=usesSourceSamilaSplat(scene),dimensions=sourceSplat?{width:Math.max(1,Math.floor(viewportSize[0]*viewportMeasurement!.pixelRatio)),height:Math.max(1,Math.floor(viewportSize[1]*viewportMeasurement!.pixelRatio))}:previewDimensions(renderPreferences.quality,...viewportSize);
    generationQueue.current?.request(scene,{time:timeRef.current,quality:profile.quality,width:dimensions.width,height:dimensions.height,...(sourceSplat?{samilaPrimaryPixelHeight:dimensions.height}:{}),...(usesSourceSamilaSampling(scene)?{samilaLive:{sessionId:samilaSessionId.current,pixelDensity:viewportMeasurement!.pixelRatio,dirtyRevision:samilaDirtyRevision.current,clock:{paused:!playingRef.current}}}:{}),...(sourceBouncing?{sourceBouncingFrame:bouncingFrame.current,sourceBouncingView:bouncingNavigationRef.current.view,sourceViewport:{logicalWidth:viewportSize[0],logicalHeight:viewportSize[1],referenceLogicalHeight:viewportSize[1],target:'primary' as const,projectionPass:'perspective' as const}}:{}),...(usesSourcePerlin(scene)?{sourcePerlinViewport:sourcePerlinPreviewViewport(viewportSize[0],viewportSize[1],viewportMeasurement!.pixelRatio)}:{}),...(scene.sourceCamera?{sourceViewport:ordinarySourceViewport(scene,viewportSize[0],viewportSize[1],'primary',viewportSize[1]),sourcePointPixelDensity:viewportMeasurement!.pixelRatio}:{}),...(scene.kind==='fractal'?{fractalViewport:{logicalWidth:viewportSize[0],logicalHeight:viewportSize[1],target:'primary' as const}}:{}),...(usesRootsNativePresentation(scene)?{rootsSessionId:rootsSessionId.current,rootsViewport:{logicalWidth:viewportSize[0],logicalHeight:viewportSize[1],referenceLogicalHeight:viewportSize[1],target:'primary' as const}}:{})},changed?90:0,changed&&!samilaDisplayRequested.current?'metadata':undefined);
    samilaDisplayRequested.current=false;
  },[scene,sourceBouncing?bouncingNavigation.view:undefined,sourceBouncing?bouncingCheckpoint:usesSourceSamilaSampling(scene)?samilaTickRevision:playing&&!hasProgressiveRoots(scene)?Math.floor(time*renderPreferences.frameRate):time,renderPreferences,viewportSize,generationRevision]);
  useEffect(()=>{
    if(autoPlayPending.current&&!generationActive&&output&&outputScene===scene&&presentedSource===scene&&!error&&!recording&&!previewCancelled){autoPlayPending.current=false;play(true);}
  },[output,outputScene,presentedSource,scene,generationActive,error,recording,previewCancelled]);
  const entries =
    category === "saved" || category === "favorites"
      ? saved
          .filter((x) => !artworkIsTrashed(library,x.id)&&(category !== "favorites" || x.favorite))
          .map((s) => ({
            key: s.id,
            name: s.name,
            kind: s.kind,
            document: s,
            description: t("本地保存的场景"),
          }))
      : creationDefinitions
          .filter((d) => category === "all" || d.kind === category)
          .flatMap((d) =>
            (d.presets.length
              ? d.presets
              : [{ id: "default", name: d.name, description: d.description }]
            ).map((p) => ({
              key: `${d.kind}:${p.id}`,
              name: p.name,
              kind: d.kind,
              document: undefined as SceneDocument | undefined,
              preset: p,
              description: p.description ?? d.description,
            })),
          );
  const filtered = entries.filter((e) =>
    `${e.name} ${e.description} ${definition(e.kind).name} ${e.document?e.name:t(e.name)} ${e.document?e.description:t(e.description)} ${definition(e.kind).englishName}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const completedFrameReady=!playing&&!recording&&!generationActive&&!previewCancelled&&!error&&output!==null&&output===presentedOutput&&outputScene===scene&&presentedSource===scene&&renderTime===time&&(!sourceBouncing||output?.sourceBouncingFrame?.checkpoint.simulationUpdates===bouncingCheckpoint.simulationUpdates&&sourceBouncingViewMatches(output.sourceBouncingFrame.camera,bouncingNavigationRef.current.view));
  return (
    <I18nProvider language={language}><div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">
            <Activity size={22} />
          </div>
          <div>
            MathArt <span>Lab</span>
            <small>{t("数学艺术工作室")}</small>
          </div>
        </div>
        <div className="header-divider" />
        <div className="project-title">
          <span className="status-dot" />
          {scene.name}
          <ChevronDown size={13} />
          <small>{t("本地草稿")}</small>
        </div>
        <div className="spacer" />
        <button
          className="text-button"
          onClick={() => setShowSettings(true)}
          title={t("工作区设置")}
        >
          <Settings size={16} />
        </button>
        <button className="text-button" onClick={()=>save()}>
          <Save size={15} />{t("保存")}</button>
        <button disabled={sourceBouncing} className="text-button" title={t(sourceBouncing?"源弹跳请通过「导出作品」录制视频":"实时录制")} onClick={()=>{autoPlayPending.current=false;play(false);if(finalPreview){generationPending.current=true;playbackClock.current=0;timeRef.current=0;setTime(0);}setRecording(true);}}><Circle size={15}/>{t("录制")}</button>
        <button
          className="primary-button"
          onClick={() => {
            autoPlayPending.current=false;
            if(sourceBouncing||usesSourceSamilaSampling(sceneRef.current))play(false);else {playingRef.current=false;setPlaying(false);}
            setExporting(true);
          }}
        >
          <Download size={15} />{t("导出作品")}</button>
      </header>
      <div className="workspace">
        <nav className="activity-bar">
          <button
            title={t("场景库")}
            className={sidebar ? "active" : ""}
            onClick={() => setSidebar(!sidebar)}
          >
            <Grid2X2 size={19} />
          </button>
          <button
            title={t("我的作品")}
            onClick={() => {
              setSidebar(true);
              setCategory("saved");
            }}
          >
            <FolderOpen size={19} />
          </button>
          <button
            title={t("收藏")}
            onClick={() => {
              setSidebar(true);
              setCategory("favorites");
            }}
          >
            <Star size={19} />
          </button>
          <div className="spacer" />
          <button
            title={t("使用帮助")}
            onClick={() =>
              notify(
                t("选择螺旋图模板 → 编辑图层和参数 → 添加动画 → 导出。空格播放；⌘S 保存；⌘Z 撤销；⌘⇧Z 重做；F2 重命名。"),
              )
            }
          >
            <HelpCircle size={19} />
          </button>
          <button title={t("显示属性面板")} onClick={() => setInspector(!inspector)}>
            <SlidersHorizontal size={19} />
          </button>
        </nav>
        {sidebar && (
          <aside className="library">
            <div className="panel-heading">
              <h2>{t("场景库")}<span>{creationDefinitions.length}</span>
              </h2>
              <div className="new-container">
                <button
                  aria-label={t("新建场景")}
                  onClick={() => setNewMenu(!newMenu)}
                >
                  <Plus size={17} />
                </button>
                {newMenu && (
                  <div className="new-menu">
                    {creationDefinitions.map((d) => (
                      <button
                        key={d.kind}
                        onClick={() => {
                          setNewMenu(false);
                          setInputDialog({title:'新建场景',label:'新场景名称',initial:language==='en'?d.englishName:d.name,validate:validateName,submit:name=>load({...createScene(d),name},'document')});
                        }}
                      >
                        {language==='en'?d.englishName:d.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <label className="search-field">
              <Search size={14} />
              <input
                placeholder={t("搜索模板与作品…")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span>⌘ K</span>
            </label>
            <div className="library-tabs">
              <button
                className={
                  category !== "saved" && category !== "favorites"
                    ? "active"
                    : ""
                }
                onClick={() => setCategory("all")}
              >{t("模板")}</button>
              <button
                className={category === "saved" ? "active" : ""}
                onClick={() => setCategory("saved")}
              >{t("我的作品")}<span>{saved.filter(item=>!artworkIsTrashed(library,item.id)).length}</span>
              </button>
            </div>
            <div className="library-scroll">
              {category !== "saved" && category !== "favorites" && (
                <>
                  <button
                    className={`category-row ${category === "all" ? "active" : ""}`}
                    onClick={() => setCategory("all")}
                  >
                    <Grid2X2 size={14} />{t("全部模板")}<span>
                      {creationDefinitions.reduce((n, d) => n + d.presets.length, 0)}
                    </span>
                  </button>
                  <div className="category-grid">
                    {creationDefinitions.map((d) => {
                      const I = icons[d.kind];
                      return (
                        <button
                          key={d.kind}
                          className={category === d.kind ? "active" : ""}
                          onClick={() => setCategory(d.kind)}
                        >
                          <I size={14} />
                          {language==='en'?d.englishName:d.name}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              {category==='saved'?<ArtworkLibrary library={library} scenes={saved} drafts={libraryDrafts} active={scene.id} search={search} onChange={setLibrary} onLoad={item=>load(item,'library')} onCreate={createArtwork} onRename={(item,name)=>changeArtworkMetadata(item,{name})} onDuplicate={duplicateArtwork} onFavorite={item=>changeArtworkMetadata(item,{favorite:!item.favorite})}/>:<><div className="library-label">
                {category === "favorites"
                    ? t("我的收藏")
                    : t("精选模型")}
                <span>{filtered.length}</span>
              </div>
              <div className="preset-list">
                {filtered.map((e, i) => {
                  const I = icons[e.kind];
                  const selected=scene.kind==='perlin'?e.document?scene.id===e.document.id:scene.kind===e.kind&&!!perlinPreset&&'preset' in e&&e.preset?.id===perlinPreset.id:scene.name===e.name&&scene.kind===e.kind;
                  return (
                    <button
                      key={e.key}
                      className={`preset-card ${selected ? "selected" : ""}`}
                      onClick={() =>
                        load(
                          e.document ??
                            createScene(
                              definition(e.kind),
                              "preset" in e ? e.preset : undefined,
                            ),
                          'library',
                        )
                      }
                    >
                      <span className={`preset-art art-${e.kind}`}>
                        <I size={28} strokeWidth={1} />
                      </span>
                      <span className="preset-info">
                        <strong>{e.document?e.name:t(e.name)}</strong>
                        <small>{definition(e.kind).englishName}</small>
                      </span>
                      {selected && (
                        <span className="selected-mark" />
                      )}
                    </button>
                  );
                })}
                {!filtered.length && (
                  <div className="empty-state">
                    <FolderOpen size={28} />
                    <p>
                      {search ? t("未找到匹配场景") : t("保存作品后，会显示在这里")}
                    </p>
                  </div>
                )}
              </div>
              </>}
            </div>
            <div className="library-footer">
              <button onClick={() => file.current?.click()}>
                <Upload size={14} />{t("导入项目")}</button>
              <button title={t("导出项目 JSON")} onClick={downloadProject}>
                <FileDown size={15} />
              </button>
            </div>
          </aside>
        )}
        <main className="main-workspace">
          <div className="viewport-toolbar">
            <div className="breadcrumb">
              <Icon size={14} />
              {language==='en'?def.englishName:def.name}
              <ChevronRight size={12} />
              <strong>{scene.name}</strong>
            </div>
            <div className="spacer" />
            <span className="render-label">
              <span />
              {output?.backend==='webgl2'?'GPU · WebGL 2':output?.backend==='cpu'?'CPU':t('WebGL 2 画布')}
            </span>
            {scene.kind==='fractal'&&scene.settings.formula==='mandelbrot'&&scene.settings.variant!=='julia'&&<button disabled={busy||playing} aria-pressed={pickingJulia} onClick={()=>setPickingJulia(v=>!v)}>{t(pickingJulia?'取消点选':'点选 Julia 种子')}</button>}
            <button title={t("适合画布")} disabled={samilaNavigationLocked||sourceBouncing} onClick={() => viewport.current?.fit()}>
              <Maximize size={15} />
            </button>
            <button title={t("撤销")} aria-label={t("撤销")} disabled={!history.current.length} onClick={undo}>
              <RotateCcw size={14} />
            </button>
            <button title={t("重做")} aria-label={t("重做")} disabled={!future.current.length} onClick={redo}>
              <RotateCw size={14} />
            </button>
            <button
              title={t("专注模式")}
              onClick={() => {
                setSidebar(!sidebar);
                setInspector(!inspector);
              }}
            >
              <Expand size={15} />
            </button>
          </div>
          <div className="viewport">
            <Viewport
              ref={viewport}
              output={output}
              outputScene={outputScene}
              onPresented={frame=>{
                setPresentedSource(frame?.source??null);setPresentedOutput(frame?output:null);
                if(usesSourceBouncing(sceneRef.current))bouncingPresented.current=!!frame&&frame.source===sceneRef.current&&outputScene===sceneRef.current&&output?.sourceBouncingFrame?.checkpoint.simulationUpdates===bouncingFrame.current.simulationUpdates&&output?.sourceBouncingFrame?.checkpoint.sceneTime===bouncingFrame.current.sceneTime&&sourceBouncingViewMatches(output.sourceBouncingFrame.camera,bouncingNavigationRef.current.view);
              }}
              onRenderError={message=>{autoPlayPending.current=false;interruptSourceBouncingInteraction();interruptSamilaPlayback();setPlaying(false);setError(message);}}
              scene={scene}
              playing={playing}
              renderPending={generationActive}
              planeFrameReady={completedFrameReady}
              time={renderTime}
              pixelRatio={usesSourceSamilaSampling(scene)?Math.round(previewProfile(renderPreferences.quality,devicePixelRatio).pixelRatio):previewProfile(renderPreferences.quality,devicePixelRatio).pixelRatio}
              onCamera={cameraChanged}
              onSize={(width,height,resolution,pixelRatio=1)=>setViewportMeasurement(previous=>previous?.size[0]===width&&previous.size[1]===height&&previous.pixelRatio===pixelRatio&&sameProjectResolution(previous.resolution,resolution)?previous:{size:[width,height],resolution,pixelRatio})}
              onViewSettings={values=>setScene(current=>({...current,settings:{...current.settings,...values}}))}
              sourceBouncingInteractionEpoch={bouncingGestureEpoch}
              onSourceBouncingNavigate={(expected,view,checkpoint,event,begin,epoch)=>{
                if(epoch!==bouncingGestureEpochRef.current||playingRef.current||exporting||recording||sceneRef.current!==expected||!usesSourceBouncing(expected)||!bouncingNavigationRef.current.paused||!sourceBouncingViewsEqual(view,bouncingNavigationRef.current.view)||checkpoint.simulationUpdates!==bouncingFrame.current.simulationUpdates||checkpoint.sceneTime!==bouncingFrame.current.sceneTime||begin&&(!bouncingPresented.current||generationPending.current))return;
                const next=navigateSourceBouncing(bouncingNavigationRef.current,event);
                if(!next.ok){interruptSourceBouncingInteraction();setError(next.error.reason);return;}
                setBouncingNavigation(next.value);return next.value.view;
              }}
              onSamilaViewport={(expected,view,begin)=>{
                if(playingRef.current)return;
                const next=commitSamilaViewport(sceneRef.current,expected,view);if(!next)return;
                if(begin){history.current.push(expected);if(history.current.length>40)history.current.shift();future.current=[];}
                dirtySamila();setScene(next);return next;
              }}
              onRootsPresentation={(expected,rootsPresentation,begin)=>{
                if(playingRef.current||sceneRef.current!==expected||!usesRootsNativePresentation(expected))return;
                const next={...expected,rootsPresentation};
                if(begin){history.current.push(expected);if(history.current.length>40)history.current.shift();future.current=[];}
                sceneRef.current=next;setScene(next);return next;
              }}
              pickingJulia={pickingJulia&&!busy&&!playing&&scene.kind==='fractal'&&scene.settings.formula==='mandelbrot'&&scene.settings.variant!=='julia'}
              onPickJulia={values=>{setPickingJulia(false);edit({...scene,settings:{...scene.settings,...values}});notify('已从选中位置打开 Julia 视图；可撤销返回。');}}
            />
            <FormulaOverlay scene={outputScene??scene}/>
            {!scene.formulas?.main.visible&&!scene.formulas?.additional.some(label=>label.visible)&&<div className="viewport-caption">
              <span className="eyebrow">{def.englishName.toUpperCase()}</span>
              <h1>{scene.name}</h1>
              <p>{t(def.description)}</p>
            </div>}
            {busy && (
              <div className="rendering-badge">
                <span className="spinner" />{t("计算几何…")}
                <button onClick={()=>{interruptSourceBouncingInteraction();interruptSamilaPlayback();generationQueue.current?.cancel();setPreviewCancelled(true);}}>{t('取消计算')}</button>
              </div>
            )}
            {previewCancelled&&<div className="rendering-badge" role="status"><span>{t('计算已取消；当前画布保留取消前的预览。')}</span><button onClick={()=>setGenerationRevision(value=>value+1)}>{t('重新计算')}</button></div>}
            {error && (
              <div className="error-card" role="alert">
                <strong>{t("计算未完成")}</strong>
                <p>{t(error)}</p>
                <small>{t("调整公式或参数后将重新计算。画布保留上次结果。")}</small>
              </div>
            )}
            <div className="viewport-bottom">
              {!scene.sourceCamera&&<span className="interaction-hint">{t(sourceBouncing?"暂停时拖动旋转、滚轮缩放 · 播放恢复旋转角度":pickingJulia&&scene.kind==='fractal'&&scene.settings.formula==='mandelbrot'&&scene.settings.variant!=='julia'?"点击图像选择 Julia 种子 · Escape 取消":samilaNavigationLocked?"拖动平移 · 滚轮缩放 · theta 旋转 · 空格播放":hasMathematicalPlane(scene)?"拖动平移 · 滚轮缩放 · 空格播放":"拖动旋转 · 滚轮缩放 · 空格播放")}</span>}
              {!sourceBouncing&&<div className="view-chips">
                <button
                  className={scene.settings.showGrid ? "active" : ""}
                  onClick={() =>
                    changeSetting("showGrid", !scene.settings.showGrid)
                  }
                  title={t("显示网格")}
                >
                  <Grid2X2 size={14} />
                </button>
                <button
                  className={scene.settings.showAxes ? "active" : ""}
                  onClick={() =>
                    changeSetting("showAxes", !scene.settings.showAxes)
                  }
                  title={t("显示坐标轴")}
                >
                  XYZ
                </button>
              </div>}
            </div>
          </div>
          {sourceBouncing?<SourceBouncingTransport checkpoint={bouncingCheckpoint} playing={playing} ready={completedFrameReady} fps={scene.timeline.fps} onPlay={play} onSeek={seekBouncingUpdates}/>:<Timeline
            scene={scene}
            time={time}
            finalPreview={finalPreviewTime!==null}
            playing={playing}
            onTime={seek}
            onPlay={play}
            onChange={edit}
          />}
        </main>
        {inspector && (
          <aside className="inspector">
            <div className="panel-heading">
              <h2>{t("场景属性")}</h2>
              <button title={t("保存副本")} onClick={duplicate}>
                <Copy size={15} />
              </button>
            </div>
            <div className="inspector-hero">
              <span className="scene-icon">
                <Icon size={22} />
              </span>
              <div>
                <SceneName name={scene.name} onChange={renameScene} onError={notify}/>
                <small>{def.englishName}</small>
              </div>
              <button
                title={t("收藏场景")}
                onClick={() => save(!scene.favorite)}
                className={scene.favorite ? "favorite" : ""}
              >
                <Star
                  size={15}
                  fill={scene.favorite ? "currentColor" : "none"}
                />
              </button>
            </div>
            <div className="inspector-tabs">
              <button
                className={tab === "geometry" ? "active" : ""}
                onClick={() => setTab("geometry")}
              >{t("几何与参数")}</button>
              <button
                className={tab === "appearance" ? "active" : ""}
                onClick={() => setTab("appearance")}
              >{t("外观")}</button>
            </div>
            <div className="inspector-scroll">
              {!isCreationKind(scene.kind)&&<p className="section-body muted" role="note">{t('此场景的完整创作支持计划于 2.0。已有项目数据可继续保存和备份。')}</p>}
              <ProjectResolutionControls resolution={scene.projectResolution} onChange={projectResolution=>{
                const next={...scene};
                if(projectResolution)next.projectResolution=projectResolution;else delete next.projectResolution;
                edit(next);
              }}/>
              {scene.provenance && (
                <details className="inspector-section">
                  <summary>{t("导入兼容说明")}<span>{scene.provenance.warnings.length}</span>
                  </summary>
                  <div className="section-body">
                    <p className="muted">{t("原始场景数据随项目完整保留，可导出备份。")}</p>
                    {scene.provenance.warnings.map((w, i) => (
                      <p className="muted" key={i}>
                        {t(w)}
                      </p>
                    ))}
                  </div>
                </details>
              )}
              {sourceBouncing?<SourceBouncingControls key={`source-bouncing:${scene.id}:${tab}`} scene={scene} tab={tab} onChange={edit}/>:tab === "geometry" ? (
                <>
                  <SymmetryFormula scene={scene} onChange={edit}/>
                  {scene.kind==='perlin'&&!usesSourcePerlin(scene)&&<PerlinPresetControls scene={scene} preset={perlinPreset} onChange={edit}/>}
                  {experience.equations&&!usesRootsNativeMath(scene)&&def.equations.length > 0 && (
                    <details open className="inspector-section">
                      <summary>{t(scene.kind==='bouncing'?'初始位置公式':"数学公式")}<span className="mono">ƒ(x)</span>
                      </summary>
                      <div className="section-body">
                        <EquationEditor scene={scene} equations={def.equations} draft={formulaDraft} onChange={setFormulaDraft} applyOnBlur={experience.applyEquationsOnBlur} onApply={()=>{restartSamila();edit({...scene,equations:{...formulaDraft}});}}/>

                      </div>
                    </details>
                  )}
                  {experience.parameterPanel&&!usesRootsNativeMath(scene)&&!usesSourcePerlin(scene)&&<details open className="inspector-section">
                    <summary>{t(experience.continuous?"已有参数 · 兼容":"自定义参数")}{" "}
                      {experience.createParameters&&supportsGenericParameters(scene)&&<button
                        title={t("添加参数")}
                        onClick={(e) => {
                          e.preventDefault();
                          setInputDialog({title:'添加参数',label:hasSymmetryCustom(scene)?'GLSL 参数名称（字母或下划线开头）':'参数名称（字母开头）',initial:'p',maxLength:100,validate:name=>(hasSymmetryCustom(scene)?symmetryCustomParameterNameError(name):parameterNameError(name,scene.kind))??(Object.hasOwn(scene.parameters,name)?'该参数已存在':undefined),submit:name=>edit({...scene,parameters:{...scene.parameters,[name]:1}})});
                        }}
                      >
                        <Plus size={14} />
                      </button>}
                    </summary>
                    <div className="section-body">
                      {genericParameterNotice(scene)&&<p className="muted">{t(genericParameterNotice(scene)!)}</p>}
                      {scene.kind==='symmetry'||scene.kind==='samila'?<ParameterEditor scene={scene} onChange={(next,intent)=>{if(intent==='structure')restartSamila();edit(next,intent==='value',intent!=='metadata');}}/>:Object.entries(scene.parameters).map(([key, value]) => (
                        <div className="parameter-row" key={key}>
                          <label
                            htmlFor={`param-${key}`}
                            className="parameter-symbol"
                          >
                            {key}
                          </label>
                          <input
                            id={`param-${key}`}
                            aria-label={t("参数 {value0}",{value0:key})}
                            type="number"
                            step=".01"
                            value={value}
                            readOnly={!supportsGenericParameters(scene)}
                            onChange={(e) => {
                              if (supportsGenericParameters(scene)&&e.target.value !== "")
                                edit({
                                  ...scene,
                                  parameters: {
                                    ...scene.parameters,
                                    [key]: Number(e.target.value),
                                  },
                                });
                            }}
                          />
                          {supportsGenericParameters(scene)&&<button
                            title={t("删除参数 {value0}",{value0:key})}
                            onClick={() => {
                              const parameters = { ...scene.parameters };
                              delete parameters[key];
                              edit({ ...scene, parameters });
                            }}
                          >
                            <X size={12} />
                          </button>}
                        </div>
                      ))}
                      {supportsGenericParameters(scene)&&!Object.keys(scene.parameters).length && (
                        <p className="muted">{t("添加参数后，可在公式与动画中使用。")}</p>
                      )}
                    </div>
                  </details>}
                  <DomainColorControls scene={scene} onChange={edit} renderFacts={output?.type==='raster'&&output===presentedOutput&&outputScene===scene&&presentedSource===scene&&!previewCancelled?output.domainRender:undefined} renderTime={renderTime} onRetry={retryDomainGpu} retryDisabled={playing||recording||scene.settings.domainBackend==='cpu'}/>
                  {scene.kind==='roots'&&<RootsMathControls key={`root-math:${scene.id}`} scene={scene} onChange={edit}/>}
                  {scene.kind==='roots'&&<RootsPresentationControls scene={scene} onChange={edit} onRestart={()=>{rootsSessionId.current=crypto.randomUUID();generationQueue.current?.cancel();autoPlayPending.current=false;setPlaying(false);const start=rootsSchedule(scene.settings,scene.rootsMath).start;playbackClock.current=start;setTime(start);setGenerationRevision(n=>n+1);}} facts={output?.type==='raster'&&output===presentedOutput&&outputScene===scene&&presentedSource===scene&&!previewCancelled?output.rootsPresentation:undefined}/>}
                  <RootsDensityColorControls scene={scene} onChange={edit} facts={output?.type==='raster'&&output===presentedOutput&&outputScene===scene&&presentedSource===scene&&!previewCancelled?output.rootsColor:undefined}/>
                  {scene.kind==='fractal'?<FractalControls scene={scene} onChange={edit} section="formula"/>:!usesSourceSurfaceHost(scene)&&!usesSourceAttractor(scene)&&!usesSourcePerlin(scene)&&<SettingsFields
                    controls={spirographAuthoringControls(scene,visibleIteratedControls(scene.kind,scene.settings,scene.kind==='perlin'?visiblePerlinControls(def.controls,scene.settings):scene.kind==='bouncing'?visibleBouncingControls(def.controls,scene.settings):scene.kind==='domain'?visibleDomainControls(def.controls,scene.settings):scene.kind==='roots'?visibleRootsControls(def.controls,scene.settings):scene.kind==='attractor'?visibleAttractorControls(scene.settings,def.controls):symmetryAuthoringControls(scene,def.controls),scene.timeline,scene.palette)).filter(control=>{
                      if(!isMeshMaterialControlVisible(scene,control.key)||!rootMathControlVisible(scene,control.key)||!rootsPresentationControlVisible(scene,control.key))return false;
                      if(usesSourceSurfaceParticles(scene)&&control.key==='colorMetric')return false;
                      const historyControls=['showTrails','recordTrails','fadeTrails','trailLifetime','trailSampleRate','trailWidth'];
                      if(scene.kind==='surface'&&scene.settings.renderMode!=='points'&&historyControls.includes(control.key))return false;
                      if(scene.kind==='attractor'&&scene.settings.simulationMode!=='continuous'&&[...historyControls,'simulationFps'].includes(control.key))return false;
                      if(scene.kind==='attractor'&&scene.settings.simulationMode==='continuous'&&['steps','renderMode','animate','stepsPerSecond'].includes(control.key))return false;
                      if(['symmetry','map','samila'].includes(scene.kind)&&['explorationSeed','funcSeed'].includes(control.key))return false;
                      if(scene.kind==='spirograph'&&String(scene.settings.layers??'').trim())return !['layers','statorRadius','rotorRadius','rotorMode','penDistance','turns','rotors','drawDuration','animate','startEaseEnabled','endEaseEnabled','fadeInStatorsOnStart','fadeOutStatorsOnFinish','colorMetric'].includes(control.key);
                      if(scene.kind==='spirograph'&&control.key==='layers')return false;
                      if(scene.kind==='surface'&&['flowU','pingPongU'].includes(control.key)&&String(scene.settings.speedU??'').trim())return false;
                      if(scene.kind==='surface'&&['flowV','pingPongV'].includes(control.key)&&String(scene.settings.speedV??'').trim())return false;
                      return true;
                    }).map(control=>{
                      if(!usesSourceSurfaceParticles(scene))return control;
                      if(control.key==='fadeTrails')return{...control,label:t('按记录顺序渐隐'),help:t('最旧记录透明、最新记录使用色板透明度；边界断点也计入渐隐顺序。')};
                      if(control.key==='recordTrails')return{...control,help:t('设置初始录制状态；时间线中的拖尾片段可随后切换。修改后从起点重算当前画面。')};
                      if(control.key==='showTrails')return{...control,help:t('只控制拖尾是否显示；重新显示时按时间线重建历史。')};
                      if(control.key==='trailWidth')return{...control,help:t('源曲面线宽采用输入值的 0.95 倍，最小呈现宽度为 0.1 像素；隐藏拖尾请关闭显示开关。')};
                      if(control.key==='trailLifetime')return{...control,min:0,help:t('按模拟时间过期；每粒子还受原版记录容量限制，全部粒子合计最多 100 万条记录（含断点）。')};
                      return control;
                    })}
                    settings={meshAppearanceControlSettings(scene.kind==='bouncing'?bouncingControlSettings(scene.settings):scene.kind==='roots'?rootsControlSettings(scene.settings):scene.kind==='domain'?domainControlSettings(scene.settings):scene.kind==='surface'||scene.kind==='attractor'?{...scene.settings,trailWidth:parseTrailAppearance(scene.settings).width}:scene.kind==='samila'?samilaToneControlSettings(scene.settings):densityToneControlSettings(scene.kind,scene.settings))}
                    onChange={changeSetting}
                  />}
                  <SourcePerlinBackendControls scene={scene} onChange={edit}/>
                  <SourcePerlinCpuControls key={`source-perlin-cpu:${scene.id}`} scene={scene} onChange={edit} tab="geometry"/>
                  <SourcePerlinGpuControls key={`source-perlin:${scene.id}`} scene={scene} onChange={edit} tab="geometry"/>
                  <SourceAttractorControls key={`source-attractor:${scene.id}`} scene={scene} onChange={edit}/>
                  <SourceSurfaceControls key={`source-mesh:${scene.id}`} scene={scene} onChange={edit}/>
                  {scene.sourceCamera&&<OrdinarySourceCameraControls scene={scene} onChange={edit} disabled={playing||recording}/>}
                  {scene.kind==='samila'&&<details open className="inspector-section"><summary>{t('Samila 相机')}</summary><div className="section-body">
                    <p className="muted">{t(samilaSourceProjection?'原版视口：拖动按画布比例平移，滚轮围绕原点缩放。调整视图会清空并重新采样；不会自动适配边界。':'启用后切换为持续批次、限幅历史与 XY 投影。相机旋转保留累积图像；编辑起始角会重新计算历史。')}</p>
                    {!samilaCameraActive&&<button disabled={busy||playing} onClick={()=>edit({...scene,settings:initializeSamilaCamera(scene.settings)})}>{t('启用锚定 theta 相机')}</button>}
                    {scene.settings.samilaCameraModel===SAMILA_CAMERA_MODEL&&<>
                      {samilaCameraControls.map(spec=><Control key={spec.key} spec={spec} value={scene.settings[spec.key]??0} onChange={value=>changeSetting(spec.key,value)}/>)}
                      <button disabled={busy||playing||!scene.runtimeSamilaViewport} onClick={()=>edit({...scene,runtimeSamilaViewport:undefined})}>{t('重置临时视图')}</button>
                      {!samilaSourceProjection&&<button disabled={busy||playing} onClick={()=>changeSetting('samilaCameraModel','legacy-v1')}>{t('停用锚定 theta 相机')}</button>}
                    </>}
                  </div></details>}
                  {hasContinuousDensity(scene)&&<div className="section-body"><button onClick={()=>changeSetting('iteratedStartTime',time)}><RotateCcw size={14}/>{t('从当前时间重新累积')}</button></div>}
                  {(scene.kind==='map'||scene.kind==='symmetry')&&hasContinuousDensity(scene)&&<div className="section-body">
                    <p className="muted">{t('首次启用时，参考画布采用当前已完成图像的尺寸；切换调色模型会保留两组参数。')}</p>
                    {scene.settings.densityToneModel==='normalized-v2'?<button onClick={()=>changeSetting('densityToneModel','white-point-v1')}>{t('恢复白点调色')}</button>:<button disabled={busy||playing||previewCancelled||!!error||!output||output.type!=='raster'||generationScene.current!==scene} onClick={()=>{if(output?.type==='raster'&&generationScene.current===scene&&!generationPending.current)try{edit({...scene,settings:initializeNormalizedDensity(scene.kind,scene.settings,output.width,output.height)});}catch(e){setToast(e instanceof Error?e.message:String(e));}}}>{t('启用归一调色')}</button>}
                  </div>}
                  {scene.kind==='samila'&&!usesSourceSamilaSplat(scene)&&hasContinuousDensity(scene)&&<div className="section-body">
                    <p className="muted">{t('按实际累积批次调整亮度，同时启用有界历史；两组调色参数分别保留。')}</p>
                    {scene.settings.densityToneModel==='samila-normalized-v2'?<button onClick={()=>changeSetting('densityToneModel','white-point-v1')}>{t('恢复白点调色')}</button>:<button disabled={busy||playing} onClick={()=>{try{edit({...scene,settings:initializeSamilaTone(scene.settings)});}catch(e){setToast(e instanceof Error?e.message:String(e));}}}>{t('启用 Samila 归一调色')}</button>}
                  </div>}
                  {hasProgressiveRoots(scene)&&<div className="section-body">
                    <p className="muted">{t('播放按已完成批次逐步推进；计算繁重时，采样时钟会慢于实际时间。')}</p>
                    {rootScheduleError&&<p role="alert">{t(rootScheduleError)}</p>}
                    {rootCompletion!==undefined&&<><p className="muted">{t(scene.rootsPresentation?.pending?'采样计划在时间轴 {value0} 秒处到达末尾；批次积压可能延后实际采样和绘制完成。':'全部采样将在时间轴 {value0} 秒处完成；这是采样时钟，不是预计计算耗时。',{value0:rootCompletion.toFixed(3)})}</p>
                      {rootCompletion>86400?<p role="alert">{t('完成时间超出 24 小时时间线；请增加每步样本数或采样频率。')}</p>:<button onClick={()=>edit({...scene,timeline:{...scene.timeline,duration:Math.min(86400,Math.max(scene.timeline.duration,.1,Math.ceil(rootCompletion!*1000)/1000)),playbackMode:'once',loop:false}})}>{t(scene.rootsPresentation?.pending?'设置到采样计划末尾（单次）':'设置完整采样时间线（单次）')}</button>}
                    </>}
                    <button onClick={()=>changeSetting('rootStartTime',time)}><RotateCcw size={14}/>{t('从当前时间重新采样')}</button>
                  </div>}
                  {scene.kind==='bouncing'&&scene.settings.boundary==='polygon'&&<BouncingPolygonEditor key={`${scene.id}:${scene.settings.polygon}:${scene.settings.radius}:${scene.settings.sides}`} settings={scene.settings} onApply={polygon=>changeSetting('polygon',polygon)}/>}
                  <SurfaceTopology scene={scene} onChange={edit}/>
                  <ExplorePanel key={scene.id} scene={scene} onChange={edit}/>
                  <SpirographEditor key={`layers:${scene.id}`} scene={scene} time={time} completedFrame={outputScene===scene&&output===presentedOutput&&presentedSource===scene&&!previewCancelled?output?.spirographFrame?.absoluteFrame:undefined} onChange={edit}/>
                  {scene.kind==='roots'&&!usesRootsNativeMath(scene)&&<RootsParameterEditor scene={scene} onChange={edit}/>}
                  {experience.formulaPanel&&<FormulaEditor scene={scene} onChange={edit}/>}
                  <details className="inspector-section"><summary>{t("场景说明")}</summary><div className="section-body"><label className="equation-field"><span>{t("描述")}</span><textarea aria-label={t("场景描述")} maxLength={300} rows={4} value={scene.description??''} onChange={e=>{const value=e.target.value;if(value.length<=300||(scene.description??'').length>300&&value.length<(scene.description??'').length)edit({...scene,description:value},false,false);}}/></label><p className="muted" aria-live="polite">{(scene.description??'').length} / 300 {t('字符')}{(scene.description??'').length>300?' · '+t('已保留导入的长描述'):''}</p>{def.presets.some(p=>scene.id===`preset:${def.kind}:${p.id}`)&&<p className="muted">{t("正在编辑内置示例的本地草稿；保存时会创建独立作品。")}</p>}</div></details>
                </>
              ) : (
                <>
                  <FractalControls scene={scene} onChange={edit} section="color"/>
                  {!usesSourceSurfaceGeometry(scene)&&!usesSourceAttractor(scene)&&!usesSourcePerlin(scene)&&<GeometryColorControls scene={scene} onChange={edit}/>}
                  <details open className="inspector-section">
                    <summary>{t("渐变与色彩")}</summary>
                    <div className="section-body">
                      {usesSourceSamilaSplat(scene)?<SourceSamilaPaletteEditor key={scene.id} scene={scene} onChange={(next,dirty)=>edit(next,dirty)}/>:usesSourcePerlinCpu(scene)?<SourcePerlinCpuControls key={`source-perlin-cpu-appearance:${scene.id}`} scene={scene} onChange={edit} tab="appearance"/>:usesSourcePerlinGpu(scene)?<SourcePerlinGpuControls key={`source-perlin-appearance:${scene.id}`} scene={scene} onChange={edit} tab="appearance"/>:usesSourceAttractor(scene)?<SourceAttractorPaletteEditor key={scene.id} scene={scene} onChange={edit}/>:usesSourceSurfaceGeometry(scene)?<SourceSurfacePaletteEditor key={scene.id} scene={scene} onChange={edit}/>:usesFractalSourceColor(scene)?<FractalSourcePaletteEditor key={scene.id} scene={scene} onChange={edit}/>:scene.kind==='roots'&&usesRootsSourceDensity(scene.settings)?<RootsSourcePaletteEditor key={scene.id} scene={scene} onChange={edit}/>:scene.kind==='domain'&&parseDomainColorVersion(scene.settings.domainColorVersion)!=='local-v1'?<DomainSourcePaletteEditor key={scene.id} scene={scene} onChange={edit}/>:<PaletteEditor palette={scene.palette} onChange={palette=>edit({...scene,palette})}/>}
                      {!usesSourceSamilaSplat(scene)&&!usesSourceSurfaceGeometry(scene)&&!usesSourceAttractor(scene)&&!usesSourcePerlin(scene)&&scene.kind!=='fractal'&&scene.kind!=='domain'&&rootsAppearanceControlVisible(scene,'colorMetric')&&!hasGeometryColorOverride(scene)&&<Control
                        spec={{
                          key: "colorMetric",
                          label: t("着色依据"),
                          group: "",
                          type: "select",
                          options: [
                            { value: "height", label: t("高度") },
                            { value: "radius", label: t("距离") },
                            { value: "angle", label: t("极角") },
                            { value: "index", label: t("采样序列") },
                          ],
                        }}
                        value={scene.settings.colorMetric}
                        onChange={(v) => changeSetting("colorMetric", v)}
                      />}
                    </div>
                  </details>
                  <details open className="inspector-section">
                    <summary>{t("画布与渲染")}</summary>
                    <div className="section-body">
                      {usesSourceAttractor(scene)&&<SourceAttractorBackground scene={scene} onChange={edit}/>}
                      {!usesSourceSurfaceHost(scene)&&!usesSourceAttractor(scene)&&!usesSourcePerlin(scene)&&<label className="field">
                        <span>{t("背景颜色")}</span>
                        <input
                          type="color"
                          aria-label={t("背景颜色")}
                          value={scene.kind==='roots'&&usesRootsSourceDensity(scene.settings)?rootsSourceColorRgbHex(String(scene.settings.background)):String(scene.settings.background)}
                          onChange={(e) =>
                            changeSetting("background", e.target.value)
                          }
                        />
                      </label>}
                      {!usesSourceSurfaceHost(scene)&&!usesSourceAttractor(scene)&&!usesSourcePerlin(scene)&&rootsAppearanceControlVisible(scene,'pointSize')&&<Control
                        spec={{
                          key: "pointSize",
                          label: t(usesSourceSurfaceParticles(scene)?"点半径":"粒子大小"),
                          group: "",
                          type: "number",
                          min: usesSourceSurfaceParticles(scene)?undefined:0.1,
                          max: usesSourceSurfaceParticles(scene)?undefined:30,
                          step: 0.1,
                        }}
                        value={scene.settings.pointSize}
                        onChange={(v) => changeSetting("pointSize", v)}
                      />}
                      {!usesSourceSurfaceHost(scene)&&!usesSourceAttractor(scene)&&!usesSourcePerlin(scene)&&bouncingCanvasControl(scene,'opacity')&&rootsAppearanceControlVisible(scene,'opacity')&&<Control
                        spec={{
                          key: "opacity",
                          label: t("不透明度"),
                          group: "",
                          type: "number",
                          min: 0,
                          max: 1,
                          step: 0.05,
                        }}
                        value={scene.settings.opacity}
                        onChange={(v) => changeSetting("opacity", v)}
                      />}
                      {[
                        ["wireframe", t("线框模式")],
                        ["showGrid", t("辅助网格")],
                        ["showAxes", t("坐标轴")],
                          ["transparentBackground", t("透明背景")],
                      ].filter(([key])=>(!usesSourceSamilaPresentation(scene)||key!=='transparentBackground')&&(!(usesSourceSurfaceHost(scene)||usesSourceAttractor(scene))||key!=='wireframe')&&bouncingCanvasControl(scene,key)&&rootsAppearanceControlVisible(scene,key)).map(([key, label]) => (
                        <Control
                          key={key}
                          spec={{ key, label, group: "", type: "toggle" }}
                          value={!!scene.settings[key]}
                          onChange={(v) => changeSetting(key, v)}
                        />
                      ))}
                    </div>
                  </details>
                </>
              )}
            </div>
            <div className="inspector-footer">
              <span className="status-dot" />{t("更改自动保存到本机")}</div>
          </aside>
        )}
      </div>
      <footer className="status-bar">
        <span className="status-dot" />
        <span>{busy ? t("正在计算") : previewCancelled ? t('已取消') : error ? t("计算错误") : t("就绪")}</span>
        <span className="status-divider" />
        <span>{output?.stats.generated.toLocaleString() ?? "—"}{t("个采样点")}</span>
        {output?.temporal&&<span title={t("历史 {value0}–{value1} 秒，{value2} 次/秒",{value0:output.temporal.windowStart.toFixed(2),value1:output.temporal.time.toFixed(2),value2:output.temporal.samplingFps})}>{t("历史 ·")}{output.temporal.frames}{t("帧 /")}{output.temporal.recordedPoints.toLocaleString()}{t("点")}</span>}
        {output?.type==='raster'&&output.roots&&<span>{t(output.roots.complete?'复根采样完成 · {value0} / {value1}':'复根采样 · {value0} / {value1}',{value0:output.roots.attemptedSamples.toLocaleString(),value1:output.roots.totalSamples.toLocaleString()})}</span>}
        {output?.type==='raster'&&output.rootsPresentation?.pending&&<span>{t('待绘制 {count} 点 · 排队 {batches} 批',{count:output.rootsPresentation.pending.pendingPoints.toLocaleString(),batches:output.rootsPresentation.pending.queuedBatches.toLocaleString()})}</span>}
        <span>{output?.stats.elapsedMs?.toFixed(0) ?? "—"} ms</span>
        {output?.density && <span title={t("累积 {value0} / {value1} 点；视口外 {value2} 点；最高 {value3} 点/像素",{value0:output.density.accepted.toLocaleString(),value1:output.density.examined.toLocaleString(),value2:output.density.clipped.toLocaleString(),value3:output.density.maxCount.toLocaleString()})}>{t("密度 ·")}{output.density.occupiedPixels.toLocaleString()}{t("像素")}</span>}
        {output?.stats.invalid ? (
          <span className="warning-text">{t("已略过 {value0} 项无效结果",{value0:output.stats.invalid.toLocaleString()})}</span>
        ) : null}
        <div className="spacer" />
        {output?.warnings?.length ? (
          <span title={previewCancelled?t('取消前的计算信息：{value0}',{value0:output.warnings.map(w=>t(w)).join('\n')}):output.warnings.map(w=>t(w)).join("\n")}>⚠ {previewCancelled?t('已保留取消前的计算信息'):t(output.warnings[0])}</span>
        ) : (
          <span>{t("本地计算 · 无需云端")}</span>
        )}
        <span className="status-divider" />
        <span>MathArt Lab {appVersion}</span>
      </footer>
      <input
        ref={file}
        type="file"
        accept=".json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            try {
              if (f.size > 8 * 1024 * 1024)
                throw new Error(t("项目文件超过 8 MB"));
              const text = await f.text();
              const {parseProjectFile}=await import('./engine/legacyImport');
              const imported=parseProjectFile(text);
              load(imported.scene,'document');
              if (imported.format === 'local') {
                notify(t("项目已载入"));
              } else {
                notify(
                  imported.warnings.length
                    ? t("原版场景已导入，{value0} 项兼容说明见属性面板",{value0:imported.warnings.length})
                    : t("原版场景已导入"),
                );
              }
            } catch (err) {
              notify(String(err));
            }
          }
          e.target.value = "";
        }}
      />
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}
      {exporting && (
        <ExportDialog
          scene={{ ...scene, camera: camera.current }}
          time={time}
          currentSourceBouncingFrame={output?.sourceBouncingFrame?{ready:completedFrameReady,frame:output.sourceBouncingFrame}:undefined}
          currentSpirographFrame={outputScene===scene&&output===presentedOutput&&presentedSource===scene&&!previewCancelled?output?.spirographFrame?.absoluteFrame:undefined}
          sourcePerlinViewport={presentedSource===scene?presentedOutput?.sourcePerlinFrame?.sourceViewport:undefined}
          previewLogicalHeight={scene.sourceCamera?(presentedSource===scene?presentedOutput?.sourceCameraFrame?.viewport.logicalHeight:undefined):viewportSize?.[1]}
          previewPointPixelDensity={presentedSource===scene&&presentedOutput?.type==='geometry'?presentedOutput.sourcePointAppearance?.referencePixelDensity:undefined}
          samilaPrimaryPixelHeight={presentedSource===scene&&presentedOutput?.type==='raster'?presentedOutput.samilaSplat?.primaryPixelHeight:undefined}
          samilaPixelDensity={usesSourceSamilaSampling(scene)?viewportMeasurement?.pixelRatio:undefined}
          currentSamilaCapture={usesSourceSamilaSampling(scene)?{
            size:{width:scene.projectResolution?.width??(output?.type==='raster'?output.width:1920),height:scene.projectResolution?.height??(output?.type==='raster'?output.height:1080)},
            ready:completedFrameReady&&output?.type==='raster'&&output.samilaLive?.sessionId===samilaSessionId.current,
            capture:async(size,scale)=>{
              if(playingRef.current||sceneRef.current!==scene||generationPending.current||!output||!generationQueue.current)throw new Error('当前 Samila 画面尚未完成或已过期，请等待预览完成后重试');
              return generationQueue.current.captureSamilaPaused(output,size,scale);
            },
          }:undefined}
          currentPerlinCapture={scene.perlinSource?{
            size:{width:scene.projectResolution?.width??(output?.type==='raster'?output.width:1920),height:scene.projectResolution?.height??(output?.type==='raster'?output.height:1080)},
            ready:completedFrameReady,
            capture:async(size,scale)=>{
              if(playingRef.current||sceneRef.current!==scene||generationPending.current||!output||!generationQueue.current)throw new Error('当前 Perlin 画面尚未完成或已过期，请等待预览完成后重试');
              return generationQueue.current.capturePerlinPaused(output,size,scale);
            },
          }:undefined}
          currentPerlinRecording={scene.perlinSource?{
            ready:completedFrameReady,
            record:async(options,consumer,signal)=>{
              if(playingRef.current||sceneRef.current!==scene||generationPending.current||!output||!generationQueue.current)throw new Error('当前 Perlin 画面尚未完成或已过期，请等待预览完成后重试');
              return generationQueue.current.recordPerlin(output,options,consumer,signal);
            },
          }:undefined}
          currentRootsCapture={usesRootsNativePresentation(scene)?{
            size:{width:output?.type==='raster'?output.width:1920,height:output?.type==='raster'?output.height:1080},
            ready:completedFrameReady,
            capture:async(size,scale)=>{
              if(playingRef.current||sceneRef.current!==scene||generationPending.current||!output||!generationQueue.current)throw new Error('当前复根画面尚未完成或已过期，请等待预览完成后重试');
              return generationQueue.current.captureRootsPaused(output,size,scale);
            },
          }:undefined}
          onClose={() => setExporting(false)}
          onDone={notify}
        />
      )}
      {inputDialog&&<TextPrompt request={inputDialog} onClose={()=>setInputDialog(null)}/>}
      {recording&&<RecordDialog name={scene.name} fps={renderPreferences.frameRate} defaultDuration={sceneRecordingDuration(scene)} ready={!generationActive&&outputScene===scene&&presentedSource===scene&&output===presentedOutput&&renderTime===time&&!previewCancelled&&!error}
        getFrame={initial=>{const frame=viewport.current?.frame();return frame&&frame.source===sceneRef.current&&(!initial||!generationPending.current)?frame:null;}}
        onDuration={scene.kind==='bouncing'?value=>changeSetting('bouncingRecordDuration',value):undefined}
        onPlaying={(value,sceneTime,startedAt)=>{autoPlayPending.current=false;if(usesSourceSamilaSampling(sceneRef.current)){play(value);return;}if(value&&sceneTime!==undefined){playbackClock.current=sceneTime;playbackStartedAt.current=startedAt;setTime(sceneTime);}setPlaying(value);}}
        onClose={()=>setRecording(false)}/>}
      {showSettings && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowSettings(false);
          }}
        >
          <section
            className="modal settings-modal"
            role="dialog"
            aria-label={t("工作区设置")}
            aria-modal="true"
          >
            <div className="modal-heading">
              <h2>{t("工作区设置")}</h2>
              <button
                onClick={() => setShowSettings(false)}
                aria-label={t("关闭设置")}
              >
                <X size={18} />
              </button>
            </div>
            <p className="muted">{t("创作数据保存在当前浏览器。导出项目 JSON 可备份或迁移。")}</p>
            <label className="field">
              <span>{t("界面主题")}</span>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value as typeof theme)}
              >
                <option value="dark">{t("深色")}</option>
                <option value="light">{t("浅色")}</option>
              </select>
            </label>
            <label className="field"><span>{t('界面语言')}</span><select aria-label={t('界面语言')} value={language} onChange={e=>setLanguage(e.target.value as Language)}><option value="zh">中文</option><option value="en">English</option></select></label>
            <label className="field"><span>{t("预览目标帧率")}</span><input aria-label={t("预览目标帧率")} type="number" min={1} max={120} step={1} value={renderPreferences.frameRate} onChange={e=>{const value=Number(e.target.value);if(Number.isInteger(value)&&value>=1&&value<=120)setRenderPreferences(p=>({...p,frameRate:value}));}}/></label>
            <label className="field"><span>{t("渲染质量")}</span><select aria-label={t("渲染质量")} value={renderPreferences.quality} onChange={e=>setRenderPreferences(p=>({...p,quality:e.target.value as RenderPreferences['quality']}))}><option value="low">{t("流畅")}</option><option value="standard">{t("标准")}</option><option value="high">{t("高质量")}</option></select></label>
            <p className="muted">{t("高质量使用导出级数学采样和双倍画布像素，并启用抗锯齿。复杂场景可能低于目标帧率；导出仍按所选帧率逐帧计算。")}</p>
            <DesktopSettings/>
            <div className="shortcuts">
              <h3>{t("键盘快捷键")}</h3>
              <p>{t("播放 / 暂停")}<kbd>Space</kbd>
              </p>
              <p>{t("保存场景")}<kbd>⌘ S</kbd>
              </p>
              <p>{t("撤销")}<kbd>⌘ Z</kbd>
              </p>
              <p>{t("重做")}<kbd>⌘ ⇧ Z</kbd>
              </p>
              <p>{t("重命名")}<kbd>F2</kbd>
              </p>
            </div>
            <button
              className="primary-button"
              onClick={() => {
                downloadProject();
                setShowSettings(false);
              }}
            >
              <Download size={14} />{t("备份当前项目")}</button>
          </section>
        </div>
      )}
    </div></I18nProvider>
  );
}
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
