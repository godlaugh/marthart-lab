import type {SceneDocument} from '../types';
import {FRACTAL_SOURCE_COLOR_PROFILE,createDefaultFractalSourceColorConfiguration,parseFractalSourceColorProfile} from './fractalSourceColor';

export function usesFractalSourceColor(scene:Pick<SceneDocument,'kind'|'settings'>):boolean {
 return scene.kind==='fractal'&&parseFractalSourceColorProfile(scene.settings.fractalColorProfile)===FRACTAL_SOURCE_COLOR_PROFILE;
}
export function authoredFractalSourceColor(scene:Pick<SceneDocument,'fractalSourceColor'>) {
 return scene.fractalSourceColor??createDefaultFractalSourceColorConfiguration();
}
/** Selection preserves both families' authored inputs. Initial source selection
 * uses source defaults; it never guesses a conversion of a local palette. */
export function selectFractalColorProfile(scene:SceneDocument,value:unknown):SceneDocument {
 const profile=parseFractalSourceColorProfile(value==='local-v1'?undefined:value),settings={...scene.settings};
 if(profile===undefined){delete settings.fractalColorProfile;return {...scene,settings};}
 return {...scene,settings:{...settings,fractalColorProfile:profile},fractalSourceColor:structuredClone(authoredFractalSourceColor(scene))};
}
export const FRACTAL_SOURCE_COLOR_ANIMATION_TARGETS=['fractalColor.paletteOffset','fractalColor.insideOffset','fractalColor.outsideOffset'] as const;
export function inactiveFractalSourceColorTarget(scene:Pick<SceneDocument,'kind'|'settings'>,target:string):boolean {
 return (FRACTAL_SOURCE_COLOR_ANIMATION_TARGETS as readonly string[]).includes(target)&&!usesFractalSourceColor(scene);
}
export function readFractalSourceColorAnimation(scene:SceneDocument,target:string):number|undefined {
 if(!usesFractalSourceColor(scene))return;
 const color=authoredFractalSourceColor(scene);
 return target==='fractalColor.paletteOffset'?color.palette.offset:target==='fractalColor.insideOffset'?color.inside.offset:target==='fractalColor.outsideOffset'?color.outside.offset:undefined;
}
export function writeFractalSourceColorAnimation(scene:SceneDocument,target:string,value:number):boolean {
 if(readFractalSourceColorAnimation(scene,target)===undefined)return false;
 const color=scene.fractalSourceColor??=createDefaultFractalSourceColorConfiguration();
 if(target==='fractalColor.paletteOffset')color.palette.offset=value;
 else if(target==='fractalColor.insideOffset')color.inside.offset=value;
 else color.outside.offset=value;
 return true;
}
