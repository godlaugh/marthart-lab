import * as THREE from 'three';
import type {SceneOutput} from '../types';
import type {SourceCameraPlan} from './sourceCamera';
import {SOURCE_IMPLICIT_PRESENTATION} from './sourceImplicitPresentation';
import {writeSourceEyePosition} from './sourceProcessingGeometry';
import {createSourceProcessingLines} from './sourceProcessingLineRenderer';
import {IMPLICIT_WORK_BYTES} from './meshEdges';

/** CPU implicit fill uses Processing's unlit immediate Color shader. Its
 * contour PShape owns its original stroke weight: the later strokeWeight call
 * outside beginShape is rejected by Processing, so getLineScale has no effect.
 * Export's camera plan is expressed in physical pixels; its retained primary
 * density converts that original logical stroke width exactly once. */
export function createSourceImplicitMesh(output:Extract<SceneOutput,{type:'geometry'}>,plan:SourceCameraPlan){
 const facts=output.sourceImplicitPresentation,count=output.positions.length/3,indices=output.indices;
 if(!facts||facts.model!==SOURCE_IMPLICIT_PRESENTATION||output.topology!=='mesh'||output.backend!=='cpu'||!Number.isInteger(count)||(indices?indices.length%3:count%3)||facts.fillColors.length!==count*4)throw Error('源隐式曲面显示与网格不匹配');
 const wire=facts.wire;
 const retained=output.positions.byteLength+(indices?.byteLength??0)+(output.sourceImplicitMesh?.normals.byteLength??0)+facts.fillColors.byteLength+(wire?wire.positions.byteLength+wire.colors.byteLength+wire.alphas.byteLength:0);
 // Account for retained frame, CPU eye vertices, compact line instances and
 // their RGBA stream before allocation. GPU memory/process RSS is not claimed.
 if(retained+count*16+(wire?wire.positions.length/6*96:0)>IMPLICIT_WORK_BYTES)throw Error('源隐式曲面渲染缓冲超过 256 MiB 容量');
 for(const index of indices??[])if(index>=count)throw Error('源隐式曲面索引越界');
 for(const value of facts.fillColors)if(!Number.isFinite(value)||value<0||value>1)throw Error('源隐式曲面填充颜色无效');
 if(typeof facts.fill!=='boolean'||!Number.isFinite(facts.referencePixelDensity)||facts.referencePixelDensity<=0)throw Error('源隐式曲面显示参数无效');
 const geometry=new THREE.BufferGeometry();let material:THREE.RawShaderMaterial|undefined,lines:ReturnType<typeof createSourceProcessingLines>|undefined;
 try{
  const eye=new Float32Array(count*4);for(let i=0;i<count;i++)writeSourceEyePosition(plan.modelView.rowMajor,output.positions[i*3],output.positions[i*3+1],output.positions[i*3+2],eye,i*4);
  geometry.setAttribute('position',new THREE.BufferAttribute(eye,4));geometry.setAttribute('color',new THREE.BufferAttribute(facts.fillColors,4));if(indices)geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),0);
  material=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,
   vertexShader:'precision highp float; uniform mat4 projection; in vec4 position; in vec4 color; out vec4 fillColor; void main(){gl_Position=projection*position;fillColor=color;}',
   fragmentShader:'precision highp float; in vec4 fillColor; out vec4 fragmentColor; void main(){fragmentColor=fillColor;}',
   side:THREE.DoubleSide,forceSinglePass:true,transparent:true,depthTest:true,depthWrite:true,depthFunc:THREE.LessEqualDepth,toneMapped:false,
   blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendEquationAlpha:THREE.AddEquation,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneFactor,
   uniforms:{projection:{value:new THREE.Matrix4().fromArray(plan.projection.columnMajor)}}});
  const fill=new THREE.Mesh(geometry,material);fill.frustumCulled=false;fill.visible=facts.fill;
  if(wire)lines=createSourceProcessingLines({mode:'retained',positions:wire.positions,lineWidth:Math.fround(facts.lineWeight*(plan.viewport.target==='offscreen'?facts.referencePixelDensity:1)),color:{kind:'vertices',rgb:wire.colors,alphas:wire.alphas}},plan);
  return{fill,lines};
 }catch(error){geometry.dispose();material?.dispose();lines?.geometry.dispose();lines?.material.dispose();throw error;}
}
