import {describe,expect,it} from 'vitest';
import {SourceSamilaExportPreview} from '../src/engine/sourceSamilaExportPreview';
describe('Samila independent export holds preview inputs without advancing history',()=>{
 it('opening and closing an unchanged preview does not schedule another display',()=>{
  const owner=new SourceSamilaExportPreview(),input=[{},[500,600],0];expect(owner.defer(input)).toBe(false);
  const token=owner.open(input);expect(owner.owns(token)).toBe(true);expect(owner.defer([...input])).toBe(true);
  expect(owner.close()).toBe(false);expect(owner.active).toBe(false);expect(owner.owns(token)).toBe(false);
 });
 it('drains the single RAF input already scheduled at open, then defers later input',()=>{
  const owner=new SourceSamilaExportPreview(),scene={},viewport={},previous=[scene,viewport,0],scheduled=[scene,viewport,1];owner.defer(previous);owner.open(scheduled);
  expect(owner.defer(scheduled)).toBe(false);expect(owner.defer(scheduled)).toBe(true);expect(owner.close()).toBe(false);
 });
 it('holds resized and edited inputs until close, then permits their latest request once',()=>{
  const owner=new SourceSamilaExportPreview(),initial=[{},[500,600],0];owner.defer(initial);owner.open(initial);
  const resized=[initial[0],[600,600],0],edited=[{},resized[1],0];expect(owner.defer(resized)).toBe(true);expect(owner.defer(edited)).toBe(true);
  expect(owner.close()).toBe(true);expect(owner.defer(edited)).toBe(false);owner.open(edited);expect(owner.close()).toBe(false);
 });
 it('drains a reserved RAF input even if React coalesces a resize before its first effect',()=>{
  const owner=new SourceSamilaExportPreview(),scene={},viewport={},previous=[scene,viewport,0],scheduled=[scene,viewport,1];owner.defer(previous);owner.open(scheduled);
  const coalesced=[scene,{},1];expect(owner.defer(coalesced)).toBe(false);expect(owner.defer(coalesced)).toBe(true);expect(owner.close()).toBe(false);
 });
 it('does not manufacture a redraw when a deferred input returns to the submitted identity',()=>{
  const owner=new SourceSamilaExportPreview(),initial=[{},0];owner.defer(initial);owner.open(initial);owner.defer([{},1]);owner.defer(initial);expect(owner.close()).toBe(false);
 });
 it('does not let an old pause acknowledgement mark a later dialog ready',()=>{
  const owner=new SourceSamilaExportPreview(),input=[{},0],old=owner.open(input);owner.close();const current=owner.open(input);
  expect(owner.owns(old)).toBe(false);expect(owner.owns(current)).toBe(true);expect(()=>owner.open(input)).toThrow('已占用');
 });
});
