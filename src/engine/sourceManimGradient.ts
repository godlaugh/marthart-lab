import { sourceColorLerp } from './domainSourcePalette';

const F = Math.fround;
/** ManimColors.gradient's lazy per-slot formula over an owner's already parsed,
 * nonempty packed ARGB palette. Callers own count/index validation and palette
 * lifetime. Keeping this lazy preserves Attractor's large-count lookup contract.
 * This is initial color assignment, not a wrapped animation sampler. */
export function sourceManimGradientColor(palette: ArrayLike<number>, count: number, index: number): number {
 const n = palette.length;
 if (n === 1) return palette[0];
 // The source multiplies before dividing. Normalizing index first loses bits.
 const position = count === 1 ? 0 : F(F(F(n - 1) * F(index)) / F(count - 1));
 let segment = Math.trunc(position), fraction = F(position % 1);
 // The sole particle is also the last slot: it receives the last palette color.
 if (index === count - 1) { fraction = 1; segment = n - 2; }
 segment = Math.max(0, Math.min(n - 2, segment));
 return sourceColorLerp(palette[segment], palette[segment + 1], fraction, 'rgb');
}
