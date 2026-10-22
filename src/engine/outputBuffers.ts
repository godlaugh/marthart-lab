import type {SceneOutput} from '../types';

/** One inventory owns transferable output storage and cache byte accounting. */
export function outputBuffers(output:SceneOutput):ArrayBuffer[]{
  const arrays=output.type==='raster'?[output.pixels]:[
    output.sourceGpuMesh?.seeds,output.sourceGpuMesh?.triangles,output.sourceGpuMesh?.packedColors,output.sourceGpuMesh?.parameters,
    output.sourceGpuPoints?.seeds,output.sourceGpuPoints?.tint,output.sourceGpuPoints?.parameters,
    output.positions,output.indices,output.meshEdges,output.colors,output.pointAlphas,output.particleIds,output.sourceMeshColors,output.sourceMeshWireframe?.positions,
    output.sourceImplicitMesh?.normals,output.sourceImplicitPresentation?.fillColors,output.sourceImplicitPresentation?.wire?.positions,output.sourceImplicitPresentation?.wire?.colors,output.sourceImplicitPresentation?.wire?.alphas,
    output.surfaceGrid?.vertexIndices,output.surfaceGrid?.cellTriangles,
    output.surfaceWireframe?.positions,output.surfaceWireframe?.indices,
    ...(output.lineOverlays?.map(line=>line.positions)??[]),
    output.trails?.positions,output.trails?.colors,output.trails?.alphas,output.trails?.indices,
  ];
  return [...new Set(arrays.filter(value=>value!==undefined).map(value=>value!.buffer as ArrayBuffer))];
}

/** Snapshot storage validity before publication. Zero-length arrays can be
 * legitimate (GPU geometry), so later byte lengths alone cannot detect detach. */
export function outputTransferState(output:SceneOutput):{intact:()=>boolean}{
 const buffers=outputBuffers(output).map(buffer=>({buffer,bytes:buffer.byteLength}));
 return{intact:()=>{try{return buffers.every(({buffer,bytes})=>{if(buffer.byteLength!==bytes)return false;new Uint8Array(buffer,0,0);return true;});}catch{return false;}}};
}
