import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {RealtimeRecorder,type RecordingFrame} from '../src/engine/realtimeRecorder';
import {parseProjectFile} from '../src/engine/legacyImport';
import type {FormulaPresentation} from '../src/types';
import type {PreparedSourceFormula} from '../src/engine/sourceFormulaCompositor';

// Exercise the recording owner with delayed glyph preparation and fake media
// boundaries. These assertions do not establish GL fidelity or video encoding.
const glyph=vi.hoisted(()=>({
 pending:[] as {signal:AbortSignal;resolve:()=>void}[],
 events:[] as string[],draws:[] as {latex:string;pixels:Uint8ClampedArray}[],disposed:0,
}));
vi.mock('../src/engine/sourceFormulaCompositor',()=>({
 formulaBasePixels:(canvas:{pixels:Uint8ClampedArray})=>{glyph.events.push('snapshot');return canvas.pixels.slice();},
 prepareSourceFormulas:(presentation:PreparedSourceFormula['presentation'],signal:AbortSignal)=>{
  glyph.events.push('prepare');return new Promise<PreparedSourceFormula>((resolve,reject)=>{
   const abort=()=>reject(new DOMException('Glyph request cancelled','AbortError'));
   signal.addEventListener('abort',abort,{once:true});
   glyph.pending.push({signal,resolve:()=>{signal.removeEventListener('abort',abort);resolve({presentation,glyphs:[]});}});
  });
 },
 SourceFormulaCompositor:class{
  pixels=new Uint8ClampedArray();
  draw(prepared:PreparedSourceFormula,_width:number,_height:number,pixels:Uint8ClampedArray){glyph.draws.push({latex:prepared.presentation.labels[0].latex,pixels:pixels.slice()});this.pixels=pixels.slice();}
  readPixels(){return this.pixels;}
  dispose(){glyph.disposed++;}
 },
}));
const media:{streams:FakeStream[];recorders:FakeRecorder[];raf:Map<number,FrameRequestCallback>;nextRaf:number;deferStop:boolean;pendingStops:(()=>void)[]}={streams:[],recorders:[],raf:new Map(),nextRaf:0,deferStop:false,pendingStops:[]};
class FakeStream{
 stopped=false;submitted:number[]=[];
 constructor(readonly canvas:FakeCanvas){}
 track={stop:()=>{this.stopped=true;},requestFrame:()=>{this.submitted.push(this.canvas.pixels[0]);}};
 getTracks(){return[this.track];}getVideoTracks(){return[this.track];}
}
class FakeCanvas{
 width=4;height=2;pixels=new Uint8ClampedArray(32).fill(11);
 context={
  clearRect:()=>{},
  drawImage:(source:FakeCanvas)=>{this.pixels=source.pixels.slice();},
  putImageData:(image:{data:Uint8ClampedArray})=>{this.pixels=image.data.slice();},
 };
 getContext(){return this.context;}
 captureStream(){const stream=new FakeStream(this);media.streams.push(stream);return stream;}
}
class FakeRecorder{
 static isTypeSupported(){return true;}
 state='inactive';mimeType:string;onstop:(()=>void)|null=null;ondataavailable:((event:{data:Blob})=>void)|null=null;onerror:(()=>void)|null=null;
 constructor(readonly stream:FakeStream,options:{mimeType:string}){this.mimeType=options.mimeType;media.recorders.push(this);}
 start(){this.state='recording';}
 stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['fake encoded bytes'])});if(media.deferStop)media.pendingStops.push(()=>this.onstop?.());else this.onstop?.();}
}
function setup(){
 const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SURFACE',name:'recording lifecycle',equations:{x:'u',y:'v',z:'0'},settings:{render_mode:'CPU',surface_mode:'POINTS',u_segments:2,v_segments:2},timeline:[{type:'wait',duration:1}]})).scene;
 const canvas=new FakeCanvas(),presentation=(latex:string):FormulaPresentation=>({layout:'source-surface-centered-v1',primaryLogicalHeight:2,labels:[{id:'main',visible:true,latex,color:'#ffffff',x:0,y:0,scale:.25,anchor:'center'}]});
 let frame:RecordingFrame={source:scene,scene,sceneTime:1,revision:1,canvas:canvas as unknown as HTMLCanvasElement,formulaPresentation:presentation('old')};
 return{canvas,getFrame:()=>frame,hideLabels:()=>{frame={...frame,formulaPresentation:{...presentation(''),labels:[]}};},advance:(revision:number,marker:number,latex='old')=>{canvas.pixels.fill(marker);frame={...frame,revision,sceneTime:revision,formulaPresentation:presentation(latex)};}};
}
async function flush(){for(let i=0;i<8;i++)await Promise.resolve();}
async function tick(now=100){const entry=media.raf.entries().next().value;if(!entry)throw Error('No scheduled recording frame');media.raf.delete(entry[0]);entry[1](now);await flush();}
function assertReleased(){
 expect(media.raf.size).toBe(0);expect(vi.getTimerCount()).toBe(0);
 for(const stream of media.streams)expect(stream.stopped).toBe(true);
 for(const recorder of media.recorders){expect(recorder.state).toBe('inactive');expect([recorder.onstop,recorder.ondataavailable,recorder.onerror]).toEqual([null,null,null]);}
}
beforeEach(()=>{
 glyph.pending=[];glyph.events=[];glyph.draws=[];glyph.disposed=0;media.streams=[];media.recorders=[];media.raf.clear();media.nextRaf=0;media.deferStop=false;media.pendingStops=[];
 vi.useFakeTimers();vi.spyOn(performance,'now').mockReturnValue(0);
 vi.stubGlobal('HTMLCanvasElement',FakeCanvas);vi.stubGlobal('MediaRecorder',FakeRecorder);
 vi.stubGlobal('document',{createElement:()=>new FakeCanvas()});
 vi.stubGlobal('ImageData',class{constructor(readonly data:Uint8ClampedArray,readonly width:number,readonly height:number){}});
 vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{const id=++media.nextRaf;media.raf.set(id,callback);return id;});
 vi.stubGlobal('cancelAnimationFrame',(id:number)=>media.raf.delete(id));
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('source formula realtime recording lifecycle',()=>{
 it('snapshots the initial raw image before awaiting glyphs and starts with its original revision',async()=>{
  const f=setup(),recorder=new RealtimeRecorder(),started=vi.fn();
  const result=recorder.record(f.getFrame,30,10,()=>{},started);const rejected=expect(result).rejects.toMatchObject({name:'AbortError'});
  expect(glyph.events).toEqual(['snapshot','prepare']);expect(media.streams).toHaveLength(0);
  f.advance(2,99,'new');glyph.pending[0].resolve();await flush();
  expect(glyph.draws).toHaveLength(1);expect(glyph.draws[0].latex).toBe('old');expect(glyph.draws[0].pixels[0]).toBe(11);
  expect(started.mock.calls[0][0]).toMatchObject({revision:1,sceneTime:1});expect(media.streams[0].canvas.pixels[0]).toBe(11);
  recorder.cancel();await rejected;expect(glyph.disposed).toBe(1);assertReleased();
 });
 it('keeps a delayed recording frame image, formula, time and revision together while playback advances',async()=>{
  const f=setup(),recorder=new RealtimeRecorder(),progress=vi.fn(),result=recorder.record(f.getFrame,30,10,progress);
  glyph.pending[0].resolve();await flush();f.advance(2,22,'second');await tick();
  expect(glyph.pending).toHaveLength(2);expect(media.streams[0].submitted).toEqual([]);
  f.advance(3,33,'third');glyph.pending[1].resolve();await flush();
  expect(glyph.draws[1].latex).toBe('second');expect(glyph.draws[1].pixels[0]).toBe(22);expect(media.streams[0].submitted).toEqual([22]);
  expect(progress.mock.calls[0].slice(1)).toEqual([1,2]);recorder.stop();
  expect(await result).toMatchObject({frames:1,frameVersions:2,sceneStart:1,sceneEnd:2,width:4,height:2});expect(glyph.disposed).toBe(2);assertReleased();
 });
 it.each([{width:2,height:4,name:'same-area width/height swap'},{width:8,height:2,name:'changed area'}])('rejects $name before submitting a resized frame',async({width,height})=>{
  const f=setup(),recorder=new RealtimeRecorder(),result=recorder.record(f.getFrame,30,10,()=>{}),rejected=expect(result).rejects.toThrow('画布尺寸已变化');
  glyph.pending[0].resolve();await flush();f.canvas.width=width;f.canvas.height=height;f.canvas.pixels=new Uint8ClampedArray(width*height*4).fill(66);await tick();
  await rejected;expect(media.streams[0].submitted).toEqual([]);expect(glyph.draws).toHaveLength(1);expect(glyph.pending).toHaveLength(1);assertReleased();
 });
 it('rejects a same-area width/height swap even when the source presentation has no visible labels',async()=>{
  const f=setup();f.hideLabels();const recorder=new RealtimeRecorder(),result=recorder.record(f.getFrame,30,10,()=>{}),rejected=expect(result).rejects.toThrow('画布尺寸已变化');
  await flush();f.canvas.width=2;f.canvas.height=4;await tick();
  await rejected;expect(media.streams[0].submitted).toEqual([]);expect(glyph.pending).toHaveLength(0);expect(glyph.draws).toHaveLength(0);assertReleased();
 });
 it('finishes the last complete frame when stop aborts a later glyph wait before asynchronous encoder onstop',async()=>{
  const f=setup(),recorder=new RealtimeRecorder(),result=recorder.record(f.getFrame,30,10,()=>{});
  glyph.pending[0].resolve();await flush();f.advance(2,22);await tick();
  expect(media.streams[0].submitted).toEqual([22]);
  f.advance(3,33,'pending formula');await tick(200);expect(glyph.pending).toHaveLength(2);
  media.deferStop=true;recorder.stop();await flush();
  // Browser stop queues onstop. The glyph rejection reaches the recording
  // tick first, but normal stop must preserve the already completed segment.
  expect(glyph.pending[1].signal.aborted).toBe(true);expect(media.pendingStops).toHaveLength(1);
  expect(media.streams[0].submitted).toEqual([22]);expect(glyph.draws).toHaveLength(2);
  media.pendingStops.shift()!();
  const completed=await result;expect(completed).toMatchObject({frames:1,frameVersions:2,sceneStart:1,sceneEnd:2,width:4,height:2});
  expect(completed.blob.size).toBeGreaterThan(0);expect(glyph.disposed).toBe(1);assertReleased();
 });
 it('records raw source RGB with opaque video alpha even when labels are disabled',async()=>{
  const f=setup();f.hideLabels();for(let i=0;i<f.canvas.pixels.length;i+=4)f.canvas.pixels.set([11,22,33,0],i);
  const recorder=new RealtimeRecorder(),result=recorder.record(f.getFrame,30,10,()=>{}),rejected=expect(result).rejects.toMatchObject({name:'AbortError'});
  await flush();expect([...media.streams[0].canvas.pixels.slice(0,4)]).toEqual([11,22,33,255]);expect(glyph.pending).toHaveLength(0);
  expect([...f.canvas.pixels.slice(0,4)]).toEqual([11,22,33,0]);recorder.cancel();await rejected;assertReleased();
 });
 it('aborts initial glyph preparation without ever creating a stream or MediaRecorder',async()=>{
  const f=setup(),recorder=new RealtimeRecorder(),result=recorder.record(f.getFrame,30,10,()=>{}),rejected=expect(result).rejects.toMatchObject({name:'AbortError'});
  recorder.cancel();await rejected;expect(glyph.pending[0].signal.aborted).toBe(true);expect(media.streams).toHaveLength(0);expect(media.recorders).toHaveLength(0);expect(glyph.draws).toHaveLength(0);assertReleased();
 });
 it('aborts a later glyph wait and releases the existing stream and encoder without a partial frame',async()=>{
  const f=setup(),recorder=new RealtimeRecorder(),result=recorder.record(f.getFrame,30,10,()=>{}),rejected=expect(result).rejects.toMatchObject({name:'AbortError'});
  glyph.pending[0].resolve();await flush();f.advance(2,22,'uncached');await tick();expect(glyph.pending).toHaveLength(2);
  recorder.cancel();await rejected;await flush();expect(glyph.pending[1].signal.aborted).toBe(true);expect(media.streams[0].submitted).toEqual([]);expect(glyph.draws).toHaveLength(1);expect(glyph.disposed).toBe(1);assertReleased();
 });
});
