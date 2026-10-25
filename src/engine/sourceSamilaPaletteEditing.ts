import type {Palette,SceneDocument} from '../types';
import {MAX_PALETTE_STOPS} from './palette';
import {sourceConfigPackedColor,sourceHotPalettePackedColor,sourceManualPalettePackedColor,SourceConfigColorError,SOURCE_COLOR_TEXT_BUDGET} from './sourceConfigColor';
import {defaultSourceCosinePalette,type SourceGradientPaletteCommit,type SourceGradientPaletteMode,type SourcePaletteGenerationResult} from './sourceGradientPaletteGeneration';
import type {SourcePaletteGeneratorConfiguration} from './sourcePaletteGeneratorImport';
import {usesSourceSamilaSplat} from './sourceSamilaSplat';
import {DEFAULT_SOURCE_SURFACE_COLORS} from './sourceSurfaceColor';
import {rootsControlRepresentationBytes} from './rootsControl';
import {sameSourceRecordingValue} from './sourceRecordingValue';
import {SOURCE_SAMILA_APPEARANCE_FIELDS} from './sourceSamilaFields';

export interface SourceSamilaPalette {colors:string[];}
/** Open-project UI state. Raw author text belongs only to samilaSourcePalette;
 * palette payloads are decoded separately in the effective configuration. */
export interface SamilaPaletteEditorState extends SourcePaletteGeneratorConfiguration {colorCount:number;manualColors?:string[];appearanceOpened?:true;}
/** Snapshot of the last full Apply, not the latest hot author palette. */
export interface SourceSamilaColdPalette {palette:Palette;useLut:boolean;}
export type SourceSamilaRuntimeConfiguration=Pick<SceneDocument,'equations'|'parameters'|'settings'|'palette'|'timeline'|'camera'|'projectResolution'|'runtimeSamilaViewport'>;
/** Complete last-applied and current effective configuration. Neither snapshot
 * recursively retains author, provenance, generator UI, or previous sessions. */
export interface SourceSamilaPaletteSession {applied:SourceSamilaRuntimeConfiguration;effective:SourceSamilaRuntimeConfiguration;runtimeRevision:number;parameterRevisions:Readonly<Record<string,number>>;}
export class SourceSamilaPaletteError extends Error {constructor(message:string,readonly kind:'input'|'capacity'='input'){super(message);}}
const runtimeKeys=['equations','parameters','settings','palette','timeline','camera','projectResolution','runtimeSamilaViewport'] as const;
// Two retained configurations plus detached edit copies, bounded independently
// of the renderer's GPU allocation and the App's history retention.
const SESSION_BUDGET=64*1024*1024;
const runtimeSettings=new Set<string>(['background',...Object.values(SOURCE_SAMILA_APPEARANCE_FIELDS).map(f=>f.key).filter(key=>key!=='trailLifetime')]);
/** Color widgets author opaque RGB. The constructor color is staged in author
 * settings, while the effective Scene retains its old packed color until Apply. */
