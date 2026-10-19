import type {SourceCameraPlan} from './sourceCamera';
import {writeSourceEyePosition} from './sourceProcessingGeometry';

const F=Math.fround;
// Complete expanded position/direction/color vec4 arrays and uint32 triangles.
const BYTES_PER_PAIR=4*4*4*3+6*4,MAX_BUFFER_BYTES=256*1024*1024;
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
export function sourceProcessingTransformScale(m:readonly number[]):number {
 const a=F(m[0]*F(F(m[5]*m[10])-F(m[6]*m[9])));
 const b=F(m[1]*F(F(m[6]*m[8])-F(m[4]*m[10])));
 const c=F(m[2]*F(F(m[4]*m[9])-F(m[5]*m[8])));
 return F(Math.pow(Math.abs(F(F(a+b)+c)),0.3333333432674408));
}
export interface SourceProcessingStrokeBuffers {
 readonly positions:Float32Array;readonly directions:Float32Array;readonly indices:Uint32Array;
}
/** Immediate setLineVertex: transform the raw float difference independently
 * from the endpoints. The no-direction overload writes literal positive zero. */
function writeStrokeVertex(input:Float32Array,m:readonly number[],a:number,b:number|undefined,positions:Float32Array,directions:Float32Array,o:number,width:number):void {
 writeSourceEyePosition(m,input[a],input[a+1],input[a+2],positions,o);
 if(b===undefined){directions.fill(0,o,o+4);return;}
 const dx=F(input[b]-input[a]),dy=F(input[b+1]-input[a+1]),dz=F(input[b+2]-input[a+2]);
 for(let row=0;row<3;row++){
  const k=row*4;
  directions[o+row]=F(F(F(dx*m[k])+F(dy*m[k+1]))+F(dz*m[k+2]));
 }
 directions[o+3]=width;
}
/** The boundary producer currently admits 3..200 points. This bound also keeps
 * one immediate shape below Processing's short-index cache rollover threshold.
 * Capacity includes position/direction vec4 and uint32 indices, not host color. */
export const SOURCE_PROCESSING_CLOSED_STROKE_LIMITS=Object.freeze({maxPoints:200,maxVertices:1002,maxIndices:2400,maxBufferBytes:1002*16*2+2400*4});
/** PGraphicsOpenGL Tessellator.tessellateEdges3D / addLineSegment3D /
 * addBevel3D, isolated immediate closed shape. Input contains N xyz points;
 * closure is implicit. Preserve duplicate points and nonfinite arithmetic.
 * Source reserves more space than it writes; return only actual vertices. */
export function sourceProcessingClosedStrokeBuffers(input:Float32Array,lineWidth:number,plan:SourceCameraPlan):SourceProcessingStrokeBuffers {
 if(!(input instanceof Float32Array)||input.length%3!==0||input.length<9||input.length/3>SOURCE_PROCESSING_CLOSED_STROKE_LIMITS.maxPoints)throw new Error('源 Processing 闭合描边需要 3 至 200 个 xyz 顶点');
 if(!Number.isFinite(F(lineWidth))||lineWidth<=0)throw new Error('源 Processing 线条宽度无效');
 const count=input.length/3,m=plan.modelView.rowMajor,scaledWidth=F(F(lineWidth)*sourceProcessingTransformScale(m));
 // noCapsJoins uses a strict comparison; NaN therefore retains joins.
 const joins=!(scaledWidth<2),half=F(scaledWidth/2),negativeHalf=F(-scaledWidth/2);
 const vertices=joins?5*count+2:4*count;
 const positions=new Float32Array(vertices*4),directions=new Float32Array(vertices*4),indices=new Uint32Array(count*(joins?12:6));
 let vertex=0,index=0,previous0=-1,previous1=-1;
 const write=(a:number,b:number|undefined,width:number)=>writeStrokeVertex(input,m,a*3,b===undefined?undefined:b*3,positions,directions,vertex++*4,width);
 const triangle=(a:number,b:number,c:number)=>{indices[index++]=a;indices[index++]=b;indices[index++]=c;};
 for(let edge=0;edge<count;edge++){
  const a=edge,b=(edge+1)%count,base=vertex;
  write(a,b,half);write(a,b,negativeHalf);write(b,a,negativeHalf);write(b,a,half);
  triangle(base,base+1,base+2);triangle(base+2,base+1,base+3);
  if(joins&&edge>0){
   write(a,undefined,0);
   triangle(base+4,previous0,base);triangle(base+4,previous1,base+1);
  }
  previous0=base+2;previous1=base+3;
 }
 if(joins){
  const base=vertex;
  write(0,undefined,0);write(0,1,half);write(0,1,negativeHalf);
  triangle(base,previous0,base+1);triangle(base,base+2,previous1);
 }
 return {positions,directions,indices};
}
/** LineVert's immediate flush uniforms. The CPU buffers already contain
 * modelview; both hosts supply identity lineModelview and the source projection. */
export function sourceProcessingLineDisplay(plan:SourceCameraPlan):{scale:[number,number,number];perspective:0;viewport:[number,number,number,number]} {
 if(plan.viewport.projectionPass==='unknown')throw new Error('源 Processing 线条投影状态未知');
 const ortho=plan.viewport.projectionPass==='scene-fade-orthographic',s=F(.999);
 return {scale:[ortho?1:s,ortho?1:s,s],perspective:0,viewport:[0,0,plan.viewport.logicalWidth,plan.viewport.logicalHeight]};
}
/** Independent LINES emit A+, A-, B-, B+; no line-strip joins or caps.
 * Directions are transformed raw endpoint differences, never eyeB-eyeA.
 * Nonfinite endpoint arithmetic is retained just like source tessellation. */
export function sourceProcessingLineBuffers(input:Float32Array,lineWidth:number,plan:SourceCameraPlan,sourceIndices?:Uint32Array):{positions:Float32Array;directions:Float32Array;indices:Uint32Array} {
 return expandLineBuffers(input,lineWidth,plan,sourceIndices,pairCount(input,lineWidth,sourceIndices));
}
function expandLineBuffers(input:Float32Array,lineWidth:number,plan:SourceCameraPlan,sourceIndices:Uint32Array|undefined,count:number):{positions:Float32Array;directions:Float32Array;indices:Uint32Array} {
 const m=plan.modelView.rowMajor;
 const halfWidth=F(F(F(lineWidth)*sourceProcessingTransformScale(m))/2);
 const positions=new Float32Array(count*16),directions=new Float32Array(count*16),indices=new Uint32Array(count*6);
 for(let pair=0;pair<count;pair++){
  const base=pair*16,aIndex=sourceIndices?sourceIndices[pair*2]:pair*2,bIndex=sourceIndices?sourceIndices[pair*2+1]:pair*2+1;
  for(let v=0;v<4;v++){
   const a=(v<2?aIndex:bIndex)*3,b=(v<2?bIndex:aIndex)*3,o=base+v*4;
   writeStrokeVertex(input,m,a,b,positions,directions,o,v===0||v===3?halfWidth:-halfWidth);
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
export const sourceProcessingLineVertex=`precision highp float;
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
export const sourceProcessingLineFragment=`precision mediump float;
precision mediump int;
in vec4 vertColor;
out vec4 fragmentColor;
void main(){fragmentColor=vertColor;}`;
