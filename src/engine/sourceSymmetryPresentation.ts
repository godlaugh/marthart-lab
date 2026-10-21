import type {SceneDocument,GenerateContext} from '../types';
import {prepareNormalizedDensityTone,type DensityToneJob} from './density';
import {usesSourceSymmetryGpu} from './sourceSymmetryMath';
import {deriveSourceIteratedNormalization,sourceIteratedPresentGlsl,type SourceIteratedToneReference} from './sourceIteratedPresentation';

export const SOURCE_SYMMETRY_PRESENTATION_MODEL='symmetry-present-1.7.8' as const;
export interface SourceSymmetryPresentationFacts {
 model:typeof SOURCE_SYMMETRY_PRESENTATION_MODEL;stage:'scene-target-rgba8';display:'opaque-rgb-copy';
 reference:SourceIteratedToneReference;referenceKind:'primary-canvas'|'local-output';scale:number;
}
export function usesSourceSymmetryPresentation(scene:Pick<SceneDocument,'kind'|'settings'>):boolean{return scene.kind==='symmetry'&&scene.settings.symmetryPresentationModel===SOURCE_SYMMETRY_PRESENTATION_MODEL;}
export function validateSourceSymmetryPresentation(scene:Pick<SceneDocument,'kind'|'settings'>):void {
 const model=scene.settings.symmetryPresentationModel;if(model===undefined)return;
 if(model!==SOURCE_SYMMETRY_PRESENTATION_MODEL||!usesSourceSymmetryGpu(scene)||scene.settings.iteratedMode!=='continuous'||scene.settings.densityToneModel!=='normalized-v2')throw Error('源 Symmetry 呈现需要源 GPU 数学、持续累积和归一调色');
}
export function prepareSourceSymmetryTone(scene:SceneDocument,context:Pick<GenerateContext,'width'|'height'|'sourceSymmetryToneReference'>):DensityToneJob {
 validateSourceSymmetryPresentation(scene);if(!usesSourceSymmetryPresentation(scene))throw Error('场景未选择源 Symmetry 呈现');
 const reference=context.sourceSymmetryToneReference??{width:context.width,height:context.height};
 const normalization=deriveSourceIteratedNormalization({kind:'symmetry',width:context.width,height:context.height,recordedPasses:0,batchSize:1},reference);
 const job=prepareNormalizedDensityTone(scene.palette,{normalizedBrightness:.3,normalizedDynamicRange:.2,...scene.settings},normalization);
 return{...job,normalization,sourceSymmetryPresentation:{model:SOURCE_SYMMETRY_PRESENTATION_MODEL,stage:'scene-target-rgba8',display:'opaque-rgb-copy',reference:{...reference},referenceKind:context.sourceSymmetryToneReference?'primary-canvas':'local-output',scale:normalization.scale}};
}
export const SOURCE_SYMMETRY_PRESENT_GLSL=sourceIteratedPresentGlsl('symmetry');
