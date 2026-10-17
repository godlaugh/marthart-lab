import { describe, expect, it } from 'vitest';
import { ACTIONS, CLIP_TYPES, EASING_NAMES, validateFractalKeyframes, clipDuration, clipProgress, createAnimationTrack, ease, interpolateColor, normalizeTimelineTime, sceneAtTime } from '../src/engine/timeline';
import { createDefaultSpirographLayer, estimateSpirographCompletion } from '../src/scenes/spirograph';
import { parseScene } from '../src/engine/document';
import { MAX_PALETTE_STOPS, paletteBaseColor, paletteColor, paletteStopsColor, validatePalettePositions } from '../src/engine/palette';
import type { AnimationAction, AnimationTrack, SceneDocument } from '../src/types';

function scene(changes: Partial<SceneDocument> = {}): SceneDocument {
  return { version: 1, id: 'timeline-test', name: 'Timeline', kind: 'surface', equations: { x: 'u', y: 'v', z: '0' }, parameters: { a: 0, b: .5 },
    settings: { scale: 1, rotation: 0, zoom: 1, centerX: 0, centerY: 0, drawDuration: 12, renderMode: 'points', count: 20 },
    palette: { name: 'test', stops: ['#000000', '#ffffff'], offset: 0, cycles: 1, mode: 'linear' },
    camera: { position: [0, 0, 10], target: [0, 0, 0], orthographic: false, zoom: 1, autoFit: false },
    timeline: { duration: 20, fps: 30, loop: false, tracks: [] }, favorite: false, ...changes };
}
function track(change: Partial<AnimationTrack> = {}): AnimationTrack {
  return { id: crypto.randomUUID(), target: 'parameters.a', from: 0, to: 10, start: 0, duration: 2, easing: 'linear', pingPong: false, enabled: true, ...change };
}
function actions(start: number, duration: number, ...items: Partial<AnimationAction>[]) {
  return track({ type: 'animate', target: 'camera.actions', start, duration, actions: items.map(item => ({ id: crypto.randomUUID(), method: 'rotateTheta', ...item })) });
}
function withTracks(...tracks: AnimationTrack[]) { const document = scene(); document.timeline.tracks = tracks; return document; }
const closeVector = (actual: number[], expected: number[], digits = 8) => actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], digits));

describe('easing semantics', () => {
  it('provides 46 shipped names and accepts source-style names without losing return curves', () => {
    expect(EASING_NAMES).toHaveLength(46); expect(new Set(EASING_NAMES).size).toBe(46);
    for (const name of EASING_NAMES) {
      expect(ease(name, 0), name).toBeCloseTo(0, 12);
      for (const t of [.13, .33, .57, .89, 1]) expect(Number.isFinite(ease(name, t)), name).toBe(true);
      expect(ease(name.toUpperCase().replaceAll('-', '_'), .37)).toBe(ease(name, .37));
    }
    expect(ease('quad-in', .25)).toBe(.0625);
    expect(ease('there-and-back', .5)).toBeCloseTo(1, 12);
    expect(ease('there-and-back', 1)).toBeCloseTo(0, 12);
    expect(ease('there-and-back-with-pause', .4)).toBe(1);
    expect(ease('there-and-back-with-pause', .6)).toBe(1);
    expect(ease('wiggle', 1)).toBeCloseTo(0, 12);
    expect(ease('not-quite-there', 1)).toBeCloseTo(.7, 12);
    expect(ease('exponential-decay', 1)).toBeCloseTo(1 - Math.exp(-5), 12);
  });
  it('preserves conventional monotonic endpoints and explicit overshoot behavior', () => {
    const nonUnit = new Set(['there-and-back', 'there-and-back-with-pause', 'wiggle', 'not-quite-there', 'exponential-decay']);
    for (const name of EASING_NAMES.filter(name => !nonUnit.has(name))) expect(ease(name, 1), name).toBeCloseTo(1, 12);
    expect(ease('back-in', .2)).toBeLessThan(0); expect(ease('back-out', .8)).toBeGreaterThan(1);
    expect(ease('linear', -5)).toBe(0); expect(ease('linear', 4)).toBe(1);
    expect(() => ease('unknown', .5)).toThrow('未知'); expect(() => ease('constructor-in', .5)).toThrow('未知'); expect(() => ease('linear', NaN)).toThrow('有限');
  });
});

