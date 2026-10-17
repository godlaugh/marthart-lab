import {generateImplicitSurface,IMPLICIT_MAX_SEGMENTS} from '../engine/implicitSurface';
import {attractorBackendControl} from '../engine/attractorControls';
import {parseAttractorInitial,AttractorSeedStream} from '../engine/attractorSeeds';
import { compileReal, numberSetting, random, type Scope } from '../engine/expression';
import {meshAppearanceDefaults,meshMaterialControls,parseMeshAppearance} from '../engine/meshAppearance';
import { vertexColors } from '../engine/palette';
import {trailWidthControl} from '../engine/trailAppearance';
import {geometryColorModel,paletteDomainColor,surfacePaletteSampler,detectSurfaceColorClosure} from '../engine/geometryColor';
import { gpuFormulaSampler, type SamplingBackend } from '../engine/gpuSampler';
import type { ControlSpec, GenerateContext, SceneDefinition, SceneDocument, SceneOutput, Settings } from '../types';

type Vec3 = [number, number, number];
export type Derivative = (point: Vec3, time: number) => Vec3;
const TAU = Math.PI * 2;
const FLOAT32_LIMIT = 3.4028234663852886e38;
const MAX_LATTICE_SAMPLES = 1_000_000;
const MAX_OUTPUT_VERTICES = 1_000_000;
const MAX_INTEGRATION_STEPS = 2_000_000;

function integer(settings: Settings, key: string, fallback: number, min: number, max: number) {
  const value = numberSetting(settings, key, fallback, min, max);
  if (!Number.isInteger(value)) throw new Error(`${key} 必须是整数`);
  return value;
}

function choice(settings: Settings, key: string, fallback: string, choices: string[]) {
  const value = String(settings[key] ?? fallback);
  if (!choices.includes(value)) throw new Error(`${key} 不支持 ${value}`);
  return value;
}

function baseScope(scene: SceneDocument, time: number): Scope {
  if (!Number.isFinite(time)) throw new Error('时间必须是有限数值');
  for (const [name, value] of Object.entries(scene.parameters)) {
    if (!Number.isFinite(value)) throw new Error(`参数 ${name} 必须是有限数值`);
  }
  return { ...scene.parameters, t: time, time };
}

