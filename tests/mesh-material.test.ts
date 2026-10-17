import {describe,it,expect} from 'vitest';
import {Box3,Vector3} from 'three';
import {meshAppearanceDefaults,parseMeshAppearance,isMeshMaterialControlVisible} from '../src/engine/meshAppearance';
import {createMeshMaterial} from '../src/engine/meshMaterial';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
describe('mesh appearance owner',()=>{
 it('sets real Phong properties and transparent/depth contracts',()=>{
  const appearance=parseMeshAppearance({...meshAppearanceDefaults,shininess:87,specular:'#ff0000',meshWireframe:true}),bounds=new Box3(new Vector3(-1,-1,-1),new Vector3(1,1,1));
  const material=createMeshMaterial(appearance,bounds,.4);expect(material.isMeshPhongMaterial).toBe(true);expect(material.shininess).toBe(87);expect(material.specular.getHexString()).toBe('ff0000');expect(material.opacity).toBe(.4);expect(material.depthWrite).toBe(false);expect(material.transparent).toBe(true);expect(material.polygonOffset).toBe(true);material.dispose();
 });
 it('rejects invalid material values before allocating GPU programs',()=>{
  for(const patch of [{shininess:101},{ambient:'red'},{specular:'#fff'},{proceduralTexture:'unknown'},{textureScale:0},{meshFill:'false'}])expect(()=>parseMeshAppearance(patch as any)).toThrow();
 });
 it('only presents material controls for mesh outputs and reveals effective dependent controls',()=>{
  const scene=createScene(definition('surface'));scene.settings.renderMode='points';expect(isMeshMaterialControlVisible(scene,'shininess')).toBe(false);scene.settings.renderMode='mesh';expect(isMeshMaterialControlVisible(scene,'shininess')).toBe(true);expect(isMeshMaterialControlVisible(scene,'textureScale')).toBe(false);scene.settings.proceduralTexture='checker';expect(isMeshMaterialControlVisible(scene,'textureScale')).toBe(true);scene.settings.meshFill=false;expect(isMeshMaterialControlVisible(scene,'shininess')).toBe(false);expect(isMeshMaterialControlVisible(scene,'meshWireframe')).toBe(true);
 });
});
