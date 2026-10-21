import {describe,it,expect,vi} from 'vitest';
import {GenerationQueue,MAX_PENDING_ITERATED_NAVIGATION} from '../src/engine/generationQueue';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import type {SceneOutput,GenerationInput} from '../src/types';
const output:SceneOutput={type:'raster',width:1,height:1,pixels:new Uint8ClampedArray(4),stats:{samples:1,generated:1,invalid:0}};
const context:GenerationInput={time:0,width:1,height:1,quality:'preview',mapLive:{sessionId:'owned',renderFps:60,replayRevision:0,clock:{paused:true}}};
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
async function setup(){
 const scene=createScene(definition('map')),pending:{resolve:(o:SceneOutput)=>void;reject:(e:Error)=>void}[]=[];
 const port={generate:vi.fn(async()=>output),navigateIteratedPaused:vi.fn((_o:SceneOutput,_e:unknown)=>new Promise<SceneOutput>((resolve,reject)=>pending.push({resolve,reject}))),setMapPaused:vi.fn(async()=>{}),cancel:vi.fn(),dispose:vi.fn()};
 const callbacks={output:vi.fn(),error:vi.fn(),busy:vi.fn()},queue=new GenerationQueue(port,callbacks);queue.request(scene,context);await flush();
 return{scene,pending,port,callbacks,queue,nav:(count:number)=>queue.navigateIteratedPaused(scene,'owned',{kind:'wheel',count})};
}
describe('iterated navigation scheduling races',()=>{
 it('bounds pending redraw work and preserves all accepted event order',async()=>{
  const f=await setup();expect(f.nav(0)).toBe(true);for(let i=1;i<=MAX_PENDING_ITERATED_NAVIGATION;i++)expect(f.nav(i)).toBe(true);
  for(let i=0;i<10000;i++)expect(f.nav(999)).toBe(false);
  expect(f.port.navigateIteratedPaused).toHaveBeenCalledTimes(1);
  for(let i=0;i<=MAX_PENDING_ITERATED_NAVIGATION;i++){f.pending[i].resolve({...output});await flush();}
  expect(f.port.navigateIteratedPaused.mock.calls.map(c=>(c[1] as {count:number}).count)).toEqual(Array.from({length:MAX_PENDING_ITERATED_NAVIGATION+1},(_,i)=>i));
  expect(f.callbacks.busy).toHaveBeenLastCalledWith(false);f.queue.dispose();
 });
 it('finishes an in-flight redraw before a queued resume and retires remaining input',async()=>{
  const f=await setup();f.nav(1);f.nav(2);const paused=f.queue.setMapPaused(false);expect(f.nav(3)).toBe(false);expect(f.port.setMapPaused).not.toHaveBeenCalled();
  const last={...output};f.pending[0].resolve(last);await paused;await flush();expect(f.port.navigateIteratedPaused).toHaveBeenCalledTimes(1);expect(f.port.setMapPaused).toHaveBeenCalledWith(last,false);expect(f.nav(4)).toBe(false);f.queue.dispose();
 });
 it('defers resize, drops old pending gestures and never publishes an outdated size',async()=>{
  const f=await setup();f.nav(1);f.nav(2);f.queue.request(f.scene,{...context,width:2});f.pending[0].resolve({...output});await flush();
  expect(f.port.generate).toHaveBeenCalledTimes(2);expect(f.port.navigateIteratedPaused).toHaveBeenCalledTimes(1);expect(f.callbacks.output).toHaveBeenCalledTimes(2);f.queue.dispose();
 });
 it.each(['cancel','dispose'] as const)('ignores late delivery after %s',async operation=>{
  const f=await setup();f.nav(1);f.nav(2);f.queue[operation]();f.pending[0].resolve({...output});await flush();expect(f.port.navigateIteratedPaused).toHaveBeenCalledTimes(1);expect(f.callbacks.output).toHaveBeenCalledTimes(1);expect(f.callbacks.error).not.toHaveBeenCalled();f.queue.dispose();
 });
 it('retires a failed worker, rejects queued resume, and admits a fresh request',async()=>{
  const f=await setup();f.nav(1);const resume=f.queue.setMapPaused(false).catch(e=>e);f.pending[0].reject(Error('GPU lost'));expect(await resume).toBeInstanceOf(Error);await flush();expect(f.callbacks.error).toHaveBeenCalledTimes(1);expect(f.nav(2)).toBe(false);
  f.queue.request(f.scene,context);await flush();expect(f.nav(3)).toBe(true);f.pending[1].resolve(output);await flush();f.queue.dispose();
 });
});