function authoredBackgroundColor(scene:SceneDocument):number {
 const value=String(scene.settings.background??'#0a0c14');if(!/^#[0-9a-f]{6}$/i.test(value))throw new SourceSamilaPaletteError('Samila 背景需要 #RRGGBB');return sourceConfigPackedColor(value);
}
function configuration(scene:SceneDocument):SourceSamilaRuntimeConfiguration {
 return{equations:scene.equations,parameters:scene.parameters,settings:scene.settings,palette:scene.palette,timeline:scene.timeline,camera:scene.camera,projectResolution:scene.projectResolution,runtimeSamilaViewport:scene.runtimeSamilaViewport};
}
function admit(value:unknown){
 try{if(rootsControlRepresentationBytes(value)>SESSION_BUDGET)throw new SourceSamilaPaletteError('Samila applied/effective snapshots exceed the 64 MiB retained and copy budget','capacity');}
 catch(error){if(error instanceof SourceSamilaPaletteError)throw error;throw new SourceSamilaPaletteError(error instanceof Error?error.message:String(error),error&&typeof error==='object'&&'failureKind' in error&&error.failureKind==='capacity'?'capacity':'input');}
}
function snapshot(value:SourceSamilaRuntimeConfiguration,retained?:SourceSamilaRuntimeConfiguration):SourceSamilaRuntimeConfiguration {
 // Include input, detached output and retained anchor before making any copy.
 admit([retained,value,value]);const next=structuredClone(value),pending:unknown[]=[next];
 while(pending.length){const v=pending.pop();if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const child of Object.values(v))pending.push(child);Object.freeze(v);}}return next;
}
function initialSession(scene:SceneDocument):SourceSamilaPaletteSession {
 const cold=prepareSourceSamilaColdPalette(scene)!,effective=snapshot(configuration(scene)),applied=snapshot({...configuration(scene),palette:cold.palette,settings:{...scene.settings,samilaUsePaletteLut:cold.useLut}},effective);
 return{applied,effective,runtimeRevision:0,parameterRevisions:{}};
}
export function ensureSourceSamilaPaletteSession(scene:SceneDocument):SceneDocument {
 return scene.samilaSourcePalette&&usesSourceSamilaSplat(scene)&&!scene.samilaPaletteSession?{...scene,samilaPaletteSession:initialSession(scene)}:scene;
}
/** All ordinary author edits pass this one boundary. After a reset, untouched
 * hot author fields remain visible but do not leak back into effective state.
 * Explicit Apply/reset/history helpers already carry their chosen session. */
