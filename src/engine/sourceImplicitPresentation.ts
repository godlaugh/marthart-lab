import type {GenerateContext,GeometryOutput,SceneDocument} from '../types';
import type {ImplicitJob} from './implicitSurface';
import {prepareSourceRealExpression} from './domainSourceScalar';
import {sourceColorLerp} from './domainSourcePalette';
import {sourceConfigPackedColor} from './sourceConfigColor';
import {IMPLICIT_WORK_BYTES,IMPLICIT_OUTPUT_BYTES} from './meshEdges';
import {writeSourcePackedColor} from './sourceProcessingGeometry';

export const SOURCE_IMPLICIT_PRESENTATION='mathart-1.7.8-cpu-slices-v1' as const;
export const usesSourceImplicitPresentation=(scene:Pick<SceneDocument,'kind'|'settings'>)=>scene.kind==='implicit'&&scene.settings.implicitPresentationVersion===SOURCE_IMPLICIT_PRESENTATION;
export const usesSourceImplicitCpuMesh=(scene:Pick<SceneDocument,'kind'|'settings'>)=>usesSourceImplicitPresentation(scene)&&scene.settings.renderMode==='mesh'&&(scene.settings.computeBackend??'cpu')==='cpu';
export interface SourceImplicitPresentation {
 readonly model:typeof SOURCE_IMPLICIT_PRESENTATION;
 readonly fill:boolean;readonly fillColors:Float32Array;readonly lineWeight:number;readonly referencePixelDensity:number;
 readonly wire?:{positions:Float32Array;colors:Float32Array;alphas:Float32Array;axes:readonly number[];samples:number};
}
const F=Math.fround;
// ImplicitSurface.<clinit> MS_SEGMENTS; edges run around the square 0→1→2→3→0.
const SEGMENTS=[[],[3,0],[0,1],[3,1],[1,2],[3,2,0,1],[0,2],[3,2],[2,3],[0,2],[0,3,1,2],[1,2],[1,3],[0,1],[3,0],[]] as const;
export function sourceImplicitSliceAxes(min:readonly number[],max:readonly number[],scale:readonly number[]):number[]{
 const spans=min.map((v,i)=>F(Math.abs(F(max[i]-v))*Math.abs(scale[i])));
 let first=0,second=1;if(spans[1]>spans[0]){first=1;second=0;}
 if(spans[2]>spans[first]){second=first;first=2;}else if(spans[2]>spans[second])second=2;
 return[first,second];
}
function scalar(value:unknown,label:string):number{if(typeof value!=='number'||!Number.isFinite(F(value)))throw Error(`源隐式曲面 ${label} 必须为有限 Float32 数值`);return F(value);}
export function sourceImplicitHeightColor(palette:readonly number[],z:number,min:number,span:number):number{
 const u=F(Math.max(0,Math.min(1,F(F(z-min)/span)))),at=F(u*(palette.length-1)),index=Math.trunc(at);
 return index>=palette.length-1?palette[palette.length-1]:sourceColorLerp(palette[index],palette[index+1],F(at-index),'rgb');
}
/** Source contour lines are independently sampled two-axis slices, not mesh
 * triangle edges. Keep their order and endpoints even when two slices meet. */
