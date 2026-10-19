import {describe,expect,it,vi} from 'vitest';
import {isValidElement,type ReactElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SourceSurfaceControls} from '../src/components/SourceSurfaceControls';
import {SourceSurfacePaletteEditor} from '../src/components/SourceSurfacePaletteEditor';
import {SurfaceTopology} from '../src/components/SurfaceTopology';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {importSourceSurfaceMeshConfig} from '../src/engine/sourceSurfaceMeshConfig';
import {SOURCE_SURFACE_HOST,SOURCE_SURFACE_PARTICLES} from '../src/engine/sourceSurfaceIdentity';
import {translate} from '../src/i18n';
import type {SceneDocument} from '../src/types';

// Controlled component callbacks, not a browser acceptance substitute. The
// public App verifier owns mounted edits, persistence and rendered-frame checks.
const setters=vi.hoisted(()=>vi.fn());
vi.mock('react',async load=>({...await load<typeof import('react')>(),useState:(initial:unknown)=>[typeof initial==='function'?initial():initial,setters]}));
vi.mock('../src/i18n',async load=>({...await load<typeof import('../src/i18n')>(),useI18n:()=>({t:(s:string,args?:Record<string,string|number>)=>s.replace(/\{(\w+)\}/g,(_,k)=>String(args?.[k]??`{${k}}`))})}));
type Node=ReactElement<Record<string,any>>;
function flatten(node:ReactNode):Node[]{if(Array.isArray(node))return node.flatMap(flatten);if(!isValidElement(node))return[];const e=node as Node;if(typeof e.type==='function')return flatten((e.type as (p:unknown)=>ReactNode)(e.props));return[e,...flatten(e.props.children)];}
function field(tree:ReactNode,label:string){const node=flatten(tree).find(x=>x.props['aria-label']===label);expect(node,`field ${label}`).toBeDefined();return node!.props;}
function scene(){const scene=createScene(definition('surface'));scene.settings.surfaceGeometryVersion=SOURCE_SURFACE_HOST;const result=importSourceSurfaceMeshConfig({surface_mode:'MESH',mesh_u_segments:5,mesh_v_segments:4,mesh_wireframe_color:'#40123456',background_color:'#80112233'});if(!result.ok)throw new Error(result.error.reason);scene.surfaceSource=result.value.configuration;return scene;}

