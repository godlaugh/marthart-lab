import type {SceneDocument,Settings} from '../types';
import {usesSourceMapMath} from './sourceMapMath';
import {sourceMapRuntimeColors} from './sourceMapRuntimeColors';
export const SOURCE_MAP_SPLAT_NUMBER_FIELDS=['dot_size','step_metric_min','step_metric_max','color_speed','color_phase'] as const;
export const SOURCE_MAP_SPLAT_MODEL='map-splat-1.7.8' as const;
export function usesSourceMapSplat(scene:Pick<SceneDocument,'kind'|'settings'>):boolean{return scene.kind==='map'&&scene.settings.mapSplatModel===SOURCE_MAP_SPLAT_MODEL;}
export function validateSourceMapSplat(scene:Pick<SceneDocument,'kind'|'settings'>):void {
 if(scene.settings.mapSplatModel===undefined)return;
 if(!usesSourceMapSplat(scene)||!usesSourceMapMath(scene))throw Error('源 Map 散点需要对应的持续 GPU 数学模型');
 sourceMapSplatSettings(scene.settings);
}
/** Construction accepts subpixel/negative dot sizes. Radius clamps only after
 * multiplying displayScale; a later native dot-size setter is a distinct event. */
export function sourceMapSplatSettings(settings:Settings){
 const read=(key:string,fallback:number)=>{const raw=settings[key]??fallback;if(typeof raw!=='number'||!Number.isFinite(Math.fround(raw)))throw Error(`源 Map ${key} 需要有限 Float32`);return Math.fround(raw);};
 const pointSize=read('pointSize',1),metricMin=read('stepMetricMin',0),metricMax=Math.max(read('stepMetricMax',2),Math.fround(metricMin+Math.fround(.001)));
 const metricMode=settings.stepMetricNormalize??'clamp';if(metricMode!=='clamp'&&metricMode!=='robust')throw Error('源 Map 步长度量模式无效');
 const colors=sourceMapRuntimeColors(settings);
 return{pointSize,metricMin,metricMax,metricMode,color:'step',...colors,colorPhaseRadians:Math.fround(Math.fround(colors.colorPhase*Math.fround(Math.PI))/180)} as const;
}
