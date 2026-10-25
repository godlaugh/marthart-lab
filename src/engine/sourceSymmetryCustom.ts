import {prepareSymmetryCustomInput,type SymmetryCustomInput} from './symmetryCustom';

export const SOURCE_SYMMETRY_CUSTOM_DIALECT='mathart-1.7.8-custom-fragment-gl41-v1' as const;
export interface SourceSymmetryCustomProgram extends SymmetryCustomInput {
 readonly dialect:typeof SOURCE_SYMMETRY_CUSTOM_DIALECT;
 readonly vertex:string;
 readonly fragment:string;
}

/** Native source dialect, intentionally not the budgeted ES dialect. The host
 * must run a full ceil(sqrt(count)) square RGBA32F ping-pong pass, retain and
 * evolve padding, bind the frozen input to stateTex, and set iterations.
 * Body macros, fragment globals, output initialization and raw nonfinite
 * results remain driver semantics. No TF wrapper, loop guard or reseeding.
 *
 * The producer and retained texture owner have separate native diagnostics.
 * Native compute and ink owners consume this profile. App routing still
 * requires explicit host graphics lifecycle and cancellation integration. Compilation alone neither
 * proves termination nor bounds arbitrary authored shader execution time. */
export function prepareSourceSymmetryCustomProgram(rawSource:string,compileDegree:number):SourceSymmetryCustomProgram {
 const input=prepareSymmetryCustomInput(rawSource,compileDegree);
 const vertex=`#version 410 core

in vec2 quadPosition;
out vec2 texCoord;

void main() {
  float x = quadPosition.x;
  float y = quadPosition.y;
  gl_Position = vec4(x, y, 0.0, 1.0);
  texCoord = vec2((x + 1.0) * 0.5, (y + 1.0) * 0.5);
}
`;
 const fragment=`#version 410 core

uniform sampler2D stateTex;
uniform int iterations;

in vec2 texCoord;
out vec4 newState;

${input.expandedSource}

void main() {
  vec4 current = texture(stateTex, texCoord);
  vec3 pos = current.xyz;
  float stepMetric = current.w;

  int stepCount = clamp(iterations, 1, 16);
  for (int i = 0; i < 16; i++) {
    if (i >= stepCount) break;
    vec3 nextPos = pos;
    float metric = stepMetric;
    calculate_next(pos, nextPos, metric);
    nextPos.z = 0.0;
    pos = nextPos;
    stepMetric = metric;
  }

  newState = vec4(pos, stepMetric);
}
`;
 return Object.freeze({...input,dialect:SOURCE_SYMMETRY_CUSTOM_DIALECT,vertex,fragment});
}
