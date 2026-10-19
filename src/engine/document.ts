import {prepareSourceSurfaceScene} from './sourceSurfaceScene';
import {parseSourceSurfacePalette} from './sourceSurfaceColor';
import {SOURCE_SURFACE_HOST,usesSourceSurfaceParticles,usesSourceSurfaceHost,usesSourceSurfaceGeometry} from './sourceSurfaceIdentity';
import {parseSourceSurfaceMeshConfiguration} from './sourceSurfaceMeshConfig';
import {ordinarySourceCameraInitial} from './ordinarySourceCamera';
import {parseFractalSourceColorProfile,parseFractalSourceColorConfiguration} from './fractalSourceColor';
import type { SceneDefinition, SceneDocument, Preset } from "../types";
import { PALETTES, validatePalette } from "./palette";
import {parseFractalColors} from './fractalColor';
import {parseFractalNumericProfile} from './fractalPrecision';
import {validateFormulas} from './formulas';
import {validateFractalKeyframes,validateTimelineExtensions,validateTimelineSchedule} from './timeline';
import type {AnimationTrack} from '../types';
import {parseRenderPreferences,type RenderPreferences} from './preferences';
import {parseRootParameters} from './rootParameters';
import {parseRootsMath,usesRootsNativeMath} from './rootsMathConfig';
import {parseRootsPresentationConfiguration} from './rootsPresentationConfig';
import {prepareRootsCameraTimeline} from './rootsCameraTimeline';
import type {Settings} from '../types';
import {parseLibrary,type ArtworkLibrary} from './library';
import {geometryColorModel} from './geometryColor';
import {parseTrailAppearance} from './trailAppearance';
import {MAX_SYMMETRY_CUSTOM_SOURCE_LENGTH,symmetryCustomParameterNameError} from './symmetryCustom';
import {parseDomainColorVersion,parseDomainSourcePalette} from './domainSourceColor';
import {parseDomainIterationVersion} from './domainSourceIteration';
import {parseDomainNativeParameters} from './domainNativeParameters';
import {parseDomainViewportVersion} from './domainViewport';
import {parseDomainRenderPolicy} from './domainRenderPolicy';
import {parseSpirographVersion} from './spirographModel';
import {parseRootsDensityColorVersion,parseRootsSourcePalette,validateRootsSourceColorSettings} from './rootsDensityColor';
import {parseSourceNumberTokens} from './sourceNumberTokens';
import {SOURCE_JSON_LIMITS} from './sourceJson';
import {prepareProjectResolution} from './projectResolution';
import {usesSpirographFrameClock,spirographSimulationFps,parseSpirographFrameEvents,spirographFrameClips} from './spirographFrameConfig';
export function createScene(
  def: SceneDefinition,
  preset?: Preset,
): SceneDocument {
  if(preset?.document){
    if(preset.equations!==undefined||preset.parameters!==undefined||preset.settings!==undefined)throw new Error('完整示例不能同时提供局部覆盖');
    return parseSceneValue({...structuredClone(preset.document),id:`preset:${def.kind}:${preset.id}`,name:preset.name,description:preset.description??def.description,kind:def.kind,favorite:false});
  }
  return {
    version: 1,
    id: preset ? `preset:${def.kind}:${preset.id}` : crypto.randomUUID(),
    name: preset?.name ?? def.name,
    description: preset?.description ?? def.description,
    kind: def.kind,
    equations: { ...def.defaults.equations, ...preset?.equations },
    parameters: { ...def.defaults.parameters, ...preset?.parameters },
    settings: {
      background: "#111317",
      pointSize: 2,
      opacity: 1,
      colorMetric: "height",
      wireframe: false,
      showGrid: false,
      showAxes: false,
      ...def.defaults.settings,
      ...preset?.settings,
    },
    palette: structuredClone(PALETTES[0]),
    camera: {
      position: [7, 5, 8],
      target: [0, 0, 0],
      orthographic: false,
      zoom: 1,
      autoFit: true,
    },
    timeline: { duration: 10, fps: 30, loop: true, tracks: [{ id: crypto.randomUUID(), type: 'wait', target: 'timeline.wait', label: '等待', from: 0, to: 0, start: 0, duration: 10, easing: 'linear', pingPong: false, enabled: true }] },
    favorite: false,
  };
}
const kinds = [
  "surface",
  "attractor",
  "map",
  "implicit",
  "fractal",
  "domain",
  "symmetry",
  "perlin",
  "spirograph",
  "bouncing",
  "samila",
  "roots",
];
function record(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function fail(message: string): never {
  throw new Error(`项目文件无效：${message}`);
}
export const MAX_SCENE_TEXT_LENGTH=SOURCE_JSON_LIMITS.characters;
export class SceneDocumentCapacityError extends Error {
  readonly code='capacity';
  constructor(readonly characters:number){super('项目文件无效：文件超过 8 MB');this.name='SceneDocumentCapacityError';}
}
export function parseScene(text: string): SceneDocument {
  if (text.length > MAX_SCENE_TEXT_LENGTH) throw new SceneDocumentCapacityError(text.length);
  return parseSceneValue(JSON.parse(text));
}
/** Validate and normalize a freshly parsed value owned by the file reader. */
export function parseSceneValue(data: unknown): SceneDocument {
  if (!record(data)) fail("应为 JSON 对象");
  delete data.evaluatedCamera; // Runtime facts are rebuilt from the document at each requested time.
  delete data.evaluatedRootsCamera;
  delete data.evaluatedDomainGradient;
  delete data.evaluatedFractalGradient;
  delete data.runtimeSamilaViewport;
  delete data.domainRender; // Delivered execution facts are not authored rules.
  delete data.rootsColor;
  delete data.evaluatedSpirographRotationRadians;
  delete data.evaluatedSpirographFrame;
  if (data.version !== 1 || !kinds.includes(String(data.kind)))
    fail("不支持的版本或场景类型");
  if(typeof data.id!=='string'||!data.id||data.id.length>300)fail('场景标识无效');
  if(record(data.provenance)&&data.provenance.sourceNumberTokens!==undefined){
    data.provenance.sourceNumberTokens=parseSourceNumberTokens(data.provenance.sourceNumberTokens,data.kind as SceneDocument['kind']);
  }
  if(data.projectResolution!==undefined){
    const prepared=prepareProjectResolution(data.projectResolution);
    if(!prepared.ok)fail(prepared.error.reason);
    data.projectResolution=prepared.value;
  }
  if(data.description!==undefined&&(typeof data.description!=='string'||data.description.length>8192))fail('场景描述超过 8192 字符或类型无效');
  if (
    typeof data.name !== "string" ||
    !data.name.trim() ||
    data.name.length > 300
  )
    fail("缺少名称");
  for (const key of [
    "equations",
    "parameters",
    "settings",
    "camera",
    "timeline",
    "palette",
  ])
    if (!record(data[key])) fail(`缺少 ${key}`);
  // Migrate the old mesh-only authored payload once at the saved-file boundary.
  // Never reconstruct editable values from original import provenance.
  const sourceSettings=data.settings as Settings;
  if(sourceSettings.surfaceGeometryVersion==='mathart-1.7.8-mesh-v1'){
    if(data.kind!=='surface'||data.surfaceSource!==undefined||data.surfaceSourceMesh===undefined)fail('旧曲面网格配置缺失或与新版配置冲突');
    data.surfaceSource=data.surfaceSourceMesh;delete data.surfaceSourceMesh;
    sourceSettings.surfaceGeometryVersion=SOURCE_SURFACE_HOST;
  }else if(data.surfaceSourceMesh!==undefined)fail('旧网格配置缺少对应版本，不能猜测其归属');
  for (const [k, v] of Object.entries(data.equations as object))
    if (typeof v !== "string" || v.length > (data.kind==='symmetry'&&k==='glsl'?MAX_SYMMETRY_CUSTOM_SOURCE_LENGTH:8192) || k.length > 100)
      fail("公式无效");
  const domainExecution=data.kind==='domain'?parseDomainIterationVersion((data.settings as Settings).domainIterationVersion):undefined;
  if(domainExecution==='mathart-1.7.8-cpu'||domainExecution==='mathart-1.7.8-gpu')data.parameters=parseDomainNativeParameters(data.parameters);
  else for (const [k, v] of Object.entries(data.parameters as object))
    if (
      (data.kind==='symmetry'?!!symmetryCustomParameterNameError(k):!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(k)) ||
      typeof v !== "number" ||
      !Number.isFinite(v)
    )
      fail("参数无效");
  for (const v of Object.values(data.settings as object))
    if (
      !["number", "boolean", "string"].includes(typeof v) ||
      (typeof v === "number" && !Number.isFinite(v))
    )
      fail("设置无效");
  const camera = data.camera as Record<string, unknown>;
  if (typeof camera.orthographic !== 'boolean' || typeof camera.zoom !== 'number' || !Number.isFinite(camera.zoom) || camera.zoom <= 0 || camera.autoFit !== undefined && typeof camera.autoFit !== 'boolean') fail('相机投影或缩放无效');
  for (const key of ["position", "target"])
    if (
      !Array.isArray(camera[key]) ||
      camera[key].length !== 3 ||
      !camera[key].every(
        (x: unknown) => typeof x === "number" && Number.isFinite(x),
      )
    )
      fail("相机无效");
  if(data.sourceCamera!==undefined)ordinarySourceCameraInitial(data as unknown as SceneDocument);
  delete data.evaluatedSourceCamera;
  const palette=validatePalette(data.palette);data.palette=palette;
  if(data.kind==='domain'){
    parseDomainRenderPolicy((data.settings as Settings).domainRenderPolicy);
    parseDomainColorVersion((data.settings as Settings).domainColorVersion);
    parseDomainViewportVersion((data.settings as Settings).domainViewportVersion);
    if(data.domainSourcePalette!==undefined)data.domainSourcePalette=parseDomainSourcePalette(data.domainSourcePalette);
  }
  if(data.kind==='fractal'){
    parseFractalNumericProfile((data.settings as Settings).fractalNumericProfile);
    const sourceColor=parseFractalSourceColorProfile((data.settings as Settings).fractalColorProfile);
    if(data.fractalSourceColor!==undefined)data.fractalSourceColor=parseFractalSourceColorConfiguration(data.fractalSourceColor);
    if(!sourceColor)parseFractalColors({settings:data.settings as Settings,palette});
  }
  if(data.kind==='spirograph'){
    const settings=data.settings as Settings;parseSpirographVersion(settings.spirographVersion);
    if(settings.spirographSimulationFps!==undefined)spirographSimulationFps({settings});
  }
  if(data.spirographFrameEvents!==undefined){
    if(data.kind!=='spirograph')fail('旋轮帧事件仅适用于旋轮场景');
    data.spirographFrameEvents=parseSpirographFrameEvents(data.spirographFrameEvents);
  }
  if(!usesSourceSurfaceHost(data as unknown as SceneDocument)){
    if(data.kind==='surface'||data.kind==='implicit')geometryColorModel({kind:data.kind,settings:data.settings as Settings});
    if(data.kind==='surface'||data.kind==='attractor')parseTrailAppearance(data.settings as Settings);
  }
  if(data.surfaceSource!==undefined){
    if(!usesSourceSurfaceHost(data as unknown as SceneDocument))fail('曲面源网格配置仅适用于原版 CPU 网格');
    const parsed=parseSourceSurfaceMeshConfiguration(data.surfaceSource);
    if(!parsed.ok)fail(`曲面源网格配置无效：${parsed.error.path.join('.')} ${parsed.error.reason}`);
    if(parsed.value.nativeBackend!=='cpu')fail('曲面源宿主仅接入 CPU，GPU 尚未接入');
    data.surfaceSource=parsed.value;
  }
  if(usesSourceSurfaceHost(data as unknown as SceneDocument)){
    const settings=data.settings as Settings;
    if(data.surfaceSource===undefined)fail('曲面源网格缺少配置');
    if(settings.computeBackend!=='cpu')fail('曲面源宿主后端不匹配');
    if(data.surfaceSourcePalette===undefined)fail('曲面源网格缺少源色板');
  }
  // Source-particle documents saved before the dedicated palette editor used
  // the local palette field. Migrate authored stops once at the file boundary;
  // never recover an older value from import provenance over later edits.
  if(data.surfaceSourcePalette===undefined&&usesSourceSurfaceParticles(data as unknown as SceneDocument))data.surfaceSourcePalette={colors:[...palette.stops]};
  if(data.surfaceSourcePalette!==undefined){
    if(!usesSourceSurfaceGeometry(data as unknown as SceneDocument))fail('曲面源色板仅适用于原版 CPU 曲面');
    data.surfaceSourcePalette=parseSourceSurfacePalette(data.surfaceSourcePalette);
  }
  if(data.rootsSourcePalette!==undefined){
    if(data.kind!=='roots')fail('复根源色板仅适用于复根场景');
    data.rootsSourcePalette=parseRootsSourcePalette(data.rootsSourcePalette);
  }
  if(data.rootsMath!==undefined){
    if(data.kind!=='roots')fail('复根数学规则仅适用于复根场景');
    data.rootsMath=parseRootsMath(data.rootsMath);
  }
  if(data.rootsPresentation!==undefined){
    if(data.kind!=='roots')fail('复根呈现规则仅适用于复根场景');
    data.rootsPresentation=parseRootsPresentationConfiguration(data.rootsPresentation);
  }
  if(data.kind==='roots'){
    const settings=data.settings as Settings;
    parseRootsDensityColorVersion(settings.rootDensityColorVersion);
    validateRootsSourceColorSettings(settings);
    if(!usesRootsNativeMath(data as unknown as SceneDocument))parseRootParameters(settings,String(settings.variable??'z'),Object.keys(data.parameters as object));
  }
  if(data.formulas!==undefined)data.formulas=validateFormulas(data.formulas);
  const t = data.timeline as Record<string, unknown>;
  if (
    typeof t.duration !== "number" ||
    t.duration <= 0 ||
    t.duration > 86400 ||
    typeof t.fps !== "number" ||
    t.fps < 1 ||
    t.fps > 120 ||
    !Array.isArray(t.tracks) ||
    t.tracks.length > 1000
  )
    fail("时间线无效");
  for (const track of t.tracks) {
    if (
      !record(track) ||
      typeof track.target !== "string" ||
      !["from", "to", "start", "duration"].every(
        (k) => typeof track[k] === "number" && Number.isFinite(track[k]),
      ) ||
      (Number(track.duration) < 0 || Number(track.duration) === 0 && !['animate','spirograph_finish_wait'].includes(String(track.type)) && !(track.type==='wait'&&usesSpirographFrameClock(data as unknown as SceneDocument)) && !(track.type==='trails'&&usesSourceSurfaceGeometry(data as unknown as SceneDocument))) ||
      Number(track.start) < 0
    )
      fail("动画轨道无效");
    validateTimelineExtensions(track as unknown as AnimationTrack,data.kind as SceneDocument['kind'],t.schedule as SceneDocument['timeline']['schedule'],usesSourceSurfaceGeometry(data as unknown as SceneDocument));
    if(track.type==='fractal_zoom')track.keyframes=validateFractalKeyframes(track as unknown as AnimationTrack);
  }
  validateTimelineSchedule(data as unknown as SceneDocument);
  if(t.schedule==='roots-camera-sequence-v1'||t.schedule==='roots-scene-sequence-v1')prepareRootsCameraTimeline(data as unknown as SceneDocument);
  if(usesSpirographFrameClock(data as unknown as SceneDocument)){
    spirographSimulationFps(data as unknown as SceneDocument);
    spirographFrameClips(data as unknown as SceneDocument);
  }
  if(usesSourceSurfaceHost(data as unknown as SceneDocument))prepareSourceSurfaceScene(data as unknown as SceneDocument);
  return data as unknown as SceneDocument;
}
export const STORAGE_KEY = "mathart-lab-v1";
export interface SavedWorkspace {
  scenes: SceneDocument[];
  drafts?: Record<string, SceneDocument>;
  active: string;
  theme: "dark" | "light";
  language: "zh" | "en";
  render?: RenderPreferences;
  library?: ArtworkLibrary;
  recovered?: boolean;
  startupError?: string;
}
export function persistentScene(scene:SceneDocument):SceneDocument {const {evaluatedSourceCamera:_sourceCamera,evaluatedCamera:_runtime,evaluatedRootsCamera:_rootsCamera,evaluatedDomainGradient:_gradient,evaluatedFractalGradient:_fractalGradient,runtimeSamilaViewport:_viewport,domainRender:_domainRender,rootsColor:_rootsColor,evaluatedSpirographRotationRadians:_spirograph,evaluatedSpirographFrame:_spirographFrame,...document}=scene as SceneDocument&{domainRender?:unknown;rootsColor?:unknown};void _sourceCamera;void _runtime;void _rootsCamera;void _gradient;void _fractalGradient;void _viewport;void _domainRender;void _rootsColor;void _spirograph;void _spirographFrame;return document;}
/** One owner for public project text and its readable-input budget. Preserve
 * the established indented output while it fits; whitespace alone must not
 * reject an otherwise saveable document. Neither branch drops provenance. */
export function serializeScene(scene:SceneDocument):string {
  const document=persistentScene(scene),pretty=JSON.stringify(document,null,2);
  if(pretty.length<=MAX_SCENE_TEXT_LENGTH)return pretty;
  const compact=JSON.stringify(document);
  if(compact.length>MAX_SCENE_TEXT_LENGTH)throw new SceneDocumentCapacityError(compact.length);
  return compact;
}
export function saveWorkspace(storage: Storage, data: SavedWorkspace): void {
  const old = storage.getItem(STORAGE_KEY);
  if (old) {
    try { decodeWorkspace(old); storage.setItem(STORAGE_KEY + "-backup", old); }
    catch { storage.setItem(STORAGE_KEY + "-recovery", old); }
  }
  storage.setItem(STORAGE_KEY, JSON.stringify({...data,scenes:data.scenes.map(persistentScene),...(data.drafts?{drafts:Object.fromEntries(Object.entries(data.drafts).map(([id,scene])=>[id,persistentScene(scene)]))}:{})}));
}
function decodeWorkspace(raw: string): SavedWorkspace {
  const data = JSON.parse(raw);
  if (!record(data) || !Array.isArray(data.scenes)) throw new Error("工作区格式无效");
  const drafts: Record<string,SceneDocument>=Object.create(null);
  if(data.drafts){if(!record(data.drafts))throw new Error('草稿列表无效');for(const [id,doc] of Object.entries(data.drafts))drafts[id]=parseScene(JSON.stringify(doc));}
  const scenes:SceneDocument[]=data.scenes.map((s: unknown) => parseScene(JSON.stringify(s)));
  return {
    scenes,
    drafts,
    active: typeof data.active==='string'?data.active:'',
    theme:data.theme==='light'?'light':'dark',
    language:data.language==='en'?'en':'zh',
    ...(data.render===undefined?{}:{render:parseRenderPreferences(data.render)}),
    ...(data.library===undefined?{}:{library:parseLibrary(data.library,scenes.map(s=>s.id))}),
  };
}
export function loadWorkspace(storage: Storage): SavedWorkspace | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try{return decodeWorkspace(raw);}catch(error){const backup=storage.getItem(STORAGE_KEY+'-backup');if(backup)return {...decodeWorkspace(backup),recovered:true};throw error;}
}
