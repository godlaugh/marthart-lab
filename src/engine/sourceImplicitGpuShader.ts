/** Original 1.7.8 implicit_mesh_vert.glsl SHA-256 739452b168f5b67bdb2b3d47db01982631f58c7b75a3c632ab04dc552f666c04.
 * Shader dialect header/precision only are adapted; arithmetic and branch order remain unchanged. */
export const sourceImplicitGpuVertex=`precision highp float;
precision highp int;
uniform mat4 transform;
uniform mat4 modelview;
in vec4 vertex;
in vec3 normal;
in vec4 color;
in vec2 texCoord;
out vec4 vertColor;
out vec2 vertTexCoord;
out vec3 vertNormal;
out vec3 vertPos;
out float vertHeight;
uniform vec3 boundsMin;
uniform vec3 boundsMax;
void main() {
    vec3 pos = vertex.xyz;
    vertPos = (modelview * vec4(pos, 1.0)).xyz;
    vertNormal = normalize((modelview * vec4(normal, 0.0)).xyz);
    vertColor = color;
    vec3 denom = max(boundsMax - boundsMin, vec3(1e-6));
    vec3 local = (pos - boundsMin) / denom;
    vertTexCoord = local.xy;
    vertHeight = local.z;
    gl_Position = transform * vec4(pos, 1.0);
}
`;

/** Original 1.7.8 implicit_mesh_frag.glsl SHA-256 15bc64378fccba32df8808defc4b4e266f049a0444d75c4dcaa9b953f98f39e8.
 * Shader dialect header/precision only are adapted; arithmetic and branch order remain unchanged. */
export const sourceImplicitGpuFragment=`precision highp float;
precision highp int;
uniform vec4 meshFillColor;
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
uniform int proceduralTextureType;
uniform sampler2D texMap;
uniform vec3 lightDir;
uniform int paletteSize;
uniform sampler2D paletteTex;
in vec4 vertColor;
in vec2 vertTexCoord;
in vec3 vertNormal;
in vec3 vertPos;
in float vertHeight;
out vec4 fragColor;
vec3 srgbToLinear(vec3 c) {
    return pow(max(c, vec3(0.0)), vec3(2.2));
}
vec3 linearToSrgb(vec3 c) {
    return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
}
vec3 getPaletteColor(float t) {
    if (paletteSize <= 0) return meshFillColor.rgb;
    if (paletteSize == 1) {
        return texture(paletteTex, vec2(0.5, 0.5)).rgb;
    }
    float p = clamp(t, 0.0, 1.0);
    float texCoord = (p * (float(paletteSize) - 1.0) + 0.5) / float(paletteSize);
    return texture(paletteTex, vec2(texCoord, 0.5)).rgb;
}
float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
void main() {
    if (useWireframe == 1) {
        vec3 bary = clamp(vertColor.rgb, vec3(0.0), vec3(1.0));
        float thickness = max(wireframeThickness, 0.0);
        float visibleThickness = max(thickness, 1.0);
        float maxAlpha = clamp(thickness, 0.0, 1.0);
        vec3 deltas = fwidth(bary);
        vec3 smoothing = deltas;
        vec3 thicknessBary = deltas * ((visibleThickness - 1.0) * 0.5);
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
    vec3 baseRgb;
    if (paletteSize > 0) {
        baseRgb = getPaletteColor(vertHeight);
    } else {
        baseRgb = (vertColor * meshFillColor).rgb;
    }
    float alpha = meshFillOpacity;
    vec3 albedo = srgbToLinear(baseRgb);
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
        vec3 N = normalize(vertNormal);
        vec3 L = normalize(vec3(0.5, 0.5, 1.0));
        if (lightDir != vec3(0.0)) {
            L = normalize(lightDir);
        }
        float nDotL = dot(N, L);
        vec3 V = normalize(-vertPos);
        if (dot(N, V) < 0.0) {
            N = -N;
        }
        float shininessNorm = clamp(materialShininess / 100.0, 0.0, 1.0);
        float diffuseWrap = mix(0.9, 0.0, shininessNorm);
        float diff = max((dot(N, L) + diffuseWrap) / (1.0 + diffuseWrap), 0.0);
        vec3 H = normalize(L + V);
        float specPower = mix(1.5, 110.0, shininessNorm * shininessNorm);
        float specStrength = mix(0.7, 4.8, shininessNorm);
        float spec = pow(max(0.0, dot(N, H)), specPower) * specStrength;
        vec3 ambientColor = materialAmbient;
        vec3 diffuseColor = vec3(diff);
        vec3 specularColor = materialSpecular * spec;
        vec3 lightIntensity = ambientColor + diffuseColor + specularColor;
        albedo *= lightIntensity;
    }
    fragColor = vec4(linearToSrgb(albedo), alpha);
}
`;
