/** MathArt 1.7.8 perlin_noise_frag.glsl adapted to WebGL2.
 * Original shader SHA256 1468e5633387c8353a6c821912d51d1063768fc6e241fe52f066ff5d3441fafc.
 * Only version/precision declarations differ; host textures, coordinates and
 * sampling policy are owned by sourcePerlinGpu. Same-browser comparisons do
 * not establish native GLSL/driver transcendental or framebuffer parity. */
export const sourcePerlinGpuVertex=`#version 300 es
precision highp float;
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}`;
export const sourcePerlinGpuFragment=`#version 300 es
precision highp float;
precision highp int;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_noiseFrequency;
uniform float u_warpAmplitude;
uniform float u_warpFrequency;
uniform float u_directionOffset;
uniform float u_timeSpeed;
uniform int u_marchSteps;
uniform float u_stepSize;
uniform float u_brightness;
uniform float u_vignettePower;
uniform float u_fiberStrength;
uniform int u_renderStyle;
uniform float u_paletteSize;
uniform sampler2D u_palette;
uniform sampler2D u_channel0;
uniform int u_useChannel0;

out vec4 fragColor;

float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

float noise(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float n = i.x + i.y * 57.0;
    return mix(mix(hash(n + 0.0), hash(n + 1.0), f.x),
               mix(hash(n + 57.0), hash(n + 58.0), f.x), f.y);
}

vec2 rot(vec2 p, float t) {
    float c = cos(t);
    float s = sin(t);
    return vec2(p.x * c + p.y * s, -p.x * s + p.y * c);
}

vec2 map(vec2 p, float offset) {
    p.x += u_warpAmplitude * sin(u_time * u_timeSpeed + u_warpFrequency * p.y);
    p.y += u_warpAmplitude * sin(u_time * u_timeSpeed + u_warpFrequency * p.x);
    float a = noise(p * u_noiseFrequency + vec2(sin(0.1 * u_time * u_timeSpeed))) * 6.2831853;
    a -= offset + u_directionOffset;
    return vec2(cos(a), sin(a));
}

float waterPotential(vec2 pos, float t) {
    vec3 p = vec3(pos + vec2(t * 0.4, 0.0), t);
    float n = noise(p.xy);
    n += 0.5 * noise(p.xy * 2.13 + vec2(p.z * 0.31, -p.z * 0.21));
    n += 3.0 * noise(pos * 0.333);
    return n;
}

vec2 waterField(vec2 pos, float t) {
    float freq = max(0.05, u_noiseFrequency);
    vec2 q = pos * freq;
    q = rot(q, u_directionOffset);
    q.x += u_warpAmplitude * sin(t + u_warpFrequency * q.y);
    q.y += u_warpAmplitude * sin(t + u_warpFrequency * q.x);
    float n = waterPotential(q, t);
    float e = max(0.01, 0.05 + 0.15 * u_stepSize);
    float nx = waterPotential(q + vec2(e, 0.0), t);
    float ny = waterPotential(q + vec2(0.0, e), t);
    return vec2(-(ny - n), nx - n) / e;
}

vec3 samplePalette(float t) {
    float x = clamp(t, 0.0, 1.0);
    if (u_paletteSize <= 1.0) {
        return texture(u_palette, vec2(0.5, 0.5)).rgb;
    }
    return texture(u_palette, vec2(x, 0.5)).rgb;
}

vec3 sampleChannel(vec2 uv) {
    vec2 tc = fract(uv * 0.5 + 0.5);
    vec3 base = texture(u_channel0, tc).rgb;
    float l = dot(base, vec3(0.3333333));
    vec3 mapped = samplePalette(l);
    return mix(samplePalette(fract(0.5 + 0.5 * uv.x)), mix(base, mapped, 0.72), clamp(u_fiberStrength, 0.0, 1.0));
}

vec3 renderFilamentStyle(vec2 p, vec2 uv, int marchSteps, float offset) {
    float acc = 0.0;
    vec3 col = vec3(0.0);
    vec2 rayUv = uv;
    for (int i = 0; i < 128; i++) {
        if (i >= marchSteps) {
            break;
        }
        vec2 dir = map(rayUv, offset);
        float h = float(i) / float(marchSteps);
        float w = 4.0 * h * (1.0 - h);
        vec3 baseCol = u_useChannel0 == 0 ? samplePalette(fract(0.5 + 0.5 * rayUv.x)) : sampleChannel(rayUv);
        vec3 ttt = w * baseCol;
        vec2 reflected = reflect(vec3(dir, 0.0), vec3(1.0, 0.0, 0.0)).xy;
        float shade = 0.5 - 0.5 * dot(reflected, vec2(0.70710678));
        ttt *= mix(vec3(0.6, 0.7, 0.7), vec3(1.0, 0.95, 0.9), shade);
        col += w * ttt;
        acc += w;
        rayUv += u_stepSize * dir;
    }
    col /= max(acc, 1e-5);
    float gg = dot(col, vec3(0.3333333));
    vec3 nor = normalize(vec3(dFdx(gg), 0.5, dFdy(gg)));
    col += vec3(0.35) * max(0.0, dot(nor, normalize(vec3(0.7, 0.01, 0.7))));
    vec2 di = map(rayUv, offset);
    col *= 0.65 + 0.35 * dot(di, vec2(0.70710678));
    col *= 0.20 + 0.80 * pow(4.0 * p.x * (1.0 - p.x), u_vignettePower);
    return col;
}

vec3 renderWaterStyle(vec2 p, vec2 uv, int marchSteps, float t) {
    vec2 srcUv = uv;
    vec3 d = vec3(0.0);
    vec3 e = vec3(0.0);
    vec2 advUv = uv;
    float lod = 0.0;
    float flowScale = u_stepSize * (0.8 + 3.0 * u_warpAmplitude);
    for (int i = 0; i < 128; i++) {
        if (i >= marchSteps) {
            break;
        }
        vec2 waterDir = waterField(advUv, t);
        vec2 newUv = waterDir * flowScale;
        float h = float(i) / float(marchSteps);
        float swirl = sin((h + 0.37) * 6.2831853 + u_directionOffset);
        vec2 driftA = vec2(0.03 * sin(0.23 * t), 0.02 * cos(0.19 * t));
        vec2 driftB = vec2(0.02 * cos(0.17 * t), -0.02 * sin(0.21 * t));
        d += sampleChannel(advUv + driftA + vec2(0.15 * swirl, -0.1 * swirl));
        e += sampleChannel(-advUv.yx * (2.0 + 0.4 * u_noiseFrequency) + driftB + vec2(0.07 * swirl, 0.12 * swirl));
        lod += length(newUv) * (3.0 + 2.0 * u_warpFrequency);
        advUv += newUv;
    }
    vec3 c = sampleChannel(advUv * 0.1 + t * 0.025);
    float norm = 1.0 / float(max(marchSteps, 1));
    d *= norm;
    e *= norm;
    float blendD = clamp(length(d) * (0.6 + 0.7 * u_fiberStrength), 0.0, 1.0);
    float blendE = clamp(length(e) * (0.6 + 0.7 * u_fiberStrength), 0.0, 1.0);
    c = mix(c, d, blendD);
    c = mix(c, e, blendE);
    float shimmer = 0.5 + 0.5 * sin(6.0 * srcUv.x + 3.0 * srcUv.y + t * (0.35 + 0.6 * u_timeSpeed));
    c *= 0.92 + 0.08 * shimmer;
    c *= 0.35 + 0.65 * pow(4.0 * p.x * (1.0 - p.x), max(0.05, u_vignettePower));
    c += 0.08 * vec3(pow(max(lod, 0.0), 0.5)) * samplePalette(fract(0.1 * lod));
    return c;
}

void main() {
    vec2 p = gl_FragCoord.xy / u_resolution.xy;
    vec2 uv = -1.0 + 2.0 * p;
    uv.x *= u_resolution.x / u_resolution.y;

    float offset = u_time * u_timeSpeed + p.x;
    float t = u_time * u_timeSpeed;
    int marchSteps = clamp(u_marchSteps, 1, 128);
    vec3 col;
    if (u_renderStyle == 1) {
        col = renderWaterStyle(p, uv, marchSteps, t);
    } else {
        col = renderFilamentStyle(p, uv, marchSteps, offset);
    }
    col *= u_brightness;

    fragColor = vec4(col, 1.0);
}
`;
