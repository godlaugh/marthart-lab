/** Shared admission for bounded generic drawing. These are representation and
 * transport copy bounds, not measurements of browser/driver process RSS. */
export const SOURCE_DRAWING_CHUNK_ENVELOPE_BYTES=120;
export const SOURCE_DRAWING_CHUNK_PACKET_COPIES=8;
export const SOURCE_DRAWING_MAX_CHUNK_BYTES=4*1024*1024;
export const SOURCE_DRAWING_DEFAULT_CHUNK_BYTES=SOURCE_DRAWING_MAX_CHUNK_BYTES;
export const sourceDrawingChunkTransportBytes=(payloadBytes:number)=>SOURCE_DRAWING_CHUNK_PACKET_COPIES*(payloadBytes+SOURCE_DRAWING_CHUNK_ENVELOPE_BYTES);
export const sourceDrawingChunkMetadataBytes=(metadataBytes:number,scheduleCount:number)=>3*metadataBytes+512*scheduleCount;
interface ChunkStorage {retainedBytes:number;frameBytes:number;metadataBytes:number;scheduleCount:number;}
export function sourceDrawingChunkPeak(input:ChunkStorage&{maxChunkBytes:number}):number {
 return input.retainedBytes+input.frameBytes+sourceDrawingChunkMetadataBytes(input.metadataBytes,input.scheduleCount)+input.maxChunkBytes+sourceDrawingChunkTransportBytes(input.maxChunkBytes);
}
/** Invert the same copy bound before packing. The caller must also fit complete
 * declarations and at least one primitive within the returned byte ceiling. */
export function sourceDrawingChunkAvailableBytes(input:ChunkStorage,maxBytes:number):number {
 return Math.max(0,Math.floor((maxBytes-sourceDrawingChunkPeak({...input,maxChunkBytes:0}))/(1+SOURCE_DRAWING_CHUNK_PACKET_COPIES)));
}
