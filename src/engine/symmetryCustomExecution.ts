import type {SceneDocument} from '../types';
import {sourceIteratedNativeKind} from './sourceIteratedNativeEligibility';
import {sourceDrawingPolicy} from './sourceDrawingPixels';
import {prepareSymmetryCustomSource,symmetryCustomCompileDegree} from './symmetryCustom';
import {prepareSourceSymmetryCustomProgram} from './sourceSymmetryCustom';

type Input=Pick<SceneDocument,'kind'|'settings'>&Partial<Pick<SceneDocument,'equations'|'symmetrySource'>>;
export function symmetryCustomExecutionBackend(scene:Input):'native'|'webgl2'{
 return sourceDrawingPolicy()==='native'&&sourceIteratedNativeKind({...scene,equations:scene.equations??{}})==='symmetry'?'native':'webgl2';
}
/** Editor diagnostics use the selected execution dialect. Driver compilation
 * still belongs to actual generation; preparation never proves a valid GLSL
 * program or bounds arbitrary author's execution time. */
export function prepareSymmetryCustomAuthoring(scene:Input,raw:string){
 const selected={...scene,equations:{...scene.equations,glsl:raw}},degree=symmetryCustomCompileDegree(scene);
 return symmetryCustomExecutionBackend(selected)==='native'?prepareSourceSymmetryCustomProgram(raw,degree):prepareSymmetryCustomSource(raw,degree);
}
