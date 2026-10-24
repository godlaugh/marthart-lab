import {parseSourceBouncingConfiguration,type SourceBouncingConfiguration} from './sourceBouncingConfig';
import type {PolygonRow} from './polygonEditor';
const F=Math.fround;
export function sourcePolygonRows(vertices:readonly number[]):PolygonRow[]{
 return Array.from({length:vertices.length/2},(_,i)=>({x:String(vertices[i*2]),y:String(vertices[i*2+1])}));
}
/** UI editing limits are not document/import limits. Unedited coordinates,
 * repeated points and concave/degenerate contours retain their source values. */
export function sourcePolygonCoordinate(value:number):number{return F(Math.max(-2,Math.min(2,F(value))));}
export function parseSourcePolygonRows(configuration:SourceBouncingConfiguration,rows:PolygonRow[]):number[]{
 const vertices=rows.flatMap(p=>[p.x,p.y].map(value=>{
  if(!value.trim()||!Number.isFinite(Number(value)))throw Error('顶点坐标必须是有限数字');
  return Number(value);
 }));
 const result=parseSourceBouncingConfiguration({...configuration,polygonVertices:vertices});
 if(!result.ok)throw Error(`${result.error.path.join('.')}: ${result.error.reason}`);
 return result.value.polygonVertices;
}
export function appendSourcePolygonMidpoint(vertices:readonly number[]):number[]{
 if(vertices.length>=128)throw Error('多边形最多 64 个顶点');
 return [...vertices,F(F(vertices.at(-2)!+vertices[0])*.5),F(F(vertices.at(-1)!+vertices[1])*.5)];
}
/** BouncingParticlesSectionKt.setRegularPolygon: Float32 angle and trig
 * conversion order. Center is separate and must not be baked into the points. */
export function regularSourcePolygon(sides:3|6,radius:number):number[]{
 const r=F(Math.max(F(.001),F(radius)));if(!Number.isFinite(r))throw Error('请输入有限数值');
 const start=sides===3?F(-1.5707964):F(.5235988),vertices:number[]=[];
 for(let i=0;i<sides;i++){const angle=F(start+F(F(F(6.2831855)*i)/sides));vertices.push(F(F(Math.cos(angle))*r),F(F(Math.sin(angle))*r));}
 return vertices;
}
