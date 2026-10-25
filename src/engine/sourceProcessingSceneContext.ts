import type {SourceCameraPlan} from './sourceCamera';
import type {SourceProcessingContextEvent} from './sourceProcessingContext';

/** MathArt.initScene restores default optics before resetMatrix. Reset alone
 * would incorrectly inherit an earlier scene's final overlay projection. */
export function sourceProcessingSceneInitializationEvents():readonly SourceProcessingContextEvent[]{
 return[{kind:'default-camera'},{kind:'default-perspective'},{kind:'reset-matrix'}];
}

/** Consume the camera owner's prepared optics/scalars. Render-stage presence
 * (fade/overlay) is supplied by the scene/presentation owner, not inferred from
 * frame number or whether a shader happens to read a particular uniform. */
export function sourceProcessingSceneBaseEvents(plan:SourceCameraPlan):readonly SourceProcessingContextEvent[]{
 return[{kind:'perspective',fov:plan.optics.fov,aspect:plan.optics.aspect,near:plan.optics.near,far:plan.optics.far},{kind:'camera',z:plan.optics.cameraZ}];
}
export function sourceProcessingSceneWorldEvents(plan:SourceCameraPlan):readonly SourceProcessingContextEvent[]{
 const c=plan.camera.value,out:SourceProcessingContextEvent[]=[{kind:'push-matrix'},{kind:'translate',x:Math.fround(Math.fround(plan.viewport.logicalWidth)/2),y:Math.fround(Math.fround(plan.viewport.logicalHeight)/2),z:0}];
 if(Math.abs(Math.fround(plan.displayScale-1))>Math.fround(.001))out.push({kind:'scale',x:plan.displayScale,y:plan.displayScale,z:plan.displayScale});
 out.push({kind:'rotate',axis:'z',angle:-c.gamma},{kind:'rotate',axis:'x',angle:c.phi},{kind:'rotate',axis:'z',angle:c.theta},{kind:'translate',x:-c.center[0],y:-c.center[1],z:-c.center[2]});return out;
}
/** popMatrix restores camera and modelview, leaving the overlay projection.
 * Call after the world stack has been popped when rendering screen overlays. */
export function sourceProcessingOverlayEvents():readonly SourceProcessingContextEvent[]{return[{kind:'push-matrix'},{kind:'default-camera'},{kind:'ortho'},{kind:'pop-matrix'}];}
