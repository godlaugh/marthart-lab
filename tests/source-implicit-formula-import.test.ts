import {describe,it,expect} from 'vitest';
import input from './fixtures/source-implicit-presentation/native.json';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {formulaLabels} from '../src/engine/formulas';
const read=(extra:Record<string,unknown>)=>parseProjectFile(JSON.stringify({...input.cases[0].input,...extra})).scene;
describe('Implicit native formula import boundary',()=>{
 it('generates the main label from its field and preserves ignored source latex',()=>{
  const scene=read({main_equation:{enabled:true,latex:{not:'source text'}}});
  expect(scene.formulas!.main).not.toHaveProperty('latex');expect(formulaLabels(scene)[0].latex).toBe('{x}^{2} + {y}^{2} - {z}^{2} - 1 = 0');
  expect(scene.provenance!.original).toMatchObject({main_equation:{latex:{not:'source text'}}});
  scene.formulas!.main.latex='Authored override';expect(formulaLabels(parseScene(serializeScene(scene)))[0].latex).toBe('Authored override');
 });
 it('does not inspect unused disabled main styles and reads native boolean strings',()=>{
  for(const enabled of [false,'FALSE',' true ',null]){
   const scene=read({main_equation:{enabled,position:'unused',scale:'unused',color:4,latex:{}}});expect(formulaLabels(scene)).toEqual([]);expect(parseScene(serializeScene(scene)).formulas).toEqual(scene.formulas);
  }
  expect(read({main_equation:{enabled:'TrUe'}}).formulas!.main.visible).toBe(true);
 });
 it('uses extra-formula defaults and ignores the source enabled member',()=>{
  const scene=read({main_equation:{enabled:false},formulas:[{latex:'x',enabled:false},{latex:'y',enabled:{ignored:true}}]});
  expect(formulaLabels(scene).map(({latex,visible,x,y,scale,color})=>({latex,visible,x,y,scale,color}))).toEqual(['x','y'].map(latex=>({latex,visible:true,x:0,y:0,scale:1,color:'#ffffff'})));
 });
 it('uses Float32 JSON scalar semantics and retains numeric evidence across save/load',()=>{
  const scene=read({main_equation:{enabled:true,scale:.03,position:[.1,'0x1.8p2',100]},formulas:[{latex:' x ',scale:'1/2',position:[-0,.2]}]});
  expect(scene.formulas!.main).toMatchObject({scale:Math.fround(.03),x:Math.fround(.1),y:6});expect(scene.formulas!.additional[0]).toMatchObject({latex:' x ',scale:1,x:0,y:Math.fround(.2)});
  const reopened=parseScene(serializeScene(scene));expect(reopened.formulas).toEqual(scene.formulas);expect(reopened.provenance!.sourceNumberTokens).toContainEqual({path:['main_equation','scale'],token:'0.03'});expect(reopened.provenance!.sourceNumberTokens).toContainEqual({path:['formulas','0','position','1'],token:'0.2'});
 });
 it('retains ignored disabled numeric lexemes without parsing them',()=>{
  const raw=JSON.stringify({...input.cases[0].input,main_equation:{enabled:false,scale:1,position:[2,3]}}).replace('"scale":1','"scale":1e999').replace('"position":[2,3]','"position":[-1e999,3]');
  const scene=parseScene(serializeScene(parseProjectFile(raw).scene));expect(scene.formulas!.main.visible).toBe(false);expect(scene.provenance!.sourceNumberTokens).toEqual(expect.arrayContaining([{path:['main_equation','scale'],token:'1e999'},{path:['main_equation','position','0'],token:'-1e999'}]));
 });
 it('rejects malformed active positions, missing extra text and nonfinite source scale',()=>{
  for(const position of [[1],['1+1',0],null])expect(()=>read({main_equation:{enabled:true,position}})).toThrow();
  expect(()=>read({formulas:[{}]})).toThrow('latex');expect(()=>read({main_equation:{enabled:true,scale:'NaN'}})).toThrow('非有限');
 });
});
