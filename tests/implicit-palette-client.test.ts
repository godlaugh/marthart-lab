import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Generator} from '../src/engine/client';
import {GenerationQueue} from '../src/engine/generationQueue';
import {parseProjectFile} from '../src/engine/legacyImport';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {implicitPaletteEditorState} from '../src/engine/implicitPaletteEditing';
import {sourcePaletteRuntimeScene} from '../src/engine/sourcePaletteRuntimeScene';
import type {GenerationInput,SceneDocument,SceneOutput} from '../src/types';
import type {GenerationRequest,GenerationResponse} from '../src/engine/generationProtocol';
import native from './fixtures/source-implicit-presentation/recording-clock.json';
// Real client, queue, Worker handler, numerical producer and transferable buffers.
// Only native drawing is replaced; these tests do not establish GPU pixels.
vi.mock('../src/engine/renderGeometryRecording',()=>({GeometryRecordingRenderer:class{
 constructor(_scene:unknown,private size:{width:number;height:number}){}
 async render(output:Extract<SceneOutput,{type:'geometry'}>){return{type:'raster',width:this.size.width,height:this.size.height,pixels:new Uint8ClampedArray(this.size.width*this.size.height*4),stats:output.stats,implicitControls:output.implicitControls,implicitRecording:output.implicitRecording,sourceImplicitParameters:output.sourceImplicitParameters,sourceCameraFrame:output.sourceCameraFrame,formulaPresentation:output.formulaPresentation};}
 dispose(){}
}}));
// Stop after real capture admission. The native App workflow verifies pixels;
// this fixture checks that a drawing failure retains the validated capability.
vi.mock('../src/engine/renderGeometryCapture',()=>({renderGeometryCapture:async()=>{throw Error('native capture fixture failed after admission');}}));
let worker:{onmessage?:(event:MessageEvent<GenerationRequest>)=>void;postMessage:(data:GenerationResponse,options:{transfer:Transferable[]})=>void},port:Transport;
let corrupt:((message:GenerationResponse)=>void)|undefined,hold=false,held:GenerationResponse[]=[];
class Transport{
 onmessage:((event:{data:GenerationResponse})=>void)|null=null;sent:GenerationRequest[]=[];terminated=false;
 constructor(){port=this;}
 postMessage(data:GenerationRequest){this.sent.push(structuredClone(data));worker.onmessage!({data:structuredClone(data)} as MessageEvent<GenerationRequest>);}
 terminate(){this.terminated=true;}
}
beforeEach(async()=>{vi.resetModules();corrupt=undefined;hold=false;held=[];worker={postMessage:(data,options)=>{
 const message=structuredClone(data,{transfer:options.transfer});corrupt?.(message);
 if(hold&&message.operation==='generate'&&!('error'in message))held.push(message);else port.onmessage?.({data:message});
}};vi.stubGlobal('self',worker);vi.stubGlobal('Worker',Transport);await import('../src/engine/generate.worker');});
afterEach(()=>vi.unstubAllGlobals());
function fixture(){
 const raw=structuredClone(native.cases[0].input.project);raw.settings.x_segments=raw.settings.y_segments=raw.settings.z_segments=4;
 const scene=parseProjectFile(JSON.stringify(raw)).scene;scene.implicitSourcePalette={colors:['#80112233']};scene.settings.opacity=1;scene.settings.meshWireframe=false;
 const context:GenerationInput={time:0,width:810,height:972,quality:'preview',sourcePointPixelDensity:2,sourceViewport:ordinarySourceViewport(scene,405,486,'primary',486),implicitControls:{sessionId:'client-palette',acknowledgedRevision:0,commands:[{kind:'apply',revision:1,scene}]}};
 return{scene,context,options:{width:128,height:96,simulationFps:4,actualFrameRate:37}};
}
async function setup(){const f=fixture(),g=new Generator(),output=await g.generate(f.scene,f.context);return{...f,g,output};}
const hot=(context:GenerationInput,revision:number,colors=['#aabbcc']):GenerationInput=>({...context,implicitControls:{sessionId:'client-palette',acknowledgedRevision:revision-1,commands:[{kind:'palette',revision,colors}]}});
const rgba=(output:SceneOutput)=>{if(output.type!=='geometry')throw Error('geometry');return [...output.sourceImplicitPresentation!.fillColors.slice(0,4)];};
const color=(r:number,g:number,b:number,a=255)=>[r,g,b,a].map(v=>Math.fround(v/255));
describe('Implicit control public client and queue transport',()=>{
 it('admits a held capture after restoring the author editor state and retains it if drawing fails',async()=>{
  const f=await setup();expect(f.scene.implicitPaletteEditor).toBeDefined();
  try{
   const start=await f.g.beginSourceRecording(f.output,f.options),stop=await f.g.finishSourceRecording(start.handle,1000);
   await f.g.setImplicitPaused(stop.preview,true,1100);
   const output=await f.g.generate(f.scene,{...stop.context,implicitLive:{...stop.context.implicitLive!,clock:{paused:true,timestampMs:1200}}});
   await expect(f.g.captureImplicitPaused(output,{width:65,height:49})).rejects.toMatchObject({message:'native capture fixture failed after admission',previewRetained:true});
   expect(port.terminated).toBe(false);
  }finally{f.g.dispose();}
 });
 it('projects the author and nested Apply before a real Worker request without changing authored editor state',async()=>{
  const f=fixture();f.scene.implicitPaletteEditor={...implicitPaletteEditorState(f.scene),colorCount:19,manualColors:['#80112233']};
  const g=new Generator();try{
   const output=await g.generate(f.scene,f.context);
   const request=port.sent.find((entry):entry is Extract<GenerationRequest,{operation:'generate'}>=>entry.operation==='generate')!;
   expect(request.scene).not.toHaveProperty('implicitPaletteEditor');
   const apply=request.context.implicitControls!.commands[0];expect(apply.kind==='apply'&&apply.scene).not.toHaveProperty('implicitPaletteEditor');
   expect(f.scene.implicitPaletteEditor.colorCount).toBe(19);expect(rgba(output)).toEqual(color(17,34,51,128));
   const start=await g.beginSourceRecording(output,f.options);await g.finishSourceRecording(start.handle,1000);
  }finally{g.dispose();}
 });
 it('retains the completed hot preview after failed Apply, records cold, and accepts a fresh same-value hot continuation',async()=>{
  const f=await setup(),author={...f.scene,implicitSourcePalette:{colors:['#aabbcc']},settings:{...f.scene.settings,background:'#ff0000'}},context=hot(f.context,2);
  const output=await f.g.generate(author,context);expect(rgba(output)).toEqual(color(170,187,204));
  const bad=structuredClone(author);bad.equations.f='invalid(';const invalid:GenerationInput={...context,implicitControls:{sessionId:'client-palette',acknowledgedRevision:2,commands:[{kind:'apply',revision:3,scene:bad}]}};
  await expect(f.g.generate(bad,invalid)).rejects.toMatchObject({previewRetained:true});expect(port.terminated).toBe(false);
  const start=await f.g.beginSourceRecording(output,f.options);expect(start.scene).toEqual(sourcePaletteRuntimeScene(author));expect(start.warmup.implicitControls).toEqual({sessionId:'client-palette',revision:2,applyRevision:1,resetRevision:2});
  const stop=await f.g.finishSourceRecording(start.handle,1000);expect(stop.scene).toEqual(sourcePaletteRuntimeScene(author));expect(rgba(stop.preview)).toEqual(color(17,34,51,128));expect(stop.context.implicitControls).toEqual({sessionId:'client-palette',acknowledgedRevision:2,commands:[]});
  const next=await f.g.generate(author,{...hot(stop.context,3),implicitLive:{...stop.context.implicitLive!,clock:{paused:false,timestampMs:1125}}});expect(rgba(next)).toEqual(color(170,187,204));expect(next.implicitControls).toMatchObject({revision:3,applyRevision:1,resetRevision:2});f.g.dispose();
 });
 it('keeps Queue completed ownership after a rejected Apply while preserving the rejected author draft',async()=>{
  const f=fixture(),g=new Generator(),cb={busy:vi.fn(),error:vi.fn(),output:vi.fn(),recordingStopped:vi.fn(),implicitControlAcknowledged:vi.fn()},q=new GenerationQueue(g,cb);
  q.request(f.scene,f.context);await vi.waitFor(()=>expect(cb.output).toHaveBeenCalledTimes(1));
  const author={...f.scene,implicitSourcePalette:{colors:['#aabbcc']}};q.request(author,hot(f.context,2));await vi.waitFor(()=>expect(cb.output).toHaveBeenCalledTimes(2));const completed=cb.output.mock.calls.at(-1)![0];
  const rejected=structuredClone(author);rejected.equations.f='invalid(';q.request(rejected,{...f.context,implicitControls:{sessionId:'client-palette',acknowledgedRevision:2,commands:[{kind:'apply',revision:3,scene:rejected}]}});
  await vi.waitFor(()=>expect(cb.error).toHaveBeenCalledTimes(1));expect(cb.error.mock.calls[0][0]).toMatchObject({previewRetained:true});expect(port.terminated).toBe(false);
  let delivered=0;await q.recordSource(completed,f.options,{actualFrameRate:()=>12,frame:()=>{delivered++;},shouldStop:()=>delivered===1});
  expect(cb.recordingStopped).toHaveBeenCalledOnce();expect(cb.recordingStopped.mock.calls[0][0].scene).toBe(rejected);expect(cb.recordingStopped.mock.calls[0][0].preview.implicitControls).toMatchObject({revision:2,applyRevision:1,resetRevision:2});expect(cb.error).toHaveBeenCalledTimes(1);q.dispose();
 });
 it.each(['sessionId','revision','applyRevision','resetRevision','missing'] as const)('rejects forged completed receipt %s',async key=>{
  const f=await setup();corrupt=message=>{if(message.operation!=='generate'||'error'in message)return;const receipt=message.output.implicitControls!;if(key==='missing')delete message.output.implicitControls;else if(key==='sessionId')receipt.sessionId='foreign';else receipt[key]++;};
  await expect(f.g.generate(f.scene,hot(f.context,2))).rejects.toThrow('回执');expect(port.terminated).toBe(true);f.g.dispose();
 });
 it.each(['palette','restart'] as const)('hands a deferred %s to the same owner after canonical recording stop',async kind=>{
  const f=fixture(),g=new Generator(),cb={busy:vi.fn(),error:vi.fn(),output:vi.fn(),recordingStopped:vi.fn(),implicitControlAcknowledged:vi.fn()},q=new GenerationQueue(g,cb);
  q.request(f.scene,f.context);await vi.waitFor(()=>expect(cb.output).toHaveBeenCalledTimes(1));
  const author={...f.scene,implicitSourcePalette:{colors:['#aabbcc']}},context=hot(f.context,2);q.request(author,context);await vi.waitFor(()=>expect(cb.output).toHaveBeenCalledTimes(2));
  const edited={...author,name:'deferred author',implicitSourcePalette:{colors:['#123456']}},deferred:GenerationInput={...context,implicitControls:{sessionId:'client-palette',acknowledgedRevision:2,commands:[kind==='palette'?{kind,revision:3,colors:['#123456']}:{kind,revision:3}]}};
  let delivered=0;await q.recordSource(cb.output.mock.calls.at(-1)![0],f.options,{actualFrameRate:()=>12,start:()=>q.request(edited,deferred),frame:()=>{delivered++;},shouldStop:()=>delivered===1});
  await vi.waitFor(()=>expect(cb.output.mock.calls.at(-1)?.[0].implicitControls?.revision).toBe(3));
  const stop=cb.recordingStopped.mock.calls[0][0],last=cb.output.mock.calls.at(-1)!;expect(stop.scene).toBe(edited);expect(last[2]).toBe(edited);expect(stop.preview.implicitControls).toMatchObject({revision:2,resetRevision:2});expect(last[0].implicitControls).toMatchObject({revision:3,applyRevision:1,resetRevision:kind==='palette'?2:3});
  expect(rgba(last[0])).toEqual(kind==='palette'?color(18,52,86):color(17,34,51,128));expect(!!last[0].implicitLive).toBe(kind==='palette');expect(cb.error).not.toHaveBeenCalled();expect(cb.implicitControlAcknowledged.mock.calls.some(([,receipt])=>receipt.revision===2&&receipt.resetRevision===2)).toBe(true);q.dispose();
 });
 it('starts a new control session deferred during recording without adopting the old live handoff for the same author object',async()=>{
  const f=fixture(),g=new Generator(),cb={busy:vi.fn(),error:vi.fn(),output:vi.fn(),recordingStopped:vi.fn(),implicitControlAcknowledged:vi.fn()},q=new GenerationQueue(g,cb);
  q.request(f.scene,f.context);await vi.waitFor(()=>expect(cb.output).toHaveBeenCalledTimes(1));
  const next:GenerationInput={...f.context,implicitControls:{sessionId:'replacement-session',acknowledgedRevision:0,commands:[{kind:'apply',revision:1,scene:f.scene}]}};
  let delivered=0;await q.recordSource(cb.output.mock.calls[0][0],f.options,{actualFrameRate:()=>12,start:()=>q.request(f.scene,next),frame:()=>{delivered++;},shouldStop:()=>delivered===1});
  await vi.waitFor(()=>expect(port.sent.some(request=>request.operation==='generate'&&request.context.implicitControls?.sessionId==='replacement-session')).toBe(true));
  const replacement=port.sent.find((request):request is Extract<GenerationRequest,{operation:'generate'}>=>request.operation==='generate'&&request.context.implicitControls?.sessionId==='replacement-session')!;
  expect(replacement.context.implicitLive).toBeUndefined();
  await vi.waitFor(()=>expect(cb.output.mock.calls.at(-1)?.[0].implicitControls).toEqual({sessionId:'replacement-session',revision:1,applyRevision:1,resetRevision:1}));
  expect(cb.output.mock.calls.map(([output])=>output.implicitControls.sessionId)).toEqual(['client-palette','replacement-session']);expect(cb.output.mock.calls.at(-1)![2]).toBe(f.scene);expect(cb.recordingStopped).not.toHaveBeenCalled();expect(cb.error).not.toHaveBeenCalled();q.dispose();
 });
 it('acknowledges a completed stale request before filtering the next real Worker batch',async()=>{
  const f=fixture(),g=new Generator(),cb={busy:vi.fn(),error:vi.fn(),output:vi.fn(),implicitControlAcknowledged:vi.fn()},q=new GenerationQueue(g,cb);hold=true;
  q.request(f.scene,f.context);await vi.waitFor(()=>expect(held).toHaveLength(1));
  const edited:SceneDocument={...f.scene,name:'new author'},next:GenerationInput={...f.context,implicitControls:{sessionId:'client-palette',acknowledgedRevision:0,commands:[...f.context.implicitControls!.commands,{kind:'palette',revision:2,colors:['#abcdef']}]}};
  q.request(edited,next);hold=false;port.onmessage?.({data:held.shift()!});await vi.waitFor(()=>expect(cb.output).toHaveBeenCalledTimes(1));
  const requests=port.sent.filter((request):request is Extract<GenerationRequest,{operation:'generate'}>=>request.operation==='generate');expect(requests).toHaveLength(2);expect(requests[1].context.implicitControls).toEqual({sessionId:'client-palette',acknowledgedRevision:1,commands:[{kind:'palette',revision:2,colors:['#abcdef']}]});
  expect(cb.implicitControlAcknowledged.mock.calls.map(([,receipt])=>receipt.revision)).toEqual([1,2]);expect(cb.output.mock.calls[0][2]).toBe(edited);expect(rgba(cb.output.mock.calls[0][0])).toEqual(color(171,205,239));expect(cb.error).not.toHaveBeenCalled();q.dispose();
 });
});
