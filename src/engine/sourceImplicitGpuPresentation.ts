import type {ImplicitJob} from './implicitSurface';
import type {SourceImplicitCommonPresentation} from './sourceImplicitPresentation';
import type {SourceImplicitField} from './sourceImplicitField';
import {sourceImplicitMeshRoute} from './sourceImplicitIdentity';
import {sourceConfigPackedColor} from './sourceConfigColor';

export const SOURCE_IMPLICIT_GPU_PRESENTATION='mathart-1.7.8-gpu-material-v1' as const;
export interface SourceImplicitGpuMaterial {
 readonly shininess:number;
 readonly ambient:number;
 readonly specular:number;
 readonly proceduralTextureType:0|1|2|3|4;
}
export interface SourceImplicitGpuPresentation extends SourceImplicitCommonPresentation {
 readonly model:typeof SOURCE_IMPLICIT_GPU_PRESENTATION;
 readonly meshMode:'GPU'|'AUTO';
 /** Actual mathematics remains the source CPU fallback. A GPU material does
  * not establish a working OpenGL 4.3 Compute Shader implementation. */
 readonly meshComputation:'source-cpu-fallback';
 readonly fillOpacity:number;
 readonly palette:Uint32Array;
 readonly boundsMin:readonly [number,number,number];
 readonly boundsMax:readonly [number,number,number];
 readonly material:SourceImplicitGpuMaterial;
}
const F=Math.fround;
const finite=(value:unknown,label:string):number=>{if(typeof value!=='number'||!Number.isFinite(F(value)))throw Error(`源隐式材质 ${label} 必须为有限 Float32 数值`);return F(value);};
const color=(value:unknown):number=>{if(typeof value!=='string')throw Error('源隐式材质颜色需要源颜色字符串');return sourceConfigPackedColor(value);};
/** Cold import owns the fixed original defaults; explicitly applied local
 * material edits represent the original updateMeshSettings setter values.
 * Keep these facts on the generated frame, never consult a staged inspector
 * document from either drawing adapter. */
export function prepareSourceImplicitGpuPresentation(job:ImplicitJob,field:SourceImplicitField,common:SourceImplicitCommonPresentation,palette:readonly number[]):SourceImplicitGpuPresentation {
 const route=sourceImplicitMeshRoute(job.scene);
 if(!route||route.presentation!=='gpu-material'||route.requestedMeshMode==='CPU')throw Error('源隐式 GPU 材质需要对应的源网格请求');
 const s=job.scene.settings,texture=s.proceduralTexture??'none',types={none:0,checker:1,metal:2,ceramic:3,carbon:4} as const;
 if(typeof texture!=='string'||!Object.hasOwn(types,texture))throw Error('未知源隐式程序纹理');
 const opacity=finite(s.opacity??1,'opacity');if(opacity<0||opacity>1)throw Error('源隐式材质透明度越界');
 if(palette.length>65536||palette.some(p=>!Number.isInteger(p)||p<0||p>0xffffffff))throw Error('源隐式材质调色板无效');
 const world=(v:readonly number[])=>v.map((value,axis)=>F(F(value*field.scale[axis])+field.offset[axis])) as [number,number,number];
 return {...common,model:SOURCE_IMPLICIT_GPU_PRESENTATION,meshMode:route.requestedMeshMode,meshComputation:'source-cpu-fallback',fillOpacity:opacity,palette:Uint32Array.from(palette),boundsMin:world(field.min),boundsMax:world(field.max),material:{
  shininess:Math.max(0,Math.min(100,finite(s.shininess??32,'shininess'))),ambient:color(s.ambient??'#4d4d4d'),specular:color(s.specular??'#ffffff'),proceduralTextureType:types[texture as keyof typeof types],
 }};
}
