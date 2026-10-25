import {beforeAll,describe,expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {FRACTAL_SOURCE_NATIVE_SHADERS} from '../src/engine/fractalSourceNativeProgram';
import {createFractalSourceRasterBindings} from '../src/engine/fractalSourceRasterBindings';
import {createDefaultFractalSourceColorConfiguration,prepareFractalSourceColor} from '../src/engine/fractalSourceColor';
import {parseFractalSourceNativePlan} from '../src/engine/fractalSourcePrecision';
import {createSourceFractalFormulaFromConfig} from '../src/engine/sourceFractalFormulaRuntime';
import {decodeFractalSourceTerminal} from '../src/engine/fractalNativeNewtonRaster';
import type {SourceDrawingUniform} from '../src/engine/sourceDrawingSnapshot';
import {captureSourceFractalNativeResponseBinding,decodeSourceFractalNativeResponse,encodeSourceFractalNativeRequest,type SourceFractalNativeOperation,type SourceFractalNativeRequest,type SourceFractalNativeResponse} from '../src/engine/sourceFractalNativeProtocol';
// @ts-expect-error The Node process owner is separate from browser contracts.
import {createSourceRendererService} from '../server/source-renderer.mjs';

// Real accelerated CGL, production encoder, native owner and process service.
// Production cases use the shared four-MRT program and uniform producer. The
// explicitly diagnostic shader below isolates transport/readback semantics.
// This is not original-app pixel parity, full-image or UI/recording acceptance.
const resourceA='a1'.repeat(16),resourceB='b2'.repeat(16),resourceC='c3'.repeat(16);
const width=17,height=13,iterations=16;
const points=()=>Uint32Array.of(12,9,0,0,12,9,16,12,1,5,8,6,3,5,1,5);
type Sample=Extract<SourceFractalNativeOperation,{kind:'sample'}>;
type Create=Extract<SourceFractalNativeOperation,{kind:'create'}>;
let backend:{executablePath:string;executableSha256:string};
const create=(resource=resourceA):Create=>({kind:'create',resource,shaders:FRACTAL_SOURCE_NATIVE_SHADERS});
const release=(resource=resourceA):SourceFractalNativeOperation=>({kind:'release',resource});
const int=(name:string,value:number):SourceDrawingUniform=>({name,kind:'int',count:1,values:Int32Array.of(value)});

function production(resource=resourceA,expectedIndex=0,w=width,h=height,samples=points(),paletteColors?:string[]):Sample {
 const native=createSourceFractalFormulaFromConfig({formulaId:'mandelbrot',fractalType:'mandelbrot',power:2,formulaParams:[2,0,0,0],bailout:4,julia:[0,0],parameters:{floats:{power:2,bailout:4},complex:{}}}).nativeState();
 const plan=parseFractalSourceNativePlan({formula:'mandelbrot',native,iterations},{centerX:-.5,centerXLow:0,centerY:0,centerYLow:0,zoom:1,rotation:0},{logicalWidth:w,logicalHeight:h,provenance:'requested-output-local'},{precision:'medium'});
 const configuration=createDefaultFractalSourceColorConfiguration();if(paletteColors)configuration.palette.colors=paletteColors;
 const color=prepareFractalSourceColor({configuration,formulaPower:native.power,bailout:native.bailout});
 expect(plan.perturbation.enabled).toBe(false);
 const uniforms=createFractalSourceRasterBindings(plan,{trapCenter:[0,0],trapRadius:.5,trapAspect:1,trapRotation:0,trapShape:'point'},undefined,color);
 return{kind:'sample',resource,expectedIndex,points:samples,reference:new Float32Array(4),palette:color.lut,uniforms};
}

// Diagnostic values come from an actual fragment invocation, including vUv
// interpolation and the bottom-left GL coordinate. No replies are fabricated.
function diagnosticCreate(resource=resourceA,nan=false):Create {
 return{kind:'create',resource,shaders:{vertex:FRACTAL_SOURCE_NATIVE_SHADERS.vertex,fragment:`
in vec2 vUv;
uniform sampler2D u_refOrbitTex;
uniform sampler2D u_gradientTex;
layout(location=0) out vec4 sourceZ;
layout(location=1) out vec4 sourceTerminal;
layout(location=2) out vec4 sourceInside;
layout(location=3) out vec4 sourceOutside;
void main(){
 sourceZ=${nan?'vec4(uintBitsToFloat(0x7fc0f00du),uintBitsToFloat(0x7fc01234u),gl_FragCoord.x,vUv.y)':'vec4(gl_FragCoord.xy,vUv)'};
 sourceTerminal=vec4(0.,0.,1.,2.);
 sourceInside=vec4(165./255.,17./255.,31./255.,1.);
 sourceOutside=vec4(texelFetch(u_refOrbitTex,ivec2(0),0).xy,texelFetch(u_gradientTex,ivec2(0),0).xy);
}`}};
}
function diagnostic(resource=resourceA,expectedIndex=0,samples=points(),gradientSize=0):Sample {
 return{kind:'sample',resource,expectedIndex,points:samples,reference:Float32Array.of(.125,.25,.5,1),palette:Float32Array.of(.375,.75,1),uniforms:[
  {name:'u_refOrbitTex',kind:'sampler2d',texture:2},{name:'u_gradientTex',kind:'sampler2d',texture:1},int('u_iterations',iterations),int('u_refOrbitLen',0),int('u_gradientSize',gradientSize),
 ]};
}
function record(value:SourceFractalNativeResponse,index:number):Buffer {expect(value.records).toBeDefined();return Buffer.from(value.records!.subarray(index*52,(index+1)*52));}
function records(value:SourceFractalNativeResponse):Buffer {expect(value.records).toBeDefined();return Buffer.from(value.records!);}
function floats(bytes:Buffer,offset:number,count=4){return Array.from({length:count},(_,i)=>bytes.readFloatLE(offset+i*4));}
function packet(request:SourceFractalNativeRequest):Buffer {const encoded=encodeSourceFractalNativeRequest(request);if(!encoded.ok)throw Error(encoded.error.reason);return Buffer.from(encoded.value);}
function corruptUniform(bytes:Buffer,name:string,kind:number,write:(bytes:Buffer,offset:number)=>void):Buffer {
 const needle=Buffer.from(name),at=bytes.indexOf(needle);expect(at).toBeGreaterThanOrEqual(4);expect(bytes.readUInt32LE(at-4)).toBe(needle.length);expect(bytes.indexOf(needle,at+1)).toBe(-1);
 const declaration=at+needle.length;expect(bytes.readUInt32LE(declaration)).toBe(kind);write(bytes,declaration+(kind===9?4:12));return bytes;
}
async function owner(){
 const service=await createSourceRendererService({...backend,timeoutMs:15000});let sequence=0;
 return{service,
  async send(operation:SourceFractalNativeOperation,w=operation.kind==='sample'?width:1,h=operation.kind==='sample'?height:1,mutate?:(bytes:Buffer)=>Buffer){
   const input:SourceFractalNativeRequest={generation:1,sequence:++sequence,width:w,height:h,operation},binding=captureSourceFractalNativeResponseBinding(input),bytes=packet(input);
   const result=await service.render(mutate?mutate(bytes):bytes);
   return{result,input,...(result.ok?{decoded:decodeSourceFractalNativeResponse(result.value.pixels,binding)}:{})};
  },
  async draw(operation:SourceFractalNativeOperation,w?:number,h?:number){const response=await this.send(operation,w,h);expect(response.result.ok,JSON.stringify(response.result.error)).toBe(true);expect(response.result.value.format).toBe('fractal-v1');expect(response.result.value.rowOrder).toBe('none');if(operation.kind!=='sample')expect(response.decoded).toMatchObject({draws:0,targetAllocations:0,referenceUploads:0,paletteUploads:0});return{...response,decoded:response.decoded!};},
  async close(){expect(await service.close()).toEqual({ok:true});expect(service.activeCount).toBe(0);expect(service.processCount).toBe(0);expect(service.processObservation).toBeNull();expect(service.retainedResourceCount).toBe(0);}
 };
}

describe.skipIf(process.platform!=='darwin')('real retained Fractal CGL lifecycle',()=>{
 beforeAll(()=>{
  mkdirSync('.cache',{recursive:true});const root=mkdtempSync(resolve('.cache/fractal-lifecycle-')),executablePath=join(root,'renderer');
  const build=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-Werror','-framework','Foundation','-framework','OpenGL','server/render/SourceCglRenderer.m','-o',executablePath],{encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:65536});
  expect(build.error).toBeUndefined();expect(build.status,build.stderr).toBe(0);expect(build.stderr).toBe('');backend={executablePath,executableSha256:createHash('sha256').update(readFileSync(executablePath)).digest('hex')};
 },30000);

 it('returns production MRT records in caller order, preserving duplicate pixels and same-size results',async()=>{
  const o=await owner();try{
   const created=await o.draw(create()),first=await o.draw(production());expect(first.decoded).toMatchObject({committedRequests:1,disposition:'owned',count:8,width,height,draws:5,targetAllocations:1,referenceUploads:1,paletteUploads:1});
   expect(record(first.decoded,0)).toEqual(record(first.decoded,2));expect(record(first.decoded,4)).toEqual(record(first.decoded,7));
   const unique=Uint32Array.of(0,0,1,5,3,5,8,6,12,9,16,12),ordered=await o.draw(production(resourceA,1,width,height,unique));
   for(const [i,j]of [[0,4],[1,0],[2,4],[3,5],[4,1],[5,3],[6,2],[7,1]])expect(record(first.decoded,i)).toEqual(record(ordered.decoded,j));
   const same=await o.draw(production(resourceA,2));expect(records(same.decoded)).toEqual(records(first.decoded));expect(same.decoded).toMatchObject({committedRequests:3,draws:5,targetAllocations:0,referenceUploads:1,paletteUploads:1});
   let escaped=0,ordinary=0;
   for(let i=0;i<first.decoded.count;i++){const bytes=record(first.decoded,i),facts=decodeFractalSourceTerminal(bytes.readFloatLE(16),bytes.readFloatLE(20),iterations);escaped+=Number(facts.escaped);ordinary+=facts.ordinarySteps;expect(facts.startedPerturb).toBe(false);expect(floats(bytes,0).every(Number.isFinite)).toBe(true);expect(bytes[35]).toBe(255);}
   expect(escaped).toBeGreaterThan(0);expect(ordinary).toBeGreaterThan(0);
   // The production producer omits u_palette for zero colors, then uploads
   // only the six or two supplied colors. Native must preserve these setters.
   const empty=await o.draw(production(resourceA,3,width,height,points(),[])),six=await o.draw(production(resourceA,4)),short=await o.draw(production(resourceA,5,width,height,points(),['#123456','#abcdef']));
   expect(records(six.decoded)).toEqual(records(first.decoded));expect(short.decoded.committedRequests).toBe(6);for(let i=0;i<first.decoded.count;i++)expect(record(empty.decoded,i).subarray(0,32)).toEqual(record(first.decoded,i).subarray(0,32));
   expect(same.result.value.contextSerial).toBe(created.result.value.contextSerial);expect(o.service.sessionStarts).toBe(1);expect(o.service.retainedResourceCount).toBe(1);
  }finally{await o.close();}
 },30000);

 it('preserves omitted and short production-array setters while rejecting typed profile overflow',async()=>{
  const program=diagnosticCreate();program.shaders={...program.shaders,fragment:program.shaders.fragment.replace('in vec2 vUv;','in vec2 vUv;\nuniform vec3 u_palette[16];\nuniform float u_dynamicParams[32];\nuniform int u_paletteSize;').replace('sourceOutside=vec4(texelFetch(u_refOrbitTex,ivec2(0),0).xy,texelFetch(u_gradientTex,ivec2(0),0).xy);','sourceOutside=vec4(u_palette[5].x,u_palette[0].x,u_dynamicParams[23],float(u_paletteSize));')};
  const sample=(index:number,size:number):Sample=>{const operation=diagnostic(resourceA,index),palette=Float32Array.from({length:size*3},(_,i)=>i%3===0?1+i/3:0);return{...operation,uniforms:[...operation.uniforms,int('u_paletteSize',size),...(size?[{name:'u_palette',kind:'vec3-array' as const,count:size,values:palette}]:[]),{name:'u_dynamicParams',kind:'float-array',count:32,values:Float32Array.from({length:32},(_,i)=>i)}]};};
  const o=await owner();try{
   await o.draw(program);expect(floats(record((await o.draw(sample(0,0))).decoded,0),36)).toEqual([0,0,23,0]);
   expect(floats(record((await o.draw(sample(1,6))).decoded,0),36)).toEqual([6,1,23,6]);
   const short=sample(2,2),palette=short.uniforms.find(u=>u.name==='u_palette')!;if(palette.kind!=='vec3-array')throw Error('fixture');palette.values[0]=9;
   expect(floats(record((await o.draw(short)).decoded,0),36)).toEqual([6,9,23,2]);
   expect(floats(record((await o.draw(sample(3,0))).decoded,0),36)).toEqual([6,9,23,0]);expect(o.service.sessionStarts).toBe(1);
  }finally{await o.close();}
  for(const [name,size,kind]of [['u_palette',17,'vec3-array'],['u_dynamicParams',33,'float-array']] as const){
   const invalid=await owner();try{
    await invalid.draw(program);const operation=sample(0,16),components=kind==='vec3-array'?3:1;
    const rejected=await invalid.send(operation,width,height,bytes=>{
     // Cross the native parser with a complete oversized block; the public
     // encoder independently rejects these source-profile counts earlier.
     const encodedName=Buffer.alloc(4+name.length);encodedName.writeUInt32LE(name.length,0);encodedName.write(name,4);const at=bytes.indexOf(encodedName);expect(at).toBeGreaterThanOrEqual(96);expect(bytes.indexOf(encodedName,at+1)).toBe(-1);
     const declaration=at+encodedName.length,oldBytes=bytes.readUInt32LE(declaration+8),end=declaration+12+oldBytes;
     expect(bytes.readUInt32LE(declaration+4)).toBe(size-1);const raw=Buffer.concat([bytes.subarray(0,end),Buffer.alloc(components*4),bytes.subarray(end)]);
     raw.writeUInt32LE(raw.length,8);raw.writeUInt32LE(size,declaration+4);raw.writeUInt32LE(oldBytes+components*4,declaration+8);return raw;
    });
    expect(rejected.result).toMatchObject({ok:false,error:{kind:'input',message:'Fractal source array exceeds typed profile bounds'}});expect(invalid.service.retainedResourceCount).toBe(1);expect(invalid.service.processCount).toBe(1);expect((await invalid.draw(sample(0,6))).decoded.committedRequests).toBe(1);
   }finally{await invalid.close();}
  }
 },30000);

 it('resizes a production owner and keeps two resources independent through idempotent releases',async()=>{
  const o=await owner();try{
   await o.draw(create());await o.draw(create(resourceB));const initial=await o.draw(production()),other=await o.draw(production(resourceB));expect(records(initial.decoded)).toEqual(records(other.decoded));
   const w=23,h=19,resized=await o.draw(production(resourceA,1,w,h),w,h),fresh=await o.draw(production(resourceB,1,w,h),w,h);
   expect(resized.decoded).toMatchObject({width:w,height:h,committedRequests:2,targetAllocations:1,draws:5});expect(records(resized.decoded)).toEqual(records(fresh.decoded));
   const restored=await o.draw(production(resourceA,2));expect(records(restored.decoded)).toEqual(records(initial.decoded));expect(restored.decoded.targetAllocations).toBe(1);expect(restored.result.value.contextSerial).toBe(initial.result.value.contextSerial);
   expect((await o.send(create(resourceC))).result).toMatchObject({ok:false,error:{kind:'capacity',message:'Two Fractal resources are already owned or token is duplicate'}});expect(o.service.retainedResourceCount).toBe(2);
   expect((await o.draw(release(resourceC))).decoded).toMatchObject({disposition:'absent',committedRequests:0});expect((await o.draw(release())).decoded).toMatchObject({disposition:'released',committedRequests:3});
   expect((await o.draw(release())).decoded).toMatchObject({disposition:'absent',committedRequests:0});expect(o.service.retainedResourceCount).toBe(1);
   expect((await o.send(production(resourceA,3))).result).toMatchObject({ok:false,error:{kind:'state-lost'}});
   expect(records((await o.draw(production(resourceB,2,w,h),w,h)).decoded)).toEqual(records(fresh.decoded));
   await o.draw(create(resourceC));expect(o.service.retainedResourceCount).toBe(2);await o.draw(release(resourceB));await o.draw(release(resourceC));expect(o.service.retainedResourceCount).toBe(0);expect(o.service.sessionStarts).toBe(1);
  }finally{await o.close();}
 },30000);

 it('rejects native stale checkpoints and corrupted bindings without committing or losing either owner',async()=>{
  const o=await owner();try{
   await o.draw(diagnosticCreate());await o.draw(diagnosticCreate(resourceB));const first=await o.draw(diagnostic());
   for(const index of [0,2])expect((await o.send(diagnostic(resourceA,index))).result).toMatchObject({ok:false,error:{kind:'input',message:'Fractal sample checkpoint mismatch'}});
   const malformed:[string,number,number][]=[['u_refOrbitTex',9,1],['u_gradientTex',9,2],['u_iterations',2,0],['u_iterations',2,2049],['u_refOrbitLen',2,2],['u_gradientSize',2,1],['u_paletteSize',2,17],['u_paletteSize',2,0xffffffff]];
   for(const [name,kind,value]of malformed){const operation=diagnostic(resourceA,1);if(name==='u_paletteSize')operation.uniforms=[...operation.uniforms,int(name,0)];const rejected=await o.send(operation,width,height,b=>corruptUniform(b,name,kind,(data,at)=>data.writeUInt32LE(value,at)));expect(rejected.result).toMatchObject({ok:false,error:{kind:'input'}});expect(rejected.result.error.message).toMatch(/^Fractal /);}
   const wrongPaletteType=diagnostic(resourceA,1);wrongPaletteType.uniforms=[...wrongPaletteType.uniforms,int('u_paletteSize',0)];
   expect((await o.send(wrongPaletteType,width,height,b=>corruptUniform(b,'u_paletteSize',2,(data,at)=>data.writeUInt32LE(1,at-12)))).result).toMatchObject({ok:false,error:{kind:'input',message:'Fractal palette size must be int 0..16'}});
   const next=await o.draw(diagnostic(resourceA,1,points(),1024));expect(next.decoded.committedRequests).toBe(2);expect(records(next.decoded)).toEqual(records(first.decoded));
   expect(records((await o.draw(diagnostic(resourceB))).decoded)).toEqual(records(first.decoded));expect(o.service.retainedResourceCount).toBe(2);expect(next.result.value.contextSerial).toBe(first.result.value.contextSerial);expect(o.service.sessionStarts).toBe(1);
  }finally{await o.close();}
 },30000);

 it('rejects native target growth including old plus new storage before any checkpoint change',async()=>{
  const o=await owner();try{
   await o.draw(diagnosticCreate());const small=await o.draw(diagnostic());
   // Raw changes pass service header admission but exceed the native 52 B/pixel
   // budget. This reaches the CGL owner, not the TypeScript budget validator.
   const exceed=await o.send(diagnostic(resourceA,1),width,height,b=>{b.writeUInt32LE(3000,20);b.writeUInt32LE(2000,24);return b;});
   expect(exceed.result).toMatchObject({ok:false,error:{kind:'capacity',message:'Fractal targets, request copies and bounded samples exceed shared budget'}});
   expect(records((await o.draw(diagnostic(resourceA,1))).decoded)).toEqual(records(small.decoded));
   const large=await o.draw(diagnostic(resourceA,2),1600,1600),same=await o.draw(diagnostic(resourceA,3),1600,1600);expect(records(same.decoded)).toEqual(records(large.decoded));
   // Each target fits separately; old 1600² plus new 1700² exceeds 256 MiB.
   const growth=await o.send(diagnostic(resourceA,4),width,height,b=>{b.writeUInt32LE(1700,20);b.writeUInt32LE(1700,24);return b;});
   expect(growth.result).toMatchObject({ok:false,error:{kind:'capacity',message:'Fractal targets, request copies and bounded samples exceed shared budget'}});
   const retained=await o.draw(diagnostic(resourceA,4),1600,1600);expect(records(retained.decoded)).toEqual(records(large.decoded));expect(retained.decoded).toMatchObject({committedRequests:5,targetAllocations:0,draws:5});expect(retained.result.value.contextSerial).toBe(small.result.value.contextSerial);expect(o.service.retainedResourceCount).toBe(1);
  }finally{await o.close();}
 },30000);

 it('reads real interpolated coordinates, fixed texture units and legal sentinel NaNs without repairing them',async()=>{
  const o=await owner();try{
   await o.draw(diagnosticCreate());const actual=await o.draw(diagnostic());
   const input=points();for(let i=0;i<actual.decoded.count;i++){
    const bytes=record(actual.decoded,i),x=input[2*i],y=input[2*i+1];expect(bytes.readFloatLE(0)).toBe(x+.5);expect(bytes.readFloatLE(4)).toBe(height-y-.5);expect(bytes.readFloatLE(8)).toBeCloseTo((x+.5)/width,6);expect(bytes.readFloatLE(12)).toBeCloseTo((y+.5)/height,6);
    expect(floats(bytes,16)).toEqual([0,0,1,2]);expect([...bytes.subarray(32,36)]).toEqual([165,17,31,255]);expect(floats(bytes,36)).toEqual([.125,.25,.375,.75]);
   }
   await o.draw(release());await o.draw(diagnosticCreate(resourceA,true));const nonfinite=await o.draw(diagnostic());
   for(let i=0;i<nonfinite.decoded.count;i++){const bytes=record(nonfinite.decoded,i);expect(Number.isNaN(bytes.readFloatLE(0))).toBe(true);expect(Number.isNaN(bytes.readFloatLE(4))).toBe(true);expect(bytes.readUInt32LE(0)).toBe(0x7fc0f00d);expect(bytes.readUInt32LE(4)).toBe(0x7fc01234);expect(floats(bytes,16).every(Number.isFinite)).toBe(true);expect([...bytes.subarray(32,36)]).toEqual([165,17,31,255]);}
   expect(record(nonfinite.decoded,0)).toEqual(record(nonfinite.decoded,2));expect(nonfinite.decoded.committedRequests).toBe(1);expect(o.service.sessionStarts).toBe(1);
  }finally{await o.close();}
 },30000);

 it('confirms native process retirement after real shader compilation fails and recovers a new session',async()=>{
  const o=await owner();try{
   const first=await o.draw(create());await o.draw(production());
   const bad=diagnosticCreate(resourceB);bad.shaders={...bad.shaders,fragment:bad.shaders.fragment+'\nthis is intentionally invalid GLSL;\n'};
   const failed=await o.send(bad);expect(failed.result).toMatchObject({ok:false,error:{kind:'runtime'}});expect(failed.result.error.message).toMatch(/ERROR|error|syntax/i);
   expect(o.service.processCount).toBe(0);expect(o.service.processObservation).toBeNull();expect(o.service.retainedResourceCount).toBe(0);expect(o.service.activeCount).toBe(0);
   expect((await o.send(production(resourceA,1))).result).toMatchObject({ok:false,error:{kind:'state-lost'}});expect((await o.draw(release())).decoded.disposition).toBe('absent');expect((await o.draw(release(resourceB))).decoded.disposition).toBe('absent');
   const fresh=await o.draw(create()),sample=await o.draw(production());expect(fresh.result.value.sessionSerial).toBeGreaterThan(first.result.value.sessionSerial);expect(sample.decoded.committedRequests).toBe(1);expect(o.service.sessionStarts).toBe(2);expect(o.service.retainedResourceCount).toBe(1);
  }finally{await o.close();}
 },30000);

 it('makes both resources state-lost only after explicit session reset confirms child exit',async()=>{
  const o=await owner();try{
   const first=await o.draw(diagnosticCreate());await o.draw(diagnosticCreate(resourceB));await o.draw(diagnostic());await o.draw(diagnostic(resourceB));
   expect(await o.service.reset()).toEqual({ok:true});expect(o.service.processCount).toBe(0);expect(o.service.processObservation).toBeNull();expect(o.service.retainedResourceCount).toBe(0);
   for(const resource of [resourceA,resourceB])expect((await o.send(diagnostic(resource,1))).result).toMatchObject({ok:false,error:{kind:'state-lost'}});
   const fresh=await o.draw(diagnosticCreate()),sample=await o.draw(diagnostic());expect(fresh.result.value.sessionSerial).toBeGreaterThan(first.result.value.sessionSerial);expect(sample.decoded.committedRequests).toBe(1);expect(o.service.sessionStarts).toBe(2);
  }finally{await o.close();}
 },30000);
});