function expressionSetting(settings: Settings, key: string, fallback: number, scope: Scope) {
  const raw = settings[key] ?? fallback;
  const value = typeof raw === 'string' ? compileReal(raw)(scope) : Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${key} 必须计算为有限数值`);
  return value;
}

function validPoint(point: Vec3) {
  return point.every(value => Number.isFinite(value) && Math.abs(value) <= FLOAT32_LIMIT);
}

export function transformFor(settings: Settings) {
  const scale = numberSetting(settings, 'scale', 1);
  const scales = ['X', 'Y', 'Z'].map(axis => numberSetting(settings, `scale${axis}`, 1) * scale);
  const offsets = ['X', 'Y', 'Z'].map(axis => numberSetting(settings, `offset${axis}`, 0));
  const angles = ['X', 'Y', 'Z'].map(axis => numberSetting(settings, `rotate${axis}`, 0));
  const [cx, cy, cz] = angles.map(Math.cos);
  const [sx, sy, sz] = angles.map(Math.sin);
  // One numeric transform owns both ordinary tuples and allocation-free large
  // cloud output. Preserve operation order rather than rebuilding a matrix at
  // a downstream consumer (which also changes floating-point rounding).
  function write(x:number,y:number,z:number,out:Vec3|Float32Array,at=0):boolean {
    x*=scales[0];y*=scales[1];z*=scales[2];
    const y1=y*cx-z*sx,z1=y*sx+z*cx;
    const x2=x*cy+z1*sy,z2=-x*sy+z1*cy;
    const tx=x2*cz-y1*sz+offsets[0],ty=x2*sz+y1*cz+offsets[1],tz=z2+offsets[2];
    out[at]=tx;out[at+1]=ty;out[at+2]=tz;
    return Number.isFinite(Math.fround(tx))&&Number.isFinite(Math.fround(ty))&&Number.isFinite(Math.fround(tz));
  }
  return {
    reflected: scales[0] * scales[1] * scales[2] < 0,
    write,
    apply(point:Vec3):Vec3 {const out:Vec3=[0,0,0];write(point[0],point[1],point[2],out);return out;},
  };
}

function pushPoint(positions: number[], point: Vec3) {
  if (!validPoint(point)) return -1;
  if (positions.length / 3 >= MAX_OUTPUT_VERTICES) {
    throw new Error(`几何输出超过 ${MAX_OUTPUT_VERTICES.toLocaleString()} 个顶点的内存预算；请降低采样密度`);
  }
  const index = positions.length / 3;
  positions.push(Math.fround(point[0]), Math.fround(point[1]), Math.fround(point[2]));
  return index;
}

function crossOf(positions: number[], a: number, b: number, c: number): Vec3 {
  const ax = positions[b * 3] - positions[a * 3];
  const ay = positions[b * 3 + 1] - positions[a * 3 + 1];
  const az = positions[b * 3 + 2] - positions[a * 3 + 2];
  const bx = positions[c * 3] - positions[a * 3];
  const by = positions[c * 3 + 1] - positions[a * 3 + 1];
  const bz = positions[c * 3 + 2] - positions[a * 3 + 2];
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

function triangle(positions: number[], indices: number[], a: number, b: number, c: number, flip = false) {
  if (a < 0 || b < 0 || c < 0 || a === b || b === c || a === c) return false;
  const normal = crossOf(positions, a, b, c);
  if (!normal.every(Number.isFinite) || normal.every(value => value === 0)) return false;
  indices.push(a, flip ? c : b, flip ? b : c);
  return true;
}

function wireframe(triangles: number[]) {
  const seen = new Set<string>();
  const edges: number[] = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const a = triangles[i], b = triangles[i + 1], c = triangles[i + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      if (!seen.has(key)) { seen.add(key); edges.push(u, v); }
    }
  }
  return edges;
}

function compactVertices(positions: number[], indices: number[]) {
  const used = new Map<number, number>(), compact: number[] = [];
  for (let i = 0; i < indices.length; i++) {
    const old = indices[i];
    let next = used.get(old);
    if (next === undefined) {
      next = compact.length / 3;
      used.set(old, next);
      compact.push(positions[old * 3], positions[old * 3 + 1], positions[old * 3 + 2]);
    }
    indices[i] = next;
  }
  positions.length = 0;
  for (const value of compact) positions.push(value);
  return used;
}

function output(scene: SceneDocument, positions: number[], indices: number[] | undefined,
  topology: 'points' | 'segments' | 'mesh', samples: number, invalid: number, warnings: string[], started: number, backend: SamplingBackend = 'cpu', providedColors?:Float32Array): SceneOutput {
  const vertices = new Float32Array(positions);
  const metric = providedColors ? 'height' : choice(scene.settings, 'colorMetric', 'height', ['height', 'radius', 'angle', 'index']);
  return {
    type: 'geometry', topology, positions: vertices, backend,
    ...(indices ? { indices: new Uint32Array(indices) } : {}),
    colors: providedColors ?? vertexColors(vertices, scene.palette, metric),
    stats: { samples, generated: positions.length / 3, invalid, elapsedMs: performance.now() - started },
    ...(warnings.length ? { warnings } : {}),
  };
}

/** Parameter motion has one owner for grids, decoupled lines and tracked particles.
 * Each instance owns its mutable evaluation scope; callers supply the evaluated
 * scene snapshot and time, so seeking does not depend on previous calls. */
function surfaceSampler(scene: SceneDocument, time: number) {
  const s = scene.settings;
  const scope = baseScope(scene, time), transform = transformFor(s);
  const nu = integer(s, 'uSegments', 96, 2, 512), nv = integer(s, 'vSegments', 48, 2, 512);
  const uMin = expressionSetting(s, 'uMin', 0, scope), uMax = expressionSetting(s, 'uMax', TAU, scope);
  const vMin = expressionSetting(s, 'vMin', 0, scope), vMax = expressionSetting(s, 'vMax', TAU, scope);
  if (uMax <= uMin || vMax <= vMin) throw new Error('参数域上限必须大于下限');
  if (![uMax - uMin, vMax - vMin].every(Number.isFinite)) throw new Error('参数域跨度不可表示');
  const periodicU = s.periodicU === true, periodicV = s.periodicV === true;
  const flowU = numberSetting(s, 'flowU', 0), flowV = numberSetting(s, 'flowV', 0);
  const speedU = s.speedU !== undefined && s.speedU !== '' ? compileReal(String(s.speedU)) : null;
  const speedV = s.speedV !== undefined && s.speedV !== '' ? compileReal(String(s.speedV)) : null;
  const equations = ['x', 'y', 'z'].map(key => compileReal(scene.equations[key] ?? '0'));
  function coordinate(min: number, max: number, fraction: number, flow: number, periodic: boolean, pingPong: boolean) {
    let f = fraction + time * flow;
    if (pingPong && flow !== 0) f = 1 - Math.abs(((f % 2) + 2) % 2 - 1);
    else if (periodic && flow !== 0) f = ((f % 1) + 1) % 1;
    return min + (max - min) * f;
  }
  function parameterCoordinate(value: number, min: number, max: number, speed: number, periodic: boolean, flowing: boolean) {
    if (!Number.isFinite(speed)) throw new Error('逐点参数速度必须是有限数值');
    const raw = value + time * speed;
    if (!periodic) return raw;
    const phase = (raw - min) / (max - min);
    return min + (max - min) * (flowing ? ((phase % 1) + 1) % 1 : 1 - Math.abs(((phase % 2) + 2) % 2 - 1));
  }
  function setParameters(fractionU:number,fractionV:number) {
      const initialU = uMin + (uMax - uMin) * fractionU, initialV = vMin + (vMax - vMin) * fractionV;
      // Both speeds see the same initial coordinates, independent of axis order.
      Object.assign(scope, { u: initialU, v: initialV, t: 0, time: 0 });
      const velocityU = speedU?.(scope), velocityV = speedV?.(scope);
      scope.t = scope.time = time;
      scope.u = velocityU === undefined ? coordinate(uMin, uMax, fractionU, flowU, periodicU, s.pingPongU === true)
        : parameterCoordinate(initialU, uMin, uMax, velocityU, periodicU, s.flowingU === true);
      scope.v = velocityV === undefined ? coordinate(vMin, vMax, fractionV, flowV, periodicV, s.pingPongV === true)
        : parameterCoordinate(initialV, vMin, vMax, velocityV, periodicV, s.flowingV === true);
      if (velocityU !== undefined && periodicU && s.flowingU === true && s.twistedU === true) {
        const turns = Math.floor((initialU + time * velocityU - uMin) / (uMax - uMin));
        if (Math.abs(turns % 2) === 1) scope.v = vMin + vMax - scope.v;
      }
  }
  return {scope,transform,nu,nv,periodicU,periodicV,flowU,flowV,speedU,speedV,equations,setParameters};
}

export interface SurfaceParticleSample {position:Vec3;particleId:number;particleCount:number;}
/** Stable row-major ID on the point lattice, independent of mesh seam vertices. */
export function sampleSurfaceParticle(scene:SceneDocument,time:number,index:number):SurfaceParticleSample {
  if(scene.kind!=='surface')throw new Error('Surface particle tracking requires a surface scene');
  if(!Number.isFinite(index))throw new Error('Surface particle index must be finite');
  const sampler=surfaceSampler(scene,time),{nu,nv,periodicU,periodicV,scope,transform,equations,setParameters}=sampler;
  const particleCount=nu*nv,particleId=Math.max(0,Math.min(particleCount-1,Math.trunc(index)));
  const i=particleId%nu,j=Math.floor(particleId/nu);
  setParameters(i/(periodicU?nu:nu-1),j/(periodicV?nv:nv-1));
  const raw=equations.map(evaluate=>evaluate(scope)) as Vec3;
  const position=validPoint(raw)?transform.apply(raw):raw;
  if(!validPoint(raw)||!validPoint(position))throw new Error(`Surface particle ${particleId} has no finite Float32 position`);
  return {position:position.map(Math.fround) as Vec3,particleId,particleCount};
}

/** Samples a rectangular parameter domain; periodic axes use wrapped topology. */
export function generateSurface(scene: SceneDocument, context: GenerateContext): SceneOutput {
  const started = performance.now(), s = scene.settings;
  const coloring=geometryColorModel(scene),parameterColors=coloring.surface==='parameter-u';
  let colorCoordinates:number[]=[];
  const {scope,transform,nu,nv,periodicU,periodicV,flowU,flowV,speedU,speedV,equations,setParameters}=surfaceSampler(scene,context.time);
  // Earlier MathArt Lab documents used periodic flags for both mesh seams and
  // motion. Explicit wrap flags now own topology independently of animation.
  const explicitWrapU = typeof s.wrapU === 'boolean', explicitWrapV = typeof s.wrapV === 'boolean';
  const wrapU = explicitWrapU ? s.wrapU === true : periodicU;
  const wrapV = explicitWrapV ? s.wrapV === true : periodicV;
  const mode = choice(s, 'renderMode', 'mesh', ['mesh', 'points', 'wireframe']);
  const width = mode === 'points' ? nu : nu + (wrapU && !explicitWrapU ? 0 : 1);
  const height = mode === 'points' ? nv : nv + (wrapV && !explicitWrapV ? 0 : 1);
  const uDivisor = mode === 'points' && !periodicU ? nu - 1 : nu;
  const vDivisor = mode === 'points' && !periodicV ? nv - 1 : nv;
  const positions: number[] = [], indices: number[] = [], warnings: string[] = [];
  const coordinates = new Float64Array(width * height * 3);
  const requestedBackend = choice(s, 'computeBackend', 'cpu', ['cpu', 'webgl2', 'auto']);
  let backend: SamplingBackend = 'cpu';
  const lookup = new Int32Array(width * height).fill(-1);
  let samples = 0, invalid = 0, cancelled = false, completedRows = 0;
  for (let j = 0; j < height; j++) {
    if (context.isCancelled?.()) { cancelled = true; break; }
    for (let i = 0; i < width; i++) {
      setParameters(i/uDivisor,j/vDivisor);
      const offset = (j * width + i) * 3;
      coordinates[offset] = scope.u; coordinates[offset + 1] = scope.v;
    }
    completedRows++;
  }
  let gpuValues: Float32Array | undefined;
  if (!cancelled && (requestedBackend === 'webgl2' || requestedBackend === 'auto' && width * height >= 4096)) {
    const sampled = gpuFormulaSampler.sample(['x', 'y', 'z'].map(key => scene.equations[key] ?? '0'), new Float32Array(coordinates), ['u', 'v'], baseScope(scene, context.time));
    gpuValues = sampled.values; backend = sampled.backend; warnings.push(...sampled.warnings);
  }
  for (let j = 0; j < completedRows; j++) for (let i = 0; i < width; i++) {
    const offset = (j * width + i) * 3;
    scope.u = coordinates[offset]; scope.v = coordinates[offset + 1];
    const point = gpuValues ? Array.from(gpuValues.subarray(offset, offset + 3)) as Vec3 : equations.map(fn => fn(scope)) as Vec3;
    samples++;
    const index = validPoint(point) ? pushPoint(positions, transform.apply(point)) : -1;
    if(parameterColors&&index>=0)colorCoordinates[index]=i/uDivisor;
    lookup[j * width + i] = index;
    if (index < 0) invalid++;
  }
  let degenerate = 0;
  let surfaceGrid: import('../types').GeometryOutput['surfaceGrid'];
  if (mode !== 'points') {
    // A whole parameter boundary may collapse to one pole (for example a sphere).
    // Weld only such boundary rings, never general coincident/self-intersecting points.
    const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) {
      low[i % 3] = Math.min(low[i % 3], positions[i]);
      high[i % 3] = Math.max(high[i % 3], positions[i]);
    }
    const diagonal = Math.hypot(...high.map((value, i) => value - low[i]));
    const tolerance = diagonal * Number.EPSILON * 64;
    const wrapThreshold = numberSetting(s, 'wrapThreshold', .25, 0, 1) * diagonal;
    let refusedSeams = 0;
    function weldPair(a: number, b: number) {
      const ia = lookup[a], ib = lookup[b];
      if (ia >= 0 && ib >= 0 && Math.hypot(...[0, 1, 2].map(k => positions[ia * 3 + k] - positions[ib * 3 + k])) <= wrapThreshold) lookup[b] = ia;
      else refusedSeams++;
    }
    if (explicitWrapU && wrapU) for (let j = 0; j < height; j++) weldPair((s.twistedU === true ? height - 1 - j : j) * width, j * width + width - 1);
    if (explicitWrapV && wrapV) for (let i = 0; i < width; i++) weldPair(i, (height - 1) * width + i);
    if (refusedSeams) warnings.push(`${refusedSeams} 对端点超过闭合阈值，保持开放边界。`);
    function weldBoundary(entries: number[]) {
      const first = lookup[entries[0]];
      if (first < 0 || !Number.isFinite(tolerance)) return;
      if (!entries.every(entry => {
        const id = lookup[entry];
        return id >= 0 && Math.hypot(positions[id * 3] - positions[first * 3], positions[id * 3 + 1] - positions[first * 3 + 1], positions[id * 3 + 2] - positions[first * 3 + 2]) <= tolerance;
      })) return;
      for (const entry of entries) lookup[entry] = first;
    }
    if (!wrapU) {
      weldBoundary(Array.from({ length: height }, (_, j) => j * width));
      weldBoundary(Array.from({ length: height }, (_, j) => j * width + width - 1));
    }
    if (!wrapV) {
      weldBoundary(Array.from({ length: width }, (_, i) => i));
      weldBoundary(Array.from({ length: width }, (_, i) => (height - 1) * width + i));
    }
    const cellTriangles = new Uint8Array(nu * nv);
    for (let j = 0; j < (cancelled ? Math.min(nv, Math.max(0, completedRows - 1)) : nv); j++) {
      for (let i = 0; i < nu; i++) {
        const nextI = (i + 1) % width, nextJ = (j + 1) % height;
        const a = lookup[j * width + i], b = lookup[j * width + nextI];
        const c = lookup[nextJ * width + nextI], d = lookup[nextJ * width + i];
        if (triangle(positions, indices, a, b, c, transform.reflected)) cellTriangles[j * nu + i] |= 1; else degenerate++;
        if (triangle(positions, indices, a, c, d, transform.reflected)) cellTriangles[j * nu + i] |= 2; else degenerate++;
      }
    }
    const remap = compactVertices(positions, indices);
    if(parameterColors){const compact:number[]=[];for(const [old,index]of remap)compact[index]=colorCoordinates[old];colorCoordinates=compact;}
    surfaceGrid = {width,height,uSegments:nu,vSegments:nv,
      vertexIndices:Int32Array.from(lookup,index=>remap.get(index)??-1),cellTriangles};
  }
  if (invalid) warnings.push(`${invalid} 个非有限或超出 Float32 范围的采样点已排除，邻接面不会跨越这些点。`);
  if (degenerate) warnings.push(`${degenerate} 个缺点或零面积三角形已排除。`);
  if (cancelled) warnings.push('已取消；仅返回完成的参数域采样。');
  if ((!speedU && flowU && !periodicU && !s.pingPongU) || (!speedV && flowV && !periodicV && !s.pingPongV)) warnings.push('旧版周期速度：非周期轴未启用往返时，流动按相位平移参数域。');
  let independentWire: import('../types').GeometryOutput['surfaceWireframe'];
  if (mode !== 'points') {
    const appearance=parseMeshAppearance(s),wire=appearance.surfaceWire;
    if(wire.decoupled&&(appearance.wireframe||mode==='wireframe')){
      const count=(wire.uLines+wire.vLines)*wire.curveSamples;
      if(count>1_000_000)throw new Error('独立线框超过 100 万个采样点；请降低线数或每条曲线采样点');
      const coords=new Float64Array(count*3),lineStarts:number[]=[];
      let populated=0;
      outer:for(const axis of ['u','v'] as const){
        const lines=axis==='u'?wire.uLines:wire.vLines;
        for(let line=0;line<lines;line++){
          lineStarts.push(populated);
          const fixed=lines===1?.5:line/(lines-1);
          for(let sample=0;sample<wire.curveSamples;sample++){
            if(context.isCancelled?.()){cancelled=true;break outer;}
            const varying=sample/(wire.curveSamples-1);
            setParameters(axis==='u'?fixed:varying,axis==='u'?varying:fixed);
            coords[populated*3]=scope.u;coords[populated*3+1]=scope.v;populated++;
          }
        }
      }
      lineStarts.push(populated);
      let curveGpu:Float32Array|undefined,curveBackend:SamplingBackend='cpu';
      if(populated>0&&!cancelled&&(requestedBackend==='webgl2'||requestedBackend==='auto'&&populated>=4096)){
        const sampled=gpuFormulaSampler.sample(['x','y','z'].map(key=>scene.equations[key]??'0'),new Float32Array(coords.subarray(0,populated*3)),['u','v'],baseScope(scene,context.time));
        curveGpu=sampled.values;curveBackend=sampled.backend;warnings.push(...sampled.warnings.map(w=>`独立线框：${w}`));
      }
      const curvePositions:number[]=[],curveIndices:number[]=[];let curveInvalid=0;
      for(let line=0;line<lineStarts.length-1;line++){
        let previous=-1;
        for(let sample=lineStarts[line];sample<lineStarts[line+1];sample++){
          scope.u=coords[sample*3];scope.v=coords[sample*3+1];
          const point=curveGpu?Array.from(curveGpu.subarray(sample*3,sample*3+3)) as Vec3:equations.map(fn=>fn(scope)) as Vec3;
          const current=validPoint(point)?pushPoint(curvePositions,transform.apply(point)):-1;samples++;
          if(current<0){curveInvalid++;previous=-1;continue;}
          if(previous>=0&&[0,1,2].some(k=>curvePositions[current*3+k]!==curvePositions[previous*3+k]))curveIndices.push(previous,current);
          previous=current;
        }
      }
      invalid+=curveInvalid;
      if(curveInvalid)warnings.push(`独立线框排除了 ${curveInvalid} 个无效采样点，并在这些位置断线。`);
      if(cancelled&&!warnings.some(w=>w.startsWith('已取消')))warnings.push('已取消；独立线框只保留完成的采样。');
      independentWire={positions:new Float32Array(curvePositions),indices:new Uint32Array(curveIndices),backend:curveBackend};
    }
  }
  let colors:Float32Array|undefined;
  if(parameterColors){
    let closed=coloring.closure==='closed';
    if(coloring.closure==='auto'){
      if(mode==='points')closed=periodicU;
      else if(wrapU)closed=true;
      else{const closure=detectSurfaceColorClosure((u,v)=>{setParameters(u,v);return transform.apply(equations.map(fn=>fn(scope)) as Vec3);},numberSetting(s,'wrapThreshold',.25,0,1),nu);closed=closure.closed;if(closure.reason==='invalid')warnings.push('曲面闭环颜色探测遇到无效点，已使用开放渐变。');}
    }
    const sample=surfacePaletteSampler(scene.palette,closed);colors=new Float32Array(positions.length);
    colorCoordinates.forEach((u,index)=>colors!.set(sample(u),index*3));
  }
  const result = output(scene, positions, mode === 'points' ? undefined : mode === 'wireframe' ? wireframe(indices) : indices,
    mode === 'points' ? 'points' : mode === 'wireframe' ? 'segments' : 'mesh', samples, invalid, warnings, started, backend,colors);
  if (result.type === 'geometry' && surfaceGrid) result.surfaceGrid = surfaceGrid;
  if (result.type === 'geometry' && independentWire) result.surfaceWireframe = independentWire;
  if (result.type === 'geometry' && mode === 'points') {
    result.particleIds = new Uint32Array(result.stats.generated);
    for (let id = 0; id < lookup.length; id++) if (lookup[id] >= 0) result.particleIds[lookup[id]] = id;
  }
  return result;
}

/** One explicit Euler or classical RK4 step. The caller controls the time step. */
export function integrateStep(derivative: Derivative, point: Vec3, time: number, dt: number, method: 'euler' | 'rk4'): Vec3 {
  const k1 = derivative(point, time);
  if (method === 'euler') return point.map((value, i) => value + dt * k1[i]) as Vec3;
  const k2 = derivative(point.map((value, i) => value + dt * k1[i] / 2) as Vec3, time + dt / 2);
  const k3 = derivative(point.map((value, i) => value + dt * k2[i] / 2) as Vec3, time + dt / 2);
  const k4 = derivative(point.map((value, i) => value + dt * k3[i]) as Vec3, time + dt);
  return point.map((value, i) => value + dt * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) / 6) as Vec3;
}

export function prepareAttractorFrame(scene: SceneDocument) {
  const s = scene.settings, scope = baseScope(scene, 0);
  const dt = numberSetting(s, 'dt', .005, .000001, 1);
  const dtMin = numberSetting(s, 'dtMin', .005, .000001, 1), dtMax = numberSetting(s, 'dtMax', .02, .000001, 1);
  if (dtMax < dtMin) throw new Error('随机时间步长上限必须不小于下限');
  const field={equations:['dx','dy','dz'].map(key=>scene.equations[key]??'0') as [string,string,string],parameters:{...scene.parameters}};
  const equations=field.equations.map(source=>compileReal(source));
  const derivative: Derivative = ([x, y, z], time) => {
    Object.assign(scope, { x, y, z, t: time, time });
    return equations.map(fn => fn(scope)) as Vec3;
  };
  return { field,dt, dtMin, dtMax, variableTimeStep: s.variableTimeStep === true,
    subSteps: integer(s, 'subSteps', 1, 1, 1000),
    limit: numberSetting(s, 'divergenceLimit', 10000, .000001, 1e30),
    method: choice(s, 'integrator', 'rk4', ['euler', 'rk4']) as 'euler' | 'rk4',
    derivative, transform: transformFor(s),
  };
}
export type AttractorFrameJob=ReturnType<typeof prepareAttractorFrame>;
export interface AttractorParticle { id: number; point: Vec3; physicalTime: number; dtFraction: number; warmup: number; alive: boolean; }
export function prepareAttractorParticles(scene: SceneDocument): AttractorParticle[] {
  const config=parseAttractorInitial(scene.settings);
  if(config.count>10000)throw new Error('CPU 吸引子最多支持 10000 个粒子；请使用无拖尾 GPU 连续模式');
  const particles:AttractorParticle[]=[];
  new AttractorSeedStream(config).read(config.count,(id,x,y,z,dtFraction,warmup)=>particles.push({id,point:[x,y,z],physicalTime:0,dtFraction,warmup,alive:true}));
  return particles;
}

export function generateAttractor(scene: SceneDocument, context: GenerateContext): SceneOutput {
  const started = performance.now(), s = scene.settings;
  const steps = integer(s, 'steps', 12_000, 1, 100_000);
  const burnIn = integer(s, 'burnIn', 500, 0, 100_000);
  const count = integer(s, 'particleCount', 1, 1, 10_000);
  const { dt, dtMin, dtMax, subSteps, method, limit, derivative, transform } = prepareAttractorFrame(scene);
  const particles = prepareAttractorParticles(scene);
  const staggerMin = integer(s, 'staggerMin', 0, 0, 100_000), staggerMax = integer(s, 'staggerMax', 0, 0, 100_000);
  if (staggerMax < staggerMin) throw new Error('随机预热上限必须不小于下限');
  if (count * (steps * subSteps + burnIn + staggerMax) > MAX_INTEGRATION_STEPS) throw new Error('总积分步数超过 2,000,000；请减少粒子数、步数、子步数或预热步数');
  const mode = choice(s, 'renderMode', 'lines', ['points', 'lines']);
  const revealRate = numberSetting(s, 'stepsPerSecond', 1200, 1, 100_000);
  const visibleSteps = s.animate === true ? Math.min(steps, Math.max(0, Math.floor(context.time * revealRate))) : steps;
  if (count * (visibleSteps + 1) > MAX_OUTPUT_VERTICES) throw new Error('轨迹输出超过 1,000,000 个顶点；请减少粒子数或记录步数');
  baseScope(scene, context.time);
  const positions: number[] = [], indices: number[] = [], warnings: string[] = [];
  let samples = 0, invalid = 0, stopped = 0, cancelled = false;
  function admissible(point: Vec3) { return validPoint(point) && Math.hypot(...point) <= limit; }
  particleLoop: for (let particle = 0; particle < count; particle++) {
    let point = [...particles[particle].point] as Vec3;
    const particleDt = s.variableTimeStep === true ? dtMin + particles[particle].dtFraction * (dtMax - dtMin) : dt;
    const particleWarmup = particles[particle].warmup;
    const integrationSteps = particleWarmup + visibleSteps * subSteps;
    let previousIndex = -1;
    for (let step = 0; step <= integrationSteps; step++) {
      if ((step & 255) === 0 && context.isCancelled?.()) { cancelled = true; break particleLoop; }
      samples++;
      if (!admissible(point)) { invalid++; stopped++; break; }
      if (step >= particleWarmup && (step - particleWarmup) % subSteps === 0) {
        const index = pushPoint(positions, transform.apply(point));
        if (index < 0) { invalid++; stopped++; break; }
        if (previousIndex >= 0 && mode === 'lines') indices.push(previousIndex, index);
        previousIndex = index;
      }
      if (step < integrationSteps) point = integrateStep(derivative, point, step * particleDt, particleDt, method);
    }
  }
  if (stopped) warnings.push(`${stopped} 条轨迹达到非有限值或发散半径 ${limit}，已停止并保留此前有限点。`);
  if (cancelled) warnings.push('已取消；仅返回完成的积分样本。');
  return output(scene, positions, mode === 'lines' ? indices : undefined, mode === 'lines' ? 'segments' : 'points', samples, invalid, warnings, started);
}

/** Implicit grid/root/output ownership is isolated from surface and attractor. */
export function generateImplicit(scene:SceneDocument,context:GenerateContext):SceneOutput {
  return generateImplicitSurface(scene,context,transformFor(scene.settings));
}

function numberControl(key: string, label: string, group: string, min?: number, max?: number, step?: number, help?: string): ControlSpec {
  return { key, label, group, type: 'number', min, max, step, help };
}
function selectControl(key: string, label: string, group: string, options: [string, string][]): ControlSpec {
  return { key, label, group, type: 'select', options: options.map(([value, label]) => ({ value, label })) };
}
const colorControl = selectControl('colorMetric', '着色依据', '外观', [['height', '高度'], ['radius', '距原点距离'], ['angle', '方位角'], ['index', '顶点顺序']]);
const backendControl = selectControl('computeBackend', '公式计算', '计算', [['cpu', 'CPU · 双精度'], ['webgl2', 'WebGL2 · 单精度'], ['auto', '自动 · 大批量使用 WebGL2']]);
const trailControls: ControlSpec[] = [
  trailWidthControl,
  { key: 'showTrails', label: '显示历史拖尾', group: '历史拖尾', type: 'toggle', help: '曲面使用点云模式；吸引子使用连续粒子模式。历史按指定时间重建，预览和导出一致。' },
  { key: 'recordTrails', label: '记录历史位置', group: '历史拖尾', type: 'toggle', help: '关闭后停止新增记录，已有记录按寿命自然过期；显示开关独立控制可见性。' },
  { key: 'fadeTrails', label: '按年龄渐隐', group: '历史拖尾', type: 'toggle' },
  numberControl('trailLifetime', '历史寿命 · 秒', '历史拖尾', .001, 60, .1, '最多100万个历史顶点；过大时明确报错，不静默丢弃粒子。'),
];
const historyDefaults: Settings = { trailWidth:1, showTrails: false, recordTrails: true, fadeTrails: false, trailLifetime: 5, trailSampleRate: 30 };
const transformControls: ControlSpec[] = [
  numberControl('scale', '整体缩放', '空间变换', -1000, 1000, 0.1),
  ...['X', 'Y', 'Z'].flatMap(axis => [numberControl(`scale${axis}`, `${axis} 轴缩放`, '空间变换', -1000, 1000, 0.1), numberControl(`offset${axis}`, `${axis} 轴偏移`, '空间变换', -1e6, 1e6, 0.1), numberControl(`rotate${axis}`, `${axis} 轴旋转 · 弧度`, '空间变换', -TAU * 100, TAU * 100, 0.05)]),
];
const transforms: Settings = { scale: 1, scaleX: 1, scaleY: 1, scaleZ: 1, offsetX: 0, offsetY: 0, offsetZ: 0, rotateX: 0, rotateY: 0, rotateZ: 0, colorMetric: 'height' };
const surfaceSettings: Settings = { ...transforms, ...meshAppearanceDefaults, ...historyDefaults, surfaceColorMode:'parameter-u',surfaceGradientClosure:'auto',renderMode: 'mesh', uMin: 0, uMax: TAU, vMin: 0, vMax: TAU, uSegments: 96, vSegments: 48, periodicU: true, periodicV: true, flowU: 0, flowV: 0, pingPongU: false, pingPongV: false };
const attractorSettings: Settings = { ...transforms, ...historyDefaults, simulationMode: 'trajectory', attractorBackend: 'cpu', simulationFps: 30, renderMode: 'lines', integrator: 'rk4', dt: 0.005, variableTimeStep: false, dtMin: 0.005, dtMax: 0.02, subSteps: 1, steps: 12000, burnIn: 500, staggerMin: 0, staggerMax: 0, particleCount: 1, initialX: 0.1, initialY: 0, initialZ: 0, initialSpread: 0.01, useInitialBounds: false, initialMinX: -0.1, initialMaxX: 0.1, initialMinY: -0.1, initialMaxY: 0.1, initialMinZ: -0.1, initialMaxZ: 0.1, divergenceLimit: 10000, seed: 42, animate: false, stepsPerSecond: 1200 };
const implicitSettings: Settings = { ...transforms, ...meshAppearanceDefaults, implicitColorMode:'z-domain',renderMode: 'mesh', resolution: 36, resolutionX: 0, resolutionY: 0, resolutionZ: 0, minX: -1.5, maxX: 1.5, minY: -1.5, maxY: 1.5, minZ: -1.5, maxZ: 1.5, isoLevel: 0, inside: 'below' };

export const definitions: SceneDefinition[] = [
  {
    kind: 'surface', name: '参数曲面', englishName: 'Parametric Surface', description: '将 u/v 方程采样为曲面、点云或线框；支持参数、时间和周期网格。', dimension: 3,
    equations: [{ key: 'x', label: 'x(u, v, t)' }, { key: 'y', label: 'y(u, v, t)' }, { key: 'z', label: 'z(u, v, t)' }],
    controls: [selectControl('renderMode', '渲染模式', '几何', [['mesh', '网格曲面'], ['points', '点云'], ['wireframe', '线框']]), backendControl, ...meshMaterialControls,
      ...['u', 'v'].flatMap(axis => [
        { key: `${axis}Min`, label: `${axis} 起点 · 表达式`, group: '参数域', type: 'text' } as ControlSpec,
        { key: `${axis}Max`, label: `${axis} 终点 · 表达式`, group: '参数域', type: 'text' } as ControlSpec,
        numberControl(`${axis}Segments`, `${axis} 分段`, '参数域', 2, 512, 1),
        { key: `periodic${axis.toUpperCase()}`, label: `${axis} 周期边界`, group: '参数域', type: 'toggle', help: '参数速度在边界环绕或反射；旧场景的网格闭合也沿用此开关。' } as ControlSpec,
        { key: `speed${axis.toUpperCase()}`, label: `${axis} 参数速度 · 表达式/秒`, group: '动画', type: 'text', help: '可引用初始 u/v 和方程参数；留空沿用旧周期速度。启用后周期边界默认往返，流动开关改为环绕。' } as ControlSpec,
        { key: `flowing${axis.toUpperCase()}`, label: `${axis} 参数速度环绕`, group: '动画', type: 'toggle' } as ControlSpec,
        numberControl(`flow${axis.toUpperCase()}`, `${axis} 流动 · 周期/秒`, '动画', -10, 10, 0.02, '周期轴环绕；非周期轴平移参数域。方程可直接使用 t。'),
        { key: `pingPong${axis.toUpperCase()}`, label: `${axis} 流动往返`, group: '动画', type: 'toggle', help: '参数在边界反射；关闭时周期轴环绕，非周期轴平移。' } as ControlSpec]),
      ...trailControls, numberControl('trailSampleRate', '历史采样 · 帧/秒', '历史拖尾', 1, 120, 1), ...transformControls, colorControl],
    defaults: { equations: { x: '(R+r*cos(v))*cos(u)', y: 'r*sin(v)', z: '(R+r*cos(v))*sin(u)' }, parameters: { R: 1.7, r: 0.55 }, settings: surfaceSettings },
    presets: [
      { id: 'torus', name: '圆环面', equations: { x: '(R+r*cos(v))*cos(u)', y: 'r*sin(v)', z: '(R+r*cos(v))*sin(u)' }, parameters: { R: 1.7, r: 0.55 }, settings: { ...surfaceSettings } },
      { id: 'sphere', name: '球面', equations: { x: 'r*sin(v)*cos(u)', y: 'r*cos(v)', z: 'r*sin(v)*sin(u)' }, parameters: { r: 1.5 }, settings: { ...surfaceSettings, vMax: Math.PI, periodicV: false } },
      { id: 'mobius', name: '莫比乌斯带', equations: { x: '(R+v*cos(u/2))*cos(u)', y: 'v*sin(u/2)', z: '(R+v*cos(u/2))*sin(u)' }, parameters: { R: 1.7 }, settings: { ...surfaceSettings, vMin: -0.55, vMax: 0.55, periodicU: false, periodicV: false } },
      { id: 'klein', name: '克莱因瓶浸入', equations: { x: '(R+cos(u/2)*sin(v)-sin(u/2)*sin(2*v))*cos(u)', y: 'sin(u/2)*sin(v)+cos(u/2)*sin(2*v)', z: '(R+cos(u/2)*sin(v)-sin(u/2)*sin(2*v))*sin(u)' }, parameters: { R: 2 }, settings: { ...surfaceSettings, periodicU: false } },
      { id: 'helicoid', name: '螺旋面', equations: { x: 'v*cos(u)', y: 'pitch*u', z: 'v*sin(u)' }, parameters: { pitch: 0.18 }, settings: { ...surfaceSettings, uMin: -TAU, uMax: TAU, vMin: -1.5, vMax: 1.5, periodicU: false, periodicV: false } },
      { id: 'enneper', name: '恩内佩尔极小曲面', equations: { x: 'u-u^3/3+u*v^2', y: 'u^2-v^2', z: 'v-v^3/3+v*u^2' }, parameters: {}, settings: { ...surfaceSettings, uMin: -1.5, uMax: 1.5, vMin: -1.5, vMax: 1.5, periodicU: false, periodicV: false } },
      { id: 'wave', name: '时间波面', equations: { x: 'u', y: 'amplitude*sin(frequency*sqrt(u^2+v^2)-speed*t)', z: 'v' }, parameters: { amplitude: 0.5, frequency: 3, speed: 1 }, settings: { ...surfaceSettings, uMin: -2, uMax: 2, vMin: -2, vMax: 2, periodicU: false, periodicV: false } },
    ], generate: generateSurface,
  },
  {
    kind: 'attractor', name: '奇异吸引子', englishName: 'Strange Attractor', description: '显式微分方程、Euler / RK4 数值积分与可复现的多粒子轨迹。', dimension: 3,
    equations: [{ key: 'dx', label: 'dx / dt' }, { key: 'dy', label: 'dy / dt' }, { key: 'dz', label: 'dz / dt' }],
    controls: [attractorBackendControl,selectControl('simulationMode', '模拟方式', '积分', [['trajectory', '完整静态轨迹'], ['continuous', '连续粒子 · 随时间推进']]), numberControl('simulationFps', '模拟帧率', '积分', 1, 120, 1, '连续模式每模拟帧执行指定子步；与视频导出帧率独立。'), ...trailControls, selectControl('renderMode', '静态轨迹呈现', '积分', [['lines', '轨迹线'], ['points', '粒子点']]), selectControl('integrator', '积分器', '积分', [['rk4', 'Runge–Kutta 4'], ['euler', 'Euler']]),
      numberControl('dt', '固定积分步长 dt', '积分', 0.000001, 1, 0.001),
      { key: 'variableTimeStep', label: '各粒子随机步长', group: '积分', type: 'toggle' },
      numberControl('dtMin', '随机 dt 下界', '积分', 0.000001, 1, 0.001), numberControl('dtMax', '随机 dt 上界', '积分', 0.000001, 1, 0.001),
      numberControl('steps', '记录帧数', '积分', 1, 100000, 500), numberControl('subSteps', '每帧积分子步', '积分', 1, 1000, 1), numberControl('burnIn', '预热步数', '积分', 0, 100000, 100),
      numberControl('staggerMin', '额外随机预热下界', '积分', 0, 100000, 1), numberControl('staggerMax', '额外随机预热上界', '积分', 0, 100000, 1),
      numberControl('particleCount', '轨迹数量', '粒子', 1, 10000, 1, '总积分预算200万步，输出预算100万个顶点。'), numberControl('initialSpread', '初始分散半径', '粒子', 0, 1000000, 0.01), numberControl('seed', '随机种子', '粒子', 0, 0xffffffff, 1),
      ...['X', 'Y', 'Z'].map(axis => numberControl(`initial${axis}`, `初始 ${axis}`, '粒子', undefined, undefined, 0.1)), numberControl('divergenceLimit', '发散停止半径', '积分', 0.000001, 1e30, 100),
      { key: 'useInitialBounds', label: '按三轴范围初始化', group: '粒子', type: 'toggle' },
      ...['X', 'Y', 'Z'].flatMap(axis => [numberControl(`initialMin${axis}`, `初始 ${axis} 下界`, '粒子', undefined, undefined, 0.1), numberControl(`initialMax${axis}`, `初始 ${axis} 上界`, '粒子', undefined, undefined, 0.1)]),
      { key: 'animate', label: '随时间逐步绘制', group: '动画', type: 'toggle' }, numberControl('stepsPerSecond', '每秒显示步数', '动画', 1, 100000, 100), ...transformControls, colorControl],
    defaults: { equations: { dx: 'sigma*(y-x)', dy: 'x*(rho-z)-y', dz: 'x*y-beta*z' }, parameters: { sigma: 10, rho: 28, beta: 8 / 3 }, settings: attractorSettings },
    presets: [
      { id: 'lorenz', name: 'Lorenz', equations: { dx: 'sigma*(y-x)', dy: 'x*(rho-z)-y', dz: 'x*y-beta*z' }, parameters: { sigma: 10, rho: 28, beta: 8 / 3 }, settings: { ...attractorSettings } },
      { id: 'rossler', name: 'Rössler', equations: { dx: '-y-z', dy: 'x+a*y', dz: 'b+z*(x-c)' }, parameters: { a: 0.2, b: 0.2, c: 5.7 }, settings: { ...attractorSettings, dt: 0.02, initialX: 1 } },
      { id: 'aizawa', name: 'Aizawa', equations: { dx: '(z-b)*x-d*y', dy: 'd*x+(z-b)*y', dz: 'c+a*z-z^3/3-(x^2+y^2)*(1+e*z)+f*z*x^3' }, parameters: { a: 0.95, b: 0.7, c: 0.6, d: 3.5, e: 0.25, f: 0.1 }, settings: { ...attractorSettings, dt: 0.01 } },
      { id: 'thomas', name: 'Thomas', equations: { dx: 'sin(y)-b*x', dy: 'sin(z)-b*y', dz: 'sin(x)-b*z' }, parameters: { b: 0.208186 }, settings: { ...attractorSettings, dt: 0.04, initialX: 1, initialY: 0.1 } },
      { id: 'halvorsen', name: 'Halvorsen', equations: { dx: '-a*x-4*y-4*z-y^2', dy: '-a*y-4*z-4*x-z^2', dz: '-a*z-4*x-4*y-x^2' }, parameters: { a: 1.4 }, settings: { ...attractorSettings, initialX: 1, dt: 0.005 } },
      { id: 'chen', name: 'Chen', equations: { dx: 'a*(y-x)', dy: '(c-a)*x-x*z+c*y', dz: 'x*y-b*z' }, parameters: { a: 35, b: 3, c: 28 }, settings: { ...attractorSettings, dt: 0.002, initialX: 0.1 } },
      { id: 'dadras', name: 'Dadras', equations: { dx: 'y-a*x+b*y*z', dy: 'c*y-x*z+z', dz: 'd*x*y-e*z' }, parameters: { a: 3, b: 2.7, c: 1.7, d: 2, e: 9 }, settings: { ...attractorSettings, dt: 0.005, initialX: 1, initialY: 1, initialZ: 1 } },
    ], generate: generateAttractor,
  },
  {
    kind: 'implicit', name: '隐式曲面', englishName: 'Implicit Surface', description: '标量场等值面；以共享边顶点的 Marching Tetrahedra 生成真实三角网格。', dimension: 3,
    equations: [{ key: 'f', label: 'f(x, y, z, t) = 等值阈值' }],
    controls: [backendControl, numberControl('isoLevel', '等值阈值', '等值面', undefined, undefined, 0.1), numberControl('resolution', '默认网格分段', '等值面', 4, IMPLICIT_MAX_SEGMENTS, 1, '完整采样请求的网格；小于网格间距的薄壁与偶重根可能无法提取。'),
      ...['X', 'Y', 'Z'].map(axis => numberControl(`resolution${axis}`, `${axis} 网格分段 · 0 跟随默认`, '等值面', 0, IMPLICIT_MAX_SEGMENTS, 1, '单独设置为4–200；设0时使用默认网格分段。')),
      selectControl('inside', '实体内部', '等值面', [['below', '场值低于阈值'], ['above', '场值高于阈值']]), selectControl('renderMode', '渲染模式', '等值面', [['mesh', '三角曲面'], ['wireframe', '线框'], ['points', '交点云']]), ...meshMaterialControls,
      ...['X', 'Y', 'Z'].flatMap(axis => ['min', 'max'].map(bound => ({ key: `${bound}${axis}`, label: `${axis} ${bound === 'min' ? '下' : '上'}界 · 表达式`, group: '采样域', type: 'text' } as ControlSpec))), ...transformControls, colorControl],
    defaults: { equations: { f: 'x^2+y^2+z^2-r^2' }, parameters: { r: 1 }, settings: implicitSettings },
    presets: [
      { id: 'sphere', name: '球体', equations: { f: 'x^2+y^2+z^2-r^2' }, parameters: { r: 1 }, settings: { ...implicitSettings } },
      { id: 'torus', name: '环面', equations: { f: '(sqrt(x^2+z^2)-R)^2+y^2-r^2' }, parameters: { R: 1, r: 0.35 }, settings: { ...implicitSettings, resolution: 48 } },
      { id: 'gyroid', name: 'Gyroid 周期曲面', equations: { f: 'sin(x)*cos(y)+sin(y)*cos(z)+sin(z)*cos(x)' }, parameters: {}, settings: { ...implicitSettings, minX: -Math.PI, maxX: Math.PI, minY: -Math.PI, maxY: Math.PI, minZ: -Math.PI, maxZ: Math.PI, resolution: 40 } },
      { id: 'schwarz-p', name: 'Schwarz P 曲面', equations: { f: 'cos(x)+cos(y)+cos(z)' }, parameters: {}, settings: { ...implicitSettings, minX: -Math.PI, maxX: Math.PI, minY: -Math.PI, maxY: Math.PI, minZ: -Math.PI, maxZ: Math.PI, resolution: 40 } },
      { id: 'metaballs', name: '融合元球', equations: { f: 'strength/((x-separation)^2+y^2+z^2+softening)+strength/((x+separation)^2+y^2+z^2+softening)' }, parameters: { strength: 0.45, separation: 0.65, softening: 0.02 }, settings: { ...implicitSettings, isoLevel: 1, inside: 'above', minX: -2, maxX: 2 } },
      { id: 'heart', name: '心形等值面', equations: { f: '(x^2+2.25*z^2+y^2-1)^3-x^2*y^3-0.1125*z^2*y^3' }, parameters: {}, settings: { ...implicitSettings, resolution: 48 } },
      { id: 'chmutov-octic', name: 'Chmutov 八次曲面 · 指南', equations: { f: 'x^8+y^8+z^8-2*x^6-2*y^6-2*z^6+1.25*x^4+1.25*y^4+1.25*z^4-.25*x^2-.25*y^2-.25*z^2+.03125' }, parameters: {}, settings: { ...implicitSettings, resolution: 80, minX:-1,maxX:1,minY:-1,maxY:1,minZ:-1,maxZ:1,computeBackend:'cpu',meshWireframe:true } },
      { id: 'klein-implicit', name: 'Klein 隐式曲面 · 指南', equations: { f: '(x*x+y*y+z*z+2*y-1)*((x*x+y*y+z*z-2*y-1)^2-8*z*z)+16*x*z*(x*x+y*y+z*z-2*y-1)' }, parameters: {}, settings: { ...implicitSettings, resolution: 100, minX:-3,maxX:3,minY:-3,maxY:3,minZ:-3,maxZ:3,computeBackend:'cpu' } },
      { id: 'animated-metaballs', name: '流动元球', equations: { f: 'strength/((x-separation*cos(t))^2+(y-separation*sin(t))^2+z^2+softening)+strength/((x+separation*cos(t))^2+(y+separation*sin(t))^2+z^2+softening)' }, parameters: { strength: 0.45, separation: 0.65, softening: 0.02 }, settings: { ...implicitSettings, isoLevel: 1, inside: 'above', minX: -2, maxX: 2, minY: -2, maxY: 2 } },
    ], generate: generateImplicit,
  },
];
