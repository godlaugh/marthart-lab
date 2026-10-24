import {beforeEach,describe,expect,it,vi} from 'vitest';
import {isValidElement,type ReactElement,type ReactNode} from 'react';
import {SourceImplicitPaletteEditor} from '../src/components/SourceImplicitPaletteEditor';
import {parseProjectFile} from '../src/engine/legacyImport';
import {openImplicitPaletteEditor} from '../src/engine/implicitPaletteEditing';
import type {SceneDocument} from '../src/types';

// Controlled callback tests; mounted App/history/Worker verification is separate.
// Retain only the wrapper's two state slots to select a raw tail entry. Child
// controls remount between renders; their flags/parameters live in the owner.
const hooks=vi.hoisted(()=>({at:0,values:[] as unknown[]}));
vi.mock('react',async load=>({...await load<typeof import('react')>(),useState:(initial:unknown)=>{const i=hooks.at++,value=()=>typeof initial==='function'?initial():initial;if(i>=2)return[value(),vi.fn()];if(!(i in hooks.values))hooks.values[i]=value();return[hooks.values[i],(next:unknown)=>{hooks.values[i]=typeof next==='function'?next(hooks.values[i]):next;}];},useRef:(current:unknown)=>({current}),useEffect:vi.fn()}));
vi.mock('../src/i18n',()=>({useI18n:()=>({t:(s:string,args?:Record<string,string|number>)=>s.replace(/\{(\w+)\}/g,(_,k)=>String(args?.[k]??`{${k}}`))})}));
type Node=ReactElement<Record<string,any>>;
function nodes(value:ReactNode):Node[]{if(Array.isArray(value))return value.flatMap(nodes);if(!isValidElement(value))return[];const node=value as Node;return typeof node.type==='function'?nodes((node.type as (p:unknown)=>ReactNode)(node.props)):[node,...nodes(node.props.children)];}
const colors=['#80AbCdEf','invalid',...Array.from({length:30},(_,i)=>'#'+i.toString(16).padStart(6,'0'))];
const scene=(palette=colors)=>parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'IMPLICIT',name:'Implicit editor',palette,color:{use_cosine_palette:true,use_curve_palette:true,cosine_a:[.2,.3,.4]},equation:{f:'x^2+y^2+z^2-1'},settings:{render_mode:'SOLID',mesh_mode:'CPU',x_segments:4,y_segments:4,z_segments:4}})).scene;
function render(s:SceneDocument,onChange:(s:SceneDocument,intent:'implicit-palette')=>void){hooks.at=0;return nodes(<SourceImplicitPaletteEditor scene={s} onChange={onChange}/>);}
function field(tree:Node[],label:string){const node=tree.find(n=>n.props['aria-label']===label);expect(node).toBeDefined();return node!.props;}
function button(tree:Node[],label:string){const node=tree.find(n=>n.type==='button'&&n.props.children===label);expect(node).toBeDefined();return node!.props;}
beforeEach(()=>{hooks.at=0;hooks.values=[];});
describe('Implicit source palette controlled UI',()=>{
 it('renders Manual and virtual first-composition padding without issuing a callback or mutating caller input',()=>{
  const s=scene([]),before=structuredClone(s),changed=vi.fn(),view=render(s,changed);
  expect(view.some(n=>n.props['data-testid']==='source-implicit-palette')).toBe(true);expect(field(view,'源色板生成模式').value).toBe('manual');expect(field(view,'源颜色原文').value).toBe('#3B82F6');
  expect(s).toEqual(before);expect(changed).not.toHaveBeenCalled();
  field(view,'源色板生成模式').onChange({target:{value:'cosine'}});expect(changed).toHaveBeenCalledTimes(1);expect(changed.mock.calls[0][1]).toBe('implicit-palette');
  const generated=changed.mock.calls[0][0] as SceneDocument;expect(generated.implicitPaletteEditor).toMatchObject({manualColors:['#3B82F6','#22D3EE'],colorCount:8,appearanceOpened:true});expect(generated.implicitSourcePalette!.colors).toHaveLength(8);
 });
 it('restores raw Manual after Cosine/Curve and leaves edited generator parameters in the opened owner',()=>{
  const s=openImplicitPaletteEditor(scene()),changed=vi.fn();field(render(s,changed),'源色板生成模式').onChange({target:{value:'cosine'}});const generated=changed.mock.calls[0][0] as SceneDocument;
  field(render(generated,changed),'增加 A R').onClick();const edited=changed.mock.calls[1][0] as SceneDocument;
  field(render(edited,changed),'源色板生成模式').onChange({target:{value:'curve'}});const curved=changed.mock.calls[2][0] as SceneDocument;
  field(render(curved,changed),'源色板生成模式').onChange({target:{value:'manual'}});const restored=changed.mock.calls[3][0] as SceneDocument;
  expect(changed).toHaveBeenCalledTimes(4);expect(changed.mock.calls.every(call=>call[1]==='implicit-palette')).toBe(true);expect(restored.implicitSourcePalette!.colors).toEqual(colors);expect(restored.implicitPaletteEditor!.cosine).toEqual(edited.implicitPaletteEditor!.cosine);expect(restored.implicitPaletteEditor!.curves).toEqual(curved.implicitPaletteEditor!.curves);
 });
 it('retains raw alpha and every tail entry while exposing and committing the final entry and same-value action',()=>{
  const s=openImplicitPaletteEditor(scene()),changed=vi.fn();let view=render(s,changed);expect(field(view,'源颜色序号').max).toBe(32);
  field(view,'源颜色序号').onChange({target:{value:'32'}});view=render(s,changed);expect(field(view,'源颜色原文').value).toBe(colors[31]);
  field(view,'源颜色原文').onChange({target:{value:colors[31]}});expect(changed).toHaveBeenCalledTimes(1);expect(changed.mock.calls[0][0].implicitSourcePalette.colors).toEqual(colors);
  field(view,'源颜色原文').onChange({target:{value:'preserved invalid raw tail'}});expect(changed.mock.calls[1][0].implicitSourcePalette.colors).toEqual([...colors.slice(0,31),'preserved invalid raw tail']);
  field(view,'源颜色').onChange({target:{value:'#112233'}});expect(changed.mock.calls[2][0].implicitSourcePalette.colors).toEqual([...colors.slice(0,31),'#112233']);expect(s.implicitSourcePalette!.colors[0]).toBe('#80AbCdEf');
 });
 it('keeps explicit empty lists empty after the initialized editor is remounted and clears only the target picker alpha',()=>{
  const s=openImplicitPaletteEditor(scene(['#80AbCdEf'])),changed=vi.fn();field(render(s,changed),'源颜色').onChange({target:{value:'#abcdef'}});
  expect(changed.mock.calls[0][0].implicitSourcePalette.colors).toEqual(['#ABCDEF','#F97316']);
  const empty={...s,implicitSourcePalette:{colors:[]}};hooks.values=[];const view=render(empty,changed);expect(view.some(n=>n.props['aria-label']==='源颜色原文')).toBe(false);expect(changed).toHaveBeenCalledTimes(1);
  button(view,'添加颜色').onClick();expect(changed.mock.calls[1][0].implicitSourcePalette.colors).toEqual(['#FFFFFF']);
 });
 it('does not expose this source-only editor for legacy or GPU profiles',()=>{
  const s=scene();s.settings.computeBackend='webgl2';expect(render(s,vi.fn())).toEqual([]);
 });
});
