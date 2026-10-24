import type {SceneDocument} from '../types';
import {DEFAULT_DOMAIN_SOURCE_COLORS,parseDomainSourcePalette} from './domainSourcePalette';
import {defaultSourceCosinePalette,type SourceGradientPaletteCommit,type SourceGradientPaletteMode,type SourcePaletteGenerationResult} from './sourceGradientPaletteGeneration';
import type {SourcePaletteGeneratorConfiguration} from './sourcePaletteGeneratorImport';

/** Open-project UI only: excluded from files, renderer identities and Worker
 * messages. The sole applied color list remains domainSourcePalette.colors. */
export interface DomainPaletteEditorState extends SourcePaletteGeneratorConfiguration {
 colorCount:number;
 /** Raw colors captured when explicitly leaving Manual, never renderer input. */
 manualColors?:string[];
}
export function domainPaletteEditorState(scene:SceneDocument):DomainPaletteEditorState {
 if(scene.domainPaletteEditor)return scene.domainPaletteEditor;
 const {a,b,c,d}=defaultSourceCosinePalette(),length=(scene.domainSourcePalette?.colors??DEFAULT_DOMAIN_SOURCE_COLORS).length;
 return{useCosine:false,cosine:{a,b,c,d},colorCount:Math.min(25,Math.max(2,length>=2?length:8))};
}
export function domainPaletteEditorMode(state:SourcePaletteGeneratorConfiguration):SourceGradientPaletteMode{return state.useCurve?'curve':state.useCosine?'cosine':'manual';}
function edit(scene:SceneDocument,colors:readonly string[],state:DomainPaletteEditorState):SourcePaletteGenerationResult<SceneDocument>{
 try{return{ok:true,value:{...scene,domainSourcePalette:parseDomainSourcePalette({colors}),domainPaletteEditor:state}};}
 catch(error){return{ok:false,error:{kind:'input',path:'domainSourcePalette.colors',reason:error instanceof Error?error.message:String(error)}};}
}
export function commitDomainSourcePalette(scene:SceneDocument,commit:SourceGradientPaletteCommit):SourcePaletteGenerationResult<SceneDocument>{
 const previous=domainPaletteEditorState(scene),next={...previous};
 if(commit.kind==='mode'&&domainPaletteEditorMode(previous)==='manual')next.manualColors=[...(scene.domainSourcePalette?.colors??DEFAULT_DOMAIN_SOURCE_COLORS)];
 next.colorCount=commit.state.colorCount;
 if(commit.mode==='cosine'){const {a,b,c,d}=commit.state;next.cosine=structuredClone({a,b,c,d});}
 else{const {red,green,blue}=commit.state;next.curves=structuredClone({red,green,blue});}
 if(commit.kind==='mode'){next.useCosine=commit.mode==='cosine';next.useCurve=commit.mode==='curve';}
 else if(commit.kind==='bake'){next.useCosine=false;next.useCurve=false;delete next.manualColors;}
 return edit(scene,commit.colors,next);
}
export function restoreDomainSourceManualPalette(scene:SceneDocument):SourcePaletteGenerationResult<SceneDocument>{
 const state={...domainPaletteEditorState(scene),useCosine:false,useCurve:false},colors=state.manualColors??scene.domainSourcePalette?.colors??DEFAULT_DOMAIN_SOURCE_COLORS;
 delete state.manualColors;return edit(scene,colors,state);
}
export function changeDomainSourcePalette(scene:SceneDocument,colors:readonly string[]):SourcePaletteGenerationResult<SceneDocument>{return edit(scene,colors,domainPaletteEditorState(scene));}
/** Narrow wire projection: preserve evaluated runtime facts and object identity
 * when there is no UI state. Strip before structuredClone, never after it. */
export function domainPaletteRuntimeScene(scene:SceneDocument):SceneDocument {
 if(!Object.hasOwn(scene,'domainPaletteEditor'))return scene;
 const {domainPaletteEditor:_,...runtime}=scene;return runtime;
}
/** Save may assign a new library id; the currently open editor survives, while
 * the persisted library entry and explicit file reload stay session-free. */
export function retainDomainPaletteEditorOnSave(before:SceneDocument,saved:SceneDocument):SceneDocument {
 return before.kind==='domain'&&saved.kind==='domain'&&before.domainPaletteEditor?{...saved,domainPaletteEditor:before.domainPaletteEditor}:saved;
}
