import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {sourceIteratedEditorScene,sourceIteratedDraftFromEditor,sourceIteratedApplyCandidate,parseSourceIteratedDraft,withSourceIteratedDraft,withoutSourceIteratedDraft,sourceIteratedSettingIsStaged} from '../src/engine/sourceIteratedDraft';
import {editSourceMapScene} from '../src/engine/sourceMapScene';
import {ordinarySourceCameraInitial} from '../src/engine/ordinarySourceCamera';
const fixture=()=>parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'MAP_ATTRACTOR',name:'draft',parameters:{gain:.1},settings:{batch_size:64,burn_in_steps:4,iterations_per_frame:1},equations:{x_next:'sin(x+gain)',y_next:'sin(y-gain)',z_next:'0'}})).scene;
const cameraTexts=(s:ReturnType<typeof fixture>)=>{const c=ordinarySourceCameraInitial(s)!;return[c.phi,c.theta,c.gamma,...c.center,c.zoom,c.focalDistance].map(String);};
describe('persisted iterated editor draft boundary',()=>{
 it('saves and restores incomplete text independently of the valid running document',()=>{
  const runtime=fixture(),before=structuredClone(runtime),texts=cameraTexts(runtime);texts[0]='-';
  const editor={...runtime,equations:{...runtime.equations,x:'sin('},settings:{...runtime.settings,batchSize:128}};
  const draft=sourceIteratedDraftFromEditor(runtime,editor,texts),saved=parseScene(serializeScene(withSourceIteratedDraft(runtime,draft)));
  expect(withoutSourceIteratedDraft(saved)).toEqual(parseScene(serializeScene(runtime)));
  const reopened=sourceIteratedEditorScene(withoutSourceIteratedDraft(saved),saved.iteratedDraft);
  expect(reopened.equations.x).toBe('sin(');expect(reopened.settings.batchSize).toBe(128);expect(saved.iteratedDraft?.cameraTexts?.[0]).toBe('-');
  expect(sourceIteratedApplyCandidate(runtime,saved.iteratedDraft)).toMatchObject({ok:false,error:{kind:'input'}});expect(runtime).toEqual(before);
 });
 it('resolves all pending fields only at Apply, preserving source provenance',()=>{
  const runtime=fixture(),texts=cameraTexts(runtime);texts[0]='0.25';
  const editor={...runtime,equations:{...runtime.equations,x:'  x + gain  '},settings:{...runtime.settings,batchSize:128}};
  const draft=sourceIteratedDraftFromEditor(runtime,editor,texts),prepared=sourceIteratedApplyCandidate(runtime,draft);expect(prepared.ok).toBe(true);if(!prepared.ok)return;
  const applied=editSourceMapScene(runtime,prepared.value,'apply');expect(applied.mapSource?.construction.equations.x).toBe('x + gain');expect(applied.settings.batchSize).toBe(128);expect(ordinarySourceCameraInitial(applied)?.phi).toBe(.25);
  expect(runtime.mapSource?.construction.equations.x).toBe('sin(x+gain)');expect(runtime.settings.batchSize).toBe(64);
 });
 it('rebases editor values after hot writes and recording restoration without promoting pending construction',()=>{
  const applied=fixture(),editor={...applied,parameters:{...applied.parameters,gain:.2},settings:{...applied.settings,batchSize:128}};
  const hot=editSourceMapScene(applied,{...applied,parameters:editor.parameters},'parameters');
  const during=sourceIteratedDraftFromEditor(hot,editor);expect(during?.parameters).toBeUndefined();expect(during?.settings).toEqual({batchSize:128});
  const after=sourceIteratedDraftFromEditor(applied,sourceIteratedEditorScene(hot,during));
  expect(after?.parameters).toEqual({gain:.2});expect(sourceIteratedEditorScene(applied,after)).toEqual(editor);
 });
 it('keeps explicit deletion distinct from omission and protects own special keys',()=>{
  const runtime=fixture(),patch=JSON.parse('{"parameters":{"gain":null,"__proto__":2}}');
  const parsed=parseSourceIteratedDraft(patch);expect(parsed.ok).toBe(true);if(!parsed.ok)return;
  const editor=sourceIteratedEditorScene(runtime,parsed.value);expect(Object.hasOwn(editor.parameters,'gain')).toBe(false);expect(Object.hasOwn(editor.parameters,'__proto__')).toBe(true);expect(editor.parameters.__proto__).toBe(2);expect(Object.getPrototypeOf(editor.parameters)).toBe(Object.prototype);
  expect(sourceIteratedDraftFromEditor(runtime,editor)?.parameters).toEqual(patch.parameters);
 });
 it('rejects malformed persisted input while retaining incomplete but bounded editor text',()=>{
  for(const raw of [null,[],{unknown:1},{parameters:{x:Infinity}},{parameters:{x:'1'}},{equations:{x:4}},{settings:{x:{}}},{cameraTexts:['1']},{sourceCamera:{}},{equations:{x:'x'.repeat(8193)}}])expect(parseSourceIteratedDraft(raw).ok).toBe(false);
  expect(parseSourceIteratedDraft({equations:{x:''},cameraTexts:Array(8).fill('')}).ok).toBe(true);
 });
 it('stage keys follow the verified family boundary and empty overlays preserve runtime identity',()=>{
  const runtime=fixture();expect(sourceIteratedDraftFromEditor(runtime,runtime,cameraTexts(runtime))).toBeUndefined();expect(sourceIteratedEditorScene(runtime)).toBe(runtime);expect(withoutSourceIteratedDraft(runtime)).toBe(runtime);
  for(const key of ['batchSize','burnIn','dimension','initialXMin','pointSize'])expect(sourceIteratedSettingIsStaged(runtime,key)).toBe(true);
  for(const key of ['iterationsPerFrame','scaleX','background','colorSpeed'])expect(sourceIteratedSettingIsStaged(runtime,key)).toBe(false);
 });
});