describe('timeline positioning and immutable composition', () => {
  it('preserves instantaneous animate starts/stops without epsilon durations or division by zero', () => {
    const source = withTracks(actions(1, 0, { method: 'ambient', args: { thetaSpeed: 1, phiSpeed: 0, gammaSpeed: 0 } }), actions(3, 0, { method: 'stopAmbient' }));
    closeVector(sceneAtTime(source, .5).camera.position, [0, 0, 10]);
    closeVector(sceneAtTime(source, 2).camera.position, [10 * Math.sin(1), 0, 10 * Math.cos(1)]);
    closeVector(sceneAtTime(source, 10).camera.position, [10 * Math.sin(2), 0, 10 * Math.cos(2)]);
    const jump = actions(2, 0, { method: 'zoom', args: { value: 2 } });
    expect(clipProgress(jump, 1)).toBe(0); expect(clipProgress(jump, 2)).toBe(1);
    expect(() => clipProgress(track({ duration: 0 }), 0)).toThrow('正有限');
  });
  it('approximates HSV manual-stop morphs as bounded RGB samples and retains exact HSV endpoints', () => {
    const source = withTracks(actions(0, 0, { method: 'gradientStart', gradient: { mode: 'cross_fade', speed: 1, interpolation: 'rgb', toStops: ['#2244ff', '#ffff00'] } }));
    source.palette = { ...source.palette, stops: ['#ff0000', '#00ff00'], interpolation: 'hsv' };
    const start = sceneAtTime(source, 0).palette, middle = sceneAtTime(source, .5).palette, end = sceneAtTime(source, 1).palette;
    expect(start.interpolation).toBe('hsv'); expect(end.interpolation).toBe('hsv'); expect(middle.interpolation).toBe('rgb');
    expect(middle.stops.length).toBeLessThanOrEqual(MAX_PALETTE_STOPS);
    const target = { ...source.palette, stops: ['#2244ff', '#ffff00'] };
    for (const t of [.15, .37, .73]) {
      const a = paletteBaseColor(source.palette, t), b = paletteBaseColor(target, t), sampled = paletteBaseColor(middle, t);
      sampled.forEach((value, i) => expect(Math.abs(value - (a[i] + b[i]) / 2)).toBeLessThan(.012));
    }
  });
  it('maps monotonic elapsed time through once, loop and ping-pong playback', () => {
    const t = scene().timeline; t.duration = 2;
    expect(normalizeTimelineTime(5, { ...t, playbackMode: 'once' })).toBe(2);
    expect(normalizeTimelineTime(5, { ...t, playbackMode: 'loop' })).toBe(1);
    expect([0, 1, 2, 3, 4, 5, 6].map(elapsed => normalizeTimelineTime(elapsed, { ...t, playbackMode: 'ping-pong' }))).toEqual([0, 1, 2, 1, 0, 1, 2]);
    expect(normalizeTimelineTime(-3, t)).toBe(0);
    expect(() => normalizeTimelineTime(0, { ...t, duration: 0 })).toThrow('大于零');
  });
  it('orders tracks by start and captures prior state at the next start, even when input is unsorted', () => {
    const late = track({ start: 2, duration: 2, fromCurrent: true, to: 20 }), early = track({ start: 0, duration: 2 });
    const document = withTracks(late, early), before = structuredClone(document);
    expect(sceneAtTime(document, -1).parameters.a).toBe(0);
    expect(sceneAtTime(document, 1).parameters.a).toBe(5);
    expect(sceneAtTime(document, 3).parameters.a).toBe(15);
    expect(sceneAtTime(document, 20).parameters.a).toBe(20);
    expect(document).toEqual(before);
    expect(sceneAtTime(document, 1).parameters.a).toBe(5);
  });
  it('resolves overlap deterministically and uses array order for equal starts', () => {
    const document = withTracks(track(), track({ start: 1, duration: 2, fromCurrent: true, to: 20 }));
    expect(sceneAtTime(document, 2).parameters.a).toBe(12.5);
    const ties = withTracks(track({ to: 20 }), track({ to: 40 }));
    expect(sceneAtTime(ties, 1).parameters.a).toBe(20);
    ties.timeline.tracks.reverse(); expect(sceneAtTime(ties, 1).parameters.a).toBe(10);
    ties.timeline.tracks[1].enabled = false; expect(sceneAtTime(ties, 1).parameters.a).toBe(20);
  });
  it('distinguishes clip repetitions, within-clip return motion, and final held values', () => {
    const t = track({ duration: 4, repeat: 2, pingPong: true });
    expect([0, .5, 1, 1.5, 2, 3, 4].map(time => clipProgress(t, time))).toEqual([0, .5, 1, .5, 0, 1, 0]);
    const document = withTracks(t);
    expect(sceneAtTime(document, 3).parameters.a).toBe(10);
    expect(sceneAtTime(document, 5).parameters.a).toBe(0);
    t.pingPong = false; expect(sceneAtTime(document, 4).parameters.a).toBe(10);
    t.repeat = 2.5; expect(() => sceneAtTime(document, 1)).toThrow('整数');
  });
  it('supports camera targets and integer settings without silently accepting missing targets', () => {
    const document = withTracks(track({ target: 'settings.count', from: 20, to: 25, round: true }), track({ target: 'camera.targetY', from: 0, to: 4 }));
    expect(sceneAtTime(document, 1).settings.count).toBe(23);
    expect(sceneAtTime(document, 1).camera.target[1]).toBe(2);
    document.timeline.tracks.push(track({ target: 'parameters.missing' }));
    expect(() => sceneAtTime(document, 1)).toThrow('不存在');
    document.timeline.tracks = [track({ target: 'settings.__proto__' })]; expect(() => sceneAtTime(document, 1)).toThrow('无效');
  });
  it('invalidates compilation after content edits and isolates cached plans from caller mutation', () => {
    const document = withTracks(track({ fromCurrent: true })), original = structuredClone(document);
    expect(sceneAtTime(document, 1).parameters.a).toBe(5);
    document.timeline.tracks[0].to = 20;
    expect(sceneAtTime(document, 1).parameters.a).toBe(10);
    expect(sceneAtTime(original, 1).parameters.a).toBe(5);
    document.parameters.a = 10;
    expect(sceneAtTime(document, 1).parameters.a).toBe(15);
    const renamed = { ...original, name: 'new metadata', equations: { x: '2*u' } };
    expect(sceneAtTime(renamed, 1).name).toBe('new metadata');
    expect(sceneAtTime(renamed, 1).equations).toEqual({ x: '2*u' });
  });
});

