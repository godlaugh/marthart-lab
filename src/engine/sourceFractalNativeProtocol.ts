import {SOURCE_FRAME_BUDGET,SOURCE_FRAME_MAGIC} from './sourceDrawingFrame';
import type {SourceDrawingResult,SourceDrawingUniform} from './sourceDrawingSnapshot';
import {SourceNativeError} from './sourceNativeError';

export const SOURCE_FRACTAL_NATIVE_MAX_SAMPLES=65536;

export type SourceFractalNativeOperation=
 | {kind:'create';resource:string;shaders:{vertex:string;fragment:string}}
 | {kind:'sample';resource:string;expectedIndex:number;points:Uint32Array;reference:Float32Array;palette:Float32Array;uniforms:readonly SourceDrawingUniform[]}
 | {kind:'release';resource:string};
export interface SourceFractalNativeRequest {generation:number;sequence:number;width:number;height:number;operation:SourceFractalNativeOperation;}
export interface SourceFractalNativeRetainedTarget {readonly resource:string;readonly width:number;readonly height:number;}
export interface SourceFractalNativeResponse {resource:string;committedRequests:number;disposition:'owned'|'released'|'absent';count:number;width:number;height:number;draws:number;targetAllocations:number;referenceUploads:number;paletteUploads:number;records?:Uint8Array;}
/** Only immutable response expectations survive an await, never caller arrays. */
export type SourceFractalNativeResponseBinding=Readonly<
 | {kind:'create'|'release';resource:string;width:1;height:1;count:0}
 | {kind:'sample';resource:string;expectedIndex:number;width:number;height:number;count:number}
