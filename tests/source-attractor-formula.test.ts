import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {defaultFormulas,formulaPresentation,formulaLabels,mainEquation,sourceFormulaQuad} from '../src/engine/formulas';
import {sourceAttractorFormulaLatex} from '../src/engine/sourceAttractorFormulaLatex';
import {prepareSourceAttractorEquation,sourceAttractorVariableNames} from '../src/engine/sourceAttractorEquation';
import dadras from './fixtures/source-attractor/dadras-source.json';

const input={config_version:'1.0.0',type:'ATTRACTOR',name:'JSON_title',settings:{render_mode:'CPU',particle_count_cpu:2,sub_steps:1},initialization:{warmup_steps:0,warmup_stagger_min:0,warmup_stagger_max:0},equations:{dx:'y-x',dy:'x-z',dz:'x*y-z'},timeline:[{type:'wait',duration:1}]};
const read=(extra:Record<string,unknown>={})=>parseProjectFile(JSON.stringify({...input,...extra}));
describe('source Attractor formula construction and persisted import boundary',()=>{
 it('matches the executed original Aizawa automatic label exactly',()=>{
  // Original 1.7.8 a6e1da3... jar; full timeline aizawa-r3 stdout line 28
  // (logs/mathart.log:11), not generated from the production emitter.
  const value=sourceAttractorFormulaLatex({name:'Aizawa Attraktor',equations:{dx:'(z - b)x - d y',dy:'d x + (z - b) y',dz:'c + a z - z^3/3 - (x^2 + y^2)(1 + e*z) + f z x^3'},parameters:{a:.95,b:.7,c:.6,d:3.5,e:.25,f:.1}});
  expect(value).toBe(String.raw`\text{Aizawa Attraktor}=\begin{cases} \dot{x} = \left(z - b\right) x - d y \\ \dot{y} = d x + \left(z - b\right) y \\ \dot{z} = c + a z - \frac{{z}^{3}}{3} - \left({x}^{2} + {y}^{2}\right) \left(1 + e z\right) + f z {x}^{3} \end{cases}`);
 });
 it('uses the same variable slots as numeric evaluation and escapes only title underscores',()=>{
  const scene={name:'A_b',equations:{dx:'x+k_1+alpha',dy:'y',dz:'z'},parameters:{x:7,k_1:2,alpha:3}};
  expect(sourceAttractorVariableNames(scene.parameters)).toEqual(['x','y','z','alpha','k_1','x']);
  expect(sourceAttractorFormulaLatex(scene)).toBe(String.raw`\text{A\_b}=\begin{cases} \dot{x} = x + k_1 + \alpha \\ \dot{y} = y \\ \dot{z} = z \end{cases}`);
  const equation=prepareSourceAttractorEquation(scene);if(!equation.ok)throw Error('valid equation');const result=new Float32Array(3);equation.value.create().compute(99,4,5,result);expect([...result]).toEqual([12,4,5]);
  expect(()=>sourceAttractorFormulaLatex({...scene,equations:{...scene.equations,dx:'x>0?x:0'}})).toThrow('原版吸引子主方程');
 });
 it('preserves extra-first source order, defaults and ignored fields through save/reopen, then permits local author override',()=>{
  const raw={main_equation:{enabled:true,latex:{ignored:true}},formulas:[{latex:String.raw`\(a\)`,enabled:false},{latex:'second',position:[12],scale:'0x1.0p-1'},{}]},result=read(raw),scene=result.scene;
  expect(scene.formulas).toMatchObject({layout:'source-surface-centered-v1',main:{visible:true,x:0,y:200,scale:.25,color:'#ffffff'},additional:[{visible:true,x:0,y:0,scale:1},{visible:true,x:0,y:0,scale:.5},{visible:true,latex:''}]});
  expect(scene.formulas!.main.latex).toBeUndefined();expect(scene.provenance!.original).toMatchObject(raw);
  expect(formulaLabels(scene).map(label=>label.id)).toEqual(['imported-formula-1','imported-formula-2','main-equation']);expect(formulaLabels(scene)[0].latex).toBe(String.raw`\(a\)`);
  expect(formulaLabels(scene)[2].latex).toContain(String.raw`\text{JSON\_title}`);
  const reopened=parseScene(serializeScene(scene));expect(reopened.formulas).toEqual(scene.formulas);expect(formulaLabels(reopened)).toEqual(formulaLabels(scene));
  reopened.formulas!.main.latex='local override';expect(formulaLabels(parseScene(serializeScene(reopened))).at(-1)!.latex).toBe('local override');
 });
 it('binds Float32 style values, opaque ConfigUtils colors and retained number tokens',()=>{
  const scene=read({main_equation:{enabled:'TrUe',position:[.1,'0x1.8p2',99],scale:.03,color:'0x112233'},formulas:[{latex:'extra',position:[.2,.3],scale:.4,color:'#abcdef'}]}).scene;
  expect(scene.formulas!.main).toMatchObject({x:Math.fround(.1),y:6,scale:Math.fround(.03),color:'#112233'});
  expect(scene.formulas!.additional[0]).toMatchObject({x:Math.fround(.2),y:Math.fround(.3),scale:Math.fround(.4)});
  const reopened=parseScene(serializeScene(scene));expect(reopened.formulas).toEqual(scene.formulas);
  expect(reopened.provenance!.sourceNumberTokens).toEqual(expect.arrayContaining([{path:['main_equation','scale'],token:'0.03'},{path:['formulas','0','position','1'],token:'0.3'}]));
  expect(read({main_equation:{enabled:true,color:'invalid'}}).scene.formulas!.main.color).toBe('#ffffff');
  expect(()=>read({main_equation:{enabled:true,color:'#80000000'}})).toThrow('透明颜色');
  expect(()=>read({main_equation:{enabled:true,scale:'NaN'}})).toThrow('非有限');
  expect(()=>read({main_equation:{enabled:true,position:[1]}})).toThrow('至少两项');
  expect(()=>read({formulas:[{position:'invalid'}]})).toThrow('源坐标数组');
 });
 it('does not read disabled main styles; absent/disabled formulas still preserve source layout and viewport requirements',()=>{
  for(const enabled of [false,'FALSE',null,' true ']){
   const scene=read({main_equation:{enabled,position:'ignored',scale:'NaN',color:{ignored:true}}}).scene;
   expect(formulaLabels(scene)).toEqual([]);expect(scene.formulas!.layout).toBe('source-surface-centered-v1');
  }
  const scene=read().scene;expect(formulaLabels(scene)).toEqual([]);expect(()=>formulaPresentation(scene)).toThrow('主画布');
  expect(formulaPresentation(scene,{target:'primary',logicalHeight:60})).toMatchObject({layout:'source-surface-centered-v1',primaryLogicalHeight:60,labels:[]});
  expect(()=>formulaPresentation(scene,{target:'offscreen',logicalHeight:600})).toThrow('主画布');
  expect(parseProjectFile(JSON.stringify(dadras)).scene.formulas).toMatchObject({layout:'source-surface-centered-v1',main:{visible:false}});
 });
 it('preserves source coordinates across explicit primary resize and offscreen density without changing text',()=>{
  const scene=read({main_equation:{enabled:true,position:[10,20],scale:.25}}).scene;
  const primary=formulaPresentation(scene,{target:'primary',logicalHeight:100}),offscreen=formulaPresentation(scene,{target:'offscreen',logicalHeight:300,referenceLogicalHeight:100}),resized=formulaPresentation(scene,{target:'primary',logicalHeight:200});
  expect(primary.labels).toEqual(offscreen.labels);expect(resized.labels).toEqual(primary.labels);
  if(offscreen.layout!=='source-surface-centered-v1')throw Error('source layout expected');
  expect([...sourceFormulaQuad(offscreen,offscreen.labels[0],500,600,{width:8,height:4})]).toEqual([54,117,54,123,66,123,66,117]);
 });
 it('preserves known getString(default) conversions and refuses unknown Java spellings',()=>{
  const text=JSON.stringify({...input,formulas:[{latex:'BIG',color:-16777216},{latex:true}]}).replace('"BIG"','9007199254740993');
  const scene=parseProjectFile(text).scene;expect(scene.formulas!.additional.map(label=>label.latex)).toEqual(['9007199254740993','true']);expect(scene.formulas!.additional[0].color).toBe('#000000');
  const reopened=parseScene(serializeScene(scene));expect(reopened.formulas).toEqual(scene.formulas);expect(reopened.provenance!.sourceNumberTokens).toContainEqual({path:['formulas','0','latex'],token:'9007199254740993'});
  expect(()=>read({formulas:[{latex:{unconfirmed:'Java container formatting'}}]})).toThrow('字符串表示尚未确认');
 });
 it('does not migrate existing generic source documents or change generic automatic text/order',()=>{
  const scene=read().scene;scene.formulas=defaultFormulas();scene.formulas.main={...scene.formulas.main,visible:true,x:640,y:520,scale:.625};scene.formulas.additional=[{id:'extra',visible:true,latex:'extra',x:10,y:20,scale:1,color:'#fff000'}];
  const before=mainEquation(scene),reopened=parseProjectFile(serializeScene(scene)).scene;
  expect(reopened.formulas).toEqual(scene.formulas);expect(mainEquation(reopened)).toBe(before);expect(before).toContain(String.raw`\frac{dx}{dt}`);expect(formulaLabels(reopened).map(x=>x.id)).toEqual(['main-equation','extra']);
 });
});
