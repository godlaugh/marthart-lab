import type {SceneDocument} from '../types';
import {usesSourceSurfaceGeometry} from './sourceSurfaceIdentity';
import {usesSourceImplicitPresentation} from './sourceImplicitPresentation';
/** Families whose original TexMobject overlay layout has been established.
 * Eligibility does not migrate a saved local formula representation. */
export const usesSourceCenteredFormulaLayout=(scene:Pick<SceneDocument,'kind'|'settings'>)=>usesSourceSurfaceGeometry(scene)||usesSourceImplicitPresentation(scene);
