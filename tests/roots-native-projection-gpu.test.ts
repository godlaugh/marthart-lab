import {prepareRootsDensityColor} from '../src/engine/rootsDensityColor';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ROOTS_NATIVE_DENSITY_CHUNK, RootsNativeDensityGpu, rootsNativeDensityGpuBytes} from '../src/engine/rootsNativeDensityGpu';
import {RootsGpuError} from '../src/engine/rootsGpuFailure';
import {prepareRootsProjection, type PreparedRootsProjection} from '../src/engine/rootsProjection';
import {defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';

/** Simulated GL checks only failure/ownership contracts. Numerical pixels are
 * covered by the independent retained-shader browser verifier, not this mock. */
function fakeGl() {
  const live = new Set<object>(), deleted: object[] = [], calls: string[] = [];
  let id = 0, lost = false, current: object | null = null;
  const faults = new Map<string, () => void>();
  const constants = new Map<string, number>();
  const create = () => { const object = {id: ++id}; live.add(object); return object; };
  const gl = new Proxy<Record<string, unknown>>({}, {get(target, key: string) {
    if (key in target) return target[key];
    if (/^[A-Z_0-9]+$/.test(key)) { if (!constants.has(key)) constants.set(key, constants.size + 1); return constants.get(key); }
    const fn = (...args: unknown[]) => {
      calls.push(key); faults.get(key)?.();
      if (key.startsWith('create')) return create();
      if (key.startsWith('delete')) { live.delete(args[0] as object); deleted.push(args[0] as object); return; }
      if (key === 'isContextLost') return lost;
      if (key === 'getExtension') return args[0] === 'WEBGL_lose_context' ? {loseContext: () => { calls.push('loseContext'); faults.get('loseContext')?.(); lost = true; }} : {};
      if (key === 'getParameter') {
        if (args[0] === gl.MAX_TEXTURE_SIZE) return 16384;
        if (args[0] === gl.MAX_VIEWPORT_DIMS) return new Int32Array([16384, 16384]);
        if (args[0] === gl.ALIASED_POINT_SIZE_RANGE) return new Float32Array([1, 1024]);
        if (args[0] === gl.CURRENT_PROGRAM) return current;
      }
      if (key === 'useProgram') { current = args[0] as object | null; return; }
      if (key === 'getShaderParameter' || key === 'getProgramParameter') return true;
      if (key === 'checkFramebufferStatus') return gl.FRAMEBUFFER_COMPLETE;
      if (key === 'getError') return gl.NO_ERROR;
      if (key === 'getUniformLocation') return {};
      if (key === 'readPixels') { const dst = args[6] as Float32Array; dst.fill(0); }
    };
    target[key] = fn; return fn;
  }});
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return gl; } });
  return {gl, live, deleted, calls, faults};
}
function failure(call: () => unknown): RootsGpuError { try { call(); } catch (error) { expect(error).toBeInstanceOf(RootsGpuError); return error as RootsGpuError; } throw Error('Expected failure'); }
function messages(error: unknown): string[] { return error instanceof Error ? [error.message, ...(error.cause ? messages(error.cause) : []), ...(error instanceof AggregateError ? error.errors.flatMap(messages) : [])] : [String(error)]; }
function plan(size = 1024) { return prepareRootsProjection(defaultRootsPresentationConfiguration(), {width: size, height: size, viewport: {logicalWidth: size, logicalHeight: size, referenceLogicalHeight: size, target: 'primary'}}); }
afterEach(() => vi.unstubAllGlobals());

