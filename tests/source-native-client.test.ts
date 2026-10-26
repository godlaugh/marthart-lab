import {it,expect,vi,afterEach} from 'vitest';
import {renderSourceNativeFrame,controlSourceBouncingState} from '../src/engine/sourceNativeClient';
import type {SourceDrawingFrame} from '../src/engine/sourceDrawingFrame';
const frame=():SourceDrawingFrame=>({generation:2,sequence:4,width:1,height:2,samples:0,clear:[0,0,0,1],drawing:{model:'source-drawing-v1',commands:[],textures:[],admittedBytes:0,copiedBufferBytes:0,retainedBufferBytes:0}});
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

const control=():SourceDrawingFrame=>({...frame(),height:1,clear:[0,0,0,0],bouncing:{kind:'upload',resource:'11'.repeat(16),particleCount:2,programBytes:0,offset:0,particles:new Float32Array(8)}});
const acknowledgement=(uploaded=2,overrides:Record<string,string>={})=>{const body=new Uint8Array(4);new DataView(body.buffer).setUint32(0,uploaded,true);return new Response(body,{headers:{...headers(),'content-length':'4','x-source-height':'1','x-source-format':'u32le','x-source-row-order':'none',...overrides}});};
it('reads explicit upload progress without treating acknowledgements as pixels',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>acknowledgement()));
 const result=await controlSourceBouncingState(control());expect(result).toMatchObject({uploadedParticles:2,generation:2,sequence:4,rendererIdentity:'a'.repeat(64)});expect(result.requestBytes).toBeGreaterThan(32);expect(result).not.toHaveProperty('pixels');
});
it.each(['progress','image-format','row-order'] as const)('rejects inconsistent native acknowledgement %s',async kind=>{
 vi.stubGlobal('fetch',vi.fn(async()=>acknowledgement(kind==='progress'?1:2,kind==='image-format'?{'x-source-format':'rgba8'}:kind==='row-order'?{'x-source-row-order':'bottom-up'}:{})));
 await expect(controlSourceBouncingState(control())).rejects.toMatchObject({kind:'protocol'});
});
it.each(['state-lost','ownership'])('preserves native resource failure %s',async kind=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({kind,error:'resource failure'}),{status:409})));
 await expect(controlSourceBouncingState(control())).rejects.toMatchObject({kind});
});
it('rejects control/image API mismatches before sending a request',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 await expect(renderSourceNativeFrame(control())).rejects.toMatchObject({kind:'input'});
 await expect(controlSourceBouncingState(frame())).rejects.toMatchObject({kind:'input'});expect(fetch).not.toHaveBeenCalled();
});
it.each(['context','compile','link','allocation','render','readback'])('preserves explicit native GPU stage %s',async gpuStage=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({kind:'runtime',gpuStage,error:'observed GL failure'}),{status:502})));
 await expect(renderSourceNativeFrame(frame())).rejects.toMatchObject({kind:'runtime',gpuStage});
});
it.each([{kind:'unknown',gpuStage:'compile'},{kind:'runtime',gpuStage:['compile']},{kind:'runtime',gpuStage:'cleanup'},{kind:'capacity',gpuStage:'compile'},{kind:'runtime',gpuStage:7}])('rejects malformed GPU attribution %j',async error=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({...error,error:'invalid attribution'}),{status:502})));
 await expect(renderSourceNativeFrame(frame())).rejects.toMatchObject({kind:'protocol'});
});
