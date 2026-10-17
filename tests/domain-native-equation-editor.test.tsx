import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {analyzeEquation,analyzeEquationDraft,equationTokens,equationCompletion,insertEquationCompletion} from '../src/engine/equationEditor';
import {domainExpressions} from '../src/engine/domainExpressions';
import {domainNativeFunctionNames} from '../src/engine/domainNativeArithmetic';
import {EquationEditor} from '../src/components/EquationEditor';
import {I18nProvider} from '../src/i18n';
import type {SceneDocument} from '../src/types';

function native(version='mathart-1.7.8-cpu'):SceneDocument{
 const scene=createScene(definition('domain'));scene.settings.domainIterationVersion=version;scene.equations={f:'z',next:''};return scene;
}
function markup(scene:SceneDocument,draft:Record<string,string>){return renderToStaticMarkup(<I18nProvider language="zh"><EquationEditor scene={scene} equations={definition('domain').equations} draft={draft} onChange={()=>{}} onApply={()=>{}}/></I18nProvider>);}

describe('native Domain equation authoring follows the execution owner',()=>{
 it.each(['mathart-1.7.8-cpu','mathart-1.7.8-gpu'])('keeps recoverable raw syntax applicable under %s',version=>{
  const scene=native(version),draft={f:'sin(',next:''},analysis=analyzeEquationDraft(scene,draft);
  expect(analysis.f.error).toBeUndefined();expect(analysis.f.warnings?.join(' ')).toContain('保留原文');expect(analysis.f.effectiveSource).toBe('z^3 - 1');
  expect(draft.f).toBe('sin(');expect(scene.equations.f).toBe('z');
  const html=markup(scene,draft);expect(html).toContain('sin(');expect(html).toContain('z^3 - 1');expect(html).not.toContain('disabled=""');expect(html).not.toContain('aria-invalid="true"');
 });
 it('parses the complete native draft once and retains cache ownership across value changes',()=>{
  const scene=native(),draft={f:'z+_gain',next:'w+z'};scene.parameters={_gain:2};domainExpressions.clear();
  analyzeEquationDraft(scene,draft);expect(domainExpressions.diagnostics().parses).toBe(2);
  scene.parameters._gain=4;analyzeEquationDraft(scene,draft);expect(domainExpressions.diagnostics().parses).toBe(2);
 });
 it('uses the effective draft main for recovered next instead of committed main',()=>{
  const scene=native(),analysis=analyzeEquationDraft(scene,{f:'z+2',next:'sin('});
  expect(analysis.next.error).toBeUndefined();expect(analysis.next.effectiveSource).toBe('z+2');expect(analysis.f.warnings?.join(' ')).toContain('迭代公式');
 });
 it('retains source-specific next whitespace and checks raw capacity before normalization',()=>{
  const scene=native();
  for(const next of ['\u00a0','\u2007','\u202f']){
   const a=analyzeEquationDraft(scene,{f:'z+2',next});expect(a.f.warnings?.join(' ')).toContain('迭代公式');expect(a.next.effectiveSource).toBe('z+2');
  }
  expect(analyzeEquationDraft(scene,{f:'z',next:'\u2000'}).f.warnings).toBeUndefined();
  expect(analyzeEquationDraft(scene,{f:'z',next:' '.repeat(8193)}).next.error?.message).toContain('8192');
 });
 it('does not reject native unknowns, Unicode variables or spacing grammar',()=>{
  const scene=native();scene.parameters={_gain:2,π:3};
  for(const source of ['π+_gain','sin (z)','foo(z)','1e3','arccsc(z)',''])expect(analyzeEquation(scene,'f',source).error,source).toBeUndefined();
  const a=analyzeEquation(scene,'f','sin (z)');expect(a.warnings).toBeUndefined();
  expect(equationTokens('sin (z)+sin(z)+π+1e3',a.suggestions,true)).toEqual([
   {text:'sin',kind:'variable'},{text:' ',kind:'space'},{text:'(',kind:'operator'},{text:'z',kind:'variable'},{text:')',kind:'operator'},
   {text:'+',kind:'operator'},{text:'sin',kind:'function'},{text:'(',kind:'operator'},{text:'z',kind:'variable'},{text:')',kind:'operator'},
   {text:'+',kind:'operator'},{text:'π',kind:'variable'},{text:'+',kind:'operator'},{text:'1',kind:'number'},{text:'e3',kind:'variable'},
  ]);
 });
 it('offers only native functions and actual bindable names without implicit time or reserved shadowing',()=>{
  const scene=native();scene.parameters={a:1,A:2,_gain:3,π:4,'not.a.name':5,e:99};
  const analysis=analyzeEquation(scene,'f','z');
  expect(analysis.suggestions.filter(s=>s.kind==='function').map(s=>s.name)).toEqual([...domainNativeFunctionNames]);
  expect(analysis.suggestions).toContainEqual({name:'e',kind:'constant'});expect(analysis.suggestions).not.toContainEqual({name:'e',kind:'variable'});
  expect(analysis.suggestions).toContainEqual({name:'π',kind:'variable'});expect(analysis.suggestions).toContainEqual({name:'_gain',kind:'variable'});
  for(const name of ['arcsin','arccos','arctan','time','A','not.a.name'])expect(analysis.suggestions.some(s=>s.name===name),name).toBe(false);
 });
 it('keeps native function completion adjacent and supports Unicode prefix completion',()=>{
  const suggestions=analyzeEquation(native(),'f','z').suggestions;
  const range=equationCompletion('si (z)',2,suggestions,false,true);
  expect(insertEquationCompletion('si (z)',range,{name:'sin',kind:'function'},true)).toEqual({source:'sin(z)',caret:3});
  expect(insertEquationCompletion('si (z)',range,{name:'sin',kind:'function'})).toEqual({source:'sin (z)',caret:3});
  expect(equationCompletion('π',1,[{name:'πgain',kind:'variable'}],false,true).items).toEqual([{name:'πgain',kind:'variable'}]);
 });
 it('shows source GPU main-w fallback without blocking native CPU recovery',()=>{
  const analysis=analyzeEquation(native('mathart-1.7.8-gpu'),'f','w+1');
  expect(analysis.error).toBeUndefined();expect(analysis.warnings?.join(' ')).toContain('w 未声明');
 });
 it('still blocks capacity failures rather than recovering them into a small formula',()=>{
  const scene=native(),draft={f:Array(300).fill('z').join('+'),next:''};
  expect(analyzeEquationDraft(scene,draft).f.error?.message).toContain('512');
  const html=markup(scene,draft);expect(html).toContain('disabled=""');expect(html).toContain('aria-invalid="true"');
  expect(analyzeEquation(scene,'f','z'.repeat(8193)).error?.message).toContain('8192');
 });
 it('preserves both existing execution versions and their local MathJS validation',()=>{
  for(const version of ['local-v1','mathart-1.7.8']){
   const scene=native(version);expect(analyzeEquation(scene,'f','sin(').error).toBeDefined();expect(analyzeEquation(scene,'f','').error).toBeDefined();
   expect(analyzeEquation(scene,'f','arcsin(z)').error).toBeUndefined();expect(analyzeEquation(scene,'f','z').suggestions).toContainEqual({name:'time',kind:'variable'});
  }
 });
});
