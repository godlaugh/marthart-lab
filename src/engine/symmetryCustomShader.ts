import {gpuShaderHeader,type GpuShaderProfile} from './gpuShaderProfile';
import {SYMMETRY_CUSTOM_LOOP_ITERATIONS,type PreparedSymmetryCustomSource} from './symmetryCustom';

/** Pure fragment kernel. IteratedDensityGpu exclusively owns GL resources,
 * state, scheduling and error reduction; this module never borrows a context.
 * Metadata.r is mathematical invalidCount; .g bit 0 is final validity and bit
 * 1 is sticky loop-budget failure. Negative authored metrics remain valid.
 * calculate_next must assign both out arguments on every executed path; GLSL
 * leaves unwritten out arguments undefined. The NaN initialization below is
 * not a definite-assignment proof and cannot make such source well-defined.
 */
export function symmetryCustomFragmentSource(plan:PreparedSymmetryCustomSource,profile:GpuShaderProfile='webgl2'):string {
 return gpuShaderHeader(profile,'precision highp float;\nprecision highp int;\n')+`uniform highp sampler2D rea_states;
uniform highp usampler2D rea_metadata;
uniform ivec2 rea_sourceSize;
uniform int rea_count,rea_steps,rea_resetCounter;
uniform uint rea_seed,rea_serialBase;
uniform vec3 rea_lower,rea_upper;
uniform float rea_escapeRadius;
layout(location=0)out vec4 rea_nextState;
layout(location=1)out uvec4 rea_nextMeta;
int rea_customLoopRemaining;
bool rea_customLoopExceeded;
bool rea_customLoopTick(){if(rea_customLoopRemaining<=0){rea_customLoopExceeded=true;return false;}rea_customLoopRemaining--;return true;}
bool rea_finiteFloat(float v){return (floatBitsToUint(v)&0x7f800000u)!=0x7f800000u;}
bool rea_finiteVector(vec3 v){return rea_finiteFloat(v.x)&&rea_finiteFloat(v.y)&&rea_finiteFloat(v.z);}
float rea_stableLength(vec3 p){float m=max(max(abs(p.x),abs(p.y)),abs(p.z));return m==0.?0.:m*length(p/m);}
uint rea_address(uint id,uint serial,uint channel){uint x=rea_seed^((id+1u)*0x9e3779b1u)^(serial*0x85ebca77u)^((channel+1u)*0x27d4eb2du);x=(x^(x>>16))*0x7feb352du;x=(x^(x>>15))*0x846ca68bu;return x^(x>>16);}
vec3 rea_initial(uint id,uint serial){vec3 u=vec3(rea_address(id,serial,0u),rea_address(id,serial,1u),rea_address(id,serial,2u))/4294967296.;vec3 p=rea_lower+(rea_upper-rea_lower)*u;p.z=0.;return p;}
// Resolve host precision and builtins before caller declarations. The caller
// may use its own precision statements and function overloads within its code.
void calculate_next(in vec3 pos,out vec3 nextPos,out float stepMetric);
void main(){
 ivec2 rea_pixel=ivec2(gl_FragCoord.xy);int rea_index=rea_pixel.y*rea_sourceSize.x+rea_pixel.x;
 if(rea_index>=rea_count)discard;
 vec4 rea_state=texelFetch(rea_states,rea_pixel,0);uvec2 rea_meta=texelFetch(rea_metadata,rea_pixel,0).rg;
 uint rea_invalid=rea_resetCounter==1?0u:rea_meta.r;bool rea_failed=(rea_meta.g&2u)!=0u;
 vec3 rea_position=rea_state.xyz;float rea_metric=rea_state.w;bool rea_valid=(rea_meta.g&1u)!=0u;
 for(int rea_j=0;rea_j<256;rea_j++){
  if(rea_j>=rea_steps||rea_failed)break;
  rea_customLoopRemaining=${SYMMETRY_CUSTOM_LOOP_ITERATIONS};rea_customLoopExceeded=false;
  vec3 rea_next=vec3(uintBitsToFloat(0x7fc00000u));float rea_stepMetric=uintBitsToFloat(0x7fc00000u);
  calculate_next(rea_position,rea_next,rea_stepMetric);rea_next.z=0.;
  if(rea_customLoopExceeded){rea_failed=true;rea_valid=false;break;}
  rea_metric=rea_stepMetric;
  rea_valid=rea_finiteVector(rea_next)&&rea_finiteFloat(rea_metric)&&rea_stableLength(rea_next)<=rea_escapeRadius;
  if(rea_valid)rea_position=rea_next;else{rea_invalid++;rea_position=rea_initial(uint(rea_index),rea_serialBase+uint(rea_j));}
 }
 rea_nextState=vec4(rea_position,rea_metric);rea_nextMeta=uvec4(rea_invalid,(rea_valid?1u:0u)|(rea_failed?2u:0u),0u,0u);
}
#line 1 1
${plan.instrumentedSource}
`;
}
