import {beforeAll,describe,expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {rootsPointCloudPrograms,type RootsPointFrameMetadata} from '../src/engine/rootsPointCloudDrawing';
import {metadata} from './source-roots-point-native-fixture';
import {captureSourceRootsPointNativeResponseBinding,decodeSourceRootsPointNativeResponse,encodeSourceRootsPointNativeRequest,sourceRootsPointNativeFrameSchedule,type SourceRootsPointNativeOperation,type SourceRootsPointNativeRequest} from '../src/engine/sourceRootsPointNativeProtocol';
import {encodeSourceDrawingFrame} from '../src/engine/sourceDrawingFrame';
// @ts-expect-error The Node owner is intentionally separate from browser code.
import {createSourceRendererService} from '../server/source-renderer.mjs';
// @ts-expect-error The loopback server is a separate runtime.
import {createExportServer} from '../server/index.mjs';

// Real CGL through production codec and Node process supervision. These bounded
// cases prove renderer lifecycle, not original-app solver/arrival/UI parity.
const A='a1'.repeat(16),B='b2'.repeat(16),C='c3'.repeat(16),S='d4'.repeat(16),T='e5'.repeat(16),width=64,height=48;
let backend:{executablePath:string;executableSha256:string};
const create=(resource=A,target:'primary'|'offscreen'='primary',session=S):SourceRootsPointNativeOperation=>({kind:'create',resource,session,target,programs:rootsPointCloudPrograms('native-gl41')});
const release=(resource=A):SourceRootsPointNativeOperation=>({kind:'release',resource});
const points=()=>Float32Array.of(-.4,-.2,0,.1,0,0,0,.3,.3,.2,0,.8,0,0,0,.5,.3,.2,0,1);
const frameMetadata=()=>{const m=metadata(width,height);const size=m.uniforms.find(u=>u.name==='pointSize');if(!size||size.kind!=='float')throw Error();size.values[0]=3;return m;};
function packet(r:SourceRootsPointNativeRequest){const result=encodeSourceRootsPointNativeRequest(r);if(!result.ok)throw Error(result.error.reason);return Buffer.from(result.value);}
async function owner(){
 const service=await createSourceRendererService({...backend,timeoutMs:15000});let sequence=0;
 return{service,
  async send(operation:SourceRootsPointNativeOperation,mutate?:(p:Buffer)=>Buffer){const input:SourceRootsPointNativeRequest={generation:17,sequence:++sequence,width:operation.kind==='release'?1:width,height:operation.kind==='release'?1:height,operation};const binding=captureSourceRootsPointNativeResponseBinding(input);const raw=packet(input),result=await service.render(mutate?mutate(raw):raw);return{result,input,decoded:result.ok?decodeSourceRootsPointNativeResponse(result.value.pixels,binding):undefined};},
  async ok(operation:SourceRootsPointNativeOperation){const r=await this.send(operation);expect(r.result.ok,JSON.stringify(r.result)).toBe(true);expect(r.result.value.format).toBe('roots-point-v1');expect(r.result.value.rowOrder).toBe(operation.kind==='finish'?'bottom-up':'none');expect(r.result.value.generation).toBe(17);expect(r.result.value.sequence).toBe(r.input.sequence);expect(r.result.value.rendererIdentity).toBe(service.rendererIdentity);return r;},
  async frame(resource=A,index=0,m:RootsPointFrameMetadata=frameMetadata(),ranges:Float32Array[]=[points()],chunkPoints=3){const start={kind:'begin' as const,resource,expectedDisplay:index,metadata:m,rangeCounts:ranges.filter(x=>x.length).map(x=>x.length/4),chunkPoints};const frame=sourceRootsPointNativeFrameSchedule(start);await this.ok(start);let ordinal=0;for(let rangeIndex=0;rangeIndex<ranges.length;rangeIndex++)for(let offset=0;offset<ranges[rangeIndex].length/4;offset+=chunkPoints){await this.ok({kind:'append',resource,expectedDisplay:index,ordinal:ordinal++,rangeIndex,rangeOffset:offset,points:ranges[rangeIndex].slice(offset*4,(offset+chunkPoints)*4),frame});}return this.ok({kind:'finish',resource,expectedDisplay:index,frame});},
  async close(){expect(await service.close()).toEqual({ok:true});expect(service.activeCount).toBe(0);expect(service.processCount).toBe(0);expect(service.processObservation).toBeNull();expect(service.retainedResourceCount).toBe(0);}
 };
}
const pixels=(r:Awaited<ReturnType<Awaited<ReturnType<typeof owner>>['frame']>>)=>Buffer.from(r.decoded!.pixels!);

describe.skipIf(process.platform!=='darwin')('real retained Roots point CGL service',()=>{
 beforeAll(()=>{
  if(process.env.SOURCE_ROOTS_POINT_NATIVE_BACKEND){backend=JSON.parse(readFileSync(process.env.SOURCE_ROOTS_POINT_NATIVE_BACKEND,'utf8'));expect(createHash('sha256').update(readFileSync(backend.executablePath)).digest('hex')).toBe(backend.executableSha256);return;}
  mkdirSync('.cache',{recursive:true});const root=mkdtempSync(resolve('.cache/roots-point-service-')),executablePath=join(root,'renderer');
  const build=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-Werror','-framework','Foundation','-framework','OpenGL','server/render/SourceCglRenderer.m','-o',executablePath],{encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:65536});expect(build.error).toBeUndefined();expect(build.status,build.stderr).toBe(0);expect(build.stderr).toBe('');backend={executablePath,executableSha256:createHash('sha256').update(readFileSync(executablePath)).digest('hex')};
 },30000);
 it('preserves production point order across chunk sizes, two ranges and repeated clear',async()=>{const o=await owner();try{
  const created=await o.ok(create());expect(created.decoded!.pointSizeRange[0]).toBeGreaterThan(0);expect(created.decoded!.pointSizeRange[1]).toBeGreaterThanOrEqual(1);
  const one=await o.frame(A,0,frameMetadata(),[points()],1),three=await o.frame(A,1),split=await o.frame(A,2,frameMetadata(),[points().slice(0,8),points().slice(8)],2);
  expect(pixels(one)).toEqual(pixels(three));expect(pixels(split)).toEqual(pixels(one));expect(pixels(one).some((n,i)=>i%4!==3&&n>0)).toBe(true);
  expect(one.decoded).toMatchObject({displayIndex:1,receivedPoints:5,pointDraws:5,clears:1,phase:'idle'});expect(three.decoded).toMatchObject({displayIndex:2,pointDraws:2});expect(split.decoded).toMatchObject({displayIndex:3,pointDraws:3});expect(o.service.sessionStarts).toBe(1);
 }finally{await o.close();}});
 it('isolates primary/offscreen and independent cold sessions without a global two-owner limit',async()=>{const o=await owner();try{
  await o.ok(create());await o.ok(create(B,'offscreen'));await o.ok(create(C,'primary',T));expect(o.service.retainedResourceCount).toBe(3);
  expect((await o.send(create('f6'.repeat(16)))).result).toMatchObject({ok:false,error:{kind:'ownership'}});expect((await o.send(create())).result).toMatchObject({ok:false,error:{kind:'ownership'}});expect(o.service.retainedResourceCount).toBe(3);
  const a=await o.frame(),b=await o.frame(B),c=await o.frame(C);expect(pixels(a)).toEqual(pixels(b));expect(pixels(c)).toEqual(pixels(a));
  const red={...frameMetadata(),clear:[1,0,0,.25] as const};await o.frame(B,1,red,[]);const {clear:discard,...keep}=frameMetadata();void discard;expect(pixels(await o.frame(A,1,keep,[]))).toEqual(pixels(a));
  expect((await o.ok(release(B))).decoded).toMatchObject({disposition:'released',displayIndex:2});expect((await o.ok(release(B))).decoded).toMatchObject({disposition:'absent'});expect(o.service.retainedResourceCount).toBe(2);
 }finally{await o.close();}});
 it('retains RGBA history and executes additive-alpha fade once per frame',async()=>{const o=await owner();try{
  await o.ok(create());await o.ok(create(B,'offscreen'));const base={...frameMetadata(),clear:[.2,.4,.6,.25] as const};const initial=await o.frame(A,0,base,[]),initialB=await o.frame(B,0,base,[]);expect(pixels(initial)).toEqual(pixels(initialB));expect(pixels(initial)[3]).toBe(64);
  const {clear:discard,...keep}=frameMetadata();void discard;expect(pixels(await o.frame(A,1,keep,[]))).toEqual(pixels(initial));
  const fade={...keep,fade:[.8,.2,.1,.5] as const};const changed=await o.frame(A,2,fade,[]),same=await o.frame(B,1,fade,[]);expect(pixels(changed)).toEqual(pixels(same));expect(pixels(changed)).not.toEqual(pixels(initial));/* Actual Apple CGL RGBA8 quantization, independently observed in service-r2; do not round two separately read alpha bytes. */expect(pixels(changed)[3]).toBe(191);expect(changed.decoded).toMatchObject({fadeDraws:1,clears:0,pointDraws:0});
 }finally{await o.close();}});
 it('locks only the active transaction and preserves failed partial ownership until release',async()=>{const o=await owner();try{
  await o.ok(create());await o.ok(create(B,'offscreen'));const start={kind:'begin' as const,resource:A,expectedDisplay:0,metadata:frameMetadata(),rangeCounts:[5],chunkPoints:3},frame=sourceRootsPointNativeFrameSchedule(start);await o.ok(start);
  expect((await o.send(release(B))).result).toMatchObject({ok:false,error:{kind:'ownership'}});
  const legacy=encodeSourceDrawingFrame({generation:1,sequence:500,width:1,height:1,samples:0,clear:[0,0,0,1],drawing:{model:'source-drawing-v1',textures:[],commands:[],copiedBufferBytes:0,retainedBufferBytes:0,admittedBytes:0}});if(!legacy.ok)throw Error();expect(await o.service.render(legacy.value)).toMatchObject({ok:false,error:{kind:'ownership'}});
  await o.ok({kind:'append',resource:A,expectedDisplay:0,ordinal:0,rangeIndex:0,rangeOffset:0,points:points().slice(0,12),frame});expect((await o.send({kind:'finish',resource:A,expectedDisplay:0,frame})).result).toMatchObject({ok:false,error:{kind:'input'}});expect(o.service.retainedResourceCount).toBe(2);
  expect((await o.ok(release())).decoded).toMatchObject({disposition:'released',receivedPoints:3,pointDraws:1});expect((await o.send({kind:'finish',resource:A,expectedDisplay:0,frame})).result).toMatchObject({ok:false,error:{kind:'state-lost'}});await o.frame(B);expect(o.service.sessionStarts).toBe(1);
 }finally{await o.close();}});
 it('preserves nonfinite XYZ transport and rejects raw malformed metric before dispatch',async()=>{const o=await owner();try{
  await o.ok(create());const start={kind:'begin' as const,resource:A,expectedDisplay:0,metadata:frameMetadata(),rangeCounts:[1],chunkPoints:1},frame=sourceRootsPointNativeFrameSchedule(start);await o.ok(start);const p=new Float32Array(4);new Uint32Array(p.buffer).set([0x7fc01234,0x7f800000,0x80000000,0x80000000]);const append={kind:'append' as const,resource:A,expectedDisplay:0,ordinal:0,rangeIndex:0,rangeOffset:0,points:p,frame};
  expect((await o.send(append,bytes=>{bytes.writeUInt32LE(0x7fc01234,124);return bytes;})).result).toMatchObject({ok:false,error:{kind:'input'}});await o.ok(append);const final=await o.ok({kind:'finish',resource:A,expectedDisplay:0,frame});expect(final.decoded).toMatchObject({receivedPoints:1,pointDraws:1});expect(o.service.sessionStarts).toBe(1);
 }finally{await o.close();}});
 it('confirms service retirement after actual compile failure and recovers in a new owned session',async()=>{const o=await owner();try{
  await o.ok(create());const bad=create(B,'offscreen');if(bad.kind!=='create')throw Error();bad.programs={...bad.programs,point:{...bad.programs.point,fragment:'#version 410 core\nthis is deliberately invalid GLSL;'}};expect((await o.send(bad)).result).toMatchObject({ok:false,error:{kind:'runtime',gpuStage:'compile'}});expect(o.service.processCount).toBe(0);expect(o.service.retainedResourceCount).toBe(0);
  await o.ok(create());await o.frame();expect(o.service.sessionStarts).toBe(2);await o.ok(release());
 }finally{await o.close();}});
 it('rejects actual-capability footprint overflow and permits exact cleanup',async()=>{const o=await owner();try{
  const created=await o.ok(create()),m=frameMetadata(),size=m.uniforms.find(u=>u.name==='pointSize');if(!size||size.kind!=='float')throw Error();size.values[0]=created.decoded!.pointSizeRange[1];expect((await o.send({kind:'begin',resource:A,expectedDisplay:0,metadata:m,rangeCounts:[65536],chunkPoints:65536})).result).toMatchObject({ok:false,error:{kind:'capacity'}});await o.ok(release());expect(o.service.retainedResourceCount).toBe(0);
 }finally{await o.close();}});
 it('binds real native finish to the HTTP page lease and preserves RGBA alpha',async()=>{
  const root=mkdtempSync(resolve('.cache/roots-point-http-')),s=await createExportServer({root,sourceRendererBackend:backend}),address=await s.listen(0),url=`http://127.0.0.1:${address.port}`,lease='f7'.repeat(16),controller=new AbortController();let sequence=0;
  const post=(operation:SourceRootsPointNativeOperation,token?:string)=>fetch(url+'/api/source-renderer/frames',{method:'POST',headers:{'content-type':'application/octet-stream',...(token?{'x-source-lease':token}:{})},body:packet({generation:73,sequence:++sequence,width:operation.kind==='release'?1:width,height:operation.kind==='release'?1:height,operation}) as Uint8Array<ArrayBuffer>});
  try{expect((await post(create())).status).toBe(409);expect(s.ownedProcessCount).toBe(0);const connection=await fetch(url+'/api/source-renderer/lease/'+lease,{signal:controller.signal}),reader=connection.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toBe('READY\n');
   expect((await post(create(),lease)).status).toBe(200);const start={kind:'begin' as const,resource:A,expectedDisplay:0,metadata:{...frameMetadata(),clear:[0,0,0,.25] as const},rangeCounts:[],chunkPoints:1};expect((await post(start,lease)).status).toBe(200);const result=await post({kind:'finish',resource:A,expectedDisplay:0,frame:sourceRootsPointNativeFrameSchedule(start)},lease);expect(result.status).toBe(200);expect(result.headers.get('x-source-format')).toBe('roots-point-v1');expect(result.headers.get('x-source-generation')).toBe('73');expect(result.headers.get('x-source-row-order')).toBe('bottom-up');const raw=new Uint8Array(await result.arrayBuffer());expect(raw.length).toBe(96+width*height*4);expect(raw[99]).toBe(64);expect((await post(release(),lease)).status).toBe(200);await reader.cancel();reader.releaseLock();
  }finally{controller.abort();await s.close();expect(s.ownedProcessCount).toBe(0);}
 });
});
