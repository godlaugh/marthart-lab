import {encodeSourceDrawingFrame,SOURCE_FRAME_BUDGET,SOURCE_FRAME_MAGIC,type SourceDrawingFrame} from './sourceDrawingFrame';
import type {SourceDrawingSnapshot,SourceDrawingResult} from './sourceDrawingSnapshot';
import {SourceNativeError} from './sourceNativeError';
import {sourceDrawingChunkPeak,SOURCE_DRAWING_CHUNK_ENVELOPE_BYTES,SOURCE_DRAWING_MAX_CHUNK_BYTES} from './sourceDrawingBudget';

export interface SourceNativeDrawingSchedule {commandIndex:number;primitive:'triangles';rangeKind:'instances'|'vertices'|'draw';total:number;passes:readonly ('front'|'back'|'both')[];chunksPerPass:number;rangeSize:number;}
export interface SourceNativeDrawingChunk {ordinal:number;commandIndex:number;passIndex:number;rangeKind:SourceNativeDrawingSchedule['rangeKind'];offset:number;count:number;total:number;drawing:SourceDrawingSnapshot;}
export type SourceNativeDrawingFrame=Pick<SourceDrawingFrame,'generation'|'sequence'|'width'|'height'|'samples'|'clear'|'completion'>;
export type SourceNativeDrawingOperation=
 | {kind:'begin';resource:string;chunkCount:number;maxChunkBytes:number;metadataBytes:number;schedule:readonly SourceNativeDrawingSchedule[]}
 | {kind:'append';resource:string;chunk:SourceNativeDrawingChunk}
 | {kind:'finish'|'release';resource:string;expectedIndex:number};
