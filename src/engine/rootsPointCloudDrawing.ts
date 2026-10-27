import {RootsPointCloudRing, ROOTS_POINT_CLOUD_RECENT_WINDOW, type RootsPointCloudWindow} from './rootsPointCloudRing';
import {validatePreparedRootsProjection, type PreparedRootsProjection} from './rootsProjection';
import {prepareRootsMetricValue, validateRootsMetricColorPlan, type RootsMetricColorPlan} from './rootsDensityColor';
import type {SourceDrawingUniform} from './sourceDrawingSnapshot';
import {RootsGpuError, rootsGpuRequire as require, rootsGpuInput, rootsGpuCancel as cancel} from './rootsGpuFailure';

/** Existing local upload/work bounds, not an original shader format limit. */
export const ROOTS_NATIVE_POINT_CLOUD_CHUNK = 65_536;
export const ROOTS_POINT_CLOUD_DRAW_FOOTPRINT = 8_000_000;
export const ROOTS_POINT_FRAME_BINDING_BYTES = 196;
export type RootsPointRgba = readonly [number, number, number, number];
export interface RootsPointPrograms {
 readonly point: {readonly vertex: string; readonly fragment: string};
 readonly fade: {readonly vertex: string; readonly fragment: string};
}
export interface RootsPointFrameMetadata {
 readonly clear?: RootsPointRgba;
 readonly fade?: RootsPointRgba;
 readonly palette: Uint8Array;
 readonly uniforms: readonly SourceDrawingUniform[];
}
const HEADERS = {webgl2: '#version 300 es\nprecision highp float;\nprecision highp int;\n', 'native-gl41': '#version 410 core\n'} as const;
// Retained shader arithmetic is shared verbatim. Only the owned profile header
// differs; consumers must never rewrite the program text.
const POINT_VERTEX = `uniform mat4 projection;
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
const POINT_FRAGMENT = `uniform float brightness;
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
const FULLSCREEN = `void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;
const FILL_FRAGMENT = `uniform vec4 fillColor;out vec4 pixel;void main(){pixel=fillColor;}`;
const programs = Object.fromEntries(Object.entries(HEADERS).map(([profile, header]) => [profile, Object.freeze({
 point: Object.freeze({vertex: header + POINT_VERTEX, fragment: header + POINT_FRAGMENT}),
 fade: Object.freeze({vertex: header + FULLSCREEN, fragment: header + FILL_FRAGMENT}),
})])) as Record<keyof typeof HEADERS, RootsPointPrograms>;
export function rootsPointCloudPrograms(profile: keyof typeof HEADERS): RootsPointPrograms {
 require(Object.hasOwn(HEADERS, profile), 'Unknown Roots point shader profile', 'input');
 return programs[profile];
}
function allocation<T>(create: () => T): T { try { return create(); } catch (cause) { throw new RootsGpuError('Native point CPU allocation failed', 'capacity', {cause}); } }
const F = Math.fround;
/** Processing packed clear/fade semantics differ from shader backgroundRGB. */
export function prepareRootsPointCloudBackground(packed: number, alpha255?: number): RootsPointRgba {
 require(Number.isInteger(packed) && packed >= 0 && packed <= 0xffffffff, 'Native point background requires packed ARGB', 'input');
 require(alpha255 === undefined || Number.isFinite(alpha255) && Number.isFinite(F(alpha255)), 'Native point fade alpha is invalid', 'input');
 const gray = packed <= 255, alpha = gray ? 255 : packed >>> 24;
 const factor = alpha255 === undefined ? 1 : F(Math.min(255, Math.max(0, F(alpha255))) / 255);
 const a = alpha255 === undefined ? alpha : Math.trunc(F(alpha * factor));
 const r = gray ? packed : (packed >>> 16) & 255, g = gray ? packed : (packed >>> 8) & 255, b = gray ? packed : packed & 255;
 return Object.freeze([F(r / 255), F(g / 255), F(b / 255), F(a / 255)]);
}
/** Owns the complete upload metadata. Every numeric array and LUT is a small,
 * independent snapshot: later authored edits cannot mutate an in-flight draw. */
export function prepareRootsPointFrame(plan: PreparedRootsProjection, color: RootsMetricColorPlan, fresh: boolean): RootsPointFrameMetadata {
 rootsGpuInput(() => {validatePreparedRootsProjection(plan); validateRootsMetricColorPlan(color);});
 require(plan.mode === 'point-cloud' && typeof fresh === 'boolean', 'Native point frame requires point-cloud facts and explicit freshness', 'input');
 require(color.lut.buffer instanceof ArrayBuffer, 'Native point palette must be unshared', 'input');
 require(plan.projection.columnMajor.buffer instanceof ArrayBuffer && plan.modelView.columnMajor.buffer instanceof ArrayBuffer, 'Native point matrices must be unshared', 'input');
 const uniforms: SourceDrawingUniform[] = [];
 const uniform = (name: string, kind: 'float' | 'vec3' | 'mat4', input: ArrayLike<number>) => {
  const values = allocation(() => new Float32Array(input));
  require(values.every(Number.isFinite), 'Native point uniform exceeds finite binary32: ' + name, 'input');
  uniforms.push(Object.freeze({name, kind, count: 1, values}));
 };
 uniform('projection', 'mat4', plan.projection.columnMajor); uniform('modelview', 'mat4', plan.modelView.columnMajor);
 uniform('pointSize', 'float', [plan.pointCloudUniformSize]); uniform('rotationDegrees', 'float', [plan.transform.rotationDegrees]);
 uniform('scaleVec', 'vec3', plan.transform.scale); uniform('offsetVec', 'vec3', plan.transform.offset);
 for (const name of ['brightness', 'contrast', 'gamma', 'dynamicRange', 'saturation', 'paletteOffset'] as const) uniform(name, 'float', [color[name]]);
 uniform('backgroundRgb', 'vec3', color.backgroundRGB);
 uniforms.push(Object.freeze({name: 'paletteTex', kind: 'sampler2d', texture: 0}));
 return Object.freeze({
  ...(fresh || !plan.accumulation.enabled ? {clear: prepareRootsPointCloudBackground(color.backgroundPacked)} : {}),
  ...(plan.accumulation.enabled ? {fade: prepareRootsPointCloudBackground(color.backgroundPacked, plan.accumulation.fadeAlpha)} : {}),
  palette: allocation(() => color.lut.slice()), uniforms: Object.freeze(uniforms),
 });
}
/** Same footprint rule for the WebGL consumer and post-create native admission.
 * A native transport may lower this count for memory, never raise it. */
export function rootsPointCloudChunkPoints(width: number, height: number, pointSize: number, pointSizeRange: readonly number[]): number {
 require([width, height].every(x => Number.isInteger(x) && x > 0 && x <= 16384), 'Native point target dimensions exceed capacity', 'capacity');
 require(Number.isFinite(pointSize) && pointSize >= 0 && pointSizeRange.length === 2 && pointSizeRange.every(Number.isFinite) && pointSizeRange[0] > 0 && pointSizeRange[1] >= Math.max(1, pointSizeRange[0]), 'Native point rasterization range is invalid', 'input');
 const diameter = Math.max(1, Math.min(pointSize, pointSizeRange[1]));
 const footprint = Math.min(width, Math.ceil(diameter) + 2) * Math.min(height, Math.ceil(diameter) + 2);
 return Math.max(1, Math.min(ROOTS_NATIVE_POINT_CLOUD_CHUNK, Math.floor(ROOTS_POINT_CLOUD_DRAW_FOOTPRINT / Math.max(1, footprint))));
}
export interface RootsPointChunk {
 readonly ordinal: number;
 readonly rangeIndex: number;
 readonly rangeOffset: number;
 readonly pointCount: number;
 /** Independent from the ring. Transferable unless the caller explicitly
  * supplied reusable synchronous staging, which remains caller-owned. */
 readonly points: Float32Array<ArrayBuffer>;
}
export interface RootsPointChunkOptions {
 readonly isCancelled?: () => boolean;
 /** Optional WebGL synchronous staging. Never supply it to async/transfer
  * consumers: the next chunk overwrites its previous values. */
 readonly destination?: Float32Array<ArrayBuffer>;
}
/** Copy a bounded borrowed range without exposing/transferring the ring buffer.
 * Raw XYZ bits (including signed zero/nonfinite payloads) remain untouched;
 * the existing source metric owner alone constrains its fourth component. */
export function prepareRootsPointChunk(window: RootsPointCloudWindow, rangeIndex: number, offset: number, count: number, ring: RootsPointCloudRing, options: RootsPointChunkOptions = {}): Float32Array<ArrayBuffer> {
 const check = () => {cancel(options.isCancelled); require(ring instanceof RootsPointCloudRing && ring.isCurrentWindow(window), 'Native point borrowed window changed during draw', 'input');};
 check();
 require(Number.isInteger(rangeIndex) && rangeIndex >= 0 && rangeIndex < window.ranges.length, 'Native point chunk range is invalid', 'input');
 const range = window.ranges[rangeIndex];
 require(Number.isInteger(offset) && offset >= 0 && Number.isInteger(count) && count > 0 && count <= ROOTS_NATIVE_POINT_CLOUD_CHUNK && offset <= range.pointCount - count, 'Native point chunk exceeds its bounded range', 'input');
 require(range.values.buffer instanceof ArrayBuffer && range.values.length === range.pointCount * 4, 'Native point borrowed storage is invalid', 'input');
 const destination = options.destination;
 require(destination === undefined || destination instanceof Float32Array && destination.buffer instanceof ArrayBuffer && destination.byteOffset === 0 && destination.byteLength === destination.buffer.byteLength && destination.length >= count * 4 && destination.length <= ROOTS_NATIVE_POINT_CLOUD_CHUNK * 4 && !window.ranges.some(r => r.values.buffer === destination.buffer), 'Native point staging must be bounded independent storage and cannot alias the ring', 'input');
 const points = destination ? destination.subarray(0, count * 4) : allocation(() => new Float32Array(count * 4));
 new Uint32Array(points.buffer, points.byteOffset, points.length).set(new Uint32Array(range.values.buffer, range.values.byteOffset + offset * 16, count * 4));
 for (let i = 0; i < count; i++) {
  if ((i & 1023) === 0) check();
  points[i * 4 + 3] = rootsGpuInput(() => prepareRootsMetricValue(points[i * 4 + 3])).clamped;
 }
 check(); return points;
}
export interface RootsPointChunkPlan extends Iterable<RootsPointChunk> {
 readonly pointCount: number;
 readonly rangeCounts: readonly number[];
 readonly chunkPoints: number;
 /** Call after awaiting each ACK and before publishing a completed frame. */
 assertCurrent(): void;
 [Symbol.iterator](): Generator<RootsPointChunk, void, unknown>;
}
/** One borrowed window per frame; no complete ring copy. Consume sequentially,
 * release/transfer each independent chunk after its ACK, then request the next.
 * The session must keep new arrivals pending while this window is borrowed. */
export function prepareRootsPointChunks(ring: RootsPointCloudRing, chunkPoints: number, options: RootsPointChunkOptions = {}): RootsPointChunkPlan {
 require(ring instanceof RootsPointCloudRing, 'Native point requires the owned arrival ring', 'input');
 require(Number.isInteger(chunkPoints) && chunkPoints > 0 && chunkPoints <= ROOTS_NATIVE_POINT_CLOUD_CHUNK, 'Native point chunk capacity is invalid', 'input');
 const window = rootsGpuInput(() => ring.recentWindow());
 require(window.pointCount <= ROOTS_POINT_CLOUD_RECENT_WINDOW, 'Native point recent window exceeds 3M capacity', 'capacity');
 const assertCurrent = () => {cancel(options.isCancelled); require(ring.isCurrentWindow(window), 'Native point borrowed window changed during draw', 'input');};
 assertCurrent();
 return Object.freeze({pointCount: window.pointCount, rangeCounts: Object.freeze(window.ranges.map(range => range.pointCount)), chunkPoints, assertCurrent,
  *[Symbol.iterator]() {
   let ordinal = 0;
   for (let rangeIndex = 0; rangeIndex < window.ranges.length; rangeIndex++) {
    const range = window.ranges[rangeIndex];
    for (let offset = 0; offset < range.pointCount; offset += chunkPoints) {
     const pointCount = Math.min(chunkPoints, range.pointCount - offset);
     const points = prepareRootsPointChunk(window, rangeIndex, offset, pointCount, ring, options);
     yield Object.freeze({ordinal: ordinal++, rangeIndex, rangeOffset: offset, pointCount, points});
    }
   }
   assertCurrent();
  },
 });
}
