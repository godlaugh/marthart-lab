import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Generator} from '../src/engine/client';
import {SourceFractalLiveSession} from '../src/engine/sourceFractalLiveSession';
import {prepareGenerationPresentation} from '../src/engine/generationPresentation';
import {parseProjectFile} from '../src/engine/legacyImport';
import {sourceProfileForFormula} from '../src/engine/fractalSourcePrecision';
import {prepareSourcePausedCaptureSize} from '../src/engine/sourcePausedCaptureSize';
import type {GenerationRequest,GenerationResponse,PausedCaptureResult} from '../src/engine/generationProtocol';
import type {FormulaPresentation,GenerationInput,SceneDocument,SceneOutput} from '../src/types';

type Raster=Extract<SceneOutput,{type:'raster'}>;

class WorkerTransport {
 static instances:WorkerTransport[]=[];
 messages:GenerationRequest[]=[];terminated=false;
 onmessage:((event:{data:GenerationResponse})=>void)|null=null;
 onerror:((event:{message:string})=>void)|null=null;
 constructor(){WorkerTransport.instances.push(this);}
 postMessage(message:GenerationRequest){this.messages.push(structuredClone(message));}
 terminate(){this.terminated=true;}
 emit(data:GenerationResponse){this.onmessage?.({data});}
 latest(){return this.messages.at(-1)!;}
}
const clients:Generator[]=[];
function scene():SceneDocument {
 const value=parseProjectFile(JSON.stringify({config_version:'1.0.0',name:'centered transport',type:'FRACTAL',fractal:{formula_id:'newton'},timeline:[{type:'wait',duration:.2}]})).scene;
 value.formulas={layout:'source-surface-centered-v1',main:{visible:true,x:0,y:1,scale:1,color:'#ffffff',anchor:'center',latex:'z^3-1'},additional:[]};
 return value;
}
const context=():GenerationInput=>({time:0,quality:'preview',width:6,height:4,fractalPixelDensity:2,fractalViewport:{logicalWidth:12,logicalHeight:8,target:'primary'},fractalLive:{sessionId:'centered-transport',revision:0,intent:'apply',actualFrameRate:60,clock:{paused:true,timestampMs:100}}});
// Only pixels and the renderer facts consumed by this transport are stubbed.
// Formula construction, numerical state and lifecycle binding are real owners;
// these tests do not establish GPU execution or original-runtime pixel parity.
function render(s:SceneDocument,c:GenerationInput):Raster {
 const formula=s.fractalSource!.formula.formulaId;
 if(typeof formula!=='string')throw Error('transport renderer fixture requires an explicit formula ID');
 const fractalRender={profile:sourceProfileForFormula(formula),formula,execution:{backend:'webgl2'},logicalSize:[c.fractalViewport!.logicalWidth,c.fractalViewport!.logicalHeight],requestedSize:[c.width,c.height],rasterSize:[c.width,c.height]} as unknown as Raster['fractalRender'];
 return{type:'raster',width:c.width,height:c.height,pixels:new Uint8ClampedArray(c.width*c.height*4),stats:{samples:1,generated:1,invalid:0},fractalRender};
}
function client(){const generator=new Generator();clients.push(generator);return generator;}
function centered(output:{formulaPresentation?:FormulaPresentation}){
 const formulas=output.formulaPresentation;
 if(formulas?.layout!=='source-surface-centered-v1')throw Error('expected source-centered formula producer');
 return formulas;
}
async function live(){
 const s=scene(),c=context(),owner=new SourceFractalLiveSession(render),output=owner.generate(s,c),generator=client();
 const pending=generator.generate(s,c),worker=WorkerTransport.instances.at(-1)!,request=worker.latest();
 worker.emit({operation:'generate',id:request.id,sessionId:request.sessionId,output});
 expect(await pending).toBe(output);return{s,c,owner,output,generator,worker};
}
function capture(f:Awaited<ReturnType<typeof live>>):PausedCaptureResult {
 const size={width:3,height:5},result=f.owner.capturePaused(f.s,{...f.c,...size}),base=prepareSourcePausedCaptureSize(size,f.c.fractalPixelDensity!);
 result.capture.sourceCurrentImage={model:'local-current-numerical-snapshot',stage:'base-before-formulas',requestedSize:[size.width,size.height],logicalSize:[base.logicalWidth,base.logicalHeight],pixelDensity:base.density,baseSize:[base.width,base.height],scale:1};
 return result;
}
beforeEach(()=>{WorkerTransport.instances=[];vi.stubGlobal('Worker',WorkerTransport);});
afterEach(()=>{for(const generator of clients.splice(0))generator.dispose();vi.unstubAllGlobals();});

