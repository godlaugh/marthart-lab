import {SOURCE_FRAME_BUDGET,SOURCE_FRAME_MAGIC} from './sourceDrawingFrame';
import type {SourceDrawingResult} from './sourceDrawingSnapshot';
import {SourceNativeError} from './sourceNativeError';
import {sourceIteratedNativeResidentBytes} from './sourceIteratedNativeProtocol';
import type {SourceIteratedRenderUniform} from './sourceIteratedRenderPlan';

export const SOURCE_ITERATED_RENDER_NATIVE_VERSION=7;
export const SOURCE_ITERATED_RENDER_NATIVE_FAMILY=3;
export const SOURCE_ITERATED_RENDER_PROGRAM_NAMES=['draw','statsFirst','statsReduce','present','presentReduce','decay'] as const;
export type SourceIteratedRenderNativePrograms=Readonly<Record<typeof SOURCE_ITERATED_RENDER_PROGRAM_NAMES[number],{vertex:string;fragment:string}>>;
export interface SourceIteratedNativeDrawPlan {
 drawUniforms:readonly SourceIteratedRenderUniform[];statsUniforms:readonly SourceIteratedRenderUniform[];
 palette:{key:string;format:'source-rgb1024'|'local-rgba4097';values:Float32Array};noise:Uint8Array;primitive:'points'|'triangles';
}
export interface SourceIteratedNativePresentPlan {uniforms:readonly SourceIteratedRenderUniform[];clear:readonly number[];filter:'linear'|'nearest';}
type Owned={resource:string};
type Checkpoint=Owned&{stateResource:string;expectedIndex:number;expectedDisplays:number;expectedCount:number};
export type SourceIteratedRenderNativeOperation=
 | (Checkpoint&{kind:'create';expectedDisplays:0;programs:SourceIteratedRenderNativePrograms})
 | (Checkpoint&{kind:'draw';plan:SourceIteratedNativeDrawPlan;clear:boolean;record:boolean;decay:number})
 | (Checkpoint&{kind:'present';plan:SourceIteratedNativePresentPlan})
 | (Owned&{kind:'release'});
export interface SourceIteratedRenderNativeRequest {generation:number;sequence:number;width:number;height:number;operation:SourceIteratedRenderNativeOperation;}
export type SourceIteratedRenderNativeResponseBinding=Readonly<
 | (Owned&{kind:'release';width:1;height:1})
 | (Checkpoint&{kind:'create'|'draw'|'present';width:number;height:number;record?:boolean})
>;
export interface SourceIteratedRenderNativeResponse {
 resource:string;stateResource?:string;index:number;displays:number;disposition:'owned'|'released'|'absent';count:number;width:number;height:number;
 invalid:number;accepted:number;clipped:number;sampleInvalid:number;occupiedPixels:number;maxCount:number;pixels?:Uint8ClampedArray;
}
const kinds={create:1,draw:2,present:3,release:4} as const;
const uniformKinds={float:1,int:2,bool:3,vec2:4,vec3:5,vec4:6,ivec2:7,mat4:8,sampler2d:9,usampler2d:10} as const;
const components={float:1,int:1,bool:1,vec2:2,vec3:3,vec4:4,ivec2:2,mat4:16,sampler2d:1,usampler2d:1} as const;
const uint=(n:number)=>Number.isInteger(n)&&n>=0&&n<=0xffffffff;
const token=(s:string)=>typeof s==='string'&&/^[a-f0-9]{32}$/.test(s)&&s!=='0'.repeat(32);
const particleCount=(n:number)=>uint(n)&&n>0&&n<=8_000_000;
const dimensions=(w:number,h:number)=>uint(w)&&w>0&&w<=16384&&uint(h)&&h>0&&h<=16384&&w*h<=16_000_000;
const finite32=(n:number)=>typeof n==='number'&&Number.isFinite(Math.fround(n));
function demand(condition:unknown,reason:string):asserts condition {if(!condition)throw new SourceNativeError('input',reason);}
function capacity(n:number){if(!Number.isSafeInteger(n)||n<0||n>SOURCE_FRAME_BUDGET)throw new SourceNativeError('capacity','原生迭代绘制、协议与保留资源超过 256 MiB 预算');}
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
function textBytes(s:string){demand(typeof s==='string'&&s.length>0&&!s.includes('\0'),'原生迭代绘制字符串无效');capacity(s.length*3);const b=encoder.encode(s);demand(decoder.decode(b)===s,'原生迭代绘制字符串不是有效 Unicode');return b;}
export function sourceIteratedRenderNativeProgramBytes(programs:SourceIteratedRenderNativePrograms):number {
 let n=0;
 for(const name of SOURCE_ITERATED_RENDER_PROGRAM_NAMES)for(const stage of ['vertex','fragment'] as const){const s=programs?.[name]?.[stage];demand(typeof s==='string'&&s.startsWith('#version 410 core\n'),'原生迭代绘制程序必须显式提供 GL 4.1 profile');n+=textBytes(s).length*3;capacity(n);}
 return n;
}
export function sourceIteratedNativeViewBytes(count:number):number {demand(particleCount(count),'原生迭代视图粒子数无效');const w=Math.min(2048,count);return w*Math.ceil(count/w)*24;}
/** Known owned storage, not driver RSS/VRAM. Target creation coexists with any
 * previous target until its exact release is acknowledged. */
