import {SOURCE_FRAME_BUDGET,SOURCE_FRAME_MAGIC} from './sourceDrawingFrame';
import type {SourceDrawingResult} from './sourceDrawingSnapshot';
import {SourceNativeError} from './sourceNativeError';
import {sourceAttractorGpuLayout,type SourceAttractorGpuPass,prepareSourceAttractorGpuDisplay} from './sourceAttractorGpuPrepared';

export const SOURCE_ATTRACTOR_NATIVE_VERSION=14;
export const SOURCE_ATTRACTOR_NATIVE_FAMILY=6;
export const SOURCE_ATTRACTOR_NATIVE_MAX_UPLOAD_BYTES=4*1024*1024;
export const SOURCE_ATTRACTOR_NATIVE_MAX_READ_BYTES=4*1024*1024;
/** Conservative control/owner representation reserve, not driver/RSS usage. */
export const SOURCE_ATTRACTOR_NATIVE_FIXED_BYTES=1024*1024;
export interface SourceAttractorNativePrograms {update:{vertex:string;fragment:string};accumulate:{vertex:string;fragment:string};present:{vertex:string;fragment:string};}
export interface SourceAttractorNativeCheckpoint {expectedIndex:number;expectedRenderIndex:number;expectedUploaded:number;expectedCount:number;expectedTexSize:number;}
export type SourceAttractorNativeDisplay=ReturnType<typeof prepareSourceAttractorGpuDisplay>;
export type SourceAttractorNativeOperation=
 | {kind:'create';resource:string;count:number;texSize:number;shaderOperations:number;programs:SourceAttractorNativePrograms}
 | ({kind:'upload';resource:string;offset:number;positions:Float32Array;texIndex:Float32Array;colors:Float32Array}&SourceAttractorNativeCheckpoint)
 | ({kind:'pass';resource:string;pass:SourceAttractorGpuPass}&SourceAttractorNativeCheckpoint)
 | ({kind:'render';resource:string;display:SourceAttractorNativeDisplay}&SourceAttractorNativeCheckpoint)
 | ({kind:'read';resource:string;target:'state'|'accumulation';offset:number;count:number}&SourceAttractorNativeCheckpoint)
 | {kind:'release';resource:string};
export interface SourceAttractorNativeRequest {generation:number;sequence:number;width:number;height:number;operation:SourceAttractorNativeOperation;}
export interface SourceAttractorNativeTarget {resource:string;width:number;height:number;accumWidth:number;accumHeight:number;}
export interface SourceAttractorNativeResponse {
 resource:string;disposition:'owned'|'released'|'absent';passIndex:number;renderIndex:number;uploaded:number;count:number;texSize:number;
 width:number;height:number;accumWidth:number;accumHeight:number;renderedPassIndex:number;
 target?:'state'|'accumulation';offset:number;readCount:number;pixels?:Uint8ClampedArray;records?:Uint8Array;
}
export interface SourceAttractorNativeResponseBinding {
 readonly kind:SourceAttractorNativeOperation['kind'];readonly resource:string;readonly width:number;readonly height:number;
 readonly passIndex?:number;readonly renderIndex?:number;readonly uploaded?:number;readonly count?:number;readonly texSize?:number;
 readonly accumWidth?:number;readonly accumHeight?:number;readonly target?:'state'|'accumulation';readonly offset:number;readonly readCount:number;
}
const operations={create:1,upload:2,pass:3,render:4,read:5,release:6} as const;
const encoder=new TextEncoder(),bindings=new WeakSet<object>();
const uint=(n:number)=>Number.isInteger(n)&&n>=0&&n<=0xffffffff;
const int=(n:number)=>Number.isInteger(n)&&n>=-2147483648&&n<=2147483647;
const dimensions=(w:number,h:number)=>uint(w)&&uint(h)&&w>0&&h>0&&w<=16384&&h<=16384&&w*h<=16_000_000;
function demand(v:unknown,reason:string):asserts v {if(!v)throw new SourceNativeError('input',reason);}
function capacity(n:number){if(!Number.isSafeInteger(n)||n<0||n>SOURCE_FRAME_BUDGET)throw new SourceNativeError('capacity','原生 GPU 吸引子表示超过 256 MiB 预算');}
/** Shared native representation accounting, also callable before allocating
 * canonical upload arrays. This is separate from the shared particle floor. */