describe('camera actions and sustained effects', () => {
  it('composes camera angles and preserves distance to the focal target', () => {
    const document = withTracks(actions(0, 2,
      { method: 'rotateTheta', args: { angle: Math.PI / 2 } }, { method: 'rotatePhi', args: { angle: Math.PI / 4 } },
      { method: 'rotateGamma', args: { angle: Math.PI / 3 } }, { method: 'zoom', args: { value: 2 } }, { method: 'focal', args: { value: 70 } }));
    const result = sceneAtTime(document, 2);
    closeVector(result.camera.position, [Math.sqrt(50), Math.sqrt(50), 0]);
    expect(Math.hypot(...result.camera.position)).toBeCloseTo(10, 10);
    expect(result.camera.zoom).toBe(2); expect(result.settings.cameraGamma).toBeCloseTo(Math.PI / 3);
    expect(result.settings.cameraFocalLength).toBe(70); expect(result.camera.autoFit).toBe(false);
  });
  it('aligns to absolute angles about a nonzero target', () => {
    const document = withTracks(track({ type: 'align', target: 'camera.orientation', orientation: { theta: Math.PI / 2, phi: 0, gamma: .4 } }));
    document.camera.target = [1, 2, 3]; document.camera.position = [1, 2, 13];
    closeVector(sceneAtTime(document, 2).camera.position, [11, 2, 3]);
  });
  it('preserves the direction of consecutive rotations across a camera pole', () => {
    const document = withTracks(actions(0, 2, { method: 'rotatePhi', args: { angle: Math.PI } }), actions(2, 2, { method: 'rotatePhi', args: { angle: Math.PI } }));
    closeVector(sceneAtTime(document, 1).camera.position, [0, 10, 0]);
    closeVector(sceneAtTime(document, 3).camera.position, [0, -10, 0]);
    closeVector(sceneAtTime(document, 4).camera.position, [0, 0, 10]);
    document.timeline.tracks.push(track({ start: 4, target: 'camera.z', from: 10, to: -10 }), actions(6, 2, { method: 'rotatePhi', args: { angle: Math.PI } }));
    closeVector(sceneAtTime(document, 7).camera.position, [0, 10, 0]);
  });
  it('integrates ambient speed ramps and stops without position jumps or continued drift', () => {
    const document = withTracks(actions(0, 2, { method: 'ambient', args: { thetaSpeed: 1 } }), actions(4, 2, { method: 'stopAmbient' }));
    closeVector(sceneAtTime(document, 1).camera.position, [10 * Math.sin(.25), 0, 10 * Math.cos(.25)]);
    closeVector(sceneAtTime(document, 6).camera.position, [10 * Math.sin(4), 0, 10 * Math.cos(4)]);
    closeVector(sceneAtTime(document, 15).camera.position, sceneAtTime(document, 6).camera.position);
    closeVector(sceneAtTime(document, 4 + 1e-7).camera.position, sceneAtTime(document, 4 - 1e-7).camera.position, 5);
  });
  it('stops fixed-point camera tracking at the stop event and can translate position with target', () => {
    const document = withTracks(actions(0, 4, { method: 'track', args: { x: 4, y: 2, z: 0, follow: true } }), actions(2, 1, { method: 'stopTracking' }));
    const result = sceneAtTime(document, 8);
    closeVector(result.camera.target, [2, 1, 0]); closeVector(result.camera.position, [2, 1, 10]);
  });
  it.each([['fractal', 'fractalRotate'], ['domain', 'domainRotate'], ['spirograph', 'spirographRotate']] as const)('rotates %s coordinates by integrated speed', (kind, method) => {
    const document = withTracks(actions(0, 2, { method, args: { speed: 2 } })); document.kind = kind;
    expect(sceneAtTime(document, 3).settings.rotation).toBeCloseTo(4, 10);
    document.kind = 'surface'; expect(() => sceneAtTime(document, 3)).toThrow('仅适用');
  });
});

