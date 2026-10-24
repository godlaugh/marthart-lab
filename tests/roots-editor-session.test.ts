import {describe,it,expect} from 'vitest';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {withRootsPresentation} from '../src/engine/rootsPresentationAuthoring';
import {defaultRootsPresentationConfiguration,defaultRootsPendingConfiguration} from '../src/engine/rootsPresentationConfig';
import {withRootsSceneTimeline} from '../src/engine/rootsCameraTimeline';
import {RootsEditorSession,assertRootsEditorRetention,type RootsEditorHistoryChange} from '../src/engine/rootsEditorSession';
import {RootsControlOwner,rootsControlRepresentationBytes,ROOTS_CONTROL_MAX_BYTES} from '../src/engine/rootsControl';
function scene(){const s=withRootsSceneTimeline(withRootsPresentation(createScene(definition('roots')),{...defaultRootsPresentationConfiguration(),pending:defaultRootsPendingConfiguration(),previewMode:'live-worker-arrival-v1'}),true);s.rootsSourcePalette={colors:['#80112233']};return s;}
function setup(){const author=scene(),editor=new RootsEditorSession('initial',author),worker=new RootsControlOwner('initial');deliver(editor,worker);return{author,editor,worker};}
function deliver(editor:RootsEditorSession,worker:RootsControlOwner){worker.commit(worker.prepare(editor.request()));editor.acknowledge(editor.sessionId,worker.receipt);}
function restore(editor:RootsEditorSession,edge:RootsEditorHistoryChange,direction:'undo'|'redo',sessionId:string){if(edge.runtimeChanged)editor.restore(direction==='undo'?edge.before:edge.after,sessionId);}
describe('Roots UI command history owner',()=>{
 it('keeps author staging and save metadata outside the issued runtime state',()=>{
  const {author,editor,worker}=setup(),before=editor.checkpoint(),request=editor.request();author.rootsPresentation!.mode='point-cloud';author.name='saved under another name';author.id='save-copy';
  expect(editor.edit({kind:'stage'})).toMatchObject({before,after:before,runtimeChanged:false,intent:'stage'});expect(editor.edit({kind:'metadata'}).runtimeChanged).toBe(false);
  expect(editor.request()).toBe(request);expect(editor.checkpoint()).toBe(before);expect(worker.currentScene.rootsPresentation!.mode).toBe('density');expect(before.cold.id).not.toBe('save-copy');expect(before.cold.name).not.toBe(author.name);
 });
 it('sends same-value Apply as an explicit history edge and restores before/after cold states',()=>{
  const {author,editor,worker}=setup(),same=editor.edit({kind:'apply',scene:author});expect(same.runtimeChanged).toBe(true);expect(editor.request().commands[0]).toMatchObject({kind:'apply',revision:2});deliver(editor,worker);expect(worker.receipt.resetRevision).toBe(2);
  author.rootsPresentation!.mode='point-cloud';const applied=editor.edit({kind:'apply',scene:author});deliver(editor,worker);expect(worker.coldScene.rootsPresentation!.mode).toBe('point-cloud');
  restore(editor,applied,'undo','undo');let restored=new RootsControlOwner(editor.sessionId);deliver(editor,restored);expect(restored.coldScene.rootsPresentation!.mode).toBe('density');
  restore(editor,applied,'redo','redo');restored=new RootsControlOwner(editor.sessionId);deliver(editor,restored);expect(restored.coldScene.rootsPresentation!.mode).toBe('point-cloud');
 });
 it('reconstructs cold plus ordered hot intentions without promoting current into cold',()=>{
  const {editor,worker}=setup();const hot=editor.edit({kind:'hot',command:{kind:'palette',palette:{colors:['#80ff0000']}}});deliver(editor,worker);
  editor.edit({kind:'hot',command:{kind:'transform',transform:{scale:[2,2,2],offset:[1,2,3],rotationDegrees:15}}});const retained=editor.checkpoint();editor.edit({kind:'restart'});deliver(editor,worker);expect(worker.currentScene).toBe(worker.coldScene);
  editor.restore(retained,'library-return');expect(editor.request().commands.map(c=>c.kind)).toEqual(['apply','palette','transform']);const restored=new RootsControlOwner(editor.sessionId);deliver(editor,restored);expect(restored.coldScene.rootsSourcePalette!.colors).toEqual(['#80112233']);expect(restored.currentScene.rootsSourcePalette!.colors).toEqual(['#ffff0000']);expect(restored.currentScene.rootsPresentation!.transform.scale).toEqual([2,2,2]);
  restored.commit(restored.prepareRecordingReset());editor.acknowledge(editor.sessionId,restored.receipt);expect(editor.checkpoint().hot).toEqual([]);expect(editor.checkpoint().cold.rootsSourcePalette!.colors).toEqual(['#80112233']);expect(hot.after.hot).toHaveLength(1);
 });
 it('does not revive acknowledged hot color after record reset; deferred commands remain pending',()=>{
  const {editor,worker}=setup();editor.edit({kind:'hot',command:{kind:'palette',palette:{colors:['#ff0000']}}});worker.commit(worker.prepare(editor.request()));
  const deferred=editor.edit({kind:'hot',command:{kind:'palette',palette:{colors:['#00ff00']}}}),issued=editor.request().commands.at(-1);
  worker.commit(worker.prepareRecordingReset());expect(editor.acknowledge(editor.sessionId,worker.receipt)).toBe(true);
  expect(editor.request()).toEqual({acknowledgedRevision:2,commands:[issued]});expect(editor.checkpoint().hot).toEqual([{kind:'palette',palette:{colors:['#00ff00']}}]);expect(deferred.before.hot).toHaveLength(1);expect(deferred.after.hot).toHaveLength(2);
  deliver(editor,worker);expect(worker.currentScene.rootsSourcePalette!.colors).toEqual(['#ff00ff00']);expect(editor.checkpoint().hot).toHaveLength(1);
 });
 it('keeps a deferred Apply as the desired new cold state across a recording acknowledgement',()=>{
  const {author,editor,worker}=setup();editor.edit({kind:'hot',command:{kind:'palette',palette:{colors:['#ff0000']}}});worker.commit(worker.prepare(editor.request()));
  author.rootsSourcePalette={colors:['#00123456']};author.rootsPresentation!.mode='point-cloud';editor.edit({kind:'apply',scene:author});
  worker.commit(worker.prepareRecordingReset());editor.acknowledge(editor.sessionId,worker.receipt);expect(editor.checkpoint().cold.rootsPresentation!.mode).toBe('point-cloud');expect(editor.checkpoint().hot).toEqual([]);expect(editor.request().commands.map(c=>c.kind)).toEqual(['apply']);
  const desired=editor.checkpoint();deliver(editor,worker);expect(editor.checkpoint()).toBe(desired);expect(worker.coldScene.rootsSourcePalette!.colors).toEqual(['#00123456']);expect(worker.currentScene).toBe(worker.coldScene);
 });
 it('stage/metadata history undo does not undo a later recording reset',()=>{
  const {editor,worker}=setup();editor.edit({kind:'hot',command:{kind:'palette',palette:{colors:['#ff0000']}}});deliver(editor,worker);
  const stage=editor.edit({kind:'stage'}),metadata=editor.edit({kind:'metadata'});worker.commit(worker.prepareRecordingReset());editor.acknowledge(editor.sessionId,worker.receipt);const request=editor.request(),checkpoint=editor.checkpoint();
  restore(editor,stage,'undo','ignored-stage');restore(editor,metadata,'undo','ignored-save');expect(editor.sessionId).toBe('initial');expect(editor.request()).toBe(request);expect(editor.checkpoint()).toBe(checkpoint);expect(checkpoint.hot).toHaveLength(0);
 });
 it('keeps malformed/stale/foreign acknowledgement and rejected edits atomic',()=>{
  const {editor}=setup(),checkpoint=editor.checkpoint(),request=editor.request();expect(editor.acknowledge('old-session',null)).toBe(false);expect(editor.acknowledge(editor.sessionId,editor.receipt)).toBe(false);
  expect(()=>editor.acknowledge(editor.sessionId,{revision:2,applyRevision:1,resetRevision:1})).toThrow();expect(()=>editor.edit({kind:'hot',command:{kind:'tone',tone:{gamma:NaN}}})).toThrow();expect(()=>editor.restore(checkpoint,'initial')).toThrow();expect(()=>editor.restore({cold:scene(),hot:[]},'forged')).toThrow();
  expect(editor.request()).toBe(request);expect(editor.checkpoint()).toBe(checkpoint);
 });
 it('owns immutable snapshots and checks expanded candidate budget before issuing any command',()=>{
  const {author,editor}=setup(),palette={colors:['#ABCDEF']},hot=editor.edit({kind:'hot',command:{kind:'palette',palette}});palette.colors[0]='#000000';expect(hot.after.hot).toEqual([{kind:'palette',palette:{colors:['#ABCDEF']}}]);expect(Object.isFrozen(hot.after.hot)).toBe(true);expect(Reflect.set(hot.after.hot[0],'kind','restart')).toBe(false);expect(hot.after.hot[0].kind).toBe('palette');
  const before=editor.checkpoint(),request=editor.request();let oversized:unknown={text:'x'.repeat(1024)};for(let i=0;i<20;i++)oversized={a:oversized,b:oversized};const candidate={...author,provenance:oversized} as typeof author;
  expect(()=>editor.edit({kind:'apply',scene:candidate})).toThrow('768');expect(editor.checkpoint()).toBe(before);expect(editor.request()).toBe(request);
 });
});

