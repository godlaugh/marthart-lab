import {sourceGradientFrameAtAge,type SourceGradientRuntime} from './sourceGradientRuntime';
import type {PreparedSourceSurfacePalette} from './sourceSurfaceColor';
import {sampleSourceSurfaceGradient,sourceSurfacePaletteTarget,sourceSurfaceTrailAgeKey,type SourceSurfacePaletteState} from './sourceSurfaceGradient';

export interface SourceSurfaceTrailGradientOptions {
 readonly palette:PreparedSourceSurfacePalette;
 readonly runtime:SourceGradientRuntime;
 readonly time:number;
 readonly numU:number;
 readonly numV:number;
 readonly reserve:(units:number)=>void;
}

/** One native drawTrailsLines call owns one snapshot and these bounded caches.
 * Call in emitted segment endpoint order: the history owner skips invalid
 * segments and carries the preceding endpoint color across connected segments.
 * Returned alpha is the palette alpha; active trail opacity is owned separately
 * by the history renderer and starts at 255, regardless of palette alpha. */
export function createSourceSurfaceTrailGradient({palette,runtime,time,numU,numV,reserve}:SourceSurfaceTrailGradientOptions):(particleId:number,recordTime:number,baseColor:number)=>number {
 const snapshot=runtime.snapshot(),config=snapshot.config;
 if(!snapshot.running||!config)throw new Error('原版曲面动态拖尾需要正在运行的渐变');
 if(palette.packed.length===0)throw new Error('原版曲面动态拖尾色板不能为空');
 for(const size of [numU,numV])if(!Number.isInteger(size)||size<1||size>512)throw new Error('原版曲面动态拖尾网格每轴必须为 1 至 512 的整数');
 const colorHashes=new Int32Array(4096),colorValues=new Uint32Array(4096),colorValid=new Uint8Array(4096);
 const stateKeys=new Int32Array(512),states:Array<SourceSurfacePaletteState|undefined>=new Array(512);
 const F=Math.fround,frameTime=F(time);
 return(particleId,recordTime,baseColor)=>{
  reserve(1);
  const age=sourceSurfaceTrailAgeKey(frameTime,recordTime);
  if(age===-2147483648)return baseColor;
  const row=Math.floor(particleId/numV),hash=Math.imul(age,73856093)^Math.imul(row,19349663),colorSlot=hash&4095;
  // Native cache compares the combined hash only, not the two original keys.
  // Preserve exact collisions rather than silently "repairing" source output.
  if(colorValid[colorSlot]&&colorHashes[colorSlot]===hash)return colorValues[colorSlot];
  const stateSlot=age&511;
  let state=states[stateSlot];
  if(!state||stateKeys[stateSlot]!==age){
   reserve(64);
   state=sourceSurfacePaletteTarget(sourceGradientFrameAtAge(snapshot,F(F(age)/F(120))),config.mode);
   states[stateSlot]=state;stateKeys[stateSlot]=age;
  }
  reserve(128);
  const coordinate=numU===1?0:F(F(row)/F(Math.max(1,numU-1)));
  const color=sampleSourceSurfaceGradient(palette.packed,coordinate,state,config.mode,config.interpolation,true);
  colorHashes[colorSlot]=hash;colorValues[colorSlot]=color;colorValid[colorSlot]=1;
  return color;
 };
}
