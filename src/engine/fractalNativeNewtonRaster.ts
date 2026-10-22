import {FRACTAL_NATIVE_POWER_GLSL} from './fractalNativePowerGlsl';
import {FRACTAL_NATIVE_COLOR_GLSL,FRACTAL_NATIVE_COLOR_TAIL} from './fractalNativeColorGlsl';
import {fractalSourceRequire as require} from './fractalSourceGpuFailure';
import {FRACTAL_NATIVE_NEWTON_GLSL} from './fractalNativeNewtonGlsl';
import {fractalTrapGLSL} from './fractalColorGpu';

/** Sole decoder for the four-MRT protocol. The packed binary32 integer carries
 * actual fragment counters, never inferred CPU orbit/repaired classifications. */
export function decodeFractalSourceTerminal(iteration:number,packed:number,maxIter:number){
 require(Number.isInteger(iteration)&&iteration>=0&&iteration<maxIter&&Number.isInteger(packed)&&packed>=0&&packed<=49159,'Source fractal returned invalid terminal metadata','device');
 const escaped=packed>=32768,payload=packed%32768,flags=payload%8,perturbSteps=Math.floor(payload/8),converged=!!(flags&1),startedPerturb=!!(flags&2),glitches=(flags&4)?1:0,steps=iteration+1,ordinarySteps=steps-perturbSteps;
 require(perturbSteps<=steps&&(!startedPerturb?perturbSteps===0&&glitches===0:perturbSteps>0)&&(!glitches||startedPerturb),'Source fractal returned inconsistent execution facts','device');
 require(!(escaped&&converged),'Source fractal terminal cannot both escape and converge','device');
 return{iteration,steps,escaped,converged,startedPerturb,glitches,perturbSteps,ordinarySteps};
}

/** Retained source header/router/init/full numerical main. ES300 declarations,
 * two observational counter increments, and the four-MRT local color transport
 * are adaptations. Coordinates and orbit share this fragment invocation.
 * fractal_header.glsl SHA256 d19ae5d532643ba9a56c895d218672d1abf2a1822f7e9c0a599ced95c6a84d93
 * formula_param_slots.glsl SHA256 50605d3e6268cc1d8fc7e356836737d3e9012f9c8008d568b083310de76e33aa
 * formula_router.glsl SHA256 11a590c450f72db271bbeb5fe3bdb600498f07229fe9395470bd7a300e5dc8f1
 * pipeline/fractal_pipeline_capabilities.glsl SHA256 023db488912e709ba0f14a466ee57349ab4e886695247b44a7ec7fb9fc9ec353
 * pipeline/fractal_pipeline_init.glsl SHA256 f0d4aecd3a618151bea2393782b1201a10941f8b102c01d4d2be0f83424544d9
 * fractal_main.glsl SHA256 3caff012e4206d391b8ec2814626011e45126956872d0e05f6428bd1a70bf60d
 */
