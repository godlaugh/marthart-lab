import type {FormulaPresentation,RasterOutput} from '../types';
import {formulaPlacement} from './formulas';
import {encodeRgbaPng} from './rgbaPng';
import {MAX_RASTER_PIXELS} from './rasterDimensions';
import {encodeSourcePausedPng} from './sourcePausedPng';
import {prepareSourcePausedPng} from './sourcePausedPngContract';
import {compositeSourceFormulaPixels,formulaBasePixels} from './sourceFormulaCompositor';
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
  const {width,height}=source,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  try{
    const context=canvas.getContext('2d');if(!context)throw new Error('无法创建公式合成画布');
    if(presentation.layout==='source-surface-centered-v1'){
      const pixels=await compositeSourceFormulaPixels(formulaBasePixels(source),width,height,presentation,options?.signal);check(options);
      context.putImageData(new ImageData(pixels,width,height),0,0);
    }else{context.drawImage(source,0,0);await drawFormulas(canvas,presentation,options);}
  }catch(error){canvas.width=canvas.height=0;throw error;}
  return canvas;
}
/** Fresh frames retain exact-byte PNG when unlabelled. Current-frame PNG
 * composes at base size, then enhances and enlarges the entire image in a
 * separate worker. No scene replay or numerical-clock update occurs here. */
export async function encodeFormulaRaster(output:RasterOutput,type:'image/png'|'image/jpeg'='image/png',options?:FormulaCompositeOptions):Promise<Blob>{
  check(options);const {pixels,width,height,formulaPresentation:presentation}=output;
  if(!presentation)throw new Error('源图像缺少实际帧的公式标注');
  const current=output.sourceCurrentImage;
  if(current&&(current.model!=='local-current-numerical-snapshot'||current.stage!=='base-before-formulas'||current.baseSize?.[0]!==width||current.baseSize?.[1]!==height||'resampling' in current||type!=='image/png'))throw new Error('当前帧 PNG 缺少未合成的基础图像');
  if(!current&&!presentation.labels.length&&type==='image/png')return encodeRgbaPng(pixels,width,height,()=>!!options?.signal?.aborted||!!options?.isCancelled?.());
  const bytes=width*height*4;
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||!Number.isSafeInteger(bytes)||bytes>MAX_RASTER_PIXELS*4||!(pixels instanceof Uint8ClampedArray)||!(pixels.buffer instanceof ArrayBuffer)||pixels.length!==bytes)throw new Error('公式合成需要完整且有界的 RGBA 图像');
  // Include both the caller's base frame and the composed readback retained
  // while the separate worker borrows it. Admit before allocating a Canvas.
  if(current){
    prepareSourcePausedPng(width,height,current.scale,pixels.buffer.byteLength+(presentation.labels.length?bytes:0));
    if(!presentation.labels.length)return encodeSourcePausedPng(pixels,width,height,current.scale,options);
  }
  // Borrowed RGBA backing + canvas + serialization/readback raster + maximum
  // one decoded formula. Browser/GPU implementation workspace is separate.
  if(pixels.buffer.byteLength+bytes*2+16_000_000*4>768*1024**2)throw new Error('公式合成超过 768 MiB 工作预算');
  if(presentation.layout==='source-surface-centered-v1'&&presentation.labels.length){
    const composed=await compositeSourceFormulaPixels(pixels,width,height,presentation,options?.signal);check(options);
    if(current)return encodeSourcePausedPng(composed,width,height,current.scale,options);
    if(type==='image/png')return encodeRgbaPng(composed,width,height,()=>!!options?.signal?.aborted||!!options?.isCancelled?.());
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    try{const context=canvas.getContext('2d');if(!context)throw new Error('无法创建公式合成画布');context.putImageData(new ImageData(composed,width,height),0,0);
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('公式图像导出失败')),type,.95));check(options);return blob;
    }finally{canvas.width=canvas.height=0;}
  }
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  let composed:Uint8ClampedArray|undefined;
  try{
    const context=canvas.getContext('2d');if(!context)throw new Error('无法创建公式合成画布');
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer,pixels.byteOffset,pixels.length),width,height),0,0);
    await drawFormulas(canvas,presentation,options);check(options);
    if(current)composed=context.getImageData(0,0,width,height).data;
    else{
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('公式图像导出失败')),type,.95));
      check(options);return blob;
    }
  }finally{canvas.width=canvas.height=0;}
  check(options);return encodeSourcePausedPng(composed!,width,height,current!.scale,options);
}
