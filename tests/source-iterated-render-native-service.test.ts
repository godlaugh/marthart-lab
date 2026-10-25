import {afterAll,beforeAll,describe,expect,it,vi,type MockInstance} from 'vitest';
import {ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {encodeSourceIteratedNativeRequest,type SourceIteratedNativeOperation} from '../src/engine/sourceIteratedNativeProtocol';
import {encodeSourceIteratedRenderNativeRequest,decodeSourceIteratedRenderNativeResponse,type SourceIteratedRenderNativeOperation,type SourceIteratedRenderNativePrograms} from '../src/engine/sourceIteratedRenderNativeProtocol';
// @ts-expect-error The owned Node pipe service is separate from browser contracts.
import {createSourceRendererService} from '../server/source-renderer.mjs';
// @ts-expect-error The Node HTTP adapter is separate from browser contracts.
import {createExportServer} from '../server/index.mjs';

// Sealed CPU children exercise the production codec and actual supervised pipes.
// Their controlled replies prove gateway ownership/protocol behavior, not GL or
// shader correctness. All inputs are synthetic and independent of private scenes.
const token='12'.repeat(16),other='34'.repeat(16),count=6;
const shaders={vertex:'#version 410 core\nvoid main(){gl_Position=vec4(0);}',fragment:'#version 410 core\nout vec4 color;void main(){color=vec4(1);}'};
const programs=Object.fromEntries(['draw','statsFirst','statsReduce','present','presentReduce','decay'].map(k=>[k,shaders])) as SourceIteratedRenderNativePrograms;
const checkpoint={resource:token,stateResource:token,expectedIndex:1,expectedDisplays:0,expectedCount:count};
const create=():SourceIteratedRenderNativeOperation=>({...checkpoint,kind:'create',expectedDisplays:0,programs});
const draw=(record=true):SourceIteratedRenderNativeOperation=>({...checkpoint,kind:'draw',clear:true,record,decay:0.5,plan:{primitive:'points',palette:{key:'synthetic',format:'source-rgb1024',values:new Float32Array(3072)},noise:new Uint8Array(256),drawUniforms:[],statsUniforms:[]}});
const replace=():SourceIteratedRenderNativeOperation=>({...checkpoint,kind:'replace-programs',expectedDisplays:1,programs});
const present=():SourceIteratedRenderNativeOperation=>({...checkpoint,kind:'present',expectedDisplays:1,plan:{filter:'nearest',clear:[0,0,0,1],uniforms:[]}});
const release=(resource=token):SourceIteratedRenderNativeOperation=>({kind:'release',resource});
const stateCreate=():SourceIteratedNativeOperation=>({kind:'create',resource:token,count,...shaders});
const advance=(expectedIndex=0):Extract<SourceIteratedNativeOperation,{kind:'advance'}>=>({kind:'advance',resource:token,expectedCount:count,expectedIndex,reset:false,resetCounter:true,dimension:2,steps:3,uniforms:[]});
const stateRelease=():SourceIteratedNativeOperation=>({kind:'release',resource:token,expectedCount:count});
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
let root:string,serial=0;
beforeAll(()=>{mkdirSync('.cache',{recursive:true});root=mkdtempSync(resolve('.cache/iterated-render-service-'));});
afterAll(()=>rmSync(root,{recursive:true,force:true}));
function packet(operation:SourceIteratedRenderNativeOperation,sequence=1){
 const request={generation:7,sequence,width:operation.kind==='release'?1:3,height:operation.kind==='release'?1:2,operation};
 const encoded=encodeSourceIteratedRenderNativeRequest(request);if(!encoded.ok)throw Error(encoded.error.reason);return{request,packet:Buffer.from(encoded.value)};
}
function computePacket(operation:SourceIteratedNativeOperation,sequence=1){const encoded=encodeSourceIteratedNativeRequest({generation:7,sequence,operation});if(!encoded.ok)throw Error(encoded.error.reason);return Buffer.from(encoded.value);}
async function fixture(mode='normal',cleanupMs=500){
 const executablePath=join(root,'child-'+(++serial)),received=executablePath+'.received';
 const source=`#!${process.execPath}
import {writeFileSync} from 'node:fs';
const mode=${JSON.stringify(mode)},states=new Map(),inks=new Map();let input=Buffer.alloc(0);
function handle(b){
 const family=b.readUInt32LE(60),kind=b.readUInt32LE(64),resource=b.subarray(72,88),key=resource.toString('hex'),fragment=b.readUInt32LE(4)===10,shift=fragment?8:0;
 writeFileSync(${JSON.stringify(received)},String(b.readUInt32LE(16)));
 if(family===3&&(kind===2&&mode==='hang'||kind===5&&mode==='replace-hang'))return;
 let payload,status=0,format=family===3?5:4;
 if(family===2){
  let state=states.get(key);if(kind===1){state={index:0,uploaded:0,count:b.readUInt32LE(88)};states.set(key,state);}
  if(kind===2&&state)state.uploaded=b.readUInt32LE(92)+b.readUInt32LE(96)/16;
  if(kind===3&&state)state.index++;
  payload=Buffer.alloc(64);payload.writeUInt32LE(2,0);payload.writeUInt32LE(kind,4);resource.copy(payload,8);
  if(state){payload.writeUInt32LE(state.index,24);payload.writeUInt32LE(state.uploaded,32);payload.writeUInt32LE(state.count,36);}
  if(kind===3)payload.writeUInt32LE(b.readUInt32LE(b.readUInt32LE(4)===7?104:100),48);
  if(kind===5){if([...inks.values()].some(i=>i.state.equals(resource))&&mode!=='illegal-state-release'){status=6;payload=Buffer.from('release inks first');}else{payload.writeUInt32LE(state?1:2,28);states.delete(key);}}
  if(kind===3&&inks.size&&mode==='runtime-compute'){status=4;payload=Buffer.from('context failed with owned ink');}
 }else{
  let ink=inks.get(key);
  if(kind===1){ink={state:Buffer.from(b.subarray(92+shift,108+shift)),index:b.readUInt32LE(108+shift),displays:0,count:b.readUInt32LE(116+shift),width:b.readUInt32LE(20),height:b.readUInt32LE(24),fragment};inks.set(key,ink);}
  if(kind===2&&ink){ink.index=b.readUInt32LE(108+shift);ink.displays++;}
  payload=Buffer.alloc(128+(kind===3?ink.width*ink.height*4:0));payload.writeUInt32LE(3,0);payload.writeUInt32LE(kind,4);resource.copy(payload,8);
  if(ink){ink.state.copy(payload,24);[ink.index,ink.displays,0,ink.count,ink.width,ink.height].forEach((n,i)=>payload.writeUInt32LE(n,40+i*4));}
  if(fragment){payload.writeUInt32LE(1,100);if(ink){payload.writeUInt32LE(1,92);payload.writeUInt32LE(1,96);}}
  if(kind===2){payload.writeUInt32LE(2,64);payload.writeUInt32LE(1,68);payload.writeUInt32LE(3,72);payload.writeUInt32LE(1,76);payload.writeUInt32LE(b.readUInt32LE(124+shift)?2:0,80);}
  if(kind===3){payload.writeUInt32LE(2,84);payload.writeFloatLE(3.5,88);for(let i=128;i<payload.length;i++)payload[i]=i-128;}
  if(kind===4){payload.writeUInt32LE(ink?1:2,48);inks.delete(key);}
  if(kind===1&&mode==='create-facts')payload.writeUInt32LE(1,64);
  if(kind===2){
   const offsets={family:0,kind:4,index:40,displays:44,disposition:48,count:52,width:56,height:60,reserved:92};
   if(mode in offsets)payload.writeUInt32LE(payload.readUInt32LE(offsets[mode])+1,offsets[mode]);
   if(mode==='resource')payload[8]^=1;if(mode==='state')payload[24]^=1;
   if(mode==='unsafe-invalid')payload.writeUInt32LE(0x200000,68);
   if(mode==='coverage')payload.writeUInt32LE(4,80);
   if(mode==='over-count')payload.writeUInt32LE(ink.count,72);
   if(mode==='unmeasured-present')payload.writeUInt32LE(1,84);
   if(mode==='record-false')payload.writeUInt32LE(1,80);
   if(mode==='outer-format')format=4;
   if(mode==='fragment-unit')payload.writeUInt32LE(0,92);if(mode==='fragment-profile')payload.writeUInt32LE(0,96);if(mode==='fragment-marker')payload.writeUInt32LE(0,100);if(mode==='fragment-reserved')payload.writeUInt32LE(1,104);
   if(mode==='extra')payload=Buffer.concat([payload,Buffer.from([1])]);
   if(mode==='runtime-ink'){status=4;payload=Buffer.from('cleanup unconfirmed');}
  }
  if(kind===3){
   if(mode==='occupied')payload.writeUInt32LE(ink.width*ink.height+1,84);
   if(mode==='max-count')payload.writeFloatLE(NaN,88);
   if(mode==='present-facts')payload.writeUInt32LE(1,64);
   if(mode==='input-error'){status=1;payload=Buffer.from('synthetic malformed present');}
  }
  if(kind===5){
   if(mode==='replace-facts')payload.writeUInt32LE(1,64);
   if(mode==='replace-displays')payload.writeUInt32LE(ink.displays+1,44);
   if(mode==='replace-index')payload.writeUInt32LE(ink.index+1,40);
   if(mode==='replace-extra')payload=Buffer.concat([payload,Buffer.from([1])]);
   if(mode==='replace-input'){status=1;payload=Buffer.from('candidate compile rejected; cleanup succeeded');}
   if(mode==='replace-runtime'){status=4;payload=Buffer.from('candidate cleanup failed');}
  }
  if(kind===4){if(mode==='fragment-absent-unit'&&!ink)payload.writeUInt32LE(1,92);if(mode==='release-checkpoint'&&ink)payload.writeUInt32LE(ink.index+1,40);if(mode==='release-state'&&ink)payload[24]^=1;if(mode==='absent-dirty'&&!ink)payload.writeUInt32LE(1,52);}
 }
 if(status)format=0;
 const h=Buffer.alloc(44);[0x31524c4d,1,44+payload.length,b.readUInt32LE(12),b.readUInt32LE(16),b.readUInt32LE(20),b.readUInt32LE(24),status,format,payload.length,1].forEach((n,i)=>h.writeUInt32LE(n,i*4));
 if(family===3&&kind===2&&mode==='outer-size')h.writeUInt32LE(4,20);
 const output=Buffer.concat([h,payload]);if(mode==='fragment'){process.stdout.write(output.subarray(0,17));setImmediate(()=>{process.stdout.write(output.subarray(17,49));setImmediate(()=>process.stdout.write(output.subarray(49)));});}else process.stdout.write(output);
}
process.stdin.on('data',chunk=>{input=Buffer.concat([input,chunk]);while(input.length>=12&&input.length>=input.readUInt32LE(8)){const n=input.readUInt32LE(8),b=input.subarray(0,n);input=input.subarray(n);handle(b);}});
`;
 writeFileSync(executablePath,source);chmodSync(executablePath,0o755);
 const backend={executablePath,executableSha256:createHash('sha256').update(source).digest('hex'),timeoutMs:5000,killGraceMs:5,cleanupMs};
 const service=await createSourceRendererService(backend);let sequence=0;
 return{service,backend,send:(op:SourceIteratedRenderNativeOperation,signal?:AbortSignal)=>{const input=packet(op,++sequence);return service.render(input.packet,{signal});},compute:(op:SourceIteratedNativeOperation)=>service.render(computePacket(op,++sequence)),ready:async()=>{for(let i=0;i<500;i++){if(existsSync(received)&&readFileSync(received,'utf8')===String(sequence))return;await delay(5);}throw Error('Owned CPU child did not receive request');},close:async()=>{expect(await service.close()).toMatchObject({ok:true});expect(service.processCount).toBe(0);expect(service.activeCount).toBe(0);expect(service.retainedResourceCount).toBe(0);}};
}
async function initialized(mode='normal',cleanupMs=500,withInk=true){
 const f=await fixture(mode,cleanupMs);try{
  const upload:SourceIteratedNativeOperation={kind:'upload',resource:token,expectedIndex:0,expectedCount:count,offset:0,positionsAndMetric:new Float32Array(count*4)};
  for(const op of [stateCreate(),upload,advance()])expect(await f.compute(op)).toMatchObject({ok:true});
  if(withInk)expect(await f.send(create())).toMatchObject({ok:true});return f;
 }catch(e){await f.close();throw e;}
}

describe('v7 iterated render gateway through actual sealed CPU child pipes',()=>{
 it.each(['fragment-unit','fragment-profile','fragment-marker','fragment-reserved'])('retires the exact child on malformed v10 %s ACK before accepting a display',async mode=>{
  const f=await fixture(mode),profile='source-fragment' as const;try{
   expect(await f.send({...create(),profile})).toMatchObject({ok:true});expect(await f.send({...draw(),profile})).toMatchObject({ok:false,error:{kind:'protocol'}});expect(f.service.processCount).toBe(0);expect(f.service.retainedResourceCount).toBe(0);
  }finally{await f.close();}
 });
 it('binds all v10 ink operations to the acknowledged profile and leaves absent unit unknown',async()=>{
  const f=await fixture(),profile='source-fragment' as const;try{
   expect(await f.send({...create(),profile})).toMatchObject({ok:true});expect(await f.send(draw())).toMatchObject({ok:false,error:{kind:'ownership'}});expect(await f.send(release())).toMatchObject({ok:false,error:{kind:'ownership'}});expect(f.service.retainedResourceCount).toBe(1);
   for(const operation of [draw(),replace(),present(),release()]){const op={...operation,profile},r=await f.send(op);expect(r).toMatchObject({ok:true});expect(decodeSourceIteratedRenderNativeResponse(r.value.pixels,packet(op).request)).toMatchObject({diagnosticUnit:'completed-pass',executionProfile:profile});}
   const op={...release(),profile},r=await f.send(op);expect(r.ok).toBe(true);const decoded=decodeSourceIteratedRenderNativeResponse(r.value.pixels,packet(op).request);expect(decoded.disposition).toBe('absent');expect(decoded.diagnosticUnit).toBeUndefined();expect(decoded.executionProfile).toBeUndefined();expect(f.service.retainedResourceCount).toBe(0);
  }finally{await f.close();}
 });
 it('rejects v10 absent-owner diagnostic claims and invalid explicit request words',async()=>{
  const f=await fixture('fragment-absent-unit'),profile='source-fragment' as const;try{
   for(const at of [88,92]){const wire=packet({...create(),profile}).packet;wire.writeUInt32LE(0,at);expect(await f.service.render(wire)).toMatchObject({ok:false,error:{kind:'input'}});expect(f.service.sessionStarts).toBe(0);}
   expect(await f.send({...release(),profile})).toMatchObject({ok:false,error:{kind:'protocol'}});expect(f.service.processCount).toBe(0);
  }finally{await f.close();}
 });

 it('binds fragmented draw/present ACKs, preserves the last drawn checkpoint after compute advances, and releases each owner separately',async()=>{
  const f=await initialized('fragment');try{
   expect(f.service.retainedResource).toBe(token);expect(f.service.retainedResourceCount).toBe(2);expect(f.service.canAcquireLease).toBe(false);
   const rendered=await f.send(draw());expect(rendered).toMatchObject({ok:true,value:{format:'iterated-render-v1',rowOrder:'none',width:3,height:2}});
   expect(decodeSourceIteratedRenderNativeResponse(rendered.value.pixels,packet(draw()).request)).toMatchObject({index:1,displays:1,invalid:4294967298,accepted:3,clipped:1,sampleInvalid:2});
   expect(await f.compute({...advance(1),resetCounter:false})).toMatchObject({ok:true,value:{format:'iterated-v1'}});
   const image=await f.send(present());expect(image).toMatchObject({ok:true,value:{rowOrder:'bottom-up',width:3,height:2,contextSerial:1,sessionSerial:1}});
   const decoded=decodeSourceIteratedRenderNativeResponse(image.value.pixels,packet(present()).request);expect(decoded).toMatchObject({index:1,displays:1,occupiedPixels:2,maxCount:3.5});expect(Array.from(decoded.pixels!)).toEqual(Array.from({length:24},(_,i)=>i));
   expect(await f.compute(stateRelease())).toMatchObject({ok:false,error:{kind:'ownership'}});expect(f.service.retainedResourceCount).toBe(2);expect(f.service.canAcquireLease).toBe(false);
   const absent=await f.send(release(other));expect(decodeSourceIteratedRenderNativeResponse(absent.value.pixels,packet(release(other)).request).disposition).toBe('absent');expect(f.service.retainedResourceCount).toBe(2);
   expect(await f.send(release())).toMatchObject({ok:true});expect(f.service.retainedResourceCount).toBe(1);expect(await f.send(release())).toMatchObject({ok:true});expect(f.service.retainedResourceCount).toBe(1);
   expect(await f.compute(stateRelease())).toMatchObject({ok:true});expect(f.service.retainedResourceCount).toBe(0);expect(f.service.canAcquireLease).toBe(true);expect(f.service.sessionStarts).toBe(1);
  }finally{await f.close();}
 });
 it('keeps the registered ink checkpoint and displayed pixels after program-only replacement, even after compute advances',async()=>{
  const f=await initialized();try{
   expect(await f.send(draw())).toMatchObject({ok:true});const before=await f.send(present());expect(await f.compute(advance(1))).toMatchObject({ok:true});
   const result=await f.send(replace());expect(result).toMatchObject({ok:true,value:{format:'iterated-render-v1',rowOrder:'none',contextSerial:1,sessionSerial:1}});
   const decoded=decodeSourceIteratedRenderNativeResponse(result.value.pixels,packet(replace()).request);expect(decoded).toMatchObject({index:1,displays:1,invalid:0,accepted:0,clipped:0,sampleInvalid:0,occupiedPixels:0,maxCount:0});expect(decoded.pixels).toBeUndefined();
   expect(result.value.pixels.byteLength).toBe(128);const after=await f.send(present());expect(after.value.pixels).toEqual(before.value.pixels);expect(f.service.retainedResourceCount).toBe(2);expect(f.service.sessionStarts).toBe(1);
   expect(await f.send(release())).toMatchObject({ok:true});expect(await f.compute(stateRelease())).toMatchObject({ok:true});
  }finally{await f.close();}
 });
 it.each(['replace-facts','replace-displays','replace-index','replace-extra'])('rejects %s ACK and retires the exact ink/state child',async mode=>{
  const f=await initialized(mode);try{expect(await f.send(draw())).toMatchObject({ok:true});expect(await f.send(replace())).toMatchObject({ok:false,error:{kind:'protocol'}});expect(f.service.processCount).toBe(0);expect(f.service.retainedResourceCount).toBe(0);}finally{await f.close();}
 });
 it('retains the previous ink after a recoverable replacement input error',async()=>{
  const f=await initialized('replace-input');try{expect(await f.send(draw())).toMatchObject({ok:true});const before=await f.send(present());expect(await f.send(replace())).toMatchObject({ok:false,error:{kind:'input'}});const after=await f.send(present());expect(after.value.pixels).toEqual(before.value.pixels);expect(f.service.retainedResourceCount).toBe(2);expect(f.service.sessionStarts).toBe(1);}finally{await f.close();}
 });
 it.each(['replace-runtime','replace-hang'])('waits for exact child close after %s before clearing both registries',async mode=>{
  const f=await initialized(mode),controller=new AbortController();try{expect(await f.send(draw())).toMatchObject({ok:true});const pending=f.send(replace(),controller.signal);await f.ready();if(mode==='replace-hang')controller.abort();expect(await pending).toMatchObject({ok:false,error:{kind:mode==='replace-hang'?'cancelled':'runtime'}});expect(f.service.processCount).toBe(0);expect(f.service.retainedResourceCount).toBe(0);expect(f.service.canAcquireLease).toBe(true);}finally{controller.abort();await f.close();}
 });
 it('carries v7 facts and pixels over real HTTP, retains its page lease, and reaps both owners on disconnect',async()=>{
  const f=await fixture(),app=await createExportServer({root:join(root,'http-'+(++serial)),sourceRendererBackend:f.backend});
  const address=await app.listen(0),url=`http://127.0.0.1:${address.port}`,controller=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  const post=(body:Buffer)=>fetch(url+'/api/source-renderer/frames',{method:'POST',headers:{'content-type':'application/octet-stream','x-source-lease':other},body:new Uint8Array(body)});
  try{
   const lease=await fetch(url+'/api/source-renderer/lease/'+other,{signal:controller.signal});expect(lease.status).toBe(200);reader=lease.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toBe('READY\n');
   const upload:SourceIteratedNativeOperation={kind:'upload',resource:token,expectedIndex:0,expectedCount:count,offset:0,positionsAndMetric:new Float32Array(count*4)};
   for(const op of [stateCreate(),upload,advance()]){const response=await post(computePacket(op));expect(response.status).toBe(200);await response.arrayBuffer();}
   for(const op of [create(),draw(),replace(),present()]){
    const response=await post(packet(op).packet);expect(response.status).toBe(200);expect(response.headers.get('x-source-format')).toBe('iterated-render-v1');expect(response.headers.get('x-source-row-order')).toBe(op.kind==='present'?'bottom-up':'none');
    expect(response.headers.get('x-source-generation')).toBe('7');expect(response.headers.get('x-source-sequence')).toBe('1');expect(response.headers.get('x-source-context')).toBe('1');expect(response.headers.get('x-source-session')).toBe('1');
    const bytes=new Uint8Array(await response.arrayBuffer());expect(bytes.length).toBe(op.kind==='present'?152:128);expect(decodeSourceIteratedRenderNativeResponse(bytes,packet(op).request).stateResource).toBe(token);
   }
   expect(app.ownedProcessCount).toBe(1);const blocked=await fetch(url+'/api/source-renderer/lease/'+'56'.repeat(16));expect(blocked.status).toBe(429);await blocked.arrayBuffer();
   controller.abort();await reader.cancel().catch(()=>{});reader.releaseLock();reader=undefined;
   for(let i=0;i<300&&app.ownedProcessCount;i++)await delay(5);expect(app.ownedProcessCount).toBe(0);
   const expired=await post(packet(release()).packet);expect(expired.status).toBe(409);await expired.arrayBuffer();
   const fresh=await fetch(url+'/api/source-renderer/lease/'+'78'.repeat(16));expect(fresh.status).toBe(200);await fresh.body!.cancel();
  }finally{controller.abort();await reader?.cancel().catch(()=>{});await app.close();expect(app.ownedProcessCount).toBe(0);await f.close();}
 });
 it('rejects malformed v7 neutral envelopes and reset-counter combinations before starting a child',async()=>{
  const f=await fixture();try{
   for(const [at,value]of [[28,1],[60,4],[68,12],[88,12],[112,1],[116,0]]){const b=packet(create()).packet;b.writeUInt32LE(value,at);expect((await f.service.render(b)).ok).toBe(false);}
   for(const [at,value]of [[120,2],[124,2],[132,3],[112,0xffffffff]]){const b=packet(draw()).packet;b.writeUInt32LE(value,at);expect((await f.service.render(b)).ok).toBe(false);}
   const wrongKind=computePacket(stateCreate());wrongKind.writeUInt32LE(7,4);expect((await f.service.render(wrongKind)).ok).toBe(false);
   for(const [reset,counter]of [[1,0],[0,2]]){const b=computePacket(advance());b.writeUInt32LE(reset,92);b.writeUInt32LE(counter,96);expect((await f.service.render(b)).ok).toBe(false);}
   expect(f.service.sessionStarts).toBe(0);
  }finally{await f.close();}
 });
 it.each(['family','kind','resource','state','index','displays','disposition','count','width','height','reserved','unsafe-invalid','coverage','over-count','unmeasured-present','outer-format','outer-size','extra'])('rejects malformed draw %s before publishing facts or pixels',async mode=>{
  const f=await initialized(mode);try{expect(await f.send(draw())).toMatchObject({ok:false,error:{kind:'protocol'}});expect(f.service.processCount).toBe(0);expect(f.service.retainedResourceCount).toBe(0);expect(f.service.canAcquireLease).toBe(true);}finally{await f.close();}
 });
 it.each(['occupied','max-count','present-facts'])('rejects malformed present %s before publishing pixels',async mode=>{
  const f=await initialized(mode);try{expect(await f.send(draw())).toMatchObject({ok:true});expect(await f.send(present())).toMatchObject({ok:false,error:{kind:'protocol'}});expect(f.service.processCount).toBe(0);}finally{await f.close();}
 });
 it('requires zero unmeasured create facts and zero invalid samples when recording is disabled',async()=>{
  const f=await initialized('create-facts',500,false),g=await initialized('record-false');try{expect(await f.send(create())).toMatchObject({ok:false,error:{kind:'protocol'}});expect(await g.send(draw(false))).toMatchObject({ok:false,error:{kind:'protocol'}});}finally{await f.close();await g.close();}
 });
 it.each(['release-checkpoint','release-state','absent-dirty'])('binds %s release acknowledgements before dropping a registered owner',async mode=>{
  const f=await initialized(mode);try{expect(await f.send(release(mode==='absent-dirty'?other:token))).toMatchObject({ok:false,error:{kind:'protocol'}});expect(f.service.processCount).toBe(0);}finally{await f.close();}
 });
 it('rejects a compute success ACK that claims to release a state while an ink child is owned',async()=>{
  const f=await initialized('illegal-state-release');try{expect(await f.compute(stateRelease())).toMatchObject({ok:false,error:{kind:'protocol'}});expect(f.service.processCount).toBe(0);}finally{await f.close();}
 });
 it('preserves both registries after a recoverable input error',async()=>{
  const f=await initialized('input-error');try{await f.send(draw());expect(await f.send(present())).toMatchObject({ok:false,error:{kind:'input'}});expect(f.service.retainedResourceCount).toBe(2);expect(f.service.processCount).toBe(1);expect(await f.send(release())).toMatchObject({ok:true});expect(f.service.retainedResourceCount).toBe(1);}finally{await f.close();}
 });
 it.each(['runtime-ink','runtime-compute'])('retires the exact process for %s and waits for close before making the lease available',async mode=>{
  const f=await initialized(mode);try{const result=mode==='runtime-ink'?await f.send(draw()):await f.compute(advance(1));expect(result).toMatchObject({ok:false,error:{kind:'runtime'}});expect(f.service.processCount).toBe(0);expect(f.service.retainedResourceCount).toBe(0);expect(f.service.canAcquireLease).toBe(true);}finally{await f.close();}
 });
 it('cancels an in-flight draw, clears both owners after close, and permits a new sealed child',async()=>{
  const f=await initialized('hang'),controller=new AbortController();try{const pending=f.send(draw(),controller.signal);await f.ready();expect(f.service.activeCount).toBe(1);controller.abort();expect(await pending).toMatchObject({ok:false,error:{kind:'cancelled'}});expect(f.service.processCount).toBe(0);expect(f.service.retainedResourceCount).toBe(0);expect(await f.compute(stateCreate())).toMatchObject({ok:true,value:{sessionSerial:2}});}finally{controller.abort();await f.close();}
 });
 it.each(['hang','runtime-ink'])('retains both owners and blocks replacement when %s cleanup cannot confirm exit',async mode=>{
  const f=await initialized(mode,60),controller=new AbortController();let kill:MockInstance<ChildProcess['kill']>|undefined;
  try{kill=vi.spyOn(ChildProcess.prototype,'kill').mockReturnValue(false);const pending=f.send(draw(),controller.signal);await f.ready();if(mode==='hang')controller.abort();expect(await pending).toMatchObject({ok:false,error:{kind:'cleanup'}});expect(f.service.retainedResourceCount).toBe(2);expect(f.service.processCount).toBe(1);expect(f.service.canAcquireLease).toBe(false);expect(await f.compute(stateCreate())).toMatchObject({ok:false,error:{kind:'capacity'}});expect(f.service.sessionStarts).toBe(1);kill.mockRestore();kill=undefined;expect(await f.service.reset()).toMatchObject({ok:true});expect(f.service.retainedResourceCount).toBe(0);expect(f.service.canAcquireLease).toBe(true);}finally{kill?.mockRestore();controller.abort();await f.close();}
 });
});
