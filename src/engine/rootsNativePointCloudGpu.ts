import {RootsPointCloudRing} from './rootsPointCloudRing';
import type {PreparedRootsProjection} from './rootsProjection';
import type {RootsMetricColorPlan} from './rootsDensityColor';
import {ROOTS_NATIVE_POINT_CLOUD_CHUNK, ROOTS_POINT_FRAME_BINDING_BYTES, rootsPointCloudPrograms, prepareRootsPointCloudBackground, prepareRootsPointFrame, rootsPointCloudChunkPoints, prepareRootsPointChunks} from './rootsPointCloudDrawing';
import {RootsGpuError, rootsGpuRequire as require, rootsGpuCall as device, rootsGpuCancel as cancel, rootsGpuCleanup, rootsGpuFinally} from './rootsGpuFailure';

const MAX_BYTES = 768 * 1024 * 1024;
const HEADER = '#version 300 es\nprecision highp float;\nprecision highp int;\n';
const PROBE_VERTEX = HEADER + `void main(){gl_Position=vec4(0.,0.,0.,1.);gl_PointSize=16.;}`;
const PROBE_FRAGMENT = HEADER + `out vec4 pixel;void main(){vec2 p=gl_PointCoord*2.-1.;if(dot(p,p)>1.)discard;pixel=vec4(1.);}`;
/** RGBA8 target + two complete protocol-checked CPU readbacks, CPU/GPU chunk,
 * LUT copies and row flip storage. Ring/math/input and driver overhead excluded. */
export function rootsNativePointCloudGpuBytes(width: number, height: number): number {
 require([width, height].every(x => Number.isInteger(x) && x > 0 && x <= 16384), 'Native point target dimensions exceed capacity', 'capacity');
 return width * height * 12 + ROOTS_NATIVE_POINT_CLOUD_CHUNK * 32 + 3 * 1024 + ROOTS_POINT_FRAME_BINDING_BYTES + width * 4;
}
function allocation<T>(create: () => T): T { try { return create(); } catch (cause) { throw new RootsGpuError('Native point CPU allocation failed', 'capacity', {cause}); } }
type ProgramKind = 'point' | 'fill' | 'probe';
/** Owns one local RGBA8 target. Clear/fade/history are explicit caller actions;
 * this renderer never substitutes density or native-PShape after GPU failure. */
