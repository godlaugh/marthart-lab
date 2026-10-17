import { compileReal, numberSetting, random, type Scope } from './expression';
import { parse } from 'mathjs';
import { integrateStep, type Derivative } from '../scenes/geometry';
import type { SceneDocument } from '../types';

type Vec3 = [number, number, number];
export interface StableSearchOptions { attempts?: number; seed?: number; }
export interface StabilityMetrics {
  divergenceRatio: number; effectiveRatio: number; coverage: number;
  lineRatio: number; centroidRatio: number; score: number; accepted: boolean;
  center: Vec3; extent: Vec3; reasons: string[];
}
export interface ParameterSensitivity { overall: number; xy: number; z: number; nonlinearity: number; perturbation: number; }
export interface StableCandidate { parameters: Record<string, number>; metrics: StabilityMetrics; }
export interface StableSearchProgress { attempt: number; total: number; accepted: number; bestScore: number | null; }
export interface StableSearchResult {
  status: 'found' | 'no-candidate' | 'cancelled'; attempts: number; accepted: number;
  candidate?: StableCandidate; sensitivities: Record<string, ParameterSensitivity>;
  viewportSuggestion?: { scaleMultiplier: number; offsetDelta: Vec3 };
  sampling: { warmup: 600; samples: 3000; grid: 16 };
  note: string;
}
export interface StableSearchHooks { isCancelled?: () => boolean; onProgress?: (progress: StableSearchProgress) => void; }
const WARMUP = 600, SAMPLES = 3000, GRID = 16;

/** Eigenvalues of a real symmetric covariance matrix; Jacobi rotations preserve trace. */
function eigenvalues(matrix: number[][]) {
  const a = matrix.map(row => [...row]);
  for (let step = 0; step < 18; step++) {
    let p = 0, q = 1;
    for (const [i, j] of [[0, 2], [1, 2]]) if (Math.abs(a[i][j]) > Math.abs(a[p][q])) { p = i; q = j; }
    if (Math.abs(a[p][q]) <= Number.EPSILON * Math.max(1, ...a.map((row, i) => Math.abs(row[i])))) break;
    const angle = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]), c = Math.cos(angle), s = Math.sin(angle);
    const pp = a[p][p], qq = a[q][q], pq = a[p][q];
    a[p][p] = c * c * pp - 2 * s * c * pq + s * s * qq;
    a[q][q] = s * s * pp + 2 * s * c * pq + c * c * qq;
    a[p][q] = a[q][p] = 0;
    for (let k = 0; k < 3; k++) if (k !== p && k !== q) {
      const kp = a[k][p], kq = a[k][q];
      a[k][p] = a[p][k] = c * kp - s * kq;
      a[k][q] = a[q][k] = s * kp + c * kq;
    }
  }
  return a.map((row, i) => Math.max(0, row[i])).sort((a, b) => b - a);
}

