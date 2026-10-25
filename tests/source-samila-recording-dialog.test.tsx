import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {isValidElement,type ReactElement,type ReactNode} from 'react';
import {inflateSync} from 'node:zlib';
import {ExportDialog} from '../src/components/ExportDialog';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {sourceRecordingSize} from '../src/engine/sourceRecordingSize';
import {exportSessionCleanup} from '../src/engine/exportSessionCleanup';
import type {SourceQueueRecordingClock} from '../src/engine/sourceRecordingClock';
import type {SourceRecordingConsumer} from '../src/engine/generationQueue';
import type {SourceRecordingOptions,SourceRecordingRaster,SourceRecordingStart} from '../src/engine/generationProtocol';

// UI/controller and real PNG/delivery contracts with simulated frame ownership.
// This does not establish native rendering or encoded video fidelity.
const hooks=vi.hoisted(()=>({stateAt:0,refAt:0,states:[] as unknown[],refs:[] as {current:unknown}[],mounted:false,effects:[] as (()=>void|(()=>void))[],cleanups:[] as (()=>void)[]}));
const asserted=vi.hoisted(()=>vi.fn());
vi.mock('react',async load=>({...await load<typeof import('react')>(),
 useState:(initial:unknown)=>{const at=hooks.stateAt++;if(!(at in hooks.states))hooks.states[at]=typeof initial==='function'?initial():initial;return[hooks.states[at],(next:unknown)=>{hooks.states[at]=typeof next==='function'?next(hooks.states[at]):next;}];},
 useRef:(initial:unknown)=>{const at=hooks.refAt++;return hooks.refs[at]??(hooks.refs[at]={current:initial});},
 useEffect:(effect:()=>void|(()=>void))=>{if(!hooks.mounted)hooks.effects.push(effect);},
}));
vi.mock('../src/i18n',()=>({useI18n:()=>({t:(text:string,values:Record<string,unknown>={})=>text.replace(/\{(\w+)\}/g,(all,key)=>String(values[key]??all))})}));
vi.mock('../src/engine/sourceSamilaRecording',()=>({assertSourceSamilaRecordingFrame:asserted}));
vi.mock('../src/engine/renderer',()=>({ArtRenderer:class{constructor(){throw Error('A source recording must not create a cold renderer');}},artExportPurpose:()=>{}}));

