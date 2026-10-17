import * as THREE from 'three';
import type {GeometryOutput} from '../types';
import type {MeshAppearance} from './meshAppearance';
import {checkedMeshBytes,IMPLICIT_WORK_BYTES} from './meshEdges';
/** Preflight before deleting the currently displayed frame or allocating normals.
 * These are one-frame typed/static-buffer bounds, not a process or VRAM cap.
 * The separate legacy material.wireframe path retains Three's internal index
 * expansion and is explicitly outside this representation bound. */
export function implicitMeshPresentation(output:GeometryOutput,overlay:boolean){
 if(output.topology!=='mesh'||!(output.positions instanceof Float32Array)||output.positions.length%3||!(output.indices instanceof Uint32Array)||output.indices.length%3||output.colors!==undefined&&(!(output.colors instanceof Float32Array)||output.colors.length!==output.positions.length))throw Error('隐式网格表示无效');
 const vertices=output.positions.length/3,indices=output.indices,edges=output.meshEdges;
 if(overlay&&edges===undefined)throw Error('隐式叠加线框缺少生产器边索引；请重新生成场景');
 if(edges!==undefined&&(!(edges instanceof Uint32Array)||edges.length%2))throw Error('隐式线框边表示无效');
 const deliverableBytes=checkedMeshBytes(vertices,indices.length,(edges?.length??0)/2),knownFrameBytes=deliverableBytes+vertices*12;
 if(!Number.isSafeInteger(knownFrameBytes)||knownFrameBytes>IMPLICIT_WORK_BYTES)throw Error('隐式网格渲染表示超过 256 MiB 预算');
 for(let i=0;i<indices.length;i++)if(indices[i]>=vertices)throw Error('隐式三角形索引越界');
 if(edges){let a=-1,b=-1;for(let i=0;i<edges.length;i+=2){const x=edges[i],y=edges[i+1];if(x>=y||y>=vertices||x<a||x===a&&y<=b)throw Error('隐式线框边索引无效或重复');a=x;b=y;}}
 return{vertices,edgeCount:(edges?.length??0)/2,deliverableBytes,knownCpuBytes:knownFrameBytes,knownStaticGpuBytes:knownFrameBytes};
}
/** Deliberately shares the BufferAttribute identity, so Three uploads positions
 * once. Both geometries must be removed/disposed together with no interim draw. */
export function createImplicitWireframe(output:GeometryOutput,position:THREE.BufferAttribute,appearance:MeshAppearance,opacity:number){
 const geometry=new THREE.BufferGeometry();let material:THREE.LineBasicMaterial|undefined;
 try{geometry.setAttribute('position',position);geometry.setIndex(new THREE.BufferAttribute(output.meshEdges!,1));material=new THREE.LineBasicMaterial({color:appearance.wireColor,transparent:true,opacity,depthWrite:false});return new THREE.LineSegments(geometry,material);}
 catch(error){geometry.dispose();material?.dispose();throw error;}
}
