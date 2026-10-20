import { writeSourceEyePosition } from './sourceProcessingGeometry';
import { sourceProcessingTransformScale } from './sourceProcessingStroke';
import { sourceProcessingCosLut, sourceProcessingSinLut } from './sourceProcessingTrig';

const F = Math.fround, TAU = F(Math.PI * 2);
export const SOURCE_PROCESSING_POINT_BYTES = 256 * 1024 * 1024;
// PGL.<clinit> PC59–70: MAX_VERTEX_INDEX=32767, MAX_VERTEX_INDEX1=32768.
const CACHE_LIMIT = 32768;
export class SourceProcessingPointsError extends Error {
 constructor(readonly code: 'input' | 'capacity' | 'cancelled', message: string) { super(message); this.name = code === 'cancelled' ? 'AbortError' : 'SourceProcessingPointsError'; }
}
export interface SourceProcessingPointCache {
 readonly vertexOffset: number; readonly indexOffset: number;
 readonly vertexCount: number; readonly indexCount: number;
}
export interface SourceProcessingRoundPointOptions {
 readonly positions: Float32Array;
 /** Already parsed RGBA attributes, four normalized channels
  * per input point. No packed-int/tint/color-mode interpretation occurs here. */
 readonly colors: Float32Array;
 readonly width: number;
 /** Explicit source PMatrix3D modelview, row-major. Immediate flush bakes this
  * into eye positions; the shader must subsequently use identity modelview. */
 readonly rowMajor: readonly number[];
 readonly isCancelled?: () => boolean;
}
export interface SourceProcessingPointBuffers {
 readonly positions: Float32Array; readonly offsets: Float32Array; readonly colors: Float32Array;
 /** Cache-local native short indices. GPU consumers offset vertex attributes
  * for each cache; adding vertexOffset to uint16 indices would corrupt them. */
 readonly indices: Uint16Array;
 readonly caches: readonly SourceProcessingPointCache[];
 readonly perimeter: number;
 readonly accountedBytes: number;
}
/** Default ROUND POINTS in immediate P3D flushMode1. Other stroke caps, retained
 * shapes and prior cache contents require their own producer contracts. Negative
 * and zero finite widths retain source arithmetic/degenerate geometry. Position
 * NaN/Infinity and transform arithmetic overflow are retained, not filtered.
 * Caller must not mutate borrowed inputs during this synchronous operation. */
