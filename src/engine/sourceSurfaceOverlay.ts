import {createSourceShaderMaterial} from './sourceShaderMaterial';
import * as THREE from 'three';

/** GenericSurfaceScene draws a final full-canvas black rectangle with depth
 * disabled. Keep it in a separate render pass, after every scene primitive.
 * Processing BLEND uses additive destination alpha, including this rectangle. */
export function createSourceSurfaceOverlay(){
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
 const material=createSourceShaderMaterial({glslVersion:THREE.GLSL3,
  vertexShader:'precision highp float; in vec3 position; void main(){ gl_Position=vec4(position,1.0); }',
  fragmentShader:'precision highp float; uniform float alpha; out vec4 color; void main(){ color=vec4(0.0,0.0,0.0,alpha); }',
  uniforms:{alpha:{kind:'float',value:0}},transparent:true,depthTest:false,depthWrite:false,toneMapped:false,
  blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,
  blendEquationAlpha:THREE.AddEquation,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneFactor,
 });
 const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;return mesh;
}
