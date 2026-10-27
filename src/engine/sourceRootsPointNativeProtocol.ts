import {SOURCE_FRAME_MAGIC,SOURCE_FRAME_BUDGET} from './sourceDrawingFrame';
import type {SourceDrawingResult,SourceDrawingUniform} from './sourceDrawingSnapshot';
import type {RootsPointPrograms,RootsPointFrameMetadata} from './rootsPointCloudDrawing';
import {SourceNativeError} from './sourceNativeError';
import {SOURCE_ROOTS_POINT_NATIVE_ACK_BYTES,SOURCE_ROOTS_POINT_NATIVE_CHUNK_POINTS,SOURCE_ROOTS_POINT_NATIVE_MAX_PACKET_BYTES,SOURCE_ROOTS_POINT_NATIVE_MAX_POINTS,sourceRootsPointNativeDimensions,sourceRootsPointNativePeakBytes,sourceRootsPointNativeResidentBytes} from './sourceRootsPointNativeBudget';
export * from './sourceRootsPointNativeBudget';

export const SOURCE_ROOTS_POINT_NATIVE_VERSION=15;
export const SOURCE_ROOTS_POINT_NATIVE_FAMILY=7;
/** Logical response binding only; append/finish do not repeat this on wire. */
export interface SourceRootsPointNativeFrameSchedule {rangeCounts:readonly number[];chunkPoints:number;clear:boolean;fade:boolean;}
export type SourceRootsPointNativeOperation=
 | {kind:'create';resource:string;session:string;target:'primary'|'offscreen';programs:RootsPointPrograms}
 | {kind:'begin';resource:string;expectedDisplay:number;chunkPoints:number;rangeCounts:readonly number[];metadata:RootsPointFrameMetadata}
 | {kind:'append';resource:string;expectedDisplay:number;ordinal:number;rangeIndex:number;rangeOffset:number;points:Float32Array;frame:SourceRootsPointNativeFrameSchedule}
 | {kind:'finish';resource:string;expectedDisplay:number;frame:SourceRootsPointNativeFrameSchedule}
 | {kind:'release';resource:string};
