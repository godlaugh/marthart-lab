import {describe,expect,it,vi} from 'vitest';
import {isValidElement,type ReactElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SourceFractalControls} from '../src/components/SourceFractalControls';
import {SourceFractalClipEditor} from '../src/components/SourceFractalClipEditor';
import {FractalControls} from '../src/components/FractalControls';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {bindSourceFractalFormulaParameters} from '../src/engine/sourceFractalFormulaRuntime';
import {parseSourceFractalActionsPayload} from '../src/engine/sourceFractalDocument';
import type {SceneDocument,AnimationTrack} from '../src/types';
vi.mock('react',async load=>({...await load<typeof import('react')>(),useState:(initial:unknown)=>[typeof initial==='function'?initial():initial,vi.fn()]}));
vi.mock('../src/i18n',()=>({useI18n:()=>({t:(s:string,args?:Record<string,string|number>)=>s.replace(/\{(\w+)\}/g,(_,k)=>String(args?.[k]??`{${k}}`))})}));
type Node=ReactElement<Record<string,any>>;
function flatten(node:ReactNode):Node[]{if(Array.isArray(node))return node.flatMap(flatten);if(!isValidElement(node))return[];const e=node as Node;if(typeof e.type==='function')return flatten((e.type as (p:unknown)=>ReactNode)(e.props));return[e,...flatten(e.props.children)];}
function field(tree:ReactNode,label:string){const result=flatten(tree).find(x=>x.props['aria-label']===label);expect(result,`field ${label}`).toBeDefined();return result!.props;}
function button(tree:ReactNode,label:string){const result=flatten(tree).find(x=>x.type==='button'&&(x.props['aria-label']===label||x.props.children===label));expect(result,`button ${label}`).toBeDefined();return result!.props;}
function scene():SceneDocument {const s=createScene(definition('fractal'));s.fractalSource={model:'mathart-1.7.8-scene-v1',formula:{formulaId:'newton',fractalType:'mandelbrot',power:3,formulaParams:[3,1,0,0],bailout:.001,julia:[0,0]}};return s;}
function clip():AnimationTrack{return{id:'source-clip',type:'animate',target:'',from:0,to:1,start:0,duration:1,easing:'linear',pingPong:false,enabled:true,fractalSource:{model:'mathart-1.7.8-actions-v1',targets:{},parameters:[]}};}
const changeValue=(tree:ReactNode,label:string,value:string)=>field(tree,label).onChange({target:{value}});
const changeToggle=(tree:ReactNode,label:string,checked:boolean)=>field(tree,label).onChange({target:{checked}});

