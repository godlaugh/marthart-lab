import {PARAMETER_RANGES_KEY} from './parameterEditing';
import type {SceneDocument} from '../types';
import {sourceSamilaPaletteRuntimeScene} from './sourceSamilaPaletteEditing';
const identity=(value:unknown)=>JSON.stringify(value,(_key,item)=>typeof item==='number'&&Object.is(item,-0)?{number:'-0'}:item);
/** Known source setters. Other changes explicitly reconstruct the mobject. */
export const SOURCE_SAMILA_HOT_SETTINGS:ReadonlySet<string>=new Set(['scaleX','scaleY','offsetX','offsetY','rotation','batchSize','samilaCameraTheta','samilaSpotSize','alpha','accumulationDecay','colorSpeed','colorPhase','normalizedBrightness','normalizedContrast','normalizedGamma','normalizedDynamicRange','normalizedSaturation','background','samilaUsePaletteLut']);
export function sourceSamilaSceneIdentity(scene:SceneDocument):string {scene=sourceSamilaPaletteRuntimeScene(scene);return identity([scene.kind,scene.equations,scene.parameters,Object.fromEntries(Object.entries(scene.settings).filter(([key])=>key!==PARAMETER_RANGES_KEY)),scene.palette,scene.timeline,scene.runtimeSamilaViewport]);}
export function sourceSamilaApplyIdentity(scene:SceneDocument):string {scene=sourceSamilaPaletteRuntimeScene(scene);const settings=Object.fromEntries(Object.entries(scene.settings).filter(([key])=>key!==PARAMETER_RANGES_KEY&&!SOURCE_SAMILA_HOT_SETTINGS.has(key)));return identity([scene.kind,settings,scene.equations,Object.keys(scene.parameters).sort(),scene.timeline]);}
