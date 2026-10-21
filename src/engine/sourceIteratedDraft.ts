import type {SceneDocument,Settings,Palette} from '../types';
import {ordinarySourceCameraInitial} from './ordinarySourceCamera';
import {sourceIteratedLiveKind} from './sourceLivePreview';
import {resolveSourceCamera,type SourceCameraInput} from './sourceCamera';
import {validatePalette} from './palette';
import {MAX_SYMMETRY_CUSTOM_SOURCE_LENGTH} from './symmetryCustom';

/** Persisted editor overlays, never passed to a renderer as effective inputs.
 * Null is an explicit deletion; omission means inherit the running document. */
export interface SourceIteratedDraft {
 equations?:Record<string,string|null>;
 parameters?:Record<string,number|null>;
 settings?:Record<string,Settings[string]|null>;
 palette?:Palette;
 sourceCamera?:SourceCameraInput;
 cameraTexts?:string[];
}
export type SourceIteratedDraftResult<T>={ok:true;value:T}|{ok:false;error:{kind:'input'|'capacity';reason:string}};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const bad=(reason:string,kind:'input'|'capacity'='input')=>({ok:false as const,error:{kind,reason}});
const equal=(a:unknown,b:unknown)=>JSON.stringify(a,(_k,v)=>Object.is(v,-0)?{number:'-0'}:v)===JSON.stringify(b,(_k,v)=>Object.is(v,-0)?{number:'-0'}:v);
export function parseSourceIteratedDraft(raw:unknown):SourceIteratedDraftResult<SourceIteratedDraft>{
 if(!record(raw)||Object.keys(raw).some(k=>!['equations','parameters','settings','palette','sourceCamera','cameraTexts'].includes(k)))return bad('迭代场景草稿结构无效');
 const out:SourceIteratedDraft={};
 for(const field of ['equations','parameters','settings'] as const){
  if(raw[field]===undefined)continue;const values=raw[field];if(!record(values))return bad('迭代场景草稿字段需要对象');
  // Same parameter-map capacity as the configuration owner; source text uses
  // the existing formula/GLSL limits, not a new hidden compilation limit.
  if(Object.keys(values).length>65536)return bad('迭代场景草稿超过本地成员容量','capacity');
  const entries:Record<string,unknown>=Object.create(null);
  for(const [key,value]of Object.entries(values)){
   if(value!==null&&(field==='equations'?typeof value!=='string':field==='parameters'?typeof value!=='number'||!Number.isFinite(value):!['number','string','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value)))return bad('迭代场景草稿值无效');
   if(field==='equations'&&typeof value==='string'&&(key.length>100||value.length>(key==='glsl'?MAX_SYMMETRY_CUSTOM_SOURCE_LENGTH:8192)))return bad('迭代场景草稿公式超过文本容量','capacity');
   entries[key]=value;
  }
  Object.assign(out,{[field]:entries});
 }
 if(raw.cameraTexts!==undefined){if(!Array.isArray(raw.cameraTexts)||raw.cameraTexts.length!==8||raw.cameraTexts.some(v=>typeof v!=='string'||v.length>8192))return bad('迭代场景相机草稿无效');out.cameraTexts=[...raw.cameraTexts];}
 if(raw.sourceCamera!==undefined){const parsed=resolveSourceCamera(raw.sourceCamera);if(!parsed.ok||parsed.value.kind!=='known')return bad('迭代场景草稿相机配置无效');out.sourceCamera=structuredClone(raw.sourceCamera) as SourceCameraInput;}
 if(raw.palette!==undefined){try{out.palette=validatePalette(raw.palette);}catch(e){return bad(e instanceof Error?e.message:String(e));}}
 return{ok:true,value:out};
}
export function withoutSourceIteratedDraft(scene:SceneDocument):SceneDocument {
 if(scene.iteratedDraft===undefined)return scene;const {iteratedDraft,...runtime}=scene;return runtime;
}
const overlay=<T>(base:Record<string,T>,patch?:Record<string,T|null>):Record<string,T>=>{
 if(!patch)return base;const out={...base};for(const [k,v]of Object.entries(patch)){if(v===null)delete out[k];else Object.defineProperty(out,k,{value:v,writable:true,enumerable:true,configurable:true});}return out;
};
/** Inspector-only view. It can contain an incomplete formula and is not a
 * validated construction document until the explicit Apply boundary succeeds. */
export function sourceIteratedEditorScene(runtime:SceneDocument,draft?:SourceIteratedDraft):SceneDocument {
 if(!draft)return runtime;
 return{...runtime,equations:overlay(runtime.equations,draft.equations),parameters:overlay(runtime.parameters,draft.parameters),settings:overlay(runtime.settings,draft.settings),...(draft.palette?{palette:draft.palette}:{}),...(draft.sourceCamera?{sourceCamera:draft.sourceCamera}:{})};
}
function difference<T>(base:Record<string,T>,next:Record<string,T>):Record<string,T|null>|undefined {
 const entries:[string,T|null][]=[];
 for(const key of new Set([...Object.keys(base),...Object.keys(next)]))if(!Object.hasOwn(next,key))entries.push([key,null]);else if(!Object.hasOwn(base,key)||!equal(base[key],next[key]))entries.push([key,next[key]]);
 return entries.length?Object.fromEntries(entries):undefined;
}
export function sourceIteratedDraftFromEditor(runtime:SceneDocument,editor:SceneDocument,cameraTexts?:string[]):SourceIteratedDraft|undefined {
 const draft:SourceIteratedDraft={};
 for(const field of ['equations','parameters','settings'] as const){const patch=difference<Settings[string]>(runtime[field],editor[field]);if(patch)Object.assign(draft,{[field]:patch});}
 if(!equal(runtime.palette,editor.palette))draft.palette=structuredClone(editor.palette);
 if(editor.sourceCamera&&!equal(runtime.sourceCamera,editor.sourceCamera))draft.sourceCamera=structuredClone(editor.sourceCamera);
 if(cameraTexts){const initial=ordinarySourceCameraInitial(editor);const baseline=initial?[initial.phi,initial.theta,initial.gamma,...initial.center,initial.zoom,initial.focalDistance].map(String):undefined;if(!equal(cameraTexts,baseline))draft.cameraTexts=[...cameraTexts];}
 return Object.keys(draft).length?draft:undefined;
}
export function withSourceIteratedDraft(runtime:SceneDocument,draft?:SourceIteratedDraft):SceneDocument {
 const base=withoutSourceIteratedDraft(runtime);return draft?{...base,iteratedDraft:structuredClone(draft)}:base;
}
/** Apply commits all valid camera text along with the rest of the editor. Save
 * may retain incomplete text, but no runtime receives it. */
export function sourceIteratedApplyCandidate(runtime:SceneDocument,draft?:SourceIteratedDraft):SourceIteratedDraftResult<SceneDocument>{
 let editor=sourceIteratedEditorScene(runtime,draft);
 if(draft?.cameraTexts){
  const values=draft.cameraTexts.map(v=>v.trim()===''?NaN:Number(v));if(values.some(v=>!Number.isFinite(v))||!editor.sourceCamera)return bad('请输入有限数值');
  const [phi,theta,gamma,x,y,z,zoom,focalDistance]=values;
  editor={...editor,sourceCamera:{...editor.sourceCamera,frame:{phi,theta,gamma,center:[x,y,z],zoom,focalDistance}}};
  try{ordinarySourceCameraInitial(editor);}catch(e){return bad(e instanceof Error?e.message:String(e));}
 }
 return{ok:true,value:editor};
}
export function sourceIteratedSettingIsStaged(scene:SceneDocument,key:string):boolean {
 const family=sourceIteratedLiveKind(scene);return !!family&&(['batchSize','burnIn'].includes(key)||(family==='map'?['dimension','initialXMin','initialXMax','initialYMin','initialYMax','pointSize'].includes(key):key==='template'));
}
