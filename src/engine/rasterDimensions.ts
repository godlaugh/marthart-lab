import type {GenerateContext} from '../types';

// One retained RGBA8 result is limited to 128 MiB. Scratch GPU batches are
// bounded separately by their owner; this is not a process-memory guarantee.
export const MAX_RASTER_PIXELS=128*1024*1024/4;
/** Validate the caller's output request before allocating or changing a live
 * renderer's failure state. Preview admission is a separate backend decision. */
export function validateRasterRequest({width,height,quality}:GenerateContext):void{
  for(const value of [width,height])if(!Number.isInteger(value)||value<1||value>16384)throw new Error('画布尺寸须为 1–16384 的整数');
  if(quality==='export'&&width*height>MAX_RASTER_PIXELS)throw new Error('导出像素超过 128 MiB 图像预算，请减小尺寸。');
}
export function rasterDimensions(context:GenerateContext,cost:number,backend:'cpu'|'webgl2',warnings:string[]):[number,number]{
  validateRasterRequest(context);
  const {width,height,quality}=context;
  if(quality==='export')return [width,height];
  const pixelBudget=backend==='webgl2'?1_048_576:320_000,workBudget=backend==='webgl2'?300_000_000:24_000_000;
  const factor=Math.min(1,Math.sqrt(pixelBudget/(width*height)),Math.sqrt(workBudget/(width*height*Math.max(1,cost))));
  const w=Math.max(1,Math.floor(width*factor)),h=Math.max(1,Math.floor(height*factor));
  if(w!==width||h!==height)warnings.push(`为限制 ${backend==='webgl2'?'GPU':'CPU'} 预览工作量，本次计算 ${w} × ${h} 像素（请求 ${width} × ${height}）。导出保留请求尺寸。`);
  return [w,h];
}