describe('source-centered Fractal formulas across the public worker client',()=>{
 it('accepts real primary formula facts on progress and final frames independently of raster sampling',async()=>{
  const s=scene(),c=context(),owner=new SourceFractalLiveSession(render),output=owner.generate(s,c),generator=client(),progress=vi.fn();
  expect(centered(output)).toMatchObject({primaryLogicalHeight:8,labels:[{latex:'z^3-1',anchor:'center'}]});
  expect(output.height).toBe(4);
  const pending=generator.generate(s,c,progress),worker=WorkerTransport.instances[0],request=worker.latest();
  worker.emit({operation:'generate-progress',id:request.id,sessionId:request.sessionId,output});
  expect(progress).toHaveBeenCalledWith(output);
  worker.emit({operation:'generate',id:request.id,sessionId:request.sessionId,output});
  expect(await pending).toBe(output);expect(worker.terminated).toBe(false);
 });

 it.each(['generate-progress','generate'] as const)('rejects a raster-height formula anchor in a %s response',async operation=>{
  const s=scene(),c=context(),output=new SourceFractalLiveSession(render).generate(s,c),generator=client(),progress=vi.fn();
  centered(output).primaryLogicalHeight=output.height;
  const pending=generator.generate(s,c,progress),rejected=expect(pending).rejects.toThrow('不匹配'),worker=WorkerTransport.instances[0],request=worker.latest();
  if(operation==='generate-progress')worker.emit({operation:'generate-progress',id:request.id,sessionId:request.sessionId,output});
  else worker.emit({operation:'generate',id:request.id,sessionId:request.sessionId,output});
  await rejected;expect(progress).not.toHaveBeenCalled();expect(worker.terminated).toBe(true);
 });

 it('keeps the primary formula height in differently sized capture and restored preview outputs',async()=>{
  const f=await live(),pending=f.generator.captureFractalPaused(f.output,{width:3,height:5}),request=f.worker.latest(),result=capture(f);
  expect(result.capture).toMatchObject({width:4,height:6,fractalRender:{logicalSize:[2,3]}});
  expect(centered(result.capture)).toEqual(centered(f.output));expect(centered(result.preview)).toEqual(centered(f.output));
  expect(centered(result.capture).primaryLogicalHeight).toBe(8);
  f.worker.emit({operation:'fractal-paused-capture',id:request.id,sessionId:request.sessionId,result});
  expect(await pending).toBe(result);expect(f.worker.terminated).toBe(false);
  const pause=f.generator.setFractalPaused(result.preview,false),control=f.worker.latest();
  f.worker.emit({operation:'fractal-playback',id:control.id,sessionId:control.sessionId,sourceId:request.id,paused:false});
  await pause;
 });

 it.each(['capture','preview'] as const)('rejects a changed formula anchor in the %s capture result',async target=>{
  const f=await live(),pending=f.generator.captureFractalPaused(f.output,{width:3,height:5}),rejected=expect(pending).rejects.toMatchObject({previewRetained:false}),request=f.worker.latest(),result=capture(f);
  centered(result[target]).primaryLogicalHeight=result[target].height;
  f.worker.emit({operation:'fractal-paused-capture',id:request.id,sessionId:request.sessionId,result});
  await rejected;expect(f.worker.terminated).toBe(true);
 });

 it.each(['valid','wrong-source-viewport','missing-fractal-viewport'] as const)('validates cold generation against its Fractal viewport: %s',async mode=>{
  const s=scene(),c:GenerationInput={time:0,quality:'export',width:3,height:5,fractalViewport:{logicalWidth:3,logicalHeight:5,referenceLogicalHeight:8,target:'offscreen'},sourceViewport:{logicalWidth:11,logicalHeight:13,referenceLogicalHeight:41,target:'offscreen',projectionPass:'perspective'}};
  const producer=prepareGenerationPresentation(s,c),output=producer.complete(render(s,c));
  expect(centered(output).primaryLogicalHeight).toBe(8);
  if(mode==='wrong-source-viewport')centered(output).primaryLogicalHeight=c.sourceViewport!.referenceLogicalHeight;
  if(mode==='missing-fractal-viewport'){
   delete c.fractalViewport;
   expect(()=>prepareGenerationPresentation(s,c)).toThrow('主画布');
  }
  const generator=client(),pending=generator.generate(s,c),rejected=mode==='valid'?undefined:expect(pending).rejects.toThrow('公式标注无效'),worker=WorkerTransport.instances[0],request=worker.latest();
  worker.emit({operation:'generate',id:request.id,sessionId:request.sessionId,output});
  if(rejected){await rejected;expect(worker.terminated).toBe(true);}
  else{expect(await pending).toBe(output);expect(worker.terminated).toBe(false);}
 });

 it('preserves primary formula height through real recording warmup, fixed frames and primary handoff',async()=>{
  const f=await live(),options={width:3,height:3,simulationFps:10};
  const begin=f.generator.beginSourceRecording(f.output,options),request=f.worker.latest(),{handle:ownerHandle,...result}=f.owner.beginRecording(f.s,f.c,options);
  expect(result.warmup.fractalRender!.logicalSize[1]).not.toBe(f.c.fractalViewport!.logicalHeight);expect(centered(result.warmup)).toEqual(centered(f.output));
  f.worker.emit({operation:'source-recording-begin',id:request.id,sessionId:request.sessionId,recordingId:request.id,result});
  const start=await begin;expect(f.generator.hasSourceRecording(start.handle)).toBe(true);
  const frame=f.generator.nextSourceRecordingFrame(start.handle,1),frameRequest=f.worker.latest(),output=f.owner.nextRecordingFrame(ownerHandle,1);
  expect(centered(output)).toEqual(centered(f.output));
  f.worker.emit({operation:'source-recording-frame',id:frameRequest.id,sessionId:frameRequest.sessionId,recordingId:start.handle.recordingId,displayFrame:1,output});
  expect(await frame).toBe(output);
  const finish=f.generator.finishSourceRecording(start.handle),stopRequest=f.worker.latest(),stop=f.owner.finishRecording(ownerHandle,500);
  expect(centered(stop.preview)).toEqual(centered(f.output));
  f.worker.emit({operation:'source-recording-finish',id:stopRequest.id,sessionId:stopRequest.sessionId,recordingId:start.handle.recordingId,result:stop});
  expect(await finish).toBe(stop);expect(f.generator.hasSourceRecording(start.handle)).toBe(false);expect(f.worker.terminated).toBe(false);
 });

 it('rejects a recording warmup that binds formulas to the offscreen height',async()=>{
  const f=await live(),options={width:3,height:3,simulationFps:10},pending=f.generator.beginSourceRecording(f.output,options),rejected=expect(pending).rejects.toMatchObject({recordingRetained:false}),request=f.worker.latest();
  const {handle:ownerHandle,...result}=f.owner.beginRecording(f.s,f.c,options);
  centered(result.warmup).primaryLogicalHeight=result.warmup.fractalRender!.logicalSize[1];
  expect(centered(result.warmup).primaryLogicalHeight).not.toBe(centered(f.output).primaryLogicalHeight);
  f.worker.emit({operation:'source-recording-begin',id:request.id,sessionId:request.sessionId,recordingId:request.id,result});
  await rejected;expect(f.worker.terminated).toBe(true);f.owner.finishRecording(ownerHandle,500);
 });
});
