import {beforeAll,describe,expect,it} from 'vitest';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {encodeSourceDrawingFrame,type SourceDrawingFrame} from '../src/engine/sourceDrawingFrame';
import {encodeSourceNativeDrawingRequest,type SourceNativeDrawingRequest} from '../src/engine/sourceDrawingNativeProtocol';
import {parseSourceDrawingViewport,type SourceDrawingViewport} from '../src/engine/sourceDrawingViewport';
import {sourceDrawingChunkPeak} from '../src/engine/sourceDrawingBudget';
// @ts-expect-error The service is an independently validated Node boundary.
import {inspectSourceFrameHeader} from '../server/source-renderer.mjs';

const resource='ab'.repeat(16);
function frame(viewport?:SourceDrawingViewport):SourceDrawingFrame{return{generation:1,sequence:2,width:2,height:3,samples:0,clear:[0,0,0,1],viewport,drawing:{model:'source-drawing-v1',admittedBytes:2000,copiedBufferBytes:36,retainedBufferBytes:36,textures:[],commands:[{primitive:'triangles',vertexShader:'in vec3 position;void main(){gl_Position=vec4(position,1);}',fragmentShader:'out vec4 color;void main(){color=vec4(1);}',first:0,count:3,instances:1,attributes:[{name:'position',size:3,divisor:0,values:new Float32Array(9)}],uniforms:[],depthTest:false,depthWrite:false,depthFunction:'less-equal',frontFace:'counter-clockwise',passes:['both'],blend:'source-alpha-over-additive-alpha'}]}};}
function begin(viewport?:SourceDrawingViewport):SourceNativeDrawingRequest{const {drawing:_,...base}=frame(viewport);return{...base,operation:{kind:'begin',resource,chunkCount:1,maxChunkBytes:4096,metadataBytes:4096,schedule:[{commandIndex:0,primitive:'triangles',rangeKind:'vertices',total:3,passes:['both'],chunksPerPass:1,rangeSize:3}]}};}
function encode(input:SourceDrawingFrame|SourceNativeDrawingRequest){const r='operation'in input?encodeSourceNativeDrawingRequest(input):encodeSourceDrawingFrame(input);if(!r.ok)throw Error(r.error.reason);return Buffer.from(r.value);}
function stripViewport(packet:Buffer,oldVersion:number){const b=Buffer.concat([packet.subarray(0,60),packet.subarray(80)]);b.writeUInt32LE(oldVersion,4);b.writeUInt32LE(b.length,8);return b;}

describe('physical viewport v16 boundary',()=>{
 it('owns an immutable copy and accepts zero extents independently of framebuffer storage',()=>{
  const input=[-2147483648,2147483647,0,2147483647],r=parseSourceDrawingViewport(input);expect(r.ok).toBe(true);if(!r.ok)throw Error();input[0]=0;expect(r.value).toEqual([-2147483648,2147483647,0,2147483647]);expect(Object.isFrozen(r.value)).toBe(true);
 });
 it.each([null,{},new Array(4),[0,0,1],[0,0,1,2,3],[0,0,-1,2],[0,0,2**31,1],[2**31,0,1,1],[-2147483649,0,1,1],[0,.5,1,1],[0,0,NaN,1],[0,0,Infinity,1],['0',0,1,1]])('rejects malformed viewport %#',value=>{expect(parseSourceDrawingViewport(value).ok).toBe(false);expect(encodeSourceDrawingFrame({...frame(),viewport:value as SourceDrawingViewport}).ok).toBe(false);});
 it.each([false,true])('preserves generic legacy bytes with maximum anisotropy=%s',maximum=>{
  const f=frame();if(maximum)f.drawing.textures=[{width:1,height:1,pixels:Uint8Array.of(1,2,3,255),anisotropy:'maximum',magFilter:'linear',minFilter:'linear-mipmap-linear',wrap:'clamp',generateMipmaps:true}];
  const old=encode(f),next=encode({...f,viewport:[-2,4,800,900]});expect(old.readUInt32LE(4)).toBe(maximum?12:3);expect(next.readUInt32LE(4)).toBe(16);expect(next.readUInt32LE(60)).toBe(0);expect(stripViewport(next,maximum?12:3)).toEqual(old);expect(inspectSourceFrameHeader(next)).toMatchObject({ok:true,value:{width:2,height:3,viewport:[-2,4,800,900]}});
 });
 it('preserves v13 bodies and keeps the nested generic chunk viewport neutral',()=>{
  const old=begin(),next={...old,viewport:[-2,4,800,900] as const};expect(stripViewport(encode(next),13)).toEqual(encode(old));
  const append:SourceNativeDrawingRequest={...next,operation:{kind:'append',resource,chunk:{ordinal:0,commandIndex:0,passIndex:0,rangeKind:'vertices',offset:0,count:3,total:3,drawing:frame().drawing}}},bytes=encode(append);
  expect(bytes.readUInt32LE(60)).toBe(1);expect(bytes.readUInt32LE(144)).toBe(3);expect(bytes.readUInt32LE(160)).toBe(1);expect(bytes.readUInt32LE(164)).toBe(1);expect(inspectSourceFrameHeader(bytes)).toMatchObject({ok:true,value:{family:'drawing',operation:2,viewport:[-2,4,800,900]}});
 });
 it('charges only envelope bytes for viewport, keeping the exact combined allocation boundary',()=>{
  const r=begin([0,0,2147483647,2147483647]);if(r.operation.kind!=='begin')throw Error();const fixed={retainedBytes:0,frameBytes:2*3*12,metadataBytes:4096,scheduleCount:1,maxChunkBytes:4096};
  const extra=sourceDrawingChunkPeak({...fixed,viewport:true})-sourceDrawingChunkPeak(fixed);expect(extra).toBe(20*8);
  const retained=256*1024*1024-sourceDrawingChunkPeak({...fixed,viewport:true});expect(encodeSourceNativeDrawingRequest(r,{retainedBytes:retained}).ok).toBe(true);expect(encodeSourceNativeDrawingRequest(r,{retainedBytes:retained+1})).toMatchObject({ok:false,error:{kind:'capacity'}});
 });
 it('rejects unknown mode, dimensions beyond GLsizei, and every truncated extension at the gateway',()=>{
  const valid=encode(frame([0,0,2,3]));for(const [offset,value]of [[60,2],[72,0x80000000],[76,0xffffffff]]){const b=Buffer.from(valid);b.writeUInt32LE(value,offset);expect(inspectSourceFrameHeader(b).ok).toBe(false);}
  for(let size=60;size<80;size++){const b=Buffer.from(valid.subarray(0,size));b.writeUInt32LE(size,8);expect(inspectSourceFrameHeader(b).ok).toBe(false);}
 });
});

