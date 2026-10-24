import {describe,expect,it,vi} from 'vitest';
import {isValidElement,type ReactElement,type ReactNode} from 'react';
import {RootsPresentationControls} from '../src/components/RootsPresentationControls';
import {RootsDensityColorControls,RootsSourcePaletteEditor} from '../src/components/RootsDensityColorControls';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {withRootsPresentation} from '../src/engine/rootsPresentationAuthoring';
import {defaultRootsPendingConfiguration,defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import {usesRootsCameraTimeline,usesRootsGradientTimeline,withRootsSceneTimeline} from '../src/engine/rootsCameraTimeline';
import {DEFAULT_ROOTS_SOURCE_COLORS,ROOTS_SOURCE_TONE_FIELDS} from '../src/engine/rootsDensityColor';
import type {RootsEditorIntent} from '../src/engine/rootsEditIntent';
import type {SceneDocument} from '../src/types';

// Exercise the production component callbacks, without claiming mounted App,
// Worker or GPU behavior. The App independently owns intent -> command routing.
vi.mock('react',async load=>({...await load<typeof import('react')>(),useState:(initial:unknown)=>[typeof initial==='function'?initial():initial,vi.fn()],useRef:(current:unknown)=>({current}),useEffect:vi.fn()}));
vi.mock('../src/i18n',()=>({useI18n:()=>({t:(s:string,args?:Record<string,string|number>)=>s.replace(/\{(\w+)\}/g,(_,k)=>String(args?.[k]??`{${k}}`))})}));
type Event={target:{value:string;valueAsNumber?:number;checked?:boolean}};
type Props={children?:ReactNode;'aria-label'?:string;value?:unknown;onChange?:(event:Event)=>void;onClick?:()=>void;[key:string]:unknown};
type Node=ReactElement<Props>;
function nodes(value:ReactNode):Node[]{
 if(Array.isArray(value))return value.flatMap(nodes);if(!isValidElement(value))return[];const node=value as Node;
 return typeof node.type==='function'?nodes((node.type as (p:Props)=>ReactNode)(node.props)):[node,...nodes(node.props.children)];
}
function field(tree:ReactNode,label:string){const node=nodes(tree).find(n=>n.props['aria-label']===label);expect(node,`field ${label}`).toBeDefined();return node!.props;}
function button(tree:ReactNode,label:string){const node=nodes(tree).find(n=>n.type==='button'&&n.props.children===label);expect(node,`button ${label}`).toBeDefined();return node!.props;}
const changed=()=>vi.fn<(scene:SceneDocument,intent:RootsEditorIntent)=>void>();
const local=()=>createScene(definition('roots'));
function source(){return withRootsSceneTimeline(withRootsPresentation(local(),{...defaultRootsPresentationConfiguration(),pending:defaultRootsPendingConfiguration(),previewMode:'live-worker-arrival-v1'}),true);}
const presentation=(scene:SceneDocument,onChange:ReturnType<typeof changed>)=><RootsPresentationControls scene={scene} onChange={onChange}/>;
const palette=(scene:SceneDocument,onChange:ReturnType<typeof changed>)=><RootsSourcePaletteEditor scene={scene} onChange={onChange}/>;
function enter(tree:ReactNode,label:string,value:number){field(tree,label).onChange!({target:{value:String(value),valueAsNumber:value}});}

describe('Roots explicit presentation edit intents',()=>{
 it('stages mode directly, emits repeated explicit selections, and has no separate mode Apply button',()=>{
  const scene=source(),before=structuredClone(scene),change=changed(),tree=presentation(scene,change);
  expect(field(tree,'空间显示方式').value).toBe('density');expect(change).not.toHaveBeenCalled();
  expect(nodes(tree).some(n=>n.type==='button'&&n.props.children==='应用显示方式并重新采样')).toBe(false);
  field(tree,'空间显示方式').onChange!({target:{value:'point-cloud'}});
  expect(change).toHaveBeenCalledTimes(1);expect(change.mock.calls[0][1]).toBe('roots-stage');
  const next=change.mock.calls[0][0];expect(next.rootsPresentation!.mode).toBe('point-cloud');expect(next.timeline).toEqual(scene.timeline);
  field(presentation(next,change),'空间显示方式').onChange!({target:{value:'point-cloud'}});
  expect(change).toHaveBeenCalledTimes(2);expect(change.mock.calls[1]).toEqual([next,'roots-stage']);expect(scene).toEqual(before);
 });

 it.each([
  ['相机 phi（弧度）',.25],['相机 theta（弧度）',-.5],['相机 gamma（弧度）',.75],
  ['相机中心 X',3],['相机中心 Y',-2],['相机中心 Z',1],['空间相机缩放',-1],['空间相机焦距',350],
 ] as const)('stages Inspector %s without turning it into mouse-camera or Apply', (label,value)=>{
  const scene=source(),before=structuredClone(scene),change=changed();enter(presentation(scene,change),label,value);
  expect(change).toHaveBeenCalledTimes(1);const [next,intent]=change.mock.calls[0];expect(intent).toBe('roots-stage');
  expect(Number(field(presentation(next,changed()),label).value)).toBe(value);expect(next.rootsPresentation!.transform).toEqual(scene.rootsPresentation!.transform);expect(scene).toEqual(before);
 });

 it.each([
  ['空间缩放 X',2],['空间缩放 Y',.5],['空间缩放 Z',-1],['空间偏移 X',3],['空间偏移 Y',-2],['空间偏移 Z',1],['复平面旋转（度）',25],
 ] as const)('routes %s as a hot transform while preserving the staged camera and mode', (label,value)=>{
  const scene=source();scene.rootsPresentation!.mode='point-cloud';scene.rootsPresentation!.camera.phi=.4321;const before=structuredClone(scene),change=changed();
  enter(presentation(scene,change),label,value);expect(change).toHaveBeenCalledTimes(1);
  const [next,intent]=change.mock.calls[0];expect(intent).toBe('roots-transform');expect(Number(field(presentation(next,changed()),label).value)).toBe(value);
  expect(next.rootsPresentation!.camera).toEqual(scene.rootsPresentation!.camera);expect(next.rootsPresentation!.mode).toBe('point-cloud');expect(scene).toEqual(before);
 });

 it('routes point size as tone, but local pending and accumulation policy changes as Apply',()=>{
  const scene=source(),change=changed();scene.rootsPresentation!.accumulation.enabled=true;const tree=presentation(scene,change);
  enter(tree,'空间点尺寸',.015);expect(change.mock.calls.at(-1)![1]).toBe('roots-tone');expect(change.mock.calls.at(-1)![0].rootsPresentation!.dotSize).toBe(.015);
  enter(tree,'每帧基础绘制点数',1234);expect(change.mock.calls.at(-1)![1]).toBe('roots-apply');expect(change.mock.calls.at(-1)![0].rootsPresentation!.pending!.maxSplatPointsPerFrame).toBe(1234);
  enter(tree,'画面淡出强度',27);expect(change.mock.calls.at(-1)![1]).toBe('roots-apply');expect(change.mock.calls.at(-1)![0].rootsPresentation!.accumulation.fadeAlpha).toBe(27);
  field(tree,'保留点云画面拖影').onChange!({target:{value:'',checked:false}});expect(change.mock.calls.at(-1)![1]).toBe('roots-apply');expect(change.mock.calls.at(-1)![0].rootsPresentation!.accumulation.enabled).toBe(false);
  expect(change).toHaveBeenCalledTimes(4);
 });

 it('keeps native, preview, pending and queue-profile transitions explicit Apply events',()=>{
  const change=changed(),initial=local();button(presentation(initial,change),'启用 MathArt 空间显示').onClick!();expect(change.mock.calls.at(-1)![1]).toBe('roots-apply');expect(change.mock.calls.at(-1)![0].rootsPresentation!.model).toBe('mathart-1.7.8-v1');
  const scene=source(),tree=presentation(scene,change);field(tree,'后台实时采样').onChange!({target:{value:'',checked:false}});expect(change.mock.calls.at(-1)![1]).toBe('roots-apply');expect(change.mock.calls.at(-1)![0].rootsPresentation!.previewMode).toBeUndefined();
  const offline=change.mock.calls.at(-1)![0];field(presentation(offline,change),'后台实时采样').onChange!({target:{value:'',checked:true}});expect(change.mock.calls.at(-1)![1]).toBe('roots-apply');expect(usesRootsGradientTimeline(change.mock.calls.at(-1)![0])).toBe(true);
  delete scene.rootsPresentation!.pending;button(presentation(scene,change),'启用批次队列并重新采样').onClick!();expect(change.mock.calls.at(-1)![1]).toBe('roots-apply');expect(change.mock.calls.at(-1)![0].rootsPresentation!.pending).toEqual(defaultRootsPendingConfiguration());
  button(tree,'返回仅相机队列').onClick!();const cameraOnly=change.mock.calls.at(-1)![0];expect(change.mock.calls.at(-1)![1]).toBe('roots-apply');expect(usesRootsCameraTimeline(cameraOnly)).toBe(true);expect(usesRootsGradientTimeline(cameraOnly)).toBe(false);
  button(presentation(cameraOnly,change),'停用源相机队列').onClick!();const noQueue=change.mock.calls.at(-1)![0];expect(change.mock.calls.at(-1)![1]).toBe('roots-apply');expect(usesRootsCameraTimeline(noQueue)).toBe(false);expect(noQueue.rootsPresentation!.previewMode).toBeUndefined();
  button(presentation(noQueue,change),'启用完整源场景队列').onClick!();expect(change.mock.calls.at(-1)![1]).toBe('roots-apply');expect(usesRootsGradientTimeline(change.mock.calls.at(-1)![0])).toBe(true);
  button(tree,'返回本地平面显示').onClick!();expect(change.mock.calls.at(-1)![1]).toBe('roots-apply');expect(change.mock.calls.at(-1)![0].rootsPresentation!.model).toBe('local-v1');expect(change).toHaveBeenCalledTimes(8);
 });

 it('does not emit malformed presentation drafts, and keeps restart a distinct callback',()=>{
  const scene=source(),change=changed(),restart=vi.fn(),tree=<RootsPresentationControls scene={scene} onChange={change} onRestart={restart}/>;
  for(const value of ['', 'NaN'])field(tree,'空间相机缩放').onChange!({target:{value,valueAsNumber:NaN}});
  enter(tree,'每帧基础绘制点数',0);enter(tree,'空间缩放 X',1e100);expect(change).not.toHaveBeenCalled();
  button(tree,'重新开始空间采样').onClick!();expect(restart).toHaveBeenCalledTimes(1);expect(change).not.toHaveBeenCalled();
 });
});

describe('Roots explicit color edit intents',()=>{
 it('separates every tone field from runtime offset and makes version selection Apply',()=>{
  const scene=source(),before=structuredClone(scene),change=changed(),tree=<RootsDensityColorControls scene={scene} onChange={change}/>;
  for(const spec of ROOTS_SOURCE_TONE_FIELDS){const value=spec.default+.01;enter(tree,spec.label,value);const [next,intent]=change.mock.calls.at(-1)!;expect(intent).toBe(spec.field==='paletteOffset'?'roots-offset':'roots-tone');expect(next.settings[spec.key]).toBe(value);expect(next.rootsSourcePalette).toEqual(scene.rootsSourcePalette);}
  expect(change).toHaveBeenCalledTimes(ROOTS_SOURCE_TONE_FIELDS.length);expect(scene).toEqual(before);
  const localScene=local();field(<RootsDensityColorControls scene={localScene} onChange={change}/>,'复根着色版本').onChange!({target:{value:'mathart-1.7.8-metric-v1'}});expect(change.mock.calls.at(-1)![1]).toBe('roots-apply');expect(change.mock.calls.at(-1)![0].settings.rootDensityColorVersion).toBe('mathart-1.7.8-metric-v1');
 });

 it('preserves raw text, alpha, tail and repeated same-value palette submissions',()=>{
  const scene=source();scene.rootsSourcePalette={colors:['#80AbCdEf','invalid raw','',...Array.from({length:30},(_,i)=>'#'+i.toString(16).padStart(6,'0'))]};const before=structuredClone(scene),change=changed(),tree=palette(scene,change);
  for(let i=0;i<2;i++)field(tree,'复根源颜色原文').onChange!({target:{value:scene.rootsSourcePalette.colors[0]}});
  expect(change).toHaveBeenCalledTimes(2);for(const [next,intent]of change.mock.calls){expect(intent).toBe('roots-palette');expect(next.rootsSourcePalette).toEqual(scene.rootsSourcePalette);}
  field(tree,'复根源颜色').onChange!({target:{value:'#112233'}});expect(change.mock.calls[2][1]).toBe('roots-palette');expect(change.mock.calls[2][0].rootsSourcePalette!.colors).toEqual(['#80112233',...scene.rootsSourcePalette.colors.slice(1)]);expect(scene).toEqual(before);
 });

 it('routes deletion to empty, add, reverse, default and local Manual-copy through palette events',()=>{
  const scene=source(),change=changed();scene.rootsSourcePalette={colors:['#123456']};button(palette(scene,change),'删除颜色').onClick!();expect(change.mock.calls.at(-1)![0].rootsSourcePalette).toEqual({colors:[]});
  const empty=change.mock.calls.at(-1)![0];button(palette(empty,change),'添加颜色').onClick!();expect(change.mock.calls.at(-1)![0].rootsSourcePalette!.colors).toEqual(['#ffffff']);
  scene.rootsSourcePalette={colors:['raw','#112233']};button(palette(scene,change),'反转').onClick!();expect(change.mock.calls.at(-1)![0].rootsSourcePalette!.colors).toEqual(['#112233','raw']);
  scene.rootsSourcePalette={colors:[...DEFAULT_ROOTS_SOURCE_COLORS]};button(palette(scene,change),'恢复四色默认').onClick!();expect(change.mock.calls.at(-1)![0].rootsSourcePalette).toEqual(scene.rootsSourcePalette);
  scene.palette.stops=['#abcdef','#010203'];button(palette(scene,change),'拷贝本地手动颜色一次').onClick!();expect(change.mock.calls.at(-1)![0].rootsSourcePalette!.colors).toEqual(scene.palette.stops);expect(change.mock.calls.at(-1)![0].palette).toEqual(scene.palette);
  expect(change).toHaveBeenCalledTimes(5);expect(change.mock.calls.map(c=>c[1])).toEqual(Array(5).fill('roots-palette'));
 });

 it.each(['cosine','curve'])('routes %s generation through a single palette event',mode=>{
  const scene=source(),before=structuredClone(scene),change=changed();scene.rootsSourcePalette={colors:['#112233','#445566']};before.rootsSourcePalette=structuredClone(scene.rootsSourcePalette);
  field(palette(scene,change),'源色板生成模式').onChange!({target:{value:mode}});expect(change).toHaveBeenCalledTimes(1);expect(change.mock.calls[0][1]).toBe('roots-palette');expect(change.mock.calls[0][0].rootsSourcePalette!.colors).toHaveLength(2);expect(scene).toEqual(before);
 });

 it('routes Manual random generation and restore callbacks, preserving omission and explicit empty',()=>{
  const scene=source(),change=changed(),random=vi.spyOn(Math,'random').mockReturnValue(.5);
  try{button(palette(scene,change),'生成并替换色板').onClick!();}finally{random.mockRestore();}
  expect(change).toHaveBeenCalledTimes(1);expect(change.mock.calls[0][1]).toBe('roots-palette');expect(change.mock.calls[0][0].rootsSourcePalette!.colors).toHaveLength(16);
  const adapter=RootsSourcePaletteEditor({scene,onChange:change}) as ReactElement<{onRestore:(palette:SceneDocument['rootsSourcePalette'])=>string|undefined}>;
  const snapshots:SceneDocument['rootsSourcePalette'][]=[undefined,{colors:[]},{colors:['','#80AbCdEf','raw']}];
  for(const restored of snapshots){expect(adapter.props.onRestore(restored)).toBeUndefined();expect(change.mock.calls.at(-1)![1]).toBe('roots-palette');expect(change.mock.calls.at(-1)![0].rootsSourcePalette).toEqual(restored);}
  expect(change).toHaveBeenCalledTimes(4);
 });
});
