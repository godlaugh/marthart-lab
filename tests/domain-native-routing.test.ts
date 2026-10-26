import {afterEach,describe,expect,it,vi} from 'vitest';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {generateDomain,generateDomainAsync,usesDomainNativeRendering} from '../src/engine/domain';
import {DomainRenderSession} from '../src/engine/domainRenderSession';
import {SOURCE_FRAME_BUDGET} from '../src/engine/sourceDrawingFrame';
import {SourceNativeError} from '../src/engine/sourceNativeError';
import * as transport from '../src/engine/sourceNativeClient';
import * as lease from '../src/engine/sourceNativeLease';
import {domainGpu} from '../src/engine/domainGpu';
import type {GenerateContext} from '../src/types';
const context:GenerateContext={width:4,height:3,time:0,quality:'export',domainTarget:{logicalWidth:2,logicalHeight:3,pixelDensity:1}};
const target={...context,width:2};
const source=()=>{const s=createScene(definition('domain'));s.parameters={};s.timeline.tracks=[];s.equations={f:'z'};Object.assign(s.settings,{domainIterationVersion:'mathart-1.7.8-gpu',domainColorVersion:'mathart-1.7.8-gpu',domainViewportVersion:'mathart-1.7.8-gpu',domainRenderPolicy:'source-cpu-on-gpu-failure-v1'});return s;};
function native(){vi.spyOn(lease,'ensureSourceNativeLease').mockResolvedValue();vi.stubEnv('VITE_SOURCE_RENDERER','native');return vi.spyOn(transport,'renderSourceNativeFrame').mockImplementation(async frame=>({width:frame.width,height:frame.height,pixels:new Uint8ClampedArray(frame.width*frame.height*4).fill(255),generation:frame.generation,sequence:frame.sequence,rendererIdentity:'a'.repeat(64),requestBytes:100}));}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();domainGpu.dispose();});
describe('Domain native adapter and common policy owner',()=>{
 it('binds complete-source native pixels to requested facts without CPU repair',async()=>{
  const render=native(),gpu=vi.spyOn(domainGpu,'render'),scene=source(),before=structuredClone(scene);
  const output=await generateDomainAsync(scene,target,undefined,{retainedBytes:24});
  expect(output.backend).toBe('native');expect(output.sourcePixelRenderer).toMatchObject({backend:'native',identity:'a'.repeat(64),samples:0});
  expect(output.domainRender).toMatchObject({route:'selected',sticky:false,effective:{backend:'native'},target:{logicalWidth:2,logicalHeight:3,presentation:'direct',sampling:'physical-fragments'}});
  expect(output.stats).toMatchObject({samples:6,generated:6,invalid:0});expect(gpu).not.toHaveBeenCalled();expect(render.mock.calls[0][1]).toEqual({retainedBytes:24});expect(scene).toEqual(before);
 });
 it('keeps explicit CPU and forced CPU byte-identical to synchronous production',async()=>{
  const render=native();for(const forced of [false,true]){const s=source();if(forced)s.settings.domainRenderPolicy='source-cpu-always-v1';else s.settings.domainBackend='cpu';
   const sync=generateDomain(s,target),async=await generateDomainAsync(s,target);expect(async.pixels).toEqual(sync.pixels);expect(async.domainRender).toEqual(sync.domainRender);expect(usesDomainNativeRendering(s)).toBe(false);
  }expect(render).not.toHaveBeenCalled();
 });
 it('uses the shared source-program preflight and sticky recovery before choosing transport',async()=>{
  const render=native(),s=source(),owner=new DomainRenderSession();s.equations.f='w+1';
  const first=await generateDomainAsync(s,target,owner);expect(first.domainRender).toMatchObject({route:'source-cpu-failure',sticky:false,trigger:{stage:'source-program'},effective:{backend:'cpu'}});
  s.equations.f='z';const second=await generateDomainAsync(s,target,owner);expect(second.domainRender).toMatchObject({route:'source-cpu-failure',sticky:true});expect(render).not.toHaveBeenCalled();
  owner.reset();expect((await generateDomainAsync(s,target,owner)).backend).toBe('native');expect(render).toHaveBeenCalledOnce();
 });
 it.each(['context','compile','link','allocation','render','readback'] as const)('recovers only a native GL %s stage through the shared sticky owner',async stage=>{
  const render=native(),s=source(),owner=new DomainRenderSession();render.mockRejectedValueOnce(new SourceNativeError('runtime','native operation failed',stage));
  const result=await generateDomainAsync(s,target,owner),cpu=generateDomain({...s,settings:{...s.settings,domainRenderPolicy:'source-cpu-always-v1'}},target);
  expect(result.pixels).toEqual(cpu.pixels);expect(result.domainRender).toMatchObject({route:'source-cpu-failure',sticky:false,trigger:{stage},effective:{backend:'cpu'}});
  expect((await generateDomainAsync(s,target,owner)).domainRender?.sticky).toBe(true);expect(render).toHaveBeenCalledOnce();
 });
 it.each(['unavailable','capacity','protocol','runtime','cleanup','timeout'] as const)('retains %s transport failure rather than inventing a GPU/CPU transition',async kind=>{
  const render=native(),owner=new DomainRenderSession(),error=new SourceNativeError(kind,'deliberate native boundary rejection');render.mockRejectedValueOnce(error);
  await expect(generateDomainAsync(source(),target,owner)).rejects.toBe(error);expect(owner.failure()).toBeUndefined();expect(render).toHaveBeenCalledOnce();
 });
 it('waits for native ACK before dropping a cancelled result',async()=>{
  const render=native();let finish!:()=>void,cancelled=false,settled=false;
  render.mockImplementationOnce(frame=>new Promise(resolve=>{finish=()=>resolve({width:frame.width,height:frame.height,pixels:new Uint8ClampedArray(frame.width*frame.height*4),generation:frame.generation,sequence:frame.sequence,rendererIdentity:'a'.repeat(64),requestBytes:100});}));
  const pending=generateDomainAsync(source(),{...target,isCancelled:()=>cancelled});void pending.catch(()=>{settled=true;});await vi.waitFor(()=>expect(render).toHaveBeenCalledOnce());cancelled=true;await Promise.resolve();expect(settled).toBe(false);expect(render.mock.calls[0][1]).not.toHaveProperty('signal');finish();await expect(pending).rejects.toMatchObject({name:'AbortError'});
 });
 it('rejects invalid dimensions/retained budgets before transport or sticky mutation',async()=>{
  const render=native(),owner=new DomainRenderSession();await expect(generateDomainAsync(source(),context,owner)).rejects.toThrow('物理尺寸');
  await expect(generateDomainAsync(source(),target,owner,{retainedBytes:-1})).rejects.toThrow('保留像素');expect(render).not.toHaveBeenCalled();expect(owner.failure()).toBeUndefined();
 });
 it('charges retained output even on forced/sticky CPU and before CPU allocation',async()=>{
  const render=native(),s=source(),owner=new DomainRenderSession();s.settings.domainRenderPolicy='source-cpu-always-v1';
  await expect(generateDomainAsync(s,target,owner,{retainedBytes:SOURCE_FRAME_BUDGET-23})).rejects.toMatchObject({kind:'capacity'});
  expect((await generateDomainAsync(s,target,owner,{retainedBytes:SOURCE_FRAME_BUDGET-24})).backend).toBe('cpu');
  s.settings.domainRenderPolicy='source-cpu-on-gpu-failure-v1';owner.select(s.id);owner.fail({stage:'compile',reason:'earlier observed compile failure'});
  await expect(generateDomainAsync(s,target,owner,{retainedBytes:SOURCE_FRAME_BUDGET-23})).rejects.toThrow('临时缓冲');expect(render).not.toHaveBeenCalled();
 });
 it('includes logical CPU image and GPU linear-presentation storage in the same bound',async()=>{
  native();const s=source();s.settings.domainRenderPolicy='source-cpu-always-v1';const c={...context,width:4,height:6,domainTarget:{logicalWidth:2,logicalHeight:3,pixelDensity:2}};
  // physical96 + logical24 + textures120 + one row16 =256 bytes.
  await expect(generateDomainAsync(s,c,undefined,{retainedBytes:SOURCE_FRAME_BUDGET-255})).rejects.toMatchObject({kind:'capacity'});
 });
 it('keeps mixed/local/supersampled source extensions outside the native selector',()=>{
  const s=source();expect(usesDomainNativeRendering(s)).toBe(true);
  for(const [key,value] of [['domainColorVersion','local-v1'],['domainViewportVersion','mathart-1.7.8-cpu'],['domainIterationVersion','local-v1'],['supersampling',2]] as const)expect(usesDomainNativeRendering({...s,settings:{...s.settings,[key]:value}})).toBe(false);
 });
});
