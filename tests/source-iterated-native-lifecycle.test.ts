import {beforeAll,describe,expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {iteratedInitialChunk} from '../src/engine/iteratedSeed';
import {iteratedDensityGpuPrograms,type IteratedGpuFieldSource} from '../src/engine/iteratedDensityGpuPrograms';
import {sourceSymmetryGpuField} from '../src/engine/sourceSymmetryMath';
import {encodeSourceIteratedNativeRequest,decodeSourceIteratedNativeResponse,type SourceIteratedNativeOperation,type SourceIteratedNativeRequest} from '../src/engine/sourceIteratedNativeProtocol';
import {encodeSourceDrawingFrame,type SourceDrawingFrame} from '../src/engine/sourceDrawingFrame';
// @ts-expect-error The Node process owner is separate from the browser contracts.
import {createSourceRendererService} from '../server/source-renderer.mjs';

// Real windowless CGL through the production producer, codec and retained
// service. These lifecycle checks do not by themselves establish source parity.
const A='a1'.repeat(16),B='b2'.repeat(16),C='c3'.repeat(16);
const field=sourceSymmetryGpuField({template:'standard',lambda:-2.5,alpha:2.5,beta:-.05,gamma:.35,omega:-.04,n:23});
const uniforms=Object.entries(field.uniforms).map(([name,value])=>({name,value}));
const shaders=iteratedDensityGpuPrograms('native-gl41').iteration(field);
const create=(count:number,resource=A,source=shaders):SourceIteratedNativeOperation=>({kind:'create',resource,count,...source});
const release=(resource=A):SourceIteratedNativeOperation=>({kind:'release',resource});
const advance=(count:number,index:number,steps=1,reset=false,resource=A,values=uniforms):SourceIteratedNativeOperation=>({kind:'advance',resource,expectedCount:count,expectedIndex:index,steps,reset,dimension:2,uniforms:values});
const read=(count:number,index:number,offset=0,length=count,resource=A):SourceIteratedNativeOperation=>({kind:'read',resource,expectedCount:count,expectedIndex:index,offset,count:length});
const seed=(count:number,offset=0,length=count)=>iteratedInitialChunk({count,seed:7,sourceInitialSeed:'6403493509108980441',dimension:2,bounds:[[-.5,.5],[-.5,.5],[0,0]]},offset,length);
const upload=(count:number,offset=0,length=count,resource=A):SourceIteratedNativeOperation=>({kind:'upload',resource,expectedCount:count,expectedIndex:0,offset,positionsAndMetric:seed(count,offset,length)});
const bytes=(a:Float32Array)=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
let backend:{executablePath:string;executableSha256:string};
async function owner(){
 const service=await createSourceRendererService({...backend,timeoutMs:15000});let sequence=0;
 return{service,
  async send(operation:SourceIteratedNativeOperation,mutate?:(b:Buffer)=>void){const request:SourceIteratedNativeRequest={generation:1,sequence:++sequence,operation},packet=encodeSourceIteratedNativeRequest(request);if(!packet.ok)throw Error(packet.error.reason);const wire=Buffer.from(packet.value);mutate?.(wire);const result=await service.render(wire);return{request,result,...(result.ok?{decoded:decodeSourceIteratedNativeResponse(result.value.pixels,request)}:{})};},
  async good(operation:SourceIteratedNativeOperation){const r=await this.send(operation);expect(r.result.ok,JSON.stringify(r.result.error)).toBe(true);return{...r,decoded:r.decoded!};},
  async bad(operation:SourceIteratedNativeOperation,kind:string,mutate?:(b:Buffer)=>void){const r=await this.send(operation,mutate);expect(r.result).toMatchObject({ok:false,error:{kind}});},
  async generic(){const frame:SourceDrawingFrame={generation:1,sequence:++sequence,width:7,height:5,samples:0,clear:[.25,.5,.75,1],drawing:{model:'source-drawing-v1',commands:[],textures:[],admittedBytes:0,copiedBufferBytes:0,retainedBufferBytes:0}},p=encodeSourceDrawingFrame(frame);if(!p.ok)throw Error(p.error.reason);const r=await service.render(p.value);expect(r.ok,JSON.stringify(r.error)).toBe(true);expect(r.value.format).toBe('rgba8');expect(r.value.pixels.length).toBe(140);return r;},
  async close(){expect(await service.close()).toEqual({ok:true});expect(service.processCount).toBe(0);expect(service.retainedResourceCount).toBe(0);}
 };
}
describe.skipIf(process.platform!=='darwin')('real retained iterated CGL lifecycle',()=>{
 beforeAll(()=>{mkdirSync('.cache',{recursive:true});const root=mkdtempSync(resolve('.cache/iterated-lifecycle-')),executablePath=join(root,'renderer');const build=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-framework','Foundation','-framework','OpenGL','server/render/SourceCglRenderer.m','-o',executablePath],{encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:65536});expect(build.error).toBeUndefined();expect(build.status,build.stderr).toBe(0);expect(build.stderr).toBe('');backend={executablePath,executableSha256:createHash('sha256').update(readFileSync(executablePath)).digest('hex')};});
 it('uploads canonical chunks, binds checkpoints, replays reset and releases the exact owner',async()=>{
  const o=await owner(),count=65541;
  try{
   const created=await o.good(create(count));expect(created.decoded).toMatchObject({index:0,uploaded:0,totalCount:count,disposition:'owned'});
   await o.good(upload(count,0,65536));await o.bad(advance(count,0),'input');await o.bad(read(count,0,0,1),'input');await o.bad(upload(count,0,1),'input');
   await o.good(upload(count,65536,5));
   for(const [offset,n]of [[0,65536],[65536,5]]){const r=(await o.good(read(count,0,offset,n))).decoded;expect(bytes(r.positionsAndMetric!)).toEqual(bytes(seed(count,offset,n)));expect(r.invalidCounts!.every(v=>v===0)).toBe(true);expect(r.validity!.every(v=>v===1)).toBe(true);}
   await o.good(advance(count,0,16));const first=(await o.good(read(count,1,65530,11))).decoded;
   await o.bad(advance(count,0),'input');await o.bad(read(count,0,0,1),'input');await o.bad(advance(count,1,1,false,B),'state-lost');
   await o.good(advance(count,1));await o.good(advance(count,2));
   await o.good(advance(count,3,16,true));const reset=(await o.good(read(count,4,65530,11))).decoded;expect(bytes(reset.positionsAndMetric!)).toEqual(bytes(first.positionsAndMetric!));expect(reset.invalidCounts).toEqual(first.invalidCounts);expect(reset.validity).toEqual(first.validity);
   const generic=await o.generic();expect(generic.value.contextSerial).toBe(created.result.value.contextSerial);
   await o.good(advance(count,4,0));expect((await o.good(read(count,5,65530,11))).decoded.positionsAndMetric).toEqual(reset.positionsAndMetric);
   // Reset reads the immutable seed buffer directly, including a zero-step
   // advance after both live sides have held evolved states.
   await o.good(advance(count,5,0,true));const seeded=(await o.good(read(count,6,65530,11))).decoded;expect(bytes(seeded.positionsAndMetric!)).toEqual(bytes(seed(count,65530,11)));expect(seeded.invalidCounts!.every(v=>v===0)).toBe(true);expect(seeded.validity!.every(v=>v===1)).toBe(true);
   expect(o.service.retainedResourceCount).toBe(1);expect((await o.good(release())).decoded).toMatchObject({disposition:'released',index:6,uploaded:count,totalCount:count});expect(o.service.retainedResourceCount).toBe(0);expect((await o.good(release())).decoded).toMatchObject({disposition:'absent',index:0,totalCount:0});
  }finally{await o.close();}
 });
 it('rejects malformed native inputs before changing uploaded state or progress',async()=>{
  const o=await owner(),count=4;
  try{
   await o.good(create(count));await o.bad(upload(count),'input',b=>b.writeFloatLE(NaN,100));await o.good(upload(count));
   await o.bad(advance(count,0),'input',b=>b.writeUInt32LE(257,100));
   await o.bad(advance(count,0,1,false,A,uniforms.slice(1)),'input');
   await o.bad(read(count,0),'input',b=>b.writeUInt32LE(4,92));
   const r=(await o.good(read(count,0))).decoded;expect(bytes(r.positionsAndMetric!)).toEqual(bytes(seed(count)));
   await o.good(advance(count,0));expect((await o.good(release())).decoded.index).toBe(1);
  }finally{await o.close();}
 });
 it('preserves nonfinite evolved state and invalid counters without reseeding',async()=>{
  const diagnostic:IteratedGpuFieldSource={key:'nonfinite-boundary',sourceCalculateNext:true,uniforms:{},source:'void calculate_next(in vec3 p,out vec3 next,out float metric){next=vec3(uintBitsToFloat(0x7fc12345u),uintBitsToFloat(0x7f800000u),0.);metric=uintBitsToFloat(0xff800000u);}'};
  const o=await owner();try{
   await o.good(create(2,A,iteratedDensityGpuPrograms('native-gl41').iteration(diagnostic)));await o.good(upload(2));await o.good(advance(2,0,2,false,A,[]));
   const r=(await o.good(read(2,1))).decoded;expect(Number.isNaN(r.positionsAndMetric![0])).toBe(true);expect(r.positionsAndMetric![1]).toBe(Infinity);expect(r.positionsAndMetric![3]).toBe(-Infinity);expect([...r.invalidCounts!]).toEqual([2,2]);expect([...r.validity!]).toEqual([0,0]);
   await o.good(advance(2,1,1,false,A,[]));expect([...(await o.good(read(2,2))).decoded.invalidCounts!]).toEqual([3,3]);await o.good(release());
  }finally{await o.close();}
 });
 it('keeps two owners independent, rejects a third and cleans failed shader creation',async()=>{
  const o=await owner();try{
   await o.good(create(4));await o.good(upload(4));await o.good(create(3,B));await o.good(upload(3,0,3,B));await o.bad(create(2,C),'capacity');
   await o.good(advance(4,0));expect(bytes((await o.good(read(3,0,0,3,B))).decoded.positionsAndMetric!)).toEqual(bytes(seed(3)));await o.good(release());await o.good(release(B));
   await o.bad(create(2,C,{...shaders,vertex:'#version 410 core\ninvalid shader;'}),'runtime');expect(o.service.retainedResourceCount).toBe(0);await o.good(create(2,C));await o.good(release(C));
  }finally{await o.close();}
 });
});
