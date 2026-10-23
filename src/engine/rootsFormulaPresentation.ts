import type {SourceCameraViewport} from './sourceCamera';
import type {PreparedRootsProjection} from './rootsProjection';

/** Roots owns its viewport independently of the ordinary geometry camera.
 * Reuse the formula layout's primary-height rule without inventing a camera. */
export function rootsFormulaViewport(view:Pick<PreparedRootsProjection,'logicalWidth'|'logicalHeight'|'referenceLogicalHeight'|'target'>):SourceCameraViewport {
 return{logicalWidth:view.logicalWidth,logicalHeight:view.logicalHeight,referenceLogicalHeight:view.referenceLogicalHeight,target:view.target,projectionPass:'unknown'};
}