export interface SourceRootsPointNativeRequest {generation:number;sequence:number;width:number;height:number;operation:SourceRootsPointNativeOperation;}
export interface SourceRootsPointNativeResponse {
 resource:string;displayIndex:number;disposition:'owned'|'released'|'absent';width:number;height:number;phase:'idle'|'active'|'failed';
 receivedPoints:number;totalPoints:number;nextChunk:number;totalChunks:number;pointDraws:number;fadeDraws:number;clears:number;
 pointSizeRange:readonly[number,number];profile:0|1;pixels?:Uint8ClampedArray;
}
export interface SourceRootsPointNativeResponseBinding {
 readonly kind:SourceRootsPointNativeOperation['kind'];readonly resource:string;readonly width:number;readonly height:number;
 readonly displayIndex?:number;readonly phase?:'idle'|'active';readonly receivedPoints?:number;readonly totalPoints?:number;
 readonly nextChunk?:number;readonly totalChunks?:number;readonly pointDraws?:number;readonly fadeDraws?:number;readonly clears?:number;
}
export interface SourceRootsPointNativeSchedule {
 readonly range0:number;readonly range1:number;readonly rangeCount:number;readonly chunkPoints:number;
 readonly totalPoints:number;readonly totalChunks:number;
}
const kinds={create:1,begin:2,append:3,finish:4,release:5} as const;
const bindings=new WeakSet<object>(),encoder=new TextEncoder();
const littleEndian=new Uint8Array(new Uint32Array([0x01020304]).buffer)[0]===4;
const uint=(n:number)=>Number.isInteger(n)&&n>=0&&n<=0xffffffff;
const token=(s:string)=>typeof s==='string'&&/^[a-f0-9]{32}$/.test(s)&&s!=='0'.repeat(32);
function demand(ok:unknown,message:string):asserts ok {if(!ok)throw new SourceNativeError('input',message);}
function fields(value:unknown,allowed:readonly string[],required:readonly string[]=allowed):void {
 demand(value!==null&&typeof value==='object'&&!Array.isArray(value),'Roots native record is invalid');
 for(const key of Reflect.ownKeys(value)){demand(typeof key==='string'&&allowed.includes(key),'Unknown Roots native field');const d=Object.getOwnPropertyDescriptor(value,key);demand(d&&!d.get&&!d.set,'Roots native fields must be data');}
 for(const key of required)demand(Object.hasOwn(value,key),'Missing Roots native field');
}
function textSize(value:string):number {
 demand(typeof value==='string'&&value.length>0,'Roots native text is empty');let bytes=0;
 for(let i=0;i<value.length;i++){
  const c=value.charCodeAt(i);demand(c!==0,'Roots native text contains NUL');
  if(c>=0xd800&&c<=0xdbff){const low=value.charCodeAt(++i);demand(low>=0xdc00&&low<=0xdfff,'Roots native text contains invalid Unicode');bytes+=4;}
  else{demand(c<0xdc00||c>0xdfff,'Roots native text contains invalid Unicode');bytes+=c<128?1:c<2048?2:3;}
  if(bytes>SOURCE_FRAME_BUDGET)throw new SourceNativeError('capacity','Roots native metadata exceeds representation capacity');
 }return bytes;
}
function programSources(programs:RootsPointPrograms):readonly string[] {
 fields(programs,['point','fade']);fields(programs.point,['vertex','fragment']);fields(programs.fade,['vertex','fragment']);
 return[programs.point.vertex,programs.point.fragment,programs.fade.vertex,programs.fade.fragment];
}
export function sourceRootsPointNativeProgramBytes(programs:RootsPointPrograms):number {
 let bytes=0;for(const text of programSources(programs)){demand(typeof text==='string'&&text.startsWith('#version 410 core\n'),'Roots native program requires explicit GL410 profile');bytes+=textSize(text)*3;}
 sourceRootsPointNativePeakBytes(0,bytes,0,0);return bytes;
}
export function sourceRootsPointNativeSchedule(rangeCounts:readonly number[],chunkPoints:number):SourceRootsPointNativeSchedule {
 demand(Array.isArray(rangeCounts)&&rangeCounts.length<=2&&uint(chunkPoints)&&chunkPoints>0&&chunkPoints<=SOURCE_ROOTS_POINT_NATIVE_CHUNK_POINTS,'Roots native schedule shape is invalid');
 let totalPoints=0,totalChunks=0;
 for(let i=0;i<rangeCounts.length;i++){const count=rangeCounts[i];demand(Object.hasOwn(rangeCounts,i)&&uint(count)&&count>0,'Roots native range must contain positive counts');totalPoints+=count;totalChunks+=Math.ceil(count/chunkPoints);}
 demand(totalPoints<=SOURCE_ROOTS_POINT_NATIVE_MAX_POINTS,'Roots native recent window exceeds 3M points');
 return Object.freeze({range0:rangeCounts[0]??0,range1:rangeCounts[1]??0,rangeCount:rangeCounts.length,chunkPoints,totalPoints,totalChunks});
}
export function sourceRootsPointNativeScheduleChunk(schedule:SourceRootsPointNativeSchedule,ordinal:number):Readonly<{rangeIndex:number;rangeOffset:number;count:number;receivedPoints:number}> {
 const canonical=sourceRootsPointNativeSchedule(schedule.rangeCount===0?[]:schedule.rangeCount===1?[schedule.range0]:[schedule.range0,schedule.range1],schedule.chunkPoints);
 demand(canonical.rangeCount===schedule.rangeCount&&canonical.totalPoints===schedule.totalPoints&&canonical.totalChunks===schedule.totalChunks&&uint(ordinal)&&ordinal<canonical.totalChunks,'Roots native chunk ordinal is outside the complete schedule');
 const firstChunks=Math.ceil(schedule.range0/schedule.chunkPoints),rangeIndex=ordinal<firstChunks?0:1,local=rangeIndex===0?ordinal:ordinal-firstChunks;
 const rangeOffset=local*schedule.chunkPoints,count=Math.min(schedule.chunkPoints,(rangeIndex===0?schedule.range0:schedule.range1)-rangeOffset);
 return Object.freeze({rangeIndex,rangeOffset,count,receivedPoints:(rangeIndex===0?0:schedule.range0)+rangeOffset+count});
}
function frameSchedule(frame:SourceRootsPointNativeFrameSchedule):SourceRootsPointNativeSchedule {
 fields(frame,['rangeCounts','chunkPoints','clear','fade']);demand(typeof frame.clear==='boolean'&&typeof frame.fade==='boolean','Roots native frame flags are invalid');return sourceRootsPointNativeSchedule(frame.rangeCounts,frame.chunkPoints);
}
export function sourceRootsPointNativeFrameSchedule(op:Extract<SourceRootsPointNativeOperation,{kind:'begin'}>):SourceRootsPointNativeFrameSchedule {
 sourceRootsPointNativeSchedule(op.rangeCounts,op.chunkPoints);
 return Object.freeze({rangeCounts:Object.freeze([...op.rangeCounts]),chunkPoints:op.chunkPoints,clear:op.metadata.clear!==undefined,fade:op.metadata.fade!==undefined});
}
function shape(request:SourceRootsPointNativeRequest):SourceRootsPointNativeOperation {
 fields(request,['generation','sequence','width','height','operation']);demand(uint(request.generation)&&request.generation>0&&uint(request.sequence)&&request.sequence>0&&sourceRootsPointNativeDimensions(request.width,request.height),'Roots native envelope identity or dimensions are invalid');
 const op=request.operation;demand(op&&typeof op==='object'&&Object.hasOwn(kinds,op.kind)&&token(op.resource),'Roots native operation/resource is invalid');
 const base=['kind','resource'];
 if(op.kind==='create'){fields(op,[...base,'session','target','programs']);demand(token(op.session)&&(op.target==='primary'||op.target==='offscreen'),'Roots native session/target is invalid');}
 else if(op.kind==='release'){fields(op,base);demand(request.width===1&&request.height===1,'Roots native release must be 1x1');}
 else{
  const extra=op.kind==='begin'?['chunkPoints','rangeCounts','metadata']:op.kind==='append'?['ordinal','rangeIndex','rangeOffset','points','frame']:['frame'];fields(op,[...base,'expectedDisplay',...extra]);
  demand(uint(op.expectedDisplay)&&op.expectedDisplay<0xffffffff,'Roots native display checkpoint is exhausted or invalid');
 }
 return op;
}
/** Capture only immutable scalars; no caller arrays/operation object survive
 * the await. Encoding validates the point payload once, without rescanning XYZ. */