describe('parameter oscillation and gradient animation', () => {
  it('samples nonuniform color knots without changing closed endpoints or periodic palette modes', () => {
    const stops = ['#ff0000', '#00ff00', '#0000ff'], positions = [0, .25, 1];
    validatePalettePositions(stops, positions);
    closeVector(paletteStopsColor(stops, 0, positions), [1, 0, 0]);
    closeVector(paletteStopsColor(stops, 1, positions), [0, 0, 1]);
    closeVector(paletteStopsColor(stops, .125, positions), [.5, .5, 0]);
    closeVector(paletteStopsColor(stops, .25, positions), [0, 1, 0]);
    closeVector(paletteStopsColor(stops, .625, positions), [0, .5, .5]);
    const palette = { ...scene().palette, stops, positions };
    closeVector(paletteColor(palette, 1), paletteColor(palette, 0));
    closeVector(paletteColor({ ...palette, mode: 'sine' }, .5), [0, 0, 1]);
    for (const mode of ['linear', 'sine', 'cosine', 'hsv'] as const) {
      const source = { ...palette, mode, positions: undefined }, explicit = { ...source, positions: [0, .5, 1] };
      for (const t of [-.2, 0, .11, .35, .5, .9, 1, 2.2]) closeVector(paletteColor(source, t), paletteColor(explicit, t));
    }
  });
  it('rejects malformed knot positions at the shared palette boundary', () => {
    const stops = ['#ff0000', '#00ff00', '#0000ff'];
    for (const positions of [[0, 1], [.1, .5, 1], [0, .5, .9], [0, 0, 1], [0, 1.1, 1], [0, NaN, 1], [0, Infinity, 1]])
      expect(() => validatePalettePositions(stops, positions), String(positions)).toThrow();
    expect(() => validatePalettePositions(Array(MAX_PALETTE_STOPS + 1).fill('#ffffff'))).toThrow('1024');
    expect(() => validatePalettePositions(['#ffffff'])).toThrow();
  });
  it('keeps unequal-stop gradient endpoints exact and retains each source knot in between', () => {
    const document = withTracks(actions(0, 1, { method: 'gradientStart', gradient: { mode: 'cross_fade', speed: 1, interpolation: 'rgb', toStops: ['#000000', '#ffffff', '#000000', '#ffffff'] } }));
    document.palette.stops = ['#ff0000', '#00ff00', '#0000ff'];
    for (const mode of ['linear', 'sine', 'cosine', 'hsv'] as const) {
      document.palette.mode = mode;
      const initial = sceneAtTime(document, 0).palette, final = sceneAtTime(document, 2).palette;
      const target = { ...document.palette, stops: ['#000000', '#ffffff', '#000000', '#ffffff'] };
      expect(initial.mode).toBe(mode); expect(final.mode).toBe(mode);
      for (const at of [0, .13, .25, .5, .77, .99, 1]) {
        closeVector(paletteColor(initial, at), paletteColor(document.palette, at));
        closeVector(paletteColor(final, at), paletteColor(target, at));
      }
    }
    document.palette.mode = 'linear';
    const middle = sceneAtTime(document, 1).palette;
    expect(middle.positions).toEqual([0, 1 / 3, .5, 2 / 3, 1]);
    expect(middle.stops).toHaveLength(5);
    expect(paletteColor(sceneAtTime(document, .0001).palette, .5)[1]).toBeCloseTo(1, 2);
    expect(document.palette.positions).toBeUndefined();
  });
  it('retains nonuniform knots through gradient restarts and reflected target palettes', () => {
    const document = withTracks(actions(0, 1, { method: 'gradientStart', gradient: { mode: 'cross_fade', speed: 1, interpolation: 'rgb', toStops: ['#ffffff', '#000000'] } }));
    document.palette.stops = ['#ff0000', '#00ff00', '#0000ff']; document.palette.positions = [0, .2, 1];
    const prior = sceneAtTime(document, 1).palette;
    document.timeline.tracks.push(actions(1, 1, { method: 'gradientStart', gradient: { mode: 'palette_morph', speed: 1, interpolation: 'rgb' } }));
    const atRestart = sceneAtTime(document, 1).palette, reflected = sceneAtTime(document, 2.5).palette;
    expect(atRestart).toEqual(prior);
    expect(reflected.positions).toEqual([0, .8, 1]);
    for (const at of [0, .13, .5, .7, .99, 1]) closeVector(paletteStopsColor(reflected.stops, at, reflected.positions), paletteStopsColor(prior.stops, 1 - at, prior.positions));
  });
  it('allows the 1024-knot budget and rejects a union that would exceed it', () => {
    const document = withTracks(actions(0, 1, { method: 'gradientStart', gradient: { mode: 'cross_fade', speed: 1, interpolation: 'rgb', toStops: ['#ffffff', '#000000'] } }));
    document.palette.stops = Array.from({ length: MAX_PALETTE_STOPS }, (_, i) => i % 2 ? '#ffffff' : '#000000');
    document.palette.positions = document.palette.stops.map((_, i) => i / (MAX_PALETTE_STOPS - 1));
    const result = sceneAtTime(document, 1).palette;
    expect(result.stops).toHaveLength(MAX_PALETTE_STOPS); validatePalettePositions(result.stops, result.positions);
    document.timeline.tracks[0].actions![0].gradient!.toStops = ['#ffffff', '#000000', '#ffffff'];
    expect(() => sceneAtTime(document, 1)).toThrow('1024');
  });
  it('starts from the current parameter phase, stays within bounds and freezes after stop', () => {
    const document = withTracks(actions(0, 2, { method: 'paramStart', parameters: [{ target: 'parameters.a', min: -1, max: 1, step: 1, enabled: true }] }), actions(4, 2, { method: 'paramStop', args: { target: 'parameters.a' } }));
    expect(sceneAtTime(document, 1).parameters.a).toBeCloseTo(Math.sin(.25), 10);
    expect(sceneAtTime(document, 6).parameters.a).toBeCloseTo(Math.sin(4), 10);
    expect(sceneAtTime(document, 12).parameters.a).toBe(sceneAtTime(document, 6).parameters.a);
    for (const at of [0, 3, 1, 5, 2, 10]) expect(Math.abs(sceneAtTime(document, at).parameters.a)).toBeLessThanOrEqual(1);
    const finiteClip = withTracks(track({ type: 'param', parameterAnimations: [{ target: 'parameters.b', min: -1, max: 1, step: Math.PI / 2, enabled: true }] }));
    expect(sceneAtTime(finiteClip, 0).parameters.b).toBeCloseTo(.5);
    expect(sceneAtTime(finiteClip, 1).parameters.b).toBeCloseTo(Math.sin(Math.PI / 6 + Math.PI / 2));
  });
  it('restarts an oscillator from its frozen current value and handles constant ranges', () => {
    const document = withTracks(actions(0, 1, { method: 'paramStart', parameters: [{ target: 'parameters.a', min: 2, max: 2, step: 3, enabled: true }] }));
    expect(sceneAtTime(document, 5).parameters.a).toBe(2);
    document.timeline.tracks.push(actions(2, 1, { method: 'paramStop' }));
    document.timeline.tracks.push(actions(4, 1, { method: 'paramStart', parameters: [{ target: 'parameters.a', min: 1, max: 3, step: 1, enabled: true }] }));
    expect(sceneAtTime(document, 4).parameters.a).toBeCloseTo(2);
    expect(sceneAtTime(document, 5).parameters.a).toBeCloseTo(2 + Math.sin(.5));
  });
  it('offset animation integrates start and stop ramps', () => {
    const document = withTracks(actions(0, 2, { method: 'gradientStart', gradient: { mode: 'offset_cycle', speed: .5, interpolation: 'rgb' } }), actions(4, 2, { method: 'gradientStop' }));
    expect(sceneAtTime(document, 1).palette.offset).toBeCloseTo(.125);
    expect(sceneAtTime(document, 6).palette.offset).toBeCloseTo(2);
    expect(sceneAtTime(document, 15).palette.offset).toBeCloseTo(2);
  });
  it('holds the terminal speed of return and partial curves instead of jumping to full speed', () => {
    const start = actions(0, 2, { method: 'gradientStart', gradient: { mode: 'offset_cycle', speed: 1, interpolation: 'rgb' } });
    start.easing = 'there-and-back'; const document = withTracks(start);
    expect(sceneAtTime(document, 2).palette.offset).toBeCloseTo(1, 9);
    expect(sceneAtTime(document, 5).palette.offset).toBeCloseTo(1, 9);
    start.easing = 'not-quite-there';
    expect(sceneAtTime(document, 5).palette.offset - sceneAtTime(document, 4).palette.offset).toBeCloseTo(.7, 9);
    start.easing = 'linear'; const stop = actions(3, 2, { method: 'gradientStop' }); stop.easing = 'there-and-back'; document.timeline.tracks.push(stop);
    // A return curve cancels the stop transition and returns to its input speed.
    expect(sceneAtTime(document, 7).palette.offset - sceneAtTime(document, 6).palette.offset).toBeCloseTo(1, 9);
  });
  it('freezes an old gradient ramp when another mode starts during its stop interval', () => {
    const document = withTracks(
      actions(0, 1, { method: 'gradientStart', gradient: { mode: 'hue_rotate', speed: .1, interpolation: 'oklab' } }),
      actions(2, 10, { method: 'gradientStop' }),
      actions(3, 1, { method: 'gradientStart', gradient: { mode: 'offset_cycle', speed: .2, interpolation: 'rgb' } }),
    );
    document.palette.stops = ['#ff0000', '#00ff00', '#0000ff'];
    const colorAtRestart = sceneAtTime(document, 3).palette.stops;
    expect(sceneAtTime(document, 4).palette.stops).toEqual(colorAtRestart);
    expect(sceneAtTime(document, 8).palette.stops).toEqual(colorAtRestart);
    expect(sceneAtTime(document, 4).palette.offset).toBeCloseTo(.1);
    expect(sceneAtTime(document, 8).palette.offset).toBeCloseTo(.9);
  });
  it('interpolates color in distinct spaces with known achromatic midpoints', () => {
    expect(interpolateColor('#000000', '#ffffff', .5, 'rgb')).toBe('#808080');
    expect(interpolateColor('#000000', '#ffffff', .5, 'linear')).toBe('#bcbcbc');
    expect(interpolateColor('#000000', '#ffffff', .5, 'oklab')).toBe('#636363');
    expect(interpolateColor('#000000', '#ffffff', .5, 'oklch')).toBe('#636363');
    for (const mode of ['rgb', 'linear', 'oklab', 'oklch'] as const) { expect(interpolateColor('#123456', '#abcdef', 0, mode)).toBe('#123456'); expect(interpolateColor('#123456', '#abcdef', 1, mode)).toBe('#abcdef'); }
    expect(() => interpolateColor('bad', '#ffffff', .5)).toThrow('颜色');
  });
  it('crossfades actual palette values and returns a hue cycle to its starting colors', () => {
    const document = withTracks(actions(0, 1, { method: 'gradientStart', gradient: { mode: 'cross_fade', speed: 1, interpolation: 'rgb', fromStops: ['#000000', '#000000'], toStops: ['#ffffff', '#ffffff'] } }));
    expect(sceneAtTime(document, 1).palette.stops).toEqual(['#808080', '#808080']);
    expect(sceneAtTime(document, 2).palette.stops).toEqual(['#ffffff', '#ffffff']);
    document.palette.stops = ['#448866', '#7799aa']; document.timeline.tracks = [actions(0, 1, { method: 'gradientStart', gradient: { mode: 'hue_rotate', speed: 1, interpolation: 'oklab' } })];
    expect(sceneAtTime(document, 1.5).palette.stops).toEqual(document.palette.stops);
    expect(sceneAtTime(document, 1).palette.stops).not.toEqual(document.palette.stops);
  });
});

