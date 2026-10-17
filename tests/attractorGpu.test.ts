import {afterEach,describe,expect,it,vi} from 'vitest';
import {AttractorGpu,attractorGpuBytes,attractorGpuFieldSource} from '../src/engine/attractorGpu';
import {parseAttractorInitial} from '../src/engine/attractorSeeds';
import {prepareAttractorFrame} from '../src/scenes/geometry';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
const scene=()=>{const s=createScene(definition('attractor'));s.parameters={a:2,e:7};s.equations={dx:'a*x+e+t',dy:'time+y',dz:'z'};Object.assign(s.settings,{particleCount:3,burnIn:0,staggerMin:0,staggerMax:0,initialSpread:0});return s;};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('Attractor GPU expression and resource admission',()=>{
 it('maps coordinates, physical RK4 time and explicit e safely and excludes values from shader identity',()=>{
  const s=scene(),a=attractorGpuFieldSource(prepareAttractorFrame(s).field);s.parameters={e:9,a:4};const b=attractorGpuFieldSource(prepareAttractorFrame(s).field);
  expect(a.key).toBe(b.key);expect(a.uniforms.parameter1).toBe(7);expect(b.uniforms.parameter1).toBe(9);expect(a.source).toContain('samplePosition.x');expect(a.source).toContain('parameter2=physicalTime,parameter3=physicalTime');expect(a.source).not.toMatch(/isnan|isinf/);
 });
 it('rejects undeclared symbols, executable syntax and nonfinite inputs before GL',()=>{
  const field=prepareAttractorFrame(scene()).field;
  for(const equation of ['x=1','x.foo','[x,y]','import("x")','unknown+x','1e100'])expect(()=>attractorGpuFieldSource({...field,equations:[equation,'y','z']})).toThrow();
  for(const name of ['x','t','time','constructor','sin','a;discard'])expect(()=>attractorGpuFieldSource({...field,parameters:{[name]:1}})).toThrow();
  for(const value of [NaN,Infinity,1e40,1e-40,1e-100])expect(()=>attractorGpuFieldSource({...field,parameters:{a:value}})).toThrow();
 });
 it('accounts for resident and known peak allocations at the requested count',()=>{
  expect(attractorGpuBytes(2_000_000)).toEqual({retainedBytes:160_000_000,estimatedPeakBytes:322_097_152});
  expect(attractorGpuBytes(1)).toEqual({retainedBytes:80,estimatedPeakBytes:192});for(const count of [0,-1,2_000_001,1.5,Infinity])expect(()=>attractorGpuBytes(count)).toThrow();
  const allocated=vi.fn();vi.stubGlobal('OffscreenCanvas',class{constructor(){allocated();}});const gpu=new AttractorGpu(),config=parseAttractorInitial(scene().settings);
  expect(()=>gpu.initialize({...config,count:2_000_001})).toThrow();expect(()=>gpu.initialize(config,()=>true)).toThrow(/cancelled/);expect(allocated).not.toHaveBeenCalled();
 });
});
/** Failure-injection only. Real numerical and state-transition assertions live in
 * scripts/verify-attractor-gpu.mjs and run against actual WebGL2. */