export class RootsNativePointCloudGpu {
 private gl?: WebGL2RenderingContext;
 private targetTexture?: WebGLTexture;
 private paletteTexture?: WebGLTexture;
 private framebuffer?: WebGLFramebuffer;
 private vao?: WebGLVertexArrayObject;
 private buffer?: WebGLBuffer;
 private programs = new Map<ProgramKind, WebGLProgram>();
 private shaders = new Set<WebGLShader>();
 private upload?: Float32Array<ArrayBuffer>;
 private uploadedLut?: Uint8Array;
 private width = 0; private height = 0;
 private cleanupPending = false;
 private draws = 0; private completedFrames = 0; private drawnPoints = 0;
 private readbackBytes = 0; private clears = 0; private fades = 0;
 private probe?: {nonzeroPixels: number; completeReadback: true};
 private deviceFacts?: {maxTextureSize: number; maxViewport: number[]; pointSizeRange: number[]};
 diagnostics() { return {
  width: this.width, height: this.height, draws: this.draws, completedFrames: this.completedFrames, drawnPoints: this.drawnPoints,
  readbackBytes: this.readbackBytes, clears: this.clears, fades: this.fades, probe: this.probe && {...this.probe}, cleanupPending: this.cleanupPending,
  contextOwned: !!this.gl, handles: Number(!!this.targetTexture) + Number(!!this.paletteTexture) + Number(!!this.framebuffer) + Number(!!this.vao) + Number(!!this.buffer) + this.programs.size + this.shaders.size,
  device: this.deviceFacts && {...this.deviceFacts, maxViewport: [...this.deviceFacts.maxViewport], pointSizeRange: [...this.deviceFacts.pointSizeRange]},
  retainedBytes: (this.targetTexture ? this.width * this.height * 4 : 0) + (this.paletteTexture ? 1024 : 0) + (this.upload?.byteLength ?? 0) + (this.buffer ? ROOTS_NATIVE_POINT_CLOUD_CHUNK * 16 : 0) + (this.uploadedLut?.byteLength ?? 0),
  estimatedPeakBytes: this.gl ? rootsNativePointCloudGpuBytes(this.width, this.height) : 0,
 }; }
 private run<T>(operation: () => T): T {
  require(!this.cleanupPending, 'Native point cleanup pending; reset must succeed before reuse', 'cleanup');
  try { return operation(); } catch (error) {
   try { this.reset(); } catch (cleanup) { throw new RootsGpuError('Native point operation and cleanup failed', 'cleanup', {cause: new AggregateError([error, cleanup])}); }
   throw error;
  }
 }
 private check(stage: string) { const gl = this.gl!; require(gl.getError() === gl.NO_ERROR && !gl.isContextLost(), 'Native point ' + stage + ' failed'); }
 private program(kind: ProgramKind, vertex: string, fragment: string) {
  const gl = this.gl!, p = gl.createProgram(); require(p, 'Native point program allocation failed'); this.programs.set(kind, p);
  const attached = new Set<WebGLShader>();
  rootsGpuFinally(() => {
   for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type); require(shader, 'Native point shader allocation failed'); this.shaders.add(shader);
    gl.shaderSource(shader, source); gl.compileShader(shader); require(gl.getShaderParameter(shader, gl.COMPILE_STATUS), 'Native point shader compile failed: ' + gl.getShaderInfoLog(shader));
    gl.attachShader(p, shader); attached.add(shader);
   }
   gl.linkProgram(p); require(gl.getProgramParameter(p, gl.LINK_STATUS), 'Native point shader link failed: ' + gl.getProgramInfoLog(p));
  }, () => { for (const shader of this.shaders) { if (attached.has(shader)) gl.detachShader(p, shader); gl.deleteShader(shader); this.shaders.delete(shader); } });
 }
 private target() {
  const gl = this.gl!; require(!gl.isContextLost(), 'Native point context lost');
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer!); gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
  require(gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, 'Native point framebuffer incomplete');
  gl.viewport(0, 0, this.width, this.height); gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.DITHER); gl.disable(gl.RASTERIZER_DISCARD); gl.colorMask(true, true, true, true);
 }
 private releaseDraw() { const gl = this.gl!; gl.disable(gl.BLEND); gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null); gl.useProgram(null); }
 initialize(width: number, height: number): void {
  this.run(() => {
   require(rootsNativePointCloudGpuBytes(width, height) <= MAX_BYTES, 'Native point target exceeds 768 MiB', 'capacity');
   if (this.gl) { require(width === this.width && height === this.height, 'Native point target dimensions changed', 'input'); device(() => require(!this.gl!.isContextLost(), 'Native point context lost')); return; }
   require(typeof OffscreenCanvas !== 'undefined', 'OffscreenCanvas is unavailable');
   const gl = device(() => new OffscreenCanvas(1, 1).getContext('webgl2', {alpha: true, antialias: false, depth: false, premultipliedAlpha: false})); require(gl, 'WebGL2 is unavailable');
   this.gl = gl; this.width = width; this.height = height;
   device(() => {
    this.deviceFacts = {maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE), maxViewport: Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS)), pointSizeRange: Array.from(gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE))};
    require(Math.max(width, height) <= this.deviceFacts.maxTextureSize && width <= this.deviceFacts.maxViewport[0] && height <= this.deviceFacts.maxViewport[1], 'Native point target exceeds GPU limits', 'capacity');
    require(this.deviceFacts.pointSizeRange.every(Number.isFinite) && this.deviceFacts.pointSizeRange[1] >= 1, 'Native point rasterization unsupported');
    this.targetTexture = gl.createTexture() ?? undefined; this.paletteTexture = gl.createTexture() ?? undefined;
    this.framebuffer = gl.createFramebuffer() ?? undefined; this.vao = gl.createVertexArray() ?? undefined; this.buffer = gl.createBuffer() ?? undefined;
    require(this.targetTexture && this.paletteTexture && this.framebuffer && this.vao && this.buffer, 'Native point resource allocation failed');
    const programs = rootsPointCloudPrograms('webgl2');
    this.program('point', programs.point.vertex, programs.point.fragment); this.program('fill', programs.fade.vertex, programs.fade.fragment); this.program('probe', PROBE_VERTEX, PROBE_FRAGMENT);
    for (const [texture, w, h, filter] of [[this.targetTexture, width, height, gl.NEAREST], [this.paletteTexture, 256, 1, gl.LINEAR]] as const) {
     gl.bindTexture(gl.TEXTURE_2D, texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.targetTexture, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer); gl.bufferData(gl.ARRAY_BUFFER, ROOTS_NATIVE_POINT_CLOUD_CHUNK * 16, gl.STREAM_DRAW); this.target(); this.check('allocation');
   });
   this.upload = allocation(() => new Float32Array(ROOTS_NATIVE_POINT_CLOUD_CHUNK * 4));
   this.probePoints();
  });
 }
 /** Two different sentinels make silent RGBA8 short reads detectable without
  * reserving a pixel value that legitimate color output could equal. */
 private readComplete(width: number, height: number, isCancelled?: () => boolean): Uint8Array {
  const gl = this.gl!, length = width * height * 4;
  const a = allocation(() => new Uint8Array(length)), b = allocation(() => new Uint8Array(length)); a.fill(0xa5); b.fill(0x5a);
  device(() => { gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.pixelStorei(gl.PACK_ALIGNMENT, 1); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, a); this.check('readback'); });
  cancel(isCancelled);
  device(() => { gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, b); this.check('readback verification'); });
  this.readbackBytes += length * 2;
  for (let i = 0; i < length; i++) { if ((i & 65535) === 0) cancel(isCancelled); require(a[i] === b[i], 'Native point readback is incomplete or unstable'); }
  return a;
 }
 private probePoints() {
  const gl = this.gl!, w = Math.min(8, this.width), h = Math.min(8, this.height);
  rootsGpuFinally(() => {
   device(() => { this.target(); gl.disable(gl.BLEND); gl.clearBufferfv(gl.COLOR, 0, new Float32Array(4)); gl.viewport(0, 0, w, h); gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, w, h); gl.bindVertexArray(this.vao!); gl.useProgram(this.programs.get('probe')!); gl.drawArrays(gl.POINTS, 0, 1); this.check('point capability probe'); });
   const data = this.readComplete(w, h); let nonzeroPixels = 0;
   for (let i = 0; i < data.length; i += 4) { require((data[i] === 0 || data[i] === 255) && data[i + 1] === data[i] && data[i + 2] === data[i] && data[i + 3] === data[i], 'Native point capability probe has invalid pixels'); if (data[i]) nonzeroPixels++; }
   require(nonzeroPixels > 0, 'Native point rasterization probe produced no pixels; native shape fallback is unavailable'); this.probe = {nonzeroPixels, completeReadback: true};
  }, () => { this.target(); this.releaseDraw(); gl.clearBufferfv(gl.COLOR, 0, new Float32Array(4)); this.check('probe cleanup'); });
 }
 clear(backgroundPacked: number): void {
  this.run(() => { require(this.gl, 'Native point target is not initialized', 'input'); const color = prepareRootsPointCloudBackground(backgroundPacked); device(() => { this.target(); this.gl!.clearBufferfv(this.gl!.COLOR, 0, Float32Array.from(color)); this.check('clear'); }); this.clears++; });
 }
 fade(backgroundPacked: number, alpha255: number): void {
  this.run(() => { require(this.gl, 'Native point target is not initialized', 'input'); const color = prepareRootsPointCloudBackground(backgroundPacked, alpha255), gl = this.gl;
   rootsGpuFinally(() => device(() => { this.target(); gl.bindVertexArray(this.vao!); const p = this.programs.get('fill')!; gl.useProgram(p); gl.uniform4fv(gl.getUniformLocation(p, 'fillColor'), color); gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE); gl.drawArrays(gl.TRIANGLES, 0, 3); this.check('fade'); }), () => this.releaseDraw()); this.fades++;
  });
 }
 draw(plan: PreparedRootsProjection, color: RootsMetricColorPlan, ring: RootsPointCloudRing, options: {isCancelled?: () => boolean} = {}): void {
  this.run(() => {
   const isCancelled = options.isCancelled; cancel(isCancelled);
   require(this.gl && this.upload, 'Native point target is not initialized', 'input');
   const frame = prepareRootsPointFrame(plan, color, false);
   require(plan.physicalWidth === this.width && plan.physicalHeight === this.height, 'Native point projection mode/dimensions do not match target', 'input');
   const batch = rootsPointCloudChunkPoints(this.width, this.height, plan.pointCloudUniformSize, this.deviceFacts!.pointSizeRange);
   const chunks = prepareRootsPointChunks(ring, batch, {...options, destination: this.upload});
   const gl = this.gl, program = this.programs.get('point')!;
   device(() => {
    this.target(); gl.bindVertexArray(this.vao!); gl.useProgram(program); gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (const u of frame.uniforms) {
     const loc = gl.getUniformLocation(program, u.name);
     switch (u.kind) {
      case 'mat4': gl.uniformMatrix4fv(loc, false, u.values as Float32Array<ArrayBuffer>); break;
      case 'float': gl.uniform1f(loc, u.values[0]); break;
      case 'vec3': gl.uniform3fv(loc, u.values as Float32Array<ArrayBuffer>); break;
      case 'sampler2d': gl.activeTexture(gl.TEXTURE0 + u.texture); gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture!); gl.uniform1i(loc, u.texture); break;
      default: throw new RootsGpuError('Unsupported prepared point uniform: ' + u.kind, 'input');
     }
    }
    if (!this.uploadedLut || !this.uploadedLut.every((v, i) => v === frame.palette[i])) { gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, frame.palette); this.uploadedLut = frame.palette; }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer!); gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1); gl.vertexAttribDivisor(0, 0); gl.vertexAttribDivisor(1, 0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12); this.check('uniform/upload');
   });
   rootsGpuFinally(() => {
    const iterator = chunks[Symbol.iterator]();
    for (;;) {
     const step = iterator.next(); if (step.done) break; const chunk = step.value;
     device(() => { gl.bufferSubData(gl.ARRAY_BUFFER, 0, chunk.points); gl.drawArrays(gl.POINTS, 0, chunk.pointCount); this.check('draw'); }); this.draws++;
    }
    chunks.assertCurrent();
   }, () => this.releaseDraw());
   this.completedFrames++; this.drawnPoints = chunks.pointCount;
  });
 }
 readback(isCancelled?: () => boolean): Uint8ClampedArray {
  return this.run(() => { cancel(isCancelled); require(this.gl, 'Native point target is not initialized', 'input'); device(() => this.target()); const data = this.readComplete(this.width, this.height, isCancelled), row = allocation(() => new Uint8Array(this.width * 4));
   for (let y = 0; y < Math.floor(this.height / 2); y++) { cancel(isCancelled); const a = y * row.length, b = (this.height - y - 1) * row.length; row.set(data.subarray(a, a + row.length)); data.copyWithin(a, b, b + row.length); data.set(row, b); }
   cancel(isCancelled); return new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
  });
 }
 reset(): void {
  const gl = this.gl, errors: unknown[] = [], attempt = (f: () => void) => { try { f(); } catch (e) { errors.push(e); } };
  if (gl) {
   for (const [key, remove] of [['targetTexture', 'deleteTexture'], ['paletteTexture', 'deleteTexture'], ['framebuffer', 'deleteFramebuffer'], ['vao', 'deleteVertexArray'], ['buffer', 'deleteBuffer']] as const) if (this[key]) attempt(() => { (gl[remove] as (v: unknown) => void).call(gl, this[key]); this[key] = undefined; });
   for (const [kind, p] of this.programs) attempt(() => { if (gl.getParameter(gl.CURRENT_PROGRAM) === p) gl.useProgram(null); gl.deleteProgram(p); this.programs.delete(kind); });
   for (const s of this.shaders) attempt(() => { gl.deleteShader(s); this.shaders.delete(s); });
  }
  this.cleanupPending = errors.length > 0;
  if (errors.length) throw new RootsGpuError('Native point cleanup failed; ownership retained', 'cleanup', {cause: new AggregateError(errors)});
  if (gl) { try { rootsGpuCleanup(() => { if (!gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext(); }); } catch (error) { this.cleanupPending = true; throw error; } }
  this.gl = undefined; this.upload = undefined; this.uploadedLut = undefined; this.width = this.height = 0;
  this.draws = this.completedFrames = this.drawnPoints = this.readbackBytes = this.clears = this.fades = 0; this.probe = undefined; this.deviceFacts = undefined;
 }
 dispose(): void { this.reset(); }
}
