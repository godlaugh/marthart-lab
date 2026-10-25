import {afterAll,beforeAll,describe,expect,it,vi,type MockInstance} from 'vitest';
import {ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {encodeSourceIteratedNativeRequest,decodeSourceIteratedNativeResponse,type SourceIteratedNativeOperation} from '../src/engine/sourceIteratedNativeProtocol';
// @ts-expect-error The owned Node pipe service is separate from browser contracts.
import {createSourceRendererService} from '../server/source-renderer.mjs';

// These small, sealed Node children emit controlled ACKs and transport faults.
// They execute no shaders, native renderer or GPU mathematics. The production
// codec and service own admission, stream parsing, resource registry and cleanup.
const token='12'.repeat(16),other='34'.repeat(16),shaders={vertex:'#version 410 core\nvoid main() { gl_Position=vec4(0); }',fragment:'#version 410 core\nvoid main() {}'};
const create=(resource=token):Extract<SourceIteratedNativeOperation,{kind:'create'}>=>({kind:'create',resource,count:2,...shaders});
const createSource=(resource=token):Extract<SourceIteratedNativeOperation,{kind:'create-source'}>=>({kind:'create-source',resource,count:2,...shaders,diagnosticVertex:shaders.vertex,diagnosticFragment:shaders.fragment});
const upload=():Extract<SourceIteratedNativeOperation,{kind:'upload'}>=>({kind:'upload',resource:token,expectedIndex:0,expectedCount:2,offset:0,positionsAndMetric:new Float32Array(8)});
const advance=(expectedIndex=0,steps=0,resetCounter?:boolean):Extract<SourceIteratedNativeOperation,{kind:'advance'}>=>({kind:'advance',resource:token,expectedIndex,expectedCount:2,reset:false,...(resetCounter===undefined?{}:{resetCounter}),dimension:2,steps,uniforms:[]});
const read=():Extract<SourceIteratedNativeOperation,{kind:'read'}>=>({kind:'read',resource:token,expectedIndex:1,expectedCount:2,offset:1,count:1});
const release=(resource=token):Extract<SourceIteratedNativeOperation,{kind:'release'}>=>({kind:'release',resource,expectedCount:2});
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
let root:string,serial=0;
beforeAll(()=>{mkdirSync('.cache',{recursive:true});root=mkdtempSync(resolve('.cache/iterated-native-service-'));});
afterAll(()=>rmSync(root,{recursive:true,force:true}));
function packet(op:SourceIteratedNativeOperation,sequence=1){const request={generation:7,sequence,operation:op},encoded=encodeSourceIteratedNativeRequest(request);if(!encoded.ok)throw Error(encoded.error.reason);return{request,packet:Buffer.from(encoded.value)};}
// The other-family control shapes test registry isolation only. They are not
// representations of complete native-create shader or texture payloads.
function control(version:4|5,kind:number){const b=Buffer.alloc(version===4?84:88);[0x31464c4d,version,b.length,7,1,1,1].forEach((n,i)=>b.writeUInt32LE(n,i*4));if(version===5){b.writeUInt32LE(1,60);b.writeUInt32LE(kind,64);b.writeUInt32LE(16,68);Buffer.from(token,'hex').copy(b,72);}else{b.writeUInt32LE(kind,60);b.writeUInt32LE(16,64);Buffer.from(token,'hex').copy(b,68);}return b;}
async function fixture(mode='normal',cleanupMs=500){
 const executablePath=join(root,'child-'+(++serial)),received=executablePath+'.received';
 const source=`#!${process.execPath}
import {writeFileSync} from 'node:fs';
const mode=${JSON.stringify(mode)},states=new Map();let input=Buffer.alloc(0);
function handle(b){
 const version=b.readUInt32LE(4),iterated=version>=6,samila=version===5,kind=b.readUInt32LE(version>=5?64:60),resource=b.subarray(version>=5?72:68,version>=5?88:84),key=(iterated?'iterated':version)+':'+resource.toString('hex');
 writeFileSync(${JSON.stringify(received)},String(b.readUInt32LE(16)));
 writeFileSync(${JSON.stringify(received+'.packet')},b);
 if(iterated&&(mode==='hang-create'&&(kind===1||kind===6||kind===7)||mode==='hang-read'&&kind===4))return;
 let payload,status=0,format=iterated?4:samila?3:2;
 if(iterated){
  let state=states.get(key);
  if(kind===1||kind===6||kind===7){
   if(kind===6&&mode==='source-input')status=1;else if(kind===6&&mode==='source-capacity')status=3;
   else if(state&&mode!=='duplicate-ack')status=1;
   else{state={index:0,uploaded:0,total:b.readUInt32LE(88)};states.set(key,state);}
  }else if(kind!==5&&!state)status=5;
  if(!status&&kind===2&&state)state.uploaded=2;if(!status&&(kind===3||kind===8)&&state)state.index++;
  const count=kind===4?b.readUInt32LE(96):0;payload=Buffer.alloc(64+count*24);payload.writeUInt32LE(2,0);payload.writeUInt32LE(kind,4);resource.copy(payload,8);
  if(state){payload.writeUInt32LE(state.index,24);payload.writeUInt32LE(state.uploaded,32);payload.writeUInt32LE(state.total,36);}
  if(kind===4){payload.writeUInt32LE(b.readUInt32LE(92),40);payload.writeUInt32LE(count,44);for(let i=0;i<count;i++){payload.writeUInt32LE(0x7fa12345,64+i*24);payload.writeUInt32LE(0x80000000,68+i*24);payload.writeUInt32LE(0x7f800000,72+i*24);payload.writeUInt32LE(0xff800000,76+i*24);payload.writeUInt32LE(0xffffffff,80+i*24);payload.writeUInt32LE(1,84+i*24);}}
  if(version===8){payload.writeUInt32LE(1,52);payload.writeUInt32LE(1,56);}
  if(kind===3||kind===8)payload.writeUInt32LE(b.readUInt32LE(version===7?104:100),48);
  if(kind===5){payload.writeUInt32LE(state?1:2,28);states.delete(key);}
  if(kind===4){
   const offsets={family:0,kind:4,index:24,disposition:28,uploaded:32,offset:40,count:44,steps:48,reserved:60,validity:84,unit:52,profile:56};
   if(mode in offsets)payload.writeUInt32LE(payload.readUInt32LE(offsets[mode])+1,offsets[mode]);if(mode==='total')payload.writeUInt32LE(0,36);if(mode==='resource')payload[8]^=1;
   if(mode==='format')format=3;if(mode==='extra')payload=Buffer.concat([payload,Buffer.from([1])]);
   if(mode==='runtime'||mode==='state-lost'){status=mode==='runtime'?4:5;format=0;payload=Buffer.from(mode);if(status===4)states.clear();}
  }
  if(kind===5&&mode==='release-empty'){payload.writeUInt32LE(0,32);payload.writeUInt32LE(0,36);}
  if(kind===6){
   const sourceOffsets={'source-kind':4,'source-index':24,'source-uploaded':32,'source-total':36,'source-reserved':60};
   if(mode in sourceOffsets)payload.writeUInt32LE(mode==='source-kind'?1:payload.readUInt32LE(sourceOffsets[mode])+1,sourceOffsets[mode]);
   if(mode==='source-runtime')status=4;
  }
  if(status){format=0;payload=Buffer.from('controlled '+mode+' status '+status);}
 }else if(samila){payload=Buffer.alloc(64);payload.writeUInt32LE(1,0);payload.writeUInt32LE(kind,4);resource.copy(payload,8);if(kind===1)states.set(key,{});else{payload.writeUInt32LE(states.has(key)?1:2,28);states.delete(key);}}
 else{payload=Buffer.alloc(4);if(kind===1)states.set(key,{});else states.delete(key);}
 const h=Buffer.alloc(44);[0x31524c4d,1,44+payload.length,b.readUInt32LE(12),b.readUInt32LE(16),1,1,status,format,payload.length,1].forEach((n,i)=>h.writeUInt32LE(n,i*4));
 const output=Buffer.concat([h,payload]);if(mode==='fragment'){process.stdout.write(output.subarray(0,17));setImmediate(()=>{process.stdout.write(output.subarray(17,49));setImmediate(()=>process.stdout.write(output.subarray(49)));});}else process.stdout.write(output);
}
process.stdin.on('data',chunk=>{input=Buffer.concat([input,chunk]);while(input.length>=12&&input.length>=input.readUInt32LE(8)){const n=input.readUInt32LE(8),b=input.subarray(0,n);input=input.subarray(n);handle(b);}});
`;
 writeFileSync(executablePath,source);chmodSync(executablePath,0o755);
 const service=await createSourceRendererService({executablePath,executableSha256:createHash('sha256').update(source).digest('hex'),timeoutMs:5000,killGraceMs:5,cleanupMs});let sequence=0;
 const send=(op:SourceIteratedNativeOperation,signal?:AbortSignal)=>{const input=packet(op,++sequence);return service.render(input.packet,{signal});};
 return{service,send,receivedPacket:()=>readFileSync(received+'.packet'),sendOther:(b:Buffer)=>{b.writeUInt32LE(++sequence,16);return service.render(b);},ready:async()=>{for(let i=0;i<500;i++){if(existsSync(received)&&readFileSync(received,'utf8')===String(sequence))return;await delay(5);}throw Error('Owned CPU child did not receive request');},close:async()=>{expect(await service.close()).toMatchObject({ok:true});expect(service.processCount).toBe(0);expect(service.activeCount).toBe(0);expect(service.retainedResourceCount).toBe(0);}};
}
async function initialized(mode='normal',cleanupMs=500,creation:SourceIteratedNativeOperation=create()){const f=await fixture(mode,cleanupMs);try{for(const op of [creation,upload(),advance()])expect(await f.send(op)).toMatchObject({ok:true});return f;}catch(e){await f.close();throw e;}}

describe('v6/v7 gateway with actual owned CPU child pipes',()=>{


 it('keeps a custom unacknowledged create owned when process cleanup fails and releases it only after confirmed close',async()=>{
  const f=await fixture('hang-create',20),abort=new AbortController(),kill=vi.spyOn(ChildProcess.prototype,'kill').mockReturnValue(false);
  try{
   const pending=f.send({kind:'create-fragment',resource:token,count:2,...shaders,bindingNames:[]},abort.signal);await f.ready();abort.abort();
   expect(await pending).toMatchObject({ok:false,error:{kind:'cleanup'}});expect(f.service.processCount).toBe(1);expect(f.service.canAcquireLease).toBe(false);
   kill.mockRestore();expect(await f.service.reset()).toMatchObject({ok:true});expect(f.service.processCount).toBe(0);
  }finally{kill.mockRestore();await f.close();}
 });
 it.each(['unit','profile'])('retires the actual child after a forged custom %s ACK instead of reinterpreting diagnostics',async mode=>{
  const f=await fixture(mode),profile='source-fragment' as const;
  try{
   expect(await f.send({kind:'create-fragment',resource:token,count:2,...shaders,bindingNames:[]})).toMatchObject({ok:true});
   const creation=f.receivedPacket();expect(await f.send(release())).toMatchObject({ok:false,error:{kind:'ownership'}});expect(f.receivedPacket()).toEqual(creation);
   expect(await f.send({...upload(),profile})).toMatchObject({ok:true});
   expect(await f.send({kind:'advance-fragment',resource:token,expectedCount:2,expectedIndex:0,steps:0,reset:false,resetCounter:false,bindings:[]})).toMatchObject({ok:true});
   expect(await f.send({...read(),profile})).toMatchObject({ok:false,error:{kind:'protocol'}});expect(f.service.processCount).toBe(0);expect(f.service.retainedResourceCount).toBe(0);
  }finally{await f.close();}
 });
 it.each([6,7] as const)('admits source zero/16-step v%s advances, rejecting excess before write or sequence commit',async version=>{
  const f=await fixture();try{
   const creation=createSource(),created=await f.send(creation);expect(created).toMatchObject({ok:true,value:{format:'iterated-v1'}});
   expect(decodeSourceIteratedNativeResponse(created.value.pixels,{generation:7,sequence:1,operation:creation})).toMatchObject({index:0,totalCount:2,uploaded:0,steps:0});
   const createdPacket=f.receivedPacket();expect([createdPacket.readUInt32LE(4),createdPacket.readUInt32LE(60),createdPacket.readUInt32LE(64),createdPacket.readUInt32LE(88)]).toEqual([7,2,6,2]);
   let at=92;const receivedShaders:string[]=[];for(let i=0;i<4;i++){const n=createdPacket.readUInt32LE(at);at+=4;receivedShaders.push(createdPacket.toString('utf8',at,at+n));at+=n;}
   expect(receivedShaders).toEqual([shaders.vertex,shaders.fragment,shaders.vertex,shaders.fragment]);expect(at).toBe(createdPacket.length);
   expect(f.service.retainedResourceCount).toBe(1);expect(f.service.canAcquireLease).toBe(false);
   expect(await f.send(upload())).toMatchObject({ok:true});const resetCounter=version===7?true:undefined;
   expect(await f.send(advance(0,0,resetCounter))).toMatchObject({ok:true});const before=f.receivedPacket();
   for(const steps of [17,256])expect(await f.service.render(packet(advance(1,steps,resetCounter),4).packet)).toMatchObject({ok:false,error:{kind:'input'}});
   expect(f.receivedPacket()).toEqual(before);expect(f.service.retainedResourceCount).toBe(1);expect(f.service.activeCount).toBe(0);
   // Sequence 4 is still available after both locally rejected requests.
   const accepted=await f.send(advance(1,16,resetCounter));expect(accepted).toMatchObject({ok:true,value:{sequence:4}});expect(accepted.value.pixels.readUInt32LE(24)).toBe(2);expect(accepted.value.pixels.readUInt32LE(48)).toBe(16);
   expect(await f.send(release())).toMatchObject({ok:true});expect(f.service.canAcquireLease).toBe(true);
   expect(await f.send(release())).toMatchObject({ok:true});expect(f.service.retainedResourceCount).toBe(0);
   // Reusing the exact token with a successful generic create changes the owner.
   for(const op of [create(),upload(),advance(0,256,resetCounter)])expect(await f.send(op)).toMatchObject({ok:true});
   expect(f.receivedPacket().readUInt32LE(version===7?104:100)).toBe(256);expect(f.service.sessionStarts).toBe(1);
  }finally{await f.close();}
 });
 it.each(['input','capacity'])('does not register a source profile after a native create %s rejection',async kind=>{
  const f=await fixture('source-'+kind);try{
   expect(await f.send(createSource())).toMatchObject({ok:false,error:{kind}});expect(f.service.retainedResourceCount).toBe(0);expect(f.service.canAcquireLease).toBe(true);
   // An unknown resource reaches its real native owner; no generic ownership is
   // invented from the missing profile, and a state-lost ACK never registers it.
   expect(await f.send(advance(0,256))).toMatchObject({ok:false,error:{kind:'state-lost'}});expect(f.receivedPacket().readUInt32LE(100)).toBe(256);expect(f.service.retainedResourceCount).toBe(0);
   for(const op of [create(),upload(),advance(0,256)])expect(await f.send(op)).toMatchObject({ok:true});expect(f.service.sessionStarts).toBe(1);
  }finally{await f.close();}
 });
 it.each(['source','generic'] as const)('preserves the %s profile after duplicate create rejection',async profile=>{
  const f=await fixture();try{
   for(const op of [profile==='source'?createSource():create(),upload()])expect(await f.send(op)).toMatchObject({ok:true});
   expect(await f.send(profile==='source'?create():createSource())).toMatchObject({ok:false,error:{kind:'input'}});expect(f.service.retainedResourceCount).toBe(1);
   const before=f.receivedPacket(),result=await f.send(advance(0,256));
   if(profile==='source'){expect(result).toMatchObject({ok:false,error:{kind:'input'}});expect(f.receivedPacket()).toEqual(before);expect(await f.send(advance(0,16))).toMatchObject({ok:true});}
   else expect(result).toMatchObject({ok:true});
   expect(await f.send(release())).toMatchObject({ok:true});expect(f.service.sessionStarts).toBe(1);
  }finally{await f.close();}
 });
 it.each(['source-kind','source-index','source-uploaded','source-total','source-reserved'])('retires the actual child on forged %s create ACK, clearing every family',async mode=>{
  const f=await fixture(mode);try{
   expect(await f.sendOther(control(5,1))).toMatchObject({ok:true});expect(f.service.retainedResourceCount).toBe(1);
   expect(await f.send(createSource())).toMatchObject({ok:false,error:{kind:'protocol'}});expect(f.service.retainedResourceCount).toBe(0);expect(f.service.processCount).toBe(0);expect(f.service.activeCount).toBe(0);expect(f.service.canAcquireLease).toBe(true);
  }finally{await f.close();}
 });
 it('rejects a forged successful duplicate ACK rather than replacing an existing profile',async()=>{
  const f=await fixture('duplicate-ack');try{
   expect(await f.send(createSource())).toMatchObject({ok:true});expect(await f.send(create())).toMatchObject({ok:false,error:{kind:'protocol'}});
   expect(f.service.processCount).toBe(0);expect(f.service.retainedResourceCount).toBe(0);expect(f.service.canAcquireLease).toBe(true);
  }finally{await f.close();}
 });
 it('keeps source profile tokens separate from Samila and Bouncing releases',async()=>{
  const f=await initialized('normal',500,createSource());try{
   for(const b of [control(5,1),control(4,1),control(5,3),control(4,4)])expect(await f.sendOther(b)).toMatchObject({ok:true});
   expect(f.service.retainedResourceCount).toBe(1);const before=f.receivedPacket();expect(await f.send(advance(1,17))).toMatchObject({ok:false,error:{kind:'input'}});expect(f.receivedPacket()).toEqual(before);
   expect(await f.send(release())).toMatchObject({ok:true});expect(f.service.retainedResourceCount).toBe(0);expect(f.service.canAcquireLease).toBe(true);
  }finally{await f.close();}
 });
 it('rejects invalid create-source version, framing and count before starting a child',async()=>{
  const f=await fixture();try{
   for(const [at,value]of [[4,6],[88,0],[88,8000001]]){const b=packet(createSource()).packet;b.writeUInt32LE(value,at);expect(await f.service.render(b)).toMatchObject({ok:false,error:{kind:'input'}});}
   const short=packet(createSource()).packet.subarray(0,107);short.writeUInt32LE(short.length,8);expect(await f.service.render(short)).toMatchObject({ok:false,error:{kind:'input'}});
   expect(f.service.sessionStarts).toBe(0);expect(f.service.processCount).toBe(0);expect(f.service.retainedResourceCount).toBe(0);
  }finally{await f.close();}
 });
 it('retires source runtime failures through exact child close, releasing all retained families',async()=>{
  const f=await initialized('runtime',500,createSource());try{
   expect(await f.sendOther(control(5,1))).toMatchObject({ok:true});expect(await f.send(read())).toMatchObject({ok:false,error:{kind:'runtime'}});
   expect(f.service.processCount).toBe(0);expect(f.service.retainedResourceCount).toBe(0);expect(f.service.canAcquireLease).toBe(true);
   for(const op of [create(),upload(),advance(0,256)])expect(await f.send(op)).toMatchObject({ok:true,value:{sessionSerial:2}});
  }finally{await f.close();}
 });
 it('confirms child close after a source create runtime failure before publishing an available lease',async()=>{
  const f=await fixture('source-runtime');try{
   expect(await f.send(createSource())).toMatchObject({ok:false,error:{kind:'runtime'}});
   expect(f.service.sessionStarts).toBe(1);expect(f.service.processCount).toBe(0);expect(f.service.retainedResourceCount).toBe(0);expect(f.service.activeCount).toBe(0);expect(f.service.canAcquireLease).toBe(true);
   expect(await f.send(create())).toMatchObject({ok:true,value:{sessionSerial:2}});
  }finally{await f.close();}
 });
 it('retains source profiles when runtime process cleanup fails until explicit reset confirms close',async()=>{
  const f=await initialized('runtime',60,createSource());let kill:MockInstance<ChildProcess['kill']>|undefined;
  try{
   expect(await f.sendOther(control(5,1))).toMatchObject({ok:true});kill=vi.spyOn(ChildProcess.prototype,'kill').mockReturnValue(false);
   expect(await f.send(read())).toMatchObject({ok:false,error:{kind:'cleanup'}});expect(f.service.processCount).toBe(1);expect(f.service.retainedResourceCount).toBe(2);expect(f.service.canAcquireLease).toBe(false);
   expect(await f.send(create(other))).toMatchObject({ok:false,error:{kind:'capacity'}});expect(f.service.sessionStarts).toBe(1);
   kill.mockRestore();kill=undefined;expect(await f.service.reset()).toMatchObject({ok:true});expect(f.service.processCount).toBe(0);expect(f.service.retainedResourceCount).toBe(0);expect(f.service.canAcquireLease).toBe(true);
  }finally{kill?.mockRestore();await f.close();}
 });
 it.each([6,7] as const)('passes 2D and 3D v%s advances through the actual child pipe in the existing field layout',async version=>{
  const f=await fixture();try{
   for(const op of [create(),upload()])expect(await f.send(op)).toMatchObject({ok:true});
   const packets:Buffer[]=[];
   for(const dimension of [2,3] as const){
    const op:SourceIteratedNativeOperation={kind:'advance',resource:token,expectedIndex:dimension-2,expectedCount:2,reset:false,...(version===7?{resetCounter:true}:{}),dimension,steps:5,uniforms:[{name:'gain',value:.25}]};
    const result=await f.send(op);expect(result).toMatchObject({ok:true});
    expect(decodeSourceIteratedNativeResponse(result.value.pixels,{generation:7,sequence:dimension+1,operation:op})).toMatchObject({index:dimension-1,uploaded:2,totalCount:2,steps:5});
    const b=f.receivedPacket(),at=version===7?100:96;packets.push(b);
    expect([b.readUInt32LE(4),b.readUInt32LE(60),b.readUInt32LE(64),b.readUInt32LE(88),b.readUInt32LE(92),b.readUInt32LE(at),b.readUInt32LE(at+4),b.readUInt32LE(at+8)]).toEqual([version,2,3,dimension-2,0,dimension,5,1]);
    if(version===7)expect(b.readUInt32LE(96)).toBe(1);
   }
   // Account only for the sequence/checkpoint of the second accepted advance
   // and its dimension; shader uniforms and the rest of the wire stay equal.
   packets[1].writeUInt32LE(3,16);packets[1].writeUInt32LE(0,88);packets[1].writeUInt32LE(2,version===7?100:96);expect(packets[1]).toEqual(packets[0]);
   expect(f.service.retainedResourceCount).toBe(1);expect(f.service.sessionStarts).toBe(1);expect(await f.send(release())).toMatchObject({ok:true});expect(f.service.retainedResourceCount).toBe(0);
  }finally{await f.close();}
 });
 it('rejects dimensions 1 and 4 at the v6/v7 gateway before any child starts',async()=>{
  const f=await fixture();try{
   for(const version of [6,7])for(const dimension of [1,4]){
    const op=advance();if(op.kind!=='advance')throw Error('fixture');if(version===7)op.resetCounter=true;
    const b=packet(op).packet;b.writeUInt32LE(dimension,version===7?100:96);expect(await f.sendOther(b)).toMatchObject({ok:false,error:{kind:'input'}});
   }
   expect(f.service.sessionStarts).toBe(0);expect(f.service.processCount).toBe(0);expect(f.service.activeCount).toBe(0);expect(f.service.retainedResourceCount).toBe(0);
   expect(await f.send(create())).toMatchObject({ok:true});expect(await f.send(release())).toMatchObject({ok:true});
  }finally{await f.close();}
 });
 it('handles fragmented ACK/read buffers and retains ownership until exact/idempotent release',async()=>{
  const f=await initialized('fragment');try{
   expect(f.service.retainedResourceCount).toBe(1);expect(f.service.canAcquireLease).toBe(false);
   const result=await f.send(read());expect(result).toMatchObject({ok:true,value:{format:'iterated-v1',rowOrder:'none',width:1,height:1,sequence:4,contextSerial:1,sessionSerial:1}});
   const decoded=decodeSourceIteratedNativeResponse(result.value.pixels,{generation:7,sequence:4,operation:read()});expect(Array.from(new Uint32Array(decoded.positionsAndMetric!.buffer))).toEqual([0x7fa12345,0x80000000,0x7f800000,0xff800000]);
   expect(await f.send(release())).toMatchObject({ok:true});expect(f.service.retainedResourceCount).toBe(0);expect(f.service.canAcquireLease).toBe(true);
   const absent=await f.send(release());expect(absent.value.pixels.readUInt32LE(28)).toBe(2);expect(f.service.sessionStarts).toBe(1);
  }finally{await f.close();}
 });
 it('keeps coincident tokens isolated across iterated, Samila and Bouncing families',async()=>{
  const f=await initialized();try{
   expect(await f.sendOther(control(5,1))).toMatchObject({ok:true});expect(await f.sendOther(control(4,1))).toMatchObject({ok:true});expect(f.service.retainedResourceCount).toBe(3);
   await f.send(release(other));expect(f.service.retainedResourceCount).toBe(3);await f.send(release());expect(f.service.retainedResourceCount).toBe(2);
   await f.sendOther(control(5,3));expect(f.service.retainedResourceCount).toBe(1);expect(f.service.canAcquireLease).toBe(false);await f.sendOther(control(4,4));expect(f.service.retainedResourceCount).toBe(0);expect(f.service.canAcquireLease).toBe(true);
  }finally{await f.close();}
 });
 it.each(['family','kind','resource','index','disposition','uploaded','total','offset','count','steps','reserved','validity','format','extra'])('retires the owned process on malformed read %s and clears every family registry',async mode=>{
  const f=await initialized(mode);try{
   await f.sendOther(control(5,1));expect(f.service.retainedResourceCount).toBe(2);expect(await f.send(read())).toMatchObject({ok:false,error:{kind:'protocol'}});
   expect(f.service.processCount).toBe(0);expect(f.service.retainedResourceCount).toBe(0);expect(f.service.canAcquireLease).toBe(true);expect(f.service.activeCount).toBe(0);
  }finally{await f.close();}
 });
 it('rejects a released ACK with zero total instead of prematurely publishing lease availability',async()=>{
  const f=await initialized('release-empty');try{expect(await f.send(release())).toMatchObject({ok:false,error:{kind:'protocol'}});expect(f.service.processCount).toBe(0);expect(f.service.retainedResourceCount).toBe(0);}finally{await f.close();}
 });
 it('rejects malformed neutral envelopes before starting the child',async()=>{
  const f=await fixture();try{
   for(const [at,value]of [[20,2],[28,1],[48,1],[52,1],[56,1],[60,1],[68,12]]){const input=packet(create()).packet;input.writeUInt32LE(value,at);expect((await f.service.render(input)).ok).toBe(false);}
   expect(f.service.sessionStarts).toBe(0);expect(f.service.processCount).toBe(0);
  }finally{await f.close();}
 });
 it.each(['generic','source'] as const)('cancels an actual in-flight %s read and releases the child and every retained resource',async profile=>{
  const f=await initialized('hang-read',500,profile==='source'?createSource():create()),controller=new AbortController();try{
   await f.sendOther(control(5,1));const pending=f.send(read(),controller.signal);await f.ready();expect(f.service.activeCount).toBe(1);expect(await f.send(create(other))).toMatchObject({ok:false,error:{kind:'capacity'}});
   controller.abort();expect(await pending).toMatchObject({ok:false,error:{kind:'cancelled'}});expect(f.service.processCount).toBe(0);expect(f.service.retainedResourceCount).toBe(0);
   expect(await f.send(create(other))).toMatchObject({ok:true,value:{sessionSerial:2}});
  }finally{controller.abort();await f.close();}
 });
 it.each(['generic','source'] as const)('retains an unacknowledged %s create owner when process cleanup fails, until explicit retry confirms exit',async profile=>{
  const f=await fixture('hang-create',60),controller=new AbortController();let kill:MockInstance<ChildProcess['kill']>|undefined;
  try{
   const pending=f.send(profile==='source'?createSource():create(),controller.signal);await f.ready();kill=vi.spyOn(ChildProcess.prototype,'kill').mockReturnValue(false);controller.abort();
   expect(await pending).toMatchObject({ok:false,error:{kind:'cleanup'}});expect(f.service.processCount).toBe(1);expect(f.service.activeCount).toBe(0);expect(f.service.retainedResourceCount).toBe(0);expect(f.service.canAcquireLease).toBe(false);
   expect(await f.send(create(other))).toMatchObject({ok:false,error:{kind:'capacity'}});expect(f.service.sessionStarts).toBe(1);
   kill.mockRestore();kill=undefined;expect(await f.service.reset()).toMatchObject({ok:true});expect(f.service.processCount).toBe(0);expect(f.service.canAcquireLease).toBe(true);
  }finally{kill?.mockRestore();controller.abort();await f.close();}
 });
 it.each(['runtime','state-lost'])('keeps the distinction between shared context %s and explicit release',async mode=>{
  const f=await initialized(mode);try{await f.sendOther(control(5,1));expect(await f.send(read())).toMatchObject({ok:false,error:{kind:mode}});expect(f.service.processCount).toBe(1);expect(f.service.retainedResourceCount).toBe(mode==='runtime'?0:2);if(mode==='state-lost'){await f.send(release());expect(f.service.retainedResourceCount).toBe(1);}}finally{await f.close();}
 });
});
