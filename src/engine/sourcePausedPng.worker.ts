import {enhanceSourcePausedImage} from './sourcePausedImage';
import {upscaleSourcePausedImage} from './sourcePausedUpscale';
import {encodeRgbaPng} from './rgbaPng';
import {prepareSourcePausedPng,type SourcePausedPngRequest,type SourcePausedPngResponse} from './sourcePausedPngContract';

const worker=self as unknown as DedicatedWorkerGlobalScope;
let started=false;
worker.onmessage=async({data}:MessageEvent<SourcePausedPngRequest>)=>{
 if(started)return;started=true;
 const response={operation:'encode-source-paused-png',id:1} as const;
 try{
  if(data?.operation!==response.operation||data.id!==1)throw new Error('当前帧 PNG 请求身份无效');
  const {pixels,width,height,scale}=data;
  if(!(pixels instanceof Uint8ClampedArray)||!(pixels.buffer instanceof ArrayBuffer)||pixels.length!==width*height*4)throw new Error('当前帧 PNG 需要完整且未共享的 RGBA 图像');
  const plan=prepareSourcePausedPng(width,height,scale,pixels.buffer.byteLength);
  const enhanced=enhanceSourcePausedImage(pixels,width,height);
  const final=scale===1?enhanced:upscaleSourcePausedImage(enhanced,width,height,scale);
  const blob=await encodeRgbaPng(final,plan.width,plan.height);
  worker.postMessage({...response,result:{blob,width:plan.width,height:plan.height}} satisfies SourcePausedPngResponse);
 }catch(error){worker.postMessage({...response,error:error instanceof Error?error.message:String(error)} satisfies SourcePausedPngResponse);}
};
