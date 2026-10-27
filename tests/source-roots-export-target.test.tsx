import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {isValidElement,type ReactElement,type ReactNode} from 'react';
import {ExportDialog} from '../src/components/ExportDialog';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import {createRootsNativeMath} from '../src/engine/rootsMathConfig';
import {exportSessionCleanup} from '../src/engine/exportSessionCleanup';
import type {GenerateContext,SceneDocument,SceneOutput} from '../src/types';
// Real export controller with simulated generation/encoding; no GPU or image-parity claim.
const h=vi.hoisted(()=>({stateAt:0,refAt:0,states:[] as unknown[],refs:[] as {current:unknown}[],effects:[] as (()=>void|(()=>void))[],cleanups:[] as (()=>void)[],mounted:false,generate:vi.fn(),size:vi.fn(),blob:vi.fn(),geometry:vi.fn(),encode:vi.fn(),dispose:vi.fn(),settle:vi.fn(),cancel:vi.fn()}));
vi.mock('react',async load=>({...await load<typeof import('react')>(),useState:(initial:unknown)=>{const i=h.stateAt++;if(!(i in h.states))h.states[i]=typeof initial==='function'?initial():initial;return[h.states[i],(v:unknown)=>{h.states[i]=typeof v==='function'?v(h.states[i]):v;}];},useRef:(initial:unknown)=>h.refs[h.refAt++]??(h.refs[h.refAt-1]={current:initial}),useEffect:(e:()=>void|(()=>void))=>{if(!h.mounted)h.effects.push(e);}}));
vi.mock('../src/i18n',()=>({useI18n:()=>({t:(s:string,args:Record<string,unknown>={})=>s.replace(/\{(\w+)\}/g,(m,k)=>String(args[k]??m))})}));
vi.mock('../src/engine/client',()=>({Generator:class{generate=h.generate;dispose=h.dispose;settledNativeCleanup=h.settle;cancel=h.cancel;}}));
vi.mock('../src/engine/renderer',()=>({ArtRenderer:class{setSize=h.size;setOutput(){}blob=h.blob;dispose(){}},artExportPurpose:()=> 'local-export'}));
vi.mock('../src/engine/sourceGeometryImage',async original=>({...await original<object>(),encodeSourceGeometryImage:h.geometry}));
vi.mock('../src/engine/formulaCanvas',()=>({encodeFormulaRaster:h.encode}));
type Node=ReactElement<Record<string,any>>;
const nodes=(n:ReactNode):Node[]=>Array.isArray(n)?n.flatMap(nodes):isValidElement(n)?[n as Node,...nodes((n as Node).props.children)]:[];
const text=(n:ReactNode):string=>typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(text).join(''):isValidElement(n)?text((n as Node).props.children):'';
function find(n:ReactNode,type:string,label:string){const p=nodes(n).find(x=>x.type===type&&(x.props['aria-label']===label||text(x.props.children)===label));expect(p,`${type} ${label}`).toBeDefined();return p!.props;}
const calls:{url:string;init:RequestInit}[]=[];
function harness(mode:'density'|'point-cloud'='density'){
 const scene=createScene(definition('roots'));scene.rootsMath=createRootsNativeMath();scene.rootsPresentation=defaultRootsPresentationConfiguration();scene.rootsPresentation.mode=mode;
 scene.projectResolution={width:32,height:24};scene.timeline={duration:.1,fps:30,loop:false,tracks:[]};
 const props:Parameters<typeof ExportDialog>[0]={scene,time:.25,previewLogicalHeight:486,previewReady:true,onClose:vi.fn(),onDone:vi.fn()};
 const render=()=>{h.stateAt=0;h.refAt=0;const tree=ExportDialog(props);if(!h.mounted){h.mounted=true;for(const effect of h.effects){const cleanup=effect();if(cleanup)h.cleanups.push(cleanup);}}return tree;};return{props,render};
}
function delivered(c:GenerateContext,backend:'native'|'webgl2'='native',mode:'density'|'point-cloud'='point-cloud'):Extract<SceneOutput,{type:'raster'}>{
 const pixels=new Uint8ClampedArray(c.width*c.height*4);for(let i=0;i<pixels.length;i+=4)pixels.set([213,7,91,i%256],i);
 return{type:'raster',cameraResolved:true,backend,width:c.width,height:c.height,pixels,
 ...(backend==='native'?{sourcePixelRenderer:{backend:'native' as const,identity:'a'.repeat(64),generation:1,sequence:2,samples:0}}:{}),
 formulaPresentation:{referenceWidth:c.width,referenceHeight:c.height,labels:[]},
 rootsPresentation:{model:'mathart-1.7.8-v1',mode,clockPolicy:'local-fixed-sample-clock-v1',streamPolicy:'global-ordinal',presentationAlpha:'opaque-framebuffer-rgb',instance:1,restartReason:null,attemptedSamples:2,newSamples:0,newRawPoints:0,totalRawPoints:2,physicalSize:[c.width,c.height],logicalSize:[c.width,c.height],referenceLogicalHeight:486,target:'offscreen'},
 stats:{samples:2,generated:2,invalid:0,elapsedMs:0}};
}
async function ready(mode:'png'|'jpg'|'video'='png',author:'density'|'point-cloud'='density'){
 const ui=harness(author);ui.render();await flush();find(ui.render(),'select','复根图像来源').onChange({target:{value:'replay'}});
 if(mode==='video')find(ui.render(),'button','动画视频').onClick();else find(ui.render(),'select','导出格式').onChange({target:{value:mode}});return ui;
}
async function flush(){for(let i=0;i<12;i++)await Promise.resolve();}
beforeEach(()=>{
 h.dispose.mockReset();h.settle.mockReset().mockResolvedValue(undefined);h.cancel.mockReset();
 Object.assign(h,{stateAt:0,refAt:0,states:[],refs:[],effects:[],cleanups:[],mounted:false});calls.length=0;h.encode.mockReset().mockResolvedValue(new Blob(['native'],{type:'image/png'}));h.size.mockReset();h.generate.mockReset().mockImplementation(async(_s:SceneDocument,c:GenerateContext)=>delivered(c));h.blob.mockReset().mockResolvedValue(new Blob(['image'],{type:'image/png'}));h.geometry.mockReset().mockResolvedValue(new Blob(['geometry'],{type:'image/png'}));
 vi.stubGlobal('document',{createElement:(tag:string)=>tag==='a'?{href:'',download:'',click(){}}:{}});
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit={})=>{calls.push({url,init});return{ok:true,status:200,json:async()=>url==='/api/health'?{ffmpeg:true}:url==='/api/exports'?{id:'a2375315-d680-489c-9f78-73bda7c5e0ed'}:{url:'/test-result'}};}));
});
afterEach(async()=>{for(const cleanup of h.cleanups)cleanup();await exportSessionCleanup.flush();expect(exportSessionCleanup.diagnostics().owned).toBe(0);vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('Roots export uses completed pixel ownership (controller test; simulated GPU)',()=>{
 for(const mode of ['png','jpg','video'] as const)it(`${mode} encodes native receipt directly, even with a different staged author mode`,async()=>{
  vi.stubEnv('VITE_SOURCE_RENDERER','native');const ui=await ready(mode,'density');await find(ui.render(),'button','开始导出').onClick();
  expect(ui.props.onDone).toHaveBeenCalledWith(mode==='video'?'视频已编码并导出':'图片已导出');expect(h.size).not.toHaveBeenCalled();expect(h.blob).not.toHaveBeenCalled();expect(h.geometry).not.toHaveBeenCalled();
  expect(h.encode).toHaveBeenCalledTimes(mode==='video'?3:1);
  for(let i=0;i<h.encode.mock.calls.length;i++){
   const [output,format,options]=h.encode.mock.calls[i];expect(output).toBe(await h.generate.mock.results[i].value);expect(output.rootsPresentation.mode).toBe('point-cloud');expect(output.pixels[3]).toBe(0);expect(output.pixels[7]).toBe(4);
   expect(format).toBe(mode==='jpg'?'image/jpeg':'image/png');expect(options.sourcePresentationAlpha).toBe(mode==='video'?'opaque':'preserve');expect(options.sourceImageProcessing).toBeUndefined();
   expect(h.generate.mock.calls[i][1]).toMatchObject({width:32,height:24,rootsViewport:{logicalWidth:32,logicalHeight:24,referenceLogicalHeight:486,target:'offscreen'}});
  }
  expect(h.dispose).toHaveBeenCalledOnce();expect(h.settle).toHaveBeenCalledOnce();
 });
 for(const mode of ['density','point-cloud'] as const)it(`retains the existing ${mode} WebGL renderer route`,async()=>{
  h.generate.mockImplementation(async(_s:SceneDocument,c:GenerateContext)=>delivered(c,'webgl2',mode));const ui=await ready('png',mode);await find(ui.render(),'button','开始导出').onClick();
  expect(ui.props.onDone).toHaveBeenCalled();expect(h.encode).not.toHaveBeenCalled();expect(h.size).toHaveBeenCalledExactlyOnceWith(32,24,1);expect(h.blob).toHaveBeenCalledOnce();
 });
 for(const malformed of ['missing-receipt','wrong-backend','missing-facts','wrong-mode','unprojected'] as const)it(`rejects ${malformed} without redrawing or publishing`,async()=>{
  h.generate.mockImplementation(async(_s:SceneDocument,c:GenerateContext)=>{const out=delivered(c);if(malformed==='missing-receipt')delete out.sourcePixelRenderer;else if(malformed==='wrong-backend')out.backend='webgl2';else if(malformed==='missing-facts')delete out.rootsPresentation;else if(malformed==='wrong-mode')out.rootsPresentation!.mode='density';else Reflect.set(out,'cameraResolved',false);return out;});
  const ui=await ready();await find(ui.render(),'button','开始导出').onClick();expect(text(ui.render())).toContain('原生复根导出缺少已完成的像素来源');expect(ui.props.onDone).not.toHaveBeenCalled();expect(h.encode).not.toHaveBeenCalled();expect(h.blob).not.toHaveBeenCalled();expect(h.size).not.toHaveBeenCalled();expect(calls.some(c=>c.url==='/api/images')).toBe(false);expect(h.dispose).toHaveBeenCalledOnce();expect(h.settle).toHaveBeenCalledOnce();
 });
 it('cancels pending composition before publication and settles the generation owner',async()=>{
  let complete!:(blob:Blob)=>void;h.encode.mockImplementation(()=>new Promise<Blob>(resolve=>{complete=resolve;}));const ui=await ready();const pending=find(ui.render(),'button','开始导出').onClick();
  await vi.waitFor(()=>expect(h.encode).toHaveBeenCalledOnce());find(ui.render(),'button','取消导出').onClick();expect(h.cancel).toHaveBeenCalledOnce();expect(h.encode.mock.calls[0][2].signal.aborted).toBe(true);
  complete(new Blob(['late'],{type:'image/png'}));await pending;expect(ui.props.onDone).not.toHaveBeenCalled();expect(calls.some(c=>c.url==='/api/images')).toBe(false);expect(h.dispose).toHaveBeenCalledOnce();expect(h.settle).toHaveBeenCalledOnce();expect(h.size).not.toHaveBeenCalled();
 });
});
