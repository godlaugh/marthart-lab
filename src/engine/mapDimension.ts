import type {SceneDefinition,SceneDocument,Settings} from '../types';
import {numberSetting} from './expression';

/** The same dimension contract governs static/continuous generation and editing. */
export function mapDimension(settings:Settings):2|3 {
 const value=numberSetting(settings,'dimension',2,2,3);
 if(value!==2&&value!==3)throw new Error('映射维度必须为 2 或 3');
 return value;
}
/** Explicit user action only: parsing, importing, and timeline sampling must not
 * erase authored equations. The caller stores the old document for Undo. */
export function changeMapDimension(scene:SceneDocument,value:Settings[string]):SceneDocument {
 if(scene.kind!=='map')throw new Error('仅映射场景支持此维度切换');
 const dimension=mapDimension({dimension:value});
 let previous:2|3|undefined;
 try{previous=mapDimension(scene.settings);}catch{/* Explicit selection repairs an invalid stored dimension. */}
 if(previous===dimension)return scene;
 return{...scene,settings:{...scene.settings,dimension},equations:{...scene.equations,z:dimension===2?'':'z'}};
}
export function editableEquations(scene:SceneDocument,equations:SceneDefinition['equations']):SceneDefinition['equations'] {
 if(scene.kind!=='map')return equations;
 try{return mapDimension(scene.settings)===2?equations.filter(eq=>eq.key!=='z'):equations;}
 catch{return equations;} // Unknown dimensions never hide retained source values.
}
