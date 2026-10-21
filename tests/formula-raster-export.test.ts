import {afterEach,describe,expect,it,vi} from 'vitest';
import {inflateSync} from 'node:zlib';
import type {FormulaPresentation,RasterOutput} from '../src/types';
import {compositeFormulas,encodeFormulaRaster} from '../src/engine/formulaCanvas';

const glyph=vi.hoisted(()=>({width:20,height:10,source:'<svg/>'}));
vi.mock('../src/engine/formulaSvg',()=>({renderFormulaSvg:()=>glyph}));
const presentation:FormulaPresentation={referenceWidth:1280,referenceHeight:720,labels:[{id:'main-equation',latex:'x',visible:true,x:20,y:40,scale:1,color:'#ffffff'}]};
function raster(labels=presentation):RasterOutput{return{type:'raster',width:2,height:1,pixels:new Uint8ClampedArray([213,7,91,0,17,99,241,1]),backend:'cpu',warnings:[],formulaPresentation:labels} as RasterOutput;}
function browser(decode:()=>Promise<void>=()=>Promise.resolve(),serialize=true){
 const drawImage=vi.fn(),putImageData=vi.fn(),context={drawImage,putImageData};
 const canvas={width:0,height:0,getContext:()=>context,toBlob:(cb:(blob:Blob|null)=>void)=>cb(serialize?new Blob(['encoded'],{type:'image/png'}):null)};
 const createElement=vi.fn(()=>canvas),images:{src:string}[]=[];
 vi.stubGlobal('document',{createElement});
 vi.stubGlobal('Image',class{src='';constructor(){images.push(this);}decode=decode;});
 vi.stubGlobal('ImageData',class{constructor(public data:Uint8ClampedArray,public width:number,public height:number){}});
 const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:owned-glyph'),revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 return{canvas,drawImage,putImageData,createElement,images,create,revoke};
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();glyph.width=20;glyph.height=10;});
describe('resolved formula raster export resource boundaries',()=>{
 it('keeps every unlabelled low-alpha byte without using Canvas or modifying the frame',async()=>{
  vi.stubGlobal('document',{createElement:()=>{throw new Error('Canvas must not be used');}});
  const frame=raster({...presentation,labels:[]}),before=frame.pixels.slice(),png=new Uint8Array(await(await encodeFormulaRaster(frame)).arrayBuffer()),view=new DataView(png.buffer),chunks:Uint8Array[]=[];
  for(let at=8;at<png.length;){const size=view.getUint32(at);if(String.fromCharCode(...png.slice(at+4,at+8))==='IDAT')chunks.push(png.slice(at+8,at+8+size));at+=12+size;}
  const decoded=inflateSync(Buffer.concat(chunks));expect([...decoded]).toEqual([0,...before]);expect(frame.pixels).toEqual(before);
 });
 it('rejects missing producer facts without making up labels',async()=>{
  const frame=raster();delete frame.formulaPresentation;
  await expect(encodeFormulaRaster(frame)).rejects.toThrow('公式标注');
 });
 it('aborts a pending glyph decode, revokes its URL, clears owned canvas and never mutates RGBA',async()=>{
  let began!:()=>void;const pending=new Promise<void>(resolve=>began=resolve),b=browser(()=>{began();return new Promise(()=>{});}),abort=new AbortController(),frame=raster(),before=frame.pixels.slice();
  const exportPromise=encodeFormulaRaster(frame,'image/png',{signal:abort.signal});
  await pending;abort.abort();
  await expect(exportPromise).rejects.toMatchObject({name:'AbortError'});
  expect(b.revoke).toHaveBeenCalledExactlyOnceWith('blob:owned-glyph');expect(b.images[0].src).toBe('');expect([b.canvas.width,b.canvas.height]).toEqual([0,0]);expect(b.drawImage).not.toHaveBeenCalled();expect(frame.pixels).toEqual(before);
 });
 it('releases both decode failure and serialization failure resources',async()=>{
  const b=browser(()=>Promise.reject(new Error('decode failed')));
  await expect(encodeFormulaRaster(raster())).rejects.toThrow('decode failed');expect(b.revoke).toHaveBeenCalledOnce();expect(b.canvas.width).toBe(0);
  vi.restoreAllMocks();const c=browser(undefined,false);
  await expect(encodeFormulaRaster(raster())).rejects.toThrow('导出失败');expect(c.revoke).toHaveBeenCalledOnce();expect(c.canvas.width).toBe(0);
 });
 it('bounds decoded glyphs before allocating their URL and rejects incomplete input before Canvas',async()=>{
  const b=browser();glyph.width=16_000_001;glyph.height=1;
  await expect(encodeFormulaRaster(raster())).rejects.toThrow('预算');expect(b.create).not.toHaveBeenCalled();expect(b.canvas.width).toBe(0);
  b.createElement.mockClear();const frame=raster();frame.pixels=new Uint8ClampedArray(3);
  await expect(encodeFormulaRaster(frame)).rejects.toThrow('RGBA');expect(b.createElement).not.toHaveBeenCalled();
 });
 it('returns an unannotated source canvas untouched and releases only its own failed copy',async()=>{
  const b=browser(()=>Promise.reject(new Error('glyph failure'))),source={width:80,height:40} as HTMLCanvasElement;
  expect(await compositeFormulas(source,{...presentation,labels:[]})).toBe(source);expect(b.createElement).not.toHaveBeenCalled();
  await expect(compositeFormulas(source,presentation)).rejects.toThrow('glyph failure');expect([source.width,source.height]).toEqual([80,40]);expect(b.canvas.width).toBe(0);
 });
});
