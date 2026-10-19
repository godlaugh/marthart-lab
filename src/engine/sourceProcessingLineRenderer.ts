import * as THREE from 'three';
import type {SourceCameraPlan} from './sourceCamera';
import type {SourceParticleTrails} from './sourceParticleTrails';
import {writeSourceEyePosition,writeSourcePackedColor} from './sourceProcessingGeometry';

const F=Math.fround;
// Complete expanded position/direction/color vec4 arrays and uint32 triangles.
const BYTES_PER_PAIR=4*4*4*3+6*4,MAX_BUFFER_BYTES=256*1024*1024;
export interface SourceProcessingLineInput {
 readonly positions:Float32Array;readonly lineWidth:number;readonly indices?:Uint32Array;
 readonly color:{readonly kind:'packed';readonly packed:number}|{readonly kind:'vertices';readonly rgb:Float32Array;readonly alphas:Float32Array};
}
function pairCount(positions:Float32Array,width:number,indices?:Uint32Array):number {
 if(!(positions instanceof Float32Array)||positions.length%3!==0||indices!==undefined&&!(indices instanceof Uint32Array))throw new Error('源 Processing 线条缓冲无效');
 const count=indices===undefined?positions.length/6:indices.length/2;
 if(!Number.isInteger(count)||count*BYTES_PER_PAIR>MAX_BUFFER_BYTES)throw new Error('源 Processing 线条缓冲无效或展开后超过 256 MiB 本地容量');
 if(!Number.isFinite(F(width))||width<=0)throw new Error('源 Processing 线条宽度无效');
 if(indices)for(const index of indices)if(index>=positions.length/3)throw new Error('源 Processing 线条索引越界');
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
export function sourceProcessingLineBuffers(input:Float32Array,lineWidth:number,plan:SourceCameraPlan,sourceIndices?:Uint32Array):{positions:Float32Array;directions:Float32Array;indices:Uint32Array} {
 return expandLineBuffers(input,lineWidth,plan,sourceIndices,pairCount(input,lineWidth,sourceIndices));
}
function expandLineBuffers(input:Float32Array,lineWidth:number,plan:SourceCameraPlan,sourceIndices:Uint32Array|undefined,count:number):{positions:Float32Array;directions:Float32Array;indices:Uint32Array} {
 const m=plan.modelView.rowMajor;
 const halfWidth=F(F(F(lineWidth)*transformScale(m))/2);
 const positions=new Float32Array(count*16),directions=new Float32Array(count*16),indices=new Uint32Array(count*6);
 for(let pair=0;pair<count;pair++){
  const base=pair*16,aIndex=sourceIndices?sourceIndices[pair*2]:pair*2,bIndex=sourceIndices?sourceIndices[pair*2+1]:pair*2+1;
  for(let v=0;v<4;v++){
   const a=(v<2?aIndex:bIndex)*3,b=(v<2?bIndex:aIndex)*3,o=base+v*4;
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

/** Owns all expanded CPU and GPU resources for the shared Processing LINES path. */
export function createSourceProcessingLines(input:SourceProcessingLineInput,plan:SourceCameraPlan,displayOpacity=1,overlay=false):THREE.Mesh<THREE.BufferGeometry,THREE.RawShaderMaterial> {
 if(!Number.isFinite(displayOpacity)||displayOpacity<0||displayOpacity>1)throw new Error('源 Processing 线条显示透明度无效');
 if(plan.viewport.projectionPass==='unknown')throw new Error('源 Processing 线条投影状态未知');
 const count=pairCount(input.positions,input.lineWidth,input.indices),color=input.color;
 if(color.kind==='packed'){
  if(!Number.isInteger(color.packed)||color.packed< -2147483648||color.packed>4294967295)throw new Error('源 Processing 线条颜色无效');
 }else if(color.kind==='vertices'){
  if(!(color.rgb instanceof Float32Array)||!(color.alphas instanceof Float32Array)||color.rgb.length!==input.positions.length||color.alphas.length!==input.positions.length/3)throw new Error('源 Processing 顶点颜色缓冲无效');
  for(const values of [color.rgb,color.alphas])for(const value of values)if(!Number.isFinite(value)||value<0||value>1)throw new Error('源 Processing 顶点颜色必须在 0 至 1 范围');
 }else throw new Error('未知源 Processing 线条颜色类型');
 const buffers=expandLineBuffers(input.positions,input.lineWidth,plan,input.indices,count),colors=new Float32Array(buffers.positions.length);
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
  const ortho=plan.viewport.projectionPass==='scene-fade-orthographic',s=F(.999);
  material=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:vertex,fragmentShader:fragment,
   side:THREE.DoubleSide,forceSinglePass:true,transparent:true,depthTest:!overlay,depthWrite:!overlay,depthFunc:THREE.LessEqualDepth,toneMapped:false,
   blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendEquationAlpha:THREE.AddEquation,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneFactor,
   uniforms:{lineModelview:{value:new THREE.Matrix4()},projection:{value:new THREE.Matrix4().fromArray(plan.projection.columnMajor)},viewport:{value:new THREE.Vector4(0,0,plan.viewport.logicalWidth,plan.viewport.logicalHeight)},perspective:{value:0},scale:{value:new THREE.Vector3(ortho?1:s,ortho?1:s,s)}}});
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
