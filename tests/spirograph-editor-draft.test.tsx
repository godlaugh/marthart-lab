import {beforeEach,describe,expect,it,vi} from 'vitest';
import {isValidElement,type ReactElement,type ReactNode} from 'react';
import {SpirographEditor} from '../src/components/SpirographEditor';
import {createDefaultSpirographLayer,parseSpirographLayers} from '../src/scenes/spirograph';
import {createScene,parseScene,persistentScene} from '../src/engine/document';
import {parseProjectFile} from '../src/engine/legacyImport';
import {definition} from '../src/scenes';
import type {SceneDocument} from '../src/types';

// Stateful component-callback harness, not a browser/DOM claim. It retains hook
// cells by component/key so drafts, prop updates and conditional repair controls
// are exercised together with the real layer parser and document callbacks.
const hooks=vi.hoisted(()=>({cells:[] as any[],index:0,id:'',effects:[] as (()=>void)[],dirty:false}));
vi.mock('react',async load=>({...await load<typeof import('react')>(),
 useState:(initial:unknown)=>{const cells=hooks.cells,i=hooks.index++;if(!(i in cells))cells[i]=typeof initial==='function'?initial():initial;return[cells[i],(value:unknown)=>{const next=typeof value==='function'?value(cells[i]):value;if(!Object.is(next,cells[i])){cells[i]=next;hooks.dirty=true;}}];},
 useEffect:(effect:()=>void,deps:unknown[])=>{const i=hooks.index++,previous=hooks.cells[i] as unknown[]|undefined;if(!previous||deps.some((x,j)=>!Object.is(x,previous[j]))){hooks.cells[i]=deps;hooks.effects.push(effect);}},
 useId:()=>`${hooks.id}:${hooks.index++}`,
}));
vi.mock('../src/i18n',async load=>({...await load<typeof import('../src/i18n')>(),useI18n:()=>({t:(s:string,args?:Record<string,string|number>)=>s.replace(/\{(\w+)\}/g,(_,k)=>String(args?.[k]??`{${k}}`))})}));
type Node=ReactElement<Record<string,any>>;
function editor(initial:SceneDocument){
 let scene=initial;const commits:SceneDocument[]=[],cells=new Map<string,any[]>();
 function visit(node:ReactNode,path:string):Node[]{
  if(Array.isArray(node))return node.flatMap((n,i)=>visit(n,`${path}/${isValidElement(n)&&n.key!==null?n.key:i}`));
  if(!isValidElement(node))return[];const e=node as Node;
  if(typeof e.type==='function'){
   if(!['SpirographEditor','SpirographNumberDraft','SpirographLayerJsonRepair'].includes(e.type.name))return[];
   const id=`${path}/${e.type.name}:${e.key??''}`;let state=cells.get(id);if(!state){state=[];cells.set(id,state);}
   hooks.cells=state;hooks.index=0;hooks.id=id;
   return visit((e.type as (p:unknown)=>ReactNode)(e.props),id);
  }
  return[e,...visit(e.props.children,`${path}/children`)];
 }
 function tree(){let nodes:Node[]=[];for(let i=0;i<5;i++){hooks.dirty=false;hooks.effects=[];nodes=visit(<SpirographEditor scene={scene} time={0} onChange={next=>{scene=next;commits.push(next);}}/>,'root');const effects=hooks.effects;hooks.effects=[];for(const run of effects)run();if(!hooks.dirty)return nodes;}throw new Error('Draft did not settle');}
 const find=(test:(node:Node)=>boolean)=>{const result=tree().find(test);expect(result).toBeDefined();return result!.props;};
 return{get scene(){return scene;},commits,tree,field:(label:string)=>find(n=>n.props['aria-label']===label),button:(text:string)=>find(n=>n.type==='button'&&n.props.children===text),title:(text:string)=>find(n=>n.type==='button'&&n.props.title===text),replace:(next:SceneDocument)=>{scene=next;},alerts:()=>tree().filter(n=>n.props.role==='alert').map(n=>n.props.children)};
}
function multilayer(){const scene=createScene(definition('spirograph'));scene.settings.layers=JSON.stringify([createDefaultSpirographLayer()]);return scene;}
const enter=(field:Record<string,any>)=>field.onKeyDown({key:'Enter',preventDefault:vi.fn()});
const layers=(scene:SceneDocument)=>parseSpirographLayers(String(scene.settings.layers));
beforeEach(()=>{hooks.cells=[];hooks.index=0;hooks.effects=[];hooks.dirty=false;});

