import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {isValidElement,type ReactElement,type ReactNode} from 'react';
import {ExportDialog} from '../src/components/ExportDialog';
import {parseProjectFile} from '../src/engine/legacyImport';
import {exportSessionCleanup} from '../src/engine/exportSessionCleanup';
import type {GenerateContext,SceneDocument} from '../src/types';
// Real export controller with simulated generation/encoding; no GPU or image-parity claim.
const h=vi.hoisted(()=>({stateAt:0,refAt:0,states:[] as unknown[],refs:[] as {current:unknown}[],effects:[] as (()=>void|(()=>void))[],cleanups:[] as (()=>void)[],mounted:false,generate:vi.fn(),size:vi.fn(),blob:vi.fn(),geometry:vi.fn(),encode:vi.fn()}));
vi.mock('react',async load=>({...await load<typeof import('react')>(),useState:(initial:unknown)=>{const i=h.stateAt++;if(!(i in h.states))h.states[i]=typeof initial==='function'?initial():initial;return[h.states[i],(v:unknown)=>{h.states[i]=typeof v==='function'?v(h.states[i]):v;}];},useRef:(initial:unknown)=>h.refs[h.refAt++]??(h.refs[h.refAt-1]={current:initial}),useEffect:(e:()=>void|(()=>void))=>{if(!h.mounted)h.effects.push(e);}}));
vi.mock('../src/i18n',()=>({useI18n:()=>({t:(s:string,args:Record<string,unknown>={})=>s.replace(/\{(\w+)\}/g,(m,k)=>String(args[k]??m))})}));
vi.mock('../src/engine/client',()=>({Generator:class{generate=h.generate;dispose(){}async settledNativeCleanup(){}}}));
vi.mock('../src/engine/renderer',()=>({ArtRenderer:class{setSize=h.size;setOutput(){}blob=h.blob;dispose(){}},artExportPurpose:()=> 'local-export'}));
vi.mock('../src/engine/sourceGeometryImage',async original=>({...await original<object>(),encodeSourceGeometryImage:h.geometry}));
vi.mock('../src/engine/formulaCanvas',()=>({encodeFormulaRaster:h.encode}));
type Node=ReactElement<Record<string,any>>;
const nodes=(n:ReactNode):Node[]=>Array.isArray(n)?n.flatMap(nodes):isValidElement(n)?[n as Node,...nodes((n as Node).props.children)]:[];
const text=(n:ReactNode):string=>typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(text).join(''):isValidElement(n)?text((n as Node).props.children):'';
function find(n:ReactNode,type:string,label:string){const p=nodes(n).find(x=>x.type===type&&(x.props['aria-label']===label||text(x.props.children)===label));expect(p,`${type} ${label}`).toBeDefined();return p!.props;}
const calls:{url:string;init:RequestInit}[]=[];
function harness(backend:'CPU'|'GPU',density:number|undefined=2,width=500,height=600,local=false){
 const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'ATTRACTOR',name:'Export target',settings:{render_mode:backend,particle_count_cpu:2,particle_count_gpu:2,sub_steps:1},equations:{dx:'1',dy:'0',dz:'0'},initialization:{warmup_steps:0,warmup_stagger_min:0,warmup_stagger_max:0},timeline:[{type:'wait',duration:.1}]})).scene;
 scene.projectResolution={width,height};if(local){delete scene.attractorSource;delete scene.sourceCamera;scene.timeline={duration:.1,fps:30,loop:false,tracks:[]};}
 const props:Parameters<typeof ExportDialog>[0]={scene,time:0,previewPointPixelDensity:density,previewLogicalHeight:486,previewReady:true,onClose:vi.fn(),onDone:vi.fn()};
 const render=()=>{h.stateAt=0;h.refAt=0;const tree=ExportDialog(props);if(!h.mounted){h.mounted=true;for(const effect of h.effects){const cleanup=effect();if(cleanup)h.cleanups.push(cleanup);}}return tree;};return{props,render};
}
async function flush(){for(let i=0;i<12;i++)await Promise.resolve();}
beforeEach(()=>{
 Object.assign(h,{stateAt:0,refAt:0,states:[],refs:[],effects:[],cleanups:[],mounted:false});calls.length=0;h.encode.mockReset().mockResolvedValue(new Blob(['native'],{type:'image/png'}));h.size.mockReset();h.generate.mockReset().mockImplementation(async(_s:SceneDocument,c:GenerateContext)=>({type:'raster',width:c.width,height:c.height,pixels:new Uint8ClampedArray(0),stats:{samples:1,generated:1,invalid:0,elapsedMs:0}}));h.blob.mockReset().mockResolvedValue(new Blob(['image'],{type:'image/png'}));h.geometry.mockReset().mockResolvedValue(new Blob(['geometry'],{type:'image/png'}));
 vi.stubGlobal('document',{createElement:(tag:string)=>tag==='a'?{href:'',download:'',click(){}}:{}});
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit={})=>{calls.push({url,init});return{ok:true,status:200,json:async()=>url==='/api/health'?{ffmpeg:true}:url==='/api/exports'?{id:'a2375315-d680-489c-9f78-73bda7c5e0ed'}:{url:'/test-result'}};}));
});
afterEach(async()=>{for(const cleanup of h.cleanups)cleanup();await exportSessionCleanup.flush();expect(exportSessionCleanup.diagnostics().owned).toBe(0);vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('Attractor public export target handoff',()=>{
 for(const backend of ['CPU','GPU'] as const)for(const density of [1,2])it(`${backend} DPR${density} PNG sends physical dimensions and paired logical camera`,async()=>{
  const ui=harness(backend,density);ui.render();await flush();await find(ui.render(),'button','开始导出').onClick();expect(ui.props.onDone).toHaveBeenCalledWith('图片已导出');
  expect(h.generate.mock.calls[0][1]).toMatchObject({width:500,height:600,sourcePointPixelDensity:density,sourceViewport:{logicalWidth:500/density,logicalHeight:600/density,referenceLogicalHeight:486,target:'offscreen'}});expect(h.size).toHaveBeenCalledWith(500/density,600/density,density);
  expect(h.geometry).toHaveBeenCalledTimes(backend==='CPU'?1:0);expect(h.blob).toHaveBeenCalledTimes(backend==='GPU'?1:0);
 });
 it.each(['CPU','GPU'] as const)('%s exposes odd actual dimensions and keeps JPEG on the same target',async backend=>{
  const ui=harness(backend,2,503,607);ui.render();await flush();expect(text(ui.render())).toContain('504 × 608');find(ui.render(),'select','导出格式').onChange({target:{value:'jpg'}});await find(ui.render(),'button','开始导出').onClick();expect(ui.props.onDone).toHaveBeenCalled();expect(h.generate.mock.calls[0][1]).toMatchObject({width:504,height:608,sourceViewport:{logicalWidth:252,logicalHeight:304}});expect(h.size).toHaveBeenCalledWith(252,304,2);
  if(backend==='GPU')expect(h.blob.mock.calls[0][0]).toBe('image/jpeg');else expect(h.geometry.mock.calls[0][3].format).toBe('image/jpeg');
 });
 it.each(['CPU','GPU'] as const)('%s fixed-time video preserves requested physical size without forced 3x',async backend=>{
  const ui=harness(backend,2);ui.render();await flush();find(ui.render(),'button','动画视频').onClick();await find(ui.render(),'button','开始导出').onClick();expect(ui.props.onDone).toHaveBeenCalledWith('视频已编码并导出');
  const created=JSON.parse(String(calls.find(c=>c.url==='/api/exports')!.init.body));expect(created).toMatchObject({width:500,height:600,inputWidth:500,inputHeight:600});expect(h.generate.mock.calls.length).toBeGreaterThan(0);for(const [,context]of h.generate.mock.calls)expect(context).toMatchObject({width:500,height:600,sourceViewport:{logicalWidth:250,logicalHeight:300}});expect(h.size).toHaveBeenCalledWith(250,300,2);
 });
 for(const mode of ['png','jpg','video'] as const)it(`native GPU ${mode} encodes delivered pixels without another renderer`,async()=>{
  vi.stubEnv('VITE_SOURCE_RENDERER','native');h.generate.mockImplementation(async(_s:SceneDocument,c:GenerateContext)=>({type:'raster',backend:'native',width:c.width,height:c.height,pixels:new Uint8ClampedArray(0),sourcePixelRenderer:{backend:'native',identity:'a'.repeat(64),generation:1,sequence:2,samples:0},stats:{samples:2,generated:2,invalid:0,elapsedMs:0}}));
  const ui=harness('GPU');ui.render();await flush();if(mode==='video')find(ui.render(),'button','动画视频').onClick();else find(ui.render(),'select','导出格式').onChange({target:{value:mode}});
  await find(ui.render(),'button','开始导出').onClick();expect(ui.props.onDone).toHaveBeenCalled();expect(h.size).not.toHaveBeenCalled();expect(h.blob).not.toHaveBeenCalled();expect(h.geometry).not.toHaveBeenCalled();expect(h.encode).toHaveBeenCalled();
  for(const [output,format,options]of h.encode.mock.calls){expect(output.backend).toBe('native');expect(format).toBe(mode==='jpg'?'image/jpeg':'image/png');expect(options.sourcePresentationAlpha).toBe(mode==='video'?'opaque':'preserve');expect(options.sourceImageProcessing).toBeUndefined();}
 });
 it('does not grant source GPU export when its completed display density is unknown',async()=>{
  const ui=harness('GPU');ui.props.previewPointPixelDensity=undefined;ui.render();await flush();const button=find(ui.render(),'button','开始导出');expect(button.disabled).toBe(true);await button.onClick();expect(h.generate).not.toHaveBeenCalled();
 });
 it('keeps local Attractor requested pixels and its existing density-1 rendering path',async()=>{
  const ui=harness('GPU',2,503,607,true);ui.render();await flush();await find(ui.render(),'button','开始导出').onClick();expect(ui.props.onDone).toHaveBeenCalled();expect(h.generate.mock.calls[0][1]).toMatchObject({width:503,height:607});expect(h.generate.mock.calls[0][1]).not.toHaveProperty('sourceViewport');expect(h.size).toHaveBeenCalledWith(503,607,1);
 });
});
