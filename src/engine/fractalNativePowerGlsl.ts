// Original formula_poly.glsl SHA256 82b1e178ddb74e9fe08e0c71b9cb0ee8585c82ec42d4d658dd302edd8a12a991
export const FRACTAL_NATIVE_POWER_GLSL = `
void applyFormulaType(vec2 zr, vec2 zi, int formulaType, out vec2 zrUse, out vec2 ziUse) {
    zrUse = zr;
    ziUse = zi;
    if (formulaType == 1) {
        zrUse = ds_abs(zrUse);
        ziUse = ds_abs(ziUse);
    } else if (formulaType == 2) {
        ziUse = ds_sub(ds_set(0.0), ziUse);
    }
}

void iteratePower(vec2 zr, vec2 zi, vec2 pr, vec2 pi, out vec2 nr, out vec2 ni) {
    bool isIntPower = abs(pi.x) < 1e-6 && abs(pr.x - floor(pr.x + 0.5)) < 1e-6;
    if (isIntPower) {
        int p = max(int(floor(pr.x + 0.5)), 2);
        if (p == 2) {
            ds_cSqr(zr, zi, nr, ni);
        } else {
            ds_cPow(zr, zi, p, nr, ni);
        }
    } else {
        ds_cPowComplex(zr, zi, pr, pi, nr, ni);
    }
}

void iterateFormula(vec2 zr, vec2 zi, vec2 cr, vec2 ci, int formulaType, vec2 pr, vec2 pi, out vec2 outR, out vec2 outI) {
    vec2 zrUse;
    vec2 ziUse;
    vec2 nr;
    vec2 ni;
    applyFormulaType(zr, zi, formulaType, zrUse, ziUse);
    iteratePower(zrUse, ziUse, pr, pi, nr, ni);
    outR = ds_add(nr, cr);
    outI = ds_add(ni, ci);
}
`;