export function syncSourceSamilaPaletteSession(before:SceneDocument,next:SceneDocument,event?:{parameter?:string;setting?:string}):SceneDocument {
 if(!next.samilaSourcePalette||!usesSourceSamilaSplat(next)||next===before&&!event)return next;
 if(next.samilaPaletteSession&&next.samilaPaletteSession!==before.samilaPaletteSession)return next;
 if(!Object.is(before.settings.background,next.settings.background)||event?.setting==='background')next={...next,settings:{...next.settings,samilaSceneBackgroundColor:authoredBackgroundColor(next)}};
 if(!before.samilaSourcePalette||before.id!==next.id||before.samilaPaletteSession&&!next.samilaPaletteSession)return{...next,samilaPaletteSession:initialSession(next)};
 const session=before.samilaPaletteSession??initialSession(before),effective={...session.effective};let changed=false,runtimeWrite=false;
 for(const key of runtimeKeys){
  if(key==='parameters'||key==='settings'){
   const left=before[key],right=next[key],copy={...effective[key]};let mapChanged=false;
   for(const name of new Set([...Object.keys(left),...Object.keys(right)]))if(!(key==='settings'&&name==='samilaSceneBackgroundColor')&&(!Object.is(left[name],right[name])||Object.hasOwn(left,name)!==Object.hasOwn(right,name)||(key==='parameters'?event?.parameter:event?.setting)===name)){if(Object.hasOwn(right,name))copy[name]=right[name];else delete copy[name];mapChanged=true;if(key==='settings'&&runtimeSettings.has(name))runtimeWrite=true;}
   if(mapChanged){Object.assign(effective,{[key]:copy});changed=true;}
  }else if(!sameSourceRecordingValue(before[key],next[key])){Object.assign(effective,{[key]:next[key]});changed=true;}
 }
 // The source hot appearance entry sends this complete group in one setter.
 // A reset cannot make untouched author gamma/phase disappear from that call.
 if(runtimeWrite){effective.settings={...effective.settings};for(const key of runtimeSettings)if(Object.hasOwn(next.settings,key))effective.settings[key]=next.settings[key];else delete effective.settings[key];}
 const runtimeRevision=session.runtimeRevision+(runtimeWrite?1:0);if(!Number.isSafeInteger(runtimeRevision))throw new SourceSamilaPaletteError('Samila runtime-setting revision capacity exceeded','capacity');
 // Values alone cannot represent a same-value setter after the native queue
 // has animated that uniform. Retain one version per existing parameter, not
 // an unbounded event log; coalesced edits deliver only the latest value.
 let parameterRevisions=session.parameterRevisions;
 if(event?.parameter){const name=event.parameter,revision=(parameterRevisions[name]??0)+1;if(!Number.isSafeInteger(revision))throw new SourceSamilaPaletteError('Samila parameter revision capacity exceeded','capacity');parameterRevisions=Object.freeze({...parameterRevisions,[name]:revision});}
 return{...next,samilaPaletteSession:changed?{applied:session.applied,effective:snapshot(effective,session.applied),runtimeRevision,parameterRevisions}:session};
}
export function writeSourceSamilaParameter(scene:SceneDocument,name:string,value:number):SceneDocument {
 if(!Object.hasOwn(scene.parameters,name)||!Number.isFinite(value))throw new SourceSamilaPaletteError('Samila hot parameter requires an existing name and finite value');
 return syncSourceSamilaPaletteSession(scene,{...scene,parameters:{...scene.parameters,[name]:value}},{parameter:name});
}
export function writeSourceSamilaSetting(scene:SceneDocument,key:string,value:SceneDocument['settings'][string]):SceneDocument {
 return syncSourceSamilaPaletteSession(scene,{...scene,settings:{...scene.settings,[key]:value}},{setting:key});
}
export function validateSourceSamilaPalette(raw:unknown):SourceSamilaPalette {
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>key!=='colors'))throw new SourceSamilaPaletteError('源 Samila 色板只能包含 colors');
 const colors=(raw as {colors?:unknown}).colors;
 if(!Array.isArray(colors)||colors.some(c=>typeof c!=='string'))throw new SourceSamilaPaletteError('源 Samila palette 必须为字符串数组');
 // The source renderer currently accepts the same 1024-stop payload as Palette.
 // Reject before allocation; never truncate the raw list to fit the editor UI.
 if(colors.length>MAX_PALETTE_STOPS||colors.reduce((n,c)=>n+c.length*2,0)>SOURCE_COLOR_TEXT_BUDGET)throw new SourceSamilaPaletteError('源 Samila 色板超过 1024 色或 1 MiB UTF-16 文本容量','capacity');
 return raw as SourceSamilaPalette;
}
export function sourceSamilaEditableColors(scene:SceneDocument):readonly string[]{return scene.samilaSourcePalette?.colors??(scene.settings.samilaUsePaletteLut===false&&scene.palette.mode!=='cosine'?[]:scene.palette.stops);}
export function sourceSamilaPaletteEditorState(scene:SceneDocument):SamilaPaletteEditorState {
 if(scene.samilaPaletteEditor)return scene.samilaPaletteEditor;
 const {a,b,c,d}=defaultSourceCosinePalette(),length=sourceSamilaEditableColors(scene).length;
 // Existing local Cosine documents have no raw owner and keep their mode.
 return{useCosine:!scene.samilaSourcePalette&&scene.palette.mode==='cosine',cosine:scene.samilaSourcePalette?{a,b,c,d}:structuredClone(scene.palette.cosine??{a,b,c,d}),colorCount:Math.min(25,Math.max(2,length>=2?length:8))};
}
export function sourceSamilaPaletteEditorMode(state:SourcePaletteGeneratorConfiguration):SourceGradientPaletteMode{return state.useCurve?'curve':state.useCosine?'cosine':'manual';}
/** Appearance construction writes only author metadata, never either hot setter.
 * Count is taken before empty/single padding, and remount does not repeat it. */
