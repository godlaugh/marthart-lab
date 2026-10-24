import {describe,it,expect} from 'vitest';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {withRootsPresentation} from '../src/engine/rootsPresentationAuthoring';
import {defaultRootsPresentationConfiguration,defaultRootsPendingConfiguration} from '../src/engine/rootsPresentationConfig';
import {withRootsSceneTimeline} from '../src/engine/rootsCameraTimeline';
import {RootsControlOwner,rootsControlReceiptMatches,validateRootsControls,rootsControlRepresentationBytes} from '../src/engine/rootsControl';
import {sourceHotPalettePackedColor} from '../src/engine/sourceConfigColor';
const scene=()=>withRootsSceneTimeline(withRootsPresentation(createScene(definition('roots')),{...defaultRootsPresentationConfiguration(),pending:defaultRootsPendingConfiguration(),previewMode:'live-worker-arrival-v1'}),true);
function owner(){const o=new RootsControlOwner('test'),s=scene();s.rootsSourcePalette={colors:['#80001122']};o.commit(o.prepare({acknowledgedRevision:0,commands:[{kind:'apply',revision:1,scene:s}]}));return o;}
describe('Roots control worker authority',()=>{
 it('uses hot UI parsing while keeping cold raw strings and preserving empty/omitted no-op',()=>{
  const o=owner();o.commit(o.prepare({acknowledgedRevision:1,commands:[{kind:'palette',revision:2,palette:{colors:['#80001122','123',' 112233','+12345','１２３４５６']}}]}));
  expect(o.currentScene.rootsSourcePalette!.colors).toEqual(['#ff001122','#ffffffff','#ffffffff','#ff012345','#ff123456']);expect(o.coldScene.rootsSourcePalette!.colors).toEqual(['#80001122']);
  const before=o.currentScene;o.commit(o.prepare({acknowledgedRevision:2,commands:[{kind:'palette',revision:3},{kind:'palette',revision:4,palette:{colors:[]}}]}));expect(o.currentScene).toBe(before);
  o.commit(o.prepareRecordingReset());expect(o.currentScene).toBe(o.coldScene);expect(o.receipt).toEqual({revision:4,applyRevision:1,resetRevision:2});
 });
 it('retries are idempotent and stale or reused revisions fail without changing cold/current',()=>{
  const o=owner(),request={acknowledgedRevision:1,commands:[{kind:'offset' as const,revision:2,offset:-0}]};o.commit(o.prepare(request));const current=o.currentScene;
  expect(o.prepare(request).steps).toHaveLength(0);expect(()=>o.prepare({...request,commands:[{kind:'offset',revision:2,offset:0}]})).toThrow('revision');expect(o.currentScene).toBe(current);
  expect(()=>o.prepare({acknowledgedRevision:3,commands:[]})).toThrow();expect(()=>validateRootsControls({acknowledgedRevision:2,commands:[{kind:'restart',revision:4}]})).toThrow('缺口');
  expect(()=>new RootsControlOwner('lost').prepare({acknowledgedRevision:2,commands:[]})).toThrow('Apply');
 });
 it('preserves consumed watermark across recording reset and accepts a fresh same-value hot command',()=>{
  const o=owner(),hot={acknowledgedRevision:1,commands:[{kind:'palette' as const,revision:2,palette:{colors:['#123456']}}]};o.commit(o.prepare(hot));o.commit(o.prepareRecordingReset());
  o.commit(o.prepare(hot));expect(o.currentScene).toBe(o.coldScene);expect(o.receipt.resetRevision).toBe(2);
  o.commit(o.prepare({acknowledgedRevision:2,commands:[{...hot.commands[0],revision:3}]}));expect(o.currentScene.rootsSourcePalette!.colors).toEqual(['#ff123456']);
 });
 it('same-value Apply and ordered restarts remain distinct events; prepared transactions cannot be replayed',()=>{
  const o=owner(),cold=o.coldScene,p=o.prepare({acknowledgedRevision:1,commands:[{kind:'apply',revision:2,scene:cold},{kind:'restart',revision:3}]});expect(p.steps.map(s=>s.reset)).toEqual([true,true]);o.commit(p);expect(o.receipt).toEqual({revision:3,applyRevision:2,resetRevision:3});expect(()=>o.commit(p)).toThrow('过期');
 });
 it('admits expanded shared graphs before serialization and rejects cycles/cancelled commands',()=>{
  let value:unknown={text:'x'.repeat(1024)};for(let i=0;i<20;i++)value={a:value,b:value};expect(()=>rootsControlRepresentationBytes(value)).toThrow('768');
  const cycle:{self?:unknown}={};cycle.self=cycle;expect(()=>rootsControlRepresentationBytes(cycle)).toThrow('循环');
  const o=owner(),before=o.receipt;expect(()=>o.prepare({acknowledgedRevision:1,commands:[{kind:'restart',revision:2}]},()=>true)).toThrow();expect(o.receipt).toEqual(before);
 });
 it.each([['#80112233',0xff112233],['0x112233',0xffffffff],['112233',0xff112233],['#abcdef',0xffabcdef],['#+12345',0xff012345],['wrong!',0xffffffff],[' 112233',0xffffffff],['１２３４５６',0xff123456]])('parses hot color %s through the source UI boundary',(text,packed)=>{expect(sourceHotPalettePackedColor(text as string)).toBe(packed);});
 it('binds receipts to actual Apply/restart commands and distinguishes record resets explicitly',()=>{
  const s=scene(),initial={acknowledgedRevision:0,commands:[{kind:'apply' as const,revision:1,scene:s},{kind:'palette' as const,revision:2,palette:{colors:['#123456']}}]},prior={revision:2,applyRevision:1,resetRevision:1};
  expect(rootsControlReceiptMatches(prior,initial)).toBe(true);expect(rootsControlReceiptMatches({...prior,applyRevision:2},initial)).toBe(false);expect(rootsControlReceiptMatches({...prior,resetRevision:2},initial)).toBe(false);
  const next={acknowledgedRevision:2,commands:[{kind:'restart' as const,revision:3},{kind:'apply' as const,revision:4,scene:s}]};expect(rootsControlReceiptMatches({revision:4,applyRevision:4,resetRevision:3},next,prior)).toBe(true);expect(rootsControlReceiptMatches({revision:4,applyRevision:3,resetRevision:3},next,prior)).toBe(false);
  expect(rootsControlReceiptMatches({...prior,resetRevision:2},{acknowledgedRevision:2,commands:[]},prior)).toBe(false);expect(rootsControlReceiptMatches({...prior,resetRevision:2},{acknowledgedRevision:2,commands:[]},prior,{allowRecordingResets:true})).toBe(true);
  expect(rootsControlReceiptMatches({revision:3,applyRevision:3,resetRevision:2},{acknowledgedRevision:2,commands:[{kind:'restart',revision:3}]})).toBe(false);
 });

});
