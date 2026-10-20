const F = Math.fround;
// PGraphics.<clinit> PC25–64. The float angle precedes double host-libm trig;
// native JVM last-bit equivalence requires separate runtime evidence.
const sin = new Float32Array(720), cos = new Float32Array(720);
for (let i = 0; i < 720; i++) {
 const angle = F(F(F(i) * F(Math.PI / 180)) * .5);
 sin[i] = F(Math.sin(angle)); cos[i] = F(Math.cos(angle));
}
/** Internal LUT reads. Each source caller owns its distinct index conversion,
 * wrapping and phase arithmetic; no interpolation or wrapping occurs here. */
export const sourceProcessingSinLut = (index: number): number => sin[index];
export const sourceProcessingCosLut = (index: number): number => cos[index];
