export type SourceNativeGpuStage='context'|'compile'|'link'|'allocation'|'render'|'readback';
export class SourceNativeError extends Error {
 constructor(readonly kind:string,message:string,readonly gpuStage?:SourceNativeGpuStage){super(message);this.name='SourceNativeError';}
}
