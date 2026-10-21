import {afterEach,describe,expect,it,vi} from 'vitest';
import {Generator} from '../src/engine/client';
import {GenerationQueue} from '../src/engine/generationQueue';
import {snapshotGenerationInput} from '../src/engine/generationInput';
import {SourceFractalLiveSession} from '../src/engine/sourceFractalLiveSession';
import {parseProjectFile} from '../src/engine/legacyImport';
import type {GenerationInput,SceneDocument,SceneOutput} from '../src/types';
import type {GenerationRequest,GenerationResponse} from '../src/engine/generationProtocol';
import {FractalLiveGenerationError,type PausedCaptureResult} from '../src/engine/generationProtocol';

class FakeWorker {
 static instances:FakeWorker[]=[];messages:GenerationRequest[]=[];terminated=false;
 onmessage:((event:{data:GenerationResponse})=>void)|null=null;onerror:((event:{message:string})=>void)|null=null;
 constructor(){FakeWorker.instances.push(this);}postMessage(message:GenerationRequest){this.messages.push(structuredClone(message));}terminate(){this.terminated=true;}
 emit(data:GenerationResponse){this.onmessage?.({data});}
}
const scene=()=>parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'fractal transport',type:'FRACTAL',fractal:{formula_id:'newton'},timeline:[{type:'wait',duration:2}]})).scene;
const context=():GenerationInput=>({time:0,quality:'preview',width:4,height:4,fractalViewport:{logicalWidth:4,logicalHeight:4,target:'primary'},fractalLive:{sessionId:'fractal-live',revision:0,intent:'apply',actualFrameRate:60,clock:{paused:true}}});
function rendered(s:SceneDocument,c=context()):SceneOutput {
 // Only transport facts are isolated here; original math is exercised by the
 // real host. No simulated renderer is evidence of real WebGL pixels.
 return new SourceFractalLiveSession((_scene,ctx)=>({type:'raster',width:ctx.width,height:ctx.height,pixels:new Uint8ClampedArray(ctx.width*ctx.height*4),stats:{samples:1,generated:1,invalid:0},fractalRender:{} as NonNullable<Extract<SceneOutput,{type:'raster'}>['fractalRender']>})).generate(s,c);
}
function captured(s:SceneDocument,c=context()):PausedCaptureResult {
 const render=(_scene:SceneDocument,ctx:GenerationInput):SceneOutput=>({type:'raster',width:ctx.width,height:ctx.height,pixels:new Uint8ClampedArray(ctx.width*ctx.height*4),stats:{samples:1,generated:1,invalid:0},fractalRender:{} as NonNullable<Extract<SceneOutput,{type:'raster'}>['fractalRender']>});
 const owner=new SourceFractalLiveSession(render);owner.generate(s,c);
 const result=owner.capturePaused(s,{...c,width:3,height:5});
 result.capture.fractalCurrentImage={model:'local-current-numerical-snapshot',baseSize:[3,5],scale:1,resampling:'none'};return result;
}
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
afterEach(()=>vi.unstubAllGlobals());
describe('Fractal live worker client contract',()=>{
 it('snapshots captured configuration and fences independent pause acknowledgements',async()=>{
  FakeWorker.instances=[];vi.stubGlobal('Worker',FakeWorker);const generator=new Generator(),s=scene(),c=context();c.fractalLive!.configuration=structuredClone(s);
  const input=snapshotGenerationInput(c);c.fractalLive!.configuration.settings.centerX=9;expect(input.fractalLive!.configuration!.settings.centerX).not.toBe(9);
  const p=generator.generate(s,input),w=FakeWorker.instances[0],request=w.messages[0],output=rendered(s,input);
  w.emit({operation:'generate',id:request.id,sessionId:request.sessionId,output});expect(await p).toBe(output);
  await expect(generator.setFractalPaused(structuredClone(output),false)).rejects.toThrow('当前');
  const pause=generator.setFractalPaused(output,false,500),control=w.messages.at(-1)!;
  expect(control).toMatchObject({operation:'fractal-playback',sourceId:request.id,paused:false,timestampMs:500});
  await expect(generator.generate(s,input)).rejects.toThrow('尚未完成');
  w.emit({operation:'fractal-playback',id:control.id,sessionId:control.sessionId,sourceId:request.id,paused:false});await pause;expect(w.terminated).toBe(false);
  const again=generator.setFractalPaused(output,true),last=w.messages.at(-1)!;w.emit({operation:'fractal-playback',id:last.id,sessionId:last.sessionId,sourceId:999,paused:true});
  await expect(again).rejects.toThrow('身份');expect(w.terminated).toBe(true);generator.dispose();
 });
 for(const mismatch of ['revision','session','frame','target','renderKind','missing'] as const)it(`rejects a ${mismatch} mismatch before accepting a live image capability`,async()=>{
  FakeWorker.instances=[];vi.stubGlobal('Worker',FakeWorker);const generator=new Generator(),s=scene(),p=generator.generate(s,context()),caught=p.catch(e=>e),w=FakeWorker.instances[0],request=w.messages[0],output=rendered(s);
  if(output.type!=='raster')throw Error('raster');
  if(mismatch==='revision')output.fractalLive!.revision++;
  else if(mismatch==='session')output.fractalLive!.sessionId='other';
  else if(mismatch==='frame')output.fractalLive!.sceneTime=3;
  else if(mismatch==='target')output.fractalLive!.target='offscreen';
  else if(mismatch==='renderKind')output.fractalLive!.renderKind='snapshot';
  else delete output.fractalLive;
  w.emit({operation:'generate',id:request.id,sessionId:request.sessionId,output});expect((await caught).message).toContain('不匹配');expect(w.terminated).toBe(true);
 });
 for(const live of [false,true])for(const progress of [false,true])for(const missing of [false,true])it(`fails closed for ${missing?'missing':'malformed'} labels on ${live?'live':'fresh'} ${progress?'progress':'final'} frames`,async()=>{
  FakeWorker.instances=[];vi.stubGlobal('Worker',FakeWorker);const generator=new Generator(),s=scene(),c=context();if(!live)delete c.fractalLive;
  const delivered=vi.fn(),pending=generator.generate(s,c,delivered),caught=pending.catch(e=>e),worker=FakeWorker.instances[0],request=worker.messages[0],output=rendered(s);
  if(output.type!=='raster')throw Error('raster');
  if(missing)delete output.formulaPresentation;else output.formulaPresentation={referenceWidth:NaN,referenceHeight:720,labels:[]};
  if(progress)worker.emit({operation:'generate-progress',id:request.id,sessionId:request.sessionId,output});
  else worker.emit({operation:'generate',id:request.id,sessionId:request.sessionId,output});
  expect((await caught).message).toContain(live?'不匹配':'公式标注无效');expect(delivered).not.toHaveBeenCalled();expect(worker.terminated).toBe(true);generator.dispose();
 });
 it('renews a validated current PNG capability and retains it after owner-confirmed configuration rejection',async()=>{
  FakeWorker.instances=[];vi.stubGlobal('Worker',FakeWorker);const generator=new Generator(),s=scene(),c=context(),first=generator.generate(s,c),w=FakeWorker.instances[0],request=w.messages[0],output=rendered(s,c);
  w.emit({operation:'generate',sessionId:request.sessionId,id:request.id,output});await first;
  const capture=generator.captureFractalPaused(output,{width:3,height:5}),captureRequest=w.messages.at(-1)!,result=captured(s,c);
  w.emit({operation:'fractal-paused-capture',sessionId:captureRequest.sessionId,id:captureRequest.id,result});expect(await capture).toBe(result);
  await expect(generator.captureFractalPaused(output,{width:3,height:5})).rejects.toThrow('过期');
  const next=generator.generate(s,{...c,fractalLive:{...c.fractalLive!,revision:1}}).catch(e=>e),failed=w.messages.at(-1)!;
  w.emit({operation:'generate',sessionId:failed.sessionId,id:failed.id,error:'invalid configuration',retainedSourceId:captureRequest.id});expect(await next).toMatchObject({previewRetained:true});
  const pause=generator.setFractalPaused(result.preview,false),control=w.messages.at(-1)!;
  expect(control).toMatchObject({operation:'fractal-playback',sourceId:captureRequest.id});
  w.emit({operation:'fractal-playback',sessionId:control.sessionId,id:control.id,sourceId:captureRequest.id,paused:false});await pause;expect(w.terminated).toBe(false);generator.dispose();
 });
 for(const mismatch of ['target','revision','ordinal','state','size','facts','labels'] as const)it(`invalidates a current PNG with mismatched ${mismatch}`,async()=>{
  FakeWorker.instances=[];vi.stubGlobal('Worker',FakeWorker);const generator=new Generator(),s=scene(),first=generator.generate(s,context()),w=FakeWorker.instances[0],request=w.messages[0],output=rendered(s);
  w.emit({operation:'generate',sessionId:request.sessionId,id:request.id,output});await first;
  const capture=generator.captureFractalPaused(output,{width:3,height:5}).catch(e=>e),captureRequest=w.messages.at(-1)!,result=captured(s);
  if(mismatch==='target')result.capture.fractalLive!.target='primary';
  else if(mismatch==='revision')result.preview.fractalLive!.revision++;
  else if(mismatch==='ordinal')result.capture.fractalLive!.updateOrdinal++;
  else if(mismatch==='state'){const frame=result.preview.fractalLive!.presentation.evaluatedFractalScene!;result.preview.fractalLive!.presentation.evaluatedFractalScene={...frame,formula:{...frame.formula,native:{...frame.formula.native,bailout:100}}};}
  else if(mismatch==='size'){result.capture.width=5;result.capture.height=3;}
  else if(mismatch==='labels')delete result.capture.formulaPresentation;
  else delete result.capture.fractalCurrentImage;
  w.emit({operation:'fractal-paused-capture',sessionId:captureRequest.sessionId,id:captureRequest.id,result});expect(await capture).toMatchObject({previewRetained:false,message:expect.stringContaining('不匹配')});expect(w.terminated).toBe(true);
 });
});
describe('Fractal live queue ordering',()=>{
 function setup(){
  const requests:{scene:SceneDocument;context:GenerationInput;resolve:(output:SceneOutput)=>void;reject:(e:Error)=>void;progress?:(output:SceneOutput)=>void}[]=[],controls:{resolve:()=>void}[]=[],captures:{resolve:(result:PausedCaptureResult)=>void}[]=[];
  const port={generate:vi.fn((s:SceneDocument,c:GenerationInput,progress?:(output:SceneOutput)=>void)=>new Promise<SceneOutput>((resolve,reject)=>requests.push({scene:s,context:c,resolve,reject,progress}))),setFractalPaused:vi.fn(()=>new Promise<void>(resolve=>controls.push({resolve}))),captureFractalPaused:vi.fn(()=>new Promise<PausedCaptureResult>(resolve=>captures.push({resolve}))),cancel:vi.fn(),dispose:vi.fn()};
  const callbacks={output:vi.fn(),error:vi.fn(),busy:vi.fn()},queue=new GenerationQueue(port,callbacks);return{queue,port,callbacks,requests,controls,captures};
 }
 it('keeps the exact pending hot snapshot through a merged stage and uses actual progress time',async()=>{
  const f=setup(),s=scene(),c=context();f.queue.request(s,c);f.requests[0].resolve(rendered(s,c));await flush();f.port.cancel.mockClear();
  const captured=structuredClone(s);captured.settings.centerX=2;const hot={...c,fractalLive:{...c.fractalLive!,revision:1,intent:'hot' as const,configuration:captured}};
  f.queue.request(captured,hot,100);
  const staged=structuredClone(captured);staged.settings.centerX=9;staged.settings.renderMethod='guessing';
  f.queue.request(staged,{...hot,fractalLive:{...hot.fractalLive,configuration:undefined}},0);
  // Force the already queued configuration through the independent clock gate.
  const pause=f.queue.setFractalPaused(true);f.controls[0].resolve();await pause;await flush();
  expect(f.requests).toHaveLength(2);expect(f.requests[1].context.fractalLive!.configuration!.settings.centerX).toBe(2);expect(f.requests[1].scene.settings.centerX).toBe(9);expect(f.port.cancel).not.toHaveBeenCalled();
  const progress=rendered(s,{...c,fractalLive:{...c.fractalLive!,startAt:.25}});if(progress.type!=='raster')throw Error('raster');
  f.requests[1].progress!(progress);expect(f.callbacks.output.mock.calls.at(-1)![1]).toBe(progress.fractalLive!.sceneTime);expect(progress.fractalLive!.sceneTime).toBeGreaterThan(0);
  f.requests[1].resolve(progress);await flush();f.queue.dispose();
 });
 it('coalesces acknowledged same-revision metadata without drawing or applying staged settings',async()=>{
  const f=setup(),s=scene(),c=context();c.fractalLive!.configuration=structuredClone(s);f.queue.request(s,c);const output=rendered(s,c);f.requests[0].resolve(output);await flush();f.port.cancel.mockClear();
  const staged=structuredClone(s);staged.settings.background='#ffffff';staged.timeline.tracks=[];
  f.queue.request(staged,{...c,time:7,fractalLive:{...c.fractalLive!,configuration:undefined,actualFrameRate:31,clock:{paused:true,timestampMs:9000}}},0,'metadata');await flush();
  expect(f.requests).toHaveLength(1);expect(f.callbacks.output).toHaveBeenLastCalledWith(output,0,staged);expect(f.port.cancel).not.toHaveBeenCalled();
  const pending=f.queue.setFractalPaused(false);expect(f.port.setFractalPaused).toHaveBeenCalledWith(output,false);f.controls[0].resolve();await pending;f.queue.dispose();
 });
 it('preserves the exact previous frame through rejected admission and serializes current PNG before deferred draws',async()=>{
  const f=setup(),s=scene(),c=context(),output=rendered(s,c);f.queue.request(s,c);f.requests[0].resolve(output);await flush();f.port.cancel.mockClear();
  const invalid=structuredClone(s);invalid.settings.perturbationPrecision='UNKNOWN';f.queue.request(invalid,{...c,fractalLive:{...c.fractalLive!,revision:1,intent:'hot',configuration:invalid}});
  f.requests[1].reject(new FractalLiveGenerationError('bad precision',true));await flush();
  const pause=f.queue.setFractalPaused(true);expect(f.port.setFractalPaused).toHaveBeenCalledWith(output,true);f.controls[0].resolve();await pause;await flush();expect(f.requests).toHaveLength(2);
  const png=f.queue.captureFractalPaused(output,{width:3,height:5}),result=captured(s,c);expect(f.port.captureFractalPaused).toHaveBeenCalledWith(output,{width:3,height:5},1);
  f.queue.request(s,c);expect(f.requests).toHaveLength(2);expect(f.port.cancel).not.toHaveBeenCalled();
  const cancelled=png.catch(e=>e);f.captures[0].resolve(result);expect((await cancelled).name).toBe('AbortError');await flush();expect(f.requests).toHaveLength(3);
  f.requests[2].resolve(output);await flush();const png2=f.queue.captureFractalPaused(output,{width:3,height:5});f.captures[1].resolve(result);expect(await png2).toBe(result.capture);expect(f.callbacks.output).toHaveBeenLastCalledWith(result.preview,0,s);f.queue.dispose();
 });
});