describe('canonical source CPU mesh authoring',()=>{
 it('edits mesh sampling, reverse domains and transforms without touching flat settings or authored inputs',()=>{
  const initial=scene(),before=structuredClone(initial),onChange=vi.fn(),tree=<SourceSurfaceControls scene={initial} onChange={onChange}/>;
  for(const [label,text,group,key,value]of [['网格 U 采样数','1','mesh','uSegments',1],['网格 V 采样数','513','mesh','vSegments',513],['U 终点','-8','domain','uMax',-8],['X 缩放','-2','transform','scaleX',-2],['Z 位移','14.25','transform','offsetZ',14.25],['跟踪 V 速度','-.2','tracking','speedV',-.2]]as const){
   field(tree,label).onChange({target:{value:text}});const next=onChange.mock.lastCall![0] as SceneDocument;expect(next.surfaceSource![group][key as never]).toBe(value);expect(next.settings).toEqual(before.settings);expect(next.surfaceSource!.points).toEqual(before.surfaceSource!.points);
  }
  expect(initial).toEqual(before);
 });
 it('renders saved out-of-capacity counts and nonstandard opacity without clamping on open',()=>{
  const initial=scene(),onChange=vi.fn();initial.surfaceSource!.mesh.uSegments=900;initial.surfaceSource!.mesh.fillOpacity=-2;const before=structuredClone(initial),tree=<SourceSurfaceControls scene={initial} onChange={onChange}/>;
  expect(field(tree,'网格 U 采样数').value).toBe(900);expect(field(tree,'网格填充透明度').value).toBe(-2);expect(field(tree,'网格 U 采样数').min).toBeUndefined();expect(field(tree,'网格 U 采样数').max).toBeUndefined();expect(onChange).not.toHaveBeenCalled();expect(initial).toEqual(before);
 });
 it('rejects invalid saved-contract numbers with feedback instead of truncating them',()=>{
  const initial=scene(),onChange=vi.fn(),tree=<SourceSurfaceControls scene={initial} onChange={onChange}/>;setters.mockClear();
  field(tree,'网格 U 采样数').onChange({target:{value:'3.5'}});expect(onChange).not.toHaveBeenCalled();expect(setters).toHaveBeenLastCalledWith(expect.stringContaining('int32'));
  field(tree,'网格填充透明度').onChange({target:{value:'Infinity'}});expect(onChange).not.toHaveBeenCalled();expect(setters).toHaveBeenLastCalledWith('请输入有限数值');
 });
 it('keeps dormant independent-wire counts when toggling and accepts source signed int32 values',()=>{
  const initial=scene(),onChange=vi.fn();initial.surfaceSource!.mesh.wireframeDecoupled=true;initial.surfaceSource!.mesh.wireframeUSegments=-7;initial.surfaceSource!.mesh.wireframeVSegments=9;const tree=<SourceSurfaceControls scene={initial} onChange={onChange}/>;
  field(tree,'独立线框网格').onChange({target:{checked:false}});const next=onChange.mock.lastCall![0] as SceneDocument;expect(next.surfaceSource!.mesh).toMatchObject({wireframeDecoupled:false,wireframeUSegments:-7,wireframeVSegments:9});
  field(tree,'线框 U 分段数').onChange({target:{value:'0'}});expect(onChange.mock.lastCall![0].surfaceSource.mesh.wireframeUSegments).toBe(0);
  expect(renderToStaticMarkup(<SourceSurfaceControls scene={next} onChange={onChange}/>)).not.toContain('aria-label="线框 U 分段数"');
 });
 it('preserves alpha when changing RGB and supports every packed ARGB value explicitly',()=>{
  const initial=scene(),onChange=vi.fn(),tree=<SourceSurfaceControls scene={initial} onChange={onChange}/>;
  field(tree,'网格线框颜色 ARGB RGB').onChange({target:{value:'#abcdef'}});expect(onChange.mock.lastCall![0].surfaceSource.mesh.wireframeColor).toBe(0x40abcdef);
  field(tree,'网格背景颜色 ARGB RGB').onChange({target:{value:'#0000ff'}});expect(onChange.mock.lastCall![0].surfaceSource.backgroundColor).toBe(0x800000ff);
  for(const value of ['#00000000','#00FFFFFF','#FFFFFFFF']){field(tree,'网格线框颜色 ARGB').onBlur({target:{value}});expect(onChange.mock.lastCall![0].surfaceSource.mesh.wireframeColor).toBe(parseInt(value.slice(1),16));}
  onChange.mockClear();field(tree,'网格背景颜色 ARGB').onBlur({target:{value:'#abc'}});expect(onChange).not.toHaveBeenCalled();expect(setters).toHaveBeenLastCalledWith('颜色需要完整的 #AARRGGBB 十六进制值');
 });
 it('does not expose point fade or local topology for mesh and leaves the point editor intact',()=>{
  const mesh=scene(),onChange=vi.fn(),markup=renderToStaticMarkup(<SourceSurfacePaletteEditor scene={mesh} onChange={onChange}/>);
  expect(markup).toContain('data-testid="source-surface-palette"');expect(markup).toContain('网格颜色沿 U');expect(markup).not.toContain('周期边界点渐隐');expect(renderToStaticMarkup(<SurfaceTopology scene={mesh} onChange={onChange}/>)).toBe('');
  const point={...mesh,settings:{...mesh.settings,surfaceGeometryVersion:SOURCE_SURFACE_PARTICLES}};expect(renderToStaticMarkup(<SourceSurfaceControls scene={point} onChange={onChange}/>)).toBe('');expect(renderToStaticMarkup(<SourceSurfacePaletteEditor scene={point} onChange={onChange}/>)).toContain('周期边界点渐隐');expect(onChange).not.toHaveBeenCalled();
 });
 it('provides translated accessible control labels for the public App',()=>{
  for(const [label,english]of [['网格 U 采样数','Mesh U samples'],['网格填充透明度','Mesh fill opacity'],['独立线框网格','Independent wireframe grid'],['线框 U 分段数','Wireframe U divisions']])expect(translate('en',label)).toBe(english);
 });
});
