import {describe,expect,it} from 'vitest';
import {SOURCE_FRAME_BUDGET,SOURCE_FRAME_MAGIC} from '../src/engine/sourceDrawingFrame';
import type {SourceDrawingUniform} from '../src/engine/sourceDrawingSnapshot';
import {captureSourceFractalNativeResponseBinding,decodeSourceFractalNativeResponse,encodeSourceFractalNativeRequest,sourceFractalNativeProgramBytes,sourceFractalNativeResponseBytes,sourceFractalNativeTargetGrowth,type SourceFractalNativeRequest,type SourceFractalNativeResponseBinding} from '../src/engine/sourceFractalNativeProtocol';

const resource='1234567890abcdef1234567890abcdef',other='abcdef1234567890abcdef1234567890';
const scalar=(name:string,value:number):SourceDrawingUniform=>({name,kind:'int',count:1,values:Int32Array.of(value)});
const uniforms=():SourceDrawingUniform[]=>[
 {name:'u_refOrbitTex',kind:'sampler2d',texture:2},{name:'u_gradientTex',kind:'sampler2d',texture:1},
 scalar('u_iterations',16),scalar('u_refOrbitLen',0),scalar('u_gradientSize',0),
];
const create=():SourceFractalNativeRequest=>({generation:7,sequence:9,width:1,height:1,operation:{kind:'create',resource,shaders:{vertex:'// 数学 🌀\nvoid main() {}',fragment:'void main() {}'}}});
const release=():SourceFractalNativeRequest=>({generation:7,sequence:11,width:1,height:1,operation:{kind:'release',resource}});
const sample=():SourceFractalNativeRequest=>({generation:7,sequence:10,width:3,height:2,operation:{kind:'sample',resource,expectedIndex:5,points:Uint32Array.of(2,1,0,0,2,1),reference:new Float32Array(4),palette:Float32Array.of(.1,.2,.3),uniforms:uniforms()}});
const op=(r:SourceFractalNativeRequest)=>{if(r.operation.kind!=='sample')throw Error('test fixture');return r.operation;};
const bytes=(request:SourceFractalNativeRequest,options:Parameters<typeof encodeSourceFractalNativeRequest>[1]={})=>{const result=encodeSourceFractalNativeRequest(request,options);if(!result.ok)throw Error(result.error.reason);return result.value;};
const reject=(request:SourceFractalNativeRequest,kind='input')=>expect(encodeSourceFractalNativeRequest(request)).toMatchObject({ok:false,error:{kind,path:['fractal']}});
function response(binding:SourceFractalNativeResponseBinding,changes:Record<number,number>={}){
 const out=new Uint8Array(sourceFractalNativeResponseBytes(binding)),view=new DataView(out.buffer),set=(at:number,value:number)=>view.setUint32(at,value,true);
 set(0,4);set(4,{create:1,sample:2,release:3}[binding.kind]);out.set(Uint8Array.from(binding.resource.match(/../g)!,s=>parseInt(s,16)),8);
 set(24,binding.kind==='sample'?binding.expectedIndex+1:binding.kind==='release'?17:0);set(28,binding.kind==='release'?1:0);set(32,binding.count);set(36,binding.width);set(40,binding.height);
 if(binding.kind==='sample'){set(44,1);set(48,1);set(52,1);set(56,1);}
 for(const [at,value]of Object.entries(changes))set(Number(at),value);return out;
}
function packetReader(packet:Uint8Array){
 const view=new DataView(packet.buffer,packet.byteOffset,packet.byteLength);let at=88;
 const word=()=>{const value=view.getUint32(at,true);at+=4;return value;};
 const block=()=>{const n=word(),value=packet.subarray(at,at+n);at+=n;return value;};
 return{word,block,text:()=>new TextDecoder().decode(block()),offset:()=>at};
}

