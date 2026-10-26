import {afterEach,describe,expect,it,vi} from 'vitest';
import {SourcePerlinCpuTarget} from '../src/engine/sourcePerlinCpuTarget';
import type {SourceNativePixels} from '../src/engine/sourceNativeClient';
import type {SourcePerlinGpuFrame} from '../src/engine/sourcePerlinGpu';
const opts={width:2,height:2,density:1,samples:0 as const,initialColor:[0,0,0,0] as const};
const f=():SourcePerlinGpuFrame=>({width:2,height:2,palette:new Uint32Array(256).fill(0xff123456),time:.5,noiseFrequency:1.5,warpAmplitude:.1,warpFrequency:2,directionOffset:0,timeSpeed:1,marchSteps:1,stepSize:.008,brightness:1.7,vignettePower:.1,fiberStrength:.7,renderStyle:0});
const channel=()=>({size:512 as const,pixels:new Uint32Array(512*512)});
const image=()=>new Uint8ClampedArray([1,2,3,255,4,5,6,255,7,8,9,255,10,11,12,255]);
const ack=():SourceNativePixels=>({width:2,height:2,pixels:image(),rendererIdentity:'a'.repeat(64),generation:3,sequence:7,requestBytes:123});
const cpuFrame={projection:new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),background:[0,0,0,.2] as const,accumulation:true,primitives:[]};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}

/** CPU-only GL call recorder. It copies attachment bytes so ownership/row order
 * can be checked; it does not compile GLSL, rasterize, or establish driver pixel
 * parity. The real native/MSAA verifier is a separate browser integration run. */
