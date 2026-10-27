import {afterEach,describe,expect,it,vi} from 'vitest';
import {RootsPointCloudPageBroker} from '../src/engine/rootsPointCloudPageBroker';
import {SourceNativeError} from '../src/engine/sourceNativeError';
import {rootsPointCloudPrograms} from '../src/engine/rootsPointCloudDrawing';
import {captureSourceRootsPointNativeResponseBinding,decodeSourceRootsPointNativeResponse,sourceRootsPointNativeFrameSchedule,type SourceRootsPointNativeFrameSchedule,type SourceRootsPointNativeRequest} from '../src/engine/sourceRootsPointNativeProtocol';
import type {SourceNativeRootsPointResponse} from '../src/engine/sourceNativeClient';
import type {RootsPointNativeAppend,RootsPointNativeBegin,RootsPointNativeTarget} from '../src/engine/rootsPointCloudNativeBackend';
import type {RootsNativeCommandRequest,RootsNativeCommandResponse,RootsPointBrokerCommand} from '../src/engine/rootsPointCloudBrokerProtocol';
import {metadata,reply,request,resource} from './source-roots-point-native-fixture';

const size={width:2,height:3},programs=rootsPointCloudPrograms('native-gl41');
const init=(target:RootsPointNativeTarget='primary'):RootsPointBrokerCommand=>({kind:'initialize',target,size,programs});
const begin=(target:RootsPointNativeTarget='primary'):RootsPointBrokerCommand=>({kind:'begin',target,metadata:metadata(),rangeCounts:[1],chunkPoints:1});
const append=(target:RootsPointNativeTarget='primary'):RootsPointBrokerCommand=>({kind:'append',target,ordinal:0,rangeIndex:0,rangeOffset:0,points:new Float32Array([1,2,3,-0])});
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return{promise,resolve};}
class Port {
 messages:RootsNativeCommandResponse[]=[];onPost?:(message:RootsNativeCommandResponse)=>void;throwNext=false;
 postMessage(message:unknown,options?:Transferable[]|StructuredSerializeOptions){
  if(this.throwNext){this.throwNext=false;throw Error('post failed');}
  const result=structuredClone(message,{transfer:Array.isArray(options)?options:options?.transfer}) as RootsNativeCommandResponse;
  this.messages.push(result);this.onPost?.(result);
 }
}
interface Hub {slot?:Backend;events:string[];}
type Target={width:number;height:number;index:number;frame?:SourceRootsPointNativeFrameSchedule};
/** Controlled native receipts run through the real binary codec. No GL or
 * solver is simulated; the hub only models exclusive frame/cleanup custody. */
