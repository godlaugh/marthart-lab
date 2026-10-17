import type {DensityBounds,DensityProjection,Settings} from '../types';
import {numberSetting} from './expression';
import {paletteColor} from './palette';
import type {Palette} from '../types';
import {prepareRootsMetricValue} from './rootsDensityColor';
export interface RootsSplat {kind:'pixel'|'soft-disc';diameter:number;}
export interface RootsInkFacts {accepted:number;clipped:number;invalid:number;}
export interface RootsMetricInkFacts extends RootsInkFacts {submittedFinitePointCount:number;}
export type RootsInk = {kind:'rgb-sum';values:Float64Array}|{kind:'metric-sum';values:Float64Array};
export function prepareRootsSplat(settings:Settings):RootsSplat {
 const kind=settings.rootSplat??'pixel';if(kind!=='pixel'&&kind!=='soft-disc')throw new Error('复根点核必须为 pixel 或 soft-disc');
 return{kind,diameter:numberSetting(settings,'rootSplatDiameter',3,.8,64)};
}
/** Source-derived radial coverage, independently evaluated in pixel units. The
 * source's camera/world-size conversion and metric-average coloring are separate. */
export function rootsSplatWeight(dx:number,dy:number,diameter:number):number {
 if(!Number.isFinite(dx)||!Number.isFinite(dy)||!Number.isFinite(diameter)||diameter<.8||diameter>64)throw new Error('Root splat weight requires finite offsets and a diameter in [0.8,64]');return splatWeight(dx,dy,diameter);
}
function splatWeight(dx:number,dy:number,diameter:number):number {
 const radius=diameter/2,r2=(dx*dx+dy*dy)/(radius*radius);if(r2>1.35)return 0;
 const u=Math.max(0,Math.min(1,((Math.sqrt(r2)-1)*Math.max(radius,.4)+.75)/1.5));
 return(1-u*u*(3-2*u))*Math.exp(-.45*r2);
}
const AXES:Record<DensityProjection,[number,number]>={xy:[0,1],xz:[0,2],yz:[1,2]};
/** Shared admission predicate also used by automatic bounds fitting; a hidden
 * third axis and positions overflowing the source float upload remain invalid. */
export function rootsMetricPositionIsFinite(points:Float64Array,at:number):boolean {
 return Number.isFinite(Math.fround(points[at]))&&Number.isFinite(Math.fround(points[at+1]))&&Number.isFinite(Math.fround(points[at+2]));
}
/** Single Float64 projection/classification boundary for both accumulation
 * backends. Each accepted point is packed as top-down pixel x/y + display RGB.
 * Pixel mode is snapped here, so GPU float32 cannot choose a neighbouring bin. */
export function projectRootPoints(points:Float64Array,count:number,width:number,height:number,bounds:DensityBounds,projection:DensityProjection,palette:Palette,splat:RootsSplat,visit:(x:number,y:number,rgb:readonly number[])=>void,isCancelled?:()=>boolean):RootsInkFacts {
 const {accepted,clipped,invalid}=projectPoints(points,count,width,height,bounds,projection,splat,'rgb-sum',(x,y,metric)=>visit(x,y,paletteColor(palette,metric)),isCancelled);
 return{accepted,clipped,invalid};
}
/** Source color admission owns all XYZ/F32 validity and metric clamping before
 * clipping. The submitted count includes finite positions outside this view. */
export function projectRootsMetricPoints(points:Float64Array,count:number,width:number,height:number,bounds:DensityBounds,projection:DensityProjection,splat:RootsSplat,visit:(x:number,y:number,metric:number)=>void,isCancelled?:()=>boolean):RootsMetricInkFacts {
 return projectPoints(points,count,width,height,bounds,projection,splat,'metric-sum',visit,isCancelled);
}
function projectPoints(points:Float64Array,count:number,width:number,height:number,bounds:DensityBounds,projection:DensityProjection,splat:RootsSplat,kind:RootsInk['kind'],visit:(x:number,y:number,metric:number)=>void,isCancelled?:()=>boolean):RootsMetricInkFacts {
 if(!(points instanceof Float64Array)||!Number.isInteger(count)||count<0||count*4>points.length||![width,height].every(n=>Number.isInteger(n)&&n>0&&n<=16384)||!AXES[projection]||![bounds.minX,bounds.maxX,bounds.minY,bounds.maxY].every(Number.isFinite)||!(bounds.maxX>bounds.minX&&bounds.maxY>bounds.minY))throw new Error('Root point projection contract is invalid');
 const [ax,ay]=AXES[projection],facts={accepted:0,clipped:0,invalid:0,submittedFinitePointCount:0};
 for(let i=0;i<count;i++){
  if((i&1023)===0&&isCancelled?.())throw new DOMException('复根点累积已取消','AbortError');const at=i*4,x=points[at+ax],y=points[at+ay];
  let metric=points[at+3];
  if(kind==='metric-sum'){
   if(!rootsMetricPositionIsFinite(points,at)){facts.invalid++;continue;}
   metric=prepareRootsMetricValue(metric).clamped;
  }else if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(metric)){facts.invalid++;continue;}
  facts.submittedFinitePointCount++;
  if(x<bounds.minX||x>bounds.maxX||y<bounds.minY||y>bounds.maxY){facts.clipped++;continue;}
  let px=(x-bounds.minX)/(bounds.maxX-bounds.minX)*width,py=(bounds.maxY-y)/(bounds.maxY-bounds.minY)*height;
  if(!Number.isFinite(px+py)){facts.invalid++;continue;}
  if(splat.kind==='pixel'){px=Math.min(width-1,Math.floor(px))+.5;py=Math.min(height-1,Math.floor(py))+.5;}
  visit(px,py,metric);facts.accepted++;
 }
 return facts;
}
export function depositRootPoint(ink:Float64Array,width:number,height:number,x:number,y:number,rgb:readonly number[],splat:RootsSplat):void {
 visitRootFootprint(width,height,x,y,splat,(at,weight)=>{for(let k=0;k<3;k++)ink[at+k]+=rgb[k]*weight;ink[at+3]+=weight;});
}
export function depositRootMetric(ink:Extract<RootsInk,{kind:'metric-sum'}>,width:number,height:number,x:number,y:number,metric:number,splat:RootsSplat):void {
 if(!Number.isFinite(metric)||metric<0||metric>1)throw new Error('Root metric deposition requires an admitted metric in [0,1]');
 visitRootFootprint(width,height,x,y,splat,(at,weight)=>{ink.values[at]+=weight;ink.values[at+1]+=metric*weight;});
}
function visitRootFootprint(width:number,height:number,x:number,y:number,splat:RootsSplat,visit:(at:number,weight:number)=>void):void {
 if(splat.kind==='pixel'){visit((Math.floor(y)*width+Math.floor(x))*4,1);return;}
 // The square quad bounds the circular support, matching the independently
 // specified raster footprint; fragments are evaluated at pixel centres.
 const radius=splat.diameter/2,x0=Math.max(0,Math.ceil(x-radius-.5)),x1=Math.min(width-1,Math.ceil(x+radius-.5)-1),y0=Math.max(0,Math.ceil(y-radius-.5)),y1=Math.min(height-1,Math.ceil(y+radius-.5)-1);
 for(let py=y0;py<=y1;py++)for(let px=x0;px<=x1;px++){const weight=splatWeight(px+.5-x,py+.5-y,splat.diameter);if(weight)visit((py*width+px)*4,weight);}
}
