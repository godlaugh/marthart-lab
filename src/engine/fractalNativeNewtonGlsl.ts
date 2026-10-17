// MathArt 1.7.8 retained shader arithmetic, not the local residual/DD kernel.
// Source bodies below are verbatim; ES declarations and the terminal adapter
// live in fractalNativeNewtonGpu. No runtime filesystem/original-app dependency.
export const FRACTAL_NATIVE_NEWTON_GLSL = `
#define ENABLE_NEWTON 1
#define ENABLE_NOVA 1
// fractal_math.glsl SHA256 e37d4e2d87c941cce9376b1b402a2e578a2f2aaf2f96e07e5382c7711b0b04dd
vec2 ds_set(float a) {
    return vec2(a, 0.0);
}

vec2 ds_add(vec2 dsa, vec2 dsb) {
    vec2 dsc;
    float t1, t2, e;
    t1 = dsa.x + dsb.x;
    e = t1 - dsa.x;
    t2 = ((dsa.x - (t1 - e)) + (dsb.x - e)) + (dsa.y + dsb.y);
    dsc.x = t1 + t2;
    dsc.y = t2 - (dsc.x - t1);
    return dsc;
}

vec2 ds_sub(vec2 dsa, vec2 dsb) {
    vec2 dsc;
    float t1, t2, e;
    t1 = dsa.x - dsb.x;
    e = t1 - dsa.x;
    t2 = ((dsa.x - (t1 - e)) - (dsb.x + e)) + (dsa.y - dsb.y);
    dsc.x = t1 + t2;
    dsc.y = t2 - (dsc.x - t1);
    return dsc;
}

vec2 ds_mul(vec2 dsa, vec2 dsb) {
    vec2 dsc;
    float c11, c21, c2, e, t1, t2;
    float a1, a2, b1, b2, cona, conb, split = 8193.0;

    cona = dsa.x * split;
    a1 = cona - (cona - dsa.x);
    a2 = dsa.x - a1;

    conb = dsb.x * split;
    b1 = conb - (conb - dsb.x);
    b2 = dsb.x - b1;

    c11 = dsa.x * dsb.x;
    c21 = a1 * b1 - c11;
    c21 += a1 * b2 + a2 * b1;
    c21 += a2 * b2;

    c2 = dsa.x * dsb.y + dsa.y * dsb.x;

    t1 = c11 + c2;
    e = t1 - c11;
    t2 = dsa.y * dsb.y + ((c2 - e) + (c11 - (t1 - e))) + c21;

    dsc.x = t1 + t2;
    dsc.y = t2 - (dsc.x - t1);

    return dsc;
}

vec2 ds_div(vec2 dsa, vec2 dsb) {
    float q1 = dsa.x / dsb.x;
    vec2 qb = ds_mul(ds_set(q1), dsb);
    vec2 r = ds_sub(dsa, qb);
    float q2 = (r.x + r.y) / dsb.x;
    return ds_add(ds_set(q1), ds_set(q2));
}

vec2 ds_sqr(vec2 dsa) {
    vec2 dsc;
    float c11, c21, c2, e, t1, t2;
    float a1, a2, cona, split = 8193.0;

    cona = dsa.x * split;
    a1 = cona - (cona - dsa.x);
    a2 = dsa.x - a1;

    c11 = dsa.x * dsa.x;
    c21 = a1 * a1 - c11;
    c21 += 2.0 * a1 * a2;
    c21 += a2 * a2;

    c2 = 2.0 * dsa.x * dsa.y;

    t1 = c11 + c2;
    e = t1 - c11;
    t2 = dsa.y * dsa.y + ((c2 - e) + (c11 - (t1 - e))) + c21;

    dsc.x = t1 + t2;
    dsc.y = t2 - (dsc.x - t1);

    return dsc;
}

vec2 ds_abs(vec2 d) {
    return d.x < 0.0 ? vec2(-d.x, -d.y) : d;
}

#ifndef ENABLE_NEWTON
#define ENABLE_NEWTON 0
#endif

#ifndef ENABLE_NOVA
#define ENABLE_NOVA 0
#endif

bool ds_mag_sqr_gt(vec2 dx, vec2 dy, float threshold) {
    float x = dx.x;
    float y = dy.x;
    return (x*x + y*y) > threshold;
}

vec2 rotateVec(vec2 v, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

void ds_cMul(vec2 ar, vec2 ai, vec2 br, vec2 bi, out vec2 res_r, out vec2 res_i) {
    vec2 t1 = ds_mul(ar, br);
    vec2 t2 = ds_mul(ai, bi);
    res_r = ds_sub(t1, t2);
    
    vec2 t3 = ds_mul(ar, bi);
    vec2 t4 = ds_mul(ai, br);
    res_i = ds_add(t3, t4);
}

void ds_cSqr(vec2 zr, vec2 zi, out vec2 res_r, out vec2 res_i) {
    vec2 r2 = ds_sqr(zr);
    vec2 i2 = ds_sqr(zi);
    res_r = ds_sub(r2, i2);
    
    vec2 t = ds_mul(zr, zi);
    res_i = ds_add(t, t);
}

void ds_cPow(vec2 zr, vec2 zi, int p, out vec2 res_r, out vec2 res_i) {
    vec2 tr = zr;
    vec2 ti = zi;
    for (int i = 1; i < 16; i++) {
        if (i >= p) break;
        vec2 nr, ni;
        ds_cMul(tr, ti, zr, zi, nr, ni);
        tr = nr;
        ti = ni;
    }
    res_r = tr;
    res_i = ti;
}

void ds_cDiv(vec2 ar, vec2 ai, vec2 br, vec2 bi, out vec2 res_r, out vec2 res_i) {
    vec2 denom = ds_add(ds_mul(br, br), ds_mul(bi, bi));
    vec2 num_r = ds_add(ds_mul(ar, br), ds_mul(ai, bi));
    vec2 num_i = ds_sub(ds_mul(ai, br), ds_mul(ar, bi));
    res_r = ds_div(num_r, denom);
    res_i = ds_div(num_i, denom);
}

float safeNorm2(vec2 zr, vec2 zi) {
    float value = zr.x * zr.x + zi.x * zi.x;
    if (isnan(value) || isinf(value)) {
        return 1.0e30;
    }
    return max(value, 0.0);
}

void safeDiv(vec2 ar, vec2 ai, vec2 br, vec2 bi, float eps, out vec2 rr, out vec2 ri) {
    float denom = safeNorm2(br, bi);
    if (denom < eps) {
        rr = ds_set(0.0);
        ri = ds_set(0.0);
        return;
    }
    ds_cDiv(ar, ai, br, bi, rr, ri);
    float mag2 = safeNorm2(rr, ri);
    if (isnan(mag2) || isinf(mag2)) {
        rr = ds_set(0.0);
        ri = ds_set(0.0);
    }
}

void cSin(vec2 zr, vec2 zi, out vec2 rr, out vec2 ri) {
    float x = zr.x;
    float y = zi.x;
    rr = ds_set(sin(x) * cosh(y));
    ri = ds_set(cos(x) * sinh(y));
}

void cCos(vec2 zr, vec2 zi, out vec2 rr, out vec2 ri) {
    float x = zr.x;
    float y = zi.x;
    rr = ds_set(cos(x) * cosh(y));
    ri = ds_set(-sin(x) * sinh(y));
}

void cSinh(vec2 zr, vec2 zi, out vec2 rr, out vec2 ri) {
    float x = zr.x;
    float y = zi.x;
    rr = ds_set(sinh(x) * cos(y));
    ri = ds_set(cosh(x) * sin(y));
}

void cCosh(vec2 zr, vec2 zi, out vec2 rr, out vec2 ri) {
    float x = zr.x;
    float y = zi.x;
    rr = ds_set(cosh(x) * cos(y));
    ri = ds_set(sinh(x) * sin(y));
}

void cLog(vec2 zr, vec2 zi, out vec2 lr, out vec2 li) {
    float mag2 = max(safeNorm2(zr, zi), 1.0e-30);
    lr = ds_set(0.5 * log(mag2));
    li = ds_set(atan(zi.x, zr.x));
}

void cExp(vec2 zr, vec2 zi, out vec2 er, out vec2 ei) {
    float expX = exp(zr.x);
    er = ds_set(expX * cos(zi.x));
    ei = ds_set(expX * sin(zi.x));
}

void cPow(vec2 zr, vec2 zi, vec2 wr, vec2 wi, out vec2 rr, out vec2 ri) {
    float mag2 = safeNorm2(zr, zi);
    if (mag2 < 1.0e-30) {
        rr = ds_set(0.0);
        ri = ds_set(0.0);
        return;
    }
    vec2 lr, li;
    cLog(zr, zi, lr, li);
    vec2 mr, mi;
    ds_cMul(wr, wi, lr, li, mr, mi);
    cExp(mr, mi, rr, ri);
}

void ds_cLog(vec2 zr, vec2 zi, out vec2 lr, out vec2 li) {
    cLog(zr, zi, lr, li);
}

void ds_cExp(vec2 zr, vec2 zi, out vec2 er, out vec2 ei) {
    cExp(zr, zi, er, ei);
}

void ds_cPowComplex(vec2 zr, vec2 zi, vec2 pr, vec2 pi, out vec2 res_r, out vec2 res_i) {
    cPow(zr, zi, pr, pi, res_r, res_i);
}

// --- Perturbation Helper Functions ---

// Computes (z+d)^p - z^p
void ds_deltaPow(vec2 zr, vec2 zi, vec2 dr, vec2 di, int p, out vec2 outR, out vec2 outI) {
    if (p == 2) {
        // (z+d)^2 - z^2 = 2zd + d^2
        vec2 zd_r, zd_i;
        ds_cMul(zr, zi, dr, di, zd_r, zd_i);
        vec2 d2_r, d2_i;
        ds_cMul(dr, di, dr, di, d2_r, d2_i);
        outR = ds_add(ds_add(zd_r, zd_r), d2_r);
        outI = ds_add(ds_add(zd_i, zd_i), d2_i);
    } else {
        // Iterative calculation for p > 2
        // Dn = (z+d)^n - z^n
        // D_n = D_{n-1}*z + (z^{n-1} + D_{n-1})*d
        vec2 currentZ_r = zr;
        vec2 currentZ_i = zi;
        
        vec2 D_r = dr;
        vec2 D_i = di;
        
        // We start with n=1: D1 = d.
        // We need to iterate p-1 times.
        for (int i = 1; i < p; i++) {
            // New D = D * z + (CurrentZ + D) * d
            vec2 term1_r, term1_i;
            ds_cMul(D_r, D_i, zr, zi, term1_r, term1_i);
            
            vec2 sum_r = ds_add(currentZ_r, D_r);
            vec2 sum_i = ds_add(currentZ_i, D_i);
            
            vec2 term2_r, term2_i;
            ds_cMul(sum_r, sum_i, dr, di, term2_r, term2_i);
            
            D_r = ds_add(term1_r, term2_r);
            D_i = ds_add(term1_i, term2_i);
            
            // Update Z^n
            vec2 nextZ_r, nextZ_i;
            ds_cMul(currentZ_r, currentZ_i, zr, zi, nextZ_r, nextZ_i);
            currentZ_r = nextZ_r;
            currentZ_i = nextZ_i;
        }
        outR = D_r;
        outI = D_i;
    }
}

// Computes Newton Perturbation Step
// z_new = (1 - relax/p) * z + (relax/p) * z^{-(p-1)}
// We need Delta(z_new) = (1 - relax/p) * d + (relax/p) * Delta(z^{-(p-1)})
// Delta(z^-m) = (z+d)^-m - z^-m = -Dm / (z^m * (z^m + Dm)) where Dm = (z+d)^m - z^m
void ds_deltaNewton(vec2 zr, vec2 zi, vec2 dr, vec2 di, int p, float relax, out vec2 outR, out vec2 outI) {
    int m = p - 1;
    
    // Calculate Dm = (z+d)^m - z^m
    vec2 Dm_r, Dm_i;
    ds_deltaPow(zr, zi, dr, di, m, Dm_r, Dm_i);
    
    // Calculate Zm = z^m
    vec2 Zm_r, Zm_i;
    if (m == 1) {
        Zm_r = zr;
        Zm_i = zi;
    } else if (m == 2) {
        ds_cSqr(zr, zi, Zm_r, Zm_i);
    } else {
        ds_cPow(zr, zi, m, Zm_r, Zm_i);
    }
    
    // Calculate Zm_plus_Dm = Zm + Dm = (z+d)^m
    vec2 ZmDm_r = ds_add(Zm_r, Dm_r);
    vec2 ZmDm_i = ds_add(Zm_i, Dm_i);
    
    // Denominator = Zm * (Zm + Dm)
    vec2 denom_r, denom_i;
    ds_cMul(Zm_r, Zm_i, ZmDm_r, ZmDm_i, denom_r, denom_i);
    
    // Numerator = -Dm
    vec2 num_r = ds_sub(ds_set(0.0), Dm_r);
    vec2 num_i = ds_sub(ds_set(0.0), Dm_i);

    // Apply weights
    float w1 = 1.0 - relax / float(p);
    float w2 = relax / float(p);
    
    vec2 term1_r = ds_mul(dr, ds_set(w1));
    vec2 term1_i = ds_mul(di, ds_set(w1));

    float denomMag2 = denom_r.x * denom_r.x + denom_i.x * denom_i.x;
    if (isnan(denomMag2) || isinf(denomMag2) || denomMag2 < 1.0e-24) {
        outR = term1_r;
        outI = term1_i;
        return;
    }
    
    // Fraction
    vec2 frac_r, frac_i;
    ds_cDiv(num_r, num_i, denom_r, denom_i, frac_r, frac_i);

    float fracMag2 = frac_r.x * frac_r.x + frac_i.x * frac_i.x;
    if (isnan(fracMag2) || isinf(fracMag2)) {
        outR = term1_r;
        outI = term1_i;
        return;
    }

    vec2 term2_r = ds_mul(frac_r, ds_set(w2));
    vec2 term2_i = ds_mul(frac_i, ds_set(w2));
    
    outR = ds_add(term1_r, term2_r);
    outI = ds_add(term1_i, term2_i);
}

// formula_newton_nova.glsl SHA256 4dfc7e88674c60d3be1b9b10ef116e7a7f2aab8e8805dc7b029c13f3a3c6c523
float powerResidual(vec2 zr, vec2 zi, int p) {
    vec2 pr;
    vec2 pi;
    if (p == 2) {
        ds_cSqr(zr, zi, pr, pi);
    } else {
        ds_cPow(zr, zi, p, pr, pi);
    }
    vec2 fr = ds_sub(pr, ds_set(1.0));
    vec2 fi = pi;
    float xr = fr.x;
    float xi = fi.x;
    return xr * xr + xi * xi;
}

float powerResidual(vec2 zr, vec2 zi, vec2 pr, vec2 pi) {
    float pRound = floor(pr.x + 0.5);
    bool isInt = abs(pi.x) < 1e-6 && abs(pr.x - pRound) < 1e-6;
    int p = int(floor(pr.x + 0.5));
    if (isInt && p >= 2 && p < 16) {
        return powerResidual(zr, zi, p);
    }
    vec2 pzr, pzi;
    ds_cPowComplex(zr, zi, pr, pi, pzr, pzi);
    vec2 fr = ds_sub(pzr, ds_set(1.0));
    vec2 fi = pzi;
    float xr = fr.x;
    float xi = fi.x;
    return xr * xr + xi * xi;
}

#if ENABLE_NEWTON == 1
void iterateNewton(vec2 zr, vec2 zi, vec2 pr, vec2 pi, float relax, out vec2 outR, out vec2 outI) {
    vec2 pzr, pzi;
    float pRound = floor(pr.x + 0.5);
    bool isInt = abs(pi.x) < 1e-6 && abs(pr.x - pRound) < 1e-6;
    int p = int(pRound);
    if (isInt && p >= 2 && p < 16) {
        ds_cPow(zr, zi, p, pzr, pzi);
    } else {
        ds_cPowComplex(zr, zi, pr, pi, pzr, pzi);
    }
    vec2 fr = ds_sub(pzr, ds_set(1.0));
    vec2 fi = pzi;
    vec2 pm1r, pm1i;
    vec2 pr1 = ds_sub(pr, ds_set(1.0));
    if (isInt && p > 1 && p < 16) {
        ds_cPow(zr, zi, p - 1, pm1r, pm1i);
    } else {
        ds_cPowComplex(zr, zi, pr1, pi, pm1r, pm1i);
    }
    vec2 dr, di;
    ds_cMul(pr, pi, pm1r, pm1i, dr, di);
    float derivNorm2 = safeNorm2(dr, di);
    if (derivNorm2 < 1.0e-24) {
        outR = zr;
        outI = zi;
        return;
    }
    vec2 rr, ri;
    safeDiv(fr, fi, dr, di, 1.0e-24, rr, ri);
    vec2 step_r = ds_mul(rr, ds_set(relax));
    vec2 step_i = ds_mul(ri, ds_set(relax));
    outR = ds_sub(zr, step_r);
    outI = ds_sub(zi, step_i);
}
#endif

#if ENABLE_NOVA == 1
void iterateNova(vec2 zr, vec2 zi, vec2 cr, vec2 ci, vec2 pr, vec2 pi, float relax, out vec2 outR, out vec2 outI) {
    vec2 nr, ni;
    iterateNewton(zr, zi, pr, pi, relax, nr, ni);
    outR = ds_add(nr, cr);
    outI = ds_add(ni, ci);
}
#endif

`;
