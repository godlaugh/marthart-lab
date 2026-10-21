import type {SceneDocument} from '../types';
import {SOURCE_MAP_PARAMETER_MODEL} from './sourceRegistryParameterConfig';
import {usesSourceMapMath} from './sourceMapMath';
import {usesSourceMapConfiguration} from './sourceMapScene';
export function usesSourceMapParameters(scene:Pick<SceneDocument,'kind'|'settings'>):boolean{return scene.kind==='map'&&scene.settings.mapParameterModel===SOURCE_MAP_PARAMETER_MODEL;}
export function validateSourceMapParameters(scene:SceneDocument):void {
 if(scene.settings.mapParameterModel===undefined)return;
 if(!usesSourceMapParameters(scene)||!usesSourceMapMath(scene)||!usesSourceMapConfiguration(scene)||!scene.sourceCamera||scene.timeline.schedule!=='ordinary-camera-sequence-v1')throw Error('源 Map 参数需要构造配置、GPU 与原版顺序时间线');
}
