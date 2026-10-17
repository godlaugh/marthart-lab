import {describe,expect,it} from 'vitest';
import {parseProjectFile,parseLegacyScene} from '../src/engine/legacyImport';
import {createScene,persistentScene,serializeScene,parseScene,MAX_SCENE_TEXT_LENGTH,SceneDocumentCapacityError} from '../src/engine/document';
import {parseSourceJson} from '../src/engine/sourceJson';
import {sceneAtTime} from '../src/engine/timeline';
import {definition} from '../src/scenes';
const native=(clips=986,padding?:string)=>JSON.stringify({config_version:'1.0.0',type:'COMPLEX_ROOTS',name:'Registered token capacity probe',...(padding===undefined?{}:{unconsumed:padding}),timeline:Array.from({length:clips},()=>({enabled:false,type:'animate',duration:1,actions:Array.from({length:12},()=>({method:'UNKNOWN',args:[1,1,1]}))}))});

describe('project text ownership and registered Roots provenance expansion',()=>{
 it('preserves existing small-project bytes and strips runtime without mutating the scene',()=>{
  const scene=parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'COMPLEX_ROOTS',name:'camera',camera:{phi:0},timeline:[{type:'animate',duration:1,easing:'LINEAR',actions:[{method:'ambient',args:[1,0]}]}]})).scene;
  const evaluated=sceneAtTime(scene,.5),before=structuredClone(evaluated),text=serializeScene(evaluated);
  expect(text).toBe(JSON.stringify(persistentScene(evaluated),null,2));expect(evaluated).toEqual(before);
  expect(evaluated.evaluatedRootsCamera).toBeDefined();expect(text).not.toContain('evaluatedRootsCamera');
  expect(parseProjectFile(text).scene).toEqual(parseScene(text));
 });
 it('uses compact lossless output at the observed986clip boundary and reopens through the actual file adapter',()=>{
  const input=native(),scene=parseProjectFile(input).scene;
  expect(input.length).toBeLessThan(MAX_SCENE_TEXT_LENGTH);expect(scene.timeline.tracks).toEqual([]);
  expect(scene.provenance!.sourceNumberTokens).toHaveLength(36482);
  const pretty=JSON.stringify(persistentScene(scene),null,2);expect(pretty.length).toBeGreaterThan(MAX_SCENE_TEXT_LENGTH);
  const saved=serializeScene(scene);expect(saved).toBe(JSON.stringify(persistentScene(scene)));expect(saved.length).toBeLessThan(MAX_SCENE_TEXT_LENGTH);
  // The native lexical scanner must keep its own input budget. Canonical file
  // routing must not apply that budget again to persisted provenance records.
  expect(()=>parseSourceJson(saved)).toThrow(/200,000/);
  const reopened=parseProjectFile(saved);expect(reopened.format).toBe('local');
  expect(reopened.scene.provenance).toEqual(scene.provenance);expect(serializeScene(reopened.scene)).toBe(saved);
  expect(parseScene(saved).provenance).toEqual(scene.provenance);
 });
 it('keeps the nearby985clip representation indented when it still fits',()=>{
  const scene=parseProjectFile(native(985)).scene,text=serializeScene(scene);
  expect(text.length).toBeLessThanOrEqual(MAX_SCENE_TEXT_LENGTH);expect(text).toBe(JSON.stringify(persistentScene(scene),null,2));
  expect(parseProjectFile(text).scene.provenance).toEqual(scene.provenance);
 });
 it('rejects an imported document only when compact output also exceeds the shared budget',()=>{
  const input=native(986,'x'.repeat(6*1024*1024));expect(input.length).toBeLessThan(MAX_SCENE_TEXT_LENGTH);
  expect(()=>parseProjectFile(input)).toThrow(SceneDocumentCapacityError);
  // The dedicated legacy adapter still includes retained provenance in its
  // admission even though it returns source separately for its caller.
  expect(()=>parseLegacyScene(input)).toThrow(SceneDocumentCapacityError);
 });
 it('rejects an oversized public save with a typed capacity fact instead of truncating source',()=>{
  const scene=createScene(definition('roots'));scene.provenance={kind:'MathArt Studio',original:{text:'x'.repeat(MAX_SCENE_TEXT_LENGTH)},warnings:[]};
  try{serializeScene(scene);throw new Error('expected capacity');}catch(error){
   expect(error).toBeInstanceOf(SceneDocumentCapacityError);expect((error as SceneDocumentCapacityError).code).toBe('capacity');
   expect((error as SceneDocumentCapacityError).characters).toBeGreaterThan(MAX_SCENE_TEXT_LENGTH);
  }
  expect((scene.provenance.original as {text:string}).text.length).toBe(MAX_SCENE_TEXT_LENGTH);
 });
 it('does not let a canonical-looking header bypass explicit legacy metadata admission',()=>{
  const scene=parseProjectFile(native()).scene,saved=serializeScene(scene);
  expect(()=>parseLegacyScene(saved)).toThrow(/200,000/);
 });
});