type Props=Parameters<typeof ExportDialog>[0];
type Node=ReactElement<Record<string,any>>;
function nodes(node:ReactNode):Node[]{if(Array.isArray(node))return node.flatMap(nodes);if(!isValidElement(node))return[];const n=node as Node;return[n,...nodes(n.props.children)];}
function content(node:ReactNode):string{if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(content).join('');return isValidElement(node)?content((node as Node).props.children):'';}
function find(tree:ReactNode,type:string,label:string){const item=nodes(tree).find(n=>n.type===type&&(n.props['aria-label']===label||content(n.props.children)===label));expect(item,`${type}: ${label}`).toBeDefined();return item!.props;}
function absent(tree:ReactNode,type:string,label:string){expect(nodes(tree).some(n=>n.type===type&&(n.props['aria-label']===label||content(n.props.children)===label))).toBe(false);}
async function flush(){for(let i=0;i<12;i++)await Promise.resolve();}
function deferred<T=void>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}
const id='b2375315-d680-489c-9f78-73bda7c5e0ed';
const calls:{url:string;init:RequestInit}[]=[],downloads:string[]=[];
let finishGate:ReturnType<typeof deferred>|undefined;
function fixture(){return parseLegacyScene('{"config_version":"1.0.0","type":"SAMILA","name":"Author name","settings":{"batch_size":4},"timeline":[{"type":"wait","duration":0.2}]}').scene;}
function harness(extra:Partial<Props>={}){
 const props:Props={scene:fixture(),time:.7,mode:'samila-recording',previewReady:true,samilaPixelDensity:2,samilaPrimaryPixelHeight:972,currentSourceRecording:{ready:true,record:async()=>{}},onClose:vi.fn(),onDone:vi.fn(),onWorkingChange:vi.fn(),...extra};
 const render=()=>{hooks.stateAt=0;hooks.refAt=0;const tree=ExportDialog(props);if(!hooks.mounted){hooks.mounted=true;for(const effect of hooks.effects){const cleanup=effect();if(cleanup)hooks.cleanups.push(cleanup);}}return tree;};
 return{props,render,field:(label:string,value:unknown)=>find(render(),'input',label).onChange({target:{value}})};
}
function clock(encodedFrames:number):SourceQueueRecordingClock{return{simulationFps:7,warmupUpdates:1,updates:encodedFrames+1,encodedFrames,firstEncodedUpdate:encodedFrames?2:null,lastDisplayFrame:encodedFrames,completionReason:'animation-queue'};}
function frames(options:SourceRecordingOptions,count:number){
 const c=clock(count),size=sourceRecordingSize(options,2),make=(index:number)=>{const pixels=new Uint8ClampedArray(size.width*size.height*4);for(let n=0;n<pixels.length;n+=4)pixels.set([201+index,11+index,99-index,n===0?0:n===4?1:127],n);return{type:'raster',width:size.width,height:size.height,pixels} as SourceRecordingRaster;};
 const start:SourceRecordingStart={handle:{sessionId:4,recordingId:1},scene:fixture(),context:{time:0,width:16,height:18,quality:'preview'},clock:c,warmup:make(0)};
 return{start,make};
}
async function pngPixels(blob:Blob){
 const b=new Uint8Array(await blob.arrayBuffer()),v=new DataView(b.buffer),chunks:Uint8Array[]=[];let width=0,height=0;
 expect([...b.slice(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
 for(let at=8;at<b.length;){const length=v.getUint32(at),type=String.fromCharCode(...b.slice(at+4,at+8));if(type==='IHDR'){width=v.getUint32(at+8);height=v.getUint32(at+12);}if(type==='IDAT')chunks.push(b.slice(at+8,at+8+length));at+=length+12;}
 const data=inflateSync(Buffer.concat(chunks)),pixels=new Uint8Array(width*height*4);for(let row=0;row<height;row++){expect(data[row*(width*4+1)]).toBe(0);pixels.set(data.subarray(row*(width*4+1)+1,(row+1)*(width*4+1)),row*width*4);}return{width,height,pixels};
}
function jsonCalls(url:string){return calls.filter(call=>call.url===url).map(call=>JSON.parse(String(call.init.body)));}
beforeEach(()=>{
 hooks.stateAt=0;hooks.refAt=0;hooks.states=[];hooks.refs=[];hooks.mounted=false;hooks.effects=[];hooks.cleanups=[];asserted.mockReset();calls.length=0;downloads.length=0;finishGate=undefined;
 vi.stubGlobal('document',{createElement:(tag:string)=>{if(tag!=='a')throw Error('Unexpected canvas creation');const a={href:'',download:'',click:()=>downloads.push(a.href)};return a;}});
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit={})=>{
  calls.push({url,init});let body:unknown={};
  if(url==='/api/health')body={ffmpeg:true};
  else if(url==='/api/exports')body={id};
  else if(url.startsWith(`/api/exports/${id}/frames?index=`))body={frames:Number(url.split('=').at(-1))+1};
  else if(url===`/api/exports/${id}/finish`){await finishGate?.promise;body={id,url:`/api/exports/${id}/file`,frames:JSON.parse(String(init.body)).finalFrames};}
  else if(init.method!=='DELETE')throw Error(`Unexpected request: ${url}`);
  return{ok:true,status:200,json:async()=>body};
 }));
});
afterEach(async()=>{for(const cleanup of hooks.cleanups)cleanup();await exportSessionCleanup.flush();expect(exportSessionCleanup.diagnostics().owned).toBe(0);vi.unstubAllGlobals();});