export function captureSourceRootsPointNativeResponseBinding(request:SourceRootsPointNativeRequest):SourceRootsPointNativeResponseBinding {
 const op=shape(request);let b:SourceRootsPointNativeResponseBinding={kind:op.kind,resource:op.resource,width:request.width,height:request.height};
 if(op.kind==='create')b={...b,displayIndex:0,phase:'idle',receivedPoints:0,totalPoints:0,nextChunk:0,totalChunks:0,pointDraws:0,fadeDraws:0,clears:0};
 else if(op.kind!=='release'){
  if(op.kind==='begin'){fields(op.metadata,['clear','fade','palette','uniforms'],['palette','uniforms']);demand(op.expectedDisplay!==0||op.metadata.clear!==undefined,'Roots native first display requires an explicit clear');}
  const s=op.kind==='begin'?sourceRootsPointNativeSchedule(op.rangeCounts,op.chunkPoints):frameSchedule(op.frame);
  const clear=op.kind==='begin'?op.metadata.clear!==undefined:op.frame.clear,fade=op.kind==='begin'?op.metadata.fade!==undefined:op.frame.fade;
  let receivedPoints=0,nextChunk=0;
  if(op.kind==='append'){
   demand(op.points instanceof Float32Array&&op.points.buffer instanceof ArrayBuffer&&op.points.length>0&&op.points.length%4===0,'Roots native point block is invalid');
   const c=sourceRootsPointNativeScheduleChunk(s,op.ordinal);demand(op.rangeIndex===c.rangeIndex&&op.rangeOffset===c.rangeOffset&&op.points.length/4===c.count,'Roots native append does not match the complete range schedule');receivedPoints=c.receivedPoints;nextChunk=op.ordinal+1;
  }else if(op.kind==='finish'){receivedPoints=s.totalPoints;nextChunk=s.totalChunks;}
  b={...b,displayIndex:op.expectedDisplay+(op.kind==='finish'?1:0),phase:op.kind==='finish'?'idle':'active',receivedPoints,totalPoints:s.totalPoints,nextChunk,totalChunks:s.totalChunks,pointDraws:nextChunk,fadeDraws:fade?1:0,clears:clear?1:0};
 }
 Object.freeze(b);bindings.add(b);return b;
}
const uniformTypes={projection:'mat4',modelview:'mat4',pointSize:'float',rotationDegrees:'float',scaleVec:'vec3',offsetVec:'vec3',brightness:'float',contrast:'float',gamma:'float',dynamicRange:'float',saturation:'float',paletteOffset:'float',backgroundRgb:'vec3',paletteTex:'sampler2d'} as const;
const codes={float:1,vec3:5,mat4:7,sampler2d:9} as const;
function uniformTable(uniforms:readonly SourceDrawingUniform[]):number {
 demand(Array.isArray(uniforms)&&uniforms.length===14,'Roots native requires the complete 14 uniform bindings');const names=new Set<string>();let bytes=4;
 for(const u of uniforms){
  demand(u&&typeof u.name==='string'&&Object.hasOwn(uniformTypes,u.name)&&!names.has(u.name)&&u.kind===uniformTypes[u.name as keyof typeof uniformTypes],'Roots native uniform identity/type is invalid');names.add(u.name);
  fields(u,u.kind==='sampler2d'?['name','kind','texture']:['name','kind','count','values']);bytes+=4+textSize(u.name)+4;
  if(u.kind==='sampler2d'){demand(u.texture===0,'Roots native palette sampler must use unit0');bytes+=4;}
  else{
   const components=u.kind==='mat4'?16:u.kind==='vec3'?3:1;
   demand(u.count===1&&u.values instanceof Float32Array&&u.values.buffer instanceof ArrayBuffer&&u.values.length===components&&u.values.every(Number.isFinite),'Roots native uniform requires finite F32 values of its exact shape');bytes+=8+u.values.byteLength;
  }
 }
 return bytes;
}
function color(value:readonly[number,number,number,number]|undefined):void {
 if(value===undefined)return;demand(Array.isArray(value)&&value.length===4,'Roots native clear/fade color must have four components');
 for(let i=0;i<4;i++)demand(Object.hasOwn(value,i)&&typeof value[i]==='number'&&Number.isFinite(Math.fround(value[i]))&&value[i]>=0&&value[i]<=1,'Roots native clear/fade color is invalid');
}
export function sourceRootsPointNativeResponseBytes(binding:SourceRootsPointNativeResponseBinding):number {
 if(!bindings.has(binding))throw new SourceNativeError('protocol','Roots native response binding was not captured by its codec');
 return SOURCE_ROOTS_POINT_NATIVE_ACK_BYTES+(binding.kind==='finish'?binding.width*binding.height*4:0);
}
function prepareRequest(request:SourceRootsPointNativeRequest,options:{retainedBytes?:number}):{op:SourceRootsPointNativeOperation;size:number} {
  fields(options,['retainedBytes'],[]);const binding=captureSourceRootsPointNativeResponseBinding(request),op=request.operation,retained=options.retainedBytes??0;demand(Number.isSafeInteger(retained)&&retained>=0,'Roots native retained byte count is invalid');
  let size=88,growth=0;
  if(op.kind==='create'){const programs=sourceRootsPointNativeProgramBytes(op.programs);size+=28+16+programs/3;growth=sourceRootsPointNativeResidentBytes(request.width,request.height,programs);}
  else if(op.kind==='begin'){
   color(op.metadata.clear);color(op.metadata.fade);demand(op.metadata.palette instanceof Uint8Array&&op.metadata.palette.buffer instanceof ArrayBuffer&&op.metadata.palette.byteLength===1024,'Roots native palette must be 256 RGBA8 texels');
   size+=16+op.rangeCounts.length*4+32+4+1024+uniformTable(op.metadata.uniforms);
  }else if(op.kind==='append'){
   for(let i=3;i<op.points.length;i+=4){const metric=op.points[i];demand(Number.isFinite(metric)&&metric>=0&&metric<=1,'Roots native uploaded metric must be finite and clamped');}
   size=112+op.points.byteLength;
  }else if(op.kind==='finish')size+=4;
  if(op.kind==='append'&&size>SOURCE_ROOTS_POINT_NATIVE_MAX_PACKET_BYTES)throw new SourceNativeError('capacity','Roots native append packet exceeds 4 MiB');
  const resident=op.kind==='release'?0:op.kind==='create'?retained:Math.max(retained,sourceRootsPointNativeResidentBytes(request.width,request.height,0));
  sourceRootsPointNativePeakBytes(resident,growth,size,sourceRootsPointNativeResponseBytes(binding));
  if(op.kind==='begin'){
   // All stages must fit before clear/fade changes history. These are
   // separate peaks, not simultaneous allocations or a truncated window.
   const largestChunk=Math.min(op.chunkPoints,Math.max(0,...op.rangeCounts));
   if(largestChunk)sourceRootsPointNativePeakBytes(resident,0,112+16*largestChunk,96);
   sourceRootsPointNativePeakBytes(resident,0,92,96+request.width*request.height*4);
  }
  return{op,size};
}
/** Allocation-free preflight for the resource owner. Mutable caller input is
 * still validated afresh when the transport actually encodes it. */