describe('scene-specific clips and storage', () => {
  it('interpolates fractal centers linearly and zoom logarithmically through keyframes', () => {
    const document = withTracks(track({ type: 'fractal_zoom', duration: 4, interpolation: 'exponential', keyframes: [{ time: 0, centerX: 0, centerY: 0, zoom: 1 }, { time: 2, centerX: 2, centerY: -4, zoom: 100 }, { time: 4, centerX: 4, centerY: 0, zoom: 10000 }] })); document.kind = 'fractal';
    const result = sceneAtTime(document, 1);
    expect(result.settings.zoom).toBeCloseTo(10); expect(result.settings.centerX).toBe(1); expect(result.settings.centerY).toBe(-2);
    expect(sceneAtTime(document, 3).settings.zoom).toBeCloseTo(1000);
    document.timeline.tracks[0].pingPong = true; expect(sceneAtTime(document, 4).settings.zoom).toBe(1);
    document.timeline.tracks[0].keyframes![1].time = 0; expect(() => sceneAtTime(document, 1)).toThrow('递增');
  });
  it('emits a continuous point/mesh blend while retaining mesh topology for the renderer', () => {
    const document = withTracks(track({ type: 'surface_mode_transition', surfaceMode: 'mesh' }));
    const midway = sceneAtTime(document, 1);
    expect(midway.settings.surfaceBlend).toBe(.5); expect(midway.settings.renderMode).toBe('mesh');
    document.timeline.tracks.push(track({ type: 'surface_mode_transition', surfaceMode: 'points', start: 2, duration: 2 }));
    expect(sceneAtTime(document, 3).settings.surfaceBlend).toBe(.5); expect(sceneAtTime(document, 4).settings.surfaceBlend).toBe(0);
  });
  it('computes finish-wait duration from the current drawing endpoint and preserves wait state', () => {
    const document = scene({ kind: 'spirograph' }), wait = createAnimationTrack(document, 'spirograph_finish_wait', 3);
    expect(clipDuration(wait, document)).toBe(9);
    document.settings.drawDuration = 20; expect(clipDuration(wait, document)).toBe(17);
    document.timeline.tracks = [wait]; expect(sceneAtTime(document, 5).settings).toEqual(document.settings);
    expect(CLIP_TYPES.filter(item => item.type !== 'numeric')).toHaveLength(8); expect(ACTIONS).toHaveLength(17);
  });
  it('round-trips all structured clip data without affecting legacy numeric tracks', () => {
    const document = withTracks(track(), actions(2, 2, { method: 'gradientStart', gradient: { mode: 'palette_morph', speed: .3, interpolation: 'oklch', toStops: ['#123456', '#987654'] } }));
    document.timeline.playbackMode = 'ping-pong';
    const restored = parseScene(JSON.stringify(document));
    expect(restored.timeline).toEqual(document.timeline);
    expect(sceneAtTime(restored, 3)).toEqual(sceneAtTime(document, 3));
  });
  it('rejects invalid clips and actions rather than installing ineffective placeholders', () => {
    expect(() => sceneAtTime(withTracks(track({ duration: 0 })), 0)).toThrow('时长');
    expect(() => sceneAtTime(withTracks(actions(0, 1, { method: 'missing' })), 0)).toThrow('未知');
    expect(() => sceneAtTime(withTracks(actions(0, 1, { method: 'zoom', args: { value: -1 } })), 2)).toThrow('缩放');
    expect(() => sceneAtTime(withTracks(track({ start: Infinity })), 0)).toThrow('有限');
    expect(() => sceneAtTime(withTracks(track({ type: 'param', parameterAnimations: [{ target: 'parameters.a', min: 0, max: 1, step: 1, phase: NaN, enabled: true }] })), 0)).toThrow('有限');
    const disabled = track({ enabled: false, target: 'not.a.target' }); expect(sceneAtTime(withTracks(disabled), 5).parameters.a).toBe(0);
  });
});