export function sourceAttractorNativePeakBytes(retainedBytes:number,allocationBytes:number,packetBytes:number,responseBytes:number){
 demand([retainedBytes,allocationBytes,packetBytes,responseBytes].every(n=>Number.isSafeInteger(n)&&n>=0),'原生 GPU 表示容量无效');
 const peak=retainedBytes+allocationBytes+packetBytes*6+responseBytes*4;capacity(peak);return peak;
}
/** Select the next complete canonical segment without allocating its arrays.
 * Only transport chunk size changes with headroom; particle count/RNG do not. */
export function sourceAttractorNativeUploadPlan(count:number,texSize:number,offset:number,retainedBytes:number){
 const l=layout(count,texSize);demand(uint(offset)&&offset<l.texels,'原生 GPU 上传 cursor 无效');
 const remaining=l.texels-offset,real=Math.max(0,count-offset),minimum=real?40:16;
 sourceAttractorNativePeakBytes(retainedBytes,0,124+minimum,96);
 const ceiling=Math.min(SOURCE_ATTRACTOR_NATIVE_MAX_UPLOAD_BYTES,Math.floor((SOURCE_FRAME_BUDGET-retainedBytes-96*4)/6)-124);
 const attributes=Math.min(real,Math.floor(ceiling/40));
 const texels=attributes<real?attributes:Math.min(remaining,attributes+Math.floor((ceiling-attributes*40)/16));
 const payloadBytes=texels*16+attributes*24,packetBytes=124+payloadBytes;
 sourceAttractorNativePeakBytes(retainedBytes,0,packetBytes,96);
 return{texels,attributes,payloadBytes,packetBytes};
}
function layout(count:number,texSize:number){
 demand(uint(count)&&count>0&&uint(texSize)&&texSize>0&&texSize<=16384,'原生 GPU 吸引子粒子布局无效');
 try{const result=sourceAttractorGpuLayout(count);demand(result.size===texSize,'原生 GPU 吸引子 square 布局不符');return result;}
 catch(error){if(error instanceof SourceNativeError)throw error;throw new SourceNativeError('capacity','原生 GPU 吸引子粒子表示超过本地预算');}
}
function textBytes(value:string){
 demand(typeof value==='string'&&value.length>0&&value.startsWith('#version 410 core\n'),'原生 GPU shader 需要明确 desktop profile');let size=0;
 for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);demand(c!==0,'原生 GPU shader 不能含 NUL');if(c>=0xd800&&c<=0xdbff){const next=value.charCodeAt(++i);demand(next>=0xdc00&&next<=0xdfff,'原生 GPU shader Unicode 无效');size+=4;}else{demand(c<0xdc00||c>0xdfff,'原生 GPU shader Unicode 无效');size+=c<128?1:c<2048?2:3;}capacity(size);}
 return size;
}
const programSources=(p:SourceAttractorNativePrograms)=>{demand(p&&typeof p==='object'&&p.update&&p.accumulate&&p.present,'原生 GPU shader 集合无效');return[p.update.vertex,p.update.fragment,p.accumulate.vertex,p.accumulate.fragment,p.present.vertex,p.present.fragment];};
export function sourceAttractorNativeProgramBytes(programs:SourceAttractorNativePrograms){const bytes=programSources(programs).reduce((n,s)=>n+textBytes(s)*3,0);capacity(bytes);return bytes;}
export function sourceAttractorNativeResidentBytes(count:number,texSize:number,programBytes:number){const l=layout(count,texSize);demand(Number.isSafeInteger(programBytes)&&programBytes>=0,'原生 GPU shader 容量无效');const bytes=l.texels*32+count*24+programBytes+SOURCE_ATTRACTOR_NATIVE_FIXED_BYTES;capacity(bytes);return bytes;}
export function sourceAttractorNativeTargetBytes(width:number,height:number,accumWidth:number,accumHeight:number){demand(dimensions(width,height)&&dimensions(accumWidth,accumHeight),'原生 GPU 显示尺寸无效');const bytes=width*height*4+accumWidth*accumHeight*16;capacity(bytes);return bytes;}
function checkpoint(op:SourceAttractorNativeCheckpoint){const l=layout(op.expectedCount,op.expectedTexSize);demand(uint(op.expectedIndex)&&uint(op.expectedRenderIndex)&&uint(op.expectedUploaded)&&op.expectedUploaded<=l.texels,'原生 GPU 检查点无效');return l;}
function array(a:Float32Array,multiple:number,empty=false){demand(a instanceof Float32Array&&a.buffer instanceof ArrayBuffer&&(empty||a.length>0)&&a.length%multiple===0,'原生 GPU 上传数组无效');}
/** Immutable reply expectations only; never retains caller upload arrays. */
export function captureSourceAttractorNativeResponseBinding(request:SourceAttractorNativeRequest):SourceAttractorNativeResponseBinding {
 demand(request&&uint(request.generation)&&request.generation>0&&uint(request.sequence)&&request.sequence>0&&dimensions(request.width,request.height),'原生 GPU 请求身份或尺寸无效');
 const op=request.operation;demand(op&&Object.hasOwn(operations,op.kind)&&typeof op.resource==='string'&&/^[a-f0-9]{32}$/.test(op.resource)&&op.resource!=='0'.repeat(32),'原生 GPU 资源身份无效');
 demand(op.kind==='render'||request.width===1&&request.height===1,'原生 GPU 控制请求必须为 1×1');
 let value:SourceAttractorNativeResponseBinding={kind:op.kind,resource:op.resource,width:request.width,height:request.height,offset:0,readCount:0};
 if(op.kind==='create'){layout(op.count,op.texSize);demand(uint(op.shaderOperations)&&op.shaderOperations>0,'原生 GPU 工作量描述无效');value={...value,passIndex:0,renderIndex:0,uploaded:0,count:op.count,texSize:op.texSize};}
 else if(op.kind!=='release'){
  const l=checkpoint(op);value={...value,passIndex:op.expectedIndex,renderIndex:op.expectedRenderIndex,uploaded:op.expectedUploaded,count:op.expectedCount,texSize:op.expectedTexSize};
  if(op.kind==='upload'){
   array(op.positions,4);array(op.texIndex,2,true);array(op.colors,4,true);const n=op.positions.length/4,m=Math.min(n,Math.max(op.expectedCount-op.offset,0));
   demand(op.expectedIndex===0&&op.expectedRenderIndex===0&&uint(op.offset)&&op.offset===op.expectedUploaded&&n<=l.texels-op.offset&&op.texIndex.length===m*2&&op.colors.length===m*4,'原生 GPU 上传 cursor 或数组长度不符');
   demand(op.positions.byteLength+op.texIndex.byteLength+op.colors.byteLength<=SOURCE_ATTRACTOR_NATIVE_MAX_UPLOAD_BYTES,'原生 GPU 上传块超过 4 MiB');value={...value,uploaded:op.offset+n};
  }else{
   demand(op.expectedUploaded===l.texels,'原生 GPU 初始化上传尚未完成');
   if(op.kind==='pass'){demand(op.expectedIndex<0xffffffff,'原生 GPU pass 检查点耗尽');value={...value,passIndex:op.expectedIndex+1};}
   if(op.kind==='render'){demand(op.expectedRenderIndex<0xffffffff&&op.display?.layout?.width===request.width&&op.display?.layout?.height===request.height,'原生 GPU 显示目标不符');sourceAttractorNativeTargetBytes(request.width,request.height,op.display.layout.accumWidth,op.display.layout.accumHeight);value={...value,renderIndex:op.expectedRenderIndex+1,accumWidth:op.display.layout.accumWidth,accumHeight:op.display.layout.accumHeight};}
   if(op.kind==='read'){demand((op.target==='state'||op.target==='accumulation')&&uint(op.offset)&&uint(op.count)&&op.count>0&&op.count*16<=SOURCE_ATTRACTOR_NATIVE_MAX_READ_BYTES,'原生 GPU 诊断读取范围无效');demand(op.target==='state'?op.offset+op.count<=l.texels:op.expectedRenderIndex>0,'原生 GPU 诊断 target 尚不可读');value={...value,target:op.target,offset:op.offset,readCount:op.count};}
  }
 }
 Object.freeze(value);bindings.add(value);return value;
}
function validatePass(pass:SourceAttractorGpuPass){demand(pass&&typeof pass.warmup==='boolean'&&[pass.steps,pass.warmupBase,pass.currentStepBase,pass.staggerMin,pass.staggerRange].every(int),'原生 GPU pass 需要原始 int32 字段');}
const displayValues=(d:SourceAttractorNativeDisplay)=>[d.radius,...d.scale,...d.offset,...d.projection,...d.modelview,...d.backgroundRgb,d.exposure,d.contrast,d.gamma,d.saturation,d.densityScale];
function validateDisplay(d:SourceAttractorNativeDisplay){const vector=(a:unknown,n:number)=>(Array.isArray(a)||a instanceof Float32Array&&a.buffer instanceof ArrayBuffer)&&a.length===n;demand(d&&vector(d.scale,3)&&vector(d.offset,3)&&vector(d.projection,16)&&vector(d.modelview,16)&&vector(d.backgroundRgb,3),'原生 GPU 显示 uniform 形状无效');demand(d.radius>0&&displayValues(d).every(n=>typeof n==='number'&&Number.isFinite(Math.fround(n))),'原生 GPU 显示 uniform 需要有限 F32');}
/** Admission tracks native representations independently of the shared WebGL
 * particle floor. retainedBytes includes all currently owned native resources.
 * Input×6 / response×4 are conservative representation bounds, not RSS. */