export function sourceIteratedRenderNativeResidentBytes(count:number,width:number,height:number,programBytes=0):number {
 demand(particleCount(count)&&dimensions(width,height)&&Number.isSafeInteger(programBytes)&&programBytes>=0,'原生迭代绘制容量参数无效');
 const w=Math.min(2048,count),h=Math.ceil(count/w),rw=Math.max(Math.ceil(w/2),Math.ceil(width/4)),rh=Math.max(Math.ceil(h/2),Math.ceil(height/4));
 return programBytes+width*height*36+rw*rh*32+4097*16+256+1024*1024;
}
const bindings=new WeakSet<object>();
export function captureSourceIteratedRenderNativeResponseBinding(request:SourceIteratedRenderNativeRequest):SourceIteratedRenderNativeResponseBinding {
 demand(request&&uint(request.generation)&&request.generation>0&&uint(request.sequence)&&request.sequence>0&&dimensions(request.width,request.height),'原生迭代绘制请求身份或尺寸无效');
 const op=request.operation;demand(op&&Object.hasOwn(kinds,op.kind)&&token(op.resource),'原生迭代绘制资源身份无效');let binding:SourceIteratedRenderNativeResponseBinding;
 if(op.kind==='release'){demand(request.width===1&&request.height===1,'原生迭代绘制释放必须为 1×1');binding={kind:op.kind,resource:op.resource,width:1,height:1};}
 else{
  demand(token(op.stateResource)&&particleCount(op.expectedCount)&&uint(op.expectedIndex)&&uint(op.expectedDisplays),'原生迭代绘制状态身份或检查点无效');
  demand(op.kind!=='create'||op.expectedDisplays===0,'原生迭代绘制创建检查点必须为零');demand(op.kind!=='draw'||op.expectedDisplays<0xffffffff,'原生迭代绘制检查点已耗尽');demand(op.kind!=='present'||op.expectedDisplays>0,'原生迭代呈现需要已完成的累积');
  if(op.kind==='draw')demand(typeof op.record==='boolean','原生迭代绘制记录标记无效');
  binding={kind:op.kind,resource:op.resource,stateResource:op.stateResource,expectedIndex:op.expectedIndex,expectedDisplays:op.expectedDisplays,expectedCount:op.expectedCount,width:request.width,height:request.height,...(op.kind==='draw'?{record:op.record}:{})};
 }
 Object.freeze(binding);bindings.add(binding);return binding;
}
const samplerUniform=(u:SourceIteratedRenderUniform):u is Extract<SourceIteratedRenderUniform,{texture:number}>=>u.kind==='sampler2d'||u.kind==='usampler2d';
function validateUniforms(uniforms:readonly SourceIteratedRenderUniform[]){
 demand(Array.isArray(uniforms)&&uniforms.length<=65536,'原生迭代绘制 uniform 集合无效');const names=new Set<string>();
 for(const u of uniforms as readonly SourceIteratedRenderUniform[]){
  demand(u&&typeof u.name==='string'&&/^[A-Za-z_]\w*$/.test(u.name)&&!u.name.startsWith('gl_')&&!names.has(u.name)&&Object.hasOwn(uniformKinds,u.kind),'原生迭代绘制 uniform 名称或类型无效');names.add(u.name);
  if(samplerUniform(u)){demand(uint(u.texture)&&u.texture<4,'原生迭代绘制采样器超出自有单元');continue;}
  demand(Array.isArray(u.values)&&u.values.length===components[u.kind],'原生迭代绘制 uniform 分量数无效');
  const integer=u.kind==='int'||u.kind==='bool'||u.kind==='ivec2';
  for(const value of u.values)demand(finite32(value)&&(!integer||Number.isInteger(value)&&value>=-2147483648&&value<=2147483647)&&(u.kind!=='bool'||value===0||value===1),'原生迭代绘制 uniform 分量无效');
 }
}
function validate(request:SourceIteratedRenderNativeRequest){
 captureSourceIteratedRenderNativeResponseBinding(request);const op=request.operation;
 if(op.kind==='draw'){
  demand(typeof op.clear==='boolean'&&finite32(op.decay)&&op.decay>=0&&op.decay<=1,'原生迭代绘制清除或衰减无效');const p=op.plan;
  demand(p&&['points','triangles'].includes(p.primitive)&&p.palette&&['source-rgb1024','local-rgba4097'].includes(p.palette.format),'原生迭代绘制计划无效');textBytes(p.palette.key);
  demand(p.palette.values instanceof Float32Array&&p.palette.values.buffer instanceof ArrayBuffer&&p.palette.values.length===(p.palette.format==='source-rgb1024'?3072:16388)&&p.palette.values.every(Number.isFinite),'原生迭代绘制色板无效');
  demand(p.noise instanceof Uint8Array&&p.noise.buffer instanceof ArrayBuffer&&p.noise.length===256,'原生迭代绘制噪声表无效');validateUniforms(p.drawUniforms);validateUniforms(p.statsUniforms);
 }
 if(op.kind==='present'){
  const p=op.plan;demand(p&&['linear','nearest'].includes(p.filter)&&Array.isArray(p.clear)&&p.clear.length===4,'原生迭代呈现计划无效');for(const c of p.clear)demand(finite32(c)&&c>=0&&c<=1,'原生迭代呈现底色无效');validateUniforms(p.uniforms);
 }
}
export function encodeSourceIteratedRenderNativeRequest(request:SourceIteratedRenderNativeRequest,options:{retainedBytes?:number;isCancelled?:()=>boolean}={}):SourceDrawingResult<Uint8Array> {
 try{
  const check=()=>{if(options.isCancelled?.())throw new SourceNativeError('cancelled','原生迭代绘制编码已取消');};check();validate(request);const op=request.operation,retained=options.retainedBytes??0;demand(Number.isSafeInteger(retained)&&retained>=0,'原生迭代绘制保留容量无效');
  // Reserve the borrowed state view conservatively even before first draw.
  // The native registry independently charges exact live storage across owners.
  const resident=op.kind==='release'?0:op.kind==='create'?Math.max(retained,sourceIteratedNativeResidentBytes(op.expectedCount,0))+sourceIteratedNativeViewBytes(op.expectedCount)+sourceIteratedRenderNativeResidentBytes(op.expectedCount,request.width,request.height,sourceIteratedRenderNativeProgramBytes(op.programs)):Math.max(retained,sourceIteratedNativeResidentBytes(op.expectedCount,0)+sourceIteratedRenderNativeResidentBytes(op.expectedCount,request.width,request.height))+sourceIteratedNativeViewBytes(op.expectedCount);
  const transient=128+(op.kind==='present'?request.width*request.height*8+request.width*4:0);capacity(resident+transient);
  let offset=0,out:Uint8Array|undefined,view:DataView|undefined;
  const reserve=(n:number)=>{capacity(offset+n);const at=offset;offset+=n;return at;};
  const word=(v:number)=>{const at=reserve(4);view?.setUint32(at,v,true);};
  const float=(v:number)=>{const at=reserve(4);view?.setFloat32(at,v,true);};
  const block=(b:Uint8Array)=>{word(b.length);const at=reserve(b.length);if(out)for(let i=0;i<b.length;i+=65536){check();out.set(b.subarray(i,i+65536),at+i);}};
  const strings=new Map<string,Uint8Array>(),text=(s:string)=>{let b=strings.get(s);if(!b){b=textBytes(s);strings.set(s,b);}block(b);};
  const id=(s:string)=>block(Uint8Array.from(s.match(/../g)!,n=>parseInt(n,16)));
  const palette=(v:Float32Array)=>{word(v.byteLength);const at=reserve(v.byteLength);if(view){const bits=new Uint32Array(v.buffer,v.byteOffset,v.length);for(let i=0;i<bits.length;i++){if((i&16383)===0)check();view.setUint32(at+i*4,bits[i],true);}}};
  const uniforms=(values:readonly SourceIteratedRenderUniform[])=>{word(values.length);for(const u of values){check();text(u.name);word(uniformKinds[u.kind]);word(components[u.kind]);if(samplerUniform(u))word(u.texture);else for(const n of u.values){if(u.kind==='int'||u.kind==='bool'||u.kind==='ivec2')word(n);else float(n);}}};
  const emit=()=>{
   check();word(SOURCE_FRAME_MAGIC);word(SOURCE_ITERATED_RENDER_NATIVE_VERSION);word(out?.length??0);word(request.generation);word(request.sequence);word(request.width);word(request.height);for(let i=0;i<8;i++)word(0);word(SOURCE_ITERATED_RENDER_NATIVE_FAMILY);word(kinds[op.kind]);id(op.resource);
   if(op.kind==='release')return;id(op.stateResource);word(op.expectedIndex);word(op.expectedDisplays);word(op.expectedCount);
   if(op.kind==='create')for(const name of SOURCE_ITERATED_RENDER_PROGRAM_NAMES)for(const stage of ['vertex','fragment'] as const)text(op.programs[name][stage]);
   if(op.kind==='draw'){word(op.clear?1:0);word(op.record?1:0);float(op.decay);word(op.plan.primitive==='points'?1:2);text(op.plan.palette.key);word(op.plan.palette.format==='source-rgb1024'?1:2);palette(op.plan.palette.values);block(op.plan.noise);uniforms(op.plan.drawUniforms);uniforms(op.plan.statsUniforms);}
   if(op.kind==='present'){word(op.plan.filter==='linear'?1:2);op.plan.clear.forEach(float);uniforms(op.plan.uniforms);}
  };
  emit();const size=offset;capacity(resident+transient+size*6);out=new Uint8Array(size);view=new DataView(out.buffer);offset=0;emit();check();return{ok:true,value:out};
 }catch(error){if(error instanceof SourceNativeError&&['input','capacity','cancelled'].includes(error.kind))return{ok:false,error:{kind:error.kind as 'input'|'capacity'|'cancelled',path:['iterated-render'],reason:error.message}};throw error;}
}
/** Bind all control and statistical facts before exposing bottom-up pixels.
 * The shared HTTP client performs the one row reversal at its owning boundary. */
