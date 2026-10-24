import {describe,expect,it,vi} from 'vitest';
import {isValidElement,type ReactElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {FractalControls} from '../src/components/FractalControls';
import {FractalColorProfileControl,FractalSourceColorControls,FractalSourcePaletteEditor} from '../src/components/FractalSourceColorControls';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {FRACTAL_SOURCE_COLOR_ALGORITHMS,FRACTAL_SOURCE_COLOR_PROFILE,createDefaultFractalSourceColorConfiguration,fractalSourceColorParameterDescriptors} from '../src/engine/fractalSourceColor';
import {FRACTAL_SOURCE_NUMERIC_PROFILE} from '../src/engine/fractalPrecision';
import type {SceneDocument} from '../src/types';

// Component callbacks are exercised as controlled authoring boundaries. This is
// not a mounted-browser or GPU-pixel claim; root owns the real App verifier.
vi.mock('react',async load=>({...await load<typeof import('react')>(),useState:(initial:unknown)=>[typeof initial==='function'?initial():initial,vi.fn()],useRef:(current:unknown)=>({current}),useEffect:vi.fn()}));
vi.mock('../src/i18n',async load=>({...await load<typeof import('../src/i18n')>(),useI18n:()=>({t:(s:string,args?:Record<string,string|number>)=>s.replace(/\{(\w+)\}/g,(_,k)=>String(args?.[k]??`{${k}}`))})}));
const local=()=>createScene(definition('fractal'));
const source=()=>{const scene=local();scene.settings={...scene.settings,formula:'newton',fractalNumericProfile:FRACTAL_SOURCE_NUMERIC_PROFILE,fractalColorProfile:FRACTAL_SOURCE_COLOR_PROFILE};scene.fractalSourceColor=createDefaultFractalSourceColorConfiguration();return scene;};
type Node=ReactElement<Record<string,any>>;
function flatten(node:ReactNode):Node[]{
 if(Array.isArray(node))return node.flatMap(flatten);if(!isValidElement(node))return[];const e=node as Node;
 if(typeof e.type==='function')return flatten((e.type as (p:unknown)=>ReactNode)(e.props));return[e,...flatten(e.props.children)];
}
function byLabel(tree:ReactNode,label:string){const n=flatten(tree).find(x=>x.props['aria-label']===label);expect(n,`field ${label}`).toBeDefined();return n!.props;}
function button(tree:ReactNode,label:string){const n=flatten(tree).find(x=>x.type==='button'&&x.props.children===label);expect(n,`button ${label}`).toBeDefined();return n!.props;}
const html=(scene:SceneDocument,section:'formula'|'color'|'all'='color')=>renderToStaticMarkup(<FractalControls scene={scene} section={section} onChange={()=>{}}/>);

describe('source color authoring surface',()=>{
 it('selects independent source defaults and restores omission while preserving both authored families',()=>{
  const scene=local();scene.palette.stops=['#112233','#abcdef'];const before=structuredClone(scene),change=vi.fn();
  byLabel(<FractalColorProfileControl scene={scene} onChange={change}/>,'分形着色版本').onChange({target:{value:FRACTAL_SOURCE_COLOR_PROFILE}});
  const enabled=change.mock.calls[0][0] as SceneDocument;expect(enabled.settings.fractalColorProfile).toBe(FRACTAL_SOURCE_COLOR_PROFILE);expect(enabled.fractalSourceColor).toEqual(createDefaultFractalSourceColorConfiguration());expect(enabled.palette).toEqual(scene.palette);expect(scene).toEqual(before);
  byLabel(<FractalColorProfileControl scene={enabled} onChange={change}/>,'分形着色版本').onChange({target:{value:''}});
  const restored=change.mock.calls[1][0] as SceneDocument;expect(restored.settings).toEqual(scene.settings);expect(restored.fractalSourceColor).toEqual(enabled.fractalSourceColor);expect(restored.palette).toEqual(scene.palette);
 });
 it('does not parse inactive local style or palette fields for source color or formula-only panels',()=>{
  const scene=source();Object.assign(scene.settings,{fractalColorVersion:2,insidePalette:'not json',outsidePalette:'not json',directGamma:'bad'});
  const text=html(scene);expect(text).toContain('原版内部与外部着色');expect(text).not.toContain('距离估计规则');expect(text).not.toContain('此区域使用独立色板');expect(text).not.toContain('not json');
  delete scene.settings.fractalColorProfile;expect(()=>html(scene,'formula')).not.toThrow();
 });
 it.each(FRACTAL_SOURCE_COLOR_ALGORITHMS)('exposes both regions and only the owner descriptors for %s',algorithm=>{
  const scene=source();scene.fractalSourceColor!.inside.algorithm=algorithm;scene.fractalSourceColor!.outside.algorithm=algorithm;
  const text=html(scene);expect((text.match(/value="direct_normalized_z"/g)??[]).length).toBe(2);
  for(const d of fractalSourceColorParameterDescriptors(algorithm))expect((text.match(new RegExp(`data-source-parameter="${d.key}"`,'g'))??[]).length).toBe(2);
  expect(text).toContain('aria-label="外部 · 传递函数"');expect(text).toContain('aria-label="内部 · 颜色密度"');
 });
 it('preserves expression text, side independence and dormant algorithm parameters through edits',()=>{
  const scene=source(),change=vi.fn();scene.fractalSourceColor!.outside.algorithm='direct_orbit_trap';scene.fractalSourceColor!.outside.parameters={trap_angle:'pi / 3',unused:'kept'};const before=structuredClone(scene);
  const tree=<FractalSourceColorControls scene={scene} onChange={change}/>;
  expect(byLabel(tree,'外部 · 陷阱角度').value).toBe('pi / 3');byLabel(tree,'外部 · 陷阱角度').onChange({target:{value:'90 + 15'}});
  const next=change.mock.calls[0][0] as SceneDocument;expect(next.fractalSourceColor!.outside.parameters).toEqual({trap_angle:'90 + 15',unused:'kept'});expect(next.fractalSourceColor!.inside).toEqual(scene.fractalSourceColor!.inside);expect(next.palette).toEqual(scene.palette);expect(scene).toEqual(before);
  expect(html(scene)).toContain('计算时下限：0.000001');expect(html(scene)).toContain('(度)');
 });
 it('uses source color editing helpers so RGB replacement preserves alpha and raw text editing stays raw',()=>{
  const scene=source(),change=vi.fn();scene.fractalSourceColor!.outside.solidColor='#40112233';const tree=<FractalSourceColorControls scene={scene} onChange={change}/>;
  byLabel(tree,'外部 · 固定颜色原文 RGB').onChange({target:{value:'#aabbcc'}});expect(change.mock.calls[0][0].fractalSourceColor.outside.solidColor).toBe('#40AABBCC');
  byLabel(tree,'外部 · 固定颜色原文').onChange({target:{value:'invalid preserved text'}});expect(change.mock.calls[1][0].fractalSourceColor.outside.solidColor).toBe('invalid preserved text');
 });
 it('offers explicit numeric/backend repair without silently changing the saved scene',()=>{
  const scene=source(),change=vi.fn();scene.settings.formula='mandelbrot';delete scene.settings.fractalNumericProfile;scene.settings.fractalBackend='cpu';const before=structuredClone(scene),tree=<FractalSourceColorControls scene={scene} onChange={change}/>;
  expect(renderToStaticMarkup(tree)).toContain('请选择对应公式后继续');expect(change).not.toHaveBeenCalled();expect(scene).toEqual(before);button(tree,'使用 Nova 原版数值').onClick();
  const next=change.mock.calls[0][0] as SceneDocument;expect(next.settings).toMatchObject({formula:'nova',fractalNumericProfile:FRACTAL_SOURCE_NUMERIC_PROFILE,fractalBackend:'auto'});expect(next.fractalSourceColor).toEqual(scene.fractalSourceColor);expect(next.palette).toEqual(scene.palette);
 });
 it('keeps profile and numeric repair visible after switching to a 3D formula',()=>{
  const scene=source();scene.settings.formula='mandelbulb_3d';const text=html(scene);
  expect(text).toContain('aria-label="分形着色版本"');expect(text).toContain('使用 Newton 原版数值');expect(text).toContain('使用 Nova 原版数值');expect(text).not.toContain('此区域使用独立色板');
 });
 it('keeps unknown authored algorithm/transfer available for explicit correction',()=>{
  const scene=source();scene.fractalSourceColor!.outside.algorithm='future';scene.fractalSourceColor!.outside.transfer='future-transfer';const text=html(scene);expect(text).toContain('value="future" selected=""');expect(text).toContain('value="future-transfer" selected=""');expect(text).toContain('role="alert"');
 });
 it('shows source DE inside-zero and outside fallback independently',()=>{
  const scene=source();scene.fractalSourceColor!.inside.algorithm='distance_estimator';scene.fractalSourceColor!.outside.algorithm='distance_estimator';const text=html(scene);expect(text).toContain('内部距离着色索引为 0');expect(text).toContain('Newton / Nova 的距离估计使用原版 Smooth 回退');
 });
});

describe('independent source palette editor',()=>{
 it('shows cosine channels and hides inactive manual palette fields without mutating them',()=>{
  const scene=source(),change=vi.fn(),before=structuredClone(scene),tree=<FractalSourcePaletteEditor scene={scene} onChange={change}/>;const text=renderToStaticMarkup(tree);
  expect(text).toContain('aria-label="A R"');expect(text).toContain('aria-label="D B"');expect(text).not.toContain('分形源颜色序号');expect(text).not.toContain('原版色板伽马');expect(change).not.toHaveBeenCalled();expect(scene).toEqual(before);
  byLabel(tree,'增加 D B').onClick();const next=change.mock.calls[0][0] as SceneDocument;expect(next.fractalSourceColor!.palette.cosine.d[2]).toBe(Math.fround(Math.fround(.667)+.01));expect(next.fractalSourceColor!.palette.colors).not.toEqual(before.fractalSourceColor!.palette.colors);expect(next.fractalSourceColor!.palette.colors).toHaveLength(6);expect(next.palette).toEqual(before.palette);
 });
 it('hydrates both imported flags without committing and keeps a Curve count edit distinct from mode selection',()=>{
  const scene=source(),change=vi.fn();scene.fractalSourceColor!.palette.useCurve=true;scene.fractalSourceColor!.palette.curves={red:[],green:[],blue:[]};
  const tree=<FractalSourcePaletteEditor scene={scene} onChange={change}/>;
  expect(renderToStaticMarkup(tree)).toContain('作品仍使用连续余弦');expect(byLabel(tree,'源色板生成模式').value).toBe('curve');expect(change).not.toHaveBeenCalled();
  byLabel(tree,'源色板生成模式').onChange({target:{value:'curve'}});expect(change).not.toHaveBeenCalled();
  byLabel(tree,'增加 生成颜色数量').onClick();expect(change).toHaveBeenCalledTimes(1);expect(change.mock.calls[0][0].fractalSourceColor.palette).toMatchObject({useCosine:true,useCurve:true});expect(change.mock.calls[0][0].fractalSourceColor.palette.colors).toHaveLength(7);
  byLabel(tree,'源色板生成模式').onChange({target:{value:'cosine'}});expect(change).toHaveBeenCalledTimes(2);expect(change.mock.calls[1][0].fractalSourceColor.palette).toMatchObject({useCosine:true,useCurve:false});
 });
 it('returning an initially loaded generator to Manual keeps its current colors, while bake keeps new generated colors',()=>{
  const scene=source(),change=vi.fn(),tree=<FractalSourcePaletteEditor scene={scene} onChange={change}/>;
  byLabel(tree,'源色板生成模式').onChange({target:{value:'manual'}});expect(change.mock.calls[0][0].fractalSourceColor.palette.colors).toEqual(scene.fractalSourceColor!.palette.colors);expect(change.mock.calls[0][0].fractalSourceColor.palette).toMatchObject({useCosine:false,useCurve:false});
  button(tree,'应用为手动色板').onClick();expect(change.mock.calls[1][0].fractalSourceColor.palette).toMatchObject({useCosine:false,useCurve:false});expect(change.mock.calls[1][0].fractalSourceColor.palette.colors).not.toEqual(scene.fractalSourceColor!.palette.colors);
 });
 it('edits raw manual colors and interpolation while keeping the local palette and opposite fields intact',()=>{
  const scene=source(),change=vi.fn();scene.fractalSourceColor!.palette.useCosine=false;scene.fractalSourceColor!.palette.colors=['#80123456','#abcdef'];const tree=<FractalSourcePaletteEditor scene={scene} onChange={change}/>;
  byLabel(tree,'分形源颜色原文 RGB').onChange({target:{value:'#445566'}});expect(change.mock.calls[0][0].fractalSourceColor.palette.colors).toEqual(['#80445566','#abcdef']);expect(change.mock.calls[0][0].palette).toEqual(scene.palette);
  byLabel(tree,'色板插值空间').onChange({target:{value:'hsv'}});expect(change.mock.calls[1][0].fractalSourceColor.palette.space).toBe('hsv');expect(change.mock.calls[1][0].fractalSourceColor.inside).toEqual(scene.fractalSourceColor!.inside);
 });
 it('supports the explicit empty source palette and restores source defaults only on request',()=>{
  const scene=source(),change=vi.fn();scene.fractalSourceColor!.palette.useCosine=false;scene.fractalSourceColor!.palette.colors=[];const tree=<FractalSourcePaletteEditor scene={scene} onChange={change}/>;
  expect(renderToStaticMarkup(tree)).toContain('空原版色板使用黑色纹理');expect(change).not.toHaveBeenCalled();button(tree,'恢复原版色板默认').onClick();expect(change.mock.calls[0][0].fractalSourceColor.palette).toEqual(createDefaultFractalSourceColorConfiguration().palette);expect(change.mock.calls[0][0].palette).toEqual(scene.palette);
 });
});