describe('Roots UI aggregate retention admission',()=>{
 it('counts repeated owners and checkpoint references once across history and library',()=>{
  const {editor}=setup(),checkpoint=editor.checkpoint();
  const expected=editor.retainedBytes+rootsControlRepresentationBytes(checkpoint);
  expect(assertRootsEditorRetention([editor],[checkpoint])).toBe(expected);
  expect(assertRootsEditorRetention([editor,editor,editor],[checkpoint,checkpoint])).toBe(expected);
  expect(assertRootsEditorRetention([editor],[checkpoint],{kind:'restart'})).toBe(expected+3*rootsControlRepresentationBytes({kind:'restart'}));
  const before=editor.retainedBytes;editor.edit({kind:'hot',command:{kind:'palette',palette:{colors:['#123456']}}});
  expect(editor.retainedBytes).toBeGreaterThan(before);
 });
 it('rejects aggregate historical plans and candidate expansion before caller mutation',()=>{
  const {editor}=setup(),before=editor.checkpoint(),request=editor.request(),receipt=editor.receipt;
  let shared:unknown={text:'x'.repeat(1024)};for(let i=0;i<16;i++)shared={a:shared,b:shared};
  // Shared subgraphs exercise serialization growth without allocating hundreds
  // of MiB. Each plan is independently retained; duplicate plan refs are free.
  const first={cold:shared,hot:[]},second={cold:shared,hot:[]},third={cold:shared,hot:[]},fourth={cold:shared,hot:[]},fifth={cold:shared,hot:[]},sixth={cold:shared,hot:[]};
  const plans=[first,second,third,fourth,fifth,sixth] as unknown as Parameters<typeof assertRootsEditorRetention>[1];
  expect(rootsControlRepresentationBytes(first)).toBeLessThan(ROOTS_CONTROL_MAX_BYTES);
  expect(()=>assertRootsEditorRetention([editor],plans)).toThrow('768 MiB');
  expect(()=>{assertRootsEditorRetention([editor],[before],{a:shared,b:shared});editor.edit({kind:'restart'});}).toThrow('768 MiB');
  expect(editor.checkpoint()).toBe(before);expect(editor.request()).toBe(request);expect(editor.receipt).toBe(receipt);expect(editor.sessionId).toBe('initial');
 });
});
