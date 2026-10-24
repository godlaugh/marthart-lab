import {beforeEach,describe,expect,it,vi} from 'vitest';
import {isValidElement,type ReactElement,type ReactNode} from 'react';
import {SourceSamilaPaletteEditor} from '../src/components/SourceSamilaPaletteEditor';
import {parseProjectFile} from '../src/engine/legacyImport';
import {openSourceSamilaPaletteEditor,sourceSamilaPaletteRuntimeScene} from '../src/engine/sourceSamilaPaletteEditing';
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
const scene=(palette=colors)=>parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SAMILA',name:'Samila editor',palette,color:{use_cosine_palette:true,use_curve_palette:true,cosine_a:[.2,.3,.4]},equations:{f1:'sin(x*y)',f2:'cos(x-y)'},settings:{batch_size:8}})).scene;
function render(s:SceneDocument,onChange:(s:SceneDocument,dirty?:boolean)=>void){hooks.at=0;return nodes(<SourceSamilaPaletteEditor scene={s} onChange={onChange}/>);}
function field(tree:Node[],label:string){const node=tree.find(n=>n.props['aria-label']===label);expect(node).toBeDefined();return node!.props;}
function button(tree:Node[],label:string){const node=tree.find(n=>n.type==='button'&&n.props.children===label);expect(node).toBeDefined();return node!.props;}
beforeEach(()=>{hooks.at=0;hooks.values=[];});
describe('Samila source palette controlled UI',()=>{
 it('renders Manual and virtual first-composition padding without issuing a callback or mutating caller input',()=>{
  const s=scene([]),before=structuredClone(s),changed=vi.fn(),view=render(s,changed);
  expect(view.some(n=>n.props['data-testid']==='source-samila-palette')).toBe(true);expect(field(view,'源色板生成模式').value).toBe('manual');expect(field(view,'源颜色原文').value).toBe('#3B82F6');
  expect(s).toEqual(before);expect(changed).not.toHaveBeenCalled();
  field(view,'源色板生成模式').onChange({target:{value:'cosine'}});expect(changed).toHaveBeenCalledTimes(1);expect(changed.mock.calls[0][1]).toBe(true);
  const generated=changed.mock.calls[0][0] as SceneDocument;expect(generated.samilaPaletteEditor).toMatchObject({manualColors:['#3B82F6','#22D3EE'],colorCount:8,appearanceOpened:true});expect(generated.samilaSourcePalette!.colors).toHaveLength(8);
 });
 it('restores raw Manual after Cosine/Curve and leaves edited generator parameters in the opened owner',()=>{
  const s=openSourceSamilaPaletteEditor(scene()),changed=vi.fn();field(render(s,changed),'源色板生成模式').onChange({target:{value:'cosine'}});const generated=changed.mock.calls[0][0] as SceneDocument;
  field(render(generated,changed),'增加 A R').onClick();const edited=changed.mock.calls[1][0] as SceneDocument;
  field(render(edited,changed),'源色板生成模式').onChange({target:{value:'curve'}});const curved=changed.mock.calls[2][0] as SceneDocument;
  field(render(curved,changed),'源色板生成模式').onChange({target:{value:'manual'}});const restored=changed.mock.calls[3][0] as SceneDocument;
  expect(changed).toHaveBeenCalledTimes(4);expect(changed.mock.calls.every(call=>call[1]===true)).toBe(true);expect(restored.samilaSourcePalette!.colors).toEqual(colors);expect(restored.samilaPaletteEditor!.cosine).toEqual(edited.samilaPaletteEditor!.cosine);expect(restored.samilaPaletteEditor!.curves).toEqual(curved.samilaPaletteEditor!.curves);
 });
 it('retains raw alpha and every tail entry while exposing and committing the final entry and same-value action',()=>{
  const s=openSourceSamilaPaletteEditor(scene()),changed=vi.fn();let view=render(s,changed);expect(field(view,'源颜色序号').max).toBe(32);
  field(view,'源颜色序号').onChange({target:{value:'32'}});view=render(s,changed);expect(field(view,'源颜色原文').value).toBe(colors[31]);
  field(view,'源颜色原文').onChange({target:{value:colors[31]}});expect(changed).toHaveBeenCalledTimes(1);expect(changed.mock.calls[0][0].samilaSourcePalette.colors).toEqual(colors);
  field(view,'源颜色原文').onChange({target:{value:'preserved invalid raw tail'}});expect(changed.mock.calls[1][0].samilaSourcePalette.colors).toEqual([...colors.slice(0,31),'preserved invalid raw tail']);
  field(view,'源颜色').onChange({target:{value:'#112233'}});expect(changed.mock.calls[2][0].samilaSourcePalette.colors).toEqual([...colors.slice(0,31),'#112233']);expect(s.samilaSourcePalette!.colors[0]).toBe('#80AbCdEf');
 });
 it('keeps explicit empty lists empty after the initialized editor is remounted and clears only the target picker alpha',()=>{
  const s=openSourceSamilaPaletteEditor(scene(['#80AbCdEf'])),changed=vi.fn();field(render(s,changed),'源颜色').onChange({target:{value:'#abcdef'}});
  expect(changed.mock.calls[0][0].samilaSourcePalette.colors).toEqual(['#ABCDEF','#F97316']);
  const empty={...s,samilaSourcePalette:{colors:[]}};hooks.values=[];const view=render(empty,changed);expect(view.some(n=>n.props['aria-label']==='源颜色原文')).toBe(false);expect(changed).toHaveBeenCalledTimes(1);
  button(view,'添加颜色').onClick();expect(changed.mock.calls[1][0].samilaSourcePalette.colors).toEqual(['#FFFFFF']);
 });
 it('does not expose this source-only editor for non-source profiles',()=>{
  const s=scene();delete s.settings.samilaSplatModel;expect(render(s,vi.fn())).toEqual([]);
 });
 it('treats repeated mode selection as no event and offset commits as non-dirty',()=>{
  const s=openSourceSamilaPaletteEditor(scene()),changed=vi.fn(),view=render(s,changed);field(view,'源色板生成模式').onChange({target:{value:'manual'}});expect(changed).not.toHaveBeenCalled();
  const control=view.find(n=>n.type==='input'&&n.props.id==='control-samila-palette-offset');expect(control).toBeDefined();control!.props.onChange({target:{value:'.25'}});expect(changed).toHaveBeenCalledOnce();expect(changed.mock.calls[0][1]).toBe(false);expect(changed.mock.calls[0][0].palette.offset).toBe(.25);expect(sourceSamilaPaletteRuntimeScene(changed.mock.calls[0][0]).palette.offset).toBe(.25);
 });
});
