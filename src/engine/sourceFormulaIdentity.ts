import {usesRootsNativePresentation} from './rootsPresentationAuthoring';
import type {SceneDocument} from '../types';
import {usesSourceSurfaceGeometry} from './sourceSurfaceIdentity';
import {usesSourceImplicitConfiguration} from './sourceImplicitIdentity';
import {usesSourceFractal} from './sourceFractalDocument';
import {usesSourceAttractor} from './sourceAttractorDocument';
/** Families whose original TexMobject overlay layout has been established.
 * Eligibility does not migrate a saved local formula representation. */
export const usesSourceCenteredFormulaLayout=(scene:Pick<SceneDocument,'kind'|'settings'|'rootsPresentation'|'fractalSource'|'attractorSource'>)=>usesSourceSurfaceGeometry(scene)||usesSourceImplicitConfiguration(scene)||usesRootsNativePresentation(scene)||usesSourceFractal(scene)||usesSourceAttractor(scene);
