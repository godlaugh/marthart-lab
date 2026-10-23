import * as THREE from 'three';
import {createSourceShaderMaterial} from './sourceShaderMaterial';
import type {SourceSurfaceGpuMeshFrame} from './sourceSurfaceGpuMesh';
import type {SourceCameraPlan} from './sourceCamera';
import {SOURCE_SURFACE_MESH_MATERIAL_DEFAULTS as defaults} from './sourceSurfaceMeshConfig';
import {sourceParticleLineScale} from './sourceParticlePointAppearance';
import {writeSourcePackedColor} from './sourceProcessingGeometry';
import {sourceSurfaceGpuMeshVertex,sourceSurfaceGpuMeshFragment} from './sourceSurfaceGpuMeshShader';

type SourceGpuMesh=THREE.Mesh<THREE.BufferGeometry,THREE.RawShaderMaterial>;
export interface SourceSurfaceGpuMeshObjects {fill?:SourceGpuMesh;wire?:SourceGpuMesh}
const F=Math.fround,MAX_VERTICES=512*512+4*511+4,MAX_INDICES=6*512*512;
/** Uniform setters receive ARGB components directly. Unlike PShape.fill(int),
 * an alpha-zero integer <=255 is not reinterpreted as opaque grayscale here. */
function uniformRgba(packed:number,opacity=1):number[]{return[F(((packed>>>16)&255)/255),F(((packed>>>8)&255)/255),F((packed&255)/255),F(F((packed>>>24)/255)*opacity)];}
function validate(frame:SourceSurfaceGpuMeshFrame,opacity:number):void {
 const count=frame.seeds.length/4;
 if(frame.model!=='surface-gpu-mesh-1.7.8'||!(frame.seeds instanceof Float32Array)||!(frame.triangles instanceof Uint32Array)||!(frame.packedColors instanceof Uint32Array)||!Number.isInteger(count)||count>MAX_VERTICES||frame.packedColors.length!==count||frame.triangles.length%3||frame.triangles.length>MAX_INDICES)throw new Error('GPU 曲面网格形状缓冲无效或超过本地容量');
 if(!(frame.parameters instanceof Float32Array)||frame.parameters.length!==32||frame.scale.length!==3||frame.offset.length!==3||frame.uLimits.length!==2||frame.vLimits.length!==2||frame.periodic.length!==2||frame.flowing.length!==2)throw new Error('GPU 曲面网格 uniform 布局无效');
 if(typeof frame.functionBody!=='string'||frame.functionBody.length>131072)throw new Error('GPU 曲面网格函数文本无效或超过容量');
 if(!Number.isFinite(opacity)||opacity<0||opacity>1||!Number.isFinite(frame.fillOpacity)||frame.fillOpacity<0||frame.fillOpacity>1||!Number.isFinite(F(frame.lineWeight))||!Number.isInteger(frame.wireframeColor)||frame.wireframeColor<0||frame.wireframeColor>0xffffffff)throw new Error('GPU 曲面网格样式数值无效');
 for(const flag of [frame.fillEnabled,frame.wireframeEnabled,frame.wireframeDecoupled,frame.twistedU,frame.twistedV])if(typeof flag!=='boolean')throw new Error('GPU 曲面网格开关无效');
 for(const flag of [...frame.periodic,...frame.flowing])if(flag!==0&&flag!==1)throw new Error('GPU 曲面网格周期标志无效');
 for(const value of [...frame.parameters,...frame.scale,...frame.offset,frame.time,...frame.uLimits,...frame.vLimits])if(!Number.isFinite(F(value)))throw new Error('GPU 曲面网格 uniform 需要有限 Float32 数值');
 for(const value of frame.seeds)if(!Number.isFinite(value))throw new Error('GPU 曲面网格种子需要有限值；公式产生非有限坐标由 GPU 处理');
 for(const index of frame.triangles)if(index>=count)throw new Error('GPU 曲面网格索引越界');
}

/** Native GPU fill and coupled wire use the same retained mathematical shader.
 * Both passes expand native triangle corners; wire carries RGB barycentrics. Caller owns both independent materials/geometries. */
