import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {definitions,definition} from '../src/scenes';
import {createScene} from '../src/engine/document';
import {analyzeEquation,equationCompletion,equationTokens,insertEquationCompletion} from '../src/engine/equationEditor';
import {compileReal} from '../src/engine/expression';
import {EquationEditor} from '../src/components/EquationEditor';
import {I18nProvider} from '../src/i18n';

describe('equation editor uses production compiler contracts',()=>{
 it('accepts all built-in editable equations, including complex roots and conditional regions',()=>{
  for(const def of definitions)for(const preset of [undefined,...def.presets]){
   const scene=createScene(def,preset);
   for(const eq of def.equations)expect(analyzeEquation(scene,eq.key,scene.equations[eq.key]??'').error,`${def.kind}/${preset?.id}/${eq.key}`).toBeUndefined();
  }
 });
 it('checks both branches and rejects ambient/prototype access without evaluating mathematical domains',()=>{
  const scene=createScene(definition('surface'));
  for(const source of ['u>0 ? u : missing','sin(','u=3','import("fs")','constructor(u)','x.y','x[0]'])expect(analyzeEquation(scene,'x',source).error,source).toBeDefined();
  for(const source of ['sqrt(u)','1/u','log(u)','π*u','e*u'])expect(analyzeEquation(scene,'x',source).error,source).toBeUndefined();
  expect(()=>compileReal('u>0?u:missing',['u'])).toThrow('未知变量 missing');
  expect(compileReal('u>0?u:missing')({u:1})).toBe(1);
 });
 it('honors per-axis map aliases, scene-specific time and the exact Math namespace normalizer',()=>{
  const map=createScene(definition('map'));
  expect(analyzeEquation(map,'x','nx+y').error).toBeDefined();expect(analyzeEquation(map,'y','nx+y').error).toBeUndefined();
  expect(analyzeEquation(map,'y','ny+x').error).toBeDefined();expect(analyzeEquation(map,'z','ny+x').error).toBeUndefined();
  const bouncing=createScene(definition('bouncing'));
  expect(analyzeEquation(bouncing,'mask','Math.sin(x)+Math.PI>y').error).toBeUndefined();
  expect(analyzeEquation(bouncing,'mask','Math.random()').error).toBeDefined();
  expect(analyzeEquation(bouncing,'mask','time').error).toBeDefined();
 });
 it('validates roots with named parameters and polynomial restrictions, and allows an omitted iteration expression',()=>{
  const roots=createScene(definition('roots'));
  expect(analyzeEquation(roots,'polynomial','z^4+t1').error).toBeUndefined();
  expect(analyzeEquation(roots,'polynomial','sin(z)').error).toBeDefined();
  expect(analyzeEquation(roots,'polynomial','z^4+unknown').error).toBeDefined();
  const domain=createScene(definition('domain'));
  expect(analyzeEquation(domain,'next','').error).toBeUndefined();expect(analyzeEquation(domain,'f','').error).toBeDefined();
 });
 it('retains invalid source text while coloring and replaces whole identifiers without changing nearby user text',()=>{
  const scene=createScene(definition('surface')),source='R + siXXX(v) + 1e-3\n<bad>',analysis=analyzeEquation(scene,'x',source);
  const tokens=equationTokens(source,analysis.suggestions);expect(tokens.map(t=>t.text).join('')).toBe(source);expect(tokens.find(t=>t.text==='1e-3')?.kind).toBe('number');
  const range=equationCompletion(source,6,analysis.suggestions);expect(range.items.map(i=>i.name)).toContain('sin');
  const inserted=insertEquationCompletion(source,range,range.items.find(i=>i.name==='sin')!);expect(inserted.source).toBe('R + sin(v) + 1e-3\n<bad>');
  const empty=equationCompletion('si',2,analysis.suggestions),next=insertEquationCompletion('si',empty,empty.items.find(i=>i.name==='sin')!);expect(next).toEqual({source:'sin()',caret:4});
 });
 it('exposes invalid state and disables apply while escaping source and translating editor labels',()=>{
  const scene=createScene(definition('surface')),draft={...scene.equations,x:'<bad>'};
  const html=renderToStaticMarkup(<I18nProvider language="en"><EquationEditor scene={scene} equations={definition('surface').equations} draft={draft} onChange={()=>{}} onApply={()=>{}}/></I18nProvider>);
  expect(html).toContain('aria-invalid="true"');expect(html).toContain('disabled=""');expect(html).not.toContain('<bad>');expect(html).toContain('Enter to apply');
 });
 it('reports coordinate-independent real domain failures without rejecting valid coordinate-dependent singularities',()=>{
  const scene=createScene(definition('surface'));scene.parameters={a:0,e:-1};
  for(const expression of ['1/0','sqrt(-1)','log(-2)','1/a','sqrt(e)','1e999'])expect(analyzeEquation(scene,'x',expression).error?.message).toContain('有限实数');
  for(const expression of ['1/u','sqrt(u)','u>0?sqrt(u):-sqrt(-u)','1?2:1/0'])expect(analyzeEquation(scene,'x',expression).error).toBeUndefined();
  const domain=createScene(definition('domain'));expect(analyzeEquation(domain,'f','sqrt(-1)').error).toBeUndefined();
 });
});

describe('source Samila equation editor scope',()=>{
 const source=()=>{const s=createScene(definition('samila'));s.settings.iteratedMode='continuous';s.settings.samilaMathModel='mathart-1.7.8';s.parameters={};s.equations={f1:'x',f2:'y'};return s;};
 it('accepts native real bars and a-d slots, rejects implicit time and local conditional grammar',()=>{const s=source();for(const text of ['|x|','a+x','sin(x)','sqrt(-1)',''])expect(analyzeEquation(s,'f1',text).error,text).toBeUndefined();for(const text of ['time+x','t+x','x>0?x:0','sin (x)','PI','E','TAU','TWO_PI','HALF_PI'])expect(analyzeEquation(s,'f1',text).error,text).toBeDefined();s.parameters={time:2};expect(analyzeEquation(s,'f1','time+x').error).toBeUndefined();const names=analyzeEquation(source(),'f1','x').suggestions.map(v=>v.name);expect(names).toContain('a');expect(names).not.toContain('time');expect(names).not.toContain('PI');});
 it('shows source coordinate labels without local time and does not claim missing variables evaluate to zero',()=>{const s=source(),html=renderToStaticMarkup(<I18nProvider language="zh"><EquationEditor scene={s} equations={definition('samila').equations} draft={s.equations} onChange={()=>{}} onApply={()=>{}}/></I18nProvider>);expect(html).toContain('f₁(x, y)');expect(html).toContain('不注入时间');expect(html).not.toContain('未绑定变量按 0 求值');});
 it('does not rename conflicting original shader globals into newly valid parameters',()=>{const s=source();for(const key of ['u_generateMode','scale','offset','radius','noiseLUT','u_rangeStart','PI']){s.parameters={[key]:1};expect(analyzeEquation(s,'f1','x').error,key).toBeDefined();}s.parameters={e:1,pi:2};expect(analyzeEquation(s,'f1','e+pi+x').error).toBeUndefined();});
});
