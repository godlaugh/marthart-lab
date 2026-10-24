/** Explicit authoring events for Roots. The App owns their command routing;
 * a value comparison cannot distinguish staged edits from hot updates. */
export type RootsEditorIntent =
 | 'roots-apply'
 | 'roots-stage'
 | 'roots-palette'
 | 'roots-tone'
 | 'roots-transform'
 | 'roots-offset'
 | 'roots-metadata';
import type {SceneDocument} from '../types';
import type {RootsEditorAction} from './rootsEditorSession';
import type {RootsControlPayload} from './rootsControl';
import {ROOTS_SOURCE_TONE_FIELDS,ROOTS_SOURCE_TONE_DEFAULTS} from './rootsDensityColor';
import {parseRootsPresentationConfiguration} from './rootsPresentationConfig';


/** Project the explicit event, not the author document's differences. Only
 * Apply may carry staged mode, camera, timeline or computation into runtime.
 * Numeric normalization and detached ownership remain in the command owner. */
export function rootsEditorActionFor(next:SceneDocument,intent:RootsEditorIntent):RootsEditorAction {
 switch(intent){
  case 'roots-stage':return{kind:'stage'};
  case 'roots-metadata':return{kind:'metadata'};
  case 'roots-apply':return{kind:'apply',scene:next};
  case 'roots-palette':return{kind:'hot',command:{kind:'palette',palette:next.rootsSourcePalette}};
  case 'roots-offset':return{kind:'hot',command:{kind:'offset',offset:Number(next.settings.rootSourcePaletteOffset??ROOTS_SOURCE_TONE_DEFAULTS.rootSourcePaletteOffset)}};
  case 'roots-transform':return{kind:'hot',command:{kind:'transform',transform:parseRootsPresentationConfiguration(next.rootsPresentation).transform}};
  case 'roots-tone':{
   const tone:Extract<RootsControlPayload,{kind:'tone'}>['tone']={dotSize:parseRootsPresentationConfiguration(next.rootsPresentation).dotSize};
   for(const field of ROOTS_SOURCE_TONE_FIELDS)if(field.field!=='paletteOffset')tone[field.field]=Number(next.settings[field.key]??field.default);
   return{kind:'hot',command:{kind:'tone',tone}};
  }
 }
}
