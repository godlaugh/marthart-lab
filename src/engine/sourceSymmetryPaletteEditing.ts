import type {Palette,SceneDocument} from '../types';
import {importSourceConfigPalette} from './sourceConfigPalette';
import {sourceHotPalettePackedColor,sourceManualPalettePackedColor} from './sourceConfigColor';
import {defaultSourceCosinePalette,type SourceGradientPaletteCommit,type SourceGradientPaletteMode,type SourcePaletteGenerationResult} from './sourceGradientPaletteGeneration';
import type {SourcePaletteGeneratorConfiguration} from './sourcePaletteGeneratorImport';
import {validatePalette} from './palette';
import {usesSourceSymmetryGpu} from './sourceSymmetryMath';
import {usesSourceSymmetryConfiguration,parseSourceSymmetryConfiguration} from './sourceSymmetryConfig';
import {rootsControlRepresentationBytes} from './rootsControl';
import {ordinarySourceCameraInitial} from './ordinarySourceCamera';

export const SOURCE_SYMMETRY_DEFAULT_COLORS=['#FC6255','#FF862F','#FFCD62','#83C167','#58C4DD','#9A72AC'] as const;
export interface SymmetryPaletteEditorState extends SourcePaletteGeneratorConfiguration {colorCount:number;manualColors?:string[];appearanceOpened?:true;}
/** Complete applied configuration for Reset, history and recording. Hot
 * palette writes cannot promote other hot controls to constructor inputs. */
export interface SymmetryPaletteSession {cold:SceneDocument;}
class PaletteFailure extends Error {constructor(message:string,readonly kind:'input'|'capacity'='input'){super(message);}}
export function assertSymmetrySourcePaletteProfile(scene:SceneDocument):void {
 if(scene.kind!=='symmetry'||!scene.settings||!usesSourceSymmetryGpu(scene)||!usesSourceSymmetryConfiguration(scene))throw new PaletteFailure('源 Symmetry 色板需要源 GPU 和构造配置');
}
/** Reuse the expanded 768 MiB representation admission before copying. The
 * App may also pass its history/document slots for cumulative admission. */
export function assertSymmetryPaletteRetention(value:unknown):number {
 try{return rootsControlRepresentationBytes(value);}catch(error){throw new PaletteFailure(error instanceof Error?error.message.replaceAll('复根','Symmetry'):String(error),typeof error==='object'&&error!==null&&'failureKind'in error&&error.failureKind==='capacity'?'capacity':'input');}
}
const transientKeys=['symmetryPaletteSession','symmetryPaletteEditor','iteratedDraft','domainPaletteEditor','implicitPaletteEditor','samilaPaletteEditor','samilaPaletteSession','runtimeSamilaViewport','evaluatedCamera','evaluatedRootsCamera','evaluatedDomainGradient','evaluatedDomainScene','evaluatedFractalGradient','evaluatedFractalScene','evaluatedSourceCamera','evaluatedSpirographRotationRadians','evaluatedSpirographFrame'] as const;
const ownedCold=new WeakSet<SceneDocument>();
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function freezeCold(copy:SceneDocument):SceneDocument {
 const pending:unknown[]=[copy],seen=new Set<object>();
 while(pending.length){const item=pending.pop();if(item&&typeof item==='object'&&!seen.has(item)){seen.add(item);for(const child of Object.values(item))pending.push(child);Object.freeze(item);}}
 ownedCold.add(copy);return copy;
}
/** Transport removes Object.freeze. Revalidate the source-owned facts before
 * retaining a detached cold copy; file parsing never accepts this field. */
