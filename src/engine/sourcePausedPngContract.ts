import {sourcePausedImageBytes} from './sourcePausedImage';
import {prepareSourcePausedUpscale} from './sourcePausedUpscale';
import {MAX_RGBA_PNG_STORAGE_BYTES} from './rgbaPng';
import {validateRasterRequest} from './rasterDimensions';

export interface SourcePausedPngRequest {
 operation:'encode-source-paused-png';id:1;
 pixels:Uint8ClampedArray<ArrayBuffer>;width:number;height:number;scale:1|3|5;
}
export type SourcePausedPngResponse={operation:SourcePausedPngRequest['operation'];id:1}&(
 {result:{blob:Blob;width:number;height:number}}|{error:string});

/** Admission covers base composition and the separate image worker. The live
 * numerical renderer, browser/GPU and compressor native workspaces are separate.
 * Encoder storage includes its output raster; avoid counting that raster twice. */
export function prepareSourcePausedPng(width:number,height:number,scale:1|3|5,retainedBytes:number){
 validateRasterRequest({width,height,time:0,quality:'export'});
 if(scale!==1&&scale!==3&&scale!==5)throw new Error('当前帧 PNG 放大倍率须为 1、3 或 5');
 const baseBytes=width*height*4,upscale=scale===1?undefined:prepareSourcePausedUpscale(width,height,scale);
 const finalWidth=upscale?.width??width,finalHeight=upscale?.height??height;
 validateRasterRequest({width:finalWidth,height:finalHeight,time:0,quality:'export'});
 if(!Number.isSafeInteger(retainedBytes)||retainedBytes<baseBytes)throw new Error('当前帧 PNG 保留图像大小无效');
 const composition=retainedBytes+baseBytes*2+16_000_000*4;
 const enhancement=retainedBytes+sourcePausedImageBytes(width,height);
 const resizing=retainedBytes+baseBytes+(upscale?.peakBytes??0);
 // The transferred composed input remains in the request during encoding;
 // when enlarged, also retain the base enhanced image conservatively.
 const encoding=retainedBytes+baseBytes+(upscale?baseBytes:0)+MAX_RGBA_PNG_STORAGE_BYTES;
 const peakBytes=Math.max(composition,enhancement,resizing,encoding);
 if(peakBytes>768*1024**2)throw new Error('当前帧 PNG 超过 768 MiB 工作预算');
 return{width:finalWidth,height:finalHeight,peakBytes};
}