export type SourceNativeDrawingRequest=SourceNativeDrawingFrame&{operation:SourceNativeDrawingOperation};
export interface SourceNativeDrawingResponse {resource:string;index:number;disposition:'owned'|'released'|'absent';width:number;height:number;chunks:number;finished:boolean;pixels?:Uint8ClampedArray;}
const kinds={begin:1,append:2,finish:3,release:4} as const;
const ranges={instances:1,vertices:2,draw:3} as const;
const passes={both:0,front:1,back:2} as const;
const uint=(n:number)=>Number.isSafeInteger(n)&&n>=0&&n<=0xffffffff;
const demand=(ok:unknown,message:string)=>{if(!ok)throw new SourceNativeError('input',message);};
export function encodeSourceNativeDrawingRequest(request:SourceNativeDrawingRequest,options:{retainedBytes?:number;isCancelled?:()=>boolean}={}):SourceDrawingResult<Uint8Array>{
 try{
  const check=()=>{if(options.isCancelled?.())throw new SourceNativeError('cancelled','分块原生绘制已取消');};check();
  const {operation:op}=request;
  demand(op&&typeof op==='object'&&Object.hasOwn(kinds,op.kind),'未知分块帧操作');
  demand(uint(request.generation)&&request.generation>0&&uint(request.sequence)&&request.sequence>0,'分块帧身份无效');
  demand(uint(request.width)&&request.width>0&&request.width<=16384&&uint(request.height)&&request.height>0&&request.height<=16384&&request.width*request.height<=16_000_000&&uint(request.samples)&&request.samples<=0x7fffffff,'分块帧尺寸或采样无效');
  demand(request.clear.length===4&&request.clear.every(x=>Number.isFinite(x)&&x>=0&&x<=1)&&(!request.completion||request.completion==='opaque-alpha'&&request.clear[3]===1),'分块帧背景无效');
  demand(typeof op.resource==='string'&&/^[a-f0-9]{32}$/.test(op.resource)&&op.resource!=='0'.repeat(32),'分块帧资源身份无效');
  const retained=options.retainedBytes??0;demand(Number.isSafeInteger(retained)&&retained>=0,'分块帧保留容量无效');
  let body:Uint8Array|undefined,length=92;
  if(op.kind==='begin'){
   demand(uint(op.chunkCount)&&uint(op.maxChunkBytes)&&op.maxChunkBytes>0&&op.maxChunkBytes<=SOURCE_DRAWING_MAX_CHUNK_BYTES&&uint(op.metadataBytes)&&Array.isArray(op.schedule),'分块帧计划容量无效');
   let chunks=0;
   op.schedule.forEach((s,i)=>{demand(s.commandIndex===i&&s.primitive==='triangles'&&Object.hasOwn(ranges,s.rangeKind)&&uint(s.total)&&uint(s.rangeSize)&&s.rangeSize>0&&Array.isArray(s.passes)&&s.passes.length>=1&&s.passes.length<=2&&s.passes.every(p=>Object.hasOwn(passes,p))&&s.chunksPerPass===Math.ceil(s.total/s.rangeSize)&&(s.rangeKind!=='draw'||s.chunksPerPass===(s.total?1:0)),'分块帧完整顺序无效');chunks+=s.chunksPerPass*s.passes.length;});
   demand(chunks===op.chunkCount&&uint(chunks),'分块帧总块数不匹配');
   if(sourceDrawingChunkPeak({retainedBytes:retained,frameBytes:request.width*request.height*(12+8*request.samples),metadataBytes:op.metadataBytes,scheduleCount:op.schedule.length,maxChunkBytes:op.maxChunkBytes})>SOURCE_FRAME_BUDGET)throw new SourceNativeError('capacity','分块原生绘制超过 256 MiB 联合预算');
   length=108+op.schedule.reduce((n,s)=>n+28+4*s.passes.length,0);
  }else if(op.kind==='append'){
   const c=op.chunk;demand([c.ordinal,c.commandIndex,c.passIndex,c.offset,c.count,c.total].every(uint)&&c.count>0&&c.offset+c.count<=c.total&&Object.hasOwn(ranges,c.rangeKind)&&c.drawing.commands.length===1&&c.drawing.commands[0].passes.length===1,'分块绘制范围无效');
   const encoded=encodeSourceDrawingFrame({...request,width:1,height:1,samples:0,clear:[0,0,0,0],completion:undefined,drawing:c.drawing},{isCancelled:options.isCancelled});
   if(!encoded.ok)return encoded;body=encoded.value;
   if(body.length>SOURCE_DRAWING_MAX_CHUNK_BYTES)throw new SourceNativeError('capacity','单个分块协议超过 4 MiB');length=SOURCE_DRAWING_CHUNK_ENVELOPE_BYTES+body.length;
  }else demand(uint(op.expectedIndex),'分块帧检查点无效');
  if(length>SOURCE_DRAWING_MAX_CHUNK_BYTES+SOURCE_DRAWING_CHUNK_ENVELOPE_BYTES)throw new SourceNativeError('capacity','分块帧元数据超过容量');
  const out=new Uint8Array(length),v=new DataView(out.buffer);let at=0;
  const word=(n:number)=>{v.setUint32(at,n,true);at+=4;};
  [SOURCE_FRAME_MAGIC,13,length,request.generation,request.sequence,request.width,request.height].forEach(word);
  request.clear.forEach(n=>{v.setFloat32(at,n,true);at+=4;});
  [0,0,request.samples,request.completion?1:0,5,kinds[op.kind],16].forEach(word);
  out.set(Uint8Array.from(op.resource.match(/../g)!,x=>parseInt(x,16)),at);at+=16;
  if(op.kind==='begin'){
   [0,op.chunkCount,op.maxChunkBytes,op.metadataBytes,op.schedule.length].forEach(word);
   for(const s of op.schedule){[s.commandIndex,ranges[s.rangeKind],s.total,s.chunksPerPass,s.rangeSize,1,s.passes.length].forEach(word);s.passes.forEach(p=>word(passes[p]));}
  }else if(op.kind==='append'){
   const c=op.chunk;[c.ordinal,c.commandIndex,c.passIndex,ranges[c.rangeKind],c.offset,c.count,c.total,body!.length].forEach(word);out.set(body!,at);at+=body!.length;
  }else word(op.expectedIndex);
  demand(at===length,'分块帧编码长度变化');check();return{ok:true,value:out};
 }catch(error){if(error instanceof SourceNativeError)return{ok:false,error:{kind:['input','capacity','cancelled','unsupported'].includes(error.kind)?error.kind as 'input'|'capacity'|'cancelled'|'unsupported':'input',path:['drawing'],reason:error.message}};throw error;}
}
export function decodeSourceNativeDrawingResponse(bytes:Uint8Array,request:SourceNativeDrawingRequest,chunkCount:number):SourceNativeDrawingResponse{
 const op=request.operation,expectedBytes=64+(op.kind==='finish'?request.width*request.height*4:0);
 demand(bytes.length===expectedBytes,'分块原生响应长度无效');const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u=(at:number)=>v.getUint32(at,true);
 const resource=Array.from(bytes.subarray(8,24),x=>x.toString(16).padStart(2,'0')).join(''),index=u(24),disposition=u(28),chunks=u(40),finished=u(44);
 demand(u(0)===5&&u(4)===kinds[op.kind]&&resource===op.resource&&u(32)===request.width&&u(36)===request.height&&finished<=1&&bytes.subarray(48,64).every(x=>x===0),'分块原生响应身份无效');
 if(op.kind==='release')demand((disposition===1&&index>=op.expectedIndex&&index<=chunks&&chunks===chunkCount)||(disposition===2&&index===0&&chunks===0&&!finished),'分块原生释放未确认');
 else demand(disposition===0&&index===(op.kind==='begin'?0:op.kind==='append'?op.chunk.ordinal+1:op.expectedIndex)&&chunks===(op.kind==='begin'?op.chunkCount:chunkCount)&&index<=chunks&&finished===(op.kind==='finish'?1:0)&&(op.kind!=='finish'||index===chunks),'分块原生确认顺序无效');
 return{resource,index,disposition:disposition===0?'owned':disposition===1?'released':'absent',width:request.width,height:request.height,chunks,finished:!!finished,...(op.kind==='finish'?{pixels:new Uint8ClampedArray(bytes.buffer,bytes.byteOffset+64,bytes.length-64)}:{})};
}