function rasterFragment(sourceColor:boolean):string{return `#version 300 es
precision highp float;precision highp int;precision highp sampler2D;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_previewScale;
uniform vec2 u_centerHigh;
uniform vec2 u_centerLow;
uniform vec2 u_zoomDS;
uniform int u_usePerturbation;
uniform int u_refOrbitLen;
uniform sampler2D u_refOrbitTex;
uniform float u_perturbationThreshold;
uniform float u_perturbationAbsFactor;
uniform float u_perturbationRelLimit;
uniform float u_rotation;
// 三轴环境旋转角度（ambient）：x=theta(绕Y), y=phi(绕X), z=gamma(绕Z)
// 由 FractalParamAnimation 的 ambient 动作驱动，Mandelbulb 3D 类型场景专用
uniform vec3 u_ambientRotation;
uniform int u_iterations;
uniform float u_bailout;
uniform int u_power;
uniform int u_formulaType;
uniform int u_formulaId;
uniform int u_formulaSupportsPerturbation;
uniform int u_type;
uniform vec4 u_formulaParams;
uniform float u_dynamicParams[32];
uniform vec2 u_juliaConstantHigh;
uniform vec2 u_juliaConstantLow;

uniform vec3 u_palette[16];
uniform int u_paletteSize;
uniform float u_paletteOffset;
uniform float u_paletteGamma;
uniform int u_paletteSpace;
uniform sampler2D u_gradientTex;
uniform int u_gradientSize;
uniform float u_insideColorDensity;
uniform int u_insideTransferFunction;
uniform float u_insideGradientOffset;
uniform int u_insideRepeatGradient;
uniform vec4 u_insideSolidColor;
uniform float u_outsideColorDensity;
uniform int u_outsideTransferFunction;
uniform float u_outsideGradientOffset;
uniform int u_outsideRepeatGradient;
uniform vec4 u_outsideSolidColor;

uniform int u_useCosinePalette;
uniform vec3 u_cosA;
uniform vec3 u_cosB;
uniform vec3 u_cosC;
uniform vec3 u_cosD;

in vec2 vUv;
layout(location=0)out vec4 sourceZ;
layout(location=1)out vec4 sourceTerminal;
layout(location=2)out vec4 sourceInside;
layout(location=3)out vec4 sourceOutside;

#define FID_MANDELBROT 0
#define FID_JULIA 1
#define FID_NEWTON 2
#define FID_NOVA 3
#define FID_PHOENIX 4
#define FID_MAGNET1 5
#define FID_MAGNET2 6
#define FID_LAMBDA 7
#define FID_C_SIN 8
#define FID_SPIRAL_SEPTAGON 9
#define FID_BINOCULAR 10
${sourceColor?FRACTAL_NATIVE_COLOR_GLSL:`// This explicit profile accepts only Newton/Nova. Existing local color/traps
// are transported separately; unused native color branches remain disabled.
const int CID_DIRECT_ORBIT_TRAP=8,CID_ORBIT_TRAP_INDEX=10,CID_DISTANCE_ESTIMATOR=6;
uniform int u_insideColoringAlgorithm,u_outsideColoringAlgorithm;
uniform vec4 u_insideColoringParams0,u_insideColoringParams1,u_insideColoringParams2,u_outsideColoringParams0,u_outsideColoringParams1,u_outsideColoringParams2;
vec2 orbitTrapTransform(vec2 z,vec4 p){return z;}
float orbitTrapDistance(vec2 z,vec4 a,vec4 b){return 0.;}
vec3 directOrbitTrapColorByDistance(float d,vec2 r,vec2 i,vec4 a,vec4 b){return vec3(0.);}
float directOrbitTrapLayerAlpha(float d,vec4 a){return 0.;}
`}uniform vec4 legacyTrap;uniform vec3 legacyTrapShape;
float localTrap(vec2 z){vec2 q=z-legacyTrap.xy;float co=legacyTrapShape.x,si=legacyTrapShape.y;q=vec2((q.x*co-q.y*si)/legacyTrap.w,q.x*si+q.y*co);return legacyTrapShape.z>1.5?min(abs(q.x),abs(q.y)):legacyTrapShape.z>.5?abs(length(q)-legacyTrap.z):length(q);}

${FRACTAL_NATIVE_NEWTON_GLSL}
${FRACTAL_NATIVE_POWER_GLSL}
${sourceColor?'':fractalTrapGLSL}
#define SLOT_POWER_RE 0
#define SLOT_POWER_IM 1
#define SLOT_RELAX 2
#define SLOT_BAILOUT 3
#define SLOT_SEED_RE 4
#define SLOT_SEED_IM 5
#define SLOT_A_RE 6
#define SLOT_A_IM 7
#define SLOT_PHI_RE 8
#define SLOT_PHI_IM 9
#define SLOT_SINGULARITY_GUARD_EPS 10
#define SLOT_MB_PHASE_SHIFT 11
#define SLOT_MB_PHASE_SPEED 12
#define SLOT_MB_CAMERA_RADIUS 13
#define SLOT_MB_CAMERA_PITCH 14
#define SLOT_MB_ROTATION_SPEED 15
#define SLOT_MB_SURFACE_EPSILON 16
#define SLOT_MB_SHADOW_STRENGTH 17
#define SLOT_MB_RAY_SCALE 18
#define SLOT_BIN_CONST_RE 19
#define SLOT_BIN_CONST_IM 20
#define SLOT_BIN_Z0_RE 21
#define SLOT_BIN_Z0_IM 22
#define SLOT_BIN_DENOM 23

void evalFormulaFamilyStep(int fid,vec2 zr,vec2 zi,vec2 cr,vec2 ci,int ft,vec2 pr,vec2 pi,float relax,out vec2 nr,out vec2 ni){if(fid==FID_NEWTON)iterateNewton(zr,zi,pr,pi,relax,nr,ni);else if(fid==FID_NOVA)iterateNova(zr,zi,cr,ci,pr,pi,relax,nr,ni);else iterateFormula(zr,zi,cr,ci,ft,pr,pi,nr,ni);}
// Unselected other-family call required by the retained runtime router. The
// typed profile/plan rejects every family except Newton/Nova/Mandelbrot/Julia before allocation.
void iteratePhoenix(vec2 zr,vec2 zi,vec2 hr,vec2 hi,vec2 cr,vec2 ci,int p,int p2,vec2 dr,vec2 di,out vec2 nr,out vec2 ni){nr=zr;ni=zi;}
bool formulaIsNewton(int fid) {
#if ENABLE_NEWTON == 1
    return fid == FID_NEWTON;
#else
    return false;
#endif
}

bool formulaIsNova(int fid) {
#if ENABLE_NOVA == 1
    return fid == FID_NOVA;
#else
    return false;
#endif
}

bool formulaIsPhoenix(int fid) {
    return fid == FID_PHOENIX;
}

bool formulaIsMagnet1(int fid) {
    return fid == FID_MAGNET1;
}

bool formulaIsMagnet2(int fid) {
    return fid == FID_MAGNET2;
}

bool formulaIsMagnet(int fid) {
    return fid == FID_MAGNET1 || fid == FID_MAGNET2;
}

bool formulaIsLambda(int fid) {
    return fid == FID_LAMBDA;
}

bool formulaIsCSin(int fid) {
    return fid == FID_C_SIN;
}

bool formulaIsSpiralSeptagon(int fid) {
    return fid == FID_SPIRAL_SEPTAGON;
}

bool formulaIsBinocular(int fid) {
    return fid == FID_BINOCULAR;
}

bool formulaIsJulia(int fid, int type) {
    if (fid == FID_JULIA) return true;
    if (type != 1) return false;
    return formulaIsNova(fid)
            || formulaIsPhoenix(fid)
            || formulaIsMagnet(fid)
            || formulaIsLambda(fid)
            || formulaIsCSin(fid)
            || formulaIsSpiralSeptagon(fid)
            || formulaIsBinocular(fid);
}

void evalFormulaStep(int fid, vec2 zr, vec2 zi, vec2 cr, vec2 ci, int formulaType, vec2 pr, vec2 pi, float relax, out vec2 nr, out vec2 ni) {
    evalFormulaFamilyStep(fid, zr, zi, cr, ci, formulaType, pr, pi, relax, nr, ni);
}

int resolveFormulaId() {
    int fid = u_formulaId >= 0 ? u_formulaId : (u_type == 1 ? FID_JULIA : FID_MANDELBROT);
#if ENABLE_NEWTON == 0
    if (fid == FID_NEWTON) fid = u_type == 1 ? FID_JULIA : FID_MANDELBROT;
#endif
#if ENABLE_NOVA == 0
    if (fid == FID_NOVA) fid = u_type == 1 ? FID_JULIA : FID_MANDELBROT;
#endif
    return fid;
}
bool allowPowerPerturbation(bool isNewton, bool isNova, bool isPhoenix, bool isMagnet, bool isLambda, bool isCSin, bool isSpiralSeptagon) {
    return !isNewton && !isNova && !isPhoenix && !isMagnet && !isLambda && !isCSin && !isSpiralSeptagon;
}

bool allowNewtonPerturbation(bool isNewton, bool isNova, vec2 pr, vec2 pi) {
    if (!isNewton && !isNova) {
        return false;
    }
    bool isIntPower = abs(pi.x) < 1e-6 && abs(pr.x - floor(pr.x + 0.5)) < 1e-6;
    return isIntPower;
}

bool supportsDistanceEstimator(
    bool isNewton,
    bool isNova,
    bool isPhoenix,
    bool isMagnet,
    bool isLambda,
    bool isCSin,
    bool isSpiralSeptagon,
    int formulaType,
    bool isIntegerPower,
    int p,
    int insideColoring,
    int outsideColoring
) {
    bool needsDistanceEstimator = (outsideColoring == CID_DISTANCE_ESTIMATOR) || (insideColoring == CID_DISTANCE_ESTIMATOR);
    return needsDistanceEstimator
            && !isNewton
            && !isNova
            && !isPhoenix
            && !isMagnet
            && !isLambda
            && !isCSin
            && !isSpiralSeptagon
            && (formulaType == 0)
            && isIntegerPower
            && (p >= 2);
}
void resolveFormulaFlags(
    int formulaId,
    int formulaType,
    out bool isNewton,
    out bool isNova,
    out bool isPhoenix,
    out bool isMagnet1,
    out bool isMagnet2,
    out bool isMagnet,
    out bool isLambda,
    out bool isSpiralSeptagon,
    out bool isJulia
) {
    isNewton = formulaIsNewton(formulaId);
    isNova = formulaIsNova(formulaId);
    isPhoenix = formulaIsPhoenix(formulaId);
    isMagnet1 = formulaIsMagnet1(formulaId);
    isMagnet2 = formulaIsMagnet2(formulaId);
    isMagnet = isMagnet1 || isMagnet2;
    isLambda = formulaIsLambda(formulaId);
    isSpiralSeptagon = formulaIsSpiralSeptagon(formulaId);
    isJulia = formulaIsJulia(formulaId, formulaType);
}

void setupInitialOrbitState(
    bool isNewton,
    bool isNova,
    bool isPhoenix,
    bool isMagnet,
    bool isLambda,
    bool isCSin,
    bool isSpiralSeptagon,
    bool isBinocular,
    bool isJulia,
    vec2 ox,
    vec2 oy,
    out vec2 zr,
    out vec2 zi,
    out vec2 cr,
    out vec2 ci
) {
    vec2 centerX = vec2(u_centerHigh.x, u_centerLow.x);
    vec2 centerY = vec2(u_centerHigh.y, u_centerLow.y);
    zr = ds_add(centerX, ox);
    zi = ds_add(centerY, oy);
    if (isBinocular) {
        // z0 rides on cr/ci: pixel coordinate (Mandelbrot variant) or julia seed (Julia variant)
        if (isJulia) {
            cr = vec2(u_juliaConstantHigh.x, u_juliaConstantLow.x);
            ci = vec2(u_juliaConstantHigh.y, u_juliaConstantLow.y);
        } else {
            cr = zr;
            ci = zi;
        }
        return;
    }
    if (isNewton) {
        cr = vec2(u_juliaConstantHigh.x, u_juliaConstantLow.x);
        ci = vec2(u_juliaConstantHigh.y, u_juliaConstantLow.y);
    } else if (isJulia) {
        cr = vec2(u_juliaConstantHigh.x, u_juliaConstantLow.x);
        ci = vec2(u_juliaConstantHigh.y, u_juliaConstantLow.y);
    } else {
        cr = zr;
        ci = zi;
        if (isNova || isLambda || isCSin || isSpiralSeptagon) {
            zr = vec2(u_juliaConstantHigh.x, u_juliaConstantLow.x);
            zi = vec2(u_juliaConstantHigh.y, u_juliaConstantLow.y);
        } else {
            zr = ds_set(0.0);
            zi = ds_set(0.0);
        }
    }
    if (!isJulia && isPhoenix) {
        zr = vec2(u_juliaConstantHigh.x, u_juliaConstantLow.x);
        zi = vec2(u_juliaConstantHigh.y, u_juliaConstantLow.y);
    }
    if (isMagnet && !isJulia) {
        zr = vec2(u_juliaConstantHigh.x, u_juliaConstantLow.x);
        zi = vec2(u_juliaConstantHigh.y, u_juliaConstantLow.y);
    }
}

void setupRuntimeFormulaParams(
    bool isMagnet,
    bool isLambda,
    bool isNewton,
    bool isNova,
    bool isBinocular,
    float baseEscapeRadius2,
    out float escapeRadius2,
    out float powerF,
    out bool isIntegerPower,
    out int p,
    out vec2 pr,
    out vec2 pi,
    out float relax,
    out int p2,
    out vec2 distR,
    out vec2 distI,
    out float convBailout2,
    out float convergenceThreshold2
) {
    escapeRadius2 = baseEscapeRadius2;
    powerF = float(u_power);
    if (!isMagnet && !isLambda) {
        if (u_formulaParams.x > 0.0) {
            powerF = u_formulaParams.x;
        }
    }
    isIntegerPower = abs(powerF - floor(powerF + 0.5)) < 1e-6;
    p = max(int(floor(powerF + 0.5)), 2);
    pr = ds_set(powerF);
    pi = ds_set(0.0);
    relax = 1.0;
    if (isNewton) {
        pr = ds_set(u_dynamicParams[SLOT_POWER_RE]);
        pi = ds_set(u_dynamicParams[SLOT_POWER_IM]);
        relax = u_dynamicParams[SLOT_RELAX];
        p = int(floor(u_dynamicParams[SLOT_POWER_RE] + 0.5));
    } else if (isNova) {
        pr = ds_set(u_dynamicParams[SLOT_POWER_RE]);
        pi = ds_set(u_dynamicParams[SLOT_POWER_IM]);
        relax = u_dynamicParams[SLOT_RELAX];
        p = int(floor(u_dynamicParams[SLOT_POWER_RE] + 0.5));
    } else if (isBinocular) {
        pr = ds_set(u_dynamicParams[SLOT_POWER_RE]);
        pi = ds_set(u_dynamicParams[SLOT_POWER_IM]);
        relax = u_dynamicParams[SLOT_RELAX];
        p = max(int(floor(u_dynamicParams[SLOT_POWER_RE] + 0.5)), 2);
    } else if (isNewton || isNova) {
        relax = u_formulaParams.y > 0.0 ? u_formulaParams.y : 1.0;
    }
    p2 = max(int(floor(u_formulaParams.y + 0.5)), 0);
    distR = ds_set(u_formulaParams.z);
    distI = ds_set(u_formulaParams.w);
    float convBailout = isMagnet ? max(u_formulaParams.x, 0.0) : 0.0;
    convBailout2 = convBailout * convBailout;
    convergenceThreshold2 = escapeRadius2;
    if (isNova) {
        float zoomVal = max(u_zoomDS.x + u_zoomDS.y, 1.0e-12);
        float minRes = max(min(u_resolution.x, u_resolution.y), 1.0);
        float pixelSpan = 2.0 / (zoomVal * minRes);
        float userConv = sqrt(max(escapeRadius2, 1.0e-30));
        float autoConv = max(pixelSpan * 64.0, 1.0e-16);
        float minConv = max(userConv * 1.0e-3, 1.0e-12);
        float conv = max(min(userConv, autoConv), minConv);
        convergenceThreshold2 = conv * conv;
    }
}
vec2 cMulF(vec2 a, vec2 b) {
    return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

vec2 cAddF(vec2 a, vec2 b) {
    return vec2(a.x + b.x, a.y + b.y);
}

vec2 cPowIntF(vec2 z, int exp) {
    vec2 result = vec2(1.0, 0.0);
    for (int i = 0; i < 64; i++) {
        if (i >= exp) {
            break;
        }
        result = cMulF(result, z);
    }
    return result;
}

void main() {
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    vec2 uvBase = vUv;
    if (u_previewScale < 0.999) {
        vec2 scaledRes = max(u_resolution * u_previewScale, vec2(1.0));
        uvBase = floor(uvBase * scaledRes) / scaledRes;
    }
    vec2 uv = uvBase * 2.0 - 1.0;
    uv.x *= aspect;
    uv = rotateVec(uv, u_rotation);
    
    vec2 dsScale = ds_div(ds_set(1.0), u_zoomDS);
    vec2 ox = ds_mul(ds_set(uv.x), dsScale);
    vec2 oy = ds_mul(ds_set(uv.y), dsScale);
    
    int formulaId = resolveFormulaId();
    bool isNewton;
    bool isNova;
    bool isPhoenix;
    bool isMagnet1;
    bool isMagnet2;
    bool isMagnet;
    bool isLambda;
    bool isCSin;
    bool isSpiralSeptagon;
    bool isJulia;
    resolveFormulaFlags(
        formulaId,
        u_type,
        isNewton,
        isNova,
        isPhoenix,
        isMagnet1,
        isMagnet2,
        isMagnet,
        isLambda,
        isSpiralSeptagon,
        isJulia
    );
    isCSin = formulaIsCSin(formulaId);
    bool isBinocular = formulaIsBinocular(formulaId);
    vec2 zr;
    vec2 zi;
    vec2 cr;
    vec2 ci;
    setupInitialOrbitState(
        isNewton,
        isNova,
        isPhoenix,
        isMagnet,
        isLambda,
        isCSin,
        isSpiralSeptagon,
        isBinocular,
        isJulia,
        ox,
        oy,
        zr,
        zi,
        cr,
        ci
    );

    float baseEscapeRadius2 = u_bailout * u_bailout;
    int iter = 0;
    float escapeRadius2;
    float powerF;
    bool isIntegerPower;
    int p;
    vec2 pr;
    vec2 pi;
    float relax;
    int p2;
    vec2 distR;
    vec2 distI;
    float convBailout2;
    float convergenceThreshold2;
    setupRuntimeFormulaParams(
        isMagnet,
        isLambda,
        isNewton,
        isNova,
        isBinocular,
        baseEscapeRadius2,
        escapeRadius2,
        powerF,
        isIntegerPower,
        p,
        pr,
        pi,
        relax,
        p2,
        distR,
        distI,
        convBailout2,
        convergenceThreshold2
    );
    vec2 zprevR = ds_set(0.0);
    vec2 zprevI = ds_set(0.0);
    int maxIter = u_iterations;
    int exitKind = 0;
    vec2 delta_r = ds_set(0.0);
    vec2 delta_i = ds_set(0.0);
    vec2 delta_c_r = ds_set(0.0);
    vec2 delta_c_i = ds_set(0.0);
    bool trackTrapInside = (u_insideColoringAlgorithm == CID_DIRECT_ORBIT_TRAP) || (u_insideColoringAlgorithm == CID_ORBIT_TRAP_INDEX);
    bool trackTrapOutside = (u_outsideColoringAlgorithm == CID_DIRECT_ORBIT_TRAP) || (u_outsideColoringAlgorithm == CID_ORBIT_TRAP_INDEX);
    bool directTrapInside = (u_insideColoringAlgorithm == CID_DIRECT_ORBIT_TRAP);
    bool directTrapOutside = (u_outsideColoringAlgorithm == CID_DIRECT_ORBIT_TRAP);
    vec4 insideTrapParams0 = u_insideColoringParams0;
    vec4 insideTrapParams1 = u_insideColoringParams1;
    vec4 insideTrapParams2 = u_insideColoringParams2;
    vec4 outsideTrapParams0 = u_outsideColoringParams0;
    vec4 outsideTrapParams1 = u_outsideColoringParams1;
    vec4 outsideTrapParams2 = u_outsideColoringParams2;
    float minTrapInside = 1.0e20;
    float minTrapOutside = 1.0e20;
    vec3 directAccumInside = u_insideSolidColor.rgb;
    vec3 directAccumOutside = u_outsideSolidColor.rgb;
    float finalResidual = 0.0;
    bool allowPowerPerturb = allowPowerPerturbation(isNewton, isNova, isPhoenix, isMagnet, isLambda, isCSin, isSpiralSeptagon);
    bool allowNewtonPerturb = allowNewtonPerturbation(isNewton, isNova, pr, pi);
    bool canPowerPerturb = allowPowerPerturb && isIntegerPower;
    bool isSupported = (u_formulaSupportsPerturbation == 1)
            && ((canPowerPerturb && (u_formulaType == 0) && (p >= 2)) || allowNewtonPerturb);
    bool perturbActive = isSupported && (u_usePerturbation == 1 && u_refOrbitLen > 0);
    int nativePerturbSteps=0,nativeGlitches=0;bool nativeStarted=perturbActive;
    float nativeNearest=3.402823466e38;
    if (perturbActive) {
        maxIter = min(u_iterations, u_refOrbitLen);
        if (isNewton || (isNova && isJulia) || (!isNewton && !isNova && isJulia)) {
            delta_r = ox;
            delta_i = oy;
        } else {
            delta_c_r = ox;
            delta_c_i = oy;
        }
    }
    float initialDelta2 = ox.x * ox.x + oy.x * oy.x;
    float adaptivePerturbThreshold = max(u_perturbationThreshold, initialDelta2 * 64.0);
    bool canComputeDistanceEstimate = supportsDistanceEstimator(
            isNewton,
            isNova,
            isPhoenix,
            isMagnet,
            isLambda,
            isCSin,
            isSpiralSeptagon,
            u_formulaType,
            isIntegerPower,
            p,
            u_insideColoringAlgorithm,
            u_outsideColoringAlgorithm
    );
    vec2 deDz = isJulia ? vec2(1.0, 0.0) : vec2(0.0, 0.0);
    vec2 deBias = isJulia ? vec2(0.0, 0.0) : vec2(1.0, 0.0);
    float deDistance = 0.0;
    int deDistanceValid = 0;
    
    for (int i = 0; i < 2048; i++) {
        if (i >= maxIter) break;
        if (perturbActive) {
            nativePerturbSteps++;
            vec4 ref = texelFetch(u_refOrbitTex, ivec2(i, 0), 0);
            vec2 zref_r = vec2(ref.r, ref.g);
            vec2 zref_i = vec2(ref.b, ref.a);
            zr = ds_add(zref_r, delta_r);
            zi = ds_add(zref_i, delta_i);
            vec2 trapPoint = vec2(zr.x, zi.x);
            ${sourceColor?'':'traceStep(trapPoint);'}
            float nativeDistance=localTrap(trapPoint);
            if(!isnan(nativeDistance)&&!isinf(nativeDistance))nativeNearest=min(nativeNearest,nativeDistance);
            if (trackTrapInside) {
                vec2 transformedInside = orbitTrapTransform(trapPoint, insideTrapParams1);
                float dInside = orbitTrapDistance(transformedInside, insideTrapParams0, insideTrapParams2);
                if (!isnan(dInside) && !isinf(dInside) && dInside < minTrapInside) minTrapInside = dInside;
                if (directTrapInside && dInside < max(insideTrapParams2.x, 1.0e-6)) {
                    vec3 currentInside = directOrbitTrapColorByDistance(dInside, zr, zi, insideTrapParams0, insideTrapParams2);
                    float alphaInside = directOrbitTrapLayerAlpha(dInside, insideTrapParams2);
                    directAccumInside = mix(directAccumInside, currentInside, alphaInside);
                }
            }
            if (trackTrapOutside) {
                vec2 transformedOutside = orbitTrapTransform(trapPoint, outsideTrapParams1);
                float dOutside = orbitTrapDistance(transformedOutside, outsideTrapParams0, outsideTrapParams2);
                if (!isnan(dOutside) && !isinf(dOutside) && dOutside < minTrapOutside) minTrapOutside = dOutside;
                if (directTrapOutside && dOutside < max(outsideTrapParams2.x, 1.0e-6)) {
                    vec3 currentOutside = directOrbitTrapColorByDistance(dOutside, zr, zi, outsideTrapParams0, outsideTrapParams2);
                    float alphaOutside = directOrbitTrapLayerAlpha(dOutside, outsideTrapParams2);
                    directAccumOutside = mix(directAccumOutside, currentOutside, alphaOutside);
                }
            }
            float tr = zr.x * zr.x + zi.x * zi.x;
            if (canComputeDistanceEstimate) {
                vec2 zf = vec2(zr.x, zi.x);
                vec2 zPowM1 = cPowIntF(zf, p - 1);
                vec2 term = cMulF(vec2(float(p), 0.0), cMulF(zPowM1, deDz));
                deDz = cAddF(term, deBias);
            }
            
            // Check escape/convergence
            if (!isNova && !isNewton && ds_mag_sqr_gt(zr, zi, escapeRadius2)) {
                iter = i;
                exitKind = 1;
                break;
            }
            
            vec2 new_delta_r, new_delta_i;
            
            if (isNewton || isNova) {
                // IMPORTANT: For Newton/Nova, Delta calculation depends on Z_ref and Delta
                // The formula derivation:
                // z_{n+1} = N(z_n)
                // z_{n+1} + \Delta_{n+1} = N(z_n + \Delta_n)
                // \Delta_{n+1} = N(z_n + \Delta_n) - N(z_n)
                // This logic is encapsulated in ds_deltaNewton.
                // However, ds_deltaNewton calculates the full step delta based on current z (zref) and delta.
                ds_deltaNewton(zref_r, zref_i, delta_r, delta_i, p, relax, new_delta_r, new_delta_i);
                
                if (isNova) {
                    // Nova: z_{n+1} = z_n - relax * (z_n^p - 1)/(p*z_n^{p-1}) + c
                    // Reference orbit includes c.
                    // Perturbed orbit: (z+d)_{n+1} = (z+d)_n - relax * ... + c
                    // Difference cancels c out.
                    // So Nova delta update is exactly the same as Newton delta update!
                    // No need to add delta_c_r/i unless c itself is perturbed (Julia set variation).
                    // If Nova is Julia type, c is constant across image, so delta_c is 0.
                    // If Nova is Mandelbrot type, c = pixel coordinate.
                    // Reference orbit uses c_center.
                    // Perturbed orbit uses c_pixel = c_center + delta_c.
                    // So yes, we DO need to add delta_c if it's not Julia.
                    if (!isJulia) {
                         new_delta_r = ds_add(new_delta_r, delta_c_r);
                         new_delta_i = ds_add(new_delta_i, delta_c_i);
                    }
                }
            } else {
                // Standard Power Formula (Mandelbrot/Julia)
                ds_deltaPow(zref_r, zref_i, delta_r, delta_i, p, new_delta_r, new_delta_i);
                new_delta_r = ds_add(new_delta_r, delta_c_r);
                new_delta_i = ds_add(new_delta_i, delta_c_i);
            }
            
            delta_r = new_delta_r;
            delta_i = new_delta_i;

            if (isNewton || isNova) {
                int nextIdx = i + 1;
                if (nextIdx < maxIter) {
                    vec4 refNext = texelFetch(u_refOrbitTex, ivec2(nextIdx, 0), 0);
                    vec2 zNextRefR = vec2(refNext.r, refNext.g);
                    vec2 zNextRefI = vec2(refNext.b, refNext.a);
                    vec2 zNextR = ds_add(zNextRefR, delta_r);
                    vec2 zNextI = ds_add(zNextRefI, delta_i);
                    vec2 dzr = ds_sub(zNextR, zr);
                    vec2 dzi = ds_sub(zNextI, zi);
                    float dx = dzr.x;
                    float dy = dzi.x;
                    float step2 = dx * dx + dy * dy;
                    if (step2 < convergenceThreshold2) {
                        finalResidual = step2;
                        iter = i;
                        exitKind = 2;
                        break;
                    }
                }
            }
            
            // Check for perturbation validity (glitch detection)
            // If |delta| is too large relative to |z|, precision loss occurs.
            // Or if delta grows too big, we should fallback to high-precision full calculation (not possible in float shader).
            // A simple heuristic: if delta magnitude squared > threshold, fallback.
            // But 'perturbActive = false' will switch to standard float iteration in the NEXT step.
            // Standard float iteration at zoom 1e15 is useless (garbage).
            // So disabling perturbation at deep zoom just gives pixelated noise, which is what "disappearing" means.
            // The issue might be that delta grows too large?
            // For Newton, we converge, so delta should shrink?
            // Actually, if we are near a root, z converges, delta converges.
            
            float dm = delta_r.x * delta_r.x + delta_i.x * delta_i.x;
            float zrefm = zref_r.x * zref_r.x + zref_i.x * zref_i.x;
            float relDelta = dm / max(zrefm, 1.0e-30);
            float adaptiveAbsLimit = adaptivePerturbThreshold * max(u_perturbationAbsFactor, 1.0);
            float adaptiveRelLimit = max(u_perturbationRelLimit, 1.0e-12);
            bool deltaInvalid = isnan(dm) || isinf(dm) || isnan(relDelta) || isinf(relDelta);
            if (isNewton || isNova) {
                if (deltaInvalid || dm > adaptiveAbsLimit || relDelta > adaptiveRelLimit) {
                    nativeGlitches++;perturbActive = false;
                }
            } else if (dm > adaptivePerturbThreshold) {
                perturbActive = false;
            }
        } else {
            vec2 zr_old = zr;
            vec2 zi_old = zi;
            vec2 trapPoint = vec2(zr_old.x, zi_old.x);
            ${sourceColor?'':'traceStep(trapPoint);'}
            float nativeDistance=localTrap(trapPoint);
            if(!isnan(nativeDistance)&&!isinf(nativeDistance))nativeNearest=min(nativeNearest,nativeDistance);
            if (trackTrapInside) {
                vec2 transformedInside = orbitTrapTransform(trapPoint, insideTrapParams1);
                float dInside = orbitTrapDistance(transformedInside, insideTrapParams0, insideTrapParams2);
                if (!isnan(dInside) && !isinf(dInside) && dInside < minTrapInside) minTrapInside = dInside;
                if (directTrapInside && dInside < max(insideTrapParams2.x, 1.0e-6)) {
                    vec3 currentInside = directOrbitTrapColorByDistance(dInside, zr_old, zi_old, insideTrapParams0, insideTrapParams2);
                    float alphaInside = directOrbitTrapLayerAlpha(dInside, insideTrapParams2);
                    directAccumInside = mix(directAccumInside, currentInside, alphaInside);
                }
            }
            if (trackTrapOutside) {
                vec2 transformedOutside = orbitTrapTransform(trapPoint, outsideTrapParams1);
                float dOutside = orbitTrapDistance(transformedOutside, outsideTrapParams0, outsideTrapParams2);
                if (!isnan(dOutside) && !isinf(dOutside) && dOutside < minTrapOutside) minTrapOutside = dOutside;
                if (directTrapOutside && dOutside < max(outsideTrapParams2.x, 1.0e-6)) {
                    vec3 currentOutside = directOrbitTrapColorByDistance(dOutside, zr_old, zi_old, outsideTrapParams0, outsideTrapParams2);
                    float alphaOutside = directOrbitTrapLayerAlpha(dOutside, outsideTrapParams2);
                    directAccumOutside = mix(directAccumOutside, currentOutside, alphaOutside);
                }
            }
            if (canComputeDistanceEstimate) {
                vec2 zf = vec2(zr_old.x, zi_old.x);
                vec2 zPowM1 = cPowIntF(zf, p - 1);
                vec2 term = cMulF(vec2(float(p), 0.0), cMulF(zPowM1, deDz));
                deDz = cAddF(term, deBias);
            }
            vec2 nr, ni;
            if (isPhoenix) {
                iteratePhoenix(zr, zi, zprevR, zprevI, cr, ci, p, p2, distR, distI, nr, ni);
                zprevR = zr;
                zprevI = zi;
            } else {
                evalFormulaStep(formulaId, zr, zi, cr, ci, u_formulaType, pr, pi, relax, nr, ni);
            }
            zr = nr;
            zi = ni;
            float tr = zr.x * zr.x + zi.x * zi.x;
            if (isNewton || isNova || isBinocular) {
                vec2 dzr = ds_sub(zr, zr_old);
                vec2 dzi = ds_sub(zi, zi_old);
                float dx = dzr.x;
                float dy = dzi.x;
                if ((dx*dx + dy*dy) < convergenceThreshold2) {
                    finalResidual = dx*dx + dy*dy;
                    iter = i;
                    exitKind = 2;
                    break;
                }
                if (isBinocular) {
                    // divergent or NaN orbits (near-singular denominators) escape early
                    if (!(tr >= 0.0) || ds_mag_sqr_gt(zr, zi, 1.0e12)) {
                        iter = i;
                        exitKind = 1;
                        break;
                    }
                }
            } else if (isMagnet) {
                if (convBailout2 > 0.0) {
                    if (isMagnet2) {
                        if (isJulia) {
                            vec2 dzr = ds_sub(zr, zr_old);
                            vec2 dzi = ds_sub(zi, zi_old);
                            float dx = dzr.x;
                            float dy = dzi.x;
                            float step2 = dx * dx + dy * dy;
                            if (tr < escapeRadius2 && step2 < convBailout2) {
                                finalResidual = step2;
                                iter = i;
                                exitKind = 2;
                                break;
                            }
                        } else {
                            vec2 toOneR = ds_sub(zr, ds_set(1.0));
                            vec2 toOneI = zi;
                            float dx = toOneR.x;
                            float dy = toOneI.x;
                            float oneDist2 = dx * dx + dy * dy;
                            if (tr < escapeRadius2 && oneDist2 < convBailout2) {
                                finalResidual = oneDist2;
                                iter = i;
                                exitKind = 2;
                                break;
                            }
                        }
                    } else {
                        vec2 toOneR = ds_sub(zr, ds_set(1.0));
                        vec2 toOneI = zi;
                        float dx = toOneR.x;
                        float dy = toOneI.x;
                        if (tr < escapeRadius2 && (dx * dx + dy * dy) < convBailout2) {
                            iter = i;
                            exitKind = 2;
                            break;
                        }
                    }
                }
                if (tr >= escapeRadius2 || ds_mag_sqr_gt(zr, zi, escapeRadius2)) {
                    iter = i;
                    exitKind = 1;
                    break;
                }
            } else if (ds_mag_sqr_gt(zr, zi, escapeRadius2)) {
                iter = i;
                exitKind = 1;
                break;
            }
        }
        iter = i;
    }


    sourceZ=vec4(zr,zi);
    // All packed integers <= 49159 are exactly representable in binary32.
    int terminalPacked=8*nativePerturbSteps+4*nativeGlitches+2*(nativeStarted?1:0)+(exitKind==2?1:0)+(exitKind==1?32768:0);
    sourceTerminal=vec4(float(iter),float(terminalPacked),finalResidual,nativeNearest);
    ${sourceColor?`vec4 fragColor;
${FRACTAL_NATIVE_COLOR_TAIL}
    sourceInside=fragColor;
    sourceOutside=vec4(minTrapInside,minTrapOutside,coloringResult.index,float(coloringResult.valid));`:'sourceInside=traceInside;sourceOutside=traceOutside;'}
}
`;}

/** Omission keeps the accepted four-float transport byte for byte. */
export const FRACTAL_SOURCE_RASTER_FRAGMENT=rasterFragment(false);
/** Native color uses attachment 2 RGBA8; coordinate, orbit, trace and color share one invocation. */
export const FRACTAL_SOURCE_COLOR_RASTER_FRAGMENT=rasterFragment(true);