describe('Spirograph layer numeric authoring drafts',()=>{
 it.each(['定子半径','转子 1 半径'])('keeps 0 → 0. → 0.5 editable for %s and commits only on Enter',label=>{
  const original=multilayer(),ui=editor(original),raw=original.settings.layers;
  for(const text of ['','0','0.','0.5']){ui.field(label).onChange({target:{value:text}});expect(ui.field(label).value).toBe(text);expect(ui.scene.settings.layers).toBe(raw);expect(ui.commits).toHaveLength(0);expect(ui.field('旋轮图层名称')).toBeDefined();}
  enter(ui.field(label));expect(ui.commits).toHaveLength(1);const layer=layers(ui.scene)[0];expect(label==='定子半径'?layer.statorRadius:layer.rotors[0].radius).toBe(.5);expect(ui.alerts()).toEqual([]);
  expect(parseScene(JSON.stringify(persistentScene(ui.scene)))).toEqual(ui.scene);
 });
 it.each(['定子半径','转子 1 半径'])('rejects a zero commit without changing or hiding %s, then accepts a correction',label=>{
  const original=multilayer(),ui=editor(original);ui.field(label).onChange({target:{value:'0'}});ui.field(label).onBlur();
  expect(ui.commits).toHaveLength(0);expect(ui.scene).toBe(original);expect(ui.field(label).value).toBe('0');expect(ui.field(label)['aria-invalid']).toBe(true);expect(ui.alerts().join(' ')).toContain('0.001 至 10000');
  ui.field(label).onChange({target:{value:'0.5'}});ui.field(label).onBlur();expect(ui.commits).toHaveLength(1);expect(ui.field(label).value).toBe('0.5');expect(ui.field(label)['aria-invalid']).toBe(false);expect(ui.alerts()).toEqual([]);
 });
 it.each(['','-','1e','Infinity','NaN'])('retains incomplete/nonfinite text %j after a rejected commit',text=>{
  const ui=editor(multilayer());ui.field('定子半径').onChange({target:{value:text}});enter(ui.field('定子半径'));expect(ui.field('定子半径').value).toBe(text);expect(ui.commits).toHaveLength(0);expect(ui.alerts().join(' ')).toContain('请输入有限数值');
 });
 it('uses the layer parser bounds for all numeric fields without UI clamping or narrower phase bounds',()=>{
  const ui=editor(multilayer());for(const [label,text] of [['图层不透明度','2'],['图层线宽','0'],['绘制速度','-1'],['非闭合绘制周数','0'],['笔距','10001']]){ui.field(label).onChange({target:{value:text}});enter(ui.field(label));expect(ui.field(label).value).toBe(text);expect(ui.field(label)['aria-invalid']).toBe(true);expect(ui.commits).toHaveLength(0);}
  ui.field('初始相位 · 弧度').onChange({target:{value:'2000'}});enter(ui.field('初始相位 · 弧度'));expect(layers(ui.scene)[0].phase).toBe(2000);
 });
 it('lets Escape explicitly discard a draft and avoids duplicate commits on Enter then blur',()=>{
  const ui=editor(multilayer());ui.field('定子半径').onChange({target:{value:'0'}});enter(ui.field('定子半径'));
  ui.field('定子半径').onKeyDown({key:'Escape',preventDefault:vi.fn()});expect(ui.field('定子半径').value).toBe('150');expect(ui.field('定子半径')['aria-invalid']).toBe(false);
  ui.field('定子半径').onChange({target:{value:'1e-1'}});enter(ui.field('定子半径'));ui.field('定子半径').onBlur();expect(ui.commits).toHaveLength(1);expect(layers(ui.scene)[0].statorRadius).toBe(.1);
 });
 it('reflects an external undo/value change and isolates drafts when another document is loaded',()=>{
  const original=multilayer(),ui=editor(original);ui.field('定子半径').onChange({target:{value:'0.5'}});enter(ui.field('定子半径'));expect(ui.field('定子半径').value).toBe('0.5');ui.replace(original);expect(ui.field('定子半径').value).toBe('150');
  ui.field('定子半径').onChange({target:{value:'-' }});ui.replace({...original,id:'another-document'});expect(ui.field('定子半径').value).toBe('150');
 });
});

describe('invalid saved/imported layer repair',()=>{
 it.each(['[broken',JSON.stringify([{id:'broken',statorRadius:0,rotors:[{radius:0,mode:'inside'}]}])])('keeps exact invalid layer text available, validates repair, and resumes normal editing',raw=>{
  const document=multilayer();document.settings.layers=raw;const imported=parseProjectFile(JSON.stringify(document)).scene,ui=editor(imported);
  expect(ui.field('多图层 JSON').value).toBe(raw);expect(ui.title('添加旋轮图层').disabled).toBe(true);expect(ui.commits).toHaveLength(0);
  ui.button('应用图层 JSON').onClick();expect(ui.commits).toHaveLength(0);expect(ui.field('多图层 JSON').value).toBe(raw);expect(ui.field('多图层 JSON')['aria-invalid']).toBe(true);
  const repaired=JSON.stringify([{...createDefaultSpirographLayer('repaired'),statorRadius:.5,rotors:[{radius:.25,mode:'inside'}]}],null,2);
  ui.field('多图层 JSON').onChange({target:{value:repaired}});expect(ui.scene.settings.layers).toBe(raw);ui.button('应用图层 JSON').onClick();expect(ui.commits).toHaveLength(1);expect(ui.scene.settings.layers).toBe(repaired);expect(ui.field('定子半径').value).toBe('0.5');expect(ui.field('转子 1 半径').value).toBe('0.25');expect(ui.tree().some(n=>n.props['aria-label']==='多图层 JSON')).toBe(false);
  expect(parseProjectFile(JSON.stringify(persistentScene(ui.scene))).scene).toEqual(ui.scene);
 });
});
