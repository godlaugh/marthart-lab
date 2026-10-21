import {MAX_RASTER_PIXELS} from './rasterDimensions';

const signature=new Uint8Array([137,80,78,71,13,10,26,10]);
// Local retained byte-storage bound: up to one maximum raster input and three
// raster-sized encoding representations. Compressor/browser native workspaces
// and the preview Worker are separate; this is not a process heap/RSS limit.
export const MAX_RGBA_PNG_STORAGE_BYTES=MAX_RASTER_PIXELS*4*4;
const crcTable=Uint32Array.from({length:256},(_,value)=>{
 let crc=value;for(let bit=0;bit<8;bit++)crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1;return crc>>>0;
});
function chunk(type:'IHDR'|'IDAT'|'IEND',data:Uint8Array):Uint8Array<ArrayBuffer>{
 const bytes=new Uint8Array(data.length+12),view=new DataView(bytes.buffer);view.setUint32(0,data.length);
 for(let i=0;i<4;i++)bytes[i+4]=type.charCodeAt(i);bytes.set(data,8);
 let crc=0xffffffff;for(let i=4;i<bytes.length-4;i++)crc=crcTable[(crc^bytes[i])&255]^(crc>>>8);
 view.setUint32(bytes.length-4,(crc^0xffffffff)>>>0);return bytes;
}

/** Encode straight RGBA8 without Canvas color conversion. Hidden RGB at A=0
 * and low-alpha channel bytes are retained. Scanlines stream through deflate;
 * each compressor output becomes an IDAT chunk, avoiding a second full-image
 * scanline buffer or concatenated compressed image. The Blob owns its bytes.
 * This is lossless PNG pixel equivalence, not ImageIO encoded-byte identity. */
export async function encodeRgbaPng(pixels:Uint8ClampedArray,width:number,height:number,isCancelled?:()=>boolean,options?:{alpha:'preserve'|'opaque'}):Promise<Blob>{
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||!Number.isSafeInteger(width*height)||width*height>MAX_RASTER_PIXELS)
  throw new Error('PNG dimensions exceed the shared RGBA raster budget');
 if(!(pixels instanceof Uint8ClampedArray)||!(pixels.buffer instanceof ArrayBuffer)||pixels.length!==width*height*4)
  throw new Error('PNG input must be a complete unshared RGBA8 image');
 const check=()=>{if(isCancelled?.())throw new DOMException('PNG encoding cancelled','AbortError');};
 check();
 const header=new Uint8Array(13),view=new DataView(header.buffer);view.setUint32(0,width);view.setUint32(4,height);header[8]=8;header[9]=6;
 const parts:BlobPart[]=[signature,chunk('IHDR',header)];let row=0,partBytes=signature.length+25;
 const admit=(nextPartBytes:number,temporaryBytes=0)=>{
  // Include the final Blob copy while parts are still reachable, and two
  // scanlines (one queued, one consumed). Count full retained backing storage.
  if(pixels.buffer.byteLength+2*nextPartBytes+2*(width*4+1)+crcTable.byteLength+temporaryBytes>MAX_RGBA_PNG_STORAGE_BYTES)
   throw new Error('PNG encoding exceeds the 512 MiB retained byte-storage budget');
 };
 admit(partBytes);
 const source=new ReadableStream<Uint8Array<ArrayBuffer>>({pull(controller){
  check();if(row===height){controller.close();return;}
  const scanline=new Uint8Array(width*4+1); // PNG filter 0: exact input bytes.
  scanline.set(pixels.subarray(row*width*4,(row+1)*width*4),1);
  // Video may consume framebuffer RGB without its recorded blending alpha.
  // Change only the already-owned row; do not allocate a second full raster.
  if(options?.alpha==='opaque')for(let i=4;i<scanline.length;i+=4)scanline[i]=255;
  row++;controller.enqueue(scanline);
 }});
 const reader=source.pipeThrough(new CompressionStream('deflate')).getReader();
 try{
  for(;;){check();const value=await reader.read();check();if(value.done)break;const nextBytes=partBytes+value.value.byteLength+12;admit(nextBytes,value.value.buffer.byteLength);parts.push(chunk('IDAT',value.value));partBytes=nextBytes;}
  admit(partBytes+12);parts.push(chunk('IEND',new Uint8Array()));check();return new Blob(parts,{type:'image/png'});
 }catch(error){
  try{await reader.cancel(error);}catch{/* Preserve the original encoding/cancellation failure. */}
  throw error;
 }finally{reader.releaseLock();}
}