describe('fractal native v11 CPU codec',()=>{
 it('writes the neutral standard envelope and exact family/resource block',()=>{
  const packet=bytes(release()),view=new DataView(packet.buffer);
  expect(packet.length).toBe(88);expect(Array.from({length:15},(_,i)=>view.getUint32(i*4,true))).toEqual([SOURCE_FRAME_MAGIC,11,88,7,11,1,1,0,0,0,0,0,0,0,0]);
  expect([view.getUint32(60,true),view.getUint32(64,true),view.getUint32(68,true)]).toEqual([4,3,16]);expect(Buffer.from(packet.subarray(72)).toString('hex')).toBe(resource);
 });
 it('preserves UTF-8 program bytes without adding a profile header',()=>{
  const input=create(),packet=bytes(input),read=packetReader(packet);if(input.operation.kind!=='create')throw Error('fixture');
  expect(read.text()).toBe(input.operation.shaders.vertex);expect(read.text()).toBe(input.operation.shaders.fragment);expect(read.offset()).toBe(packet.length);
  expect(sourceFractalNativeProgramBytes(input.operation.shaders)).toBe(new TextEncoder().encode(input.operation.shaders.vertex+input.operation.shaders.fragment).length*3);
 });
 it.each(['','#version 330 core\nvoid main() {}',' \n # version 410 core\nvoid main() {}','a\0b','bad\ud800','bad\udc00'])('rejects malformed or pre-versioned shaders: %j',vertex=>{
  const r=create();if(r.operation.kind==='create')r.operation.shaders.vertex=vertex;reject(r);
 });
 it('preserves ordered duplicate integer points and every finite float representation',()=>{
  const r=sample(),s=op(r),referenceBits=Uint32Array.of(99,0x80000000,1,0x7f7fffff,0xff7fffff,98);
  s.reference=new Float32Array(referenceBits.buffer,4,4);const packet=bytes(r),read=packetReader(packet);expect(read.word()).toBe(5);
  const pointBlock=read.block();expect(Array.from({length:6},(_,i)=>new DataView(pointBlock.buffer,pointBlock.byteOffset).getUint32(i*4,true))).toEqual([2,1,0,0,2,1]);
  const block=read.block();expect(Array.from({length:4},(_,i)=>new DataView(block.buffer,block.byteOffset).getUint32(i*4,true))).toEqual(Array.from(referenceBits.subarray(1,5)));
 });
 it('uses Samila uniform kind/count/byte-block encoding, including complete arrays',()=>{
  const r=sample();
  op(r).uniforms=[...uniforms(),
   {name:'a',kind:'float',count:1,values:Float32Array.of(-0)},
   {name:'b',kind:'vec2',count:1,values:Float32Array.of(1,2)},
   {name:'c',kind:'vec3',count:1,values:Float32Array.of(1,2,3)},
   {name:'d',kind:'vec4',count:1,values:Float32Array.of(1,2,3,4)},
   {name:'parameters',kind:'float-array',count:32,values:Float32Array.from({length:32},(_,i)=>i)},
   {name:'colors',kind:'vec3-array',count:16,values:new Float32Array(48)},
  ];
  const packet=bytes(r),read=packetReader(packet);read.word();read.block();read.block();read.block();expect(read.word()).toBe(11);
  const rows=[];for(let i=0;i<11;i++){const name=read.text(),kind=read.word();if(kind===9)rows.push({name,kind,texture:read.word()});else {const count=read.word(),data=read.block();rows.push({name,kind,count,bytes:data.length,...(name==='a'?{bits:new DataView(data.buffer,data.byteOffset).getUint32(0,true)}:{})});}}
  expect(rows.slice(0,2)).toEqual([{name:'u_refOrbitTex',kind:9,texture:2},{name:'u_gradientTex',kind:9,texture:1}]);
  expect(rows.slice(5)).toEqual([{name:'a',kind:1,count:1,bytes:4,bits:0x80000000},{name:'b',kind:3,count:1,bytes:8},{name:'c',kind:5,count:1,bytes:12},{name:'d',kind:6,count:1,bytes:16},{name:'parameters',kind:8,count:32,bytes:128},{name:'colors',kind:10,count:16,bytes:192}]);expect(read.offset()).toBe(packet.length);
 });
 it.each([0,1024])('allows a pending gradient-size %i with both actual palette widths',gradientSize=>{
  for(const width of [1,1024]){const r=sample();op(r).palette=new Float32Array(width*3);op(r).uniforms=[...uniforms().slice(0,4),scalar('u_gradientSize',gradientSize)];expect(bytes(r).length).toBeGreaterThan(88);}
 });
 it('admits optional production arrays with partial uploads, including six colors',()=>{
  for(const [dynamicCount,paletteCount] of [[1,1],[6,6],[32,16]]){
   const r=sample();op(r).uniforms=[...uniforms(),{name:'u_dynamicParams',kind:'float-array',count:dynamicCount,values:new Float32Array(dynamicCount)},{name:'u_palette',kind:'vec3-array',count:paletteCount,values:new Float32Array(paletteCount*3)},scalar('u_paletteSize',paletteCount)];
   const packet=bytes(r),read=packetReader(packet);read.word();read.block();read.block();read.block();const count=read.word(),arrays=[];
   for(let i=0;i<count;i++){const name=read.text(),kind=read.word();if(kind===9)read.word();else{const count=read.word(),values=read.block();if(name==='u_dynamicParams'||name==='u_palette')arrays.push({name,kind,count,bytes:values.length});}}
   expect(arrays).toEqual([{name:'u_dynamicParams',kind:8,count:dynamicCount,bytes:dynamicCount*4},{name:'u_palette',kind:10,count:paletteCount,bytes:paletteCount*12}]);
  }
 });
 it.each([
  ['u_dynamicParams','float',1,1],['u_dynamicParams','vec3-array',1,3],['u_dynamicParams','float-array',0,0],['u_dynamicParams','float-array',33,33],
  ['u_palette','vec3',1,3],['u_palette','float-array',1,1],['u_palette','vec3-array',0,0],['u_palette','vec3-array',17,51],
 ] as const)('rejects production array ABI mismatch %s/%s count %i',(name,kind,count,length)=>{
  const r=sample();op(r).uniforms=[...uniforms(),{name,kind,count,values:new Float32Array(length)}];reject(r);
 });
 it.each([0,6,16])('admits optional u_paletteSize %i without requiring a palette array',size=>{
  const r=sample();op(r).uniforms=[...uniforms(),scalar('u_paletteSize',size)];expect(bytes(r).length).toBeGreaterThan(88);
 });
 it.each(['negative','overflow','float'] as const)('rejects production palette-size ABI mismatch: %s',kind=>{
  const r=sample();op(r).uniforms=[...uniforms(),kind==='float'?{name:'u_paletteSize',kind:'float',count:1,values:Float32Array.of(6)}:scalar('u_paletteSize',kind==='negative'?-1:17)];reject(r);
 });
 it('does not apply named production ABI limits to other diagnostic arrays',()=>{
  const r=sample();op(r).uniforms=[...uniforms(),{name:'parameters',kind:'float-array',count:33,values:new Float32Array(33)},{name:'colors',kind:'vec3-array',count:17,values:new Float32Array(51)}];expect(bytes(r).length).toBeGreaterThan(88);
 });
 it('binds zero/nonzero reference lengths and accepts the maximum source texture/point range',()=>{
  const r=sample();r.width=256;r.height=256;op(r).points=new Uint32Array(65536*2);op(r).reference=new Float32Array(2048*4);op(r).uniforms=[...uniforms().slice(0,2),scalar('u_iterations',2048),scalar('u_refOrbitLen',2048),scalar('u_gradientSize',0)];
  expect(bytes(r).length).toBeGreaterThan(65536*8);op(r).reference=new Float32Array(4);reject(r);
 });
 it.each(['empty','odd','tooMany','outsideX','outsideY','wrongType','shared'] as const)('rejects invalid points: %s',kind=>{
  const r=sample(),s=op(r);
  if(kind==='empty')s.points=new Uint32Array();if(kind==='odd')s.points=Uint32Array.of(1);if(kind==='tooMany')s.points=new Uint32Array(65537*2);if(kind==='outsideX')s.points=Uint32Array.of(3,0);if(kind==='outsideY')s.points=Uint32Array.of(0,2);if(kind==='wrongType')s.points=new Float32Array(2) as unknown as Uint32Array;if(kind==='shared')s.points=new Uint32Array(new SharedArrayBuffer(8));reject(r);
 });
 it.each(['reference','palette'] as const)('rejects malformed %s texture storage before encoding',key=>{
  for(const value of [new Float32Array(),new Float32Array(5),Float32Array.of(NaN,0,0,0),Float32Array.of(Infinity,0,0,0),new Float32Array(new SharedArrayBuffer(key==='reference'?16:12))]){const r=sample();op(r)[key]=value;reject(r);}
 });
 it.each(['missing','sampler','extraSampler','iterationZero','iterationOverflow','refMismatch','gradient','duplicate','arrayName','reservedName','badKind','badCount','badComponents','nonfinite','shared','integerStorage'] as const)('rejects invalid uniform binding: %s',kind=>{
  const r=sample(),u=uniforms();
  if(kind==='missing')u.shift();if(kind==='sampler')u[0]={name:'u_refOrbitTex',kind:'sampler2d',texture:1};if(kind==='extraSampler')u.push({name:'foreignTex',kind:'sampler2d',texture:3});if(kind==='iterationZero')u[2]=scalar('u_iterations',0);if(kind==='iterationOverflow')u[2]=scalar('u_iterations',2049);if(kind==='refMismatch')u[3]=scalar('u_refOrbitLen',2);if(kind==='gradient')u[4]=scalar('u_gradientSize',1);if(kind==='duplicate')u.push(u[0]);
  if(kind==='arrayName')u.push({name:'a[0]',kind:'float-array',count:1,values:Float32Array.of(1)});if(kind==='reservedName')u.push(scalar('gl_bad',0));if(kind==='badKind')u.push({name:'a',kind:'mat4',count:1,values:new Float32Array(16)});if(kind==='badCount')u.push({name:'a',kind:'float',count:2,values:new Float32Array(2)});if(kind==='badComponents')u.push({name:'a',kind:'vec3',count:1,values:new Float32Array(2)});if(kind==='nonfinite')u.push({name:'a',kind:'float',count:1,values:Float32Array.of(NaN)});if(kind==='shared')u.push({name:'a',kind:'float',count:1,values:new Float32Array(new SharedArrayBuffer(4))});if(kind==='integerStorage')u[2]={name:'u_iterations',kind:'int',count:1,values:Float32Array.of(16)};
  op(r).uniforms=u;reject(r);
 });
 it.each(['generation','sequence','resource','zeroResource','width','height','index','controlSize'] as const)('rejects invalid envelope/checkpoint %s',kind=>{
  const r=kind==='controlSize'?create():sample();if(kind==='generation')r.generation=0;if(kind==='sequence')r.sequence=0x100000000;if(kind==='resource')r.operation.resource='X'.repeat(32);if(kind==='zeroResource')r.operation.resource='0'.repeat(32);if(kind==='width')r.width=0;if(kind==='height')r.height=16385;if(kind==='index')op(r).expectedIndex=0xffffffff;if(kind==='controlSize')r.width=2;reject(r);
 });
 it('rejects over-budget targets without allocating a large pixel array',()=>{const r=sample();r.width=3000;r.height=2000;reject(r,'capacity');});
 it('charges new and old target coexistence but reuses only an acknowledged identical target',()=>{
  const r=sample();r.width=1000;r.height=1000;const target={resource,width:1000,height:1000};
  const retained=SOURCE_FRAME_BUDGET-20_000_000;expect(encodeSourceFractalNativeRequest(r,{retainedBytes:retained})).toMatchObject({ok:false,error:{kind:'capacity'}});expect(bytes(r,{retainedBytes:retained,retainedTarget:target})).toBeInstanceOf(Uint8Array);
  r.width=1001;expect(encodeSourceFractalNativeRequest(r,{retainedBytes:retained,retainedTarget:target})).toMatchObject({ok:false,error:{kind:'capacity'}});
  expect(encodeSourceFractalNativeRequest(r,{retainedBytes:retained,retainedTarget:{...target,resource:other}})).toMatchObject({ok:false,error:{kind:'input'}});
  expect(encodeSourceFractalNativeRequest(r,{retainedBytes:0,retainedTarget:target})).toMatchObject({ok:false,error:{kind:'input'}});
  expect(sourceFractalNativeTargetGrowth(resource,1000,1000,target)).toBe(0);expect(sourceFractalNativeTargetGrowth(resource,1001,1000,target)).toBe(1001*1000*52);
 });
 it('admits exact aggregate copy/readback budget and rejects the next byte',()=>{
  const r=sample(),s=op(r),packet=bytes(r),count=s.points.length/2,maxSpan=Math.min(count,Math.floor(2_000_000/16));
  const peak=r.width*r.height*52+s.reference.byteLength+s.palette.byteLength+packet.length*6+count*(52*3+12)+maxSpan*68+256;
  expect(bytes(r,{retainedBytes:SOURCE_FRAME_BUDGET-peak})).toHaveLength(packet.length);expect(encodeSourceFractalNativeRequest(r,{retainedBytes:SOURCE_FRAME_BUDGET-peak+1})).toMatchObject({ok:false,error:{kind:'capacity'}});
  const c=create();if(c.operation.kind!=='create')throw Error('fixture');const n=bytes(c).length,createPeak=sourceFractalNativeProgramBytes(c.operation.shaders)+n*6+192;
  expect(bytes(c,{retainedBytes:SOURCE_FRAME_BUDGET-createPeak})).toHaveLength(n);expect(encodeSourceFractalNativeRequest(c,{retainedBytes:SOURCE_FRAME_BUDGET-createPeak+1})).toMatchObject({ok:false,error:{kind:'capacity'}});
  expect(bytes(release(),{retainedBytes:SOURCE_FRAME_BUDGET+1})).toHaveLength(88);
 });
 it('captures immutable scalar response expectations before any caller mutation',()=>{
  const r=sample(),binding=captureSourceFractalNativeResponseBinding(r),reply=response(binding);expect(Object.isFrozen(binding)).toBe(true);expect(Object.values(binding).every(v=>typeof v==='string'||typeof v==='number')).toBe(true);
  r.width=1;r.height=1;op(r).expectedIndex=98;op(r).points=new Uint32Array(2);r.operation.resource=other;
  expect(decodeSourceFractalNativeResponse(reply,binding)).toMatchObject({resource,count:3,width:3,height:2,committedRequests:6});expect(sourceFractalNativeResponseBytes(binding)).toBe(64+3*52);
  expect(()=>sourceFractalNativeResponseBytes({...binding})).toThrow('绑定');expect(()=>decodeSourceFractalNativeResponse(reply,{...binding})).toThrow('绑定');
 });
 it('preserves every raw record byte, including nonfinite orbit/terminal payload and unaligned response views',()=>{
  const binding=captureSourceFractalNativeResponseBinding(sample()),raw=response(binding),view=new DataView(raw.buffer);
  const words=[0x7fc01234,0x7f800000,0xff800000,0x80000000];for(let i=0;i<4;i++)view.setUint32(64+i*4,words[i],true);view.setUint32(64+16,0xffc05678,true);raw.set([17,23,29,31],64+32);view.setUint32(64+36,0x7f800000,true);
  const storage=new Uint8Array(raw.length+3);storage.set(raw,1);const result=decodeSourceFractalNativeResponse(storage.subarray(1,raw.length+1),binding);
  expect(result.records).toEqual(raw.subarray(64));expect(result.records!.buffer).toBe(storage.buffer);expect(result.records!.byteOffset).toBe(65);
 });
 it.each([0,4,8,24,28,32,36,40,60])('rejects incorrect sample ACK word at %i',offset=>{
  const binding=captureSourceFractalNativeResponseBinding(sample()),raw=response(binding),view=new DataView(raw.buffer);view.setUint32(offset,view.getUint32(offset,true)+1,true);expect(()=>decodeSourceFractalNativeResponse(raw,binding)).toThrow();
 });
 it('exposes actual sample execution facts for target allocation and reuse',()=>{
  const binding=captureSourceFractalNativeResponseBinding(sample());
  for(const draws of [1,binding.count])for(const targetAllocations of [0,1])expect(decodeSourceFractalNativeResponse(response(binding,{44:draws,48:targetAllocations}),binding)).toMatchObject({draws,targetAllocations,referenceUploads:1,paletteUploads:1});
 });
 it.each([[44,0],[44,4],[48,2],[52,0],[52,2],[56,0],[56,2]])('rejects impossible sample execution fact at %i = %i',(offset,value)=>{
  const binding=captureSourceFractalNativeResponseBinding(sample());expect(()=>decodeSourceFractalNativeResponse(response(binding,{[offset]:value}),binding)).toThrow('统计');
 });
 it.each([44,48,52,56])('rejects nonzero control execution fact at %i',offset=>{
  for(const request of [create(),release()]){
   const binding=captureSourceFractalNativeResponseBinding(request);expect(decodeSourceFractalNativeResponse(response(binding),binding)).toMatchObject({draws:0,targetAllocations:0,referenceUploads:0,paletteUploads:0});
   expect(()=>decodeSourceFractalNativeResponse(response(binding,{[offset]:1}),binding)).toThrow('统计');
   if(binding.kind==='release')expect(()=>decodeSourceFractalNativeResponse(response(binding,{24:0,28:2,[offset]:1}),binding)).toThrow('统计');
  }
 });
 it('rejects short, long or shared responses and binds create/release dispositions',()=>{
  const sampleBinding=captureSourceFractalNativeResponseBinding(sample()),raw=response(sampleBinding);for(const data of [raw.subarray(1),new Uint8Array(raw.length+1),new Uint8Array(new SharedArrayBuffer(raw.length))])expect(()=>decodeSourceFractalNativeResponse(data,sampleBinding)).toThrow();
  const created=captureSourceFractalNativeResponseBinding(create()),released=captureSourceFractalNativeResponseBinding(release());expect(decodeSourceFractalNativeResponse(response(created),created)).toMatchObject({disposition:'owned',committedRequests:0,count:0,width:1,height:1});
  expect(()=>decodeSourceFractalNativeResponse(response(created,{24:1}),created)).toThrow();expect(()=>decodeSourceFractalNativeResponse(response(created,{28:1}),created)).toThrow();
  expect(decodeSourceFractalNativeResponse(response(released),released)).toMatchObject({disposition:'released',committedRequests:17});expect(decodeSourceFractalNativeResponse(response(released,{24:0,28:2}),released)).toMatchObject({disposition:'absent',committedRequests:0});
  const malformed:Record<number,number>[]=[{28:0},{28:3},{28:2},{32:1},{36:2}];for(const changes of malformed)expect(()=>decodeSourceFractalNativeResponse(response(released,changes),released)).toThrow();
 });
});
