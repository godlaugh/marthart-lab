import {MAX_RASTER_PIXELS} from './rasterDimensions';
import {toneRootsMetricRgbaPrepared,validateRootsMetricColorPlan,rootsDensityScale,type RootsMetricColorPlan} from './rootsDensityColor';

/** Source shaders use bottom-up normalized texture coordinates. Public raster
 * buffers use top-down rows. This owner is the only place that converts them.
 * This is a CPU numerical reference, not a claim about native-driver rounding. */
export interface RootsInkView {
 readonly width:number;
 readonly height:number;
 readonly rotation:number;
 readonly aspect:number;
 readonly cosine:number;
 readonly sine:number;
}
type MetricInk=Float32Array|Float64Array;
const F=Math.fround;
const MAX_VIEW_BYTES=768*1024*1024;
const cancelled=(fn?:()=>boolean)=>{if(fn?.())throw new DOMException('复根显示已取消','AbortError');};
function dimensions(width:number,height:number):void {
 if(![width,height].every(n=>Number.isInteger(n)&&n>0&&n<=16384)||width*height>MAX_RASTER_PIXELS)throw new Error('复根显示尺寸无效或超过图像预算');
}
function bufferShape(ink:MetricInk,width:number,height:number):void {
 dimensions(width,height);
 if(!(ink instanceof Float32Array||ink instanceof Float64Array)||ink.length!==width*height*4)throw new Error('复根显示需要完整的 RGBA 标量墨迹');
}
function validTexel(ink:MetricInk,i:number):void {
 if(!Number.isFinite(ink[i])||ink[i]<0||!Number.isFinite(ink[i+1])||ink[i+1]<0||ink[i+1]>ink[i]||ink[i+2]!==0||ink[i+3]!==0)throw new Error('复根墨迹包含无效质量、度量或布局');
}
export function prepareRootsInkView(width:number,height:number,displayRotation:number):RootsInkView {
 dimensions(width,height);
 const rotation=F(displayRotation);
 if(typeof displayRotation!=='number'||!Number.isFinite(rotation))throw new Error('复根显示旋转必须在 float32 有限范围内');
 return Object.freeze({width,height,rotation,aspect:F(F(width)/F(height)),cosine:F(Math.cos(-rotation)),sine:F(Math.sin(-rotation))});
}
function validateView(view:RootsInkView):void {
 dimensions(view.width,view.height);
 if(![view.rotation,view.aspect,view.cosine,view.sine].every(Number.isFinite)||view.aspect<=0||Math.abs(view.cosine)>1||Math.abs(view.sine)>1)throw new Error('复根显示计划无效');
}
/** Pixel index in the unrotated top-down ink, or -1 for source background.
 * Endpoint UV=1 is admitted then clamped, as GL_NEAREST + CLAMP_TO_EDGE does. */
export function rootsInkViewSourceIndex(view:RootsInkView,x:number,y:number):number {
 validateView(view);
 if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=view.width||y>=view.height)throw new Error('复根显示像素索引越界');
 return sourceIndex(view,x,y);
}
function sourceIndex(view:RootsInkView,x:number,y:number):number {
 const u=F(F(x+.5)/F(view.width)),v=F(F(view.height-y-.5)/F(view.height));
 const cx=F(F(u-.5)*view.aspect),cy=F(v-.5);
 const rx=F(F(F(F(cx*view.cosine)-F(cy*view.sine))/view.aspect)+.5);
 const ry=F(F(F(cx*view.sine)+F(cy*view.cosine))+.5);
 if(rx<0||rx>1||ry<0||ry>1)return -1;
 const sx=Math.min(view.width-1,Math.floor(rx*view.width));
 const sy=view.height-1-Math.min(view.height-1,Math.floor(ry*view.height));
 return sy*view.width+sx;
}
/** Statistics belong to retained, unrotated ink. Display lookup can clip or
 * repeat texels, so its occupancy must never replace accumulation statistics. */
export function rootsNativeInkStatistics(ink:MetricInk,width:number,height:number,isCancelled?:()=>boolean){
 bufferShape(ink,width,height);let occupiedPixels=0,maxCount=0,totalMass=0;
 for(let i=0;i<ink.length;i+=4){if((i&65535)===0)cancelled(isCancelled);validTexel(ink,i);if(ink[i]>0)occupiedPixels++;maxCount=Math.max(maxCount,ink[i]);totalMass+=ink[i];}
 if(!Number.isFinite(totalMass))throw new Error('复根墨迹总质量超出数值范围');
 return{occupiedPixels,maxCount,totalMass};
}
/** Always returns independently owned ink; never mutates or detaches input.
 * Validate even clipped-away texels: a view must not hide corrupted evidence. */