function graphics(){
 type ObjectRecord={pixels?:Uint8Array;attachment?:ObjectRecord;source?:string;shaders?:ObjectRecord[]};
 const events:{name:string;blend?:boolean;dither?:boolean;pixels?:number[]}[]=[],enabled=new Set<number>();
 let id=100,texture:ObjectRecord|undefined,renderbuffer:ObjectRecord|undefined,draw:ObjectRecord|undefined,read:ObjectRecord|undefined,program:ObjectRecord|undefined;
 let clear=[0,0,0,0],deleteFailure=false;
 const constants:Record<string,number>={},object=():ObjectRecord=>({});
 const g=new Proxy<Record<string,unknown>>({}, {get(_target,name:string){
  if(/^[A-Z][A-Z0-9_]*$/.test(name))return constants[name]??(constants[name]=++id);
  return methods[name]??(()=>{});
 }});
 const methods:Record<string,(...args:any[])=>any>={
  isContextLost:()=>false,getError:()=>g.NO_ERROR,getShaderParameter:()=>true,getProgramParameter:()=>true,
  getParameter:(name:number)=>name===g.MAX_VIEWPORT_DIMS?new Int32Array([16384,16384]):name===g.MAX_SAMPLES?4:16384,
  getInternalformatParameter:()=>new Int32Array([4]),checkFramebufferStatus:()=>g.FRAMEBUFFER_COMPLETE,
  createProgram:()=>({...object(),shaders:[]}),createShader:object,createTexture:object,createFramebuffer:object,createRenderbuffer:object,createVertexArray:object,createBuffer:object,
  shaderSource:(s:ObjectRecord,text:string)=>{s.source=text;},attachShader:(p:ObjectRecord,s:ObjectRecord)=>p.shaders!.push(s),useProgram:(p:ObjectRecord)=>{program=p;},getUniformLocation:(_p:ObjectRecord,name:string)=>({name}),
  bindTexture:(_target:number,t:ObjectRecord)=>{texture=t;},texImage2D:(_t:number,_l:number,_i:number,w:number,h:number)=>{texture!.pixels=new Uint8Array(w*h*4);},
  texSubImage2D:(_t:number,_l:number,_x:number,_y:number,_w:number,_h:number,_f:number,_type:number,p:Uint8Array)=>{texture!.pixels=new Uint8Array(p);events.push({name:'upload',pixels:[...p]});},
  bindFramebuffer:(target:number,f:ObjectRecord)=>{if(target===g.FRAMEBUFFER||target===g.DRAW_FRAMEBUFFER)draw=f;if(target===g.FRAMEBUFFER||target===g.READ_FRAMEBUFFER)read=f;},
  framebufferTexture2D:(_t:number,_a:number,_tt:number,t:ObjectRecord)=>{draw!.attachment=t;},bindRenderbuffer:(_t:number,r:ObjectRecord)=>{renderbuffer=r;},
  renderbufferStorageMultisample:(_t:number,_s:number,_f:number,w:number,h:number)=>{renderbuffer!.pixels=new Uint8Array(w*h*4);},framebufferRenderbuffer:(_t:number,_a:number,_tt:number,r:ObjectRecord)=>{draw!.attachment=r;},
  clearColor:(...rgba:number[])=>{clear=rgba;},clear:()=>{const p=draw!.attachment!.pixels!;for(let i=0;i<p.length;i++)p[i]=Math.round(clear[i%4]*255);events.push({name:'clear'});},
  enable:(state:number)=>enabled.add(state),disable:(state:number)=>enabled.delete(state),
  drawArrays:()=>{const copy=program!.shaders!.some(s=>s.source?.includes('texelFetch(nativePixels'));
   if(copy)draw!.attachment!.pixels=new Uint8Array(texture!.pixels!);
   events.push({name:copy?'native-copy':'other-draw',blend:enabled.has(g.BLEND as number),dither:enabled.has(g.DITHER as number)});},
  blitFramebuffer:()=>{draw!.attachment!.pixels=new Uint8Array(read!.attachment!.pixels!);events.push({name:'resolve'});},
  readPixels:(_x:number,_y:number,_w:number,_h:number,_f:number,_t:number,p:Uint8ClampedArray)=>{p.set(read!.attachment!.pixels!);events.push({name:'read'});},
  deleteProgram:()=>{if(deleteFailure)throw Error('program cleanup failed');},getExtension:()=>({loseContext:()=>events.push({name:'lose-context'})}),
 };
 const canvas=vi.fn(()=>({getContext:()=>g}));vi.stubGlobal('OffscreenCanvas',canvas);
 return{events,canvas,failCleanup:(value:boolean)=>{deleteFailure=value;}};
}
afterEach(()=>vi.unstubAllGlobals());
describe('native Perlin target acknowledgement, ownership and budget (CPU call contracts)',()=>{
 it.each([0,4] as const)('replaces opaque bytes and %i-sample history before readback without the image blend pass',async samples=>{
  const gl=graphics(),target=new SourcePerlinCpuTarget({...opts,samples}),pixels=image();
  await target.drawGpuAsync(f(),channel(),async()=>({...ack(),pixels}));
  expect(target.diagnostics()).toMatchObject({draws:1,sourcePixelRenderer:{backend:'native',identity:'a'.repeat(64),generation:3,sequence:7,samples:0}});
  expect(gl.events.find(e=>e.name==='upload')?.pixels).toEqual([7,8,9,255,10,11,12,255,1,2,3,255,4,5,6,255]);
  expect(gl.events.filter(e=>e.name==='other-draw')).toEqual([]);
  expect(gl.events.filter(e=>e.name==='native-copy')).toEqual(samples?[{name:'native-copy',blend:false,dither:false}]:[]);
  expect(target.readPixels()).toEqual(pixels);expect(pixels).toEqual(image());
  target.draw(cpuFrame);expect(target.diagnostics().sourcePixelRenderer).toBeUndefined();
  await target.drawGpuAsync(f(),channel(),async()=>({...ack(),sequence:8}));expect(target.readPixels()).toEqual(image());expect(target.diagnostics().sourcePixelRenderer?.sequence).toBe(8);target.dispose();
 });
 it('holds the entire in-flight peak and rejects reentrant mutations without losing the owner',async()=>{
  const gl=graphics(),a=new SourcePerlinCpuTarget(opts),b=a.createSibling(opts),base=a.diagnostics().deviceRepresentationBytes,wait=deferred<SourceNativePixels>();
  const render=vi.fn(()=>wait.promise),pending=a.drawGpuAsync(f(),channel(),render);
  expect(gl.canvas).not.toHaveBeenCalled();expect(a.diagnostics().deviceRepresentationBytes).toBeGreaterThan(base+7*1024*1024);
  for(const run of [()=>a.readPixels(),()=>a.draw(cpuFrame),()=>a.dispose(),()=>a.releaseSceneGpuBindings()])expect(run).toThrow(/in-flight/);
  expect(()=>b.withWorkingBytes(256*1024*1024-base-1,()=>{})).toThrow(expect.objectContaining({code:'capacity'}));
  expect(a.diagnostics().deviceTargets).toBe(2);wait.resolve(ack());await pending;
  expect(a.diagnostics().deviceRepresentationBytes).toBe(base);expect(a.readPixels()).toEqual(image());a.dispose();b.dispose();
 });
 it('keeps capture reservations across awaits, including rejection',async()=>{
  const a=new SourcePerlinCpuTarget(opts),b=a.createSibling(opts),base=a.diagnostics().deviceRepresentationBytes,wait=deferred<void>();
  const pending=a.withWorkingBytesAsync(4096,()=>wait.promise);expect(b.diagnostics().deviceRepresentationBytes).toBe(base+4096);
  wait.reject(Error('capture stopped'));await expect(pending).rejects.toThrow('capture stopped');expect(b.diagnostics().deviceRepresentationBytes).toBe(base);a.dispose();b.dispose();
 });
 it('commits a completed ACK before soft cancellation and preserves exact history for the owner',async()=>{
  graphics();const target=new SourcePerlinCpuTarget(opts);let cancelled=false;
  await expect(target.drawGpuAsync(f(),channel(),async()=>{cancelled=true;return ack();},()=>cancelled)).rejects.toMatchObject({code:'cancelled'});
  expect(target.diagnostics().draws).toBe(1);expect(target.diagnostics().sourcePixelRenderer?.sequence).toBe(7);expect(target.readPixels()).toEqual(image());target.dispose();
 });
 it('rejects capacity before dispatch or GL creation while preserving a sibling',async()=>{
  const gl=graphics(),a=new SourcePerlinCpuTarget(opts),b=a.createSibling(opts),render=vi.fn(async()=>ack());
  await expect(a.drawGpuAsync(f(),channel(),render,undefined,256*1024*1024)).rejects.toMatchObject({code:'capacity'});
  expect(render).not.toHaveBeenCalled();expect(gl.canvas).not.toHaveBeenCalled();expect(b.diagnostics().deviceTargets).toBe(1);a.dispose();b.dispose();
 });
 it.each(['transport','alpha','identity','size','backing'] as const)('does not publish or upload an invalid %s response',async fault=>{
  const gl=graphics(),a=new SourcePerlinCpuTarget(opts),b=a.createSibling(opts);
  const render=async()=>{if(fault==='transport')throw Error('transport failed');const result=ack();if(fault==='alpha')result.pixels[3]=254;if(fault==='identity')result.rendererIdentity='unknown';if(fault==='size')result.width=3;if(fault==='backing')result.pixels=new Uint8ClampedArray(new ArrayBuffer(32),0,16);return result;};
  await expect(a.drawGpuAsync(f(),channel(),render)).rejects.toThrow();expect(gl.events.some(e=>e.name==='upload')).toBe(false);expect(gl.canvas).not.toHaveBeenCalled();expect(b.diagnostics().deviceTargets).toBe(1);a.dispose();b.dispose();
 });
 it('retains the last shared-device owner when cleanup fails and supports a retry',async()=>{
  const gl=graphics(),a=new SourcePerlinCpuTarget(opts);await a.drawGpuAsync(f(),channel(),async()=>ack());
  gl.failCleanup(true);expect(()=>a.dispose()).toThrow('program cleanup failed');expect(()=>a.readPixels()).toThrow(expect.objectContaining({code:'failed'}));expect(()=>a.dispose()).toThrow('program cleanup failed');
  gl.failCleanup(false);a.dispose();expect(()=>a.diagnostics()).toThrow(expect.objectContaining({code:'disposed'}));
 });
});
