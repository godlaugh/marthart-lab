import {SOURCE_FRAME_BUDGET} from './sourceDrawingFrame';
import {SourceNativeError} from './sourceNativeError';

export const SOURCE_ROOTS_POINT_NATIVE_MAX_POINTS=3_000_000;
export const SOURCE_ROOTS_POINT_NATIVE_CHUNK_POINTS=65_536;
export const SOURCE_ROOTS_POINT_NATIVE_MAX_PACKET_BYTES=4*1024*1024;
export const SOURCE_ROOTS_POINT_NATIVE_ACK_BYTES=96;
export const SOURCE_ROOTS_POINT_NATIVE_VBO_BYTES=SOURCE_ROOTS_POINT_NATIVE_CHUNK_POINTS*16;
export const SOURCE_ROOTS_POINT_NATIVE_CONTROL_BYTES=1024*1024;
const integer=(n:number)=>Number.isSafeInteger(n)&&n>=0;
function demand(ok:unknown,message:string):asserts ok {if(!ok)throw new SourceNativeError('input',message);}
export function sourceRootsPointNativeDimensions(width:number,height:number):boolean {
 return integer(width)&&integer(height)&&width>0&&height>0&&width<=16384&&height<=16384&&width*height<=16_000_000;
}
/** Native representations, independent of the Worker's 10M-point ring. The
 * fixed VBO is allocated once at create; smaller chunks never change capacity. */
export function sourceRootsPointNativeResidentBytes(width:number,height:number,programBytes:number):number {
 demand(sourceRootsPointNativeDimensions(width,height)&&integer(programBytes),'Roots native target representation is invalid');
 return sourceRootsPointNativePeakBytes(0,width*height*4+1024+SOURCE_ROOTS_POINT_NATIVE_VBO_BYTES+SOURCE_ROOTS_POINT_NATIVE_CONTROL_BYTES+programBytes,0,0);
}
export function sourceRootsPointNativePeakBytes(retainedBytes:number,allocationBytes:number,packetBytes:number,responseBytes:number):number {
 demand([retainedBytes,allocationBytes,packetBytes,responseBytes].every(integer),'Roots native capacity inputs must be nonnegative safe integers');
 const bytes=retainedBytes+allocationBytes+packetBytes*8+responseBytes*4;
 if(!integer(bytes)||bytes>SOURCE_FRAME_BUDGET)throw new SourceNativeError('capacity','Roots native targets, protocol copies and readback exceed 256 MiB');
 return bytes;
}
/** Call before allocating the independent upload array. maximumPoints already
 * contains the shared producer's device/8M-footprint limit. No points are lost. */
export function sourceRootsPointNativeChunkPlan(retainedBytes:number,maximumPoints:number,remainingPoints:number):Readonly<{count:number;packetBytes:number}> {
 demand(integer(retainedBytes)&&integer(maximumPoints)&&maximumPoints>0&&maximumPoints<=SOURCE_ROOTS_POINT_NATIVE_CHUNK_POINTS&&integer(remainingPoints)&&remainingPoints>0,'Roots native chunk limits are invalid');
 sourceRootsPointNativePeakBytes(retainedBytes,0,128,SOURCE_ROOTS_POINT_NATIVE_ACK_BYTES);
 const available=Math.floor((SOURCE_FRAME_BUDGET-retainedBytes-SOURCE_ROOTS_POINT_NATIVE_ACK_BYTES*4)/8);
 const count=Math.min(maximumPoints,remainingPoints,Math.floor((Math.min(available,SOURCE_ROOTS_POINT_NATIVE_MAX_PACKET_BYTES)-112)/16));
 demand(count>0,'Roots native chunk has no complete point');
 const packetBytes=112+count*16;sourceRootsPointNativePeakBytes(retainedBytes,0,packetBytes,SOURCE_ROOTS_POINT_NATIVE_ACK_BYTES);
 return Object.freeze({count,packetBytes});
}
