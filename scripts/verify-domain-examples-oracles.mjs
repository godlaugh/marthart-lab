/** Independent test oracles. No production imports, parsing, or lowering.
 * Formula macros are transcribed from the retained guide, including the
 * nonstandard example named Newton. They are not generated from its AST. */
export const officialFormulaMacros = Object.freeze({
  1: { formulaGlsl: 'c_sub(c_pow(z,vec2(3.,0.)),vec2(1.,0.))' },
  2: { formulaGlsl: 'c_div(c_sin(c_sub(z,vec2(0.,1.))),c_sin(c_add(z,vec2(0.,1.))))' },
  3: { formulaGlsl: 'c_div(c_sin(c_sub(z,vec2(1.,0.))),c_sin(c_add(z,c_mul(vec2(peer_t,0.),vec2(0.,1.)))))', parameterNames: ['peer_t'] },
  4: { formulaGlsl: 'c_pow(z,c_add(vec2(peer_a,0.),c_mul(vec2(3.,0.),vec2(0.,1.))))', parameterNames: ['peer_a'] },
  5: { formulaGlsl: 'z', nextGlsl: 'c_add(c_div(c_sub(c_pow(w,vec2(3.,0.)),vec2(1.,0.)),c_mul(vec2(3.,0.),c_pow(w,vec2(2.,0.)))),c)' },
  6: { formulaGlsl: 'z', nextGlsl: 'c_div(c_mul(c_sin(w),c_cos(w)),c_add(vec2(1.,0.),w))' },
  7: { formulaGlsl: 'z', nextGlsl: 'c_sin(c_add(w,c_pow(z,vec2(2.,0.))))' },
  8: { formulaGlsl: 'c_div(c_mul(c_sub(c_pow(z,vec2(2.,0.)),vec2(1.,0.)),c_pow(c_sub(c_sub(z,vec2(2.,0.)),vec2(0.,1.)),vec2(2.,0.))),c_add(c_add(c_pow(z,vec2(2.,0.)),vec2(2.,0.)),c_mul(vec2(2.,0.),vec2(0.,1.))))' },
});

/** Cartesian closed forms / principal polar square root. These do not invoke
 * compileComplex, domainEvaluator, domainPixel, or the production palette. */
export function analyticValue(formula, [x, y]) {
  if (formula === 'z^3-1') return [x * x * x - 3 * x * y * y - 1, 3 * x * x * y - y * y * y];
  if (formula === '1/z') {
    const squared = x * x + y * y;
    return squared === 0 ? [NaN, NaN] : [x / squared, -y / squared];
  }
  if (formula === 'sqrt(z)') {
    const radius = Math.sqrt(Math.hypot(x, y));
    // The documented local branch chooses the upper side for either signed
    // zero. Nonzero lower-half-plane points retain the lower principal side.
    const angle = Math.atan2(y === 0 ? 0 : y, x) / 2;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  }
  throw new Error('No independent analytic oracle for ' + formula);
}

export function independentLocalPoint(column, row, width, height, scale, offsetX = .5, offsetY = .5) {
  return [(((column + offsetX) / width) - .5) * 4 * width / height / scale,
    (.5 - (row + offsetY) / height) * 4 / scale];
}

/** Textbook HSV six-sector conversion, distinct from production's triangular
 * wave implementation. Test scenes explicitly select saturation .72. */
export function independentPhaseColor(value) {
  const magnitude = Math.hypot(...value);
  if (!Number.isFinite(magnitude) || magnitude > 1e12) return undefined;
  let h = Math.atan2(value[1], value[0]) / (2 * Math.PI);
  h = ((h % 1) + 1) % 1;
  const sector = h * 6, index = Math.floor(sector), fraction = sector - index;
  const low = .28, falling = 1 - .72 * fraction, rising = .28 + .72 * fraction;
  const rgb = [[1, rising, low], [falling, 1, low], [low, 1, rising],
    [low, falling, 1], [rising, low, 1], [1, low, falling]][index % 6];
  const brightness = Math.min(1, Math.sqrt(magnitude));
  return rgb.map(channel => channel * brightness);
}

export function independentAnalyticImage(formula, width, height, scale, supersampling = 1) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  let validSamples = 0, invalidPixels = 0;
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    const sum = [0, 0, 0]; let valid = 0;
    for (let sy = 0; sy < supersampling; sy++) for (let sx = 0; sx < supersampling; sx++) {
      const point = independentLocalPoint(column, row, width, height, scale, (sx + .5) / supersampling, (sy + .5) / supersampling);
      const color = independentPhaseColor(analyticValue(formula, point));
      if (!color) continue;
      valid++; for (let k = 0; k < 3; k++) sum[k] += color[k];
    }
    validSamples += valid; if (!valid) invalidPixels++;
    const at = (row * width + column) * 4;
    for (let k = 0; k < 3; k++) pixels[at + k] = valid ? Math.round(sum[k] / valid * 255) : [17, 19, 23][k];
    pixels[at + 3] = 255;
  }
  return { pixels, validSamples, invalidPixels };
}

export function winding(values) {
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const a = Math.atan2(values[i][1], values[i][0]);
    const b = Math.atan2(values[(i + 1) % values.length][1], values[(i + 1) % values.length][0]);
    let delta = b - a;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta <= -Math.PI) delta += 2 * Math.PI;
    sum += delta;
  }
  return sum / (2 * Math.PI);
}
