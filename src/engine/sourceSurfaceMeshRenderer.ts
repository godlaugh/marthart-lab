import * as THREE from 'three';
import type {GeometryOutput} from '../types';
import type {SourceCameraPlan} from './sourceCamera';
import {writeSourceEyePosition,writeSourcePackedColor} from './sourceProcessingGeometry';

export const SOURCE_SURFACE_CPU_MESH_MODEL='surface-cpu-mesh-1.7.8' as const;
export interface SourceSurfaceMeshAppearance {
 readonly model:typeof SOURCE_SURFACE_CPU_MESH_MODEL;
 readonly fillEnabled:boolean;
 /** MeshSurface replaces palette alpha with this truncated fill alpha. */
 readonly fillAlphaByte:number;
}
export function sourceSurfaceMeshAppearance(fillEnabled:boolean,fillOpacity:number):SourceSurfaceMeshAppearance {
 if(typeof fillEnabled!=='boolean'||!Number.isFinite(Math.fround(fillOpacity)))throw new Error('源曲面网格填充设置无效');
 const opacity=Math.max(0,Math.min(1,Math.fround(fillOpacity)));
 return Object.freeze({model:SOURCE_SURFACE_CPU_MESH_MODEL,fillEnabled,fillAlphaByte:Math.trunc(Math.fround(opacity*255))});
}
/** Native fill(int) interprets zero-alpha integers <=255 as grayscale, not as
 * packed transparent blue. Preserve the integer until this owning boundary;
 * reconstructing it from normalized RGB would lose that source distinction. */
export function sourceSurfaceMeshFillColors(packed:Uint32Array,fillAlphaByte:number,displayOpacity=1):Float32Array {
 if(packed.length>512*512+4*511+4||!Number.isInteger(fillAlphaByte)||fillAlphaByte<0||fillAlphaByte>255||!Number.isFinite(displayOpacity)||displayOpacity<0||displayOpacity>1)throw new Error('源曲面填充颜色容量或透明度无效');
 const colors=new Float32Array(packed.length*4);
 for(let i=0;i<packed.length;i++){
  writeSourcePackedColor((packed[i]&0xffffff)|(fillAlphaByte<<24),colors,i*4,displayOpacity);
 }
 return colors;
}

/** Immediate Processing tessellation bakes modelview into a vec4 CPU buffer.
 * flush then resets modelview and sends projection alone to ColorVert. Keeping
 * these staged float operations on the CPU is observably different from a
 * combined transform or modelview arithmetic inside a GPU shader. */
export function sourceMeshEyeVertices(positions:Float32Array,plan:SourceCameraPlan):Float32Array {
 const count=positions.length/3,m=plan.modelView.rowMajor;
 if(!Number.isInteger(count)||count>512*512+4*511+4)throw new Error('源曲面网格顶点超过本地容量或缓冲无效');
 const eye=new Float32Array(count*4);
 for(let i=0;i<count;i++)writeSourceEyePosition(m,positions[i*3],positions[i*3+1],positions[i*3+2],eye,i*4);
 return eye;
}
// Unlit ColorVert/ColorFrag behavior; no tone mapping or sRGB conversion. CPU
// MeshSurface.resetShader does not use the material/texture GPU mesh shader.
const vertex=`precision highp float;
uniform mat4 projection;
in vec4 position;
in vec4 color;
out vec4 meshColor;
void main(){gl_Position=projection*position;meshColor=color;}`;
const fragment=`precision highp float;
in vec4 meshColor;
out vec4 fragmentColor;
void main(){fragmentColor=meshColor;}`;

/** Borrow immutable index buffers; own CPU eye-space/RGBA buffers and
 * GPU resources. Caller owns disposal through ArtRenderer's ordinary path. */
export function createSourceSurfaceMeshFill(output:GeometryOutput,plan:SourceCameraPlan,displayOpacity=1){
 const appearance=output.sourceMeshAppearance,count=output.positions.length/3,indices=output.indices;
 if(!appearance||appearance.model!==SOURCE_SURFACE_CPU_MESH_MODEL||output.topology!=='mesh'||!Number.isInteger(count)||count>512*512+4*511+4||output.sourceMeshColors?.length!==count||!indices||indices.length%3||indices.length>6*512*512)throw new Error('源曲面网格填充与缓冲不匹配或超过本地容量');
 if(typeof appearance.fillEnabled!=='boolean'||!Number.isInteger(appearance.fillAlphaByte)||appearance.fillAlphaByte<0||appearance.fillAlphaByte>255||!Number.isFinite(displayOpacity)||displayOpacity<0||displayOpacity>1)throw new Error('源曲面网格填充透明度无效');
 for(const i of indices)if(i>=count)throw new Error('源曲面网格索引超出顶点缓冲');
 const geometry=new THREE.BufferGeometry();let material:THREE.RawShaderMaterial|undefined;
 try{
  geometry.setAttribute('position',new THREE.BufferAttribute(sourceMeshEyeVertices(output.positions,plan),4));
  geometry.setAttribute('color',new THREE.BufferAttribute(sourceSurfaceMeshFillColors(output.sourceMeshColors,appearance.fillAlphaByte,displayOpacity),4));
  geometry.setIndex(new THREE.BufferAttribute(indices,1));
  // Native topology can retain nonfinite unused vertices after skipping their
  // quads. Culling is disabled; avoid Three deriving an irrelevant NaN sphere.
  geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),0);
  material=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:vertex,fragmentShader:fragment,side:THREE.DoubleSide,forceSinglePass:true,transparent:true,depthTest:true,depthWrite:true,toneMapped:false,
   // PGraphicsOpenGL.BLEND keeps additive destination alpha (ONE, ONE).
   blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendEquationAlpha:THREE.AddEquation,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneFactor,
   uniforms:{projection:{value:new THREE.Matrix4().fromArray(plan.projection.columnMajor)}}});
  const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.visible=appearance.fillEnabled;mesh.userData.sourceSurfaceMeshFill=true;return mesh;
 }catch(error){geometry.dispose();material?.dispose();throw error;}
}
