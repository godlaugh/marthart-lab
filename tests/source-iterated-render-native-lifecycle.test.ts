import {beforeAll,describe,expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {parseProjectFile} from '../src/engine/legacyImport';
import {prepareIteratedFrame,type IteratedFrameJob} from '../src/scenes/iteratedDensity';
import {iteratedInitialChunk} from '../src/engine/iteratedSeed';
import {iteratedDensityGpuPrograms,iteratedGpuFieldSource,type IteratedGpuFieldSource} from '../src/engine/iteratedDensityGpuPrograms';
import {prepareSourceSymmetryPalette} from '../src/engine/sourceSymmetryPalette';
import {prepareSourceSymmetryTone} from '../src/engine/sourceSymmetryPresentation';
import {prepareSourceIteratedDrawPlan,prepareSourceIteratedPresentPlan,sourceIteratedRenderPrograms} from '../src/engine/sourceIteratedRenderPlan';
import {encodeSourceIteratedNativeRequest,decodeSourceIteratedNativeResponse,type SourceIteratedNativeOperation,type SourceIteratedNativeRequest} from '../src/engine/sourceIteratedNativeProtocol';
import {encodeSourceIteratedRenderNativeRequest,decodeSourceIteratedRenderNativeResponse,type SourceIteratedNativeDrawPlan,type SourceIteratedNativePresentPlan,type SourceIteratedRenderNativeOperation,type SourceIteratedRenderNativeRequest} from '../src/engine/sourceIteratedRenderNativeProtocol';
import {encodeSourceDrawingFrame,type SourceDrawingFrame} from '../src/engine/sourceDrawingFrame';
// @ts-expect-error The production Node process owner is separate from browser contracts.
import {createSourceRendererService} from '../server/source-renderer.mjs';

// Real windowless production CGL/service boundaries. This suite compares exact
// retained outputs with themselves across lifecycle operations; it makes no
// original-application or cross-driver pixel-equivalence claim.
const STATE='11'.repeat(16),OTHER_STATE='22'.repeat(16),INK_A='aa'.repeat(16),INK_B='bb'.repeat(16),INK_C='cc'.repeat(16);
const WIDTH=32,HEIGHT=24;
const bytes=(a:Float32Array|Uint8ClampedArray)=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
type RenderOperation=SourceIteratedRenderNativeOperation;
type RenderOptions={width?:number;height?:number;mutate?:(packet:Buffer)=>void};
let executable:{executablePath:string;executableSha256:string};

function fixture(count=8){
 const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'Retained ink lifecycle',type:'SYMMETRY_CHAOS',settings:{batch_size:count,burn_in_steps:0,background_color:'#000000'},palette:['#ff0000','#ff0000']})).scene;
 const job=prepareIteratedFrame(scene,0,0),source=iteratedGpuFieldSource(job.field,'native-gl41');
 expect(source.sourceCalculateNext).toBe(true);
 const program=iteratedDensityGpuPrograms('native-gl41').iteration(source),uniforms=Object.entries(source.uniforms).map(([name,value])=>({name,value}));
 const target={width:WIDTH,height:HEIGHT,stateWidth:Math.min(2048,count),projection:'xy' as const,bounds:{minX:-1,maxX:1,minY:-1,maxY:1}};
 const prepared=prepareSourceIteratedDrawPlan(job,target),programs=sourceIteratedRenderPrograms('native-gl41','symmetry',prepared.sourceSplatProgram);
 const preparedPresent=prepareSourceIteratedPresentPlan(prepareSourceSymmetryTone(scene,{width:WIDTH,height:HEIGHT}),WIDTH,HEIGHT);
 const presentPlan:SourceIteratedNativePresentPlan={uniforms:preparedPresent.uniforms,clear:Array.from(preparedPresent.clear),filter:preparedPresent.filter};
 const drawPlan=(value:IteratedFrameJob=job):SourceIteratedNativeDrawPlan=>{
  const plan=prepareSourceIteratedDrawPlan(value,target);
  return{drawUniforms:plan.drawUniforms,statsUniforms:plan.statsUniforms,palette:{key:plan.palette.key,format:plan.palette.format,values:plan.palette.createValues()},noise:plan.noisePermutation,primitive:plan.primitive};
 };
 const binding=(resource:string,index:number,displays:number)=>({resource,stateResource:STATE,expectedIndex:index,expectedDisplays:displays,expectedCount:count});
 return{count,job,source,program,programs,uniforms,drawPlan,
  seeds:()=>iteratedInitialChunk(job.config,0,count),
  create:(resource=INK_A,index=0):RenderOperation=>({...binding(resource,index,0),kind:'create',expectedDisplays:0,programs}),
  draw:(resource=INK_A,index=0,displays=0,value=job,clear=true):RenderOperation=>({...binding(resource,index,displays),kind:'draw',plan:drawPlan(value),record:value.config.record,decay:value.config.decay,clear}),
  present:(resource=INK_A,index=0,displays=1):RenderOperation=>({...binding(resource,index,displays),kind:'present',plan:presentPlan}),
  advance:(index:number,steps=1,extra:Partial<Extract<SourceIteratedNativeOperation,{kind:'advance'}>>={}):SourceIteratedNativeOperation=>({kind:'advance',resource:STATE,expectedCount:count,expectedIndex:index,steps,reset:false,dimension:2,uniforms,...extra}),
  read:(index:number):SourceIteratedNativeOperation=>({kind:'read',resource:STATE,expectedCount:count,expectedIndex:index,offset:0,count}),
 };
}
async function owner(){
 const service=await createSourceRendererService({...executable,timeoutMs:15000});let sequence=0;
 return{service,
  async compute(operation:SourceIteratedNativeOperation,mutate?:(packet:Buffer)=>void){
   const request:SourceIteratedNativeRequest={generation:1,sequence:++sequence,operation},encoded=encodeSourceIteratedNativeRequest(request);if(!encoded.ok)throw Error(encoded.error.reason);
   const packet=Buffer.from(encoded.value);mutate?.(packet);const result=await service.render(packet);
   return{request,packet,result,...(result.ok?{decoded:decodeSourceIteratedNativeResponse(result.value.pixels,request)}:{})};
  },
  async computeGood(operation:SourceIteratedNativeOperation){const r=await this.compute(operation);expect(r.result.ok,JSON.stringify(r.result.error)).toBe(true);return{...r,decoded:r.decoded!};},
  async render(operation:RenderOperation,options:RenderOptions={}){
   const request:SourceIteratedRenderNativeRequest={generation:1,sequence:++sequence,width:options.width??(operation.kind==='release'?1:WIDTH),height:options.height??(operation.kind==='release'?1:HEIGHT),operation};
   const encoded=encodeSourceIteratedRenderNativeRequest(request);if(!encoded.ok)throw Error(encoded.error.reason);
   const packet=Buffer.from(encoded.value);options.mutate?.(packet);const result=await service.render(packet);
   return{request,result,...(result.ok?{decoded:decodeSourceIteratedRenderNativeResponse(result.value.pixels,request)}:{})};
  },
  async good(operation:RenderOperation,options:RenderOptions={}){const r=await this.render(operation,options);expect(r.result.ok,JSON.stringify(r.result.error)).toBe(true);expect(r.result.value.format).toBe('iterated-render-v1');expect(r.result.value.rowOrder).toBe(operation.kind==='present'?'bottom-up':'none');return{...r,decoded:r.decoded!};},
  async rejected(operation:RenderOperation,options:RenderOptions={},kind='input'){const r=await this.render(operation,options);expect(r.result).toMatchObject({ok:false,error:{kind}});},
  async setup(f:ReturnType<typeof fixture>,resource=STATE){await this.computeGood({kind:'create',resource,count:f.count,...f.program});await this.computeGood({kind:'upload',resource,expectedIndex:0,expectedCount:f.count,offset:0,positionsAndMetric:f.seeds()});},
  async generic(){
   const frame:SourceDrawingFrame={generation:1,sequence:++sequence,width:7,height:5,samples:0,clear:[.25,.5,.75,1],drawing:{model:'source-drawing-v1',commands:[],textures:[],admittedBytes:0,copiedBufferBytes:0,retainedBufferBytes:0}};
   const encoded=encodeSourceDrawingFrame(frame);if(!encoded.ok)throw Error(encoded.error.reason);const result=await service.render(encoded.value);expect(result.ok,JSON.stringify(result.error)).toBe(true);expect(result.value.format).toBe('rgba8');expect(result.value.pixels).toHaveLength(7*5*4);return result;
  },
  async close(){expect(await service.close()).toEqual({ok:true});expect(service.processCount).toBe(0);expect(service.activeCount).toBe(0);expect(service.retainedResourceCount).toBe(0);}
 };
}
const releaseInk=(resource=INK_A):RenderOperation=>({kind:'release',resource});
const releaseState=(resource=STATE):SourceIteratedNativeOperation=>({kind:'release',resource});

