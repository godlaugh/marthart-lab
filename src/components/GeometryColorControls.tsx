import type {SceneDocument} from '../types';
import {geometryColorControls,geometryColorModel} from '../engine/geometryColor';
import {SettingsFields} from './Fields';
export function GeometryColorControls({scene,onChange}:{scene:SceneDocument;onChange:(scene:SceneDocument)=>void}){
 const mode=geometryColorModel(scene);
 return <SettingsFields controls={geometryColorControls(scene)} settings={{surfaceColorMode:mode.surface,implicitColorMode:mode.implicit,surfaceGradientClosure:mode.closure,...scene.settings}} onChange={(key,value)=>onChange({...scene,settings:{...scene.settings,[key]:value}})}/>;
}
