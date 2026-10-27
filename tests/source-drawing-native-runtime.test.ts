import {beforeAll,describe,it,expect} from 'vitest';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {encodeSourceDrawingFrame,type SourceDrawingFrame} from '../src/engine/sourceDrawingFrame';
import {encodeSourceNativeDrawingRequest,type SourceNativeDrawingRequest} from '../src/engine/sourceDrawingNativeProtocol';
import {SOURCE_DRAWING_MAX_CHUNK_BYTES} from '../src/engine/sourceDrawingBudget';
// @ts-expect-error The owned Node pipe service is a separate runtime.
import {createSourceRendererService} from '../server/source-renderer.mjs';
const resource='56'.repeat(16);
function frame(samples=0):SourceDrawingFrame{return{generation:1,sequence:1,width:31,height:23,samples,clear:[.1,.2,.3,1],completion:'opaque-alpha',drawing:{model:'source-drawing-v1',textures:[],copiedBufferBytes:1000,retainedBufferBytes:1000,admittedBytes:3000,commands:[{primitive:'triangles',vertexShader:'in vec2 position;in vec3 tint;out vec3 c;void main(){gl_Position=vec4(position,0,1);c=tint;}',fragmentShader:'in vec3 c;out vec4 color;void main(){color=vec4(c,.25);}',first:0,count:6,instances:3,attributes:[{name:'position',size:2,divisor:0,values:Float32Array.of(-1,-1,3,-1,-1,3,-1,-1,-1,3,3,-1)},{name:'tint',size:3,divisor:1,values:Float32Array.of(1,0,0,0,1,0,0,0,1)}],uniforms:[],depthTest:false,depthWrite:false,depthFunction:'less-equal',frontFace:'counter-clockwise',passes:['back','front'],blend:'source-alpha-over-additive-alpha'}]}};}
function bytes(r:SourceNativeDrawingRequest|SourceDrawingFrame){const out='operation' in r?encodeSourceNativeDrawingRequest(r):encodeSourceDrawingFrame(r);if(!out.ok)throw Error(out.error.reason);return Buffer.from(out.value);}
describe.skipIf(process.platform!=='darwin')('actual retained CGL drawing frame',()=>{
 let backend:{executablePath:string;executableSha256:string};
 beforeAll(()=>{const folder=mkdtempSync(resolve('.cache/drawing-native-runtime-')),executablePath=join(folder,'renderer'),build=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-framework','Foundation','-framework','OpenGL','server/render/SourceCglRenderer.m','-o',executablePath],{encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:65536});expect(build.status,build.stderr).toBe(0);backend={executablePath,executableSha256:createHash('sha256').update(readFileSync(executablePath)).digest('hex')};},40000);
 async function run(f:SourceDrawingFrame,change?:(r:SourceNativeDrawingRequest)=>void,maximum=4096){const s=await createSourceRendererService(backend);let seq=0,transferred=false;const send=(r:SourceNativeDrawingRequest|SourceDrawingFrame)=>{r.sequence=++seq;return s.render(bytes(r));};try{
  const legacy=await send(f);expect(legacy).toMatchObject({ok:true});
  const {drawing,...base}=f,start:SourceNativeDrawingRequest={...base,operation:{kind:'begin',resource,chunkCount:6,maxChunkBytes:maximum,metadataBytes:8192,schedule:[{commandIndex:0,primitive:'triangles',rangeKind:'instances',total:3,passes:['back','front'],chunksPerPass:3,rangeSize:1}]}};
  expect(await send(start)).toMatchObject({ok:true});let ordinal=0;
  for(let pass=0;pass<2;pass++)for(let i=0;i<3;i++){
   const command=drawing.commands[0],r:SourceNativeDrawingRequest={...base,operation:{kind:'append',resource,chunk:{ordinal:ordinal++,commandIndex:0,passIndex:pass,rangeKind:'instances',offset:i,count:1,total:3,drawing:{...drawing,commands:[{...command,passes:[command.passes[pass]],instances:1,attributes:command.attributes.map(a=>a.divisor?{...a,values:a.values.slice(i*3,i*3+3)}:a)}]}}}};
   change?.(r);const result=await send(r);if(!result.ok){transferred=true;return{failed:result,s,send,base,legacy};}
  }
  const finished=await send({...base,operation:{kind:'finish',resource,expectedIndex:6}});expect(finished).toMatchObject({ok:true});expect(Buffer.from(finished.value.pixels).subarray(64)).toEqual(Buffer.from(legacy.value.pixels));expect(s.retainedResourceCount).toBe(1);
  expect(await send({...base,operation:{kind:'release',resource,expectedIndex:6}})).toMatchObject({ok:true});expect(s.retainedResourceCount).toBe(0);return{legacy,finished};
 }finally{if(!transferred){expect(await s.close()).toMatchObject({ok:true});expect(s.processCount).toBe(0);}}}
 it.each([0,4])('matches complete ordered double-sided transparent rendering at samples=%i',async samples=>{await run(frame(samples));});
 it.each([0,4])('v16 keeps physical viewport independent from allocation and identical across bounded passes at samples=%i',async samples=>{
  for(const viewport of [[-7,5,93,69],[4,3,0,23],[0,0,31,0]] as const){const f=frame(samples);f.viewport=viewport;const r=await run(f);if(!('finished'in r)||!r.finished)throw Error();expect(r.finished.value.pixels.length).toBe(64+31*23*4);}
 });
 it('physically crops a larger viewport without changing clip coordinates and clears zero-sized viewports',async()=>{
  const s=await createSourceRendererService(backend);let sequence=0;
  const send=(f:SourceDrawingFrame)=>s.render(bytes({...f,sequence:++sequence}));
  try{
   const f=frame(),command=f.drawing.commands[0];command.instances=1;command.attributes=command.attributes.filter(a=>!a.divisor);command.passes=['both'];command.vertexShader='in vec2 position;out vec2 uv;void main(){gl_Position=vec4(position,0,1);uv=position*.5+.5;}';command.fragmentShader='in vec2 uv;out vec4 color;void main(){color=vec4(uv,0.5,1);}';
   const large=await send({...f,width:62,height:46}),cropped=await send({...f,viewport:[-3,-4,62,46]});expect(large).toMatchObject({ok:true});expect(cropped).toMatchObject({ok:true});
   const expected=Buffer.alloc(31*23*4);for(let y=0;y<23;y++)Buffer.from(large.value.pixels).copy(expected,y*31*4,((y+4)*62+3)*4,((y+4)*62+34)*4);expect(Buffer.from(cropped.value.pixels)).toEqual(expected);
   const empty=await send({...f,drawing:{...f.drawing,commands:[]}});expect(empty).toMatchObject({ok:true});
   for(const viewport of [[0,0,0,23],[0,0,31,0]] as const){const zero=await send({...f,viewport});expect(zero).toMatchObject({ok:true});expect(Buffer.from(zero.value.pixels)).toEqual(Buffer.from(empty.value.pixels));}
  }finally{expect(await s.close()).toMatchObject({ok:true});expect(s.processCount).toBe(0);}
 });
 it('retains a v16 transaction after a changed viewport and releases the original owner',async()=>{
  const f=frame();f.viewport=[0,0,62,46];const r=await run(f,q=>{if(q.operation.kind==='append'&&q.operation.chunk.ordinal===1)q.viewport=[0,0,63,46];});if(!('failed'in r)||!r.s||!r.send||!r.base)throw Error('Expected viewport identity failure');const {s,send,base}=r;try{expect(r.failed).toMatchObject({ok:false,error:{kind:'ownership'}});expect(s.retainedResourceCount).toBe(1);expect(await send({...base,operation:{kind:'release',resource,expectedIndex:1}})).toMatchObject({ok:true});expect(s.retainedResourceCount).toBe(0);}finally{await s.close();expect(s.processCount).toBe(0);}
 });
 it('rejects a viewport beyond hardware dimensions without losing provisional cleanup custody',async()=>{
  const s=await createSourceRendererService(backend),{drawing:_,...base}=frame();try{
   const r=await s.render(bytes({...base,viewport:[0,0,2147483647,1],operation:{kind:'begin',resource,chunkCount:0,maxChunkBytes:1024,metadataBytes:0,schedule:[]}}));expect(r).toMatchObject({ok:false,error:{kind:'unsupported'}});expect(s.retainedResourceCount).toBe(1);
   expect(await s.render(bytes({...base,sequence:2,viewport:[0,0,2147483647,1],operation:{kind:'release',resource,expectedIndex:0}}))).toMatchObject({ok:true});expect(s.retainedResourceCount).toBe(0);
  }finally{await s.close();expect(s.processCount).toBe(0);}
 });
 it.each([0,4])('transfers exact 4 MiB blocks with unchanged transparent pass order at samples=%i',async samples=>{
  const f=frame(samples),d=f.drawing.commands[0],a=d.attributes[0];
  const nested=()=>bytes({...f,width:1,height:1,samples:0,clear:[0,0,0,0],completion:undefined,drawing:{...f.drawing,commands:[{...d,passes:['back'],instances:1,attributes:d.attributes.map(a=>a.divisor?{...a,values:a.values.slice(0,3)}:a)}]}});
  d.vertexShader+=' '.repeat((8-nested().length%8)%8);
  const values=new Float32Array(a.values.length+(SOURCE_DRAWING_MAX_CHUNK_BYTES-nested().length)/4);values.set(a.values);a.values=values;
  let count=0;await run(f,r=>{if(r.operation.kind==='append'){expect(bytes(r).length-120).toBe(SOURCE_DRAWING_MAX_CHUNK_BYTES);count++;}},SOURCE_DRAWING_MAX_CHUNK_BYTES);expect(count).toBe(6);
 });
 it.each(['maximum','capacity'] as const)('rejects a forged %s at the actual C boundary without creating a context',mode=>{
  const {drawing:_,...base}=frame(),request:SourceNativeDrawingRequest={...base,operation:{kind:'begin',resource,chunkCount:0,maxChunkBytes:SOURCE_DRAWING_MAX_CHUNK_BYTES,metadataBytes:0,schedule:[]}},packet=bytes(request);
  if(mode==='maximum')packet.writeUInt32LE(SOURCE_DRAWING_MAX_CHUNK_BYTES+1,96);else{packet.writeUInt32LE(3072,20);packet.writeUInt32LE(2048,24);packet.writeUInt32LE(4,52);}
  const r=spawnSync(backend.executablePath,['--stdio'],{input:packet,timeout:10000,killSignal:'SIGKILL',maxBuffer:65536});
  expect(r.error).toBeUndefined();expect(r.signal).toBeNull();expect(r.status).toBe(0);expect(r.stderr.length).toBe(0);expect(r.stdout.readUInt32LE(28)).toBe(mode==='maximum'?1:3);expect(r.stdout.readUInt32LE(40)).toBe(0);
 });
 it('keeps v12 maximum texture sampling within one retained frame',async()=>{const f=frame(),d=f.drawing.commands[0];f.drawing.textures=[{width:1,height:1,pixels:Uint8Array.of(127,63,191,255),anisotropy:'maximum',magFilter:'linear',minFilter:'linear-mipmap-linear',wrap:'clamp',generateMipmaps:true}];d.fragmentShader='in vec3 c;uniform sampler2D image;out vec4 color;void main(){color=vec4(c*texture(image,vec2(.5)).rgb,.25);}';d.uniforms=[{name:'image',kind:'sampler2d',texture:0}];await run(f);});
 it.each(['ordinal','metadata'])('fails the whole frame on changed %s and releases the exact target',async mode=>{const r=await run(frame(),q=>{if(q.operation.kind!=='append'||q.operation.chunk.ordinal!==1)return;if(mode==='ordinal')q.operation.chunk.offset=0;else q.operation.chunk.drawing.commands[0].fragmentShader='out vec4 color;void main(){color=vec4(1);}';});if(!('failed'in r)||!r.s||!r.send||!r.base)throw Error('Expected native failure');const {s,send,base}=r;try{expect(r.failed).toMatchObject({ok:false,error:{kind:'input'}});expect(await send({...base,operation:{kind:'finish',resource,expectedIndex:1}})).toMatchObject({ok:false});expect(await send({...base,operation:{kind:'release',resource,expectedIndex:1}})).toMatchObject({ok:true});expect(s.retainedResourceCount).toBe(0);}finally{await s.close();expect(s.processCount).toBe(0);}});
 it('renders an empty complete background once without needing a fabricated draw',async()=>{const s=await createSourceRendererService(backend),{drawing:_,...base}=frame();try{expect(await s.render(bytes({...base,sequence:1,operation:{kind:'begin',resource,chunkCount:0,maxChunkBytes:1024,metadataBytes:0,schedule:[]}}))).toMatchObject({ok:true});const out=await s.render(bytes({...base,sequence:2,operation:{kind:'finish',resource,expectedIndex:0}}));expect(out).toMatchObject({ok:true});expect(out.value.pixels.length).toBe(64+31*23*4);expect(await s.render(bytes({...base,sequence:3,operation:{kind:'release',resource,expectedIndex:0}}))).toMatchObject({ok:true});}finally{await s.close();expect(s.processCount).toBe(0);}});
});
