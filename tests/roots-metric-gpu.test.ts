import {describe,it,expect,vi} from 'vitest';
import {RootsDensityGpu,RootsGpuError,rootsGpuBytes} from '../src/engine/rootsDensityGpu';
import {rootsMetricToneGpuBytes,RootsDensityToneGpu} from '../src/engine/rootsDensityToneGpu';
import {rootsGpuCall,rootsGpuCancel} from '../src/engine/rootsGpuFailure';
import {prepareRootsDensityColor} from '../src/engine/rootsDensityColor';
function messages(error:unknown):string[]{if(!(error instanceof Error))return[String(error)];return[error.message,...(error.cause?messages(error.cause):[]),...(error instanceof AggregateError?error.errors.flatMap(messages):[])];}

describe('tagged roots GPU representation and failure boundaries',()=>{
 it('preflights source ink, same-ink readback, output, upload and LUT storage',()=>{
  const w=3840,h=2160;
  expect(rootsGpuBytes(w,h,'metric-sum')).toBe(w*h*36+65536*24+w*16+rootsMetricToneGpuBytes());
  expect(rootsGpuBytes(w,h)).toBe(rootsGpuBytes(w,h,'rgb-sum'));
  for(const [width,height]of[[0,1],[.5,1],[16385,1],[16384,16384]]){
   try{rootsGpuBytes(width,height,'metric-sum');throw Error('accepted');}catch(error){expect(error).toBeInstanceOf(RootsGpuError);expect((error as RootsGpuError).failureKind).toBe('capacity');}
  }
  expect(()=>rootsGpuBytes(w,h,'unknown' as 'metric-sum')).toThrow('kind');
 });
 it('does not interpret missing state or RGB tone as source metric ink',()=>{
  const gpu=new RootsDensityGpu(),plan=prepareRootsDensityColor({settings:{rootDensityColorVersion:'mathart-1.7.8-metric-v1'}});
  if(plan.kind!=='metric-sum')throw Error('source plan');
  for(const call of[()=>gpu.addMetric(0,0,.5,{kind:'pixel',diameter:1}),()=>gpu.presentMetric(plan,{submittedFinitePointCount:1})]){
   try{call();throw Error('accepted');}catch(error){expect(error).toBeInstanceOf(RootsGpuError);expect((error as RootsGpuError).failureKind).toBe('input');}
  }
  expect(gpu.diagnostics().retainedBytes).toBe(0);
 });
 it('distinguishes unavailable device from capacity before touching a context',()=>{
  const getContext=vi.fn();vi.stubGlobal('OffscreenCanvas',class{getContext=getContext;});
  try{const gpu=new RootsDensityGpu();expect(()=>gpu.initialize(16384,2048,'metric-sum')).toThrow('768 MiB');expect(getContext).not.toHaveBeenCalled();
   try{gpu.initialize(4,4,'metric-sum');throw Error('accepted');}catch(error){expect(error).toBeInstanceOf(RootsGpuError);expect((error as RootsGpuError).failureKind).toBe('device');}
   expect(gpu.diagnostics().handles).toBe(0);
  }finally{vi.unstubAllGlobals();}
 });
 it('preserves cancellation and already classified errors in narrow GL calls',()=>{
  const aborted=new DOMException('stop','AbortError'),capacity=new RootsGpuError('budget','capacity');
  for(const original of[aborted,capacity]){try{rootsGpuCall(()=>{throw original;});}catch(error){expect(error).toBe(original);}}
  try{rootsGpuCall(()=>{throw Error('driver');});}catch(error){expect((error as RootsGpuError).failureKind).toBe('device');expect((error as Error).cause).toBeInstanceOf(Error);}
 });
 it('keeps malformed prepared facts and callback failures outside device recovery',()=>{
  const p=prepareRootsDensityColor({settings:{rootDensityColorVersion:'mathart-1.7.8-metric-v1'}});if(p.kind!=='metric-sum')throw Error('source plan');
  const gl={},tone=new RootsDensityToneGpu(gl as WebGL2RenderingContext);
  for(const call of[()=>tone.render({} as WebGLTexture,1,1,{...p,gamma:NaN},{submittedFinitePointCount:1}),()=>tone.render({} as WebGLTexture,1,1,p,{submittedFinitePointCount:-1}),()=>rootsGpuCancel(()=>{throw Error('caller');})]){
   try{call();throw Error('accepted');}catch(error){expect(error).toBeInstanceOf(RootsGpuError);expect((error as RootsGpuError).failureKind).toBe('input');}
  }
  expect(tone.diagnostics().handles).toBe(0);
 });
 it('retains an owned failed-deletion handle for a later reset (simulated boundary)',()=>{
  const gpu=new RootsDensityGpu(),texture={},lose=vi.fn(),deletion=vi.fn().mockImplementationOnce(()=>{throw Error('delete failed');});
  const gl={deleteTexture:deletion,getExtension:()=>({loseContext:lose})};
  Object.assign(gpu,{gl,ink:texture,width:4,height:4});
  try{gpu.reset();throw Error('accepted');}catch(error){expect((error as RootsGpuError).failureKind).toBe('cleanup');}
  expect(gpu.diagnostics().cleanupPending).toBe(true);expect(gpu.diagnostics().handles).toBe(1);expect(lose).not.toHaveBeenCalled();
  gpu.reset();expect(deletion.mock.calls).toEqual([[texture],[texture]]);expect(lose).toHaveBeenCalledOnce();expect(gpu.diagnostics().handles).toBe(0);
 });
 it('retains both shader compilation and shader cleanup failures (simulated GL)',()=>{
  const deletion=vi.fn().mockImplementationOnce(()=>{throw Error('shader delete fault');}),lose=vi.fn();
  const gl={MAX_TEXTURE_SIZE:1,MAX_VIEWPORT_DIMS:2,CURRENT_PROGRAM:3,VERTEX_SHADER:4,FRAGMENT_SHADER:5,COMPILE_STATUS:6,
   getParameter:(key:number)=>key===1?16384:key===2?[16384,16384]:null,getExtension:(name:string)=>name==='WEBGL_lose_context'?{loseContext:lose}:{},
   createTexture:()=>({}),createFramebuffer:()=>({}),createBuffer:()=>({}),createVertexArray:()=>({}),createProgram:()=>({}),createShader:()=>({}),
   shaderSource:()=>{},compileShader:()=>{},getShaderParameter:()=>false,getShaderInfoLog:()=>'compiler fault',deleteShader:deletion,
   deleteTexture:()=>{},deleteFramebuffer:()=>{},deleteBuffer:()=>{},deleteVertexArray:()=>{},deleteProgram:()=>{}};
  vi.stubGlobal('OffscreenCanvas',class{getContext(){return gl;}});
  try{const gpu=new RootsDensityGpu();let thrown:unknown;try{gpu.initialize(2,2,'metric-sum');}catch(error){thrown=error;}
   expect(thrown).toBeInstanceOf(RootsGpuError);expect((thrown as RootsGpuError).failureKind).toBe('cleanup');expect(messages(thrown).join('\n')).toContain('compiler fault');expect(messages(thrown).join('\n')).toContain('shader delete fault');
   expect(gpu.diagnostics().handles).toBe(0);expect(deletion).toHaveBeenCalledTimes(2);
  }finally{vi.unstubAllGlobals();}
 });
 it('retains both tone device failure and failed tone cleanup without CPU replay',()=>{
  const plan=prepareRootsDensityColor({settings:{rootDensityColorVersion:'mathart-1.7.8-metric-v1'}});if(plan.kind!=='metric-sum')throw Error('source plan');
  const gpu=new RootsDensityGpu(),render=vi.fn(()=>{throw new RootsGpuError('tone device fault');}),dispose=vi.fn().mockImplementationOnce(()=>{throw new RootsGpuError('tone delete fault','cleanup');});
  const gl={isContextLost:()=>false,deleteTexture:()=>{},getExtension:()=>({loseContext:()=>{}})};
  Object.assign(gpu,{gl,width:1,height:1,kind:'metric-sum',ink:{},metricTone:{render,dispose}});let thrown:unknown;
  try{gpu.presentMetric(plan,{submittedFinitePointCount:0});}catch(error){thrown=error;}
  expect((thrown as RootsGpuError).failureKind).toBe('cleanup');expect(messages(thrown).join('\n')).toContain('tone device fault');expect(messages(thrown).join('\n')).toContain('tone delete fault');expect(render).toHaveBeenCalledOnce();expect(dispose).toHaveBeenCalledTimes(2);expect(gpu.diagnostics().handles).toBe(0);
 });
 it('presentation cleanup preserves borrowed context and retries only owned resources',()=>{
  const texture={},borrowedInk={},deleteTexture=vi.fn().mockImplementationOnce(()=>{throw Error('delete failed');});
  const gl={deleteTexture},tone=new RootsDensityToneGpu(gl as unknown as WebGL2RenderingContext);
  Object.assign(tone,{textures:[texture]});expect(()=>tone.dispose()).toThrow('cleanup');expect(tone.diagnostics().handles).toBe(1);tone.dispose();
  expect(deleteTexture.mock.calls).toEqual([[texture],[texture]]);expect(deleteTexture.mock.calls.every(([value])=>value!==borrowedInk)).toBe(true);expect(tone.diagnostics().handles).toBe(0);
 });
});
