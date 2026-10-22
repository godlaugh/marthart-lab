import {describe,expect,it} from 'vitest';
import {SurfacePausedCaptureError} from '../src/engine/generationProtocol';
import {GenerationQueue} from '../src/engine/generationQueue';
import {SourceSurfaceLiveSession} from '../src/engine/sourceSurfaceLiveSession';
import {parseProjectFile} from '../src/engine/legacyImport';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import type {GenerationInput,SceneDocument,SceneOutput} from '../src/types';
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return{promise,resolve};}
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function fixture(){
 const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SURFACE',name:'queue',parameters:{a:.25,b:.5},equations:{x:'a+u',y:'b+v',z:'0'},settings:{surface_mode:'MESH',render_mode:'CPU',mesh_u_segments:2,mesh_v_segments:2,scale_x:1,scale_y:1,scale_z:1,speed_u:0,speed_v:0,mesh_wireframe:false},timeline:[{type:'wait',duration:2}]})).scene;
 const input=(revision=0):GenerationInput=>({time:999,quality:'preview',width:64,height:48,sourceViewport:ordinarySourceViewport(scene,64,48,'primary',48),surfaceLive:{sessionId:'s',revision,clock:{paused:true,timestampMs:1000},actualFrameRate:37}});
 const owner=new SourceSurfaceLiveSession();let completed:{output:SceneOutput;scene:SceneDocument;context:GenerationInput}|undefined;
 const calls:{scene:SceneDocument;context:GenerationInput}[]=[],writes:[string,number][]=[],outputs:{output:SceneOutput;time:number;scene:SceneDocument}[]=[],errors:Error[]=[],pauses:boolean[]=[];
 let gate:ReturnType<typeof deferred>|undefined,editGate:ReturnType<typeof deferred>|undefined,pauseGate:ReturnType<typeof deferred>|undefined,captureGate:ReturnType<typeof deferred>|undefined;
 const port={
  async generate(s:SceneDocument,c:GenerationInput){calls.push({scene:s,context:c});const wait=gate;gate=undefined;await wait?.promise;const output=owner.generate(s,c);completed={output,scene:s,context:c};return output;},
  async updateSurfaceParameter(output:SceneOutput,name:string,value:number){if(completed?.output!==output)throw Error('stale');writes.push([name,value]);owner.updateParameter(completed.scene,completed.context,name,value);const wait=editGate;editGate=undefined;await wait?.promise;},
  async setSurfacePaused(output:SceneOutput,paused:boolean){if(completed?.output!==output)throw Error('stale');const wait=pauseGate;pauseGate=undefined;await wait?.promise;owner.setPaused(paused,1000);completed.context={...completed.context,surfaceLive:{...completed.context.surfaceLive!,clock:{paused,timestampMs:1000}}};pauses.push(paused);},
  async captureSurfacePaused(output:SceneOutput,size:{width:number;height:number},scale:1|3|5=1){
   if(completed?.output!==output)throw Error('stale');const source=completed;
   let result;try{result=owner.capturePaused(source.scene,source.context,size,scale);}catch(error){throw new SurfacePausedCaptureError(String(error),owner.matchesCompletedPrimary(source.scene,source.context));}
   const wait=captureGate;captureGate=undefined;await wait?.promise;completed={...source,output:result.preview};
   // Queue ownership test: rasterization is covered by the real browser verifier.
   return{preview:result.preview,capture:{type:'raster' as const,width:1,height:1,pixels:new Uint8ClampedArray(4),stats:result.capture.stats}};
  },
  cancel(){owner.reset();completed=undefined;},dispose(){owner.reset();completed=undefined;},
 };
 const queue=new GenerationQueue(port,{output:(output,time,scene)=>outputs.push({output,time,scene}),error:e=>errors.push(e),busy:()=>{}});
 return{scene,input,owner,calls,writes,outputs,errors,pauses,queue,hold:()=>gate=deferred(),holdEdit:()=>editGate=deferred(),holdPause:()=>pauseGate=deferred(),holdCapture:()=>captureGate=deferred()};
}
function geometry(output:SceneOutput){if(output.type!=='geometry')throw Error('geometry');return output;}
describe('Surface editor requests use one live queue owner',()=>{
 it.each(['replace','cancel','dispose'] as const)('retires a pending Surface capture on %s without stale publication',async action=>{
  const f=fixture();f.queue.request(f.scene,f.input());await flush();const before=f.outputs[0].output,gate=f.holdCapture();
  const pending=f.queue.captureSurfacePaused(before,{width:16,height:12}),caught=pending.catch(e=>e);
  await expect(f.queue.setSurfacePaused(false)).rejects.toThrow();
  if(action==='replace')f.queue.request({...f.scene},f.input(1));else f.queue[action]();
  expect(f.outputs).toHaveLength(1);gate.resolve();expect((await caught).name).toBe('AbortError');await flush();
  expect(f.outputs).toHaveLength(action==='replace'?2:1);expect(f.errors).toEqual([]);
  if(action==='replace')expect(geometry(f.outputs[1].output).surfaceLive?.revision).toBe(1);f.queue.dispose();
 });
 it('retains the completed capability after capture preflight failure and republishes a successful preview',async()=>{
  const f=fixture();f.queue.request(f.scene,f.input());await flush();const before=f.outputs[0].output;
  await expect(f.queue.captureSurfacePaused(before,{width:30000,height:30000})).rejects.toMatchObject({previewRetained:true});
  expect(f.errors).toEqual([]);const renamed={...f.scene,name:'retained'};f.queue.request(renamed,f.input(),0,'metadata');await flush();expect(f.calls).toHaveLength(1);
  await expect(f.queue.captureSurfacePaused(before,{width:16,height:12})).resolves.toMatchObject({type:'raster'});
  const preview=geometry(f.outputs.at(-1)!.output);expect(preview.surfaceLive?.frame).toEqual(geometry(before).surfaceLive?.frame);
  await f.queue.setSurfacePaused(false);expect(f.pauses).toEqual([false]);f.queue.dispose();
 });
 it('edits a paused mesh, keeps its clock and acknowledges harmless metadata without another draw',async()=>{
  const f=fixture();f.queue.request(f.scene,f.input());await flush();const before=geometry(f.outputs.at(-1)!.output);
  const next={...f.scene,parameters:{a:.75,b:.5}};f.queue.request(next,f.input(),0,undefined,[['a',.75]]);await flush();
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([['a',.75]]);expect(f.owner.diagnostics().constructions).toBe(1);
  const changed=geometry(f.outputs.at(-1)!.output);expect(changed.positions[0]).toBe(.75);expect(changed.surfaceLive?.frame).toEqual(before.surfaceLive?.frame);expect(f.outputs.at(-1)!.time).toBe(0);
  const renamed={...next,name:'renamed'};f.queue.request(renamed,{...f.input(),time:72,surfaceLive:{...f.input().surfaceLive!,actualFrameRate:61}},0,'metadata');await flush();
  expect(f.calls).toHaveLength(2);expect(f.outputs.at(-1)).toMatchObject({output:changed,scene:renamed,time:0});f.queue.dispose();
 });
 it('carries a coalesced Apply configuration while later drafts stay unapplied',async()=>{
  const f=fixture(),gate=f.hold();f.queue.request(f.scene,f.input());
  const applied={...f.scene,parameters:{a:.75,b:.5}},first=f.input(1);first.surfaceLive!.configuration=applied;f.queue.request(applied,first);
  const draft={...applied,equations:{x:'(',y:'v',z:'0'}};f.queue.request(draft,f.input(1));applied.parameters.a=99;gate.resolve();await flush();
  expect(f.calls).toHaveLength(2);expect(f.errors).toEqual([]);expect(f.outputs).toHaveLength(1);expect(geometry(f.outputs[0].output).positions[0]).toBe(.75);expect(f.owner.diagnostics()).toMatchObject({constructions:2,revision:1});f.queue.dispose();
 });
 it('does not replay old parameter events into a full Apply revision',async()=>{
  const f=fixture();f.queue.request(f.scene,f.input());await flush();
  const applied={...f.scene,parameters:{a:.75,b:.5}},c=f.input(1);c.surfaceLive!.configuration=applied;f.queue.request(applied,c,0,undefined,[['a',.75]]);await flush();
  expect(f.writes).toEqual([]);expect(f.owner.diagnostics().constructions).toBe(2);expect(geometry(f.outputs.at(-1)!.output).surfaceLive?.frame.sceneTime).toBe(0);f.queue.dispose();
 });
 it('normalizes an edit queued during a pause acknowledgement to the acknowledged clock',async()=>{
  const f=fixture();f.queue.request(f.scene,f.input());await flush();const gate=f.holdPause(),resume=f.queue.setSurfacePaused(false);
  const next={...f.scene,parameters:{a:.75,b:.5}};f.queue.request(next,f.input(),0,undefined,[['a',.75]]);gate.resolve();await resume;await flush();
  expect(f.pauses).toEqual([false]);expect(f.errors).toEqual([]);expect(f.calls.at(-1)!.context.surfaceLive!.clock.paused).toBe(false);expect(f.writes).toEqual([['a',.75]]);expect(f.owner.diagnostics().constructions).toBe(1);f.queue.dispose();
 });
 it('validates a complete parameter batch before the first write',async()=>{
  const f=fixture();f.queue.request(f.scene,f.input());await flush();const next={...f.scene,parameters:{a:.75,b:NaN}};
  f.queue.request(next,f.input(),0,undefined,[['a',.75],['b',NaN]]);await flush();expect(f.writes).toEqual([]);expect(f.errors.at(-1)?.message).toContain('有限数值');f.queue.dispose();
 });
 it('cancellation during a batch prevents remaining edits and obsolete publication',async()=>{
  const f=fixture();f.queue.request(f.scene,f.input());await flush();const gate=f.holdEdit(),next={...f.scene,parameters:{a:.75,b:.9}};
  f.queue.request(next,f.input(),0,undefined,[['a',.75],['b',.9]]);await flush();expect(f.writes).toEqual([['a',.75]]);f.queue.cancel();gate.resolve();await flush();
  expect(f.writes).toHaveLength(1);expect(f.outputs).toHaveLength(1);expect(f.errors).toEqual([]);f.queue.dispose();
 });
});
