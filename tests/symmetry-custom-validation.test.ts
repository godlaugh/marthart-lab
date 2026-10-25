import {afterEach,describe,expect,it,vi} from 'vitest';
import type {SceneDocument} from '../src/types';
const mocks=vi.hoisted(()=>({owners:[] as {generate:ReturnType<typeof vi.fn>;dispose:ReturnType<typeof vi.fn>;settledNativeCleanup:ReturnType<typeof vi.fn>}[]}));
vi.mock('../src/engine/client',()=>({Generator:class{
 generate=vi.fn(async()=>({backend:'native'}));dispose=vi.fn();settledNativeCleanup=vi.fn(async()=>{});
 constructor(){mocks.owners.push(this);}
}}));
vi.mock('../src/engine/symmetryCustomExecution',()=>({symmetryCustomExecutionBackend:()=> 'native'}));
vi.mock('../src/engine/symmetryEditing',()=>({symmetryCustomValidationInput:()=>({time:0,width:64,height:64})}));
import {beginSymmetryCustomValidation} from '../src/engine/symmetryCustomValidation';
const scene={} as SceneDocument;
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return{promise,resolve};}
afterEach(()=>{mocks.owners.length=0;});
describe('custom validation owner retirement',()=>{
 it('does not publish success until release acknowledges, including cancellation during release',async()=>{
  const job=beginSymmetryCustomValidation(scene),owner=mocks.owners[0],gate=deferred();owner.settledNativeCleanup.mockImplementation(()=>gate.promise);
  const observed=job.promise.then(()=> 'success',e=>e.name);await vi.waitFor(()=>expect(owner.settledNativeCleanup).toHaveBeenCalledOnce());
  let done=false;void observed.then(()=>{done=true;});await Promise.resolve();expect(done).toBe(false);
  job.cancel();gate.resolve();expect(await observed).toBe('AbortError');expect(owner.settledNativeCleanup).toHaveBeenCalledOnce();
 });
 it('retains failed cleanup and retries it before the next candidate generates',async()=>{
  const first=beginSymmetryCustomValidation(scene),owner=mocks.owners[0];owner.settledNativeCleanup.mockRejectedValueOnce(Error('release failed'));
  await expect(first.promise).rejects.toThrow('release failed');
  const gate=deferred();owner.settledNativeCleanup.mockImplementation(()=>gate.promise);
  const next=beginSymmetryCustomValidation(scene),second=mocks.owners[1];await vi.waitFor(()=>expect(owner.settledNativeCleanup).toHaveBeenCalledTimes(2));
  expect(second.generate).not.toHaveBeenCalled();gate.resolve();await next.promise;expect(second.generate).toHaveBeenCalledOnce();expect(second.settledNativeCleanup).toHaveBeenCalledOnce();
 });
});