describe('native projected Roots GPU failure and ownership boundaries', () => {
  it('preflights actual ink/readback/chunk bytes before a context exists', () => {
    const getContext = vi.fn(); vi.stubGlobal('OffscreenCanvas', class {getContext = getContext;});
    expect(rootsNativeDensityGpuBytes(3840, 2160)).toBe(3840 * 2160 * 32 + ROOTS_NATIVE_DENSITY_CHUNK * 32 + 3840 * 16);
    const gpu = new RootsNativeDensityGpu();
    for (const [w, h] of [[0, 1], [1.5, 2], [16385, 1], [16384, 2048]]) expect(failure(() => gpu.initialize(w, h)).failureKind).toBe('capacity');
    expect(getContext).not.toHaveBeenCalled(); expect(gpu.diagnostics().handles).toBe(0);
  });
  it('separates missing-device support from input and capacity errors', () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    const gpu = new RootsNativeDensityGpu();
    expect(failure(() => gpu.initialize(2, 2)).failureKind).toBe('device');
    expect(failure(() => gpu.add([0, 0, 0], .5)).failureKind).toBe('input');
    expect(gpu.diagnostics().contextOwned).toBe(false);
  });
  it('counts queued points separately and clears pending data without reading ink', () => {
    const f = fakeGl(), gpu = new RootsNativeDensityGpu(); gpu.initialize(2, 2);
    const reads = f.calls.filter(s => s === 'readPixels').length;
    gpu.add([1e9, 2, 3], .5);
    expect(gpu.diagnostics()).toMatchObject({queuedFinitePoints: 1, pendingPoints: 1, submittedPoints: 0});
    gpu.clear(); expect(gpu.diagnostics()).toMatchObject({queuedFinitePoints: 0, pendingPoints: 0, submittedPoints: 0});
    expect(f.calls.filter(s => s === 'readPixels').length).toBe(reads);
    gpu.dispose(); expect(f.live.size).toBe(0); expect(gpu.diagnostics().contextOwned).toBe(false);
  });
  it('rejects nonfinite/invalid input and a full staging chunk without device recovery', () => {
    for (const [point, metric] of [[[0, 0, Infinity], .5], [[0, 1e300, 0], .5], [[0, 0, 0], NaN], [[0, 0], .5], [[0, 0, 0], 2]] as [number[], number][]) {
      const f = fakeGl(), gpu = new RootsNativeDensityGpu(); gpu.initialize(2, 2);
      expect(failure(() => gpu.add(point, metric)).failureKind).toBe('input'); expect(f.live.size).toBe(0);
    }
    const f = fakeGl(), gpu = new RootsNativeDensityGpu(); gpu.initialize(2, 2);
    for (let i = 0; i < ROOTS_NATIVE_DENSITY_CHUNK; i++) gpu.add([0, 0, 0], 0);
    expect(failure(() => gpu.add([0, 0, 0], 0)).failureKind).toBe('capacity'); expect(f.live.size).toBe(0);
  });
  it('never reads pending points as if they were submitted ink', () => {
    const f = fakeGl(), gpu = new RootsNativeDensityGpu(); gpu.initialize(2, 2); gpu.add([0, 0, 0], 1);
    const reads = f.calls.filter(s => s === 'readPixels').length;
    expect(failure(() => gpu.readback()).failureKind).toBe('input');
    expect(f.calls.filter(s => s === 'readPixels').length).toBe(reads); expect(f.live.size).toBe(0);
  });
  it('validates prepared facts and refuses point-cloud plans before any accumulation', () => {
    for (const bad of [{...plan(2), mode: 'point-cloud'}, {...plan(2), physicalWidth: 3}, {...plan(2), projection: {rowMajor: [], columnMajor: new Float32Array()}}]) {
      const f = fakeGl(), gpu = new RootsNativeDensityGpu(); gpu.initialize(2, 2); gpu.add([0, 0, 0], .5);
      const draws = f.calls.filter(x => x === 'drawArrays' || x === 'drawArraysInstanced').length;
      expect(failure(() => gpu.flush(bad as PreparedRootsProjection)).failureKind).toBe('input');
      expect(f.calls.filter(x => x === 'drawArrays' || x === 'drawArraysInstanced').length).toBe(draws); expect(f.live.size).toBe(0);
    }
  });
  it('commits N only after every draw succeeds and invalidates partly drawn ink on failure', () => {
    const f = fakeGl(), gpu = new RootsNativeDensityGpu(), p = plan(); gpu.initialize(1024, 1024);
    // A large diameter forces several bounded draws for a small point count.
    const large = {...p, densityDiameter: 1000, pointsDiameter: 1000, quadDiameter: 600, pointCloudUniformSize: 10};
    for (let i = 0; i < 30; i++) gpu.add([0, 0, 0], .5);
    let draws = 0;
    f.faults.set('drawArraysInstanced', () => {
      expect(gpu.diagnostics()).toMatchObject({submittedPoints: 0, pendingPoints: 30});
      if (++draws === 2) throw Error('second draw failed');
    });
    expect(failure(() => gpu.flush(large, 'quad')).failureKind).toBe('device');
    expect(draws).toBe(2); expect(gpu.diagnostics()).toMatchObject({submittedPoints: 0, handles: 0, contextOwned: false}); expect(f.live.size).toBe(0);
  });
  it('preserves a completed draw plus cancellation as an invalidated request, then recreates cleanly', () => {
    const f = fakeGl(), gpu = new RootsNativeDensityGpu(), p = plan(2); gpu.initialize(2, 2); gpu.add([0, 0, 0], .5);
    let checks = 0;
    expect(() => gpu.flush(p, 'points', () => ++checks === 3)).toThrowError(expect.objectContaining({name: 'AbortError'}));
    expect(f.calls.filter(x => x === 'drawArrays').length).toBe(1); // Actual draw before cancellation.
    expect(f.live.size).toBe(0); expect(gpu.diagnostics().submittedPoints).toBe(0);
    const recovered = fakeGl(); gpu.initialize(2, 2); gpu.add([0, 0, 0], .5); gpu.flush(p, 'quad');
    expect(gpu.diagnostics()).toMatchObject({submittedPoints: 1, pendingPoints: 0}); gpu.dispose(); expect(recovered.live.size).toBe(0);
  });
  it('retains failing draw and cleanup causes with retryable ownership', () => {
    const f = fakeGl(), gpu = new RootsNativeDensityGpu(); gpu.initialize(2, 2); gpu.add([0, 0, 0], .5);
    f.faults.set('drawArraysInstanced', () => { throw Error('draw fault'); });
    f.faults.set('deleteBuffer', () => { throw Error('buffer deletion fault'); });
    const error = failure(() => gpu.flush(plan(2), 'quad'));
    expect(error.failureKind).toBe('cleanup'); expect(messages(error)).toContain('draw fault'); expect(messages(error)).toContain('buffer deletion fault');
    expect(gpu.diagnostics()).toMatchObject({handles: 1, cleanupPending: true, submittedPoints: 0}); expect(f.live.size).toBe(1);
    f.faults.clear(); gpu.reset(); expect(f.live.size).toBe(0);
  });
  it('does not disguise cancellation or a throwing caller callback as a GPU device error', () => {
    const f = fakeGl(), gpu = new RootsNativeDensityGpu(); gpu.initialize(2, 2);
    expect(() => gpu.flush({} as PreparedRootsProjection, 'auto', () => true)).toThrowError(expect.objectContaining({name: 'AbortError'}));
    expect(f.live.size).toBe(0);
    const f2 = fakeGl(); gpu.initialize(2, 2);
    const error = failure(() => gpu.readback(() => { throw Error('caller fault'); }));
    expect(error.failureKind).toBe('input'); expect(messages(error)).toContain('caller fault'); expect(f2.live.size).toBe(0);
  });
  it('cleans all previously allocated objects on compilation, linking, FBO and read failure', () => {
    for (const stage of ['compileShader', 'linkProgram', 'checkFramebufferStatus', 'readPixels']) {
      const f = fakeGl(), gpu = new RootsNativeDensityGpu(); f.faults.set(stage, () => { throw Error(stage); });
      expect(failure(() => { gpu.initialize(2, 2); if (stage === 'readPixels') gpu.readback(); }).failureKind).toBe('device');
      expect(f.live.size).toBe(0); expect(gpu.diagnostics().handles).toBe(0);
    }
  });
  it('rejects incomplete or invalid no-error metric readback', () => {
    for (const fill of [
      (dst: Float32Array) => { dst.fill(0, 0, dst.length - 4); },
      (dst: Float32Array) => { dst.fill(0); dst[1] = 1; },
      (dst: Float32Array) => { dst.fill(0); dst[dst.length - 1] = Infinity; },
      (dst: Float32Array) => { dst.fill(0); dst.fill(-1, 0, 4); },
    ]) {
      const f = fakeGl(), gpu = new RootsNativeDensityGpu();
      f.gl.readPixels = (...args: unknown[]) => fill(args[6] as Float32Array);
      gpu.initialize(2, 2);
      expect(failure(() => gpu.readback())).toMatchObject({failureKind: 'device', message: 'Native root readback violates metric ink contract'});
      expect(gpu.diagnostics()).toMatchObject({contextOwned: false, handles: 0}); expect(f.live.size).toBe(0);
    }
  });
  it('preserves the source auto quad route and explicit diagnostic points without a repaired probe', () => {
    const f = fakeGl(), gpu = new RootsNativeDensityGpu(); gpu.initialize(2, 2);
    expect(f.calls).not.toContain('drawArrays'); expect(f.calls).not.toContain('readPixels');
    expect(gpu.diagnostics()).toMatchObject({autoKernel: 'quad', autoKernelReason: 'mathart-1.7.8-uninitialized-probe'});
    gpu.add([0, 0, 0], .5); gpu.flush(plan(2));
    expect(gpu.diagnostics().lastKernel).toBe('quad');
    gpu.clear(); gpu.add([0, 0, 0], .5); gpu.flush(plan(2), 'points');
    expect(gpu.diagnostics().lastKernel).toBe('points'); gpu.dispose(); expect(f.live.size).toBe(0);
  });
  it('presents retained ink without resubmission and returns independently owned top-down pixels', () => {
    const f=fakeGl(),gpu=new RootsNativeDensityGpu();gpu.initialize(2,2);gpu.add([0,0,0],.5);gpu.flush(plan(2));
    const color=prepareRootsDensityColor({settings:{rootDensityColorVersion:'mathart-1.7.8-metric-v1'}});if(color.kind!=='metric-sum')throw Error('metric');
    f.gl.readPixels=(...args:unknown[])=>{const p=args[6] as Uint8ClampedArray;for(let i=0;i<p.length;i+=4){p[i]=i<8?7:19;p[i+3]=255;}};
    const first=gpu.presentPixels(color,0),second=gpu.presentPixels(color,0);
    expect(Array.from(first.filter((_,i)=>i%4===0))).toEqual([19,19,7,7]);first.fill(0);expect(second[0]).toBe(19);
    expect(gpu.diagnostics()).toMatchObject({submittedPoints:1,pendingPoints:0,handles:9});gpu.dispose();expect(f.live.size).toBe(0);
  });
  it('rejects a missing final color row before row flipping can conceal it', () => {
    const f=fakeGl(),gpu=new RootsNativeDensityGpu();gpu.initialize(2,2);
    const color=prepareRootsDensityColor({settings:{rootDensityColorVersion:'mathart-1.7.8-metric-v1'}});if(color.kind!=='metric-sum')throw Error('metric');
    f.gl.readPixels=(...args:unknown[])=>{const p=args[6] as Uint8ClampedArray;p.fill(0);p[3]=p[7]=255;};
    expect(failure(()=>gpu.presentPixels(color,0))).toMatchObject({failureKind:'device',message:'Native root color readback is incomplete'});
    expect(gpu.diagnostics()).toMatchObject({handles:0,contextOwned:false});expect(f.live.size).toBe(0);
  });
  it('preserves color draw failure and retryable texture ownership', () => {
    const f=fakeGl(),gpu=new RootsNativeDensityGpu();gpu.initialize(2,2);
    const color=prepareRootsDensityColor({settings:{rootDensityColorVersion:'mathart-1.7.8-metric-v1'}});if(color.kind!=='metric-sum')throw Error('metric');
    f.faults.set('drawArrays',()=>{throw Error('color draw failed');});f.faults.set('deleteTexture',()=>{throw Error('texture release failed');});
    const error=failure(()=>gpu.presentPixels(color,0));expect(messages(error)).toContain('color draw failed');expect(error.failureKind).toBe('cleanup');
    expect(gpu.diagnostics()).toMatchObject({handles:3,cleanupPending:true,contextOwned:true});f.faults.clear();gpu.reset();expect(f.live.size).toBe(0);
  });
  it('cancels after color draw and readback without publishing a partial frame', () => {
    const f=fakeGl(),gpu=new RootsNativeDensityGpu();gpu.initialize(2,2);
    const color=prepareRootsDensityColor({settings:{rootDensityColorVersion:'mathart-1.7.8-metric-v1'}});if(color.kind!=='metric-sum')throw Error('metric');
    f.gl.readPixels=(...args:unknown[])=>{const p=args[6] as Uint8ClampedArray;for(let i=3;i<p.length;i+=4)p[i]=255;};let polls=0;
    expect(()=>gpu.presentPixels(color,0,()=>++polls===3)).toThrowError(expect.objectContaining({name:'AbortError'}));
    expect(f.calls.filter(x=>x==='drawArrays').length).toBe(1);expect(gpu.diagnostics().handles).toBe(0);expect(f.live.size).toBe(0);
  });
  it('preserves compile failure plus failed shader deletion and keeps the handle owned', () => {
    const f = fakeGl(), gpu = new RootsNativeDensityGpu();
    f.faults.set('compileShader', () => { throw Error('compile fault'); });
    f.faults.set('deleteShader', () => { throw Error('delete fault'); });
    const error = failure(() => gpu.initialize(2, 2));
    expect(error.failureKind).toBe('cleanup'); expect(messages(error).join('\n')).toContain('compile fault'); expect(messages(error).join('\n')).toContain('delete fault');
    expect(gpu.diagnostics()).toMatchObject({cleanupPending: true, handles: 1}); expect(f.live.size).toBe(1); expect(f.calls).not.toContain('loseContext');
    expect(failure(() => gpu.initialize(2, 2)).failureKind).toBe('cleanup');
    f.faults.clear(); gpu.reset(); expect(f.live.size).toBe(0); expect(gpu.diagnostics().contextOwned).toBe(false);
  });
  it('retains a failed program deletion instead of removing its ownership entry', () => {
    const f = fakeGl(), gpu = new RootsNativeDensityGpu(); gpu.initialize(2, 2);
    f.faults.set('deleteProgram', () => { throw Error('program deletion fault'); });
    expect(failure(() => gpu.dispose()).failureKind).toBe('cleanup');
    expect(gpu.diagnostics()).toMatchObject({cleanupPending: true, handles: 2}); expect(f.live.size).toBe(2);
    f.faults.clear(); gpu.dispose(); expect(f.live.size).toBe(0); expect(gpu.diagnostics().handles).toBe(0);
  });
  it('retains context ownership after context release fails and permits explicit retry', () => {
    const f = fakeGl(), gpu = new RootsNativeDensityGpu(); gpu.initialize(2, 2);
    f.faults.set('loseContext', () => { throw Error('context release fault'); });
    expect(failure(() => gpu.reset()).failureKind).toBe('cleanup');
    expect(gpu.diagnostics()).toMatchObject({cleanupPending: true, contextOwned: true, handles: 0});
    f.faults.clear(); gpu.reset(); expect(gpu.diagnostics()).toMatchObject({cleanupPending: false, contextOwned: false});
  });
});
