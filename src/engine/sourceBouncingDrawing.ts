import type {SourceDrawingFrame} from './sourceDrawingFrame';
import type {SourceDrawingCommand,SourceDrawingUniform} from './sourceDrawingSnapshot';
import type {SourceBouncingOperation} from './sourceBouncingOperation';
import type {SourceBouncingBoundary} from './sourceBouncingGpu';
import {SourceBouncingGpuError,SOURCE_BOUNCING_GPU_LIMITS,sourceBouncingFloat32} from './sourceBouncingLimits';
import {sourceBouncingNativeVertex,sourceBouncingNativeTextureVertex,sourceBouncingNativeFragment} from './sourceBouncingGpuShader';
import {prepareSourceBouncingDisplay,type SourceBouncingVisualConfiguration} from './sourceBouncingVisualConfig';
import type {SourceCameraPlan} from './sourceCamera';
import {MAX_RASTER_PIXELS} from './rasterDimensions';
import {writeSourcePackedColor} from './sourceProcessingGeometry';
import {prepareSourceBouncingBoundary,SOURCE_BOUNCING_BOUNDARY_LIMITS} from './sourceBouncingBoundary';
import {sourceProcessingClosedStrokeBuffers,sourceProcessingLineDisplay,sourceProcessingLineVertex,sourceProcessingLineFragment,SOURCE_PROCESSING_CLOSED_STROKE_LIMITS} from './sourceProcessingStroke';
export interface SourceBouncingDrawingOptions {
 readonly width:number;readonly height:number;readonly cameraPlan:SourceCameraPlan;
 readonly visualConfiguration:SourceBouncingVisualConfiguration;readonly initialSpeed:number;
 /** Already translated world boundary from the seed/update owner. Omission
  * retains the explicit particle-only diagnostic path. */
 readonly boundary?:SourceBouncingBoundary;
}
export function sourceBouncingGpuDisplayLayout(width:number,height:number){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>16384||height>16384||width*height>MAX_RASTER_PIXELS)throw new SourceBouncingGpuError('capacity','源弹跳画布超出本地图像容量');
 // RGBA8 attachment + readback; one flip row and small uniform upload arrays.
 return Object.freeze({width,height,bytes:width*height*8+width*4+1024});
}
function matrix(values:ArrayLike<number>|undefined):Float32Array{
 if(!values||values.length!==16)throw new SourceBouncingGpuError('input','源弹跳矩阵需要16个有限Float32值');
 const result=new Float32Array(16);for(let i=0;i<16;i++)result[i]=sourceBouncingFloat32(values[i]);return result;
}
export const SOURCE_BOUNCING_BOUNDARY_BYTES=SOURCE_PROCESSING_CLOSED_STROKE_LIMITS.maxBufferBytes*2+SOURCE_BOUNCING_BOUNDARY_LIMITS.pathBytes;
export function prepareSourceBouncingDrawing(count:number,options:SourceBouncingDrawingOptions){
  if(!Number.isInteger(count)||count<1||count>2147483647)throw new SourceBouncingGpuError('input','源弹跳粒子数量无效');
  const d=sourceBouncingGpuDisplayLayout(options.width,options.height);
  const prepared=prepareSourceBouncingDisplay(options.visualConfiguration,{initialSpeed:options.initialSpeed},options.cameraPlan?.displayScale);
  if(!prepared.ok)throw new SourceBouncingGpuError(prepared.error.kind==='capacity'?'capacity':'input',prepared.error.reason);
  const u=prepared.value,projection=matrix(options.cameraPlan?.projection?.columnMajor),modelview=matrix(options.cameraPlan?.modelView?.columnMajor);
  let boundary:{buffers:ReturnType<typeof sourceProcessingClosedStrokeBuffers>;color:number;display:ReturnType<typeof sourceProcessingLineDisplay>}|undefined;
  if(options.boundary){
   const path=prepareSourceBouncingBoundary(options.boundary,u,options.cameraPlan);
   if(!path.ok)throw new SourceBouncingGpuError(path.error.kind==='capacity'?'capacity':'input',path.error.reason);
   if(path.value.positions.length)boundary={buffers:sourceProcessingClosedStrokeBuffers(path.value.positions,path.value.lineWidth,options.cameraPlan),color:path.value.packedColor,display:sourceProcessingLineDisplay(options.cameraPlan)};
  }
  const pointSize=Math.max(1,u.radius),fragments=count*Math.ceil(pointSize)**2;
  if(!Number.isFinite(pointSize)||!Number.isSafeInteger(fragments)||fragments>SOURCE_BOUNCING_GPU_LIMITS.pointFragments)throw new SourceBouncingGpuError('capacity','源弹跳点片元或绘制次数超出预算；不减少粒子或点大小');

  const clear=new Float32Array(4);writeSourcePackedColor(u.backgroundColor,clear,0);
  return{particleCount:count,d,u,projection,modelview,boundary,pointSize,clear};
 }