>;
const kinds={create:1,sample:2,release:3} as const;
const codes={float:1,int:2,vec2:3,vec3:5,vec4:6,'float-array':8,sampler2d:9,'vec3-array':10} as const;
const encoder=new TextEncoder(),bindings=new WeakSet<object>();
const uint=(v:number)=>Number.isInteger(v)&&v>=0&&v<=0xffffffff;
const dimensions=(w:number,h:number)=>uint(w)&&uint(h)&&w>0&&h>0&&w<=16384&&h<=16384&&w*h<=16_000_000;
function demand(value:unknown,reason:string):asserts value {if(!value)throw new SourceNativeError('input',reason);}
function capacity(bytes:number){if(!Number.isSafeInteger(bytes)||bytes<0||bytes>SOURCE_FRAME_BUDGET)throw new SourceNativeError('capacity','分形原生状态、协议副本、采样与读取缓冲超过 256 MiB 预算');}
/** Count and validate UTF-8 before allocating an encoded shader or packet. */
function textSize(value:string):number {
 demand(typeof value==='string'&&value.length>0,'分形原生字符串无效');let bytes=0;
 for(let i=0;i<value.length;i++){
  const c=value.charCodeAt(i);demand(c!==0,'分形原生字符串不能包含 NUL');
  if(c>=0xd800&&c<=0xdbff){const low=value.charCodeAt(++i);demand(low>=0xdc00&&low<=0xdfff,'分形原生字符串不是有效 Unicode');bytes+=4;}
  else {demand(c<0xdc00||c>0xdfff,'分形原生字符串不是有效 Unicode');bytes+=c<0x80?1:c<0x800?2:3;}
  capacity(bytes);
 }return bytes;
}
export function sourceFractalNativeProgramBytes(shaders:{vertex:string;fragment:string}):number {
 demand(shaders&&typeof shaders==='object','分形 shader 配置无效');let bytes=0;
 for(const value of [shaders.vertex,shaders.fragment]){demand(typeof value==='string'&&!/^\s*#\s*version\b/m.test(value),'分形 shader 不能包含 #version');bytes+=textSize(value)*3;capacity(bytes);}return bytes;
}
export function sourceFractalNativeTargetGrowth(resource:string,width:number,height:number,target?:SourceFractalNativeRetainedTarget):number {
 if(target){demand(target.resource===resource&&dimensions(target.width,target.height),'分形保留目标身份或尺寸无效');if(target.width===width&&target.height===height)return 0;}
 return width*height*52;
}
export function captureSourceFractalNativeResponseBinding(request:SourceFractalNativeRequest):SourceFractalNativeResponseBinding {
 demand(request&&uint(request.generation)&&request.generation>0&&uint(request.sequence)&&request.sequence>0,'分形请求身份无效');
 const {width,height,operation:op}=request;demand(dimensions(width,height),'分形物理尺寸无效');
 demand(op&&Object.hasOwn(kinds,op.kind)&&typeof op.resource==='string'&&/^[a-f0-9]{32}$/.test(op.resource)&&op.resource!=='0'.repeat(32),'分形资源身份无效');
 let value:SourceFractalNativeResponseBinding;
 if(op.kind==='sample'){
  demand(uint(op.expectedIndex)&&op.expectedIndex<0xffffffff,'分形采样检查点无效');
  demand(op.points instanceof Uint32Array&&op.points.buffer instanceof ArrayBuffer&&op.points.length>0&&op.points.length%2===0&&op.points.length<=SOURCE_FRACTAL_NATIVE_MAX_SAMPLES*2,'分形采样点必须为 1–65536 个非共享整数坐标对');
  value={kind:op.kind,resource:op.resource,expectedIndex:op.expectedIndex,width,height,count:op.points.length/2};
 }else {demand(width===1&&height===1,'分形控制事务必须为 1×1');value={kind:op.kind,resource:op.resource,width:1,height:1,count:0};}
 Object.freeze(value);bindings.add(value);return value;
}
function uniformTable(uniforms:readonly SourceDrawingUniform[]):{bytes:number;iterations:number;referenceLength:number;gradientSize:number} {
 demand(Array.isArray(uniforms)&&uniforms.length<=65536,'分形 uniform 集合无效');let bytes=4;
 const names=new Map<string,SourceDrawingUniform>();
 for(const u of uniforms){
  demand(u&&typeof u.name==='string'&&/^[A-Za-z_]\w*$/.test(u.name)&&!u.name.startsWith('gl_')&&!names.has(u.name)&&Object.hasOwn(codes,u.kind),'分形 uniform 名称、类型无效或重复');names.set(u.name,u);
  bytes+=4+u.name.length+4;
  if(u.kind==='sampler2d'){demand((u.name==='u_refOrbitTex'&&u.texture===2)||(u.name==='u_gradientTex'&&u.texture===1),'分形 sampler 名称或固定单元无效');bytes+=4;}
  else {
   const components=u.kind==='vec2'?2:u.kind==='vec3'||u.kind==='vec3-array'?3:u.kind==='vec4'?4:1;
   demand((u.kind==='int'?u.values instanceof Int32Array:u.values instanceof Float32Array)&&u.values.buffer instanceof ArrayBuffer&&uint(u.count)&&u.count>0&&u.count<=0x7fffffff&&(u.kind==='float-array'||u.kind==='vec3-array'||u.count===1)&&u.values.length===u.count*components,'分形 uniform 存储、维数或 count 无效');
   if(u.kind!=='int')demand(u.values.every(Number.isFinite),'分形 uniform 必须为有限浮点');bytes+=8+u.values.byteLength;
  }
  capacity(bytes);
 }
 for(const [name,texture] of [['u_refOrbitTex',2],['u_gradientTex',1]] as const){const u=names.get(name);demand(u?.kind==='sampler2d'&&u.texture===texture,`分形 ${name} 固定 sampler 绑定无效`);}
 const scalar=(name:string)=>{const u=names.get(name);demand(u?.kind==='int'&&u.count===1,`分形 ${name} 必须为单个 int`);return u.values[0];};
 // These named production-profile ABI limits permit partial uploads. They do
 // not infer a diagnostic shader's reflected array capacity or require usage.
 const dynamic=names.get('u_dynamicParams'),palette=names.get('u_palette');
 if(dynamic)demand(dynamic.kind==='float-array'&&dynamic.count<=32,'分形 u_dynamicParams 必须为 1–32 个 float-array 值');
 if(palette)demand(palette.kind==='vec3-array'&&palette.count<=16,'分形 u_palette 必须为 1–16 个 vec3-array 值');
 if(names.has('u_paletteSize')){const size=scalar('u_paletteSize');demand(size>=0&&size<=16,'分形 u_paletteSize 必须为 0–16');}
 const iterations=scalar('u_iterations'),referenceLength=scalar('u_refOrbitLen'),gradientSize=scalar('u_gradientSize');
 demand(iterations>=1&&iterations<=2048,'分形迭代数必须为 1–2048');demand(referenceLength>=0&&referenceLength<=2048,'分形参考轨道长度无效');demand(gradientSize===0||gradientSize===1024,'分形渐变 uniform 必须为 0 或 1024');
 return{bytes,iterations,referenceLength,gradientSize};
}
/** v11 carries already-produced bindings. No shader translation, GPU work or
 * scene interpretation occurs here. Resident estimates exclude driver RSS. */
export function encodeSourceFractalNativeRequest(request:SourceFractalNativeRequest,options:{retainedBytes?:number;retainedTarget?:SourceFractalNativeRetainedTarget}={}):SourceDrawingResult<Uint8Array> {
 try{
  const binding=captureSourceFractalNativeResponseBinding(request),op=request.operation,retained=options.retainedBytes??0;
  demand(Number.isSafeInteger(retained)&&retained>=0,'分形保留容量无效');
  // Even a wrong-target cleanup hint must never be interpreted as ownership.
  if(options.retainedTarget)demand(options.retainedTarget.resource===op.resource&&dimensions(options.retainedTarget.width,options.retainedTarget.height),'分形保留目标身份或尺寸无效');
  let size=88,resident=op.kind==='release'?0:retained,transient=192;
  if(op.kind==='create'){
   demand(options.retainedTarget===undefined,'分形 create 不能复用已存在目标');const program=sourceFractalNativeProgramBytes(op.shaders);resident+=program;size+=8+program/3;
  }else if(op.kind==='sample'){
   for(let i=0;i<op.points.length;i+=2)demand(op.points[i]<request.width&&op.points[i+1]<request.height,'分形采样坐标超出实际目标');
   for(const [values,stride,maximum] of [[op.reference,4,2048],[op.palette,3,1024]] as const){demand(values instanceof Float32Array&&values.buffer instanceof ArrayBuffer&&values.length>=stride&&values.length%stride===0&&values.length<=stride*maximum&&values.every(Number.isFinite),'分形参考或调色纹理无效');}
   demand(op.palette.length===3||op.palette.length===3072,'分形调色纹理宽度必须为 1 或 1024');
   const table=uniformTable(op.uniforms);demand(op.reference.length===Math.max(1,table.referenceLength)*4,'分形参考长度 uniform 与纹理不符');
   // A queued gradient-size uniform and current fallback texture are distinct
   // source facts: both 1-texel/1024 and 1024-texel/0 are legitimate.
   const target=options.retainedTarget;if(target)demand(retained>=target.width*target.height*52,'分形保留总量未包含已声明目标');
   resident+=sourceFractalNativeTargetGrowth(op.resource,request.width,request.height,target)+op.reference.byteLength+op.palette.byteLength;
   size+=4+12+op.points.byteLength+op.reference.byteLength+op.palette.byteLength+table.bytes;
   const count=binding.count,maxSpan=Math.min(count,Math.floor(2_000_000/table.iterations));
   // Three 52-byte record representations, point/order storage, bounded MRT
   // reads plus independent sentinel re-read, and response/header allowance.
   transient=count*(52*3+12)+maxSpan*68+256;
  }
  capacity(size);capacity(resident+size*6+transient);
  const out=new Uint8Array(size),view=new DataView(out.buffer);let at=0;
  const word=(value:number)=>{view.setUint32(at,value,true);at+=4;};
  const text=(value:string)=>{const bytes=textSize(value);word(bytes);const result=encoder.encodeInto(value,out.subarray(at,at+bytes));demand(result.read===value.length&&result.written===bytes,'分形 UTF-8 编码不完整');at+=bytes;};
  const words=(values:Uint32Array|Float32Array|Int32Array)=>{word(values.byteLength);const bits=new Uint32Array(values.buffer,values.byteOffset,values.length);for(const value of bits)word(value);};
  word(SOURCE_FRAME_MAGIC);word(11);word(size);word(request.generation);word(request.sequence);word(request.width);word(request.height);for(let i=0;i<8;i++)word(0);
  word(4);word(kinds[op.kind]);word(16);for(let i=0;i<32;i+=2)out[at++]=parseInt(op.resource.slice(i,i+2),16);
  if(op.kind==='create'){text(op.shaders.vertex);text(op.shaders.fragment);}
  if(op.kind==='sample'){
   word(op.expectedIndex);words(op.points);words(op.reference);words(op.palette);word(op.uniforms.length);
   for(const u of op.uniforms){text(u.name);word(codes[u.kind as keyof typeof codes]);if(u.kind==='sampler2d')word(u.texture);else {word(u.count);words(u.values);}}
  }
  demand(at===size,'分形 wire 长度不一致');return{ok:true,value:out};
 }catch(error){if(error instanceof SourceNativeError&&['input','capacity'].includes(error.kind))return{ok:false,error:{kind:error.kind as 'input'|'capacity',path:['fractal'],reason:error.message}};throw error;}
}
export function sourceFractalNativeResponseBytes(binding:SourceFractalNativeResponseBinding):number {
 if(!bindings.has(binding))throw new SourceNativeError('protocol','分形响应绑定必须由 codec 捕获');return 64+binding.count*52;
}
/** Records borrow the response bytes, including all NaN/Inf payloads and -0.
 * Terminal interpretation belongs to the same producer as the WebGL path. */
export function decodeSourceFractalNativeResponse(raw:Uint8Array,binding:SourceFractalNativeResponseBinding):SourceFractalNativeResponse {
 function fail(value:unknown,reason:string):asserts value {if(!value)throw new SourceNativeError('protocol',reason);}
 fail(bindings.has(binding),'分形响应绑定必须由 codec 捕获');
 fail(raw instanceof Uint8Array&&raw.buffer instanceof ArrayBuffer&&raw.byteLength===sourceFractalNativeResponseBytes(binding),'分形响应长度无效');
 const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),u=(at:number)=>view.getUint32(at,true),resource=Array.from(raw.subarray(8,24),v=>v.toString(16).padStart(2,'0')).join('');
 fail(u(0)===4&&u(4)===kinds[binding.kind]&&resource===binding.resource,'分形响应身份不符');
 fail(u(60)===0,'分形响应保留字段非零');
 const committedRequests=u(24),disposition=u(28),count=u(32),width=u(36),height=u(40);
 const draws=u(44),targetAllocations=u(48),referenceUploads=u(52),paletteUploads=u(56);
 fail(count===binding.count&&width===binding.width&&height===binding.height,'分形响应采样数或尺寸不符');
 if(binding.kind==='sample')fail(draws>=1&&draws<=count&&targetAllocations<=1&&referenceUploads===1&&paletteUploads===1,'分形响应执行统计不可能');
 else fail(draws===0&&targetAllocations===0&&referenceUploads===0&&paletteUploads===0,'分形控制响应执行统计必须为零');
 if(binding.kind==='sample')fail(disposition===0&&committedRequests===binding.expectedIndex+1,'分形响应采样检查点不符');
 else if(binding.kind==='create')fail(disposition===0&&committedRequests===0,'分形 create 响应无效');
 else fail(disposition===1||disposition===2&&committedRequests===0,'分形 release 响应无效');
 return{resource,committedRequests,disposition:disposition===0?'owned':disposition===1?'released':'absent',count,width,height,draws,targetAllocations,referenceUploads,paletteUploads,...(binding.kind==='sample'?{records:raw.subarray(64)}:{})};
}