export function admitSourceRootsPointNativeRequest(request:SourceRootsPointNativeRequest,options:{retainedBytes?:number}={}):SourceDrawingResult<void> {
 try{prepareRequest(request,options);return{ok:true,value:undefined};}
 catch(error){if(error instanceof SourceNativeError&&(error.kind==='input'||error.kind==='capacity'))return{ok:false,error:{kind:error.kind,path:['roots-point'],reason:error.message}};throw error;}
}
export function encodeSourceRootsPointNativeRequest(request:SourceRootsPointNativeRequest,options:{retainedBytes?:number}={}):SourceDrawingResult<Uint8Array> {
 try{
  const {op,size}=prepareRequest(request,options);
  const out=new Uint8Array(size),view=new DataView(out.buffer);let at=0;
  const word=(n:number)=>{view.setUint32(at,n,true);at+=4;},float=(n:number)=>{view.setFloat32(at,n,true);at+=4;};
  const raw=(bytes:Uint8Array)=>{word(bytes.byteLength);out.set(bytes,at);at+=bytes.byteLength;};
  const words=(values:Float32Array)=>{
   word(values.byteLength);
   // Copy IEEE-754 storage, not numeric values: preserve NaN payloads and -0.
   if(littleEndian){out.set(new Uint8Array(values.buffer,values.byteOffset,values.byteLength),at);at+=values.byteLength;}
   else{const bits=new Uint32Array(values.buffer,values.byteOffset,values.length);for(const v of bits)word(v);}
  };
  const text=(value:string)=>{const bytes=textSize(value);word(bytes);const result=encoder.encodeInto(value,out.subarray(at,at+bytes));demand(result.read===value.length&&result.written===bytes,'Roots native UTF-8 encoding is incomplete');at+=bytes;};
  const resource=(value:string)=>{word(16);for(let i=0;i<32;i+=2)out[at++]=parseInt(value.slice(i,i+2),16);};
  word(SOURCE_FRAME_MAGIC);word(15);word(size);word(request.generation);word(request.sequence);word(request.width);word(request.height);for(let i=0;i<8;i++)word(0);word(7);word(kinds[op.kind]);resource(op.resource);
  if(op.kind==='create'){resource(op.session);word(op.target==='primary'?1:2);word(1);for(const source of programSources(op.programs))text(source);}
  else if(op.kind==='begin'){
   word(op.expectedDisplay);word((op.metadata.clear?1:0)|(op.metadata.fade?2:0));word(op.chunkPoints);word(op.rangeCounts.length);for(const count of op.rangeCounts)word(count);
   for(const v of op.metadata.clear??[0,0,0,0])float(v);for(const v of op.metadata.fade??[0,0,0,0])float(v);raw(op.metadata.palette);word(op.metadata.uniforms.length);
   for(const u of op.metadata.uniforms){text(u.name);word(codes[u.kind as keyof typeof codes]);if(u.kind==='sampler2d')word(u.texture);else{word(u.count);words(u.values as Float32Array);}}
  }else if(op.kind==='append'){word(op.expectedDisplay);word(op.ordinal);word(op.rangeIndex);word(op.rangeOffset);word(op.points.length/4);words(op.points);}
  else if(op.kind==='finish')word(op.expectedDisplay);
  demand(at===size,'Roots native wire size differs from preflight');return{ok:true,value:out};
 }catch(error){if(error instanceof SourceNativeError&&(error.kind==='input'||error.kind==='capacity'))return{ok:false,error:{kind:error.kind,path:['roots-point'],reason:error.message}};throw error;}
}
/** The returned pixels borrow raw bytes and are still bottom-up. The transport
 * performs the one row conversion; the codec never changes alpha or color. */
