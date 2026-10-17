import {describe, expect, it} from 'vitest';
import {createScene, loadWorkspace, parseScene, parseSceneValue, persistentScene, saveWorkspace} from '../src/engine/document';
import {defaultRootsPresentationConfiguration, RootsPresentationConfigurationError} from '../src/engine/rootsPresentationConfig';
import {sceneAtTime} from '../src/engine/timeline';
import {definitions} from '../src/scenes';
import type {AnimationTrack, SceneDocument} from '../src/types';

const definition = definitions.find(d => d.kind === 'roots')!;
const legacy = () => createScene(definition);
function explicit(): SceneDocument { return {...legacy(), rootsPresentation: defaultRootsPresentationConfiguration()}; }
const numeric = (): AnimationTrack => ({id: 'presentation-persistence-test', type: 'numeric', target: 'settings.rootScale',
 from: 1, to: 3, start: 0, duration: 2, easing: 'linear', enabled: true, pingPong: false});
function animated(scene = explicit()): SceneDocument { return {...scene, timeline: {...scene.timeline, tracks: [numeric()]}}; }
function storage(): Storage {
 const values = new Map<string, string>();
 return {getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); },
  clear: () => values.clear(), key: index => [...values.keys()][index] ?? null, get length() { return values.size; }};
}

describe('optional Roots presentation persistence', () => {
 it('does not migrate existing defaults or presets, including through save and timeline evaluation', () => {
  for (const preset of [undefined, ...definition.presets]) {
   const original = createScene(definition, preset), loaded = parseScene(JSON.stringify(persistentScene(original)));
   expect(Object.hasOwn(original, 'rootsPresentation')).toBe(false);
   expect(Object.hasOwn(loaded, 'rootsPresentation')).toBe(false);
   expect(loaded).toEqual(original);
   expect(Object.hasOwn(sceneAtTime(loaded, 1), 'rootsPresentation')).toBe(false);
  }
 });

 it.each(['density', 'point-cloud'] as const)('round trips a complete %s payload independently of legacy camera and settings', mode => {
  const scene = explicit(), config = scene.rootsPresentation!;
  config.mode = mode; config.transform.scale = [-2, 0, 1 / 3]; config.transform.offset = [11, -12, 13];
  config.transform.rotationDegrees = 720.123456789;
  config.camera = {phi: 0, theta: Math.PI, gamma: -1 / 7, center: [3, 2, 1], zoom: -2, focalDistance: -20};
  config.accumulation = {enabled: true, fadeAlpha: 17.25};
  const original = structuredClone(scene), loaded = parseScene(JSON.stringify(persistentScene(scene)));
  expect(loaded.rootsPresentation).toEqual(config);
  expect(loaded.camera).toEqual(original.camera); expect(loaded.settings).toEqual(original.settings);
  expect(loaded.palette).toEqual(original.palette); expect(loaded.equations).toEqual(original.equations);
  expect(loaded.rootsMath).toEqual(original.rootsMath); expect(scene).toEqual(original);
 });

 it('distinguishes omission and explicit camera zero, without inventing native import defaults for incomplete stored payloads', () => {
  const scene = explicit(); scene.rootsPresentation!.camera.phi = 0;
  expect(parseScene(JSON.stringify(scene)).rootsPresentation!.camera.phi).toBe(0);
  expect(defaultRootsPresentationConfiguration().camera.phi).not.toBe(0);
  const {camera: _camera, ...noCamera} = scene.rootsPresentation!; void _camera;
  for (const rootsPresentation of [null, {}, noCamera, {...scene.rootsPresentation, camera: {}}]) {
   expect(() => parseScene(JSON.stringify({...scene, rootsPresentation}))).toThrow(RootsPresentationConfigurationError);
  }
  expect(parseScene(JSON.stringify(legacy())).rootsPresentation).toBeUndefined();
 });

 it('retains dormant local payloads without source clamps or projection preparation', () => {
  const scene = explicit(), config = scene.rootsPresentation!;
  config.model = 'local-v1'; config.mode = 'point-cloud'; config.dotSize = -5;
  config.accumulation.fadeAlpha = 999; config.camera.zoom = 0; config.camera.focalDistance = 0;
  config.transform.scale = [0, -1, 1e30]; config.camera.gamma = 1e30;
  expect(parseScene(JSON.stringify(persistentScene(scene))).rootsPresentation).toEqual(config);
  // These are valid authored dormant fields, not an admission claim that a
  // singular active projection could be prepared or rendered.
  expect(sceneAtTime(scene, 1).rootsPresentation).toEqual(config);
 });

 it('delegates active normalization to the sole configuration owner and owns the returned nested values', () => {
  const scene = explicit(), input = scene.rootsPresentation!;
  input.dotSize = 4; input.accumulation.fadeAlpha = -20; input.transform.scale[2] = 1 / 3;
  const decoded = parseSceneValue(scene), output = decoded.rootsPresentation!;
  expect(output.dotSize).toBe(.1); expect(output.accumulation.fadeAlpha).toBe(0);
  expect(input.dotSize).toBe(4); expect(input.accumulation.fadeAlpha).toBe(-20);
  expect(output).not.toBe(input); expect(output.transform.scale).not.toBe(input.transform.scale);
  expect(output.transform.offset).not.toBe(input.transform.offset); expect(output.camera.center).not.toBe(input.camera.center);
  output.transform.scale[2] = 7; output.transform.offset[1] = 8; output.camera.center[0] = 9; output.accumulation.enabled = true;
  expect(input.transform.scale[2]).toBe(1 / 3); expect(input.transform.offset[1]).toBe(0);
  expect(input.camera.center[0]).toBe(0); expect(input.accumulation.enabled).toBe(false);
 });

 it.each(['local-v1', 'mathart-1.7.8-v1'] as const)('rejects malformed %s values at the stored document boundary', model => {
  const config = {...defaultRootsPresentationConfiguration(), model};
  const malformed = [
   {...config, model: 'unknown'}, {...config, mode: 'GPU_3D'},
   {...config, transform: {...config.transform, scale: [1, 2]}},
   {...config, camera: {...config.camera, zoom: '1'}},
   {...config, camera: {...config.camera, center: [0, 0, 1e39]}},
   {...config, accumulation: {...config.accumulation, enabled: 1}},
  ];
  for (const rootsPresentation of malformed) expect(() => parseScene(JSON.stringify({...legacy(), rootsPresentation}))).toThrow(RootsPresentationConfigurationError);
  // Value-entry checks also retain a nonfinite diagnostic before JSON could
  // replace nonfinite numeric values with null.
  expect(() => parseSceneValue({...legacy(), rootsPresentation: {...config, dotSize: Infinity}})).toThrow(expect.objectContaining({reason: 'non-finite'}));
 });

 it('rejects the payload on a non-Roots document instead of treating it as an unknown inactive extension', () => {
  expect(() => parseScene(JSON.stringify({...explicit(), kind: 'surface'}))).toThrow('复根呈现规则仅适用于复根场景');
 });

 it('stores distinct saved artwork and draft payloads and restores them independently', () => {
  const scene = explicit(), draft = structuredClone(scene), local = legacy(), memory = storage();
  draft.rootsPresentation!.model = 'local-v1'; draft.rootsPresentation!.dotSize = -3; draft.rootsPresentation!.camera.center[1] = 19;
  saveWorkspace(memory, {scenes: [scene, local], drafts: {[scene.id]: draft}, active: scene.id, theme: 'dark', language: 'en'});
  const restored = loadWorkspace(memory)!;
  expect(restored.scenes[0].rootsPresentation).toEqual(scene.rootsPresentation);
  expect(restored.drafts![scene.id].rootsPresentation).toEqual(draft.rootsPresentation);
  expect(Object.hasOwn(restored.scenes[1], 'rootsPresentation')).toBe(false);
  restored.drafts![scene.id].rootsPresentation!.camera.center[1] = 42;
  expect(restored.scenes[0].rootsPresentation!.camera.center[1]).toBe(0);
  expect(draft.rootsPresentation!.camera.center[1]).toBe(19);
 });
});

