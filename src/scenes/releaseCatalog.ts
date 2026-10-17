import {definition} from './index';
import type {SceneDefinition,SceneKind} from '../types';

/** Discovery for the 1.0 release. The complete registry remains the owner of
 * document decoding, imported projects, saved works and generation. */
export const creationDefinitions:readonly SceneDefinition[]=Object.freeze([definition('spirograph')]);

export function isCreationKind(kind:SceneKind):boolean {
  return creationDefinitions.some(item=>item.kind===kind);
}

const startupDefinition=definition('spirograph');
const startupPreset=startupDefinition.presets.find(item=>item.id==='hypotrochoid');
if(!startupPreset)throw new Error('Missing release startup preset: spirograph/hypotrochoid');

/** An explicit identity avoids changing first launch when guide examples move. */
export const defaultCreationTemplate=Object.freeze({definition:startupDefinition,preset:startupPreset});
