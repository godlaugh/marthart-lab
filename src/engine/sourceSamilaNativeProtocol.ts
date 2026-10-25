import {SOURCE_FRAME_BUDGET,SOURCE_FRAME_MAGIC} from './sourceDrawingFrame';
import type {SourceDrawingResult,SourceDrawingUniform} from './sourceDrawingSnapshot';
import {SourceNativeError} from './sourceNativeError';

export type SourceSamilaNativeUniform=SourceDrawingUniform|{name:string;kind:'bool';count:1;values:Int32Array};
export const SOURCE_SAMILA_NATIVE_SHADER_KEYS=['historyVertex','historyFragment','sampleVertex','sampleFragment','presentVertex','presentFragment'] as const;
export type SourceSamilaNativeShaders=Record<typeof SOURCE_SAMILA_NATIVE_SHADER_KEYS[number],string>;
type SourceSamilaNativeAccumulation={resource:string;expectedIndex:number;clear:boolean;baseBatch:number;passes:1|6;seed:number;palette?:Float32Array;history:readonly SourceSamilaNativeUniform[];sample:readonly SourceSamilaNativeUniform[];present:readonly SourceSamilaNativeUniform[]};
export type SourceSamilaNativeOperation=
 | {kind:'create';resource:string;shaders:SourceSamilaNativeShaders;noise:Float32Array;palette:Float32Array}
 | ({kind:'display'}&SourceSamilaNativeAccumulation)
 | ({kind:'step'}&SourceSamilaNativeAccumulation)
 | {kind:'present';resource:string;expectedIndex:number;present:readonly SourceSamilaNativeUniform[]}
 | {kind:'release';resource:string};
export const sourceSamilaNativeHasPixels=(op:SourceSamilaNativeOperation)=>op.kind==='display'||op.kind==='present';
export interface SourceSamilaNativeRequest {generation:number;sequence:number;width:number;height:number;operation:SourceSamilaNativeOperation;}
export interface SourceSamilaNativeFacts {steps:number;accepted:number;clipped:number;invalid:number;occupiedPixels:number;maxCount:number;invalidInkPixels:number;}
export interface SourceSamilaNativeResponse extends SourceSamilaNativeFacts {resource:string;committedDisplays:number;disposition:'owned'|'released'|'absent';pixels?:Uint8ClampedArray;}
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const codes:Record<SourceSamilaNativeUniform['kind'],number>={float:1,int:2,vec2:3,ivec2:4,vec3:5,vec4:6,mat4:7,'float-array':8,sampler2d:9,'vec3-array':10,bool:11};
const kinds={create:1,display:2,release:3,present:4,step:5};
const uint=(n:number)=>Number.isInteger(n)&&n>=0&&n<=0xffffffff;
const validName=(s:string)=>typeof s==='string'&&/^[A-Za-z_]\w*$/.test(s)&&!s.startsWith('gl_');
const components=(kind:SourceSamilaNativeUniform['kind'])=>kind==='vec2'||kind==='ivec2'?2:kind==='vec3'||kind==='vec3-array'?3:kind==='vec4'?4:kind==='mat4'?16:1;
function demand(condition:unknown,reason:string):asserts condition {if(!condition)throw new SourceNativeError('input',reason);}
function capacity(bytes:number){if(!Number.isSafeInteger(bytes)||bytes>SOURCE_FRAME_BUDGET)throw new SourceNativeError('capacity','Samila 原生状态、协议副本与输出超过 256 MiB 预算');}
function table(uniforms:readonly SourceSamilaNativeUniform[]):Map<string,SourceSamilaNativeUniform> {
 demand(Array.isArray(uniforms)&&uniforms.length<=65536,'Samila uniform 集合无效');const names=new Map<string,SourceSamilaNativeUniform>();
 for(const u of uniforms){
  demand(u&&validName(u.name)&&!names.has(u.name)&&Object.hasOwn(codes,u.kind),'Samila uniform 声明无效或重复');names.set(u.name,u);
  if(u.kind==='sampler2d'){demand(uint(u.texture)&&u.texture<=3,'Samila sampler 单元无效');continue;}
  const integer=u.kind==='int'||u.kind==='ivec2'||u.kind==='bool';
  demand((integer?u.values instanceof Int32Array:u.values instanceof Float32Array)&&u.values.buffer instanceof ArrayBuffer&&uint(u.count)&&u.count>0&&u.count<=0x7fffffff&&(u.kind==='float-array'||u.kind==='vec3-array'||u.count===1)&&u.values.length===components(u.kind)*u.count,'Samila uniform 类型/维数无效');
  if(u.kind==='bool')demand(u.values[0]===0||u.values[0]===1,'Samila bool 必须为 0 或 1');
  else if(!integer)demand(u.values.every(Number.isFinite),'Samila uniform 含非有限浮点');
 }
 return names;
}
function binding(t:Map<string,SourceSamilaNativeUniform>,name:string,kind:SourceSamilaNativeUniform['kind'],expected?:readonly number[]):number[] {
 const u=t.get(name);demand(u?.kind===kind,`Samila ${name} 类型或绑定缺失`);
 const value=u.kind==='sampler2d'?[u.texture]:Array.from(u.values);
 demand(!expected||(value.length===expected.length&&value.every((v,i)=>v===expected[i])),`Samila ${name} 与绘制事务不符`);return value;
}
/** Validate the actual resolved display contract before encoding or mutation.
 * The GPU adapter never reinterprets raw scene settings. */
