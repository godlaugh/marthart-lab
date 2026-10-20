/** Perlin.drawParticles2D calls stroke(R,G,B,trailAlpha=255). Packed palette
 * alpha and Processing's stroke(int) grayscale special case do not apply.
 * This adapter produces the parsed RGBA contract consumed by generic POINTS. */
export function sourcePerlinPointRgba(packed: Uint32Array, isCancelled?: () => boolean): Float32Array {
 const check = () => { if (isCancelled?.()) throw new SourcePerlinPointColorsError('cancelled', 'Perlin point color conversion cancelled.'); };
 if (!(packed instanceof Uint32Array)) throw new SourcePerlinPointColorsError('input', 'Perlin point colors require current packed ARGB.');
 // Matches the source particle-color owner's 1M packed-slot output budget;
 // scene motion may impose a smaller bound. Includes 4 MiB input +16 MiB RGBA.
 if (packed.length > SOURCE_PERLIN_INITIAL_COLOR_LIMIT) throw new SourcePerlinPointColorsError('capacity', 'Perlin point color conversion exceeds the local 20 MiB input/output budget.');
 check(); const result = new Float32Array(packed.length * 4);
 for (let i = 0; i < packed.length; i++) {
  if ((i & 255) === 0) check();
  result[i * 4] = ((packed[i] >>> 16) & 255) / 255; result[i * 4 + 1] = ((packed[i] >>> 8) & 255) / 255; result[i * 4 + 2] = (packed[i] & 255) / 255; result[i * 4 + 3] = 1;
 }
 check(); return result;
}
import { SOURCE_PERLIN_INITIAL_COLOR_LIMIT } from './sourcePerlinColorRuntime';

export class SourcePerlinPointColorsError extends Error {
 constructor(readonly code: 'input' | 'capacity' | 'cancelled', message: string) { super(message); this.name = code === 'cancelled' ? 'AbortError' : 'SourcePerlinPointColorsError'; }
}
