import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const wire=vi.hoisted(()=>({compute:vi.fn(),render:vi.fn()}));
vi.mock('../src/engine/sourceNativeClient',async actual=>({...await actual<typeof import('../src/engine/sourceNativeClient')>(),exchangeSourceIteratedNative:wire.compute,exchangeSourceIteratedRenderNative:wire.render}));
vi.mock('../src/engine/sourceNativeLease',()=>({ensureSourceNativeLease:async()=>{},sourceNativeLeaseToken:()=>undefined}));
import {SourceIteratedNativeBackend} from '../src/engine/sourceIteratedNativeBackend';
import {SourceIteratedSession} from '../src/engine/sourceIteratedSession';
import {parseProjectFile} from '../src/engine/legacyImport';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import type {SourceIteratedNativeRequest} from '../src/engine/sourceIteratedNativeProtocol';
import {sourceIteratedNativeSourceProgramBytes,sourceIteratedNativeProgramBytes,sourceIteratedNativeResidentBytes} from '../src/engine/sourceIteratedNativeProtocol';
import type {SourceIteratedRenderNativeRequest} from '../src/engine/sourceIteratedRenderNativeProtocol';
import type {GenerateContext} from '../src/types';

const scene=()=>parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'Native retained boundary',type:'SYMMETRY_CHAOS',parameters:{alpha:2.5},settings:{batch_size:8,burn_in_steps:3,iterations_per_frame:1},timeline:[{type:'wait',duration:1}]})).scene;
const context=():GenerateContext=>({time:0,width:32,height:24,quality:'preview',sourcePointPixelDensity:1,sourceViewport:ordinarySourceViewport(scene(),32,24,'primary',24),symmetryLive:{sessionId:'native-boundary',renderFps:30,replayRevision:0,clock:{paused:true,timestampMs:1000}}});
const metadata={rendererIdentity:'a'.repeat(64),contextSerial:9,sessionSerial:4,requestBytes:128};
function computeReply(r:SourceIteratedNativeRequest){const op=r.operation;if(op.kind==='create-fragment'||op.kind==='advance-fragment'||op.kind==='advance-processing-fragment')throw Error('Existing backend does not route fragment owners');return{...metadata,...r,resource:op.resource,index:op.kind==='create'||op.kind==='create-source'||op.kind==='release'?0:op.expectedIndex+(op.kind==='advance'?1:0),disposition:op.kind==='release'?'absent':'owned'};}
function renderReply(r:SourceIteratedRenderNativeRequest){const op=r.operation;return{...metadata,...r,resource:op.resource,index:op.kind==='release'?0:op.expectedIndex,displays:op.kind==='release'?0:op.expectedDisplays+(op.kind==='draw'?1:0),disposition:op.kind==='release'?'absent':'owned',invalid:0,accepted:op.kind==='draw'&&op.record?op.expectedCount:0,clipped:0,sampleInvalid:0,occupiedPixels:1,maxCount:1,...(op.kind==='present'?{pixels:new Uint8ClampedArray(r.width*r.height*4)}:{})};}
const backends:SourceIteratedNativeBackend[]=[];
function owner(){const backend=new SourceIteratedNativeBackend();backends.push(backend);const step=vi.spyOn(backend,'step');return{backend,step,session:new SourceIteratedSession('symmetry',{asyncBackend:()=>backend})};}
const computeOps=()=>wire.compute.mock.calls.map(([r])=>(r as SourceIteratedNativeRequest).operation);
const renderOps=()=>wire.render.mock.calls.map(([r])=>(r as SourceIteratedRenderNativeRequest).operation);
beforeEach(()=>{wire.compute.mockReset().mockImplementation(async r=>computeReply(r));wire.render.mockReset().mockImplementation(async r=>renderReply(r));});
afterEach(async()=>{wire.compute.mockImplementation(async r=>computeReply(r));wire.render.mockImplementation(async r=>renderReply(r));for(const b of backends.splice(0))await b.dispose();});

