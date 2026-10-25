import {describe,expect,it} from 'vitest';
import {SOURCE_FRAME_BUDGET,SOURCE_FRAME_MAGIC} from '../src/engine/sourceDrawingFrame';
import {SOURCE_ITERATED_NATIVE_CHUNK_PARTICLES,SOURCE_ITERATED_NATIVE_FIXED_BYTES,captureSourceIteratedNativeResponseBinding,encodeSourceIteratedNativeRequest,decodeSourceIteratedNativeResponse,sourceIteratedNativeProgramBytes,sourceIteratedNativeSourceProgramBytes,sourceIteratedNativeResidentBytes,type SourceIteratedNativeOperation,type SourceIteratedNativeRequest} from '../src/engine/sourceIteratedNativeProtocol';

const resource='1234567890abcdef1234567890abcdef',vertex='#version 410 core\nvoid main() { gl_Position=vec4(0); }',fragment='#version 410 core\nvoid main() {}';
const request=(operation:SourceIteratedNativeOperation):SourceIteratedNativeRequest=>({generation:17,sequence:23,operation});
const create=(count=2)=>request({kind:'create',resource,count,vertex,fragment});
const diagnosticVertex='#version 410 core\n// 独立分类\nvoid main() {}',diagnosticFragment='#version 410 core\n// diagnostic fragment\nvoid main() {}';
const createSource=(count=2)=>request({kind:'create-source',resource,count,vertex,fragment,diagnosticVertex,diagnosticFragment});
const upload=(offset=0,count=2)=>request({kind:'upload',resource,expectedIndex:0,expectedCount:count,offset,positionsAndMetric:new Float32Array([.25,-.5,0,0])});
const advance=(steps=3,index=0)=>request({kind:'advance',resource,expectedIndex:index,expectedCount:2,reset:false,dimension:2,steps,uniforms:[{name:'gain',value:.1},{name:'time',value:-0}]});
const read=(offset=0,count=2)=>request({kind:'read',resource,expectedIndex:7,expectedCount:2,offset,count});
const release=()=>request({kind:'release',resource});
const bytes=(input:SourceIteratedNativeRequest,options:Parameters<typeof encodeSourceIteratedNativeRequest>[1]={})=>{const result=encodeSourceIteratedNativeRequest(input,options);if(!result.ok)throw Error(result.error.reason);return result.value;};
function response(input:SourceIteratedNativeRequest,changes:Record<number,number>={}){
 const op=input.operation;if(op.kind==='create-fragment'||op.kind==='advance-fragment')throw Error('Legacy fixture only');const readCount=op.kind==='read'?op.count:0,out=new Uint8Array(64+readCount*24),v=new DataView(out.buffer),set=(at:number,n:number)=>v.setUint32(at,n,true);
 set(0,2);set(4,{create:1,upload:2,advance:3,read:4,release:5,'create-source':6}[op.kind]);out.set(Uint8Array.from(resource.match(/../g)!,n=>parseInt(n,16)),8);
 set(24,(op.kind==='create'||op.kind==='create-source')?0:op.kind==='release'?7:op.expectedIndex+(op.kind==='advance'?1:0));set(28,op.kind==='release'?1:0);
 set(32,(op.kind==='create'||op.kind==='create-source')?0:op.kind==='upload'?op.offset+op.positionsAndMetric.length/4:2);set(36,(op.kind==='create'||op.kind==='create-source')?op.count:op.kind==='release'?2:op.expectedCount);
 if(op.kind==='read'){set(40,op.offset);set(44,op.count);for(let i=0;i<readCount;i++)set(64+i*24+20,1);}
 if(op.kind==='advance')set(48,op.steps);
 for(const [at,n]of Object.entries(changes))set(Number(at),n);return out;
}
const reject=(input:SourceIteratedNativeRequest,kind='input')=>expect(encodeSourceIteratedNativeRequest(input)).toMatchObject({ok:false,error:{kind}});