/** Finite-window heuristic, not a proof of chaos or long-term stability. */
export function searchStableAttractor(scene: SceneDocument, options: StableSearchOptions = {}, hooks: StableSearchHooks = {}): StableSearchResult {
  if (scene.kind !== 'attractor') throw new Error('稳定参数搜索只适用于微分吸引子');
  const attempts = options.attempts ?? 120, seed = options.seed ?? Number(scene.settings.seed ?? 42);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 120) throw new Error('搜索次数必须为 1–120 的整数');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('种子必须为 32 位无符号整数');
  const declaredNames = Object.keys(scene.parameters);
  if (declaredNames.length > 128 || declaredNames.some(name => !Number.isFinite(scene.parameters[name]))) throw new Error('搜索参数须有限且不超过 128 个');
  const sources = ['dx', 'dy', 'dz'].map(key => scene.equations[key] ?? '0');
  const equations = sources.map(source=>compileReal(source)), symbols = new Set<string>();
  for (const source of sources) parse(source.replaceAll('π', 'pi')).traverse(node => {
    if (node.type === 'SymbolNode') symbols.add((node as unknown as { name: string }).name);
  });
  const names = declaredNames.filter(name => symbols.has(name) && !['x', 'y', 'z', 't', 'time'].includes(name));
  if (!names.length) throw new Error('当前方程没有使用可搜索的参数');
  const scope: Scope = { ...scene.parameters };
  const derivative: Derivative = ([x, y, z], time) => {
    Object.assign(scope, { x, y, z, t: time, time });
    return equations.map(fn => fn(scope)) as Vec3;
  };
  const dt = numberSetting(scene.settings, 'dt', .005, .000001, 1);
  const limit = numberSetting(scene.settings, 'divergenceLimit', 10000, .000001, 1e30);
  const method = scene.settings.integrator ?? 'rk4';
  if (method !== 'euler' && method !== 'rk4') throw new Error('未知积分器');
  const initial = ['X', 'Y', 'Z'].map(axis => numberSetting(scene.settings, `initial${axis}`, axis === 'X' ? .1 : 0)) as Vec3;
  const admissible = (point: Vec3) => point.every(Number.isFinite) && Math.hypot(...point) <= limit;
  function sample(parameters: Record<string, number>) {
    Object.assign(scope, parameters);
    const points: Vec3[] = [];
    let point = [...initial] as Vec3;
    for (let i = 0; i < WARMUP + SAMPLES; i++) {
      if ((i & 127) === 0 && hooks.isCancelled?.()) return null;
      point = integrateStep(derivative, point, i * dt, dt, method as 'euler' | 'rk4');
      if (!admissible(point)) break;
      if (i >= WARMUP) points.push(point);
    }
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], center: Vec3 = [0, 0, 0];
    for (const p of points) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); center[k] += p[k] / points.length; }
    const extent = max.map((v, k) => points.length ? v - min[k] : 0) as Vec3;
    const span = Math.hypot(...extent), cells = new Set<number>();
    const covariance = Array.from({ length: 3 }, () => [0, 0, 0]);
    let effective = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i], cell = p.map((v, k) => extent[k] ? Math.min(GRID - 1, Math.floor((v - min[k]) / extent[k] * GRID)) : 0);
      cells.add(cell[0] + GRID * (cell[1] + GRID * cell[2]));
      if (i > 0 && Math.hypot(...p.map((v, k) => v - points[i - 1][k])) > Math.max(1e-12, span * 1e-6)) effective++;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) covariance[a][b] += (p[a] - center[a]) * (p[b] - center[b]) / points.length;
    }
    const eigen = eigenvalues(covariance), divergenceRatio = 1 - points.length / SAMPLES;
    const effectiveRatio = effective / SAMPLES, coverage = cells.size / GRID ** 3;
    const lineRatio = eigen[0] > 1e-20 ? eigen[1] / eigen[0] : 0;
    const centroidRatio = span > 1e-10 ? Math.hypot(...center) / span : Number.MAX_VALUE;
    const reasons: string[] = [];
    if (divergenceRatio > .02) reasons.push('发散比例超过 2%');
    if (effectiveRatio < .25) reasons.push('有效移动样本不足 25%');
    if (coverage < .002 || coverage > .45) reasons.push('覆盖率不在 0.2%–45%');
    if (lineRatio < .005) reasons.push('轨迹退化为点或直线');
    if (centroidRatio > 4) reasons.push('质心偏离超过域跨度的 4 倍');
    const score = effectiveRatio - divergenceRatio * 5 - Math.abs(Math.log(Math.max(coverage, 1e-9) / .06)) * .15 + Math.min(.25, lineRatio) - Math.min(4, centroidRatio) * .05;
    const metrics: StabilityMetrics = { divergenceRatio, effectiveRatio, coverage, lineRatio, centroidRatio, score, accepted: reasons.length === 0, center, extent, reasons };
    return { metrics, points };
  }
  const sensitivities: Record<string, ParameterSensitivity> = {};
  const result: StableSearchResult = { status: 'no-candidate', attempts: 0, accepted: 0, sensitivities, sampling: { warmup: WARMUP, samples: SAMPLES, grid: GRID }, note: '独立有限时窗启发式：在候选包围盒内计算 16³ 占用率；协方差次主轴比≥0.005，质心/域跨度≤4。不证明混沌或长期稳定；仅建议更改方程参数。' };
  const baseline = sample(scene.parameters);
  if (!baseline) return { ...result, status: 'cancelled' };
  const probes = baseline.points.filter((_, i) => i % 250 === 0).slice(0, 12);
  if (!probes.length) probes.push(initial);
  // Central finite differences at a common set of states avoid conflating
  // parameter sensitivity with divergence between independently integrated paths.
  for (const name of names) {
    if (hooks.isCancelled?.()) return { ...result, status: 'cancelled' };
    const value = scene.parameters[name], scale = Math.max(.1, Math.abs(value)), h = scale * 1e-4;
    let xy = 0, z = 0, overall = 0, nonlinear = 0;
    Object.assign(scope, scene.parameters);
    for (const point of probes) {
      scope[name] = value; const center = derivative(point, 0);
      scope[name] = value + h; const hi = derivative(point, 0);
      scope[name] = value - h; const lo = derivative(point, 0);
      const d = hi.map((v, k) => (v - lo[k]) * scale / (2 * h));
      const norm = Math.max(1, Math.hypot(...center));
      xy += Math.hypot(d[0], d[1]) / norm; z += Math.abs(d[2]) / norm; overall += Math.hypot(...d) / norm;
      nonlinear += Math.hypot(...hi.map((v, k) => (v - 2 * center[k] + lo[k]) * scale ** 2 / h ** 2)) / norm;
    }
    const bounded = (v: number) => Number.isFinite(v) ? v / probes.length : 1e6;
    overall = bounded(overall); xy = bounded(xy); z = bounded(z); nonlinear = bounded(nonlinear);
    sensitivities[name] = { overall, xy, z, nonlinearity: nonlinear, perturbation: scale * .35 / (1 + overall + Math.sqrt(nonlinear)) };
  }
  const rng = random(seed);
  for (let i = 0; i < attempts; i++) {
    if (hooks.isCancelled?.()) { result.status = 'cancelled'; return result; }
    const parameters = { ...scene.parameters, ...Object.fromEntries(names.map(name => {
      const gaussian = Math.sqrt(-2 * Math.log(Math.max(1e-12, rng()))) * Math.cos(2 * Math.PI * rng());
      return [name, scene.parameters[name] + gaussian * sensitivities[name].perturbation];
    })) };
    const sampled = sample(parameters);
    if (!sampled) { result.status = 'cancelled'; return result; }
    result.attempts++;
    if (sampled.metrics.accepted) {
      result.accepted++;
      if (!result.candidate || sampled.metrics.score > result.candidate.metrics.score) result.candidate = { parameters, metrics: sampled.metrics };
    }
    hooks.onProgress?.({ attempt: result.attempts, total: attempts, accepted: result.accepted, bestScore: result.candidate?.metrics.score ?? null });
  }
  if (result.candidate) {
    result.status = 'found';
    const best = result.candidate.metrics, baseSpan = Math.hypot(...baseline.metrics.extent), span = Math.hypot(...best.extent);
    result.viewportSuggestion = { scaleMultiplier: baseSpan > 0 && span > 0 ? baseSpan / span : 1, offsetDelta: best.center.map((v, i) => baseline.metrics.center[i] - v) as Vec3 };
  }
  return result;
}
