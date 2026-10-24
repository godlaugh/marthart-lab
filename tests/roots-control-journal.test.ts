import {describe,expect,it,vi} from 'vitest';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {defaultRootsPendingConfiguration,defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import {withRootsPresentation} from '../src/engine/rootsPresentationAuthoring';
import {withRootsSceneTimeline} from '../src/engine/rootsCameraTimeline';
import {MAX_ROOTS_SOURCE_COLOR_TEXT} from '../src/engine/rootsDensityColor';
import {ROOTS_CONTROL_MAX_BYTES,rootsControlRepresentationBytes,RootsControlOwner,type RootsControlPayload,type RootsControlReceipt} from '../src/engine/rootsControl';
import {RootsControlJournal,RootsControlJournalError} from '../src/engine/rootsControlJournal';

function scene(){
 const source=withRootsSceneTimeline(withRootsPresentation(createScene(definition('roots')),{...defaultRootsPresentationConfiguration(),pending:defaultRootsPendingConfiguration(),previewMode:'live-worker-arrival-v1'}),true);
 source.timeline.tracks=[];source.rootsSourcePalette={colors:['#102030','#fF80aB']};return source;
}
const receipt=(revision:number,applyRevision=1,resetRevision=1):RootsControlReceipt=>({revision,applyRevision,resetRevision});
function setup(){const author=scene(),journal=new RootsControlJournal('roots-one',author);return{author,journal};}

describe('Roots main-thread command journal',()=>{
 it('owns a detached, immutable first Apply and reuses unchanged request snapshots',()=>{
  const {author,journal}=setup(),request=journal.request(),first=request.commands[0];
  expect(journal.sessionId).toBe('roots-one');expect(journal.issuedRevision).toBe(1);expect(journal.pendingCount).toBe(1);
  expect(request).toBe(journal.request());expect(request.acknowledgedRevision).toBe(0);
  expect(first).toMatchObject({revision:1,kind:'apply',scene:author});
  author.name='renamed after issuing';author.rootsSourcePalette!.colors[0]='#ffffff';
  expect(first.kind==='apply'&&first.scene.name).not.toBe(author.name);
  expect(first.kind==='apply'&&first.scene.rootsSourcePalette!.colors[0]).toBe('#102030');
  expect(()=>request.commands.push({revision:2,kind:'restart'})).toThrow();
  expect(()=>{if(first.kind==='apply')first.scene.rootsSourcePalette!.colors[0]='#000000';}).toThrow();
  expect(journal.request()).toBe(request);
 });

 it('preserves equal explicit palette and Apply events without compaction',()=>{
  const {author,journal}=setup(),palette={colors:['','#80fFaa00','invalid raw color']};
  journal.enqueue({kind:'palette',palette});journal.enqueue({kind:'palette',palette});journal.enqueue({kind:'apply',scene:author});
  palette.colors[0]='#999999';
  expect(journal.request().commands.map(c=>[c.revision,c.kind])).toEqual([[1,'apply'],[2,'palette'],[3,'palette'],[4,'apply']]);
  for(const command of journal.request().commands.slice(1,3))expect(command.kind==='palette'&&command.palette?.colors[0]).toBe('');
 });

 it('retains omission, explicit empty palette, and each narrow command payload',()=>{
  const {journal}=setup(),payloads:RootsControlPayload[]=[
   {kind:'palette'},{kind:'palette',palette:{colors:[]}},{kind:'tone',tone:{brightness:.7,dotSize:.02}},
   {kind:'transform',transform:{scale:[2,3,4],offset:[5,6,7],rotationDegrees:-15}},
   {kind:'camera',camera:{phi:.1,theta:.2,gamma:.3,zoom:-2}},{kind:'offset',offset:-.4},{kind:'restart'},
  ];
  payloads.forEach(payload=>journal.enqueue(payload));
  expect(journal.request().commands.slice(1)).toEqual(payloads.map((payload,index)=>({...payload,revision:index+2})));
  expect(journal.request().commands[1]).not.toHaveProperty('palette');
 });

 it('rejects malformed and oversized input atomically through the protocol owner',()=>{
  const {journal}=setup(),before=journal.request();
  expect(()=>journal.enqueue({kind:'offset',offset:NaN})).toThrow();
  expect(()=>journal.enqueue({kind:'palette',palette:{colors:['x'.repeat(MAX_ROOTS_SOURCE_COLOR_TEXT+1)]}})).toThrow('1 MiB');
  expect(journal.issuedRevision).toBe(1);expect(journal.request()).toBe(before);
  expect(journal.enqueue({kind:'restart'}).revision).toBe(2);
 });

 it('admits combined retained representation before allocating a large detached Apply',()=>{
  const {author,journal}=setup(),before=journal.request(),chunk='x'.repeat(1024*1024);
  // Repeated source strings keep this test allocation small, while the wire
  // representation still has to account for every occurrence independently.
  const original=Array.from({length:383},()=>chunk),large={...author,provenance:{kind:'MathArt Studio' as const,original,warnings:[]}},command={kind:'apply',revision:2,scene:large};
  const target=ROOTS_CONTROL_MAX_BYTES-Math.floor(rootsControlRepresentationBytes(before)/2);
  const missing=target-rootsControlRepresentationBytes(command);original.push('x'.repeat(Math.floor((missing-64)/2)));
  expect(rootsControlRepresentationBytes(command)).toBeLessThan(ROOTS_CONTROL_MAX_BYTES);
  const clone=vi.spyOn(globalThis,'structuredClone');
  try{expect(()=>journal.enqueue({kind:'apply',scene:large})).toThrow('768 MiB');expect(clone).not.toHaveBeenCalled();}
  finally{clone.mockRestore();}
  expect(journal.request()).toBe(before);expect(journal.issuedRevision).toBe(1);
 });

 it('accepts a confirmed prefix while a newer request is pending and retains old snapshots',()=>{
  const {journal}=setup();journal.enqueue({kind:'palette',palette:{colors:['#ff0000']}});
  const sent=journal.request(),later=journal.enqueue({kind:'tone',tone:{gamma:1.5}}),latest=journal.request();
  expect(sent.commands).toHaveLength(2);expect(latest.commands).toHaveLength(3);
  expect(journal.acknowledge('roots-one',receipt(2))).toBe(true);
  expect(journal.request()).toEqual({acknowledgedRevision:2,commands:[later]});
  expect(journal.request().commands[0]).toBe(later);expect(sent.commands).toHaveLength(2);
  expect(journal.issuedRevision).toBe(3);
 });

 it('ignores old sessions and duplicate or older receipts without rolling back',()=>{
  const {journal}=setup();journal.enqueue({kind:'tone',tone:{contrast:.8}});
  expect(journal.acknowledge('roots-one',receipt(2))).toBe(true);const confirmed=journal.request();
  expect(journal.acknowledge('retired-session',null)).toBe(false);
  expect(journal.acknowledge('roots-one',receipt(2))).toBe(false);
  expect(journal.acknowledge('roots-one',receipt(1))).toBe(false);
  expect(journal.request()).toBe(confirmed);expect(journal.receipt).toEqual(receipt(2));
 });

 it('rejects unknown revisions and mismatched Apply/reset facts without dropping commands',()=>{
  const {author,journal}=setup();journal.enqueue({kind:'palette',palette:{colors:[]}});journal.enqueue({kind:'apply',scene:author});journal.enqueue({kind:'restart'});
  const pending=journal.request();
  for(const value of [receipt(5),receipt(4,1,3),receipt(4,3,2),receipt(4,3,-1),null]){
   expect(()=>journal.acknowledge('roots-one',value)).toThrow();expect(journal.request()).toBe(pending);expect(journal.receipt.revision).toBe(0);
  }
  expect(journal.acknowledge('roots-one',receipt(4,3,3))).toBe(true);
  expect(journal.pendingCount).toBe(0);expect(journal.receipt).toEqual(receipt(4,3,3));
 });

 it('accepts recording resets at the same revision without losing later commands',()=>{
  const {journal}=setup();journal.enqueue({kind:'palette',palette:{colors:['#ff0000']}});journal.acknowledge('roots-one',receipt(2));
  const later=journal.enqueue({kind:'tone',tone:{brightness:.5}}),pending=journal.request(),recording=receipt(2,1,2);
  expect(journal.acknowledge('roots-one',recording)).toBe(true);recording.resetRevision=99;
  expect(journal.request()).toBe(pending);expect(journal.receipt).toEqual(receipt(2,1,2));
  expect(journal.acknowledge('roots-one',receipt(2,1,1))).toBe(false);
  expect(()=>journal.acknowledge('roots-one',receipt(2,2,2))).toThrow(RootsControlJournalError);
  expect(journal.request().commands).toEqual([later]);expect(journal.acknowledge('roots-one',receipt(3,1,2))).toBe(true);
 });

 it('requires reset counts to include acknowledged recording resets and later explicit resets',()=>{
  const {journal}=setup();journal.acknowledge('roots-one',receipt(1,1,3));journal.enqueue({kind:'restart'});
  const pending=journal.request();expect(()=>journal.acknowledge('roots-one',receipt(2,1,3))).toThrow();expect(journal.request()).toBe(pending);
  expect(journal.acknowledge('roots-one',receipt(2,1,4))).toBe(true);
 });

 it('starts a new document with a fresh session and cannot reuse old receipts',()=>{
  const {author,journal}=setup();journal.enqueue({kind:'restart'});journal.acknowledge('roots-one',receipt(2,1,2));
  journal.reset('roots-two',author);
  expect(journal.issuedRevision).toBe(1);expect(journal.receipt.revision).toBe(0);expect(journal.pendingCount).toBe(1);
  expect(journal.acknowledge('roots-one',receipt(2,1,2))).toBe(false);
  const pending=journal.request();expect(()=>journal.reset('roots-two',author)).toThrow(RootsControlJournalError);
  expect(()=>journal.reset(' ',author)).toThrow(RootsControlJournalError);
  expect(()=>journal.reset('invalid-source',{...author,kind:'samila'})).toThrow();expect(journal.request()).toBe(pending);
 });

 it('does not apply staged author mutations through a later narrow hot command',()=>{
  const {author,journal}=setup(),owner=new RootsControlOwner(journal.sessionId);
  const initial=owner.prepare(journal.request());owner.commit(initial);journal.acknowledge(journal.sessionId,owner.receipt);
  author.rootsPresentation!.mode='point-cloud';author.rootsPresentation!.camera.theta=2;author.timeline.duration=999;
  journal.enqueue({kind:'palette',palette:{colors:['#ff0000']}});
  const hot=owner.prepare(journal.request());owner.commit(hot);journal.acknowledge(journal.sessionId,owner.receipt);
  expect(owner.currentScene.rootsPresentation!.mode).toBe('density');expect(owner.currentScene.rootsPresentation!.camera.theta).toBe(0);
  expect(owner.currentScene.timeline.duration).not.toBe(999);expect(owner.currentScene.rootsSourcePalette!.colors).toEqual(['#ffff0000']);
  journal.enqueue({kind:'apply',scene:author});const applied=owner.prepare(journal.request());owner.commit(applied);journal.acknowledge(journal.sessionId,owner.receipt);
  expect(owner.currentScene.rootsPresentation!.mode).toBe('point-cloud');expect(owner.currentScene.rootsPresentation!.camera.theta).toBe(2);
  expect(owner.currentScene.timeline.duration).toBe(999);
 });

 it('does not revive an acknowledged hot palette after recording reset with deferred input',()=>{
  const {author,journal}=setup(),owner=new RootsControlOwner(journal.sessionId);
  journal.enqueue({kind:'palette',palette:{colors:['#ff0000']}});const sent=journal.request(),prepared=owner.prepare(sent);
  journal.enqueue({kind:'tone',tone:{contrast:.8}});owner.commit(prepared);journal.acknowledge(journal.sessionId,owner.receipt);
  expect(owner.currentScene.rootsSourcePalette!.colors).toEqual(['#ffff0000']);
  const recording=owner.prepareRecordingReset();owner.commit(recording);journal.acknowledge(journal.sessionId,owner.receipt);
  expect(journal.request().commands.map(c=>c.kind)).toEqual(['tone']);
  const deferred=owner.prepare(journal.request());owner.commit(deferred);journal.acknowledge(journal.sessionId,owner.receipt);
  expect(owner.currentScene.rootsSourcePalette).toEqual(author.rootsSourcePalette);expect(owner.currentScene.settings.rootSourceContrast).toBe(Math.fround(.8));
  expect(owner.receipt).toEqual(receipt(3,1,2));expect(journal.pendingCount).toBe(0);
 });
});