export function openSourceSamilaPaletteEditor(scene:SceneDocument):SceneDocument {
 if(!usesSourceSamilaSplat(scene)||scene.samilaPaletteEditor?.appearanceOpened)return scene;
 const state=sourceSamilaPaletteEditorState(scene),raw=sourceSamilaEditableColors(scene),colors=raw.length===0?['#3B82F6','#22D3EE']:raw.length===1?[raw[0],'#F97316']:[...raw];
 validateSourceSamilaPalette({colors});
 // Opening an old local document must not silently opt it into new persistence.
 return{...scene,...(scene.samilaSourcePalette?{samilaSourcePalette:{colors},samilaPaletteSession:scene.samilaPaletteSession??initialSession(scene)}:{}),samilaPaletteEditor:{...state,appearanceOpened:true}};
}
function decodedPalette(colors:readonly string[],base:Palette,mode:'cold'|'hot',cosine?:SamilaPaletteEditorState):SourceSamilaColdPalette {
 validateSourceSamilaPalette({colors});
 const stops=colors.map(text=>{let packed:number;if(mode==='hot')packed=sourceHotPalettePackedColor(text);else try{packed=sourceConfigPackedColor(text);}catch(error){if(!(error instanceof SourceConfigColorError))throw error;packed=0xffffffff;}return '#'+(packed&0xffffff).toString(16).padStart(6,'0');});
 const continuous=mode==='hot'&&Boolean(cosine?.useCosine);
 return{palette:{name:base.name,mode:continuous?'cosine':'linear',offset:mode==='hot'?base.offset:0,cycles:1,stops:stops.length===0?['#000000','#000000']:stops.length===1?[stops[0],stops[0]]:stops,...(continuous?{cosine:structuredClone(cosine!.cosine)}:{})},useLut:colors.length>0};
}
export function prepareSourceSamilaColdPalette(scene:SceneDocument):SourceSamilaColdPalette|undefined {
 if(!scene.samilaSourcePalette)return undefined;
 if(!usesSourceSamilaSplat(scene))throw new SourceSamilaPaletteError('Samila source palette requires the source splat profile');
 return decodedPalette(validateSourceSamilaPalette(scene.samilaSourcePalette).colors,scene.palette,'cold');
}
/** Explicit full Apply alone replaces the cold reset anchor. */
export function applySourceSamilaPalette(scene:SceneDocument):SceneDocument {
 const cold=prepareSourceSamilaColdPalette(scene);if(!cold)return scene;
 const authored=authoredBackgroundColor(scene),source=scene.settings.samilaSceneBackgroundColor;
 if(source!==undefined&&(typeof source!=='number'||!Number.isSafeInteger(source)||source<0||source>0xffffffff))throw new SourceSamilaPaletteError('Samila Scene 背景需要 uint32 颜色');
 // Direct full-Apply callers may bypass the ordinary edit boundary. Preserve
 // original packed alpha/grayscale only while its shader RGB remains authored.
 const packed=typeof source==='number'&&(source&0xffffff)===(authored&0xffffff)?source:authored;
 const next={...scene,palette:cold.palette,settings:{...scene.settings,samilaSceneBackgroundColor:packed,samilaUsePaletteLut:cold.useLut}},applied=snapshot(configuration(next));return{...next,samilaPaletteSession:{applied,effective:applied,runtimeRevision:0,parameterRevisions:{}}};
}
/** Reset leaves author values and generator parameters alone. Rebuilding a
 * session for history does not call this: it resumes its effective snapshot. */
export function restartSourceSamilaPalette(scene:SceneDocument):SceneDocument {
 if(!scene.samilaSourcePalette)return scene;
 const session=scene.samilaPaletteSession??initialSession(scene);
 return{...scene,palette:structuredClone(session.applied.palette),settings:{...scene.settings,samilaUsePaletteLut:session.applied.settings.samilaUsePaletteLut},samilaPaletteSession:{applied:session.applied,effective:session.applied,runtimeRevision:0,parameterRevisions:{}}};
}
/** Save/reopen uses baked raw colors and the cold parser. Current open editor
 * state and live continuous mode are retained separately by the caller. */
