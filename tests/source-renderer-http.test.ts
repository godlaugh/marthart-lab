import {beforeAll,describe,it,expect,vi} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync,ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import http from 'node:http';
import {encodeSourceDrawingFrame} from '../src/engine/sourceDrawingFrame';
// @ts-expect-error Node host module is separate from browser types.
import {createExportServer} from '../server/index.mjs';
// @ts-expect-error Node desktop host module is separate from browser types.
import {createDesktopHost} from '../desktop/host.mjs';
let root:string,backend:{executablePath:string;executableSha256:string},serial=0;
const packet=(sequence=1)=>{const r=encodeSourceDrawingFrame({generation:3,sequence,width:7,height:5,samples:0,clear:[1,0,0.5,1],drawing:{model:'source-drawing-v1',commands:[],textures:[],admittedBytes:0,copiedBufferBytes:0,retainedBufferBytes:0}});if(!r.ok)throw Error(r.error.reason);return Buffer.from(r.value);};
const delay=(n:number)=>new Promise(resolve=>setTimeout(resolve,n));
const post=(url:string,body=packet(),headers={})=>fetch(url+'/api/source-renderer/frames',{method:'POST',headers:{'content-type':'application/octet-stream',...headers},body});
describe.skipIf(process.platform!=='darwin')('loopback native frame transport',()=>{
 beforeAll(()=>{mkdirSync('.cache',{recursive:true});root=mkdtempSync(resolve('.cache/native-http-'));const executablePath=join(root,'renderer');const build=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O2','-framework','Foundation','-framework','OpenGL','server/render/SourceCglRenderer.m','-o',executablePath],{encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:65536});expect(build.status,build.stderr).toBe(0);backend={executablePath,executableSha256:createHash('sha256').update(readFileSync(executablePath)).digest('hex')};});
 async function service(configured=true){const app=await createExportServer({root:join(root,'exports-'+(++serial)),sourceRendererBackend:configured?backend:undefined,limits:{bodyTimeoutMs:1000,writeTimeoutMs:1000}});const a=await app.listen(0);return{app,url:`http://127.0.0.1:${a.port}`};}
 it('reports unavailable without starting a process when not configured',async()=>{const s=await service(false);try{expect(await(await fetch(s.url+'/api/source-renderer/health')).json()).toMatchObject({available:false});expect((await post(s.url)).status).toBe(503);expect(s.app.ownedProcessCount).toBe(0);}finally{await s.app.close();}});
 it('coordinates identical caller identities and returns original identity and exact pixels',async()=>{
  const s=await service();try{for(const sequence of [1,1,9]){const r=await post(s.url,packet(sequence));expect(r.status).toBe(200);expect(r.headers.get('x-source-generation')).toBe('3');expect(r.headers.get('x-source-sequence')).toBe(String(sequence));expect(r.headers.get('x-source-row-order')).toBe('bottom-up');const b=new Uint8Array(await r.arrayBuffer());expect(b.length).toBe(140);for(let i=0;i<b.length;i+=4)expect([...b.subarray(i,i+4)]).toEqual([255,0,128,255]);}expect(s.app.ownedProcessCount).toBe(1);}
  finally{await s.app.close();expect(s.app.ownedProcessCount).toBe(0);}
 });
 it('preserves an actual compiler failure stage through the loopback HTTP boundary',async()=>{
  const s=await service();try{
   const frame=encodeSourceDrawingFrame({generation:1,sequence:1,width:7,height:5,samples:0,clear:[0,0,0,1],drawing:{model:'source-drawing-v1',textures:[],admittedBytes:0,copiedBufferBytes:0,retainedBufferBytes:0,commands:[{primitive:'triangles',vertexShader:'not GLSL',fragmentShader:'out vec4 c;void main(){c=vec4(1);}',attributes:[{name:'position',size:2,divisor:0,values:new Float32Array([0,0,1,0,0,1])}],first:0,count:3,instances:1,uniforms:[],depthTest:false,depthWrite:false,depthFunction:'less-equal',frontFace:'counter-clockwise',passes:['both'],blend:'source-alpha-over'}]}});
   if(!frame.ok)throw Error(frame.error.reason);const response=await post(s.url,Buffer.from(frame.value));expect(response.status).toBe(502);expect(await response.json()).toMatchObject({kind:'runtime',gpuStage:'compile'});
   const recovered=await post(s.url);expect(recovered.status).toBe(200);expect(recovered.headers.get('x-source-context')).toBe('2');await recovered.arrayBuffer();
  }finally{await s.app.close();expect(s.app.ownedProcessCount).toBe(0);}
 });
 it('rejects external origin, wrong MIME, oversized body and malformed frames',async()=>{const s=await service();try{
  expect((await post(s.url,packet(),{origin:'https://example.com'})).status).toBe(403);
  expect((await post(s.url,packet(),{'content-type':'text/plain'})).status).toBe(415);
  expect((await post(s.url,Buffer.alloc(52))).status).toBe(400);
  const broken=packet();broken.writeUInt32LE(999,48);expect((await post(s.url,broken)).status).toBe(400);
  const status=await new Promise(resolve=>{const req=http.request(s.url+'/api/source-renderer/frames',{method:'POST',headers:{'content-type':'application/octet-stream','content-length':64*1024*1024+1}},res=>{res.resume();resolve(res.statusCode);});req.on('error',()=>resolve('error'));req.end();});expect(status).toBe(413);
  expect((await post(s.url)).status).toBe(200);
 }finally{await s.app.close();}});
 it('reserves before upload and releases abandoned or shutdown uploads',async()=>{const s=await service();let req:http.ClientRequest|undefined;try{
  req=http.request(s.url+'/api/source-renderer/frames',{method:'POST',headers:{'content-type':'application/octet-stream','content-length':1000}});req.on('error',()=>{});req.write(packet());await delay(30);
  expect((await post(s.url)).status).toBe(429);req.destroy();await delay(30);expect((await post(s.url)).status).toBe(200);
  req=http.request(s.url+'/api/source-renderer/frames',{method:'POST',headers:{'content-type':'application/octet-stream','content-length':1000}});req.on('error',()=>{});req.write(packet());await delay(30);await s.app.close();expect(s.app.ownedProcessCount).toBe(0);
 }finally{req?.destroy();await s.app.close();}});
 it('retains a desktop cleanup failure and can retry the same owner',async()=>{
  const dist=join(root,'retry-dist');mkdirSync(dist,{recursive:true});writeFileSync(join(dist,'index.html'),'<!doctype html>');const host=await createDesktopHost({dist,exportRoot:join(root,'retry-exports'),sourceRendererBackend:{...backend,killGraceMs:5,cleanupMs:100}});let spy;
  try{const r=await post(host.origin);expect(r.status).toBe(200);await r.arrayBuffer();spy=vi.spyOn(ChildProcess.prototype,'kill').mockReturnValue(false);await expect(host.close()).rejects.toThrow('退出');expect(host.api.ownedProcessCount).toBe(1);spy.mockRestore();spy=undefined;await host.close();expect(host.api.ownedProcessCount).toBe(0);}finally{spy?.mockRestore();await host.api.close();await host.close();}
 });
 it('binds native frames to a live page connection and reaps on disconnect before reacquisition',async()=>{
  const s=await service(),controller=new AbortController(),token='12'.repeat(16);let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
   const response=await fetch(s.url+'/api/source-renderer/lease/'+token,{signal:controller.signal});expect(response.status).toBe(200);reader=response.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toBe('READY\n');
   expect((await post(s.url)).status).toBe(409);expect((await post(s.url,packet(),{'x-source-lease':'34'.repeat(16)})).status).toBe(409);
   const accepted=await post(s.url,packet(),{'x-source-lease':token});expect(accepted.status).toBe(200);await accepted.arrayBuffer();expect(s.app.ownedProcessCount).toBe(1);
   expect((await fetch(s.url+'/api/source-renderer/lease/'+'56'.repeat(16))).status).toBe(429);
   controller.abort();await reader.cancel().catch(()=>{});reader.releaseLock();reader=undefined;
   for(let i=0;i<200&&s.app.ownedProcessCount;i++)await delay(10);expect(s.app.ownedProcessCount).toBe(0);
   expect((await post(s.url,packet(),{'x-source-lease':token})).status).toBe(409);
   const renewed=new AbortController();try{const fresh=await fetch(s.url+'/api/source-renderer/lease/'+'78'.repeat(16),{signal:renewed.signal});expect(fresh.status).toBe(200);await fresh.body!.cancel();}finally{renewed.abort();}
  }finally{controller.abort();await reader?.cancel().catch(()=>{});await s.app.close();}
 });
 it('passes the same native route through the actual desktop host',async()=>{
  const dist=join(root,'dist');mkdirSync(dist,{recursive:true});writeFileSync(join(dist,'index.html'),'<!doctype html>');
  const host=await createDesktopHost({dist,exportRoot:join(root,'desktop'),ffmpegPath:'ffmpeg',sourceRendererBackend:backend});
  try{const r=await post(host.origin);expect(r.status).toBe(200);expect((await r.arrayBuffer()).byteLength).toBe(140);expect(host.api.ownedProcessCount).toBe(1);}finally{await host.close();expect(host.api.ownedProcessCount).toBe(0);}
 });
});
