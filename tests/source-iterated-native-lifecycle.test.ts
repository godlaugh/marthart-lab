import {beforeAll,describe,expect,it,vi} from 'vitest';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {iteratedInitialChunk} from '../src/engine/iteratedSeed';
import {iteratedDensityGpuPrograms,sourceIteratedGpuPrograms,type IteratedGpuFieldSource} from '../src/engine/iteratedDensityGpuPrograms';
import {sourceMapGpuField} from '../src/engine/sourceMapMath';
import {prepareSourceSymmetryCustomProgram} from '../src/engine/sourceSymmetryCustom';
import {bindSymmetryCustomParameters} from '../src/engine/symmetryCustom';
import processingFixture from './fixtures/source-processing-native/runtime.json';
import {parseProjectFile} from '../src/engine/legacyImport';
import {prepareSourceCamera,resolveSourceCamera} from '../src/engine/sourceCamera';
import {OrdinarySourceCameraTimelineSession} from '../src/engine/ordinarySourceCameraTimeline';
import {SourceProcessingContext,SourceProcessingShaderContext,type SourceProcessingContextEvent} from '../src/engine/sourceProcessingContext';
import {sourceProcessingAutomaticSetters} from '../src/engine/sourceProcessingAutomaticBindings';
import {sourceProcessingSceneInitializationEvents,sourceProcessingSceneBaseEvents,sourceProcessingSceneWorldEvents,sourceProcessingOverlayEvents} from '../src/engine/sourceProcessingSceneContext';
import {exchangeSourceIteratedNative} from '../src/engine/sourceNativeClient';
// @ts-expect-error The actual loopback server is separate from browser contracts.
import {createExportServer} from '../server/index.mjs';
import type {SourceSymmetryNativeBinding} from '../src/engine/sourceSymmetryNativeBindings';
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
const create=(count:number,resource=A,source=shaders):Extract<SourceIteratedNativeOperation,{kind:'create'}>=>({kind:'create',resource,count,...source});
const release=(resource=A):Extract<SourceIteratedNativeOperation,{kind:'release'}>=>({kind:'release',resource});
const advance=(count:number,index:number,steps=1,reset=false,resource=A,values=uniforms):Extract<SourceIteratedNativeOperation,{kind:'advance'}>=>({kind:'advance',resource,expectedCount:count,expectedIndex:index,steps,reset,dimension:2,uniforms:values});
const read=(count:number,index:number,offset=0,length=count,resource=A):Extract<SourceIteratedNativeOperation,{kind:'read'}>=>({kind:'read',resource,expectedCount:count,expectedIndex:index,offset,count:length});
const seed=(count:number,offset=0,length=count)=>iteratedInitialChunk({count,seed:7,sourceInitialSeed:'6403493509108980441',dimension:2,bounds:[[-.5,.5],[-.5,.5],[0,0]]},offset,length);
const upload=(count:number,offset=0,length=count,resource=A):Extract<SourceIteratedNativeOperation,{kind:'upload'}>=>({kind:'upload',resource,expectedCount:count,expectedIndex:0,offset,positionsAndMetric:seed(count,offset,length)});
const bytes=(a:Float32Array)=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
let backend:{executablePath:string;executableSha256:string};
async function owner(){
 const service=await createSourceRendererService({...backend,timeoutMs:15000});let sequence=0;
 return{service,
  async send(operation:SourceIteratedNativeOperation,mutate?:(b:Buffer)=>void){const request:SourceIteratedNativeRequest={generation:1,sequence:++sequence,operation},packet=encodeSourceIteratedNativeRequest(request);if(!packet.ok)throw Error(packet.error.reason);const wire=Buffer.from(packet.value);mutate?.(wire);const result=await service.render(wire);return{request,result,...(result.ok?{decoded:decodeSourceIteratedNativeResponse(result.value.pixels,request)}:{})};},
  async good(operation:SourceIteratedNativeOperation){const r=await this.send(operation);expect(r.result.ok,JSON.stringify(r.result.error)).toBe(true);return{...r,decoded:r.decoded!};},
  async bad(operation:SourceIteratedNativeOperation,kind:string,mutate?:(b:Buffer)=>void){const r=await this.send(operation,mutate);expect(r.result).toMatchObject({ok:false,error:{kind}});},
  async generic(){const frame:SourceDrawingFrame={generation:1,sequence:++sequence,width:7,height:5,samples:0,clear:[.25,.5,.75,1],drawing:{model:'source-drawing-v1',commands:[],textures:[],admittedBytes:0,copiedBufferBytes:0,retainedBufferBytes:0}},p=encodeSourceDrawingFrame(frame);if(!p.ok)throw Error(p.error.reason);const r=await service.render(p.value);expect(r.ok,JSON.stringify(r.error)).toBe(true);expect(r.value.format).toBe('rgba8');expect(r.value.pixels.length).toBe(140);return r;},
  async close(){expect(await service.close()).toEqual({ok:true});expect(service.processCount).toBe(0);expect(service.activeCount).toBe(0);expect(service.retainedResourceCount).toBe(0);}
 };
}
describe.skipIf(process.platform!=='darwin')('real retained iterated CGL lifecycle',()=>{
 beforeAll(()=>{mkdirSync('.cache',{recursive:true});const root=mkdtempSync(resolve('.cache/iterated-lifecycle-')),executablePath=join(root,'renderer');const build=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-Werror','-framework','Foundation','-framework','OpenGL','server/render/SourceCglRenderer.m','-o',executablePath],{encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:65536});expect(build.error).toBeUndefined();expect(build.status,build.stderr).toBe(0);expect(build.stderr).toBe('');backend={executablePath,executableSha256:createHash('sha256').update(readFileSync(executablePath)).digest('hex')};});
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
 it.each([2,3] as const)('executes %iD source Map equations with ordered aliases, final metric and exact zero-step/reset semantics',async dimension=>{
  const count=4,initial=iteratedInitialChunk({count,seed:7,dimension,bounds:[[1,1],[2,2],[3,3]]},0,count);
  // Dyadic input and integer increments give exact XYZ expectations. The
  // finite length oracle permits one Float32 ULP: native length(3,4,12)
  // is 13 + 1 ULP on this CGL driver. Original-compiler parity below remains
  // bit-exact across every state channel, without such a tolerance.
  const source=sourceMapGpuField({dimension,equations:{x:'x+dx',y:'y+dy+(nx-x-dx)',z:'z+dz+(ny-y-dy)'},parameters:{dx:3,dy:4,dz:12}}),values=Object.entries(source.uniforms).map(([name,value])=>({name,value})),o=await owner();
  const step=(index:number,steps:number,reset=false,resetCounter?:boolean):SourceIteratedNativeOperation=>({kind:'advance',resource:A,expectedCount:count,expectedIndex:index,dimension,steps,reset,resetCounter,uniforms:values});
  try{
   await o.good(create(count,A,iteratedDensityGpuPrograms('native-gl41').iteration(source)));await o.good({kind:'upload',resource:A,expectedCount:count,expectedIndex:0,offset:0,positionsAndMetric:initial});
   // The unchanged neutral advance wire is admitted as v6, with the existing
   // optional independent counter-reset word still selecting v7.
   await o.good(step(0,3));const evolved=(await o.good(read(count,1))).decoded;
   const expected=evolved.positionsAndMetric!.slice(),metricBits=new Uint32Array(Float32Array.of(dimension===3?13:5).buffer)[0],actualBits=new Uint32Array(expected.buffer);for(let i=0;i<count;i++){expect([...expected.subarray(i*4,i*4+3)]).toEqual([10,14,dimension===3?39:0]);expect(Math.abs(actualBits[i*4+3]-metricBits)).toBeLessThanOrEqual(1);}expect([...evolved.invalidCounts!]).toEqual([0,0,0,0]);expect([...evolved.validity!]).toEqual([1,1,1,1]);
   for(const invalid of [0,1,4,0xffffffff])await o.bad(step(1,1),'input',b=>b.writeUInt32LE(invalid,96));expect(bytes((await o.good(read(count,1))).decoded.positionsAndMetric!)).toEqual(bytes(expected));
   await o.good(step(1,0,false,true));expect(bytes((await o.good(read(count,2))).decoded.positionsAndMetric!)).toEqual(bytes(expected));
   await o.good(step(2,0,true));expect(bytes((await o.good(read(count,3))).decoded.positionsAndMetric!)).toEqual(bytes(initial));
   await o.good(step(3,3));expect(bytes((await o.good(read(count,4))).decoded.positionsAndMetric!)).toEqual(bytes(expected));await o.good(release());
  }finally{await o.close();}
 });
 it('matches the captured original compiler 3D equation on the same CGL TF owner without reinterpreting source',async()=>{
  const captured=JSON.parse(readFileSync('tests/fixtures/source-iterated-native-map/ordered-aliases-original.json','utf8'));
  expect(createHash('sha256').update(captured.originalGlsl).digest('hex')).toBe(captured.evidence.originalGlslSha256);
  const count=17,input=captured.input,source=sourceMapGpuField({dimension:3,equations:{x:input.x,y:input.y,z:input.z},parameters:{}}),original:IteratedGpuFieldSource={source:captured.originalGlsl,uniforms:{},key:'captured-original-ordered-aliases',sourceCalculateNext:true};
  const initial=iteratedInitialChunk({count,seed:7,sourceInitialSeed:'6403493509108980441',dimension:3,bounds:[[-.5,.5],[-.5,.5],[-1,1]]},0,count),o=await owner();
  try{
   for(const [resource,field]of [[A,source],[B,original]] as const){await o.good(create(count,resource,iteratedDensityGpuPrograms('native-gl41').iteration(field)));await o.good({kind:'upload',resource,expectedCount:count,expectedIndex:0,offset:0,positionsAndMetric:initial});}
   let index=0;for(const [steps,reset]of [[1,false],[16,false],[0,false],[1,false],[16,true]] as const){
    for(const resource of [A,B])await o.good({kind:'advance',resource,expectedCount:count,expectedIndex:index,dimension:3,steps,reset,uniforms:[]});index++;
    const actual=(await o.good(read(count,index))).decoded,reference=(await o.good(read(count,index,0,count,B))).decoded;
    expect(bytes(actual.positionsAndMetric!)).toEqual(bytes(reference.positionsAndMetric!));expect(actual.invalidCounts).toEqual(reference.invalidCounts);expect(actual.validity).toEqual(reference.validity);expect(actual.positionsAndMetric!.some((v,i)=>i%4===2&&v!==initial[i])).toBe(true);
   }
   await o.good(release());await o.good(release(B));
  }finally{await o.close();}
 });
 it('preserves nonfinite Z from a source Map equation and resets counters independently without reseeding',async()=>{
  const count=2,dimension=3,initial=iteratedInitialChunk({count,seed:7,dimension,bounds:[[1,1],[2,2],[3,3]]},0,count),source=sourceMapGpuField({dimension,equations:{x:'x',y:'y',z:'z/(x-x)'},parameters:{}}),o=await owner();
  const step=(index:number,steps:number,reset=false,resetCounter?:boolean):SourceIteratedNativeOperation=>({kind:'advance',resource:A,expectedCount:count,expectedIndex:index,dimension,steps,reset,resetCounter,uniforms:[]});
  try{
   await o.good(create(count,A,iteratedDensityGpuPrograms('native-gl41').iteration(source)));await o.good({kind:'upload',resource:A,expectedCount:count,expectedIndex:0,offset:0,positionsAndMetric:initial});await o.good(step(0,1));
   const first=(await o.good(read(count,1))).decoded;for(let i=0;i<count;i++){expect([...first.positionsAndMetric!.subarray(i*4,i*4+3)]).toEqual([1,2,Infinity]);expect(first.positionsAndMetric![i*4+3]).toBe(Infinity);}expect([...first.invalidCounts!]).toEqual([1,1]);expect([...first.validity!]).toEqual([0,0]);
   await o.good(step(1,1));expect([...(await o.good(read(count,2))).decoded.invalidCounts!]).toEqual([2,2]);
   const before=(await o.good(read(count,2))).decoded;await o.good(step(2,0,false,true));const resetCounter=(await o.good(read(count,3))).decoded;expect(bytes(resetCounter.positionsAndMetric!)).toEqual(bytes(before.positionsAndMetric!));expect([...resetCounter.invalidCounts!]).toEqual([0,0]);expect([...resetCounter.validity!]).toEqual([0,0]);
   await o.good(step(3,0,true));const reset=(await o.good(read(count,4))).decoded;expect(bytes(reset.positionsAndMetric!)).toEqual(bytes(initial));expect([...reset.invalidCounts!]).toEqual([0,0]);expect([...reset.validity!]).toEqual([1,1]);await o.good(release());
  }finally{await o.close();}
 });
 it('keeps two owners independent, rejects a third and cleans failed shader creation',async()=>{
  const o=await owner();try{
   await o.good(create(4));await o.good(upload(4));await o.good(create(3,B));await o.good(upload(3,0,3,B));await o.bad(create(2,C),'capacity');
   await o.good(advance(4,0));expect(bytes((await o.good(read(3,0,0,3,B))).decoded.positionsAndMetric!)).toEqual(bytes(seed(3)));await o.good(release());await o.good(release(B));
   await o.bad(create(2,C,{...shaders,vertex:'#version 410 core\ninvalid shader;'}),'runtime');expect(o.service.retainedResourceCount).toBe(0);await o.good(create(2,C));await o.good(release(C));
  }finally{await o.close();}
 });
 it('keeps source prefix state and per-step diagnostics independent through recovery and zero-step resets',async()=>{
  const source:IteratedGpuFieldSource={key:'source-prefix-recovery',sourceCalculateNext:true,uniforms:{},source:`void calculate_next(in vec3 p,out vec3 next,out float metric){
   float x=p.x+1.;float y=x<2.?uintBitsToFloat(0x7fc12345u):x<3.?uintBitsToFloat(0x7f800000u):x<4.?uintBitsToFloat(0xff800000u):2.;
   next=vec3(x,y,p.z);metric=x<3.?uintBitsToFloat(0x7fc12345u):x<5.?uintBitsToFloat(0x7f800000u):0.;}`};
  const count=2,initial=Float32Array.of(0,2,3,7,0,4,5,9),o=await owner();let index=0;
  const step=(steps:number,reset=false,resetCounter?:boolean):SourceIteratedNativeOperation=>({kind:'advance',resource:A,expectedCount:count,expectedIndex:index,dimension:3,steps,reset,resetCounter,uniforms:[]});
  const send=async(steps:number,reset=false,resetCounter?:boolean)=>{await o.good(step(steps,reset,resetCounter));index++;return(await o.good(read(count,index))).decoded;};
  try{
   await o.good({kind:'create-source',resource:A,count,...sourceIteratedGpuPrograms(source,'native-gl41')});await o.good({kind:'upload',resource:A,expectedCount:count,expectedIndex:0,offset:0,positionsAndMetric:initial});
   for(let n=1;n<=6;n++){const r=await send(n,true);expect([...r.invalidCounts!]).toEqual([Math.min(4,n),Math.min(4,n)]);expect([...r.validity!]).toEqual([n<5?0:1,n<5?0:1]);expect(r.positionsAndMetric![0]).toBe(n);expect(r.positionsAndMetric![2]).toBe(3);expect(r.positionsAndMetric![6]).toBe(5);}
   const invalid=await send(3,true),unchanged=await send(0);expect(bytes(unchanged.positionsAndMetric!)).toEqual(bytes(invalid.positionsAndMetric!));expect(unchanged.invalidCounts).toEqual(invalid.invalidCounts);expect(unchanged.validity).toEqual(invalid.validity);
   const counterReset=await send(0,false,true);expect(bytes(counterReset.positionsAndMetric!)).toEqual(bytes(invalid.positionsAndMetric!));expect([...counterReset.invalidCounts!]).toEqual([0,0]);expect([...counterReset.validity!]).toEqual([0,0]);
   const next=await send(1);expect(next.positionsAndMetric![0]).toBe(4);expect([...next.invalidCounts!]).toEqual([1,1]);expect([...next.validity!]).toEqual([0,0]);
   const recovered=await send(2);expect(recovered.positionsAndMetric![0]).toBe(6);expect([...recovered.invalidCounts!]).toEqual([1,1]);expect([...recovered.validity!]).toEqual([1,1]);
   const reset=await send(0,true);expect(bytes(reset.positionsAndMetric!)).toEqual(bytes(initial));expect([...reset.invalidCounts!]).toEqual([0,0]);expect([...reset.validity!]).toEqual([1,1]);
   const first=await send(1);expect(first.positionsAndMetric![0]).toBe(1);expect([...first.invalidCounts!]).toEqual([1,1]);await o.good(release());
  }finally{await o.close();}
 });
 it('rejects source over-limit and incomplete controls before mutating its checkpoint',async()=>{
  const o=await owner(),count=4;
  try{
   await o.good({kind:'create-source',resource:A,count,...sourceIteratedGpuPrograms(field,'native-gl41')});await o.good(upload(count));
   await o.bad(advance(count,0,17),'input');await o.bad(advance(count,0,16,false,A,uniforms.slice(1)),'input');await o.bad(advance(count,0,1,false,A,[...uniforms,{name:'observe',value:1}]),'input');
   expect(bytes((await o.good(read(count,0))).decoded.positionsAndMetric!)).toEqual(bytes(seed(count)));await o.good(advance(count,0,16));await o.good(release());
  }finally{await o.close();}
 });
 it('admits a constant source equation with optimized-away input, while retaining exact zero-step bytes',async()=>{
  const f=sourceMapGpuField({dimension:2,equations:{x:'1',y:'2'},parameters:{}}),o=await owner();
  try{await o.good({kind:'create-source',resource:A,count:2,...sourceIteratedGpuPrograms(f,'native-gl41')});await o.good(upload(2));await o.good(advance(2,0,0,false,A,[]));expect(bytes((await o.good(read(2,1))).decoded.positionsAndMetric!)).toEqual(bytes(seed(2)));await o.good(advance(2,1,16,false,A,[]));const r=(await o.good(read(2,2))).decoded;expect([...r.positionsAndMetric!]).toEqual([1,2,0,0,1,2,0,0]);expect([...r.invalidCounts!]).toEqual([0,0]);await o.good(release());}finally{await o.close();}
 });
 it('cleans both source programs after diagnostic compilation or ABI failure',async()=>{
  const p=sourceIteratedGpuPrograms(field,'native-gl41'),o=await owner();
  const bad=[{...p,diagnosticVertex:'#version 410 core\ninvalid;'},
   {...p,diagnosticVertex:p.diagnosticVertex.replace('flat out uvec2 newMetadata','flat out vec2 newMetadata').replace('newMetadata=uvec2','newMetadata=vec2')},
   {...p,vertex:shaders.vertex}];
  try{for(const source of bad){await o.bad({kind:'create-source',resource:A,count:2,...source},'runtime');expect(o.service.retainedResourceCount).toBe(0);await o.good({kind:'create-source',resource:A,count:2,...p});await o.good(upload(2));await o.good(advance(2,0));await o.good(release());}}finally{await o.close();}
 });

 it('preflights the uint32 observation interval and retains failed source ownership through disposal',()=>{
  const root=mkdtempSync(resolve('.cache/iterated-prefix-boundaries-')),executable=join(root,'runner');
  const build=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-Werror','-Iserver/render','-framework','Foundation','-framework','OpenGL','tests/fixtures/source-iterated-prefix-boundaries/runner.m','-o',executable],{encoding:'utf8',timeout:30000});expect(build.error).toBeUndefined();expect(build.status,build.stderr).toBe(0);expect(build.stderr).toBe('');
  const source=sourceMapGpuField({dimension:3,equations:{x:'x+1',y:'y+1',z:'z+1'},parameters:{}}),packet=encodeSourceIteratedNativeRequest({generation:1,sequence:1,operation:{kind:'create-source',resource:A,count:2,...sourceIteratedGpuPrograms(source)}});if(!packet.ok)throw Error(packet.error.reason);const path=join(root,'create.bin');writeFileSync(path,packet.value);
  const run=spawnSync(executable,[path],{encoding:'utf8',timeout:15000});expect(run.error).toBeUndefined();expect(run.status,run.stderr).toBe(0);expect(run.stderr).toBe('');expect(JSON.parse(run.stdout)).toEqual({overflowPreflight:true,zeroAtLimit:true,counterReset:true,poisonedOwnerRetained:true,cleanup:true});
 });

 it('runs the v8 fragment profile with signed typed bindings, reset and exact release in the shared CGL service',async()=>{
  const o=await owner(),count=65541,profile='source-fragment' as const;
  const program=prepareSourceSymmetryCustomProgram('uniform float gain;uniform int signedCount;uniform vec2 supplied[2];uniform mat3 basis;uniform float linkDefault=.125;uniform bvec2 flags2;uniform bvec3 flags3;uniform bvec4 flags4;void calculate_next(in vec3 pos,out vec3 nextPos,out float metric){nextPos=pos+basis*vec3(gain+supplied[1].x,supplied[1].y,9.);metric=float(signedCount)+linkDefault+supplied[0].x+float(flags2.y)+float(flags3.z)+float(flags4.x)+float(flags4.w);}',5);
  const bindings:SourceSymmetryNativeBinding[]=[{name:'gain',type:5126,values:[.5]},{name:'signedCount',type:5124,values:[-2]},{name:'supplied',type:35664,values:[.25,.5,1,2]},{name:'basis',type:35675,values:[1,0,0,0,1,0,0,0,1]},{name:'flags2',type:35671,values:[0,1]},{name:'flags3',type:35672,values:[0,0,1]},{name:'flags4',type:35673,values:[1,0,0,1]}];
  const step=(index:number,steps:number,reset=false):SourceIteratedNativeOperation=>({kind:'advance-fragment',resource:A,expectedCount:count,expectedIndex:index,reset,resetCounter:reset,steps,bindings});
  const scan=(index:number):SourceIteratedNativeOperation=>({...read(count,index,65530,11),profile});
  try{
   expect((await o.good({kind:'create-fragment',resource:A,count,...program})).decoded.diagnosticUnit).toBe('completed-pass');
   await o.bad(upload(count,0,1),'ownership');await o.bad(release(),'ownership');
   for(const [offset,n] of [[0,65536],[65536,5]])await o.good({...upload(count,offset,n),profile});
   const initial=seed(count,65530,11);expect(bytes((await o.good(scan(0))).decoded.positionsAndMetric!)).toEqual(bytes(initial));
   await o.bad(advance(count,0),'ownership');
   await o.good(step(0,3));const first=(await o.good(scan(1))).decoded;
   const expected=initial.slice();for(let i=0;i<11;i++){expected[i*4]=Math.fround(Math.fround(Math.fround(initial[i*4]+1.5)+1.5)+1.5);expected[i*4+1]=Math.fround(Math.fround(Math.fround(initial[i*4+1]+2)+2)+2);expected[i*4+2]=0;expected[i*4+3]=2.375;}
   expect(bytes(first.positionsAndMetric!)).toEqual(bytes(expected));expect(first.invalidCounts!.every(n=>n===0)).toBe(true);
   // Parser failures must leave the completed checkpoint and values unchanged.
   await o.bad(step(1,1),'input',b=>b.writeUInt32LE(0xffffffff,104));
   await o.bad(step(1,1),'input',b=>b.writeUInt32LE(0x7fc00000,124)); // gain value
   await o.bad(step(1,1),'input',b=>b.writeInt32LE(2,b.length-4)); // non-boolean bvec4 component
   await o.bad({...step(1,1),bindings:[{name:'gain',type:35664,values:[1,2]}]} as SourceIteratedNativeOperation,'input');
   expect(bytes((await o.good(scan(1))).decoded.positionsAndMetric!)).toEqual(bytes(expected));
   await o.good(step(1,0,true));expect(bytes((await o.good(scan(2))).decoded.positionsAndMetric!)).toEqual(bytes(initial));
   await o.good(step(2,3));expect(bytes((await o.good(scan(3))).decoded.positionsAndMetric!)).toEqual(bytes(first.positionsAndMetric!));
   // A legacy owner may coexist, but the same token cannot switch profiles.
   await o.good(create(2,B));await o.bad({...read(2,0,0,1,B),profile},'ownership');await o.good(release(B));
   expect((await o.good({...release(),profile})).decoded).toMatchObject({disposition:'released',index:3,diagnosticUnit:'completed-pass'});
   expect((await o.good({...release(),profile})).decoded.disposition).toBe('absent');
  }finally{await o.close();}
 });
 it('matches eight original frames through the public HTTP client, exposing every automatic matrix and matched collision',async()=>{
  const f=processingFixture,count=64,profile='source-fragment' as const;
  const app=await createExportServer({root:mkdtempSync(resolve('.cache/processing-http-')),sourceRendererBackend:backend}),realFetch=globalThis.fetch;let restoreFetch:(()=>void)|undefined,sequence=0;
  const o={async good(operation:SourceIteratedNativeOperation){return{decoded:await exchangeSourceIteratedNative({generation:1,sequence:++sequence,operation})};}};
  const value=<T>(r:{ok:true;value:T}|{ok:false;error:Error}):T=>{if(!r.ok)throw r.error;return r.value;};
  const scene=parseProjectFile(JSON.stringify(f.source)).scene,camera=value(resolveSourceCamera(scene.sourceCamera));if(camera.kind!=='known')throw Error(camera.reason);
  const timeline=new OrdinarySourceCameraTimelineSession(camera.state.value,scene.timeline.tracks,30,{}),graphics=value(SourceProcessingContext.create(f.viewport.logicalWidth,f.viewport.logicalHeight)),shader=new SourceProcessingShaderContext();
  const events=(items:readonly SourceProcessingContextEvent[])=>{for(const event of items)value(graphics.apply(event));};
  const program=prepareSourceSymmetryCustomProgram(f.source.equation.glsl,f.compileDegree),parameters=Object.entries(bindSymmetryCustomParameters(program,f.source.parameters)).map(([name,value])=>({name,value}));let index=0;
  try{
   const address=await app.listen(0),base=`http://127.0.0.1:${address.port}`;const fetchSpy=vi.spyOn(globalThis,'fetch').mockImplementation((input,init)=>realFetch(new URL(String(input),base),init));restoreFetch=()=>fetchSpy.mockRestore();
   events([{kind:'begin-draw'},...sourceProcessingSceneInitializationEvents()]);value(shader.bind(graphics));events([{kind:'end-draw'}]);
   await o.good({kind:'create-fragment',resource:A,count,...program});await o.good({kind:'upload',resource:A,profile,expectedCount:count,expectedIndex:0,offset:0,positionsAndMetric:new Float32Array(new Uint32Array(f.seedBits).buffer)});
   for(const frame of f.frames){
    events([{kind:'begin-draw'}]);const calculated=timeline.step(frame.rawDt);
    for(const steps of frame.steps){
     const automatic=value(sourceProcessingAutomaticSetters(value(shader.bind(undefined))));
     const r=(await o.good({kind:'advance-processing-fragment',resource:A,expectedCount:count,expectedIndex:index,reset:false,resetCounter:false,steps,automatic,parameters})).decoded;index=r.index;
     const outcomes=Object.fromEntries(r.processingBindings!.parameters.map(p=>[p.name,p.outcome]));expect(outcomes).toMatchObject({perspective:'applied',normalMatrix:'rejected',iterations:'rejected',stateTex:'rejected',gl_unused:'inactive','123':'inactive'});
    }
    const actual=(await o.good({...read(count,index),profile})).decoded;expect(bytes(actual.positionsAndMetric!),`original frame ${frame.index}`).toEqual(Buffer.from(new Uint32Array(frame.expectedBits).buffer));
    const prepared=value(prepareSourceCamera({...scene.sourceCamera,frame:calculated.camera},f.viewport));if(prepared.kind!=='known')throw Error(prepared.reason);
    events(sourceProcessingSceneBaseEvents(prepared.plan));if(scene.settings.sourceCameraProjection==='scene-fade-orthographic')events(sourceProcessingOverlayEvents());events(sourceProcessingSceneWorldEvents(prepared.plan));events([{kind:'pop-matrix'}]);expect(f.watermark).toBe(true);events([...sourceProcessingOverlayEvents(),{kind:'end-draw'}]);
   }
   await o.good({...release(),profile});
  }finally{restoreFetch?.();shader.dispose();graphics.dispose();await app.close();expect(app.ownedProcessCount).toBe(0);}
 });
 it('runs source setter phases against its own linked program and preserves state on preflight failures',async()=>{
  const o=await owner(),profile='source-fragment' as const,count=3;
  const program=prepareSourceSymmetryCustomProgram(`uniform mat4 transform;uniform mat4 transformMatrix=mat4(7.);uniform bvec4 viewport;uniform bool perspective;uniform float gain;uniform float authored[2]=float[2](.25,.5);uniform sampler2D ppixels;
// uniform float authored;
// uniform float perspective;
// uniform float transform;
// uniform float iterations;
// uniform float stateTex;
// uniform float gl_unused;
// uniform float 123;
void calculate_next(in vec3 p,out vec3 q,out float m){q=vec3(transform[0][0]+transformMatrix[0][0]+float(viewport.z)+float(perspective),authored[0]+authored[1]+gain+float(iterations),0.);m=texture(ppixels,texCoord).x;}`,5);
  const parameters=(values:Record<string,number>)=>Object.entries(bindSymmetryCustomParameters(program,values)).map(([name,value])=>({name,value}));
  const step=(index:number,steps=3):Extract<SourceIteratedNativeOperation,{kind:'advance-processing-fragment'}>=>({kind:'advance-processing-fragment',resource:A,expectedCount:count,expectedIndex:index,steps,reset:false,resetCounter:false,automatic:[{names:['transform','transformMatrix'],type:35676,values:[3,0,0,0,0,3,0,0,0,0,3,0,0,0,0,3]},{names:['viewport'],type:35666,values:[0,0,10,20]},{names:['perspective'],type:5124,values:[0]},{names:['ppixels'],type:5124,values:[0]},{names:['absent'],type:35664,values:[1,2]}],parameters:parameters({gain:.125,authored:.875,perspective:.25,transform:99,iterations:12,stateTex:1})});
  const scan=(index:number)=>({...read(count,index),profile});
  try{
   await o.good({kind:'create-fragment',resource:A,count,...program});await o.good({...upload(count),profile});
   const initial=seed(count),first=(await o.good(step(0))).decoded;
   expect(first.processingBindings!.automatic).toEqual([{outcome:'applied',selectedName:'transform'},{outcome:'applied',selectedName:'viewport'},{outcome:'applied',selectedName:'perspective'},{outcome:'applied',selectedName:'ppixels'},{outcome:'inactive'}]);
   const outcomes=Object.fromEntries(first.processingBindings!.parameters.map(p=>[p.name,p.outcome]));expect(outcomes).toEqual({gain:'applied',authored:'applied',perspective:'applied',transform:'rejected',iterations:'rejected',stateTex:'rejected',gl_unused:'inactive','123':'inactive'});
   const expected=new Float32Array(count*4);for(let i=0;i<count;i++)expected.set([12,4.5,0,initial[i*4]],i*4);expect(bytes((await o.good(scan(1))).decoded.positionsAndMetric!)).toEqual(bytes(expected));
   const missing={...step(1),reset:true,resetCounter:true,parameters:step(1).parameters.slice(1)};await o.bad(missing,'input');
   const foreign=step(1);foreign.reset=true;foreign.resetCounter=true;(foreign.automatic[3].values as number[])[0]=1;await o.bad(foreign,'ownership');
   await o.bad(step(1),'input',b=>b.writeUInt32LE(0x7fc00000,b.indexOf(Buffer.from('gain'))+4));
   expect(bytes((await o.good(scan(1))).decoded.positionsAndMetric!)).toEqual(bytes(expected));
   const reset={...step(1,0),reset:true,resetCounter:true};expect((await o.good(reset)).decoded.processingBindings!.automatic.every(r=>r.outcome==='skipped')).toBe(true);expect(bytes((await o.good(scan(2))).decoded.positionsAndMetric!)).toEqual(bytes(initial));
   await o.good(step(2));expect(bytes((await o.good(scan(3))).decoded.positionsAndMetric!)).toEqual(bytes(expected));
   const empty={...step(3,1),parameters:parameters({gain:NaN})};await o.good(empty);for(let i=0;i<count;i++)expected.set([11,1.5,0,12],i*4);expect(bytes((await o.good(scan(4))).decoded.positionsAndMetric!)).toEqual(bytes(expected));
   await o.good(create(1,B));await o.bad({...step(0),resource:B,expectedCount:1},'ownership');await o.good(release(B));
   await o.good({...release(),profile});
  }finally{await o.close();}
 });
 it('keeps custom invalid observations in completed-pass units and rejects forged native profile requests',async()=>{
  const o=await owner(),profile='source-fragment' as const;
  const program=prepareSourceSymmetryCustomProgram('uniform float zero;void calculate_next(in vec3 pos,out vec3 nextPos,out float metric){nextPos=vec3(1./zero,pos.y+1.,9.);metric=-3.;}',5);
  const step=(index:number,steps:number,resetCounter=false):SourceIteratedNativeOperation=>({kind:'advance-fragment',resource:A,expectedCount:1,expectedIndex:index,steps,reset:false,resetCounter,bindings:[{name:'zero',type:5126,values:[0]}]});
  try{
   await o.good({kind:'create-fragment',resource:A,count:1,...program});await o.good({...upload(1),profile});
   await o.good(step(0,3));await o.good(step(1,3));
   const r=(await o.good({...read(1,2),profile})).decoded;expect(r.diagnosticUnit).toBe('completed-pass');expect([...r.invalidCounts!]).toEqual([2]);expect([...r.validity!]).toEqual([0]);
   await o.good(step(2,0,true));const zero=(await o.good({...read(1,3),profile})).decoded;expect(bytes(zero.positionsAndMetric!)).toEqual(bytes(r.positionsAndMetric!));expect([...zero.invalidCounts!]).toEqual([0]);expect([...zero.validity!]).toEqual([0]);
   await o.bad(step(3,1),'input',b=>b.writeUInt32LE(3,64));
   await o.bad({...read(1,3),profile},'ownership',b=>b.writeUInt32LE(6,4));
   expect((await o.good({...read(1,3),profile})).decoded.index).toBe(3);await o.good({...release(),profile});
  }finally{await o.close();}
 });

 it('retires failed fragment creation before permitting a new service owner',async()=>{
  const o=await owner(),program=prepareSourceSymmetryCustomProgram('void calculate_next(in vec3 p,out vec3 q,out float m){q=p;m=0.;}',5),creation:SourceIteratedNativeOperation={kind:'create-fragment',resource:A,count:1,...program};
  try{
   await o.bad({...creation,fragment:'#version 410 core\nnot valid GLSL'},'runtime');expect(o.service.processCount).toBe(0);expect(o.service.retainedResourceCount).toBe(0);
   await o.good(creation);await o.good({...release(),profile:'source-fragment'});
  }finally{await o.close();}
 });

});
