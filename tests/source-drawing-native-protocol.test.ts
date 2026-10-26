import {describe,it,expect} from 'vitest';
import {encodeSourceNativeDrawingRequest,decodeSourceNativeDrawingResponse,type SourceNativeDrawingRequest} from '../src/engine/sourceDrawingNativeProtocol';
import {SOURCE_DRAWING_MAX_CHUNK_BYTES,sourceDrawingChunkPeak} from '../src/engine/sourceDrawingBudget';
// @ts-expect-error The Node gateway is outside the browser compilation unit.
import {inspectSourceFrameHeader} from '../server/source-renderer.mjs';
const resource='12'.repeat(16);
export const begin=():SourceNativeDrawingRequest=>({generation:1,sequence:2,width:2,height:2,samples:0,clear:[0,0,0,1],operation:{kind:'begin',resource,chunkCount:2,maxChunkBytes:4096,metadataBytes:4096,schedule:[{commandIndex:0,primitive:'triangles',rangeKind:'instances',total:2,passes:['both'],chunksPerPass:2,rangeSize:1}]}});
export const encoded=(request:SourceNativeDrawingRequest)=>{const r=encodeSourceNativeDrawingRequest(request);if(!r.ok)throw Error(r.error.reason);return r.value;};
export function response(request:SourceNativeDrawingRequest,index:number,chunks=2,disposition=0){const op=request.operation,bytes=new Uint8Array(64+(op.kind==='finish'?request.width*request.height*4:0)),v=new DataView(bytes.buffer);[5,{begin:1,append:2,finish:3,release:4}[op.kind]].forEach((n,i)=>v.setUint32(i*4,n,true));bytes.set(Buffer.from(resource,'hex'),8);[index,disposition,request.width,request.height,chunks,op.kind==='finish'?1:0].forEach((n,i)=>v.setUint32(24+i*4,n,true));return bytes;}
describe('retained generic drawing v13 codec',()=>{
 it('shares the 4 MiB declaration boundary with the Node gateway, including the first invalid byte',()=>{
  const r=begin();if(r.operation.kind!=='begin')throw Error();r.operation.maxChunkBytes=SOURCE_DRAWING_MAX_CHUNK_BYTES;
  expect(SOURCE_DRAWING_MAX_CHUNK_BYTES).toBe(4*1024*1024);
  const packet=encoded(r);expect(inspectSourceFrameHeader(packet)).toMatchObject({ok:true,value:{maximum:SOURCE_DRAWING_MAX_CHUNK_BYTES}});
  r.operation.maxChunkBytes++;expect(encodeSourceNativeDrawingRequest(r).ok).toBe(false);
  new DataView(packet.buffer,packet.byteOffset,packet.byteLength).setUint32(96,r.operation.maxChunkBytes,true);expect(inspectSourceFrameHeader(packet).ok).toBe(false);
 });
 it('keeps all nine packed/transport representations inside the unchanged joint budget',()=>{
  const r=begin();if(r.operation.kind!=='begin')throw Error();r.operation.maxChunkBytes=SOURCE_DRAWING_MAX_CHUNK_BYTES;
  const fixed=sourceDrawingChunkPeak({retainedBytes:0,frameBytes:r.width*r.height*(12+8*r.samples),metadataBytes:r.operation.metadataBytes,scheduleCount:r.operation.schedule.length,maxChunkBytes:SOURCE_DRAWING_MAX_CHUNK_BYTES});
  expect(encodeSourceNativeDrawingRequest(r,{retainedBytes:256*1024*1024-fixed}).ok).toBe(true);
  expect(encodeSourceNativeDrawingRequest(r,{retainedBytes:256*1024*1024-fixed+1})).toMatchObject({ok:false,error:{kind:'capacity'}});
 });
 it('preserves v13 frame identity and complete order through gateway admission',()=>{const r=begin(),packet=encoded(r);expect(new DataView(packet.buffer).getUint32(4,true)).toBe(13);expect(inspectSourceFrameHeader(packet)).toMatchObject({ok:true,value:{family:'drawing',resource,chunks:2,maximum:4096,operation:1,width:2,height:2}});});
 it('accepts clear-only empty plans and skipped zero draws with stable command indices',()=>{for(const middle of [false,true]){const r=begin();if(r.operation.kind!=='begin')throw Error();r.operation.schedule=middle?[{...r.operation.schedule[0],total:0,chunksPerPass:0}, {...r.operation.schedule[0],commandIndex:1}]:[];r.operation.chunkCount=middle?2:0;expect(inspectSourceFrameHeader(encoded(r))).toMatchObject({ok:true,value:{chunks:middle?2:0}});}});
 it('rejects total mismatch, noncontiguous command ids, excess capacity before packets',()=>{for(const change of ['count','command','budget']){const r=begin();if(r.operation.kind!=='begin')throw Error();if(change==='count')r.operation.chunkCount=3;if(change==='command')r.operation.schedule=[{...r.operation.schedule[0],commandIndex:2}];if(change==='budget')r.operation.metadataBytes=100_000_000;expect(encodeSourceNativeDrawingRequest(r).ok).toBe(false);}});
 it('checks actual total from the retained owner rather than trusting a response',()=>{const r={...begin(),operation:{kind:'finish' as const,resource,expectedIndex:2}};expect(decodeSourceNativeDrawingResponse(response(r,2),r,2).finished).toBe(true);expect(()=>decodeSourceNativeDrawingResponse(response(r,2,3),r,2)).toThrow();expect(()=>decodeSourceNativeDrawingResponse(response(r,1),r,2)).toThrow();});
 it('allows token-owned release after a lost append ACK, without claiming an absent owner advanced',()=>{const r={...begin(),operation:{kind:'release' as const,resource,expectedIndex:1}};expect(decodeSourceNativeDrawingResponse(response(r,2,2,1),r,2).index).toBe(2);expect(decodeSourceNativeDrawingResponse(response(r,0,0,2),r,2).disposition).toBe('absent');expect(()=>decodeSourceNativeDrawingResponse(response(r,1,0,2),r,2)).toThrow();});
});
