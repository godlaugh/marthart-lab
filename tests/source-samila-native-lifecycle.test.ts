import {beforeAll,describe,expect,it,vi} from 'vitest';
import {ChildProcess,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {SourceSamilaSession} from '../src/engine/sourceSamilaSession';
import {prepareSourceSamilaNativeCreate,prepareSourceSamilaNativeDisplay} from '../src/engine/sourceSamilaNativeProgram';
import {encodeSourceSamilaNativeRequest,decodeSourceSamilaNativeResponse,SOURCE_SAMILA_NATIVE_STATISTICS_BYTES,SOURCE_SAMILA_NATIVE_STATISTICS_PROGRAM_BYTES,SOURCE_SAMILA_NATIVE_STATISTICS_READBACK_BYTES,type SourceSamilaNativeOperation,type SourceSamilaNativeRequest,type SourceSamilaNativeResponse} from '../src/engine/sourceSamilaNativeProtocol';
import {encodeSourceDrawingFrame,type SourceDrawingFrame} from '../src/engine/sourceDrawingFrame';
// @ts-expect-error The Node process owner is separate from the browser contracts.
import {createSourceRendererService} from '../server/source-renderer.mjs';

// Real accelerated CGL + production producer/encoder/service boundary. Lifecycle
// cases use production shaders and fixed seeds; dedicated boundary cases below
// supply diagnostic shader outputs. No pixels or native replies are fabricated.
// These are lifecycle/statistics checks, not original-app parity.
const resourceA='a1'.repeat(16),resourceB='b2'.repeat(16),resourceC='c3'.repeat(16);
const width=64,height=48,seeds=[0x80000001,0xfedcba98];
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
let backend:{executablePath:string;executableSha256:string};
function prepared(seed:number,w=width,h=height,batchSize=2048){
 const scene=parseLegacyScene(JSON.stringify({config_version:'1.0.0',type:'SAMILA',name:'Native retained lifecycle',settings:{batch_size:batchSize},equations:{f1:'sin(x*y)',f2:'cos(x-y)'},timeline:[{type:'wait',duration:1}]})).scene;
 const owner=new SourceSamilaSession({samilaSeedProvider:()=>seed});
 try{const token=owner.begin(scene,{width:w,height:h,time:0,quality:'preview',samilaPrimaryPixelHeight:972,samilaLive:{sessionId:'native-lifecycle',pixelDensity:1}});return owner.prepareDisplay(token);}finally{owner.reset();}
}
function create(resource=resourceA){return prepareSourceSamilaNativeCreate(prepared(seeds[0]).job,resource);}
function display(resource=resourceA,index=0,seed=seeds[0],clear=index===0,w=width,h=height,batchSize=2048){
 const p=prepared(seed,w,h,batchSize);return prepareSourceSamilaNativeDisplay(p.job,p.tone,p.view,{width:w,height:h,clearInk:clear,resource,expectedIndex:index,paletteChanged:false});
}
// Exercise the native shader-output boundary independently of the mathematical
// sampler. Only its statistics output is replaced; the actual CGL draw and
// production request/service/response path still run. This is not source parity.
function statisticsCreate(expression:string){
 const op=create(),vertex=op.shaders.sampleVertex;
 expect(vertex.match(/void main\(\)\s*\{/g)).toHaveLength(1);
 return{...op,shaders:{...op.shaders,sampleVertex:vertex.replace(/void main\(\)\s*\{/, 'void originalSampleMain(){')+`\nvoid main(){originalSampleMain();sourceStats=${expression};}\n`}};
}
const release=(resource=resourceA):SourceSamilaNativeOperation=>({kind:'release',resource});
const blank=():SourceDrawingFrame=>({generation:1,sequence:1,width:7,height:5,samples:0,clear:[.25,.5,.75,1],drawing:{model:'source-drawing-v1',commands:[],textures:[],admittedBytes:0,copiedBufferBytes:0,retainedBufferBytes:0}});
function packet(request:SourceSamilaNativeRequest):Buffer{const encoded=encodeSourceSamilaNativeRequest(request);if(!encoded.ok)throw Error(encoded.error.reason);return Buffer.from(encoded.value);}
function image(value:SourceSamilaNativeResponse){expect(value.pixels).toBeDefined();return{pixels:Buffer.from(value.pixels!),steps:value.steps,accepted:value.accepted,clipped:value.clipped,invalid:value.invalid,occupiedPixels:value.occupiedPixels,maxCount:value.maxCount,invalidInkPixels:value.invalidInkPixels};}
// A malformed caller must reach native validation, not merely be rejected by
// the production encoder. Locate a named field in a valid display packet and
// alter only its raw value. This helper supplies no rendering implementation.
function corruptUniform(bytes:Buffer,name:string,kind:number,write:(bytes:Buffer,offset:number)=>void){
 const needle=Buffer.from(name),at=bytes.indexOf(needle);expect(at).toBeGreaterThanOrEqual(4);expect(bytes.readUInt32LE(at-4)).toBe(needle.length);expect(bytes.indexOf(needle,at+1)).toBe(-1);const declaration=at+needle.length;expect(bytes.readUInt32LE(declaration)).toBe(kind);expect(bytes.readUInt32LE(declaration+4)).toBe(1);write(bytes,declaration+12);return bytes;
}
async function owner(){
 const service=await createSourceRendererService({...backend,timeoutMs:15000});let sequence=0;
 const request=(operation:SourceSamilaNativeOperation,w=['display','step','present'].includes(operation.kind)?width:1,h=['display','step','present'].includes(operation.kind)?height:1):SourceSamilaNativeRequest=>({generation:1,sequence:++sequence,width:w,height:h,operation});
 return{service,
  async send(operation:SourceSamilaNativeOperation,w?:number,h?:number,options:{signal?:AbortSignal;mutate?:(bytes:Buffer)=>Buffer}={}){const input=request(operation,w,h),bytes=packet(input),result=await service.render(options.mutate?options.mutate(bytes):bytes,{signal:options.signal});return{result,input,...(result.ok?{decoded:decodeSourceSamilaNativeResponse(result.value.pixels,input)}:{})};},
  async draw(operation:SourceSamilaNativeOperation,w?:number,h?:number){const response=await this.send(operation,w,h);expect(response.result.ok,JSON.stringify(response.result.error)).toBe(true);return{...response,decoded:response.decoded!};},
  async generic(){const frame={...blank(),sequence:++sequence},encoded=encodeSourceDrawingFrame(frame);if(!encoded.ok)throw Error(encoded.error.reason);expect(new DataView(encoded.value.buffer).getUint32(4,true)).toBe(3);const result=await service.render(encoded.value);expect(result.ok,JSON.stringify(result.error)).toBe(true);expect(result.value.pixels.length).toBe(frame.width*frame.height*4);},
  async close(){expect(await service.close()).toEqual({ok:true});expect(service.processCount).toBe(0);expect(service.retainedResourceCount).toBe(0);}
 };
}
async function reference(frameSeeds=seeds,w=width,h=height){const o=await owner();try{await o.draw(create());const values=[];for(let i=0;i<frameSeeds.length;i++)values.push(image((await o.draw(display(resourceA,i,frameSeeds[i],i===0,w,h),w,h)).decoded));return values;}finally{await o.close();}}

describe.skipIf(process.platform!=='darwin')('real retained Samila CGL lifecycle',()=>{
 beforeAll(()=>{mkdirSync('.cache',{recursive:true});const root=mkdtempSync(resolve('.cache/samila-lifecycle-')),executablePath=join(root,'renderer');const build=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-framework','Foundation','-framework','OpenGL','server/render/SourceCglRenderer.m','-o',executablePath],{encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:65536});expect(build.error).toBeUndefined();expect(build.status,build.stderr).toBe(0);expect(build.stderr).toBe('');backend={executablePath,executableSha256:createHash('sha256').update(readFileSync(executablePath)).digest('hex')};},30000);

 it('charges the actual native statistics owner in the browser admission contract',()=>{
  const root=mkdtempSync(resolve('.cache/samila-accounting-')),source=join(root,'accounting.m'),binary=join(root,'accounting');
  // Read the actual C/GLSL producer's values, including encoded shader lengths;
  // a second TypeScript formula would not detect cross-language contract drift.
  writeFileSync(source,'#import <Foundation/Foundation.h>\n#include <stdio.h>\n#include "SourceCglSamilaStatistics.h"\nint main(void){@autoreleasepool{printf("%llu %llu %llu\\n",(unsigned long long)SamilaStatsStorageBytes,(unsigned long long)samilaStatsProgramBytes(),(unsigned long long)SamilaStatsReadbackBytes);}return 0;}\n');
  const build=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-O2','-framework','Foundation','-I',resolve('server/render'),source,'-o',binary],{encoding:'utf8',timeout:30000});expect(build.error).toBeUndefined();expect(build.status,build.stderr).toBe(0);
  const run=spawnSync(binary,[],{encoding:'utf8',timeout:10000});expect(run.error).toBeUndefined();expect(run.status,run.stderr).toBe(0);
  expect(run.stdout.trim().split(' ').map(Number)).toEqual([SOURCE_SAMILA_NATIVE_STATISTICS_BYTES,SOURCE_SAMILA_NATIVE_STATISTICS_PROGRAM_BYTES,SOURCE_SAMILA_NATIVE_STATISTICS_READBACK_BYTES]);
 },30000);

 it('counts every tuple across partial chunks without reusing unwritten tails or prior summaries',async()=>{
  const o=await owner();try{
   await o.draw(statisticsCreate('gl_VertexID%3==0?uvec4(1u,0u,0u,0u):gl_VertexID%3==1?uvec4(0u,0u,1u,0u):uvec4(0u,0u,0u,1u)'));
   // Shrinking after multiple chunks detects both TF padding and stale summary
   // pixels. A one-sample final chunk must still contribute exactly one tuple.
   const counts=[131065,1,65531,65532,65533,2];
   for(let index=0;index<counts.length;index++){
    const count=counts[index],op=display(resourceA,index,seeds[0],true,width,height,count),result=(await o.draw({...op,kind:'step'})).decoded;
    expect(result).toMatchObject({steps:count,invalid:Math.ceil(count/3),accepted:Math.floor((count+1)/3),clipped:Math.floor(count/3),committedDisplays:index+1});
    expect(result).not.toHaveProperty('pixels');
   }
   await o.draw(release());expect(o.service.retainedResourceCount).toBe(0);
  }finally{await o.close();}
 },30000);

 it('rejects malformed individual tuples even when aggregated counters could appear valid',async()=>{
  const invalid=['uvec4(0u)','uvec4(2u,0u,0u,0u)','uvec4(0u,1u,1u,0u)','uvec4(1u,0u,1u,0u)','uvec4(0xffffffffu,0u,2u,0u)'];
  for(const value of invalid){
   const o=await owner();try{
    const first=await o.draw(statisticsCreate(`gl_VertexID==65532?${value}:uvec4(0u,0u,1u,0u)`));
    const result=await o.send({...display(resourceA,0,seeds[0],true,width,height,65533),kind:'step'});
    expect(result.result).toMatchObject({ok:false,error:{kind:'runtime',message:'Invalid Samila per-sample statistics'}});
    // A runtime error is acknowledged only after the native dispatcher disposes
    // every owner and destroys that context. The gateway then clears its registry.
    expect(o.service.retainedResourceCount).toBe(0);
    expect((await o.send(display())).result).toMatchObject({ok:false,error:{kind:'state-lost'}});
    expect((await o.draw(release())).decoded.disposition).toBe('absent');
    const fresh=await o.draw(create());expect(fresh.result.value.contextSerial).toBeGreaterThan(first.result.value.contextSerial);
    expect((await o.draw(display())).decoded.committedDisplays).toBe(1);await o.draw(release());
   }finally{await o.close();}
  }
 },30000);

 it('keeps two alternating resources independent across generic v3 frames and dimensions',async()=>{
  const expected=await reference(),otherSeeds=[0x12345678,0x10203040],other=await reference(otherSeeds),o=await owner();
  try{const a=await o.draw(create()),b=await o.draw(create(resourceB));expect(a.result.value.contextSerial).toBe(b.result.value.contextSerial);expect(o.service.retainedResourceCount).toBe(2);
   expect(image((await o.draw(display())).decoded)).toEqual(expected[0]);expect(image((await o.draw(display(resourceB,0,otherSeeds[0]))).decoded)).toEqual(other[0]);
   await o.generic();expect(image((await o.draw(display(resourceA,1,seeds[1]))).decoded)).toEqual(expected[1]);await o.generic();expect(image((await o.draw(display(resourceB,1,otherSeeds[1]))).decoded)).toEqual(other[1]);
   expect(expected[0].occupiedPixels).toBeGreaterThan(0);expect(expected[0].maxCount).toBeGreaterThan(0);expect(o.service.sessionStarts).toBe(1);expect(o.service.processCount).toBe(1);
  }finally{await o.close();}
 },30000);

 it('separates accumulation from read-only presentation without changing the full image or either history',async()=>{
  const expected=await reference(),o=await owner();try{
   await o.draw(create());await o.draw(create(resourceB));await o.draw(display(resourceB));
   for(let i=0;i<seeds.length;i++){
    const op=display(resourceA,i,seeds[i]),stepped=(await o.draw({...op,kind:'step'})).decoded;
    expect(stepped).not.toHaveProperty('pixels');expect(stepped.committedDisplays).toBe(i+1);expect(stepped.steps).toBe(expected[i].steps);expect(stepped.accepted).toBe(expected[i].accepted);
    const present:SourceSamilaNativeOperation={kind:'present',resource:resourceA,expectedIndex:i+1,present:op.present};
    const shown=(await o.draw(present)).decoded,again=(await o.draw(present)).decoded;expect(shown.committedDisplays).toBe(i+1);expect(shown.steps).toBe(0);expect(again).toEqual(shown);
    expect(Buffer.from(shown.pixels!)).toEqual(expected[i].pixels);expect(shown.occupiedPixels).toBe(expected[i].occupiedPixels);expect(shown.maxCount).toBe(expected[i].maxCount);
    expect((await o.send({...present,expectedIndex:i})).result).toMatchObject({ok:false,error:{kind:'input'}});
   }
   await o.draw(release());expect(image((await o.draw(display(resourceB,1,seeds[1]))).decoded)).toEqual(expected[1]);expect(o.service.sessionStarts).toBe(1);
  }finally{await o.close();}
 },30000);

 it('rejects checkpoints, resize, fixed bindings, third resource and capacity before ink mutation',async()=>{
  const expected=(await reference())[1],o=await owner();try{await o.draw(create());await o.draw(create(resourceB));const first=await o.draw(display());expect(image((await o.draw(display(resourceB))).decoded)).toEqual(image(first.decoded));
   const reject=async(operation:SourceSamilaNativeOperation,kind:string,w?:number,h?:number,mutate?:(bytes:Buffer)=>Buffer)=>{expect((await o.send(operation,w,h,{mutate})).result).toMatchObject({ok:false,error:{kind}});expect(o.service.processCount).toBe(1);expect(o.service.retainedResourceCount).toBe(2);};
   await reject(display(resourceA,0),'input');await reject(display(resourceA,2),'input');await reject(display(resourceA,1,seeds[1],false,73,51),'input',73,51);await reject(create(resourceC),'capacity');
   for(const [name,kind,value]of [['u_frameSeed',2,7],['u_particleCount',2,1],['u_quadSplat',11,1],['origin',4,1],['viewportAspect',1,2],['densityCeiling',1,301]] as const){await reject(display(resourceA,1,seeds[1]),'input',width,height,b=>corruptUniform(b,name,kind,(v,at)=>kind===1?v.writeFloatLE(value,at):v.writeUInt32LE(value,at)));}
   await reject(display(resourceA,1,seeds[1]),'capacity',width,height,b=>corruptUniform(b,'radius',1,(v,at)=>v.writeFloatLE(20000,at)));
   // Keep packet and sample size small while asking native for target storage
   // over its shared budget. The valid encoder is not bypassed by an allocation.
   await reject(display(resourceA,1,seeds[1],true),'capacity',width,height,b=>{b.writeUInt32LE(2000,20);b.writeUInt32LE(2000,24);corruptUniform(b,'u_viewportSize',3,(v,at)=>{v.writeFloatLE(2000,at);v.writeFloatLE(2000,at+4);});corruptUniform(b,'u_aspectRatio',1,(v,at)=>v.writeFloatLE(1,at));return corruptUniform(b,'viewportAspect',1,(v,at)=>v.writeFloatLE(1,at));});
   const after=await o.draw(display(resourceA,1,seeds[1])),untouched=await o.draw(display(resourceB,1,seeds[1]));expect(image(after.decoded)).toEqual(expected);expect(image(untouched.decoded)).toEqual(expected);expect(after.decoded.committedDisplays).toBe(2);expect(after.result.value.contextSerial).toBe(first.result.value.contextSerial);expect(o.service.sessionStarts).toBe(1);
  }finally{await o.close();}
 },30000);

 it('resizes only with clear while retaining its checkpoint and releases exact resources idempotently',async()=>{
  const w=73,h=51,expected=(await reference([seeds[1]],w,h))[0],continuation=(await reference())[1],o=await owner();
  try{await o.draw(create());await o.draw(create(resourceB));const first=await o.draw(display());await o.draw(display(resourceB));const resized=await o.draw(display(resourceA,1,seeds[1],true,w,h),w,h);expect(image(resized.decoded)).toEqual(expected);expect(resized.decoded.committedDisplays).toBe(2);expect(resized.result.value.contextSerial).toBe(first.result.value.contextSerial);
   expect((await o.draw(release(resourceC))).decoded).toMatchObject({disposition:'absent',committedDisplays:0});expect(o.service.retainedResourceCount).toBe(2);expect((await o.draw(release())).decoded).toMatchObject({disposition:'released',committedDisplays:2});expect(o.service.retainedResourceCount).toBe(1);expect((await o.draw(release())).decoded).toMatchObject({disposition:'absent',committedDisplays:0});
   expect((await o.send(display(resourceA,2))).result).toMatchObject({ok:false,error:{kind:'state-lost'}});expect(image((await o.draw(display(resourceB,1,seeds[1]))).decoded)).toEqual(continuation);expect(o.service.retainedResourceCount).toBe(1);expect((await o.draw(release(resourceB))).decoded.disposition).toBe('released');expect(o.service.retainedResourceCount).toBe(0);
  }finally{await o.close();}
 },30000);

 it('cancels a real child after display output exists and leaves both resources lost until explicit create',async()=>{
  let child:ChildProcess|undefined;const prototype=ChildProcess.prototype as unknown as {spawn:(options:{file?:string})=>unknown},spawn=prototype.spawn;
  const observe=vi.spyOn(prototype,'spawn').mockImplementation(function(this:ChildProcess,options){const result=spawn.call(this,options);if(options.file===backend.executablePath)child=this;return result;});
  const o=await owner();try{await o.draw(create());await o.draw(create(resourceB));await o.draw(display());await o.draw(display(resourceB));expect(child?.stdout).toBeDefined();observe.mockRestore();const oldChild=child!;oldChild.stdout!.pause();
   const controller=new AbortController(),pending=o.send(display(resourceA,1,seeds[1]),width,height,{signal:controller.signal});let produced=false;
   try{for(let i=0;i<1000;i++){if(oldChild.stdout!.readableLength>0){produced=true;break;}await delay(5);}expect(produced,'the actual CGL child must produce response bytes before cancellation').toBe(true);}finally{controller.abort();oldChild.stdout!.resume();}
   expect((await pending).result).toMatchObject({ok:false,error:{kind:'cancelled'}});expect(o.service.processCount).toBe(0);expect(o.service.retainedResourceCount).toBe(0);
   expect((await o.send(display(resourceB,1,seeds[1]))).result).toMatchObject({ok:false,error:{kind:'state-lost'}});expect((await o.send(display(resourceA,1,seeds[1]))).result).toMatchObject({ok:false,error:{kind:'state-lost'}});expect(o.service.retainedResourceCount).toBe(0);expect(o.service.sessionStarts).toBe(2);
   await o.draw(create(resourceC));const fresh=await o.draw(display(resourceC));expect(fresh.decoded.committedDisplays).toBe(1);expect(fresh.result.value.sessionSerial).toBe(2);
  }finally{child?.stdout?.resume();observe.mockRestore();await o.close();}
 },30000);
});