describe('Samila source recording dialog',()=>{
 it('uses an explicit queue mode while preserving duration export and absent capabilities',async()=>{
  const h=harness({mode:'export'});let tree=h.render();await flush();find(tree,'button','动画视频').onClick();tree=h.render();
  expect(find(tree,'select','Samila 视频模式').value).toBe('duration');find(tree,'input','导出时长');absent(tree,'select','视频质量');
  find(tree,'select','Samila 视频模式').onChange({target:{value:'retained'}});tree=h.render();absent(tree,'input','导出时长');absent(tree,'input','录制模拟帧率');find(tree,'select','视频质量');
  expect(content(tree)).toContain('上次完整应用的 Samila');expect(content(tree)).not.toContain('使用独立随机采样');
  find(tree,'select','Samila 视频模式').onChange({target:{value:'duration'}});h.props.currentSourceRecording=undefined;tree=h.render();absent(tree,'select','Samila 视频模式');find(tree,'input','导出时长');
 });
 it('waits for both the preview pause and retained owner before enabling a source recording',async()=>{
  const h=harness({previewReady:false});let tree=h.render();await flush();tree=h.render();
  expect(find(tree,'section','Samila 录制')['aria-modal']).toBe('true');absent(tree,'button','动画视频');absent(tree,'input','导出时长');absent(tree,'input','录制模拟帧率');
  expect(find(tree,'button','开始录制').disabled).toBe(true);h.props.previewReady=true;h.props.currentSourceRecording!.ready=false;expect(find(h.render(),'button','开始录制').disabled).toBe(true);
  h.props.currentSourceRecording!.ready=true;expect(find(h.render(),'button','开始录制').disabled).toBe(false);
 });
 it('discards warmup, uploads raw RGBA from the 3x target and waits for the original MP4 profile to finish',async()=>{
  finishGate=deferred();const atFinish=deferred(),restored=vi.fn();let expected:Uint8ClampedArray|undefined;
  const record=vi.fn(async(options:SourceRecordingOptions,consumer:SourceRecordingConsumer)=>{const {start,make}=frames(options,2);await consumer.start?.(start);for(let i=0;i<2;i++){const output=make(i+1);if(!i)expected=output.pixels.slice();await consumer.frame(output,i,start);}atFinish.resolve();await consumer.complete?.(start,{encodedFrames:2,lastDisplayFrame:2,reason:'queue-complete'});restored();});
  const h=harness({currentSourceRecording:{ready:true,record}});h.render();await flush();h.field('导出宽度',16);h.field('导出高度',18);h.field('导出帧率',7);
  const done=find(h.render(),'button','开始录制').onClick() as Promise<void>;await atFinish.promise;await flush();
  expect(record.mock.calls[0][0]).toEqual({width:16,height:18,simulationFps:7});expect(jsonCalls('/api/exports')).toEqual([{width:16,height:18,fps:7,frames:2,format:'mp4',profile:'mathart',quality:'high',inputWidth:48,inputHeight:54}]);
  const uploads=calls.filter(c=>c.url.includes('/frames?'));expect(uploads.map(c=>c.url)).toEqual([`/api/exports/${id}/frames?index=0`,`/api/exports/${id}/frames?index=1`]);
  const raw=await pngPixels(uploads[0].init.body as Blob);expect([raw.width,raw.height]).toEqual([48,54]);expect(raw.pixels).toEqual(new Uint8Array(expected!));expect([...raw.pixels.slice(0,8)]).toEqual([202,12,98,0,202,12,98,1]);
  expect(asserted.mock.calls.map(args=>args[2])).toEqual([0,1,2]);expect(restored).not.toHaveBeenCalled();expect(h.props.onDone).not.toHaveBeenCalled();expect(downloads).toEqual([]);
  finishGate.resolve(undefined);await done;expect(restored).toHaveBeenCalledOnce();expect(downloads).toEqual([`/api/exports/${id}/file`]);expect(h.props.onWorkingChange).toHaveBeenLastCalledWith(false);expect(h.props.onDone).toHaveBeenCalledWith('视频已编码并导出');
 });
 it('reports zero encoded frames without creating an export or manufacturing a hold frame',async()=>{
  const record=vi.fn(async(options:SourceRecordingOptions,consumer:SourceRecordingConsumer)=>{const {start}=frames(options,0);await consumer.start?.(start);await consumer.complete?.(start,{encodedFrames:0,lastDisplayFrame:0,reason:'queue-complete'});});
  const h=harness({currentSourceRecording:{ready:true,record}});h.render();await flush();h.field('导出帧率',7);await find(h.render(),'button','开始录制').onClick();
  expect(record).toHaveBeenCalledOnce();expect(calls.filter(c=>c.url.startsWith('/api/exports'))).toEqual([]);expect(content(h.render())).toContain('没有可保存帧');expect(downloads).toEqual([]);expect(h.props.onDone).not.toHaveBeenCalled();
 });
 it('cancels before the next frame upload and keeps created-session cleanup reachable',async()=>{
  const warmed=deferred(),continueQueue=deferred(),restored=vi.fn();let observed:AbortSignal|undefined;
  const record=vi.fn(async(options:SourceRecordingOptions,consumer:SourceRecordingConsumer,signal?:AbortSignal)=>{observed=signal;const {start,make}=frames(options,2);try{await consumer.start?.(start);warmed.resolve();await continueQueue.promise;await consumer.frame(make(1),0,start);}finally{restored();}});
  const h=harness({currentSourceRecording:{ready:true,record}});h.render();await flush();h.field('导出宽度',16);h.field('导出高度',18);h.field('导出帧率',7);
  const done=find(h.render(),'button','开始录制').onClick() as Promise<void>;await warmed.promise;find(h.render(),'button','取消导出').onClick();expect(observed?.aborted).toBe(true);continueQueue.resolve();await done;
  expect(calls.filter(c=>c.url.includes('/frames?')||c.url.endsWith('/finish'))).toEqual([]);expect(calls.some(c=>c.init.method==='DELETE'&&c.url===`/api/exports/${id}?onlyUnfinished=true`)).toBe(true);expect(restored).toHaveBeenCalledOnce();expect(downloads).toEqual([]);expect(h.props.onWorkingChange).toHaveBeenLastCalledWith(false);
 });
 it('rejects an owner target that disagrees with the 3x preflight before creating an encoder',async()=>{
  const record=vi.fn(async(options:SourceRecordingOptions,consumer:SourceRecordingConsumer)=>{const {start}=frames(options,1);await consumer.start?.({...start,warmup:{...start.warmup,width:16,height:18}});});
  const h=harness({currentSourceRecording:{ready:true,record}});h.render();await flush();h.field('导出宽度',16);h.field('导出高度',18);h.field('导出帧率',7);await find(h.render(),'button','开始录制').onClick();
  expect(content(h.render())).toContain('录制实际尺寸与预检不一致');expect(calls.filter(c=>c.url.startsWith('/api/exports'))).toEqual([]);expect(h.props.onWorkingChange).toHaveBeenLastCalledWith(false);
 });
 it('stops after the last uploaded frame and saves that exact prefix before returning the owner',async()=>{
  const uploaded=deferred(),continueQueue=deferred(),restored=vi.fn();let stopped=false;
  const record=vi.fn(async(options:SourceRecordingOptions,consumer:SourceRecordingConsumer)=>{const {start,make}=frames(options,3);await consumer.start?.(start);await consumer.frame(make(1),0,start);uploaded.resolve();await continueQueue.promise;stopped=consumer.shouldStop?.()??false;if(!stopped)throw Error('Manual stop was not delivered');await consumer.complete?.(start,{encodedFrames:1,lastDisplayFrame:1,reason:'manual-stop'});restored();});
  const h=harness({currentSourceRecording:{ready:true,record}});h.render();await flush();h.field('导出宽度',16);h.field('导出高度',18);h.field('导出帧率',7);
  const done=find(h.render(),'button','开始录制').onClick() as Promise<void>;await uploaded.promise;find(h.render(),'button','停止并保存').onClick();continueQueue.resolve();await done;
  expect(stopped).toBe(true);expect(calls.filter(c=>c.url.includes('/frames?'))).toHaveLength(1);expect(jsonCalls(`/api/exports/${id}/finish`)).toEqual([{finalFrames:1}]);expect(restored).toHaveBeenCalledOnce();expect(downloads).toHaveLength(1);
 });
});
