import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {prepareSourcePerlinNativeDrawing,sourcePerlinNativeDrawingLayout} from '../src/engine/sourcePerlinNativeDrawing';
import {sourcePerlinFragmentBody,sourcePerlinGpuFragment} from '../src/engine/sourcePerlinGpuShader';
import {prepareSourcePerlinGpuUniforms,type SourcePerlinGpuFrame} from '../src/engine/sourcePerlinGpu';
import {encodeSourceDrawingFrame,SOURCE_FRAME_BUDGET} from '../src/engine/sourceDrawingFrame';
const frame=():SourcePerlinGpuFrame=>({width:64,height:48,palette:new Uint32Array(256).fill(0x80402010),time:.5,noiseFrequency:1.5,warpAmplitude:.1,warpFrequency:2,directionOffset:0,timeSpeed:1,marchSteps:32,stepSize:.008,brightness:1.7,vignettePower:.1,fiberStrength:.7,renderStyle:0});
const channel=()=>({size:512 as const,pixels:new Uint32Array(512*512).fill(0x40abcdef)});
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
describe('Perlin native mathematical drawing producer (CPU contracts, no GL execution)',()=>{
 it('shares the unchanged original fragment body with WebGL',()=>{
  expect(sha(sourcePerlinFragmentBody.trim())).toBe('1649041ad123fd9c9a6d9b295263ecf66db5c1c6616768b83d4cc826a5af153c');
  expect(sourcePerlinGpuFragment).toBe('#version 300 es\nprecision highp float;\nprecision highp int;\n'+sourcePerlinFragmentBody);
  const drawing=prepareSourcePerlinNativeDrawing(frame(),channel());
  expect(drawing.commands[0].fragmentShader).toBe(sourcePerlinFragmentBody);expect(drawing.commands[0].fragmentShader).not.toContain('#version');
 });
 it('keeps source ARGB alpha, source row order and original sampler assignments',()=>{
  const f=frame(),c=channel();c.pixels[0]=0xff123456;c.pixels[c.size]=0x01876543;
  const drawing=prepareSourcePerlinNativeDrawing(f,c),d=drawing.commands[0];
  expect([...drawing.textures[0].pixels.slice(0,4)]).toEqual([64,32,16,128]);
  expect([...drawing.textures[1].pixels.slice(0,4)]).toEqual([18,52,86,255]);
  expect([...drawing.textures[1].pixels.slice(c.size*4,c.size*4+4)]).toEqual([135,101,67,1]);
  expect(d.uniforms.filter(u=>u.kind==='sampler2d')).toEqual([{name:'u_palette',kind:'sampler2d',texture:0},{name:'u_channel0',kind:'sampler2d',texture:1}]);
  expect(drawing.textures.every(t=>t.anisotropy==='maximum'&&t.generateMipmaps&&t.minFilter==='linear-mipmap-linear'&&t.magFilter==='linear'&&t.wrap==='clamp')).toBe(true);
  c.pixels[0]=0;f.palette[0]=0;expect(drawing.textures[1].pixels[0]).toBe(18);expect(drawing.textures[0].pixels[0]).toBe(64);
 });
 it('uses the existing source uniform clamp owner, with physical resolution and opaque quad state',()=>{
  const f={...frame(),noiseFrequency:-1,marchSteps:256,fiberStrength:2,renderStyle:2},d=prepareSourcePerlinNativeDrawing(f,channel()).commands[0];
  const value=(name:string)=>{const u=d.uniforms.find(u=>u.name===name)!;if(u.kind==='sampler2d')throw Error('numeric expected');return [...u.values];};
  const prepared=prepareSourcePerlinGpuUniforms(f);for(const key of Object.keys(prepared) as (keyof typeof prepared)[])expect(value('u_'+key)).toEqual([prepared[key]]);
  expect(value('u_resolution')).toEqual([64,48]);expect(value('u_paletteSize')).toEqual([256]);expect(value('u_useChannel0')).toEqual([1]);
  expect(d).toMatchObject({count:6,instances:1,depthTest:false,depthWrite:false,passes:['both'],blend:'source-alpha-over-additive-alpha'});
  expect([...d.index!]).toEqual([0,1,2,2,3,0]);expect(d.attributes[0].values.length).toBe(16);
 });
 it('binds pre-allocation wire accounting to the real encoder and maximum policy version',()=>{
  const f=frame(),c=channel(),layout=sourcePerlinNativeDrawingLayout(f,c),drawing=prepareSourcePerlinNativeDrawing(f,c);
  const result=encodeSourceDrawingFrame({generation:1,sequence:1,width:f.width,height:f.height,samples:0,clear:[0,0,0,1],drawing});
  expect(result.ok).toBe(true);if(!result.ok)throw result.error;
  expect(result.value.byteLength).toBe(layout.packetBytes);expect(new DataView(result.value.buffer).getUint32(4,true)).toBe(12);
  const copied=drawing.textures.reduce((n,t)=>n+t.pixels.byteLength,0)+drawing.commands.reduce((n,d)=>n+d.attributes.reduce((s,a)=>s+a.values.byteLength,0)+(d.index?.byteLength??0)+d.uniforms.reduce((s,u)=>s+(u.kind==='sampler2d'?0:u.values.byteLength),0),0);
  expect(drawing.copiedBufferBytes).toBe(copied);
 });
 it('admits the complete shared peak and rejects one byte beyond it',()=>{
  const f=frame(),c=channel(),base=sourcePerlinNativeDrawingLayout(f,c),remaining=SOURCE_FRAME_BUDGET-base.peakBytes;
  expect(sourcePerlinNativeDrawingLayout(f,c,{retainedBytes:remaining}).peakBytes).toBe(SOURCE_FRAME_BUDGET);
  expect(()=>prepareSourcePerlinNativeDrawing(f,c,{retainedBytes:remaining+1})).toThrow(expect.objectContaining({code:'capacity'}));
  for(const retainedBytes of [-1,NaN,Infinity,.5])expect(()=>prepareSourcePerlinNativeDrawing(f,c,{retainedBytes})).toThrow(expect.objectContaining({code:'input'}));
 });
 it('counts complete source backings and deduplicates shared ownership',()=>{
  const c=channel(),f={...frame(),palette:new Uint32Array(c.pixels.buffer,0,256)};
  expect(sourcePerlinNativeDrawingLayout(f,c).retainedBufferBytes).toBe(c.pixels.buffer.byteLength);
  const backing=new ArrayBuffer(2*1024*1024),larger={...c,pixels:new Uint32Array(backing,0,c.pixels.length)};
  expect(sourcePerlinNativeDrawingLayout(frame(),larger).retainedBufferBytes).toBe(backing.byteLength+1024);
 });
 it('rejects unsupported array ownership, malformed images and physical/work limits before packing',()=>{
  expect(()=>prepareSourcePerlinNativeDrawing(frame(),{size:512,pixels:new Uint32Array(new SharedArrayBuffer(512*512*4))})).toThrow(expect.objectContaining({code:'input'}));
  expect(()=>prepareSourcePerlinNativeDrawing({...frame(),palette:new Uint32Array(1)},channel())).toThrow(expect.objectContaining({code:'input'}));
  expect(()=>prepareSourcePerlinNativeDrawing({...frame(),width:1080},channel())).toThrow(expect.objectContaining({code:'input'}));
  const large={size:2048 as const,pixels:new Uint32Array(2048*2048)};
  expect(()=>prepareSourcePerlinNativeDrawing({...frame(),width:4096,height:4096,marchSteps:1},large)).toThrow(expect.objectContaining({code:'capacity'}));
  expect(()=>prepareSourcePerlinNativeDrawing({...frame(),width:4096,height:4000,marchSteps:128},large)).toThrow(expect.objectContaining({code:'capacity'}));
 });
});