describe('layered spirograph completion waits', () => {
  it('uses sequential closure duration plus trace start, including completed zero waits', () => {
    const document=scene({kind:'spirograph'}),a=createDefaultSpirographLayer('a'),b=createDefaultSpirographLayer('b');
    Object.assign(a,{statorRadius:3,rotors:[{radius:1,mode:'inside'}],speed:6});Object.assign(b,{statorRadius:4,rotors:[{radius:1,mode:'inside'}],speed:3});
    Object.assign(document.settings,{layers:JSON.stringify([a,b]),traceStartTime:4,fadeOutStatorsOnFinish:true});
    const end=estimateSpirographCompletion(document.settings).totalSeconds!+4,wait=createAnimationTrack(document,'spirograph_finish_wait',1);
    expect(clipDuration(wait,document)).toBeCloseTo(end-1);expect(end).toBeGreaterThan(4);
    wait.start=end+1;expect(clipDuration(wait,document)).toBe(0);document.timeline.tracks=[wait];expect(()=>sceneAtTime(document,end+2)).not.toThrow();
  });
  it('rejects automatic waiting for a paused or indefinitely drawing layer', () => {
    for(const change of [{speed:0},{autoStopOnClosure:false}]) {
      const document=scene({kind:'spirograph'}),layer={...createDefaultSpirographLayer(),...change};document.settings.layers=JSON.stringify([layer]);
      expect(()=>createAnimationTrack(document,'spirograph_finish_wait',0)).toThrow('有限完成时间');
    }
  });
});

