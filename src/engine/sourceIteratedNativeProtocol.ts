import {SOURCE_FRAME_BUDGET,SOURCE_FRAME_MAGIC} from './sourceDrawingFrame';
import type {SourceDrawingResult} from './sourceDrawingSnapshot';
import {SourceNativeError} from './sourceNativeError';
import {SOURCE_SYMMETRY_BINDING_TYPES,sourceSymmetryNativeBindingsBytes,sourceSymmetryNativeNamesBytes,sourceSymmetryNativeProcessingBytes,type SourceSymmetryNativeBinding,type SourceSymmetryAutomaticSetter,type SourceSymmetryMatchedParameter} from './sourceSymmetryNativeBindings';

export const SOURCE_ITERATED_NATIVE_VERSION=6;
export const SOURCE_ITERATED_NATIVE_FAMILY=2;
export const SOURCE_ITERATED_NATIVE_CHUNK_PARTICLES=65536;
export const SOURCE_ITERATED_NATIVE_FIXED_BYTES=1024*1024;
export interface SourceIteratedNativeShaders {vertex:string;fragment:string;}
/** Separate pure math and final-state diagnostic programs; their native ABI is
 * owned by the explicit source-prefix resource, never inferred from GLSL. */
export interface SourceIteratedNativeSourceShaders extends SourceIteratedNativeShaders {diagnosticVertex:string;diagnosticFragment:string;}
export interface SourceIteratedNativeUniform {name:string;value:number;}
type Owned={resource:string};
type Profile={profile?:'source-fragment'};
export type SourceIteratedDiagnosticUnit='iteration'|'completed-pass';
type Checkpoint=Owned&{expectedIndex:number;expectedCount:number};
export type SourceIteratedNativeOperation=
 | (Owned&SourceIteratedNativeShaders&{kind:'create';count:number})
 | (Owned&SourceIteratedNativeSourceShaders&{kind:'create-source';count:number})
 | (Owned&SourceIteratedNativeShaders&{kind:'create-fragment';count:number;bindingNames:readonly string[]})
 | (Checkpoint&{kind:'advance-fragment';reset:boolean;resetCounter:boolean;steps:number;bindings:readonly SourceSymmetryNativeBinding[]})
 | (Checkpoint&{kind:'advance-processing-fragment';reset:boolean;resetCounter:boolean;steps:number;automatic:readonly SourceSymmetryAutomaticSetter[];parameters:readonly SourceSymmetryMatchedParameter[]})
 | (Checkpoint&Profile&{kind:'upload';expectedIndex:0;offset:number;positionsAndMetric:Float32Array})
 | (Checkpoint&{kind:'advance';reset:boolean;resetCounter?:boolean;dimension:2|3;steps:number;uniforms:readonly SourceIteratedNativeUniform[]})
 | (Checkpoint&Profile&{kind:'read';offset:number;count:number})
 | (Owned&Profile&{kind:'release';expectedIndex?:number;expectedCount?:number});
/** All operations use a 1x1, zero-clear, zero-draw envelope. Logical expected
 * counts bind responses and admission; they are not extra wire fields. */
export interface SourceIteratedNativeRequest {generation:number;sequence:number;operation:SourceIteratedNativeOperation;}
/** Immutable scalar facts captured after admission and before transport. No
 * uploaded seed storage or caller-owned operation object is retained. */
export type SourceIteratedNativeResponseBinding=Readonly<
 | (Owned&{kind:'create';count:number})
 | (Owned&{kind:'create-source';count:number})
 | (Owned&{kind:'create-fragment';count:number})
 | (Checkpoint&{kind:'advance-fragment';steps:number})
 | (Checkpoint&{kind:'advance-processing-fragment';steps:number;automaticNames:readonly (readonly string[])[];parameterNames:readonly string[]})
 | (Checkpoint&Profile&{kind:'upload';uploaded:number})
 | (Checkpoint&{kind:'advance';steps:number})
 | (Checkpoint&Profile&{kind:'read';offset:number;count:number})
 | (Owned&Profile&{kind:'release';expectedIndex?:number;expectedCount?:number})
