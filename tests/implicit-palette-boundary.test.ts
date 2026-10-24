import {describe,expect,it} from 'vitest';
import {createScene,parseScene,serializeScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {snapshotGenerationInput} from '../src/engine/generationInput';
import {SOURCE_IMPLICIT_PRESENTATION} from '../src/engine/sourceImplicitPresentation';
import {prepareImplicitPalette} from '../src/engine/sourceImplicitPalette';
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
});
