import type {SceneDocument} from '../types';
import {PARAMETER_RANGES_KEY} from './parameterEditing';
import {SOURCE_MAP_PRESENTATION_FIELDS} from './sourceMapPresentationFields';
import {ordinarySourceCameraInitial} from './ordinarySourceCamera';
export const SOURCE_ITERATED_REPLAY_SETTINGS=['scaleX','scaleY','scaleZ','offsetX','offsetY','offsetZ'] as const;
export const SOURCE_MAP_RUNTIME_SETTINGS:readonly string[]=[...SOURCE_MAP_PRESENTATION_FIELDS.map(field=>field[1]),'stepMetricMin','stepMetricMax','stepMetricNormalize','colorSpeed','colorPhase'];
const mapRuntimeSettings=new Set<string>([...SOURCE_ITERATED_REPLAY_SETTINGS,...SOURCE_MAP_RUNTIME_SETTINGS,'pointSize','background','mapBackgroundAlpha']);
const runtimeSettings=new Set<string>([...SOURCE_ITERATED_REPLAY_SETTINGS,'iterationsPerFrame','accumulationDecay','pointSize','normalizedBrightness','normalizedContrast','normalizedGamma','normalizedDynamicRange','normalizedSaturation','background']);
const identity=(value:unknown)=>JSON.stringify(value,(_key,v)=>Object.is(v,-0)?{number:'-0'}:v);
/** Recreate only on constructor/queue changes. Native hot setters and camera
 * angles have independent owners; metadata cannot restart a running scene. */
export function sourceIteratedApplyIdentity(scene:SceneDocument):string {
 const camera=ordinarySourceCameraInitial(scene);if(!camera)throw Error('迭代场景实时会话缺少源相机');
 const {phi,theta,gamma,...projection}=camera;
 if(scene.kind==='map')return identity([scene.kind,scene.equations,scene.parameters,scene.mapSource,scene.timeline,scene.projectResolution,projection,Object.fromEntries(Object.entries(scene.settings).filter(([key])=>key!==PARAMETER_RANGES_KEY&&!mapRuntimeSettings.has(key)))]);
 const {name,stops,mode,cosine,...paletteExtension}=scene.palette;
 return identity([scene.kind,scene.equations,scene.parameters,scene.symmetrySource,scene.timeline,scene.projectResolution,projection,Object.fromEntries(Object.entries(scene.settings).filter(([key])=>key!==PARAMETER_RANGES_KEY&&!runtimeSettings.has(key))),paletteExtension,['linear','cosine'].includes(mode)?'source':mode]);
}
export const sourceIteratedReplayIdentity=(s:SceneDocument)=>identity([s.kind==='symmetry'?[s.palette.mode,s.palette.stops,s.palette.cosine]:undefined,SOURCE_ITERATED_REPLAY_SETTINGS.map(key=>s.settings[key])]);
/** All rendered authored inputs, excluding metadata and parameter editor ranges. */
export function sourceIteratedSceneIdentity(scene:SceneDocument):string {return identity([scene.kind,scene.equations,scene.parameters,scene.kind==='map'?scene.mapSource:scene.symmetrySource,scene.sourceCamera,scene.timeline,scene.projectResolution,scene.kind==='symmetry'?scene.palette:undefined,Object.fromEntries(Object.entries(scene.settings).filter(([key])=>key!==PARAMETER_RANGES_KEY))]);}
