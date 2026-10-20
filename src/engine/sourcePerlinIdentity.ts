import type {SourcePerlinDocumentPayload} from './sourcePerlinDocument';
import type {SourcePerlinCpuDocumentPayload} from './sourcePerlinCpuDocument';
import type {SourcePerlinGpuDocumentPayload} from './sourcePerlinGpuDocument';
type PerlinScene={kind:string;perlinSource?:SourcePerlinDocumentPayload;perlinCpuSource?:SourcePerlinCpuDocumentPayload;perlinGpuSource?:SourcePerlinGpuDocumentPayload};
type PerlinIdentity=Pick<PerlinScene,'kind'|'perlinSource'>&{perlinCpuSource?:unknown;perlinGpuSource?:unknown};
/** Source identity and active backend selection have one owner. Legacy single
 * backend projects remain readable without fabricating their missing settings. */
export function usesSourcePerlinCpu(scene:PerlinIdentity):boolean{return scene.kind==='perlin'&&(scene.perlinSource?scene.perlinSource.backend==='cpu':scene.perlinCpuSource!==undefined);}
export function usesSourcePerlinGpu(scene:PerlinIdentity):boolean{return scene.kind==='perlin'&&(scene.perlinSource?scene.perlinSource.backend==='gpu':scene.perlinGpuSource!==undefined);}
export function usesSourcePerlin(scene:PerlinIdentity):boolean{return scene.kind==='perlin'&&(scene.perlinSource!==undefined||scene.perlinCpuSource!==undefined||scene.perlinGpuSource!==undefined);}
/** Pure projections: available settings are independent of active backend.
 * Nested authored values are borrowed read-only by convention, not reparsed. */
export function sourcePerlinCpuConfiguration(scene:PerlinScene):SourcePerlinCpuDocumentPayload|undefined{
 if(scene.kind!=='perlin')return undefined;
 if(!scene.perlinSource)return scene.perlinCpuSource;
 const {backend:_backend,gpu:_gpu,...cpu}=scene.perlinSource;void _backend;void _gpu;return cpu;
}
export function sourcePerlinGpuConfiguration(scene:PerlinScene):SourcePerlinGpuDocumentPayload|undefined{
 if(scene.kind!=='perlin')return undefined;
 if(!scene.perlinSource)return scene.perlinGpuSource;
 const {seed,palette,parameters,cpuStyle,gpu}=scene.perlinSource;
 return {seed,palette,parameters,cpuStyle,...gpu};
}
