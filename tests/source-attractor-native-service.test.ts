import {it,expect,beforeAll,afterAll} from 'vitest';
import {mkdtempSync,writeFileSync,chmodSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {create,upload,request,packet,resource,checkpoint,display} from './source-attractor-native-fixture';
import {encodeSourceNativeDrawingRequest} from '../src/engine/sourceDrawingNativeProtocol';
// @ts-expect-error Node gateway is a separate runtime.
import {createSourceRendererService} from '../server/source-renderer.mjs';
// @ts-expect-error Loopback HTTP runtime is intentionally outside browser types.
import {createExportServer} from '../server/index.mjs';
let root:string;beforeAll(()=>{root=mkdtempSync(resolve('.cache/attractor-service-'));});afterAll(()=>rmSync(root,{recursive:true,force:true}));
/** Real bounded child-process/service transport; no GL, shader execution or
 * renderer fidelity is claimed by this controlled ACK fixture. */
function fixture(mode='normal'){
 const executablePath=join(root,'pipe-'+crypto.randomUUID()),source=`#!${process.execPath}
let input=Buffer.alloc(0);const owners=new Map(),mode=${JSON.stringify(mode)};
function run(b){const u=o=>b.readUInt32LE(o),version=u(4),kind=u(64);let payload,format=8;
if(version===14){const id=b.subarray(72,88).toString('hex');let r=owners.get(id);if(kind===1){r={pass:0,render:0,uploaded:0,count:u(88),side:u(92),width:0,height:0,aw:0,ah:0,rendered:0};owners.set(id,r);}if(kind===2)r.uploaded=u(108)+u(112)/16;if(kind===3)r.pass++;if(kind===4){r.render++;r.width=u(20);r.height=u(24);r.aw=u(108);r.ah=u(112);r.rendered=r.pass;}
payload=Buffer.alloc(96+(kind===4?u(20)*u(24)*4:kind===5?u(116)*16:0));const w=(o,n)=>payload.writeUInt32LE(n,o);w(0,6);w(4,kind);b.copy(payload,8,72,88);if(r){[r.pass,r.render,r.uploaded,r.count,r.side,kind===6?1:0,r.width,r.height,r.aw,r.ah,r.rendered].forEach((n,i)=>w(24+i*4,n));}else w(44,2);if(kind===5){w(68,u(108));w(72,u(112));w(76,u(116));}if(mode==='wrong-pass'&&kind===3)w(24,r.pass+1);if(kind===6)owners.delete(id);
}else{format=2;payload=Buffer.alloc(4);}const h=Buffer.alloc(44);[0x31524c4d,1,44+payload.length,u(12),u(16),u(20),u(24),0,format,payload.length,1].forEach((n,i)=>h.writeUInt32LE(n,i*4));process.stdout.write(Buffer.concat([h,payload]));}
process.stdin.on('data',b=>{input=Buffer.concat([input,b]);while(input.length>=12&&input.length>=input.readUInt32LE(8)){const n=input.readUInt32LE(8),frame=input.subarray(0,n);input=input.subarray(n);run(frame);}});
`;
 writeFileSync(executablePath,source);chmodSync(executablePath,0o755);return{executablePath,executableSha256:createHash('sha256').update(source).digest('hex')};
}
const pass=(index=0,renderIndex=0)=>request({kind:'pass',resource,...checkpoint,expectedIndex:index,expectedRenderIndex:renderIndex,pass:{steps:1,warmup:false,warmupBase:0,currentStepBase:0,staggerMin:0,staggerRange:0}});
it('keeps actual upload/pass/render checkpoints and rejects stale accumulation without mutating owner',async()=>{const s=await createSourceRendererService(fixture());let seq=0;const send=(r:ReturnType<typeof request>)=>s.render(packet({...r,sequence:++seq}));try{
 expect(await send(create())).toMatchObject({ok:true});expect(await send(pass())).toMatchObject({ok:false,error:{kind:'input'}});
 expect(await send(upload(0,5))).toMatchObject({ok:true});expect(await send(upload(5,4))).toMatchObject({ok:true});expect(await send(pass())).toMatchObject({ok:true});
 expect(await send(request({kind:'render',resource,...checkpoint,expectedIndex:1,display:display()}))).toMatchObject({ok:true,value:{format:'attractor-v1',rowOrder:'bottom-up'}});
 expect(await send(request({kind:'read',resource,...checkpoint,expectedIndex:1,expectedRenderIndex:1,target:'accumulation',offset:8,count:1}))).toMatchObject({ok:true});
 expect(await send(pass(1,1))).toMatchObject({ok:true});expect(await send(request({kind:'read',resource,...checkpoint,expectedIndex:2,expectedRenderIndex:1,target:'accumulation',offset:0,count:1}))).toMatchObject({ok:false,error:{kind:'input'}});
 expect(await send(request({kind:'read',resource,...checkpoint,expectedIndex:2,expectedRenderIndex:1,target:'state',offset:5,count:4}))).toMatchObject({ok:true});expect(s.retainedResourceCount).toBe(1);
 expect(await send(request({kind:'release',resource}))).toMatchObject({ok:true});expect(s.retainedResourceCount).toBe(0);
 }finally{await s.close();expect(s.processCount).toBe(0);}});
it('allows two Attractor owners and other retained families while preserving v13 exclusivity',async()=>{const s=await createSourceRendererService(fixture());try{
 const bouncing=Buffer.alloc(84);[0x31464c4d,4,84,1,1,1,1].forEach((n,i)=>bouncing.writeUInt32LE(n,i*4));bouncing.writeUInt32LE(1,60);bouncing.writeUInt32LE(16,64);Buffer.from('ab'.repeat(16),'hex').copy(bouncing,68);
 expect(await s.render(bouncing)).toMatchObject({ok:true});expect(await s.render(packet({...create(),sequence:2}))).toMatchObject({ok:true});expect(await s.render(packet({...create('34'.repeat(16)),sequence:3}))).toMatchObject({ok:true});expect(s.retainedResourceCount).toBe(3);
 expect(await s.render(packet({...create('56'.repeat(16)),sequence:4}))).toMatchObject({ok:false,error:{kind:'capacity'}});
 const drawing=encodeSourceNativeDrawingRequest({generation:1,sequence:5,width:1,height:1,samples:0,clear:[0,0,0,1],operation:{kind:'begin',resource:'78'.repeat(16),chunkCount:0,maxChunkBytes:1024,metadataBytes:0,schedule:[]}});if(!drawing.ok)throw Error(drawing.error.reason);expect(await s.render(drawing.value)).toMatchObject({ok:false,error:{kind:'ownership'}});expect(s.retainedResourceCount).toBe(3);
 }finally{await s.close();expect(s.processCount).toBe(0);}});
it('does not send mismatched ownership/negative-overflow work to the native child',async()=>{const s=await createSourceRendererService(fixture());try{expect(await s.render(packet(create()))).toMatchObject({ok:true});expect(await s.render(packet({...upload(),sequence:2}))).toMatchObject({ok:true});const r=pass();r.sequence=3;if(r.operation.kind!=='pass')throw Error();r.operation.pass={...r.operation.pass,steps:2147483647};expect(await s.render(packet(r))).toMatchObject({ok:false,error:{kind:'capacity'}});r.operation.pass={...r.operation.pass,steps:-2147483648};expect(await s.render(packet(r))).toMatchObject({ok:true});expect(s.retainedResourceCount).toBe(1);}finally{await s.close();expect(s.processCount).toBe(0);}});
it('retires its actual child on a forged native ACK and releases resource bookkeeping',async()=>{const s=await createSourceRendererService(fixture('wrong-pass'));try{expect(await s.render(packet(create()))).toMatchObject({ok:true});expect(await s.render(packet({...upload(),sequence:2}))).toMatchObject({ok:true});expect(await s.render(packet({...pass(),sequence:3}))).toMatchObject({ok:false,error:{kind:'protocol'}});expect(s.processCount).toBe(0);expect(s.retainedResourceCount).toBe(0);}finally{await s.close();}});
it('binds v14 resources to the actual HTTP page lease and preserves caller response identity',async()=>{
 const s=await createExportServer({root:join(root,'exports'),sourceRendererBackend:fixture()}),address=await s.listen(0),url=`http://127.0.0.1:${address.port}`,token='cd'.repeat(16),controller=new AbortController();
 const post=(r:ReturnType<typeof request>,lease?:string)=>fetch(url+'/api/source-renderer/frames',{method:'POST',headers:{'content-type':'application/octet-stream',...(lease?{'x-source-lease':lease}:{})},body:packet(r) as Uint8Array<ArrayBuffer>});
 try{
  expect((await post(create())).status).toBe(409);expect(s.ownedProcessCount).toBe(0);
  const connection=await fetch(url+'/api/source-renderer/lease/'+token,{signal:controller.signal}),reader=connection.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toBe('READY\n');
  expect((await post(create(),'ef'.repeat(16))).status).toBe(409);const created=await post({...create(),generation:17,sequence:91},token);expect(created.status).toBe(200);expect(created.headers.get('x-source-generation')).toBe('17');expect(created.headers.get('x-source-sequence')).toBe('91');expect(created.headers.get('x-source-format')).toBe('attractor-v1');expect((await created.arrayBuffer()).byteLength).toBe(96);
  expect((await post(upload(),token)).status).toBe(200);const rendered=await post(request({kind:'render',resource,...checkpoint,display:display()}),token);expect(rendered.status).toBe(200);expect(rendered.headers.get('x-source-row-order')).toBe('bottom-up');expect((await rendered.arrayBuffer()).byteLength).toBe(112);
  const released=await post(request({kind:'release',resource}),token);expect(released.status).toBe(200);expect(new DataView(await released.arrayBuffer()).getUint32(44,true)).toBe(1);await reader.cancel();reader.releaseLock();
 }finally{controller.abort();await s.close();expect(s.ownedProcessCount).toBe(0);}
});
