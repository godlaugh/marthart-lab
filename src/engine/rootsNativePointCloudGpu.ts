import {RootsPointCloudRing, ROOTS_POINT_CLOUD_RECENT_WINDOW} from './rootsPointCloudRing';
import {validatePreparedRootsProjection, type PreparedRootsProjection} from './rootsProjection';
import {prepareRootsMetricValue, validateRootsMetricColorPlan, type RootsMetricColorPlan} from './rootsDensityColor';
import {RootsGpuError, rootsGpuRequire as require, rootsGpuCall as device, rootsGpuInput, rootsGpuCancel as cancel, rootsGpuCleanup, rootsGpuFinally} from './rootsGpuFailure';

export const ROOTS_NATIVE_POINT_CLOUD_CHUNK = 65_536;
const MAX_BYTES = 768 * 1024 * 1024;
const HEADER = '#version 300 es\nprecision highp float;\nprecision highp int;\n';
// Retained complex_roots_point_cloud shaders. Only ES precision/version and
// attribute declarations differ; the transform/tone/alpha bodies are verbatim.
const POINT_VERTEX = HEADER + `uniform mat4 projection;
uniform mat4 modelview;
uniform float pointSize;
uniform float rotationDegrees;
uniform vec3 scaleVec;
uniform vec3 offsetVec;

layout(location=0) in vec3 rootPosition;
layout(location=1) in float pointMetric;

out float vertMetric;

void main() {
    float angle = radians(rotationDegrees);
    float c = cos(angle);
    float s = sin(angle);
    vec2 rotated = vec2(
        rootPosition.x * c - rootPosition.y * s,
        rootPosition.x * s + rootPosition.y * c
    );
    vec3 positionWorld = vec3(
        rotated.x * scaleVec.x + offsetVec.x,
        rotated.y * scaleVec.y + offsetVec.y,
        rootPosition.z * scaleVec.z + offsetVec.z
    );
    vec4 viewPos = modelview * vec4(positionWorld, 1.0);
    gl_Position = projection * viewPos;
    gl_PointSize = max(pointSize, 0.001);
    vertMetric = pointMetric;
}`;
const POINT_FRAGMENT = HEADER + `uniform float brightness;
uniform float contrast;
uniform float gamma;
uniform float dynamicRange;
uniform float pointSize;
uniform float saturation;
uniform float paletteOffset;
uniform vec3 backgroundRgb;
uniform sampler2D paletteTex;

in float vertMetric;

out vec4 fragColor;

vec3 adjustSaturation(vec3 rgb, float amount) {
    float luma = dot(rgb, vec3(0.299, 0.587, 0.114));
    return mix(vec3(luma), rgb, amount);
}

float smoothLimit(float x, float k) {
    x = 2.0 * x - 1.0;
    float a = pow(abs(x), 1.0 / max(k, 0.01));
    return sign(x) * pow(a / (a + 1.0), max(k, 0.01)) * 0.5 + 0.5;
}

void main() {
    vec2 localCoord = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(localCoord, localCoord);
    if (r2 > 1.0) {
        discard;
    }

    float edgeAlpha = 1.0 - smoothstep(0.75, 1.0, r2);
    float exposure = clamp(pow(2.0, brightness * 2.0), 0.15, 8.0);
    float value = smoothLimit(contrast * edgeAlpha * exposure + brightness, dynamicRange);
    vec3 vertColor = texture(paletteTex, vec2(fract(vertMetric + paletteOffset), 0.5)).rgb;
    vec3 rgb = mix(backgroundRgb, vertColor, clamp(value, 0.0, 1.0));
    rgb = pow(clamp(rgb, 0.0, 1.0), vec3(1.0 / max(gamma, 0.001)));
    rgb = adjustSaturation(rgb, saturation);
    float subpixelAlphaScale = clamp(pointSize / 0.125, 0.02, 1.0);
    fragColor = vec4(rgb, clamp(edgeAlpha * 0.38 * subpixelAlphaScale * exposure, 0.0, 0.85));
}`;
const FULLSCREEN = HEADER + `void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;
const FILL_FRAGMENT = HEADER + `uniform vec4 fillColor;out vec4 pixel;void main(){pixel=fillColor;}`;
const PROBE_VERTEX = HEADER + `void main(){gl_Position=vec4(0.,0.,0.,1.);gl_PointSize=16.;}`;
const PROBE_FRAGMENT = HEADER + `out vec4 pixel;void main(){vec2 p=gl_PointCoord*2.-1.;if(dot(p,p)>1.)discard;pixel=vec4(1.);}`;
const F = Math.fround;
/** Source PGraphics RGB/default255 colorCalc(int[,alpha]), followed by the
 * packed fillColor byte path. An alpha-zero int <=255 is a grayscale input.
 * Shader backgroundRGB intentionally has different semantics. */
export function prepareRootsPointCloudBackground(packed: number, alpha255?: number): readonly [number, number, number, number] {
 require(Number.isInteger(packed) && packed >= 0 && packed <= 0xffffffff, 'Native point background requires packed ARGB', 'input');
 require(alpha255 === undefined || Number.isFinite(alpha255) && Number.isFinite(F(alpha255)), 'Native point fade alpha is invalid', 'input');
 const gray = packed <= 255, alpha = gray ? 255 : packed >>> 24;
 const factor = alpha255 === undefined ? 1 : F(Math.min(255, Math.max(0, F(alpha255))) / 255);
 const a = alpha255 === undefined ? alpha : Math.trunc(F(alpha * factor));
 const r = gray ? packed : (packed >>> 16) & 255, g = gray ? packed : (packed >>> 8) & 255, b = gray ? packed : packed & 255;
 return [F(r / 255), F(g / 255), F(b / 255), F(a / 255)];
}
/** RGBA8 target + two complete protocol-checked CPU readbacks, CPU/GPU chunk,
 * LUT copies and row flip storage. Ring/math/input and driver overhead excluded. */
export function rootsNativePointCloudGpuBytes(width: number, height: number): number {
 require([width, height].every(x => Number.isInteger(x) && x > 0 && x <= 16384), 'Native point target dimensions exceed capacity', 'capacity');
 return width * height * 12 + ROOTS_NATIVE_POINT_CLOUD_CHUNK * 32 + 3 * 1024 + width * 4;
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
 private upload?: Float32Array;
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
    this.program('point', POINT_VERTEX, POINT_FRAGMENT); this.program('fill', FULLSCREEN, FILL_FRAGMENT); this.program('probe', PROBE_VERTEX, PROBE_FRAGMENT);
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
   rootsGpuInput(() => { validatePreparedRootsProjection(plan); validateRootsMetricColorPlan(color); });
   require(plan.mode === 'point-cloud' && plan.physicalWidth === this.width && plan.physicalHeight === this.height, 'Native point projection mode/dimensions do not match target', 'input');
   require(ring instanceof RootsPointCloudRing, 'Native point requires the owned arrival ring', 'input');
   const window = rootsGpuInput(() => ring.recentWindow());
   require(window.pointCount <= ROOTS_POINT_CLOUD_RECENT_WINDOW, 'Native point recent window exceeds 3M capacity', 'capacity');
   const fresh = () => require(ring.isCurrentWindow(window), 'Native point borrowed window changed during draw', 'input');
   const gl = this.gl, program = this.programs.get('point')!;
   device(() => {
    this.target(); gl.bindVertexArray(this.vao!); gl.useProgram(program); gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const location = (name: string) => gl.getUniformLocation(program, name);
    gl.uniformMatrix4fv(location('projection'), false, plan.projection.columnMajor); gl.uniformMatrix4fv(location('modelview'), false, plan.modelView.columnMajor);
    gl.uniform1f(location('pointSize'), plan.pointCloudUniformSize); gl.uniform1f(location('rotationDegrees'), plan.transform.rotationDegrees); gl.uniform3fv(location('scaleVec'), plan.transform.scale); gl.uniform3fv(location('offsetVec'), plan.transform.offset);
    for (const name of ['brightness', 'contrast', 'gamma', 'dynamicRange', 'saturation', 'paletteOffset'] as const) gl.uniform1f(location(name), color[name]);
    gl.uniform3fv(location('backgroundRgb'), color.backgroundRGB); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture!); gl.uniform1i(location('paletteTex'), 0);
    if (!this.uploadedLut || !this.uploadedLut.every((v, i) => v === color.lut[i])) { gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, color.lut); this.uploadedLut = allocation(() => color.lut.slice()); }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer!); gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1); gl.vertexAttribDivisor(0, 0); gl.vertexAttribDivisor(1, 0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12); this.check('uniform/upload');
   });
   const diameter = Math.max(1, Math.min(plan.pointCloudUniformSize, this.deviceFacts!.pointSizeRange[1]));
   const footprint = Math.min(this.width, Math.ceil(diameter) + 2) * Math.min(this.height, Math.ceil(diameter) + 2);
   const batch = Math.max(1, Math.min(ROOTS_NATIVE_POINT_CLOUD_CHUNK, Math.floor(8_000_000 / Math.max(1, footprint))));
   rootsGpuFinally(() => {
    for (const range of window.ranges) for (let at = 0; at < range.pointCount; at += batch) {
     cancel(isCancelled); fresh(); const count = Math.min(batch, range.pointCount - at);
     this.upload!.set(range.values.subarray(at * 4, (at + count) * 4), 0);
     for (let i = 0; i < count; i++) { if ((i & 1023) === 0) { cancel(isCancelled); fresh(); } this.upload![i * 4 + 3] = rootsGpuInput(() => prepareRootsMetricValue(this.upload![i * 4 + 3])).clamped; }
     device(() => { gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.upload!.subarray(0, count * 4)); gl.drawArrays(gl.POINTS, 0, count); this.check('draw'); }); this.draws++;
    }
    cancel(isCancelled); fresh();
   }, () => this.releaseDraw());
   this.completedFrames++; this.drawnPoints = window.pointCount;
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
