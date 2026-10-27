import type {SceneDocument} from '../types';
import {usesSourceImplicitMesh} from './sourceImplicitIdentity';
import {ImplicitPaletteControlError,validateImplicitPaletteColors} from './sourceImplicitPalette';
import {sourceManualPalettePackedColor} from './sourceConfigColor';
import {defaultSourceCosinePalette,type SourceGradientPaletteCommit,type SourceGradientPaletteMode,type SourcePaletteGenerationResult} from './sourceGradientPaletteGeneration';
import type {SourcePaletteGeneratorConfiguration} from './sourcePaletteGeneratorImport';

/** BaseImplicitSurfaceConfig defaults, distinct from ProjectState's seven. */
export const SOURCE_IMPLICIT_DEFAULT_COLORS=['#FC6255','#FF862F','#FFCD62','#83C167','#58C4DD','#9A72AC'] as const;
/** Open-project UI only. The authored color list is implicitSourcePalette;
 * neither generator parameters nor the Manual snapshot are renderer input. */
export interface ImplicitPaletteEditorState extends SourcePaletteGeneratorConfiguration {
 colorCount:number;
 manualColors?:string[];
 appearanceOpened?:true;
}
/** Old local documents without a raw owner retain their existing manual stops.
 * Provenance is evidence, never a second source to rehydrate on each mount. */
export function implicitEditableColors(scene:SceneDocument):readonly string[]{return scene.implicitSourcePalette?.colors??scene.palette.stops;}
export function implicitPaletteEditorState(scene:SceneDocument):ImplicitPaletteEditorState {
 if(scene.implicitPaletteEditor)return scene.implicitPaletteEditor;
 const {a,b,c,d}=defaultSourceCosinePalette(),length=implicitEditableColors(scene).length;
 return{useCosine:false,cosine:{a,b,c,d},colorCount:Math.min(25,Math.max(2,length>=2?length:8))};
}
export function implicitPaletteEditorMode(state:SourcePaletteGeneratorConfiguration):SourceGradientPaletteMode{return state.useCurve?'curve':state.useCosine?'cosine':'manual';}
/** Appearance's first composition pads the author list but does not notify the
 * runtime. App owns this metadata transition separately from palette commands.
 * Count is captured before padding; subsequent empty edits stay empty. */
export function openImplicitPaletteEditor(scene:SceneDocument):SceneDocument {
 if(!usesSourceImplicitMesh(scene)||scene.implicitPaletteEditor?.appearanceOpened)return scene;
 const state=implicitPaletteEditorState(scene),raw=implicitEditableColors(scene);
 const colors=raw.length===0?['#3B82F6','#22D3EE']:raw.length===1?[raw[0],'#F97316']:[...raw];
 validateImplicitPaletteColors(colors);
 return{...scene,implicitSourcePalette:{colors},implicitPaletteEditor:{...state,appearanceOpened:true}};
}
function edit(scene:SceneDocument,colors:readonly string[],state:ImplicitPaletteEditorState):SourcePaletteGenerationResult<SceneDocument>{
 try{
  if(!usesSourceImplicitMesh(scene))throw Error('Implicit source palette editing requires the source mesh profile');
  validateImplicitPaletteColors(colors);
  return{ok:true,value:{...scene,implicitSourcePalette:{colors:[...colors]},implicitPaletteEditor:state}};
 }catch(error){return{ok:false,error:{kind:error instanceof ImplicitPaletteControlError?error.kind:'input',path:'implicitSourcePalette.colors',reason:error instanceof Error?error.message:String(error)}};}
}
export function commitImplicitSourcePalette(scene:SceneDocument,commit:SourceGradientPaletteCommit):SourcePaletteGenerationResult<SceneDocument>{
 const previous=implicitPaletteEditorState(scene),next={...previous};
 if(commit.kind==='mode'&&implicitPaletteEditorMode(previous)==='manual')next.manualColors=[...implicitEditableColors(scene)];
 next.colorCount=commit.state.colorCount;
 if(commit.mode==='cosine'){const {a,b,c,d}=commit.state;next.cosine=structuredClone({a,b,c,d});}
 else{const {red,green,blue}=commit.state;next.curves=structuredClone({red,green,blue});}
 if(commit.kind==='mode'){next.useCosine=commit.mode==='cosine';next.useCurve=commit.mode==='curve';}
 else if(commit.kind==='bake'){next.useCosine=false;next.useCurve=false;delete next.manualColors;}
 return edit(scene,commit.colors,next);
}
export function restoreImplicitSourceManualPalette(scene:SceneDocument):SourcePaletteGenerationResult<SceneDocument>{
 const state={...implicitPaletteEditorState(scene),useCosine:false,useCurve:false},colors=state.manualColors??implicitEditableColors(scene);
 delete state.manualColors;return edit(scene,colors,state);
}
export function changeImplicitSourcePalette(scene:SceneDocument,colors:readonly string[]):SourcePaletteGenerationResult<SceneDocument>{return edit(scene,colors,implicitPaletteEditorState(scene));}
/** Picker display follows Manual's parser; it is not the hot/cold renderer. */
export function implicitManualColorRgb(text:string):string{return '#'+(sourceManualPalettePackedColor(text)&0xffffff).toString(16).padStart(6,'0');}
export function implicitManualRgbText(rgb:string):string {
 if(!/^#[0-9a-f]{6}$/i.test(rgb))throw Error('色标必须使用 #RRGGBB');return rgb.toUpperCase();
}
/** Strip before cloning. Evaluated facts and the sole raw color owner survive. */
export function implicitPaletteRuntimeScene(scene:SceneDocument):SceneDocument {
 if(!Object.hasOwn(scene,'implicitPaletteEditor'))return scene;
 const {implicitPaletteEditor:_,...runtime}=scene;return runtime;
}
export function retainImplicitPaletteEditorOnSave(before:SceneDocument,saved:SceneDocument):SceneDocument {
 return before.kind==='implicit'&&saved.kind==='implicit'&&before.implicitPaletteEditor?{...saved,implicitPaletteEditor:before.implicitPaletteEditor}:saved;
}
