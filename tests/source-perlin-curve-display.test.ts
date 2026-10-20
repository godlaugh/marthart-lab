import {describe,it,expect} from 'vitest';
import fixture from './fixtures/source-perlin/curve-display.json';
import {sourcePerlinCurveRgba,sourcePerlinCurveCacheNeedsRebuild,sourcePerlinCurveStrokeBuffers,type SourcePerlinCurveDrawingData} from '../src/engine/sourcePerlinCurveDisplay';
import {prepareSourcePerlinCpuDisplay} from '../src/engine/sourcePerlinDisplay';

const display=prepareSourcePerlinCpuDisplay({width:320,height:200,sourceWidth:320,sourceHeight:200,sourcePixelDensity:1,target:'primary',lineWeight:2,dotSize:2});
const data:SourcePerlinCurveDrawingData={count:2,length:3,xs:new Float32Array([-20,0,20,30,40,50]),ys:new Float32Array([-10,10,-10,0,10,0]),colors:new Uint32Array([0x001234fe,0xffff8040])};

describe('Perlin curve display source scalar and primitive boundaries',()=>{
 it('records static instruction evidence, not native rendering',()=>{
  expect(fixture.provenance.nativeExecution).toBe(false);
  expect(fixture.provenance.kind).toBe('independent-static-instruction-transcription');
 });
 for(const c of fixture.colors)it(`matches RGB255 stroke: ${c.name}`,()=>{
  expect(sourcePerlinCurveRgba(c.input.packed,c.input.alpha)).toEqual(c.expected.rgba);
 });
 for(const [i,c] of fixture.thresholds.entries())it(`preserves strict float cache threshold ${i}`,()=>{
  expect(sourcePerlinCurveCacheNeedsRebuild({width:320,height:200,lineScale:c.input.cachedScale},320,200,c.input.newScale,false)).toBe(c.expected.rebuild);
 });
 it('keeps the last rebuilt scale checkpoint across subthreshold changes',()=>{
  // These scales come from the independent source-method lifecycle oracle.
  const sequence=fixture.sequences.find(s=>s.name==='small-changes-relative-to-last-rebuild');
  expect(sequence).toBeDefined();
  let cached:{width:number;height:number;lineScale:number}|undefined;
  for(const step of sequence!.steps){
   const event=step.event as {action:string;width:number;height:number;lineScale:number};
   if(event.action!=='draw')continue;
   const rebuild=sourcePerlinCurveCacheNeedsRebuild(cached,event.width,event.height,event.lineScale,false);
   expect(rebuild).toBe(step.expected.effects.some(effect=>effect==='rebuild-cache'));
   if(rebuild)cached={width:event.width,height:event.height,lineScale:event.lineScale};
   expect(cached).toEqual(step.expected.cache);
  }
 });
 it('invalidates on missing cache, dimensions or dirty state',()=>{
  const cached={width:320,height:200,lineScale:1};
  expect(sourcePerlinCurveCacheNeedsRebuild(undefined,320,200,1,false)).toBe(true);
  expect(sourcePerlinCurveCacheNeedsRebuild(cached,321,200,1,false)).toBe(true);
  expect(sourcePerlinCurveCacheNeedsRebuild(cached,320,201,1,false)).toBe(true);
  expect(sourcePerlinCurveCacheNeedsRebuild(cached,320,200,1,true)).toBe(true);
  expect(sourcePerlinCurveCacheNeedsRebuild(cached,320,200,1,false)).toBe(false);
 });
 it('assembles separate open polygons and per-curve colors without mutating source arrays',()=>{
  const before={xs:[...data.xs],ys:[...data.ys],colors:[...data.colors]};
  const buffers=sourcePerlinCurveStrokeBuffers(data,display,.37);
  expect(buffers.indices.length).toBeGreaterThan(0);
  const colors=new Set(Array.from({length:buffers.colors.length/4},(_,i)=>JSON.stringify([...buffers.colors.slice(i*4,i*4+4)])));
  expect(colors).toEqual(new Set([...data.colors].map(c=>JSON.stringify(sourcePerlinCurveRgba(c,.37)))));
  expect({xs:[...data.xs],ys:[...data.ys],colors:[...data.colors]}).toEqual(before);
  const two=sourcePerlinCurveStrokeBuffers({count:1,length:2,xs:new Float32Array([0,10]),ys:new Float32Array([0,10]),colors:new Uint32Array([0xffffffff])},display,1);
  expect(two.indices.length).toBe(0);
  expect(two.caches).toEqual([]);
 });
 it('rejects malformed snapshots and reports cancellation before conversion',()=>{
  for(const bad of [{...data,count:3},{...data,length:1},{...data,ys:new Float32Array(1)},{...data,colors:new Uint32Array(1)}]){
   expect(()=>sourcePerlinCurveStrokeBuffers(bad,display,1)).toThrow(expect.objectContaining({code:'input'}));
  }
  expect(()=>sourcePerlinCurveStrokeBuffers(data,display,1,()=>true)).toThrow(expect.objectContaining({code:'cancelled',name:'AbortError'}));
  for(const alpha of [NaN,Infinity,1e40])expect(()=>sourcePerlinCurveRgba(0xffffffff,alpha)).toThrow(expect.objectContaining({code:'input'}));
  for(const packed of [-1,1.5,0x100000000])expect(()=>sourcePerlinCurveRgba(packed,1)).toThrow(expect.objectContaining({code:'input'}));
 });
});