describe('source fractal authoring controls',()=>{
 it('keeps absent and typed-empty parameter sets distinct and explicitly binds defaults',()=>{
  const s=scene(),change=vi.fn(),tree=<SourceFractalControls scene={s} section="formula" onChange={change}/>;
  expect(renderToStaticMarkup(tree)).toContain('未提供参数集');expect(change).not.toHaveBeenCalled();
  changeToggle(tree,'启用公式参数集',true);const enabled=change.mock.calls[0][0] as SceneDocument;expect(enabled.fractalSource!.formula.parameters!.complex.exponent).toEqual([3,0]);
  button(<SourceFractalControls scene={enabled} section="formula" onChange={change}/>,'保留空参数集').onClick();expect(change.mock.calls[1][0].fractalSource.formula.parameters).toEqual({floats:{},complex:{}});
  changeToggle(<SourceFractalControls scene={enabled} section="formula" onChange={change}/>,'启用公式参数集',false);expect(change.mock.calls[2][0].fractalSource.formula).not.toHaveProperty('parameters');expect(s.fractalSource!.formula).not.toHaveProperty('parameters');
 });
 it('edits one typed parameter without filling unrelated missing values or mutating local formula settings',()=>{
  const s=scene();s.fractalSource!.formula={...s.fractalSource!.formula,parameters:{floats:{},complex:{exponent:[3,.5]}}};const before=structuredClone(s),change=vi.fn();
  changeValue(<SourceFractalControls scene={s} section="formula" onChange={change}/>,'指数 · 虚部','0.75');const next=change.mock.calls[0][0] as SceneDocument;expect(next.fractalSource!.formula.parameters).toEqual({floats:{},complex:{exponent:[3,.75]}});expect(next.settings).toEqual(s.settings);expect(s).toEqual(before);
 });
 it('routes full source scenes away from inactive local formula controls',()=>{
  const s=scene();const html=renderToStaticMarkup(<FractalControls scene={s} section="formula" onChange={()=>{}}/>);expect(html).toContain('原版分形公式');expect(html).not.toContain('Newton / Nova 数值规则');expect(html).not.toContain('Binocular');
 });
 it('switches only the source formula and explicitly resets its supplied parameters',()=>{
  const s=scene(),bound=bindSourceFractalFormulaParameters('newton',{});if(!bound.ok)throw Error(bound.error.reason);s.fractalSource!.formula={...s.fractalSource!.formula,parameters:bound.value.parameters};const change=vi.fn();changeValue(<SourceFractalControls scene={s} section="formula" onChange={change}/>,'原版公式','nova');expect(change.mock.calls[0][0].fractalSource.formula.formulaId).toBe('nova');expect(change.mock.calls[0][0].fractalSource.formula.parameters.complex.start_value).toEqual([1,0]);expect(change.mock.calls[0][0].settings).toEqual(s.settings);
 });
 it('edits retained traditional fields and high/low viewport values without enabling the parameter set',()=>{
  const s=scene(),change=vi.fn(),tree=<SourceFractalControls scene={s} section="formula" onChange={change}/>;
  changeValue(tree,'传统幂次','7');expect(change.mock.calls[0][0].fractalSource.formula.power).toBe(7);expect(change.mock.calls[0][0].fractalSource.formula).not.toHaveProperty('parameters');
  changeValue(tree,'传统 Julia 虚部','.125');expect(change.mock.calls[1][0].fractalSource.formula.julia).toEqual([0,.125]);
  changeValue(tree,'传统参数 2','.9');expect(change.mock.calls[2][0].fractalSource.formula.formulaParams).toEqual([3,.9,0,0]);
  changeValue(tree,'中心 X 低位','1e-20');expect(change.mock.calls[3][0].settings.centerXLow).toBe(1e-20);expect(change.mock.calls[3][0].fractalSource).toEqual(s.fractalSource);
 });
 it('retains CPU selection with an actionable error and exposes backend/render-method recovery',()=>{
  const s=scene();s.settings.fractalBackend='cpu';const change=vi.fn(),tree=<SourceFractalControls scene={s} section="formula" onChange={change}/>;
  expect(field(tree,'计算后端').value).toBe('cpu');expect(renderToStaticMarkup(tree)).toContain('请选择自动或 GPU');
  changeValue(tree,'计算后端','auto');expect(change.mock.calls[0][0].settings.fractalBackend).toBe('auto');expect(change.mock.calls[0][0].fractalSource).toEqual(s.fractalSource);
  changeValue(tree,'渲染方法','one-pass');expect(change.mock.calls[1][0].settings.renderMethod).toBe('one-pass');
 });
 it('uses owned source identity for color capability without changing stale local formula settings',()=>{
  const s=scene();s.settings.formula='mandelbulb_3d';s.settings.fractalNumericProfile='invalid dormant marker';const change=vi.fn(),tree=<FractalControls scene={s} section="color" onChange={change}/>;
  const html=renderToStaticMarkup(tree);expect(html).toContain('原版内部与外部着色');expect(html).not.toContain('使用 Newton 原版数值');
  changeValue(tree,'外部 · 颜色密度','2');expect(change.mock.calls[0][0].settings).toEqual(s.settings);expect(change.mock.calls[0][0].fractalSource).toEqual(s.fractalSource);
 });
 it('writes viewport only into settings',()=>{
  const s=scene(),change=vi.fn();changeValue(<SourceFractalControls scene={s} section="formula" onChange={change}/>,'中心 X','0.125');expect(change.mock.calls[0][0].settings.centerX).toBe(.125);expect(change.mock.calls[0][0].fractalSource).toEqual(s.fractalSource);
 });
});