export function sourceImplicitSliceLines(job:ImplicitJob,context:GenerateContext,retainedBytes=0){
 const {scene,dimensions}=job,s=scene.settings,min=job.min.map(F),max=job.max.map(F),scale=['X','Y','Z'].map(a=>scalar(s['scale'+a]??1,'scale'+a)),offset=['X','Y','Z'].map(a=>scalar(s['offset'+a]??0,'offset'+a)),iso=F(job.iso);
 if(Number(s.scale??1)!==1||['X','Y','Z'].some(a=>Number(s['rotate'+a]??0)!==0))throw Error('源隐式切片暂不支持附加的本地整体缩放或旋转');
 if(!min.every((v,i)=>Number.isFinite(v)&&Number.isFinite(max[i])&&max[i]>v))throw Error('源隐式切片坐标域在 Float32 中不可表示');
 const keys=Object.keys(scene.parameters).sort(),parsed=prepareSourceRealExpression(scene.equations.f,['x','y','z',...keys]);
 if(!parsed.ok)throw Error('源隐式切片公式无效：'+JSON.stringify(parsed.error));
 const variables=new Float64Array([0,0,0,...keys.map(k=>scene.parameters[k])]),step=min.map((v,i)=>F(F(max[i]-v)/dimensions[i])),axes=sourceImplicitSliceAxes(min,max,scale);
 const chunks:Float32Array[]=[],CHUNK=12288;let length=0,samples=0,fieldBytes=0,peak=retainedBytes;
 const check=()=>{if(context.isCancelled?.())throw new DOMException('源隐式切片已取消','AbortError');};
 const append=(p:readonly number[])=>{if(length%CHUNK===0){const next=(chunks.length+1)*CHUNK*4;if(retainedBytes+next*4+fieldBytes>IMPLICIT_WORK_BYTES||retainedBytes+next*7/3>IMPLICIT_OUTPUT_BYTES)throw Error('源隐式切片与网格缓冲超过 256 MiB 预算');peak=Math.max(peak,retainedBytes+next*4+fieldBytes);chunks.push(new Float32Array(CHUNK));}for(const x of p){if(!Number.isFinite(x))throw Error('源隐式切片坐标超出有限 Float32 范围');chunks[Math.floor(length/CHUNK)][length%CHUNK]=x;length++;}};
 const coordinate=(axis:number,i:number)=>F(min[axis]+F(i*step[axis]));
 for(const axis of axes){
  const [a,b]=[0,1,2].filter(i=>i!==axis),stride=dimensions[b]+1;fieldBytes=(dimensions[a]+1)*stride*4;
  if(retainedBytes+chunks.length*CHUNK*16+fieldBytes>IMPLICIT_WORK_BYTES)throw Error('源隐式切片场缓冲超过 256 MiB 预算');
  peak=Math.max(peak,retainedBytes+chunks.length*CHUNK*16+fieldBytes);const field=new Float32Array(fieldBytes/4);
  for(let slice=0;slice<=dimensions[axis];slice++){
   check();const fixed=coordinate(axis,slice);variables[axis]=fixed;
   for(let i=0;i<=dimensions[a];i++){check();variables[a]=coordinate(a,i);for(let j=0;j<=dimensions[b];j++){variables[b]=coordinate(b,j);const value=F(parsed.value.evaluate(variables));field[i*stride+j]=Number.isFinite(value)?value:iso===0?1:F(iso*10);samples++;}}
   for(let i=0;i<dimensions[a];i++){check();const a0=coordinate(a,i),a1=coordinate(a,i+1);for(let j=0;j<dimensions[b];j++){
    const values=[field[i*stride+j],field[(i+1)*stride+j],field[(i+1)*stride+j+1],field[i*stride+j+1]],mask=values.reduce((mask,value,k)=>mask|(value<iso?1<<k:0),0),edges=SEGMENTS[mask];if(!edges.length)continue;
    const b0=coordinate(b,j),b1=coordinate(b,j+1),corners=[[a0,b0],[a1,b0],[a1,b1],[a0,b1]],points:(number[]|undefined)[]=[];
    for(const edge of edges){let point=points[edge];if(!point){const end=(edge+1)%4,delta=F(values[end]-values[edge]),ratio=Math.abs(delta)<F(1e-6)?.5:F(F(iso-values[edge])/delta),u=Math.max(0,Math.min(1,ratio)),p=[0,0,0];p[axis]=fixed;p[a]=F(corners[edge][0]+F(u*F(corners[end][0]-corners[edge][0])));p[b]=F(corners[edge][1]+F(u*F(corners[end][1]-corners[edge][1])));point=p.map((v,k)=>F(F(v*scale[k])+offset[k]));points[edge]=point;}append(point);}
   }}
  }
 }
 check();const positions=new Float32Array(length);for(let i=0;i<chunks.length;i++)positions.set(chunks[i].subarray(0,Math.min(CHUNK,length-i*CHUNK)),i*CHUNK);return{positions,axes,samples,estimatedPeakWorkingBytes:peak};
}
/** One generation owner resolves fill/line presence and color. Consumers never
 * reinterpret current inspector settings or replace slice lines by topology. */