// This executable calls the real native parser only. It never creates a CGL
// context or runs target/render methods, including for valid packets.
describe.skipIf(process.platform!=='darwin')('native v16 parser without GL execution',()=>{
 let executable:string;
 beforeAll(()=>{const folder=mkdtempSync(resolve('.cache/drawing-viewport-parser-')),source=join(folder,'parse.m');executable=join(folder,'parse');writeFileSync(source,`#define main rendererMain\n#include "${resolve('server/render/SourceCglRenderer.m')}"\n#undef main\nint main(void){@autoreleasepool{@try{NSDictionary *f=parse([[NSFileHandle fileHandleWithStandardInput]readDataToEndOfFile],NO);NSDictionary *out=@{@"viewport":f[@"viewport"],@"width":f[@"width"],@"height":f[@"height"],@"bounded":@([f objectForKey:@"drawing"]!=nil)};NSData *j=[NSJSONSerialization dataWithJSONObject:out options:0 error:NULL];fwrite(j.bytes,1,j.length,stdout);return 0;}@catch(NSException *e){fprintf(stderr,"%s: %s",e.name.UTF8String,e.reason.UTF8String);return 2;}}}`);const built=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-Werror','-framework','Foundation','-framework','OpenGL',source,'-o',executable],{encoding:'utf8',timeout:30000,maxBuffer:65536});expect(built.status,built.stderr).toBe(0);expect(built.stderr).toBe('');},40000);
 it.each([[0,0,0,0],[-3,4,810,972],[2147483647,-2147483648,2147483647,1]] as const)('parses independent viewport %s for complete and bounded',(...viewport)=>{
  for(const request of [frame(viewport),begin(viewport)]){const r=spawnSync(executable,[],{input:encode(request),encoding:'utf8',timeout:1000});expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toEqual({viewport,width:2,height:3,bounded:Number('operation'in request)});}
 });
 it('rejects unknown modes, truncated payloads and transplanted v13 data before GL',()=>{
  const good=encode(begin([0,0,4,5]));for(const [offset,value]of [[60,2],[60,0],[72,0x80000000],[80,7],[88,15]]){const bad=Buffer.from(good);bad.writeUInt32LE(value,offset);const r=spawnSync(executable,[],{input:bad,encoding:'utf8',timeout:1000});expect(r.status).toBe(2);expect(r.stderr).toMatch(/^input:/);}
  for(const size of [60,64,68,72,76,80,100,111]){const bad=Buffer.from(good.subarray(0,size));bad.writeUInt32LE(size,8);expect(spawnSync(executable,[],{input:bad,timeout:1000}).status).toBe(2);}
 });
});