describe('production iterated backend (real Session/plans, simulated transport)',()=>{
 it('creates the explicit source profile with four charged shader blocks and preserves logical step counts',async()=>{
  const {session,backend,step}=owner(),c=context();c.symmetryLive!.clock.paused=false;await session.generateAsync(scene(),c);
  const created=computeOps()[0];expect(created.kind).toBe('create-source');if(created.kind!=='create-source')throw Error('source create absent');
  expect(created.vertex).not.toContain('oldMetadata');expect(created.diagnosticVertex).not.toContain('calculate_next');expect(created.diagnosticFragment.startsWith('#version 410 core\n')).toBe(true);
  const charged=sourceIteratedNativeSourceProgramBytes(created);expect(charged).toBe(3*[created.vertex,created.fragment,created.diagnosticVertex,created.diagnosticFragment].reduce((n,s)=>n+new TextEncoder().encode(s).length,0));expect(charged).toBeGreaterThan(sourceIteratedNativeProgramBytes(created));
  expect(wire.compute.mock.calls[0][1]).toEqual({retainedBytes:0});expect(backend.diagnostics().retainedBytes).toBeGreaterThan(sourceIteratedNativeResidentBytes(8,charged));
  const advances=computeOps().filter(op=>op.kind==='advance');expect(advances.map(op=>op.steps)).toEqual([3,1,1]);expect(advances.map(op=>op.reset)).toEqual([true,false,false]);expect(advances.map(op=>op.resetCounter)).toEqual([true,false,false]);
  expect((await step.mock.results[0].value).steps).toBe(8*5);
  const [job,options]=step.mock.calls[0],before=backend.diagnostics(),requests=wire.compute.mock.calls.length;expect(backend.estimateWork(job,options.resetParticles)).toBe(8*13);expect(backend.diagnostics()).toEqual(before);expect(wire.compute).toHaveBeenCalledTimes(requests);
 });
 it('owns canonical state once and presents acknowledged ink without particle readback',async()=>{
  const {session,backend}=owner(),s=scene(),c=context();const first=await session.generateAsync(s,c);await session.generateAsync(s,c);
  expect(first.backend).toBe('native');expect(first.sourcePixelRenderer).toMatchObject({backend:'native',identity:metadata.rendererIdentity});
  expect(computeOps().filter(o=>o.kind==='create-source')).toHaveLength(1);expect(computeOps().some(o=>o.kind==='read')).toBe(false);
  const draws=renderOps().filter(o=>o.kind==='draw'),shown=renderOps().filter(o=>o.kind==='present');expect(draws.length).toBeGreaterThan(0);expect(shown.at(-1)).toMatchObject({expectedIndex:backend.diagnostics().index,expectedDisplays:backend.diagnostics().displays});
  const state=computeOps()[0].resource,ink=renderOps()[0].resource;await session.resetAsync();expect(backend.diagnostics().retainedBytes).toBe(0);
  expect(renderOps().at(-1)).toEqual({kind:'release',resource:ink});expect(computeOps().at(-1)).toEqual({kind:'release',resource:state});
 });
 it('replaces draw programs on the retained ink checkpoint before advancing again',async()=>{
  const {session,backend,step}=owner();await session.generateAsync(scene(),context());
  const [job,options]=step.mock.calls.at(-1)!;const before=backend.diagnostics(),ink=renderOps().find(o=>o.kind==='create')!.resource;
  await backend.step({...job,frame:job.frame+1,config:{...job.config,color:job.config.color==='step'?'radius':'step'}},{...options,resetParticles:false,clearInk:false});
  const replacement=renderOps().find(o=>o.kind==='replace-programs');expect(replacement).toMatchObject({resource:ink,expectedIndex:before.index,expectedDisplays:before.displays});
  expect(renderOps().filter(o=>o.kind==='create')).toHaveLength(1);expect(backend.diagnostics()).toMatchObject({creations:1,programReplacements:1,displays:before.displays+1});
 });
 it('resizes only the ink owner, preserving the mathematical checkpoint',async()=>{
  const {session,backend}=owner();await session.generateAsync(scene(),context());const before=backend.diagnostics(),old=renderOps()[0].resource;
  await backend.resizeAccumulation(24,18);expect(backend.diagnostics()).toMatchObject({index:before.index,creations:1,displays:0,inkOwners:1});
  expect(renderOps().at(-1)).toEqual({kind:'release',resource:old});expect(computeOps().filter(o=>o.kind==='create-source')).toHaveLength(1);
 });
 it('retains both possible ink generations when resize acknowledgement is lost',async()=>{
  const {session,backend}=owner();await session.generateAsync(scene(),context());const before=backend.diagnostics();
  wire.render.mockImplementationOnce(async()=>{throw Error('resize acknowledgement lost');});await expect(backend.resizeAccumulation(64,48)).rejects.toThrow('lost');
  expect(backend.diagnostics()).toMatchObject({inkOwners:2,failed:true,index:before.index});expect(backend.diagnostics().retainedBytes).toBeGreaterThan(before.retainedBytes);
  await backend.dispose();expect(backend.diagnostics()).toMatchObject({owned:false,inkOwners:0,retainedBytes:0});
 });
 it('keeps uncertain create and failed cleanup ownership until an acknowledged retry',async()=>{
  const {backend,session}=owner();wire.compute.mockRejectedValueOnce(Error('lost create'));await expect(session.generateAsync(scene(),context())).rejects.toThrow();
  // The Session attempts cleanup on failure; make the next direct ownership
  // test below retain the failure through that attempt too.
  await backend.dispose();expect(backend.diagnostics().retainedBytes).toBe(0);
  const other=owner();wire.compute.mockImplementation(async(r:SourceIteratedNativeRequest)=>{if(['create-source','release'].includes(r.operation.kind))throw Error('unavailable');return computeReply(r);});
  await expect(other.session.generateAsync(scene(),context())).rejects.toThrow();expect(other.backend.diagnostics()).toMatchObject({owned:true,failed:true});
  const resource=computeOps().reverse().find(o=>o.kind==='create-source')!.resource;
  wire.compute.mockImplementation(async r=>computeReply(r));await other.session.resetAsync();expect(computeOps().at(-1)).toEqual({kind:'release',resource});expect(other.backend.diagnostics().owned).toBe(false);
 });
 it.each(['rendererIdentity','contextSerial','sessionSerial'] as const)('poisons a changed %s without silently recreating history',async key=>{
  const {session,backend,step}=owner();await session.generateAsync(scene(),context());const [job,options]=step.mock.calls.at(-1)!;
  wire.render.mockImplementationOnce(async r=>({...renderReply(r),[key]:key==='rendererIdentity'?'b'.repeat(64):99}));
  await expect(backend.step({...job,frame:job.frame+1},{...options,resetParticles:false})).rejects.toMatchObject({kind:'state-lost'});
  expect(backend.diagnostics()).toMatchObject({owned:true,failed:true,creations:1});
 });
 it('validates unsupported fields and malformed draw plans before remote effects',async()=>{
  const {session,backend,step}=owner();await session.generateAsync(scene(),context());const [job,options]=step.mock.calls.at(-1)!;await backend.dispose();
  wire.compute.mockClear();wire.render.mockClear();
  await expect(backend.step({...job,config:{...job.config,dimension:3}},{...options,resetParticles:true})).rejects.toThrow('二维');expect(wire.compute).not.toHaveBeenCalled();expect(wire.render).not.toHaveBeenCalled();
 });
 it('rejects source advances above 16 before remote effects rather than clamping or inheriting the generic limit',async()=>{
  const {session,backend,step}=owner();await session.generateAsync(scene(),context());const [job,options]=step.mock.calls.at(-1)!;await backend.dispose();wire.compute.mockClear();wire.render.mockClear();
  await expect(backend.step({...job,iterationFrame:undefined,iterationUpdates:undefined,config:{...job.config,burn:17}},{...options,resetParticles:true})).rejects.toThrow('最多 16 步');expect(wire.compute).not.toHaveBeenCalled();expect(wire.render).not.toHaveBeenCalled();
 });
 it('admits prefix recomputation and every classifier, not just the logical number of updates',async()=>{
  const {session,backend,step}=owner();await session.generateAsync(scene(),context());const [job,options]=step.mock.calls.at(-1)!;await backend.dispose();wire.compute.mockClear();wire.render.mockClear();
  const large={...job,config:{...job.config,count:8_000_000,burn:16,iterations:16},iterationUpdates:[job.field,job.field],iterationFrame:{model:'symmetry-frame-1.7.8' as const,frameIndex:0,objectUpdates:2,warmupSteps:16,iterationSteps:32,warmupApplied:true}};
  // Logical work is 384M; 3 × (136 prefix steps + 16 classifiers) × 8M
  // exceeds 2B before canonical seed storage or a remote owner is created.
  expect(backend.estimateWork(large,true)).toBe(3_648_000_000);await expect(backend.step(large,{...options,resetParticles:true})).rejects.toThrow('prefix 与逐步分类');expect(wire.compute).not.toHaveBeenCalled();expect(wire.render).not.toHaveBeenCalled();expect(backend.diagnostics().retainedBytes).toBe(0);
 });
 it('restores canonical seeds even for a reset display with zero mathematical advances',async()=>{
  const {session,backend,step}=owner();await session.generateAsync(scene(),context());const [job,options]=step.mock.calls.at(-1)!;
  wire.compute.mockClear();wire.render.mockClear();
  expect(backend.estimateWork(job,false)).toBe(0);expect(backend.estimateWork(job,true)).toBe(8);
  await backend.step({...job,frame:job.frame+1,iterationUpdates:undefined,iterationFrame:{...job.iterationFrame!,phase:'replay',objectUpdates:0,warmupSteps:0,iterationSteps:0}},{...options,resetParticles:true,clearInk:true});
  expect(computeOps()).toHaveLength(1);expect(computeOps()[0]).toMatchObject({kind:'advance',reset:true,resetCounter:true,steps:0});expect(computeOps().some(op=>op.kind==='create-source'||op.kind==='upload')).toBe(false);
  expect(renderOps().at(-1)).toMatchObject({kind:'draw',clear:true});
 });
 it('retains both possible program allocations after a lost replacement ACK and never advances the state',async()=>{
  const {session,backend,step}=owner();await session.generateAsync(scene(),context());const [job,options]=step.mock.calls.at(-1)!,before=backend.diagnostics();
  wire.compute.mockClear();wire.render.mockClear();wire.render.mockImplementationOnce(async()=>{throw Error('program ACK lost');});
  await expect(backend.step({...job,frame:job.frame+1,config:{...job.config,color:job.config.color==='step'?'radius':'step'}},{...options,resetParticles:false})).rejects.toThrow('program ACK lost');
  expect(renderOps()).toHaveLength(1);expect(renderOps()[0].kind).toBe('replace-programs');expect(wire.compute).not.toHaveBeenCalled();expect(backend.diagnostics()).toMatchObject({failed:true,index:before.index,displays:before.displays,programReplacements:before.programReplacements});expect(backend.diagnostics().retainedBytes).toBeGreaterThan(before.retainedBytes);
  await backend.dispose();expect(renderOps().at(-1)?.kind).toBe('release');expect(computeOps().at(-1)?.kind).toBe('release');expect(backend.diagnostics().retainedBytes).toBe(0);
 });
 it('retains the new and old targets if resize created its new ink but old ink release fails',async()=>{
  const {session,backend}=owner();await session.generateAsync(scene(),context());const old=renderOps()[0].resource;wire.render.mockClear();
  wire.render.mockImplementationOnce(async r=>renderReply(r)).mockImplementationOnce(async()=>{throw Error('old target release failed');});
  await expect(backend.resizeAccumulation(48,32)).rejects.toThrow('old target release failed');const created=renderOps()[0].resource;
  expect(created).not.toBe(old);expect(backend.diagnostics()).toMatchObject({failed:true,inkOwners:2,owned:true});
  wire.render.mockClear();await backend.dispose();expect(renderOps()).toEqual([{kind:'release',resource:old},{kind:'release',resource:created}]);expect(backend.diagnostics()).toMatchObject({retainedBytes:0,inkOwners:0,owned:false});
 });
 it('does not abort an in-flight transport when disposal is requested',async()=>{
  const {session,backend,step}=owner();await session.generateAsync(scene(),context());const [job,options]=step.mock.calls.at(-1)!;
  let done!:(value:ReturnType<typeof renderReply>)=>void;let request!:SourceIteratedRenderNativeRequest;
  wire.render.mockImplementationOnce((r:SourceIteratedRenderNativeRequest)=>{request=r;return new Promise(resolve=>{done=resolve;});});
  const pending=backend.step({...job,frame:job.frame+1},{...options,resetParticles:false});await vi.waitFor(()=>expect(done).toBeTypeOf('function'));
  await expect(backend.dispose()).rejects.toMatchObject({kind:'cleanup'});expect(wire.render.mock.calls.at(-1)![1]).not.toHaveProperty('signal');done(renderReply(request));await pending;await backend.dispose();expect(backend.diagnostics().retainedBytes).toBe(0);
 });
});
