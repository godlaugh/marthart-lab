import {MAX_RASTER_PIXELS} from './rasterDimensions';
import {RootsPausedImageError} from './rootsPausedImage';

export type RootsPausedUpscale=3|5;
export interface RootsPausedUpscalePlan {
 readonly width:number;readonly height:number;
 readonly inputBytes:number;readonly outputBytes:number;readonly workspaceBytes:number;
 /** Borrowed input view + premultiplied scratch + result + shared lookup tables.
  * The caller separately budgets other backing buffers, renderer and encoder. */
 readonly peakBytes:number;
 readonly method:'openjdk21-software-bicubic';
}

const UNIT=4294967296,HALF=2147483648,BYTE_UNIT=16777216;
// OpenJDK21 default software TransformHelper: A=-.5, integer coefficients
// (8 fractional bits) corrected to a unit sum. This is a functional transcript,
// not an assumption about which platform override the bundled JVM selects.
const coefficients=new Int16Array(513),divisionSteps=new Uint32Array(256);
for(let i=0;i<256;i++){
 const x=i/256;
 coefficients[i]=Math.trunc((((1.5*x-2.5)*x*x)+1)*256);
}
for(let i=256;i<384;i++){
 const x=i/256;
 coefficients[i]=Math.trunc((((-.5*x+2.5)*x-4)*x+2)*256);
}
coefficients[384]=(256-coefficients[128]*2)/2;
for(let i=385;i<=512;i++)coefficients[i]=256-(coefficients[512-i]+coefficients[i-256]+coefficients[768-i]);
// AlphaMath.c DIV8 table, represented without allocating all 65536 entries.
for(let a=1;a<256;a++)divisionSteps[a]=Math.floor((255*BYTE_UNIT+Math.floor(a/2))/a);
const LOOKUP_BYTES=coefficients.byteLength+divisionSteps.byteLength;

/** Menu scales only. Scale1 uses the enhancement result directly: sending it
 * through a premultiplied transform would alter transparent/low-alpha RGB. */
export function prepareRootsPausedUpscale(width:number,height:number,scale:RootsPausedUpscale):RootsPausedUpscalePlan {
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1)
  throw new RootsPausedImageError('input','dimensions must be positive safe integers');
 if(scale!==3&&scale!==5)throw new RootsPausedImageError('input','bicubic upscale must be 3 or 5');
 const inputCount=width*height;
 if(!Number.isSafeInteger(inputCount)||inputCount>MAX_RASTER_PIXELS)
  throw new RootsPausedImageError('capacity','RGBA input exceeds the shared 128 MiB raster budget');
 // MathArt.upscaleImage i2f/fmul/Math.round(F), followed by a size-based
 // Graphics2D transform (target/source), not a second geometric render.
 const w=Math.floor(Math.fround(Math.fround(width)*scale)+.5);
 const h=Math.floor(Math.fround(Math.fround(height)*scale)+.5),outputCount=w*h;
 if(!Number.isSafeInteger(outputCount)||outputCount>MAX_RASTER_PIXELS)
  throw new RootsPausedImageError('capacity','upscaled RGBA output exceeds the shared 128 MiB raster budget');
 const inputBytes=inputCount*4,outputBytes=outputCount*4,workspaceBytes=inputBytes+32;
 return {width:w,height:h,inputBytes,outputBytes,workspaceBytes,
  peakBytes:inputBytes+outputBytes+workspaceBytes+LOOKUP_BYTES,method:'openjdk21-software-bicubic'};
}

const clamp=(value:number,maximum:number)=>Math.max(0,Math.min(maximum,value));
// AlphaMath.c MUL8 table recurrence collapsed to an exact integer expression.
const premultiply=(value:number,alpha:number)=>Math.floor((value*alpha*65793+8388608)/BYTE_UNIT);
const unpremultiply=(value:number,alpha:number)=>value>=alpha?255:Math.floor((8388608+value*divisionSteps[alpha])/BYTE_UNIT);
function checkCancelled(isCancelled?:()=>boolean):void {
 if(isCancelled?.())throw new DOMException('Roots paused image upscale cancelled','AbortError');
}

/** Explicit OpenJDK21 default *software* image pipeline, not Canvas smoothing
 * and not a claim of byte equality with the original JVM's platform route.
 * Top-down straight RGBA8 -> MUL8 premultiply -> fixed32.32 center sampling
 * -> clamped-edge4x4 integer bicubic -> premultiplied saturation -> SrcOver
 * onto a new transparent IntArgb destination (DIV8 unpremultiply).
 *
 * Source references: TransformHelper.c checkOverflow/main/BicubicInterp;
 * GraphicsPrimitiveMgr.h DblToLong; LoopMacros.h DEFINE_TRANSFORMHELPER_BC;
 * IntArgb.h CopyIntArgbToIntArgbPre; AlphaMath.c tables; AlphaMacros.h
 * DEFINE_SRCOVER_MASKBLIT(IntArgbPre,IntArgb,4ByteArgb). See retained audit.
 * Allocations are preflighted; input is never mutated/detached. */
