import type {SourceSurfaceFunction} from './sourceSurfaceFunction';
import {type SourceSurfaceGpuFunction} from './sourceSurfaceGpuFunction';
import {createSourceSurfacePointRuntime,sourceSurfaceParticleStart,type SourceSurfacePointRuntimeOptions} from './sourceSurfaceParticles';
import {prepareSourceSurfaceColors} from './sourceSurfaceColor';
import {writeSourcePackedColor} from './sourceProcessingGeometry';
import type {OrdinaryCameraParticleFrame,OrdinaryCameraTargetRequest} from './ordinarySourceCameraTimeline';
import type {SourceGradientAction} from './sourceGradientRuntime';
import type {SourceOscillatingParameterAction,SourceOscillatingParameterConfiguration} from './sourceOscillatingParameterRuntime';

export interface SourceSurfaceGpuPointFrame {
 readonly model:'surface-gpu-points-1.7.8';
 /** u0,v0,speedU,speedV per instance; these are not world positions. */
 readonly seeds:Float32Array;
 /** PShape tint captured at construction; gradient callbacks do not rebuild it. */
 readonly tint:Float32Array;
 readonly functionBody:string;
 readonly parameters:Float32Array;
 readonly scale:readonly number[];readonly offset:readonly number[];
 readonly time:number;
 readonly uLimits:readonly [number,number];readonly vLimits:readonly [number,number];
 readonly periodic:readonly [number,number];readonly flowing:readonly [number,number];
 readonly fadePoints:boolean;
}
/** GPU vertices use analytic shader time. Only the last setup-time tracked Dot
 * evolves by the CPU recurrence; older captured target vectors remain frozen.
 * Parameter and gradient actions still run on that same function/runtime owner.
 * GPU trail recording cannot produce a visible CPU trail. */
export class SourceSurfaceGpuPoints {
 private readonly tracking;
 private readonly seeds:Float32Array;
 private readonly tint:Float32Array;
 private readonly diagnostics:string[];
 private readonly config:SourceSurfacePointRuntimeOptions['configuration'];
 private readonly surfaceFunction:SourceSurfaceFunction;
 constructor(private readonly options:SourceSurfacePointRuntimeOptions,private readonly prepared:SourceSurfaceGpuFunction){
  this.config=structuredClone(options.configuration);this.surfaceFunction=options.surfaceFunction;
  if(this.config.nativeBackend!=='gpu'||this.config.mode!=='points')throw new Error('GPU 点宿主需要对应点模式配置');
  this.tracking=createSourceSurfacePointRuntime({...options,coverage:'tracked'});
  const p=this.config.points,d=this.config.domain,count=p.uSegments*p.vSegments;
  if(options.coverage==='all')options.reserve?.(count*12);
  this.seeds=new Float32Array(options.coverage==='all'?count*4:0);this.tint=new Float32Array(this.seeds.length);
  if(options.coverage==='all'){
   const colors=prepareSourceSurfaceColors(options.palette,p.uSegments,p.vSegments,d.periodicU);this.diagnostics=[...colors.diagnostics];
   for(let i=0;i<count;i++){
    if((i&1023)===0&&options.isCancelled?.())throw new DOMException('GPU 曲面种子生成已取消','AbortError');
    const at=i*4;this.seeds[at]=sourceSurfaceParticleStart(Math.fround(d.uMin),Math.fround(d.uMax),Math.floor(i/p.vSegments),p.uSegments);this.seeds[at+1]=sourceSurfaceParticleStart(Math.fround(d.vMin),Math.fround(d.vMax),i%p.vSegments,p.vSegments);this.seeds[at+2]=this.config.tracking.speedU;this.seeds[at+3]=this.config.tracking.speedV;
    writeSourcePackedColor(colors.packed[i],this.tint,at);
   }
  }else this.diagnostics=[];
 }
 bind(request:OrdinaryCameraTargetRequest){return this.tracking.bind(request);}
 update(frame:OrdinaryCameraParticleFrame){this.tracking.update(frame);}
 setRecordingTrails(enabled:boolean){this.tracking.setRecordingTrails(enabled);}
 beginGradientActions(actions:readonly SourceGradientAction[]){this.tracking.beginGradientActions(actions);}
 interpolateGradientActions(eased:number,finished:boolean){this.tracking.interpolateGradientActions(eased,finished);}
 beginParameterActions(actions:readonly SourceOscillatingParameterAction[]){this.tracking.beginParameterActions(actions);}
 interpolateParameterActions(eased:number,finished:boolean){this.tracking.interpolateParameterActions(eased,finished);}
 beginParameterClip(parameters:readonly ({name:string}&SourceOscillatingParameterConfiguration)[]){this.tracking.beginParameterClip(parameters);}
 finishParameterClip(){this.tracking.finishParameterClip();}
 retire(){this.tracking.retire();}
 snapshot():{frame:SourceSurfaceGpuPointFrame;diagnostics:string[]}{
  if(this.options.coverage!=='all')throw new Error('GPU 相机查询不能交付完整绘制数据');
  const parameters=this.prepared.uniforms(name=>this.surfaceFunction.read(name));if(!parameters.ok)throw new Error(`GPU 曲面参数：${parameters.error.reason}`);
  const d=this.config.domain;
  return{frame:{model:'surface-gpu-points-1.7.8',seeds:this.seeds.slice(),tint:this.tint.slice(),functionBody:this.prepared.functionBody,parameters:parameters.value,scale:this.prepared.scales,offset:this.prepared.offsets,time:this.tracking.currentAnimationTime,uLimits:[Math.fround(d.uMin),Math.fround(d.uMax)],vLimits:[Math.fround(d.vMin),Math.fround(d.vMax)],periodic:[Number(d.periodicU),Number(d.periodicV)],flowing:[Number(d.flowingU),Number(d.flowingV)],fadePoints:this.config.points.fadePoints},diagnostics:[...this.diagnostics,...this.tracking.parameterDiagnostics]};
 }
}
