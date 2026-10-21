import type {SceneDocument} from '../types';
import type {SymmetryParameters} from '../scenes/iterated';
import {hasSymmetryCustom} from './symmetryCustom';

/** MathArt 1.7.8 SymmetryChaosFunctionGenerator class
 * SHA256 6a839bddc08c8ab095a6feccbf4542e4896e73d260d69d0c89e06c0cc8f0215a.
 * Retained generated arithmetic, including modified origin 0/0. This contract
 * is GPU-only; it does not claim native RNG, texture layout or pixel parity.
 */
export const SOURCE_SYMMETRY_MATH='mathart-1.7.8-gpu-v1' as const;
/** Mobject color uniforms, shared by built-in and custom calculate_next kernels.
 * Constructor/splatParticles hardcode these; BaseConfig colorSpeed is unused. */
export const SOURCE_SYMMETRY_GPU_DORMANT_COLOR=['iteratedColor','colorSpeed','colorPhase','stepMetricMin','stepMetricMax','stepMetricNormalize'] as const;
export const SOURCE_SYMMETRY_GPU_COLOR=Object.freeze({metricMin:0,metricMax:2,metricMode:'robust' as const,color:'step',colorSpeed:1,colorPhase:0});
export function usesSourceSymmetryGpu(scene:Pick<SceneDocument,'kind'|'settings'>):boolean {
 const model=scene.settings.symmetryMathModel;
 if(model===undefined||model==='legacy-v1')return false;
 if(model!==SOURCE_SYMMETRY_MATH||scene.kind!=='symmetry')throw new Error('未知源 Symmetry 数学模型');
 return true;
}
export function usesSourceSymmetryMath(scene:Pick<SceneDocument,'kind'|'settings'|'equations'>):boolean {
 if(!usesSourceSymmetryGpu(scene))return false;
 // Explicit custom source owns its own kernel; retain the built-in selection
 // so clearing that source restores the same authored built-in contract.
 return !hasSymmetryCustom(scene);
}
const STANDARD=`uniform float lambda;
uniform float alpha;
uniform float beta;
uniform float gamma;
uniform float omega;
uniform float symmetry_degree;

void calculate_next(in vec3 pos, out vec3 nextPos, out float stepMetric) {
    float x = pos.x;
    float y = pos.y;
    int symmetryN = clamp(int(round(symmetry_degree)), 2, 50);
    float zzbar = x * x + y * y;

    float zreal = x;
    float zimag = y;
    int zPowerLoopCount = max(0, symmetryN - 2);
    for (int i = 0; i < 48; ++i) {
        if (i >= zPowerLoopCount) break;
        float za = zreal * x - zimag * y;
        float zb = zimag * x + zreal * y;
        zreal = za;
        zimag = zb;
    }

    float zn = x * zreal - y * zimag;

    float p = lambda + alpha * zzbar + beta * zn;

    float xnew = p * x + gamma * zreal - omega * y;
    float ynew = p * y - gamma * zimag + omega * x;

    nextPos = vec3(xnew, ynew, 0.0);
    stepMetric = length(nextPos - pos);
}
`;
const MODIFIED=`uniform float lambda;
uniform float alpha;
uniform float beta;
uniform float gamma;
uniform float omega;
uniform float delta;
uniform float symmetry_degree;
uniform float delta_power;

void calculate_next(in vec3 pos, out vec3 nextPos, out float stepMetric) {
    float x = pos.x;
    float y = pos.y;
    int symmetryN = clamp(int(round(symmetry_degree)), 2, 50);
    int symmetryDeltaPower = clamp(int(round(delta_power)), 1, 6);
    float zzbar = x * x + y * y;

    float np_factor = 0.0;
    if (delta != 0.0) {
        float zabs = sqrt(zzbar);
        float ereal = x / zabs;
        float eimag = y / zabs;
        float zc = 1.0;
        float zd = 0.0;
        int npIterations = symmetryN * symmetryDeltaPower;
        for (int i = 0; i < 300; ++i) {
            if (i >= npIterations) break;
            float za = ereal * zc - eimag * zd;
            float zb = eimag * zc + ereal * zd;
            zc = za;
            zd = zb;
        }
        np_factor = zc * zabs;
    }

    float zreal = x;
    float zimag = y;
    int zPowerLoopCount = max(0, symmetryN - 2);
    for (int i = 0; i < 48; ++i) {
        if (i >= zPowerLoopCount) break;
        float za = zreal * x - zimag * y;
        float zb = zimag * x + zreal * y;
        zreal = za;
        zimag = zb;
    }

    float zn = x * zreal - y * zimag;

    float p = lambda + alpha * zzbar + beta * zn + delta * np_factor;

    float xnew = p * x + gamma * zreal - omega * y;
    float ynew = p * y - gamma * zimag + omega * x;

    nextPos = vec3(xnew, ynew, 0.0);
    stepMetric = length(nextPos - pos);
}
`;
export function sourceSymmetryGpuField(parameters:SymmetryParameters){
 const q=parameters,modified=q.template==='modified';
 const uniforms:Record<string,number>={lambda:q.lambda,alpha:q.alpha,beta:q.beta,gamma:q.gamma,omega:q.omega,symmetry_degree:q.n,...(modified?{delta:q.delta??0,delta_power:q.deltaPower??1}:{})};
 if(!Object.values(uniforms).every(v=>Number.isFinite(v)&&Number.isFinite(Math.fround(v))))throw new Error('源 Symmetry 参数超出 GPU float32');
 return {source:modified?MODIFIED:STANDARD,uniforms,key:SOURCE_SYMMETRY_MATH+':'+(modified?'modified':'standard'),sourceSymmetry:true as const};
}
