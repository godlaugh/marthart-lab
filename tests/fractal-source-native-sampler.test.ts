import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const {transport,lease}=vi.hoisted(()=>({transport:vi.fn(),lease:vi.fn()}));
vi.mock('../src/engine/sourceNativeClient',async actual=>({...await actual<typeof import('../src/engine/sourceNativeClient')>(),exchangeSourceFractalNative:transport}));
vi.mock('../src/engine/sourceNativeLease',()=>({ensureSourceNativeLease:lease}));
import {FractalSourceNativeSampler} from '../src/engine/fractalSourceNativeSampler';
import {fractalConfig,generateFractalAsync} from '../src/scenes/complex';
import {parseFractalSourcePlan} from '../src/engine/fractalSourcePrecision';
import {prepareFractalSourceColor,createDefaultFractalSourceColorConfiguration} from '../src/engine/fractalSourceColor';
import {FRACTAL_SOURCE_NATIVE_SHADERS} from '../src/engine/fractalSourceNativeProgram';
import {SOURCE_FRACTAL_NATIVE_MAX_SAMPLES,encodeSourceFractalNativeRequest,type SourceFractalNativeRequest} from '../src/engine/sourceFractalNativeProtocol';
import type {SourceNativeFractalResponse} from '../src/engine/sourceNativeClient';
import type {FractalSourceSampleRequest} from '../src/engine/fractalSourceSampling';
import {SOURCE_FRAME_BUDGET} from '../src/engine/sourceDrawingFrame';
import {scatterFractalSourceRasterSample} from '../src/engine/fractalSourceRasterSample';
import fixture from './fixtures/source-fractal-display/mandelbrot.json';
import {parseProjectFile} from '../src/engine/legacyImport';
import {sceneAtTime} from '../src/engine/timeline';

// Real plan, palette, bindings, codec and sampler owner with mocked transport.
// Record payloads below are diagnostic fixtures, not GPU/original-app evidence.
const samplers:FractalSourceNativeSampler[]=[],remote=new Map<string,{index:number;width:number;height:number}>();
function owner(){const sampler=new FractalSourceNativeSampler();samplers.push(sampler);return sampler;}
function input(width=17,height=13,zoom=1):FractalSourceSampleRequest {
 const config=fractalConfig({formula:'newton',power:2,iterations:8}),plan=parseFractalSourcePlan(config,{centerX:2,centerXLow:0,centerY:0,centerYLow:0,zoom,rotation:0},{logicalWidth:width,logicalHeight:height,provenance:'requested-output-local'},{precision:'high'});
 const colorPlan=prepareFractalSourceColor({configuration:createDefaultFractalSourceColorConfiguration(),formulaPower:2,bailout:.001});
 return{points:Float32Array.of(12,9,0,0,12,9),width,height,config,plan,colorPlan,additionalBytes:width*height*4};
}
function reply(request:SourceFractalNativeRequest):SourceNativeFractalResponse {
 const op=request.operation,previous=remote.get(op.resource),count=op.kind==='sample'?op.points.length/2:0,records=new Uint8Array(count*52),view=new DataView(records.buffer);
 const allocated=op.kind==='sample'&&(!previous||previous.width!==request.width||previous.height!==request.height)?1:0;
 if(op.kind==='create')remote.set(op.resource,{index:0,width:0,height:0});
 if(op.kind==='sample'){
  for(let i=0;i<count;i++){const values=[op.points[i*2],-0,op.points[i*2+1],NaN,1,32768,4,Infinity];for(let j=0;j<8;j++)view.setFloat32(i*52+j*4,values[j],true);records.set([op.points[i*2],op.points[i*2+1],165,255],i*52+32);}
  remote.set(op.resource,{index:op.expectedIndex+1,width:request.width,height:request.height});
 }
 if(op.kind==='release')remote.delete(op.resource);
 return{resource:op.resource,committedRequests:op.kind==='sample'?op.expectedIndex+1:op.kind==='release'?previous?.index??0:0,disposition:op.kind==='release'?(previous?'released':'absent'):'owned',count,width:request.width,height:request.height,draws:op.kind==='sample'?1:0,targetAllocations:allocated,referenceUploads:op.kind==='sample'?1:0,paletteUploads:op.kind==='sample'?1:0,...(op.kind==='sample'?{records}:{}),generation:request.generation,sequence:request.sequence,rendererIdentity:'a'.repeat(64),contextSerial:9,sessionSerial:4,requestBytes:128};
}
function normal(request:SourceFractalNativeRequest,options:Parameters<typeof encodeSourceFractalNativeRequest>[1]){
 const encoded=encodeSourceFractalNativeRequest(request,options);if(!encoded.ok)throw Error(encoded.error.reason);return Promise.resolve({...reply(request),requestBytes:encoded.value.length});
}
const operations=()=>transport.mock.calls.map(([r])=>(r as SourceFractalNativeRequest).operation);
beforeEach(()=>{remote.clear();transport.mockReset().mockImplementation(normal);lease.mockReset().mockResolvedValue(undefined);});
afterEach(async()=>{vi.unstubAllGlobals();vi.restoreAllMocks();transport.mockReset().mockImplementation(normal);lease.mockReset().mockResolvedValue(undefined);for(const sampler of samplers.splice(0))await sampler.dispose();expect(remote.size).toBe(0);});

