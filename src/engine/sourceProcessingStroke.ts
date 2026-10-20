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
/** One source segment emits A+, A-, B-, B+ for every stroke topology. */
function writeStrokeSegment(input:Float32Array,m:readonly number[],a:number,b:number,positions:Float32Array,directions:Float32Array,vertex:number,half:number,negativeHalf:number):void {
 writeStrokeVertex(input,m,a*3,b*3,positions,directions,vertex*4,half);
 writeStrokeVertex(input,m,a*3,b*3,positions,directions,(vertex+1)*4,negativeHalf);
 writeStrokeVertex(input,m,b*3,a*3,positions,directions,(vertex+2)*4,negativeHalf);
 writeStrokeVertex(input,m,b*3,a*3,positions,directions,(vertex+3)*4,half);
}
export interface SourceProcessingStrokeCache {
 readonly vertexOffset:number;readonly indexOffset:number;readonly vertexCount:number;readonly indexCount:number;
}
export interface SourceProcessingOpenStrokeInput {
 readonly positions:Float32Array;
 /** Independent beginShape(POLYGON)/endShape(OPEN) ranges, with final sentinel. */
 readonly polygonOffsets:Uint32Array;
 /** Already parsed normalized RGBA, one vec4 per input vertex. */
 readonly colors:Float32Array;
 readonly rowMajor:readonly number[];
 readonly lineWidth:number;
 readonly isCancelled?:()=>boolean;
}
export interface SourceProcessingOpenStrokeBuffers {
 readonly positions:Float32Array;readonly directions:Float32Array;readonly colors:Float32Array;
 readonly indices:Uint16Array;readonly caches:readonly SourceProcessingStrokeCache[];
}
export class SourceProcessingStrokeError extends Error {
 constructor(readonly code:'input'|'capacity'|'cancelled',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourceProcessingStrokeError';}
}
const OPEN_CACHE_VERTICES=32767;
// Every edge emits at most three indices per vertex (including rollover joins).
const OPEN_CACHE_INDICES=OPEN_CACHE_VERTICES*3;
const OPEN_CHUNK_BYTES=OPEN_CACHE_VERTICES*48+OPEN_CACHE_INDICES*2+32;
export const SOURCE_PROCESSING_OPEN_STROKE_LIMITS=Object.freeze({maxBufferBytes:MAX_BUFFER_BYTES,maxCacheVertices:OPEN_CACHE_VERTICES,maxChunkBufferBytes:OPEN_CHUNK_BYTES});
type MutableStrokeCache={vertexOffset:number;indexOffset:number;vertexCount:number;indexCount:number};
type OpenEdgeVisitor=(a:number,b:number,vertex:number,index:number,base:number,previous0:number,previous1:number,rollover:boolean,join:boolean)=>void;
function prepareOpenStroke(input:SourceProcessingOpenStrokeInput){
 if(!input||typeof input!=='object')throw new SourceProcessingStrokeError('input','Missing Processing polygon stroke input.');
 const {positions:xyz,polygonOffsets,colors:rgba,rowMajor:m,lineWidth,isCancelled}=input;
 const check=()=>{if(isCancelled?.())throw new SourceProcessingStrokeError('cancelled','Processing stroke expansion cancelled.');};
 check();
 if(!(xyz instanceof Float32Array)||xyz.length%3!==0||!(polygonOffsets instanceof Uint32Array)||polygonOffsets.length<1||polygonOffsets[0]!==0||polygonOffsets[polygonOffsets.length-1]!==xyz.length/3||!(rgba instanceof Float32Array)||rgba.length!==xyz.length/3*4||!Array.isArray(m)||m.length!==16||m.some(v=>typeof v!=='number'))throw new SourceProcessingStrokeError('input','Invalid Processing polygon stroke buffers.');
 if(!Number.isFinite(F(lineWidth))||lineWidth<=0)throw new SourceProcessingStrokeError('input','Invalid Processing stroke width.');
 for(let i=1;i<polygonOffsets.length;i++){
  if((i&1023)===0)check();
  if(polygonOffsets[i]<polygonOffsets[i-1]||polygonOffsets[i]>xyz.length/3)throw new SourceProcessingStrokeError('input','Invalid Processing polygon offsets.');
 }
 for(let i=0;i<rgba.length;i++){
  if((i&4095)===0)check();
  if(!Number.isFinite(rgba[i])||rgba[i]<0||rgba[i]>1)throw new SourceProcessingStrokeError('input','Processing stroke colors must be parsed normalized RGBA.');
 }
 const scaledWidth=F(F(lineWidth)*sourceProcessingTransformScale(m)),joins=!(scaledWidth<2),half=F(scaledWidth/2),negativeHalf=F(-scaledWidth/2);
 return {input,check,joins,half,negativeHalf};
}
type PreparedOpenStroke=ReturnType<typeof prepareOpenStroke>;
/** Single topology owner for complete allocation and bounded streaming. Cache
 * close events preserve source rollover and endShape flush ordering. */
function walkOpenStroke(prepared:PreparedOpenStroke,completeCapacity:boolean,visit?:OpenEdgeVisitor,close?:(cache:MutableStrokeCache)=>void){
 const {input:{polygonOffsets},check,joins}=prepared;
 let vertex=0,index=0,cacheCount=0,flushVertexStart=0,cache:MutableStrokeCache|undefined;
 const finish=()=>{if(cache){check();close?.(cache);check();cache=undefined;}};
 for(let polygon=0;polygon+1<polygonOffsets.length;polygon++){
  check();
  const start=polygonOffsets[polygon],end=polygonOffsets[polygon+1];
  if(end-start<3)continue;
  let previous0=-1,previous1=-1;
  for(let a=start;a+1<end;a++){
   if((a&1023)===0)check();
   const join=joins&&previous0>=0;
   const rollover=cache!==undefined&&cache.vertexCount+4+(join?1:0)>=32768;
   if(!cache||rollover){finish();cache={vertexOffset:vertex,indexOffset:index,vertexCount:0,indexCount:0};cacheCount++;}
   const base=cache.vertexCount,addedVertices=4+(join?(rollover?3:1):0),addedIndices=6+(join?6:0);
   if(completeCapacity&&(vertex+addedVertices)*48+(index+addedIndices)*2+cacheCount*32>MAX_BUFFER_BYTES)throw new SourceProcessingStrokeError('capacity','Processing polygon expansion exceeds 256 MiB local capacity.');
   visit?.(a,a+1,vertex,index,base,previous0,previous1,rollover,join);
   vertex+=addedVertices;index+=addedIndices;cache.vertexCount+=addedVertices;cache.indexCount+=addedIndices;
   previous0=base+2;previous1=base+3;
  }
  // Source checks total tessellation size after the whole shape, not edge.
  if(vertex-flushVertexStart>=32768){finish();flushVertexStart=vertex;}
 }
 finish();return {vertex,index};
}
function openStrokeWriter(prepared:PreparedOpenStroke,output:Omit<SourceProcessingOpenStrokeBuffers,'caches'>,local:boolean):OpenEdgeVisitor{
 const {input:{positions:xyz,colors:rgba,rowMajor:m},half,negativeHalf}=prepared;
 const {positions,directions,colors,indices}=output;
 let localIndex=0;
 const color=(vertex:number,source:number)=>{for(let c=0;c<4;c++)colors[vertex*4+c]=rgba[source*4+c];};
 return (a,b,globalVertex,globalIndex,base,previous0,previous1,rollover,join)=>{
  const vertex=local?base:globalVertex;
  if(local&&base===0)localIndex=0;
  const index=local?localIndex:globalIndex;
  localIndex+=6+(join?6:0);
  writeStrokeSegment(xyz,m,a,b,positions,directions,vertex,half,negativeHalf);
  color(vertex,a);color(vertex+1,a);color(vertex+2,b);color(vertex+3,b);
  indices.set([base,base+1,base+2,base+2,base+1,base+3],index);
  if(!join)return;
  writeStrokeVertex(xyz,m,a*3,undefined,positions,directions,(vertex+4)*4,0);
  if(rollover){
   color(vertex+4,a-1);
   writeStrokeVertex(xyz,m,a*3,(a-1)*3,positions,directions,(vertex+5)*4,negativeHalf);
   writeStrokeVertex(xyz,m,a*3,(a-1)*3,positions,directions,(vertex+6)*4,half);
   color(vertex+5,a-1);color(vertex+6,a-1);
   indices.set([base+4,base+5,base,base+4,base+6,base+1],index+6);
  }else{
   color(vertex+4,a);
   indices.set([base+4,previous0,base,base+4,previous1,base+1],index+6);
  }
 };
}
function allocateOpenStroke(vertex:number,index:number){
 return {positions:new Float32Array(vertex*4),directions:new Float32Array(vertex*4),colors:new Float32Array(vertex*4),indices:new Uint16Array(index)};
}
/** Complete source immediate P3D open POLYGON output. Capacity includes all
 * three vec4 arrays, uint16 indices and four 64-bit cache counters. */
export function sourceProcessingOpenStrokeBuffers(input:SourceProcessingOpenStrokeInput):SourceProcessingOpenStrokeBuffers {
 const prepared=prepareOpenStroke(input),caches:MutableStrokeCache[]=[];
 const layout=walkOpenStroke(prepared,true,undefined,cache=>caches.push(cache));prepared.check();
 const output=allocateOpenStroke(layout.vertex,layout.index);
 walkOpenStroke(prepared,true,openStrokeWriter(prepared,output,false));
 prepared.check();return {...output,caches};
}
/** Synchronously consume one source index cache at a time, in draw order.
 * Each chunk has one cache with zero offsets and source-local ushort indices.
 * Array storage is reused after consume returns: upload/draw or copy before
 * returning, and do not mutate input during consumption. No async callbacks.
 * Capacity bounds retained input backing stores plus one work chunk at 256 MiB;
 * expanded total is not retained or bounded. Cancellation or consumer failure
 * propagates immediately; earlier chunks may already have been consumed. */
export function forEachSourceProcessingOpenStrokeChunk(input:SourceProcessingOpenStrokeInput,consume:(chunk:SourceProcessingOpenStrokeBuffers)=>void):void {
 const prepared=prepareOpenStroke(input);
 if(typeof consume!=='function')throw new SourceProcessingStrokeError('input','Missing Processing stroke chunk consumer.');
 const buffers=new Set([input.positions.buffer,input.colors.buffer,input.polygonOffsets.buffer]);
 const retainedBytes=Array.from(buffers).reduce((sum,buffer)=>sum+buffer.byteLength,0)+16*8;
 if(retainedBytes+OPEN_CHUNK_BYTES>MAX_BUFFER_BYTES)throw new SourceProcessingStrokeError('capacity','Processing stroke input and chunk exceed 256 MiB local capacity.');
 const output=allocateOpenStroke(OPEN_CACHE_VERTICES,OPEN_CACHE_INDICES);
 walkOpenStroke(prepared,false,openStrokeWriter(prepared,output,true),cache=>{
  consume({positions:output.positions.subarray(0,cache.vertexCount*4),directions:output.directions.subarray(0,cache.vertexCount*4),colors:output.colors.subarray(0,cache.vertexCount*4),indices:output.indices.subarray(0,cache.indexCount),caches:[{vertexOffset:0,indexOffset:0,vertexCount:cache.vertexCount,indexCount:cache.indexCount}]});
 });
 prepared.check();
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
  writeStrokeSegment(input,m,a,b,positions,directions,vertex,half,negativeHalf);vertex+=4;
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
  writeStrokeSegment(input,m,aIndex,bIndex,positions,directions,base/4,halfWidth,-halfWidth);
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
