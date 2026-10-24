import {definition,definitions} from './index';
import type {SceneDefinition,SceneDocument,SceneKind} from '../types';
import {createScene} from '../engine/document';
import {bouncingCreationPresets,bouncingDefaultPresetId} from './bouncingTemplates';

const bouncingCreationDefinition:SceneDefinition={...definition('bouncing'),presets:bouncingCreationPresets};
/** Creation templates have one owner; the registry still interprets existing
 * documents, including the earlier local Bouncing model. */
export function creationDefinition(kind:SceneKind):SceneDefinition {
  return kind==='bouncing'?bouncingCreationDefinition:definition(kind);
}
/** Only the explicit preview build exposes the full creation catalogue. */
export function creationCatalogForMode(mode:string):readonly SceneDefinition[] {
  return Object.freeze(mode==='preview-v2'?definitions.map(item=>creationDefinition(item.kind)):[definition('spirograph')]);
}
export const isCreationPreview=import.meta.env.MODE==='preview-v2';
export const creationDefinitions=creationCatalogForMode(import.meta.env.MODE);

export function isCreationKind(kind:SceneKind):boolean {
  return creationDefinitions.some(item=>item.kind===kind);
}

/** New, folder and example actions all resolve through this catalogue. A new
 * work gets its own identity even when it starts from a complete preset. */
export function createCreationScene(kind:SceneKind,presetId?:string):SceneDocument {
  const def=creationDefinition(kind),selected=presetId??(kind==='bouncing'?bouncingDefaultPresetId:undefined);
  const preset=selected===undefined?undefined:def.presets.find(item=>item.id===selected);
  if(selected!==undefined&&!preset)throw Error(`Unknown creation template: ${kind}/${selected}`);
  const scene=createScene(def,preset);
  return presetId===undefined?{...scene,id:crypto.randomUUID(),name:def.name,description:def.description}:scene;
}

export function isBuiltinCreationScene(scene:Pick<SceneDocument,'kind'|'id'>):boolean {
  // Preserve copy-on-save for drafts made from the earlier built-in examples.
  return [creationDefinition(scene.kind),definition(scene.kind)].some(def=>def.presets.some(p=>scene.id===`preset:${def.kind}:${p.id}`));
}

const startupDefinition=definition('spirograph');
const startupPreset=startupDefinition.presets.find(item=>item.id==='hypotrochoid');
if(!startupPreset)throw new Error('Missing release startup preset: spirograph/hypotrochoid');

/** An explicit identity avoids changing first launch when guide examples move. */
export const defaultCreationTemplate=Object.freeze({definition:startupDefinition,preset:startupPreset});
