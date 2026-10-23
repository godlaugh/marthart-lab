import type {ArtRenderer} from './renderer';
import type {RasterOutput} from '../types';
import {renderSourceNativeFrame,SourceNativeError} from './sourceNativeClient';
export interface SourceDrawingRequest {signal:AbortSignal;generation:number;sequence:number}
/** Build policy is shared by captures and recording; never select a fallback
 * after an unavailable, unsupported or failed native frame. */
export function sourceDrawingBackend(request?:SourceDrawingRequest):'native'|'webgl' {
 const backend=import.meta.env.VITE_SOURCE_RENDERER??'webgl';
 if(backend!=='native'&&backend!=='webgl')throw Error('未知源绘图后端配置');
 if(backend==='native'&&!request)throw Error('原生绘图需要可取消的帧请求');
 return backend;
}
/** Read only an already drawn offscreen frame. Numerical state, formulas and
 * image enhancement belong to callers; native pixels are already top-down. */
export async function readSourceDrawingPixels(renderer:ArtRenderer,width:number,height:number,retainedBytes:number,isCancelled:()=>boolean,request?:SourceDrawingRequest):Promise<Pick<RasterOutput,'pixels'|'sourcePixelRenderer'>> {
 const backend=sourceDrawingBackend(request),check=()=>{if(isCancelled()||request?.signal.aborted)throw new DOMException('源绘图已取消','AbortError');};check();
 const gl=renderer.renderer.getContext();
 if(gl.drawingBufferWidth!==width||gl.drawingBufferHeight!==height)throw Error('源绘图实际绘制尺寸不匹配');
 if(backend==='native'){
  const frame=renderer.sourceDrawingFrame(request!.generation,request!.sequence);
  if(!frame.ok)throw new SourceNativeError(frame.error.kind,frame.error.reason);
  if(frame.value.samples!==0)throw Error('源导出需要无多重采样的离屏帧');
  const native=await renderSourceNativeFrame(frame.value,{signal:request!.signal,retainedBytes});check();
  return{pixels:native.pixels,sourcePixelRenderer:{backend:'native',identity:native.rendererIdentity,generation:native.generation,sequence:native.sequence,samples:frame.value.samples}};
 }
 const pixels=new Uint8ClampedArray(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
 if(gl.isContextLost()||gl.getError()!==gl.NO_ERROR)throw Error('源绘图像素回读失败');
 const stride=width*4,row=new Uint8ClampedArray(stride);
 for(let y=0;y<Math.floor(height/2);y++){const a=y*stride,b=(height-1-y)*stride;row.set(pixels.subarray(a,a+stride));pixels.copyWithin(a,b,b+stride);pixels.set(row,b);}
 check();return{pixels,sourcePixelRenderer:{backend:'webgl'}};
}