>;
export interface SourceIteratedNativeResponse {
 diagnosticUnit:SourceIteratedDiagnosticUnit;resource:string;index:number;disposition:'owned'|'released'|'absent';uploaded:number;totalCount:number;offset:number;readCount:number;steps:number;
 positionsAndMetric?:Float32Array;invalidCounts?:Uint32Array;validity?:Uint8Array;
 processingBindings?:{automatic:readonly {outcome:'skipped'|'inactive'|'applied'|'rejected';selectedName?:string}[];parameters:readonly {name:string;outcome:'skipped'|'inactive'|'applied'|'rejected'}[]};
}
const kinds={create:1,upload:2,advance:3,read:4,release:5,'create-source':6,'create-fragment':7,'advance-fragment':8,'advance-processing-fragment':9} as const;
function fragment(op:SourceIteratedNativeOperation|SourceIteratedNativeResponseBinding):boolean{return op.kind==='create-fragment'||op.kind==='advance-fragment'||op.kind==='advance-processing-fragment'||'profile' in op&&op.profile==='source-fragment';}
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const uint=(n:number)=>Number.isInteger(n)&&n>=0&&n<=0xffffffff;
const count=(n:number)=>uint(n)&&n>0&&n<=8_000_000;
function demand(condition:unknown,reason:string):asserts condition {if(!condition)throw new SourceNativeError('input',reason);}
function capacity(bytes:number){if(!Number.isSafeInteger(bytes)||bytes<0||bytes>SOURCE_FRAME_BUDGET)throw new SourceNativeError('capacity','原生迭代计算状态、协议副本与读取缓冲超过 256 MiB 预算');}
function textBytes(text:string):Uint8Array {
 demand(typeof text==='string'&&text.length>0&&!text.includes('\0'),'原生迭代字符串无效');capacity(text.length*3);
 const bytes=encoder.encode(text);demand(decoder.decode(bytes)===text,'原生迭代字符串不是有效 Unicode');return bytes;
}
/** Native profiles are supplied by the shader producer, never translated from
 * ES source here. This charge is source UTF-8 bytes times three, not driver RSS. */
function shaderProgramBytes(sources:readonly string[]):number {
 let bytes=0;
 for(const source of sources){demand(typeof source==='string'&&source.startsWith('#version 410 core\n'),'原生迭代 shader 必须显式提供 #version 410 core');bytes+=textBytes(source).length*3;capacity(bytes);}
 return bytes;
}
export function sourceIteratedNativeProgramBytes(shaders:SourceIteratedNativeShaders):number {
 return shaderProgramBytes([shaders?.vertex,shaders?.fragment]);
}
export function sourceIteratedNativeSourceProgramBytes(shaders:SourceIteratedNativeSourceShaders):number {
 return shaderProgramBytes([shaders?.vertex,shaders?.fragment,shaders?.diagnosticVertex,shaders?.diagnosticFragment]);
}
export function sourceSymmetryNativeResidentBytes(particles:number,programBytes:number,bindingNames:readonly string[]=[]):number {
 demand(count(particles)&&Number.isSafeInteger(programBytes)&&programBytes>=0,'原生 Symmetry 驻留容量无效');return Math.ceil(Math.sqrt(particles))**2*64+programBytes+SOURCE_ITERATED_NATIVE_FIXED_BYTES+sourceSymmetryNativeNamesBytes(bindingNames);
}
export function sourceIteratedNativeResidentBytes(particles:number,programBytes:number):number {
 demand(count(particles)&&Number.isSafeInteger(programBytes)&&programBytes>=0,'原生迭代驻留容量无效');return particles*64+programBytes+SOURCE_ITERATED_NATIVE_FIXED_BYTES;
}
const responseBindings=new WeakSet<object>();
/** This captures response identity/range only. Full shader, seed-value and
 * uniform admission belongs to encodeSourceIteratedNativeRequest. */
