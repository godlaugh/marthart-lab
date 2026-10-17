/** Literal shipped MathArt 1.7.8 color functions. ES300 transport is owned by
 * fractalNativeNewtonRaster; these numerical bodies are not rewritten. */
export const FRACTAL_NATIVE_COLOR_PARTS = {
 // common/color_palette.glsl SHA256 140b2bf318499c23f278ec5e13b0ecc428c321c0acb4e24b0944b796997aaa5b
 palette:`vec3 rgb2hsv(vec3 c) {
    float cMax = max(c.r, max(c.g, c.b));
    float cMin = min(c.r, min(c.g, c.b));
    float delta = cMax - cMin;
    float h = 0.0;
    if (delta > 1e-6) {
        if (cMax == c.r) {
            h = (c.g - c.b) / delta;
        } else if (cMax == c.g) {
            h = 2.0 + (c.b - c.r) / delta;
        } else {
            h = 4.0 + (c.r - c.g) / delta;
        }
        h = (h / 6.0);
        if (h < 0.0) h += 1.0;
    }
    float s = cMax <= 0.0 ? 0.0 : delta / cMax;
    float v = cMax;
    return vec3(h, s, v);
}

vec3 hsv2rgb(vec3 c) {
    float h = c.x * 6.0;
    float s = c.y;
    float v = c.z;
    int i = int(floor(h));
    float f = h - float(i);
    float p = v * (1.0 - s);
    float q = v * (1.0 - s * f);
    float t = v * (1.0 - s * (1.0 - f));
    if (i == 0) return vec3(v, t, p);
    if (i == 1) return vec3(q, v, p);
    if (i == 2) return vec3(p, v, t);
    if (i == 3) return vec3(p, q, v);
    if (i == 4) return vec3(t, p, v);
    return vec3(v, p, q);
}

vec3 getPaletteColor(float t) {
    if (u_useCosinePalette == 1) {
        return u_cosA + u_cosB * cos(6.28318 * (u_cosC * (t + u_paletteOffset) + u_cosD));
    }
    if (u_paletteSize <= 0) return vec3(0.0);
    if (u_paletteSize == 1) return u_palette[0];
    float tAdj = pow(fract(t + u_paletteOffset), max(u_paletteGamma, 0.01));
    float p = tAdj * float(u_paletteSize);
    int idx = int(floor(p));
    float f = fract(p);
    int idx0 = idx % u_paletteSize;
    int idx1 = (idx0 + 1) % u_paletteSize;
    vec3 c1 = u_palette[idx0];
    vec3 c2 = u_palette[idx1];
    if (u_paletteSpace == 0) {
        return mix(c1, c2, f);
    }
    vec3 hsv1 = rgb2hsv(c1);
    vec3 hsv2 = rgb2hsv(c2);
    float dh = hsv2.x - hsv1.x;
    if (abs(dh) > 0.5) {
        hsv1.x += sign(dh);
    }
    vec3 hsv = mix(hsv1, hsv2, f);
    hsv.x = fract(hsv.x);
    return hsv2rgb(hsv);
}

float applyTransfer(float x, int tf) {
    float v = max(x, 0.0);
    if (tf == 1) return v;
    if (tf == 2) return v * v;
    if (tf == 3) return sqrt(v);
    if (tf == 4) return v * v * v;
    if (tf == 5) return pow(v, 1.0 / 3.0);
    if (tf == 6) return log(max(v, 1.0e-6));
    if (tf == 7) return exp(v);
    if (tf == 8) return 0.5 + 0.5 * sin(v);
    if (tf == 9) return atan(v) / 1.57079632679;
    return v;
}

vec3 sampleGradient(float t) {
    if (u_gradientSize <= 0) return getPaletteColor(t);
    if (u_gradientSize == 1) {
        return texelFetch(u_gradientTex, ivec2(0, 0), 0).rgb;
    }
    float wrapped = fract(t);
    float p = wrapped * float(u_gradientSize);
    int idx = int(floor(p));
    float f = fract(p);
    int idx0 = idx % u_gradientSize;
    int idx1 = (idx0 + 1) % u_gradientSize;
    vec3 c1 = texelFetch(u_gradientTex, ivec2(idx0, 0), 0).rgb;
    vec3 c2 = texelFetch(u_gradientTex, ivec2(idx1, 0), 0).rgb;
    return mix(c1, c2, f);
}
`,
 // common/orbit_trap_utils.glsl SHA256 179c8399f23b3fe62bca21f1b49d3e9a2af62e61506ac69c874d1c8695265419
 orbit:`vec3 directColorDomain(vec2 zr, vec2 zi, vec4 directParams) {
    float x = zr.x;
    float y = zi.x;
    float angle = atan(y, x);
    float hue = angle / 6.28318530718 + 0.5;
    float mag = log(max(x * x + y * y, 1.0e-12)) * 0.5;
    float scale = max(directParams.x, 1.0e-6);
    float v = fract(mag * scale);
    float s = clamp(directParams.z, 0.0, 1.0);
    vec3 rgb = hsv2rgb(vec3(fract(hue), s, v));
    float g = max(directParams.y, 1.0e-6);
    return pow(rgb, vec3(1.0 / g));
}

vec2 orbitTrapTransform(vec2 z, vec4 trapParams1) {
    vec2 centered = z - trapParams1.xy;
    float angle = trapParams1.z * 0.017453292519943295;
    float ca = cos(angle);
    float sa = sin(angle);
    vec2 rotated = vec2(
        centered.x * ca - centered.y * sa,
        centered.x * sa + centered.y * ca
    );
    rotated.y *= max(trapParams1.w, 1.0e-6);
    return rotated;
}

float orbitTrapDistance(vec2 transformed, vec4 trapParams0, vec4 trapParams2) {
    int shape = int(floor(trapParams2.y + 0.5));
    if (shape == 1) {
        float diameter = max(trapParams0.w, 1.0e-6);
        return abs(length(transformed) - diameter);
    }
    if (shape == 2) {
        return min(abs(transformed.x), abs(transformed.y));
    }
    return length(transformed);
}

vec3 directOrbitTrapColorByDistance(float distance, vec2 zr, vec2 zi, vec4 directParams, vec4 trapParams2) {
    float threshold = max(trapParams2.x, 1.0e-6);
    float t = clamp(distance / threshold, 0.0, 1.0);
    float v = 1.0 - t;
    float angle = atan(zi.x, zr.x);
    float hue = angle / 6.28318530718 + 0.5;
    float s = clamp(directParams.z, 0.0, 1.0);
    vec3 rgb = hsv2rgb(vec3(fract(hue), s, v));
    float g = max(directParams.y, 1.0e-6);
    vec3 directColor = pow(rgb, vec3(1.0 / g));
    float mixFactor = clamp(directParams.x, 0.0, 1.0);
    if (mixFactor > 0.001) {
        vec3 gradColor = sampleGradient(v);
        return mix(directColor, gradColor, mixFactor);
    }
    return directColor;
}

float directOrbitTrapLayerAlpha(float distance, vec4 trapParams2) {
    float threshold = max(trapParams2.x, 1.0e-6);
    float baseAlpha = clamp(1.0 - distance / threshold, 0.0, 1.0);
    float mergeOpacity = clamp(trapParams2.z, 0.0, 1.0);
    return baseAlpha * mergeOpacity;
}

vec3 directColorOrbitTrap(float minTrap, vec2 zr, vec2 zi, vec4 directParams, vec4 trapParams2) {
    return directOrbitTrapColorByDistance(minTrap, zr, zi, directParams, trapParams2);
}

vec3 directColorNormalizedZ(vec2 zr, vec2 zi, vec4 directParams) {
    float r2 = zr.x * zr.x + zi.x * zi.x;
    float r = sqrt(max(r2, 1.0e-12));
    float v = log(r) / log(max(u_bailout, 1.0e-6));
    v = clamp(v * max(directParams.x, 0.0), 0.0, 1.0);
    float angle = atan(zi.x, zr.x);
    float hue = angle / 6.28318530718 + 0.5;
    float s = clamp(directParams.z, 0.0, 1.0);
    vec3 rgb = hsv2rgb(vec3(fract(hue), s, v));
    float g = max(directParams.y, 1.0e-6);
    return pow(rgb, vec3(1.0 / g));
}

float orbitTrapIndex(float minTrap, vec4 params0, vec4 params2) {
    if (isnan(minTrap) || isinf(minTrap) || minTrap >= 1.0e19) {
        minTrap = max(params2.x, 1.0e-6);
    }
    float threshold = max(params2.x, 1.0e-6);
    float v = minTrap / threshold;
    if (isnan(v) || isinf(v)) return 0.0;
    return v;
}
`,
 // coloring_header.glsl SHA256 71838c89610fe4d20c137e2326b455df7af5648de83aeba202508e7443865277
 header:`const int COLORING_TYPE_INDEX = 0;
const int COLORING_TYPE_DIRECT = 1;

const int CID_LEGACY = 0;
const int CID_NONE = 1;
const int CID_BASIC = 2;
const int CID_SMOOTH_MANDELBROT = 3;
const int CID_DECOMPOSITION = 4;
const int CID_BINARY_DECOMPOSITION = 5;
const int CID_DISTANCE_ESTIMATOR = 6;
const int CID_DIRECT_DOMAIN = 7;
const int CID_DIRECT_ORBIT_TRAP = 8;
const int CID_DIRECT_NORMALIZED_Z = 9;
const int CID_ORBIT_TRAP_INDEX = 10;
const int BASIC_METRIC_ITERATION = 0;
const int BASIC_METRIC_REAL = 1;
const int BASIC_METRIC_IMAGINARY = 2;
const int BASIC_METRIC_SUM = 3;

uniform vec4 u_insideColoringParams0;
uniform vec4 u_outsideColoringParams0;
uniform vec4 u_insideColoringParams1;
uniform vec4 u_outsideColoringParams1;
uniform vec4 u_insideColoringParams2;
uniform vec4 u_outsideColoringParams2;

struct ColoringContext {
    int iter;
    int maxIter;
    float iterVal;
    int escaped;
    int exitKind;
    vec2 zr;
    vec2 zi;
    vec2 zPrevR;
    vec2 zPrevI;
    float minTrapInside;
    float minTrapOutside;
    vec3 directAccumInside;
    vec3 directAccumOutside;
    float residual;
    float distanceEstimate;
    int distanceEstimateValid;
};

struct ColoringResult {
    int type;
    float index;
    vec3 directColor;
    int valid;
};

ColoringResult makeIndexResult(float index) {
    ColoringResult result;
    result.type = COLORING_TYPE_INDEX;
    result.index = index;
    result.directColor = vec3(0.0);
    result.valid = 1;
    return result;
}

ColoringResult makeDirectResult(vec3 color) {
    ColoringResult result;
    result.type = COLORING_TYPE_DIRECT;
    result.index = 0.0;
    result.directColor = color;
    result.valid = 1;
    return result;
}

bool isEscaped(ColoringContext ctx) {
    return ctx.escaped == 1;
}
`,
 // coloring_algorithms.glsl SHA256 1840061f303e13462622b5fa20b583349cd2eeb66fa435b2feaf5e1e834ac2b4
 algorithms:`float coloringLegacyIndex(ColoringContext ctx) {
    return ctx.iterVal / max(float(ctx.maxIter), 1.0);
}

vec4 getColoringParams0(ColoringContext ctx) {
    return isEscaped(ctx) ? u_outsideColoringParams0 : u_insideColoringParams0;
}

vec4 getColoringParams1(ColoringContext ctx) {
    return isEscaped(ctx) ? u_outsideColoringParams1 : u_insideColoringParams1;
}

vec4 getColoringParams2(ColoringContext ctx) {
    return isEscaped(ctx) ? u_outsideColoringParams2 : u_insideColoringParams2;
}

float getOrbitTrapMin(ColoringContext ctx) {
    return isEscaped(ctx) ? ctx.minTrapOutside : ctx.minTrapInside;
}

float coloringNone(ColoringContext ctx) {
    return 0.0;
}

float coloringBasic(ColoringContext ctx) {
    vec4 p = getColoringParams0(ctx);
    int metric = int(floor(p.x + 0.5));
    if (metric == BASIC_METRIC_REAL) {
        return 0.05 * (4.0 + ctx.zr.x);
    } else if (metric == BASIC_METRIC_IMAGINARY) {
        return 0.05 * (4.0 + ctx.zi.x);
    } else if (metric == BASIC_METRIC_SUM) {
        return 0.05 * (4.0 + ctx.zr.x + ctx.zi.x);
    }
    return 0.01 * float(ctx.iter);
}

float coloringSmoothMandelbrot(ColoringContext ctx) {
    if (!isEscaped(ctx)) {
        return 0.01 * float(ctx.iter);
    }
    vec4 p = getColoringParams0(ctx);
    float exponentMag = max(length(vec2(p.x, p.y)), 1.000001);
    float bailout = max(p.z, 1.0e-12);
    float r = max(length(vec2(ctx.zr.x, ctx.zi.x)), 1.000001);
    float il = 1.0 / max(log(exponentMag), 1.0e-12);
    if (ctx.exitKind == 2) {
        // Convergent exit: smooth by convergence rate only (residual-based).
        // The escape-style il factor below depends on the exponent param and can
        // amplify per-pixel residual jitter into full-palette noise (grain).
        float d = max(sqrt(max(ctx.residual, 0.0)), 1.0e-30);
        float conv = max(-log(d), 1.0e-12);
        float smoothConv = float(ctx.iter) + 1.0 - log(conv) / 0.69314718056;
        return 0.05 * smoothConv;
    }
    float lp = log(max(log(max(bailout, 1.000001)), 1.0e-12));
    float smoothValue = float(ctx.iter) + 1.0 + il * lp - il * log(max(log(r), 1.0e-12));
    return 0.05 * smoothValue;
}

float coloringDecomposition(ColoringContext ctx) {
    float angle = atan(ctx.zi.x, ctx.zr.x);
    if (angle < 0.0) {
        angle += 6.28318530718;
    }
    return angle * 0.15915494309;
}

float coloringBinaryDecomposition(ColoringContext ctx) {
    vec4 p = getColoringParams0(ctx);
    int decompType = int(floor(p.x + 0.5));
    if (decompType <= 0) {
        return ctx.zr.x * ctx.zi.x >= 0.0 ? 0.5 : 0.0;
    }
    return atan(ctx.zi.x, ctx.zr.x) > 0.0 ? 0.5 : 0.0;
}

float coloringDistanceEstimator(ColoringContext ctx) {
    if (!isEscaped(ctx)) {
        return 0.0;
    }
    if (ctx.distanceEstimateValid != 1) {
        return coloringSmoothMandelbrot(ctx);
    }
    vec4 p = getColoringParams0(ctx);
    float power = max(p.z, 2.0);
    float de = max(ctx.distanceEstimate, 0.0);
    return pow(de, 1.0 / power);
}
`,
 // coloring_router.glsl SHA256 08b708a89d9a2c69f67fe9d6a13ef535a6a264058badd88667c57adcefdb03ef
 router:`uniform int u_insideColoringAlgorithm;
uniform int u_outsideColoringAlgorithm;

int resolveColoringAlgorithm(ColoringContext ctx) {
    int id = isEscaped(ctx) ? u_outsideColoringAlgorithm : u_insideColoringAlgorithm;
    if (id <= 0) {
        return CID_LEGACY;
    }
    return id;
}

ColoringResult evaluateColoring(ColoringContext ctx) {
    int algorithmId = resolveColoringAlgorithm(ctx);
    vec4 params0 = getColoringParams0(ctx);
    vec4 params2 = getColoringParams2(ctx);
    if (algorithmId == CID_NONE) {
        return makeIndexResult(coloringNone(ctx));
    }
    if (algorithmId == CID_BASIC) {
        return makeIndexResult(coloringBasic(ctx));
    }
    if (algorithmId == CID_SMOOTH_MANDELBROT) {
        return makeIndexResult(coloringSmoothMandelbrot(ctx));
    }
    if (algorithmId == CID_DECOMPOSITION) {
        return makeIndexResult(coloringDecomposition(ctx));
    }
    if (algorithmId == CID_BINARY_DECOMPOSITION) {
        return makeIndexResult(coloringBinaryDecomposition(ctx));
    }
    if (algorithmId == CID_DISTANCE_ESTIMATOR) {
        return makeIndexResult(coloringDistanceEstimator(ctx));
    }
    if (algorithmId == CID_DIRECT_DOMAIN) {
        return makeDirectResult(directColorDomain(ctx.zr, ctx.zi, params0));
    }
    if (algorithmId == CID_DIRECT_ORBIT_TRAP) {
        return makeDirectResult(isEscaped(ctx) ? ctx.directAccumOutside : ctx.directAccumInside);
    }
    if (algorithmId == CID_DIRECT_NORMALIZED_Z) {
        return makeDirectResult(directColorNormalizedZ(ctx.zr, ctx.zi, params0));
    }
    if (algorithmId == CID_ORBIT_TRAP_INDEX) {
        return makeIndexResult(orbitTrapIndex(getOrbitTrapMin(ctx), params0, params2));
    }
    return makeIndexResult(coloringLegacyIndex(ctx));
}
`,
 // coloring_mapping.glsl SHA256 eea0565113bb0b5e44179215ffbc7fa4219d52a1d709c59c97a68f4c33d64bcd
 mapping:`vec3 applyIndexMapping(ColoringContext ctx, float baseIndex) {
    float density = isEscaped(ctx) ? u_outsideColorDensity : u_insideColorDensity;
    int tf = isEscaped(ctx) ? u_outsideTransferFunction : u_insideTransferFunction;
    float offset = isEscaped(ctx) ? u_outsideGradientOffset : u_insideGradientOffset;
    int repeat = isEscaped(ctx) ? u_outsideRepeatGradient : u_insideRepeatGradient;
    vec4 solid = isEscaped(ctx) ? u_outsideSolidColor : u_insideSolidColor;
    if (tf == 0) {
        return solid.rgb;
    }
    float t = applyTransfer(baseIndex * density, tf) + offset;
    if (repeat == 1) {
        t = fract(t);
    } else {
        t = clamp(t, 0.0, 1.0);
    }
    return sampleGradient(t);
}

vec4 mapColoringResult(ColoringContext ctx, ColoringResult result) {
    if (result.valid != 1) {
        vec4 solid = isEscaped(ctx) ? u_outsideSolidColor : u_insideSolidColor;
        return solid;
    }
    if (result.type == COLORING_TYPE_DIRECT) {
        return vec4(clamp(result.directColor, 0.0, 1.0), 1.0);
    }
    return vec4(applyIndexMapping(ctx, result.index), 1.0);
}
`,
} as const;
export const FRACTAL_NATIVE_COLOR_GLSL = Object.values(FRACTAL_NATIVE_COLOR_PARTS).join('\n');
/** Original main final-color body, excluding the closing main brace. */
export const FRACTAL_NATIVE_COLOR_TAIL = `    bool escaped;
    escaped = exitKind != 0;
    if (canComputeDistanceEstimate && escaped) {
        float r = max(length(vec2(zr.x, zi.x)), 1.0e-9);
        float dLen = max(length(deDz), 1.0e-9);
        float de = float(p) * log(r) * r / dLen;
        if (!isnan(de) && !isinf(de) && de >= 0.0) {
            deDistance = de;
            deDistanceValid = 1;
        }
    }
    if (trackTrapInside && minTrapInside >= 1.0e19) {
        minTrapInside = max(insideTrapParams2.x, 1.0e-6);
    }
    if (trackTrapOutside && minTrapOutside >= 1.0e19) {
        minTrapOutside = max(outsideTrapParams2.x, 1.0e-6);
    }
    float iterVal = float(iter);

    ColoringContext coloringCtx;
    coloringCtx.iter = iter;
    coloringCtx.maxIter = maxIter;
    coloringCtx.iterVal = iterVal;
    coloringCtx.escaped = escaped ? 1 : 0;
    coloringCtx.exitKind = exitKind;
    coloringCtx.zr = zr;
    coloringCtx.zi = zi;
    coloringCtx.zPrevR = zprevR;
    coloringCtx.zPrevI = zprevI;
    coloringCtx.minTrapInside = minTrapInside;
    coloringCtx.minTrapOutside = minTrapOutside;
    coloringCtx.directAccumInside = directAccumInside;
    coloringCtx.directAccumOutside = directAccumOutside;
    coloringCtx.residual = finalResidual;
    coloringCtx.distanceEstimate = deDistance;
    coloringCtx.distanceEstimateValid = deDistanceValid;

    ColoringResult coloringResult = evaluateColoring(coloringCtx);
    fragColor = mapColoringResult(coloringCtx, coloringResult);
`;
