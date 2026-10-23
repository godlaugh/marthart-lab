import {beforeAll,describe,expect,it,vi} from 'vitest';
import {mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import {ChildProcess,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {encodeSourceDrawingFrame,type SourceDrawingFrame} from '../src/engine/sourceDrawingFrame';
import {sourceBouncingProgramBytes,type SourceBouncingOperation} from '../src/engine/sourceBouncingOperation';
import {sourceBouncingNativeQuad,sourceBouncingNativeUpdateFragment,sourceBouncingNativeTextureVertex,sourceBouncingNativeFragment} from '../src/engine/sourceBouncingGpuShader';
// @ts-expect-error Node adapter is separate from browser contracts.
import {createSourceRendererService} from '../server/source-renderer.mjs';
// @ts-expect-error Node adapter is separate from browser contracts.
import {createExportServer} from '../server/index.mjs';
const resource='11'.repeat(16),foreign='22'.repeat(16),shaders={quad:sourceBouncingNativeQuad,update:sourceBouncingNativeUpdateFragment,vertex:sourceBouncingNativeTextureVertex,fragment:sourceBouncingNativeFragment},programBytes=sourceBouncingProgramBytes(shaders);
const identity=(particleCount=2)=>({resource,particleCount,programBytes});
const blank=(bouncing?:SourceBouncingOperation):SourceDrawingFrame=>({generation:1,sequence:1,width:1,height:1,samples:0,clear:[0,0,0,0],drawing:{model:'source-drawing-v1',commands:[],textures:[],admittedBytes:0,copiedBufferBytes:0,retainedBufferBytes:0},...(bouncing?{bouncing}:{})});
const begin=(count=2)=>blank({kind:'create',...identity(count),shaders});
const upload=(offset:number,particles:Float32Array,count=2)=>blank({kind:'upload',...identity(count),offset,particles});
const release=()=>blank({kind:'release',resource});
const update={subSteps:1,timeStep:Math.fround(.012),particleRadius:Math.fround(.006),boundary:{kind:'circle' as const,center:[0,0] as const,radius:Math.fround(.55)}};
function display(from=0,to=0,count=2):SourceDrawingFrame{
 const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],palette=new Float32Array(75);palette.set([1,0,0]);
 const uniform=(name:string,kind:'float'|'int'|'mat4'|'vec3'|'vec3-array',values:number[]|Float32Array,n=1)=>({name,kind,count:n,values:kind==='int'?new Int32Array(values):new Float32Array(values)});
 return{...blank({kind:'draw',...identity(count),from,to,update}),width:8,height:8,clear:[0,0,0,1],completion:'opaque-alpha',drawing:{model:'source-drawing-v1',textures:[],admittedBytes:8192,copiedBufferBytes:0,retainedBufferBytes:0,commands:[{retainedBouncingState:true,primitive:'points',vertexShader:shaders.vertex,fragmentShader:shaders.fragment,first:0,count,instances:1,attributes:[],uniforms:[uniform('projection','mat4',matrix),uniform('modelview','mat4',matrix),uniform('scale','vec3',[1,1,1]),uniform('offset','vec3',[0,0,0]),uniform('particleCount','int',[count]),uniform('radius','float',[3]),uniform('speedScale','float',[5]),uniform('paletteCount','int',[1]),uniform('palette','vec3-array',palette,25)],depthTest:false,depthWrite:false,depthFunction:'less-equal',frontFace:'counter-clockwise',passes:['both'],blend:'source-alpha-over'}]}};
}
function bytes(frame:SourceDrawingFrame){const encoded=encodeSourceDrawingFrame(frame);if(!encoded.ok)throw Error(encoded.error.reason);return Buffer.from(encoded.value);}
let backend:{executablePath:string;executableSha256:string},root:string;
describe('retained Bouncing encoder admission',()=>{
 it('counts the whole caller seed buffer and six packet representations before allocation',()=>{
  const seeds=new Float32Array(5000000*4);
  expect(encodeSourceDrawingFrame(upload(0,seeds.subarray(0,1048576),5000000)).ok).toBe(true);
  expect(encodeSourceDrawingFrame(upload(0,seeds.subarray(0,2097152),5000000))).toMatchObject({ok:false,error:{kind:'capacity'}});
 });
 it('keeps ownership separate from particle data and rejects inconsistent control/drawing metadata',()=>{
  expect(encodeSourceDrawingFrame({...release(),width:2}).ok).toBe(false);
  expect(encodeSourceDrawingFrame({...begin(),bouncing:{kind:'create',...identity(),programBytes:0,shaders}}).ok).toBe(false);
  const frame=display();frame.bouncing=undefined;expect(encodeSourceDrawingFrame(frame).ok).toBe(false);
 });
});
describe.skipIf(process.platform!=='darwin')('real retained CGL state protocol',()=>{
 beforeAll(()=>{mkdirSync('.cache',{recursive:true});root=mkdtempSync(resolve('.cache/bouncing-protocol-'));const executablePath=join(root,'renderer');const built=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-framework','Foundation','-framework','OpenGL','server/render/SourceCglRenderer.m','-o',executablePath],{encoding:'utf8',timeout:30000,maxBuffer:65536});expect(built.status,built.stderr).toBe(0);expect(built.stderr).toBe('');backend={executablePath,executableSha256:createHash('sha256').update(readFileSync(executablePath)).digest('hex')};});
 async function owner(){const service=await createSourceRendererService(backend);let sequence=0;return{service,sendMalformed:(frame:SourceDrawingFrame,transform:(packet:Buffer)=>Buffer)=>service.render(transform(bytes({...frame,sequence:++sequence}))),send:(frame:SourceDrawingFrame,options={})=>service.render(bytes({...frame,sequence:++sequence}),options),close:async()=>{expect(await service.close()).toMatchObject({ok:true});expect(service.processCount).toBe(0);}};}
 const particle=new Float32Array([0,0,.1,0]);
 it('keeps state through malformed/foreign requests, ordinary frames and explicit paused redraws',async()=>{
  const o=await owner();try{
   expect(await o.send(begin())).toMatchObject({ok:true});expect(await o.send(display())).toMatchObject({ok:false,error:{kind:'input'}});
   expect(await o.send(upload(1,particle))).toMatchObject({ok:false,error:{kind:'input'}});
   expect(await o.send({...upload(0,particle),bouncing:{kind:'upload',...identity(),resource:foreign,offset:0,particles:particle}})).toMatchObject({ok:false,error:{kind:'ownership'}});
   expect(await o.send(upload(0,particle))).toMatchObject({ok:true,value:{pixels:Buffer.from([1,0,0,0])}});
   expect(await o.send(display())).toMatchObject({ok:false,error:{kind:'input'}});
   expect(await o.send(upload(1,particle))).toMatchObject({ok:true,value:{pixels:Buffer.from([2,0,0,0])}});
   expect(await o.send(upload(0,particle))).toMatchObject({ok:false,error:{kind:'input'}});
   expect(await o.send(begin())).toMatchObject({ok:false,error:{kind:'capacity'}});
   const wrong=display(0,1);wrong.drawing.commands[0].vertexShader+='\n';expect(await o.send(wrong)).toMatchObject({ok:false,error:{kind:'input'}});
   const a=await o.send(display(0,1));expect(a.ok).toBe(true);expect([...a.value.pixels].some((v,i)=>i%4===0&&v>0)).toBe(true);
   expect(await o.send(blank())).toMatchObject({ok:true});const b=await o.send(display(1,1));expect(b.value.pixels).toEqual(a.value.pixels);
   expect(await o.send(display(0,2))).toMatchObject({ok:false,error:{kind:'input'}});
   expect(await o.send({...release(),bouncing:{kind:'release',resource:foreign}})).toMatchObject({ok:false,error:{kind:'ownership'}});
   expect(await o.send(release())).toMatchObject({ok:true});expect(await o.send(release())).toMatchObject({ok:true});expect(await o.send(display())).toMatchObject({ok:false,error:{kind:'state-lost'}});
  }finally{await o.close();}
 });
 it('rejects trailing data without advancing state, and retires state before a poisoned context is replaced',async()=>{
  const o=await owner();try{
   await o.send(begin());await o.send(upload(0,new Float32Array(8)));
   const good=await o.send(display());expect(good.ok).toBe(true);
   // Direct transport sequence remains increasing; malformed input is rejected before GL.
   expect(await o.sendMalformed(display(0,1),packet=>{const result=Buffer.concat([packet,Buffer.alloc(4)]);result.writeUInt32LE(result.length,8);return result;})).toMatchObject({ok:false,error:{kind:'input'}});
   const frame=display(0,1);frame.drawing.commands[0].uniforms=[...frame.drawing.commands[0].uniforms,{name:'stateTex',kind:'sampler2d',texture:0}];
   expect(await o.send(frame)).toMatchObject({ok:false,error:{kind:'input'}});
   expect(await o.send(display(0,1))).toMatchObject({ok:true});
   const broken=display();broken.bouncing=undefined;const command=broken.drawing.commands[0];delete command.retainedBouncingState;command.vertexShader='invalid GLSL';command.attributes=[{name:'position',size:4,divisor:0,values:new Float32Array(8)}];
   expect(await o.send(broken)).toMatchObject({ok:false,error:{kind:'runtime'}});
   expect(await o.send(display(1,1))).toMatchObject({ok:false,error:{kind:'state-lost'}});
   expect(await o.send(begin())).toMatchObject({ok:true});await o.send(upload(0,new Float32Array(8)));const recovered=await o.send(display());expect(recovered.value.contextSerial).toBeGreaterThan(good.value.contextSerial);expect(recovered.value.pixels).toEqual(good.value.pixels);
  }finally{await o.close();}
 });
 it('releases provisional ownership after shader preparation fails',async()=>{
  const o=await owner();try{const bad=begin();bad.bouncing={kind:'create',...identity(),shaders:{...shaders,quad:'invalid GLSL'}};expect(await o.send(bad)).toMatchObject({ok:false,error:{kind:'runtime'}});expect(await o.send(begin())).toMatchObject({ok:true});}finally{await o.close();}
 });
 it('retires the real process on cancellation after a delayed response and reports its old state lost',async()=>{
  let child:ChildProcess|undefined;const original=(ChildProcess.prototype as any).spawn;
  const spy=vi.spyOn(ChildProcess.prototype as any,'spawn').mockImplementation(function(this:ChildProcess,options:any){const result=original.call(this,options);if(options.file===backend.executablePath)child=this;return result;});
  const o=await owner();try{
   await o.send(begin());await o.send(upload(0,new Float32Array(8)));expect(child).toBeDefined();child!.stdout!.pause();
   const controller=new AbortController(),pending=o.send(display(0,1),{signal:controller.signal});await new Promise(resolve=>setTimeout(resolve,25));expect(o.service.activeCount).toBe(1);
   controller.abort();child!.stdout!.resume();expect(await pending).toMatchObject({ok:false,error:{kind:'cancelled'}});expect(o.service.processCount).toBe(0);
   expect(await o.send(display(1,1))).toMatchObject({ok:false,error:{kind:'state-lost'}});expect(o.service.sessionStarts).toBe(2);
  }finally{child?.stdout?.resume();spy.mockRestore();await o.close();}
 });
 it('carries a complete 5M caller buffer in bounded chunks through real HTTP and independent caller frame identities',async()=>{
  const app=await createExportServer({root:join(root,'http'),sourceRendererBackend:backend});const address=await app.listen(0),url=`http://127.0.0.1:${address.port}/api/source-renderer/frames`;
  const post=async(frame:SourceDrawingFrame)=>{const response=await fetch(url,{method:'POST',headers:{'content-type':'application/octet-stream'},body:bytes(frame)});return{response,body:Buffer.from(await response.arrayBuffer())};};
  try{const seeds=new Float32Array(5000000*4);expect((await post(begin(5000000))).response.status).toBe(200);
   const lease=await fetch(`http://127.0.0.1:${address.port}/api/source-renderer/lease/`+'55'.repeat(16));expect(lease.status).toBe(429);await lease.arrayBuffer();
   for(let offset=0;offset<seeds.length;offset+=1048576){const values=seeds.subarray(offset,Math.min(seeds.length,offset+1048576)),r=await post(upload(offset/4,values,5000000));expect(r.response.status).toBe(200);expect(r.response.headers.get('x-source-sequence')).toBe('1');expect(r.response.headers.get('x-source-format')).toBe('u32le');expect(r.response.headers.get('x-source-row-order')).toBe('none');expect(r.body.readUInt32LE()).toBe((offset+values.length)/4);}
   const wrong=await post({...release(),bouncing:{kind:'release',resource:foreign}});expect(wrong.response.status).toBe(409);expect(JSON.parse(wrong.body.toString()).kind).toBe('ownership');
   expect((await post(release())).response.status).toBe(200);const lost=await post(display(0,0,5000000));expect(lost.response.status).toBe(409);expect(JSON.parse(lost.body.toString()).kind).toBe('state-lost');
  }finally{await app.close();expect(app.ownedProcessCount).toBe(0);}
 },30000);
});
