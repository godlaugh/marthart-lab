import {describe,expect,it} from 'vitest';
import {createScene,parseScene,serializeScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {snapshotGenerationInput} from '../src/engine/generationInput';
import {SOURCE_IMPLICIT_PRESENTATION} from '../src/engine/sourceImplicitPresentation';
import {prepareImplicitPalette} from '../src/engine/sourceImplicitPalette';
import {implicitPaletteEditorState} from '../src/engine/implicitPaletteEditing';
import {ImplicitPaletteControlOwner} from '../src/engine/implicitPaletteControl';
import {ImplicitControlJournal} from '../src/engine/implicitControlJournal';
import type {GenerateContext} from '../src/types';

function scene(){const s=createScene(definition('implicit'));Object.assign(s.settings,{implicitPresentationVersion:SOURCE_IMPLICIT_PRESENTATION,renderMode:'mesh',computeBackend:'cpu'});return s;}
describe('Implicit raw palette document and transport boundaries',()=>{
 it.each([[],['#00112233'],['#80112233','invalid raw',' 112233','0x123456']].map(colors=>({colors})))('preserves raw palette cardinality and text through save/open: $colors',({colors})=>{
  const author=scene();author.implicitSourcePalette={colors};
  const restored=parseScene(serializeScene(author));expect(restored.implicitSourcePalette).toEqual({colors});expect(restored.palette).toEqual(author.palette);
  expect(serializeScene(restored)).not.toContain('implicitControls');
 });
 it('rejects malformed explicit payloads without silently falling back to legacy stops',()=>{
  for(const payload of [null,[],{colors:[3]},{colors:['#ffffff'],extra:true}]){const author={...scene(),implicitSourcePalette:payload};expect(()=>parseScene(JSON.stringify(author))).toThrow();}
  const author={...createScene(definition('roots')),implicitSourcePalette:{colors:[]}};expect(()=>parseScene(JSON.stringify(author))).toThrow('隐式');
 });
 it('copies admitted public commands and excludes producer facts and callbacks',()=>{
  const author=scene();author.implicitSourcePalette={colors:['#80112233']};
  const context:GenerateContext={time:0,width:64,height:64,quality:'preview',implicitControls:{sessionId:'boundary',acknowledgedRevision:0,commands:[{revision:1,kind:'apply',scene:author}]},implicitPalettePrepared:prepareImplicitPalette(['#112233'],'hot'),onProgress:()=>{throw Error('local callback');}};
  const copy=snapshotGenerationInput(context);author.implicitSourcePalette.colors[0]='#ffffff';
  expect(copy).not.toHaveProperty('implicitPalettePrepared');expect(copy).not.toHaveProperty('onProgress');
  const command=copy.implicitControls!.commands[0];expect(command.kind==='apply'&&command.scene.implicitSourcePalette?.colors).toEqual(['#80112233']);
  expect(()=>snapshotGenerationInput({...context,implicitControls:{...context.implicitControls!,sessionId:''}})).toThrow('identity');
  expect(()=>snapshotGenerationInput({...context,implicitControls:{...context.implicitControls!,unexpected:1} as never})).toThrow('Unknown');
 });
 it('keeps editor state out of the journal, transport and direct runtime owner while preserving raw colors',()=>{
  const author=scene();author.implicitSourcePalette={colors:['#80aBcDeF']};
  author.implicitPaletteEditor={...implicitPaletteEditorState(author),manualColors:['untouched author text'],colorCount:17};
  const journal=new ImplicitControlJournal('editor-boundary',author);
  const first=journal.request().commands[0];expect(first.kind==='apply'&&first.scene).not.toHaveProperty('implicitPaletteEditor');
  const input={sessionId:'editor-boundary',acknowledgedRevision:0,commands:[{revision:1,kind:'apply' as const,scene:author}]};
  const snapshot=snapshotGenerationInput({time:0,width:64,height:64,quality:'preview',implicitControls:input});
  const command=snapshot.implicitControls!.commands[0];expect(command.kind==='apply'&&command.scene).not.toHaveProperty('implicitPaletteEditor');
  const owner=new ImplicitPaletteControlOwner('editor-boundary'),prepared=owner.prepare({acknowledgedRevision:0,commands:input.commands});owner.commit(prepared);
  expect(prepared.cold).not.toHaveProperty('implicitPaletteEditor');expect(prepared.cold.implicitSourcePalette).toEqual({colors:['#80aBcDeF']});
  expect(author.implicitPaletteEditor.colorCount).toBe(17);
  // A retransmitted revision has the same runtime meaning despite local UI
  // metadata changing. It must not be treated as a different Apply payload.
  author.implicitPaletteEditor.colorCount=7;
  expect(owner.prepare({acknowledgedRevision:0,commands:input.commands}).steps).toEqual([]);
 });
});
