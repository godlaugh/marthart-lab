import {usesSourceMapParameters} from './sourceMapParameterIdentity';
import {usesSourceMapPresentation} from './sourceMapPresentation';
import type {SceneDocument} from '../types';
import {usesSourceSamilaSampling} from './sourceSamilaSampling';
import {usesSourceSymmetryParameters} from './sourceSymmetryParameterIdentity';
import {usesSourceSymmetryGradient} from './sourceSymmetryGradient';
import {usesSourceSymmetryPresentation} from './sourceSymmetryPresentation';
/** Only complete live contracts opt in. Older fixed-preview documents retain
 * their saved models, including legacy parameter/timeline behavior. Local
 * delayed accumulation and disabled recording retain fixed reconstruction; the
 * native live mobject always has a zero origin and draws each normal display. */
export function sourceLivePreviewKind(scene:SceneDocument):'samila'|'symmetry'|undefined {
 if(usesSourceSamilaSampling(scene))return 'samila';
 if(sourceIteratedLiveKind(scene)==='symmetry')return 'symmetry';
}

/** Shared core readiness; Map UI admission follows once its event adapter is wired. */
export function sourceIteratedLiveKind(scene:SceneDocument):'map'|'symmetry'|undefined {
 if(scene.settings.iteratedBackend==='cpu'||(scene.settings.iteratedStartTime!==undefined&&scene.settings.iteratedStartTime!==0)||scene.settings.recordTrails===false)return;
 if(usesSourceMapParameters(scene)&&usesSourceMapPresentation(scene))return 'map';
 if(usesSourceSymmetryParameters(scene)&&usesSourceSymmetryGradient(scene)&&usesSourceSymmetryPresentation(scene))return 'symmetry';
}
