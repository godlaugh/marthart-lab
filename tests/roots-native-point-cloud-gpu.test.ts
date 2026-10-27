import {afterEach, describe, expect, it, vi} from 'vitest';
import {RootsNativePointCloudGpu, rootsNativePointCloudGpuBytes} from '../src/engine/rootsNativePointCloudGpu';
import {ROOTS_NATIVE_POINT_CLOUD_CHUNK, ROOTS_POINT_FRAME_BINDING_BYTES} from '../src/engine/rootsPointCloudDrawing';
import {RootsPointCloudRing} from '../src/engine/rootsPointCloudRing';
import {prepareRootsProjection} from '../src/engine/rootsProjection';
import {defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import {prepareRootsDensityColor, ROOTS_DENSITY_COLOR_VERSION, type RootsMetricColorPlan} from '../src/engine/rootsDensityColor';
import {RootsGpuError} from '../src/engine/rootsGpuFailure';

// Mock scope is protocol, state and resource ownership only. Actual pixel math
// is separately compared with retained shaders in the browser verifier.
function fakeGl() {
 const live = new Set<object>(), faults = new Map<string, () => void>(), calls: {name: string; args: unknown[]}[] = [], uploaded: Float32Array[] = [];
 let id = 0, lost = false, current: unknown = null, reads = 0; const constants = new Map<string, number>();
 const gl = new Proxy<Record<string, unknown>>({}, {get(target, name: string) {
  if (name in target) return target[name];
  if (/^[A-Z_0-9]+$/.test(name)) { if (!constants.has(name)) constants.set(name, constants.size + 1); return constants.get(name); }
  const fn = (...args: unknown[]) => {
   calls.push({name, args}); faults.get(name)?.();
   if (name.startsWith('create')) { const item = {id: ++id}; live.add(item); return item; }
   if (name.startsWith('delete')) { live.delete(args[0] as object); return; }
   if (name === 'getParameter') { if (args[0] === gl.MAX_TEXTURE_SIZE) return 16384; if (args[0] === gl.MAX_VIEWPORT_DIMS) return new Int32Array([16384, 16384]); if (args[0] === gl.ALIASED_POINT_SIZE_RANGE) return new Float32Array([1, 1024]); if (args[0] === gl.CURRENT_PROGRAM) return current; }
   if (name === 'useProgram') current = args[0];
   if (name === 'getShaderParameter' || name === 'getProgramParameter') return true;
   if (name === 'checkFramebufferStatus') return gl.FRAMEBUFFER_COMPLETE;
   if (name === 'getError') return gl.NO_ERROR;
   if (name === 'isContextLost') return lost;
   if (name === 'getExtension') return {loseContext() { faults.get('loseContext')?.(); lost = true; }};
   if (name === 'getUniformLocation') return {name: args[1]};
   if (name === 'readPixels') { const dst = args[6] as Uint8Array; dst.fill(0); if (reads++ < 2) dst.fill(255, 0, 4); }
   if (name === 'bufferSubData') uploaded.push((args[2] as Float32Array).slice());
  }; target[name] = fn; return fn;
 }});
 vi.stubGlobal('OffscreenCanvas', class { getContext() { return gl; } });
 return {gl, live, faults, calls, uploaded};
}
function plan(size = 4) { const c = defaultRootsPresentationConfiguration(); c.mode = 'point-cloud'; return prepareRootsProjection(c, {width: size, height: size, viewport: {logicalWidth: size, logicalHeight: size, referenceLogicalHeight: size, target: 'primary'}}); }
function color(background = '#000000') { return prepareRootsDensityColor({settings: {rootDensityColorVersion: ROOTS_DENSITY_COLOR_VERSION, background}}) as RootsMetricColorPlan; }
function ring(points = [0, 0, 0, .5]) { const r = new RootsPointCloudRing({capacityPoints: 8, recentWindowPoints: 4}); r.append(Float32Array.from(points)); return r; }
function error(run: () => unknown) { try { run(); } catch (e) { expect(e).toBeInstanceOf(RootsGpuError); return e as RootsGpuError; } throw Error('Expected RootsGpuError'); }
function messages(e: unknown): string[] { return e instanceof Error ? [e.message, ...(e.cause ? messages(e.cause) : []), ...(e instanceof AggregateError ? e.errors.flatMap(messages) : [])] : [String(e)]; }
afterEach(() => vi.unstubAllGlobals());

describe('source point-cloud GPU protocol and ownership', () => {
 it('preflights target representations before creating a device', () => {
  const getContext = vi.fn(); vi.stubGlobal('OffscreenCanvas', class {getContext = getContext;});
  expect(rootsNativePointCloudGpuBytes(10, 20)).toBe(10 * 20 * 12 + ROOTS_NATIVE_POINT_CLOUD_CHUNK * 32 + 3072 + ROOTS_POINT_FRAME_BINDING_BYTES + 40);
  const gpu = new RootsNativePointCloudGpu(); expect(error(() => gpu.initialize(16384, 16384)).failureKind).toBe('capacity'); expect(getContext).not.toHaveBeenCalled();
 });
 it('requires a complete positive point probe; empty/short reads do not become a shape fallback', () => {
  for (const short of [false, true]) {
   const f = fakeGl(), gpu = new RootsNativePointCloudGpu();
   f.gl.readPixels = (...args: unknown[]) => { const a = args[6] as Uint8Array; a.fill(0, 0, short ? a.length - 4 : a.length); };
   expect(error(() => gpu.initialize(4, 4)).failureKind).toBe('device'); expect(f.live.size).toBe(0); expect(gpu.diagnostics().probe).toBeUndefined();
  }
 });
 it('uploads raw XYZ without CPU projection/filter/sort and constrains metric via its owner', () => {
  const f = fakeGl(), gpu = new RootsNativePointCloudGpu(), r = ring([1, NaN, Infinity, -Infinity, -0, 3, -Infinity, Infinity]);
  gpu.initialize(4, 4); gpu.draw(plan(), color(), r);
  const values = f.uploaded[0]; expect(values.length).toBe(8); expect(values[0]).toBe(1); expect(values[1]).toBeNaN(); expect(values[2]).toBe(Infinity); expect(values[3]).toBe(0); expect(Object.is(values[4], -0)).toBe(true); expect(values[6]).toBe(-Infinity); expect(values[7]).toBe(1);
  expect(gpu.diagnostics()).toMatchObject({drawnPoints: 2, completedFrames: 1}); gpu.dispose(); expect(f.live.size).toBe(0);
 });
 it('rejects undefined NaN metric as input without consuming the ring or authorizing device fallback', () => {
  const f = fakeGl(), gpu = new RootsNativePointCloudGpu(), r = ring([0, 0, 0, NaN]); gpu.initialize(4, 4);
  expect(error(() => gpu.draw(plan(), color(), r)).failureKind).toBe('input'); expect(r.facts.retainedPointCount).toBe(1); expect(f.live.size).toBe(0);
 });
 it('keeps clear/fade explicit and uses distinct source alpha factors', () => {
  const f = fakeGl(), gpu = new RootsNativePointCloudGpu(); gpu.initialize(4, 4);
  const initialClears = f.calls.filter(c => c.name === 'clearBufferfv').length;
  gpu.draw(plan(), color(), ring()); expect(f.calls.filter(c => c.name === 'clearBufferfv').length).toBe(initialClears);
  expect([...f.calls].reverse().find(c => c.name === 'blendFunc')?.args).toEqual([f.gl.SRC_ALPHA, f.gl.ONE_MINUS_SRC_ALPHA]);
  gpu.fade(0xff010203, 6); expect([...f.calls].reverse().find(c => c.name === 'blendFuncSeparate')?.args).toEqual([f.gl.SRC_ALPHA, f.gl.ONE_MINUS_SRC_ALPHA, f.gl.ONE, f.gl.ONE]);
  gpu.clear(0xff010203); expect(gpu.diagnostics()).toMatchObject({clears: 1, fades: 1}); gpu.dispose();
 });
 it('compares full LUT content, including in-place edits, rather than object/hash identity', () => {
  const f = fakeGl(), gpu = new RootsNativePointCloudGpu(), c = color(), r = ring(); gpu.initialize(4, 4);
  gpu.draw(plan(), c, r); gpu.draw(plan(), c, r); expect(f.calls.filter(v => v.name === 'texSubImage2D').length).toBe(1);
  c.lut[0] ^= 1; gpu.draw(plan(), c, r); expect(f.calls.filter(v => v.name === 'texSubImage2D').length).toBe(2); gpu.dispose();
 });
 it('detects caller mutation of the borrowed ring before submission', () => {
  const f = fakeGl(), gpu = new RootsNativePointCloudGpu(), r = ring(); gpu.initialize(4, 4); let checks = 0;
  expect(error(() => gpu.draw(plan(), color(), r, {isCancelled: () => { if (++checks === 2) r.clear(); return false; }})).failureKind).toBe('input');
  expect(f.uploaded).toHaveLength(0); expect(f.live.size).toBe(0);
 });
 it('preserves Abort and callback input errors and permits clean recreation', () => {
  const f = fakeGl(), gpu = new RootsNativePointCloudGpu(); gpu.initialize(4, 4);
  expect(() => gpu.draw(plan(), color(), ring(), {isCancelled: () => true})).toThrowError(expect.objectContaining({name: 'AbortError'})); expect(f.live.size).toBe(0);
  fakeGl(); gpu.initialize(4, 4); expect(error(() => gpu.readback(() => {throw Error('caller');})).failureKind).toBe('input');
  fakeGl(); gpu.initialize(4, 4); gpu.draw(plan(), color(), ring()); expect(gpu.diagnostics().completedFrames).toBe(1); gpu.dispose();
 });
 it('rejects a silent partial ordinary readback even when the GL reports no error', () => {
  const f = fakeGl(), gpu = new RootsNativePointCloudGpu(); gpu.initialize(4, 4);
  f.gl.readPixels = (...args: unknown[]) => (args[6] as Uint8Array).fill(0, 0, 4);
  expect(error(() => gpu.readback()).failureKind).toBe('device'); expect(f.live.size).toBe(0);
 });
 it('releases failed initialization and preserves deletion failure ownership/cause', () => {
  for (const stage of ['compileShader', 'linkProgram', 'checkFramebufferStatus', 'drawArrays', 'readPixels']) {
   const f = fakeGl(), gpu = new RootsNativePointCloudGpu(); f.faults.set(stage, () => {throw Error(stage);});
   expect(error(() => gpu.initialize(4, 4)).failureKind).toBe('device'); expect(f.live.size).toBe(0);
  }
  const f = fakeGl(), gpu = new RootsNativePointCloudGpu(); f.faults.set('compileShader', () => {throw Error('compile');}); f.faults.set('deleteShader', () => {throw Error('delete');});
  const e = error(() => gpu.initialize(4, 4)); expect(e.failureKind).toBe('cleanup'); expect(messages(e)).toContain('compile'); expect(messages(e)).toContain('delete'); expect(gpu.diagnostics()).toMatchObject({handles: 1, cleanupPending: true});
  f.faults.clear(); gpu.reset(); expect(f.live.size).toBe(0);
 });
 it('joins a draw failure with cleanup failure and retains the failed buffer for retry', () => {
  const f = fakeGl(), gpu = new RootsNativePointCloudGpu(); gpu.initialize(4, 4);
  f.faults.set('drawArrays', () => {throw Error('draw failed');}); f.faults.set('deleteBuffer', () => {throw Error('delete failed');});
  const e = error(() => gpu.draw(plan(), color(), ring())); expect(e.failureKind).toBe('cleanup'); expect(messages(e)).toContain('draw failed'); expect(messages(e)).toContain('delete failed'); expect(gpu.diagnostics().handles).toBe(1);
  f.faults.clear(); gpu.dispose(); expect(f.live.size).toBe(0);
 });
 it('retains a context whose release failed, without allowing resource reuse', () => {
  const f = fakeGl(), gpu = new RootsNativePointCloudGpu(); gpu.initialize(4, 4); f.faults.set('loseContext', () => {throw Error('release');});
  expect(error(() => gpu.dispose()).failureKind).toBe('cleanup'); expect(gpu.diagnostics()).toMatchObject({handles: 0, contextOwned: true, cleanupPending: true});
  expect(error(() => gpu.initialize(4, 4)).failureKind).toBe('cleanup'); f.faults.clear(); gpu.dispose(); expect(gpu.diagnostics().contextOwned).toBe(false);
 });
});
