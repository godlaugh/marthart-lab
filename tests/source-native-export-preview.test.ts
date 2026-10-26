import {describe,expect,it,vi} from 'vitest';
import {SourceNativeExportPreview} from '../src/engine/sourceNativeExportPreview';
describe('Native independent export holds preview inputs without advancing history',()=>{
 it('opening and closing an unchanged preview does not schedule another display',()=>{
  const owner=new SourceNativeExportPreview(),input=[{},[500,600],0];expect(owner.defer(input)).toBe(false);
  const token=owner.open(input);expect(owner.owns(token)).toBe(true);expect(owner.defer([...input])).toBe(true);
  expect(owner.close()).toBe(false);expect(owner.active).toBe(false);expect(owner.owns(token)).toBe(false);
 });
 it('drains the single RAF input already scheduled at open, then defers later input',()=>{
  const owner=new SourceNativeExportPreview(),scene={},viewport={},previous=[scene,viewport,0],scheduled=[scene,viewport,1];owner.defer(previous);owner.open(scheduled);
  expect(owner.defer(scheduled)).toBe(false);expect(owner.defer(scheduled)).toBe(true);expect(owner.close()).toBe(false);
 });
 it('holds resized and edited inputs until close, then permits their latest request once',()=>{
  const owner=new SourceNativeExportPreview(),initial=[{},[500,600],0];owner.defer(initial);owner.open(initial);
  const resized=[initial[0],[600,600],0],edited=[{},resized[1],0];expect(owner.defer(resized)).toBe(true);expect(owner.defer(edited)).toBe(true);
  expect(owner.close()).toBe(true);expect(owner.defer(edited)).toBe(false);owner.open(edited);expect(owner.close()).toBe(false);
 });
 it('drains a reserved RAF input even if React coalesces a resize before its first effect',()=>{
  const owner=new SourceNativeExportPreview(),scene={},viewport={},previous=[scene,viewport,0],scheduled=[scene,viewport,1];owner.defer(previous);owner.open(scheduled);
  const coalesced=[scene,{},1];expect(owner.defer(coalesced)).toBe(false);expect(owner.defer(coalesced)).toBe(true);expect(owner.close()).toBe(false);
 });
 it('does not manufacture a redraw when a deferred input returns to the submitted identity',()=>{
  const owner=new SourceNativeExportPreview(),initial=[{},0];owner.defer(initial);owner.open(initial);owner.defer([{},1]);owner.defer(initial);expect(owner.close()).toBe(false);
 });
 it('does not let an old pause acknowledgement mark a later dialog ready',()=>{
  const owner=new SourceNativeExportPreview(),input=[{},0],old=owner.open(input);owner.close();const current=owner.open(input);
  expect(owner.owns(old)).toBe(false);expect(owner.owns(current)).toBe(true);expect(()=>owner.open(input)).toThrow('已占用');
 });
});
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};};
describe('Deterministic native preview resource handoff',()=>{
 it('distinguishes fixed-time input committed before its generation effect',async()=>{
  const owner=new SourceNativeExportPreview(),scope={},release=vi.fn(async()=>{}),old=[scope,0],next=[scope,1/30];owner.defer(old,{scope,time:0});
  owner.open(next,{fixedInput:{scope,time:1/30},releasePreview:release});expect(await owner.preparePresented()).toBe(false);
  expect(owner.defer(next,{scope,time:1/30})).toBe(false);expect(await owner.preparePresented()).toBe(true);expect(release).toHaveBeenCalledTimes(1);await owner.closeAfterCleanup(async()=>{});
 });
 it('retains precommit RAF identity until that exact time is submitted, including resize coalescing',async()=>{
  const owner=new SourceNativeExportPreview(),scope={},view={},release=vi.fn(async()=>{}),old=[scope,view,0],next=[scope,{},.01];owner.defer(old,{scope,time:0});
  owner.reserveFixedInput(scope,.01);owner.open(old,{fixedInput:{scope,time:0},releasePreview:release});
  expect(owner.defer(old,{scope,time:0})).toBe(true);expect(await owner.preparePresented()).toBe(false);expect(release).not.toHaveBeenCalled();
  expect(owner.defer(next,{scope,time:.01})).toBe(false);expect(await owner.preparePresented()).toBe(true);expect(await owner.closeAfterCleanup(async()=>{})).toBe(true);
  owner.defer(next,{scope,time:.01});owner.open(next,{fixedInput:{scope,time:.01}});expect(owner.close()).toBe(false);
 });
 it('does not carry an abandoned fixed request into a replacement document',async()=>{
  const owner=new SourceNativeExportPreview(),old={},next={},input=[next,0];owner.defer([old,0],{scope:old,time:0});owner.reserveFixedInput(old,1);
  owner.defer(input,{scope:next,time:0});owner.open(input,{fixedInput:{scope:next,time:0}});expect(await owner.preparePresented()).toBe(true);expect(owner.close()).toBe(false);
 });
 it('waits for the reserved input and release ACK, then rebuilds unchanged input on close',async()=>{
  const owner=new SourceNativeExportPreview(),input=[{},0],ack=deferred(),release=vi.fn(()=>ack.promise);
  owner.open(input,{releasePreview:release});expect(await owner.preparePresented()).toBe(false);expect(release).not.toHaveBeenCalled();
  expect(owner.defer(input)).toBe(false);const preparing=owner.preparePresented();await Promise.resolve();expect(release).toHaveBeenCalledTimes(1);expect(owner.ready).toBe(false);
  ack.resolve();expect(await preparing).toBe(true);expect(owner.ready).toBe(true);expect(()=>owner.close()).toThrow('等待清理');
  expect(await owner.closeAfterCleanup(async()=>{})).toBe(true);expect(owner.active).toBe(false);expect(owner.defer(input)).toBe(false);
 });
 it('closing during release waits for both exact owners and cannot publish late readiness',async()=>{
  const owner=new SourceNativeExportPreview(),input=[{},0],release=deferred(),cleanup=deferred(),flush=vi.fn(()=>cleanup.promise);
  owner.defer(input);owner.open(input,{releasePreview:()=>release.promise});const preparing=owner.preparePresented(),closing=owner.closeAfterCleanup(flush);
  expect(owner.closeAfterCleanup(flush)).toBe(closing);expect(owner.closing).toBe(true);expect(owner.ready).toBe(false);expect(owner.active).toBe(true);expect(flush).not.toHaveBeenCalled();
  release.resolve();expect(await preparing).toBe(false);await Promise.resolve();expect(flush).toHaveBeenCalledTimes(1);expect(owner.active).toBe(true);
  cleanup.resolve();expect(await closing).toBe(true);expect(owner.active).toBe(false);
 });
 it('retains failed preview release, never grants export, and retries on explicit close',async()=>{
  const owner=new SourceNativeExportPreview(),input=[{},0],failure=Error('release ACK missing'),release=vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
  owner.defer(input);owner.open(input,{releasePreview:release});await expect(owner.preparePresented()).rejects.toBe(failure);expect(owner.ready).toBe(false);expect(owner.active).toBe(true);
  await expect(owner.preparePresented()).rejects.toBe(failure);expect(release).toHaveBeenCalledTimes(1);
  expect(await owner.closeAfterCleanup(async()=>{})).toBe(true);expect(release).toHaveBeenCalledTimes(2);expect(owner.active).toBe(false);
 });
 it('keeps the export lease after failed export cleanup and does not release preview twice',async()=>{
  const owner=new SourceNativeExportPreview(),input=[{},0],release=vi.fn(async()=>{}),flush=vi.fn().mockRejectedValueOnce(Error('export resource retained')).mockResolvedValue(undefined);
  owner.defer(input);owner.open(input,{releasePreview:release});await owner.preparePresented();
  await expect(owner.closeAfterCleanup(flush)).rejects.toThrow('export resource retained');expect(owner.active).toBe(true);expect(owner.closing).toBe(false);expect(owner.ready).toBe(false);expect(owner.defer([{},1])).toBe(true);
  expect(await owner.closeAfterCleanup(flush)).toBe(true);expect(release).toHaveBeenCalledTimes(1);expect(flush).toHaveBeenCalledTimes(2);
 });
 it('closing before presentation leaves the resource and unchanged history alone',async()=>{
  const owner=new SourceNativeExportPreview(),input=[{},0],release=vi.fn(async()=>{});owner.defer(input);owner.open(input,{releasePreview:release});
  expect(await owner.closeAfterCleanup(async()=>{})).toBe(false);expect(release).not.toHaveBeenCalled();expect(await owner.preparePresented()).toBe(false);
 });
});
