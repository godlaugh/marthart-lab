import {it,expect,vi,afterEach} from 'vitest';
import {renderSourceNativeFrame} from '../src/engine/sourceNativeClient';
import type {SourceDrawingFrame} from '../src/engine/sourceDrawingFrame';
const frame=():SourceDrawingFrame=>({generation:2,sequence:4,width:1,height:2,clear:[0,0,0,1],drawing:{model:'source-drawing-v1',commands:[],textures:[],admittedBytes:0,copiedBufferBytes:0,retainedBufferBytes:0}});
const headers=()=>({'content-type':'application/octet-stream','content-length':'8','x-source-generation':'2','x-source-sequence':'4','x-source-width':'1','x-source-height':'2','x-source-renderer':'a'.repeat(64),'x-source-format':'rgba8','x-source-row-order':'bottom-up'});
afterEach(()=>vi.unstubAllGlobals());
it('preserves byte channels and converts native row order once',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([1,2,3,0,5,6,7,255]),{headers:headers()})));const r=await renderSourceNativeFrame(frame());expect([...r.pixels]).toEqual([5,6,7,255,1,2,3,0]);});
it.each(['identity','width','length','format','truncated','extra'] as const)('rejects invalid response %s',async kind=>{
 const h=headers();if(kind==='identity')h['x-source-sequence']='5';if(kind==='width')h['x-source-width']='2';if(kind==='length')h['content-length']='9';if(kind==='format')h['x-source-row-order']='top-down';
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array(kind==='truncated'?7:kind==='extra'?9:8),{headers:h})));
 await expect(renderSourceNativeFrame(frame())).rejects.toMatchObject({kind:kind==='extra'?'capacity':'protocol'});
});
it('surfaces native failure without accepting fallback pixels',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:'Unavailable',kind:'unavailable'}),{status:503})));await expect(renderSourceNativeFrame(frame())).rejects.toMatchObject({kind:'unavailable'});});
it('bounds local concurrency and aborts an in-flight transport',async()=>{
 vi.stubGlobal('fetch',vi.fn((_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('cancel','AbortError'))))));
 const controller=new AbortController(),p=renderSourceNativeFrame(frame(),{signal:controller.signal});await expect(renderSourceNativeFrame(frame())).rejects.toMatchObject({kind:'capacity'});controller.abort();await expect(p).rejects.toMatchObject({name:'AbortError'});
});
