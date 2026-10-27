import {generateScene} from '../src/engine/temporal';
import {parseProjectFile} from '../src/engine/legacyImport';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import native from './fixtures/source-implicit-presentation/recording-clock.json';
import {describe,it,expect,vi} from 'vitest';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {SOURCE_IMPLICIT_PRESENTATION} from '../src/engine/sourceImplicitIdentity';
import {ImplicitControlJournal} from '../src/engine/implicitControlJournal';
import {ImplicitEditorSession,assertImplicitEditorRetention} from '../src/engine/implicitEditorSession';
import {implicitEditorActionFor} from '../src/engine/implicitEditIntent';
import {ImplicitPaletteControlOwner,implicitPaletteControlRepresentationBytes} from '../src/engine/implicitPaletteControl';
function scene(){const s=createScene(definition('implicit'));Object.assign(s.settings,{implicitPresentationVersion:SOURCE_IMPLICIT_PRESENTATION,renderMode:'mesh',computeBackend:'cpu'});s.implicitSourcePalette={colors:['#80112233']};return s;}
function deliver(editor:ImplicitEditorSession,worker:ImplicitPaletteControlOwner){worker.commit(worker.prepare(editor.request()));editor.acknowledge(editor.sessionId,worker.receipt);}
function setup(){const author=scene(),editor=new ImplicitEditorSession('initial',author),worker=new ImplicitPaletteControlOwner('initial');deliver(editor,worker);return{author,editor,worker};}
describe('Implicit editor explicit command and history ownership',()=>{
 it('reconstructs independent export through the real palette owner and CPU producer, preserving hot alpha and staged isolation',()=>{
  const raw=structuredClone(native.cases[0].input.project);raw.settings.x_segments=raw.settings.y_segments=raw.settings.z_segments=4;
  const cold=parseProjectFile(JSON.stringify(raw)).scene;cold.implicitSourcePalette={colors:['#80112233']};cold.settings.opacity=1;cold.settings.meshWireframe=false;
  const editor=new ImplicitEditorSession('export',cold),worker=new ImplicitPaletteControlOwner('export');deliver(editor,worker);
  cold.settings.opacity=.1;cold.settings.background='#ff0000';editor.edit({kind:'stage'});editor.edit({kind:'palette',colors:['#80112233']});deliver(editor,worker);
  const request=editor.request(),runtime=editor.runtimeScene(),context={time:0,width:64,height:48,quality:'export' as const,sourcePointPixelDensity:1,sourceViewport:ordinarySourceViewport(runtime,64,48,'offscreen',48)};
  const hot=generateScene(runtime,context);if(hot.type!=='geometry')throw Error('geometry');expect([...hot.sourceImplicitPresentation!.fillColors.slice(0,4)]).toEqual([17,34,51,255].map(v=>Math.fround(v/255)));expect(hot.sourceBackgroundColor).toBe(0xff000000);expect(runtime.settings.opacity).toBe(1);expect(editor.request()).toBe(request);
  worker.commit(worker.prepareRecordingReset());editor.acknowledge(editor.sessionId,worker.receipt);const reset=generateScene(editor.runtimeScene(),context);if(reset.type!=='geometry')throw Error('geometry');expect(reset.sourceImplicitPresentation!.fillColors[3]).toBe(Math.fround(128/255));expect(editor.checkpoint().cold.implicitSourcePalette!.colors).toEqual(['#80112233']);
 });

 it('stages author and save metadata without altering cold/current or issuing commands',()=>{
  const {author,editor,worker}=setup(),before=editor.checkpoint(),request=editor.request();author.settings.opacity=.2;author.name='saved';author.id='save-copy';
  for(const intent of ['implicit-stage','implicit-metadata'] as const){const edge=editor.edit(implicitEditorActionFor(author,intent));expect(edge).toMatchObject({before,after:before,runtimeChanged:false});}
  expect(editor.request()).toBe(request);expect(before.cold.id).not.toBe(author.id);expect(worker.currentScene.settings.opacity).not.toBe(.2);
 });
 it('sends same-value Apply events and reconstructs full cold states on undo/redo with new identities',()=>{
  const {author,editor,worker}=setup();editor.edit({kind:'apply',scene:author});deliver(editor,worker);expect(worker.receipt.resetRevision).toBe(2);
  author.settings.opacity=.2;const edge=editor.edit({kind:'apply',scene:author});deliver(editor,worker);expect(worker.coldScene.settings.opacity).toBe(.2);
  editor.restore(edge.before,'undo');let restored=new ImplicitPaletteControlOwner('undo');deliver(editor,restored);expect(restored.coldScene.settings.opacity).not.toBe(.2);
  editor.restore(edge.after,'redo');restored=new ImplicitPaletteControlOwner('redo');deliver(editor,restored);expect(restored.coldScene.settings.opacity).toBe(.2);
 });
 it('restores ordered hot commands without elevating hot opaque colors or staged settings to cold',()=>{
  const {author,editor,worker}=setup();author.settings.opacity=.2;const colors=['#80ff0000'];const edge=editor.edit({kind:'palette',colors});colors[0]='#000000';deliver(editor,worker);expect(worker.currentPalette.packed).toEqual([0xffff0000]);expect(worker.currentScene.settings.opacity).not.toBe(.2);
  editor.edit({kind:'palette',colors:[]});const held=editor.checkpoint();editor.edit({kind:'restart'});deliver(editor,worker);expect(worker.currentPalette.packed).toEqual([0x80112233]);
  editor.restore(held,'library-return');expect(editor.request().commands.map(c=>c.kind)).toEqual(['apply','palette','palette']);const restored=new ImplicitPaletteControlOwner('library-return');deliver(editor,restored);expect(restored.currentPalette.packed).toEqual([0xffff0000]);expect(restored.coldPalette.packed).toEqual([0x80112233]);expect(edge.after.hot[0].colors).toEqual(['#80ff0000']);expect(Object.isFrozen(held.hot[0].colors)).toBe(true);
 });
 it('clears acknowledged hot on recording reset while preserving newer deferred palette and historical snapshots',()=>{
  const {editor,worker}=setup();const edge=editor.edit({kind:'palette',colors:['#ff0000']});worker.commit(worker.prepare(editor.request()));
  editor.edit({kind:'palette',colors:['#00ff00']});worker.commit(worker.prepareRecordingReset());editor.acknowledge(editor.sessionId,worker.receipt);
  expect(editor.request().commands.map(c=>c.revision)).toEqual([3]);expect(editor.checkpoint().hot).toEqual([{kind:'palette',colors:['#00ff00']}]);expect(edge.after.hot).toEqual([{kind:'palette',colors:['#ff0000']}]);deliver(editor,worker);expect(worker.currentPalette.packed).toEqual([0xff00ff00]);
 });
 it('retains a deferred Apply across record reset and metadata undo leaves the post-record state alone',()=>{
  const {author,editor,worker}=setup();editor.edit({kind:'palette',colors:['#abcdef']});deliver(editor,worker);const metadata=editor.edit({kind:'metadata'});
  author.settings.opacity=.25;editor.edit({kind:'apply',scene:author});worker.commit(worker.prepareRecordingReset());editor.acknowledge(editor.sessionId,worker.receipt);expect(editor.checkpoint().cold.settings.opacity).toBe(.25);expect(editor.checkpoint().hot).toEqual([]);expect(metadata.runtimeChanged).toBe(false);deliver(editor,worker);expect(worker.coldScene.settings.opacity).toBe(.25);
 });
 it('rejects foreign checkpoints, malformed edits and acknowledgements without changing the session',()=>{
  const {editor}=setup(),checkpoint=editor.checkpoint(),request=editor.request();expect(editor.acknowledge('foreign',null)).toBe(false);
  expect(()=>editor.restore(checkpoint,'initial')).toThrow();expect(()=>editor.restore({cold:scene(),hot:[]},'forged')).toThrow();expect(()=>editor.edit({kind:'palette',colors:[1] as unknown as string[]})).toThrow();expect(()=>editor.acknowledge('initial',{revision:99,applyRevision:1,resetRevision:1})).toThrow();expect(editor.checkpoint()).toBe(checkpoint);expect(editor.request()).toBe(request);
 });
 it('does not silently rebuild a lost worker from a staged author or acknowledged commands',()=>{
  const {author,editor}=setup();author.settings.opacity=.2;expect(()=>new ImplicitPaletteControlOwner('initial').prepare(editor.request())).toThrow();
  const explicit=new ImplicitEditorSession('new-apply',author),worker=new ImplicitPaletteControlOwner('new-apply');deliver(explicit,worker);expect(worker.coldScene.settings.opacity).toBe(.2);
 });
 it('bounds expanded history and candidate allocation while deduplicating exact owner/checkpoint references',()=>{
  const {author,editor}=setup(),checkpoint=editor.checkpoint(),request=editor.request();const expected=editor.retainedBytes+implicitPaletteControlRepresentationBytes(checkpoint);
  expect(assertImplicitEditorRetention([editor,editor],[checkpoint,checkpoint])).toBe(expected);expect(assertImplicitEditorRetention([editor],[checkpoint],{kind:'restart'})).toBe(expected+3*implicitPaletteControlRepresentationBytes({kind:'restart'}));
  let graph:unknown={text:'x'.repeat(1024)};for(let i=0;i<20;i++)graph={a:graph,b:graph};const clone=vi.spyOn(globalThis,'structuredClone');
  try{expect(()=>editor.edit({kind:'apply',scene:{...author,provenance:graph} as typeof author})).toThrow('768');expect(clone).not.toHaveBeenCalled();expect(()=>assertImplicitEditorRetention([editor],[checkpoint],graph)).toThrow('768');}finally{clone.mockRestore();}
  expect(editor.request()).toBe(request);expect(editor.checkpoint()).toBe(checkpoint);
 });
 it('rejects cumulative retained checkpoints even when every individual expanded graph fits',()=>{
  const {editor}=setup(),before=editor.checkpoint(),request=editor.request();let shared:unknown={text:'x'.repeat(1024)};for(let i=0;i<16;i++)shared={a:shared,b:shared};
  const plans=Array.from({length:6},()=>({cold:shared,hot:[]})) as unknown as Parameters<typeof assertImplicitEditorRetention>[1];
  expect(()=>assertImplicitEditorRetention([editor],plans)).toThrow('768');expect(editor.checkpoint()).toBe(before);expect(editor.request()).toBe(request);
 });
 it('projects only explicitly selected palette intent and preserves empty or legacy fallback colors',()=>{
  const s=scene();s.implicitSourcePalette={colors:[]};expect(implicitEditorActionFor(s,'implicit-palette')).toEqual({kind:'palette',colors:[]});delete s.implicitSourcePalette;expect(implicitEditorActionFor(s,'implicit-palette')).toEqual({kind:'palette',colors:s.palette.stops});expect(implicitEditorActionFor(s,'implicit-restart')).toEqual({kind:'restart'});
 });
});
describe('Implicit main-thread journal receipts',()=>{
 it('detaches snapshots, preserves same-value events and acknowledges prefixes before newer commands',()=>{
  const author=scene(),j=new ImplicitControlJournal('j',author),first=j.request();author.name='changed';expect(first.commands[0].kind==='apply'&&first.commands[0].scene.name).not.toBe('changed');j.enqueue({kind:'palette',colors:[]});j.enqueue({kind:'palette',colors:[]});expect(first.commands).toHaveLength(1);
  expect(j.acknowledge('j',{revision:2,applyRevision:1,resetRevision:1})).toBe(true);expect(j.request().commands.map(c=>c.revision)).toEqual([3]);expect(Object.isFrozen(j.request().commands)).toBe(true);
 });
 it('rejects forged Apply/reset receipts atomically and preserves pending commands during record reset',()=>{
  const j=new ImplicitControlJournal('j',scene());j.enqueue({kind:'palette',colors:[]});j.enqueue({kind:'apply',scene:scene()});const pending=j.request();
  for(const receipt of [{revision:4,applyRevision:1,resetRevision:1},{revision:3,applyRevision:1,resetRevision:2},{revision:3,applyRevision:3,resetRevision:1}]){expect(()=>j.acknowledge('j',receipt)).toThrow();expect(j.request()).toBe(pending);}
  j.acknowledge('j',{revision:2,applyRevision:1,resetRevision:1});const remaining=j.request();j.acknowledge('j',{revision:2,applyRevision:1,resetRevision:2});expect(j.request()).toBe(remaining);expect(j.acknowledge('j',{revision:1,applyRevision:1,resetRevision:1})).toBe(false);expect(()=>j.acknowledge('j',{revision:2,applyRevision:2,resetRevision:2})).toThrow();expect(j.acknowledge('retired',null)).toBe(false);
  j.acknowledge('j',{revision:3,applyRevision:3,resetRevision:3});expect(j.pendingCount).toBe(0);
 });
 it('requires new session for reset and rejects over-budget snapshots before clone',()=>{
  const j=new ImplicitControlJournal('j',scene()),before=j.request();expect(()=>j.reset('j',scene())).toThrow();expect(()=>j.enqueue({kind:'palette',colors:['x'.repeat(524289)]})).toThrow('1 MiB');expect(j.request()).toBe(before);j.reset('fresh',scene());expect(j.issuedRevision).toBe(1);expect(j.acknowledge('j',{revision:1,applyRevision:1,resetRevision:1})).toBe(false);
 });
});
