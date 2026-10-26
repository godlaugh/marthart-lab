import {afterEach,describe,expect,it,vi} from 'vitest';
import type {GenerationWorkerRequest,GenerationWorkerResponse} from '../src/engine/generationProtocol';
import type {SourceAttractorWarmupRequest} from '../src/engine/sourceAttractorWarmup';
import type {SourceAttractorWarmupWorkerPort} from '../src/engine/sourceAttractorWarmupPool';

afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
describe('source Attractor production Worker handoff',()=>{
 it('awaits nested warmup workers and transfers detached public geometry without leaking retained arrays or callbacks',async()=>{
  vi.resetModules();const {executeSourceAttractorWarmup}=await import('../src/engine/sourceAttractorWarmup');
  const {parseProjectFile}=await import('../src/engine/legacyImport');
  const source=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'ATTRACTOR',name:'Worker warmup',main_equation:{enabled:true,color:'#FFFFFF',scale:1,position:[10,20]},settings:{render_mode:'CPU',particle_count_cpu:8,time_step:.01,sub_steps:3},initialization:{warmup_steps:30,stagger_min:5,stagger_max:20},equations:{dx:'y-x',dy:'x-z',dz:'x*y-z'},parameters:{},timeline:[{type:'wait',duration:2}]})).scene;
  let workers=0,terminated=0;const responses:GenerationWorkerResponse[]=[],detach:number[][]=[];
  vi.stubGlobal('Worker',class implements SourceAttractorWarmupWorkerPort{
   onmessage:SourceAttractorWarmupWorkerPort['onmessage']=null;onerror:SourceAttractorWarmupWorkerPort['onerror']=null;onmessageerror:SourceAttractorWarmupWorkerPort['onmessageerror']=null;
   constructor(){workers++;}
   postMessage(data:SourceAttractorWarmupRequest,transfer:Transferable[]){const input=structuredClone(data,{transfer});queueMicrotask(()=>{const result=executeSourceAttractorWarmup(input);this.onmessage?.({data:structuredClone(result,{transfer:[result.raw.buffer,result.steps.buffer]})} as MessageEvent);});}
   terminate(){terminated++;}
  });
  const scope:{onmessage?:(event:MessageEvent<GenerationWorkerRequest>)=>Promise<void>;postMessage:(data:GenerationWorkerResponse,options?:{transfer:Transferable[]})=>void}={postMessage(data,options){const arrays=options?.transfer??[];responses.push(structuredClone(data,{transfer:arrays}));detach.push(arrays.map(buffer=>(buffer as ArrayBuffer).byteLength));}};
  vi.stubGlobal('self',scope);await import('../src/engine/generate.worker');
  const context={time:0,width:80,height:60,quality:'preview' as const,sourceViewport:{logicalWidth:80,logicalHeight:60,referenceLogicalHeight:60,target:'primary' as const,projectionPass:'perspective' as const}};
  const request=(id:number,time:number)=>({operation:'generate' as const,id,sessionId:1,scene:source,context:{...context,time}});
  await scope.onmessage!({data:request(1,0)} as MessageEvent<GenerationWorkerRequest>);
  const first=responses.find(x=>x.id===1&&x.operation==='generate');expect(first).toHaveProperty('output');if(!first||!('output'in first)||first.output.type!=='geometry')throw Error('geometry expected');
  const positions=first.output.positions.slice();expect(workers).toBeGreaterThan(1);expect(terminated).toBe(workers);
  expect(first.output.formulaPresentation).toMatchObject({layout:'source-surface-centered-v1',primaryLogicalHeight:60});
  expect(first.output.formulaPresentation?.labels).toHaveLength(1);expect(first.output.formulaPresentation?.labels[0].latex).toBe(String.raw`\text{Worker warmup}=\begin{cases} \dot{x} = y - x \\ \dot{y} = x - z \\ \dot{z} = x y - z \end{cases}`);
  await scope.onmessage!({data:request(2,.1)} as MessageEvent<GenerationWorkerRequest>);
  await scope.onmessage!({data:request(3,0)} as MessageEvent<GenerationWorkerRequest>);
  const third=responses.find(x=>x.id===3&&x.operation==='generate');if(!third||!('output'in third)||third.output.type!=='geometry')throw Error('geometry expected');
  expect(third.output.positions).toEqual(positions);expect(detach.flat().every(bytes=>bytes===0)).toBe(true);expect(terminated).toBe(workers);expect(responses.some(x=>'error'in x)).toBe(false);
  expect(third.output.formulaPresentation).toEqual(first.output.formulaPresentation);
  source.formulas!.main.visible=false;await scope.onmessage!({data:request(4,0)} as MessageEvent<GenerationWorkerRequest>);
  const fourth=responses.find(x=>x.id===4&&x.operation==='generate');if(!fourth||!('output'in fourth))throw Error('output expected');expect(fourth.output.formulaPresentation?.labels).toEqual([]);
 });
});
