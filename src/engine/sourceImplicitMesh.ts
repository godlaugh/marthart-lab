import type {GenerateContext,SceneOutput} from '../types';
import type {ImplicitJob} from './implicitSurface';
import type {SourceImplicitField} from './sourceImplicitField';
import {SOURCE_IMPLICIT_EDGE_TABLE as EDGE,SOURCE_IMPLICIT_TRI_TABLE as TRI} from './sourceImplicitMarchingTables';
import {IMPLICIT_WORK_BYTES,IMPLICIT_OUTPUT_BYTES} from './meshEdges';
const F=Math.fround;
const CORNERS=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]] as const;
const EDGES=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]] as const;
export interface SourceImplicitMesh {
 readonly model:'mathart-1.7.8-cpu-marching-cubes-v1';
 /** Native Mesh has no indices: successive triples are triangles, including
  * repeated vertices and zero-area triangles. Normals precede world scaling. */
 readonly normals:Float32Array;
 readonly retainedRepeatedVertexTriangles:number;
}
/** Output includes the fill RGBA that the presentation owner will produce.
 * Two passes over cells avoid unbounded chunks and flattening copies. These
 * bounds describe typed representations, not VM overhead or process RSS. */
export function sourceImplicitMeshAllocation(samples:number,coordinateCount:number,vertices:number){
 if(![samples,coordinateCount,vertices].every(v=>Number.isSafeInteger(v)&&v>=0)||vertices%3)throw Error('源隐式 MC 缓冲计数无效');
 const outputBytes=vertices*40,workingBytes=samples*16+coordinateCount*4+outputBytes;
 if(!Number.isSafeInteger(outputBytes)||outputBytes>IMPLICIT_OUTPUT_BYTES)throw Error('源隐式 MC 输出超过 128 MiB 预算');
 if(!Number.isSafeInteger(workingBytes)||workingBytes>IMPLICIT_WORK_BYTES)throw Error('源隐式 MC 工作缓冲超过 256 MiB 预算');
 return{outputBytes,workingBytes};
}
/** Observed original CPU Marching Cubes, not the local certified-root MT path.
 * Tables, F32 operations, corner/triangle order and normals are validated by
 * complete original Mesh arrays in two independent native runs. */
