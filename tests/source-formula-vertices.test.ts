import {describe,it,expect} from 'vitest';
import native from './fixtures/source-formula-vertices/native.json';
import {sourceFormulaQuad} from '../src/engine/formulas';
import type {FormulaLabel,FormulaPresentation} from '../src/types';
describe('native TexMobject float vertex boundary',()=>{
 for(const [index,fixture] of native.cases.entries())it(`matches original formula ${index+1} at native logical size and physical density 2`,()=>{
  const label:FormulaLabel={id:String(index),visible:true,latex:'geometry-only',color:'#ffffff',anchor:'center',x:fixture.x,y:fixture.y,scale:fixture.scale};
  const presentation:Extract<FormulaPresentation,{layout:'source-surface-centered-v1'}>={layout:'source-surface-centered-v1',primaryLogicalHeight:native.primaryLogicalHeight,labels:[label]};
  for(const density of [1,2]){
   const actual=sourceFormulaQuad(presentation,label,native.nativeLogicalSize[0]*density,native.nativeLogicalSize[1]*density,fixture.glyph);
   expect(Array.from(actual)).toEqual(fixture.nativeCorners.map(v=>v*density));
  }
 });
});