export function captureSourceIteratedNativeResponseBinding(request:SourceIteratedNativeRequest):SourceIteratedNativeResponseBinding {
 demand(request&&uint(request.generation)&&request.generation>0&&uint(request.sequence)&&request.sequence>0,'原生迭代请求身份无效');
 const op=request.operation;demand(op&&Object.hasOwn(kinds,op.kind)&&typeof op.resource==='string'&&/^[a-f0-9]{32}$/.test(op.resource)&&op.resource!=='0'.repeat(32),'原生迭代资源身份无效');
 demand(!('profile' in op)||op.profile===undefined||(['upload','read','release'].includes(op.kind)&&op.profile==='source-fragment'),'原生迭代资源 profile 无效');
 const profile=fragment(op)?{profile:'source-fragment' as const}:{};
 let binding:SourceIteratedNativeResponseBinding;
 if(op.kind==='create'||op.kind==='create-source'||op.kind==='create-fragment'){demand(count(op.count),'原生迭代粒子数无效');binding={kind:op.kind,resource:op.resource,count:op.count};}
 else if(op.kind==='release'){
  demand(op.expectedIndex===undefined||uint(op.expectedIndex),'原生迭代释放检查点无效');demand(op.expectedCount===undefined||count(op.expectedCount),'原生迭代释放粒子数无效');
  binding={...profile,kind:op.kind,resource:op.resource,...(op.expectedIndex===undefined?{}:{expectedIndex:op.expectedIndex}),...(op.expectedCount===undefined?{}:{expectedCount:op.expectedCount})};
 }else{
  demand(uint(op.expectedIndex)&&count(op.expectedCount),'原生迭代检查点或粒子数无效');
  const base={...profile,resource:op.resource,expectedIndex:op.expectedIndex,expectedCount:op.expectedCount};
  if(op.kind==='upload'){
   const a=op.positionsAndMetric;
   demand(op.expectedIndex===0&&a instanceof Float32Array&&a.buffer instanceof ArrayBuffer&&a.length>0&&a.length%4===0&&a.length/4<=SOURCE_ITERATED_NATIVE_CHUNK_PARTICLES,'原生迭代上传块无效');
   demand(uint(op.offset)&&op.offset<=op.expectedCount&&a.length/4<=op.expectedCount-op.offset,'原生迭代上传范围无效');
   binding={...base,kind:op.kind,uploaded:op.offset+a.length/4};
  }else if(op.kind==='advance'||op.kind==='advance-fragment'||op.kind==='advance-processing-fragment'){
   demand(op.expectedIndex<0xffffffff&&uint(op.steps)&&op.steps<=(op.kind==='advance'?256:16),'原生迭代推进检查点或步骤无效');
   if(op.kind==='advance-processing-fragment'){
    capacity(sourceSymmetryNativeProcessingBytes(op.automatic,op.parameters));
    binding={...base,kind:op.kind,steps:op.steps,automaticNames:Object.freeze(op.automatic.map(s=>Object.freeze([...s.names]))),parameterNames:Object.freeze(op.parameters.map(p=>p.name))};
   }else binding={...base,kind:op.kind,steps:op.steps};
  }else{
   demand(uint(op.offset)&&uint(op.count)&&op.count>0&&op.count<=SOURCE_ITERATED_NATIVE_CHUNK_PARTICLES&&op.offset<=op.expectedCount&&op.count<=op.expectedCount-op.offset,'原生迭代读取范围无效');
   binding={...base,kind:op.kind,offset:op.offset,count:op.count};
  }
 }
 Object.freeze(binding);responseBindings.add(binding);return binding;
}
function validate(request:SourceIteratedNativeRequest){
 captureSourceIteratedNativeResponseBinding(request);const op=request.operation;
 if(op.kind==='upload')demand(op.positionsAndMetric.every(Number.isFinite),'原生迭代上传块须为有限 canonical seed');
 if(op.kind==='create-fragment')sourceSymmetryNativeNamesBytes(op.bindingNames);
 if(op.kind==='advance-fragment'){demand(typeof op.reset==='boolean'&&typeof op.resetCounter==='boolean'&&(!op.reset||op.resetCounter),'Symmetry 推进配置无效');sourceSymmetryNativeBindingsBytes(op.bindings);}
 if(op.kind==='advance-processing-fragment'){demand(typeof op.reset==='boolean'&&typeof op.resetCounter==='boolean'&&(!op.reset||op.resetCounter),'Processing Symmetry 推进配置无效');sourceSymmetryNativeProcessingBytes(op.automatic,op.parameters);}
 if(op.kind==='advance'){
  demand(typeof op.reset==='boolean'&&(op.dimension===2||op.dimension===3)&&(op.resetCounter===undefined||typeof op.resetCounter==='boolean'&&(!op.reset||op.resetCounter)),'原生迭代推进配置无效');
  demand(Array.isArray(op.uniforms)&&op.uniforms.length<=65536,'原生迭代 uniform 集合无效');const names=new Set<string>();
  for(const u of op.uniforms){demand(u&&typeof u.name==='string'&&/^[A-Za-z_]\w*$/.test(u.name)&&!u.name.startsWith('gl_')&&!['steps','dimension','resetCounter'].includes(u.name)&&!names.has(u.name),'原生迭代 uniform 名称无效或重复');demand(typeof u.value==='number'&&Number.isFinite(Math.fround(u.value)),'原生迭代 uniform 必须为有限 float32');names.add(u.name);}
 }
}
/** retainedBytes includes every currently resident native owner (including the
 * operated resource). Create adds its new resident allocation. Other commands
 * check at least the known particle allocation; the service owns exact live
 * program accounting. Release remains possible when live capacity is exceeded.
 * Read's 48 bytes/particle cover the raw response plus detached decoded arrays.
 * No shader compiler, native process or GPU is invoked by this codec. */
