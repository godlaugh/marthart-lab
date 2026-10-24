import {prepareSourcePausedCaptureSize} from './sourcePausedCaptureSize';

/** MathArt.ensureRenderBuffer uses the configured output size multiplied by
 * exportScaleFactor=3 in Float32 before inherited-density division/Java round.
 * Keep both the logical graphics size and its physical pixels: shader viewport
 * uniforms consume the former, pixel transport consumes the latter. Encoder
 * output parity/limits are separate and must not resize this input first. */
export function sourceRecordingSize(size:{width:number;height:number},density:number,maxPixels?:number){
 if(!size||![size.width,size.height].every(n=>Number.isSafeInteger(n)&&n>0))throw Error('录制输出尺寸必须为正整数');
 return prepareSourcePausedCaptureSize({width:Math.fround(Math.fround(size.width)*3),height:Math.fround(Math.fround(size.height)*3)},density,maxPixels);
}
