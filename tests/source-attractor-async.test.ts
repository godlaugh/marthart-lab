import {afterEach,describe,expect,it,vi} from 'vitest';
import {SourceAttractorSession} from '../src/scenes/sourceAttractor';
import {OrdinarySourceCameraTimelineSession} from '../src/engine/ordinarySourceCameraTimeline';
import {executeSourceAttractorWarmup,type SourceAttractorWarmupRequest} from '../src/engine/sourceAttractorWarmup';
import type {SourceAttractorWarmupWorkerPort} from '../src/engine/sourceAttractorWarmupPool';
import {parseProjectFile} from '../src/engine/legacyImport';
import {generateScene,generateSceneAsync,TemporalGenerationSession} from '../src/engine/temporal';
import type {GenerateContext,SceneOutput} from '../src/types';
import {outputBuffers} from '../src/engine/outputBuffers';

function scene(){return parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'ATTRACTOR',name:'Async CPU',settings:{render_mode:'CPU',particle_count_cpu:8,time_step:.01,sub_steps:3},initialization:{warmup_steps:30,stagger_min:5,stagger_max:20},equations:{dx:'y-x',dy:'x-z',dz:'x*y-z'},parameters:{},timeline:[{type:'wait',duration:2}]})).scene;}
const context:GenerateContext={time:0,width:80,height:60,quality:'preview',sourceViewport:{logicalWidth:80,logicalHeight:60,referenceLogicalHeight:60,target:'primary',projectionPass:'perspective'}};
function comparable(output:SceneOutput){const copy=structuredClone(output);copy.stats.elapsedMs=0;return copy;}
class Port implements SourceAttractorWarmupWorkerPort {
 onmessage:SourceAttractorWarmupWorkerPort['onmessage']=null;onerror:SourceAttractorWarmupWorkerPort['onerror']=null;onmessageerror:SourceAttractorWarmupWorkerPort['onmessageerror']=null;
 pending:SourceAttractorWarmupRequest[]=[];terminated=false;failTerminate=false;
 constructor(private automatic=true){}
 postMessage(data:SourceAttractorWarmupRequest,transfer:Transferable[]){this.pending.push(structuredClone(data,{transfer}));if(this.automatic)queueMicrotask(()=>{if(!this.terminated)this.complete();});}
 complete(){const result=executeSourceAttractorWarmup(this.pending.shift()!);this.onmessage?.({data:structuredClone(result,{transfer:[result.raw.buffer,result.steps.buffer]})} as MessageEvent);}
 terminate(){if(this.failTerminate)throw Error('cleanup refused');this.terminated=true;}
}
afterEach(()=>vi.unstubAllGlobals());
describe('source Attractor async initialization with unchanged timeline owner',()=>{
 it('matches serial colors, trails, camera and geometry through forward/reverse, input edit, resize and transfer',async()=>{
  const ports:Port[]=[],owner=new SourceAttractorSession({warmupWorkerFactory:()=>{const p=new Port();ports.push(p);return p;}}),s=scene();
  try{
   for(const time of [0,.1,.5,.1]){
    const input={...context,time},output=await owner.generateAsync(s,input);expect(comparable(output)).toEqual(comparable(new SourceAttractorSession().generate(s,input)));
    structuredClone(output,{transfer:outputBuffers(output)});
   }
   expect(owner.diagnostics().constructions).toBe(2);const previous=ports.length;
   await owner.generateAsync(s,{...context,time:.1,width:160,height:120});expect(ports.length).toBe(previous);
   s.parameters.extra=3;await owner.generateAsync(s,context);expect(ports.length).toBeGreaterThan(previous);expect(owner.diagnostics().constructions).toBe(1);
   expect(ports.every(p=>p.terminated)).toBe(true);
  }finally{await owner.resetAsync();}
 });
 it('blocks reentry until all ACKs, revokes pending initialization and retains failed cleanup for explicit retry',async()=>{
  const ports:Port[]=[],owner=new SourceAttractorSession({warmupWorkerFactory:()=>{const p=new Port(false);ports.push(p);return p;}});
  const pending=owner.generateAsync(scene(),context),rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});
  expect(()=>owner.generate(scene(),context)).toThrow('正在进行');expect(()=>owner.reset()).toThrow('resetAsync');
  await owner.resetAsync();await rejected;expect(ports.every(p=>p.terminated)).toBe(true);expect(owner.diagnostics().retainedBytes).toBe(0);
  const second=owner.generateAsync(scene(),context),failed=expect(second).rejects.toThrow('cleanup');
  const fresh=ports.filter(p=>!p.terminated);fresh[0].failTerminate=true;for(const p of fresh)while(p.pending.length)p.complete();await failed;
  expect(owner.diagnostics().warmup.ownedWorkers).toBe(1);expect(()=>owner.generateAsync(scene(),context)).toThrow('清理未完成');
  fresh[0].failTerminate=false;await owner.resetAsync();expect(owner.diagnostics().warmup.ownedWorkers).toBe(0);
 });
 it('binds async creation inside the same timeline rebuild decision and never advances before ACK',async()=>{
  const initial={phi:0,theta:0,gamma:0,center:[0,0,0] as [number,number,number],zoom:1,focalDistance:250};
  const updates:number[]=[],created:{resolve:(p:{bind:()=>{kind:'ignored';reason:string};update:(f:{frameIndex:number})=>void})=>void}[]=[];
  const owner=new OrdinarySourceCameraTimelineSession(initial,[{id:'w',type:'wait',target:'timeline.wait',from:0,to:0,start:0,duration:1,easing:'linear',enabled:true,pingPong:false}],4,{createParticlesAsync:()=>new Promise(resolve=>created.push({resolve}))});
  const first=owner.evaluateAsync(.5);expect(updates).toEqual([]);expect(created).toHaveLength(1);
  expect(()=>owner.evaluate(0)).toThrow('正在进行');expect(()=>owner.step(.25)).toThrow('正在进行');expect(()=>owner.display()).toThrow('正在进行');
  created[0].resolve({bind:()=>({kind:'ignored',reason:'unused'}),update:f=>updates.push(f.frameIndex)});expect((await first).frameIndex).toBe(2);expect(updates).toEqual([0,1,2]);
  await owner.evaluateAsync(.75);expect(created).toHaveLength(1);expect(updates).toEqual([0,1,2,3]);
  const reverse=owner.evaluateAsync(0);expect(created).toHaveLength(2);created[1].resolve({bind:()=>({kind:'ignored',reason:'unused'}),update:f=>updates.push(f.frameIndex)});await reverse;expect(updates).toEqual([0,1,2,3,0]);
 });
 it('suppresses a delayed initialization after timeline reset and keeps failure available for new explicit replay',async()=>{
  const s=scene();let release!:(value:{bind:()=>{kind:'ignored';reason:string};update:()=>void})=>void,updates=0;
  const owner=new OrdinarySourceCameraTimelineSession({phi:0,theta:0,gamma:0,center:[0,0,0],zoom:1,focalDistance:250},s.timeline.tracks,30,{createParticlesAsync:()=>new Promise(resolve=>release=resolve)});
  const pending=owner.evaluateAsync(0),rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});owner.reset();release({bind:()=>({kind:'ignored',reason:'unused'}),update:()=>{updates++;}});await rejected;await owner.settle();expect(updates).toBe(0);
 });
 it('routes the production asynchronous generation entry to bounded workers while synchronous API remains available',async()=>{
  let workers=0;vi.stubGlobal('Worker',class extends Port{constructor(){super();workers++;}});
  const s=scene(),owner=new TemporalGenerationSession();try{
   expect(comparable(await generateSceneAsync(s,context,owner))).toEqual(comparable(generateScene(s,context)));expect(workers).toBeGreaterThan(1);
   const count=workers;await generateSceneAsync(s,{...context,time:.1},owner);expect(workers).toBe(count);
  }finally{owner.reset();}
 });
});