export function upscaleRootsPausedImage(pixels:Uint8ClampedArray,width:number,height:number,scale:RootsPausedUpscale,isCancelled?:()=>boolean):Uint8ClampedArray {
 const plan=prepareRootsPausedUpscale(width,height,scale);
 if(!(pixels instanceof Uint8ClampedArray)||!(pixels.buffer instanceof ArrayBuffer)||pixels.length!==plan.inputBytes)
  throw new RootsPausedImageError('input','input must be a complete unshared RGBA8 image');
 try{new Uint8Array(pixels.buffer,0,0);}catch(cause){throw new RootsPausedImageError('input','input buffer is detached',{cause});}
 checkCancelled(isCancelled);
 let source:Uint8Array,result:Uint8ClampedArray,columns:Int32Array,rows:Int32Array;
 try{source=new Uint8Array(plan.inputBytes);result=new Uint8ClampedArray(plan.outputBytes);columns=new Int32Array(4);rows=new Int32Array(4);}
 catch(cause){throw new RootsPausedImageError('allocation','could not allocate bicubic image workspace',{cause});}
 for(let i=0;i<pixels.length;i+=4){
  if((i&16383)===0)checkCancelled(isCancelled);
  const alpha=pixels[i+3];source[i+3]=alpha;
  if(alpha)for(let c=0;c<3;c++)source[i+c]=alpha===255?pixels[i+c]:premultiply(pixels[i+c],alpha);
 }
 // A double scale is formed as target/source, then reciprocated by
 // AffineTransform.createInverse. Do not substitute source/target algebra.
 const ix=1/(plan.width/width),iy=1/(plan.height/height);
 const stepX=Math.trunc(ix*UNIT),stepY=Math.trunc(iy*UNIT);
 const startX=Math.trunc((.5*ix)*UNIT)-HALF,startY=Math.trunc((.5*iy)*UNIT)-HALF;
 const firstX=Math.floor(startX/UNIT),fractionX=startX-firstX*UNIT;
 let wholeY=Math.floor(startY/UNIT),fractionY=startY-wholeY*UNIT,at=0;
 for(let y=0;y<plan.height;y++){
  checkCancelled(isCancelled);
  const fy=Math.floor(fractionY/BYTE_UNIT);
  rows[0]=clamp(wholeY-1,height-1)*width*4;rows[1]=clamp(wholeY,height-1)*width*4;
  rows[2]=clamp(wholeY+1,height-1)*width*4;rows[3]=clamp(wholeY+2,height-1)*width*4;
  let wholeX=firstX,fraction=fractionX;
  for(let x=0;x<plan.width;x++,at+=4){
   if((x&1023)===0)checkCancelled(isCancelled);
   const fx=Math.floor(fraction/BYTE_UNIT);
   columns[0]=clamp(wholeX-1,width-1)*4;columns[1]=clamp(wholeX,width-1)*4;
   columns[2]=clamp(wholeX+1,width-1)*4;columns[3]=clamp(wholeX+2,width-1)*4;
   let a=32768,r=32768,g=32768,b=32768;
   for(let row=0;row<4;row++){
    const yc=coefficients[row===0?fy+256:row===1?fy:row===2?256-fy:512-fy];
    for(let column=0;column<4;column++){
     const xc=coefficients[column===0?fx+256:column===1?fx:column===2?256-fx:512-fx];
     const factor=yc*xc,index=rows[row]+columns[column];
     r+=source[index]*factor;g+=source[index+1]*factor;b+=source[index+2]*factor;a+=source[index+3]*factor;
    }
   }
   // Accumulators stay within signed32 for this unit-sum kernel/RGBA8 range.
   // C arithmetic shift is floor, including negative coefficient overshoot.
   a=clamp(Math.floor(a/65536),255);
   if(a){
    r=clamp(Math.floor(r/65536),a);g=clamp(Math.floor(g/65536),a);b=clamp(Math.floor(b/65536),a);
    result[at]=a===255?r:unpremultiply(r,a);result[at+1]=a===255?g:unpremultiply(g,a);
    result[at+2]=a===255?b:unpremultiply(b,a);result[at+3]=a;
   }
   fraction+=stepX;if(fraction>=UNIT){wholeX++;fraction-=UNIT;}
  }
  fractionY+=stepY;if(fractionY>=UNIT){wholeY++;fractionY-=UNIT;}
 }
 checkCancelled(isCancelled);
 return result;
}
