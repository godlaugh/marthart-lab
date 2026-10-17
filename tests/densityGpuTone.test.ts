import {describe,it,expect,vi,afterEach} from 'vitest';
import {prepareDensityTone,toneDensityRgba,toneDensityRgbaPrepared} from '../src/engine/density';
import {prepareDensityGpuTone,densityGpuToneBytes,DensityGpuTone} from '../src/engine/densityGpuTone';
import type {Palette,Settings} from '../src/types';
const palette:Palette={name:'test',mode:'linear',stops:['#ff0000','#0000ff'],cycles:1,offset:0};
afterEach(()=>vi.restoreAllMocks());
describe('shared density presentation input',()=>{
 it('detaches validated palette data and preserves exact CPU tone with a caller-owned destination',()=>{
  const source={...palette,stops:[...palette.stops]},job=prepareDensityTone(source,{paletteMode:'source',toneMap:'linear',gamma:1,dynamicRange:2,transparentBackground:true}),rgba=new Float32Array([1,0,0,1,0,0,0,0]);source.stops[0]='#ffffff';expect(job.palette.stops[0]).toBe('#ff0000');
  const target=new Uint8ClampedArray(8).fill(255),expected=toneDensityRgba(2,1,rgba,palette,{paletteMode:'source',toneMap:'linear',gamma:1,dynamicRange:2,transparentBackground:true});expect(toneDensityRgbaPrepared(2,1,rgba,job,undefined,target)).toBe(target);expect(target).toEqual(expected);expect([...target]).toEqual([255,0,0,128,0,0,0,0]);expect([...rgba]).toEqual([1,0,0,1,0,0,0,0]);
 });
 it('keeps invalid settings and malformed buffers at the shared parser/output boundaries',()=>{
  for(const patch of [{gamma:0},{background:'red'},{exposure:NaN},{contrast:-1},{transparentBackground:1}]as Settings[])expect(()=>prepareDensityTone(palette,patch)).toThrow();
  const job=prepareDensityTone(palette);expect(()=>toneDensityRgbaPrepared(1,1,new Float32Array(3),job)).toThrow();expect(()=>toneDensityRgbaPrepared(1,1,new Float32Array(4),job,undefined,new Uint8ClampedArray(8))).toThrow();expect(()=>toneDensityRgbaPrepared(0,1,new Float32Array(),job)).toThrow();
 });
 it('retains source-color applicability for every palette representation including extreme phase',()=>{
  for(const mode of ['linear','sine','cosine','hsv','curve']as const){const job=prepareDensityTone({...palette,mode,offset:1e200,cycles:1e200},{paletteMode:'source'});expect(prepareDensityGpuTone(job).plan).toBeDefined();}
 });
 it('uses explicit CPU applicability reasons for unsupported precision and preserves half-open endpoint colors',()=>{
  for(const p of [{...palette,mode:'curve' as const},{...palette,cycles:1000},{...palette,offset:1e100},{...palette,stops:['#000000','#ffffff','#ff0000'],positions:[0,1-1e-10,1]}])expect(prepareDensityGpuTone(prepareDensityTone(p)).reason).toBeTruthy();
  const plan=prepareDensityGpuTone(prepareDensityTone(palette)).plan!;expect(plan.endpoint[2]).toBeCloseTo(1,12);expect(plan.endpoint[0]).toBeLessThan(1e-12);expect(plan.stops).toEqual(new Float32Array([1,0,0,0,0,0,1,1]));
 });
 it('accounts for fixed MRT/reduction buffers before rendering and rejects malformed sizes',()=>{
  expect(densityGpuToneBytes()).toBe(512*512*28+128*128*32+1024*32);for(const value of [0,-1,.5,513,NaN])expect(()=>densityGpuToneBytes(value)).toThrow();
  const gl={}as WebGL2RenderingContext,renderer=new DensityGpuTone(gl),plan=prepareDensityGpuTone(prepareDensityTone(palette)).plan!;
  expect(()=>renderer.render({}as WebGLTexture,1,1,plan,()=>true)).toThrow('取消');expect(()=>renderer.render({}as WebGLTexture,8192,8192,plan)).toThrow('128 MiB');expect(renderer.diagnostics()).toEqual({retainedBytes:0,programs:0});
 });
});


describe('GPU tone resource ownership',()=>{
 function fixture(fail:'shader'|'texture'|'framebuffer'){
  let n=0;const made={program:[] as object[],shader:[] as object[],texture:[] as object[]};
  const api:Record<string,unknown>={MAX_DRAW_BUFFERS:1,MAX_TEXTURE_SIZE:2,VERTEX_SHADER:3,FRAGMENT_SHADER:4,
   getParameter:(key:number)=>key===1?2:1024,
   createProgram:()=>{const p={id:++n};made.program.push(p);return p;},
   createShader:()=>{if(fail==='shader'&&made.shader.length===1)return null;const p={id:++n};made.shader.push(p);return p;},
   createTexture:()=>{if(fail==='texture'&&made.texture.length===1)return null;const p={id:++n};made.texture.push(p);return p;},
   createFramebuffer:()=>null,getShaderParameter:()=>true,getProgramParameter:()=>true,getShaderInfoLog:()=>'',getProgramInfoLog:()=>'',
   deleteProgram:vi.fn(),deleteShader:vi.fn(),deleteTexture:vi.fn(),deleteFramebuffer:vi.fn(),
   shaderSource:vi.fn(),compileShader:vi.fn(),attachShader:vi.fn(),linkProgram:vi.fn(),bindTexture:vi.fn(),texParameteri:vi.fn(),texImage2D:vi.fn()};
  return{api,made,renderer:new DensityGpuTone(api as unknown as WebGL2RenderingContext)};
 }
 for(const failure of ['shader','texture','framebuffer']as const)it('releases every allocated handle after '+failure+' allocation failure without deleting borrowed ink',()=>{
  const {api,made,renderer}=fixture(failure),borrowed={}as WebGLTexture,plan=prepareDensityGpuTone(prepareDensityTone(palette)).plan!;
  expect(()=>renderer.render(borrowed,1,1,plan)).toThrow('分配失败');
  for(const kind of ['program','shader','texture']as const){const deleted=api['delete'+kind[0].toUpperCase()+kind.slice(1)] as ReturnType<typeof vi.fn>;expect(deleted.mock.calls.flat()).toEqual(made[kind]);expect(deleted).not.toHaveBeenCalledWith(borrowed);}
  expect(renderer.diagnostics()).toEqual({retainedBytes:0,programs:0});renderer.dispose();
 });
});
