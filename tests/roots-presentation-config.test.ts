import {describe, expect, it} from 'vitest';
import {
 defaultRootsPresentationConfiguration, parseRootsPresentationConfiguration,
 prepareRootsPresentationConfiguration, RootsPresentationConfigurationError,
} from '../src/engine/rootsPresentationConfig';

describe('Roots presentation configuration boundary', () => {
 it('uses the full Scene constructor defaults, including its camera override', () => {
  expect(defaultRootsPresentationConfiguration()).toEqual({
   model: 'mathart-1.7.8-v1', mode: 'density',
   transform: {scale: [240, 240, 35], offset: [0, 0, 0], rotationDegrees: 0},
   camera: {phi: 1.5707963705062866, theta: 0, gamma: 0, center: [0, 0, 0], zoom: 1, focalDistance: 20},
   dotSize: .01, accumulation: {enabled: false, fadeAlpha: 6},
  });
 });
 it('returns fresh defaults and independently copies every nested mutable value', () => {
  const input = defaultRootsPresentationConfiguration(), untouched = structuredClone(input);
  const parsed = parseRootsPresentationConfiguration(input);
  expect(parsed).toEqual(input);
  parsed.transform.scale[0] = 9; parsed.transform.offset[1] = 8;
  parsed.camera.center[2] = 7; parsed.camera.phi = 6;
  parsed.accumulation.fadeAlpha = 5;
  expect(input).toEqual(untouched);
  input.transform.scale[0] = 4;
  expect(defaultRootsPresentationConfiguration()).toEqual(untouched);
 });
 it('preserves dormant local payload values, without activating source clamps', () => {
  const input = defaultRootsPresentationConfiguration(); input.model = 'local-v1'; input.mode = 'point-cloud';
  input.dotSize = -3; input.accumulation = {enabled: true, fadeAlpha: 999};
  input.transform.scale = [-4, 0, 1 / 3]; input.transform.rotationDegrees = -720.123456789;
  input.camera = {phi: Math.PI, theta: -1 / 7, gamma: 1000, center: [0, -12, 3], zoom: 0, focalDistance: -20};
  expect(parseRootsPresentationConfiguration(input)).toEqual(input);
  expect(parseRootsPresentationConfiguration(JSON.parse(JSON.stringify(input)))).toEqual(input);
 });
 it('admits finite world/camera values without invented positive or angle ranges', () => {
  const input = defaultRootsPresentationConfiguration(); input.mode = 'point-cloud';
  input.transform.scale = [0, -4, 3.4028234663852886e38];
  input.transform.offset = [Number.MIN_VALUE, -0, -3.4028234663852886e38];
  input.transform.rotationDegrees = 1e30;
  input.camera = {phi: 1e30, theta: -1e30, gamma: 1 / 3, center: [-0, 2, 3], zoom: -1, focalDistance: 0};
  const result = parseRootsPresentationConfiguration(input);
  expect(result).toEqual(input); expect(Object.is(result.transform.offset[1], -0)).toBe(true);
  expect(result.transform.offset[0]).toBe(Number.MIN_VALUE);
  expect(result.camera.gamma).toBe(1 / 3);
 });
 it.each([
  [-1, -12, .001, 0], [.001, 0, .001, 0], [.01, 6, .01, 6], [.1, 255, .1, 255], [1, 256, .1, 255],
 ])('normalizes only the active dot/fade bounds (%s, %s)', (dotSize, fadeAlpha, dot, fade) => {
  const input = defaultRootsPresentationConfiguration(); input.dotSize = dotSize; input.accumulation.fadeAlpha = fadeAlpha;
  const result = parseRootsPresentationConfiguration(input);
  expect(result.dotSize).toBe(dot); expect(result.accumulation.fadeAlpha).toBe(fade);
  expect(input.dotSize).toBe(dotSize); expect(input.accumulation.fadeAlpha).toBe(fadeAlpha);
  expect(parseRootsPresentationConfiguration(result)).toEqual(result);
 });
 it.each([undefined, null, [], {}, {model: 'source'}])('leaves omission/default selection with the caller and rejects malformed roots %s', value => {
  expect(prepareRootsPresentationConfiguration(value).ok).toBe(false);
  expect(() => parseRootsPresentationConfiguration(value)).toThrow(RootsPresentationConfigurationError);
 });
 it.each(['local-v1', 'mathart-1.7.8-v1'] as const)('validates finite/F32 admission before clamping in %s', model => {
  for (const bad of [NaN, Infinity, -Infinity, 1e39, -1e39, '1', null]) {
   const input: Record<string, unknown> = {...defaultRootsPresentationConfiguration(), model, dotSize: bad};
   const result = prepareRootsPresentationConfiguration(input);
   expect(result.ok).toBe(false);
   if (!result.ok) expect(result.error).toMatchObject({kind: 'input', path: 'dotSize', reason: typeof bad !== 'number' ? 'number-required' : !Number.isFinite(bad) ? 'non-finite' : 'float32-overflow'});
  }
 });
 it('returns precise field failures without coercing shapes, inherited fields or booleans', () => {
  const config = defaultRootsPresentationConfiguration();
  const cases: [unknown, string, string][] = [
   [{...config, mode: 'GPU_3D'}, 'mode', 'invalid-choice'],
   [{...config, transform: null}, 'transform', 'object-required'],
   [{...config, transform: {...config.transform, scale: [1, 2]}}, 'transform.scale', 'triple-required'],
   [{...config, transform: {...config.transform, offset: [0, 1e39, 0]}}, 'transform.offset[1]', 'float32-overflow'],
   [{...config, camera: {...config.camera, center: [0, 0, NaN]}}, 'camera.center[2]', 'non-finite'],
   [{...config, camera: {...config.camera, zoom: '1'}}, 'camera.zoom', 'number-required'],
   [{...config, accumulation: {enabled: 1, fadeAlpha: 6}}, 'accumulation.enabled', 'boolean-required'],
   [{...config, accumulation: {enabled: false, fadeAlpha: 1e39}}, 'accumulation.fadeAlpha', 'float32-overflow'],
   [Object.create(config), 'model', 'missing-field'],
  ];
  for (const [value, path, reason] of cases) {
   const result = prepareRootsPresentationConfiguration(value);
   expect(result.ok).toBe(false);
   if (!result.ok) expect(result.error).toMatchObject({kind: 'input', path, reason});
  }
 });
});
