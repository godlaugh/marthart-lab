import type {GeometryOutput} from '../types';
import type {MeshAppearance} from './meshAppearance';
import {surfaceWireSegments} from './surfaceWireframe';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {LineSegmentsGeometry} from 'three/addons/lines/LineSegmentsGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
/** Shared screen-space line material; actual triangle bands avoid native lineWidth. */
export function createScreenLineMaterial(width:number,opacity:number,options:{color?:string;vertexColors?:boolean}={}):LineMaterial {
 const material=new LineMaterial({...options,linewidth:width,worldUnits:false,transparent:true,opacity,depthWrite:false,depthTest:true,alphaToCoverage:false});
 // Butt ends avoid repeatedly accumulating round-cap opacity on dense segments.
 // Canvas MSAA antialiases the triangle band without overwriting endpoint alpha.
 material.onBeforeCompile=shader=>{if(!shader.vertexShader.includes('vec2 dir = ndcEnd.xy - ndcStart.xy;')||!shader.fragmentShader.includes('#include <clipping_planes_fragment>'))throw new Error('屏幕线材质版本不兼容');shader.vertexShader=shader.vertexShader.replace('vec2 dir = ndcEnd.xy - ndcStart.xy;','vec2 dir = ndcEnd.xy - ndcStart.xy;\nif (!(dot(dir,dir)>0.0)) {gl_Position=vec4(2.0,2.0,2.0,1.0);return;}');shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif (abs(vUv.y)>1.0) discard;');};
 material.customProgramCacheKey=()=> 'mathart-butt-ended-screen-lines-v1';
 return material;
}

/** Rasterized triangle bands avoid WebGL's implementation-dependent native line
 * width. LineSegments2 updates its viewport resolution on every render, including
 * resized canvases and export. Width is in logical canvas/CSS pixels. */
export function createThickWireframe(positions:Float32Array,color:string,width:number,opacity:number,indices?:Uint32Array):LineSegments2 {
 if(positions.length%(indices?3:6)||!Number.isFinite(width)||width<.1||width>32||!Number.isFinite(opacity)||opacity<0||opacity>1)throw new Error('粗线框输入无效');
 let segments=positions;
 if(indices){
  if(indices.length%2||indices.length>2_000_000)throw new Error('独立线框索引格式或数量无效');
  segments=new Float32Array(indices.length*3);
  for(let i=0;i<indices.length;i++){const id=indices[i];if(id>=positions.length/3)throw new Error('独立线框索引越界');segments.set(positions.subarray(id*3,id*3+3),i*3);}
 }
 for(const value of segments)if(!Number.isFinite(value))throw new Error('线框包含非有限顶点');
 const geometry=new LineSegmentsGeometry();
 try{
  geometry.setPositions(segments);
  // The installed LineMaterial alpha-to-coverage branch overwrites opacity at
  // round caps. Canvas MSAA antialiases the geometry without that branch.
  const material=createScreenLineMaterial(width,opacity,{color});
  const line=new LineSegments2(geometry,material);line.renderOrder=1;return line;
 }catch(error){geometry.dispose();throw error;}
}

/** Choose producer-owned independent curves or the coupled parameter-grid edges. */
export function createSurfaceWireframe(output:GeometryOutput,appearance:MeshAppearance,opacity:number):LineSegments2 {
 if(appearance.surfaceWire.decoupled){
  // While a changed scene is generating, its previous output may have no curves.
  // An empty layer avoids inventing geometry from an unrelated previous mesh.
  const curves=output.surfaceWireframe;
  return createThickWireframe(curves?.positions??new Float32Array(),appearance.wireColor,appearance.wireWidth,opacity,curves?.indices);
 }
 if(!output.surfaceGrid)throw new Error('曲面缺少参数网格拓扑');
 return createThickWireframe(surfaceWireSegments(output.positions,output.surfaceGrid),appearance.wireColor,appearance.wireWidth,opacity);
}
