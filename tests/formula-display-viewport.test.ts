import {describe,it,expect} from 'vitest';
import {validateFormulaPresentation,withSourceFormulaDrawingViewport} from '../src/engine/formulaConfig';
import type {FormulaPresentation} from '../src/types';

describe('delivered source formula viewport',()=>{
 it('preserves an independent physical viewport through the transport parser without rewriting labels',()=>{
  const label={id:'main',latex:'x^2',visible:true,x:0,y:200,scale:.25,color:'#ffffff',anchor:'center' as const};
  const source:FormulaPresentation={layout:'source-surface-centered-v1',primaryLogicalHeight:486,labels:[label]};
  const viewport:[number,number,number,number]=[0,0,810,972],bound=withSourceFormulaDrawingViewport(source,viewport);
  viewport[2]=1;label.latex='changed';
  const delivered=validateFormulaPresentation(structuredClone(bound));
  expect(delivered).toMatchObject({drawingViewport:[0,0,810,972],primaryLogicalHeight:486,labels:[{latex:'x^2',x:0,y:200,scale:.25}]});
  expect(source).not.toHaveProperty('drawingViewport');
 });
 it('does not reinterpret existing local formulas as source layout',()=>{
  const legacy:FormulaPresentation={referenceWidth:1280,referenceHeight:720,labels:[]};
  expect(withSourceFormulaDrawingViewport(legacy,[0,0,810,972])).toEqual(legacy);
  expect(()=>validateFormulaPresentation({...legacy,drawingViewport:[0,0,810,972]})).toThrow('源公式布局');
 });
 it('rejects malformed runtime state rather than dropping it at serialization',()=>{
  const source={layout:'source-surface-centered-v1',primaryLogicalHeight:486,labels:[]};
  for(const drawingViewport of [[0,0,1.5,600],[0,0,-1,600],[0,0,NaN,600],[]])expect(()=>validateFormulaPresentation({...source,drawingViewport})).toThrow();
  expect(validateFormulaPresentation({...source,drawingViewport:[-5,2,0,600]})).toHaveProperty('drawingViewport',[-5,2,0,600]);
 });
});