describe('deep zoom keyframe precision',()=>{
 it('interpolates high/low pairs without rounding away motion below double precision',()=>{
  const document=scene({kind:'fractal'}),clip=createAnimationTrack(document,'fractal_zoom',0);clip.duration=2;clip.easing='linear';clip.keyframes=[{time:0,centerX:1,centerXLow:1e-20,centerY:-1,centerYLow:-3e-20,zoom:1e18},{time:2,centerX:1,centerXLow:3e-20,centerY:-1,centerYLow:-1e-20,zoom:1e22}];document.timeline.tracks=[clip];
  const middle=sceneAtTime(document,1);expect(middle.settings.centerX).toBe(1);expect(middle.settings.centerXLow).toBeCloseTo(2e-20,30);expect(middle.settings.centerYLow).toBeCloseTo(-2e-20,30);expect(Number(middle.settings.zoom)/1e20).toBeCloseTo(1,12);
  expect(sceneAtTime(document,0).settings.centerXLow).toBe(1e-20);expect(sceneAtTime(document,2).settings.centerXLow).toBe(3e-20);
 });
 it('captures low parts from the current viewport and rejects malformed low parts at the owner boundary',()=>{
  const document=scene({kind:'fractal'});Object.assign(document.settings,{centerX:1,centerY:0,centerXLow:1e-22,centerYLow:2e-22,zoom:1e28});const clip=createAnimationTrack(document,'fractal_zoom');expect(clip.keyframes![0].centerXLow).toBe(1e-22);expect(clip.keyframes![1].zoom).toBe(1e28);document.timeline.tracks=[clip];clip.keyframes![0].centerYLow=NaN;expect(()=>validateFractalKeyframes(clip)).toThrow('centerYLow');expect(()=>sceneAtTime(document,1)).toThrow('有限数值');
 });
});


