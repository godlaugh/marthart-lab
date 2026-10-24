import type {SceneDocument} from '../types';
import {domainPaletteRuntimeScene} from './domainPaletteEditing';
import {implicitPaletteRuntimeScene} from './implicitPaletteEditing';

/** Each editor owns its transient fields. Runtime transports compose those
 * projections without changing authored palette values or evaluation facts. */
export function sourcePaletteRuntimeScene(scene:SceneDocument):SceneDocument {
 return implicitPaletteRuntimeScene(domainPaletteRuntimeScene(scene));
}
