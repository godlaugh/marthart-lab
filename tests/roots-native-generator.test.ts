import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Generator} from '../src/engine/client';
import type {GenerationRequest,GenerationWorkerResponse} from '../src/engine/generationProtocol';
import type {RootsNativeCommandRequest,RootsNativeCommandResponse,RootsPointBrokerCommand} from '../src/engine/rootsPointCloudBrokerProtocol';
import {rootsPointCloudPrograms} from '../src/engine/rootsPointCloudDrawing';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import type {SceneOutput} from '../src/types';
// Actual Generator and page broker; the native device is a controlled custody
// boundary. These tests establish dispatch/cleanup, not GPU pixel fidelity.
const h=vi.hoisted(()=>({instances:[] as Array<{held:boolean;releaseCount:number;memory:number}>,initializeGate:undefined as Promise<void>|undefined,releaseGate:undefined as Promise<void>|undefined,releaseFailure:undefined as Error|undefined}));
vi.mock('../src/engine/rootsPointCloudNativeBackend',()=>({RootsPointCloudNativeBackend:class{
 held=false;releaseCount=0;memory=0;
 constructor(private options:{retainedBytes:()=>number}){h.instances.push(this);}
 async initialize(_target:unknown,size:{width:number;height:number}){this.held=true;this.memory=this.options.retainedBytes();await h.initializeGate;return{...size,pointSizeRange:[1,64]};}
 async release(){this.releaseCount++;await h.releaseGate;if(h.releaseFailure)throw h.releaseFailure;this.held=false;}
 async settle(){}
 diagnostics(){return{cleanupPending:!!h.releaseFailure,transactionTarget:undefined};}
}}));
class FakeWorker{
 static instances:FakeWorker[]=[];messages:Array<GenerationRequest|RootsNativeCommandResponse>=[];terminated=false;
 onmessage:((event:{data:GenerationWorkerResponse})=>void)|null=null;onerror:unknown;
 constructor(){FakeWorker.instances.push(this);}
 postMessage(value:GenerationRequest|RootsNativeCommandResponse,transfer:Transferable[]=[]){this.messages.push(structuredClone(value,{transfer}));}
 terminate(){this.terminated=true;}
 emit(data:GenerationWorkerResponse){this.onmessage?.({data});}
}
const context={time:0,width:2,height:3,quality:'preview' as const};
const output:SceneOutput={type:'raster',width:2,height:3,pixels:new Uint8ClampedArray(24),stats:{samples:0,generated:0,invalid:0,elapsedMs:0}};
const scene=()=>createScene(definition('roots'));
const initialize=():RootsPointBrokerCommand=>({kind:'initialize',target:'primary',size:{width:2,height:3},programs:rootsPointCloudPrograms('native-gl41')});
function rpc(worker:FakeWorker,command=initialize(),rpcId=1,override:Partial<RootsNativeCommandRequest>={}){
 const request=[...worker.messages].reverse().find(v=>v.operation==='generate')!;
 const data:RootsNativeCommandRequest={operation:'roots-native-command',sessionId:request.sessionId,id:request.id,displayId:0,rpcId,command,...override};worker.emit(data);return data;
}
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const generators:Generator[]=[];
const setup=()=>{const g=new Generator();generators.push(g);return g;};
beforeEach(()=>{vi.stubEnv('VITE_SOURCE_RENDERER','native');vi.stubGlobal('Worker',FakeWorker);FakeWorker.instances=[];h.instances=[];h.initializeGate=h.releaseGate=undefined;h.releaseFailure=undefined;});
afterEach(async()=>{h.releaseFailure=undefined;for(const g of generators.splice(0)){g.dispose();await g.settledNativeCleanup();}vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('Roots native Generator binding and retirement',()=>{
 it('ignores foreign session/request and retired Worker commands before acquiring native custody',async()=>{
  const g=setup(),pending=g.generate(scene(),context),failure=pending.catch(e=>e),worker=FakeWorker.instances[0];
  rpc(worker,initialize(),1,{sessionId:999});rpc(worker,initialize(),1,{id:999});await flush();expect(h.instances).toHaveLength(0);
  rpc(worker);await flush();expect(h.instances).toHaveLength(1);expect(worker.messages.at(-1)).toMatchObject({operation:'roots-native-result',result:{kind:'initialize'}});
  g.cancel();await failure;await g.settledNativeCleanup();expect(worker.terminated).toBe(true);rpc(worker,initialize(),2);await flush();expect(h.instances).toHaveLength(1);
 });
 it('waits for an actual in-flight ACK before cleanup and suppresses its late result on cancellation',async()=>{
  let confirm!:()=>void;h.initializeGate=new Promise<void>(r=>confirm=r);
  const g=setup(),pending=g.generate(scene(),context),failure=pending.catch(e=>e),worker=FakeWorker.instances[0];rpc(worker);await flush();
  expect(h.instances[0].held).toBe(true);g.cancel();expect((await failure).name).toBe('AbortError');expect(worker.terminated).toBe(false);expect(h.instances[0].releaseCount).toBe(0);
  confirm();await g.settledNativeCleanup();expect(h.instances[0].held).toBe(false);expect(worker.terminated).toBe(true);expect(worker.messages.filter(v=>v.operation==='roots-native-result')).toHaveLength(0);
 });
 it('retains the exact retired Worker after failed release and retries only explicit cleanup',async()=>{
  const g=setup(),pending=g.generate(scene(),context),failure=pending.catch(e=>e),worker=FakeWorker.instances[0];rpc(worker);await flush();h.releaseFailure=Error('release unacknowledged');g.cancel();await failure;
  await expect(g.settledNativeCleanup()).rejects.toThrow('仍待清理');expect(worker.terminated).toBe(false);expect(h.instances[0].held).toBe(true);
  h.releaseFailure=undefined;await g.settledNativeCleanup();expect(worker.terminated).toBe(true);expect(h.instances[0].held).toBe(false);
 });
 it('does not let a replacement Worker acquire a target before the retired owner releases',async()=>{
  const g=setup(),pending=g.generate(scene(),context),failure=pending.catch(e=>e),old=FakeWorker.instances[0];rpc(old);await flush();
  let release!:()=>void;h.releaseGate=new Promise<void>(r=>release=r);g.cancel();await failure;
  const next=g.generate(scene(),context),nextFailure=next.catch(e=>e),fresh=FakeWorker.instances[1];rpc(fresh);await flush();expect(h.instances).toHaveLength(1);expect(old.terminated).toBe(false);
  release();await flush();expect(h.instances).toHaveLength(2);expect(old.terminated).toBe(true);expect(fresh.messages.at(-1)).toMatchObject({operation:'roots-native-result',result:{kind:'initialize'}});
  g.cancel();await nextFailure;
 });
 it('allows the same Worker to release Roots during a transition to another scene',async()=>{
  const g=setup(),first=g.generate(scene(),context),worker=FakeWorker.instances[0];rpc(worker);await flush();const request=worker.messages[0];worker.emit({operation:'generate',sessionId:request.sessionId,id:request.id,output});await first;
  const next=g.generate(createScene(definition('spirograph')),context),failure=next.catch(e=>e);rpc(worker,{kind:'release'},2);await flush();
  expect(h.instances[0].held).toBe(false);expect(worker.messages.at(-1)).toMatchObject({operation:'roots-native-result',result:{kind:'release'}});expect(worker.terminated).toBe(false);g.cancel();await failure;
 });
 it('rejects native acquisition by an unrelated scene before creating a backend',async()=>{
  const g=setup(),pending=g.generate(createScene(definition('spirograph')),context),failure=pending.catch(e=>e),worker=FakeWorker.instances[0];rpc(worker);expect(await failure).toMatchObject({kind:'protocol'});expect(h.instances).toHaveLength(0);expect(worker.terminated).toBe(true);
 });
 it('charges the prior completed page image once while initializing the next Roots target',async()=>{
  const g=setup(),first=g.generate(scene(),context),worker=FakeWorker.instances[0],request=worker.messages[0];worker.emit({operation:'generate',sessionId:request.sessionId,id:request.id,output});await first;
  const next=g.generate(scene(),context),failure=next.catch(e=>e);rpc(worker);await flush();expect(h.instances[0].memory).toBe(24);g.cancel();await failure;
 });
});
