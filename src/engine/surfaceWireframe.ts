import type {GeometryOutput} from '../types';

export type SurfaceGrid = NonNullable<GeometryOutput['surfaceGrid']>;
const MAX_SEGMENTS=1_048_576;
/** Validates the producer-owned topology once, before expansion into line instances. */
function validate(positions:Float32Array,grid:SurfaceGrid){
 const {width,height,uSegments:nu,vSegments:nv,vertexIndices:ids,cellTriangles:masks}=grid;
 if(!(positions instanceof Float32Array)||positions.length%3)throw new Error('曲面线框位置格式无效');
 if(!Number.isInteger(nu)||!Number.isInteger(nv)||nu<2||nv<2||nu>512||nv>512||![nu,nu+1].includes(width)||![nv,nv+1].includes(height))throw new Error('曲面参数网格尺寸无效');
 if(!(ids instanceof Int32Array)||ids.length!==width*height||!(masks instanceof Uint8Array)||masks.length!==nu*nv)throw new Error('曲面参数网格元数据不完整');
 for(const value of positions)if(!Number.isFinite(value))throw new Error('曲面线框包含非有限顶点');
 for(const id of ids)if(id < -1||id>=positions.length/3)throw new Error('曲面参数网格索引越界');
 for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){
  const mask=masks[j*nu+i];if(mask>3)throw new Error('曲面三角片掩码无效');
  const a=ids[j*width+i],b=ids[j*width+(i+1)%width],c=ids[((j+1)%height)*width+(i+1)%width],d=ids[((j+1)%height)*width+i];
  if(mask&1 && (a<0||b<0||c<0)||mask&2 && (a<0||c<0||d<0))throw new Error('曲面三角片引用缺失顶点');
 }
}

/** Draw only parameter-grid boundaries belonging to accepted triangles.
 * Independent formula curves are produced by generateSurface, not reconstructed here. */
export function surfaceWireSegments(positions:Float32Array,grid:SurfaceGrid):Float32Array {
 validate(positions,grid);
 const {width,height,uSegments:nu,vSegments:nv,vertexIndices:ids,cellTriangles:masks}=grid;
 const estimate=(nu+1)*nv+(nv+1)*nu;
 if(estimate>MAX_SEGMENTS)throw new Error('曲面线框展开超过 1048576 段资源预算');
 const result=new Float32Array(estimate*6);let length=0;
 const seenEdges=new Set<number>();
 function edge(a:number,b:number){
  if(a<0||b<0||a===b)return;
  const key=Math.min(a,b)*positions.length/3+Math.max(a,b);
  if(seenEdges.has(key))return;seenEdges.add(key);
  if([0,1,2].every(k=>positions[a*3+k]===positions[b*3+k]))return;
  result.set(positions.subarray(a*3,a*3+3),length);result.set(positions.subarray(b*3,b*3+3),length+3);length+=6;
 }
 for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){
  const a=ids[j*width+i],b=ids[j*width+(i+1)%width],c=ids[((j+1)%height)*width+(i+1)%width],d=ids[((j+1)%height)*width+i],mask=masks[j*nu+i];
  if(mask&1){edge(a,b);edge(b,c);}
  if(mask&2){edge(c,d);edge(d,a);}
 }
 return result.subarray(0,length);
}
