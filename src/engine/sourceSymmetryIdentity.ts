import type {SceneDocument} from '../types';
import {PARAMETER_RANGES_KEY} from './parameterEditing';
import {ordinarySourceCameraInitial} from './ordinarySourceCamera';
const transformKeys=['scaleX','scaleY','scaleZ','offsetX','offsetY','offsetZ'] as const;
const runtimeSettings=new Set<string>([...transformKeys,'iterationsPerFrame','accumulationDecay','pointSize','normalizedBrightness','normalizedContrast','normalizedGamma','normalizedDynamicRange','normalizedSaturation','background']);
const identity=(value:unknown)=>JSON.stringify(value,(_key,v)=>Object.is(v,-0)?{number:'-0'}:v);
/** Recreate only on constructor/queue changes. Native hot setters and camera
 * angles have independent owners; metadata cannot restart a running scene. */
export function sourceSymmetryApplyIdentity(scene:SceneDocument):string {
 const camera=ordinarySourceCameraInitial(scene);if(!camera)throw Error('Symmetry 实时会话缺少源相机');
 const {phi,theta,gamma,...projection}=camera;
 const {name,stops,mode,cosine,...paletteExtension}=scene.palette;
 return identity([scene.kind,scene.equations,scene.parameters,scene.symmetrySource,scene.timeline,scene.projectResolution,projection,Object.fromEntries(Object.entries(scene.settings).filter(([key])=>key!==PARAMETER_RANGES_KEY&&!runtimeSettings.has(key))),paletteExtension,['linear','cosine'].includes(mode)?'source':mode]);
}
export const sourceSymmetryReplayIdentity=(s:SceneDocument)=>identity([s.palette.mode,s.palette.stops,s.palette.cosine,transformKeys.map(key=>s.settings[key])]);
/** All rendered authored inputs, excluding metadata and parameter editor ranges. */
export function sourceSymmetrySceneIdentity(scene:SceneDocument):string {return identity([scene.kind,scene.equations,scene.parameters,scene.symmetrySource,scene.sourceCamera,scene.timeline,scene.projectResolution,scene.palette,Object.fromEntries(Object.entries(scene.settings).filter(([key])=>key!==PARAMETER_RANGES_KEY))]);}