export function viewRootsNativeMetricInk(ink:MetricInk,view:RootsInkView,isCancelled?:()=>boolean):MetricInk {
 validateView(view);bufferShape(ink,view.width,view.height);
 checkViewCapacity(ink,view);
 rootsNativeInkStatistics(ink,view.width,view.height,isCancelled);
 return selectInk(ink,view,isCancelled);
}
/** Includes the borrowed input, independently selected ink and final RGBA8.
 * Callers must add their other retained CPU/GL representations separately. */
export function rootsNativeInkViewBytes(width:number,height:number,bytesPerElement:4|8):number {
 dimensions(width,height);
 if(bytesPerElement!==4&&bytesPerElement!==8)throw new Error('复根墨迹精度无效');
 return width*height*(8*bytesPerElement+4);
}
function checkViewCapacity(ink:MetricInk,view:RootsInkView):void {
 if(rootsNativeInkViewBytes(view.width,view.height,ink instanceof Float32Array?4:8)>MAX_VIEW_BYTES)throw new Error('复根显示的输入、选择缓冲与输出超过 768 MiB 预算');
}
function selectInk(ink:MetricInk,view:RootsInkView,isCancelled?:()=>boolean):MetricInk {
 const output=ink instanceof Float32Array?new Float32Array(ink.length):new Float64Array(ink.length);
 for(let y=0;y<view.height;y++){
  cancelled(isCancelled);
  for(let x=0;x<view.width;x++){
   const source=sourceIndex(view,x,y);
   if(source>=0){const at=(y*view.width+x)*4;output[at]=ink[source*4];output[at+1]=ink[source*4+1];}
  }
 }
 return output;
}
/** Rotation happens on raw mass/metric sums before nonlinear palette/tone.
 * N remains the finite submitted count, including points clipped by the view. */
function prepareViewedInk(ink:MetricInk,view:RootsInkView,isCancelled?:()=>boolean){
 validateView(view);bufferShape(ink,view.width,view.height);checkViewCapacity(ink,view);
 const accumulated=rootsNativeInkStatistics(ink,view.width,view.height,isCancelled);
 const viewed=view.rotation===0?ink:selectInk(ink,view,isCancelled);
 const displayed=viewed===ink?accumulated:rootsNativeInkStatistics(viewed,view.width,view.height,isCancelled);
 return{accumulated,displayed,viewed};
}
/** Numerical view statistics stay independent of the GPU color presentation. */
export function measureRootsNativeMetricInk(ink:MetricInk,view:RootsInkView,isCancelled?:()=>boolean){
 const {accumulated,displayed}=prepareViewedInk(ink,view,isCancelled);return{accumulated,displayed};
}
export function presentRootsNativeMetricInk(ink:MetricInk,view:RootsInkView,color:RootsMetricColorPlan,submittedFinitePointCount:number,isCancelled?:()=>boolean){
 validateRootsMetricColorPlan(color);rootsDensityScale({submittedFinitePointCount,width:view.width,height:view.height});
 const {accumulated,displayed,viewed}=prepareViewedInk(ink,view,isCancelled);
 const pixels=toneRootsMetricRgbaPrepared(view.width,view.height,viewed,color,{submittedFinitePointCount},isCancelled);
 return{pixels,accumulated,displayed,toneBackend:'cpu' as const};
}

/** Radial reference for the two retained source fragment shaders. The quad is
 * clipped to its square before this shader runs; r² alone does not express it. */
export function rootsNativeKernelWeight(kind:'points'|'quad',localX:number,localY:number,diameter:number):number {
 if((kind!=='points'&&kind!=='quad')||![localX,localY,diameter].every(Number.isFinite)||diameter<=0)throw new Error('复根参考点核输入无效');
 if(Math.abs(localX)>1||Math.abs(localY)>1)return 0;
 const r2=localX*localX+localY*localY;
 const smooth=(lo:number,hi:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-lo)/(hi-lo)));return t*t*(3-2*t);};
 if(kind==='points')return r2>1?0:1-smooth(.70,1,r2);
 if(r2>1.35)return 0;
 return(1-smooth(-.75,.75,(Math.sqrt(r2)-1)*Math.max(diameter*.5,.4)))*Math.exp(-.45*r2);
}
