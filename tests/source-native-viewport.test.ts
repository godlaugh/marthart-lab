import {describe,it,expect,vi,beforeEach} from 'vitest';
import {SourceNativeViewport,type NativeViewportRequest} from '../src/engine/sourceNativeViewport';
import type {SourceDrawingFrame} from '../src/engine/sourceDrawingFrame';
const state=vi.hoisted(()=>({calls:[] as {sequence:number;signal:AbortSignal;resolve:(v:any)=>void;reject:(e:Error)=>void}[],draws:[] as number[],disposed:0,failDispose:false,prepareError:false}));
vi.mock('../src/engine/sourceNativeClient',()=>({renderSourceNativeFrame:(frame:any,options:any)=>new Promise((resolve,reject)=>state.calls.push({sequence:frame.sequence,signal:options.signal,resolve,reject}))}));
vi.mock('../src/engine/sourceFormulaCompositor',()=>({prepareSourceFormulas:async(p:any)=>{if(state.prepareError)throw Error('glyph failed');return{presentation:p,glyphs:[]};},SourceFormulaCompositor:class{draw(_p:any,_w:number,_h:number,pixels:Uint8ClampedArray){state.draws.push(pixels[0]);}drawPixels(_w:number,_h:number,pixels:Uint8ClampedArray){state.draws.push(pixels[0]);}dispose(){if(state.failDispose){state.failDispose=false;throw Error('cleanup failed');}state.disposed++;}}}));
const pixels=(n:number)=>({width:1,height:1,pixels:new Uint8ClampedArray([n,0,0,255])});
function request():NativeViewportRequest {
 return{prepare:(generation,sequence)=>({frame:{generation,sequence} as SourceDrawingFrame,retainedBytes:0}),formulas:{layout:'source-surface-centered-v1',primaryLogicalHeight:1,labels:[]},current:()=>true,ready:vi.fn(),failed:vi.fn()};
}
const tick=()=>new Promise<void>(r=>setTimeout(r,0));
beforeEach(()=>Object.assign(state,{calls:[],draws:[],disposed:0,failDispose:false,prepareError:false}));
describe('native viewport latest-frame ownership',()=>{
 it('settles a cancelled native call before starting the latest pending request; discarded requests never allocate snapshots',async()=>{
  const owner=new SourceNativeViewport({} as HTMLCanvasElement),a=request(),discarded=request(),b=request();discarded.prepare=vi.fn(discarded.prepare);
  owner.submit(a);owner.submit(discarded);owner.submit(b);
  expect(state.calls).toHaveLength(1);expect(state.calls[0].signal.aborted).toBe(true);
  state.calls[0].resolve(pixels(1));await tick();expect(state.calls).toHaveLength(2);expect(discarded.prepare).not.toHaveBeenCalled();
  state.calls[1].resolve(pixels(2));await owner.settled();expect(state.draws).toEqual([2]);expect(a.ready).not.toHaveBeenCalled();expect(b.ready).toHaveBeenCalledOnce();owner.dispose();
 });
 it('rejects an obsolete output even if the transport ignores cancellation',async()=>{
  const owner=new SourceNativeViewport({} as HTMLCanvasElement),r=request();let current=true;r.current=()=>current;
  owner.submit(r);current=false;state.calls[0].resolve(pixels(3));await owner.settled();expect(state.draws).toEqual([]);expect(r.ready).not.toHaveBeenCalled();expect(r.failed).not.toHaveBeenCalled();owner.dispose();
 });
 it('reports real failures without drawing a fallback, then accepts an explicit replacement',async()=>{
  const owner=new SourceNativeViewport({} as HTMLCanvasElement),r=request();owner.submit(r);state.calls[0].reject(Error('native failed'));await owner.settled();expect(r.failed).toHaveBeenCalledOnce();expect(state.draws).toEqual([]);
  const next=request();owner.submit(next);state.calls[1].resolve(pixels(4));await owner.settled();expect(state.draws).toEqual([4]);owner.dispose();
 });
 it('waits for formulas and refuses a completed pixel frame if glyph preparation fails',async()=>{
  const owner=new SourceNativeViewport({} as HTMLCanvasElement),r=request();state.prepareError=true;owner.submit(r);state.calls[0].resolve(pixels(5));await owner.settled();expect(r.failed).toHaveBeenCalledOnce();expect(state.draws).toEqual([]);owner.dispose();
 });
 it('composes an already native recording raster without acquiring another transport slot',async()=>{
  const owner=new SourceNativeViewport({} as HTMLCanvasElement),r=request();r.prepare=()=>({pixels:pixels(6)});owner.submit(r);await owner.settled();expect(state.calls).toEqual([]);expect(state.draws).toEqual([6]);expect(r.ready).toHaveBeenCalledOnce();owner.dispose();
 });
 it('copies empty local layouts without inventing source formula placement',async()=>{
  const owner=new SourceNativeViewport({} as HTMLCanvasElement),r=request();r.formulas={referenceWidth:100,referenceHeight:100,labels:[]};r.prepare=()=>({pixels:pixels(9)});owner.submit(r);await owner.settled();expect(state.draws).toEqual([9]);expect(r.ready).toHaveBeenCalledOnce();owner.dispose();
 });
 it('cancels unmount work and retains a failed disposal until it can actually be retried',async()=>{
  const owner=new SourceNativeViewport({} as HTMLCanvasElement),r=request();r.prepare=()=>({pixels:pixels(7)});owner.submit(r);await owner.settled();
  const pending=request();owner.submit(pending);state.failDispose=true;expect(()=>owner.dispose()).toThrow('cleanup failed');expect(state.calls[0].signal.aborted).toBe(true);
  state.calls[0].resolve(pixels(8));await owner.settled();expect(state.draws).toEqual([7]);expect(()=>owner.submit(request())).toThrow('已释放');
  owner.dispose();expect(state.disposed).toBe(1);new SourceNativeViewport({} as HTMLCanvasElement).dispose();
 });
});
