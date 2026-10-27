import * as THREE from 'three';
import type {GeometryOutput} from '../types';
import type {SourceCameraPlan} from './sourceCamera';
import type {SourceImplicitGpuPresentation} from './sourceImplicitGpuPresentation';
import {createSourceShaderMaterial} from './sourceShaderMaterial';
import {sourceImplicitGpuVertex,sourceImplicitGpuFragment} from './sourceImplicitGpuShader';
import {markSourceTextureMaximumAnisotropy} from './sourceProcessingTextureSampling';

const F=Math.fround;
const rgb=(packed:number)=>[F((packed>>>16&255)/255),F((packed>>>8&255)/255),F((packed&255)/255)];
/** Retained ImplicitSurface PShape fill; the shared presentation renderer owns
 * contour lines. Source CPU fallback positions/normals are uploaded unchanged,
 * with neither vertex merging nor an inverse-transpose normal transform. */
export function createSourceImplicitGpuFill(output:GeometryOutput,facts:SourceImplicitGpuPresentation,plan:SourceCameraPlan,maxAnisotropy:number){
 const normals=output.sourceImplicitMesh?.normals,count=output.positions.length/3,m=facts.material;
 if(!(normals instanceof Float32Array)||normals.length!==output.positions.length||!(facts.palette instanceof Uint32Array)||facts.palette.length>65536||facts.meshComputation!=='source-cpu-fallback'||!['GPU','AUTO'].includes(facts.meshMode))throw Error('源隐式 GPU 材质缺少对应网格、法线或调色板');
 if(!m||!Number.isFinite(m.shininess)||m.shininess<0||m.shininess>100||![m.ambient,m.specular].every(c=>Number.isInteger(c)&&c>=0&&c<=0xffffffff)||!Number.isInteger(m.proceduralTextureType)||m.proceduralTextureType<0||m.proceduralTextureType>4||!Number.isFinite(facts.fillOpacity)||facts.fillOpacity<0||facts.fillOpacity>1)throw Error('源隐式 GPU 材质数值无效');
 if(facts.boundsMin.length!==3||facts.boundsMax.length!==3||![...facts.boundsMin,...facts.boundsMax].every(n=>Number.isFinite(F(n)))||!Number.isFinite(maxAnisotropy)||maxAnisotropy<1)throw Error('源隐式 GPU 材质范围或纹理能力无效');
 const geometry=new THREE.BufferGeometry();let texture:THREE.DataTexture|undefined,material:THREE.RawShaderMaterial|undefined;
 try{
  const vertices=new Float32Array(count*4),indices=output.indices??new Uint32Array(count);
  for(let i=0;i<count;i++){vertices.set(output.positions.subarray(i*3,i*3+3),i*4);vertices[i*4+3]=1;if(!output.indices)indices[i]=i;}
  geometry.setAttribute('vertex',new THREE.BufferAttribute(vertices,4));geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));geometry.setAttribute('color',new THREE.BufferAttribute(facts.fillColors,4));geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),0);
  // PImage(RGB) retains packed palette colors but uploads opaque alpha. Both
  // active sampler names refer to this one image; useTexture remains zero.
  const pixels=new Uint8Array(Math.max(1,facts.palette.length)*4);if(!facts.palette.length)pixels.fill(255);
  for(let i=0;i<facts.palette.length;i++){const c=facts.palette[i];pixels.set([c>>>16&255,c>>>8&255,c&255,255],i*4);}
  texture=new THREE.DataTexture(pixels,Math.max(1,facts.palette.length),1,THREE.RGBAFormat);
  texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.anisotropy=maxAnisotropy;texture.generateMipmaps=true;texture.flipY=false;texture.colorSpace=THREE.NoColorSpace;texture.needsUpdate=true;
  markSourceTextureMaximumAnisotropy(texture);
  material=createSourceShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:sourceImplicitGpuVertex,fragmentShader:sourceImplicitGpuFragment,
   side:THREE.DoubleSide,forceSinglePass:true,transparent:true,depthTest:true,depthWrite:true,depthFunc:THREE.LessEqualDepth,toneMapped:false,
   blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendEquationAlpha:THREE.AddEquation,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneFactor,
   uniforms:{transform:{kind:'mat4',value:new THREE.Matrix4().fromArray(plan.transform.columnMajor)},modelview:{kind:'mat4',value:new THREE.Matrix4().fromArray(plan.modelView.columnMajor)},boundsMin:{kind:'vec3',value:facts.boundsMin},boundsMax:{kind:'vec3',value:facts.boundsMax},meshFillColor:{kind:'vec4',value:[1,1,1,1]},meshFillOpacity:{kind:'float',value:facts.fillOpacity},meshWireframeColor:{kind:'vec4',value:[0,0,0,0]},useWireframe:{kind:'int',value:0},wireframeThickness:{kind:'float',value:0},wireframeDistanceScale:{kind:'float',value:0},wireframeDistanceMin:{kind:'float',value:0},wireframeDistanceMax:{kind:'float',value:0},wireframeFresnelPower:{kind:'float',value:0},wireframeFresnelStrength:{kind:'float',value:0},useTexture:{kind:'int',value:0},enableLighting:{kind:'int',value:1},materialShininess:{kind:'float',value:m.shininess},materialAmbient:{kind:'vec3',value:rgb(m.ambient)},materialSpecular:{kind:'vec3',value:rgb(m.specular)},proceduralTextureType:{kind:'int',value:m.proceduralTextureType},lightDir:{kind:'vec3',value:[.5,.5,1]},paletteSize:{kind:'int',value:facts.palette.length},paletteTex:{kind:'sampler2d',value:texture},texMap:{kind:'sampler2d',value:texture}},
  },{rangeIdentity:'attribute-only'});
  const ownedTexture=texture;material.addEventListener('dispose',()=>ownedTexture.dispose());
  const fill=new THREE.Mesh(geometry,material);fill.frustumCulled=false;fill.visible=facts.fill;return fill;
 }catch(error){geometry.dispose();if(material)material.dispose();else texture?.dispose();throw error;}
}