describe('source fractal clip controls',()=>{
 it('enables and edits vector targets independently without generic action conversion',()=>{
  const s=scene(),c=clip(),change=vi.fn();changeToggle(<SourceFractalClipEditor track={c} scene={s} onChange={change}/>,'改变环境旋转速度',true);const enabled=change.mock.calls[0][0] as AnimationTrack;expect(enabled.fractalSource!.targets).toEqual({ambientRates:[0,0,0]});changeValue(<SourceFractalClipEditor track={enabled} scene={s} onChange={change}/>,'环境旋转速度 · θ','.2');expect(change.mock.calls[1][0].fractalSource.targets).toEqual({ambientRates:[0,.2,0]});expect(c).not.toHaveProperty('actions');
 });
 it('adds ordered named parameter actions, supports all-stop, and preserves source name text',()=>{
  const s=scene(),c=clip(),change=vi.fn();button(<SourceFractalClipEditor track={c} scene={s} onChange={change}/>,'添加参数动作').onClick();const added=change.mock.calls[0][0] as AnimationTrack;
  changeValue(<SourceFractalClipEditor track={added} scene={s} onChange={change}/>,'参数动作 1 · 参数名称',' exponent_re ');expect(change.mock.calls[1][0].fractalSource.parameters[0].scope.name).toBe(' exponent_re ');
  changeValue(<SourceFractalClipEditor track={added} scene={s} onChange={change}/>,'参数动作 1 · 操作','stop');const stopped=change.mock.calls[2][0] as AnimationTrack;expect(stopped.fractalSource!.parameters[0]).not.toHaveProperty('configuration');
  changeValue(<SourceFractalClipEditor track={stopped} scene={s} onChange={change}/>,'参数动作 1 · 范围','all');expect(change.mock.calls[3][0].fractalSource.parameters[0]).toEqual({kind:'stop',scope:{kind:'all'}});
 });
 it('removes optional edge configuration without restoring it by merge',()=>{
  const s=scene(),c=clip(),change=vi.fn();button(<SourceFractalClipEditor track={c} scene={s} onChange={change}/>,'添加参数动作').onClick();const added=change.mock.calls[0][0] as AnimationTrack;changeToggle(<SourceFractalClipEditor track={added} scene={s} onChange={change}/>,'参数动作 1 · 自定义端点缓动',false);expect(change.mock.calls[1][0].fractalSource.parameters[0].configuration).not.toHaveProperty('edgeEasing');
 });
 it('preserves parameter order and independent gradient flags through reorder/edit',()=>{
  const s=scene(),c=clip(),change=vi.fn();c.fractalSource!.parameters=[{kind:'stop',scope:{kind:'named',name:'bailout'}},{kind:'stop',scope:{kind:'all'}}];button(<SourceFractalClipEditor track={c} scene={s} onChange={change}/>,'参数动作 2 · 上移').onClick();expect(change.mock.calls[0][0].fractalSource.parameters[0].scope).toEqual({kind:'all'});
  changeValue(<SourceFractalClipEditor track={c} scene={s} onChange={change}/>,'渐变操作','start');const gradient=change.mock.calls[1][0] as AnimationTrack;changeToggle(<SourceFractalClipEditor track={gradient} scene={s} onChange={change}/>,'影响内部',false);const last=change.mock.calls[2][0] as AnimationTrack;expect(last.fractalSource!.gradient).toMatchObject({kind:'start',config:{affectInside:false,affectOutside:true}});expect(parseSourceFractalActionsPayload(last.fractalSource).ok).toBe(true);expect(last.fractalSource!.parameters).toEqual(c.fractalSource!.parameters);
 });
});
