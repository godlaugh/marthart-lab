import {prepareRootsInkView} from './rootsNativeInk';
import {rootsDensityScale,validateRootsMetricColorPlan,normalizeRootsSourceToneField,ROOTS_SOURCE_TONE_FIELDS,type RootsMetricColorPlan} from './rootsDensityColor';
import type {PreparedRootsProjection} from './rootsProjection';
import {validatePreparedRootsProjection} from './rootsProjection';
import {RootsGpuError, rootsGpuRequire as require, rootsGpuCall as device, rootsGpuCancel as cancel, rootsGpuInput, rootsGpuCleanup, rootsGpuFinally} from './rootsGpuFailure';

export type RootsNativeDensityKernel = 'auto' | 'points' | 'quad';
export const ROOTS_NATIVE_DENSITY_CHUNK = 65536;
const MAX_BYTES = 768 * 1024 * 1024;
const HEADER = '#version 300 es\nprecision highp float;\nprecision highp int;\n';
// MathArt 1.7.8 complex_roots_splat{,_quad}.{vert,frag}. Bodies and
// arithmetic order are retained; only ES declarations and attribute locations
// differ. The geometry is projected world space, never local axis-bound bins.
const POINT_VERTEX = HEADER + `
uniform mat4 projection;
uniform mat4 modelview;
uniform float pointSize;
layout(location=0) in vec3 positionWorld;
layout(location=1) in float splatMetric;
out float vertMetric;
void main() {
    vec4 viewPos = modelview * vec4(positionWorld, 1.0);
    gl_Position = projection * viewPos;
    gl_PointSize = max(pointSize, 1.0);
    vertMetric = splatMetric;
}`;
const POINT_FRAGMENT = HEADER + `
in float vertMetric;
out vec4 fragColor;
void main() {
    vec2 localCoord = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(localCoord, localCoord);
    if (r2 > 1.0) {
        discard;
    }
    float edgeAlpha = 1.0 - smoothstep(0.70, 1.0, r2);
    fragColor = vec4(edgeAlpha, vertMetric * edgeAlpha, 0.0, 0.0);
}`;
const QUAD_VERTEX = HEADER + `
uniform mat4 projection;
uniform mat4 modelview;
uniform float pointSize;
uniform vec2 viewportSize;
layout(location=0) in vec3 positionWorld;
layout(location=1) in float splatMetric;
out vec2 localCoord;
out float pointDiameter;
out float vertMetric;
const vec2 CORNERS[6] = vec2[](
    vec2(-1.0, -1.0),
    vec2( 1.0, -1.0),
    vec2(-1.0,  1.0),
    vec2(-1.0,  1.0),
    vec2( 1.0, -1.0),
    vec2( 1.0,  1.0)
);
void main() {
    vec4 viewPos = modelview * vec4(positionWorld, 1.0);
    vec4 centerClip = projection * viewPos;
    vec2 local = CORNERS[gl_VertexID];
    float diameter = max(pointSize * 0.6, 0.8);
    vec2 pixelToNdc = vec2(2.0 / max(viewportSize.x, 1.0), 2.0 / max(viewportSize.y, 1.0));
    vec2 clipOffset = local * diameter * 0.5 * pixelToNdc * centerClip.w;
    gl_Position = centerClip + vec4(clipOffset, 0.0, 0.0);
    localCoord = local;
    pointDiameter = diameter;
    vertMetric = splatMetric;
}`;
const QUAD_FRAGMENT = HEADER + `
in vec2 localCoord;
in float pointDiameter;
in float vertMetric;
out vec4 fragColor;
void main() {
    float r2 = dot(localCoord, localCoord);
    if (r2 > 1.35) {
        discard;
    }
    float halfPointSize = max(pointDiameter * 0.5, 0.4);
    float distanceToEdgePx = (sqrt(r2) - 1.0) * halfPointSize;
    float coverageAlpha = 1.0 - smoothstep(-0.75, 0.75, distanceToEdgePx);
    float coreAlpha = exp(-0.45 * r2);
    float edgeAlpha = coverageAlpha * coreAlpha;
    fragColor = vec4(edgeAlpha, vertMetric * edgeAlpha, 0.0, 0.0);
}`;
// Retained MathArt 1.7.8 quad.vert and complex_roots_present.frag. Keep
// normalized UV sampling and shader arithmetic together: CPU tone and texelFetch
// rewrites do not preserve native palette seam rounding. Only ES declarations differ.
const PRESENT_VERTEX = HEADER + `out vec2 texCoord;

void main() {
  float x = float((gl_VertexID & 1) << 1) - 1.0;
  float y = float((gl_VertexID & 2)) - 1.0;
  gl_Position = vec4(x, y, 0.0, 1.0);
  texCoord = vec2((x + 1.0) * 0.5, (y + 1.0) * 0.5);
}`;
const PRESENT_FRAGMENT = HEADER + `uniform sampler2D accumTex;
uniform sampler2D paletteTex;
uniform float paletteOffset;
uniform float brightness;
uniform float contrast;
uniform float gamma;
uniform float dynamicRange;
uniform float saturation;
uniform float scale;
uniform float displayRotation;
uniform float viewportAspect;
uniform vec3 backgroundRgb;

in vec2 texCoord;

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
    vec2 centered = texCoord - vec2(0.5);
    centered.x *= viewportAspect;
    float c = cos(-displayRotation);
    float s = sin(-displayRotation);
    vec2 rotated = vec2(
        centered.x * c - centered.y * s,
        centered.x * s + centered.y * c
    );
    rotated.x /= viewportAspect;
    rotated += vec2(0.5);
    if (rotated.x < 0.0 || rotated.x > 1.0 || rotated.y < 0.0 || rotated.y > 1.0) {
        fragColor = vec4(backgroundRgb, 1.0);
        return;
    }
    vec4 accum = texture(accumTex, rotated);
    float count = max(accum.r, 0.0);
    if (count <= 1.0e-12) {
        fragColor = vec4(backgroundRgb, 1.0);
        return;
    }

    float avgT = accum.g / count;
    vec3 avgRgb = texture(paletteTex, vec2(fract(avgT + paletteOffset), 0.5)).rgb;
    float density = count / max(scale, 1.0e-8);
    float v = density == 0.0
        ? -20.0
        : (log(density) - log(1.0)) / (log(1000.0) - log(1.0));
    float value = smoothLimit(contrast * v + brightness, dynamicRange);
    float densityBrightness = clamp(value, 0.0, 1.0);

    vec3 rgb = mix(backgroundRgb, avgRgb, densityBrightness);
    rgb = pow(clamp(rgb, 0.0, 1.0), vec3(1.0 / max(gamma, 0.001)));
    rgb = adjustSaturation(rgb, saturation);
    fragColor = vec4(rgb, 1.0);
}`;

