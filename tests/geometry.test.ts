import { describe, expect, it } from 'vitest';
import { definitions, generateAttractor, generateImplicit, generateSurface, integrateStep } from '../src/scenes/geometry';
import { PALETTES } from '../src/engine/palette';
import type { GenerateContext, GeometryOutput, SceneDocument, SceneKind, SceneOutput } from '../src/types';
import { searchStableAttractor } from '../src/engine/stableSearch';
import { compileGlslExpression, GpuFormulaSampler } from '../src/engine/gpuSampler';
import { exploreSurface } from '../src/engine/surfaceExplore';
import { sceneAtTime } from '../src/engine/timeline';

const context: GenerateContext = { time: 0, quality: 'preview', width: 640, height: 480 };
type Mesh = GeometryOutput & { stats: SceneOutput['stats']; warnings?: string[] };
type Vec = [number, number, number];
function scene(kind: SceneKind, changes: Partial<SceneDocument> = {}): SceneDocument {
  const definition = definitions.find(definition => definition.kind === kind)!;
  return {
    version: 1, id: 'test', name: 'test', kind,
    equations: { ...definition.defaults.equations }, parameters: { ...definition.defaults.parameters },
    settings: { ...definition.defaults.settings }, palette: { ...PALETTES[0] },
    camera: { position: [5, 4, 5], target: [0, 0, 0], orthographic: false, zoom: 1 },
    timeline: { duration: 10, fps: 30, loop: false, tracks: [] }, favorite: false,
    ...changes,
    ...('settings' in changes ? { settings: { ...definition.defaults.settings, ...changes.settings } } : {}),
  };
}
function mesh(output: SceneOutput): Mesh {
  expect(output.type).toBe('geometry');
  if (output.type !== 'geometry') throw new Error('Expected geometry');
  for (const value of output.positions) expect(Number.isFinite(value)).toBe(true);
  for (const index of output.indices ?? []) expect(index).toBeLessThan(output.positions.length / 3);
  for (const value of output.colors ?? []) expect(Number.isFinite(value) && value >= 0 && value <= 1).toBe(true);
  expect(output.stats.generated).toBe(output.positions.length / 3);
  return output;
}
function point(output: Mesh, index: number): Vec { return Array.from(output.positions.slice(index * 3, index * 3 + 3)) as Vec; }
function cross(a: Vec, b: Vec): Vec { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function subtract(a: Vec, b: Vec): Vec { return a.map((v, i) => v - b[i]) as Vec; }
function dot(a: Vec, b: Vec) { return a.reduce((sum, value, i) => sum + value * b[i], 0); }
function triangles(output: Mesh) {
  const result: [Vec, Vec, Vec][] = [];
  for (let i = 0; i < output.indices!.length; i += 3) result.push([point(output, output.indices![i]), point(output, output.indices![i + 1]), point(output, output.indices![i + 2])]);
  return result;
}
function edgeCounts(output: Mesh) {
  const counts = new Map<string, number>();
  for (let i = 0; i < output.indices!.length; i += 3) {
    const [a, b, c] = output.indices!.slice(i, i + 3);
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

describe('finite-window stable parameter search', () => {
  it('returns reproducible bounded Lorenz candidates without changing camera, transforms or equations', () => {
    const source = scene('attractor', { parameters: { sigma: 10, rho: 28, beta: 8/3, unused: 77 }, settings: { offsetX: 99, scaleY: 3 } }), before = JSON.stringify(source);
    const progress: number[] = [];
    const a = searchStableAttractor(source, { attempts: 3, seed: 17 }, { onProgress: p => progress.push(p.attempt) });
    const b = searchStableAttractor(source, { attempts: 3, seed: 17 });
    expect(a).toEqual(b);
    expect(a.status).toBe('found');
    expect(a.candidate!.parameters).not.toEqual(source.parameters);
    expect(a.candidate!.parameters.unused).toBe(77);
    expect(a.sensitivities.unused).toBeUndefined();
    expect(a.candidate!.metrics.divergenceRatio).toBeLessThanOrEqual(.02);
    expect(a.candidate!.metrics.effectiveRatio).toBeGreaterThanOrEqual(.25);
    expect(a.candidate!.metrics.coverage).toBeGreaterThanOrEqual(.002);
    expect(a.candidate!.metrics.coverage).toBeLessThanOrEqual(.45);
    expect(a.candidate!.metrics.lineRatio).toBeGreaterThanOrEqual(.005);
    expect(Object.values(a.sensitivities).every(s => s.overall >= 0 && Number.isFinite(s.perturbation))).toBe(true);
    expect(progress).toEqual([1, 2, 3]);
    expect(JSON.stringify(source)).toBe(before);
    expect(a.viewportSuggestion?.scaleMultiplier).toBeGreaterThan(0);
  });

  it('rejects fixed points, lines and divergent trajectories instead of calling them stable', () => {
    for (const equations of [{ dx: 'a*0', dy: '0', dz: '0' }, { dx: 'a', dy: '0', dz: '0' }, { dx: 'a*x', dy: 'a*y', dz: 'a*z' }]) {
      const result = searchStableAttractor(scene('attractor', { equations, parameters: { a: 100 }, settings: { divergenceLimit: 100 } }), { attempts: 1 });
      expect(result.status).toBe('no-candidate');
      expect(result.candidate).toBeUndefined();
    }
  });

  it('cancels during sampling and limits work before allocating candidate samples', () => {
    let calls = 0;
    const source = scene('attractor');
    const result = searchStableAttractor(source, {}, { isCancelled: () => ++calls > 3 });
    expect(result.status).toBe('cancelled');
    expect(result.attempts).toBe(0);
    expect(() => searchStableAttractor(source, { attempts: 121 })).toThrow('1–120');
    expect(() => searchStableAttractor(source, { attempts: 2.5 })).toThrow('整数');
    expect(() => searchStableAttractor(scene('attractor', { parameters: {} }))).toThrow('没有');
  });
});

describe('surface secondary exploration', () => {
  it('deterministically rewrites one formula through a whitelist and retains all nonformula state', () => {
    const source = scene('surface'), before = JSON.stringify(source);
    const a = exploreSurface(source, 27), b = exploreSurface(source, 27);
    expect(a).toEqual(b);
    expect(a.status).toBe('found');
    expect(Object.keys(a.equations!).filter(key => a.equations![key] !== source.equations[key])).toHaveLength(1);
    expect(['frequency', 'trig-switch']).toContain(a.mutation!.operation);
    if (a.mutation!.factor !== undefined) expect([.5, .75, 1.25, 1.5, 2]).toContain(a.mutation!.factor);
    expect(a.metrics!.relativeDisplacement).toBeGreaterThanOrEqual(.015);
    expect(a.metrics!.relativeDisplacement).toBeLessThanOrEqual(.65);
    expect(JSON.stringify(source)).toBe(before);
    const output = mesh(generateSurface({ ...source, equations: a.equations! }, context));
    expect(output.stats.invalid).toBe(0);
  });

  it('does not invent arbitrary mutations for polynomial-only or collapsed surfaces', () => {
    const polynomial = exploreSurface(scene('surface', { equations: { x: 'u', y: 'v', z: 'u*v' } }), 42);
    expect(polynomial.status).toBe('no-candidate'); expect(polynomial.attempts).toBe(0);
    expect(polynomial.reason).toContain('sin/cos');
    expect(exploreSurface(scene('surface', { equations: { x: 'sin(u)', y: '0', z: '0' } }), 42).reason).toContain('退化');
    expect(() => exploreSurface(scene('surface'), NaN)).toThrow('种子');
  });
});

describe('parametric surfaces', () => {
  it('applies timeline offsets to the generated geometry without changing the parameter surface', () => {
    const source = scene('surface', { settings: { uSegments: 4, vSegments: 4, renderMode: 'points' }, timeline: { duration: 4, fps: 30, loop: false, tracks: [{ id: 'offset', target: 'settings.offsetX', from: 0, to: 4, start: 0, duration: 4, easing: 'linear', pingPong: false, enabled: true }] } });
    const first = mesh(generateSurface(source, context)), translated = mesh(generateSurface(sceneAtTime(source, 2), { ...context, time: 2 }));
    for (let i = 0; i < first.positions.length; i++) expect(translated.positions[i] - first.positions[i]).toBeCloseTo(i % 3 === 0 ? 2 : 0, 5);
  });
  it('advances per-point parameter velocities in domain units and uses a shared initial u/v scope', () => {
    const source = scene('surface', { equations: { x: 'u', y: 'v', z: 't' }, parameters: {}, settings: {
      renderMode: 'points', uMin: 0, uMax: 10, vMin: 0, vMax: 20, uSegments: 3, vSegments: 3,
      periodicU: false, periodicV: false, speedU: 'v+1', speedV: 'u+2', flowU: 99,
    } });
    const result = mesh(generateSurface(source, { ...context, time: 2 }));
    expect(point(result, 0)).toEqual([2, 4, 2]);
    expect(point(result, 4)).toEqual([27, 24, 2]);
  });

  it('reflects or wraps parameter speeds and reverses the transverse coordinate after odd twisted turns', () => {
    const source = scene('surface', { equations: { x: 'u', y: 'v', z: '0' }, parameters: {}, settings: {
      renderMode: 'points', uMin: 0, uMax: 2, vMin: -1, vMax: 1, uSegments: 4, vSegments: 4,
      periodicU: true, periodicV: false, speedU: 1, speedV: 0,
    } });
    expect(point(mesh(generateSurface(source, { ...context, time: 3 })), 0)).toEqual([1, -1, 0]);
    source.settings.flowingU = true; source.settings.twistedU = true;
    expect(point(mesh(generateSurface(source, { ...context, time: 3 })), 0)).toEqual([1, 1, 0]);
    expect(point(mesh(generateSurface(source, { ...context, time: 5 })), 0)).toEqual([1, -1, 0]);
  });

  it('owns mesh seams separately from periodic motion and refuses distant seam endpoints', () => {
    const torus = scene('surface', { settings: { uSegments: 16, vSegments: 12, periodicU: false, periodicV: false, wrapU: true, wrapV: true } });
    const closed = mesh(generateSurface(torus, context));
    expect(new Set(edgeCounts(closed).values())).toEqual(new Set([2]));
    expect(closed.stats.generated).toBe(16 * 12);
    const open = mesh(generateSurface(scene('surface', { equations: { x: 'u', y: 'v', z: '0' }, settings: { uMin: 0, uMax: 10, vMin: 0, vMax: 1, uSegments: 4, vSegments: 4, wrapU: true, wrapV: false, wrapThreshold: .01 } }), context));
    expect(open.warnings?.join('')).toContain('保持开放边界');
    expect(new Set(edgeCounts(open).values())).toEqual(new Set([1, 2]));
  });

  it('reports CPU fallback without pretending missing WebGL2 is GPU execution', () => {
    const result = generateSurface(scene('surface', { settings: { computeBackend: 'webgl2', uSegments: 4, vSegments: 4 } }), context);
    expect(result.backend).toBe('cpu');
    expect(result.warnings?.join('')).toContain('OffscreenCanvas');
    const gpu = new GpuFormulaSampler();
    expect(gpu.sample(['erf(u)'], new Float32Array([0, 0, 0]), ['u'], {}).warnings.join('')).toContain('不支持函数');
    expect(() => compileGlslExpression('foo(u)', ['u'], [])).toThrow('不支持');
    expect(() => compileGlslExpression('u=1', ['u'], [])).toThrow('表达式');
    expect(compileGlslExpression('e+cos(u)^2', ['u'], ['e'])).toContain('parameter0');
    expect(compileGlslExpression('e', ['u'], [])).toBe(String(Math.E));
  });
  it('satisfies the torus equation and closes both periodic seams without boundary edges', () => {
    const document = scene('surface', { settings: { uSegments: 24, vSegments: 12 } });
    const result = mesh(generateSurface(document, context));
    expect(result.stats.generated).toBe(24 * 12);
    expect(result.indices?.length).toBe(24 * 12 * 6);
    for (let i = 0; i < result.stats.generated; i++) {
      const [x, y, z] = point(result, i);
      expect((Math.hypot(x, z) - 1.7) ** 2 + y ** 2).toBeCloseTo(0.55 ** 2, 6);
    }
    expect(new Set(edgeCounts(result).values())).toEqual(new Set([2]));
    expect(result.stats.generated - edgeCounts(result).size + result.indices!.length / 3).toBe(0);
  });

  it('covers an open rectangular domain and has the expected analytic area after transforms', () => {
    const document = scene('surface', {
      equations: { x: 'u', y: 'v', z: 't' }, parameters: {},
      settings: { uMin: -1, uMax: 2, vMin: -2, vMax: 2, uSegments: 5, vSegments: 8, periodicU: false, periodicV: false, scaleX: 2, scaleY: 3, rotateZ: Math.PI / 2, offsetX: 4 },
    });
    const result = mesh(generateSurface(document, { ...context, time: 2 }));
    const area = triangles(result).reduce((sum, [a, b, c]) => sum + Math.hypot(...cross(subtract(b, a), subtract(c, a))) / 2, 0);
    expect(area).toBeCloseTo(72, 5);
    expect(point(result, 0)).toEqual([10, -2, 2]);
    expect(result.stats.generated).toBe(6 * 9);
  });

  it('welds collapsed sphere boundaries without welding general self intersections', () => {
    const preset = definitions[0].presets.find(preset => preset.id === 'sphere')!;
    const result = mesh(generateSurface(scene('surface', { equations: preset.equations, parameters: preset.parameters, settings: { ...preset.settings, uSegments: 20, vSegments: 12 } }), context));
    expect(new Set(edgeCounts(result).values())).toEqual(new Set([2]));
    expect(result.stats.generated - edgeCounts(result).size + result.indices!.length / 3).toBe(2);
    for (let i = 0; i < result.stats.generated; i++) expect(Math.hypot(...point(result, i))).toBeCloseTo(1.5, 6);
  });

  it('moves flow phase and produces real point/wireframe modes', () => {
    const document = scene('surface', { settings: { uSegments: 8, vSegments: 8, flowU: 0.25, renderMode: 'points' } });
    const first = mesh(generateSurface(document, context));
    const shifted = mesh(generateSurface(document, { ...context, time: 1 }));
    expect(first.topology).toBe('points');
    expect(first.indices).toBeUndefined();
    expect(point(shifted, 0)[0]).toBeCloseTo(0, 6);
    expect(point(shifted, 0)[2]).toBeCloseTo(2.25, 6);
    document.settings.renderMode = 'wireframe';
    const wire = mesh(generateSurface(document, context));
    expect(wire.topology).toBe('segments');
    const edges = Array.from({ length: wire.indices!.length / 2 }, (_, i) => [wire.indices![i * 2], wire.indices![i * 2 + 1]].sort((a, b) => a - b).join(':'));
    expect(new Set(edges).size).toBe(edges.length);
  });

  it('evaluates domain expressions and reflects flowing samples at parameter bounds', () => {
    const document = scene('surface', {
      equations: { x: 'u', y: 'v', z: '0' }, parameters: { span: 2 },
      settings: { uMin: 0, uMax: 'span*PI', vMin: 0, vMax: 1, uSegments: 4, vSegments: 4, periodicU: false, periodicV: false, flowU: 1, pingPongU: true, renderMode: 'points' },
    });
    const midpoint = mesh(generateSurface(document, { ...context, time: 0.5 }));
    const reflected = mesh(generateSurface(document, { ...context, time: 1.5 }));
    expect(midpoint.stats.generated).toBe(16);
    expect(point(midpoint, 0)[0]).toBeCloseTo(Math.PI, 6);
    expect(point(reflected, 0)[0]).toBeCloseTo(Math.PI, 6);
    expect(point(midpoint, 1)[0]).toBeGreaterThan(point(midpoint, 0)[0]);
    expect(point(reflected, 1)[0]).toBeLessThan(point(reflected, 0)[0]);
    for (let i = 0; i < reflected.stats.generated; i++) expect(point(reflected, i)[0]).toBeLessThanOrEqual(2 * Math.PI + 1e-6);
  });

  it('excludes singular samples and triangles that would bridge an undefined column', () => {
    const result = mesh(generateSurface(scene('surface', {
      equations: { x: 'u', y: 'v', z: '1/(u-0.5)' }, parameters: {},
      settings: { uMin: 0, uMax: 1, vMin: 0, vMax: 1, uSegments: 4, vSegments: 4, periodicU: false, periodicV: false },
    }), context));
    expect(result.stats.invalid).toBe(5);
    for (const tri of triangles(result)) {
      const xs = tri.map(p => p[0]);
      expect(Math.min(...xs) < 0.5 && Math.max(...xs) > 0.5).toBe(false);
    }
  });

  it('reports collapsed geometry and rejects reversed domains or nonfinite parameters', () => {
    const zero = mesh(generateSurface(scene('surface', { equations: { x: '0', y: '0', z: '0' }, settings: { uSegments: 4, vSegments: 4 } }), context));
    expect(zero.indices?.length).toBe(0);
    expect(zero.warnings?.join('')).toContain('零面积');
    expect(() => generateSurface(scene('surface', { settings: { uMax: -1 } }), context)).toThrow('上限');
    expect(() => generateSurface(scene('surface', { parameters: { R: NaN } }), context)).toThrow('有限');
    expect(() => generateSurface(scene('surface', { settings: { uSegments: 2.5 } }), context)).toThrow('整数');
  });
});

describe('differential trajectories', () => {
  it('RK4 preserves harmonic orbit energy and phase while Euler has its expected drift', () => {
    let rk: Vec = [1, 0, 0], euler: Vec = [1, 0, 0];
    const f = ([x, y]: Vec): Vec => [-y, x, 0];
    for (let i = 0; i < 1000; i++) {
      rk = integrateStep(f, rk, i * 0.01, 0.01, 'rk4');
      euler = integrateStep(f, euler, i * 0.01, 0.01, 'euler');
    }
    expect(rk[0]).toBeCloseTo(Math.cos(10), 8);
    expect(rk[1]).toBeCloseTo(Math.sin(10), 8);
    expect(dot(rk, rk)).toBeCloseTo(1, 9);
    expect(dot(euler, euler)).toBeGreaterThan(1.1);
  });

  it('evaluates time at RK4 intermediate stages', () => {
    const result = integrateStep((_point, t) => [t, t ** 2, 0], [0, 0, 0], 1, 0.5, 'rk4');
    expect(result[0]).toBeCloseTo((1.5 ** 2 - 1) / 2, 12);
    expect(result[1]).toBeCloseTo((1.5 ** 3 - 1) / 3, 12);
  });

  it('generates deterministic separated particle trajectories with no cross-particle edges', () => {
    const document = scene('attractor', { equations: { dx: 'speed', dy: '0', dz: '0' }, parameters: { speed: 2 }, settings: { dt: 0.1, burnIn: 2, steps: 10, particleCount: 3, initialSpread: 0.5 } });
    const result = mesh(generateAttractor(document, context));
    expect(result.stats.generated).toBe(33);
    expect(result.indices?.length).toBe(60);
    expect(generateAttractor(document, context)).toMatchObject({ positions: result.positions, indices: result.indices });
    for (let i = 0; i < result.indices!.length; i += 2) expect(Math.floor(result.indices![i] / 11)).toBe(Math.floor(result.indices![i + 1] / 11));
    for (let i = 0; i < 3; i++) expect(point(result, i * 11 + 10)[0] - point(result, i * 11)[0]).toBeCloseTo(2, 6);
    document.settings.seed = 43;
    expect(generateAttractor(document, context)).not.toMatchObject({ positions: result.positions });
  });

  it('preserves user parameter e and changes the actual integrated trajectory', () => {
    const document = scene('attractor', { equations: { dx: 'e*x', dy: '0', dz: '0' }, parameters: { e: 0 }, settings: { initialX: 1, burnIn: 0, steps: 10, dt: 0.1 } });
    expect(point(mesh(generateAttractor(document, context)), 10)[0]).toBe(1);
    document.parameters.e = 1;
    expect(point(mesh(generateAttractor(document, context)), 10)[0]).toBeCloseTo(Math.E, 5);
  });

  it('stops divergent trajectories with finite retained evidence', () => {
    const result = mesh(generateAttractor(scene('attractor', { equations: { dx: 'x^2', dy: '0', dz: '0' }, settings: { initialX: 1, steps: 100, burnIn: 0, dt: 0.1, divergenceLimit: 20 } }), context));
    expect(result.stats.generated).toBeGreaterThan(1);
    expect(result.stats.generated).toBeLessThan(100);
    expect(result.stats.invalid).toBe(1);
    expect(result.warnings?.join('')).toContain('发散');
  });

  it('applies physical substeps and fixed stagger before recording each frame', () => {
    const document = scene('attractor', {
      equations: { dx: '1', dy: '0', dz: '0' }, parameters: {},
      settings: { initialX: 0, steps: 4, burnIn: 2, staggerMin: 3, staggerMax: 3, subSteps: 5, dt: 0.1 },
    });
    const result = mesh(generateAttractor(document, context));
    expect(result.stats.generated).toBe(5);
    expect(result.stats.samples).toBe(26);
    expect(point(result, 0)[0]).toBeCloseTo(0.5, 6);
    expect(point(result, 4)[0]).toBeCloseTo(2.5, 6);
  });

  it('samples independent dt and initial coordinates reproducibly inside the requested ranges', () => {
    const document = scene('attractor', {
      equations: { dx: '1', dy: '0', dz: '0' }, parameters: {},
      settings: { particleCount: 20, steps: 1, burnIn: 0, variableTimeStep: true, dtMin: 0.01, dtMax: 0.02,
        useInitialBounds: true, initialMinX: 3, initialMaxX: 4, initialMinY: 7, initialMaxY: 8, initialMinZ: -2, initialMaxZ: -1 },
    });
    const result = mesh(generateAttractor(document, context));
    const intervals = [];
    for (let i = 0; i < 20; i++) {
      const start = point(result, i * 2), end = point(result, i * 2 + 1), dt = end[0] - start[0];
      expect(start[0]).toBeGreaterThanOrEqual(3); expect(start[0]).toBeLessThanOrEqual(4);
      expect(start[1]).toBeGreaterThanOrEqual(7); expect(start[1]).toBeLessThanOrEqual(8);
      expect(start[2]).toBeGreaterThanOrEqual(-2); expect(start[2]).toBeLessThanOrEqual(-1);
      expect(dt).toBeGreaterThan(0.01 - 1e-6); expect(dt).toBeLessThan(0.02 + 1e-6);
      intervals.push(dt);
    }
    expect(new Set(intervals).size).toBeGreaterThan(15);
    expect(generateAttractor(document, context)).toMatchObject({ positions: result.positions });
    document.settings.dtMax = 0.001;
    expect(() => generateAttractor(document, context)).toThrow('上限');
  });

  it('reveals a reproducible trajectory prefix and enforces numeric/resource limits', () => {
    const document = scene('attractor', { settings: { animate: true, stepsPerSecond: 10, steps: 100, burnIn: 0 } });
    const first = mesh(generateAttractor(document, { ...context, time: 1 }));
    const second = mesh(generateAttractor(document, { ...context, time: 2 }));
    expect(first.stats.generated).toBe(11);
    expect(second.stats.generated).toBe(21);
    expect(second.positions.slice(0, first.positions.length)).toEqual(first.positions);
    expect(() => generateAttractor(scene('attractor', { settings: { dt: 0 } }), context)).toThrow('dt');
    expect(() => generateAttractor(scene('attractor', { settings: { steps: 100000, particleCount: 64 } }), context)).toThrow('总积分');
    expect(() => generateAttractor(document, { ...context, time: NaN })).toThrow('时间');
  });
});

describe('tetrahedral isosurfaces', () => {
  it('evaluates parameter-based domain expressions and retains open boundaries when the domain clips a surface', () => {
    const source = scene('implicit', { settings: { resolution: 12, minX: '0*r', maxX: '2*r', minY: '-2*r', maxY: '2*r', minZ: '-2*r', maxZ: '2*r' } });
    const clipped = mesh(generateImplicit(source, context));
    expect(clipped.stats.generated).toBeGreaterThan(0);
    for (let i = 0; i < clipped.positions.length; i += 3) expect(clipped.positions[i]).toBeGreaterThanOrEqual(0);
    expect([...edgeCounts(clipped).values()].some(count => count === 1)).toBe(true);
    expect(() => generateImplicit(scene('implicit', { settings: { minX: 'unknown' } }), context)).toThrow('未知变量');
  });
  it('produces a closed outward-facing sphere with bounded geometric error and correct volume', () => {
    const result = mesh(generateImplicit(scene('implicit', { settings: { resolution: 20 } }), context));
    expect(result.indices!.length).toBeGreaterThan(0);
    expect(new Set(edgeCounts(result).values())).toEqual(new Set([2]));
    let area = 0, volume = 0;
    for (let i = 0; i < result.stats.generated; i++) {
      const radius = Math.hypot(...point(result, i));
      expect(radius).toBeLessThanOrEqual(1.000001);
      expect(radius).toBeGreaterThan(0.99);
    }
    for (const [a, b, c] of triangles(result)) {
      const normal = cross(subtract(b, a), subtract(c, a));
      expect(dot(normal, a)).toBeGreaterThan(0);
      area += Math.hypot(...normal) / 2;
      volume += dot(a, cross(b, c)) / 6;
    }
    expect(Math.abs(area / (4 * Math.PI) - 1)).toBeLessThan(0.02);
    expect(Math.abs(volume / (4 * Math.PI / 3) - 1)).toBeLessThan(0.03);
  });

  it('welds exact zero lattice corners into a manifold sphere', () => {
    const result = mesh(generateImplicit(scene('implicit', { settings: { resolution: 12, minX: -1.5, maxX: 1.5, minY: -1.5, maxY: 1.5, minZ: -1.5, maxZ: 1.5 } }), context));
    expect(new Set(edgeCounts(result).values())).toEqual(new Set([2]));
  });

  it('keeps the default non-binary grid sphere watertight after Float32 rounding', () => {
    const result = mesh(generateImplicit(scene('implicit'), context));
    const counts = edgeCounts(result);
    expect(new Set(counts.values())).toEqual(new Set([2]));
    expect(result.stats.generated - counts.size + result.indices!.length / 3).toBe(2);
  });

  it.each(['below', 'above'] as const)('interpolates a plane exactly with %s orientation', inside => {
    const result = mesh(generateImplicit(scene('implicit', { equations: { f: 'x' }, parameters: {}, settings: { resolution: 8, isoLevel: 0.3, inside } }), context));
    for (let i = 0; i < result.stats.generated; i++) expect(point(result, i)[0]).toBeCloseTo(0.3, 6);
    let area = 0;
    for (const [a, b, c] of triangles(result)) {
      const normal = cross(subtract(b, a), subtract(c, a));
      expect(normal[0] * (inside === 'below' ? 1 : -1)).toBeGreaterThan(0);
      area += Math.hypot(...normal) / 2;
    }
    expect(area).toBeCloseTo(9, 5);
  });

  it('preserves outward orientation after reflection and nonuniform scale', () => {
    const result = mesh(generateImplicit(scene('implicit', { settings: { resolution: 12, scaleX: -2, scaleY: 3, scaleZ: 0.5 } }), context));
    for (const [a, b, c] of triangles(result)) {
      const normal = cross(subtract(b, a), subtract(c, a));
      expect(dot(normal, [a[0] / 4, a[1] / 9, a[2] / 0.25])).toBeGreaterThan(0);
    }
  });

  it('honors independent axis resolutions while preserving a closed anisotropic mesh', () => {
    const result = mesh(generateImplicit(scene('implicit', { settings: { resolution: 20, resolutionX: 12, resolutionY: 16, resolutionZ: 24 } }), context));
    expect(result.stats.samples).toBe(13 * 17 * 25);
    expect(new Set(edgeCounts(result).values())).toEqual(new Set([2]));
    expect(result.indices!.length).toBeGreaterThan(0);
    expect(() => generateImplicit(scene('implicit', { settings: { resolutionX: 2 } }), context)).toThrow('至少 4');
  });

  it('handles zero/constant fields without fictitious geometry and rejects invalid bounds', () => {
    for (const f of ['0', '1', '-1']) {
      const result = mesh(generateImplicit(scene('implicit', { equations: { f }, settings: { resolution: 4 } }), context));
      expect(result.positions.length).toBe(0);
      expect(result.indices?.length).toBe(0);
      expect(result.warnings?.join('')).toContain('没有可提取');
    }
    expect(() => generateImplicit(scene('implicit', { settings: { minX: 2, maxX: 1 } }), context)).toThrow('上限');
    expect(() => generateImplicit(scene('implicit', { settings: { resolution: 1000 } }), context)).toThrow('resolution');
  });

  it('skips undefined scalar regions instead of emitting NaNs or bridging them', () => {
    const result = mesh(generateImplicit(scene('implicit', { equations: { f: 'sqrt(x)-y' }, settings: { resolution: 8 } }), context));
    expect(result.stats.invalid).toBeGreaterThan(0);
    expect(result.indices!.length).toBeGreaterThan(0);
    for (let i = 0; i < result.stats.generated; i++) expect(point(result, i)[0]).toBeGreaterThanOrEqual(0);
  });

  it('responds to time and allows point/line representations of actual intersections', () => {
    const document = scene('implicit', { equations: { f: 'x-t' }, settings: { resolution: 6, renderMode: 'points' } });
    const result = mesh(generateImplicit(document, { ...context, time: 0.2 }));
    expect(result.topology).toBe('points');
    expect(result.indices).toBeUndefined();
    for (let i = 0; i < result.stats.generated; i++) expect(point(result, i)[0]).toBeCloseTo(0.2, 6);
    document.settings.renderMode = 'wireframe';
    expect(mesh(generateImplicit(document, context)).topology).toBe('segments');
  });
});

describe('geometry production boundaries', () => {
  it.each(definitions)('$kind has working presets with finite nonempty geometry', definition => {
    for (const preset of definition.presets) {
      const document = scene(definition.kind, { equations: preset.equations, parameters: preset.parameters, settings: { ...preset.settings, uSegments: 12, vSegments: 12, steps: 100, burnIn: 10, resolution: 10 } });
      const result = mesh(definition.generate(document, context));
      expect(result.stats.generated, `${definition.kind}/${preset.id}`).toBeGreaterThan(0);
      expect(result.indices?.length, `${definition.kind}/${preset.id}`).toBeGreaterThan(0);
    }
  });

  it.each(definitions)('$kind honors immediate cancellation without invalid geometry', definition => {
    const result = mesh(definition.generate(scene(definition.kind), { ...context, isCancelled: () => true }));
    expect(result.stats.samples).toBe(0);
    expect(result.stats.generated).toBe(0);
    expect(result.warnings?.join('')).toContain('取消');
  });
});
