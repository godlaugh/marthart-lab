// Adapted from retained MathArt 1.7.8 point_vert_gpu.glsl (SHA-256
// 7a05896beae4008f2cd6fabf228edc4c2ba81809781440c92561b3bfb8fe6476).
// Only version/input transport and identity sprite UV matrix are adapted.
const template=`precision highp float;
precision highp int;

uniform mat4 projection;
uniform mat4 modelview;


uniform float time; // 全局时间

// 粒子参数：
// particleSeed.x = u_start
// particleSeed.y = v_start
// particleSeed.z = u_speed
// particleSeed.w = v_speed (通过 normal 属性传递)
in vec4 particleSeed;


in vec4 particleTint;
in vec2 uv;

out vec4 vertColor;
out vec2 vertTexCoord;
out vec2 vertBillboardCoord;

uniform float radius;
uniform float focalLength;
// uniform float viewHeight; // Removed unused uniform

// 缩放系数
uniform vec3 surfaceScale;
uniform vec3 surfaceOffset;

uniform vec2 uLimits;
uniform vec2 vLimits;
uniform ivec2 isPeriodic;
uniform ivec2 isFlowing;
uniform int fadePoints;

// 动态参数 Uniforms (预留足够的槽位)
// 使用数组以支持更多参数
uniform float params[32];
// uniform int ints[8]; // 暂时保留，如有需要可启用

// -----------------------------------------------------------
// 动态注入区域
// -----------------------------------------------------------
vec3 getSurfacePos(float u, float v) {
    // %SURFACE_FUNCTION_BODY%
    return vec3(0.0, 0.0, 0.0); // Fallback
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
  // 1. 计算当前参数 (u, v)
  // u = u_start + u_speed * time
  // v = v_start + v_speed * time
  float rawU = particleSeed.x + particleSeed.z * time;
  float rawV = particleSeed.y + particleSeed.w * time;

  float u = rawU;
  float v = rawV;

  float alphaFactor = 1.0;
  float fadeZoneU = (uLimits.y - uLimits.x) * 0.1;
  float fadeZoneV = (vLimits.y - vLimits.x) * 0.1;

  if (isPeriodic.x != 0) {
      if (isFlowing.x != 0) {
          u = wrap(rawU, uLimits.x, uLimits.y);
          // Fade
          float dist = min(u - uLimits.x, uLimits.y - u);
          if (dist < fadeZoneU) alphaFactor *= dist / fadeZoneU;
      } else {
          u = pingPong(rawU, uLimits.x, uLimits.y);
      }
  }

  if (isPeriodic.y != 0) {
      if (isFlowing.y != 0) {
          v = wrap(rawV, vLimits.x, vLimits.y);
          // Fade
          float dist = min(v - vLimits.x, vLimits.y - v);
          if (dist < fadeZoneV) alphaFactor *= dist / fadeZoneV;
      } else {
          v = pingPong(rawV, vLimits.x, vLimits.y);
      }
  }

  // 2. 调用注入的数学函数计算 3D 位置
  vec3 rawPos = getSurfacePos(u, v);

  // 2.5 应用缩放 (对应 CPU 的 d.pos.x *= scaleX)
  // Changed from division to multiplication to match intuitive scaling
  vec3 pos = rawPos * surfaceScale + surfaceOffset;


  vec4 viewPos = modelview * vec4(pos, 1.0);

  // 4. 透视补偿与 Billboarding (保持原有逻辑)
  float depth = -viewPos.z;
  if (depth < 0.1) depth = 0.1;
  float r = radius * (depth / focalLength);

  vec2 offset = (uv - 0.5) * 2.0;
  viewPos.xy += offset * r;

  gl_Position = projection * viewPos;

  vertColor = particleTint;
  if (fadePoints != 0) {
      vertColor.a *= alphaFactor;
  }
  vertBillboardCoord = uv;
  vertTexCoord = uv;
}
`;
export function sourceSurfaceGpuPointVertex(functionBody:string):string{return template.replace('// %SURFACE_FUNCTION_BODY%',functionBody);}
