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
const create=(resource=token):SourceIteratedNativeOperation=>({kind:'create',resource,count:2,...shaders});
const upload=():SourceIteratedNativeOperation=>({kind:'upload',resource:token,expectedIndex:0,expectedCount:2,offset:0,positionsAndMetric:new Float32Array(8)});
const advance=():SourceIteratedNativeOperation=>({kind:'advance',resource:token,expectedIndex:0,expectedCount:2,reset:false,dimension:2,steps:0,uniforms:[]});
const read=():SourceIteratedNativeOperation=>({kind:'read',resource:token,expectedIndex:1,expectedCount:2,offset:1,count:1});
const release=(resource=token):SourceIteratedNativeOperation=>({kind:'release',resource,expectedCount:2});
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
 const version=b.readUInt32LE(4),iterated=version===6||version===7,samila=version===5,kind=b.readUInt32LE(version>=5?64:60),resource=b.subarray(version>=5?72:68,version>=5?88:84),key=(iterated?'iterated':version)+':'+resource.toString('hex');
 writeFileSync(${JSON.stringify(received)},String(b.readUInt32LE(16)));
 writeFileSync(${JSON.stringify(received+'.packet')},b);
 if(iterated&&(mode==='hang-create'&&kind===1||mode==='hang-read'&&kind===4))return;
 let payload,status=0,format=iterated?4:samila?3:2;
 if(iterated){
  let state=states.get(key);if(kind===1){state={index:0,uploaded:0,total:2};states.set(key,state);}
  if(kind===2&&state)state.uploaded=2;if(kind===3&&state)state.index++;
  const count=kind===4?b.readUInt32LE(96):0;payload=Buffer.alloc(64+count*24);payload.writeUInt32LE(2,0);payload.writeUInt32LE(kind,4);resource.copy(payload,8);
  if(state){payload.writeUInt32LE(state.index,24);payload.writeUInt32LE(state.uploaded,32);payload.writeUInt32LE(state.total,36);}
  if(kind===4){payload.writeUInt32LE(b.readUInt32LE(92),40);payload.writeUInt32LE(count,44);for(let i=0;i<count;i++){payload.writeUInt32LE(0x7fa12345,64+i*24);payload.writeUInt32LE(0x80000000,68+i*24);payload.writeUInt32LE(0x7f800000,72+i*24);payload.writeUInt32LE(0xff800000,76+i*24);payload.writeUInt32LE(0xffffffff,80+i*24);payload.writeUInt32LE(1,84+i*24);}}
  if(kind===3)payload.writeUInt32LE(b.readUInt32LE(version===7?104:100),48);
  if(kind===5){payload.writeUInt32LE(state?1:2,28);states.delete(key);}
  if(kind===4){
   const offsets={family:0,kind:4,index:24,disposition:28,uploaded:32,offset:40,count:44,steps:48,reserved:60,validity:84};
   if(mode in offsets)payload.writeUInt32LE(payload.readUInt32LE(offsets[mode])+1,offsets[mode]);if(mode==='total')payload.writeUInt32LE(0,36);if(mode==='resource')payload[8]^=1;
   if(mode==='format')format=3;if(mode==='extra')payload=Buffer.concat([payload,Buffer.from([1])]);
   if(mode==='runtime'||mode==='state-lost'){status=mode==='runtime'?4:5;format=0;payload=Buffer.from(mode);if(status===4)states.clear();}
  }
  if(kind===5&&mode==='release-empty'){payload.writeUInt32LE(0,32);payload.writeUInt32LE(0,36);}
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
async function initialized(mode='normal',cleanupMs=500){const f=await fixture(mode,cleanupMs);try{for(const op of [create(),upload(),advance()])expect(await f.send(op)).toMatchObject({ok:true});return f;}catch(e){await f.close();throw e;}}

describe('v6/v7 gateway with actual owned CPU child pipes',()=>{
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
 it('cancels an actual in-flight read and releases the child and every retained resource',async()=>{
  const f=await initialized('hang-read'),controller=new AbortController();try{
   await f.sendOther(control(5,1));const pending=f.send(read(),controller.signal);await f.ready();expect(f.service.activeCount).toBe(1);expect(await f.send(create(other))).toMatchObject({ok:false,error:{kind:'capacity'}});
   controller.abort();expect(await pending).toMatchObject({ok:false,error:{kind:'cancelled'}});expect(f.service.processCount).toBe(0);expect(f.service.retainedResourceCount).toBe(0);
   expect(await f.send(create(other))).toMatchObject({ok:true,value:{sessionSerial:2}});
  }finally{controller.abort();await f.close();}
 });
 it('retains an unacknowledged create owner when process cleanup fails, until explicit retry confirms exit',async()=>{
  const f=await fixture('hang-create',60),controller=new AbortController();let kill:MockInstance<ChildProcess['kill']>|undefined;
  try{
   const pending=f.send(create(),controller.signal);await f.ready();kill=vi.spyOn(ChildProcess.prototype,'kill').mockReturnValue(false);controller.abort();
   expect(await pending).toMatchObject({ok:false,error:{kind:'cleanup'}});expect(f.service.processCount).toBe(1);expect(f.service.activeCount).toBe(0);expect(f.service.retainedResourceCount).toBe(0);expect(f.service.canAcquireLease).toBe(false);
   expect(await f.send(create(other))).toMatchObject({ok:false,error:{kind:'capacity'}});expect(f.service.sessionStarts).toBe(1);
   kill.mockRestore();kill=undefined;expect(await f.service.reset()).toMatchObject({ok:true});expect(f.service.processCount).toBe(0);expect(f.service.canAcquireLease).toBe(true);
  }finally{kill?.mockRestore();controller.abort();await f.close();}
 });
 it.each(['runtime','state-lost'])('keeps the distinction between shared context %s and explicit release',async mode=>{
  const f=await initialized(mode);try{await f.sendOther(control(5,1));expect(await f.send(read())).toMatchObject({ok:false,error:{kind:mode}});expect(f.service.processCount).toBe(1);expect(f.service.retainedResourceCount).toBe(mode==='runtime'?0:2);if(mode==='state-lost'){await f.send(release());expect(f.service.retainedResourceCount).toBe(1);}}finally{await f.close();}
 });
});
