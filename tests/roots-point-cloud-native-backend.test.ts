import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const transport=vi.hoisted(()=>({transaction:vi.fn(),release:vi.fn()}));
vi.mock('../src/engine/sourceNativeClient',()=>({withSourceRootsPointNativeTransaction:transport.transaction,releaseSourceRootsPointNative:transport.release}));
import {RootsPointCloudNativeBackend,type RootsPointNativeBegin} from '../src/engine/rootsPointCloudNativeBackend';
import {rootsPointCloudPrograms,prepareRootsPointFrame} from '../src/engine/rootsPointCloudDrawing';
import {defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import {prepareRootsProjection} from '../src/engine/rootsProjection';
import {prepareRootsDensityColor,ROOTS_DENSITY_COLOR_VERSION} from '../src/engine/rootsDensityColor';
import {captureSourceRootsPointNativeResponseBinding,decodeSourceRootsPointNativeResponse,encodeSourceRootsPointNativeRequest,sourceRootsPointNativeResponseBytes,type SourceRootsPointNativeRequest} from '../src/engine/sourceRootsPointNativeProtocol';
import type {SourceNativeRootsPointResponse,SourceRootsPointNativeExchange} from '../src/engine/sourceNativeClient';
import {SourceNativeError} from '../src/engine/sourceNativeError';

const programs=()=>rootsPointCloudPrograms('native-gl41');
const size={width:8,height:6};
function input(count=3):RootsPointNativeBegin {
 const c=defaultRootsPresentationConfiguration();c.mode='point-cloud';const plan=prepareRootsProjection(c,{...size,viewport:{logicalWidth:8,logicalHeight:6,referenceLogicalHeight:6,target:'primary'}});
 const color=prepareRootsDensityColor({settings:{rootDensityColorVersion:ROOTS_DENSITY_COLOR_VERSION,background:'#000000'}});if(color.kind!=='metric-sum')throw Error();
 return{metadata:prepareRootsPointFrame(plan,color,true),rangeCounts:count?[count]:[],chunkPoints:2};
}
function deferred<T>(){let resolve!:(v:T|PromiseLike<T>)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const owners:RootsPointCloudNativeBackend[]=[];
const records:{request:SourceRootsPointNativeRequest;retainedBytes:number;wire:Uint8Array}[]=[];
const remote=new Map<string,{reply:SourceNativeRootsPointResponse;color:number}>();let slot=false,serial=10,nextColor=40;
const exchange=vi.fn<SourceRootsPointNativeExchange>();
function owner(options:ConstructorParameters<typeof RootsPointCloudNativeBackend>[0]={}){const o=new RootsPointCloudNativeBackend(options);owners.push(o);return o;}
function kinds(){return records.map(r=>r.request.operation.kind);}
async function respond(r:SourceRootsPointNativeRequest,options:{retainedBytes?:number}={}):Promise<SourceNativeRootsPointResponse> {
 const encoded=encodeSourceRootsPointNativeRequest(r,options);if(!encoded.ok)throw new SourceNativeError(encoded.error.kind,encoded.error.reason);
 records.push({request:structuredClone(r),retainedBytes:options.retainedBytes??0,wire:encoded.value});const op=r.operation,previous=remote.get(op.resource);
 if(op.kind==='create'&&previous)throw new SourceNativeError('ownership','foreign token');
 if(op.kind!=='create'&&op.kind!=='release'&&!previous)throw new SourceNativeError('state-lost','target absent');
 const binding=captureSourceRootsPointNativeResponseBinding(r),bytes=new Uint8Array(sourceRootsPointNativeResponseBytes(binding)),view=new DataView(bytes.buffer);
 const fields:Record<number,number>={0:7,4:{create:1,begin:2,append:3,finish:4,release:5}[op.kind],24:binding.displayIndex??previous?.reply.displayIndex??0,28:op.kind==='release'?(previous?1:2):0,32:op.kind==='release'?(previous?.reply.width??1):r.width,36:op.kind==='release'?(previous?.reply.height??1):r.height,40:binding.phase==='active'?1:op.kind==='release'?(previous?.reply.phase==='active'?1:0):0,44:binding.receivedPoints??previous?.reply.receivedPoints??0,48:binding.totalPoints??previous?.reply.totalPoints??0,52:binding.nextChunk??previous?.reply.nextChunk??0,56:binding.totalChunks??previous?.reply.totalChunks??0,60:binding.pointDraws??previous?.reply.pointDraws??0,64:binding.fadeDraws??previous?.reply.fadeDraws??0,68:binding.clears??previous?.reply.clears??0,80:op.kind==='release'&&!previous?0:1};
 for(const [offset,value]of Object.entries(fields))view.setUint32(Number(offset),value,true);
 for(let i=0;i<16;i++)bytes[8+i]=parseInt(op.resource.slice(i*2,i*2+2),16);
 view.setFloat32(72,fields[28]===2?0:1,true);view.setFloat32(76,fields[28]===2?0:64,true);
 const color=previous?.color??nextColor++;if(op.kind==='finish')bytes.fill(color,96);
 const reply:SourceNativeRootsPointResponse={...decodeSourceRootsPointNativeResponse(bytes,binding),generation:r.generation,sequence:r.sequence,rendererIdentity:'a'.repeat(64),contextSerial:fields[28]===2?0:serial,sessionSerial:5,requestBytes:encoded.value.length};
 if(op.kind==='release')remote.delete(op.resource);else remote.set(op.resource,{reply,color});return reply;
}
async function complete(o:RootsPointCloudNativeBackend,target:'primary'|'offscreen'='primary'){
 await o.begin(target,input());await o.append(target,{ordinal:0,rangeIndex:0,rangeOffset:0,points:new Float32Array(8)});await o.append(target,{ordinal:1,rangeIndex:0,rangeOffset:2,points:new Float32Array(4)});return o.finish(target);
}
beforeEach(()=>{
 records.length=0;remote.clear();slot=false;serial=10;nextColor=40;exchange.mockReset().mockImplementation(respond);
 transport.transaction.mockReset().mockImplementation(async(perform:(send:SourceRootsPointNativeExchange)=>Promise<unknown>)=>{if(slot)throw new SourceNativeError('capacity','slot busy');slot=true;try{return await perform(exchange);}finally{slot=false;}});
 transport.release.mockReset().mockImplementation(async(r:SourceRootsPointNativeRequest)=>{if(slot)throw new SourceNativeError('capacity','slot busy');return exchange(r);});
});
afterEach(async()=>{exchange.mockImplementation(respond);for(const o of owners.splice(0))await o.release();expect(remote.size).toBe(0);expect(slot).toBe(false);vi.restoreAllMocks();});
describe('page Roots point native target ownership (mock transport, CPU only)',()=>{
 it('holds one slot across a complete frame and retains two independent targets between frames',async()=>{
  const o=owner();await o.initialize('primary',size,programs());await o.initialize('offscreen',size,programs());expect(slot).toBe(false);
  await o.begin('primary',input());expect(slot).toBe(true);await expect(o.begin('offscreen',input())).rejects.toMatchObject({kind:'capacity'});
  await o.append('primary',{ordinal:0,rangeIndex:0,rangeOffset:0,points:new Float32Array(8)});await o.append('primary',{ordinal:1,rangeIndex:0,rangeOffset:2,points:new Float32Array(4)});const first=await o.finish('primary');expect(slot).toBe(false);
  const second=await complete(o,'offscreen'),again=await complete(o);expect(first.pixels![0]).not.toBe(second.pixels![0]);expect(again.pixels![0]).toBe(first.pixels![0]);expect(again.displayIndex).toBe(2);expect(o.diagnostics().targets.map(t=>t.displayIndex)).toEqual([2,1]);expect(transport.transaction).toHaveBeenCalledTimes(5);
 });
 it('does not retain finish pixel buffers after transfer to the Worker',async()=>{
  const o=owner();await o.initialize('primary',size,programs());const r=await complete(o),pixels=r.pixels!;structuredClone(pixels,{transfer:[pixels.buffer]});expect(pixels.byteLength).toBe(0);const next=await complete(o);expect(next.pixels!.length).toBe(192);expect(next.displayIndex).toBe(2);
 });
 it('rejects duplicate/skipped/incomplete chunks before sending and permits the correct next ACK',async()=>{
  const o=owner();await o.initialize('primary',size,programs());await o.begin('primary',input());const n=records.length;
  await expect(o.append('primary',{ordinal:1,rangeIndex:0,rangeOffset:2,points:new Float32Array(4)})).rejects.toThrow('next');await expect(o.finish('primary')).rejects.toThrow('every chunk');expect(records.length).toBe(n);
  await o.append('primary',{ordinal:0,rangeIndex:0,rangeOffset:0,points:new Float32Array(8)});await expect(o.append('primary',{ordinal:0,rangeIndex:0,rangeOffset:0,points:new Float32Array(8)})).rejects.toThrow('next');await o.append('primary',{ordinal:1,rangeIndex:0,rangeOffset:2,points:new Float32Array(4)});await o.finish('primary');
 });
 it('captures programs, metadata and schedule before a delayed transaction callback',async()=>{
  const o=owner(),gate=deferred<void>(),entered=deferred<void>();transport.transaction.mockImplementationOnce(async(perform:(send:SourceRootsPointNativeExchange)=>Promise<unknown>)=>{slot=true;entered.resolve();await gate.promise;try{return await perform(exchange);}finally{slot=false;}});
  const p=structuredClone(programs()),original=p.point.vertex,init=o.initialize('primary',size,p);await entered.promise;Object.assign(p.point,{vertex:'bad'});gate.resolve();await init;expect(records[0].request.operation).toMatchObject({kind:'create',programs:{point:{vertex:original}}});
  const wait=deferred<void>();transport.transaction.mockImplementationOnce(async(perform:(send:SourceRootsPointNativeExchange)=>Promise<unknown>)=>{slot=true;await wait.promise;try{return await perform(exchange);}finally{slot=false;}});
  const m=input(),begin=o.begin('primary',m);m.rangeCounts=[999];m.metadata.palette.fill(123);const u=m.metadata.uniforms[0];if(u.kind==='sampler2d')throw Error();u.values[0]=99;wait.resolve();await begin;
  const sent=records.at(-1)!.request.operation;if(sent.kind!=='begin')throw Error();expect(sent.rangeCounts).toEqual([3]);expect(sent.metadata.palette[0]).not.toBe(123);expect(sent.metadata.uniforms[0]).not.toMatchObject({values:new Float32Array([99])});
 });
 it('commits a late finish ACK before cancellation cleanup and never passes a user abort signal',async()=>{
  const o=owner();await o.initialize('primary',size,programs());await o.begin('primary',input(0));const ack=deferred<void>(),entered=deferred<void>(),releaseAck=deferred<void>();
  exchange.mockImplementation(async(r,options)=>{const result=await respond(r,options);if(r.operation.kind==='finish'){entered.resolve();await ack.promise;}if(r.operation.kind==='release')await releaseAck.promise;return result;});
  const finish=o.finish('primary');await entered.promise;const cleanup=o.release();expect(kinds()).not.toContain('release');await expect(o.begin('primary',input())).rejects.toMatchObject({kind:'capacity'});ack.resolve();const done=await finish;expect(done.displayIndex).toBe(1);
  await vi.waitFor(()=>expect(kinds().at(-1)).toBe('release'));expect(o.diagnostics().targets[0].displayIndex).toBe(1);expect(exchange.mock.calls.every(([,options])=>!options||!('signal'in options))).toBe(true);releaseAck.resolve();await cleanup;
 });
 it('retains the held frame after append/release failures and retries exact cleanup',async()=>{
  const o=owner();await o.initialize('primary',size,programs());await o.begin('primary',input());exchange.mockImplementationOnce(async(r,opt)=>{await respond(r,opt);throw Error('append ACK lost');});
  await expect(o.append('primary',{ordinal:0,rangeIndex:0,rangeOffset:0,points:new Float32Array(8)})).rejects.toThrow('ACK lost');expect(slot).toBe(true);expect(o.diagnostics().cleanupPending).toBe(true);
  exchange.mockRejectedValueOnce(Error('release lost'));await expect(o.release()).rejects.toThrow('release lost');expect(o.diagnostics().targets).toHaveLength(1);expect(slot).toBe(true);await expect(o.finish('primary')).rejects.toMatchObject({kind:'state-lost'});
  await o.release();expect(slot).toBe(false);expect(transport.release).not.toHaveBeenCalled();expect(o.diagnostics().targets).toHaveLength(0);
 });
 it('retains uncertain create custody, including cleanup retry after an already-executed release',async()=>{
  const o=owner();exchange.mockImplementationOnce(async(r,opt)=>{await respond(r,opt);throw Error('create ACK lost');});await expect(o.initialize('primary',size,programs())).rejects.toThrow('ACK lost');expect(remote.size).toBe(1);
  exchange.mockImplementationOnce(async(r,opt)=>{await respond(r,opt);throw Error('release ACK lost');});await expect(o.release()).rejects.toThrow('ACK lost');expect(remote.size).toBe(0);expect(o.diagnostics().targets).toHaveLength(1);await o.release();expect(o.diagnostics().targets).toHaveLength(0);
 });
 it('does not retain or release a provisional create that never entered its send callback',async()=>{
  const o=owner();transport.transaction.mockRejectedValueOnce(new SourceNativeError('unavailable','lease unavailable'));
  await expect(o.initialize('primary',size,programs())).rejects.toThrow('lease unavailable');expect(o.diagnostics().targets).toHaveLength(0);await o.release();expect(exchange).not.toHaveBeenCalled();expect(transport.release).not.toHaveBeenCalled();
  await o.initialize('primary',size,programs());expect(o.diagnostics().targets).toHaveLength(1);
 });
 it('closes an unsubmitted begin gate without invalidating the existing target',async()=>{
  const o=owner();await o.initialize('primary',size,programs());transport.transaction.mockRejectedValueOnce(new SourceNativeError('unavailable','lease unavailable'));
  await expect(o.begin('primary',input())).rejects.toThrow('lease unavailable');expect(o.diagnostics()).toMatchObject({cleanupPending:false,transactionTarget:undefined});expect(kinds()).toEqual(['create']);expect(slot).toBe(false);
  expect((await complete(o)).displayIndex).toBe(1);expect(kinds().filter(k=>k==='create')).toHaveLength(1);
 });
 it('does not release a foreign token after an explicit create ownership rejection',async()=>{
  const a=owner();await a.initialize('primary',size,programs());const token=a.diagnostics().targets[0].resource;
  vi.spyOn(crypto,'randomUUID').mockReturnValue(`${token.slice(0,8)}-${token.slice(8,12)}-${token.slice(12,16)}-${token.slice(16,20)}-${token.slice(20)}` as ReturnType<Crypto['randomUUID']>);
  const b=owner();await expect(b.initialize('primary',size,programs())).rejects.toMatchObject({kind:'ownership'});await b.release();expect(transport.release).not.toHaveBeenCalled();expect(remote.has(token)).toBe(true);expect(b.diagnostics().targets).toHaveLength(0);
 });
 it('keeps renderer/context identity per target and can clean an old target after context loss',async()=>{
  const o=owner();await o.initialize('primary',size,programs());const old=o.diagnostics().targets[0].resource;remote.delete(old);serial=11;await o.initialize('offscreen',size,programs());expect(o.diagnostics().targets.map(t=>t.contextSerial)).toEqual([10,11]);await o.release('primary');expect(o.diagnostics().targets.map(t=>t.target)).toEqual(['offscreen']);await complete(o,'offscreen');
 });
 it('retains cleanup custody after a mismatched context ACK instead of publishing it',async()=>{
  const o=owner();await o.initialize('primary',size,programs());exchange.mockImplementationOnce(async(r,opt)=>({...await respond(r,opt),contextSerial:99}));await expect(o.begin('primary',input())).rejects.toMatchObject({kind:'state-lost'});expect(o.diagnostics().cleanupPending).toBe(true);await o.release();
 });
 it('charges all page point owners without duplicating provisional create',async()=>{
  const a=owner({retainedBytes:()=>192});await a.initialize('primary',size,programs());expect(records[0].retainedBytes).toBe(192);const bytes=a.diagnostics().retainedBytes;
  const b=owner();await b.initialize('primary',size,programs());expect(records[1].retainedBytes).toBe(bytes);const c=owner();await c.initialize('offscreen',size,programs());expect(records[2].retainedBytes).toBe(bytes+b.diagnostics().retainedBytes);expect(remote.size).toBe(3);
 });
 it('admits future readback before begin mutates a large target and rechecks finish headroom',async()=>{
  let extra=0;const o=owner({retainedBytes:()=>extra});await o.initialize('primary',{width:2048,height:2048},programs());extra=256*1024*1024-20_000_000;
  await expect(o.begin('primary',input(0))).rejects.toMatchObject({kind:'capacity'});expect(kinds()).toEqual(['create']);expect(o.diagnostics().cleanupPending).toBe(false);extra=0;await o.release();
  await o.initialize('primary',size,programs());await o.begin('primary',input(0));extra=256*1024*1024;const before=records.length;await expect(o.finish('primary')).rejects.toMatchObject({kind:'capacity'});expect(records.length).toBe(before);extra=0;expect((await o.finish('primary')).displayIndex).toBe(1);
 });
 it('rejects an impossible future append before begin sends or clears the small target',async()=>{
  let extra=0;const o=owner({retainedBytes:()=>extra});await o.initialize('primary',size,programs());extra=256*1024*1024-o.diagnostics().retainedBytes-1_000_000;
  const request=input(65536);request.chunkPoints=65536;await expect(o.begin('primary',request)).rejects.toMatchObject({kind:'capacity'});expect(kinds()).toEqual(['create']);expect(o.diagnostics()).toMatchObject({cleanupPending:false,transactionTarget:undefined});extra=0;
 });
 it('requires explicit release before size/program replacement and keeps other target intact',async()=>{
  const o=owner();await o.initialize('primary',size,programs());await o.initialize('offscreen',size,programs());const n=records.length;await expect(o.initialize('primary',{width:9,height:6},programs())).rejects.toThrow('Release');expect(records.length).toBe(n);
  await o.release('primary');await o.initialize('primary',{width:9,height:6},programs());expect(o.diagnostics().targets.find(t=>t.target==='offscreen')?.width).toBe(8);
 });
 it('does not mistake a concurrent specific-target cleanup for cleanup of every target',async()=>{
  const o=owner();await o.initialize('primary',size,programs());await o.initialize('offscreen',size,programs());const gate=deferred<void>(),entered=deferred<void>();exchange.mockImplementationOnce(async(r,opt)=>{const result=await respond(r,opt);entered.resolve();await gate.promise;return result;});
  const first=o.release('primary');await entered.promise;const all=o.release();gate.resolve();await Promise.all([first,all]);expect(o.diagnostics().targets).toHaveLength(0);expect(kinds().filter(k=>k==='release')).toHaveLength(2);
 });
 it('settle waits for an ACK but not an intentionally open display gate',async()=>{
  const o=owner();await o.initialize('primary',size,programs());await o.begin('primary',input(0));await o.settle();expect(slot).toBe(true);await o.release();await o.settle();expect(slot).toBe(false);
 });
});
