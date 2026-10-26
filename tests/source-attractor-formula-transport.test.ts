import {afterEach,describe,expect,it,vi} from 'vitest';
import {Generator} from '../src/engine/client';
import {generateScene} from '../src/engine/temporal';
import {parseProjectFile} from '../src/engine/legacyImport';
import type {GenerationRequest,GenerationResponse} from '../src/engine/generationProtocol';
import type {GenerationInput} from '../src/types';

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
afterEach(()=>vi.unstubAllGlobals());
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