describe('Roots presentation timeline snapshot and identity', () => {
 it.each([false, true])('deep clones every nested payload in empty/compiled evaluation (compiled=%s)', compiled => {
  const scene = compiled ? animated() : {...explicit(), timeline: {...explicit().timeline, tracks: []}};
  const before = structuredClone(scene), frame = sceneAtTime(scene, 1), config = frame.rootsPresentation!;
  config.transform.scale[0] = 10; config.transform.offset[1] = 11; config.camera.center[2] = 12;
  config.camera.phi = 13; config.accumulation.fadeAlpha = 14; config.model = 'local-v1';
  expect(scene).toEqual(before);
  expect(sceneAtTime(scene, 1).rootsPresentation).toEqual(before.rootsPresentation);
  expect(sceneAtTime(structuredClone(scene), .5).rootsPresentation).toEqual(before.rootsPresentation);
 });

 it('preserves same-id payload edits, warm/cold back-seeks, explicit dormant selection and subsequent removal', () => {
  const scene = animated(), first = sceneAtTime(scene, 1);
  scene.rootsPresentation!.mode = 'point-cloud'; scene.rootsPresentation!.camera.center[0] = 27;
  scene.rootsPresentation!.camera.phi = 0; scene.rootsPresentation!.transform.rotationDegrees = 91;
  for (const time of [2, .25, 1, .25]) {
   expect(sceneAtTime(scene, time).rootsPresentation).toEqual(scene.rootsPresentation);
   expect(sceneAtTime(parseScene(JSON.stringify(scene)), time).rootsPresentation).toEqual(scene.rootsPresentation);
  }
  expect(first.rootsPresentation!.mode).toBe('density'); expect(first.rootsPresentation!.camera.center[0]).toBe(0);
  scene.rootsPresentation!.model = 'local-v1'; scene.rootsPresentation!.dotSize = -7;
  expect(sceneAtTime(scene, 1).rootsPresentation).toEqual(scene.rootsPresentation);
  delete scene.rootsPresentation;
  expect(Object.hasOwn(sceneAtTime(scene, 1), 'rootsPresentation')).toBe(false);
 });

 it('preserves authored double and signed-zero facts in memory without turning presentation into legacy animation values', () => {
  const scene = animated(); scene.rootsPresentation!.transform.offset[0] = -0;
  scene.rootsPresentation!.camera.gamma = 1 / 3;
  for (const zero of [-0, 0, -0]) {
   scene.rootsPresentation!.transform.offset[0] = zero;
   const frame = sceneAtTime(scene, 1);
   expect(Object.is(frame.rootsPresentation!.transform.offset[0], zero)).toBe(true);
   expect(frame.rootsPresentation!.camera.gamma).toBe(1 / 3);
  }
  const {rootsPresentation: _presentation, ...legacyScene} = scene; void _presentation;
  const {rootsPresentation: _evaluated, ...currentFrame} = sceneAtTime(scene, 1); void _evaluated;
  expect(currentFrame).toEqual(sceneAtTime(legacyScene, 1));
  expect(currentFrame.settings.rootScale).toBe(2);
  const unsupported = {...scene, timeline: {...scene.timeline, tracks: [{...numeric(), target: 'rootsPresentation.camera.zoom'}]}};
  expect(() => sceneAtTime(unsupported, 1)).toThrow('无效动画目标');
 });
});