describe('nullable source align axes',()=>{
 it('aligns each selected axis to next whole turn plus target without touching omitted axes',()=>{const source=withTracks(track({type:'align',alignMode:'next-turn',orientation:{gamma:Math.PI/2},duration:2}));source.settings.cameraGamma=-.4;const initial=structuredClone(source.camera);expect(sceneAtTime(source,1).settings.cameraGamma).toBeCloseTo((-.4+Math.PI/2)/2);expect(sceneAtTime(source,2).settings.cameraGamma).toBeCloseTo(Math.PI/2);expect(sceneAtTime(source,2).camera.position).toEqual(initial.position);source.settings.cameraGamma=7;expect(sceneAtTime(source,2).settings.cameraGamma).toBeCloseTo(4*Math.PI+Math.PI/2);});
 it('preserves legal no-target alignment and distinguishes absolute alignment',()=>{const source=withTracks(track({type:'align',alignMode:'next-turn',orientation:{}}));source.settings.cameraGamma=.7;expect(sceneAtTime(source,2).camera).toEqual(source.camera);expect(sceneAtTime(source,2).settings.cameraGamma).toBe(.7);source.timeline.tracks[0].orientation={gamma:0};expect(sceneAtTime(source,1).settings.cameraGamma).toBeCloseTo((.7+2*Math.PI)/2);source.timeline.tracks[0].alignMode='absolute';expect(sceneAtTime(source,1).settings.cameraGamma).toBeCloseTo(.35);});
});