export function encodeSourceAttractorNativeRequest(request:SourceAttractorNativeRequest,options:{isCancelled?:()=>boolean;retainedBytes?:number;retainedTarget?:SourceAttractorNativeTarget}={}):SourceDrawingResult<Uint8Array>{
 try{
  const check=()=>{if(options.isCancelled?.())throw new SourceNativeError('cancelled','原生 GPU 编码已取消');};check();const binding=captureSourceAttractorNativeResponseBinding(request),op=request.operation,retained=options.retainedBytes??0;
  demand(Number.isSafeInteger(retained)&&retained>=0,'原生 GPU 保留容量无效');let resident=retained,size=88;const strings:Uint8Array[]=[];
  if(options.retainedTarget){const t=options.retainedTarget;demand(t.resource===op.resource,'原生 GPU 保留目标不属于当前资源');sourceAttractorNativeTargetBytes(t.width,t.height,t.accumWidth,t.accumHeight);}
  if(op.kind==='create'){demand(!options.retainedTarget,'原生 GPU create 不能复用目标');const p=sourceAttractorNativeProgramBytes(op.programs);resident+=sourceAttractorNativeResidentBytes(op.count,op.texSize,p);size=100+p/3+24;}
  else if(op.kind!=='release'){
   resident=Math.max(resident,sourceAttractorNativeResidentBytes(op.expectedCount,op.expectedTexSize,0));
   if(op.kind==='upload'){size=124+op.positions.byteLength+op.texIndex.byteLength+op.colors.byteLength;for(const a of[op.positions,op.texIndex,op.colors])demand(a.every(Number.isFinite),'原生 GPU 上传仅接受有限 canonical seeds/属性');}
   if(op.kind==='pass'){validatePass(op.pass);size=132;}
   if(op.kind==='render'){validateDisplay(op.display);size=304;const d=op.display.layout,t=options.retainedTarget;if(!t||t.width!==d.width||t.height!==d.height||t.accumWidth!==d.accumWidth||t.accumHeight!==d.accumHeight)resident+=sourceAttractorNativeTargetBytes(d.width,d.height,d.accumWidth,d.accumHeight);}
   if(op.kind==='read'){size=120;if(op.target==='accumulation'&&options.retainedTarget)demand(op.offset+op.count<=options.retainedTarget.accumWidth*options.retainedTarget.accumHeight,'原生 GPU accumulation 读取超出目标');}
  }
  if(op.kind!=='release')sourceAttractorNativePeakBytes(resident,0,size,sourceAttractorNativeResponseBytes(binding));check();
  if(op.kind==='create')for(const s of programSources(op.programs))strings.push(encoder.encode(s));
  const out=new Uint8Array(size),view=new DataView(out.buffer);let at=0;
  const word=(n:number)=>{view.setUint32(at,n>>>0,true);at+=4;},float=(n:number)=>{view.setFloat32(at,n,true);at+=4;},block=(bytes:Uint8Array)=>{word(bytes.byteLength);out.set(bytes,at);at+=bytes.byteLength;};
  const floats=(a:Float32Array)=>{word(a.byteLength);const bits=new Uint32Array(a.buffer,a.byteOffset,a.length);for(let i=0;i<bits.length;i++){if((i&16383)===0)check();word(bits[i]);}};
  [SOURCE_FRAME_MAGIC,SOURCE_ATTRACTOR_NATIVE_VERSION,size,request.generation,request.sequence,request.width,request.height,...Array(8).fill(0),SOURCE_ATTRACTOR_NATIVE_FAMILY,operations[op.kind]].forEach(word);block(Uint8Array.from(op.resource.match(/../g)!,s=>parseInt(s,16)));
  if(op.kind==='create'){word(op.count);word(op.texSize);word(op.shaderOperations);strings.forEach(block);}
  else if(op.kind!=='release'){
   [op.expectedIndex,op.expectedRenderIndex,op.expectedUploaded,op.expectedCount,op.expectedTexSize].forEach(word);
   if(op.kind==='upload'){word(op.offset);floats(op.positions);floats(op.texIndex);floats(op.colors);}
   if(op.kind==='pass'){const p=op.pass;[p.steps,p.warmup?1:0,p.warmupBase,p.currentStepBase,p.staggerMin,p.staggerRange].forEach(word);}
   if(op.kind==='render'){word(op.display.layout.accumWidth);word(op.display.layout.accumHeight);displayValues(op.display).forEach(float);}
   if(op.kind==='read'){word(op.target==='state'?1:2);word(op.offset);word(op.count);}
  }
  demand(at===size,'原生 GPU 协议布局不一致');check();return{ok:true,value:out};
 }catch(error){if(error instanceof SourceNativeError&&['input','capacity','cancelled'].includes(error.kind))return{ok:false,error:{kind:error.kind as 'input'|'capacity'|'cancelled',path:['attractor'],reason:error.message}};throw error;}
}
export function sourceAttractorNativeResponseBytes(binding:SourceAttractorNativeResponseBinding){if(!bindings.has(binding))throw new SourceNativeError('protocol','原生 GPU 响应绑定未经捕获');return 96+(binding.kind==='render'?binding.width*binding.height*4:binding.kind==='read'?binding.readCount*16:0);}
/** F32 reads expose bytes deliberately: NaN payloads and signed zero survive. */
export function decodeSourceAttractorNativeResponse(raw:Uint8Array,b:SourceAttractorNativeResponseBinding):SourceAttractorNativeResponse {
 const fail=(v:unknown,s:string)=>{if(!v)throw new SourceNativeError('protocol',s);};fail(bindings.has(b),'原生 GPU 响应绑定未经捕获');
 fail(raw instanceof Uint8Array&&raw.buffer instanceof ArrayBuffer&&raw.length===sourceAttractorNativeResponseBytes(b),'原生 GPU 响应长度无效');const v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),u=(n:number)=>v.getUint32(n,true),resource=Array.from(raw.subarray(8,24),n=>n.toString(16).padStart(2,'0')).join('');
 fail(u(0)===6&&u(4)===operations[b.kind]&&resource===b.resource&&[80,84,88,92].every(n=>u(n)===0),'原生 GPU 响应身份或保留字段不符');
 const passIndex=u(24),renderIndex=u(28),uploaded=u(32),count=u(36),texSize=u(40),disposition=u(44),width=u(48),height=u(52),accumWidth=u(56),accumHeight=u(60),renderedPassIndex=u(64),target=u(68),offset=u(72),readCount=u(76);
 fail(target===(b.target==='state'?1:b.target==='accumulation'?2:0)&&offset===b.offset&&readCount===b.readCount,'原生 GPU 读取响应范围不符');
 if(b.kind==='release')fail(disposition===1||disposition===2,'原生 GPU release 未确认');else fail(disposition===0,'原生 GPU 操作没有保留资源');
 if(disposition===2)fail([passIndex,renderIndex,uploaded,count,texSize,width,height,accumWidth,accumHeight,renderedPassIndex].every(n=>n===0),'原生 GPU absent 响应包含状态');
 else{
  fail(count>0&&texSize===Math.ceil(Math.sqrt(count))&&texSize*texSize*64+count*48<=SOURCE_FRAME_BUDGET&&uploaded<=texSize*texSize&&passIndex<=10000,'原生 GPU 响应布局或检查点无效');
  fail(renderIndex===0?[width,height,accumWidth,accumHeight,renderedPassIndex].every(n=>n===0):dimensions(width,height)&&dimensions(accumWidth,accumHeight)&&renderedPassIndex<=passIndex,'原生 GPU 响应 target 元数据无效');
  if(b.kind!=='release')fail(passIndex===b.passIndex&&renderIndex===b.renderIndex&&uploaded===b.uploaded&&count===b.count&&texSize===b.texSize,'原生 GPU 响应不属于当前检查点');
  if(b.kind==='render')fail(width===b.width&&height===b.height&&accumWidth===b.accumWidth&&accumHeight===b.accumHeight&&renderedPassIndex===passIndex,'原生 GPU render 目标不符');
  if(b.kind==='read')fail(b.target==='state'?offset+readCount<=texSize*texSize:renderIndex>0&&renderedPassIndex===passIndex&&offset+readCount<=accumWidth*accumHeight,'原生 GPU read 目标过期或越界');
 }
 return{resource,disposition:disposition===0?'owned':disposition===1?'released':'absent',passIndex,renderIndex,uploaded,count,texSize,width,height,accumWidth,accumHeight,renderedPassIndex,...(b.target?{target:b.target}:{}),offset,readCount,...(b.kind==='render'?{pixels:new Uint8ClampedArray(raw.buffer,raw.byteOffset+96,raw.length-96)}:b.kind==='read'?{records:raw.subarray(96)}:{})};
}
