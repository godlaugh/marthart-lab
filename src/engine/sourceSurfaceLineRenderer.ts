import type {SourceCameraPlan} from './sourceCamera';
import type {SourceSurfaceMeshWireframeFrame} from './sourceSurfaceMeshWireframe';
import {createSourceProcessingLines} from './sourceProcessingLineRenderer';

/** Mesh wireframe has a uniform packed stroke and retains depth testing. The
 * shared Processing owner supplies tessellation, shaders and resource cleanup. */
export function createSourceSurfaceMeshLines(frame:SourceSurfaceMeshWireframeFrame,plan:SourceCameraPlan,displayOpacity=1) {
 const mesh=createSourceProcessingLines({positions:frame.positions,lineWidth:frame.lineWidth,color:{kind:'packed',packed:frame.packedColor}},plan,displayOpacity);
 mesh.userData.sourceSurfaceMeshLines=true;return mesh;
}
