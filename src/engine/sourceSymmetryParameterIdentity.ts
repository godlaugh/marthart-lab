import type {SceneDocument} from '../types';
import {SOURCE_SYMMETRY_PARAMETER_MODEL} from './sourceRegistryParameterConfig';
import {usesSourceSymmetryGradient,validateSourceSymmetryGradient} from './sourceSymmetryGradient';
export function usesSourceSymmetryParameters(scene:Pick<SceneDocument,'kind'|'settings'>):boolean{return scene.kind==='symmetry'&&scene.settings.symmetryParameterModel===SOURCE_SYMMETRY_PARAMETER_MODEL;}
/** New imports opt in explicitly; opening an older source-gradient document
 * must not silently reinterpret its local parameter animations. */
export function validateSourceSymmetryParameters(scene:SceneDocument):void {
 const enabled=usesSourceSymmetryParameters(scene);
 if(scene.settings.symmetryParameterModel!==undefined){
  if(!enabled||!usesSourceSymmetryGradient(scene))throw Error('源 Symmetry 参数需要对应渐变与共享队列模型');
  validateSourceSymmetryGradient(scene);
 }
}
