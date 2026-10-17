import {describe, expect, it} from 'vitest';
import {createScene, parseScene, persistentScene} from '../src/engine/document';
import {parseProjectFile} from '../src/engine/legacyImport';
import {createRootsNativeMath} from '../src/engine/rootsMathConfig';
import {definition} from '../src/scenes';
import type {SceneDocument} from '../src/types';

// Independent expectations transcribed from retained JsonComplexRootsConfig,
// BaseComplexRootsConfig and Scene constructors. See the method offsets and
// hashes in .cache/roots-presentation-import-next.json. No original JVM runs.
const header = {config_version: '1.0.0', type: 'COMPLEX_ROOTS', name: 'Source presentation'};
const source = (extra: Record<string, unknown> = {}) => ({...header, ...extra});
const load = (extra: Record<string, unknown> = {}) => parseProjectFile(JSON.stringify(source(extra)));
const literal = (tail: string) => parseProjectFile(`{${JSON.stringify(header).slice(1, -1)},${tail}}`);
const saved = (scene: SceneDocument) => parseScene(JSON.stringify(persistentScene(scene)));
const F = Math.fround;

describe('native Roots presentation through public import and persistence', () => {
 it('selects the complete source profile without using inherited generic visual defaults', () => {
  const result = load(), scene = result.scene, plan = scene.rootsPresentation;
  expect(result.format).toBe('mathart');
  expect(plan).toMatchObject({
   model: 'mathart-1.7.8-v1', mode: 'density',
   transform: {scale: [240, 240, 35], offset: [0, 0, 0], rotationDegrees: 0},
   camera: {phi: 1.5707963705062866, theta: 0, gamma: 0, center: [0, 0, 0], zoom: 1, focalDistance: 20},
   accumulation: {enabled: false, fadeAlpha: 6},
  });
  expect(F(plan!.dotSize)).toBe(0.009999999776482582);
  expect(scene.rootsMath?.model).toBe('mathart-1.7.8-v1');
  expect(scene.settings).toMatchObject({rootsMode: 'progressive', rootDensityColorVersion: 'mathart-1.7.8-metric-v1'});
  expect(scene.provenance?.original).toEqual(source());
  expect(saved(scene).rootsPresentation).toEqual(plan);
 });

 it('makes omitted and empty containers equivalent but preserves an explicit zero camera phi', () => {
  const omitted = load().scene.rootsPresentation;
  for (const extra of [{settings: {}}, {camera: {}}, {settings: {}, camera: {}}]) {
   expect(load(extra).scene.rootsPresentation).toEqual(omitted);
  }
  expect(load({camera: {phi: 0}}).scene.rootsPresentation!.camera).toEqual({
   phi: 0, theta: 0, gamma: 0, center: [0, 0, 0], zoom: 1, focalDistance: 20,
  });
 });

 it('maps exact source leaves once, retaining degrees for the object and radians for the camera', () => {
  const input = source({settings: {
   scale_x: -2.25, scale_y: 0, scale_z: 1e20,
   offset_x: 1 / 3, offset_y: -7.5, offset_z: 12,
   rotation: 'PI/2', dot_size: .08, render_mode: 'GPU_3D',
  }, camera: {phi: 'pi/2', theta: -.7, gamma: 3}});
  const scene = parseProjectFile(JSON.stringify(input)).scene, plan = scene.rootsPresentation!;
  expect(plan.mode).toBe('point-cloud');
  expect(plan.transform).toEqual({scale: [-2.25, 0, F(1e20)], offset: [F(1 / 3), -7.5, 12], rotationDegrees: 1.5707963705062866});
  expect(plan.camera).toEqual({phi: 1.5707963705062866, theta: F(-.7), gamma: 3, center: [0, 0, 0], zoom: 1, focalDistance: 20});
  expect(F(plan.dotSize)).toBe(F(.08));
  // These dormant fields must not become a second interpretation of the input.
  const dormant = createScene(definition('roots')).settings;
  for (const key of ['rootScale', 'rootScaleY', 'depthScale', 'rootOffsetX', 'rootOffsetY', 'rootOffsetZ', 'rotation', 'pointSize', 'rootRender']) {
   expect(scene.settings[key], key).toEqual(dormant[key]);
  }
  expect(scene.provenance?.original).toEqual(input);
  const roundtrip = saved(scene);
  expect(roundtrip.rootsPresentation).toEqual(plan);
  expect(roundtrip.settings).toEqual(scene.settings);
 });

 it('accepts finite zero, negative and large source scales without legacy positive or 10000 bounds', () => {
  const scene = load({settings: {scale_x: 0, scale_y: -1e30, scale_z: 1e37}}).scene;
  expect(scene.rootsPresentation!.transform.scale).toEqual([0, F(-1e30), F(1e37)]);
  expect(saved(scene).rootsPresentation).toEqual(scene.rootsPresentation);
 });

 it.each([
  ['PI/2', 1.5707963705062866], ['pi/2', 1.5707963705062866],
  [null, 240], ['sin(', 0], ['1e3+1', 0], ['1e3', 1000],
  [true, 0], [[], 0], [{x: 1}, 0], [1 / 3, 0.3333333432674408],
 ] as const)('uses the source float scalar route for scale_x=%j', (scale_x, expected) => {
  const result = load({settings: {scale_x}});
  expect(result.scene.rootsPresentation!.transform.scale[0]).toBe(expected);
  expect(result.scene.provenance?.original).toEqual(source({settings: {scale_x}}));
 });

 it('uses field-specific defaults for scalar null and does not bind formula parameters into expressions', () => {
  const scene = load({settings: {scale_z: null, rotation: null, dot_size: null}, camera: {phi: null, theta: null, gamma: null}}).scene;
  expect(scene.rootsPresentation!.transform).toEqual({scale: [240, 240, 35], offset: [0, 0, 0], rotationDegrees: 0});
  expect(scene.rootsPresentation!.camera.phi).toBe(1.5707963705062866);
  expect(F(scene.rootsPresentation!.dotSize)).toBe(0.009999999776482582);
  const unbound = load({parameters: {a: 7}, settings: {offset_x: 'a+1'}});
  expect(unbound.scene.rootsPresentation!.transform.offset[0]).toBe(0);
 });

 it.each([
  [-3, 0.0010000000474974513], [0, 0.0010000000474974513], [.001, 0.0010000000474974513],
  [.1, 0.10000000149011612], [10, 0.10000000149011612],
  ['Infinity', 0.10000000149011612], ['-Infinity', 0.0010000000474974513],
  ['1e999', 0.10000000149011612], ['-1e999', 0.0010000000474974513],
  ['PI/2', 0.10000000149011612], ['1e3+1', 0.0010000000474974513],
 ] as const)('applies the native float dot clamp to %j before finite document validation', (dot_size, expected) => {
  const scene = load({settings: {dot_size}}).scene;
  expect(F(scene.rootsPresentation!.dotSize)).toBe(expected);
  expect(Number.isFinite(scene.rootsPresentation!.dotSize)).toBe(true);
  expect(saved(scene).rootsPresentation).toEqual(scene.rootsPresentation);
 });

 it.each(['NaN', '0/0', 'sqrt(-1)'])('rejects a source NaN dot result from %s rather than defaulting it', dot_size => {
  expect(() => load({settings: {dot_size}})).toThrow();
 });

 it.each(['Infinity', '-Infinity', 'NaN', '3.4028236e38'])('rejects nonfinite execution values %s for unbounded transform and camera fields', value => {
  expect(() => load({settings: {scale_x: value}})).toThrow();
  expect(() => load({camera: {theta: value}})).toThrow();
 });

 it.each([
  ['GPU_DENSITY', 'density'], ['GPU_DENSITY_3D', 'point-cloud'], ['GPU_3D', 'point-cloud'],
  ['gpu_3d', 'point-cloud'], ['\u0000\t gpu_density_3d \r\u001f', 'point-cloud'],
  ['\u00a0GPU_3D\u00a0', 'density'], ['\u2000GPU_3D\u2000', 'density'],
  ['CPU', 'density'], ['unknown', 'density'], ['', 'density'],
  [null, 'density'], [17, 'density'], [false, 'density'], [[], 'density'], [{mode: 'GPU_3D'}, 'density'],
 ] as const)('normalizes render_mode=%j using the source exact mode rules', (render_mode, expected) => {
  const result = load({settings: {render_mode}});
  expect(result.scene.rootsPresentation!.mode).toBe(expected);
  expect(result.scene.provenance?.original).toEqual(source({settings: {render_mode}}));
 });

 it.each([null, [], 1, ''])('rejects present non-object settings or camera containers: %j', value => {
  expect(() => load({settings: value})).toThrow();
  expect(() => load({camera: value})).toThrow();
 });

 it('consumes the pending splat budget while leaving unsupported camera and wrapper fields in provenance', () => {
  const input = source({
   camera: {theta: .25, center: [4, 5, 6], zoom: 2, focalDistance: 30},
   settings: {use_accumulation_buffer: true, accumulation_fade_alpha: 255, max_splat_points_per_frame: 7},
  });
  const result = parseProjectFile(JSON.stringify(input)), plan = result.scene.rootsPresentation!;
  expect(plan.camera).toEqual({phi: 1.5707963705062866, theta: .25, gamma: 0, center: [0, 0, 0], zoom: 1, focalDistance: 20});
  expect(plan.accumulation).toEqual({enabled: false, fadeAlpha: 6});
  expect(plan.pending!.maxSplatPointsPerFrame).toBe(7);
  expect(result.scene.provenance?.original).toEqual(input);
  const unmapped = result.warnings.filter(w => w.startsWith('以下字段尚未映射')).join('\n');
  for (const path of ['camera.center', 'camera.zoom', 'camera.focalDistance', 'settings.use_accumulation_buffer', 'settings.accumulation_fade_alpha']) {
   expect(unmapped, path).toContain(path);
  }
  expect(unmapped).not.toContain('settings.max_splat_points_per_frame');
  expect(saved(result.scene).provenance?.original).toEqual(input);
 });

 it('does not reinterpret camel aliases as exact native presentation keys', () => {
  const result = load({settings: {scale_x: 4, scaleX: 9, renderMode: 'GPU_3D', dotSize: .08}});
  expect(result.scene.rootsPresentation!.transform.scale).toEqual([4, 240, 35]);
  expect(result.scene.rootsPresentation!.mode).toBe('density');
  expect(F(result.scene.rootsPresentation!.dotSize)).toBe(0.009999999776482582);
  const unmapped = result.warnings.filter(w => w.startsWith('以下字段尚未映射')).join('\n');
  for (const path of ['settings.scaleX', 'settings.renderMode', 'settings.dotSize']) expect(unmapped).toContain(path);
 });

 it.each([['1e999', .1], ['-1e999', .001]] as const)('retains consumed overflow token %s after the effective dot value is clamped and saved', (token, expected) => {
  const result = literal(`"settings":{"dot_size":${token}}`), scene = result.scene;
  expect(F(scene.rootsPresentation!.dotSize)).toBe(F(expected));
  const record = {path: ['settings', 'dot_size'], token};
  expect(scene.provenance?.sourceNumberTokens).toContainEqual(record);
  const reloaded = saved(scene);
  expect(reloaded.rootsPresentation).toEqual(scene.rootsPresentation);
  expect(reloaded.provenance?.sourceNumberTokens).toContainEqual(record);
  expect(parseProjectFile(JSON.stringify(persistentScene(scene))).scene.rootsPresentation).toEqual(scene.rootsPresentation);
 });

 it('round trips all 13 consumed numeric fields together without losing source spellings', () => {
  const scene = literal('"sampling":{"seed":9007199254740993},"settings":{"background_color":-65536,"scale_x":2.0,"scale_y":-3e0,"scale_z":0,"offset_x":1.25,"offset_y":-0.5,"offset_z":4,"rotation":90,"dot_size":0.08},"camera":{"phi":0,"theta":0.5,"gamma":-0.25}').scene;
  const records = [
   {path: ['sampling', 'seed'], token: '9007199254740993'},
   {path: ['settings', 'background_color'], token: '-65536'},
   {path: ['settings', 'scale_x'], token: '2.0'},
   {path: ['settings', 'scale_y'], token: '-3e0'},
   {path: ['settings', 'scale_z'], token: '0'},
   {path: ['settings', 'offset_x'], token: '1.25'},
   {path: ['settings', 'offset_y'], token: '-0.5'},
   {path: ['settings', 'offset_z'], token: '4'},
   {path: ['settings', 'rotation'], token: '90'},
   {path: ['settings', 'dot_size'], token: '0.08'},
   {path: ['camera', 'phi'], token: '0'},
   {path: ['camera', 'theta'], token: '0.5'},
   {path: ['camera', 'gamma'], token: '-0.25'},
  ];
  expect(scene.provenance?.sourceNumberTokens).toHaveLength(13);
  expect(scene.provenance?.sourceNumberTokens).toEqual(expect.arrayContaining(records));
  expect(scene.rootsMath!.sampling.seed).toBe('9007199254740993');
  for (const reloaded of [saved(scene), parseProjectFile(JSON.stringify(persistentScene(scene))).scene]) {
   expect(reloaded.provenance?.sourceNumberTokens).toEqual(scene.provenance?.sourceNumberTokens);
   expect(reloaded.rootsPresentation).toEqual(scene.rootsPresentation);
   expect(reloaded.rootsMath).toEqual(scene.rootsMath);
  }
  const overLimit = {...scene, provenance: {...scene.provenance!, sourceNumberTokens: [...records,
   {path: ['sampling', 'batch_size'], token: '256'}, {path: ['settings', 'max_splat_points_per_frame'], token: '20000'}, records[10]]}};
  expect(() => parseScene(JSON.stringify(overLimit))).toThrow('最多 15');
 });

 it.each([
  [{path: ['camera', 'phi'], token: '0'}, {path: ['camera', 'phi'], token: '1'}],
  [{path: ['settings', 'background_color'], token: '1'}, {path: ['settings', 'backgroundColor'], token: '2'}],
  [{path: ['settings', 'backgroundColor'], token: '2'}, {path: ['settings', 'background_color'], token: '1'}],
 ])('rejects duplicate consumed identities, including the two background aliases: %j', (...records) => {
  const scene = load().scene;
  const altered = {...scene, provenance: {...scene.provenance!, sourceNumberTokens: records}};
  expect(() => parseScene(JSON.stringify(altered))).toThrow('重复同一消费字段');
 });

 it.each([['settings', 'scaleX'], ['settings', 'dotSize'], ['camera', 'Phi']])('rejects an unregistered spatial token path %s.%s', (...path) => {
  const scene = load().scene;
  const altered = {...scene, provenance: {...scene.provenance!, sourceNumberTokens: [{path, token: '1'}]}};
  expect(() => parseScene(JSON.stringify(altered))).toThrow('字段路径无效');
 });

 it('keeps old local documents with omitted presentation on their previous contracts', () => {
  const local = createScene(definition('roots'));
  const priorSourceMath = structuredClone(local);
  priorSourceMath.rootsMath = createRootsNativeMath();
  priorSourceMath.settings.rootsMode = 'progressive';
  priorSourceMath.settings.rootDensityColorVersion = 'mathart-1.7.8-metric-v1';
  for (const scene of [local, priorSourceMath]) {
   const text = JSON.stringify(persistentScene(scene)), parsed = parseProjectFile(text);
   expect(parsed.format).toBe('local');
   expect(Object.hasOwn(parsed.scene, 'rootsPresentation')).toBe(false);
   expect(parsed.scene).toEqual(parseScene(text));
   expect(saved(parsed.scene)).toEqual(scene);
  }
 });
});