describe('source Fractal native sampler CPU ownership contracts',()=>{
 it('uses production shaders and bindings, preserves record facts and counts actual ACK execution',async()=>{
  const sampler=owner(),request=input(),first=await sampler.sample(request),second=await sampler.sample(request);
  expect(sampler.maximumSamples).toBe(SOURCE_FRACTAL_NATIVE_MAX_SAMPLES);expect(operations()[0]).toMatchObject({kind:'create',shaders:FRACTAL_SOURCE_NATIVE_SHADERS});
  const samples=operations().filter(op=>op.kind==='sample');expect(samples.map(op=>op.expectedIndex)).toEqual([0,1]);expect(samples[0].points).toEqual(Uint32Array.of(12,9,0,0,12,9));
  expect(samples[0].uniforms.find(u=>u.name==='u_dynamicParams')).toMatchObject({kind:'float-array',count:32});expect(samples[0].uniforms.find(u=>u.name==='u_gradientTex')).toEqual({name:'u_gradientTex',kind:'sampler2d',texture:1});
  expect(first.values!.slice(0,8)).toEqual(Float32Array.of(12,9,2,2,0,0,Infinity,0));expect(Object.is(first.residual![0],-0)).toBe(true);expect(Number.isNaN(first.residual![1])).toBe(true);expect(first.sourceRGBA).toEqual(Uint8Array.of(12,9,165,255,0,0,165,255,12,9,165,255));expect(second).toEqual(first);
  expect(sampler.diagnostics()).toMatchObject({samples:6,colorSamples:6,draws:2,rasterDraws:2,rasterAllocations:1,referenceUploads:2,colorUploads:2,referenceHits:0,colorHits:0,ordinarySteps:12,perturbSteps:0,committedRequests:2,reference:{builds:1,hits:1}});
  expect(sampler.execution()).toEqual({backend:'native',renderer:{identity:'a'.repeat(64),contextSerial:9,sessionSerial:4}});expect(sampler.pixelRenderer()).toMatchObject({backend:'native',identity:'a'.repeat(64),generation:transport.mock.calls[2][0].generation,sequence:3,samples:0});
 });

 it('shares the scatter interpretation with WebGL including distance, traps and nonfinite values',()=>{
  const out={values:new Float32Array(16),residual:new Float32Array(16),source:new Float32Array(8),distance:new Float32Array(24),traps:new Float32Array(16),sourceRGBA:new Uint8Array(8)};
  const facts=scatterFractalSourceRasterSample(out,1,true,8,Float32Array.of(0,0,0,0,NaN,-0,Infinity,-Infinity),Float32Array.of(0,0,0,0,2,1,9,NaN),4,Float32Array.of(0,0,0,0,1,2,3,4),Float32Array.of(0,0,0,0,5,6,7,8),Uint8Array.of(0,0,0,0,165,7,250,255));
  expect(facts).toMatchObject({converged:true,steps:3,ordinarySteps:3});expect(Number.isNaN(out.values[8])).toBe(true);expect(out.values[9]).toBe(Infinity);expect(out.residual.slice(8,16)).toEqual(Float32Array.of(-0,-Infinity,3,0,3,0,1,2));expect(out.traps.slice(8)).toEqual(Float32Array.of(1,2,3,4,5,6,7,8));expect(out.sourceRGBA.slice(4)).toEqual(Uint8Array.of(165,7,250,255));expect(out.distance[19]).toBe(2);
 });

 it('keeps two resources independent, admits same-size reuse and frees only the exact token',async()=>{
  const a=owner(),b=owner(),third=owner(),request=input();await a.sample(request);await b.sample(request);
  await expect(third.sample(request)).rejects.toMatchObject({kind:'capacity'});const created=operations().filter(op=>op.kind==='create');expect(created).toHaveLength(2);expect(created[0].resource).not.toBe(created[1].resource);
  await a.sample(request);expect(transport.mock.calls.at(-1)![1].retainedTarget).toEqual({resource:created[0].resource,width:17,height:13});await a.sample(input(23,19));expect(a.diagnostics().rasterAllocations).toBe(2);
  await a.dispose();expect(operations().at(-1)).toEqual({kind:'release',resource:created[0].resource});expect(b.diagnostics()).toMatchObject({owned:true,committedRequests:1,resources:1});await third.sample(request);await b.sample(request);expect(b.diagnostics().committedRequests).toBe(2);
 });

 it('validates zero batches without native work and rejects capacity before creating a token',async()=>{
  const sampler=owner(),request=input(),empty=await sampler.sample({...request,points:new Float32Array()});expect(empty).toMatchObject({values:new Float32Array(),residual:new Float32Array(),source:new Float32Array(),sourceRGBA:new Uint8Array()});expect(transport).not.toHaveBeenCalled();expect(lease).not.toHaveBeenCalled();expect(()=>sampler.execution()).toThrow();
  await expect(sampler.sample({...request,additionalBytes:SOURCE_FRAME_BUDGET})).rejects.toMatchObject({kind:'capacity'});await expect(sampler.sample({...request,points:Float32Array.of(.5,0)})).rejects.toMatchObject({kind:'input'});await expect(sampler.sample({...request,points:new Float32Array(65537*2)})).rejects.toMatchObject({kind:'input'});expect(transport).not.toHaveBeenCalled();
  expect((await sampler.sample(request)).sourceRGBA).toHaveLength(12);
 });

 it('admits prospective buffers without changing cache/execution and counts caller bytes before reference allocation',()=>{
  const sampler=owner(),request=input(),before=sampler.diagnostics();sampler.admit({...request,sampleCount:request.points.length/2});
  expect(sampler.diagnostics()).toMatchObject({owned:false,samples:0,reference:before.reference});expect(lease).not.toHaveBeenCalled();expect(transport).not.toHaveBeenCalled();
  expect(()=>sampler.admit({...request,sampleCount:3,additionalBytes:SOURCE_FRAME_BUDGET})).toThrow('256 MiB');
  const deep=input(17,13,100);expect(()=>sampler.prepareReference(deep.plan,{additionalBytes:SOURCE_FRAME_BUDGET})).toThrow('256 MiB');expect(sampler.diagnostics().reference).toEqual({builds:0,hits:0});
 });

 it('rejects native dimensions or retained-image capacity before allocating the output raster',async()=>{
  const scene=sceneAtTime(parseProjectFile(JSON.stringify(fixture)).scene,0),sampler=owner(),allocations:number[]=[];
  vi.stubGlobal('Uint8ClampedArray',new Proxy(Uint8ClampedArray,{construct(_target,args){allocations.push(Number(args[0]));throw Error('raster allocated before admission');}}));
  await expect(generateFractalAsync(scene,{time:0,quality:'export',width:6000,height:5000},sampler)).rejects.toMatchObject({kind:'input'});
  await expect(generateFractalAsync(scene,{time:0,quality:'export',width:4,height:3},sampler,undefined,{retainedBytes:SOURCE_FRAME_BUDGET})).rejects.toMatchObject({kind:'capacity'});
  expect(allocations).toEqual([]);expect(transport).not.toHaveBeenCalled();expect(lease).not.toHaveBeenCalled();
 });

 it('carries retained-image bytes through recursive display admission and each actual sample',async()=>{
  const scene=sceneAtTime(parseProjectFile(JSON.stringify(fixture)).scene,0),sampler=owner(),admit=vi.spyOn(sampler,'admit'),sample=vi.spyOn(sampler,'sample');
  const output=await generateFractalAsync(scene,{time:0,quality:'export',width:4,height:3},sampler,undefined,{retainedBytes:1234});
  expect(output.type).toBe('raster');expect(admit).toHaveBeenCalledOnce();expect(admit.mock.calls[0][0]).toMatchObject({width:4,height:3,sampleCount:12,additionalBytes:1234+48+96});expect(sample.mock.calls[0][0].additionalBytes).toBe(1234+48+96);
 });

 it('snapshots caller points, palette and numerical bindings before awaiting the lease',async()=>{
  let ready!:()=>void;lease.mockImplementationOnce(()=>new Promise<void>(resolve=>{ready=resolve;}));const sampler=owner(),request=input(),paletteFirst=request.colorPlan.lut[0],work=sampler.sample(request);
  request.points[0]=3;request.colorPlan.lut[0]=.123;request.config.trapCenter[0]=99;ready();await work;
  const operation=operations().find(op=>op.kind==='sample')!;expect(operation.points[0]).toBe(12);expect(operation.palette[0]).toBe(paletteFirst);const trap=operation.uniforms.find(u=>u.name==='legacyTrap')!;expect(trap.kind==='vec4'&&trap.values[0]).toBe(0);
 });

 it('cancels after an acknowledged sample without aborting transport or forgetting its checkpoint',async()=>{
  const sampler=owner(),request=input();await sampler.sample(request);let complete!:(value:SourceNativeFractalResponse)=>void,submitted!:SourceFractalNativeRequest,cancelled=false;
  transport.mockImplementationOnce((r:SourceFractalNativeRequest)=>{submitted=r;return new Promise<SourceNativeFractalResponse>(resolve=>{complete=resolve;});});
  const work=sampler.sample({...request,isCancelled:()=>cancelled}),failed=expect(work).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(submitted).toBeDefined());cancelled=true;expect(transport.mock.calls.at(-1)![1]).not.toHaveProperty('signal');expect(sampler.diagnostics().committedRequests).toBe(1);complete(reply(submitted));await failed;
  expect(sampler.diagnostics()).toMatchObject({committedRequests:2,cleanupPending:false,samples:6});await sampler.sample(request);expect(operations().at(-1)).toMatchObject({kind:'sample',expectedIndex:2});
 });

 it('retains a cancelled create ACK and allows release without ever sampling that token',async()=>{
  const sampler=owner();let complete!:(value:SourceNativeFractalResponse)=>void,submitted!:SourceFractalNativeRequest,cancelled=false;
  transport.mockImplementationOnce((r:SourceFractalNativeRequest)=>{submitted=r;return new Promise<SourceNativeFractalResponse>(resolve=>{complete=resolve;});});
  const work=sampler.sample({...input(),isCancelled:()=>cancelled}),failed=expect(work).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(submitted).toBeDefined());cancelled=true;complete(reply(submitted));await failed;expect(operations().map(op=>op.kind)).toEqual(['create']);expect(sampler.diagnostics()).toMatchObject({owned:true,committedRequests:0,cleanupPending:false});
  await sampler.dispose();expect(operations().map(op=>op.kind)).toEqual(['create','release']);
 });

 it('waits for its in-flight ACK before disposal and preserves a second owner',async()=>{
  const a=owner(),b=owner(),request=input();await a.sample(request);await b.sample(request);let complete!:(value:SourceNativeFractalResponse)=>void,submitted!:SourceFractalNativeRequest;
  transport.mockImplementationOnce((r:SourceFractalNativeRequest)=>{submitted=r;return new Promise<SourceNativeFractalResponse>(resolve=>{complete=resolve;});});
  const work=a.sample(request),failed=expect(work).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(submitted).toBeDefined());const disposed=a.dispose();await Promise.resolve();expect(operations().filter(op=>op.kind==='release')).toHaveLength(0);complete(reply(submitted));await failed;await disposed;
  expect(operations().at(-1)).toEqual({kind:'release',resource:submitted.operation.resource});expect(a.diagnostics()).toMatchObject({owned:false,active:false,resources:1});await b.sample(request);expect(b.diagnostics().committedRequests).toBe(2);
 });

 it('retains unacknowledged creation and failed cleanup ownership until a release retry confirms absence',async()=>{
  const sampler=owner();transport.mockRejectedValueOnce(Error('create acknowledgement lost'));await expect(sampler.sample(input())).rejects.toThrow('acknowledgement lost');const token=operations()[0].resource;expect(sampler.diagnostics()).toMatchObject({owned:true,cleanupPending:true});await expect(sampler.sample(input())).rejects.toMatchObject({kind:'state-lost'});
  transport.mockRejectedValueOnce(Error('release unavailable'));await expect(sampler.dispose()).rejects.toThrow('release unavailable');expect(sampler.diagnostics()).toMatchObject({owned:true,cleanupPending:true});await sampler.dispose();expect(operations().filter(op=>op.kind==='release').map(op=>op.resource)).toEqual([token,token]);expect(sampler.diagnostics()).toMatchObject({owned:false,resources:0});
 });

 it('rejects a changed execution identity and retains possible resize storage until release',async()=>{
  const sampler=owner();await sampler.sample(input());const held=sampler.diagnostics().retainedGpuBytes;
  transport.mockImplementationOnce(async r=>({...reply(r),contextSerial:10}));await expect(sampler.sample(input(23,19))).rejects.toMatchObject({kind:'state-lost'});expect(sampler.diagnostics()).toMatchObject({owned:true,cleanupPending:true,committedRequests:1});expect(sampler.diagnostics().retainedGpuBytes).toBeGreaterThan(held);await expect(sampler.sample(input())).rejects.toMatchObject({kind:'state-lost'});await sampler.dispose();
 });

 it('retains its real reference cache and charges replacement/cache plus caller storage',async()=>{
  const sampler=owner(),request=input(17,13,100),first=sampler.prepareReference(request.plan);expect(first.reference.kind).toBe('ready');expect(sampler.prepareReference(request.plan).cacheHit).toBe(true);expect(sampler.diagnostics().retainedCpuBytes).toBeGreaterThan(0);
  await sampler.sample(request);expect(sampler.diagnostics()).toMatchObject({reference:{builds:1,hits:2},referenceUploads:1,referenceHits:0});
  const calls=transport.mock.calls.length;await expect(sampler.sample({...request,additionalBytes:SOURCE_FRAME_BUDGET-1})).rejects.toMatchObject({kind:'capacity'});expect(transport).toHaveBeenCalledTimes(calls);expect(sampler.diagnostics().cleanupPending).toBe(false);await sampler.dispose();expect(sampler.diagnostics().retainedCpuBytes).toBe(0);
 });
});
