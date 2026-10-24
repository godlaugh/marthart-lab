import {beforeEach,describe,expect,it,vi} from 'vitest';
import {isValidElement,type ReactElement,type ReactNode} from 'react';
import {SourceGradientPaletteEditor,type SourceGradientPaletteController} from '../src/components/SourceGradientPaletteEditor';
import {defaultSourceCosinePalette,type SourceGradientPaletteCommit} from '../src/engine/sourceGradientPaletteGeneration';

// Retain hook slots across explicit controlled rerenders. This checks authoring
// ownership and event boundaries; the separate App verifier owns mounted UI.
const hooks=vi.hoisted(()=>({slots:[] as unknown[],index:0}));
vi.mock('react',async load=>({...await load<typeof import('react')>(),
 useState:(initial:unknown)=>{const index=hooks.index++;if(!(index in hooks.slots))hooks.slots[index]=typeof initial==='function'?initial():initial;return[hooks.slots[index],(value:unknown)=>{hooks.slots[index]=typeof value==='function'?value(hooks.slots[index]):value;}];},
 useRef:(initial:unknown)=>{const index=hooks.index++;if(!(index in hooks.slots))hooks.slots[index]={current:initial};return hooks.slots[index];},
}));
vi.mock('../src/i18n',()=>({useI18n:()=>({t:(s:string)=>s})}));
type Node=ReactElement<Record<string,any>>;
function nodes(value:ReactNode):Node[]{return Array.isArray(value)?value.flatMap(nodes):isValidElement(value)?[value as Node,...nodes((value as Node).props.children)]:[];}
const select=(tree:ReactNode)=>nodes(tree).find(n=>n.props['aria-label']==='源色板生成模式')!.props;
const count=(tree:ReactNode)=>nodes(tree).find(n=>n.props.id==='generator-count')!.props;
const ramps=(state:Extract<SourceGradientPaletteCommit,{mode:'curve'}>['state'])=>Object.fromEntries(['red','green','blue'].map(key=>[key,state[key as 'red'].map(({x,y})=>[x,y])]));
const expectedRamps={red:[[0,0],[1,1]],green:[[0,0],[1,1]],blue:[[0,0],[1,1]]};
beforeEach(()=>{hooks.index=0;hooks.slots=[];});
function render(controller:SourceGradientPaletteController){
 hooks.index=0;return SourceGradientPaletteEditor({source:['#112233','#445566'],colors:['#112233','#445566'],controller,onGenerate:()=>{throw Error('controlled commit escaped');},onRestore:()=>undefined,children:null});
}
function controller(onCommit:(c:SourceGradientPaletteCommit)=>string|undefined):SourceGradientPaletteController{return{mode:'manual',cosine:defaultSourceCosinePalette(),curve:{},onCommit,description:''};}

describe('controlled source generator state ownership',()=>{
 it('uses original constructor ramps for omitted channels, but randomizes explicitly empty curves on mode entry',()=>{
  const commits:SourceGradientPaletteCommit[]=[],c=controller(x=>{commits.push(x);return undefined;}),random=vi.spyOn(Math,'random').mockReturnValue(.5);
  try{
   const initial=render(c);expect(commits).toEqual([]);select(initial).onChange({target:{value:'curve'}});
   expect(random).not.toHaveBeenCalled();expect(commits[0].mode).toBe('curve');expect(ramps((commits[0] as Extract<SourceGradientPaletteCommit,{mode:'curve'}>).state)).toEqual(expectedRamps);
   const explicit=render({...c,curve:{red:[],green:[],blue:[]}});expect(commits).toHaveLength(1);select(explicit).onChange({target:{value:'curve'}});
   expect(random).toHaveBeenCalled();expect(ramps((commits[1] as Extract<SourceGradientPaletteCommit,{mode:'curve'}>).state)).not.toEqual(expectedRamps);
  }finally{random.mockRestore();}
 });
 it('does not revive an earlier Curve commit after canonical reset/Undo removes curves',()=>{
  const commits:SourceGradientPaletteCommit[]=[],c=controller(x=>{commits.push(x);return undefined;}),custom={red:[{id:'a',x:0,y:1},{id:'b',x:1,y:0}],green:[],blue:[]};
  const changed=render({...c,mode:'curve',curve:custom});count(changed).onCommit(9);
  expect(commits).toHaveLength(1);expect((commits[0] as Extract<SourceGradientPaletteCommit,{mode:'curve'}>).state.red[0].y).toBe(1);
  const reset=render(c);expect(commits).toHaveLength(1);select(reset).onChange({target:{value:'curve'}});
  expect(ramps((commits[1] as Extract<SourceGradientPaletteCommit,{mode:'curve'}>).state)).toEqual(expectedRamps);
 });
});