export function generateSourceImplicitMesh(job:ImplicitJob,source:SourceImplicitField,context:GenerateContext):Extract<SceneOutput,{type:'geometry'}>{
 const started=performance.now(),n=source.dimensions,{min,step,iso}=source;
 const check=()=>{if(context.isCancelled?.())throw new DOMException('源隐式 MC 已取消','AbortError');};check();
 const coordinateCount=n.reduce((sum,v)=>sum+v+1,0),N=job.latticeSamples;
 sourceImplicitMeshAllocation(N,coordinateCount,0);
 const coords=n.map((v,a)=>Float32Array.from({length:v+1},(_,i)=>source.coordinate(a,i))),idx=(x:number,y:number,z:number)=>x+y*(n[0]+1)+z*(n[0]+1)*(n[1]+1);
 const field=new Float32Array(N);let q=0,invalid=0;
 for(let z=0;z<=n[2];z++)for(let y=0;y<=n[1];y++){check();for(let x=0;x<=n[0];x++){
  let value=source.evaluate(coords[0][x],coords[1][y],coords[2][z]);if(!Number.isFinite(value)){invalid++;value=F(source.isoThreshold*10);}field[q++]=value;
 }}
 const gradients=[new Float32Array(N),new Float32Array(N),new Float32Array(N)],inv=step.map(s=>Math.abs(s)<F(1e-8)?0:F(1/s));
 for(let z=0;z<=n[2];z++)for(let y=0;y<=n[1];y++){check();for(let x=0;x<=n[0];x++)for(let a=0;a<3;a++){
  const p=[x,y,z],low=[...p],high=[...p];low[a]=Math.max(0,p[a]-1);high[a]=Math.min(n[a],p[a]+1);
  let diff=F(field[idx(high[0],high[1],high[2])]-field[idx(low[0],low[1],low[2])]);if(p[a]>0&&p[a]<n[a])diff=F(diff*F(.5));gradients[a][idx(x,y,z)]=F(diff*inv[a]);
 }}
 const lerp=(a:number,b:number,t:number)=>F(a+F(F(b-a)*t));
 function normal(point:readonly number[]){
  const grid=point.map((v,a)=>Math.max(0,Math.min(n[a],Math.abs(step[a])<F(1e-8)?0:F(F(v-min[a])/step[a])))),lo=grid.map(Math.floor),hi=lo.map((v,a)=>Math.min(n[a],v+1)),t=grid.map((v,a)=>F(v-lo[a]));
  const g=gradients.map(f=>{
   const a=lerp(f[idx(lo[0],lo[1],lo[2])],f[idx(hi[0],lo[1],lo[2])],t[0]),b=lerp(f[idx(lo[0],hi[1],lo[2])],f[idx(hi[0],hi[1],lo[2])],t[0]),c=lerp(f[idx(lo[0],lo[1],hi[2])],f[idx(hi[0],lo[1],hi[2])],t[0]),d=lerp(f[idx(lo[0],hi[1],hi[2])],f[idx(hi[0],hi[1],hi[2])],t[0]);return lerp(lerp(a,b,t[1]),lerp(c,d,t[1]),t[2]);
  });const length=F(Math.sqrt(F(F(F(g[0]*g[0])+F(g[1]*g[1]))+F(g[2]*g[2]))));return length<F(1e-6)?[0,0,1]:g.map(v=>F(v*F(1/length)));
 }
 function visit(emit:(points:number[][])=>void){
  for(let z=0;z<n[2];z++)for(let y=0;y<n[1];y++){check();for(let x=0;x<n[0];x++){
   const values=CORNERS.map(([dx,dy,dz])=>field[idx(x+dx,y+dy,z+dz)]),mask=values.reduce((m,v,i)=>m|(v<iso?1<<i:0),0),edgeMask=EDGE[mask];if(!edgeMask)continue;
   const points=CORNERS.map(([dx,dy,dz])=>[coords[0][x+dx],coords[1][y+dy],coords[2][z+dz]]);
   const crossing=EDGES.map(([a,b],e)=>{if(!(edgeMask&1<<e))return [NaN,NaN,NaN];const delta=F(values[b]-values[a]),t=Math.abs(delta)<F(1e-6)?F(.5):F(F(iso-values[a])/delta);return points[a].map((value,k)=>lerp(value,points[b][k],t));});
   const triangles=TRI[mask];for(let i=0;i<triangles.length&&triangles[i]!==-1;i+=3){const triangle=[crossing[triangles[i]],crossing[triangles[i+1]],crossing[triangles[i+2]]];if(triangle.some(p=>p.some(Number.isNaN)))continue;emit(triangle);}
  }}
 }
 let vertices=0;visit(()=>{vertices+=3;sourceImplicitMeshAllocation(N,coordinateCount,vertices);});check();
 const allocation=sourceImplicitMeshAllocation(N,coordinateCount,vertices),positions=new Float32Array(vertices*3),normals=new Float32Array(vertices*3);let at=0,degenerates=0;
 visit(points=>{
  if(points[0].every((v,a)=>v===points[1][a])||points[1].every((v,a)=>v===points[2][a])||points[0].every((v,a)=>v===points[2][a]))degenerates++;
  for(const point of points){positions.set(source.world(point),at);normals.set(normal(point),at);at+=3;}
 });check();
 if(at!==positions.length)throw Error('源隐式 MC 计数与生成不一致');
 return{type:'geometry',dimension:3,topology:'mesh',backend:'cpu',positions,sourceImplicitMesh:{model:'mathart-1.7.8-cpu-marching-cubes-v1',normals,retainedRepeatedVertexTriangles:degenerates},
  implicit:{requestedCells:job.cells,examinedCells:job.cells*2,requestedLatticeSamples:N,latticeSamples:N,latticeValidationSamples:0,rootEvaluations:0,refinedEdges:0,representedZeroCorners:0,rejectedEdges:0,unresolvedCells:0,degenerateTriangles:0,estimatedPeakWorkingBytes:allocation.workingBytes},
  stats:{samples:N,generated:vertices,invalid,elapsedMs:performance.now()-started},...(invalid?{warnings:[`${invalid} 个非有限场值按源 CPU 规则替换为 isoThreshold × 10。`]}:{})};
}
