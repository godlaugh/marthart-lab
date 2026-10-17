import * as THREE from 'three';
import {PROCEDURAL_TEXTURES,type MeshAppearance} from './meshAppearance';
// Independent 3-D object-coordinate patterns. No shader or texture bytes from the
// reference app are used. Geometry bounds make frequency independent of scale.
const PATTERNS=`
varying vec3 vMathArtPosition;
uniform vec3 mathArtMinimum;
uniform vec3 mathArtExtent;
uniform float mathArtPattern;
uniform float mathArtFrequency;
float mathArtHash(vec3 p) { return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453123); }
vec3 mathArtTexture(vec3 coordinate) {
 vec3 p=(coordinate-mathArtMinimum)/mathArtExtent*mathArtFrequency;
 if(mathArtPattern<0.5)return vec3(1.0);
 if(mathArtPattern<1.5){
  vec3 wave=sin(3.141592653589793*p);float board=wave.x*wave.y*wave.z;
  float width=max(fwidth(board),0.001);return vec3(mix(0.2,1.0,smoothstep(-width,width,board)));
 }
 if(mathArtPattern<2.5){
  float grain=mathArtHash(floor(p*vec3(2.0,96.0,2.0)));
  float brushed=0.72+0.14*sin(p.y*96.0+grain*2.0)+0.10*grain;
  return vec3(0.83,0.88,0.94)*brushed;
 }
 if(mathArtPattern<3.5){
  vec3 q=p+0.06*vec3(sin(p.y*3.0),sin(p.z*4.0),sin(p.x*2.0));
  vec3 edge=abs(fract(q)-0.5);float seam=max(edge.x,max(edge.y,edge.z));
  float glaze=0.92+0.06*sin(p.x*2.0+p.y*3.0+p.z);
  return vec3(glaze)*mix(1.0,0.45,smoothstep(0.465,0.495,seam));
 }
 vec2 cell=floor(p.xy),uv=fract(p.xy);float parity=mod(cell.x+cell.y,2.0);
 float along=mix(uv.x,uv.y,parity),across=mix(uv.y,uv.x,parity);
 float filament=0.5+0.5*cos(along*50.2654824574);
 float ribbon=pow(max(0.0,sin(across*3.14159265359)),0.4);
 return vec3((0.22+0.22*filament)*ribbon+0.06);
}
`;
export function createMeshMaterial(appearance:MeshAppearance,bounds:THREE.Box3,opacity:number,legacyWireframe=false):THREE.MeshPhongMaterial {
 if(!Number.isFinite(opacity)||opacity<0||opacity>1)throw new Error('网格透明度必须在 0–1');
 const material=new THREE.MeshPhongMaterial({vertexColors:true,side:THREE.DoubleSide,shininess:appearance.shininess,specular:appearance.specular,wireframe:legacyWireframe,opacity,transparent:opacity<1,depthWrite:opacity===1,polygonOffset:appearance.wireframe,polygonOffsetFactor:1,polygonOffsetUnits:1});
 const minimum=bounds.isEmpty()?new THREE.Vector3():bounds.min.clone(),extent=bounds.isEmpty()?new THREE.Vector3(1,1,1):bounds.getSize(new THREE.Vector3());
 // Planar surfaces sample the middle of a texture cell, rather than a checker seam.
 for(const axis of ['x','y','z'] as const)if(extent[axis]<1e-12){extent[axis]=1;minimum[axis]-=.5/appearance.textureScale;}
 material.onBeforeCompile=shader=>{
  Object.assign(shader.uniforms,{mathArtMinimum:{value:minimum},mathArtExtent:{value:extent},mathArtPattern:{value:PROCEDURAL_TEXTURES.indexOf(appearance.texture)},mathArtFrequency:{value:appearance.textureScale}});
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vMathArtPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\nvMathArtPosition=position;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+PATTERNS).replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb*=mathArtTexture(vMathArtPosition);');
 };
 material.customProgramCacheKey=()=> 'mathart-phong-object-texture-v1';
 return material;
}
