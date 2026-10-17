import {describe,it,expect} from 'vitest';
import {inflateSync} from 'node:zlib';
import {encodeRgbaPng} from '../src/engine/rgbaPng';

// Independent PNG container/CRC decoder. No Canvas or encoder helper is used.
async function decode(blob:Blob){
 const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),idat:number[]=[];
 expect([...bytes.slice(0,8)]).toEqual([137,80,78,71,13,10,26,10]);let width=0,height=0,ended=false;
 for(let at=8;at<bytes.length;){
  const length=view.getUint32(at),type=String.fromCharCode(...bytes.slice(at+4,at+8)),data=bytes.slice(at+8,at+8+length);
  let crc=-1;for(const value of bytes.slice(at+4,at+8+length)){crc^=value;for(let bit=0;bit<8;bit++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}
  expect((crc^-1)>>>0).toBe(view.getUint32(at+8+length));
  if(type==='IHDR'){const h=new DataView(data.buffer);width=h.getUint32(0);height=h.getUint32(4);expect([...data.slice(8)]).toEqual([8,6,0,0,0]);}
  else if(type==='IDAT')idat.push(...data);else if(type==='IEND'){expect(length).toBe(0);ended=true;}
  else throw new Error('Unexpected PNG chunk');at+=length+12;
 }
 expect(ended).toBe(true);const raw=inflateSync(new Uint8Array(idat)),pixels=new Uint8Array(width*height*4);
 expect(raw.length).toBe((width*4+1)*height);
 for(let row=0;row<height;row++){expect(raw[row*(width*4+1)]).toBe(0);pixels.set(raw.subarray(row*(width*4+1)+1,(row+1)*(width*4+1)),row*width*4);}
 return{width,height,pixels};
}
describe('straight RGBA PNG delivery',()=>{
 it('preserves hidden RGB and every low-alpha byte without a Canvas conversion',async()=>{
  const input=new Uint8ClampedArray([213,7,91,0,17,99,241,1,5,87,209,127,255,66,33,254,44,55,66,255,1,2,3,2]);
  const before=input.slice(),blob=await encodeRgbaPng(input,3,2),result=await decode(blob);
  expect(blob.type).toBe('image/png');expect([result.width,result.height]).toEqual([3,2]);expect([...result.pixels]).toEqual([...input]);expect(input).toEqual(before);
 });
 it('streams multiple rows and IDAT chunks into one valid zlib image',async()=>{
  const input=new Uint8ClampedArray(129*79*4);let seed=9;for(let i=0;i<input.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;input[i]=seed>>>24;}
  expect((await decode(await encodeRgbaPng(input,129,79))).pixels).toEqual(new Uint8Array(input));
 });
 it('rejects invalid dimensions and incomplete input before encoding',async()=>{
  await expect(encodeRgbaPng(new Uint8ClampedArray(4),0,1)).rejects.toThrow('dimensions');
  await expect(encodeRgbaPng(new Uint8ClampedArray(3),1,1)).rejects.toThrow('complete');
  await expect(encodeRgbaPng(new Uint8ClampedArray(),Number.MAX_SAFE_INTEGER,2)).rejects.toThrow('dimensions');
 });
 it('honors cancellation before work and during streamed encoding without changing its input',async()=>{
  const input=new Uint8ClampedArray(4*32*32).fill(37),before=input.slice();let checks=0;
  await expect(encodeRgbaPng(input,32,32,()=>true)).rejects.toMatchObject({name:'AbortError'});
  await expect(encodeRgbaPng(input,32,32,()=>++checks>4)).rejects.toMatchObject({name:'AbortError'});
  expect(checks).toBeGreaterThan(4);expect(input).toEqual(before);
 });
});