export function decodeSourceIteratedRenderNativeResponse(raw:Uint8Array,request:SourceIteratedRenderNativeRequest|SourceIteratedRenderNativeResponseBinding):SourceIteratedRenderNativeResponse {
 const fail=(ok:unknown,message:string)=>{if(!ok)throw new SourceNativeError('protocol',message);};
 const op='operation' in request?captureSourceIteratedRenderNativeResponseBinding(request):request;fail(bindings.has(op),'原生迭代绘制响应绑定必须由 codec 捕获');
 const size=128+(op.kind==='present'?op.width*op.height*4:0);fail(raw instanceof Uint8Array&&raw.buffer instanceof ArrayBuffer&&raw.byteLength===size,'原生迭代绘制响应长度无效');
 const v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),u=(n:number)=>v.getUint32(n,true),id=(n:number)=>Array.from(raw.subarray(n,n+16),n=>n.toString(16).padStart(2,'0')).join('');
 const resource=id(8),stateResource=id(24),index=u(40),displays=u(44),disposition=u(48),count=u(52),width=u(56),height=u(60),invalid=u(64)+u(68)*4294967296,accepted=u(72),clipped=u(76),sampleInvalid=u(80),occupiedPixels=u(84),maxCount=v.getFloat32(88,true);
 fail(u(0)===3&&u(4)===kinds[op.kind]&&resource===op.resource&&raw.subarray(92,128).every(n=>n===0),'原生迭代绘制响应身份或保留字段无效');
 if(op.kind==='release'){
  fail(disposition===1||disposition===2,'原生迭代绘制释放未确认');fail(raw.subarray(64,128).every(n=>n===0),'原生迭代绘制释放含有未测量统计');
  if(disposition===2)fail(raw.subarray(24,48).every(n=>n===0)&&raw.subarray(52,128).every(n=>n===0),'不存在的原生迭代绘制资源含有状态');
  else fail(token(stateResource)&&particleCount(count)&&dimensions(width,height),'原生迭代绘制释放容量或父状态无效');
 }else{
  fail(disposition===0&&stateResource===op.stateResource&&index===op.expectedIndex&&displays===op.expectedDisplays+(op.kind==='draw'?1:0)&&count===op.expectedCount&&width===op.width&&height===op.height,'原生迭代绘制确认检查点或尺寸不符');
  if(op.kind==='create')fail(raw.subarray(64,128).every(n=>n===0),'原生迭代绘制创建含有未测量统计');
  if(op.kind==='draw')fail(Number.isSafeInteger(invalid)&&accepted+clipped<=count&&sampleInvalid===(op.record?count-accepted-clipped:0)&&raw.subarray(84,128).every(n=>n===0),'原生迭代绘制统计覆盖不符');
  if(op.kind==='present')fail(raw.subarray(64,84).every(n=>n===0)&&occupiedPixels<=width*height&&Number.isFinite(maxCount)&&maxCount>=0,'原生迭代呈现统计无效');
 }
 return{resource,...(disposition===2?{}:{stateResource}),index,displays,disposition:disposition===0?'owned':disposition===1?'released':'absent',count,width,height,invalid,accepted,clipped,sampleInvalid,occupiedPixels,maxCount,...(op.kind==='present'?{pixels:new Uint8ClampedArray(raw.buffer,raw.byteOffset+128,raw.byteLength-128)}:{})};
}
