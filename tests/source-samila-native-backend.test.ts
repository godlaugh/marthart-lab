import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const transport=vi.hoisted(()=>vi.fn());
vi.mock('../src/engine/sourceNativeClient',async importActual=>({...await importActual<typeof import('../src/engine/sourceNativeClient')>(),exchangeSourceSamilaNative:transport}));
vi.mock('../src/engine/sourceNativeLease',()=>({ensureSourceNativeLease:async()=>{},sourceNativeLeaseToken:()=>undefined}));
import {SourceSamilaNativeBackend} from '../src/engine/sourceSamilaNativeBackend';
import {SourceSamilaAsyncSession} from '../src/engine/sourceSamilaAsyncSession';
import type {SourceNativeSamilaResponse} from '../src/engine/sourceNativeClient';
import type {SourceSamilaNativeRequest} from '../src/engine/sourceSamilaNativeProtocol';
import {parseLegacyScene,parseProjectFile} from '../src/engine/legacyImport';
import {Generator} from '../src/engine/client';
import {GenerationQueue,retryRetiredGenerationQueueCleanup} from '../src/engine/generationQueue';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {writeSourceSamilaParameter,sourceSamilaPaletteRuntimeScene} from '../src/engine/sourceSamilaPaletteEditing';
import type {GenerateContext} from '../src/types';

const source={config_version:'1.0.0',type:'SAMILA',name:'Native owner',palette:['#112233','#abcdef'],settings:{batch_size:13},parameters:{a:0},equations:{f1:'sin(x*y)+a',f2:'cos(x-y)'},timeline:[{type:'wait',duration:1}]};
const scene=()=>parseLegacyScene(JSON.stringify(source)).scene;
const context:GenerateContext={width:17,height:13,time:0,quality:'preview',samilaPrimaryPixelHeight:972,samilaLive:{sessionId:'native-owner',pixelDensity:1}};
const owners:SourceSamilaAsyncSession[]=[],generators:Generator[]=[];
function owner(seed=1){const backend=new SourceSamilaNativeBackend(),session=new SourceSamilaAsyncSession(backend,{samilaSeedProvider:()=>seed});owners.push(session);return{backend,session};}
function reply(request:SourceSamilaNativeRequest):SourceNativeSamilaResponse {
 const op=request.operation,display=op.kind==='display'||op.kind==='present',accumulate=op.kind==='display'||op.kind==='step',steps=accumulate?op.baseBatch*op.passes:0;
 return{width:request.width,height:request.height,generation:request.generation,sequence:request.sequence,resource:op.resource,committedDisplays:accumulate?op.expectedIndex+1:op.kind==='present'?op.expectedIndex:0,disposition:op.kind==='release'?'absent':'owned',steps,accepted:steps,clipped:0,invalid:0,occupiedPixels:display?1:0,maxCount:display ? .5 : 0,invalidInkPixels:0,...(display?{pixels:new Uint8ClampedArray(request.width*request.height*4)}:{}),rendererIdentity:'a'.repeat(64),contextSerial:9,sessionSerial:4,requestBytes:128};
}
const operations=()=>transport.mock.calls.map(([request])=>(request as SourceSamilaNativeRequest).operation);
beforeEach(()=>{transport.mockReset().mockImplementation(async request=>reply(request));});
afterEach(async()=>{
 transport.mockReset().mockImplementation(async request=>reply(request));
 await retryRetiredGenerationQueueCleanup();
 for(const generator of generators.splice(0)){generator.dispose();await generator.settledNativeCleanup();}
 for(const session of owners.splice(0))await session.release();vi.unstubAllGlobals();vi.unstubAllEnvs();
});