class Backend {
 targets=new Map<RootsPointNativeTarget,Target>();transaction?:RootsPointNativeTarget;sequence=0;
 gate?:{kind:string;entered:ReturnType<typeof deferred>;release:ReturnType<typeof deferred>};releaseFailures=0;receipt?:SourceNativeRootsPointResponse;
 constructor(readonly name:string,readonly hub:Hub,readonly retained:()=>number){}
 async wait(kind:string){this.hub.events.push(`${this.name}:${kind}`);if(this.gate?.kind===kind){this.gate.entered.resolve();await this.gate.release.promise;}}
 ack(r:SourceRootsPointNativeRequest){
  const raw=reply(r);if(r.operation.kind==='finish')for(let i=96;i<raw.length;i++)raw[i]=(i-96)*9%256;
  return{...decodeSourceRootsPointNativeResponse(raw,captureSourceRootsPointNativeResponseBinding(r)),rendererIdentity:'a'.repeat(64),generation:r.generation,sequence:r.sequence,requestBytes:128,contextSerial:1,sessionSerial:1};
 }
 async initialize(target:RootsPointNativeTarget,s:{width:number;height:number},_programs:typeof programs){
  await this.wait('initialize');this.targets.set(target,{...s,index:0});
  return{...s,pointSizeRange:[1,64] as const,rendererIdentity:'a'.repeat(64),contextSerial:1,sessionSerial:1};
 }
 async begin(target:RootsPointNativeTarget,input:RootsPointNativeBegin){
  await this.wait('begin');if(this.hub.slot)throw new SourceNativeError('capacity','slot held');this.hub.slot=this;this.transaction=target;
  const s=this.targets.get(target)!;const op={kind:'begin' as const,resource,expectedDisplay:s.index,...input};s.frame=sourceRootsPointNativeFrameSchedule(op);return this.ack(request(op,s.width,s.height,++this.sequence));
 }
 async append(target:RootsPointNativeTarget,input:RootsPointNativeAppend){
  await this.wait('append');const s=this.targets.get(target)!;return this.ack(request({kind:'append',resource,expectedDisplay:s.index,...input,frame:s.frame!},s.width,s.height,++this.sequence));
 }
 async finish(target:RootsPointNativeTarget){
  await this.wait('finish');const s=this.targets.get(target)!;const r=this.ack(request({kind:'finish',resource,expectedDisplay:s.index,frame:s.frame!},s.width,s.height,++this.sequence));
  s.index=r.displayIndex;this.hub.slot=undefined;this.transaction=undefined;this.receipt=r;return r;
 }
 async release(target?:RootsPointNativeTarget){
  await this.wait('release');if(this.releaseFailures-->0)throw new SourceNativeError('cleanup','release failed');
  if(this.hub.slot&&this.hub.slot!==this)throw new SourceNativeError('capacity','another frame holds slot');
  if(!target||target===this.transaction){this.hub.slot=undefined;this.transaction=undefined;}
  if(target)this.targets.delete(target);else this.targets.clear();
 }
 async settle(){}
 diagnostics(){return{active:false,retiring:false,transactionTarget:this.transaction,retainedBytes:this.targets.size*100,cleanupPending:this.releaseFailures>0,targets:[]};}
}
const brokers:RootsPointCloudPageBroker[]=[];
function fixture(){
 const hub:Hub={events:[]},backends:Backend[]=[];const broker=new RootsPointCloudPageBroker(read=>{const b=new Backend(String(backends.length),hub,read);backends.push(b);return b;});brokers.push(broker);
 function driver(port=new Port()){
  let rpcId=0;const binding={current:()=>true,retainedBytes:()=>123};
  const make=(command:RootsPointBrokerCommand,displayId=0,id=1):RootsNativeCommandRequest=>({operation:'roots-native-command',sessionId:1,id,rpcId:++rpcId,displayId,command});
  return{port,binding,make,send:(command:RootsPointBrokerCommand,displayId=0,id=1)=>broker.execute(port,make(command,displayId,id),binding)};
 }
 return{hub,backends,broker,driver};
}
afterEach(async()=>{for(const broker of brokers.splice(0))await broker.release();vi.restoreAllMocks();});
describe('page Roots broker ACK/transfer custody (CPU real codec receipts)',()=>{
 it('delivers a codec borrowed ACK view as one independent transferable RGBA buffer',async()=>{
  const f=fixture(),d=f.driver();await d.send(init());await d.send(begin(),1);await d.send(append(),1);await d.send({kind:'finish',target:'primary'},1);
  const native=f.backends[0].receipt!,response=d.port.messages.at(-1)!;if(!('result'in response)||response.result.kind!=='finish')throw Error('Missing finish');
  expect(native.pixels!.byteOffset).toBe(96);expect(native.pixels!.buffer.byteLength).toBe(120);
  const pixels=response.result.pixels;expect(pixels.byteOffset).toBe(0);expect(pixels.buffer.byteLength).toBe(24);expect([...pixels]).toEqual([...native.pixels!]);
  expect(response).toMatchObject({sessionId:1,id:1,displayId:1,rpcId:4,result:{displayIndex:1,receivedPoints:1,pointDraws:1,rendererIdentity:'a'.repeat(64)}});
  const received=structuredClone(response,{transfer:[pixels.buffer]});expect(pixels.byteLength).toBe(0);expect('result'in received&&received.result.kind==='finish'&&received.result.pixels.byteLength).toBe(24);
  expect(native.pixels!.byteLength).toBe(24);expect(f.hub.slot).toBeUndefined();
 });
 it('clears pending before publishing ACK and does not let old finally erase the next operation',async()=>{
  const f=fixture(),d=f.driver();let next:Promise<void>|undefined;
  d.port.onPost=message=>{if('result'in message&&message.result.kind==='initialize')next=d.send(begin(),1);};
  await d.send(init());await next;expect(d.port.messages.map(m=>'result'in m?m.result.kind:m.error.kind)).toEqual(['initialize','begin']);expect(f.hub.slot).toBe(f.backends[0]);
  await d.send(append(),1);await d.send({kind:'finish',target:'primary'},1);
 });
 it('retirement waits for the actual late ACK, suppresses publication and releases exact custody',async()=>{
  const f=fixture(),d=f.driver();await d.send(init());const backend=f.backends[0];backend.gate={kind:'begin',entered:deferred(),release:deferred()};
  const pending=d.send(begin(),1);await backend.gate.entered.promise;const retirement=f.broker.release(d.port);expect(f.hub.events).toEqual(['0:initialize','0:begin']);expect(f.broker.has(d.port)).toBe(true);
  backend.gate.release.resolve();await Promise.all([pending,retirement]);expect(d.port.messages).toHaveLength(1);expect(f.hub.events.at(-1)).toBe('0:release');expect(f.broker.has(d.port)).toBe(false);expect(f.hub.slot).toBeUndefined();
 });
 it('retains failed retirement for retry and rejects further commands from that Worker',async()=>{
  const f=fixture(),d=f.driver();await d.send(init());await d.send(begin(),1);f.backends[0].releaseFailures=1;
  await expect(f.broker.release(d.port)).rejects.toThrow('仍待清理');expect(f.broker.has(d.port)).toBe(true);expect(f.hub.slot).toBe(f.backends[0]);
  await expect(d.send(append(),1)).rejects.toMatchObject({kind:'cleanup'});await f.broker.release(d.port);expect(f.broker.has(d.port)).toBe(false);expect(f.hub.slot).toBeUndefined();
 });
 it('keeps failed Worker-requested cleanup retryable without dropping the active frame',async()=>{
  const f=fixture(),d=f.driver();await d.send(init());await d.send(begin(),1);f.backends[0].releaseFailures=1;
  await d.send({kind:'release',target:'primary'});expect(d.port.messages.at(-1)).toMatchObject({error:{kind:'cleanup',cleanupPending:true}});expect(f.hub.slot).toBe(f.backends[0]);
  await d.send({kind:'release',target:'primary'});expect(d.port.messages.at(-1)).toMatchObject({result:{kind:'release'}});expect(f.hub.slot).toBeUndefined();
  await d.send(init());await d.send(begin(),2);await d.send(append(),2);await d.send({kind:'finish',target:'primary'},2);
 });
 it('rejects concurrent commands before backend entry and settle waits for the submitted ACK',async()=>{
  const f=fixture(),d=f.driver();await d.send(init());const b=f.backends[0];b.gate={kind:'begin',entered:deferred(),release:deferred()};
  const pending=d.send(begin(),1);await b.gate.entered.promise;const next=d.make(init('offscreen'));
  await expect(f.broker.execute(d.port,next,d.binding)).rejects.toThrow('上一条');let settled=false;const wait=f.broker.settle().then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);
  b.gate.release.resolve();await Promise.all([pending,wait]);expect(settled).toBe(true);expect(f.hub.events.filter(x=>x.endsWith(':initialize'))).toHaveLength(1);
 });
 it('releases the active frame first then idle targets across Workers',async()=>{
  const f=fixture(),a=f.driver(),b=f.driver();await a.send(init());await b.send(init());await b.send(begin(),1);
  await f.broker.release();expect(f.hub.events.filter(x=>x.endsWith(':release'))).toEqual(['1:release','0:release']);expect(f.hub.slot).toBeUndefined();expect(f.broker.has(a.port)||f.broker.has(b.port)).toBe(false);
 });
 it('binds append and finish to the exact Worker request/display/target and preserves the owning frame after rejection',async()=>{
  const f=fixture(),d=f.driver();await d.send(init());await d.send(begin(),1,7);const r=d.make(append(),1,8);
  await expect(f.broker.execute(d.port,r,d.binding)).rejects.toMatchObject({kind:'protocol'});r.id=7;r.command={...append(),target:'offscreen'};await expect(f.broker.execute(d.port,r,d.binding)).rejects.toMatchObject({kind:'protocol'});
  r.command=append();await f.broker.execute(d.port,r,d.binding);await d.send({kind:'finish',target:'primary'},1,7);expect(f.hub.slot).toBeUndefined();
 });
 it('suppresses a now-stale completion but keeps owned targets until explicit retirement',async()=>{
  const f=fixture(),d=f.driver();await d.send(init());await d.send(begin(),1);await d.send(append(),1);const b=f.backends[0];b.gate={kind:'finish',entered:deferred(),release:deferred()};
  const pending=d.send({kind:'finish',target:'primary'},1);await b.gate.entered.promise;d.binding.current=()=>false;b.gate.release.resolve();await pending;
  expect(d.port.messages).toHaveLength(3);expect(f.broker.has(d.port)).toBe(true);expect(f.hub.slot).toBeUndefined();await f.broker.release(d.port);expect(f.broker.has(d.port)).toBe(false);
 });
 it('does not create a native owner for stale input or locally proven absent cleanup',async()=>{
  const f=fixture(),d=f.driver();d.binding.current=()=>false;await d.send(init());expect(f.backends).toHaveLength(0);expect(d.port.messages).toHaveLength(0);
  const fresh=f.driver();await fresh.send({kind:'release'});expect(f.backends).toHaveLength(0);expect(fresh.port.messages[0]).toMatchObject({result:{kind:'release'}});
 });
 it('updates retained-byte callbacks per command and drops them after settlement',async()=>{
  const f=fixture(),d=f.driver();await d.send(init());const b=f.backends[0];expect(b.retained()).toBe(0);d.binding.retainedBytes=()=>456;b.gate={kind:'begin',entered:deferred(),release:deferred()};
  const pending=d.send(begin(),1);await b.gate.entered.promise;expect(b.retained()).toBe(456);b.gate.release.resolve();await pending;expect(b.retained()).toBe(0);
 });
 it('reports a failed post without losing native cleanup custody',async()=>{
  const f=fixture(),d=f.driver();await d.send(init());await d.send(begin(),1);await d.send(append(),1);d.port.throwNext=true;await d.send({kind:'finish',target:'primary'},1);
  expect(d.port.messages.at(-1)).toMatchObject({error:{kind:'runtime',reason:'post failed'}});expect(f.broker.has(d.port)).toBe(true);await f.broker.release(d.port);expect(f.broker.has(d.port)).toBe(false);
 });
});
