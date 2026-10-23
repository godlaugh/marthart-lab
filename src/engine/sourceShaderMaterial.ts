import * as THREE from 'three';

type Components = readonly number[] | Float32Array | Int32Array;
/** The shader owner declares types. Both adapters read these same value cells;
 * neither shader text nor JavaScript value shape chooses a uniform's type. */
export type SourceShaderUniform =
  | {readonly kind:'float'|'int'; value:number}
  | {readonly kind:'vec2'|'ivec2'; value:Components|THREE.Vector2}
  | {readonly kind:'vec3'; value:Components|THREE.Vector3}
  | {readonly kind:'vec4'; value:Components|THREE.Vector4}
  | {readonly kind:'mat4'; value:THREE.Matrix4}
  | {readonly kind:'float-array'|'vec3-array'; readonly count:number; value:Float32Array}
  | {readonly kind:'sampler2d'; value:THREE.DataTexture};
export type SourceShaderUniforms = Record<string,SourceShaderUniform>;

const owners=new WeakMap<THREE.RawShaderMaterial,SourceShaderUniforms>();

export function createSourceShaderMaterial<U extends SourceShaderUniforms>(
  parameters:Omit<THREE.ShaderMaterialParameters,'uniforms'> & {uniforms:U},
):THREE.RawShaderMaterial & {uniforms:U} {
  const material=new THREE.RawShaderMaterial(parameters);
  // RawShaderMaterial retains the supplied cells, including later value edits.
  owners.set(material,parameters.uniforms);
  material.addEventListener('dispose',()=>owners.delete(material));
  return material as THREE.RawShaderMaterial & {uniforms:U};
}

export function sourceShaderUniformOwner(material:THREE.RawShaderMaterial):SourceShaderUniforms|undefined {
  return owners.get(material);
}
