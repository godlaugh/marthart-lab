import {describe,it,expect} from 'vitest';
import {insertSourceBouncingColor,moveSourceBouncingColor,sourceBouncingEditableColors,sourceBouncingReplaceRgb} from '../src/engine/sourceBouncingPaletteEditing';
import originalAfter from './fixtures/source-bouncing-palette/manual-after.json';
import {importSourceBouncingDocument} from '../src/engine/sourceBouncingDocument';
import {prepareSourceBouncingDisplay,sourceBouncingPaletteColor} from '../src/engine/sourceBouncingVisualConfig';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {definition} from '../src/scenes';
describe('source palette editing and persisted display ownership',()=>{
 it('matches the actual original midpoint helper without rewriting existing entries',()=>{
  for(const c of originalAfter.cases){
   const before=[...c.input.palette];
   if(c.output.status==='threw')expect(()=>insertSourceBouncingColor(c.input.palette,c.input.selectedIndex),c.id).toThrow('索引');
   else{
    const actual=insertSourceBouncingColor(c.input.palette,c.input.selectedIndex);expect(actual.colors,c.id).toEqual(c.output.palette);
    // The original pure helper returns invalid index 1 for an empty input;
    // unlike its normalized GUI list, our explicit empty palette stays empty
    // until this action, and the newly inserted sole color must be selected.
    expect(actual.selected,c.id).toBe(Math.min(c.output.insertedIndex!,actual.colors.length-1));
   }
   expect(c.input.palette,c.id+' input retained').toEqual(before);
  }
 });
 it('keeps absent, empty, single-color and long original arrays distinct',()=>{
  expect(sourceBouncingEditableColors({kind:'absent'})).toHaveLength(6);expect(sourceBouncingEditableColors({kind:'colors',colors:[]})).toEqual([]);
  expect(sourceBouncingEditableColors({kind:'colors',colors:['raw']})).toEqual(['raw']);
  const colors=Array.from({length:32},(_,i)=>i===0?'#80123456':i===1?'invalid':String(i)),input=importSourceBouncingDocument({palette:colors,settings:{particle_count:32}});if(!input.ok)throw Error('fixture');
  const scene=createScene(definition('bouncing'));scene.settings={};scene.equations={};scene.parameters={};scene.timeline.tracks=[];scene.bouncingSource=input.value.payload;
  scene.bouncingSource.visual.palette={kind:'colors',colors:moveSourceBouncingColor(colors,1,3)};
  const read=parseScene(JSON.stringify(persistentScene(scene)));expect(read.bouncingSource!.visual.palette).toEqual({kind:'colors',colors:moveSourceBouncingColor(colors,1,3)});
  expect((read.bouncingSource!.visual.palette as {colors:string[]}).colors.slice(25)).toEqual(colors.slice(25));
  const display=prepareSourceBouncingDisplay(read.bouncingSource!.visual,read.bouncingSource!.configuration);if(!display.ok)throw Error('display');expect(display.value.paletteCount).toBe(25);expect(display.value.paletteRgb.slice(9,12)).toEqual(new Float32Array([1,1,1]));
 });
 it('changes only selected RGB while retaining alpha and unchanged source spelling',()=>{
  expect(sourceBouncingReplaceRgb('#80123456','#aabbcc')).toBe('#80aabbcc');expect(sourceBouncingReplaceRgb('#00123456','#abcdef')).toBe('#00abcdef');
  expect(sourceBouncingReplaceRgb('0x80123456','#123456')).toBe('0x80123456');expect(sourceBouncingReplaceRgb('-65536','#ff0000')).toBe('-65536');expect(sourceBouncingReplaceRgb('invalid','#ffffff')).toBe('invalid');
  expect(sourceBouncingReplaceRgb('invalid','#abcdef')).toBe('#ffabcdef');expect(sourceBouncingPaletteColor('invalid')).toEqual({packed:0xffffffff,valid:false});
 });
 it('reorders strings without resampling, color parsing or mutating the input',()=>{
  const colors=['#80010203','invalid','-1','0x123456'];expect(moveSourceBouncingColor(colors,0,3)).toEqual(['invalid','-1','0x123456','#80010203']);expect(colors).toEqual(['#80010203','invalid','-1','0x123456']);
  for(const pair of [[-1,0],[0,4],[0,.5]])expect(()=>moveSourceBouncingColor(colors,...pair as [number,number])).toThrow('索引');
 });
});
