import type {ArtRenderer} from './renderer';
import type {SceneOutput} from '../types';
import {outputBuffers} from './outputBuffers';
import {readSourceDrawingPixels} from './sourceDrawingPixels';
import {encodeFormulaRaster,type FormulaCompositeOptions} from './formulaCanvas';
import {validateFormulaPresentation} from './formulaConfig';
import {MAX_RASTER_PIXELS} from './rasterDimensions';

let generation=0;
/** Encode the already generated CPU implicit geometry. Pixel backend selection
 * belongs to the shared drawing boundary; formulas and PNG enhancement consume
 * those pixels without regenerating the scene or inventing a retained frame. */
export async function encodeSourceImplicitPng(renderer:ArtRenderer,output:SceneOutput,options:FormulaCompositeOptions&{signal:AbortSignal}):Promise<Blob> {
 if(output.type!=='geometry'||!output.sourceImplicitPresentation||!output.sourceCameraFrame)throw Error('源隐式 PNG 需要已生成的几何及相机帧');
 const formulas=validateFormulaPresentation(output.formulaPresentation),gl=renderer.renderer.getContext();
 const width=gl.drawingBufferWidth,height=gl.drawingBufferHeight;
 const retainedBytes=[...new Set(outputBuffers(output))].reduce((sum,b)=>sum+b.byteLength,0)+width*height*4;
 if(!Number.isSafeInteger(width*height)||width<=0||height<=0||width*height>MAX_RASTER_PIXELS||retainedBytes>256*1024*1024)throw Error('源隐式 PNG 几何与图像超过容量');
 const isCancelled=()=>options.signal.aborted||!!options.isCancelled?.();
 const pixels=await readSourceDrawingPixels(renderer,width,height,retainedBytes,isCancelled,{signal:options.signal,generation:++generation,sequence:1});
 return encodeFormulaRaster({type:'raster',width,height,...pixels,formulaPresentation:formulas},'image/png',{...options,sourceImageProcessing:'paused-png'});
}
