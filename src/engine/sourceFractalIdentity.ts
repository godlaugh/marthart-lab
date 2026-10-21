import type {SceneDocument} from '../types';
import {isJavaBlank} from './sourceJavaText';

/** Original fresh-config identity: blank is Java String.isBlank, while a
 * nonblank registry key is retained exactly (no trim or case normalization). */
export function sourceFractalFormulaIdentity(config:{readonly formulaId?:string|null;readonly fractalType:'mandelbrot'|'julia'}):string {
 return config.formulaId==null||isJavaBlank(config.formulaId)?config.fractalType:config.formulaId;
}
export type FractalFormulaIdentityScene=Pick<SceneDocument,'kind'|'settings'>&Partial<Pick<SceneDocument,'fractalSource'>>;
/** Legacy settings do not compete with an explicitly owned source formula. */
export function activeFractalFormulaIdentity(scene:FractalFormulaIdentityScene):string|undefined {
 if(scene.kind!=='fractal')return;
 return scene.fractalSource?sourceFractalFormulaIdentity(scene.fractalSource.formula):typeof scene.settings.formula==='string'?scene.settings.formula:undefined;
}