export function bindSourceImplicitPresentation(output:GeometryOutput,job:ImplicitJob,context:GenerateContext):void{
 const s=job.scene.settings;if(s.implicitPresentationVersion===undefined)return;
 if(!usesSourceImplicitPresentation(job.scene))throw Error('未知源隐式曲面显示版本');
 // The imported marker retains provenance if the user switches rendering mode.
 // GPU and particle sampling still belong to their existing implementations.
 if(!usesSourceImplicitCpuMesh(job.scene))return;
 const check=()=>{if(context.isCancelled?.())throw new DOMException('源隐式曲面显示已取消','AbortError');};check();
 const opacity=scalar(s.opacity??1,'fill opacity');if(opacity<0||opacity>1)throw Error('源隐式曲面填充透明度越界');
 if(typeof s.meshFill!=='boolean'||typeof s.meshWireframe!=='boolean')throw Error('源隐式填充与线条开关必须为布尔值');
 const fill=s.meshFill,lineWeight=scalar(s.meshWireframeWidth??1,'line weight'),density=context.sourcePointPixelDensity??1;
 if(lineWeight<=0||!Number.isFinite(density)||density<=0)throw Error('源隐式曲面线宽或参考像素密度无效');
 const palette=job.scene.palette.stops.map(sourceConfigPackedColor);if(!palette.length)throw Error('源隐式曲面调色板不能为空');
 const zScale=scalar(s.scaleZ??1,'scaleZ'),zOffset=scalar(s.offsetZ??0,'offsetZ'),low=F(job.min[2]*zScale),high=F(job.max[2]*zScale),fillLow=F(low+zOffset),fillSpan=F(F(high+zOffset)-fillLow)||1,wireSpan=F(high-low)||1;
 const retained=output.positions.byteLength+(output.indices?.byteLength??0)+output.positions.length/3*16;
 if(retained>IMPLICIT_OUTPUT_BYTES||retained+output.positions.length/3*32>IMPLICIT_WORK_BYTES)throw Error('源隐式曲面显示缓冲超过容量');
 const fillColors=new Float32Array(output.positions.length/3*4);
 for(let i=0;i<output.positions.length;i+=3){if((i&4095)===0)check();const packed=sourceImplicitHeightColor(palette,output.positions[i+2],fillLow,fillSpan),alpha=Math.trunc(F(F(F((packed>>>24)/255)*opacity)*255));writeSourcePackedColor((packed&0xffffff)|(alpha<<24),fillColors,i/3*4);}
 // CPU Scene rendering is unlit. Preserve the original fill(int) byte boundary
 // and keep palette alpha; neither Phong lighting nor sRGB conversion applies.
 const facts:SourceImplicitPresentation={model:SOURCE_IMPLICIT_PRESENTATION,fill,fillColors,lineWeight,referencePixelDensity:density};
 if(s.meshWireframe&&(!fill||opacity<F(.999))){
  const wire=sourceImplicitSliceLines(job,context,retained),rgb=new Float32Array(wire.positions.length),alphas=new Float32Array(wire.positions.length/3),rgba=new Float32Array(4);
  for(let i=0;i<rgb.length;i+=3){if((i&4095)===0)check();writeSourcePackedColor(sourceImplicitHeightColor(palette,wire.positions[i+2],low,wireSpan),rgba,0);rgb.set(rgba.subarray(0,3),i);alphas[i/3]=rgba[3];}
  (facts as {wire:SourceImplicitPresentation['wire']}).wire={...wire,colors:rgb,alphas};
  if(output.implicit)output.implicit.estimatedPeakWorkingBytes=Math.max(output.implicit.estimatedPeakWorkingBytes,wire.estimatedPeakWorkingBytes);
 }
 check();output.colors=undefined;output.sourceImplicitPresentation=facts;output.sourceBackgroundColor=sourceConfigPackedColor(String(s.background??'#000000'));
}
