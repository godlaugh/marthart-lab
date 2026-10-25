import {afterEach,describe,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {SourceSamilaRecordingPreviewRenderer} from '../src/engine/sourceSamilaPreviewRenderer';

const background=[16,32,48,128] as const;
function frame(width=1,height=1){return{width,height,pixels:new Uint8ClampedArray(width*height*4)};}
function device(options:{width?:number;height?:number;maxTexture?:number;maxRenderbuffer?:number;maxViewport?:readonly[number,number];samples?:number;supported?:number[];lost?:boolean;error?:number}={}){
 const state={width:options.width??2,height:options.height??2,maxTexture:options.maxTexture??16384,maxRenderbuffer:options.maxRenderbuffer??16384,maxViewport:options.maxViewport??[16384,16384] as const,samples:options.samples??0,supported:options.supported??[4,2,1],lost:options.lost??false,error:options.error??0,dither:true};
 const gl={NO_ERROR:0,SAMPLES:0x80a9,MAX_TEXTURE_SIZE:0x0d33,MAX_RENDERBUFFER_SIZE:0x84e8,MAX_VIEWPORT_DIMS:0x0d3a,RENDERBUFFER:0x8d41,RGBA8:0x8058,DITHER:0x0bd0,
  isContextLost:vi.fn(()=>state.lost),getError:vi.fn(()=>state.error),
  isEnabled:vi.fn(()=>state.dither),disable:vi.fn(()=>{state.dither=false;}),enable:vi.fn(()=>{state.dither=true;}),
  getParameter:vi.fn((name:number)=>{if(name===gl.SAMPLES)return state.samples;if(name===gl.MAX_TEXTURE_SIZE)return state.maxTexture;if(name===gl.MAX_RENDERBUFFER_SIZE)return state.maxRenderbuffer;if(name===gl.MAX_VIEWPORT_DIMS)return Int32Array.from(state.maxViewport);throw Error('unexpected GL query');}),
  getInternalformatParameter:vi.fn(()=>Int32Array.from(state.supported)),
 };
 const fake={autoClear:true,getDrawingBufferSize:vi.fn((size:THREE.Vector2)=>size.set(state.width,state.height)),getRenderTarget:vi.fn(()=>null as THREE.WebGLRenderTarget|null),getContext:vi.fn(()=>gl),setRenderTarget:vi.fn(),clear:vi.fn(),render:vi.fn(),state:{buffers:{color:{setMask:vi.fn(),setClear:vi.fn()}}}};
 return{state,gl,fake,renderer:fake as unknown as THREE.WebGLRenderer};
}
function untouched(value:ReturnType<typeof device>){expect(value.fake.setRenderTarget).not.toHaveBeenCalled();expect(value.fake.clear).not.toHaveBeenCalled();expect(value.fake.render).not.toHaveBeenCalled();expect(value.fake.state.buffers.color.setClear).not.toHaveBeenCalled();}
afterEach(()=>vi.restoreAllMocks());

describe('Samila recording preview resource boundary (real Three objects, fake renderer; no GPU claim)',()=>{
 it('rejects the 128 MiB input domain before accepting an incomplete tiny backing array',()=>{
  // No large allocation or forged typed-array length: dimensions alone exceed
  // the input policy, which must reject before inspecting the four real bytes.
  expect(()=>new SourceSamilaRecordingPreviewRenderer({width:8192,height:4097,pixels:new Uint8ClampedArray(4)},background)).toThrow('128 MiB');
  expect(()=>new SourceSamilaRecordingPreviewRenderer({width:2,height:2,pixels:new Uint8ClampedArray(4)},background)).toThrow('完整原始 RGBA');
 });
 it.each([
  {name:'source texture',source:[4,2],width:2,height:2,maxTexture:3},
  {name:'destination texture',source:[1,1],width:4,height:2,maxTexture:3},
  {name:'destination renderbuffer',source:[1,1],width:4,height:2,maxRenderbuffer:3},
  {name:'destination viewport width',source:[1,1],width:4,height:2,maxViewport:[3,8]},
  {name:'destination viewport height',source:[1,1],width:2,height:4,maxViewport:[8,3]},
 ])('rejects $name before target resize, clear or rendering',value=>{
  const owner=new SourceSamilaRecordingPreviewRenderer(frame(value.source[0],value.source[1]),background),d=device({...value,maxViewport:value.maxViewport as [number,number]|undefined}),resize=vi.spyOn(THREE.WebGLRenderTarget.prototype,'setSize');
  try{expect(()=>owner.render(d.renderer)).toThrow('GPU 纹理或视口限制');untouched(d);expect(resize).not.toHaveBeenCalled();}finally{owner.dispose();}
 });
 it.each([-1,.5,Number.NaN,8])('rejects invalid or unsupported sample count %s before allocating target storage',samples=>{
  const owner=new SourceSamilaRecordingPreviewRenderer(frame(),background),d=device({samples,supported:[4,2,1]}),resize=vi.spyOn(THREE.WebGLRenderTarget.prototype,'setSize');
  try{expect(()=>owner.render(d.renderer)).toThrow('不支持当前主画布采样数');untouched(d);expect(resize).not.toHaveBeenCalled();}finally{owner.dispose();}
 });
 it('counts source upload, resolve and multisample bytes together against 256 MiB',()=>{
  const owner=new SourceSamilaRecordingPreviewRenderer(frame(),background),d=device({width:8192,height:4096}),resize=vi.spyOn(THREE.WebGLRenderTarget.prototype,'setSize');
  try{
   // The fake query advertises a 128 MiB drawing buffer. Three.setSize changes
   // descriptors only; this fake renderer never creates a canvas or GL texture.
   owner.render(d.renderer);expect(d.fake.render).toHaveBeenCalledTimes(2);expect(resize).toHaveBeenCalledOnce();
   d.fake.setRenderTarget.mockClear();d.fake.clear.mockClear();d.fake.render.mockClear();d.fake.state.buffers.color.setClear.mockClear();resize.mockClear();
   // 128 MiB resolve + 128 MiB one-sample color + 4 actual source bytes is
   // already over the limit. This catches omission of the source upload.
   d.state.samples=1;expect(()=>owner.render(d.renderer)).toThrow('256 MiB');untouched(d);expect(resize).not.toHaveBeenCalled();
   // One pixel-row less fits the full sum; no large typed array is involved.
   d.state.height=4095;owner.render(d.renderer);expect(d.fake.render).toHaveBeenCalledTimes(2);
   d.fake.setRenderTarget.mockClear();d.fake.clear.mockClear();d.fake.render.mockClear();d.fake.state.buffers.color.setClear.mockClear();resize.mockClear();
   d.state.samples=2;expect(()=>owner.render(d.renderer)).toThrow('256 MiB');untouched(d);expect(resize).not.toHaveBeenCalled();
  }finally{owner.dispose();}
 });
 it.each([{lost:true,error:0,message:'上下文已丢失'},{lost:false,error:1282,message:'GL 状态失败'}])('rejects bad preexisting context state before target mutations: $message',value=>{
  const owner=new SourceSamilaRecordingPreviewRenderer(frame(),background),d=device(value),resize=vi.spyOn(THREE.WebGLRenderTarget.prototype,'setSize');
  try{expect(()=>owner.render(d.renderer)).toThrow(value.message);untouched(d);expect(resize).not.toHaveBeenCalled();d.state.lost=false;d.state.error=0;owner.render(d.renderer);expect(d.fake.render).toHaveBeenCalledTimes(2);}finally{owner.dispose();}
 });
 it('retains the exact failed disposal resource, retries it, and rejects renders while closing or disposed',()=>{
  const owner=new SourceSamilaRecordingPreviewRenderer(frame(),background),d=device();owner.render(d.renderer);
  const first=d.fake.render.mock.calls[0][0] as THREE.Scene,second=d.fake.render.mock.calls[1][0] as THREE.Scene;
  const mesh=first.children[0] as THREE.Mesh<THREE.BufferGeometry,THREE.RawShaderMaterial>,copy=(second.children[0] as THREE.Mesh<THREE.BufferGeometry,THREE.RawShaderMaterial>).material;
  const texture=mesh.material.uniforms.image.value as THREE.DataTexture,target=d.fake.setRenderTarget.mock.calls[0][0] as THREE.WebGLRenderTarget;
  const resources=[mesh.geometry,mesh.material,copy,texture,target],disposed=resources.map(()=>vi.fn());let reject=true;
  resources.forEach((resource,index)=>resource.addEventListener('dispose',()=>{disposed[index]();if(index===1&&reject){reject=false;throw Error('one material dispose listener failed');}}));
  d.fake.getDrawingBufferSize.mockClear();d.fake.setRenderTarget.mockClear();d.fake.clear.mockClear();d.fake.render.mockClear();d.fake.state.buffers.color.setClear.mockClear();
  expect(()=>owner.dispose()).toThrow('one material');expect(disposed.map(fn=>fn.mock.calls.length)).toEqual([1,1,0,0,0]);expect(first.children).toHaveLength(0);expect(second.children).toHaveLength(0);
  expect(()=>owner.render(d.renderer)).toThrow('等待清理');expect(d.fake.getDrawingBufferSize).not.toHaveBeenCalled();untouched(d);
  owner.dispose();expect(disposed.map(fn=>fn.mock.calls.length)).toEqual([1,2,1,1,1]);owner.dispose();expect(disposed.map(fn=>fn.mock.calls.length)).toEqual([1,2,1,1,1]);
  expect(()=>owner.render(d.renderer)).toThrow('已释放');expect(d.fake.getDrawingBufferSize).not.toHaveBeenCalled();untouched(d);
 });
 it.each([true,false])('restores the caller target, auto-clear and dither=%s after a failed draw',dither=>{
  const owner=new SourceSamilaRecordingPreviewRenderer(frame(),background),d=device();d.state.dither=dither;
  d.fake.render.mockImplementation(()=>{expect(d.state.dither).toBe(false);throw Error('draw failed');});
  try{expect(()=>owner.render(d.renderer)).toThrow('draw failed');expect(d.fake.setRenderTarget).toHaveBeenLastCalledWith(null);expect(d.fake.autoClear).toBe(true);expect(d.state.dither).toBe(dither);}finally{owner.dispose();}
 });
});