export function encodeSourceIteratedNativeRequest(request:SourceIteratedNativeRequest,options:{isCancelled?:()=>boolean;retainedBytes?:number}={}):SourceDrawingResult<Uint8Array> {
 try{
  const check=()=>{if(options.isCancelled?.())throw new SourceNativeError('cancelled','原生迭代事务编码已取消');};check();validate(request);
  const retained=options.retainedBytes??0;demand(Number.isSafeInteger(retained)&&retained>=0,'原生迭代保留容量无效');const op=request.operation;
  const resident=op.kind==='create-fragment'?retained+sourceSymmetryNativeResidentBytes(op.count,sourceIteratedNativeProgramBytes(op),op.bindingNames):op.kind==='create'||op.kind==='create-source'?retained+sourceIteratedNativeResidentBytes(op.count,op.kind==='create-source'?sourceIteratedNativeSourceProgramBytes(op):sourceIteratedNativeProgramBytes(op)):op.kind==='release'?0:Math.max(retained,(fragment(op)?sourceSymmetryNativeResidentBytes:sourceIteratedNativeResidentBytes)(op.expectedCount,0));
  const transient=op.kind==='read'?48*op.count:op.kind==='advance-fragment'?sourceSymmetryNativeBindingsBytes(op.bindings):op.kind==='advance-processing-fragment'?sourceSymmetryNativeProcessingBytes(op.automatic,op.parameters):0;capacity(resident+transient);
  let offset=0,out:Uint8Array|undefined,view:DataView|undefined;
  const reserve=(bytes:number)=>{capacity(offset+bytes);const at=offset;offset+=bytes;return at;};
  const word=(value:number)=>{const at=reserve(4);view?.setUint32(at,value,true);};
  const float=(value:number)=>{const at=reserve(4);view?.setFloat32(at,value,true);};
  const block=(bytes:Uint8Array)=>{word(bytes.length);const at=reserve(bytes.length);if(out)for(let i=0;i<bytes.length;i+=65536){check();out.set(bytes.subarray(i,i+65536),at+i);}};
  const strings=new Map<string,Uint8Array>();
  const text=(value:string)=>{let bytes=strings.get(value);if(!bytes){bytes=textBytes(value);strings.set(value,bytes);}block(bytes);};
  const floats=(values:Float32Array)=>{
   word(values.byteLength);const at=reserve(values.byteLength);
   // Copy canonical seed F32 representations, including -0, without a
   // JS-number round trip. DataView keeps the wire explicitly little-endian.
   if(view){const bits=new Uint32Array(values.buffer,values.byteOffset,values.length);for(let i=0;i<bits.length;i++){if((i&16383)===0)check();view.setUint32(at+i*4,bits[i],true);}}
  };
  const emit=()=>{
   check();word(SOURCE_FRAME_MAGIC);word(op.kind==='advance-processing-fragment'?9:fragment(op)?8:op.kind==='create-source'||op.kind==='advance'&&op.resetCounter!==undefined?7:SOURCE_ITERATED_NATIVE_VERSION);word(out?.length??0);word(request.generation);word(request.sequence);word(1);word(1);for(let i=0;i<8;i++)word(0);
   word(SOURCE_ITERATED_NATIVE_FAMILY);word(kinds[op.kind]);block(Uint8Array.from(op.resource.match(/../g)!,v=>parseInt(v,16)));
   if(op.kind==='create'||op.kind==='create-source'||op.kind==='create-fragment'){word(op.count);text(op.vertex);text(op.fragment);if(op.kind==='create-source'){text(op.diagnosticVertex);text(op.diagnosticFragment);}if(op.kind==='create-fragment'){word(op.bindingNames.length);for(const name of op.bindingNames)text(name);}}
   if(op.kind==='upload'){word(op.expectedIndex);word(op.offset);floats(op.positionsAndMetric);}
   if(op.kind==='advance'){word(op.expectedIndex);word(op.reset?1:0);if(op.resetCounter!==undefined)word(op.resetCounter?1:0);word(op.dimension);word(op.steps);word(op.uniforms.length);for(const u of op.uniforms){check();text(u.name);float(u.value);}}
   if(op.kind==='advance-fragment'){word(op.expectedIndex);word(op.reset?1:0);word(op.resetCounter?1:0);word(op.steps);word(op.bindings.length);for(const binding of op.bindings){check();text(binding.name);word(binding.type);word(binding.values.length);for(const n of binding.values){if(SOURCE_SYMMETRY_BINDING_TYPES[binding.type].integer)word(n>>>0);else float(n);}}}
   if(op.kind==='advance-processing-fragment'){
    word(op.expectedIndex);word(op.reset?1:0);word(op.resetCounter?1:0);word(op.steps);word(op.automatic.length);word(op.parameters.length);
    for(const setter of op.automatic){check();word(setter.names.length);for(const name of setter.names)text(name);word(setter.type);word(setter.values.length);for(const n of setter.values){if(setter.type===5124)word(n>>>0);else float(n);}}
    for(const parameter of op.parameters){check();text(parameter.name);float(parameter.value);}
   }
   if(op.kind==='read'){word(op.expectedIndex);word(op.offset);word(op.count);}
  };
  emit();const size=offset;capacity(resident+transient+size*6);out=new Uint8Array(size);view=new DataView(out.buffer);offset=0;emit();check();return{ok:true,value:out};
 }catch(error){if(error instanceof SourceNativeError&&['input','capacity','cancelled'].includes(error.kind))return{ok:false,error:{kind:error.kind as 'input'|'capacity'|'cancelled',path:['iterated'],reason:error.message}};throw error;}
}
/** The codec owns the full payload length, including v9 setter results. HTTP
 * clients consume these captured facts rather than reinterpret operation kinds. */