function fixture(failure:'allocate'|'compile'|'draw'|'read'|'none'){
 const live=new Map<object,string>(),tokens=new Map<string,number>();let buffers=0,lost=0,active=false,ended=0;
 const token=(key:string)=>{if(!tokens.has(key))tokens.set(key,tokens.size+1);return tokens.get(key)!;};
 const gl=new Proxy({}as WebGL2RenderingContext,{get(_target,key:string){
  if(/^[A-Z_0-9]+$/.test(key))return token(key);if(key==='isContextLost')return()=>false;if(key==='getParameter')return()=>1024;if(key==='getError')return()=>token('NO_ERROR');if(key==='getShaderParameter')return()=>failure!=='compile';if(key==='getProgramParameter')return()=>true;if(key==='getShaderInfoLog'||key==='getProgramInfoLog')return()=> 'injected';if(key==='getUniformLocation')return()=>null;if(key==='getExtension')return()=>({loseContext(){lost++;}});
  if(key.startsWith('create'))return()=>{if(key==='createBuffer'&&++buffers===3&&failure==='allocate')return null;const resource={};live.set(resource,key.slice(6));return resource;};if(key.startsWith('delete'))return(resource:object|null)=>{if(resource)live.delete(resource);};
  if(key==='beginTransformFeedback')return()=>{active=true;};if(key==='endTransformFeedback')return()=>{active=false;ended++;};if(key==='drawArrays')return()=>{if(failure==='draw')throw Error('draw failed');};if(key==='getBufferSubData')return()=>{if(failure==='read')throw Error('read failed');};return()=>{};
 }});vi.stubGlobal('OffscreenCanvas',class{getContext(){return gl;}});return{live,get lost(){return lost;},get active(){return active;},get ended(){return ended;}};
}
describe('Attractor GPU owned lifecycle',()=>{
 for(const failure of ['allocate','compile','draw','read']as const)it(`cleans every owned object after partial ${failure} failure`,()=>{
  const state=fixture(failure),s=scene(),gpu=new AttractorGpu();expect(()=>{gpu.initialize(parseAttractorInitial(s.settings));gpu.advance(prepareAttractorFrame(s),1,1,true);gpu.snapshot();}).toThrow();expect(state.live.size).toBe(0);expect(state.active).toBe(false);expect(state.lost).toBe(1);expect(gpu.diagnostics()).toMatchObject({particleCount:0,retainedBytes:0,context:false,programs:0});gpu.dispose();expect(state.lost).toBe(1);
 });
 it('cleans successful state once and does not touch other contexts',()=>{const state=fixture('none'),s=scene(),gpu=new AttractorGpu();gpu.initialize(parseAttractorInitial(s.settings));gpu.advance(prepareAttractorFrame(s),513,.5,false);expect(gpu.diagnostics()).toMatchObject({particleCount:3,partial:true,programs:1});expect(state.ended).toBe(3);gpu.dispose();expect(state.live.size).toBe(0);expect(state.lost).toBe(1);gpu.dispose();expect(state.lost).toBe(1);});
 it('cancels between bounded draws, clears partial state and preserves AbortError',()=>{const state=fixture('none'),s=scene(),gpu=new AttractorGpu();gpu.initialize(parseAttractorInitial(s.settings));let checks=0;try{gpu.advance(prepareAttractorFrame(s),1000,1,true,()=>++checks>3);throw Error('expected abort');}catch(error){expect(error).toBeInstanceOf(DOMException);expect((error as DOMException).name).toBe('AbortError');}expect(state.ended).toBe(1);expect(state.live.size).toBe(0);expect(gpu.diagnostics().context).toBe(false);});
 it('rejects malformed advancement before drawing and never exposes stale state',()=>{const state=fixture('none'),s=scene(),gpu=new AttractorGpu();gpu.initialize(parseAttractorInitial(s.settings));expect(()=>gpu.advance(prepareAttractorFrame(s),.5,1,true)).toThrow();expect(state.ended).toBe(0);expect(state.live.size).toBe(0);expect(()=>gpu.snapshot()).toThrow('not initialized');});
 it('bounds compiled programs and recompiles only after structural edits or eviction',()=>{const state=fixture('none'),s=scene(),gpu=new AttractorGpu();gpu.initialize(parseAttractorInitial(s.settings));const job=prepareAttractorFrame(s);gpu.advance(job,1,1,true);job.field.parameters.a=7;gpu.advance(job,1,1,true);expect(gpu.diagnostics()).toMatchObject({fieldCompiles:1,programs:1});for(let i=0;i<10;i++){job.field.equations[0]=`x+${i}`;gpu.advance(job,1,1,true);}expect(gpu.diagnostics()).toMatchObject({fieldCompiles:11,programs:8});expect([...state.live.values()].filter(type=>type==='Program')).toHaveLength(8);gpu.dispose();expect(state.live.size).toBe(0);});
 it('rejects a fractional dt that would flush to zero before any step is drawn',()=>{const state=fixture('none'),s=scene(),gpu=new AttractorGpu();gpu.initialize(parseAttractorInitial(s.settings));expect(()=>gpu.advance(prepareAttractorFrame(s),1,1e-37,true)).toThrow('underflows');expect(state.ended).toBe(0);expect(state.live.size).toBe(0);});
});