/** MathArt 1.7.8 loads its debug point shader but never binds/initializes it
 * before probePointSplatSupport reads glProgram=0. The original probe therefore
 * selects quad, even on hardware supporting points. Preserve that source route
 * without issuing invalid GL calls or repairing the source probe. Explicit
 * points/quad remain diagnostic overrides. See the native reference report. */
export const ROOTS_NATIVE_AUTO_KERNEL = 'quad' as const;

/** Peak includes RGBA32F ink + readback, CPU/GPU
 * interleaved chunks and one readback flip row. It excludes driver overhead. */
export function rootsNativeDensityGpuBytes(width: number, height: number): number {
  require([width, height].every(n => Number.isInteger(n) && n > 0 && n <= 16384), 'Native root dimensions exceed the image budget', 'capacity');
  return width * height * 32 + ROOTS_NATIVE_DENSITY_CHUNK * 32 + width * 16;
}
/** Additional color attachment, retained LUT and output/readback row. */
export function rootsNativeToneGpuBytes(width:number,height:number):number {
  rootsNativeDensityGpuBytes(width,height);
  return width*height*8+width*4+2048;
}
function pixels8(length:number):Uint8ClampedArray {
  try{return new Uint8ClampedArray(length);}catch(cause){throw new RootsGpuError('Native root color buffer allocation failed','capacity',{cause});}
}
function floats(length: number): Float32Array {
  try { return new Float32Array(length); }
  catch (cause) { throw new RootsGpuError('Native root CPU buffer allocation failed', 'capacity', {cause}); }
}

