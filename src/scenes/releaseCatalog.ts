import {definition,definitions} from './index';
import type {SceneDefinition,SceneKind} from '../types';

/** Discovery does not change document/runtime semantics. Only the explicit
 * preview build exposes the full registry; ordinary builds retain 1.0 scope. */
export function creationCatalogForMode(mode:string):readonly SceneDefinition[] {
  return Object.freeze(mode==='preview-v2'?[...definitions]:[definition('spirograph')]);
}
export const isCreationPreview=import.meta.env.MODE==='preview-v2';
export const creationDefinitions=creationCatalogForMode(import.meta.env.MODE);

export function isCreationKind(kind:SceneKind):boolean {
  return creationDefinitions.some(item=>item.kind===kind);
}

const startupDefinition=definition('spirograph');
const startupPreset=startupDefinition.presets.find(item=>item.id==='hypotrochoid');
if(!startupPreset)throw new Error('Missing release startup preset: spirograph/hypotrochoid');

/** An explicit identity avoids changing first launch when guide examples move. */
export const defaultCreationTemplate=Object.freeze({definition:startupDefinition,preset:startupPreset});
