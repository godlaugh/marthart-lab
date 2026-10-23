import {beforeAll,describe,it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {encodeSourceDrawingFrame,SOURCE_FRAME_BUDGET,type SourceDrawingFrame} from '../src/engine/sourceDrawingFrame';
import type {SourceDrawingCommand,SourceDrawingSnapshot} from '../src/engine/sourceDrawingSnapshot';

function frame(commands:SourceDrawingCommand[]=[]):SourceDrawingFrame {
  const drawing:SourceDrawingSnapshot={model:'source-drawing-v1',commands,textures:[],copiedBufferBytes:0,retainedBufferBytes:0,admittedBytes:0};
  return{generation:7,sequence:11,width:16,height:12,samples:0,clear:[1,0,0.5,1],drawing};
}
function triangle():SourceDrawingCommand {
  return{vertexShader:'in vec2 position;void main(){gl_Position=vec4(position,0.0,1.0);}',
    fragmentShader:'uniform float params[3];uniform int mode;uniform ivec2 pair;uniform float negative;out vec4 color;void main(){color=vec4(params[1],float(mode)/4.0,float(pair.y)/4.0,floatBitsToInt(negative)<0?1.0:0.0);}',
    attributes:[{name:'position',size:2,divisor:0,values:new Float32Array([-1,-1,3,-1,-1,3])}],
    first:0,count:3,instances:1,depthTest:false,depthWrite:false,depthFunction:'less-equal',frontFace:'counter-clockwise',passes:['both'],blend:'source-alpha-over-additive-alpha',
    uniforms:[{name:'params',kind:'float-array',count:3,values:new Float32Array([0.125,0.25,0.5])},{name:'mode',kind:'int',count:1,values:new Int32Array([2])},{name:'pair',kind:'ivec2',count:1,values:new Int32Array([3,4])},{name:'negative',kind:'float',count:1,values:new Float32Array([-0])}],
  };
}
function encode(f:SourceDrawingFrame){const r=encodeSourceDrawingFrame(f);if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;}

describe('binary source frame producer',()=>{
  it('writes identity, physical viewport and exact float words, without JSON',()=>{
    const d=triangle(),f=frame([d]);
    // Unused source attribute payload is still evidence and retains its bits.
    const words=new Uint32Array([0x7fc12345,0x80000000,0x7f800000]);
    d.attributes=[...d.attributes,{name:'unused',size:1,divisor:0,values:new Float32Array(words.buffer)}];
    const packet=encode(f),b=Buffer.from(packet);
    expect(b.readUInt32LE(0)).toBe(0x31464c4d);expect(b.readUInt32LE(8)).toBe(b.length);
    expect([b.readUInt32LE(12),b.readUInt32LE(16),b.readUInt32LE(20),b.readUInt32LE(24)]).toEqual([7,11,16,12]);
    expect(b.includes(Buffer.from(words.buffer))).toBe(true);expect(b.subarray(-4).readUInt32LE()).toBe(0x80000000);
    d.attributes[0].values[0]=99;expect(Buffer.from(encode(f)).equals(b)).toBe(false);
  });
  it.each(['identity','dimensions','samples','background','unicode','capacity'] as const)('rejects invalid %s before native delivery',kind=>{
    const f=frame([triangle()]);
    if(kind==='identity')f.sequence=0;
    if(kind==='dimensions')f.width=16385;
    if(kind==='samples')f.samples=-1;
    if(kind==='background')f.clear=[NaN,0,0,1];
    if(kind==='unicode')f.drawing.commands[0].vertexShader='\ud800';
    if(kind==='capacity')f.drawing.admittedBytes=SOURCE_FRAME_BUDGET;
    expect(encodeSourceDrawingFrame(f)).toMatchObject({ok:false,error:{kind:kind==='capacity'?'capacity':'input'}});
  });
  it('admits multisample color/depth storage before allocating the packet',()=>{
    const f=frame();f.width=4000;f.height=4000;
    expect(encodeSourceDrawingFrame(f).ok).toBe(true);f.samples=4;
    expect(encodeSourceDrawingFrame(f)).toMatchObject({ok:false,error:{kind:'capacity'}});
  });
  it('counts caller-retained capture and enhancement buffers in encoder admission',()=>{
    expect(encodeSourceDrawingFrame(frame(),{retainedBytes:SOURCE_FRAME_BUDGET})).toMatchObject({ok:false,error:{kind:'capacity'}});
    expect(encodeSourceDrawingFrame(frame(),{retainedBytes:NaN})).toMatchObject({ok:false,error:{kind:'input'}});
  });
  it('does not deliver a partially encoded cancelled frame',()=>{
    let calls=0;expect(encodeSourceDrawingFrame(frame([triangle()]),{isCancelled:()=>++calls>45})).toMatchObject({ok:false,error:{kind:'cancelled'}});
  });
});

// This executes the real system CGL consumer; no simulated native provider.
// Each synchronous child handle has a hard deadline and bounded diagnostic IO.
describe.skipIf(process.platform!=='darwin')('native binary frame boundary',()=>{
  let root:string,binary:string,serial=0;
  beforeAll(()=>{
    mkdirSync('.cache',{recursive:true});root=mkdtempSync(resolve('.cache/frame-boundary-'));binary=join(root,'replay');
    const build=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-framework','Foundation','-framework','OpenGL','server/render/SourceCglRenderer.m','-o',binary],{encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:65536});
    expect(build.error).toBeUndefined();expect(build.status,build.stderr).toBe(0);expect(build.stderr).toBe('');
  });
  function run(bytes:Uint8Array){
    const folder=join(root,String(++serial));mkdirSync(folder);const input=join(folder,'frame.bin');writeFileSync(input,bytes);
    const result=spawnSync(binary,[input,folder],{encoding:'utf8',timeout:10000,killSignal:'SIGKILL',maxBuffer:65536,env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8'}});
    expect(result.error).toBeUndefined();expect(result.signal).toBeNull();return{...result,folder};
  }
  function success(f:SourceDrawingFrame,expected:number[]){
    const r=run(encode(f));expect(r.status,r.stderr).toBe(0);
    const meta=JSON.parse(readFileSync(join(r.folder,'renderer.json'),'utf8'));
    expect(meta).toMatchObject({generation:f.generation,sequence:f.sequence,width:f.width,height:f.height,draws:f.drawing.commands.length,windowCreated:false,vendor:'Apple',rowOrder:'bottom-up'});
    const rgba=readFileSync(join(r.folder,'frame.rgba'));expect(rgba.length).toBe(f.width*f.height*4);
    for(let i=0;i<rgba.length;i+=4)expect([...rgba.subarray(i,i+4)]).toEqual(expected);
  }
  it('renders caller dimensions and background for an empty frame',()=>{const f=frame();f.width=7;f.height=5;success(f,[255,0,128,255]);});
  it('resolves a four-sample frame and preserves depth across diagnostic readbacks',()=>{
    const near=triangle();near.attributes[0].values=new Float32Array([-1,-1,1,-1,-1,1]);near.uniforms=[];
    near.fragmentShader='out vec4 color;void main(){color=vec4(1,0,0,1);}';near.depthTest=true;near.depthWrite=true;
    const far={...near,vertexShader:near.vertexShader.replace('0.0,1.0','0.5,1.0'),fragmentShader:'out vec4 color;void main(){color=vec4(0,0,1,1);}'};
    const f=frame([near,far]);f.width=f.height=16;f.clear=[0,0,0,1];f.samples=4;
    const r=run(encode(f));expect(r.status,r.stderr).toBe(0);
    const first=readFileSync(join(r.folder,'draw-1-after.rgba')),last=readFileSync(join(r.folder,'frame.rgba'));
    expect(readFileSync(join(r.folder,'draw-2-after.rgba')).equals(first)).toBe(true);expect(last.equals(first)).toBe(true);
    expect(JSON.parse(readFileSync(join(r.folder,'renderer.json'),'utf8')).samples).toBe(4);
    expect([...last].some((v,i)=>i%4===0&&v>0&&v<255)).toBe(true);
    expect([...last].every((v,i)=>i%4===0||v===(i%4===3?255:0))).toBe(true);
    f.samples=0;const single=run(encode(f));expect(single.status,single.stderr).toBe(0);
    expect([...readFileSync(join(single.folder,'frame.rgba'))].every(v=>v===0||v===255)).toBe(true);
  });
  it('continues to read retained v1 packets as single-sample evidence',()=>{
    const current=Buffer.from(encode(frame([triangle()]))),legacy=Buffer.concat([current.subarray(0,52),current.subarray(56)]);
    legacy.writeUInt32LE(1,4);legacy.writeUInt32LE(legacy.length,8);const r=run(legacy);expect(r.status,r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(r.folder,'renderer.json'),'utf8')).samples).toBe(0);
  });
  it.each(['invalid','capacity','unsupported'] as const)('rejects %s sample counts without a partial frame',kind=>{
    const bytes=Buffer.from(encode(frame()));bytes.writeUInt32LE(kind==='invalid'?0xffffffff:kind==='capacity'?0x7fffffff:65536,52);
    // Keep the hardware-limit case within the allocation budget.
    if(kind==='unsupported'){bytes.writeUInt32LE(1,20);bytes.writeUInt32LE(1,24);}
    const r=run(bytes);expect(r.status).toBe(1);expect(JSON.parse(r.stderr).kind).toBe(kind==='invalid'?'input':kind);
    expect(()=>readFileSync(join(r.folder,'frame.rgba'))).toThrow();
  });
  it.each(['arrays','uint16','uint32','nonindexed-range'] as const)('renders %s with typed arrays, integer vectors and negative zero',kind=>{
    const d=triangle();if(kind==='uint16'||kind==='uint32'){d.index=kind==='uint16'?new Uint16Array([99,99,99,0,1,2]):new Uint32Array([99,99,99,0,1,2]);d.first=3;}
    if(kind==='nonindexed-range'){d.attributes[0].values=new Float32Array([99,99,99,99,99,99,-1,-1,3,-1,-1,3]);d.first=3;}
    success(frame([d]),[64,128,255,255]);
  });
  it('retains an explicitly empty indexed draw',()=>{const d=triangle();d.index=new Uint16Array();d.count=0;success(frame([d]),[255,0,128,255]);});
  it('binds distinct textures and preserves ordered draws',()=>{
    const a=triangle(),b=triangle();a.fragmentShader='out vec4 color;void main(){color=vec4(1,0,0,1);}';a.uniforms=[];
    b.fragmentShader='uniform sampler2D a;uniform sampler2D b;out vec4 color;void main(){color=texture(a,vec2(0.5))+texture(b,vec2(0.5));}';
    b.uniforms=[{name:'a',kind:'sampler2d',texture:0},{name:'b',kind:'sampler2d',texture:1}];
    const f=frame([a,b]);f.drawing.textures=[[0,64,0,128],[0,0,128,127]].map(bytes=>({width:1,height:1,pixels:new Uint8Array(bytes),anisotropy:1,magFilter:'linear',minFilter:'linear-mipmap-linear',wrap:'clamp',generateMipmaps:true}));
    success(f,[0,64,128,255]);
  });
  it.each(['magic','version','length','identity','viewport','clear','truncated','trailing','collection','index','uniform-type','shader','budget'] as const)('fails closed on malformed %s',kind=>{
    const f=frame([triangle()]);if(kind==='index'){f.drawing.commands[0].index=new Uint16Array([0,1,999]);}
    if(kind==='uniform-type')f.drawing.commands[0].uniforms=f.drawing.commands[0].uniforms.map((u,i)=>i===1?{name:'mode',kind:'float',count:1,values:new Float32Array([2])}:u);
    if(kind==='shader')f.drawing.commands[0].fragmentShader='this is not GLSL';
    let bytes=Buffer.from(encode(f));
    if(kind==='magic')bytes.writeUInt32LE(0,0);if(kind==='version')bytes.writeUInt32LE(3,4);if(kind==='length')bytes.writeUInt32LE(bytes.length+1,8);
    if(kind==='identity')bytes.writeUInt32LE(0,12);if(kind==='viewport')bytes.writeUInt32LE(0,20);if(kind==='clear')bytes.writeFloatLE(NaN,28);
    if(kind==='truncated')bytes=bytes.subarray(0,-7);
    if(kind==='trailing'){bytes=Buffer.concat([bytes,Buffer.alloc(4)]);bytes.writeUInt32LE(bytes.length,8);}
    if(kind==='collection')bytes.writeUInt32LE(0xffffffff,48);
    if(kind==='budget')bytes.writeUInt32LE(SOURCE_FRAME_BUDGET,8);
    const r=run(bytes);expect(r.status).toBe(1);expect(JSON.parse(r.stderr).kind).toBe(kind==='shader'||kind==='uniform-type'?'runtime':kind==='budget'?'capacity':'input');
    expect(()=>readFileSync(join(r.folder,'renderer.json'))).toThrow();
  });
});
