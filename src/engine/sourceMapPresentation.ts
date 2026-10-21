import {writeSourcePackedColor} from './sourceProcessingGeometry';
import type {SceneDocument,GenerateContext,Settings} from '../types';
import {prepareNormalizedDensityTone,type DensityToneJob} from './density';
import {usesSourceMapSplat} from './sourceMapSplat';
import {usesSourceMapMath} from './sourceMapMath';
import {deriveSourceIteratedNormalization,sourceIteratedPresentGlsl,type SourceIteratedToneReference} from './sourceIteratedPresentation';
export const SOURCE_MAP_PRESENTATION_MODEL='map-present-1.7.8' as const;
export interface SourceMapPresentationFacts {
 model:typeof SOURCE_MAP_PRESENTATION_MODEL;stage:'scene-target-rgba8';display:'opaque-rgb-copy';
 reference:SourceIteratedToneReference;referenceKind:'primary-canvas'|'local-output';scale:number;
}
export function usesSourceMapPresentation(scene:Pick<SceneDocument,'kind'|'settings'>):boolean{return scene.kind==='map'&&scene.settings.mapPresentationModel===SOURCE_MAP_PRESENTATION_MODEL;}
function backgroundAlpha(settings:Settings):number {const alpha=settings.mapBackgroundAlpha??255;if(typeof alpha!=='number'||!Number.isInteger(alpha)||alpha<0||alpha>255)throw Error('源 Map 背景 alpha 需要 0–255 整数');return alpha;}
export function validateSourceMapPresentation(scene:Pick<SceneDocument,'kind'|'settings'>):void {
 if(scene.settings.mapPresentationModel===undefined)return;
 if(!usesSourceMapPresentation(scene)||!usesSourceMapMath(scene)||!usesSourceMapSplat(scene)||scene.settings.densityToneModel!=='normalized-v2')throw Error('源 Map 呈现需要源 GPU 数学、散点与归一调色');
 backgroundAlpha(scene.settings);
}
export function prepareSourceMapTone(scene:SceneDocument,context:Pick<GenerateContext,'width'|'height'|'sourceMapToneReference'>):DensityToneJob {
 validateSourceMapPresentation(scene);if(!usesSourceMapPresentation(scene))throw Error('场景未选择源 Map 呈现');
 const reference=context.sourceMapToneReference??{width:context.width,height:context.height};
 const normalization=deriveSourceIteratedNormalization({kind:'map',width:context.width,height:context.height,recordedPasses:0,batchSize:1},reference);
 const job=prepareNormalizedDensityTone(scene.palette,scene.settings,normalization),alpha=backgroundAlpha(scene.settings);
 const packed=((alpha<<24)|Number.parseInt(job.tone.background.slice(1),16))>>>0,rgba=new Float32Array(4);writeSourcePackedColor(packed,rgba,0);
 const sceneBackground:[number,number,number,number]=[rgba[0],rgba[1],rgba[2],rgba[3]];
 return{...job,sceneBackground,sourceMapPresentation:{model:SOURCE_MAP_PRESENTATION_MODEL,stage:'scene-target-rgba8',display:'opaque-rgb-copy',reference:{...reference},referenceKind:context.sourceMapToneReference?'primary-canvas':'local-output',scale:normalization.scale}};
}
export const SOURCE_MAP_PRESENT_GLSL=sourceIteratedPresentGlsl('map');
