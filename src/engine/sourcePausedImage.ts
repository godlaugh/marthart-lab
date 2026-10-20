import {MAX_RASTER_PIXELS} from './rasterDimensions';

export class SourcePausedImageError extends Error {
 constructor(readonly kind:'input'|'capacity'|'allocation',reason:string,options?:ErrorOptions){
  super(`Source paused image: ${reason}`,options);this.name='SourcePausedImageError';
 }
}

function pixelCount(width:number,height:number):number {
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1)
  throw new SourcePausedImageError('input','dimensions must be positive safe integers');
 const count=width*height;
 // Reuse the public raster result budget, not an invented native format limit.
 if(!Number.isSafeInteger(count)||count>MAX_RASTER_PIXELS)
  throw new SourcePausedImageError('capacity','RGBA output exceeds the shared 128 MiB raster budget');
 return count;
}

/** Borrowed RGBA view + owned RGBA result + one reusable byte-luma workspace.
 * Other retained backing storage, renderer targets and PNG encoding are the
 * caller's budget. No Gaussian image or second RGBA result is allocated. */
export function sourcePausedImageBytes(width:number,height:number):number {
 return pixelCount(width,height)*9;
}

const F=Math.fround,AA_STRENGTH=F(.30),SHARPEN_STRENGTH=F(.42);
const clamp8=(value:number)=>Math.max(0,Math.min(255,value));
// Java Math.round(float), including negative half values. Its inputs here are
// finite and small; Java saturation/NaN rules cannot be reached from RGBA8.
const roundFloat=(value:number)=>Math.floor(value+.5);
function fillLuma(pixels:Uint8ClampedArray,luma:Uint8Array):void {
 for(let i=0,p=0;p<luma.length;p++,i+=4)luma[p]=(54*pixels[i]+183*pixels[i+1]+19*pixels[i+2])>>8;
}

/** Shared MathArt image postprocessing; independent of scene type/backend.
 * MathArt 1.7.8 savePausedFrameInternal always calls buildEnhancedImage with
 * scale=1 before its separate optional Java2D bicubic upscale. This implements
 * that base enhancement: edge AA, then Gaussian-luma sharpening. Input/output
 * are top-down RGBA8. Alpha is preserved, not forced opaque or premultiplied.
 *
 * Source: MathArt.applyEdgeAwareAa @126–631, buildGaussianBlurLuma @0–299,
 * buildEnhancedImage @59–325. Float operations retain the bytecode stages.
 * The original's full int[] luma/blur temporaries are unnecessary: luma fits a
 * byte, and sharpening only reads immutable luma, so it can write RGBA in place.
 * Never mutates or detaches input; returned storage is independently owned. */
export function enhanceSourcePausedImage(pixels:Uint8ClampedArray,width:number,height:number):Uint8ClampedArray {
 const count=pixelCount(width,height);
 if(!(pixels instanceof Uint8ClampedArray)||!(pixels.buffer instanceof ArrayBuffer)||pixels.length!==count*4)
  throw new SourcePausedImageError('input','input must be a complete unshared RGBA8 image');
 try{new Uint8Array(pixels.buffer,0,0);}catch(cause){throw new SourcePausedImageError('input','input buffer is detached',{cause});}
 let output:Uint8ClampedArray,luma:Uint8Array;
 try{output=new Uint8ClampedArray(pixels);luma=new Uint8Array(count);}
 catch(cause){throw new SourcePausedImageError('allocation','could not allocate RGBA output and luma workspace',{cause});}
 fillLuma(pixels,luma);
 for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
  const p=y*width+x,left=p-1,right=p+1,up=p-width,down=p+width;
  const edge=Math.abs(luma[left]-luma[right])+Math.abs(luma[up]-luma[down]);
  if(edge<=20)continue;
  const weight=F(Math.max(0,Math.min(1,F(F(edge-20)/F(100))))*AA_STRENGTH);
  for(let c=0;c<3;c++){
   const mean=(pixels[left*4+c]+pixels[right*4+c]+pixels[up*4+c]+pixels[down*4+c])>>2;
   output[p*4+c]=clamp8(roundFloat(F(F(pixels[p*4+c]*F(1-weight))+F(mean*weight))));
  }
 }
 // Reuse storage only after AA finishes reading the original luma.
 fillLuma(output,luma);
 for(let y=0;y<height;y++){
  const top=Math.max(0,y-1)*width,middle=y*width,bottom=Math.min(height-1,y+1)*width;
  for(let x=0;x<width;x++){
   const p=middle+x,at=p*4;
   if(output[at+3]===0)continue;
   const left=Math.max(0,x-1),right=Math.min(width-1,x+1);
   const blurred=(luma[top+left]+2*luma[top+x]+luma[top+right]
    +2*luma[middle+left]+4*luma[p]+2*luma[middle+right]
    +luma[bottom+left]+2*luma[bottom+x]+luma[bottom+right])>>4;
   const delta=luma[p]-blurred;
   if(Math.abs(delta)<2)continue;
   const shift=roundFloat(F(F(delta)*SHARPEN_STRENGTH));
   for(let c=0;c<3;c++)output[at+c]=clamp8(output[at+c]+shift);
  }
 }
 return output;
}