export function sourceBouncingDrawingFrame(prepared:ReturnType<typeof prepareSourceBouncingDrawing>,identity:{generation:number;sequence:number},storage:{kind:'snapshot';state:Float32Array}|{kind:'retained';operation:Extract<SourceBouncingOperation,{kind:'draw'}>}):SourceDrawingFrame{
  if(!identity||![identity.generation,identity.sequence].every(n=>Number.isInteger(n)&&n>0&&n<=0xffffffff))throw new SourceBouncingGpuError('input','原生帧身份需要非零 uint32');
  const count=prepared.particleCount;
  if(storage.kind==='snapshot'&&storage.state.length!==count*4||storage.kind==='retained'&&storage.operation.particleCount!==count)throw new SourceBouncingGpuError('input','状态与绘制数量不匹配');
  const {d,u,projection,modelview,boundary,clear}=prepared,c=u.transform;
  const uniform=(name:string,kind:Exclude<SourceDrawingUniform['kind'],'sampler2d'>,values:ArrayLike<number>,count=1):SourceDrawingUniform=>({name,kind,count,values:kind==='int'||kind==='ivec2'?new Int32Array(values):new Float32Array(values)});
  const common={first:0,instances:1,depthTest:false,depthWrite:false,depthFunction:'less-equal' as const,frontFace:'counter-clockwise' as const,passes:['both' as const]};
  const commands:SourceDrawingCommand[]=[{...common,primitive:'points',...(storage.kind==='retained'?{retainedBouncingState:true as const}:{}),vertexShader:storage.kind==='retained'?sourceBouncingNativeTextureVertex:sourceBouncingNativeVertex,fragmentShader:sourceBouncingNativeFragment,attributes:storage.kind==='snapshot'?[{name:'particleState',size:4,divisor:0,values:storage.state}]:[],count,blend:'source-alpha-over',uniforms:[
   uniform('projection','mat4',projection),uniform('modelview','mat4',modelview),uniform('scale','vec3',[c.scaleX,c.scaleY,c.scaleZ]),uniform('offset','vec3',[c.offsetX,c.offsetY,c.offsetZ]),uniform('radius','float',[u.radius]),uniform('particleCount','int',[count]),uniform('speedScale','float',[u.speedScale]),uniform('paletteCount','int',[u.paletteCount]),uniform('palette','vec3-array',u.paletteRgb,25),
  ]}];
  if(boundary){
   const b=boundary.buffers,rgba=new Float32Array(4);writeSourcePackedColor(boundary.color,rgba,0);const colors=new Float32Array(b.positions.length);for(let i=0;i<colors.length;i+=4)colors.set(rgba,i);
   commands.push({...common,primitive:'triangles',vertexShader:sourceProcessingLineVertex,fragmentShader:sourceProcessingLineFragment,attributes:[{name:'position',size:4,divisor:0,values:b.positions},{name:'direction',size:4,divisor:0,values:b.directions},{name:'color',size:4,divisor:0,values:colors}],index:b.indices,count:b.indices.length,blend:'source-alpha-over-additive-alpha',uniforms:[
    uniform('lineModelview','mat4',[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),uniform('projection','mat4',projection),uniform('viewport','vec4',boundary.display.viewport),uniform('perspective','int',[boundary.display.perspective]),uniform('scale','vec3',boundary.display.scale),
   ]});
  }
  const buffers=new Set<ArrayBufferLike>();for(const command of commands){for(const attribute of command.attributes)buffers.add(attribute.values.buffer);if(command.index)buffers.add(command.index.buffer);for(const binding of command.uniforms)if(binding.kind!=='sampler2d')buffers.add(binding.values.buffer);}
  const bytes=[...buffers].reduce((n,b)=>n+b.byteLength,0),metadata=commands.reduce((n,c)=>n+3*(c.vertexShader.length+c.fragmentShader.length)+4096,0);
  return{...identity,...(storage.kind==='retained'?{bouncing:storage.operation}:{}),width:d.width,height:d.height,samples:0,clear:[clear[0],clear[1],clear[2],clear[3]],...(clear[3]===1?{completion:'opaque-alpha' as const}:{}),drawing:{model:'source-drawing-v1',commands,textures:[],copiedBufferBytes:bytes,retainedBufferBytes:0,admittedBytes:bytes+metadata}};
}
