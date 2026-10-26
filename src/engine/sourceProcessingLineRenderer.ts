import {createSourceShaderMaterial} from './sourceShaderMaterial';
import * as THREE from 'three';
import type {SourceCameraPlan} from './sourceCamera';
import type {SourceParticleTrails} from './sourceParticleTrails';
import {sourceProcessingRetainedLineInstances} from './sourceProcessingRetainedLine';
import {writeSourcePackedColor} from './sourceProcessingGeometry';

import {sourceProcessingLineInstances,sourceProcessingInstancedLineVertex,sourceProcessingLineFragment,sourceProcessingLineDisplay} from './sourceProcessingStroke';
export {sourceProcessingLineBuffers} from './sourceProcessingStroke';

const F=Math.fround;
export interface SourceProcessingLineInput {
 readonly positions:Float32Array;readonly lineWidth:number;readonly indices?:Uint32Array;
 /** Retained PShape LINES have a null shape matrix and defer modelview to GPU. */
 readonly mode?:'immediate'|'retained';readonly isCancelled?:()=>boolean;
 readonly color:{readonly kind:'packed';readonly packed:number}|{readonly kind:'vertices';readonly rgb:Float32Array;readonly alphas:Float32Array};
}
/** Owns compact instance CPU and GPU resources for the shared Processing LINES path. */
export function createSourceProcessingLines(input:SourceProcessingLineInput,plan:SourceCameraPlan,displayOpacity=1,overlay=false):THREE.Mesh<THREE.BufferGeometry,THREE.RawShaderMaterial> {
 if(!Number.isFinite(displayOpacity)||displayOpacity<0||displayOpacity>1)throw new Error('源 Processing 线条显示透明度无效');
 if(input.mode!==undefined&&input.mode!=='immediate'&&input.mode!=='retained')throw Error('未知源 Processing 线条模式');
 const retained=input.mode==='retained',display=sourceProcessingLineDisplay(plan);
 const check=()=>{if(retained&&input.isCancelled?.())throw new DOMException('源 retained 线条颜色处理已取消','AbortError');};check();
 const color=input.color;
 if(color.kind==='packed'){
  if(!Number.isInteger(color.packed)||color.packed< -2147483648||color.packed>4294967295)throw new Error('源 Processing 线条颜色无效');
 }else if(color.kind==='vertices'){
  if(!(input.positions instanceof Float32Array)||!(color.rgb instanceof Float32Array)||!(color.alphas instanceof Float32Array)||color.rgb.length!==input.positions.length||color.alphas.length!==input.positions.length/3)throw new Error('源 Processing 顶点颜色缓冲无效');
  for(const values of [color.rgb,color.alphas])for(let i=0;i<values.length;i++){if((i&4095)===0)check();const value=values[i];if(!Number.isFinite(value)||value<0||value>1)throw new Error('源 Processing 顶点颜色必须在 0 至 1 范围');}
 }else throw new Error('未知源 Processing 线条颜色类型');
 const buffers=retained?sourceProcessingRetainedLineInstances({...input,colorBuffers:color.kind==='vertices'?[color.rgb,color.alphas]:[]}):sourceProcessingLineInstances(input.positions,input.lineWidth,plan,input.indices),count=buffers.count,colors=new Float32Array(count*8);
 if(color.kind==='packed')for(let o=0;o<colors.length;o+=4){if((o&4095)===0)check();writeSourcePackedColor(color.packed,colors,o,displayOpacity);}
 else for(let pair=0;pair<count;pair++)for(let v=0;v<2;v++){
  if((pair&1023)===0)check();
  const endpoint=pair*2+v,index=input.indices?input.indices[endpoint]:endpoint,o=pair*8+v*4;
  colors[o]=color.rgb[index*3];colors[o+1]=color.rgb[index*3+1];colors[o+2]=color.rgb[index*3+2];colors[o+3]=F(color.alphas[index]*displayOpacity);
 }
 check();const geometry=new THREE.InstancedBufferGeometry();let material:THREE.RawShaderMaterial|undefined;
 try{
  geometry.setAttribute('strokeVertex',new THREE.BufferAttribute(new Float32Array([0,1,2,3]),1));
  const endpoints=new THREE.InstancedInterleavedBuffer(buffers.positions,8),directions=new THREE.InstancedInterleavedBuffer(buffers.directions,8),rgba=new THREE.InstancedInterleavedBuffer(colors,8);
  for(const [name,buffer]of [['endpoint',endpoints],['direction',directions],['color',rgba]] as const){
   geometry.setAttribute(name+'A',new THREE.InterleavedBufferAttribute(buffer,4,0));
   geometry.setAttribute(name+'B',new THREE.InterleavedBufferAttribute(buffer,4,4));
  }
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array([0,1,2,2,1,3]),1));geometry.instanceCount=count;
  geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),0);
  material=createSourceShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:sourceProcessingInstancedLineVertex,fragmentShader:sourceProcessingLineFragment,
   side:THREE.DoubleSide,forceSinglePass:true,transparent:true,depthTest:!overlay,depthWrite:!overlay,depthFunc:THREE.LessEqualDepth,toneMapped:false,
   blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendEquationAlpha:THREE.AddEquation,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneFactor,
   uniforms:{lineModelview:{kind:'mat4',value:retained?new THREE.Matrix4().fromArray(plan.modelView.columnMajor):new THREE.Matrix4()},projection:{kind:'mat4',value:new THREE.Matrix4().fromArray(plan.projection.columnMajor)},viewport:{kind:'vec4',value:new THREE.Vector4(...display.viewport)},perspective:{kind:'int',value:display.perspective},scale:{kind:'vec3',value:new THREE.Vector3(...display.scale)}}},{rangeIdentity:'attribute-only'});
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
