import {sourceSurfaceGpuPointVertex} from './sourceSurfaceGpuPointShader';
import * as THREE from 'three';
import type {GeometryOutput} from '../types';
import type {SourceCameraPlan} from './sourceCamera';
import {SOURCE_SURFACE_POINT_MODEL,sourceSurfacePointSprite} from './sourceSurfacePointAppearance';
import {sourcePointVertex,sourcePointFragment} from './sourceSurfacePointShaders';

/** One instance per particle, rather than four copied positions/colors per quad.
 * The material owns the sprite texture; ArtRenderer's normal material disposal
 * releases it. All source buffers are read-only borrowed output arrays. */
export function createSourceSurfacePoints(output:GeometryOutput,plan:SourceCameraPlan,opacity:number){
 const appearance=output.sourcePointAppearance,gpu=output.sourceGpuPoints,count=gpu?gpu.seeds.length/4:output.positions.length/3;
 if(!appearance||appearance.model!==SOURCE_SURFACE_POINT_MODEL||output.topology!=='points'||!Number.isInteger(count)||count>512*512||(!gpu&&(output.colors?.length!==count*3||output.pointAlphas?.length!==count)))throw new Error('源曲面点外观与粒子缓冲不匹配或超过本地容量');
 if(!Number.isFinite(appearance.radius)||!Number.isFinite(appearance.focalLength)||appearance.focalLength<=0||!Number.isFinite(opacity)||opacity<0||opacity>1)throw new Error('源曲面点外观数值无效');
 if(gpu&&(gpu.model!=='surface-gpu-points-1.7.8'||gpu.tint.length!==count*4||gpu.parameters.length!==32||gpu.scale.length!==3||gpu.offset.length!==3||output.positions.length!==0))throw new Error('GPU 曲面点参数缓冲无效');
 if(gpu&&[...gpu.parameters,...gpu.scale,...gpu.offset,gpu.time,...gpu.uLimits,...gpu.vLimits].some(n=>!Number.isFinite(n)))throw new Error('GPU 曲面参数需要有限值');
 if(!gpu)for(let i=0;i<count;i++)if(!Number.isFinite(output.pointAlphas![i])||output.pointAlphas![i]<0||output.pointAlphas![i]>1)throw new Error('逐点透明度必须在 0 至 1 之间');
 const geometry=new THREE.InstancedBufferGeometry(),texture=new THREE.DataTexture(sourceSurfacePointSprite(),64,64,THREE.RGBAFormat);
 let material:THREE.RawShaderMaterial|undefined;
 try{
  geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(12),3));
  geometry.setAttribute('uv',new THREE.BufferAttribute(new Float32Array([0,0,1,0,1,1,0,1]),2));
  geometry.setIndex([0,1,2,0,2,3]);geometry.instanceCount=count;
  if(gpu){geometry.setAttribute('particleSeed',new THREE.InstancedBufferAttribute(gpu.seeds,4));geometry.setAttribute('particleTint',new THREE.InstancedBufferAttribute(gpu.tint,4));}
  else {geometry.setAttribute('particlePosition',new THREE.InstancedBufferAttribute(output.positions,3));
  geometry.setAttribute('particleColor',new THREE.InstancedBufferAttribute(output.colors!,3));
  geometry.setAttribute('particleAlpha',new THREE.InstancedBufferAttribute(output.pointAlphas!,1));}
  // Processing default sampling=5, wrapping=0; ordinary PImage is not inverted.
  texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.flipY=false;texture.colorSpace=THREE.NoColorSpace;texture.needsUpdate=true;
  material=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:gpu?sourceSurfaceGpuPointVertex(gpu.functionBody):sourcePointVertex,fragmentShader:sourcePointFragment,side:THREE.DoubleSide,transparent:true,depthTest:true,depthWrite:true,toneMapped:false,
   // PGraphicsOpenGL BLEND: straight RGB over; alpha accumulates with ONE/ONE.
   blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendEquationAlpha:THREE.AddEquation,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneFactor,
   uniforms:{...(gpu?{time:{value:gpu.time},surfaceScale:{value:gpu.scale},surfaceOffset:{value:gpu.offset},uLimits:{value:gpu.uLimits},vLimits:{value:gpu.vLimits},isPeriodic:{value:gpu.periodic},isFlowing:{value:gpu.flowing},fadePoints:{value:gpu.fadePoints?1:0},params:{value:gpu.parameters}}:{}),projection:{value:new THREE.Matrix4().fromArray(plan.projection.columnMajor)},modelview:{value:new THREE.Matrix4().fromArray(plan.modelView.columnMajor)},radius:{value:appearance.radius},focalLength:{value:appearance.focalLength},sprite:{value:texture},opacity:{value:opacity},lightDir:{value:new THREE.Vector3()},materialShininess:{value:0},materialSpecular:{value:new THREE.Vector3()},specularStrength:{value:0}}});
  material.addEventListener('dispose',()=>texture.dispose());
  const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.userData.sourceSurfacePoints=true;mesh.userData.sourceSurfaceGpuPoints=!!gpu;return mesh;
 }catch(error){geometry.dispose();if(material)material.dispose();else texture.dispose();throw error;}
}
