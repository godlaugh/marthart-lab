import {bouncingPolygonFacts,boundaryFromSettings,type Point} from '../scenes/bouncing';
import type {Settings} from '../types';

export type PolygonRow={x:string;y:string};
export const polygonRows=(vertices:Point[]):PolygonRow[]=>vertices.map(([x,y])=>({x:String(x),y:String(y)}));
export function readPolygonRows(settings:Settings):PolygonRow[] {
  const boundary=boundaryFromSettings({...settings,boundary:'polygon'});
  return polygonRows(boundary.kind==='polygon'?boundary.vertices:[]);
}
export function parsePolygonRows(rows:PolygonRow[]) {
  const vertices:Point[]=rows.map(({x,y})=>{
    if(!x.trim()||!y.trim()||!Number.isFinite(Number(x))||!Number.isFinite(Number(y)))throw new Error('顶点坐标必须是有限数字');
    return[Number(x),Number(y)];
  });
  return bouncingPolygonFacts(vertices);
}
/** The shipped six-point reset outline; coordinates remain explicit local world values. */
export function resetPolygonRows():PolygonRow[] {return polygonRows([[-.95,-.5],[-.38,-.88],[.75,-.65],[.95,.25],[.28,.82],[-.82,.58]]);}
export function appendPolygonMidpoint(rows:PolygonRow[]):PolygonRow[] {
  const {vertices}=parsePolygonRows(rows);
  if(vertices.length>=64)throw new Error('多边形最多 64 个顶点');
  const first=vertices[0],last=vertices.at(-1)!;
  return[...rows,{x:String((first[0]+last[0])/2),y:String((first[1]+last[1])/2)}];
}
export function polygonEditorView(rows:PolygonRow[]) {
  const points=rows.map(({x,y})=>[Number(x),Number(y)]).filter(p=>p.every(Number.isFinite));
  const xmin=points.length?Math.min(...points.map(p=>p[0])):-1,xmax=points.length?Math.max(...points.map(p=>p[0])):1;
  const ymin=points.length?Math.min(...points.map(p=>p[1])):-1,ymax=points.length?Math.max(...points.map(p=>p[1])):1;
  const span=Math.max(xmax-xmin,ymax-ymin,1e-6)*1.4;
  return{x:(xmin+xmax)/2,y:(ymin+ymax)/2,span};
}
