import * as THREE from 'three';
import type {SourceCameraPlan} from './sourceCamera';
import type {SourceSurfaceMeshWireframeFrame} from './sourceSurfaceMeshWireframe';
import {writeSourceEyePosition,writeSourcePackedColor} from './sourceProcessingGeometry';

const F=Math.fround;
// Four vec4 positions, directions and colors, plus six uint32 indices per pair.
// Charge the complete renderer allocation even when only requesting geometry.
const BYTES_PER_PAIR=4*4*4*3+6*4,MAX_BUFFER_BYTES=256*1024*1024;
function pairCount(frame:SourceSurfaceMeshWireframeFrame):number {
 const count=frame.positions.length/6;
 if(!(frame.positions instanceof Float32Array)||!Number.isInteger(count)||count*BYTES_PER_PAIR>MAX_BUFFER_BYTES)throw new Error('源曲面线框缓冲无效或展开后超过 256 MiB 本地容量');
 if(!Number.isFinite(F(frame.lineWidth))||frame.lineWidth<=0||!Number.isInteger(frame.packedColor)||frame.packedColor< -2147483648||frame.packedColor>4294967295)throw new Error('源曲面线框宽度或颜色无效');
 return count;
}
/** PGraphicsOpenGL.matrixScale(PMatrix3D): determinant rounded at each float
 * operation, followed by Math.pow(double, widened float 1/3), then float. */
function transformScale(m:readonly number[]):number {
 const a=F(m[0]*F(F(m[5]*m[10])-F(m[6]*m[9])));
 const b=F(m[1]*F(F(m[6]*m[8])-F(m[4]*m[10])));
 const c=F(m[2]*F(F(m[4]*m[9])-F(m[5]*m[8])));
 return F(Math.pow(Math.abs(F(F(a+b)+c)),0.3333333432674408));
}
/** Independent LINES emit A+, A-, B-, B+; no line-strip joins or caps.
 * Directions are transformed raw endpoint differences, never eyeB-eyeA.
 * Nonfinite endpoint arithmetic is retained just like source tessellation. */
export function sourceSurfaceLineBuffers(frame:SourceSurfaceMeshWireframeFrame,plan:SourceCameraPlan):{positions:Float32Array;directions:Float32Array;indices:Uint32Array} {
 const count=pairCount(frame),m=plan.modelView.rowMajor,input=frame.positions;
 const halfWidth=F(F(F(frame.lineWidth)*transformScale(m))/2);
 const positions=new Float32Array(count*16),directions=new Float32Array(count*16),indices=new Uint32Array(count*6);
 for(let pair=0;pair<count;pair++){
  const p=pair*6,base=pair*16;
  for(let v=0;v<4;v++){
   const a=p+(v<2?0:3),b=p+(v<2?3:0),o=base+v*4;
   writeSourceEyePosition(m,input[a],input[a+1],input[a+2],positions,o);
   const dx=F(input[b]-input[a]),dy=F(input[b+1]-input[a+1]),dz=F(input[b+2]-input[a+2]);
   for(let row=0;row<3;row++){
    const k=row*4;
    directions[o+row]=F(F(F(dx*m[k])+F(dy*m[k+1]))+F(dz*m[k+2]));
   }
   directions[o+3]=v===0||v===3?halfWidth:-halfWidth;
  }
  const i=pair*6,v=pair*4;
  indices[i]=v;indices[i+1]=v+1;indices[i+2]=v+2;indices[i+3]=v+2;indices[i+4]=v+1;indices[i+5]=v+3;
 }
 return {positions,directions,indices};
}

// Adapted from Processing LineVert/LineFrag, Processing Foundation (2012–21),
// Ben Fry/Casey Reas (2004–12), MIT (2001–04), LGPL-2.1-or-later.
// Preserve shader operations including identity modelview multiplication and
// perspective mix. Immediate flush has already baked the CPU modelview.
const vertex=`precision highp float;
precision highp int;
uniform mat4 lineModelview;
uniform mat4 projection;
uniform vec4 viewport;
uniform int perspective;
uniform vec3 scale;
in vec4 position;
in vec4 color;
in vec4 direction;
out vec4 vertColor;
void main(){
 vec4 posp=lineModelview*position;
 vec4 posq=lineModelview*(position+vec4(direction.xyz,0));
 posp.xyz=posp.xyz*scale;
 posq.xyz=posq.xyz*scale;
 vec4 p=projection*posp;
 vec4 q=projection*posq;
 vec2 tangent=(q.xy*p.w-p.xy*q.w)*viewport.zw;
 tangent=length(tangent)==0.0?vec2(0.0,0.0):normalize(tangent);
 vec2 normal=vec2(-tangent.y,tangent.x);
 float thickness=direction.w;
 vec2 offset=normal*thickness;
 vec2 perspScale=(projection*vec4(1,-1,0,0)).xy;
 vec2 noPerspScale=p.w/(0.5*viewport.zw);
 gl_Position.xy=p.xy+offset.xy*mix(noPerspScale,perspScale,float(perspective>0));
 gl_Position.zw=p.zw;
 vertColor=color;
}`;
const fragment=`precision mediump float;
precision mediump int;
in vec4 vertColor;
out vec4 fragmentColor;
void main(){fragmentColor=vertColor;}`;

/** Default CPU MeshSurface Processing line path. Hint6/7 remain disabled in the
 * inspected source path. Logical viewport dimensions control extrusion; raster
 * density belongs to the render target. Own all expanded CPU/GPU resources. */
export function createSourceSurfaceMeshLines(frame:SourceSurfaceMeshWireframeFrame,plan:SourceCameraPlan,displayOpacity=1):THREE.Mesh<THREE.BufferGeometry,THREE.RawShaderMaterial> {
 if(!Number.isFinite(displayOpacity)||displayOpacity<0||displayOpacity>1)throw new Error('源曲面线框显示透明度无效');
 if(plan.viewport.projectionPass==='unknown')throw new Error('源曲面线框投影状态未知');
 const buffers=sourceSurfaceLineBuffers(frame,plan),colors=new Float32Array(buffers.positions.length);
 for(let o=0;o<colors.length;o+=4)writeSourcePackedColor(frame.packedColor,colors,o,displayOpacity);
 const geometry=new THREE.BufferGeometry();let material:THREE.RawShaderMaterial|undefined;
 try{
  geometry.setAttribute('position',new THREE.BufferAttribute(buffers.positions,4));
  geometry.setAttribute('direction',new THREE.BufferAttribute(buffers.directions,4));
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,4));
  geometry.setIndex(new THREE.BufferAttribute(buffers.indices,1));
  geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),0);
  const ortho=plan.viewport.projectionPass==='scene-fade-orthographic',s=F(.999);
  material=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:vertex,fragmentShader:fragment,
   side:THREE.DoubleSide,forceSinglePass:true,transparent:true,depthTest:true,depthWrite:true,depthFunc:THREE.LessEqualDepth,toneMapped:false,
   blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendEquationAlpha:THREE.AddEquation,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneFactor,
   uniforms:{lineModelview:{value:new THREE.Matrix4()},projection:{value:new THREE.Matrix4().fromArray(plan.projection.columnMajor)},viewport:{value:new THREE.Vector4(0,0,plan.viewport.logicalWidth,plan.viewport.logicalHeight)},perspective:{value:0},scale:{value:new THREE.Vector3(ortho?1:s,ortho?1:s,s)}}});
  const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.renderOrder=1;mesh.userData.sourceSurfaceMeshLines=true;return mesh;
 }catch(error){geometry.dispose();material?.dispose();throw error;}
}