export function validateSourceSamilaNativeDisplay(op:Extract<SourceSamilaNativeOperation,{kind:'display'|'step'}>,width:number,height:number):void {
 demand(uint(op.expectedIndex)&&op.expectedIndex<0xffffffff&&typeof op.clear==='boolean'&&Number.isInteger(op.baseBatch)&&op.baseBatch>0&&op.baseBatch<=8_000_000&&(op.passes===1||op.passes===6)&&uint(op.seed),'Samila display 进度、批次或随机字无效');
 const h=table(op.history),s=table(op.sample),steps=op.baseBatch*op.passes;
 binding(h,'previousInk','sampler2d',[0]);binding(h,'densityCeiling','float',[300]);const decay=binding(h,'decay','float')[0];demand(decay>=0&&decay<=1,'Samila decay 超出范围');
 binding(s,'noiseLUT','sampler2d',[3]);binding(s,'paletteLUT','sampler2d',[2]);binding(s,'u_quadSplat','bool',[0]);binding(s,'u_particleCount','int',[steps]);binding(s,'u_frameSeed','int',[op.seed|0]);binding(s,'u_viewportSize','vec2',[width,height]);binding(s,'u_aspectRatio','float',[Math.fround(width/height)]);
 const radius=binding(s,'radius','float')[0];demand(radius>0,'Samila 点半径无效');if(steps*(Math.ceil(Math.max(radius,1))+2)**2>2_000_000_000)throw new SourceNativeError('capacity','Samila 原生显示超过 20 亿次工作预算');
 validateSourceSamilaNativePresent(op,width,height);
}
export function validateSourceSamilaNativePresent(op:{expectedIndex:number;present:readonly SourceSamilaNativeUniform[]},width:number,height:number):void {
 demand(uint(op.expectedIndex),'Samila 呈现检查点无效');const p=table(op.present);
 binding(p,'ink','sampler2d',[0]);binding(p,'origin','ivec2',[0,0]);binding(p,'viewportAspect','float',[Math.fround(width/height)]);
}
export function sourceSamilaNativeProgramBytes(shaders:SourceSamilaNativeShaders):number {
 let bytes=0;for(const key of SOURCE_SAMILA_NATIVE_SHADER_KEYS){const s=shaders[key];demand(typeof s==='string'&&s.length>0&&!s.includes('\0')&&!/^\s*#version/m.test(s)&&!/^\s*precision\s/m.test(s),'Samila shader profile 无效');capacity(bytes+s.length*6);const encoded=encoder.encode(s);demand(decoder.decode(encoded)===s,'Samila shader 不是有效 Unicode');bytes+=encoded.length*3;}return bytes;
}
/** Conservative resident accounting, not measured driver RSS. Targets include
 * two RGBA32F histories, RGBA8 output and the actual integer statistics MRT. */
// Fixed native-owner allocations: padded TF buffer/input texture, two reduction
// targets and a summary covering all 48 million permitted samples. The internal
// shader charge is its UTF-8 source length times three, as for caller programs.
// The native lifecycle test reads the actual header's values to detect drift.
export const SOURCE_SAMILA_NATIVE_STATISTICS_BYTES=2_240_000;
export const SOURCE_SAMILA_NATIVE_STATISTICS_PROGRAM_BYTES=1_860;
export const SOURCE_SAMILA_NATIVE_STATISTICS_READBACK_BYTES=16;
export interface SourceSamilaNativeRetainedTarget {readonly resource:string;readonly width:number;readonly height:number;}
/** Only an acknowledged target belonging to this owner can be reused. Unknown
 * targets and size changes still reserve a complete new generation. */
export function sourceSamilaNativeTargetGrowth(resource:string|undefined,width:number,height:number,target?:SourceSamilaNativeRetainedTarget):number {
 if(target){
  demand(target.resource===resource&&[target.width,target.height].every(n=>Number.isInteger(n)&&n>0&&n<=16384)&&target.width*target.height<=16_000_000,'Samila 保留目标身份或尺寸无效');
  if(target.width===width&&target.height===height)return 0;
 }
 return width*height*52;
}
export function sourceSamilaNativeResidentBytes(programBytes:number,width=0,height=0):number {return programBytes+SOURCE_SAMILA_NATIVE_STATISTICS_PROGRAM_BYTES+256*256*4+1024*3*4+SOURCE_SAMILA_NATIVE_STATISTICS_BYTES+width*height*52;}
export function encodeSourceSamilaNativeRequest(request:SourceSamilaNativeRequest,options:{isCancelled?:()=>boolean;retainedBytes?:number;retainedTarget?:SourceSamilaNativeRetainedTarget}={}):SourceDrawingResult<Uint8Array> {
 try{
  const check=()=>{if(options.isCancelled?.())throw new SourceNativeError('cancelled','Samila 原生事务编码已取消');};check();
  const retained=options.retainedBytes??0;demand(Number.isSafeInteger(retained)&&retained>=0,'Samila 保留内存无效');
  demand(uint(request.generation)&&request.generation>0&&uint(request.sequence)&&request.sequence>0,'Samila 请求身份无效');
  const {width,height,operation:op}=request;demand(Number.isInteger(width)&&width>0&&width<=16384&&Number.isInteger(height)&&height>0&&height<=16384&&width*height<=16_000_000,'Samila 物理尺寸无效');
  demand(op&&Object.hasOwn(kinds,op.kind)&&/^[a-f0-9]{32}$/.test(op.resource)&&op.resource!=='0'.repeat(32),'Samila 资源身份无效');
  if(op.kind==='create'||op.kind==='release')demand(width===1&&height===1,'Samila 控制事务不能绘图');
  const floatBlock=(v:Float32Array,size:number)=>demand(v instanceof Float32Array&&v.buffer instanceof ArrayBuffer&&v.length===size&&v.every(Number.isFinite),'Samila 浮点纹理无效');
  let nativeExtra=0;
  if(op.kind==='create'){floatBlock(op.noise,65536);floatBlock(op.palette,3072);nativeExtra=sourceSamilaNativeResidentBytes(sourceSamilaNativeProgramBytes(op.shaders));}
  if(op.kind==='display'||op.kind==='step'){validateSourceSamilaNativeDisplay(op,width,height);if(op.palette)floatBlock(op.palette,3072);const growth=sourceSamilaNativeTargetGrowth(op.resource,width,height,options.retainedTarget);if(options.retainedTarget)demand(retained>=options.retainedTarget.width*options.retainedTarget.height*52,'Samila 保留总量未包含已声明目标');nativeExtra=growth+(op.kind==='display'?width*height*32:0)+SOURCE_SAMILA_NATIVE_STATISTICS_READBACK_BYTES;}
  if(op.kind==='present'){validateSourceSamilaNativePresent(op,width,height);nativeExtra=width*height*32;}
  let offset=0,out:Uint8Array|undefined,view:DataView|undefined;
  const reserve=(size:number)=>{capacity(offset+size);const at=offset;offset+=size;return at;};
  const word=(value:number)=>{demand(uint(value),'Samila wire 整数无效');const at=reserve(4);view?.setUint32(at,value,true);};
  const block=(b:Uint8Array)=>{word(b.length);const at=reserve(b.length);if(out)for(let i=0;i<b.length;i+=65536){check();out.set(b.subarray(i,i+65536),at+i);}};
  const words=(values:Float32Array|Int32Array)=>{word(values.byteLength);const at=reserve(values.byteLength);if(view)for(let i=0;i<values.length;i++){if((i&16383)===0)check();if(values instanceof Float32Array)view.setFloat32(at+i*4,values[i],true);else view.setInt32(at+i*4,values[i],true);}};
  const strings=new Map<string,Uint8Array>();
  const text=(s:string)=>{capacity(offset+s.length*3);let b=strings.get(s);if(!b){b=encoder.encode(s);demand(decoder.decode(b)===s&&!s.includes('\0'),'Samila 字符串无效');strings.set(s,b);}block(b);};
  const uniforms=(values:readonly SourceSamilaNativeUniform[])=>{word(values.length);for(const u of values){text(u.name);word(codes[u.kind]);if(u.kind==='sampler2d')word(u.texture);else{word(u.count);words(u.values);}}};
  const emit=()=>{
   check();word(SOURCE_FRAME_MAGIC);word(5);word(out?.length??0);word(request.generation);word(request.sequence);word(width);word(height);for(let i=0;i<8;i++)word(0);
   word(1);word(kinds[op.kind]);block(Uint8Array.from(op.resource.match(/../g)!,v=>parseInt(v,16)));
   if(op.kind==='create'){for(const key of SOURCE_SAMILA_NATIVE_SHADER_KEYS)text(op.shaders[key]);words(op.noise);words(op.palette);}
   if(op.kind==='display'||op.kind==='step'){word(op.expectedIndex);word(op.clear?1:0);word(op.baseBatch);word(op.passes);word(op.seed);if(op.palette)words(op.palette);else word(0);uniforms(op.history);uniforms(op.sample);uniforms(op.present);}
   if(op.kind==='present'){word(op.expectedIndex);uniforms(op.present);}
  };
  emit();const size=offset;capacity(retained+nativeExtra+size*6);out=new Uint8Array(size);view=new DataView(out.buffer);offset=0;emit();check();return{ok:true,value:out};
 }catch(error){if(error instanceof SourceNativeError&&['input','capacity','cancelled','unsupported'].includes(error.kind))return{ok:false,error:{kind:error.kind as 'input'|'capacity'|'cancelled'|'unsupported',path:['samila'],reason:error.message}};throw error;}
}
/** Decode and bind the response to the exact resource and next checkpoint.
 * Pixels borrow the bounded response buffer. Row order is still GL bottom-up. */
export function decodeSourceSamilaNativeResponse(raw:Uint8Array,request:SourceSamilaNativeRequest):SourceSamilaNativeResponse {
 function fail(value:unknown,reason:string):asserts value {if(!value)throw new SourceNativeError('protocol',reason);}
 const {operation:op,width,height}=request;fail(raw.length===64+(sourceSamilaNativeHasPixels(op)?width*height*4:0),'Samila 响应长度不符');const v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),u=(at:number)=>v.getUint32(at,true);
 const resource=Array.from(raw.subarray(8,24),n=>n.toString(16).padStart(2,'0')).join('');fail(u(0)===1&&u(4)===kinds[op.kind]&&resource===op.resource&&u(60)===0,'Samila 响应身份不符');
 const committedDisplays=u(24),d=u(28),facts={steps:u(32),accepted:u(36),clipped:u(40),invalid:u(44),occupiedPixels:u(48),maxCount:v.getFloat32(52,true),invalidInkPixels:u(56)};
 if(op.kind==='display'||op.kind==='step'){
  fail(d===0&&committedDisplays===op.expectedIndex+1&&facts.steps===op.baseBatch*op.passes&&facts.accepted+facts.clipped+facts.invalid===facts.steps,'Samila 累积进度或实际统计无效');
  if(op.kind==='step')fail(facts.occupiedPixels===0&&u(52)===0&&facts.invalidInkPixels===0,'Samila step 不能声明未经测量的呈现统计');
 }
 if(sourceSamilaNativeHasPixels(op)){
  fail(d===0&&facts.occupiedPixels<=width*height&&Number.isFinite(facts.maxCount)&&facts.maxCount>=0&&facts.invalidInkPixels===0,'Samila 实际呈现统计无效');
  if(op.kind==='present')fail(committedDisplays===op.expectedIndex&&facts.steps===0&&facts.accepted===0&&facts.clipped===0&&facts.invalid===0,'Samila 只呈现事务不能推进采样');
 }

 if(op.kind==='create'||op.kind==='release'){for(let at=32;at<60;at+=4)fail(u(at)===0,'Samila 控制响应包含绘制统计');fail(op.kind==='create'?d===0&&committedDisplays===0:(d===1||d===2&&committedDisplays===0),'Samila 控制响应状态无效');}
 return{resource,committedDisplays,disposition:d===0?'owned':d===1?'released':'absent',...facts,...(sourceSamilaNativeHasPixels(op)?{pixels:new Uint8ClampedArray(raw.buffer,raw.byteOffset+64,raw.byteLength-64)}:{})};
}
