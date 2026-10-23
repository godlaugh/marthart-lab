import {beforeAll,describe,it,expect,vi} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {spawnSync,ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {encodeSourceDrawingFrame,type SourceDrawingFrame} from '../src/engine/sourceDrawingFrame';
// @ts-expect-error The Node host service is an ES module, not browser code.
import {createSourceRendererService} from '../server/source-renderer.mjs';
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function request(sequence:number,overrides:Partial<SourceDrawingFrame>={}){
 const frame:SourceDrawingFrame={generation:1,sequence,width:7,height:5,clear:[1,0,0.5,1],drawing:{model:'source-drawing-v1',commands:[],textures:[],admittedBytes:0,copiedBufferBytes:0,retainedBufferBytes:0},...overrides};
 const result=encodeSourceDrawingFrame(frame);if(!result.ok)throw Error(result.error.reason);return result.value;
}
let root:string,binary:string,executableSha256:string;
beforeAll(()=>{mkdirSync('.cache',{recursive:true});root=mkdtempSync(resolve('.cache/session-boundary-'));});
describe.skipIf(process.platform!=='darwin')('real persistent CGL session',()=>{
 beforeAll(()=>{
  binary=join(root,'renderer');const build=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-framework','Foundation','-framework','OpenGL','server/render/SourceCglRenderer.m','-o',binary],{encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:65536});
  expect(build.error).toBeUndefined();expect(build.status,build.stderr).toBe(0);expect(build.stderr).toBe('');executableSha256=hash(readFileSync(binary));
 });
 const service=(options={})=>createSourceRendererService({executablePath:binary,executableSha256,...options});
 it('reuses one process/context across changing dimensions, colors and clear-only frames',async()=>{
  const s=await service();try{
   for(let i=1;i<=8;i++){const color=i%2?[1,0,0.5,1] as const:[0,1,0,1] as const;const r=await s.render(request(i,{width:i+4,height:i+2,clear:color}));
    expect(r.ok,JSON.stringify(r.error)).toBe(true);expect(r.value).toMatchObject({sequence:i,width:i+4,height:i+2,sessionSerial:1,contextSerial:1,rowOrder:'bottom-up'});
    const expected=i%2?[255,0,128,255]:[0,255,0,255];for(let k=0;k<r.value.pixels.length;k+=4)expect([...r.value.pixels.subarray(k,k+4)]).toEqual(expected);
   }expect(s.sessionStarts).toBe(1);expect(s.processCount).toBe(1);
  }finally{expect(await s.close()).toEqual({ok:true});expect(s.processCount).toBe(0);}
 });
 it('owns request bytes and rejects duplicate identities without corrupting the session',async()=>{
  const s=await service();try{const b=request(1),pending=s.render(b);b.fill(0);expect((await pending).ok).toBe(true);
   expect(await s.render(request(1))).toMatchObject({ok:false,error:{kind:'input'}});expect((await s.render(request(2))).value.contextSerial).toBe(1);
  }finally{await s.close();}
 });
 it('keeps a good context after invalid input and recreates it after a shader error',async()=>{
  const s=await service();try{
   expect((await s.render(request(1))).ok).toBe(true);
   const bad=Buffer.from(request(2));bad.writeUInt32LE(0xffffffff,48);expect(await s.render(bad)).toMatchObject({ok:false,error:{kind:'input'}});
   expect((await s.render(request(3))).value.contextSerial).toBe(1);
   const f:SourceDrawingFrame['drawing']={model:'source-drawing-v1',textures:[],admittedBytes:0,copiedBufferBytes:0,retainedBufferBytes:0,commands:[{vertexShader:'not GLSL',fragmentShader:'out vec4 color;void main(){color=vec4(1);}',attributes:[{name:'position',size:2,divisor:0,values:new Float32Array([0,0,1,0,0,1])}],first:0,count:3,instances:1,uniforms:[],depthTest:false,depthWrite:false,depthFunction:'less-equal',frontFace:'counter-clockwise',passes:['both'],blend:'source-alpha-over-additive-alpha'}]};
   expect(await s.render(request(4,{drawing:f}))).toMatchObject({ok:false,error:{kind:'runtime'}});
   expect((await s.render(request(5))).value).toMatchObject({sessionSerial:1,contextSerial:2});
  }finally{await s.close();}
 });
 it('cancels an actual CGL child and recovers in a fresh process',async()=>{
  const s=await service(),controller=new AbortController();try{const pending=s.render(request(1),{signal:controller.signal});for(let i=0;i<100&&s.processCount===0;i++)await delay(1);expect(s.processCount).toBe(1);controller.abort();expect(await pending).toMatchObject({ok:false,error:{kind:'cancelled'}});expect(s.processCount).toBe(0);expect((await s.render(request(2))).value).toMatchObject({sessionSerial:2,contextSerial:1});}finally{await s.close();}
 });
 it('rejects an unexpected executable identity',async()=>{await expect(createSourceRendererService({executablePath:binary,executableSha256:'0'.repeat(64)})).rejects.toThrow('身份');});
 it('does not spawn after immediate close or pre-cancel, and bounds concurrent requests',async()=>{
  const s=await service();const cancelled=new AbortController();cancelled.abort();expect(await s.render(request(1),{signal:cancelled.signal})).toMatchObject({ok:false,error:{kind:'cancelled'}});expect(s.processCount).toBe(0);
  const pending=s.render(request(1));expect(await s.render(request(2))).toMatchObject({ok:false,error:{kind:'capacity'}});
  expect(await s.close()).toEqual({ok:true});expect(await pending).toMatchObject({ok:false,error:{kind:'closed'}});await delay(20);expect(s.processCount).toBe(0);expect(s.sessionStarts).toBe(0);
  expect(await s.render(request(3))).toMatchObject({ok:false,error:{kind:'closed'}});
 });
});

// Controlled child fixtures exercise transport/lifetime faults; they are not
// evidence of native image fidelity. All killed processes are owned handles.
describe('owned session transport faults',()=>{
 let number=0;
 async function fixture(mode:string,options={}){
  const executablePath=join(root,'fixture-'+(++number));
  const source=`#!${process.execPath}\nconst mode=${JSON.stringify(mode)};let input=Buffer.alloc(0);process.on('SIGTERM',()=>{});process.stdin.on('data',b=>{input=Buffer.concat([input,b]);if(input.length<12||input.length<input.readUInt32LE(8))return;const request=input;input=Buffer.alloc(0);if(mode==='exit')process.exit(9);if(mode==='hang')return;const w=request.readUInt32LE(20),h=request.readUInt32LE(24),head=Buffer.alloc(44);[0x31524c4d,1,44+w*h*4,request.readUInt32LE(12),request.readUInt32LE(16),w,h,0,1,w*h*4,1].forEach((n,i)=>head.writeUInt32LE(n,i*4));if(mode==='identity')head.writeUInt32LE(999,16);if(mode==='length')head.writeUInt32LE(0xffffffff,36);if(mode==='partial'){process.stdout.write(head.subarray(0,20));process.exit(0);}const response=Buffer.concat([head,Buffer.alloc(w*h*4)]);if(mode==='extra'){process.stdout.write(Buffer.concat([response,Buffer.from([1])]));return;}if(mode==='fragment'){let i=0;const tick=()=>{if(i===response.length)return;process.stdout.write(response.subarray(i,i+1));i++;setTimeout(tick,1)};tick();return;}process.stdout.write(response);});\n`;
  writeFileSync(executablePath,source);chmodSync(executablePath,0o755);
  return Object.assign(await createSourceRendererService({executablePath,executableSha256:hash(Buffer.from(source)),timeoutMs:2000,killGraceMs:10,cleanupMs:1500,...options}),{fixturePath:executablePath});
 }
 it('refuses a changed executable before another request',async()=>{const s=await fixture('normal');try{expect((await s.render(request(1))).ok).toBe(true);writeFileSync(s.fixturePath,readFileSync(s.fixturePath,'utf8')+'// changed\n');expect(await s.render(request(2))).toMatchObject({ok:false,error:{kind:'unavailable'}});expect(s.sessionStarts).toBe(1);expect(s.processCount).toBe(0);}finally{await s.close();}});
 it.each(['identity','length','partial','extra','exit'])('retires %s response before another process can serve a frame',async mode=>{
  const s=await fixture(mode);try{expect((await s.render(request(1))).ok).toBe(false);expect(s.processCount).toBe(0);expect(s.activeCount).toBe(0);expect(s.sessionStarts).toBe(1);
   expect((await s.render(request(2))).ok).toBe(false);expect(s.sessionStarts).toBe(2);expect(s.processCount).toBe(0);
  }finally{await s.close();}
 });
 it('parses arbitrary response fragmentation without repeated buffer concatenation',async()=>{const s=await fixture('fragment');try{expect((await s.render(request(1))).ok).toBe(true);}finally{expect(await s.close()).toEqual({ok:true});}});
 it.each(['cancel','timeout','close'])('confirms child exit on %s',async mode=>{
  const s=await fixture('hang',{timeoutMs:mode==='timeout'?120:2000});const controller=new AbortController();
  try{const pending=s.render(request(1),{signal:controller.signal});for(let i=0;i<100&&s.processCount===0;i++)await delay(2);expect(s.processCount).toBe(1);
   let closing;if(mode==='cancel')controller.abort();if(mode==='close')closing=s.close();
   expect(await pending).toMatchObject({ok:false,error:{kind:{cancel:'cancelled',timeout:'timeout',close:'closed'}[mode]}});if(closing)expect(await closing).toEqual({ok:true});expect(s.processCount).toBe(0);
  }finally{await s.close();}
 });
 it('retains a failed cleanup owner and refuses a replacement until retry confirms exit',async()=>{
  const s=await fixture('hang',{timeoutMs:2000,killGraceMs:5,cleanupMs:40});const controller=new AbortController();let spy;
  try{const pending=s.render(request(1),{signal:controller.signal});for(let i=0;i<100&&s.processCount===0;i++)await delay(2);expect(s.processCount).toBe(1);
   spy=vi.spyOn(ChildProcess.prototype,'kill').mockReturnValue(false);controller.abort();expect(await pending).toMatchObject({ok:false,error:{kind:'cleanup'}});expect(s.processCount).toBe(1);
   expect(await s.render(request(2))).toMatchObject({ok:false,error:{kind:'capacity'}});expect(s.sessionStarts).toBe(1);
   spy.mockRestore();spy=undefined;expect(await s.close()).toEqual({ok:true});expect(s.processCount).toBe(0);
  }finally{spy?.mockRestore();await s.close();}
 });
});