type ProgramKind = 'points' | 'quad' | 'present';
/** Owns only source projected metric accumulation. It does not solve roots,
 * transform raw roots, tone colors, choose source camera anchors or replay a
 * failed request. A failed/partly drawn flush invalidates the entire owner. */
export class RootsNativeDensityGpu {
  private gl?: WebGL2RenderingContext;
  private ink?: WebGLTexture;
  private colorTexture?: WebGLTexture;
  private paletteTexture?: WebGLTexture;
  private uploadedPalette?: Uint8Array;
  private framebuffer?: WebGLFramebuffer;
  private buffer?: WebGLBuffer;
  private vao?: WebGLVertexArrayObject;
  private programs = new Map<ProgramKind, WebGLProgram>();
  private shaders = new Set<WebGLShader>();
  private upload?: Float32Array;
  private width = 0;
  private height = 0;
  private pending = 0;
  private queued = 0;
  private submitted = 0;
  private cleanupPending = false;
  private lastKernel?: 'points' | 'quad';
  private draws = 0;
  private readbackBytes = 0;
  private deviceFacts?: {maxTextureSize: number; maxViewport: number[]; pointSizeRange: number[]};

  diagnostics() {
    return {
      width: this.width, height: this.height, inkKind: 'metric-sum' as const,
      queuedFinitePoints: this.queued, pendingPoints: this.pending, submittedPoints: this.submitted,
      stagingCapacity: ROOTS_NATIVE_DENSITY_CHUNK, lastKernel: this.lastKernel,
      autoKernel: ROOTS_NATIVE_AUTO_KERNEL,
      autoKernelReason: 'mathart-1.7.8-uninitialized-probe' as const,
      device: this.deviceFacts ? {...this.deviceFacts, maxViewport: [...this.deviceFacts.maxViewport], pointSizeRange: [...this.deviceFacts.pointSizeRange]} : undefined,
      draws: this.draws, readbackBytes: this.readbackBytes, cleanupPending: this.cleanupPending,
      contextOwned: !!this.gl,
      handles: Number(!!this.ink) + Number(!!this.colorTexture) + Number(!!this.paletteTexture) + Number(!!this.framebuffer) + Number(!!this.buffer) + Number(!!this.vao) + this.programs.size + this.shaders.size,
      retainedBytes: (this.colorTexture ? this.width * this.height * 4 : 0) + (this.paletteTexture ? 1024 : 0) + (this.uploadedPalette?.byteLength ?? 0) + (this.ink ? this.width * this.height * 16 : 0) + (this.buffer ? ROOTS_NATIVE_DENSITY_CHUNK * 16 : 0) + (this.upload?.byteLength ?? 0),
      estimatedPeakBytes: this.gl ? rootsNativeDensityGpuBytes(this.width, this.height) + rootsNativeToneGpuBytes(this.width, this.height) : 0,
    };
  }

  private run<T>(operation: () => T): T {
    require(!this.cleanupPending, 'Native root cleanup is pending; reset must complete before reuse', 'cleanup');
    try { return operation(); }
    catch (error) {
      try { this.reset(); }
      catch (cleanup) { throw new RootsGpuError('Native root operation and cleanup failed', 'cleanup', {cause: new AggregateError([error, cleanup])}); }
      // All GL operations are wrapped narrowly below. Do not turn input,
      // caller cancellation or prepared-owner errors into device failures.
      throw error;
    }
  }

