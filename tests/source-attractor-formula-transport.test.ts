import {afterEach,describe,expect,it,vi} from 'vitest';
import {Generator} from '../src/engine/client';
import {generateScene} from '../src/engine/temporal';
import {parseProjectFile} from '../src/engine/legacyImport';
import type {GenerationRequest,GenerationResponse} from '../src/engine/generationProtocol';
import type {GenerationInput} from '../src/types';
import {SourceAttractorGpuReplaySession} from '../src/engine/sourceAttractorGpuReplay';

class WorkerPort {
 static instances:WorkerPort[]=[];messages:GenerationRequest[]=[];terminated=false;
 onmessage:((event:{data:GenerationResponse})=>void)|null=null;onerror:((event:{message:string})=>void)|null=null;
 constructor(){WorkerPort.instances.push(this);}
 postMessage(message:GenerationRequest){this.messages.push(structuredClone(message));}
 terminate(){this.terminated=true;}
 emit(data:GenerationResponse){this.onmessage?.({data});}
}
const scene=()=>parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'ATTRACTOR',name:'Formula handoff',main_equation:{enabled:true,scale:1,color:'#FFFFFF',position:[10,20]},settings:{render_mode:'CPU',particle_count_cpu:2,sub_steps:1},initialization:{warmup_steps:0,warmup_stagger_min:0,warmup_stagger_max:0},equations:{dx:'1',dy:'0',dz:'0'},timeline:[{type:'wait',duration:1}]})).scene;
const context:GenerationInput={time:0,width:80,height:60,quality:'preview',sourceViewport:{logicalWidth:80,logicalHeight:60,referenceLogicalHeight:60,target:'primary',projectionPass:'perspective'}};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('CPU Attractor formula Worker response contract',()=>{
 for(const progress of [false,true])for(const missing of [false,true])it(`rejects ${missing?'missing':'malformed'} ${progress?'progress':'completed'} presentation before publishing geometry`,async()=>{
  WorkerPort.instances=[];vi.stubGlobal('Worker',WorkerPort);const s=scene(),generator=new Generator(),delivered=vi.fn();
  try{
   const output=generateScene(s,context);if(missing)delete output.formulaPresentation;else output.formulaPresentation={referenceWidth:NaN,referenceHeight:720,labels:[]};
   const pending=generator.generate(s,context,delivered),failure=pending.catch(e=>e),w=WorkerPort.instances[0],request=w.messages[0];
   if(progress)w.emit({operation:'generate-progress',id:request.id,sessionId:request.sessionId,output});
   else w.emit({operation:'generate',id:request.id,sessionId:request.sessionId,output});
   expect((await failure).message).toContain('公式标注');expect(delivered).not.toHaveBeenCalled();expect(w.terminated).toBe(true);
  }finally{generator.dispose();}
 });
 it.each([false,true])('accepts the actual completed producer presentation with visible=%s',async visible=>{
  WorkerPort.instances=[];vi.stubGlobal('Worker',WorkerPort);const s=scene(),generator=new Generator();s.formulas!.main.visible=visible;
  try{const output=generateScene(s,context),pending=generator.generate(s,context),w=WorkerPort.instances[0],request=w.messages[0];w.emit({operation:'generate',id:request.id,sessionId:request.sessionId,output});expect((await pending).formulaPresentation!.labels).toHaveLength(visible?1:0);expect(w.terminated).toBe(false);}finally{generator.dispose();}
 });
});
describe('GPU Attractor source-camera raster formula ownership (simulated device)',()=>{
 function fixture(){
  const s=scene(),base=structuredClone(generateScene(s,context).sourceCameraFrame!),frame={...base,camera:{...base.camera,center:[12,34,56] as [number,number,number]}};s.attractorSource!.configuration.nativeBackend='gpu';s.attractorSource!.configuration.particleCountGPU=2;
  const draw=vi.spyOn(SourceAttractorGpuReplaySession.prototype,'generate').mockImplementation(request=>({type:'raster',backend:'webgl2',width:request.width,height:request.height,pixels:new Uint8ClampedArray(request.width*request.height*4),sourceCameraFrame:structuredClone(frame),stats:{samples:2,generated:2,invalid:0,elapsedMs:0}}));
  return{s,frame,draw};
 }
 it('attaches source labels without overwriting the actual GPU replay camera and validates before drawing',()=>{
  const {s,frame,draw}=fixture(),output=generateScene(s,context);expect(output.type).toBe('raster');expect(output.sourceCameraFrame).toEqual(frame);expect(output.formulaPresentation).toMatchObject({layout:'source-surface-centered-v1',primaryLogicalHeight:60});
  s.formulas!.main.scale=NaN;expect(()=>generateScene(s,context)).toThrow('公式');expect(draw).toHaveBeenCalledTimes(1);
 });
 it.each(['valid','missing','height','layout'] as const)('checks required GPU presentation at the actual Worker boundary: %s',async variant=>{
  WorkerPort.instances=[];vi.stubGlobal('Worker',WorkerPort);const {s}=fixture(),output=generateScene(s,context),generator=new Generator();
  if(variant==='missing')delete output.formulaPresentation;
  if(variant==='height'&&output.formulaPresentation?.layout==='source-surface-centered-v1')output.formulaPresentation.primaryLogicalHeight=61;
  if(variant==='layout')output.formulaPresentation={referenceWidth:1280,referenceHeight:720,labels:[]};
  try{
   const pending=generator.generate(s,context),caught=pending.catch(error=>error),worker=WorkerPort.instances[0],request=worker.messages[0];worker.emit({operation:'generate',id:request.id,sessionId:request.sessionId,output});
   if(variant==='valid'){expect((await pending).formulaPresentation).toEqual(output.formulaPresentation);expect(worker.terminated).toBe(false);}
   else{expect((await caught).message).toContain('公式标注');expect(worker.terminated).toBe(true);}
  }finally{generator.dispose();}
 });
 it.each(['valid','missing','wrong','unexpected'] as const)('binds completed display density to the issued Worker request: %s',async variant=>{
  WorkerPort.instances=[];vi.stubGlobal('Worker',WorkerPort);const {s}=fixture(),input={...context,sourcePointPixelDensity:variant==='unexpected'?undefined:2},output=generateScene(s,input),generator=new Generator();
  if(output.type!=='raster')throw Error('raster expected');
  if(variant==='missing')delete output.sourceAttractorPixelDensity;
  if(variant==='wrong')output.sourceAttractorPixelDensity=1;
  if(variant==='unexpected')output.sourceAttractorPixelDensity=2;
  try{
   const pending=generator.generate(s,input),caught=pending.catch(error=>error),worker=WorkerPort.instances[0],request=worker.messages[0];worker.emit({operation:'generate',id:request.id,sessionId:request.sessionId,output});
   if(variant==='valid'){expect(await pending).toHaveProperty('sourceAttractorPixelDensity',2);expect(worker.terminated).toBe(false);}
   else{expect(await caught).toBeInstanceOf(Error);expect(worker.terminated).toBe(true);}
  }finally{generator.dispose();}
 });
});
