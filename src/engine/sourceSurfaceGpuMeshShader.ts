// Retained MathArt 1.7.8 mesh_vert_gpu.glsl and mesh_frag.glsl.
// Source SHA256: vertex 6190012867ac2a69204b75eaa52daa108b95eefdce5b085f80125ef0f2a7aa2f
// fragment fa42999e6d98ae7522a89734f747418f90a4a73840177832b419c4e84ec10e0f.
// Adapt only GLSL version/precision and seed transport: source vertex.xyz and
// normal.x become one position.xyzw attribute. Shader arithmetic stays intact.
const vertexTemplate=`precision highp float;
precision highp int;

uniform mat4 transform;
uniform mat4 modelview;
uniform mat4 projection;
uniform mat4 texMatrix;

uniform float time;

// position.x = u_start
// position.y = v_start
// position.z = u_speed
// position.w = v_speed (passed via normal attribute)
in vec4 position;

in vec4 color;
in vec2 texCoord;

out vec4 vertColor;
out vec2 vertTexCoord;
out vec3 vertNormal;
out vec3 vertPos; // World position for lighting

uniform vec3 surfaceScale;
uniform vec3 surfaceOffset;

uniform vec2 uLimits;
uniform vec2 vLimits;
uniform ivec2 isPeriodic;
uniform ivec2 isFlowing;
uniform int isTwistedU;
uniform int isTwistedV;
uniform int useWireframe;
uniform float wireframeDepthBias;

// Dynamic parameters
uniform float params[32];

// -----------------------------------------------------------
// Dynamic Injection
// -----------------------------------------------------------
vec3 getSurfacePos(float u, float v) {
    // %SURFACE_FUNCTION_BODY%
    return vec3(0.0, 0.0, 0.0);
}
// -----------------------------------------------------------

float pingPong(float val, float minVal, float maxVal) {
    float range = maxVal - minVal;
    if (range <= 0.00001) return minVal;
    float L = 2.0 * range;
    float t = val - minVal;
    t = mod(t, L);
    if (t < 0.0) t += L;
    return minVal + (range - abs(t - range));
}

float wrap(float val, float minVal, float maxVal) {
    float range = maxVal - minVal;
    if (range <= 0.00001) return minVal;
    float t = val - minVal;
    return minVal + mod(t, range);
}

void main() {
    // 1. Calculate u, v
    float rawU = position.x + position.z * time;
    float rawV = position.y + position.w * time; // v_speed stored in position.w

    float u = rawU;
    float v = rawV;
    float rangeU = uLimits.y - uLimits.x;
    float rangeV = vLimits.y - vLimits.x;

    if (isPeriodic.x != 0) {
        if (isFlowing.x != 0) {
            u = wrap(rawU, uLimits.x, uLimits.y);
        } else {
            u = pingPong(rawU, uLimits.x, uLimits.y);
        }
        if (isTwistedU != 0 && rangeU > 0.00001) {
            float wraps = floor((rawU - uLimits.x) / rangeU);
            if (wraps != 0.0) {
                if (mod(abs(wraps), 2.0) >= 1.0) {
                    v = vLimits.x + vLimits.y - v;
                }
            }
        }
    }

    if (isPeriodic.y != 0) {
        if (isFlowing.y != 0) v = wrap(rawV, vLimits.x, vLimits.y);
        else v = pingPong(rawV, vLimits.x, vLimits.y);
    }

    // 2. Calculate Position
    vec3 rawPos = getSurfacePos(u, v);
    vec3 pos = rawPos * surfaceScale + surfaceOffset;

    // 3. Calculate Normal (Finite Difference, seam-safe)
    float deltaU = max(abs(rangeU) * 1e-5, 1e-6);
    float deltaV = max(abs(rangeV) * 1e-5, 1e-6);

    float vN = v + deltaV;
    float uN = u + deltaU;
    if (uN > uLimits.y) {
        if (isPeriodic.x != 0) {
            uN = uLimits.x + (uN - uLimits.y);
            if (isTwistedU != 0) {
                vN = vLimits.x + vLimits.y - vN;
            }
        } else {
            uN = u - deltaU;
        }
    }
    if (vN > vLimits.y) {
        if (isPeriodic.y != 0) {
            vN = vLimits.x + (vN - vLimits.y);
            if (isTwistedV != 0) {
                uN = uLimits.x + uLimits.y - uN;
            }
        } else {
            vN = v - deltaV;
        }
    }

    vec3 posU = getSurfacePos(uN, v) * surfaceScale + surfaceOffset;
    vec3 posV = getSurfacePos(u, vN) * surfaceScale + surfaceOffset;

    vec3 du = posU - pos;
    vec3 dv = posV - pos;
    vec3 N = normalize(cross(du, dv));

    // 4. Outputs
    vertNormal = normalize((modelview * vec4(N, 0.0)).xyz); // Transform normal to view space
    vertPos = (modelview * vec4(pos, 1.0)).xyz; // View space position
    vertColor = color;

    // Normalize UVs for texture mapping [0..1]
    rangeU = uLimits.y - uLimits.x;
    rangeV = vLimits.y - vLimits.x;
    if (abs(rangeU) < 0.00001) rangeU = 1.0;
    if (abs(rangeV) < 0.00001) rangeV = 1.0;

    float normU = (u - uLimits.x) / rangeU;
    float normV = (v - vLimits.x) / rangeV;
    vertTexCoord = vec2(normU, normV);

    gl_Position = transform * vec4(pos, 1.0);
    if (useWireframe != 0) {
        gl_Position.z -= wireframeDepthBias * gl_Position.w;
    }
}
`;
export function sourceSurfaceGpuMeshVertex(functionBody:string):string {
 return vertexTemplate.replace('// %SURFACE_FUNCTION_BODY%',functionBody);
}
export const sourceSurfaceGpuMeshFragment=`precision highp float;
precision highp int;

uniform vec4 meshFillColor; // Base color if texture is missing
uniform float meshFillOpacity;
uniform vec4 meshWireframeColor;
uniform int useWireframe;
uniform float wireframeThickness;
uniform float wireframeFeather;
uniform float wireframeDistanceScale;
uniform float wireframeDistanceMin;
uniform float wireframeDistanceMax;
uniform float wireframeFresnelPower;
uniform float wireframeFresnelStrength;
uniform int useTexture;
uniform int enableLighting;
uniform float materialShininess;
uniform vec3 materialAmbient;
uniform vec3 materialSpecular;
uniform int proceduralTextureType; // 0=None, 1=Checkerboard, 2=Metal, 3=Ceramic, 4=Carbon

uniform sampler2D texMap;

// Simple lighting
uniform vec3 lightDir; // View space light direction

in vec4 vertColor;
in vec2 vertTexCoord;
in vec3 vertNormal;
in vec3 vertPos;

out vec4 fragColor;

vec3 srgbToLinear(vec3 c) {
    return pow(max(c, vec3(0.0)), vec3(2.2));
}

vec3 linearToSrgb(vec3 c) {
    return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
}

// 基于屏幕空间导数计算片元几何法线。
// 在 seam/高曲率区域比插值顶点法线更稳定，可明显减少“缝线高光”。
vec3 geometricNormal(vec3 pos, vec3 fallbackNormal) {
    vec3 dpdx = dFdx(pos);
    vec3 dpdy = dFdy(pos);
    vec3 n = cross(dpdx, dpdy);
    float len2 = dot(n, n);
    if (len2 > 1e-12) {
        return n * inversesqrt(len2);
    }
    return normalize(fallbackNormal);
}

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

void main() {
    if (useWireframe == 1) {
        vec3 bary = clamp(vertColor.rgb, vec3(0.0), vec3(1.0));

        // Ensure minimum visual width of 1 pixel (smoothing only), but fade alpha for sub-pixel thickness
        float thickness = max(wireframeThickness, 0.0);
        float visibleThickness = max(thickness, 1.0);
        float maxAlpha = clamp(thickness, 0.0, 1.0);

        // Solid core with AA edge
        vec3 deltas = fwidth(bary);
        vec3 smoothing = deltas; // 1 pixel smoothing
        vec3 thicknessBary = deltas * ((visibleThickness - 1.0) * 0.5); // Core width (subtract smoothing)

        vec3 a3 = smoothstep(thicknessBary, thicknessBary + smoothing, bary);
        float edge = min(min(a3.x, a3.y), a3.z);

        float alpha = (1.0 - edge) * meshWireframeColor.a * maxAlpha;
        vec3 lineColor = srgbToLinear(meshWireframeColor.rgb);
        vec3 V = normalize(-vertPos);
        vec3 N = normalize(vertNormal);
        float fresnel = pow(1.0 - max(dot(N, V), 0.0), wireframeFresnelPower) * wireframeFresnelStrength;
        lineColor = mix(lineColor, vec3(1.0), fresnel);
        alpha = clamp(alpha + fresnel * meshWireframeColor.a, 0.0, 1.0);
        fragColor = vec4(linearToSrgb(lineColor), alpha);
        return;
    } else if (useWireframe == 2) {
        float depth = max(-vertPos.z, 0.001);
        float atten = clamp(wireframeDistanceScale / depth, wireframeDistanceMin, wireframeDistanceMax);
        float alpha = meshWireframeColor.a * atten;
        vec3 lineColor = srgbToLinear(meshWireframeColor.rgb);
        vec3 V = normalize(-vertPos);
        vec3 N = normalize(vertNormal);
        float fresnel = pow(1.0 - max(dot(N, V), 0.0), wireframeFresnelPower) * wireframeFresnelStrength;
        lineColor = mix(lineColor, vec3(1.0), fresnel);
        fragColor = vec4(linearToSrgb(lineColor), clamp(alpha, 0.0, 1.0));
        return;
    }

    vec4 baseColor = vertColor * meshFillColor;
    float alpha = meshFillOpacity;
    vec3 albedo = srgbToLinear(baseColor.rgb);

    if (proceduralTextureType == 1) {
        float u = vertTexCoord.x * 10.0;
        float v = vertTexCoord.y * 10.0;
        bool check = (int(floor(u)) + int(floor(v))) % 2 == 0;
        if (check) {
            albedo *= 0.7;
        }
    } else if (proceduralTextureType == 2) {
        vec2 uv = vertTexCoord;
        float brushed = 0.5 + 0.5 * sin(uv.y * 260.0 + sin(uv.x * 24.0) * 3.0);
        float grain = hash21(uv * 320.0) * 0.22;
        float metal = clamp(0.62 + brushed * 0.28 + grain, 0.0, 1.0);
        albedo = mix(albedo, vec3(metal), 0.9);
    } else if (proceduralTextureType == 3) {
        vec2 uv = vertTexCoord;
        float speckle = hash21(uv * 180.0);
        float pores = smoothstep(0.62, 1.0, speckle) * 0.12;
        float glaze = 0.92 + 0.08 * sin(uv.x * 12.0 + uv.y * 14.0);
        vec3 ceramic = vec3(0.92, 0.90, 0.87) * glaze;
        albedo = mix(albedo, ceramic, 0.78);
        albedo *= (1.0 - pores);
    } else if (proceduralTextureType == 4) {
        vec2 uv = vertTexCoord * 26.0;
        float stripX = smoothstep(0.15, 0.45, fract(uv.x));
        float stripY = smoothstep(0.15, 0.45, fract(uv.y));
        float weave = abs(stripX - stripY);
        float fiberNoise = hash21(floor(uv)) * 0.16;
        float tone = clamp(0.18 + weave * 0.34 + fiberNoise, 0.0, 1.0);
        vec3 carbon = mix(vec3(0.08), vec3(0.32), tone);
        albedo = mix(albedo, carbon, 0.9);
    }

    if (useTexture != 0) {
        vec4 texColor = texture(texMap, vertTexCoord);
        albedo *= srgbToLinear(texColor.rgb);
        alpha *= texColor.a;
    }

    if (enableLighting != 0) {
        // 填充光照使用片元几何法线，尽量与 CPU 路径的面法线表现保持一致。
        vec3 N = geometricNormal(vertPos, vertNormal);
        vec3 L = normalize(vec3(0.5, 0.5, 1.0));
        if (lightDir != vec3(0.0)) {
            L = normalize(lightDir);
        }

        vec3 V = normalize(-vertPos);
        // 统一法线朝向到观察者半球，避免 seam 邻域出现前后翻转导致的亮暗跳变。
        vec3 N_eff = dot(N, V) < 0.0 ? -N : N;
        float shininessNorm = clamp(materialShininess / 100.0, 0.0, 1.0);
        float diffuseWrap = mix(0.9, 0.0, shininessNorm);
        float diff = max((dot(N_eff, L) + diffuseWrap) / (1.0 + diffuseWrap), 0.0);
        vec3 H = normalize(L + V);
        float specPower = mix(1.5, 110.0, shininessNorm * shininessNorm);
        float specStrength = mix(0.7, 4.8, shininessNorm);
        float spec = pow(max(0.0, dot(N_eff, H)), specPower) * specStrength;

        vec3 ambientColor = materialAmbient;
        vec3 diffuseColor = vec3(diff);
        vec3 specularColor = materialSpecular * spec;
        vec3 lightIntensity = ambientColor + diffuseColor + specularColor;
        albedo *= lightIntensity;
    }

    fragColor = vec4(linearToSrgb(albedo), alpha);
}
`;