  initialize(width: number, height: number): void {
    this.run(() => {
      require(rootsNativeDensityGpuBytes(width, height) <= MAX_BYTES, 'Native root buffers exceed 768 MiB', 'capacity');
      if (this.gl) {
        require(width === this.width && height === this.height, 'Native root dimensions differ from retained state', 'input');
        device(() => require(!this.gl!.isContextLost(), 'Native root context was lost'));
        return;
      }
      require(typeof OffscreenCanvas !== 'undefined', 'OffscreenCanvas is unavailable');
      const gl = device(() => new OffscreenCanvas(1, 1).getContext('webgl2', {alpha: false, antialias: false, depth: false}));
      require(gl, 'WebGL2 is unavailable');
      this.gl = gl; this.width = width; this.height = height;
      device(() => {
        require(gl.getExtension('EXT_color_buffer_float'), 'Native root density requires EXT_color_buffer_float');
        require(gl.getExtension('EXT_float_blend'), 'Native root density requires EXT_float_blend');
        this.deviceFacts = {maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE), maxViewport: Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS)), pointSizeRange: Array.from(gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE))};
        require(Math.max(width, height) <= this.deviceFacts.maxTextureSize && width <= this.deviceFacts.maxViewport[0] && height <= this.deviceFacts.maxViewport[1], 'Native root dimensions exceed GPU limits', 'capacity');
        this.ink = gl.createTexture() ?? undefined;
        this.framebuffer = gl.createFramebuffer() ?? undefined;
        this.buffer = gl.createBuffer() ?? undefined;
        this.vao = gl.createVertexArray() ?? undefined;
        require(this.ink && this.framebuffer && this.buffer && this.vao, 'Native root resource allocation failed');
        this.compile('points', POINT_VERTEX, POINT_FRAGMENT);
        this.compile('quad', QUAD_VERTEX, QUAD_FRAGMENT);
        gl.bindTexture(gl.TEXTURE_2D, this.ink);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, ROOTS_NATIVE_DENSITY_CHUNK * 16, gl.STREAM_DRAW);
        this.target(); this.clearInk(); this.check('allocation');
      });
      this.upload = floats(ROOTS_NATIVE_DENSITY_CHUNK * 4);
    });
  }

  private compile(kind: ProgramKind, vertex: string, fragment: string): void {
    const gl = this.gl!, program = gl.createProgram();
    require(program, 'Native root program allocation failed');
    this.programs.set(kind, program); // Owner before any operation can fail.
    const attached = new Set<WebGLShader>();
    rootsGpuFinally(() => {
      for (const [type, text] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
        const shader = gl.createShader(type);
        require(shader, 'Native root shader allocation failed');
        this.shaders.add(shader);
        gl.shaderSource(shader, text); gl.compileShader(shader);
        require(gl.getShaderParameter(shader, gl.COMPILE_STATUS), 'Native root shader compilation failed: ' + gl.getShaderInfoLog(shader));
        gl.attachShader(program, shader); attached.add(shader);
      }
      gl.linkProgram(program);
      require(gl.getProgramParameter(program, gl.LINK_STATUS), 'Native root shader linking failed: ' + gl.getProgramInfoLog(program));
    }, () => {
      for (const shader of this.shaders) {
        if (attached.has(shader)) gl.detachShader(program, shader);
        gl.deleteShader(shader); this.shaders.delete(shader);
      }
    });
  }

  private target(): void {
    const gl = this.gl!;
    require(!gl.isContextLost(), 'Native root context was lost');
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer!);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.ink!, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    require(gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, 'Native root float framebuffer is incomplete');
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.CULL_FACE); gl.disable(gl.DITHER); gl.disable(gl.RASTERIZER_DISCARD);
    gl.colorMask(true, true, true, true);
  }
  private clearInk(): void { this.gl!.clearBufferfv(this.gl!.COLOR, 0, new Float32Array(4)); }
  private check(stage: string): void {
    const gl = this.gl!;
    require(gl.getError() === gl.NO_ERROR && !gl.isContextLost(), `Native root ${stage} failed`);
  }
  private blend(): void { const gl = this.gl!; gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE); }
  private releaseDrawState(): void { const gl = this.gl!; gl.disable(gl.BLEND); gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null); gl.useProgram(null); }

  /** Up to one bounded chunk. Caller flushes before the next add when full. */
  add(worldXYZ: readonly number[], metric: number): void {
    this.run(() => {
      require(this.upload, 'Native root density is not initialized', 'input');
      require(worldXYZ.length === 3 && [...worldXYZ, metric].every(n => Number.isFinite(n) && Number.isFinite(Math.fround(n))) && metric >= 0 && metric <= 1, 'Native root point requires finite F32 world XYZ and clamped metric', 'input');
      require(this.pending < ROOTS_NATIVE_DENSITY_CHUNK, 'Native root staging is full; flush before adding more points', 'capacity');
      require(Number.isSafeInteger(this.queued + 1), 'Native root queued point count exceeds safe integer', 'capacity');
      this.upload.set([worldXYZ[0], worldXYZ[1], worldXYZ[2], metric], this.pending * 4);
      this.pending++; this.queued++;
    });
  }

  flush(projection: PreparedRootsProjection, kernel: RootsNativeDensityKernel = 'auto', isCancelled?: () => boolean): void {
    this.run(() => {
      cancel(isCancelled);
      require(this.gl && this.upload, 'Native root density is not initialized', 'input');
      rootsGpuInput(() => validatePreparedRootsProjection(projection));
      require(projection.mode === 'density', 'Native metric density cannot consume a point-cloud presentation plan', 'input');
      require(projection.physicalWidth === this.width && projection.physicalHeight === this.height, 'Native root projection dimensions do not match ink', 'input');
      require(kernel === 'auto' || kernel === 'points' || kernel === 'quad', 'Native root kernel is invalid', 'input');
      if (!this.pending) return;
      const selected = kernel === 'auto' ? ROOTS_NATIVE_AUTO_KERNEL : kernel;
      const gl = this.gl, program = this.programs.get(selected)!;
      require(Number.isSafeInteger(this.submitted + this.pending), 'Native root submitted count exceeds safe integer', 'capacity');
      device(() => {
        this.target(); this.blend(); gl.useProgram(program); gl.bindVertexArray(this.vao!);
        gl.uniformMatrix4fv(gl.getUniformLocation(program, 'projection'), false, projection.projection.columnMajor);
        gl.uniformMatrix4fv(gl.getUniformLocation(program, 'modelview'), false, projection.modelView.columnMajor);
        gl.uniform1f(gl.getUniformLocation(program, 'pointSize'), projection.densityDiameter);
        gl.uniform2f(gl.getUniformLocation(program, 'viewportSize'), this.width, this.height);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer!);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.upload!.subarray(0, this.pending * 4));
        gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1);
        gl.vertexAttribDivisor(0, selected === 'quad' ? 1 : 0);
        gl.vertexAttribDivisor(1, selected === 'quad' ? 1 : 0);
      });
      // Bound work between cancellation checks by estimated screen footprint.
      // A single point may cover the target; this is not mid-draw interruption.
      const diameter = selected === 'points' ? projection.pointsDiameter : projection.quadDiameter;
      const footprint = Math.min(this.width, Math.ceil(diameter) + 2) * Math.min(this.height, Math.ceil(diameter) + 2);
      const perDraw = Math.max(1, Math.min(ROOTS_NATIVE_DENSITY_CHUNK, Math.floor(8_000_000 / Math.max(1, footprint))));
      rootsGpuFinally(() => {
        for (let at = 0; at < this.pending; at += perDraw) {
          cancel(isCancelled);
          device(() => {
            gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, at * 16);
            gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, at * 16 + 12);
            const count = Math.min(perDraw, this.pending - at);
            if (selected === 'quad') gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
            else gl.drawArrays(gl.POINTS, 0, count);
            this.check('accumulation'); this.draws++;
          });
        }
        cancel(isCancelled);
      }, () => this.releaseDrawState());
      this.submitted += this.pending; this.pending = 0; this.lastKernel = selected;
    });
  }

  clear(): void {
    this.run(() => {
      require(this.gl && this.ink, 'Native root density is not initialized', 'input');
      device(() => { this.target(); this.clearInk(); this.check('clear'); });
      this.pending = this.queued = this.submitted = 0;
      this.lastKernel = undefined;
    });
  }

  readback(isCancelled?: () => boolean): Float32Array {
    return this.run(() => {
      cancel(isCancelled);
      require(this.gl && this.ink && this.pending === 0, 'Native root readback requires initialized ink with no queued points', 'input');
      const gl = this.gl, rgba = floats(this.width * this.height * 4), row = floats(this.width * 4);
      rgba.fill(NaN);
      device(() => {
        this.target(); gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
        gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.FLOAT, rgba);
        this.check('readback');
      });
      this.readbackBytes += rgba.byteLength;
      for (let i = 0; i < rgba.length; i += 4) {
        if ((i & 65535) === 0) cancel(isCancelled);
        require(Number.isFinite(rgba[i]) && Number.isFinite(rgba[i + 1]) && rgba[i] >= 0 && rgba[i + 1] >= 0 && rgba[i + 1] <= rgba[i] && rgba[i + 2] === 0 && rgba[i + 3] === 0, 'Native root readback violates metric ink contract');
      }
      for (let y = 0; y < Math.floor(this.height / 2); y++) {
        cancel(isCancelled);
        const a = y * row.length, b = (this.height - y - 1) * row.length;
        row.set(rgba.subarray(a, a + row.length)); rgba.copyWithin(a, b, b + row.length); rgba.set(row, b);
      }
      cancel(isCancelled);
      return rgba;
    });
  }

  /** Uses the original full-screen shader on retained ink. The caller owns
   * arrival and display statistics; this operation never submits root points. */
  presentPixels(color:RootsMetricColorPlan,rotation:number,isCancelled?:()=>boolean):Uint8ClampedArray {
    return this.run(()=>{
      cancel(isCancelled);
      require(this.gl&&this.ink&&this.pending===0,'Native root presentation requires committed ink','input');
      const gl=this.gl,width=this.width,height=this.height;
      const {view,scale}=rootsGpuInput(()=>{
        validateRootsMetricColorPlan(color);
        // These are prepared native runtime values, whose clamps bound shader
        // pow/log intermediates. Do not silently clamp a forged color plan.
        for(const field of ROOTS_SOURCE_TONE_FIELDS)require(Math.fround(color[field.field])===normalizeRootsSourceToneField(field.key,color[field.field]),'Native root tone is outside source runtime bounds','input');
        require(color.backgroundRGB.every(v=>v>=0&&v<=1),'Native root background is outside normalized RGB','input');
        return{view:prepareRootsInkView(width,height,rotation),scale:rootsDensityScale({submittedFinitePointCount:this.submitted,width,height})};
      });
      require(rootsNativeDensityGpuBytes(width,height)+rootsNativeToneGpuBytes(width,height)<=MAX_BYTES,'Native root presentation exceeds 768 MiB','capacity');
      device(()=>{
        if(!this.programs.has('present'))this.compile('present',PRESENT_VERTEX,PRESENT_FRAGMENT);
        gl.activeTexture(gl.TEXTURE0);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
        const allocate=(w:number,h:number,filter:number,own:(t:WebGLTexture)=>void)=>{
          const t=gl.createTexture();require(t,'Native root color texture allocation failed');own(t);gl.bindTexture(gl.TEXTURE_2D,t);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
        };
        if(!this.colorTexture)allocate(width,height,gl.NEAREST,t=>{this.colorTexture=t;});
        if(!this.paletteTexture)allocate(256,1,gl.LINEAR,t=>{this.paletteTexture=t;});
        gl.bindTexture(gl.TEXTURE_2D,this.paletteTexture!);
        if(!this.uploadedPalette||!this.uploadedPalette.every((v,i)=>v===color.lut[i])){
          gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,256,1,gl.RGBA,gl.UNSIGNED_BYTE,color.lut);this.uploadedPalette=new Uint8Array(color.lut);
        }
        this.target();gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.colorTexture!,0);
        require(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'Native root color framebuffer is incomplete');
        gl.disable(gl.BLEND);gl.bindVertexArray(null);const program=this.programs.get('present')!;gl.useProgram(program);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.ink!);gl.uniform1i(gl.getUniformLocation(program,'accumTex'),0);
        gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.paletteTexture!);gl.uniform1i(gl.getUniformLocation(program,'paletteTex'),1);
        for(const field of ROOTS_SOURCE_TONE_FIELDS)gl.uniform1f(gl.getUniformLocation(program,field.field),color[field.field]);
        gl.uniform1f(gl.getUniformLocation(program,'scale'),scale);gl.uniform1f(gl.getUniformLocation(program,'displayRotation'),view.rotation);gl.uniform1f(gl.getUniformLocation(program,'viewportAspect'),view.aspect);
        gl.uniform3f(gl.getUniformLocation(program,'backgroundRgb'),...color.backgroundRGB);
        this.check('presentation setup');
      });
      const pixels=pixels8(width*height*4),row=pixels8(width*4);
      return rootsGpuFinally(()=>{
        cancel(isCancelled);
        device(()=>{
          gl.drawArrays(gl.TRIANGLE_STRIP,0,4);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.pixelStorei(gl.PACK_ALIGNMENT,1);
          gl.pixelStorei(gl.PACK_ROW_LENGTH,0);gl.pixelStorei(gl.PACK_SKIP_PIXELS,0);gl.pixelStorei(gl.PACK_SKIP_ROWS,0);
          gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);this.check('color readback');
        });
        this.readbackBytes+=pixels.byteLength;
        for(let y=0;y<height;y++){
          cancel(isCancelled);
          for(let x=0;x<width;x++)require(pixels[(y*width+x)*4+3]===255,'Native root color readback is incomplete');
        }
        for(let y=0;y<Math.floor(height/2);y++){
          cancel(isCancelled);const a=y*row.length,b=(height-y-1)*row.length;row.set(pixels.subarray(a,a+row.length));pixels.copyWithin(a,b,b+row.length);pixels.set(row,b);
        }
        return pixels;
      },()=>this.releaseDrawState());
    });
  }

  reset(): void {
    const errors: unknown[] = [], gl = this.gl;
    const attempt = (f: () => void) => { try { f(); } catch (error) { errors.push(error); } };
    if (gl) {
      for (const [key, remove] of [['colorTexture', 'deleteTexture'], ['paletteTexture', 'deleteTexture'], ['ink', 'deleteTexture'], ['framebuffer', 'deleteFramebuffer'], ['buffer', 'deleteBuffer'], ['vao', 'deleteVertexArray']] as const) {
        if (this[key]) attempt(() => { (gl[remove] as (o: unknown) => void).call(gl, this[key]); this[key] = undefined; });
      }
      for (const [kind, program] of this.programs) attempt(() => {
        if (gl.getParameter(gl.CURRENT_PROGRAM) === program) gl.useProgram(null);
        gl.deleteProgram(program); this.programs.delete(kind);
      });
      for (const shader of this.shaders) attempt(() => { gl.deleteShader(shader); this.shaders.delete(shader); });
    }
    this.cleanupPending = errors.length > 0;
    if (errors.length) throw new RootsGpuError('Native root cleanup failed; handles retained for retry', 'cleanup', {cause: new AggregateError(errors)});
    if (gl) {
      try { rootsGpuCleanup(() => { if (!gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext(); }); }
      catch (error) { this.cleanupPending = true; throw error; }
    }
    this.gl = undefined; this.uploadedPalette = undefined; this.upload = undefined; this.width = this.height = 0;
    this.pending = this.queued = this.submitted = 0; this.draws = this.readbackBytes = 0;
    this.lastKernel = undefined; this.deviceFacts = undefined;
  }
  dispose(): void { this.reset(); }
}
