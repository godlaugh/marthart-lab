import {it,expect,afterAll,beforeAll,vi} from 'vitest';
import {mkdtempSync,writeFileSync,chmodSync,rmSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {encodeSourceNativeDrawingRequest,type SourceNativeDrawingRequest} from '../src/engine/sourceDrawingNativeProtocol';
import {encodeSourceDrawingFrame} from '../src/engine/sourceDrawingFrame';
import {SOURCE_DRAWING_MAX_CHUNK_BYTES} from '../src/engine/sourceDrawingBudget';
// @ts-expect-error The Node gateway is deliberately outside browser typechecking.
import {createSourceRendererService} from '../server/source-renderer.mjs';
// @ts-expect-error The loopback server is a separate runtime.
import {createExportServer} from '../server/index.mjs';
let root:string;beforeAll(()=>{root=mkdtempSync(resolve('.cache/drawing-service-'));});afterAll(()=>rmSync(root,{recursive:true,force:true}));
const token='12'.repeat(16),other='34'.repeat(16);
const request=(operation:SourceNativeDrawingRequest['operation'],sequence=1):SourceNativeDrawingRequest=>({generation:1,sequence,width:1,height:1,samples:0,clear:[0,0,0,1],operation});
const begin=(resource=token)=>request({kind:'begin',resource,chunkCount:0,maxChunkBytes:4096,metadataBytes:0,schedule:[]});
const packet=(r:SourceNativeDrawingRequest)=>{const p=encodeSourceNativeDrawingRequest(r);if(!p.ok)throw Error(p.error.reason);return Buffer.from(p.value);};
function fixture(mode='normal',marker=''){
 const executablePath=join(root,'child-'+crypto.randomUUID());
 // Only controlled pipe responses: this fixture executes no GL or shaders.
 const source=`#!${process.execPath}
import fs from 'node:fs';
let input=Buffer.alloc(0),state;const mode=${JSON.stringify(mode)};
if(mode==='slow-stop')process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),500));
function run(b){let format,payload;const v=b.readUInt32LE(4),kind=b.readUInt32LE(64);if(mode==='slow-stop'&&v===13&&kind===1){fs.writeFileSync(${JSON.stringify(marker)},'received');return;}if(v===13){const resource=b.subarray(72,88);if(kind===1)state={resource,index:0,chunks:b.readUInt32LE(92),finished:0};if(kind===2)state.index++;if(kind===3)state.finished=1;payload=Buffer.alloc(64+(kind===3?4:0));[5,kind].forEach((n,i)=>payload.writeUInt32LE(n,i*4));resource.copy(payload,8);[state?.index??0,kind===4?(state?1:2):0,1,1,state?.chunks??0,state?.finished??0].forEach((n,i)=>payload.writeUInt32LE(n,24+i*4));if(kind===3&&mode==='wrong-count')payload.writeUInt32LE(1,40);if(kind===4)state=undefined;format=7;}else if(v===4){format=2;payload=Buffer.alloc(4);}else{format=1;payload=Buffer.alloc(4);}const h=Buffer.alloc(44);[0x31524c4d,1,44+payload.length,b.readUInt32LE(12),b.readUInt32LE(16),1,1,0,format,payload.length,1].forEach((n,i)=>h.writeUInt32LE(n,i*4));process.stdout.write(Buffer.concat([h,payload]));}
process.stdin.on('data',chunk=>{input=Buffer.concat([input,chunk]);while(input.length>=12&&input.length>=input.readUInt32LE(8)){const n=input.readUInt32LE(8),b=input.subarray(0,n);input=input.subarray(n);run(b);}});
`;
 writeFileSync(executablePath,source);chmodSync(executablePath,0o755);return{executablePath,executableSha256:createHash('sha256').update(source).digest('hex')};
}
const legacy=()=>{const p=encodeSourceDrawingFrame({generation:1,sequence:3,width:1,height:1,samples:0,clear:[0,0,0,1],drawing:{model:'source-drawing-v1',textures:[],commands:[],copiedBufferBytes:0,retainedBufferBytes:0,admittedBytes:0}});if(!p.ok)throw Error();return Buffer.from(p.value);};
it('owns a complete frame through finish, rejects foreign operations, then releases exactly that resource',async()=>{const s=await createSourceRendererService(fixture());try{
 expect(await s.render(packet(begin()))).toMatchObject({ok:true});expect(s.retainedResourceCount).toBe(1);
 for(const p of [packet(begin(other)),legacy(),packet(request({kind:'release',resource:other,expectedIndex:0},4))])expect(await s.render(p)).toMatchObject({ok:false,error:{kind:'ownership'}});
 expect(s.retainedResourceCount).toBe(1);expect(s.processCount).toBe(1);
 expect(await s.render(packet(request({kind:'finish',resource:token,expectedIndex:0},5)))).toMatchObject({ok:true,value:{format:'drawing-v1'}});expect(s.retainedResourceCount).toBe(1);
 expect(await s.render(packet(request({kind:'release',resource:token,expectedIndex:0},6)))).toMatchObject({ok:true});expect(s.retainedResourceCount).toBe(0);
 }finally{expect(await s.close()).toMatchObject({ok:true});expect(s.processCount).toBe(0);}});
it('rejects begin before touching another retained family',async()=>{const s=await createSourceRendererService(fixture());try{const b=Buffer.alloc(84);[0x31464c4d,4,84,1,1,1,1].forEach((n,i)=>b.writeUInt32LE(n,i*4));b.writeUInt32LE(1,60);b.writeUInt32LE(16,64);Buffer.from(other,'hex').copy(b,68);expect(await s.render(b)).toMatchObject({ok:true});expect(await s.render(packet({...begin(),sequence:2}))).toMatchObject({ok:false,error:{kind:'ownership'}});expect(s.retainedResource).toBe(other);expect(s.processCount).toBe(1);}finally{await s.close();expect(s.processCount).toBe(0);}});
it('retires the owned child on a forged finish total and keeps no published pixels',async()=>{const s=await createSourceRendererService(fixture('wrong-count'));try{expect(await s.render(packet(begin()))).toMatchObject({ok:true});expect(await s.render(packet(request({kind:'finish',resource:token,expectedIndex:0},2)))).toMatchObject({ok:false,error:{kind:'protocol'}});expect(s.processCount).toBe(0);expect(s.retainedResourceCount).toBe(0);}finally{await s.close();}});
it('a bad same-resource checkpoint poisons publication but retains release authority',async()=>{const s=await createSourceRendererService(fixture());try{expect(await s.render(packet(begin()))).toMatchObject({ok:true});expect(await s.render(packet(request({kind:'finish',resource:token,expectedIndex:1},2)))).toMatchObject({ok:false,error:{kind:'input'}});expect(await s.render(packet(request({kind:'finish',resource:token,expectedIndex:0},3)))).toMatchObject({ok:false,error:{kind:'input'}});expect(s.retainedResourceCount).toBe(1);expect(await s.render(packet(request({kind:'release',resource:token,expectedIndex:0},4)))).toMatchObject({ok:true});expect(s.retainedResourceCount).toBe(0);}finally{await s.close();expect(s.processCount).toBe(0);}});
it('requires the actual page lease and rejects cross-page takeover without disturbing the first frame',async()=>{
 const s=await createExportServer({root:join(root,'exports'),sourceRendererBackend:fixture()}),address=await s.listen(0),url=`http://127.0.0.1:${address.port}`,lease='ab'.repeat(16),foreign='cd'.repeat(16),controller=new AbortController();
 const post=(r:SourceNativeDrawingRequest,owner?:string)=>fetch(url+'/api/source-renderer/frames',{method:'POST',headers:{'content-type':'application/octet-stream',...(owner?{'x-source-lease':owner}:{})},body:packet(r)});
 const start=request({kind:'begin',resource:token,chunkCount:1,maxChunkBytes:SOURCE_DRAWING_MAX_CHUNK_BYTES,metadataBytes:4096,schedule:[{commandIndex:0,primitive:'triangles',rangeKind:'draw',total:1,passes:['both'],chunksPerPass:1,rangeSize:1}]}),values=new Float32Array(512*1024);
 const append=request({kind:'append',resource:token,chunk:{ordinal:0,commandIndex:0,passIndex:0,rangeKind:'draw',offset:0,count:1,total:1,drawing:{model:'source-drawing-v1',textures:[],copiedBufferBytes:values.byteLength,retainedBufferBytes:values.byteLength,admittedBytes:values.byteLength+4096,commands:[{primitive:'triangles',vertexShader:'in vec2 position;void main(){gl_Position=vec4(position,0,1);}',fragmentShader:'out vec4 color;void main(){color=vec4(1);}',first:0,count:3,instances:1,attributes:[{name:'position',size:2,divisor:0,values}],uniforms:[],depthTest:false,depthWrite:false,depthFunction:'less-equal',frontFace:'counter-clockwise',passes:['both'],blend:'source-alpha-over'}]}}},2);
 try{
  expect((await post(begin())).status).toBe(409);expect(s.ownedProcessCount).toBe(0);
  const leaseResponse=await fetch(url+'/api/source-renderer/lease/'+lease,{signal:controller.signal}),reader=leaseResponse.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toBe('READY\n');
  expect((await post(start,lease)).status).toBe(200);
  expect((await fetch(url+'/api/source-renderer/lease/'+foreign)).status).toBe(429);expect((await post(begin(other),foreign)).status).toBe(409);expect((await post(begin(other),lease)).status).toBe(409);expect(s.ownedProcessCount).toBe(1);
  expect(packet(append).length).toBeGreaterThan(1024*1024);expect((await post(append,lease)).status).toBe(200);
  expect((await post(request({kind:'finish',resource:token,expectedIndex:1},3),lease)).status).toBe(200);expect((await post(request({kind:'release',resource:token,expectedIndex:1},4),lease)).status).toBe(200);await reader.cancel();reader.releaseLock();
 }finally{controller.abort();await s.close();expect(s.ownedProcessCount).toBe(0);}
});
it('marks only the gateway busy interval retryable while a cancelled child exits, then confirms absence',async()=>{
 const marker=join(root,'slow-stop-marker'),s=await createExportServer({root:join(root,'slow-stop-exports'),sourceRendererBackend:{...fixture('slow-stop',marker),killGraceMs:1000,cleanupMs:3000}}),address=await s.listen(0),url=`http://127.0.0.1:${address.port}`,lease='ef'.repeat(16),connection=new AbortController(),draw=new AbortController();
 const post=(r:SourceNativeDrawingRequest,signal?:AbortSignal)=>fetch(url+'/api/source-renderer/frames',{method:'POST',headers:{'content-type':'application/octet-stream','x-source-lease':lease},body:packet(r),signal});
 try{
  const leaseResponse=await fetch(url+'/api/source-renderer/lease/'+lease,{signal:connection.signal}),reader=leaseResponse.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toBe('READY\n');
  const pending=post(begin(),draw.signal).then(()=>undefined,error=>error);
  await vi.waitFor(()=>expect(existsSync(marker)).toBe(true),{timeout:3000,interval:5});expect(s.ownedProcessCount).toBe(1);draw.abort();expect(await pending).toMatchObject({name:'AbortError'});
  const release=request({kind:'release',resource:token,expectedIndex:0},2),busy=await post(release);expect(busy.status).toBe(429);expect(await busy.json()).toMatchObject({kind:'capacity',retryable:true});
  let response:Response|undefined;await vi.waitFor(async()=>{response=await post(release);if(response.status===429)expect(await response.json()).toMatchObject({kind:'capacity',retryable:true});expect(response.status).toBe(200);},{timeout:3000,interval:25});
  const ack=new DataView(await response!.arrayBuffer());expect(ack.getUint32(24,true)).toBe(0);expect(ack.getUint32(28,true)).toBe(2);expect(ack.getUint32(40,true)).toBe(0);await reader.cancel();reader.releaseLock();
 }finally{draw.abort();connection.abort();await s.close();expect(s.ownedProcessCount).toBe(0);}
});
