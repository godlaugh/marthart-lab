import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import type {SceneDocument} from '../src/types';
import {ensureSymmetryPaletteSession,openSymmetryPaletteEditor,changeSymmetrySourcePalette,applySymmetrySourcePalette,restartSymmetrySourcePalette,symmetryPaletteColdAnchor,assertSymmetrySourcePaletteProfile,assertSymmetryPaletteRetention,snapshotSymmetryAppliedScene,symmetryPaletteRuntimeScene,retainSymmetryPaletteAfterRecording,persistentSymmetryPaletteScene} from '../src/engine/sourceSymmetryPaletteEditing';
import {sourceIteratedDraftFromEditor,sourceIteratedEditorScene} from '../src/engine/sourceIteratedDraft';
import {sourceIteratedApplyIdentity,sourceIteratedReplayIdentity,sourceIteratedSceneIdentity} from '../src/engine/sourceIteratedLiveIdentity';
import {editSourceSymmetryConfiguration,sourceSymmetryInitialSeed} from '../src/engine/sourceSymmetryConfig';

const make=(palette:string[]=['#80112233','#445566'])=>parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:'Applied A',palette,parameters:{lambda:.25},settings:{batch_size:4,burn_in_steps:3,scale_x:100},timeline:[]})).scene;
function hot(scene:SceneDocument,colors:string[]){const result=changeSymmetrySourcePalette(scene,colors);if(!result.ok)throw Error(result.error.reason);return result.value;}

