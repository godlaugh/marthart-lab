import {afterEach,describe,expect,it,vi} from 'vitest';
import {createScene,parseScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {generateDomain} from '../src/engine/domain';
import {domainGpu} from '../src/engine/domainGpu';
import {DomainGpuError} from '../src/engine/domainGpuFailure';
import {DomainRenderSession} from '../src/engine/domainRenderSession';
import {parseDomainRenderPolicy} from '../src/engine/domainRenderPolicy';
import {domainEvaluator,parseDomainModel} from '../src/engine/domainModel';
import {generateScene,TemporalGenerationSession} from '../src/engine/temporal';
import type {GenerateContext,SceneDocument,SceneOutput} from '../src/types';
const context:GenerateContext={width:17,height:13,time:0,quality:'export'};
const raster=(out:SceneOutput)=>{if(out.type!=='raster')throw Error('Expected raster');return out;};
const scene=()=>{
 const s=createScene(definition('domain'));s.parameters={};s.timeline.tracks=[];s.equations={f:'z+1',next:'w+100'};
 s.domainSourcePalette={colors:['#ff971a35','#ff168ac4','#ff23d96e']};
 Object.assign(s.settings,{domainRenderPolicy:'source-cpu-on-gpu-failure-v1',domainIterationVersion:'mathart-1.7.8-gpu',domainColorVersion:'mathart-1.7.8-gpu',domainViewportVersion:'mathart-1.7.8-gpu',domainBackend:'gpu',iterationEnabled:false,seedMode:'ZERO',curveMode:'PHASE_MODULUS',curveBias:.1,curveMix:.8,scale:2.5,rotation:.37});return s;
};
const wholeCpu=(s:SceneDocument)=>({...s,settings:{...s.settings,domainRenderPolicy:'source-cpu-always-v1'}});
const fail=()=>vi.spyOn(domainGpu,'render').mockImplementation(()=>{throw new DomainGpuError('compile','deliberate unit compile failure');});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();domainGpu.dispose();});
describe('Domain complete-render policy through production generation',()=>{
 it('preserves omission and rejects unknown explicit policies',()=>{
  expect(parseDomainRenderPolicy(undefined)).toBe('selected-rules-1723');
  for(const value of [null,false,0,'source-cpu'])expect(()=>parseDomainRenderPolicy(value)).toThrow();
  for(const value of ['selected-rules-1723','source-cpu-on-gpu-failure-v1','source-cpu-always-v1'])expect(parseDomainRenderPolicy(value)).toBe(value);
 });
 it('keeps omitted and explicit saved rules byte-identical on CPU',()=>{
  const s=scene();s.settings.domainBackend='cpu';delete s.settings.domainRenderPolicy;
  const a=raster(generateDomain(s,context)),b=raster(generateDomain({...s,settings:{...s.settings,domainRenderPolicy:'selected-rules-1723'}},context));
  expect(a.pixels).toEqual(b.pixels);expect(a.domainRender?.route).toBe('selected');expect(a.domainRender?.effective.formula).toBe('mathart-1.7.8-gpu');
 });
 it('switches formula, viewport and color together while retaining raw input and requested facts',()=>{
  const s=scene(),raw=JSON.stringify(s),session=new DomainRenderSession(),spy=fail();
  const out=raster(generateDomain(s,context,session)),expected=raster(generateDomain(wholeCpu(s),context));
  expect(out.pixels).toEqual(expected.pixels);expect(out.domainRender?.effective).toEqual({backend:'cpu',formula:'mathart-1.7.8-cpu',color:'mathart-1.7.8-cpu',viewport:'mathart-1.7.8-cpu'});
  expect(out.domainRender?.requested).toEqual({backend:'gpu',formula:'mathart-1.7.8-gpu',color:'mathart-1.7.8-gpu',viewport:'mathart-1.7.8-gpu'});
  expect(out.domainRender?.route).toBe('source-cpu-failure');expect(out.domainRender?.sticky).toBe(false);expect(out.domainRender?.trigger?.stage).toBe('compile');
  expect(out.stats.samples).toBe(221);expect(out.stats.generated+out.stats.invalid).toBe(221);expect(JSON.stringify(s)).toBe(raw);expect(spy).toHaveBeenCalledOnce();
  // Source CPU executes disabled next once; the GPU rule ignores it. This is
  // the source-derived semantic counterexample, not a CPU/GPU tolerance test.
  const cpu=structuredClone(s);Object.assign(cpu.settings,{domainIterationVersion:'mathart-1.7.8-cpu'});
  expect(domainEvaluator(parseDomainModel(cpu,0))([2,3])).toEqual([100,0]);expect(domainEvaluator(parseDomainModel(s,0))([2,3])).toEqual([1,0]);
 });
 it('recovers the captured CPU constant instead of cloning a GPU no-upload zero',()=>{
  const s=scene();s.equations={f:'z',next:'w'};Object.assign(s.settings,{iterationEnabled:true,iterationSteps:2,seedMode:'CONSTANT_C',constantReal:.3,constantImag:.7});
  expect(parseDomainModel(s,0).constant).toEqual([0,0]);fail();const out=raster(generateDomain(s,context,new DomainRenderSession()));
  expect(out.domainRender?.constant).toEqual([Math.fround(.3),Math.fround(.7)]);expect(out.pixels).toEqual(raster(generateDomain(wholeCpu(s),context)).pixels);
 });
 it('reuses one full export RGBA buffer and replaces partial GPU pixels and counters on whole-chain failure',()=>{
  const s=scene(),expected=raster(generateDomain(wholeCpu(s),context)),allocations:Uint8ClampedArray[]=[];
  const bytes=context.width!*context.height!*4;
  vi.stubGlobal('Uint8ClampedArray',new Proxy(Uint8ClampedArray,{construct(target,args,newTarget){const value=Reflect.construct(target,args,newTarget) as Uint8ClampedArray;if(value.length===bytes)allocations.push(value);return value;}}));
  let failedPixels:Uint8ClampedArray|undefined;
  vi.spyOn(domainGpu,'render').mockImplementation((_model,_width,_height,pixels)=>{failedPixels=pixels;pixels.fill(117,0,73);throw new DomainGpuError('readback','partial GPU task failed');});
  const out=raster(generateDomain(s,context,new DomainRenderSession()));
  expect(allocations).toHaveLength(1);expect(out.pixels).toBe(failedPixels);expect(out.pixels).toBe(allocations[0]);expect(out.pixels).toEqual(expected.pixels);
  expect(out.domainRender?.route).toBe('source-cpu-failure');
  expect({samples:out.stats.samples,generated:out.stats.generated,invalid:out.stats.invalid}).toEqual({samples:expected.stats.samples,generated:expected.stats.generated,invalid:expected.stats.invalid});
 });
 it('keeps failure for edits/time, isolates scene identity and clears only on explicit reset',()=>{
  const s=scene(),session=new DomainRenderSession(),spy=fail();generateDomain(s,context,session);
  const edited={...s,equations:{f:'z+2'},parameters:{a:.5}};const warm=raster(generateDomain(edited,{...context,time:1.05},session));
  expect(warm.domainRender?.sticky).toBe(true);expect(warm.pixels).toEqual(raster(generateDomain(wholeCpu(edited),{...context,time:1.05})).pixels);expect(spy).toHaveBeenCalledOnce();
  const other={...edited,id:s.id+'-other'};generateDomain(other,context,session);expect(spy).toHaveBeenCalledTimes(2);
  session.reset();generateDomain(other,context,session);expect(spy).toHaveBeenCalledTimes(3);
 });
 it('does not trigger a fresh failure for explicit CPU or precision admission',()=>{
  const s=scene(),session=new DomainRenderSession(),spy=fail();s.settings.domainBackend='cpu';
  const cpu=raster(generateDomain(s,context,session));expect(cpu.domainRender?.route).toBe('selected');expect(cpu.domainRender?.effective.formula).toBe('mathart-1.7.8-gpu');expect(session.failure()).toBeUndefined();
  s.settings.domainBackend='gpu';s.settings.domainViewportVersion='mathart-1.7.8-cpu';
  const admitted=raster(generateDomain(s,context,session));expect(admitted.domainRender?.route).toBe('selected');expect(admitted.domainRender?.effective.color).toBe('mathart-1.7.8-gpu');expect(spy).not.toHaveBeenCalled();expect(session.failure()).toBeUndefined();
 });
 it('prepares the latched source CPU tuple before validating edited inactive local colors',()=>{
  const s=scene(),session=new DomainRenderSession(),spy=fail();s.settings.domainColorVersion='local-v1';
  generateDomain(s,context,session);
  const edited={...s,settings:{...s.settings,phaseSharpness:.001,modSharpness:.001}};
  expect(()=>parseDomainModel(edited,0)).toThrow();
  const out=raster(generateDomain(edited,context,session));
  expect(out.domainRender?.sticky).toBe(true);expect(out.domainRender?.requested.color).toBe('local-v1');
  expect(out.pixels).toEqual(raster(generateDomain(wholeCpu(edited),context)).pixels);expect(spy).toHaveBeenCalledOnce();
 });
 it('forces source CPU without GPU allocation, including an authored local tuple',()=>{
  const s=scene(),spy=fail();Object.assign(s.settings,{domainRenderPolicy:'source-cpu-always-v1',domainIterationVersion:'local-v1',domainViewportVersion:'local-v1',domainColorVersion:'local-v1'});
  const out=raster(generateDomain(s,context,new DomainRenderSession()));expect(out.backend).toBe('cpu');expect(out.domainRender?.route).toBe('source-cpu-forced');expect(out.domainRender?.effective.formula).toBe('mathart-1.7.8-cpu');expect(spy).not.toHaveBeenCalled();
 });
 it('classifies native main-w compile impossibility as source-program and retains authored source',()=>{
  const s=scene(),session=new DomainRenderSession(),spy=fail();s.equations={f:'w+1'};const raw=JSON.stringify(s);
  const out=raster(generateDomain(s,context,session));expect(out.domainRender?.trigger?.stage).toBe('source-program');expect(out.domainRender?.route).toBe('source-cpu-failure');expect(session.failure()?.stage).toBe('source-program');expect(JSON.stringify(s)).toBe(raw);expect(spy).not.toHaveBeenCalled();
 });
 it.each([new Error('CPU callback / unknown invariant'),new RangeError('local capacity'),new DOMException('cancel','AbortError')])('propagates non-device failure without poisoning the renderer: %s',error=>{
  const s=scene(),session=new DomainRenderSession();vi.spyOn(domainGpu,'render').mockImplementation(()=>{throw error;});
  expect(()=>generateDomain(s,context,session)).toThrow(error);expect(session.failure()).toBeUndefined();
 });
 it('rejects export capacity and initial cancellation before entering GPU or recording failure',()=>{
  const s=scene(),spy=fail(),session=new DomainRenderSession();
  expect(()=>generateDomain(s,{...context,width:16384,height:16384},session)).toThrow(/预算/);expect(session.failure()).toBeUndefined();
  expect(()=>generateDomain(s,{...context,isCancelled:()=>true},session)).toThrow(/取消/);expect(session.failure()).toBeUndefined();expect(spy).not.toHaveBeenCalled();
 });
 it('validates dimensions before a main-w source-program failure can latch',()=>{
  const s=scene(),spy=fail();s.equations={f:'w+1'};
  for(const size of [{width:0,height:13},{width:17.5,height:13},{width:16384,height:16384}]){
   const session=new DomainRenderSession();expect(()=>generateDomain(s,{...context,...size},session)).toThrow();expect(session.failure()).toBeUndefined();
  }
  expect(spy).not.toHaveBeenCalled();
 });
 it('keeps explicit Temporal sessions across edits and resets when leaving the Domain scene',()=>{
  const s=scene(),session=new TemporalGenerationSession(),spy=fail();const first=raster(generateScene(s,context,session));expect(first.domainRender?.sticky).toBe(false);
  s.settings.centerX=.3;expect(raster(generateScene(s,{...context,time:.5},session)).domainRender?.sticky).toBe(true);expect(spy).toHaveBeenCalledOnce();
  const other=createScene(definition('domain'));other.id=s.id+'-other';Object.assign(other.settings,{domainBackend:'cpu'});generateScene(other,context,session);
  expect(raster(generateScene(s,context,session)).domainRender?.sticky).toBe(false);expect(spy).toHaveBeenCalledTimes(2);session.reset();
 });
 it('persists authored policy but never writes delivered runtime failure facts into scene JSON',()=>{
  const s=scene(),raw=JSON.stringify(s);fail();generateDomain(s,context,new DomainRenderSession());
  expect(JSON.stringify(s)).toBe(raw);const loaded=parseScene(raw);expect(loaded.settings.domainRenderPolicy).toBe('source-cpu-on-gpu-failure-v1');expect('domainRender'in loaded).toBe(false);
 });
});