describe('Samila native resource/backend integration (real producers, mock transport)',()=>{
 it('keeps two independent histories and only frees the requested owner',async()=>{
  const a=owner(11),b=owner(22),third=owner(33),s=scene();
  expect((await a.session.generate(s,context)).samilaLive?.displayIndex).toBe(0);expect((await b.session.generate(s,context)).samilaLive?.displayIndex).toBe(0);
  const creates=operations().filter(op=>op.kind==='create');expect(creates).toHaveLength(2);expect(creates[0].resource).not.toBe(creates[1].resource);
  await expect(third.session.generate(s,context)).rejects.toMatchObject({kind:'capacity'});expect(third.session.diagnostics().random.words).toBe(0);
  expect((await a.session.generate(s,context)).samilaLive?.displayIndex).toBe(1);await a.session.release();
  expect(b.backend.diagnostics()).toMatchObject({owned:true,displayIndex:1,resources:1});expect((await b.session.generate(s,context)).samilaLive?.displayIndex).toBe(1);expect((await third.session.generate(s,context)).samilaLive?.displayIndex).toBe(0);
  const displays=operations().filter(op=>op.kind==='display');expect(displays.slice(0,4).map(op=>[op.resource,op.expectedIndex,op.seed])).toEqual([[creates[0].resource,0,11],[creates[1].resource,0,22],[creates[0].resource,1,11],[creates[1].resource,1,22]]);expect(displays[4]).toMatchObject({expectedIndex:0,seed:33});expect(creates.map(op=>op.resource)).not.toContain(displays[4].resource);
  expect(operations().filter(op=>op.kind==='release').map(op=>op.resource)).toEqual([creates[0].resource]);
 });
 it('keeps hot writes and six-pass compensation on the same native resource',async()=>{
  const {session,backend}=owner(),s=scene();await session.generate(s,context);const edited={...s,parameters:{...s.parameters,a:2}};
  const next=await session.generate(edited,context);expect(next.samilaLive).toMatchObject({displayIndex:1,parameterChanged:true,accumulationPasses:6});expect(next.density).toMatchObject({accepted:78,inputPoints:78});
  const ops=operations(),displays=ops.filter(op=>op.kind==='display');expect(ops.filter(op=>op.kind==='create')).toHaveLength(1);expect(displays[1]).toMatchObject({resource:displays[0].resource,expectedIndex:1,clear:true,passes:6,baseBatch:13});expect(backend.diagnostics().displayIndex).toBe(2);
 });
 it('reuses an acknowledged desktop-size target and charges a provisional create only once',async()=>{
  const {session}=owner(),s=scene(),desktop={...context,width:1724,height:1160};
  await session.generate(s,desktop);await session.generate(s,desktop);await session.generate({...s,parameters:{...s.parameters,a:2}},desktop);
  const calls=transport.mock.calls,create=calls.find(([r])=>r.operation.kind==='create')!;
  expect(create[1]?.retainedBytes).toBe(0);expect(create[1]?.retainedTarget).toBeUndefined();
  const displays=calls.filter(([r])=>r.operation.kind==='display');expect(displays).toHaveLength(3);expect(displays[0][1]?.retainedTarget).toBeUndefined();
  for(const [,options] of displays.slice(1))expect(options?.retainedTarget).toEqual({resource:create[0].operation.resource,width:1724,height:1160});
  expect(displays[2][0].operation).toMatchObject({passes:6,expectedIndex:2});expect(operations().filter(op=>op.kind==='create')).toHaveLength(1);
 });
 it.each(['renderer','context','session'] as const)('rejects changed %s identity without continuing or silently recreating history',async identity=>{
  const {session,backend}=owner(),s=scene();await session.generate(s,context);transport.mockImplementationOnce(async request=>({...reply(request),...(identity==='renderer'?{rendererIdentity:'b'.repeat(64)}:identity==='context'?{contextSerial:10}:{sessionSerial:5})}));
  await expect(session.generate(s,context)).rejects.toMatchObject({kind:'state-lost'});expect(backend.diagnostics()).toMatchObject({owned:true,cleanupPending:true,displayIndex:1});expect(session.diagnostics().displayIndex).toBe(1);
  const count=transport.mock.calls.length;await expect(session.generate(s,context)).rejects.toThrow('显式重置');expect(transport).toHaveBeenCalledTimes(count);expect(operations().filter(op=>op.kind==='create')).toHaveLength(1);
 });
 it.each([false,true])('accounts for possibly allocated targets after lost display acknowledgement (resize=%s)',async resize=>{
  const {session,backend}=owner(),s=scene();if(resize)await session.generate(s,context);
  transport.mockImplementation(async(request:SourceSamilaNativeRequest)=>{if(request.operation.kind==='display')throw Error('display acknowledgement lost');return reply(request);});
  await expect(session.generate(s,{...context,width:500,height:600})).rejects.toThrow('display acknowledgement lost');
  // Failed transport cannot prove the requested MRT/ink targets were never
  // allocated. Their known minimum alone exceeds the old 17x13 resource.
  expect(backend.diagnostics()).toMatchObject({owned:true,cleanupPending:true});expect(backend.diagnostics().retainedBytes).toBeGreaterThanOrEqual(500*600*52);
 });
 it('retains an unacknowledged create token until explicit idempotent release succeeds',async()=>{
  const {session,backend}=owner(),s=scene();transport.mockRejectedValueOnce(Error('create acknowledgement lost'));
  await expect(session.generate(s,context)).rejects.toThrow('create acknowledgement lost');const create=operations()[0];expect(create.kind).toBe('create');expect(backend.diagnostics()).toMatchObject({owned:true,cleanupPending:true,displayIndex:0});
  transport.mockRejectedValueOnce(Error('release unavailable'));await expect(session.reset()).rejects.toThrow('release unavailable');expect(backend.diagnostics().owned).toBe(true);
  await session.reset();expect(backend.diagnostics()).toMatchObject({owned:false,resources:0});expect(operations().filter(op=>op.kind==='release').map(op=>op.resource)).toEqual([create.resource,create.resource]);
 });
 it('cancels one submitted display and retains its exact token when release fails',async()=>{
  const {session,backend}=owner(),s=scene();let submitted=false;
  transport.mockImplementation((request:SourceSamilaNativeRequest,options:{signal?:AbortSignal})=>{
   if(request.operation.kind==='display'){submitted=true;return new Promise((_resolve,reject)=>options.signal!.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}));}
   return Promise.resolve(reply(request));
  });
  const draw=session.generate(s,context),failed=expect(draw).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(submitted).toBe(true));const resource=operations()[0].resource;
  transport.mockImplementation(async request=>{if(request.operation.kind==='release')throw Error('release still pending');return reply(request);});await expect(session.reset()).rejects.toThrow('release still pending');await failed;
  expect(backend.diagnostics()).toMatchObject({owned:true,active:false,cleanupPending:true,displayIndex:0});expect(operations().filter(op=>op.kind==='display')).toHaveLength(1);expect(operations().at(-1)).toMatchObject({kind:'release',resource});
  transport.mockImplementation(async request=>reply(request));await session.reset();await session.generate(s,context);const creates=operations().filter(op=>op.kind==='create');expect(creates).toHaveLength(2);expect(creates[1].resource).not.toBe(resource);
 });
 it('projects UI metadata before the Generator clones a native scene; pause and capture use the owned session',async()=>{
  vi.stubEnv('VITE_SOURCE_RENDERER','native');const generator=new Generator();generators.push(generator);const s=parseProjectFile(JSON.stringify(source)).scene;Object.assign(s.samilaPaletteEditor!,{uiOnly:()=>{}});
  const realtime={...context,samilaLive:{...context.samilaLive!,clock:{paused:false}}};const output=await generator.generate(s,realtime);expect(output).toMatchObject({type:'raster',backend:'native',samilaLive:{target:'primary'}});
  const calls=transport.mock.calls.length;await generator.setSamilaPaused(output,true);expect(transport).toHaveBeenCalledTimes(calls);
  const captured=await generator.captureSamilaPaused(output,{width:19,height:15});expect(captured.capture).toMatchObject({width:19,height:15,samilaLive:{target:'offscreen',displayIndex:1}});expect(captured.preview).toMatchObject({width:17,height:13,samilaLive:{target:'primary',displayIndex:2}});expect(operations().filter(op=>op.kind==='create')).toHaveLength(1);
 });
 it('blocks ordinary hot generation after unknown display success until a new live incarnation is requested',async()=>{
  vi.stubEnv('VITE_SOURCE_RENDERER','native');const generator=new Generator();generators.push(generator);const s=scene();await generator.generate(s,context);
  transport.mockRejectedValueOnce(Error('display acknowledgement lost'));await expect(generator.generate(s,context)).rejects.toThrow('display acknowledgement lost');const calls=transport.mock.calls.length;
  await expect(generator.generate({...s,parameters:{...s.parameters,a:2}},context)).rejects.toMatchObject({kind:'state-lost'});expect(transport).toHaveBeenCalledTimes(calls);
  const restarted=await generator.generate(s,{...context,samilaLive:{...context.samilaLive!,sessionId:'explicit-full-apply'}});expect(restarted).toMatchObject({samilaLive:{sessionId:'explicit-full-apply',displayIndex:0}});expect(operations().filter(op=>op.kind==='create')).toHaveLength(2);expect(operations().filter(op=>op.kind==='release')).toHaveLength(1);
 });
 it('does not let a queued newer edit silently replace a failed native display',async()=>{
  vi.stubEnv('VITE_SOURCE_RENDERER','native');const generator=new Generator();generators.push(generator);const s=scene(),errors=vi.fn(),outputs=vi.fn(),queue=new GenerationQueue(generator,{error:errors,output:outputs,busy:()=>{}});let fail!:(error:Error)=>void;
  transport.mockImplementation((request:SourceSamilaNativeRequest)=>request.operation.kind==='display'?new Promise((_resolve,reject)=>{fail=reject;}):Promise.resolve(reply(request)));
  try{
   queue.request(s,context);await vi.waitFor(()=>expect(fail).toBeTypeOf('function'));queue.request({...s,parameters:{...s.parameters,a:2}},context);
   // The superseded failure is not published by the queue; its newest request
   // still has to encounter the retained failed incarnation, not fresh ink.
   transport.mockImplementation(async request=>reply(request));fail(Error('display acknowledgement lost'));
   await vi.waitFor(()=>expect(errors).toHaveBeenCalledOnce());expect(errors.mock.calls[0][0]).toMatchObject({kind:'state-lost'});expect(outputs).not.toHaveBeenCalled();expect(operations().filter(op=>op.kind==='create')).toHaveLength(1);expect(operations().filter(op=>op.kind==='display')).toHaveLength(1);
  }finally{queue.dispose();}
 });
 it('retains failed capture incarnation identity until explicit cancel authorizes reconstruction',async()=>{
  vi.stubEnv('VITE_SOURCE_RENDERER','native');const generator=new Generator();generators.push(generator);const s=scene(),paused={...context,samilaLive:{...context.samilaLive!,clock:{paused:true}}},output=await generator.generate(s,paused);
  transport.mockRejectedValueOnce(Error('capture acknowledgement lost'));await expect(generator.captureSamilaPaused(output,{width:19,height:15})).rejects.toMatchObject({previewRetained:false});const calls=transport.mock.calls.length;
  await expect(generator.generate(s,paused)).rejects.toMatchObject({kind:'state-lost'});expect(transport).toHaveBeenCalledTimes(calls);
  generator.cancel();await generator.settledNativeCleanup();expect(await generator.generate(s,paused)).toMatchObject({samilaLive:{displayIndex:0}});expect(operations().filter(op=>op.kind==='create')).toHaveLength(2);
 });
 it('retains a disposed queue after native release failure and retries its exact owner when another queue opens',async()=>{
  vi.stubEnv('VITE_SOURCE_RENDERER','native');const generator=new Generator();generators.push(generator);const disposed=vi.spyOn(generator,'dispose'),outputs=vi.fn(),queue=new GenerationQueue(generator,{output:outputs,error:vi.fn(),busy:()=>{}});
  queue.request(scene(),context);await vi.waitFor(()=>expect(outputs).toHaveBeenCalledOnce());const resource=operations()[0].resource;
  transport.mockImplementation(async request=>{if(request.operation.kind==='release')throw Error('native release unavailable');return reply(request);});queue.dispose();
  await expect(retryRetiredGenerationQueueCleanup()).rejects.toThrow('资源清理仍未完成');expect(disposed).toHaveBeenCalledOnce();const failedReleases=operations().filter(op=>op.kind==='release').length;expect(failedReleases).toBeGreaterThan(0);
  transport.mockImplementation(async request=>reply(request));const nextGenerator=new Generator();generators.push(nextGenerator);const next=new GenerationQueue(nextGenerator,{output:vi.fn(),error:vi.fn(),busy:()=>{}});
  try{
   await vi.waitFor(()=>expect(operations().filter(op=>op.kind==='release')).toHaveLength(failedReleases+1));await retryRetiredGenerationQueueCleanup();
   expect(operations().filter(op=>op.kind==='release').every(op=>op.resource===resource)).toBe(true);expect(disposed).toHaveBeenCalledOnce();
   await retryRetiredGenerationQueueCleanup();expect(operations().filter(op=>op.kind==='release')).toHaveLength(failedReleases+1);
   expect(await nextGenerator.generate(scene(),context)).toMatchObject({samilaLive:{displayIndex:0}});
  }finally{next.dispose();await retryRetiredGenerationQueueCleanup();}
 });
 it('waits for native cleanup confirmation before handing a replacement to the Worker',async()=>{
  vi.stubEnv('VITE_SOURCE_RENDERER','native');const posted:unknown[]=[];vi.stubGlobal('Worker',class {postMessage(message:unknown){posted.push(message);}terminate(){}});const generator=new Generator();generators.push(generator);await generator.generate(scene(),context);
  const legacy=createScene(definition('samila')),input={width:17,height:13,time:0,quality:'preview' as const};transport.mockRejectedValueOnce(Error('native cleanup pending'));
  await expect(generator.generate(legacy,input)).rejects.toThrow('native cleanup pending');expect(posted).toHaveLength(0);
  const pending=generator.generate(legacy,input),cancelled=expect(pending).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(posted).toHaveLength(1));expect(operations().filter(op=>op.kind==='release')).toHaveLength(2);generator.cancel();await cancelled;
 });
 it('releases two retired native queues through one transport slot in a single cleanup pass',async()=>{
  vi.stubEnv('VITE_SOURCE_RENDERER','native');const a=new Generator(),b=new Generator();generators.push(a,b);const queues=[a,b].map(generator=>new GenerationQueue(generator,{output:vi.fn(),error:vi.fn(),busy:()=>{}}));
  await a.generate(scene(),context);await b.generate(scene(),context);const resources=operations().filter(op=>op.kind==='create').map(op=>op.resource);
  transport.mockImplementation(async request=>{if(request.operation.kind==='release')throw Error('release temporarily unavailable');return reply(request);});for(const queue of queues)queue.dispose();await expect(retryRetiredGenerationQueueCleanup()).rejects.toThrow('资源清理仍未完成');
  let active=false,overlaps=0;const released:string[]=[];
  transport.mockImplementation(async request=>{
   if(request.operation.kind==='release'){
    if(active){overlaps++;throw Error('single native transport slot is busy');}active=true;
    try{await new Promise(resolve=>setTimeout(resolve,1));released.push(request.operation.resource);}finally{active=false;}
   }
   return reply(request);
  });
  await retryRetiredGenerationQueueCleanup();expect(overlaps).toBe(0);expect(released).toEqual(resources);
  await retryRetiredGenerationQueueCleanup();expect(released).toEqual(resources);
 });
 it('routes source cold replay through independent steps and read-only presentations',async()=>{
  vi.stubEnv('VITE_SOURCE_RENDERER','native');const a=new Generator(),b=new Generator();generators.push(a,b);const s=scene(),c={width:17,height:13,time:0,quality:'export' as const,samilaPrimaryPixelHeight:972};
  const hot=await a.generate(s,{...context,samilaLive:{...context.samilaLive!,clock:{paused:true}}});await b.generate(s,c);const ops=operations(),aId=ops[0].resource,bId=ops.find(op=>op.kind==='step')!.resource;expect(aId).not.toBe(bId);expect(ops.map(op=>op.kind)).toEqual(['create','display','create','step','present']);
  const mark=ops.length;await b.generate(s,c);await b.generate({...s,settings:{...s.settings,normalizedBrightness:.625}},c);expect(operations().slice(mark).map(op=>op.kind)).toEqual(['present','present']);
  await a.setSamilaPaused(hot,true);b.dispose();await b.settledNativeCleanup();expect(operations().at(-1)).toMatchObject({kind:'release',resource:bId});expect(operations().filter(op=>op.resource===aId).map(op=>op.kind)).toEqual(['create','display']);
  expect(await a.generate(s,{...context,samilaLive:{...context.samilaLive!,clock:{paused:true}}})).toMatchObject({samilaLive:{displayIndex:1}});
 });
 it('soft-cancels a submitted cold step, acknowledges it, then releases only its owner',async()=>{
  vi.stubEnv('VITE_SOURCE_RENDERER','native');const a=new Generator(),b=new Generator();generators.push(a,b);const s=scene();await a.generate(s,context);let complete!:(value:SourceNativeSamilaResponse)=>void,submitted:SourceSamilaNativeRequest|undefined,signal:AbortSignal|undefined;
  transport.mockImplementation((request:SourceSamilaNativeRequest,options:{signal?:AbortSignal})=>{if(request.operation.kind==='step'){submitted=request;signal=options.signal;return new Promise(resolve=>{complete=resolve;});}return Promise.resolve(reply(request));});
  const work=b.generate(s,{width:17,height:13,time:0,quality:'export',samilaPrimaryPixelHeight:972}),cancelled=expect(work).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(submitted).toBeDefined());b.cancel();await cancelled;
  expect(signal?.aborted).toBe(false);expect(operations().some(op=>op.kind==='release')).toBe(false);complete(reply(submitted!));await b.settledNativeCleanup();
  expect(signal?.aborted).toBe(false);expect(operations().filter(op=>op.resource===submitted!.operation.resource).map(op=>op.kind)).toEqual(['create','step','release']);expect(await a.generate(s,context)).toMatchObject({samilaLive:{displayIndex:1}});
 });
 it('keeps legacy Samila without a source live context on the existing Worker route',async()=>{
  vi.stubEnv('VITE_SOURCE_RENDERER','native');const posted:unknown[]=[];let terminated=0;vi.stubGlobal('Worker',class {postMessage(message:unknown){posted.push(message);}terminate(){terminated++;}});
  const generator=new Generator();generators.push(generator);const pending=generator.generate(createScene(definition('samila')),{width:17,height:13,time:0,quality:'preview'}),cancelled=expect(pending).rejects.toMatchObject({name:'AbortError'});
  expect(posted).toHaveLength(1);expect(posted[0]).toMatchObject({operation:'generate',scene:{kind:'samila'}});expect(transport).not.toHaveBeenCalled();generator.cancel();await cancelled;expect(terminated).toBe(1);
 });
 it('records the applied Samila scene through the public Generator and resumes one owned primary',async()=>{
  vi.stubEnv('VITE_SOURCE_RENDERER','native');const generator=new Generator();generators.push(generator);
  const initial=parseProjectFile(JSON.stringify(source)).scene,base={...context,samilaLive:{...context.samilaLive!,clock:{paused:true}}};
  await generator.generate(initial,base);
  const edited=writeSourceSamilaParameter(initial,'a',5),input={...base,samilaLive:{...base.samilaLive,parameterRevisions:edited.samilaPaletteSession!.parameterRevisions}},preview=await generator.generate(edited,input);
  const mark=operations().length,start=await generator.beginSourceRecording(preview,{width:5,height:7,simulationFps:10});
  expect(start.warmup).toMatchObject({width:15,height:21,samilaRecording:{displayFrame:0,warmup:true,complete:false},samilaLive:{target:'offscreen',displayIndex:0,clock:'fixed-source-queue',runtime:{paused:false}}});
  expect(sourceSamilaPaletteRuntimeScene(start.scene).parameters.a).toBe(0);expect(start.scene.parameters.a).toBe(5);
  expect(operations().slice(mark).map(op=>op.kind)).toEqual(['release','create','display']);
  expect(generator.hasSourceRecording(start.handle)).toBe(true);
  await expect(generator.generate(initial,base)).rejects.toThrow('录制期间');
  await expect(generator.nextSourceRecordingFrame({...start.handle},1)).rejects.toThrow('身份无效');
  const frame=await generator.nextSourceRecordingFrame(start.handle,1);expect(frame.samilaRecording).toMatchObject({displayFrame:1,warmup:false});
  const before=operations().length;await expect(generator.nextSourceRecordingFrame(start.handle,1)).rejects.toThrow();expect(operations()).toHaveLength(before);
  const stopped=await generator.finishSourceRecording(start.handle,5000);
  expect(stopped.context).toMatchObject({width:17,height:13,samilaLive:{sessionId:'native-owner',dirtyRevision:0,runtimeRevision:0,parameterRevisions:{},clock:{paused:false}}});
  expect(stopped.preview).toMatchObject({samilaLive:{displayIndex:2,target:'primary',runtime:{sceneTime:frame.samilaLive!.runtime!.sceneTime}}});
  expect(stopped.preview).not.toHaveProperty('samilaRecording');expect(generator.hasSourceRecording(start.handle)).toBe(false);
  expect(await generator.generate(stopped.scene,stopped.context)).toMatchObject({samilaLive:{displayIndex:3}});
 });
 it('keeps preflight rejection usable and never consumes a native draw or seed',async()=>{
  vi.stubEnv('VITE_SOURCE_RENDERER','native');const generator=new Generator();generators.push(generator);const s=scene(),input={...context,samilaLive:{...context.samilaLive!,clock:{paused:true}}},output=await generator.generate(s,input),before=operations().length;
  await expect(generator.beginSourceRecording(output,{width:100000,height:100000,simulationFps:10})).rejects.toMatchObject({previewRetained:true,recordingRetained:false});expect(operations()).toHaveLength(before);
  const start=await generator.beginSourceRecording(output,{width:5,height:7,simulationFps:10});await generator.finishSourceRecording(start.handle);
 });
 it('soft-cancels an in-flight recording frame then restores primary after its acknowledgement',async()=>{
  vi.stubEnv('VITE_SOURCE_RENDERER','native');const generator=new Generator();generators.push(generator);
  const s=scene(),input={...context,samilaLive:{...context.samilaLive!,clock:{paused:true}}},callbacks={output:vi.fn(),error:vi.fn(),busy:vi.fn(),recordingStopped:vi.fn()},queue=new GenerationQueue(generator,callbacks);
  queue.request(s,input);await vi.waitFor(()=>expect(callbacks.output).toHaveBeenCalledOnce());const preview=callbacks.output.mock.calls[0][0],controller=new AbortController();let submitted:SourceSamilaNativeRequest|undefined,signal:AbortSignal|undefined,complete!:(v:SourceNativeSamilaResponse)=>void;
  const frames=vi.fn(),record=queue.recordSource(preview,{width:5,height:7,simulationFps:10},{start:()=>{transport.mockImplementation((request:SourceSamilaNativeRequest,options:{signal?:AbortSignal})=>{if(request.operation.kind==='display'&&!submitted){submitted=request;signal=options.signal;return new Promise(resolve=>{complete=resolve;});}return Promise.resolve(reply(request));});},frame:frames},controller.signal),failed=record.catch(error=>error);
  await vi.waitFor(()=>expect(submitted).toBeDefined());const mark=operations().length;controller.abort();await Promise.resolve();expect(signal!.aborted).toBe(false);expect(operations()).toHaveLength(mark);expect(callbacks.recordingStopped).not.toHaveBeenCalled();
  complete(reply(submitted!));expect(await failed).toMatchObject({name:'AbortError'});expect(frames).not.toHaveBeenCalled();expect(signal!.aborted).toBe(false);expect(callbacks.recordingStopped).toHaveBeenCalledOnce();expect(callbacks.error).not.toHaveBeenCalled();expect(callbacks.recordingStopped.mock.calls[0][0].preview.samilaLive.target).toBe('primary');queue.dispose();await retryRetiredGenerationQueueCleanup();
 });
 it('releases an uncertain recording without replay and retains failed release for retry',async()=>{
  vi.stubEnv('VITE_SOURCE_RENDERER','native');const generator=new Generator();generators.push(generator);const s=scene(),input={...context,samilaLive:{...context.samilaLive!,clock:{paused:true}}},preview=await generator.generate(s,input),start=await generator.beginSourceRecording(preview,{width:5,height:7,simulationFps:10});
  transport.mockImplementation(async request=>{if(request.operation.kind==='display')throw Error('ACK lost');return reply(request);});await expect(generator.nextSourceRecordingFrame(start.handle,1)).rejects.toMatchObject({recordingRetained:true});const draws=operations().filter(op=>op.kind==='display').length;
  transport.mockImplementation(async request=>{if(request.operation.kind==='release')throw Error('release unavailable');return reply(request);});await expect(generator.finishSourceRecording(start.handle)).rejects.toMatchObject({recordingRetained:true});expect(generator.hasSourceRecording(start.handle)).toBe(true);
  transport.mockImplementation(async request=>reply(request));await expect(generator.finishSourceRecording(start.handle)).rejects.toMatchObject({previewRetained:false,recordingRetained:false});expect(generator.hasSourceRecording(start.handle)).toBe(false);expect(operations().filter(op=>op.kind==='display')).toHaveLength(draws);
 });

});