describe('source Symmetry complete applied configuration ownership',()=>{
 it('anchors at document open before any parameter edit or Appearance mount',()=>{
  const initial=ensureSymmetryPaletteSession(make());expect(initial.symmetryPaletteEditor?.appearanceOpened).toBeUndefined();
  const edited={...initial,parameters:{...initial.parameters,lambda:.9},settings:{...initial.settings,scaleX:19}};
  const remounted=ensureSymmetryPaletteSession(edited);expect(remounted).toBe(edited);
  const reopenedAppearance=openSymmetryPaletteEditor(remounted),restarted=restartSymmetrySourcePalette(reopenedAppearance);
  expect(restarted.parameters.lambda).toBe(.25);expect(restarted.settings.scaleX).toBe(100);
 });
 it('restarts every cold render input after palette, parameter, transform and camera hot edits',()=>{
  const initial=make(),opened=openSymmetryPaletteEditor(initial),colored=hot(opened,['#AA123456','#abcdef']);
  const edited={...colored,id:'saved-copy',name:'renamed',favorite:true,parameters:{...colored.parameters,lambda:.75},settings:{...colored.settings,scaleX:37,iterationsPerFrame:3,normalizedBrightness:1.1},sourceCamera:{...colored.sourceCamera!,frame:{...colored.sourceCamera!.frame,phi:.4,theta:.6}}};
  const restarted=restartSymmetrySourcePalette(edited);
  expect(restarted.parameters).toEqual(initial.parameters);expect(restarted.settings).toEqual(initial.settings);expect(restarted.sourceCamera).toEqual(initial.sourceCamera);expect(restarted.symmetrySource).toEqual(initial.symmetrySource);expect(restarted.timeline).toEqual(initial.timeline);expect(restarted.palette).toEqual(initial.palette);
  expect(restarted).toMatchObject({id:'saved-copy',name:'renamed',favorite:true,symmetrySourcePalette:{colors:['#AA123456','#abcdef']}});
  expect(restarted.symmetryPaletteEditor).toBe(edited.symmetryPaletteEditor);expect(restarted.symmetryPaletteSession).toBe(edited.symmetryPaletteSession);
  // Existing draft owner retains the user's latest author controls separately.
  const draft=sourceIteratedDraftFromEditor(restarted,{...edited,palette:restarted.palette});
  const editor=sourceIteratedEditorScene(restarted,draft);
  expect(editor.parameters).toEqual(edited.parameters);expect(editor.settings).toEqual(edited.settings);expect(editor.sourceCamera).toEqual(edited.sourceCamera);expect(editor.symmetrySourcePalette).toBe(edited.symmetrySourcePalette);
 });
 it('keeps the latest parameter editor tree over cold construction and consumes it only at Apply',()=>{
  const initial=ensureSymmetryPaletteSession(make());
  const edited=editSourceSymmetryConfiguration(initial,{...initial,parameters:{...initial.parameters,lambda:.75,AaAa:1,BBBB:2,AaBB:3}},'parameters');
  const expected=editSourceSymmetryConfiguration(edited,edited,'apply');
  for(const runtime of [restartSymmetrySourcePalette(edited),retainSymmetryPaletteAfterRecording(edited,structuredClone(symmetryPaletteColdAnchor(edited)))]){
   expect(runtime.parameters).toEqual(initial.parameters);expect(runtime.symmetrySource!.construction).toEqual(initial.symmetrySource!.construction);
   expect(runtime.symmetrySource!.editorMap).toBe(edited.symmetrySource!.editorMap);expect(runtime.symmetrySource!.editorParameters).toBe(edited.symmetrySource!.editorParameters);
   // Author B does not invalidate the already running / captured runtime A.
   expect(sourceIteratedApplyIdentity(runtime)).toBe(sourceIteratedApplyIdentity(initial));expect(sourceIteratedSceneIdentity(runtime)).toBe(sourceIteratedSceneIdentity(initial));
   const editor=sourceIteratedEditorScene(runtime,sourceIteratedDraftFromEditor(runtime,edited));
   const applied=editSourceSymmetryConfiguration(runtime,editor,'apply');
   expect(applied.symmetrySource).toEqual(expected.symmetrySource);expect(applied.parameters).toEqual(expected.parameters);
   expect(sourceSymmetryInitialSeed(applied.symmetrySource!)).toBe(sourceSymmetryInitialSeed(expected.symmetrySource!));
   expect(sourceIteratedApplyIdentity(applied)).not.toBe(sourceIteratedApplyIdentity(initial));
  }
 });
 it('captures raw empty before Appearance padding and shares cold across hot commands',()=>{
  const initial=make([]),opened=openSymmetryPaletteEditor(initial),a=hot(opened,['#112233']),b=hot(a,['#112233']),empty=hot(b,[]);
  expect(symmetryPaletteColdAnchor(opened).symmetrySourcePalette?.colors).toEqual([]);
  expect(opened.symmetrySourcePalette?.colors).toEqual(['#3B82F6','#22D3EE']);
  expect(a.symmetryPaletteSession).toBe(opened.symmetryPaletteSession);expect(b.symmetryPaletteSession).toBe(a.symmetryPaletteSession);expect(empty.symmetryPaletteSession).toBe(a.symmetryPaletteSession);
  expect(empty.palette.stops).toEqual(['#112233','#112233']);expect(restartSymmetrySourcePalette(empty).palette.stops).toEqual(['#000000','#000000']);
 });
 it('Apply replaces complete cold once and excludes editor, draft and recursive sessions',()=>{
  const opened=openSymmetryPaletteEditor(make()),colored=hot(opened,['#abcdef','#123456']);
  const candidate={...colored,parameters:{...colored.parameters,lambda:.8},settings:{...colored.settings,scaleX:41},iteratedDraft:{settings:{batchSize:99}},symmetryPaletteEditor:{...colored.symmetryPaletteEditor!,useCosine:true},palette:{...colored.palette,mode:'cosine' as const}};
  const applied=applySymmetrySourcePalette(candidate),cold=symmetryPaletteColdAnchor(applied);
  expect(cold.parameters.lambda).toBe(.8);expect(cold.settings.scaleX).toBe(41);expect(cold.settings.batchSize).toBe(4);expect(cold.palette.mode).toBe('linear');expect(cold.symmetrySourcePalette?.colors).toEqual(['#abcdef','#123456']);
  expect(cold).not.toHaveProperty('symmetryPaletteSession');expect(cold).not.toHaveProperty('symmetryPaletteEditor');expect(cold).not.toHaveProperty('iteratedDraft');expect(Object.isFrozen(cold)).toBe(true);expect(Object.isFrozen(cold.settings)).toBe(true);expect(applied.symmetryPaletteEditor?.useCosine).toBe(true);
  candidate.parameters.lambda=7;candidate.settings.scaleX=88;expect(cold.parameters.lambda).toBe(.8);expect(cold.settings.scaleX).toBe(41);
 });
 it('history transport clones retain original cold and exclude editor from runtime',()=>{
  const opened=openSymmetryPaletteEditor(make()),edited=hot(opened,['#abcdef','#123456']);
  edited.parameters={...edited.parameters,lambda:.9};
  const transported=structuredClone(symmetryPaletteRuntimeScene(edited)),restarted=restartSymmetrySourcePalette(transported);
  expect(transported).not.toHaveProperty('symmetryPaletteEditor');expect(transported.symmetryPaletteSession?.cold).not.toHaveProperty('symmetryPaletteEditor');expect(restarted.parameters.lambda).toBe(.25);expect(restarted.symmetrySourcePalette).toEqual(edited.symmetrySourcePalette);
 });
 it('detaches and freezes a transported cold owner without tying it to a save-as document id',()=>{
  const transported=structuredClone(ensureSymmetryPaletteSession(make())),restored=ensureSymmetryPaletteSession({...transported,id:'saved-copy'});
  const cold=symmetryPaletteColdAnchor(restored);expect(Object.isFrozen(cold.settings)).toBe(true);expect(cold).not.toBe(transported.symmetryPaletteSession!.cold);
  transported.symmetryPaletteSession!.cold.parameters.lambda=9;
  expect(restartSymmetrySourcePalette(restored).parameters.lambda).toBe(.25);expect(restartSymmetrySourcePalette(restored).id).toBe('saved-copy');
 });
 it('record stop retains raw/editor B while runtime and cold anchor remain A',()=>{
  const opened=openSymmetryPaletteEditor(make()),edited=hot(opened,['#abcdef','#123456']),runtime=structuredClone(symmetryPaletteColdAnchor(edited));
  const restored=retainSymmetryPaletteAfterRecording(edited,runtime);
  expect(restored.palette).toEqual(opened.palette);expect(restored.symmetrySourcePalette).toBe(edited.symmetrySourcePalette);expect(restored.symmetryPaletteEditor).toBe(edited.symmetryPaletteEditor);expect(symmetryPaletteColdAnchor(restored).parameters).toEqual(opened.parameters);
  const saved=persistentSymmetryPaletteScene(restored);expect(saved).not.toHaveProperty('symmetryPaletteSession');expect(saved).not.toHaveProperty('symmetryPaletteEditor');expect(saved.palette.stops).toEqual(['#abcdef','#123456']);
 });
 it('raw/editor metadata never replaces a running render identity; runtime palette does',()=>{
  const original=make([]),opened=openSymmetryPaletteEditor(original);
  expect(sourceIteratedApplyIdentity(opened)).toBe(sourceIteratedApplyIdentity(original));expect(sourceIteratedReplayIdentity(opened)).toBe(sourceIteratedReplayIdentity(original));expect(sourceIteratedSceneIdentity(opened)).toBe(sourceIteratedSceneIdentity(original));
  const edited=hot(opened,['#ff0000','#00ff00']);expect(sourceIteratedApplyIdentity(edited)).toBe(sourceIteratedApplyIdentity(original));expect(sourceIteratedReplayIdentity(edited)).not.toBe(sourceIteratedReplayIdentity(original));
 });
 it('rejects incompatible profiles, nested cold sessions, cycles and expanded oversized descriptions',()=>{
  const scene=make(),legacy={...scene,settings:{...scene.settings,symmetryMathModel:'legacy-v1'}};
  expect(()=>assertSymmetrySourcePaletteProfile(legacy)).toThrow('源 GPU');expect(()=>snapshotSymmetryAppliedScene(legacy)).toThrow('源 GPU');
  const nested={...scene,symmetryPaletteSession:{cold:scene}};
  expect(()=>symmetryPaletteColdAnchor({...scene,symmetryPaletteSession:{cold:nested}})).toThrow('nested session');
  expect(()=>symmetryPaletteColdAnchor({...scene,symmetryPaletteSession:null} as unknown as SceneDocument)).toThrow('cold owner');
  const malformed=[{...scene,symmetrySourcePalette:undefined},{...scene,palette:{...scene.palette,mode:'cosine' as const}},{...scene,symmetrySource:{...scene.symmetrySource!,construction:{...scene.symmetrySource!.construction,degree:99}}},{...scene,sourceCamera:undefined},{...scene,equations:{glsl:42}}];
  for(const cold of malformed)expect(()=>symmetryPaletteColdAnchor({...scene,symmetryPaletteSession:{cold:cold as SceneDocument}})).toThrow();
  const cycle:{value?:unknown}={};cycle.value=cycle;expect(()=>assertSymmetryPaletteRetention(cycle)).toThrow('循环');
  let expanded:unknown='x';for(let i=0;i<27;i++)expanded=[expanded,expanded];expect(()=>assertSymmetryPaletteRetention(expanded)).toThrow('768 MiB');
 });
});
