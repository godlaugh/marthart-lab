import type {SceneOutput} from '../types';

/** One inventory owns transferable output storage and cache byte accounting. */
export function outputBuffers(output:SceneOutput):ArrayBuffer[]{
  const arrays=output.type==='raster'?[output.pixels]:[
    output.positions,output.indices,output.meshEdges,output.colors,output.pointAlphas,output.particleIds,output.sourceMeshColors,output.sourceMeshWireframe?.positions,
    output.surfaceGrid?.vertexIndices,output.surfaceGrid?.cellTriangles,
    output.surfaceWireframe?.positions,output.surfaceWireframe?.indices,
    ...(output.lineOverlays?.map(line=>line.positions)??[]),
    output.trails?.positions,output.trails?.colors,output.trails?.alphas,output.trails?.indices,
  ];
  return [...new Set(arrays.filter(value=>value!==undefined).map(value=>value!.buffer as ArrayBuffer))];
}
