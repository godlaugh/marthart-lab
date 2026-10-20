import {describe,it,expect,vi} from 'vitest';
import {GenerationQueue} from '../src/engine/generationQueue';
import {parseLegacyScene} from '../src/engine/legacyImport';
import type {SceneDocument,SceneOutput} from '../src/types';
const context={time:.5,width:64,height:48,quality:'preview' as const};
const output:SceneOutput={type:'raster',width:1,height:1,pixels:new Uint8ClampedArray(4),stats:{samples:1,generated:1,invalid:0}};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const scene=()=>parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'PERLIN',name:'Retained Perlin queue',settings:{seed:1,particle_count:2},timeline:[{type:'wait',duration:2}]})).scene;
function fixture(){
 const calls:{scene:SceneDocument;resolve:(o:SceneOutput)=>void;reject:(e:Error)=>void}[]=[];
 const port={generate:vi.fn((scene:SceneDocument)=>new Promise<SceneOutput>((resolve,reject)=>calls.push({scene,resolve,reject}))),cancel:vi.fn(),dispose:vi.fn()};
 const callbacks={output:vi.fn(),error:vi.fn(),busy:vi.fn()};
 return{queue:new GenerationQueue(port,callbacks),port,callbacks,calls};
}
describe('Perlin runtime lifetime through backend authoring',()=>{
 it.each(['success','failure'] as const)('retains Worker and suppresses obsolete %s during rapid backend changes',async terminal=>{
  const f=fixture(),cpu=scene(),gpu={...cpu,perlinSource:{...cpu.perlinSource!,backend:'gpu' as const}},latest={...gpu,perlinSource:{...gpu.perlinSource,backend:'cpu' as const}};
  f.queue.request(cpu,context);f.queue.request(gpu,context);f.queue.request(latest,context);
  expect(f.port.cancel).toHaveBeenCalledTimes(1);expect(f.calls).toHaveLength(1);
  if(terminal==='success')f.calls[0].resolve(output);else f.calls[0].reject(Error('superseded'));
  await flush();expect(f.callbacks.output).not.toHaveBeenCalled();expect(f.callbacks.error).not.toHaveBeenCalled();expect(f.calls).toHaveLength(2);expect(f.calls[1].scene).toBe(latest);
  f.calls[1].resolve(output);await flush();expect(f.callbacks.output).toHaveBeenLastCalledWith(output,.5,latest);
  f.queue.request(gpu,context);expect(f.port.cancel).toHaveBeenCalledTimes(1);f.calls[2].resolve(output);await flush();f.queue.dispose();
 });
 it('retires the Worker for a different document, local model or explicit cancellation',async()=>{
  const f=fixture(),cpu=scene();f.queue.request(cpu,context);f.calls[0].resolve(output);await flush();
  const other={...cpu,id:cpu.id+'other'};f.queue.request(other,context);expect(f.port.cancel).toHaveBeenCalledTimes(2);f.calls[1].resolve(output);await flush();
  const local={...other};delete local.perlinSource;f.queue.request(local,context);expect(f.port.cancel).toHaveBeenCalledTimes(3);f.calls[2].resolve(output);await flush();
  f.queue.cancel();expect(f.port.cancel).toHaveBeenCalledTimes(4);f.queue.dispose();
 });
});
