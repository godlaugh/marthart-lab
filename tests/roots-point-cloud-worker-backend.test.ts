import {it,expect,vi} from 'vitest';
import {RootsPointCloudWorkerBackend} from '../src/engine/rootsPointCloudWorkerBackend';
import {RootsPointCloudRing} from '../src/engine/rootsPointCloudRing';
import {prepareRootsPointChunks,rootsPointCloudPrograms} from '../src/engine/rootsPointCloudDrawing';
import type {RootsPointBrokerCall,RootsPointBrokerCommand,RootsPointBrokerResult} from '../src/engine/rootsPointCloudBrokerProtocol';
import {metadata} from './source-roots-point-native-fixture';
function setup(){
 const seen:RootsPointBrokerCommand[]=[],targets=new Map<string,{displayIndex:number;receivedPoints:number;totalPoints:number;nextChunk:number;totalChunks:number;pointDraws:number;clears:number;fadeDraws:number}>();
 const deliver:RootsPointBrokerCall=async command=>{
  const c=command.kind==='append'?structuredClone(command,{transfer:[command.points.buffer]}):structuredClone(command);seen.push(c);
  if(c.kind==='initialize'){targets.set(c.target,{displayIndex:0,receivedPoints:0,totalPoints:0,nextChunk:0,totalChunks:0,pointDraws:0,clears:0,fadeDraws:0});return{kind:'initialize',...c.size,pointSizeRange:[1,64]};}
  if(c.kind==='release'){if(c.target)targets.delete(c.target);else targets.clear();return{kind:'release'};}
  const s=targets.get(c.target)!;
  if(c.kind==='begin'){s.receivedPoints=0;s.nextChunk=0;s.pointDraws=0;s.totalPoints=c.rangeCounts.reduce((a,b)=>a+b,0);s.totalChunks=c.rangeCounts.reduce((a,b)=>a+Math.ceil(b/c.chunkPoints),0);s.clears=Number(c.metadata.clear!==undefined);s.fadeDraws=Number(c.metadata.fade!==undefined);return{kind:'begin',...s};}
  if(c.kind==='append'){s.receivedPoints+=c.points.length/4;s.nextChunk++;s.pointDraws++;return{kind:'append',...s};}
  s.displayIndex++;return{kind:'finish',...s,width:2,height:3,pixels:new Uint8ClampedArray(24).fill(127),rendererIdentity:'a'.repeat(64),generation:1,sequence:seen.length,requestBytes:96};
 };
 const call=vi.fn(deliver),backend=new RootsPointCloudWorkerBackend(call),ring=new RootsPointCloudRing({capacityPoints:8,recentWindowPoints:8});
 ring.append(new Float32Array([1,2,3,-0,4,5,6,Infinity,7,8,9,1]));
 const initialize=()=>backend.initialize('primary',{width:2,height:3},rootsPointCloudPrograms('native-gl41'));
 const display=(extra={})=>backend.display('primary',{metadata:metadata(),chunks:prepareRootsPointChunks(ring,2),workerRetainedBytes:128,...extra});
 return{seen,targets,call,deliver,backend,ring,initialize,display};
}
it('transfers only independent chunks and retains the complete numerical ring',async()=>{const s=setup();await s.initialize();const result=await s.display();expect(s.seen.map(x=>x.kind)).toEqual(['initialize','begin','append','append','finish']);expect(s.ring.facts.retainedPointCount).toBe(3);expect(s.ring.recentWindow().ranges[0].values.byteLength).toBe(48);expect(result).toMatchObject({displayIndex:1,width:2,height:3,rendererIdentity:'a'.repeat(64)});const chunks=s.seen.filter(c=>c.kind==='append');expect(Object.is(chunks[0].points[3],-0)).toBe(true);expect(chunks[0].points[7]).toBe(1);await s.backend.release();s.ring.dispose();});
it('waits for each actual ACK before allocating/sending the next chunk',async()=>{
 const s=setup();await s.initialize();let release!:(r:RootsPointBrokerResult)=>void;
 s.call.mockImplementation(async(c,id)=>{const r=await s.deliver(c,id);return c.kind==='append'&&c.ordinal===0?new Promise(resolve=>release=resolve):r;});
 const pending=s.display();await vi.waitFor(()=>expect(release).toBeTypeOf('function'));expect(s.seen.filter(c=>c.kind==='append')).toHaveLength(1);
 release({kind:'append',displayIndex:0,receivedPoints:2,totalPoints:3,nextChunk:1,totalChunks:2,pointDraws:1,clears:1,fadeDraws:0});await pending;expect(s.seen.filter(c=>c.kind==='append')).toHaveLength(2);await s.backend.release();s.ring.dispose();
});
it('checks the borrowed ring after an ACK and refuses a changed window',async()=>{const s=setup();await s.initialize();s.call.mockImplementation(async(c,id)=>{const r=await s.deliver(c,id);if(c.kind==='append')s.ring.append(new Float32Array([10,11,12,.5]));return r;});await expect(s.display()).rejects.toThrow('borrowed window');expect(s.seen.some(c=>c.kind==='finish')).toBe(false);await s.backend.release();s.ring.dispose();});
it('observes soft cancellation after ACK without issuing another chunk or aborting transport',async()=>{const s=setup();await s.initialize();let cancelled=false;s.call.mockImplementation(async(c,id)=>{const r=await s.deliver(c,id);if(c.kind==='append')cancelled=true;return r;});await expect(s.display({isCancelled:()=>cancelled})).rejects.toMatchObject({name:'AbortError'});expect(s.seen.filter(c=>c.kind==='append')).toHaveLength(1);expect(s.seen.some(c=>c.kind==='finish')).toBe(false);await s.backend.release();s.ring.dispose();});
it('does not fabricate cleanup on failed release and permits the same owner to retry',async()=>{const s=setup();await s.initialize();let fail=true;s.call.mockImplementation(async(c,id)=>{if(c.kind==='release'&&fail)throw Error('release failed');return s.deliver(c,id);});await expect(s.backend.release()).rejects.toThrow('release failed');fail=false;await s.backend.release();await expect(s.display()).rejects.toThrow('尚未初始化');s.ring.dispose();});
it('checks Worker capacity before beginning a native frame and never sends the numerical budget to the page',async()=>{const s=setup();await s.initialize();await expect(s.display({workerRetainedBytes:768*1024*1024})).rejects.toMatchObject({failureKind:'capacity'});expect(s.seen.map(x=>x.kind)).toEqual(['initialize']);await s.display();expect(s.seen.some(c=>'workerRetainedBytes' in c||'retainedBytes' in c)).toBe(false);await s.backend.release();s.ring.dispose();});
it.each(['coverage','pixels','identity'])('rejects invalid %s instead of publishing a completed display',async field=>{const s=setup();await s.initialize();s.call.mockImplementation(async(c,id)=>{const r=await s.deliver(c,id);if(r.kind==='finish'){if(field==='coverage')r.receivedPoints--;if(field==='pixels')r.pixels=new Uint8ClampedArray(20);if(field==='identity')r.rendererIdentity='unknown';}return r;});await expect(s.display()).rejects.toMatchObject({failureKind:'input'});await s.backend.release();s.ring.dispose();});