export function sourceIteratedNativeResponseBytes(binding:SourceIteratedNativeResponseBinding):number {
 if(!responseBindings.has(binding))throw new SourceNativeError('protocol','原生迭代响应绑定必须由 codec 捕获');
 return 64+(binding.kind==='read'?binding.count*24:binding.kind==='advance-processing-fragment'?8+(binding.automaticNames.length+binding.parameterNames.length)*4:0);
}
/** Bind every reply to the exact operation, resource, checkpoint and bounded
 * range before allocating decoded arrays. Read does not advance state; advance
 * commits one checkpoint even when its requested mathematical step count is 0. */
export function decodeSourceIteratedNativeResponse(raw:Uint8Array,request:SourceIteratedNativeRequest|SourceIteratedNativeResponseBinding):SourceIteratedNativeResponse {
 const fail=(condition:unknown,reason:string)=>{if(!condition)throw new SourceNativeError('protocol',reason);};
 const op='operation' in request?captureSourceIteratedNativeResponseBinding(request):request;
 // Bindings are local codec outputs, not another transport format. Reject a
 // forged or reinterpreted object rather than reading unadmitted scalar facts.
 fail(responseBindings.has(op),'原生迭代响应绑定必须由 codec 捕获');
 const readCount=op.kind==='read'?op.count:0;
 fail(raw instanceof Uint8Array&&raw.buffer instanceof ArrayBuffer&&raw.byteLength===sourceIteratedNativeResponseBytes(op),'原生迭代响应长度无效');
 const v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),u=(at:number)=>v.getUint32(at,true),resource=Array.from(raw.subarray(8,24),n=>n.toString(16).padStart(2,'0')).join('');
 fail(u(0)===SOURCE_ITERATED_NATIVE_FAMILY&&u(4)===kinds[op.kind]&&resource===op.resource,'原生迭代响应身份不符');
 const profile=fragment(op)?1:0;fail(u(52)===profile&&u(56)===profile&&u(60)===(op.kind==='advance-processing-fragment'?1:0),'原生迭代响应诊断单位、profile 或保留字段不符');
 const index=u(24),d=u(28),uploaded=u(32),totalCount=u(36),offset=u(40),returnedCount=u(44),steps=u(48);
 fail(returnedCount===readCount&&offset===(op.kind==='read'?op.offset:0),'原生迭代响应读取范围不符');
 fail(steps===(op.kind==='advance'||op.kind==='advance-fragment'||op.kind==='advance-processing-fragment'?op.steps:0),'原生迭代响应步骤数不符');
 if(op.kind==='release'){
  fail(d===1||d===2,'原生迭代释放响应状态无效');
  if(d===2)fail(index===0&&uploaded===0&&totalCount===0,'原生迭代不存在资源响应含有状态');
  else fail(count(totalCount)&&uploaded<=totalCount&&(op.expectedIndex===undefined||index===op.expectedIndex)&&(op.expectedCount===undefined||totalCount===op.expectedCount),'原生迭代释放响应检查点或容量不符');
 }else{
  const expectedCount=(op.kind==='create'||op.kind==='create-source'||op.kind==='create-fragment')?op.count:op.expectedCount,expectedIndex=(op.kind==='create'||op.kind==='create-source'||op.kind==='create-fragment')?0:op.expectedIndex+(op.kind==='advance'||op.kind==='advance-fragment'||op.kind==='advance-processing-fragment'?1:0);
  const expectedUploaded=(op.kind==='create'||op.kind==='create-source'||op.kind==='create-fragment')?0:op.kind==='upload'?op.uploaded:expectedCount;
  fail(d===0&&totalCount===expectedCount&&index===expectedIndex&&uploaded===expectedUploaded,'原生迭代响应检查点或上传进度不符');
 }
 const result:SourceIteratedNativeResponse={diagnosticUnit:profile?'completed-pass':'iteration',resource,index,disposition:d===0?'owned':d===1?'released':'absent',uploaded,totalCount,offset,readCount:returnedCount,steps};
 if(op.kind==='advance-processing-fragment'){
  fail(u(64)===op.automaticNames.length&&u(68)===op.parameterNames.length,'Processing setter 响应数量不符');
  const automatic:NonNullable<SourceIteratedNativeResponse['processingBindings']>['automatic'][number][]=[],parameters:NonNullable<SourceIteratedNativeResponse['processingBindings']>['parameters'][number][]=[];
  for(let i=0;i<op.automaticNames.length;i++){
   const code=u(72+i*4),names=op.automaticNames[i];fail(steps?code>=1&&code<=names.length*2+1:code===0,'Processing automatic 响应状态无效');
   automatic.push(Object.freeze(code<2?{outcome:code===0?'skipped':'inactive'}:{outcome:code%2?'rejected':'applied',selectedName:names[Math.floor((code-2)/2)]}));
  }
  for(let i=0;i<op.parameterNames.length;i++){
   const code=u(72+(op.automaticNames.length+i)*4);fail(steps?code>=1&&code<=3:code===0,'Processing matched float 响应状态无效');parameters.push(Object.freeze({name:op.parameterNames[i],outcome:(['skipped','inactive','applied','rejected'] as const)[code]}));
  }
  result.processingBindings={automatic:Object.freeze(automatic),parameters:Object.freeze(parameters)};
 }
 if(op.kind==='read'){
  // Validate the entire interleaved payload before publishing any partial state.
  for(let i=0;i<readCount;i++)fail(u(64+i*24+20)<=1,'原生迭代粒子有效性必须为 0 或 1');
  const positionsAndMetric=new Float32Array(readCount*4),bits=new Uint32Array(positionsAndMetric.buffer),invalidCounts=new Uint32Array(readCount),validity=new Uint8Array(readCount);
  for(let i=0;i<readCount;i++){const at=64+i*24;for(let j=0;j<4;j++)bits[i*4+j]=u(at+j*4);invalidCounts[i]=u(at+16);validity[i]=u(at+20);}
  Object.assign(result,{positionsAndMetric,invalidCounts,validity});
 }
 return result;
}