export function decodeSourceRootsPointNativeResponse(raw:Uint8Array,binding:SourceRootsPointNativeResponseBinding):SourceRootsPointNativeResponse {
 function fail(ok:unknown,message:string):asserts ok {if(!ok)throw new SourceNativeError('protocol',message);}
 fail(bindings.has(binding),'Roots native response binding was not captured');fail(raw instanceof Uint8Array&&raw.buffer instanceof ArrayBuffer&&raw.byteLength===sourceRootsPointNativeResponseBytes(binding),'Roots native response byte coverage is invalid');
 const v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),u=(at:number)=>v.getUint32(at,true),resource=Array.from(raw.subarray(8,24),n=>n.toString(16).padStart(2,'0')).join('');
 fail(u(0)===7&&u(4)===kinds[binding.kind]&&resource===binding.resource,'Roots native response identity differs');fail(u(84)===0&&u(88)===0&&u(92)===0,'Roots native ACK reserved fields are nonzero');
 const displayIndex=u(24),disposition=u(28),width=u(32),height=u(36),phase=u(40),receivedPoints=u(44),totalPoints=u(48),nextChunk=u(52),totalChunks=u(56),pointDraws=u(60),fadeDraws=u(64),clears=u(68),min=v.getFloat32(72,true),max=v.getFloat32(76,true),profile=u(80);
 fail(disposition<=2&&phase<=2&&[receivedPoints,totalPoints,nextChunk,totalChunks,pointDraws].every(n=>n<=SOURCE_ROOTS_POINT_NATIVE_MAX_POINTS)&&fadeDraws<=1&&clears<=1,'Roots native ACK counters are impossible');
 if(disposition===2){
  fail(binding.kind==='release'&&displayIndex===0&&width===1&&height===1&&phase===0&&receivedPoints===0&&totalPoints===0&&nextChunk===0&&totalChunks===0&&pointDraws===0&&fadeDraws===0&&clears===0&&Object.is(min,0)&&Object.is(max,0)&&profile===0,'Roots native absent ACK contains retained facts');
 }else{
  const deviceShape=Number.isFinite(min)&&Number.isFinite(max)&&(binding.kind==='release'||min>0&&max>=min&&max>=1);
  fail(sourceRootsPointNativeDimensions(width,height)&&deviceShape&&profile===1,'Roots native retained target/device facts are invalid');
  if(binding.kind==='release')fail(disposition===1,'Roots native release did not release its resource');
  else{
   fail(disposition===0&&width===binding.width&&height===binding.height&&displayIndex===binding.displayIndex&&phase===(binding.phase==='idle'?0:1),'Roots native target/checkpoint differs');
   fail(receivedPoints===binding.receivedPoints&&totalPoints===binding.totalPoints&&nextChunk===binding.nextChunk&&totalChunks===binding.totalChunks&&pointDraws===binding.pointDraws&&fadeDraws===binding.fadeDraws&&clears===binding.clears,'Roots native response does not cover the admitted display schedule');
  }
 }
 return{resource,displayIndex,disposition:disposition===0?'owned':disposition===1?'released':'absent',width,height,phase:phase===0?'idle':phase===1?'active':'failed',receivedPoints,totalPoints,nextChunk,totalChunks,pointDraws,fadeDraws,clears,pointSizeRange:Object.freeze([min,max] as const),profile:profile as 0|1,...(binding.kind==='finish'?{pixels:new Uint8ClampedArray(raw.buffer,raw.byteOffset+96,width*height*4)}:{})};
}