function validateCold(cold:SceneDocument):void {
 if(cold.version!==1||typeof cold.id!=='string'||!cold.id||typeof cold.name!=='string'||!cold.name||!record(cold.equations)||!record(cold.parameters)||!record(cold.settings)||!record(cold.timeline)||!record(cold.camera))throw new PaletteFailure('Symmetry cold snapshot requires a complete scene');
 assertSymmetrySourcePaletteProfile(cold);
 if(Object.values(cold.equations).some(value=>typeof value!=='string')||Object.values(cold.parameters).some(value=>typeof value!=='number'||!Number.isFinite(value))||Object.values(cold.settings).some(value=>!['string','boolean','number'].includes(typeof value)))throw new PaletteFailure('Symmetry cold snapshot contains invalid render inputs');
 const configuration=parseSourceSymmetryConfiguration(cold.symmetrySource);if(!configuration.ok)throw new PaletteFailure(configuration.error.reason,configuration.error.kind);
 if(!ordinarySourceCameraInitial(cold))throw new PaletteFailure('Symmetry cold snapshot requires a source camera');
 const raw=parseSymmetrySourcePalette(cold.symmetrySourcePalette),palette=validatePalette(cold.palette),expected=symmetryColdPalette(raw.colors,palette.name);
 if(palette.mode!=='linear'||palette.offset!==expected.offset||palette.cycles!==expected.cycles||palette.cosine!==undefined||JSON.stringify(palette.stops)!==JSON.stringify(expected.stops))throw new PaletteFailure('Symmetry cold snapshot palette must match its authored discrete colors');
}
/** Capture once at Apply; the immutable cold document is shared by subsequent
 * hot edits and never contains another session, editor or pending draft. */
export function snapshotSymmetryAppliedScene(scene:SceneDocument):SceneDocument {
 assertSymmetrySourcePaletteProfile(scene);
 if(!scene.symmetrySourcePalette)throw new PaletteFailure('Symmetry cold snapshot requires authored colors');
 const runtime={...scene,palette:symmetryColdPalette(scene.symmetrySourcePalette.colors,scene.palette.name)};for(const key of transientKeys)delete runtime[key];
 assertSymmetryPaletteRetention({input:runtime,detached:runtime});
 validateCold(runtime);return freezeCold(structuredClone(runtime));
}
function session(scene:SceneDocument):SymmetryPaletteSession {
 assertSymmetrySourcePaletteProfile(scene);
 if(scene.symmetryPaletteSession!==undefined){
  const owner=scene.symmetryPaletteSession;
  if(!record(owner)||Object.keys(owner).some(key=>key!=='cold'))throw new PaletteFailure('Symmetry cold snapshot requires a cold owner');
  const cold=owner.cold;
  if(!record(cold)||transientKeys.some(key=>Object.hasOwn(cold,key)))throw new PaletteFailure('Symmetry cold snapshot cannot contain transient or nested session fields');
  if(ownedCold.has(cold))return owner;
  assertSymmetryPaletteRetention({input:scene,detached:cold});validateCold(cold);
  return{cold:freezeCold(structuredClone(cold))};
 }
 return{cold:snapshotSymmetryAppliedScene(scene)};
}
/** Establish cold at document-open time, before the user can hot-edit a
 * parameter without ever visiting Appearance. History keeps an existing owner. */