export function sourceSamilaPalettePersistentScene(scene:SceneDocument):SceneDocument {
 // Persist author values, never the effective projection after a reset.
 const {samilaPaletteSession:_,samilaPaletteEditor:__,...runtime}=scene,cold=prepareSourceSamilaColdPalette(scene);
 return cold?{...runtime,palette:cold.palette,settings:{...runtime.settings,samilaUsePaletteLut:cold.useLut}}:runtime;
}
export function sourceSamilaPaletteRuntimeScene(scene:SceneDocument):SceneDocument {
 if(!Object.hasOwn(scene,'samilaPaletteEditor')&&!Object.hasOwn(scene,'samilaPaletteSession'))return scene;
 const {samilaPaletteEditor:_,samilaPaletteSession:session,...runtime}=scene;
 return session?{...runtime,...session.effective}:runtime;
}
export function retainSourceSamilaPaletteOnSave(before:SceneDocument,saved:SceneDocument):SceneDocument {
 if(before.kind!=='samila'||saved.kind!=='samila')return saved;
 return{...saved,palette:before.palette,settings:{...saved.settings,samilaUsePaletteLut:before.settings.samilaUsePaletteLut},...(before.samilaSourcePalette?{samilaSourcePalette:before.samilaSourcePalette}:{}),...(before.samilaPaletteEditor?{samilaPaletteEditor:before.samilaPaletteEditor}:{}),...(before.samilaPaletteSession?{samilaPaletteSession:before.samilaPaletteSession}:{})};
}
function edit(scene:SceneDocument,colors:readonly string[],state:SamilaPaletteEditorState):SourcePaletteGenerationResult<SceneDocument> {
 try{
  if(!usesSourceSamilaSplat(scene))throw new SourceSamilaPaletteError('Samila palette editing requires the source splat profile');
  const effective=sourceSamilaPaletteRuntimeScene(scene),runtime=decodedPalette(colors,effective.palette,'hot',state),session=scene.samilaSourcePalette?(scene.samilaPaletteSession??initialSession(scene)):undefined;
  return{ok:true,value:{...scene,...(session?{samilaSourcePalette:{colors:[...colors]},samilaPaletteSession:{...session,effective:snapshot({...session.effective,palette:runtime.palette,settings:{...session.effective.settings,samilaUsePaletteLut:runtime.useLut}},session.applied)}}:{}),samilaPaletteEditor:state,palette:runtime.palette,settings:{...scene.settings,samilaUsePaletteLut:runtime.useLut}}};
 }catch(error){return{ok:false,error:{kind:error instanceof SourceSamilaPaletteError?error.kind:'input',path:'samilaSourcePalette.colors',reason:error instanceof Error?error.message:String(error)}};}
}
export function commitSourceSamilaPalette(scene:SceneDocument,commit:SourceGradientPaletteCommit):SourcePaletteGenerationResult<SceneDocument> {
 const previous=sourceSamilaPaletteEditorState(scene),next={...previous};
 if(commit.kind==='mode'&&sourceSamilaPaletteEditorMode(previous)==='manual')next.manualColors=[...sourceSamilaEditableColors(scene)];
 next.colorCount=commit.state.colorCount;
 if(commit.mode==='cosine'){const {a,b,c,d}=commit.state;next.cosine=structuredClone({a,b,c,d});}else{const {red,green,blue}=commit.state;next.curves=structuredClone({red,green,blue});}
 if(commit.kind==='mode'){next.useCosine=commit.mode==='cosine';next.useCurve=commit.mode==='curve';}else if(commit.kind==='bake'){next.useCosine=false;next.useCurve=false;delete next.manualColors;}
 return edit(scene,commit.colors,next);
}
export function restoreSourceSamilaManualPalette(scene:SceneDocument):SourcePaletteGenerationResult<SceneDocument> {
 const state={...sourceSamilaPaletteEditorState(scene),useCosine:false,useCurve:false},colors=state.manualColors??sourceSamilaEditableColors(scene);delete state.manualColors;return edit(scene,colors,state);
}
export function changeSourceSamilaPalette(scene:SceneDocument,colors:readonly string[]):SourcePaletteGenerationResult<SceneDocument>{return edit(scene,colors,sourceSamilaPaletteEditorState(scene));}
export function sourceSamilaManualColorRgb(text:string):string{return '#'+(sourceManualPalettePackedColor(text)&0xffffff).toString(16).padStart(6,'0');}
export function sourceSamilaManualRgbText(rgb:string):string {if(!/^#[0-9a-f]{6}$/i.test(rgb))throw Error('色标必须使用 #RRGGBB');return rgb.toUpperCase();}
export const SOURCE_SAMILA_DEFAULT_COLORS=DEFAULT_SOURCE_SURFACE_COLORS;

/** Renderer owner keeps authored/applied/effective facts, never the editor UI. */
export function sourceSamilaOwnerScene(scene:SceneDocument):SceneDocument {const {samilaPaletteEditor:_,...owned}=scene;return owned;}
