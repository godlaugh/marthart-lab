import type {Preset, SceneDefinition, SceneDocument, Settings} from '../types';
import {visiblePerlinControls} from '../scenes/perlin';

/** Match the active mathematical recipe, independent of artwork name or ID.
 * Inactive controls and global appearance/camera are not preset identity. */
export function matchingPerlinPreset(scene:SceneDocument,definition:SceneDefinition):Preset|undefined {
  if(scene.kind!=='perlin'||definition.kind!=='perlin')return;
  const actual={...definition.defaults.settings,...scene.settings};
  const matches=definition.presets.filter(preset=>{
    const expected={...definition.defaults.settings,...preset.settings};
    return visiblePerlinControls(definition.controls,expected)
      .filter(control=>control.key!=='perlinBackend')
      .every(control=>actual[control.key]===expected[control.key]);
  });
  return matches.length===1?matches[0]:undefined;
}

/** The caller supplies fresh entropy; only the mathematical noise seed changes.
 * Guarantee a different seed even if the random draw repeats the old one. */
export function refreshPerlinSeed(settings:Settings,entropy:number):Settings {
  if(!Number.isInteger(entropy)||entropy<0||entropy>0xffffffff)throw new Error('噪声种子须为 32 位非负整数');
  return {...settings,seed:entropy===Number(settings.seed??42)?(entropy+1)>>>0:entropy};
}
