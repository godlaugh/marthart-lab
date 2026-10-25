import type {SceneDocument} from '../types';
import {usesSourceMapMath} from './sourceMapMath';
import {usesSourceMapParameters} from './sourceMapParameterIdentity';
import {usesSourceMapPresentation} from './sourceMapPresentation';
import {usesSourceSymmetryNative} from './sourceSymmetryMath';
import {usesSourceSymmetryParameters} from './sourceSymmetryParameterIdentity';
import {usesSourceSymmetryGradient} from './sourceSymmetryGradient';
import {usesSourceSymmetryPresentation} from './sourceSymmetryPresentation';

/** Shared native math/host contract for dispatch, cold replay and authoring.
 * Live admission additionally requires its clock and recording semantics.
 * Delayed starts and disabled recording remain valid cold inputs. */
export function sourceIteratedNativeKind(scene:Pick<SceneDocument,'kind'|'settings'|'equations'|'symmetrySource'>):'map'|'symmetry'|undefined{
 if(scene.settings.iteratedBackend==='cpu')return;
 if(usesSourceMapMath(scene)&&usesSourceMapParameters(scene)&&usesSourceMapPresentation(scene))return 'map';
 if(usesSourceSymmetryNative(scene)&&usesSourceSymmetryParameters(scene)&&usesSourceSymmetryGradient(scene)&&usesSourceSymmetryPresentation(scene))return 'symmetry';
}