describe.skipIf(process.platform!=='darwin')('real retained iterated render CGL lifecycle',()=>{
 beforeAll(()=>{
  mkdirSync('.cache',{recursive:true});const directory=mkdtempSync(resolve('.cache/iterated-render-lifecycle-')),executablePath=join(directory,'renderer');
  const build=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-Werror','-framework','Foundation','-framework','OpenGL','server/render/SourceCglRenderer.m','-o',executablePath],{encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:65536});
  expect(build.error).toBeUndefined();expect(build.status,build.stderr).toBe(0);expect(build.stderr).toBe('');executable={executablePath,executableSha256:createHash('sha256').update(readFileSync(executablePath)).digest('hex')};
 });
 it('isolates two ink owners, presents their last checkpoints after compute advances, and releases only exact resources',async()=>{
  const o=await owner(),f=fixture();try{
   await o.setup(f);await o.computeGood(f.advance(0));const a=await o.good(f.create(INK_A,1));await o.good(f.create(INK_B,1));expect(o.service.retainedResourceCount).toBe(3);
   await o.rejected(f.create(INK_C,1),{},'capacity');expect(o.service.retainedResourceCount).toBe(3);
   const first=await o.good(f.draw(INK_A,1));expect(first.decoded.accepted).toBeGreaterThan(0);expect(first.decoded.displays).toBe(1);
   const initial=(await o.good(f.present(INK_A,1))).decoded;expect(initial.occupiedPixels).toBeGreaterThan(0);const original=Buffer.from(bytes(initial.pixels!));
   const blue={...f.job,palette:{...f.job.palette,stops:['#0000ff','#0000ff']}};blue.symmetryPalette=prepareSourceSymmetryPalette(blue.palette);
   await o.good(f.draw(INK_B,1,0,blue));const other=(await o.good(f.present(INK_B,1))).decoded;expect(bytes(other.pixels!)).not.toEqual(original);
   await o.computeGood(f.advance(1));expect(bytes((await o.good(f.present(INK_A,1))).decoded.pixels!)).toEqual(original);
   await o.good(f.draw(INK_B,2,1,blue,false));expect(bytes((await o.good(f.present(INK_A,1))).decoded.pixels!)).toEqual(original);
   const generic=await o.generic();expect(generic.value.contextSerial).toBe(a.result.value.contextSerial);expect(bytes((await o.good(f.present(INK_A,1))).decoded.pixels!)).toEqual(original);
   expect((await o.compute(releaseState())).result).toMatchObject({ok:false,error:{kind:'ownership'}});expect(o.service.retainedResourceCount).toBe(3);
   const released=(await o.good(releaseInk())).decoded;expect(released).toMatchObject({resource:INK_A,stateResource:STATE,disposition:'released',index:1,displays:1,count:f.count,width:WIDTH,height:HEIGHT});expect(o.service.retainedResourceCount).toBe(2);
   expect((await o.good(releaseInk())).decoded).toMatchObject({disposition:'absent',index:0,displays:0,count:0,width:0,height:0});expect(o.service.retainedResourceCount).toBe(2);
   expect((await o.good(f.present(INK_B,2,2))).decoded.occupiedPixels).toBeGreaterThan(0);await o.good(releaseInk(INK_B));expect(o.service.retainedResourceCount).toBe(1);
   expect((await o.computeGood(releaseState())).decoded).toMatchObject({disposition:'released',index:2,totalCount:f.count});expect(o.service.retainedResourceCount).toBe(0);
  }finally{await o.close();}
 },30000);
 it('rejects malformed drawing identities, dimensions, checkpoints and controls without changing retained pixels',async()=>{
  const o=await owner(),f=fixture();try{
   await o.setup(f);await o.computeGood(f.advance(0));await o.good(f.create(INK_A,1));await o.good(f.draw(INK_A,1));
   const baseline=await o.good(f.present(INK_A,1)),original=Buffer.from(bytes(baseline.decoded.pixels!));
   const stable=async()=>{const r=await o.good(f.present(INK_A,1));expect(r.decoded.displays).toBe(1);expect(bytes(r.decoded.pixels!)).toEqual(original);expect(r.result.value.contextSerial).toBe(baseline.result.value.contextSerial);expect(o.service.retainedResourceCount).toBe(2);};
   const valid=f.draw(INK_A,1,1);if(valid.kind!=='draw')throw Error('draw fixture');
   await o.rejected({...valid,expectedCount:f.count+1});await stable();
   await o.rejected({...valid,expectedIndex:0});await stable();
   await o.rejected({...valid,expectedDisplays:0});await stable();
   await o.rejected(valid,{width:WIDTH+1});await stable();
   await o.rejected({...valid,plan:{...valid.plan,drawUniforms:valid.plan.drawUniforms.map(u=>u.name==='stateWidth'?{name:u.name,kind:'int' as const,values:[f.count+1]}:u)}});await stable();
   await o.rejected({...valid,plan:{...valid.plan,drawUniforms:valid.plan.drawUniforms.map(u=>u.name==='states'?{name:u.name,kind:'sampler2d' as const,texture:2}:u)}});await stable();
   await o.rejected(valid,{mutate:p=>p.writeUInt32LE(2,120)});await stable();
   // Corrupt one encoded scalar after codec admission so the native parser,
   // rather than a TypeScript precheck, must reject the nonfinite uniform.
   await o.rejected(valid,{mutate:p=>{const name=Buffer.from('alpha'),at=p.indexOf(name);expect(at).toBeGreaterThan(0);p.writeFloatLE(NaN,at+name.length+8);}});await stable();
   await o.setup(f,OTHER_STATE);await o.rejected({...valid,stateResource:OTHER_STATE});expect(o.service.retainedResourceCount).toBe(3);
   expect(bytes((await o.good(f.present(INK_A,1))).decoded.pixels!)).toEqual(original);await o.computeGood(releaseState(OTHER_STATE));await stable();
   const present=f.present(INK_A,1);if(present.kind!=='present')throw Error('present fixture');
   await o.rejected({...present,expectedIndex:0});await stable();await o.rejected({...present,expectedDisplays:2});await stable();
   await o.good(f.draw(INK_A,1,1));expect((await o.good(f.present(INK_A,1,2))).decoded.displays).toBe(2);
  }finally{await o.close();}
 },30000);
 it('acknowledges record=false without adding samples and preserves ink across a counter-only computation phase',async()=>{
  const o=await owner(),f=fixture();try{
   await o.setup(f);await o.computeGood(f.advance(0));await o.good(f.create(INK_A,1));await o.good(f.draw(INK_A,1));const original=Buffer.from(bytes((await o.good(f.present(INK_A,1))).decoded.pixels!));
   await o.computeGood(f.advance(1,0,{resetCounter:true}));const noRecord={...f.job,config:{...f.job.config,record:false,decay:1}};
   const result=await o.good(f.draw(INK_A,2,1,noRecord,false));expect(result.decoded).toMatchObject({index:2,displays:2,accepted:0,clipped:0,sampleInvalid:0});expect(bytes((await o.good(f.present(INK_A,2,2))).decoded.pixels!)).toEqual(original);
  }finally{await o.close();}
 });
 it('keeps v6 advance compatible while v7 resets counters independently of nonfinite state',async()=>{
  const o=await owner(),f=fixture(2),diagnostic:IteratedGpuFieldSource={key:'render-counter-boundary',sourceCalculateNext:true,uniforms:{},source:'void calculate_next(in vec3 p,out vec3 next,out float metric){next=vec3(uintBitsToFloat(0x7fc12345u),uintBitsToFloat(0x7f800000u),0.);metric=uintBitsToFloat(0xff800000u);}'};
  try{
   await o.computeGood({kind:'create',resource:STATE,count:2,...iteratedDensityGpuPrograms('native-gl41').iteration(diagnostic)});await o.computeGood({kind:'upload',resource:STATE,expectedIndex:0,expectedCount:2,offset:0,positionsAndMetric:f.seeds()});
   const legacy=await o.computeGood(f.advance(0,2,{uniforms:[]}));expect(legacy.packet.readUInt32LE(4)).toBe(6);expect([...(await o.computeGood(f.read(1))).decoded.invalidCounts!]).toEqual([2,2]);
   await o.computeGood(f.advance(1,1,{uniforms:[]}));const invalid=(await o.computeGood(f.read(2))).decoded;expect([...invalid.invalidCounts!]).toEqual([3,3]);const state=Buffer.from(bytes(invalid.positionsAndMetric!));
   const reset=await o.computeGood(f.advance(2,0,{uniforms:[],resetCounter:true}));expect(reset.packet.readUInt32LE(4)).toBe(7);const cleared=(await o.computeGood(f.read(3))).decoded;expect(bytes(cleared.positionsAndMetric!)).toEqual(state);expect([...cleared.invalidCounts!]).toEqual([0,0]);expect([...cleared.validity!]).toEqual([0,0]);
   await o.computeGood(f.advance(3,1,{uniforms:[],resetCounter:false}));expect([...(await o.computeGood(f.read(4))).decoded.invalidCounts!]).toEqual([1,1]);
   const seedReset=await o.computeGood(f.advance(4,0,{uniforms:[],reset:true}));expect(seedReset.packet.readUInt32LE(4)).toBe(6);const restored=(await o.computeGood(f.read(5))).decoded;expect(bytes(restored.positionsAndMetric!)).toEqual(bytes(f.seeds()));expect([...restored.invalidCounts!]).toEqual([0,0]);expect([...restored.validity!]).toEqual([1,1]);await o.computeGood(releaseState());
  }finally{await o.close();}
 });
 it('retires failed shader context and all dependent owners before accepting a fresh context',async()=>{
  const o=await owner(),f=fixture();try{
   await o.setup(f);const original=await o.good(f.create());await o.good(f.draw());expect(o.service.retainedResourceCount).toBe(2);
   const create=f.create(INK_B);if(create.kind!=='create')throw Error('create fixture');
   await o.rejected({...create,programs:{...create.programs,draw:{...create.programs.draw,fragment:'#version 410 core\ninvalid shader;'}}},{},'runtime');expect(o.service.retainedResourceCount).toBe(0);expect(o.service.processCount).toBe(0);expect(o.service.processObservation).toBeNull();
   expect((await o.compute(f.read(0))).result).toMatchObject({ok:false,error:{kind:'state-lost'}});
   expect((await o.render(f.present())).result).toMatchObject({ok:false,error:{kind:'state-lost'}});
   // The service retires the exact child, so its new context counter starts at
   // one again. Session identity, not a child-local GL counter, proves renewal.
   const fresh=await o.generic();expect(fresh.value.sessionSerial).toBeGreaterThan(original.result.value.sessionSerial);expect(o.service.sessionStarts).toBeGreaterThan(1);
   await o.setup(f);await o.good(f.create());await o.good(f.draw());expect((await o.good(f.present())).decoded.occupiedPixels).toBeGreaterThan(0);
  }finally{await o.close();}
 },30000);
});
