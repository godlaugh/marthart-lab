import {describe,it,expect} from 'vitest';
import native from './fixtures/source-roots-formula-order/native.json';
import {createScene,parseScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import {resolveFormulaContent,defaultFormulas} from '../src/engine/formulas';
import type {FormulaLabel} from '../src/types';
function scene(){
 const scene=createScene(definition('roots'));scene.rootsPresentation=defaultRootsPresentationConfiguration();
 const label=(v:{position:number[];scale:number;color:string;latex:string},id:string):FormulaLabel=>({id,visible:true,x:v.position[0],y:v.position[1],scale:v.scale,color:v.color,latex:v.latex,anchor:'center'});
 scene.formulas={layout:'source-surface-centered-v1',main:label(native.sourceConfiguration.main_equation,'main-equation'),additional:native.sourceConfiguration.formulas.map((v,i)=>label(v,'extra-'+i))};
 return parseScene(JSON.stringify(scene));
}
const colors=(s:ReturnType<typeof scene>)=>resolveFormulaContent(s).labels.map(label=>label.color.toUpperCase());
const observed=native.observedDraws.map(d=>'#'+d.opaqueRgba.slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase());
describe('original Roots formula overlap ordering',()=>{
 it('uses observed extra-extra-main order after save/reopen, without mutating authored configuration',()=>{
  const source=scene(),before=structuredClone(source.formulas);expect(colors(source)).toEqual(observed);
  expect(resolveFormulaContent(source).labels.map(l=>l.id)).toEqual(['extra-0','extra-1','main-equation']);expect(source.formulas).toEqual(before);
 });
 it('preserves native order when hidden and empty extras are filtered, including disabled main',()=>{
  const source=scene();source.formulas!.additional[0].visible=false;expect(colors(source)).toEqual(observed.slice(1));
  source.formulas!.main.visible=false;expect(colors(source)).toEqual([observed[1]]);
  source.formulas!.additional[1].latex=' ';expect(colors(source)).toEqual([]);
 });
 it('keeps generic saved Roots main-first order, without inferring a layout migration',()=>{
  const source=scene(),{main,additional}=source.formulas!;source.formulas={...defaultFormulas(),main,additional};
  expect(colors(parseScene(JSON.stringify(source)))).toEqual([observed[2],observed[0],observed[1]]);
 });
});