describe('bounded iterated native v6/v7 codec (CPU only)',()=>{
 it('writes the exact 60-byte neutral envelope and family/resource block',()=>{
  const packet=bytes(release()),v=new DataView(packet.buffer);expect(packet.length).toBe(88);
  expect(Array.from({length:15},(_,i)=>v.getUint32(i*4,true))).toEqual([SOURCE_FRAME_MAGIC,6,88,17,23,1,1,0,0,0,0,0,0,0,0]);
  expect([v.getUint32(60,true),v.getUint32(64,true),v.getUint32(68,true)]).toEqual([2,5,16]);expect(Array.from(packet.subarray(72))).toEqual(Array.from(Uint8Array.from(resource.match(/../g)!,n=>parseInt(n,16))));
 });
 it('encodes explicit native shader bytes after count without modifying source',()=>{
  const input=create(),packet=bytes(input),v=new DataView(packet.buffer),text=new TextDecoder();let at=88;
  expect(v.getUint32(at,true)).toBe(2);at+=4;
  for(const shader of [vertex,fragment]){const n=v.getUint32(at,true);at+=4;expect(text.decode(packet.subarray(at,at+n))).toBe(shader);at+=n;}expect(at).toBe(packet.length);
  expect(sourceIteratedNativeProgramBytes({vertex,fragment})).toBe(new TextEncoder().encode(vertex+fragment).length*3);
 });
 it('encodes source-prefix creation as v7 kind6 and four exact UTF8 blocks while preserving generic v6 bytes',()=>{
  const generic=bytes(create()),source=bytes(createSource()),v=new DataView(source.buffer),text=new TextDecoder();
  expect([v.getUint32(4,true),v.getUint32(60,true),v.getUint32(64,true),v.getUint32(88,true)]).toEqual([7,2,6,2]);
  let at=92;for(const shader of [vertex,fragment,diagnosticVertex,diagnosticFragment]){const n=v.getUint32(at,true);at+=4;expect(text.decode(source.subarray(at,at+n))).toBe(shader);at+=n;}expect(at).toBe(source.length);
  // Removing only the two explicit diagnostic blocks yields the old wire,
  // after updating the three envelope fields that distinguish the operation.
  const old=source.slice(0,generic.length),oldView=new DataView(old.buffer);oldView.setUint32(4,6,true);oldView.setUint32(8,old.length,true);oldView.setUint32(64,1,true);expect(old).toEqual(generic);
  const shaders={vertex,fragment,diagnosticVertex,diagnosticFragment};
  expect(sourceIteratedNativeSourceProgramBytes(shaders)).toBe(new TextEncoder().encode(vertex+fragment+diagnosticVertex+diagnosticFragment).length*3);
  expect(sourceIteratedNativeProgramBytes(shaders)).toBe(new TextEncoder().encode(vertex+fragment).length*3);
  expect(decodeSourceIteratedNativeResponse(response(createSource()),createSource())).toMatchObject({index:0,uploaded:0,totalCount:2,steps:0});
  expect(()=>decodeSourceIteratedNativeResponse(response(createSource(),{4:1}),createSource())).toThrow('身份');
 });
 it.each(['diagnosticVertex','diagnosticFragment'] as const)('rejects invalid %s at source shader admission',key=>{
  for(const bad of [undefined,'','#version 300 es\nvoid main() {}','#version 410 core\r\nvoid main() {}',diagnosticVertex+'\0',diagnosticVertex+'\ud800']){
   const input=createSource();Object.assign(input.operation,{[key]:bad});reject(input);
  }
 });
 it('charges both source programs and six packet copies at the exact aggregate capacity boundary',()=>{
  const input=createSource(1),size=bytes(input).length,program=sourceIteratedNativeSourceProgramBytes({vertex,fragment,diagnosticVertex,diagnosticFragment});
  const resident=sourceIteratedNativeResidentBytes(1,program),retained=SOURCE_FRAME_BUDGET-resident-size*6;
  expect(bytes(input,{retainedBytes:retained})).toHaveLength(size);expect(encodeSourceIteratedNativeRequest(input,{retainedBytes:retained+1})).toMatchObject({ok:false,error:{kind:'capacity'}});
  // Stateless advance encoding deliberately does not guess a retained profile;
  // source <=16 admission belongs to the acknowledged service/native owner.
  expect(bytes(advance(256))).toBeInstanceOf(Uint8Array);
 });
 it('writes float uniform pairs without a kind word, and commits zero-step advances',()=>{
  const input=advance(0,8),packet=bytes(input),v=new DataView(packet.buffer);
  expect(Array.from({length:5},(_,i)=>v.getUint32(88+i*4,true))).toEqual([8,0,2,0,2]);
  expect(v.getUint32(108,true)).toBe(4);expect(new TextDecoder().decode(packet.subarray(112,116))).toBe('gain');expect(v.getFloat32(116,true)).toBe(Math.fround(.1));
  expect(v.getUint32(120,true)).toBe(4);expect(v.getUint32(128,true)).toBe(0x80000000);expect(packet.length).toBe(132);
  expect(decodeSourceIteratedNativeResponse(response(input),input)).toMatchObject({index:9,steps:0,uploaded:2,totalCount:2});
 });
 it.each([undefined,false,true] as const)('uses the existing dimension word for 3D with resetCounter=%s and preserves every other 2D byte',resetCounter=>{
  const input=advance(4,9),op=input.operation;if(op.kind!=='advance')throw Error('fixture');
  const two=bytes(request({...op,resetCounter})),three=bytes(request({...op,resetCounter,dimension:3}));
  const offset=resetCounter===undefined?96:100,expected=two.slice();new DataView(expected.buffer).setUint32(offset,3,true);
  expect(three).toEqual(expected);expect(new DataView(three.buffer).getUint32(4,true)).toBe(resetCounter===undefined?6:7);
  const req=request({...op,resetCounter,dimension:3});expect(decodeSourceIteratedNativeResponse(response(req),req)).toMatchObject({index:10,steps:4,totalCount:2});
 });
 it('uploads a nonzero-byteOffset block without changing any F32 bits',()=>{
  const storage=new Uint32Array([0x12345678,0x80000000,0x00000001,0x7f7fffff,0xff7fffff,0x87654321]),values=new Float32Array(storage.buffer,4,4);
  const input=request({kind:'upload',resource,expectedIndex:0,expectedCount:2,offset:1,positionsAndMetric:values}),packet=bytes(input),v=new DataView(packet.buffer);
  expect([v.getUint32(88,true),v.getUint32(92,true),v.getUint32(96,true)]).toEqual([0,1,16]);expect(Array.from({length:4},(_,i)=>v.getUint32(100+i*4,true))).toEqual(Array.from(storage.subarray(1,5)));
  expect(decodeSourceIteratedNativeResponse(response(input),input)).toMatchObject({index:0,uploaded:2,totalCount:2,readCount:0});
 });
 it('reads an unaligned response slice and preserves every state word independently of validity',()=>{
  const input=read(),raw=response(input),v=new DataView(raw.buffer),words=[0x80000000,0x7fc01234,0x7f800000,0xff800000,0x3f800000,0x40000000,0x40400000,0x40800000];
  for(let i=0;i<2;i++){for(let j=0;j<4;j++)v.setUint32(64+i*24+j*4,words[i*4+j],true);v.setUint32(64+i*24+16,0xffffffff-i,true);v.setUint32(64+i*24+20,i,true);}
  const backing=new Uint8Array(raw.length+3);backing.set(raw,1);const result=decodeSourceIteratedNativeResponse(backing.subarray(1,1+raw.length),input);
  expect(Array.from(new Uint32Array(result.positionsAndMetric!.buffer))).toEqual(words);expect(Array.from(result.invalidCounts!)).toEqual([0xffffffff,0xfffffffe]);expect(Array.from(result.validity!)).toEqual([0,1]);
  backing.fill(0);expect(result.positionsAndMetric![4]).toBe(1);expect(result.index).toBe(7);
 });
 it('encodes a bounded read range while expectedCount stays logical',()=>{
  const packet=bytes(read(1,1)),v=new DataView(packet.buffer);expect(packet.length).toBe(100);expect([v.getUint32(88,true),v.getUint32(92,true),v.getUint32(96,true)]).toEqual([7,1,1]);
  expect(decodeSourceIteratedNativeResponse(response(read(1,1)),read(1,1))).toMatchObject({offset:1,readCount:1,totalCount:2,index:7});
 });
 it.each(['create','create-source','upload','advance','read','release'] as const)('%s binds the exact response family, operation, identity and reserved words',kind=>{
  const input={create:create(),'create-source':createSource(),upload:upload(),advance:advance(),read:read(),release:release()}[kind],good=response(input);
  for(const at of [0,4,52,56,60]){const bad=good.slice();new DataView(bad.buffer).setUint32(at,999,true);expect(()=>decodeSourceIteratedNativeResponse(bad,input)).toThrow();}
  const foreign=good.slice();foreign[8]^=1;expect(()=>decodeSourceIteratedNativeResponse(foreign,input)).toThrow('身份');
  expect(()=>decodeSourceIteratedNativeResponse(good.subarray(1),input)).toThrow('长度');const extra=new Uint8Array(good.length+1);extra.set(good);expect(()=>decodeSourceIteratedNativeResponse(extra,input)).toThrow('长度');
 });
 it.each([create(),createSource(),upload(),advance(),read()])('binds owned checkpoint, uploaded count, total count and measured steps for $operation.kind',input=>{
  const good=response(input),v=new DataView(good.buffer);
  for(const at of [24,28,32,36,40,44,48]){const bad=good.slice();new DataView(bad.buffer).setUint32(at,v.getUint32(at,true)+1,true);expect(()=>decodeSourceIteratedNativeResponse(bad,input)).toThrow();}
 });
 it('rejects non-boolean validity across the complete read range',()=>{const input=read();expect(()=>decodeSourceIteratedNativeResponse(response(input,{108:2}),input)).toThrow('有效性');});
 it('releases known state exactly or cleans an uncertain checkpoint without inventing a checkpoint',()=>{
  const known=request({kind:'release',resource,expectedIndex:7,expectedCount:2});expect(decodeSourceIteratedNativeResponse(response(known),known)).toMatchObject({disposition:'released',index:7,totalCount:2});
  expect(()=>decodeSourceIteratedNativeResponse(response(known,{24:8}),known)).toThrow();expect(()=>decodeSourceIteratedNativeResponse(response(known,{36:3}),known)).toThrow();
  expect(decodeSourceIteratedNativeResponse(response(release(),{24:0xffffffff}),release()).index).toBe(0xffffffff);
  const absent=response(known,{24:0,28:2,32:0,36:0});expect(decodeSourceIteratedNativeResponse(absent,known)).toMatchObject({disposition:'absent',index:0,totalCount:0});
  for(const at of [24,32,36]){const bad=absent.slice();new DataView(bad.buffer).setUint32(at,1,true);expect(()=>decodeSourceIteratedNativeResponse(bad,known)).toThrow();}
  expect(()=>decodeSourceIteratedNativeResponse(response(known,{28:0}),known)).toThrow();expect(()=>decodeSourceIteratedNativeResponse(response(known,{32:3}),known)).toThrow();
 });
 it('rejects malformed identity, checkpoint, count and explicit profile before allocation',()=>{
  for(const n of [0,-1,.5,0x100000000,NaN]){reject({...create(),generation:n});reject({...create(),sequence:n});}
  for(const id of ['',resource.toUpperCase(),'0'.repeat(32),'ff'])reject(request({...create().operation,resource:id}));
  for(const n of [0,-1,.5,8_000_001,NaN])reject(create(n));
  for(const source of ['void main() {}','#version 300 es\nvoid main() {}',vertex+'\0',vertex+'\ud800','#version 410 core\r\nvoid main() {}','#version 410 core'])reject(request({kind:'create',resource,count:1,vertex:source,fragment}));
  reject(request({...advance().operation,expectedIndex:0xffffffff} as SourceIteratedNativeOperation));
 });
 it('requires bounded upload-sized ranges and finite canonical seeds without shared buffers',()=>{
  const input=upload(),op=input.operation;if(op.kind!=='upload')throw Error('fixture');
  for(const offset of [-1,.5,2,0xffffffff])reject(request({...op,offset}));
  for(const values of [new Float32Array(),new Float32Array(3),new Float32Array([NaN,0,0,0]),new Float32Array([Infinity,0,0,0]),new Float32Array([-Infinity,0,0,0]),new Float32Array((SOURCE_ITERATED_NATIVE_CHUNK_PARTICLES+1)*4),new Float32Array(new SharedArrayBuffer(16))])reject(request({...op,expectedCount:65537,positionsAndMetric:values}));
  reject(request({...op,expectedIndex:1} as unknown as SourceIteratedNativeOperation));
  const values=new Float32Array(SOURCE_ITERATED_NATIVE_CHUNK_PARTICLES*4);expect(bytes(request({...op,expectedCount:65536,positionsAndMetric:values})).length).toBe(100+values.byteLength);
 });
 it('rejects invalid bounded read and advance controls without silently coercing values',()=>{
  const r=read().operation,a=advance().operation;if(r.kind!=='read'||a.kind!=='advance')throw Error('fixture');
  for(const patch of [{count:0},{count:65537},{offset:2},{offset:-1},{expectedCount:0},{expectedIndex:-1}])reject(request({...r,...patch}));
  for(const patch of [{steps:-1},{steps:257},{steps:.5},{dimension:1},{dimension:4},{dimension:2.5},{reset:1}])reject(request({...a,...patch} as SourceIteratedNativeOperation));
  for(const uniforms of [[{name:'x',value:Infinity}],[{name:'x',value:1e50}],[{name:'gl_x',value:1}],[{name:'steps',value:1}],[{name:'dimension',value:2}],[{name:'resetCounter',value:0}],[{name:'2x',value:1}],[{name:'x',value:1},{name:'x',value:2}]])reject(request({...a,uniforms}));
 });
 it('admits the exact resident+six-packet boundary and rejects the 8M format maximum',()=>{
  const packet=bytes(create(1)),program=sourceIteratedNativeProgramBytes({vertex,fragment});
  const count=Math.floor((SOURCE_FRAME_BUDGET-SOURCE_ITERATED_NATIVE_FIXED_BYTES-program-packet.length*6)/64),input=create(count),resident=sourceIteratedNativeResidentBytes(count,program);
  const slack=SOURCE_FRAME_BUDGET-resident-packet.length*6;expect(bytes(input,{retainedBytes:slack}).length).toBe(packet.length);expect(encodeSourceIteratedNativeRequest(input,{retainedBytes:slack+1})).toMatchObject({ok:false,error:{kind:'capacity'}});
  reject(create(8_000_000),'capacity');
 });
 it('accounts for all active owners and read transient arrays while preserving cleanup at capacity',()=>{
  const input=read(1,1),size=bytes(input).length,retained=SOURCE_FRAME_BUDGET-size*6-48;
  expect(bytes(input,{retainedBytes:retained})).toHaveLength(size);expect(encodeSourceIteratedNativeRequest(input,{retainedBytes:retained+1})).toMatchObject({ok:false,error:{kind:'capacity'}});
  expect(bytes(release(),{retainedBytes:SOURCE_FRAME_BUDGET*2})).toHaveLength(88);
  expect(encodeSourceIteratedNativeRequest(input,{retainedBytes:-1})).toMatchObject({ok:false,error:{kind:'input'}});
 });
 it.each([create(),createSource(),upload(),advance(),read(),release()])('captures a frozen scalar response binding for $operation.kind without retaining caller state',input=>{
  const raw=response(input),binding=captureSourceIteratedNativeResponseBinding(input);
  expect(Object.isFrozen(binding)).toBe(true);expect(Object.values(binding).every(v=>typeof v==='string'||typeof v==='number')).toBe(true);
  input.operation.resource='34'.repeat(16);if('expectedIndex' in input.operation)input.operation.expectedIndex=0;
  if(input.operation.kind==='upload')input.operation.positionsAndMetric.fill(NaN);
  expect(decodeSourceIteratedNativeResponse(raw,binding).resource).toBe(resource);
  expect(()=>decodeSourceIteratedNativeResponse(raw,{...binding})).toThrow('codec 捕获');
 });
 it('captures upload progress without scanning or copying an already admitted seed array',()=>{
  const input=upload();if(input.operation.kind!=='upload')throw Error('fixture');
  bytes(input);Object.defineProperty(input.operation.positionsAndMetric,'every',{value:()=>{throw Error('unexpected seed scan');}});
  const binding=captureSourceIteratedNativeResponseBinding(input);expect(binding).toMatchObject({kind:'upload',uploaded:1});expect(decodeSourceIteratedNativeResponse(response(input),binding).uploaded).toBe(1);
 });
 it('returns cancellation before allocation and while copying the admitted upload',()=>{
  expect(encodeSourceIteratedNativeRequest(create(),{isCancelled:()=>true})).toMatchObject({ok:false,error:{kind:'cancelled'}});
  const input=upload(),op=input.operation;if(op.kind!=='upload')throw Error('fixture');let calls=0;
  expect(encodeSourceIteratedNativeRequest(request({...op,expectedCount:65536,positionsAndMetric:new Float32Array(65536*4)}),{isCancelled:()=>++calls===5})).toMatchObject({ok:false,error:{kind:'cancelled'}});expect(calls).toBe(5);
 });
});