export function createSourceSurfaceGpuMesh(frame:SourceSurfaceGpuMeshFrame,plan:SourceCameraPlan,displayOpacity=1):SourceSurfaceGpuMeshObjects {
 validate(frame,displayOpacity);const objects:SourceSurfaceGpuMeshObjects={};
 if(!frame.triangles.length)return objects;
 const {displayScale}=sourceParticleLineScale(plan,frame.referencePixelDensity),thickness=Math.max(F(.1),F(F(frame.lineWeight)*displayScale));
 const wireColor=uniformRgba(frame.wireframeColor,displayOpacity),ambient=uniformRgba(defaults.materialAmbientColor),specular=uniformRgba(defaults.materialSpecularColor);
 const make=(wire:boolean):SourceGpuMesh=>{
  const geometry=new THREE.BufferGeometry();let material:THREE.RawShaderMaterial|undefined;
  // Three binds a 1x1 transparent-black texture for a null sampler. Own the
  // same texel explicitly so both adapters receive defined sampler content.
  // Filtering is immaterial for a constant 1x1 image; use the shared contract.
  const texture=new THREE.DataTexture(new Uint8Array(4),1,1,THREE.RGBAFormat);
  texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;
  try{
   // MeshSurface emits fresh PShape.vertex entries for every triangle corner.
   // Sharing a grid vertex changes raster interpolation/derivative rounding on
   // real drivers, and observably changes geometric-normal lighting.
   const seeds=new Float32Array(frame.triangles.length*4),colors=new Float32Array(seeds.length),indices=new Uint32Array(frame.triangles.length);
   for(let i=0;i<frame.triangles.length;i++){
    const source=frame.triangles[i]*4,at=i*4;seeds.set(frame.seeds.subarray(source,source+4),at);indices[i]=i;
    if(wire){colors[at+i%3]=1;colors[at+3]=1;}else writeSourcePackedColor(frame.packedColors[frame.triangles[i]],colors,at);
   }
   geometry.setAttribute('position',new THREE.BufferAttribute(seeds,4));geometry.setAttribute('color',new THREE.BufferAttribute(colors,4));geometry.setIndex(new THREE.BufferAttribute(indices,1));
   geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),0);
   material=createSourceShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:sourceSurfaceGpuMeshVertex(frame.functionBody),fragmentShader:sourceSurfaceGpuMeshFragment,side:THREE.DoubleSide,forceSinglePass:true,transparent:true,depthTest:true,depthWrite:true,toneMapped:false,
    blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendEquationAlpha:THREE.AddEquation,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneFactor,
    uniforms:{transform:{kind:'mat4',value:new THREE.Matrix4().fromArray(plan.transform.columnMajor)},modelview:{kind:'mat4',value:new THREE.Matrix4().fromArray(plan.modelView.columnMajor)},time:{kind:'float',value:frame.time},surfaceScale:{kind:'vec3',value:frame.scale},surfaceOffset:{kind:'vec3',value:frame.offset},uLimits:{kind:'vec2',value:frame.uLimits},vLimits:{kind:'vec2',value:frame.vLimits},isPeriodic:{kind:'ivec2',value:frame.periodic},isFlowing:{kind:'ivec2',value:frame.flowing},isTwistedU:{kind:'int',value:frame.twistedU?1:0},isTwistedV:{kind:'int',value:frame.twistedV?1:0},params:{kind:'float-array',count:32,value:frame.parameters},useWireframe:{kind:'int',value:wire?1:0},meshFillColor:{kind:'vec4',value:[1,1,1,1]},meshFillOpacity:{kind:'float',value:F(F(frame.fillOpacity)*F(displayOpacity))},meshWireframeColor:{kind:'vec4',value:wireColor},wireframeThickness:{kind:'float',value:thickness},wireframeFeather:{kind:'float',value:defaults.wireframeFeather},wireframeDepthBias:{kind:'float',value:defaults.wireframeDepthBias},wireframeDistanceScale:{kind:'float',value:defaults.wireframeDistanceScale},wireframeDistanceMin:{kind:'float',value:defaults.wireframeDistanceMin},wireframeDistanceMax:{kind:'float',value:defaults.wireframeDistanceMax},wireframeFresnelPower:{kind:'float',value:defaults.wireframeFresnelPower},wireframeFresnelStrength:{kind:'float',value:defaults.wireframeFresnelStrength},enableLighting:{kind:'int',value:wire?0:1},lightDir:{kind:'vec3',value:[.5,.5,1]},materialShininess:{kind:'float',value:defaults.materialShininess},materialAmbient:{kind:'vec3',value:ambient.slice(0,3)},materialSpecular:{kind:'vec3',value:specular.slice(0,3)},proceduralTextureType:{kind:'int',value:0},useTexture:{kind:'int',value:0},texMap:{kind:'sampler2d',value:texture}}});
   material.addEventListener('dispose',()=>texture.dispose());
   const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.renderOrder=wire?1:0;mesh.userData.sourceSurfaceGpuMesh=true;mesh.userData.sourceSurfaceGpuWire=wire;return mesh;
  }catch(error){geometry.dispose();if(material)material.dispose();else texture.dispose();throw error;}
 };
 try{
  if(frame.fillEnabled)objects.fill=make(false);
  // Native decoupled LINES shapes call noStroke; Processing tessellation emits
  // no visible primitives. Do not replace that path with local line segments.
  if(frame.wireframeEnabled&&!frame.wireframeDecoupled)objects.wire=make(true);
  return objects;
 }catch(error){objects.fill?.geometry.dispose();objects.fill?.material.dispose();objects.wire?.geometry.dispose();objects.wire?.material.dispose();throw error;}
}
