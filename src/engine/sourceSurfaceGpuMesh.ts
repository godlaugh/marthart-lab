/** Render facts from the native MeshSurface shape lifetime. Positions and
 * normals are evaluated by the GPU; topology and palette are shape-time data. */
export interface SourceSurfaceGpuMeshFrame {
 readonly model:'surface-gpu-mesh-1.7.8';
 readonly shapeGeneration:number;readonly shapeFunctionRevision:number;
 readonly seeds:Float32Array;
 readonly triangles:Uint32Array;
 readonly packedColors:Uint32Array;
 readonly functionBody:string;readonly parameters:Float32Array;
 readonly scale:readonly number[];readonly offset:readonly number[];
 readonly time:number;
 readonly uLimits:readonly [number,number];readonly vLimits:readonly [number,number];
 /** Geometric shouldWrap flags, independent of periodic tracking boundaries. */
 readonly periodic:readonly [number,number];readonly flowing:readonly [number,number];
 readonly twistedU:boolean;readonly twistedV:boolean;
 readonly fillEnabled:boolean;readonly fillOpacity:number;
 readonly wireframeEnabled:boolean;
 /** Native LINES with noStroke produces no visible primitives. */
 readonly wireframeDecoupled:boolean;
 readonly lineWeight:number;readonly wireframeColor:number;
 readonly referencePixelDensity?:number;
}
