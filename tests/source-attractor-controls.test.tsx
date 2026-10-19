import {describe,expect,it,vi} from 'vitest';
import {isValidElement,type ReactElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SourceAttractorControls,SourceAttractorBackground} from '../src/components/SourceAttractorControls';
import {SourceAttractorPaletteEditor} from '../src/components/SourceAttractorPaletteEditor';
import {AttractorGradientEditor,Timeline} from '../src/components/Timeline';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {importSourceAttractorConfig} from '../src/engine/sourceAttractorConfig';
import {importSourceAttractorVisualConfig} from '../src/engine/sourceAttractorVisualConfig';
import {SOURCE_PARTICLE_GRADIENT_DEFAULT} from '../src/engine/sourceParticleGradientConfig';
import type {SceneDocument} from '../src/types';
const setters=vi.hoisted(()=>vi.fn());
vi.mock('react',async load=>({...await load<typeof import('react')>(),useState:(initial:unknown)=>[typeof initial==='function'?initial():initial,setters]}));
vi.mock('../src/i18n',async load=>({...await load<typeof import('../src/i18n')>(),useI18n:()=>({t:(s:string,args?:Record<string,string|number>)=>s.replace(/\{(\w+)\}/g,(_,k)=>String(args?.[k]??`{${k}}`))})}));
type Node=ReactElement<Record<string,any>>;
function flatten(node:ReactNode):Node[]{if(Array.isArray(node))return node.flatMap(flatten);if(!isValidElement(node))return[];const e=node as Node;if(typeof e.type==='function')return flatten((e.type as (p:unknown)=>ReactNode)(e.props));return[e,...flatten(e.props.children)];}
function field(tree:ReactNode,label:string){const node=flatten(tree).find(n=>n.props['aria-label']===label);expect(node,`field ${label}`).toBeDefined();return node!.props;}
function scene(){const s=createScene(definition('attractor'));const c=importSourceAttractorConfig({particle_count_cpu:4,particle_count_gpu:777},{}),v=importSourceAttractorVisualConfig({show_trails:true},['128','#00112233']);if(!c.ok||!v.ok)throw Error('fixture');s.attractorSource={configuration:c.value.configuration,visual:v.value.configuration,backgroundColor:0x80112233};s.sourceCamera={model:'mathart-1.7.8-v1',configuration:{kind:'angles',family:'attractor',phi:0,theta:0,gamma:0}};s.timeline.schedule='ordinary-camera-sequence-v1';s.timeline.tracks=[];return s;}
describe('canonical source Attractor authoring',()=>{
 it('edits motion fields without inert settings or source input mutation',()=>{
  const initial=scene(),before=structuredClone(initial),onChange=vi.fn(),tree=<SourceAttractorControls scene={initial} onChange={onChange}/>;
  for(const [label,text,group,key,value]of [['CPU 粒子数','10001',null,'particleCountCPU',10001],['每帧积分次数','7',null,'stepsPerFrame',7],['积分步长下限','-.2','dtRange','min',-.2],['预热次数','200','warmup','steps',200],['X 初始下限','3','bounds','minX',3],['X 初始上限','-3','bounds','maxX',-3],['Z 缩放','-2','transform','scaleZ',-2]]as const){
   field(tree,label).onChange({target:{value:text}});const next=onChange.mock.lastCall![0] as SceneDocument,c=next.attractorSource!.configuration;expect(group?c[group][key as never]:(c as unknown as Record<string,number>)[key]).toBe(value);expect(next.settings).toEqual(before.settings);expect(c.particleCountGPU).toBe(777);
  }expect(initial).toEqual(before);
 });
 it('edits point and trail appearance, rejects fractional int counts, and preserves signed radius',()=>{
  const initial=scene(),onChange=vi.fn(),tree=<SourceAttractorControls scene={initial} onChange={onChange}/>;
  field(tree,'点半径').onChange({target:{value:'-4'}});expect(onChange.mock.lastCall![0].attractorSource.visual.points.dotRadius).toBe(-4);
  field(tree,'显示拖尾').onChange({target:{checked:false}});expect(onChange.mock.lastCall![0].attractorSource.visual.trails.show).toBe(false);
  onChange.mockClear();field(tree,'CPU 粒子数').onChange({target:{value:'2.5'}});expect(onChange).not.toHaveBeenCalled();expect(setters).toHaveBeenLastCalledWith(expect.stringContaining('int32'));
 });
 it('normalizes integer-gray picker display with the shared color owner while retaining raw palette text',()=>{
  const initial=scene(),onChange=vi.fn(),tree=<SourceAttractorPaletteEditor scene={initial} onChange={onChange}/>;
  expect(field(tree,'吸引子颜色 RGB').value).toBe('#808080');expect(field(tree,'吸引子颜色原文').value).toBe('128');
  field(tree,'吸引子颜色 RGB').onChange({target:{value:'#abcdef'}});expect(onChange.mock.lastCall![0].attractorSource.visual.palette.colors[0]).toBe('#ffabcdef');
  field(tree,'吸引子颜色原文').onChange({target:{value:'not-a-color'}});expect(onChange.mock.lastCall![0].attractorSource.visual.palette.colors[0]).toBe('not-a-color');expect(initial.attractorSource!.visual.palette).toEqual({kind:'colors',colors:['128','#00112233']});
 });
 it('retains empty and omitted palette states and never replaces them merely by rendering',()=>{
  for(const palette of [{kind:'absent'} as const,{kind:'colors' as const,colors:[]}]){const s=scene();s.attractorSource!.visual.palette=palette;const onChange=vi.fn();expect(renderToStaticMarkup(<SourceAttractorPaletteEditor scene={s} onChange={onChange}/>)).toContain('使用默认六色');expect(onChange).not.toHaveBeenCalled();}
 });
 it('preserves background alpha through RGB edits and applies ARGB only after valid blur',()=>{
  const initial=scene(),onChange=vi.fn(),tree=<SourceAttractorBackground scene={initial} onChange={onChange}/>;
  field(tree,'吸引子背景 RGB').onChange({target:{value:'#abcdef'}});expect(onChange.mock.lastCall![0].attractorSource.backgroundColor).toBe(0x80abcdef);
  field(tree,'吸引子背景 ARGB').onBlur({target:{value:'#00112233'}});expect(onChange.mock.lastCall![0].attractorSource.backgroundColor).toBe(0x00112233);
  onChange.mockClear();field(tree,'吸引子背景 ARGB').onBlur({target:{value:'#abc'}});expect(onChange).not.toHaveBeenCalled();
 });
 it('offers source camera/gradient authoring without parameter clips and retains local Attractor UI',()=>{
  const s=scene(),html=renderToStaticMarkup(<Timeline scene={s} time={0} playing={false} onTime={()=>{}} onPlay={()=>{}} onChange={()=>{}}/>),choices=html.match(/<select aria-label="新片段类型"[^>]*>(.*?)<\/select>/)?.[1]??'';
  for(const type of ['wait','animate','align'])expect(choices).toContain(`value="${type}"`);for(const type of ['param','numeric','trails'])expect(choices).not.toContain(`value="${type}"`);
  const gradient=renderToStaticMarkup(<AttractorGradientEditor config={SOURCE_PARTICLE_GRADIENT_DEFAULT} onChange={()=>{}}/>);expect(gradient).toContain('attractor-gradient-config');expect(gradient).toContain('显示拖尾时');expect(gradient).not.toContain('曲面两侧');
  const local=createScene(definition('attractor'));expect(renderToStaticMarkup(<SourceAttractorControls scene={local} onChange={()=>{}}/>)).toBe('');expect(renderToStaticMarkup(<SourceAttractorPaletteEditor scene={local} onChange={()=>{}}/>)).toBe('');
 });
});
