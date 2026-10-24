import {describe,expect,it,vi} from 'vitest';
import {isValidElement,type ReactElement,type ReactNode} from 'react';
import {DomainSourcePaletteEditor} from '../src/components/DomainColorControls';
import {parseProjectFile} from '../src/engine/legacyImport';
import type {SceneDocument} from '../src/types';

// Controlled component boundary only; the separate headless App verifier owns
// mounted tab/save/Undo behavior and real Worker full-Apply observations.
vi.mock('react',async load=>({...await load<typeof import('react')>(),useState:(initial:unknown)=>[typeof initial==='function'?initial():initial,vi.fn()],useRef:(current:unknown)=>({current}),useEffect:vi.fn()}));
vi.mock('../src/i18n',()=>({useI18n:()=>({t:(s:string,args?:Record<string,string|number>)=>s.replace(/\{(\w+)\}/g,(_,k)=>String(args?.[k]??`{${k}}`))})}));
type Node=ReactElement<Record<string,any>>;
function nodes(value:ReactNode):Node[]{if(Array.isArray(value))return value.flatMap(nodes);if(!isValidElement(value))return[];const node=value as Node;return typeof node.type==='function'?nodes((node.type as (p:unknown)=>ReactNode)(node.props)):[node,...nodes(node.props.children)];}
function field(tree:ReactNode,label:string){const node=nodes(tree).find(n=>n.props['aria-label']===label);expect(node).toBeDefined();return node!.props;}
const colors=['#80AbCdEf','-1',...Array.from({length:30},(_,i)=>'#'+i.toString(16).padStart(6,'0'))];
const scene=(color:unknown={})=>parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Shared editor',palette:colors,color,domainColoring:{formula:'z'}})).scene;
const tree=(s:SceneDocument,onChange:(s:SceneDocument)=>void,usage?:'cpu-fallback')=><DomainSourcePaletteEditor scene={s} onChange={onChange} usage={usage}/>;
describe('Domain shared main / fallback generator surfaces',()=>{
 it('hydrates both surfaces without apply, prefers Curve for dual flags, and gives each a stable scope',()=>{
  const s=scene({use_cosine_palette:true,use_curve_palette:true,curve_red:[]}),before=structuredClone(s),changed=vi.fn();
  for(const usage of [undefined,'cpu-fallback'] as const){const view=tree(s,changed,usage);expect(field(view,'源色板生成模式').value).toBe('curve');expect(field(view,'生成颜色数量').value).toBe('25');expect(nodes(view).some(n=>n.props['data-testid']===(usage?'domain-source-palette-cpu-fallback':'domain-source-palette-main'))).toBe(true);}
  expect(changed).not.toHaveBeenCalled();expect(s).toEqual(before);
 });
 it('restores the shared raw Manual snapshot from a different newly mounted surface without reverting generator parameters',()=>{
  const initial=scene(),changed=vi.fn();field(tree(initial,changed),'源色板生成模式').onChange({target:{value:'cosine'}});expect(changed).toHaveBeenCalledTimes(1);
  const generated=changed.mock.calls[0][0] as SceneDocument;expect(generated.domainSourcePalette!.colors).toHaveLength(25);
  field(tree(generated,changed,'cpu-fallback'),'增加 A R').onClick();expect(changed).toHaveBeenCalledTimes(2);
  const edited=changed.mock.calls[1][0] as SceneDocument;
  field(tree(edited,changed),'源色板生成模式').onChange({target:{value:'manual'}});expect(changed).toHaveBeenCalledTimes(3);
  const restored=changed.mock.calls[2][0] as SceneDocument;expect(restored.domainSourcePalette!.colors).toEqual(colors);expect(restored.domainPaletteEditor!.cosine).toEqual(edited.domainPaletteEditor!.cosine);expect(restored.domainPaletteEditor).toMatchObject({useCosine:false,useCurve:false});
 });
 it('commits each Manual RGB edit once, preserves alpha/raw tail, and exposes shared count after a different surface edits',()=>{
  const initial=scene(),changed=vi.fn();field(tree(initial,changed),'源颜色').onChange({target:{value:'#112233'}});
  expect(changed).toHaveBeenCalledTimes(1);const manual=changed.mock.calls[0][0] as SceneDocument;expect(manual.domainSourcePalette!.colors).toEqual(['#80112233',...colors.slice(1)]);
  field(tree(manual,changed),'源色板生成模式').onChange({target:{value:'cosine'}});const generated=changed.mock.calls[1][0] as SceneDocument;
  field(tree(generated,changed,'cpu-fallback'),'减少 生成颜色数量').onClick();expect(changed).toHaveBeenCalledTimes(3);const reduced=changed.mock.calls[2][0] as SceneDocument;
  expect(field(tree(reduced,changed),'生成颜色数量').value).toBe('24');expect(reduced.domainSourcePalette!.colors).toHaveLength(24);
 });
});