export function ensureSymmetryPaletteSession(scene:SceneDocument):SceneDocument {
 if(!scene.symmetrySourcePalette)return scene;
 const owner=session(scene);return scene.symmetryPaletteSession===owner?scene:{...scene,symmetryPaletteSession:owner};
}
export function parseSymmetrySourcePalette(raw:unknown):{colors:string[]} {
 const value=raw as {colors?:unknown}|null;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>k!=='colors'))throw new PaletteFailure('Symmetry source palette requires colors');
 const parsed=importSourceConfigPalette(value.colors,[],'Symmetry');if(!parsed.ok)throw new PaletteFailure(parsed.error.reason,parsed.error.kind);
 if(!Array.isArray(value.colors))throw new PaletteFailure('Symmetry source palette requires colors');
 return{colors:[...value.colors]};
}
export function symmetryColdPalette(colors:readonly string[],name='原版导入'):Palette {
 const parsed=importSourceConfigPalette(colors,[],'Symmetry');if(!parsed.ok)throw new PaletteFailure(parsed.error.reason,parsed.error.kind);
 return{...parsed.value.palette,name};
}
export function symmetryPaletteEditorState(scene:SceneDocument):SymmetryPaletteEditorState {
 if(scene.symmetryPaletteEditor)return scene.symmetryPaletteEditor;
 const {a,b,c,d}=defaultSourceCosinePalette(),length=scene.symmetrySourcePalette?.colors.length??scene.palette.stops.length;
 return{useCosine:false,cosine:{a,b,c,d},colorCount:Math.min(25,Math.max(2,length>=2?length:8))};
}
export function symmetryPaletteEditorMode(state:SourcePaletteGeneratorConfiguration):SourceGradientPaletteMode{return state.useCurve?'curve':state.useCosine?'cosine':'manual';}
export function symmetryPaletteColdAnchor(scene:SceneDocument):SceneDocument {
 return session(scene).cold;
}
export function openSymmetryPaletteEditor(scene:SceneDocument):SceneDocument {
 if(!scene.symmetrySourcePalette||scene.symmetryPaletteEditor?.appearanceOpened)return scene;
 const state=symmetryPaletteEditorState(scene),raw=scene.symmetrySourcePalette.colors;
 const colors=raw.length===0?['#3B82F6','#22D3EE']:raw.length===1?[raw[0],'#F97316']:[...raw];
 assertSymmetrySourcePaletteProfile(scene);
 return{...scene,symmetrySourcePalette:{colors},symmetryPaletteEditor:{...state,appearanceOpened:true},symmetryPaletteSession:session(scene)};
}
function edit(scene:SceneDocument,colors:readonly string[],state:SymmetryPaletteEditorState):SourcePaletteGenerationResult<SceneDocument>{
 try{
  assertSymmetrySourcePaletteProfile(scene);if(!scene.symmetrySourcePalette)throw new PaletteFailure('Source Symmetry palette owner required');
  const raw=parseSymmetrySourcePalette({colors}),stops=colors.map(text=>'#'+(sourceHotPalettePackedColor(text)&0xffffff).toString(16).padStart(6,'0'));
  // updatePalette ignores empty lists, but the following cosine setter still
  // updates the flag/coefficients and schedules replay even for equal values.
  const palette:Palette={name:scene.palette.name,mode:state.useCosine?'cosine':'linear',offset:scene.palette.offset,cycles:1,stops:stops.length===0?[...scene.palette.stops]:stops.length===1?[stops[0],stops[0]]:stops,...(state.useCosine?{cosine:structuredClone(state.cosine)}:{})};
  validatePalette(palette);
  return{ok:true,value:{...scene,palette,symmetrySourcePalette:raw,symmetryPaletteEditor:state,symmetryPaletteSession:session(scene)}};
 }catch(error){return{ok:false,error:{kind:error instanceof PaletteFailure?error.kind:'input',path:'symmetrySourcePalette.colors',reason:error instanceof Error?error.message:String(error)}};}
}
export function commitSymmetrySourcePalette(scene:SceneDocument,commit:SourceGradientPaletteCommit):SourcePaletteGenerationResult<SceneDocument>{
 const previous=symmetryPaletteEditorState(scene),next={...previous};
 if(commit.kind==='mode'&&symmetryPaletteEditorMode(previous)==='manual')next.manualColors=[...scene.symmetrySourcePalette!.colors];
 next.colorCount=commit.state.colorCount;
 if(commit.mode==='cosine'){const {a,b,c,d}=commit.state;next.cosine=structuredClone({a,b,c,d});}else{const {red,green,blue}=commit.state;next.curves=structuredClone({red,green,blue});}
 if(commit.kind==='mode'){next.useCosine=commit.mode==='cosine';next.useCurve=commit.mode==='curve';}
 else if(commit.kind==='bake'){next.useCosine=false;next.useCurve=false;delete next.manualColors;}
 return edit(scene,commit.colors,next);
}
export function restoreSymmetrySourceManualPalette(scene:SceneDocument):SourcePaletteGenerationResult<SceneDocument>{const state={...symmetryPaletteEditorState(scene),useCosine:false,useCurve:false},colors=state.manualColors??scene.symmetrySourcePalette!.colors;delete state.manualColors;return edit(scene,colors,state);}
export function changeSymmetrySourcePalette(scene:SceneDocument,colors:readonly string[]):SourcePaletteGenerationResult<SceneDocument>{return edit(scene,colors,symmetryPaletteEditorState(scene));}
export function applySymmetrySourcePalette(scene:SceneDocument):SceneDocument {
 if(!scene.symmetrySourcePalette)return scene;
 const palette=symmetryColdPalette(scene.symmetrySourcePalette.colors,scene.palette.name),applied={...scene,palette};
 return{...applied,symmetryPaletteSession:{cold:snapshotSymmetryAppliedScene(applied)}};
}
/** The ProjectState parameter tree belongs to the author. Reset and recording
 * restore construction A, but the next Apply must still consume editor B. */
