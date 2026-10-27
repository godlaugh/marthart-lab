import type {RootsPointChunkPlan,RootsPointFrameMetadata,RootsPointPrograms} from './rootsPointCloudDrawing';
import type {SourceNativePixels} from './sourceNativeClient';

export type RootsPointCloudTarget='primary'|'offscreen';
export interface RootsPointCloudDeviceFacts {readonly pointSizeRange:readonly[number,number];}
export interface RootsPointCloudAsyncDisplay {
 readonly metadata:RootsPointFrameMetadata;
 /** Worker-owned borrowed ring schedule. Consume one independently allocated
  * chunk, await its ACK, assertCurrent, then request the next. Never transfer
  * ring storage or use the synchronous WebGL staging option. */
 readonly chunks:RootsPointChunkPlan;
 /** Worker representations only. Do not pass the 160MB ring to the page/native
  * 256MiB budget, which owns its own target/packet/output representations. */
 readonly workerRetainedBytes:number;
 readonly isCancelled?:()=>boolean;
}
export interface RootsPointCloudAsyncReceipt extends SourceNativePixels {readonly displayIndex:number;}
/** Session-side backend, normally bridged by the Worker to page-owned tokens.
 * Completion transfers one top-down RGBA buffer to the session. It must await
 * each submitted ACK even after cancellation; release never inherits a cancelled
 * request signal. Page/native resource custody remains with the backend. */
export interface RootsPointCloudAsyncBackend {
 initialize(target:RootsPointCloudTarget,size:{width:number;height:number},programs:RootsPointPrograms):Promise<RootsPointCloudDeviceFacts>;
 display(target:RootsPointCloudTarget,input:RootsPointCloudAsyncDisplay):Promise<RootsPointCloudAsyncReceipt>;
 release(target?:RootsPointCloudTarget):Promise<void>;
 settle():Promise<void>;
}
