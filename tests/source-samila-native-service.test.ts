import {afterAll,beforeAll,describe,expect,it,vi,type MockInstance} from 'vitest';
import {ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
// @ts-expect-error The Node adapter is separate from browser contracts.
import {createSourceRendererService} from '../server/source-renderer.mjs';
// @ts-expect-error The Node HTTP adapter is separate from browser contracts.
import {createExportServer} from '../server/index.mjs';

// CPU-only transport fixtures. They deliberately implement no shaders, GPU,
// native parser or numerical work; these tests establish service admission,
// response validation and ownership, not CGL correctness or image fidelity.
const tokenA='11'.repeat(16),tokenB='22'.repeat(16),missing='33'.repeat(16);
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const digest=(source:string)=>createHash('sha256').update(source).digest('hex');
let root:string,number=0;
beforeAll(()=>{mkdirSync('.cache',{recursive:true});root=mkdtempSync(resolve('.cache/samila-service-'));});
afterAll(()=>rmSync(root,{recursive:true,force:true}));

function envelope(version:4|5,operation:number,token:string,display=false,index=0):Buffer {
 const bytes=Buffer.alloc(version===4?84:display?108:88);
 [0x31464c4d,version,bytes.length,7,1,display?3:1,display?2:1].forEach((value,i)=>bytes.writeUInt32LE(value,i*4));
 if(version===5){
  bytes.writeUInt32LE(1,60);bytes.writeUInt32LE(operation,64);bytes.writeUInt32LE(16,68);Buffer.from(token,'hex').copy(bytes,72);
  if(display){bytes.writeUInt32LE(index,88);bytes.writeUInt32LE(1,92);bytes.writeUInt32LE(5,96);bytes.writeUInt32LE(6,100);bytes.writeUInt32LE(0xfedcba98,104);}
 }else{bytes.writeUInt32LE(operation,60);bytes.writeUInt32LE(16,64);Buffer.from(token,'hex').copy(bytes,68);}
 return bytes;
}
const create=(token=tokenA)=>envelope(5,1,token);
const display=(token=tokenA,index=0)=>envelope(5,2,token,true,index);
const release=(token=tokenA)=>envelope(5,3,token);
const bouncingCreate=(token=tokenA)=>envelope(4,1,token);
const bouncingRelease=(token=tokenA)=>envelope(4,4,token);

function childFixture(mode='normal',options:Record<string,number>={}) {
 const executablePath=join(root,'child-'+(++number)),receivedPath=executablePath+'.received';
 const source=`#!${process.execPath}
import {writeFileSync} from 'node:fs';
const mode=${JSON.stringify(mode)},states=new Map();let input=Buffer.alloc(0),context=mode==='http-context'?7:1;
function handle(request){
 const version=request.readUInt32LE(4),samila=version===5,operation=request.readUInt32LE(samila?64:60),resource=request.subarray(samila?72:68,samila?88:84),key=(samila?'samila:':'bouncing:')+resource.toString('hex');
 const width=request.readUInt32LE(20),height=request.readUInt32LE(24),control=samila?operation!==2:operation!==3;
 if(mode.startsWith('hang-'))writeFileSync(${JSON.stringify(receivedPath)},String(request.readUInt32LE(16)));
 if(samila&&(mode==='hang-create'&&operation===1||mode==='hang-display'&&operation===2))return;
 let status=0,format=samila?3:control?2:1,payload;
 if(samila&&operation===2&&(mode==='runtime'||mode==='state-lost')){
  status=mode==='runtime'?4:5;format=0;payload=Buffer.from(mode);if(status===4)states.clear();else states.delete(key);
 }else if(samila){
  payload=Buffer.alloc(64+(control?0:width*height*4));payload.writeUInt32LE(1,0);payload.writeUInt32LE(operation,4);resource.copy(payload,8);
  if(operation===1)states.set(key,0);
  if(operation===2){const index=request.readUInt32LE(88)+1,steps=request.readUInt32LE(96)*request.readUInt32LE(100);states.set(key,index);payload.writeUInt32LE(index,24);payload.writeUInt32LE(steps,32);payload.writeUInt32LE(steps-2,36);payload.writeUInt32LE(1,40);payload.writeUInt32LE(1,44);payload.writeUInt32LE(2,48);payload.writeFloatLE(1.5,52);for(let i=64;i<payload.length;i+=4)payload.set([11,23,47,255],i);}
  if(operation===3){const present=states.has(key);payload.writeUInt32LE(present?states.get(key):0,24);payload.writeUInt32LE(present?1:2,28);states.delete(key);}
  if(operation===2){
   const offsets={family:0,operation:4,index:24,disposition:28,steps:32,conservation:36,occupied:48,reserved:60};
   if(mode in offsets)payload.writeUInt32LE(mode==='occupied'?width*height+1:payload.readUInt32LE(offsets[mode])+1,offsets[mode]);
   if(mode==='resource')payload[8]^=255;
   if(mode==='negative-mass')payload.writeFloatLE(-1,52);
   if(mode==='nonfinite-mass')payload.writeFloatLE(NaN,52);
   if(mode==='invalid-ink')payload.writeUInt32LE(1,56);
   if(mode==='format')format=1;
   if(mode==='length')payload=Buffer.concat([payload,Buffer.alloc(1)]);
  }
  if(operation===1){if(mode==='create-index')payload.writeUInt32LE(1,24);if(mode==='create-disposition')payload.writeUInt32LE(1,28);if(mode==='create-stats')payload.writeUInt32LE(1,36);}
  if(operation===3){if(mode==='release-disposition')payload.writeUInt32LE(0,28);if(mode==='absent-index')payload.writeUInt32LE(1,24);if(mode==='release-stats')payload.writeUInt32LE(1,32);}
 }else{payload=Buffer.alloc(control?4:width*height*4);if(operation===1)states.set(key,0);if(operation===4)states.delete(key);}
 const head=Buffer.alloc(44);[0x31524c4d,1,44+payload.length,request.readUInt32LE(12),request.readUInt32LE(16),width,height,status,format,payload.length,context].forEach((value,i)=>head.writeUInt32LE(value,i*4));
 if(status===4)context++;
 const output=Buffer.concat([head,payload]);if(mode==='fragment'){process.stdout.write(output.subarray(0,17));setImmediate(()=>{process.stdout.write(output.subarray(17,49));setImmediate(()=>process.stdout.write(output.subarray(49)));});}else process.stdout.write(output);
}
process.stdin.on('data',chunk=>{input=Buffer.concat([input,chunk]);while(input.length>=12&&input.length>=input.readUInt32LE(8)){const n=input.readUInt32LE(8),packet=input.subarray(0,n);input=input.subarray(n);handle(packet);}});
`;
 writeFileSync(executablePath,source);chmodSync(executablePath,0o755);
 return{backend:{executablePath,executableSha256:digest(source),timeoutMs:8000,killGraceMs:5,cleanupMs:1000,...options},received:async(sequence:number)=>{const expected=String(sequence);for(let i=0;i<600;i++){if(existsSync(receivedPath)&&readFileSync(receivedPath,'utf8')===expected)return;await delay(5);}throw Error('CPU child did not receive the pending request');}};
}
async function fixture(mode='normal',options:Record<string,number>={}) {
 const child=childFixture(mode,options),service=await createSourceRendererService(child.backend);
 let sequence=0;
 return{service,send:(packet:Buffer,signal?:AbortSignal)=>{const owned=Buffer.from(packet);owned.writeUInt32LE(++sequence,16);return service.render(owned,{signal});},received:()=>child.received(sequence),close:async()=>{expect(await service.close()).toMatchObject({ok:true});expect(service.processCount).toBe(0);}};
}

describe('Samila retained service protocol with CPU-only owned children',()=>{
 it('delivers a complete fragmented prefix and pixels with the caller and process identity',async()=>{
  const f=await fixture('fragment');try{
   expect(f.service.canAcquireLease).toBe(true);
   const created=await f.send(create());expect(created).toMatchObject({ok:true,value:{format:'samila-v1',rowOrder:'none',generation:7,sequence:1,contextSerial:1,sessionSerial:1}});
   expect(created.value.pixels).toHaveLength(64);expect(f.service.retainedResourceCount).toBe(1);expect(f.service.canAcquireLease).toBe(false);
   const image=await f.send(display());expect(image).toMatchObject({ok:true,value:{format:'samila-v1',rowOrder:'bottom-up',width:3,height:2,sequence:2}});
   expect(image.value.pixels).toHaveLength(88);expect(image.value.pixels.readUInt32LE(24)).toBe(1);expect(image.value.pixels.readUInt32LE(32)).toBe(30);
   expect([...image.value.pixels.subarray(64,68)]).toEqual([11,23,47,255]);expect((await f.send(display(tokenA,1))).value.pixels.readUInt32LE(24)).toBe(2);
  }finally{await f.close();}
 });

 it('tracks two Samila resources and Bouncing independently, even when tokens coincide across families',async()=>{
  const f=await fixture();try{
   for(const packet of [bouncingCreate(),create(),create(tokenB)])expect(await f.send(packet)).toMatchObject({ok:true});
   expect(f.service.retainedResourceCount).toBe(3);expect(f.service.canAcquireLease).toBe(false);
   expect(await f.send(release())).toMatchObject({ok:true});expect(f.service.retainedResourceCount).toBe(2);
   const absent=await f.send(release());expect(absent.value.pixels.readUInt32LE(28)).toBe(2);expect(f.service.retainedResourceCount).toBe(2);
   expect(await f.send(bouncingRelease())).toMatchObject({ok:true});expect(f.service.retainedResourceCount).toBe(1);expect(f.service.retainedResource).toBe(tokenB);expect(f.service.canAcquireLease).toBe(false);
   expect(await f.send(display(tokenB))).toMatchObject({ok:true});expect(await f.send(release(missing))).toMatchObject({ok:true});expect(f.service.retainedResourceCount).toBe(1);
   expect(await f.send(release(tokenB))).toMatchObject({ok:true});expect(f.service.retainedResourceCount).toBe(0);expect(f.service.retainedResource).toBeUndefined();expect(f.service.canAcquireLease).toBe(true);
  }finally{await f.close();}
 });

 it.each(['family','operation','resource','index','disposition','steps','conservation','occupied','reserved','negative-mass','nonfinite-mass','invalid-ink','format','length'])('retires all retained owners after an invalid display %s response',async mode=>{
  const f=await fixture(mode);try{
   for(const packet of [bouncingCreate(),create(),create(tokenB)])expect(await f.send(packet)).toMatchObject({ok:true});
   expect(await f.send(display())).toMatchObject({ok:false,error:{kind:'protocol'}});
   expect(f.service.processCount).toBe(0);expect(f.service.retainedResourceCount).toBe(0);expect(f.service.canAcquireLease).toBe(true);
  }finally{await f.close();}
 });

 it.each(['create-index','create-disposition','create-stats'])('does not publish provisional ownership after malformed %s acknowledgement',async mode=>{
  const f=await fixture(mode);try{expect(await f.send(create())).toMatchObject({ok:false,error:{kind:'protocol'}});expect(f.service.retainedResourceCount).toBe(0);expect(f.service.processCount).toBe(0);}finally{await f.close();}
 });

 it.each(['release-disposition','absent-index','release-stats'])('does not accept malformed %s release acknowledgement',async mode=>{
  const f=await fixture(mode);try{await f.send(create());expect(await f.send(release(mode==='absent-index'?missing:tokenA))).toMatchObject({ok:false,error:{kind:'protocol'}});expect(f.service.processCount).toBe(0);expect(f.service.retainedResourceCount).toBe(0);}finally{await f.close();}
 });

 it('clears every family after native runtime context failure, then observes the new context',async()=>{
  const f=await fixture('runtime');try{
   for(const packet of [bouncingCreate(),create(),create(tokenB)])expect(await f.send(packet)).toMatchObject({ok:true});
   expect(await f.send(display())).toMatchObject({ok:false,error:{kind:'runtime'}});expect(f.service.retainedResourceCount).toBe(0);expect(f.service.canAcquireLease).toBe(true);expect(f.service.processCount).toBe(1);
   expect(await f.send(create())).toMatchObject({ok:true,value:{contextSerial:2,sessionSerial:1}});expect(f.service.retainedResourceCount).toBe(1);
  }finally{await f.close();}
 });

 it('keeps unrelated resources on state-lost and deletes only the explicitly absent token on release',async()=>{
  const f=await fixture('state-lost');try{
   for(const packet of [bouncingCreate(),create(),create(tokenB)])await f.send(packet);
   expect(await f.send(display())).toMatchObject({ok:false,error:{kind:'state-lost'}});expect(f.service.retainedResourceCount).toBe(3);expect(f.service.processCount).toBe(1);
   const result=await f.send(release());expect(result.value.pixels.readUInt32LE(28)).toBe(2);expect(f.service.retainedResourceCount).toBe(2);expect(f.service.canAcquireLease).toBe(false);
  }finally{await f.close();}
 });

 it.each(['hang-create','hang-display'])('blocks lease acquisition through failed %s cleanup, including no acknowledged resource',async mode=>{
  const f=await fixture(mode,{cleanupMs:60}),controller=new AbortController();let kill:MockInstance<ChildProcess['kill']>|undefined;
  try{
   if(mode==='hang-display')for(const packet of [bouncingCreate(),create(),create(tokenB)])await f.send(packet);
   const retained=mode==='hang-create'?0:3;
   const pending=f.send(mode==='hang-create'?create():display(),controller.signal);
   await f.received();
   expect(f.service.processCount).toBe(1);expect(f.service.canAcquireLease).toBe(false);
   kill=vi.spyOn(ChildProcess.prototype,'kill').mockReturnValue(false);controller.abort();
   expect(await pending).toMatchObject({ok:false,error:{kind:'cleanup'}});expect(f.service.activeCount).toBe(0);expect(f.service.processCount).toBe(1);
   expect(f.service.retainedResourceCount).toBe(retained);expect(f.service.canAcquireLease).toBe(false);
   expect(await f.send(create(missing))).toMatchObject({ok:false,error:{kind:'capacity'}});expect(f.service.sessionStarts).toBe(1);
   kill.mockRestore();kill=undefined;expect(await f.service.reset()).toMatchObject({ok:true});expect(f.service.processCount).toBe(0);expect(f.service.retainedResourceCount).toBe(0);expect(f.service.canAcquireLease).toBe(true);
  }finally{kill?.mockRestore();await f.close();}
 });

 it('carries Samila context, restarted session and original caller identity through real HTTP',async()=>{
  const child=childFixture('http-context'),app=await createExportServer({root:join(root,'http-'+(++number)),sourceRendererBackend:child.backend});
  const address=await app.listen(0),url=`http://127.0.0.1:${address.port}`,leaseController=new AbortController();
  const post=(body:Buffer)=>fetch(url+'/api/source-renderer/frames',{method:'POST',headers:{'content-type':'application/octet-stream'},body:new Uint8Array(body)});
  try{
   for(const packet of [create(),display(),release()]){
    const response=await post(packet);expect(response.status).toBe(200);
    expect(response.headers.get('x-source-generation')).toBe('7');expect(response.headers.get('x-source-sequence')).toBe('1');
    expect(response.headers.get('x-source-context')).toBe('7');expect(response.headers.get('x-source-session')).toBe('1');expect(response.headers.get('x-source-format')).toBe('samila-v1');
    const drawing=packet.readUInt32LE(64)===2,body=Buffer.from(await response.arrayBuffer());
    expect(response.headers.get('x-source-row-order')).toBe(drawing?'bottom-up':'none');expect(body.length).toBe(drawing?88:64);expect(response.headers.get('content-length')).toBe(String(body.length));expect(body.subarray(8,24).toString('hex')).toBe(tokenA);
    if(drawing){expect(body.readUInt32LE(24)).toBe(1);expect([...body.subarray(64,68)]).toEqual([11,23,47,255]);}
   }
   expect(app.ownedProcessCount).toBe(1);
   const lease=await fetch(url+'/api/source-renderer/lease/'+missing,{signal:leaseController.signal});expect(lease.status).toBe(200);await lease.body!.cancel();leaseController.abort();
   for(let i=0;i<300&&app.ownedProcessCount;i++)await delay(5);expect(app.ownedProcessCount).toBe(0);
   const restarted=await post(create());expect(restarted.status).toBe(200);expect(restarted.headers.get('x-source-context')).toBe('7');expect(restarted.headers.get('x-source-session')).toBe('2');expect((await restarted.arrayBuffer()).byteLength).toBe(64);expect(app.ownedProcessCount).toBe(1);
  }finally{leaseController.abort();await app.close();expect(app.ownedProcessCount).toBe(0);}
 });

 it('rejects a real HTTP page lease after unacknowledged create cleanup fails and the request slot is free',async()=>{
  const child=childFixture('hang-create',{cleanupMs:60}),app=await createExportServer({root:join(root,'http-'+(++number)),sourceRendererBackend:child.backend});
  const address=await app.listen(0),url=`http://127.0.0.1:${address.port}`,controller=new AbortController();let kill:MockInstance<ChildProcess['kill']>|undefined;
  const post=(body:Buffer,signal?:AbortSignal)=>fetch(url+'/api/source-renderer/frames',{method:'POST',headers:{'content-type':'application/octet-stream'},body:new Uint8Array(body),signal});
  try{
   const pending=post(create(),controller.signal).then(()=>false,error=>error.name==='AbortError');await child.received(1);expect(app.ownedProcessCount).toBe(1);
   kill=vi.spyOn(ChildProcess.prototype,'kill').mockReturnValue(false);controller.abort();expect(await pending).toBe(true);
   // A malformed frame reaches header parsing only after nativeBusy is cleared.
   // This distinguishes the ownership guard from merely rejecting a busy slot.
   let probeStatus=0;for(let i=0;i<200;i++){const probe=await post(Buffer.alloc(52));probeStatus=probe.status;await probe.arrayBuffer();if(probeStatus===400)break;expect(probeStatus).toBe(429);await delay(5);}expect(probeStatus).toBe(400);
   const lease=await fetch(url+'/api/source-renderer/lease/'+missing);expect(lease.status).toBe(429);expect(await lease.json()).toMatchObject({kind:'capacity',retryable:false});expect(app.ownedProcessCount).toBe(1);
   const blocked=await post(create(tokenB));expect(blocked.status).toBe(429);expect(await blocked.json()).toMatchObject({kind:'capacity'});expect(app.ownedProcessCount).toBe(1);
  }finally{controller.abort();kill?.mockRestore();await app.close();expect(app.ownedProcessCount).toBe(0);}
 });
});
