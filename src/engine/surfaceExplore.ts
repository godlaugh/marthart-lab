import { parse, type MathNode } from 'mathjs';
import { compileReal, random } from './expression';
import { generateSurface } from '../scenes/geometry';
import type { SceneDocument } from '../types';

export interface SurfaceExploreResult {
  status: 'found' | 'no-candidate'; attempts: number;
  equations?: Record<string, string>;
  mutation?: { equation: string; operation: 'trig-switch' | 'frequency'; from: string; to: string; factor?: number };
  metrics?: { relativeDisplacement: number; extentRatio: number; centroidShift: number; finiteRatio: number };
  reason?: string;
  note: string;
}
const FACTORS = [.5, .75, 1.25, 1.5, 2] as const;
const CONTEXT = { time: 0, quality: 'preview' as const, width: 640, height: 480 };

/** Local AST rewrites and bounded geometric probes. The caller owns baseline/undo. */
export function exploreSurface(scene: SceneDocument, seed: number): SurfaceExploreResult {
  if (scene.kind !== 'surface') throw new Error('曲面探索只适用于参数曲面');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('种子必须为 32 位无符号整数');
  const note = '独立白名单改写：单处 sin/cos 互换或倍率 {0.5,0.75,1.25,1.5,2}；32×24 有限几何探针筛选相似度和变化。阈值与倍率为本实现定义，未与原应用运行结果比较。';
  const result: SurfaceExploreResult = { status: 'no-candidate', attempts: 0, note };
  const settings = { ...scene.settings, renderMode: 'points', uSegments: 32, vSegments: 24, computeBackend: 'cpu', speedU: 0, speedV: 0, flowU: 0, flowV: 0 };
  const evaluate = (equations: Record<string, string>) => {
    const output = generateSurface({ ...scene, equations, settings }, CONTEXT);
    if (output.type !== 'geometry') throw new Error('曲面未产生几何');
    return output;
  };
  const baseline = evaluate(scene.equations);
  if (baseline.stats.invalid || baseline.stats.generated !== 768) return { ...result, reason: '基线存在非有限采样，先修正公式或参数域。' };
  function describe(positions: Float32Array) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], center = [0, 0, 0];
    for (let i = 0; i < positions.length; i++) { const axis = i % 3; min[axis] = Math.min(min[axis], positions[i]); max[axis] = Math.max(max[axis], positions[i]); center[axis] += positions[i] / (positions.length / 3); }
    let area = 0;
    // Two parameter tangents detect collapse to a line even after arbitrary rotation.
    for (let j = 0; j < 23; j++) for (let i = 0; i < 31; i++) {
      const p = (j * 32 + i) * 3;
      const a = [0, 1, 2].map(k => positions[p + 3 + k] - positions[p + k]), b = [0, 1, 2].map(k => positions[p + 96 + k] - positions[p + k]);
      area += Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
    }
    return { center, span: Math.hypot(...max.map((v, i) => v - min[i])), area };
  }
  const base = describe(baseline.positions);
  if (base.span < 1e-10 || base.area < 1e-12) return { ...result, reason: '基线退化为点或线，无法筛选同族曲面。' };
  type Choice = { equation: string; ordinal: number; name: string; argument: MathNode; factor?: number };
  const candidates: Choice[] = [], trees = new Map<string, MathNode>();
  for (const equation of ['x', 'y', 'z']) {
    const source = scene.equations[equation] ?? '0'; compileReal(source);
    const tree = parse(source.replaceAll('π', 'pi')); trees.set(equation, tree);
    let ordinal = 0;
    tree.traverse(node => {
      if (node.type !== 'FunctionNode') return;
      const current = ordinal++, fn = node as unknown as { fn: { name: string }; args: MathNode[] };
      if (!['sin', 'cos'].includes(fn.fn.name) || fn.args.length !== 1) return;
      let parameterDependent = false;
      fn.args[0].traverse(n => { if (n.type === 'SymbolNode' && ['u', 'v'].includes((n as unknown as { name: string }).name)) parameterDependent = true; });
      if (!parameterDependent) return;
      candidates.push({ equation, ordinal: current, name: fn.fn.name, argument: fn.args[0] });
      for (const factor of FACTORS) candidates.push({ equation, ordinal: current, name: fn.fn.name, argument: fn.args[0], factor });
    });
  }
  const rng = random(seed);
  for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
  const bound = (key: string, fallback: number) => { const value = scene.settings[key] ?? fallback; return typeof value === 'string' ? compileReal(value)({ ...scene.parameters, t: 0, time: 0 }) : Number(value); };
  const domains = { uMin: bound('uMin', 0), uMax: bound('uMax', Math.PI * 2), vMin: bound('vMin', 0), vMax: bound('vMax', Math.PI * 2) };
  for (const candidate of candidates.slice(0, 32)) {
    result.attempts++;
    if (candidate.factor !== undefined) {
      const arg = compileReal(candidate.argument.toString()), phases: number[] = [];
      for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) phases.push(arg({ ...scene.parameters, t: 0, time: 0, u: domains.uMin + (domains.uMax - domains.uMin) * i / 4, v: domains.vMin + (domains.vMax - domains.vMin) * j / 4 }));
      if (!phases.every(Number.isFinite) || (Math.max(...phases) - Math.min(...phases)) * candidate.factor > 128 * Math.PI) continue;
    }
    let ordinal = 0;
    const rewritten = trees.get(candidate.equation)!.transform(node => {
      if (node.type !== 'FunctionNode') return node;
      if (ordinal++ !== candidate.ordinal) return node;
      const argument = candidate.argument.toString();
      return parse(candidate.factor === undefined ? `${candidate.name === 'sin' ? 'cos' : 'sin'}(${argument})` : `${candidate.name}((${argument})*${candidate.factor})`);
    }).toString();
    const equations = { ...scene.equations, [candidate.equation]: rewritten };
    const sampled = evaluate(equations);
    if (sampled.stats.invalid || sampled.positions.length !== baseline.positions.length) continue;
    const shape = describe(sampled.positions), extentRatio = shape.span / base.span, areaRatio = shape.area / base.area;
    let squaredDistance = 0;
    for (let i = 0; i < sampled.positions.length; i++) squaredDistance += (sampled.positions[i] - baseline.positions[i]) ** 2;
    const relativeDisplacement = Math.sqrt(squaredDistance / sampled.stats.generated) / base.span;
    const centroidShift = Math.hypot(...shape.center.map((v, i) => v - base.center[i])) / base.span;
    if (extentRatio < .35 || extentRatio > 2.5 || areaRatio < .2 || areaRatio > 4 || relativeDisplacement < .015 || relativeDisplacement > .65 || centroidShift > .3) continue;
    return { ...result, status: 'found', equations, mutation: { equation: candidate.equation, operation: candidate.factor === undefined ? 'trig-switch' : 'frequency', from: candidate.name, to: candidate.factor === undefined ? candidate.name === 'sin' ? 'cos' : 'sin' : candidate.name, ...(candidate.factor !== undefined ? { factor: candidate.factor } : {}) }, metrics: { relativeDisplacement, extentRatio, centroidShift, finiteRatio: 1 } };
  }
  return { ...result, reason: candidates.length ? '有限候选均未通过几何稳定性、相似度或变化筛选。' : '公式中没有依赖 u/v 的可改写 sin/cos 函数。' };
}