function retainSymmetryParameterEditor(before:SceneDocument,runtime:SceneDocument):SceneDocument['symmetrySource'] {
 if(!before.symmetrySource||!runtime.symmetrySource)return runtime.symmetrySource;
 const {editorMap:_,editorParameters:__,...configuration}=runtime.symmetrySource;
 return{...configuration,...(Object.hasOwn(before.symmetrySource,'editorMap')?{editorMap:before.symmetrySource.editorMap}:{}),...(Object.hasOwn(before.symmetrySource,'editorParameters')?{editorParameters:before.symmetrySource.editorParameters}:{})};
}
export function restartSymmetrySourcePalette(scene:SceneDocument):SceneDocument {
 if(!scene.symmetrySourcePalette)return scene;
 const anchor=session(scene);assertSymmetryPaletteRetention({input:scene,detached:anchor.cold});
 const runtime=structuredClone(anchor.cold);
 return{...runtime,id:scene.id,name:scene.name,description:scene.description,favorite:scene.favorite,symmetrySource:retainSymmetryParameterEditor(scene,runtime),symmetrySourcePalette:scene.symmetrySourcePalette,symmetryPaletteEditor:scene.symmetryPaletteEditor,symmetryPaletteSession:anchor};
}
export function symmetryPaletteRuntimeScene(scene:SceneDocument):SceneDocument {
 if(!Object.hasOwn(scene,'symmetryPaletteEditor'))return scene;
 const {symmetryPaletteEditor:_,...runtime}=scene;return runtime;
}
export function persistentSymmetryPaletteScene(scene:SceneDocument):SceneDocument {
 const {symmetryPaletteEditor:_,symmetryPaletteSession:__,...document}=scene;
 return document.symmetrySourcePalette?{...document,palette:symmetryColdPalette(document.symmetrySourcePalette.colors,document.palette.name)}:document;
}
export function retainSymmetryPaletteOnSave(before:SceneDocument,saved:SceneDocument):SceneDocument {
 return before.symmetrySourcePalette&&saved.kind==='symmetry'?{...saved,palette:before.palette,symmetryPaletteEditor:before.symmetryPaletteEditor,symmetryPaletteSession:before.symmetryPaletteSession}:saved;
}
/** Recording owns runtime palette A, while the open editor still owns raw B.
 * Do not turn that distinction into a staged generic-palette draft. */
export function retainSymmetryPaletteAfterRecording(before:SceneDocument,runtime:SceneDocument):SceneDocument {
 return before.symmetrySourcePalette&&runtime.kind==='symmetry'?{...runtime,symmetrySource:retainSymmetryParameterEditor(before,runtime),symmetrySourcePalette:before.symmetrySourcePalette,symmetryPaletteEditor:before.symmetryPaletteEditor,symmetryPaletteSession:before.symmetryPaletteSession}:runtime;
}
export const symmetryManualColorRgb=(text:string)=>'#'+(sourceManualPalettePackedColor(text)&0xffffff).toString(16).padStart(6,'0');
export function symmetryManualRgbText(rgb:string):string{if(!/^#[0-9a-f]{6}$/i.test(rgb))throw Error('色标必须使用 #RRGGBB');return rgb.toUpperCase();}
