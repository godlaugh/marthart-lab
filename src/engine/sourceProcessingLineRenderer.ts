import * as THREE from 'three';
import type {SourceCameraPlan} from './sourceCamera';
import type {SourceParticleTrails} from './sourceParticleTrails';
import {writeSourcePackedColor} from './sourceProcessingGeometry';

import {sourceProcessingLineBuffers,sourceProcessingLineVertex,sourceProcessingLineFragment,sourceProcessingLineDisplay} from './sourceProcessingStroke';
export {sourceProcessingLineBuffers} from './sourceProcessingStroke';

const F=Math.fround;
export interface SourceProcessingLineInput {
 readonly positions:Float32Array;readonly lineWidth:number;readonly indices?:Uint32Array;
 readonly color:{readonly kind:'packed';readonly packed:number}|{readonly kind:'vertices';readonly rgb:Float32Array;readonly alphas:Float32Array};
}
/** Owns all expanded CPU and GPU resources for the shared Processing LINES path. */
export function createSourceProcessingLines(input:SourceProcessingLineInput,plan:SourceCameraPlan,displayOpacity=1,overlay=false):THREE.Mesh<THREE.BufferGeometry,THREE.RawShaderMaterial> {
 if(!Number.isFinite(displayOpacity)||displayOpacity<0||displayOpacity>1)throw new Error('源 Processing 线条显示透明度无效');
 const display=sourceProcessingLineDisplay(plan);
 const color=input.color;
 if(color.kind==='packed'){
  if(!Number.isInteger(color.packed)||color.packed< -2147483648||color.packed>4294967295)throw new Error('源 Processing 线条颜色无效');
 }else if(color.kind==='vertices'){
  if(!(input.positions instanceof Float32Array)||!(color.rgb instanceof Float32Array)||!(color.alphas instanceof Float32Array)||color.rgb.length!==input.positions.length||color.alphas.length!==input.positions.length/3)throw new Error('源 Processing 顶点颜色缓冲无效');
  for(const values of [color.rgb,color.alphas])for(const value of values)if(!Number.isFinite(value)||value<0||value>1)throw new Error('源 Processing 顶点颜色必须在 0 至 1 范围');
 }else throw new Error('未知源 Processing 线条颜色类型');
 const buffers=sourceProcessingLineBuffers(input.positions,input.lineWidth,plan,input.indices),count=buffers.positions.length/16,colors=new Float32Array(buffers.positions.length);
 if(color.kind==='packed')for(let o=0;o<colors.length;o+=4)writeSourcePackedColor(color.packed,colors,o,displayOpacity);
 else for(let pair=0;pair<count;pair++)for(let v=0;v<4;v++){
  const endpoint=pair*2+(v<2?0:1),index=input.indices?input.indices[endpoint]:endpoint,o=pair*16+v*4;
  colors[o]=color.rgb[index*3];colors[o+1]=color.rgb[index*3+1];colors[o+2]=color.rgb[index*3+2];colors[o+3]=F(color.alphas[index]*displayOpacity);
 }
 const geometry=new THREE.BufferGeometry();let material:THREE.RawShaderMaterial|undefined;
 try{
  geometry.setAttribute('position',new THREE.BufferAttribute(buffers.positions,4));
  geometry.setAttribute('direction',new THREE.BufferAttribute(buffers.directions,4));
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,4));
  geometry.setIndex(new THREE.BufferAttribute(buffers.indices,1));
  geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),0);
  material=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:sourceProcessingLineVertex,fragmentShader:sourceProcessingLineFragment,
   side:THREE.DoubleSide,forceSinglePass:true,transparent:true,depthTest:!overlay,depthWrite:!overlay,depthFunc:THREE.LessEqualDepth,toneMapped:false,
   blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendEquationAlpha:THREE.AddEquation,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneFactor,
   uniforms:{lineModelview:{value:new THREE.Matrix4()},projection:{value:new THREE.Matrix4().fromArray(plan.projection.columnMajor)},viewport:{value:new THREE.Vector4(...display.viewport)},perspective:{value:display.perspective},scale:{value:new THREE.Vector3(...display.scale)}}});
  const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.renderOrder=1;mesh.userData.sourceProcessingLines=true;return mesh;
 }catch(error){geometry.dispose();material?.dispose();throw error;}
}

/** ParticleSystemMobject.drawTrailsLines consumes already-normalized RGB/alpha
 * from the history owner, and StrangeAttractor.drawTrailsOverlay disables depth
 * testing. Every supplied index pair remains an independent Processing LINES
 * primitive, including duplicates, reversed pairs and shared endpoints. */
export function createSourceParticleTrailLines(trails:Pick<SourceParticleTrails,'positions'|'colors'|'alphas'|'indices'>,width:number,plan:SourceCameraPlan,displayOpacity=1):THREE.Mesh<THREE.BufferGeometry,THREE.RawShaderMaterial> {
 if(!(trails.indices instanceof Uint32Array))throw new Error('源粒子轨迹必须提供 Uint32 索引');
 const mesh=createSourceProcessingLines({positions:trails.positions,indices:trails.indices,lineWidth:width,color:{kind:'vertices',rgb:trails.colors,alphas:trails.alphas}},plan,displayOpacity,true);
 mesh.userData.sourceParticleTrailLines=true;return mesh;
}
