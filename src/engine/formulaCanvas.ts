import type {FormulaPresentation,RasterOutput} from '../types';
import {formulaPlacement} from './formulas';
import {encodeRgbaPng} from './rgbaPng';
import {MAX_RASTER_PIXELS} from './rasterDimensions';
export interface FormulaCompositeOptions {signal?:AbortSignal;isCancelled?:()=>boolean;}
function check(options?:FormulaCompositeOptions){if(options?.signal?.aborted||options?.isCancelled?.())throw new DOMException('公式合成已取消','AbortError');}
/** Only resolved frame facts enter the compositor. No scene replay, label
 * parsing or author-document fallback is allowed here. */
async function drawFormulas(canvas:HTMLCanvasElement,presentation:FormulaPresentation,options?:FormulaCompositeOptions){
  check(options);if(!presentation.labels.length)return;
  const {renderFormulaSvg}=await import('./formulaSvg');
  check(options);const context=canvas.getContext('2d');if(!context)throw new Error('无法创建公式合成画布');
  for(const label of presentation.labels){
    check(options);const rendered=renderFormulaSvg(label.latex,label.color);
    // Decode only one glyph image at a time, using the same intrinsic image
    // budget as the existing realtime recorder, before allocating its URL.
    if(Math.ceil(rendered.width)*Math.ceil(rendered.height)>16_000_000)throw new Error('公式图像超出合成预算');
    const url=URL.createObjectURL(new Blob([rendered.source],{type:'image/svg+xml'})),image=new Image();
    let stop:(()=>void)|undefined;
    try{
      check(options);image.src=url;
      await new Promise<void>((resolve,reject)=>{
        stop=()=>reject(new DOMException('公式合成已取消','AbortError'));
        options?.signal?.addEventListener('abort',stop,{once:true});
        image.decode().then(resolve,reject);
        if(options?.signal?.aborted)stop();
      });
      check(options);const p=formulaPlacement(presentation,label,canvas.width,canvas.height,rendered);
      context.drawImage(image,p.x,p.y,rendered.width*p.scale,rendered.height*p.scale);
    }finally{if(stop)options?.signal?.removeEventListener('abort',stop);image.src='';URL.revokeObjectURL(url);}
  }
  check(options);
}
export async function compositeFormulas(source:HTMLCanvasElement,presentation:FormulaPresentation,options?:FormulaCompositeOptions):Promise<HTMLCanvasElement>{
  check(options);if(!presentation.labels.length)return source;
  const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
  try{
    const context=canvas.getContext('2d');if(!context)throw new Error('无法创建公式合成画布');
    context.drawImage(source,0,0);await drawFormulas(canvas,presentation,options);
  }catch(error){canvas.width=canvas.height=0;throw error;}
  return canvas;
}
/** Source raster export keeps the existing exact-byte PNG route when labels
 * are empty. Labelled output uses the same Canvas/SVG composition as preview
 * annotations, at the final requested image size (after paused upscaling) or
 * the recording input size (before FFmpeg downscaling). */
export async function encodeFormulaRaster(output:RasterOutput,type:'image/png'|'image/jpeg'='image/png',options?:FormulaCompositeOptions):Promise<Blob>{
  check(options);const {pixels,width,height,formulaPresentation:presentation}=output;
  if(!presentation)throw new Error('源图像缺少实际帧的公式标注');
  if(!presentation.labels.length&&type==='image/png')return encodeRgbaPng(pixels,width,height,()=>!!options?.signal?.aborted||!!options?.isCancelled?.());
  const bytes=width*height*4;
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||!Number.isSafeInteger(bytes)||bytes>MAX_RASTER_PIXELS*4||!(pixels instanceof Uint8ClampedArray)||!(pixels.buffer instanceof ArrayBuffer)||pixels.length!==bytes)throw new Error('公式合成需要完整且有界的 RGBA 图像');
  // Borrowed RGBA backing + canvas + serialization/readback raster + maximum
  // one decoded formula. Browser/GPU implementation workspace is separate.
  if(pixels.buffer.byteLength+bytes*2+16_000_000*4>768*1024**2)throw new Error('公式合成超过 768 MiB 工作预算');
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  try{
    const context=canvas.getContext('2d');if(!context)throw new Error('无法创建公式合成画布');
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer,pixels.byteOffset,pixels.length),width,height),0,0);
    await drawFormulas(canvas,presentation,options);check(options);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('公式图像导出失败')),type,.95));
    check(options);return blob;
  }finally{canvas.width=canvas.height=0;}
}
