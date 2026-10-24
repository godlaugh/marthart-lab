import type {SceneDocument} from '../types';
import type {ImplicitEditorAction} from './implicitEditorSession';
/** Explicit UI events; document differences cannot identify a runtime action. */
export type ImplicitEditorIntent='implicit-stage'|'implicit-metadata'|'implicit-apply'|'implicit-palette'|'implicit-restart';
export function implicitEditorActionFor(next:SceneDocument,intent:ImplicitEditorIntent):ImplicitEditorAction {
 switch(intent){
  case 'implicit-stage':return{kind:'stage'};
  case 'implicit-metadata':return{kind:'metadata'};
  case 'implicit-apply':return{kind:'apply',scene:next};
  case 'implicit-palette':return{kind:'palette',colors:next.implicitSourcePalette?.colors??next.palette.stops};
  case 'implicit-restart':return{kind:'restart'};
 }
}
