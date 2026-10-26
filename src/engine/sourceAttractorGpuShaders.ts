import {gpuShaderHeader,type GpuShaderProfile} from './gpuShaderProfile';
import type {SourceAttractorGpuFunction} from './sourceAttractorGpuFunction';

/** Retained MathArt 1.7.8 shaders (JAR a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018).
 * OpenGL 4.10 -> WebGL2 adaptation: version and explicit highp only.
 * Formula injection belongs to sourceAttractorGpuFunction. Same-GPU agreement
 * with these sources is not an original JVM/JOGL full-frame comparison. */
const sourceAttractorQuadBody=`
out vec2 texCoord;

void main() {
  float x = float((gl_VertexID & 1) << 1) - 1.0;
  float y = float((gl_VertexID & 2)) - 1.0;
  gl_Position = vec4(x, y, 0.0, 1.0);
  texCoord = vec2((x + 1.0) * 0.5, (y + 1.0) * 0.5);
}
`;
const sourceAttractorUpdateBody=`
uniform sampler2D posTex;
uniform int steps; // Number of integration steps per frame

// Warmup control uniforms
uniform bool isWarmup;
uniform int warmupBase;
uniform int staggerMin;
uniform int staggerRange; // staggerMax - staggerMin
uniform int currentStepBase;

in vec2 texCoord;
out vec4 newPos;

// %ATTRACTOR_FUNCTION_BODY%

// Simple pseudo-random generator based on texture coordinates
// Returns value in [0, 1]
float rand(vec2 co){
    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
}

// Runge-Kutta 4th Order Integration
vec3 rk4(vec3 p, float h) {
  vec3 k1, k2, k3, k4;
  
  calculate_derivative(p, k1);
  calculate_derivative(p + k1 * (h * 0.5), k2);
  calculate_derivative(p + k2 * (h * 0.5), k3);
  calculate_derivative(p + k3 * h, k4);
  
  return p + (k1 + k2 * 2.0 + k3 * 2.0 + k4) * (h / 6.0);
}

void main() {
  // Read current position from texture
  vec4 current = texture(posTex, texCoord);
  vec3 pos = current.xyz;
  float dt = current.w;
  
  // Determine integration limit for this particle
  int myLimit = 2147483647; // Max int (effectively infinite for normal run)
  
  if (isWarmup) {
      // Calculate specific target steps for this particle based on its coordinate
      // This is deterministic for the same particle across multiple passes
      float r = rand(texCoord);
      int extra = staggerMin + int(r * float(staggerRange));
      myLimit = warmupBase + extra;
  }
  
  // Iterate integration steps
  for (int i = 0; i < steps; i++) {
      // In warmup mode, only integrate if we haven't reached this particle's target limit
      // In normal mode (isWarmup=false), always integrate
      if (!isWarmup || (currentStepBase + i < myLimit)) {
          pos = rk4(pos, dt);
      }
  }
  
  newPos = vec4(pos, current.w);
}
`;
const sourceAttractorAccumulateVertexBody=`
uniform mat4 projection;
uniform mat4 modelview;
uniform float radius;
uniform vec3 scale;
uniform vec3 offset;
uniform sampler2D posTex;

in vec2 texIndex;
in vec4 color;

out vec4 vertColor;

void main() {
  vec4 posData = texture(posTex, texIndex);
  vec3 pos = posData.xyz * scale + offset;

  gl_Position = projection * modelview * vec4(pos, 1.0);
  gl_PointSize = max(radius, 1.0);
  vertColor = color;
}
`;
const sourceAttractorAccumulateFragmentBody=`
in vec4 vertColor;
out vec4 fragColor;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) {
    discard;
  }

  float dist = sqrt(r2);
  float coverage = 1.0 - smoothstep(0.72, 1.0, dist);
  float softCore = exp(-0.55 * r2);
  float weight = coverage * softCore * max(vertColor.a, 0.0);

  fragColor = vec4(weight, vertColor.rgb * weight);
}
`;
const sourceAttractorPresentBody=`
uniform sampler2D accumTex;
uniform vec3 backgroundRgb;
uniform float exposure;
uniform float contrast;
uniform float gamma;
uniform float saturation;
uniform float densityScale;

in vec2 texCoord;
out vec4 fragColor;

vec3 rgb2yuv(vec3 rgb) {
  float y = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
  return vec3(y, 0.493 * (rgb.b - y), 0.877 * (rgb.r - y));
}

vec3 yuv2rgb(vec3 yuv) {
  return vec3(
      yuv.x + (1.0 / 0.877) * yuv.z,
      yuv.x - 0.39393 * yuv.y - 0.58081 * yuv.z,
      yuv.x + (1.0 / 0.493) * yuv.y
  );
}

void main() {
  vec4 accum = texture(accumTex, texCoord);
  float count = max(accum.r, 0.0);
  if (count <= 1.0e-8) {
    fragColor = vec4(backgroundRgb, 1.0);
    return;
  }

  vec3 avgRgb = accum.gba / count;
  float density = count / max(densityScale, 1.0e-6);
  float exposureSafe = max(exposure, 0.001);
  float value = log(1.0 + density * exposureSafe) / log(1.0 + exposureSafe * 6.0);
  value = (value - 0.5) * max(contrast, 0.001) + 0.5;
  value = clamp(value, 0.0, 1.0);

  vec3 yuv = rgb2yuv(avgRgb);
  yuv.yz *= saturation;
  vec3 hueRgb = clamp(yuv2rgb(yuv), 0.0, 1.0);
  vec3 mapped = hueRgb * value;
  mapped = pow(mapped, vec3(1.0 / max(gamma, 0.001)));

  float foregroundAlpha = clamp(density / (density + 0.08), 0.0, 0.92);
  vec3 rgb = mix(backgroundRgb, mapped, foregroundAlpha);
  fragColor = vec4(rgb, 1.0);
}
`;

const header=(profile:GpuShaderProfile)=>gpuShaderHeader(profile,'precision highp float;\nprecision highp int;\n');
export const sourceAttractorQuad=header('webgl2')+sourceAttractorQuadBody;
export const sourceAttractorUpdate=header('webgl2')+sourceAttractorUpdateBody;
export const sourceAttractorAccumulateVertex=header('webgl2')+sourceAttractorAccumulateVertexBody;
export const sourceAttractorAccumulateFragment=header('webgl2')+sourceAttractorAccumulateFragmentBody;
export const sourceAttractorPresent=header('webgl2')+sourceAttractorPresentBody;
export function sourceAttractorGpuPrograms(shader:SourceAttractorGpuFunction,profile:GpuShaderProfile){
 const prefix=header(profile),quad=prefix+sourceAttractorQuadBody;
 return{update:{vertex:quad,fragment:prefix+sourceAttractorUpdateBody.replace('// %ATTRACTOR_FUNCTION_BODY%',shader.code)},
  accumulate:{vertex:prefix+sourceAttractorAccumulateVertexBody,fragment:prefix+sourceAttractorAccumulateFragmentBody},
  present:{vertex:quad,fragment:prefix+sourceAttractorPresentBody}};
}
