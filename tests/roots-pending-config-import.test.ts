import {describe, expect, it} from 'vitest';
import {createScene, parseScene, persistentScene} from '../src/engine/document';
import {parseProjectFile} from '../src/engine/legacyImport';
import {defaultRootsPendingConfiguration, defaultRootsPresentationConfiguration, parseRootsPresentationConfiguration, prepareRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import {prepareRootsPresentationImport} from '../src/engine/rootsPresentationImport';
import {createRootsNativeMath} from '../src/engine/rootsMathConfig';
import {definition} from '../src/scenes';

const header = '"config_version":"1.0.0","type":"COMPLEX_ROOTS","name":"Pending source"';
const load = (tail = '') => parseProjectFile(`{${header}${tail ? ',' + tail : ''}}`);
const reload = (scene: ReturnType<typeof load>['scene']) => parseScene(JSON.stringify(persistentScene(scene)));

describe('explicit Roots pending profile and source integer import', () => {
 it('keeps old presentation omission and old immediate source documents unchanged on save/open', () => {
  const local = createScene(definition('roots')), priorSource = structuredClone(local);
  priorSource.rootsMath = createRootsNativeMath();
  priorSource.rootsPresentation = defaultRootsPresentationConfiguration();
  for (const scene of [local, priorSource]) {
   const opened = parseProjectFile(JSON.stringify(persistentScene(scene))).scene;
   expect(opened).toEqual(scene);
   expect(opened.rootsPresentation?.pending).toBeUndefined();
  }
  expect(defaultRootsPresentationConfiguration()).not.toHaveProperty('pending');
  const inherited = Object.assign(Object.create({pending: defaultRootsPendingConfiguration()}), defaultRootsPresentationConfiguration());
  expect(parseRootsPresentationConfiguration(inherited)).not.toHaveProperty('pending');
 });

 it('explicitly enables fresh native imports in both display modes without duplicating batch size', () => {
  for (const render_mode of ['GPU_DENSITY', 'GPU_3D']) {
   const scene = load(`"settings":{"render_mode":"${render_mode}"}`).scene;
   expect(scene.rootsPresentation?.pending).toEqual({model: 'roots-pending-ordinal-v1', maxSplatPointsPerFrame: 20000, referenceHeapBytes: 4294967296});
   expect(scene.rootsMath?.sampling.batchSize).toBe(256);
   expect(scene.rootsPresentation?.pending).not.toHaveProperty('batchSize');
   expect(reload(scene).rootsPresentation).toEqual(scene.rootsPresentation);
  }
  const first = defaultRootsPendingConfiguration(); first.maxSplatPointsPerFrame = 3;
  expect(defaultRootsPendingConfiguration().maxSplatPointsPerFrame).toBe(20000);
 });

 it.each(['local-v1', 'mathart-1.7.8-v1'] as const)('retains and deep-copies pending fields under %s without F32 conversion', model => {
  const scene = createScene(definition('roots'));
  scene.rootsPresentation = {...defaultRootsPresentationConfiguration(), model, pending: {
   model: 'roots-pending-ordinal-v1', maxSplatPointsPerFrame: 16777217, referenceHeapBytes: Number.MAX_SAFE_INTEGER,
  }};
  const parsed = parseRootsPresentationConfiguration(scene.rootsPresentation);
  expect(parsed.pending).toEqual(scene.rootsPresentation.pending);
  parsed.pending!.maxSplatPointsPerFrame = 8;
  expect(scene.rootsPresentation.pending!.maxSplatPointsPerFrame).toBe(16777217);
  expect(reload(scene).rootsPresentation).toEqual(scene.rootsPresentation);
  expect(parseRootsPresentationConfiguration({...scene.rootsPresentation, pending: {...scene.rootsPresentation.pending, maxSplatPointsPerFrame: 2147483647, referenceHeapBytes: 0}}).pending)
   .toMatchObject({maxSplatPointsPerFrame: 2147483647, referenceHeapBytes: 0});
 });

 it('rejects malformed profile and inexact local representation rather than shrinking a budget', () => {
  const config = defaultRootsPresentationConfiguration(), pending = defaultRootsPendingConfiguration();
  for (const bad of [null, [], {}, {...pending, model: 'source'}, Object.create(pending)])
   expect(prepareRootsPresentationConfiguration({...config, pending: bad}).ok).toBe(false);
  for (const maxSplatPointsPerFrame of [0, -1, .5, 2147483648, NaN, Infinity, '20000'])
   expect(prepareRootsPresentationConfiguration({...config, pending: {...pending, maxSplatPointsPerFrame}}).ok).toBe(false);
  for (const referenceHeapBytes of [-1, .5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '4096']) {
   const result = prepareRootsPresentationConfiguration({...config, pending: {...pending, referenceHeapBytes}});
   expect(result.ok).toBe(false);
   if (!result.ok) expect(result.error).toMatchObject({path: 'pending.referenceHeapBytes', reason: 'reference-heap-safe-integer-required'});
  }
 });

 // Independent expectations: retained Base ctor @65–69/@93–97 and JSON ctor
 // @318–333/@511–526, JSONObject getInt narrowing then Math.max(1,...).
 // These are source representation bounds, not local allocation admissions.
 it.each([
  ['7', 7, 7], ['-1', 1, 1], ['-0', 1, 1], ['1.9', 1, 1],
  ['16777217', 16777217, 16777217], ['2147483647', 2147483647, 2147483647],
  ['2147483648', 1, 1], ['2147483648.0', 2147483647, 2147483647],
  ['4294967296', 1, 1], ['4294967296.0', 2147483647, 2147483647],
  ['9007199254740993', 1, 1], ['1e999', 20000, 256],
  ['null', 20000, 256], ['true', 20000, 256], ['{}', 20000, 256],
  ['"+7"', 7, 7], ['"7.0"', 20000, 256], ['"2+1"', 20000, 256],
  ['"2147483648"', 20000, 256], ['"bad"', 20000, 256],
 ])('imports %s with exact int-class semantics and retains raw/token evidence', (token, maxSplat, batch) => {
  const scene = load(`"sampling":{"batch_size":${token}},"settings":{"max_splat_points_per_frame":${token}}`).scene;
  expect(scene.rootsPresentation!.pending!.maxSplatPointsPerFrame).toBe(maxSplat);
  expect(scene.rootsMath!.sampling.batchSize).toBe(batch);
  const source = scene.provenance!.original as {sampling: {batch_size: unknown}; settings: {max_splat_points_per_frame: unknown}};
  expect(source.sampling.batch_size).toEqual(JSON.parse(token));
  expect(source.settings.max_splat_points_per_frame).toEqual(JSON.parse(token));
  if (typeof JSON.parse(token) === 'number') {
   expect(scene.provenance!.sourceNumberTokens).toContainEqual({path: ['sampling', 'batch_size'], token});
   expect(scene.provenance!.sourceNumberTokens).toContainEqual({path: ['settings', 'max_splat_points_per_frame'], token});
  }
  const reopened = reload(scene);
  expect(reopened.rootsPresentation).toEqual(scene.rootsPresentation);
  expect(reopened.rootsMath).toEqual(scene.rootsMath);
  expect(reopened.provenance!.sourceNumberTokens).toEqual(scene.provenance!.sourceNumberTokens);
 });

 it('requires source numeric class evidence for ambiguous standalone integer reads', () => {
  const read = (path: readonly string[]) => path[1] === 'max_splat_points_per_frame' ? 4294967296 : undefined;
  const unknown = prepareRootsPresentationImport(read);
  expect(unknown.ok).toBe(false);
  if (!unknown.ok) expect(unknown.error).toMatchObject({kind: 'input', sourceError: {kind: 'number-token-required'}});
  const known = prepareRootsPresentationImport(read, {numberToken: () => '4294967296.0'});
  expect(known.ok).toBe(true);
  if (known.ok) expect(known.value.configuration.pending!.maxSplatPointsPerFrame).toBe(2147483647);
 });

 it('preserves the prior batch alias boundary but does not invent native maxSplat aliases', () => {
  const imported = load('"sampling":{"batchSize":3.0},"settings":{"maxSplatPointsPerFrame":7}');
  expect(imported.scene.rootsMath!.sampling.batchSize).toBe(3);
  expect(imported.scene.provenance!.sourceNumberTokens).toContainEqual({path: ['sampling', 'batchSize'], token: '3.0'});
  expect(imported.scene.rootsPresentation!.pending!.maxSplatPointsPerFrame).toBe(20000);
  expect(imported.warnings.join('\n')).toContain('settings.maxSplatPointsPerFrame');
  expect(reload(imported.scene).provenance!.sourceNumberTokens).toEqual(imported.scene.provenance!.sourceNumberTokens);
  const scene = imported.scene;
  scene.provenance!.sourceNumberTokens!.push({path: ['sampling', 'batch_size'], token: '3'});
  expect(() => reload(scene)).toThrow('重复同一消费字段');
 });
});