export function sourceProcessingRoundPointBuffers(input: SourceProcessingRoundPointOptions): SourceProcessingPointBuffers {
 const check = () => { if (input.isCancelled?.()) throw new SourceProcessingPointsError('cancelled', 'Processing point tessellation cancelled.'); };
 if (!input || !(input.positions instanceof Float32Array) || input.positions.length % 3 !== 0 || !(input.colors instanceof Float32Array) || input.colors.length !== input.positions.length / 3 * 4) throw new SourceProcessingPointsError('input', 'Processing points require xyz and parsed RGBA Float32 arrays.');
 if (typeof input.width !== 'number' || !Number.isFinite(F(input.width)) || !input.rowMajor || input.rowMajor.length !== 16) throw new SourceProcessingPointsError('input', 'Processing points require finite Float32 width and an explicit modelview matrix.');
 check();
 const matrix = Array.from(input.rowMajor, value => {
  if (typeof value !== 'number' || !Number.isFinite(F(value))) throw new SourceProcessingPointsError('input', 'Processing modelview entries must be finite Float32 values.');
  return F(value);
 });
 const width = F(input.width), count = input.positions.length / 3;
 // JVM f2i saturates at integer limits; the following clamp yields the same
 // perimeter count even when TAU*finiteWidth overflows float.
 const perimeter = Math.min(200, Math.max(20, Math.trunc(F(F(TAU * width) / 10))));
 const perPoint = perimeter + 1, perIndices = perimeter * 3;
 const perCache = Math.floor((CACHE_LIMIT - 1) / perPoint), cacheCount = Math.ceil(count / perCache);
 // Account borrowed input, all output arrays, bounded metadata allowance and
 // one immutable fan template + eye/matrix scratch. No output-sized copies.
 const accountedBytes = input.positions.byteLength + input.colors.byteLength + count * (perPoint * 40 + perIndices * 2) + cacheCount * 64 + perPoint * 8 + 272;
 if (!Number.isSafeInteger(accountedBytes) || accountedBytes > SOURCE_PROCESSING_POINT_BYTES) throw new SourceProcessingPointsError('capacity', 'Processing point expansion exceeds the local 256 MiB input/output budget.');
 for (let i = 0; i < input.colors.length; i++) {
  if ((i & 1023) === 0) check();
  if (!Number.isFinite(input.colors[i]) || input.colors[i] < 0 || input.colors[i] > 1) throw new SourceProcessingPointsError('input', 'Processing point colors must be parsed normalized RGBA channels.');
 }
 const positions = new Float32Array(count * perPoint * 4), offsets = new Float32Array(count * perPoint * 2), colors = new Float32Array(positions.length), indices = new Uint16Array(count * perIndices);
 const fan = new Float32Array(perPoint * 2), eye = new Float32Array(4), scale = sourceProcessingTransformScale(matrix), phaseStep = F(720 / perimeter);
 let phase = 0;
 for (let i = 0; i < perimeter; i++) {
  const index = Math.trunc(phase);
  fan[(i + 1) * 2] = F(F(F(.5 * sourceProcessingCosLut(index)) * scale) * width);
  fan[(i + 1) * 2 + 1] = F(F(F(.5 * sourceProcessingSinLut(index)) * scale) * width);
  phase = F(F(phase + phaseStep) % 720);
 }
 const caches: SourceProcessingPointCache[] = [];
 let vertex = 0, index = 0;
 for (let first = 0; first < count; first += perCache) {
  check(); const points = Math.min(perCache, count - first), vertexOffset = vertex, indexOffset = index;
  for (let point = first; point < first + points; point++) {
   if ((point & 63) === 0) check();
   writeSourceEyePosition(matrix, input.positions[point * 3], input.positions[point * 3 + 1], input.positions[point * 3 + 2], eye, 0);
   const base = vertex - vertexOffset;
   offsets.set(fan, vertex * 2);
   for (let k = 0; k < perPoint; k++, vertex++) {
    positions.set(eye, vertex * 4);
    for (let channel = 0; channel < 4; channel++) colors[vertex * 4 + channel] = input.colors[point * 4 + channel];
   }
   for (let k = 1; k < perPoint - 1; k++) { indices[index++] = base; indices[index++] = base + k; indices[index++] = base + k + 1; }
   // Source's last triangle reverses the usual fan-closing pair. Preserve it.
   indices[index++] = base; indices[index++] = base + 1; indices[index++] = base + perPoint - 1;
  }
  caches.push(Object.freeze({ vertexOffset, indexOffset, vertexCount: vertex - vertexOffset, indexCount: index - indexOffset }));
 }
 check(); return { positions, offsets, colors, indices, caches: Object.freeze(caches), perimeter, accountedBytes };
}

// Adapted from Processing PointVert/PointFrag, Processing Foundation (2012–21),
// Ben Fry/Casey Reas (2004–12), MIT (2001–04), LGPL-2.1-or-later.
// GLSL3 syntax only; preserve the original perspective/viewport calculations.
export const sourceProcessingPointVertex = `precision highp float;
precision highp int;
uniform mat4 projection;
uniform mat4 pointModelview;
uniform vec4 viewport;
uniform int perspective;
in vec4 position;
in vec4 color;
in vec2 offset;
out vec4 vertColor;
void main(){
 vec4 pos=pointModelview*position;
 vec4 clip=projection*pos;
 vec2 perspScale=(projection*vec4(1,-1,0,0)).xy;
 vec2 noPerspScale=clip.w/(0.5*viewport.zw);
 gl_Position.xy=clip.xy+offset.xy*mix(noPerspScale,perspScale,float(perspective>0));
 gl_Position.zw=clip.zw;
 vertColor=color;
}`;
export const sourceProcessingPointFragment = `precision mediump float;
precision mediump int;
in vec4 vertColor;
out vec4 fragmentColor;
void main(){fragmentColor=vertColor;}`;
