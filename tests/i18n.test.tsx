import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ENGLISH_CATALOG,I18nProvider,translate,localizeDefinition} from '../src/i18n';
import {builtInTranslationSources} from '../src/i18nMetadata';
import {definitions} from '../src/scenes';
import {defaultFormulas} from '../src/engine/formulas';
import {createScene} from '../src/engine/document';
import {Control} from '../src/components/Fields';
import {PaletteEditor} from '../src/components/PaletteEditor';
import {SceneName} from '../src/components/SceneName';
import {Timeline} from '../src/components/Timeline';
import {FormulaEditor} from '../src/components/FormulaEditor';
const chinese=/[\u3400-\u9fff]/;
const placeholders=(s:string)=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
describe('explicit locale boundary',()=>{
 it('switches exact source labels and preserves unknown messages',()=>{
  expect(translate('en','场景名称')).toBe('Scene name');expect(translate('zh','场景名称')).toBe('场景名称');
  expect(translate('en','没有目录项的原始消息')).toBe('没有目录项的原始消息');
 });
 it('interpolates named/positional fields without translating user text',()=>{
  expect(translate('en','已保存：{value0}',{value0:'极光 · Aurora {0}'})).toBe('Saved: 极光 · Aurora {0}');
  expect(translate('zh','删除参数 {0}',{0:'用户名字'})).toBe('删除参数 用户名字');
  expect(translate('en','色标 {0}',{0:7})).toBe('Stop 7');
 });
 it('translates canonical stored statuses on each render without mutating them',()=>{
  const source='已保存：我的作品';expect(translate('en',source)).toBe('Saved: 我的作品');expect(translate('zh',source)).toBe(source);
  expect(translate('en','草稿保存失败：磁盘已满')).toBe('Could not save draft: 磁盘已满');
 });
 it('every translation preserves exact placeholders and has English content',()=>{
  for(const[source,value]of Object.entries(ENGLISH_CATALOG)){expect(value.trim(),source).not.toBe('');expect(chinese.test(value),source).toBe(false);expect(placeholders(value),source).toEqual(placeholders(source));}
 });
 it('covers current metadata from all twelve scene owners and shared menus',()=>{
  expect(definitions).toHaveLength(12);const rows=builtInTranslationSources();expect(rows.length).toBeGreaterThan(1000);
  expect(rows.filter(r=>!Object.hasOwn(ENGLISH_CATALOG,r.source))).toEqual([]);
  for(const row of rows)expect(chinese.test(translate('en',row.source)),row.path).toBe(false);
 });
 it('localizes built-in definitions without mutating semantic IDs or saved values',()=>{
  for(const definition of definitions){const before=JSON.stringify(definition),localized=localizeDefinition(definition,'en');expect(localized.name).toBe(definition.englishName);expect(localized.generate).toBe(definition.generate);expect(localized.defaults).toBe(definition.defaults);expect(localized.controls.map(c=>[c.key,c.options?.map(o=>o.value)])).toEqual(definition.controls.map(c=>[c.key,c.options?.map(o=>o.value)]));expect(JSON.stringify(definition)).toBe(before);expect(localizeDefinition(definition,'zh')).toBe(definition);}
 });
 it('renders labels, option labels and help with provider while leaving option values exact',()=>{
  const spec={key:'choice',group:'颜色',label:'色标插值',help:'复平面网格',type:'select' as const,options:[{value:'rgb',label:'实数区间'}]};
  const component=<Control spec={spec} value="rgb" onChange={()=>{}}/>;
  const en=renderToStaticMarkup(<I18nProvider language="en">{component}</I18nProvider>),zh=renderToStaticMarkup(<I18nProvider language="zh">{component}</I18nProvider>);
  expect(en).toContain('aria-label="Stop interpolation"');expect(en).toContain('title="Complex-plane grid"');expect(en).toContain('value="rgb"');expect(en).toContain('Real interval');expect(chinese.test(en)).toBe(false);expect(zh).toContain('色标插值');
 });
 it('preserves user names, palette names, track labels and LaTeX in rendered editors',()=>{
  const scene=createScene(definitions[0]);scene.name='我的作品';scene.palette.name='我的调色板';scene.timeline.tracks[0].label='我的片段';scene.formulas=defaultFormulas();scene.formulas.main.latex='\\text{我的公式}';
  const before=JSON.stringify(scene),markup=renderToStaticMarkup(<I18nProvider language="en"><SceneName name={scene.name} onChange={()=>{}} onError={()=>{}}/><PaletteEditor palette={scene.palette} onChange={()=>{}}/><Timeline scene={scene} time={0} playing={false} onTime={()=>{}} onPlay={()=>{}} onRestart={()=>{}} onChange={()=>{}}/><FormulaEditor scene={scene} onChange={()=>{}}/></I18nProvider>);
  expect(markup).toContain('value="我的作品"');expect(markup).toContain('value="我的调色板"');expect(markup).toContain('我的片段');expect(markup).toContain('\\text{我的公式}');expect(markup).toContain('Palette editor');expect(markup).toContain('Animation timeline');expect(JSON.stringify(scene)).toBe(before);
 });
});
